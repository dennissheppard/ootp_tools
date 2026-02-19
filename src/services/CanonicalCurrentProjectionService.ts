import { getFullName, getPositionLabel, isPitcher } from '../models/Player';
import { scoutingDataFallbackService } from './ScoutingDataFallbackService';
import { hitterScoutingDataService } from './HitterScoutingDataService';
import { trueRatingsService } from './TrueRatingsService';
import { teamRatingsService } from './TeamRatingsService';
import { playerService } from './PlayerService';
import { teamService } from './TeamService';
import { projectionService, ProjectedPlayer } from './ProjectionService';
import { ProjectedBatter } from './BatterProjectionService';
import { resolveCanonicalPitcherData, resolveCanonicalBatterData, computePitcherProjection, computeBatterProjection } from './ModalDataService';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';
import { leagueBattingAveragesService } from './LeagueBattingAveragesService';
import { fipWarService } from './FipWarService';
import type { PitcherProfileData } from '../views/PitcherProfileModal';
import type { BatterProfileData } from '../views/BatterProfileModal';

export interface CanonicalCurrentProjectionSnapshot {
  pitchers: Map<number, ProjectedPlayer>;
  batters: Map<number, ProjectedBatter>;
}

function estimatePitcherIpLikeModal(stamina: number, injury?: string): number {
  let baseIp: number;
  if (stamina >= 65) {
    baseIp = 180 + (stamina - 65) * 1.5;
  } else if (stamina >= 50) {
    baseIp = 120 + (stamina - 50) * 4;
  } else if (stamina >= 35) {
    baseIp = 65 + (stamina - 35) * 3.67;
  } else {
    baseIp = 40 + (stamina - 20) * 1.67;
  }

  const injuryMultiplier: Record<string, number> = {
    Ironman: 1.15,
    Durable: 1.10,
    Normal: 1.0,
    Wary: 0.95,
    Fragile: 0.90,
    Prone: 0.80,
    Wrecked: 0.75,
  };
  const mult = injuryMultiplier[injury ?? 'Normal'] ?? 0.95;
  return Math.round(baseIp * mult);
}

function computeWobaLikeModal(
  bbRate: number,
  avg: number,
  doublesRate: number,
  triplesRate: number,
  hrRate: number
): number {
  const abRate = 1 - bbRate;
  const singlesPerAb = Math.max(0, avg - doublesRate - triplesRate - hrRate);
  return 0.69 * bbRate + abRate * (0.89 * singlesPerAb + 1.27 * doublesRate + 1.62 * triplesRate + 2.10 * hrRate);
}

class CanonicalCurrentProjectionService {
  private cache = new Map<number, CanonicalCurrentProjectionSnapshot>();
  private inFlight = new Map<number, Promise<CanonicalCurrentProjectionSnapshot>>();

  async getSnapshot(year: number): Promise<CanonicalCurrentProjectionSnapshot> {
    const cached = this.cache.get(year);
    if (cached) return cached;

    const pending = this.inFlight.get(year);
    if (pending) return pending;

    const buildPromise = this.buildSnapshot(year).finally(() => {
      this.inFlight.delete(year);
    });

    this.inFlight.set(year, buildPromise);
    return buildPromise;
  }

  private async buildSnapshot(year: number): Promise<CanonicalCurrentProjectionSnapshot> {
    const [
      allPlayers,
      allTeams,
      pitcherTrMap,
      batterTrMap,
      unifiedPitcherTfr,
      unifiedHitterTfr,
      pitcherScoutFallback,
      myHitterScout,
      osaHitterScout,
      leagueAvg,
      pitchingYears,
      battingYears,
    ] = await Promise.all([
      playerService.getAllPlayers(),
      teamService.getAllTeams(),
      trueRatingsService.getPitcherTrueRatings(year),
      trueRatingsService.getHitterTrueRatings(year),
      teamRatingsService.getUnifiedPitcherTfrData(year).catch(() => null),
      teamRatingsService.getUnifiedHitterTfrData(year).catch(() => null),
      scoutingDataFallbackService.getScoutingRatingsWithFallback(undefined, 'my').catch(() => ({ ratings: [] as any[] })),
      hitterScoutingDataService.getLatestScoutingRatings('my').catch(() => [] as any[]),
      hitterScoutingDataService.getLatestScoutingRatings('osa').catch(() => [] as any[]),
      leagueBattingAveragesService.getLeagueAverages(year - 1).catch(() => null),
      Promise.all(
        [year, year - 1, year - 2, year - 3, year - 4].map(y =>
          trueRatingsService.getTruePitchingStats(y).catch(() => [])
        )
      ),
      Promise.all(
        [year, year - 1, year - 2, year - 3, year - 4].map(y =>
          trueRatingsService.getTrueBattingStats(y).catch(() => [])
        )
      ),
    ]);

    const teamById = new Map(allTeams.map(t => [t.id, t]));
    const pitcherTfrMap = new Map((unifiedPitcherTfr?.prospects ?? []).map(p => [p.playerId, p]));
    const hitterTfrMap = new Map((unifiedHitterTfr?.prospects ?? []).map(p => [p.playerId, p]));
    const pitcherScoutMap = new Map(pitcherScoutFallback.ratings.map((r: any) => [r.playerId, r]));

    const hitterScoutMap = new Map<number, any>();
    for (const r of osaHitterScout) hitterScoutMap.set(r.playerId, r);
    for (const r of myHitterScout) hitterScoutMap.set(r.playerId, r);

    const pitcherStatsByYear = new Map<number, Map<number, any>>();
    const pitcherYears = [year, year - 1, year - 2, year - 3, year - 4];
    for (let i = 0; i < pitcherYears.length; i++) {
      pitcherStatsByYear.set(
        pitcherYears[i],
        new Map((pitchingYears[i] ?? []).map((s: any) => [s.player_id, s]))
      );
    }

    const battingStatsByYear = new Map<number, Map<number, any>>();
    const battingYearList = [year, year - 1, year - 2, year - 3, year - 4];
    for (let i = 0; i < battingYearList.length; i++) {
      battingStatsByYear.set(
        battingYearList[i],
        new Map((battingYears[i] ?? []).map((s: any) => [s.player_id, s]))
      );
    }

    const pitcherSnapshots = new Map<number, ProjectedPlayer>();
    const batterSnapshots = new Map<number, ProjectedBatter>();

    for (const player of allPlayers) {
      if (isPitcher(player)) {
        const tr = pitcherTrMap.get(player.id);
        const tfr = pitcherTfrMap.get(player.id);
        if (!tr && !tfr) continue;

        const scouting = pitcherScoutMap.get(player.id);
        const teamId = player.teamId;
        const teamName = teamById.get(teamId)?.nickname ?? 'Unknown';

        const data: PitcherProfileData = {
          playerId: player.id,
          playerName: getFullName(player),
          team: teamName,
          parentTeam: teamName,
          age: player.age,
          position: player.position,
          positionLabel: getPositionLabel(player.position),
          scoutStuff: scouting?.stuff,
          scoutControl: scouting?.control,
          scoutHra: scouting?.hra,
          scoutStamina: scouting?.stamina,
          injuryProneness: scouting?.injuryProneness,
          scoutOvr: scouting?.ovr,
          scoutPot: scouting?.pot,
          pitchRatings: scouting?.pitches,
        };
        resolveCanonicalPitcherData(data, tr, tfr);

        const mlbStats: Array<{ year: number; level: string; ip: number; k9: number; bb9: number; hr9: number; fip?: number; war?: number; gs: number }> = [];
        for (const y of pitcherYears) {
          const stat = pitcherStatsByYear.get(y)?.get(player.id);
          if (!stat) continue;
          const ip = trueRatingsService.parseIp(stat.ip);
          if (ip <= 0) continue;
          const k9 = (stat.k / ip) * 9;
          const bb9 = (stat.bb / ip) * 9;
          const hr9 = (stat.hra / ip) * 9;
          const fip = ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + 3.47;
          mlbStats.push({
            year: y,
            level: 'MLB',
            ip,
            k9,
            bb9,
            hr9,
            fip,
            war: stat.war,
            gs: stat.gs ?? 0,
          });
        }

        let projectedIpFromService: number | null = null;
        if (data.projIp === undefined) {
          try {
            const currentRatings = {
              stuff: data.estimatedStuff ?? scouting?.stuff ?? 50,
              control: data.estimatedControl ?? scouting?.control ?? 50,
              hra: data.estimatedHra ?? scouting?.hra ?? 50,
            };
            const historicalStats = mlbStats.map(st => ({
              year: st.year,
              ip: st.ip,
              k9: st.k9,
              bb9: st.bb9,
              hr9: st.hr9,
              gs: st.gs,
            }));
            const latestMlb = historicalStats[0];
            const calc = await projectionService.calculateProjection(
              currentRatings,
              data.age ?? 27,
              scouting?.pitches ? Object.values(scouting.pitches).filter((r: any) => r >= 25).length : 0,
              latestMlb?.gs ?? 0,
              { fipConstant: 3.47, avgFip: 4.20, runsPerWin: 8.50 },
              scouting?.stamina ?? data.scoutStamina,
              scouting?.injuryProneness ?? data.injuryProneness,
              historicalStats.length > 0 ? historicalStats : undefined,
              data.trueRating ?? 0,
              scouting?.pitches ?? data.pitchRatings,
            );
            projectedIpFromService = calc.projectedStats.ip;
          } catch {
            projectedIpFromService = null;
          }
        }

        const proj = computePitcherProjection(data, mlbStats, {
          projectionMode: 'current',
          scoutingData: scouting ? { stamina: scouting.stamina, injuryProneness: scouting.injuryProneness } : null,
          projectedIp: projectedIpFromService,
          estimateIp: (stamina, injury) => estimatePitcherIpLikeModal(stamina, injury),
          calculateWar: (fip, ip) => fipWarService.calculateWar(fip, ip),
        });

        const totalGs = mlbStats.reduce((sum, s) => sum + (s.gs ?? 0), 0);
        const usablePitchCount = scouting?.pitches ? Object.values(scouting.pitches).filter((v: any) => (v ?? 0) >= 45).length : 0;
        const hasStarterProfile = (scouting?.stamina ?? 0) >= 30 && usablePitchCount >= 3;
        const isSp = totalGs >= 5 || hasStarterProfile;

        const currentRating = tr?.trueRating ?? tfr?.trueFutureRating ?? 0.5;
        const projectedTrueRating = (data.hasTfrUpside && data.trueFutureRating !== undefined)
          ? data.trueFutureRating
          : currentRating;

        pitcherSnapshots.set(player.id, {
          playerId: player.id,
          name: getFullName(player),
          teamId,
          teamName,
          position: player.position,
          age: player.age,
          currentTrueRating: currentRating,
          currentPercentile: tr?.percentile,
          projectedTrueRating,
          projectedStats: {
            k9: proj.projK9,
            bb9: proj.projBb9,
            hr9: proj.projHr9,
            fip: proj.projFip,
            war: proj.projWar,
            ip: proj.projIp,
          },
          projectedRatings: {
            stuff: proj.ratings.stuff,
            control: proj.ratings.control,
            hra: proj.ratings.hra,
          },
          isSp,
          fipLike: tr?.fipLike,
          isProspect: data.isProspect === true,
        });
      } else {
        const tr = batterTrMap.get(player.id);
        const tfr = hitterTfrMap.get(player.id);
        if (!tr && !tfr) continue;

        const scouting = hitterScoutMap.get(player.id);
        const teamId = player.teamId;
        const teamName = teamById.get(teamId)?.nickname ?? 'Unknown';

        const data: BatterProfileData = {
          playerId: player.id,
          playerName: getFullName(player),
          team: teamName,
          parentTeam: teamName,
          age: player.age,
          position: player.position,
          positionLabel: getPositionLabel(player.position),
          scoutPower: scouting?.power,
          scoutEye: scouting?.eye,
          scoutAvoidK: scouting?.avoidK,
          scoutContact: scouting?.contact,
          scoutGap: scouting?.gap,
          scoutSpeed: scouting?.speed,
          scoutSR: scouting?.stealingAggressiveness,
          scoutSTE: scouting?.stealingAbility,
          scoutOvr: scouting?.ovr,
          scoutPot: scouting?.pot,
          injuryProneness: scouting?.injuryProneness,
        };
        resolveCanonicalBatterData(data, tr, tfr);

        const mlbStats: Array<{ year: number; level: string; pa: number; avg: number; obp: number; slg: number; hr: number; d?: number; t?: number; rbi: number; sb: number; cs: number; bb: number; k: number; war?: number }> = [];
        for (const y of battingYearList) {
          const stat = battingStatsByYear.get(y)?.get(player.id);
          if (!stat || stat.pa <= 0) continue;
          const singles = stat.h - stat.d - stat.t - stat.hr;
          const slg = stat.ab > 0 ? (singles + 2 * stat.d + 3 * stat.t + 4 * stat.hr) / stat.ab : 0;
          mlbStats.push({
            year: y,
            level: 'MLB',
            pa: stat.pa,
            avg: stat.avg,
            obp: stat.obp,
            slg,
            hr: stat.hr,
            d: stat.d,
            t: stat.t,
            rbi: stat.rbi,
            sb: stat.sb,
            cs: stat.cs,
            bb: stat.bb,
            k: stat.k,
            war: stat.war,
          });
        }

        const proj = computeBatterProjection(data, mlbStats, {
          projectionMode: 'current',
          projectionYear: year,
          leagueAvg,
          scoutingData: scouting ? {
            injuryProneness: scouting.injuryProneness,
            stealingAggressiveness: scouting.stealingAggressiveness,
            stealingAbility: scouting.stealingAbility,
          } : null,
          expectedBbPct: (eye) => HitterRatingEstimatorService.expectedBbPct(eye),
          expectedKPct: (avoidK) => HitterRatingEstimatorService.expectedKPct(avoidK),
          expectedAvg: (contact) => HitterRatingEstimatorService.expectedAvg(contact),
          expectedHrPct: (power) => HitterRatingEstimatorService.expectedHrPct(power),
          expectedDoublesRate: (gap) => HitterRatingEstimatorService.expectedDoublesRate(gap),
          expectedTriplesRate: (speed) => HitterRatingEstimatorService.expectedTriplesRate(speed),
          getProjectedPa: (injury, age) => leagueBattingAveragesService.getProjectedPa(injury, age),
          getProjectedPaWithHistory: (history, age, injury) => leagueBattingAveragesService.getProjectedPaWithHistory(history, age, injury),
          calculateOpsPlus: (obp, slg, lg) => leagueBattingAveragesService.calculateOpsPlus(obp, slg, lg),
          computeWoba: (bbRate, avg, d, t, hr) => computeWobaLikeModal(bbRate, avg, d, t, hr),
          calculateBaserunningRuns: (sb, cs) => leagueBattingAveragesService.calculateBaserunningRuns(sb, cs),
          calculateBattingWar: (woba, pa, lg, sbRuns) => leagueBattingAveragesService.calculateBattingWar(woba, pa, lg, sbRuns),
          projectStolenBases: (sr, ste, pa) => HitterRatingEstimatorService.projectStolenBases(sr, ste, pa),
        });

        const currentRating = tr?.trueRating ?? tfr?.trueFutureRating ?? 0.5;

        batterSnapshots.set(player.id, {
          playerId: player.id,
          name: getFullName(player),
          teamId,
          teamName,
          position: player.position,
          positionLabel: getPositionLabel(player.position),
          age: player.age,
          currentTrueRating: currentRating,
          percentile: tr?.percentile ?? tfr?.percentile ?? 0,
          projectedStats: {
            woba: proj.projWoba,
            avg: proj.projAvg,
            obp: proj.projObp,
            slg: proj.projSlg,
            ops: proj.projOps,
            wrcPlus: proj.projOpsPlus,
            war: proj.projWar,
            pa: proj.projPa,
            hr: proj.projHr,
            rbi: Math.round(proj.projPa * 0.12),
            sb: proj.projSb,
            hrPct: proj.projHrPct,
            bbPct: proj.projBbPct,
            kPct: proj.projKPct,
          },
          estimatedRatings: {
            power: proj.ratings.power,
            eye: proj.ratings.eye,
            avoidK: proj.ratings.avoidK,
            contact: proj.ratings.contact,
          },
          scoutingRatings: scouting ? {
            power: scouting.power,
            eye: scouting.eye,
            avoidK: scouting.avoidK,
            contact: scouting.contact,
          } : undefined,
          isProspect: data.isProspect === true,
        } as ProjectedBatter);
      }
    }

    const snapshot = {
      pitchers: pitcherSnapshots,
      batters: batterSnapshots,
    };
    this.cache.set(year, snapshot);
    return snapshot;
  }
}

export const canonicalCurrentProjectionService = new CanonicalCurrentProjectionService();
