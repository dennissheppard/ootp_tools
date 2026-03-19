/**
 * BatterProjectionService
 *
 * Generates stat projections for MLB batters using:
 * - Prior year batting stats
 * - Scouting ratings (blended with stats)
 * - League averages for wRC+ and WAR calculations
 */

import { playerService } from './PlayerService';
import { teamService } from './TeamService';
import { Team } from '../models/Team';
import { trueRatingsService, TruePlayerBattingStats } from './TrueRatingsService';
import { hitterScoutingDataService } from './HitterScoutingDataService';
import {
  HitterTrueRatingResult,
  YearlyHittingStats,
} from './HitterTrueRatingsCalculationService';
import { leagueBattingAveragesService, LeagueBattingAverages } from './LeagueBattingAveragesService';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';
import { hitterAgingService } from './HitterAgingService';
import { dateService } from './DateService';
import { HitterScoutingRatings } from '../models/ScoutingData';
import { supabaseDataService } from './SupabaseDataService';
import { resolveCanonicalBatterData, computeBatterProjection } from './ModalDataService';
import { computeEffectiveParkFactors } from './ParkFactorService';
import type { BatterProfileData } from '../views/BatterProfileModal';

export interface ProjectedBatter {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
  position: number;
  positionLabel: string;
  level?: number;
  parentTeamId?: number;
  age: number;
  /** Current True Rating (0.5-5.0) */
  currentTrueRating: number;
  /** Percentile (0-100) for True Rating */
  percentile: number;
  /** Projected stats for next season */
  projectedStats: {
    woba: number;
    avg: number;
    obp: number;
    slg: number;
    ops: number;
    wrcPlus: number;
    war: number;
    pa: number;
    hr: number;
    rbi: number;
    sb: number;
    hrPct?: number;
    bbPct?: number;
    kPct?: number;
    defRuns?: number;
    posAdj?: number;
    defSource?: 'drs' | 'scouting' | 'blended';
  };
  /** Estimated ratings from projected stats */
  estimatedRatings: {
    power: number;
    eye: number;
    avoidK: number;
    contact: number;
  };
  /** Scouting ratings if available */
  scoutingRatings?: {
    power: number;
    eye: number;
    avoidK: number;
    contact: number;
  };
  /** Flag indicating this is a prospect-like asset in canonical modal path */
  isProspect?: boolean;
}

export interface BatterProjectionContext {
  projections: ProjectedBatter[];
  statsYear: number;
  usedFallbackStats: boolean;
  scoutingMetadata?: {
    fromMyScout: number;
    fromOSA: number;
  };
}

export interface BatterProjectionCalculationTrace {
  input?: {
    playerId: number;
    playerName: string;
    age: number;
    currentTrueRating: number;
    percentile: number;
    currentRatings: {
      power: number;
      eye: number;
      avoidK: number;
      contact: number;
    };
    hasScouting: boolean;
    scoutingSource?: 'my' | 'osa';
    scoutingInjuryProneness?: string;
    historicalPaData: Array<{ year: number; pa: number }>;
  };
  projectedRatings?: {
    power: number;
    eye: number;
    avoidK: number;
    contact: number;
  };
  projectedRates?: {
    bbPct: number;
    kPct: number;
    avg: number;
    hrPct: number;
  };
  wobaComponents?: {
    bbRate: number;
    singleRate: number;
    doubleRate: number;
    tripleRate: number;
    hrRate: number;
    woba: number;
    iso: number;
    obp: number;
    slg: number;
    ops: number;
  };
  playingTime?: {
    projectedPa: number;
    injuryProneness?: string;
    historicalPaData: Array<{ year: number; pa: number }>;
  };
  stolenBaseProjection?: {
    method: 'scouting' | 'blended' | 'fallback';
    sr?: number;
    ste?: number;
    sb: number;
    cs: number;
    sbRuns: number;
    historyWeight?: number;
    yearsUsed?: number;
  };
  runValueOutput?: {
    hasLeagueAverages: boolean;
    wrcPlus: number;
    war: number;
  };
  output?: {
    projectedStats: ProjectedBatter['projectedStats'];
    estimatedRatings: ProjectedBatter['estimatedRatings'];
  };
}

interface BatterProjectionPlayerInfo {
  age: number;
  teamId: number;
  teamName: string;
  position: number;
  level?: number;
  parentTeamId?: number;
  name: string;
  scouting?: HitterScoutingRatings;
  fromMyScout: boolean;
  /** Precomputed defensive value from defensive_lookup cache */
  defRuns?: number;
  posAdj?: number;
  /** Effective park factors (half home / half away) */
  parkFactors?: { avg: number; hr: number; d: number; t: number };
}

const POSITION_LABELS: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

class BatterProjectionService {
  async getProjectionsWithContext(
    year: number,
    options?: { tracePlayerId?: number; trace?: BatterProjectionCalculationTrace; preSeasonOnly?: boolean; projectionTargetYear?: number }
  ): Promise<BatterProjectionContext> {
    // Fast-path: return precomputed projections from CLI sync (only for current/latest year)
    if (supabaseDataService.isConfigured && !supabaseDataService.hasCustomScouting) {
      const cachedYear = await dateService.getCurrentYear();
      if (year === cachedYear) {
        const cached = await supabaseDataService.getPrecomputed('batter_projections');
        if (cached) return cached as BatterProjectionContext;
      }
    }

    const preSeasonOnly = options?.preSeasonOnly ?? false;
    const leagueAvgYear = preSeasonOnly ? year - 1 : year;
    // Get all required data
    const [allPlayers, allTeams, scoutingList, leagueAvgCurrent, currentYear] = await Promise.all([
      playerService.getAllPlayers(),
      teamService.getAllTeams(),
      hitterScoutingDataService.getLatestScoutingRatings('osa'),
      leagueBattingAveragesService.getLeagueAverages(leagueAvgYear),
      dateService.getCurrentYear(),
    ]);

    // Fall back to prior year's league averages if current year not available yet
    const leagueAvg = leagueAvgCurrent ?? await leagueBattingAveragesService.getLeagueAverages(year - 1);

    // Also try to get "my" scouting ratings
    const myScoutingList = await hitterScoutingDataService.getLatestScoutingRatings('my');

    // Build scouting map (prefer "my" over "osa")
    const scoutingMap = new Map<number, { rating: typeof scoutingList[0], fromMyScout: boolean }>();
    for (const rating of scoutingList) {
      scoutingMap.set(rating.playerId, { rating, fromMyScout: false });
    }
    for (const rating of myScoutingList) {
      scoutingMap.set(rating.playerId, { rating, fromMyScout: true });
    }

    // Get multi-year batting stats for True Ratings calculation
    // The view passes statsBaseYear (targetYear - 1), so `year` already represents
    // the most recent completed season — no further subtraction needed.
    const multiYearStats = await trueRatingsService.getMultiYearBattingStats(year);

    // Get batting stats to build stats-driven player pool
    // Pre-season mode uses prior year only; current mode tries current year first
    const battingStatsYear = preSeasonOnly ? year - 1 : year;
    let battingStats: TruePlayerBattingStats[] = [];
    try {
      battingStats = await trueRatingsService.getTrueBattingStats(battingStatsYear);
    } catch {
      // Fall back to prior year if current year stats unavailable
      if (!preSeasonOnly) {
        try {
          battingStats = await trueRatingsService.getTrueBattingStats(year - 1);
        } catch {
          battingStats = [];
        }
      }
    }

    // Build lookup maps
    const teamMap = new Map<number, Team>(allTeams.map(t => [t.id, t]));
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));
    const battingStatsMap = new Map<number, TruePlayerBattingStats>();
    for (const stat of battingStats) {
      battingStatsMap.set(stat.player_id, stat);
    }

    // Use canonical TR — same source of truth as the modal.
    // This eliminates divergence between the projection table and the modal.
    const canonicalTR = await trueRatingsService.getHitterTrueRatings(currentYear);

    // Load defensive lookup and park factors for browser-side projections
    let defensiveLookup: Record<number, [number, number, string]> | null = null;
    let parkFactorsData: Record<number, any> | null = null;
    if (supabaseDataService.isConfigured) {
      [defensiveLookup, parkFactorsData] = await Promise.all([
        supabaseDataService.getPrecomputed('defensive_lookup'),
        supabaseDataService.getPrecomputed('park_factors'),
      ]);
    }

    // Build player info map for projection context
    const playerInfoMap = new Map<number, BatterProjectionPlayerInfo>();
    let fromMyScout = 0;
    let fromOSA = 0;

    for (const player of allPlayers) {
      if (player.retired) continue;
      const position = player.position || 0;
      if (position === 1) continue; // Skip pitchers
      if (!canonicalTR.has(player.id)) continue;

      const stat = battingStatsMap.get(player.id);
      const scoutingInfo = scoutingMap.get(player.id);

      // Use current roster only — don't fall back to stat team_id,
      // which would assign free agents to their old team from prior year stats.
      const teamId = player.teamId ?? 0;
      const team = teamMap.get(teamId);
      const teamName = team?.nickname || 'Free Agent';
      const playerName = stat?.playerName
        ?? `${player.firstName} ${player.lastName}`;
      const birthYear = currentYear - player.age;
      const ageInYear = year - birthYear;

      if (scoutingInfo) {
        if (scoutingInfo.fromMyScout) fromMyScout++;
        else fromOSA++;
      }

      const defEntry = defensiveLookup?.[player.id];
      playerInfoMap.set(player.id, {
        age: ageInYear,
        teamId,
        teamName,
        position,
        level: player.level,
        parentTeamId: player.parentTeamId,
        name: playerName,
        scouting: scoutingInfo?.rating,
        fromMyScout: scoutingInfo?.fromMyScout ?? false,
        defRuns: defEntry?.[0],
        posAdj: defEntry?.[1],
        parkFactors: parkFactorsData?.[teamId] && player.bats
          ? computeEffectiveParkFactors(parkFactorsData[teamId], player.bats)
          : undefined,
      });
    }

    // Build projections from canonical True Rating results
    const projections: ProjectedBatter[] = [];

    for (const [playerId, trResult] of canonicalTR) {
      const info = playerInfoMap.get(playerId);
      if (!info) continue;

      const trace = options?.trace && options.tracePlayerId === trResult.playerId
        ? options.trace
        : undefined;
      projections.push(
        this.calculateProjectionFromTrueRating(
          trResult,
          info,
          leagueAvg,
          multiYearStats.get(trResult.playerId) || [],
          trace,
          options?.projectionTargetYear ?? year + 1
        )
      );
    }

    // Add draftee/HSC batter peak projections (scouting-only, no canonical TR)
    const existingPlayerIds = new Set(projections.map(p => p.playerId));
    for (const player of allPlayers) {
      if (player.retired) continue;
      if (existingPlayerIds.has(player.id)) continue;
      if (!player.draftEligible && !player.hsc) continue;
      const pos = player.position || 0;
      if (pos === 1) continue; // Skip pitchers

      const scoutingInfo = scoutingMap.get(player.id);
      if (!scoutingInfo) continue;
      const scouting = scoutingInfo.rating;

      const teamId = player.teamId ?? 0;
      const team = teamMap.get(teamId);
      const teamName = team?.nickname || 'Free Agent';
      const playerName = `${player.firstName} ${player.lastName}`;
      const birthYear = currentYear - player.age;
      const ageInYear = year - birthYear;

      if (scoutingInfo.fromMyScout) fromMyScout++;
      else fromOSA++;

      // Derive blended rates from scouting ratings
      const power = scouting.power ?? 50;
      const eye = scouting.eye ?? 50;
      const avoidK = scouting.avoidK ?? 50;
      const contact = scouting.contact ?? 50;
      const gap = scouting.gap ?? 50;
      const speed = scouting.speed ?? 50;

      const blendedBbPct = HitterRatingEstimatorService.expectedBbPct(eye);
      const blendedKPct = HitterRatingEstimatorService.expectedKPct(avoidK);
      const blendedHrPct = HitterRatingEstimatorService.expectedHrPct(power);
      const blendedAvg = HitterRatingEstimatorService.expectedAvg(contact);
      const blendedDoublesRate = HitterRatingEstimatorService.expectedDoublesRate(gap);
      const blendedTriplesRate = HitterRatingEstimatorService.expectedTriplesRate(speed);

      // Derive OBP/SLG from blended rates
      const tfrObp = Math.min(0.450, blendedAvg + (blendedBbPct / 100) * (1 - blendedAvg));
      const hrPerAb = (blendedHrPct / 100) / 0.88;
      const iso = blendedDoublesRate + 2 * blendedTriplesRate + 3 * hrPerAb;
      const tfrSlg = blendedAvg + iso;

      // Build BatterProfileData for peak mode
      const data: any = {
        playerId: player.id,
        playerName,
        age: ageInYear,
        position: pos,
        isProspect: true,
        hasTfrUpside: true,
        estimatedPower: power,
        estimatedEye: eye,
        estimatedAvoidK: avoidK,
        estimatedContact: contact,
        estimatedGap: gap,
        estimatedSpeed: speed,
        tfrPower: power,
        tfrEye: eye,
        tfrAvoidK: avoidK,
        tfrContact: contact,
        tfrGap: gap,
        tfrSpeed: speed,
        tfrBbPct: blendedBbPct,
        tfrKPct: blendedKPct,
        tfrHrPct: blendedHrPct,
        tfrAvg: blendedAvg,
        tfrObp,
        tfrSlg,
        projBbPct: blendedBbPct,
        projKPct: blendedKPct,
        projHrPct: blendedHrPct,
        projAvg: blendedAvg,
        projDoublesRate: blendedDoublesRate,
        projTriplesRate: blendedTriplesRate,
        scoutGap: gap,
        scoutSpeed: speed,
        injuryProneness: scouting.injuryProneness,
      };

      const defEntry = defensiveLookup?.[player.id];
      const drafteeDefRuns = defEntry?.[0] ?? 0;
      const drafteeDefPosAdj = defEntry?.[1] ?? 0;

      const modalResult = computeBatterProjection(data, [], {
        projectionMode: 'current',
        projectionYear: year + 1,
        leagueAvg: leagueAvg as any,
        scoutingData: {
          injuryProneness: scouting.injuryProneness,
          stealingAggressiveness: scouting.stealingAggressiveness,
          stealingAbility: scouting.stealingAbility,
        },
        defRuns: drafteeDefRuns,
        posAdj: drafteeDefPosAdj,
        expectedBbPct: (e: number) => HitterRatingEstimatorService.expectedBbPct(e),
        expectedKPct: (ak: number) => HitterRatingEstimatorService.expectedKPct(ak),
        expectedAvg: (c: number) => HitterRatingEstimatorService.expectedAvg(c),
        expectedHrPct: (p: number) => HitterRatingEstimatorService.expectedHrPct(p),
        expectedDoublesRate: (g: number) => HitterRatingEstimatorService.expectedDoublesRate(g),
        expectedTriplesRate: (s: number) => HitterRatingEstimatorService.expectedTriplesRate(s),
        getProjectedPa: (injury, a) => leagueBattingAveragesService.getProjectedPa(injury, a),
        getProjectedPaWithHistory: (history, a, injury) =>
          leagueBattingAveragesService.getProjectedPaWithHistory(history, a, injury),
        calculateOpsPlus: (obp, slg, lg) => leagueBattingAveragesService.calculateOpsPlus(obp, slg, lg),
        computeWoba: (bbRate, avg, d, t, hr) => {
          const single = avg * (1 - bbRate) - hr - d - t;
          return 0.69 * bbRate + 0.89 * Math.max(0, single) + 1.27 * d + 1.62 * t + 2.10 * hr;
        },
        calculateBaserunningRuns: (sb, cs) => leagueBattingAveragesService.calculateBaserunningRuns(sb, cs),
        calculateBattingWar: (woba, pa, lg, sbRuns, defR, posA) =>
          leagueBattingAveragesService.calculateBattingWar(woba, pa, lg, sbRuns, defR, posA),
        projectStolenBases: (sr, ste, pa) => HitterRatingEstimatorService.projectStolenBases(sr, ste, pa),
        applyAgingToRates: (rates, a) => HitterRatingEstimatorService.applyAgingToBlendedRates(rates, hitterAgingService.getAgingModifiers(a)),
      });

      projections.push({
        playerId: player.id,
        name: playerName,
        teamId,
        teamName,
        position: pos,
        positionLabel: POSITION_LABELS[pos] || 'UT',
        level: player.level,
        parentTeamId: player.parentTeamId,
        age: ageInYear,
        currentTrueRating: scouting.pot ?? 0,
        percentile: 0,
        projectedStats: {
          woba: Math.round(modalResult.projWoba * 1000) / 1000,
          avg: Math.round(modalResult.projAvg * 1000) / 1000,
          obp: Math.round(modalResult.projObp * 1000) / 1000,
          slg: Math.round(modalResult.projSlg * 1000) / 1000,
          ops: Math.round(modalResult.projOps * 1000) / 1000,
          wrcPlus: modalResult.projOpsPlus,
          war: Math.round(modalResult.projWar * 10) / 10,
          pa: modalResult.projPa,
          hr: modalResult.projHr,
          rbi: Math.round(modalResult.projHr * 3.5 + modalResult.projPa * 0.08),
          sb: modalResult.projSb,
          hrPct: Math.round(modalResult.projHrPct * 10) / 10,
          bbPct: Math.round(modalResult.projBbPct * 10) / 10,
          kPct: Math.round(modalResult.projKPct * 10) / 10,
          defRuns: drafteeDefRuns,
          posAdj: drafteeDefPosAdj,
        },
        estimatedRatings: {
          power: Math.round(power),
          eye: Math.round(eye),
          avoidK: Math.round(avoidK),
          contact: Math.round(contact),
        },
        scoutingRatings: {
          power: scouting.power,
          eye: scouting.eye,
          avoidK: scouting.avoidK,
          contact: scouting.contact ?? 50,
        },
      });
    }

    // Draftee diagnostic
    const drafteeProjections = projections.filter(p => {
      const player = playerMap.get(p.playerId);
      return player?.draftEligible || player?.hsc;
    });
    if (drafteeProjections.length > 0) {
      console.log(`[BatterProjectionService] 🎓 ${drafteeProjections.length} draftee batter projections`);
      const topDraftees = [...drafteeProjections].sort((a, b) => b.projectedStats.war - a.projectedStats.war).slice(0, 5);
      console.table(topDraftees.map(p => ({
        name: p.name, war: p.projectedStats.war.toFixed(1), woba: p.projectedStats.woba.toFixed(3),
        avg: p.projectedStats.avg.toFixed(3), obp: p.projectedStats.obp.toFixed(3), slg: p.projectedStats.slg.toFixed(3),
        pa: p.projectedStats.pa, hr: p.projectedStats.hr,
        pwr: p.estimatedRatings.power, eye: p.estimatedRatings.eye,
      })));
    }

    // Sort by WAR descending
    projections.sort((a, b) => b.projectedStats.war - a.projectedStats.war);

    return {
      projections,
      statsYear: year,
      usedFallbackStats: false,
      scoutingMetadata: { fromMyScout, fromOSA },
    };
  }

  async getProjections(year: number): Promise<ProjectedBatter[]> {
    const context = await this.getProjectionsWithContext(year);
    return context.projections;
  }

  async getProjectionWithTrace(
    year: number,
    playerId: number
  ): Promise<{ projection: ProjectedBatter; trace: BatterProjectionCalculationTrace; statsYear: number; usedFallbackStats: boolean; projectionPoolSize: number } | null> {
    const trace: BatterProjectionCalculationTrace = {};
    const context = await this.getProjectionsWithContext(year, { tracePlayerId: playerId, trace });
    const projection = context.projections.find((p) => p.playerId === playerId);
    if (!projection) return null;
    return {
      projection,
      trace,
      statsYear: context.statsYear,
      usedFallbackStats: context.usedFallbackStats,
      projectionPoolSize: context.projections.length,
    };
  }

  calculateProjectionFromTrueRating(
    trResult: HitterTrueRatingResult,
    info: BatterProjectionPlayerInfo,
    leagueAvg: LeagueBattingAverages | null,
    historicalStats: YearlyHittingStats[] = [],
    trace?: BatterProjectionCalculationTrace,
    projectionYear?: number,
  ): ProjectedBatter {
    const { age, teamId, teamName, position, level, parentTeamId, name, scouting, fromMyScout } = info;

    // Build a BatterProfileData-like object and use resolveCanonicalBatterData +
    // computeBatterProjection — the SAME functions the modal uses. This guarantees
    // the table and modal produce identical numbers.
    const data: any = {
      playerId: trResult.playerId,
      playerName: name,
      age,
      position,
      estimatedPower: trResult.estimatedPower,
      estimatedEye: trResult.estimatedEye,
      estimatedAvoidK: trResult.estimatedAvoidK,
      estimatedContact: trResult.estimatedContact,
      estimatedGap: trResult.estimatedGap,
      estimatedSpeed: trResult.estimatedSpeed,
      scoutGap: scouting?.gap,
      scoutSpeed: scouting?.speed,
      injuryProneness: scouting?.injuryProneness,
    };
    resolveCanonicalBatterData(data, trResult, undefined);

    // Build MLB stats history for PA projection + SB blending
    const mlbStats = historicalStats.map(s => {
      const singles = s.h - s.d - s.t - s.hr;
      const slg = s.ab > 0 ? (singles + 2 * s.d + 3 * s.t + 4 * s.hr) / s.ab : 0;
      return {
        year: s.year, level: 'MLB', pa: s.pa,
        avg: s.ab > 0 ? s.h / s.ab : 0,
        obp: s.pa > 0 ? (s.h + s.bb) / s.pa : 0,
        slg: Math.round(slg * 1000) / 1000,
        hr: s.hr, d: s.d, t: s.t, rbi: 0,
        sb: s.sb ?? 0, cs: s.cs ?? 0,
        bb: s.bb, k: s.k,
      };
    });

    // Defensive value from precomputed lookup (or 0 if not available)
    const defRuns = info.defRuns ?? 0;
    const posAdj = info.posAdj ?? 0;

    const modalResult = computeBatterProjection(data, mlbStats, {
      projectionMode: 'current',
      projectionYear: projectionYear ?? 0,
      leagueAvg: leagueAvg as any,
      scoutingData: scouting ? {
        injuryProneness: scouting.injuryProneness,
        stealingAggressiveness: scouting.stealingAggressiveness,
        stealingAbility: scouting.stealingAbility,
      } : null,
      defRuns,
      posAdj,
      parkFactors: info.parkFactors,
      expectedBbPct: (eye: number) => HitterRatingEstimatorService.expectedBbPct(eye),
      expectedKPct: (avoidK: number) => HitterRatingEstimatorService.expectedKPct(avoidK),
      expectedAvg: (contact: number) => HitterRatingEstimatorService.expectedAvg(contact),
      expectedHrPct: (power: number) => HitterRatingEstimatorService.expectedHrPct(power),
      expectedDoublesRate: (gap: number) => HitterRatingEstimatorService.expectedDoublesRate(gap),
      expectedTriplesRate: (speed: number) => HitterRatingEstimatorService.expectedTriplesRate(speed),
      getProjectedPa: (injury, a) => leagueBattingAveragesService.getProjectedPa(injury, a),
      getProjectedPaWithHistory: (history, a, injury) =>
        leagueBattingAveragesService.getProjectedPaWithHistory(history, a, injury),
      calculateOpsPlus: (obp, slg, lg) => leagueBattingAveragesService.calculateOpsPlus(obp, slg, lg),
      computeWoba: (bbRate, avg, d, t, hr) => {
        const single = avg * (1 - bbRate) - hr - d - t;
        return 0.69 * bbRate + 0.89 * Math.max(0, single) + 1.27 * d + 1.62 * t + 2.10 * hr;
      },
      calculateBaserunningRuns: (sb, cs) => leagueBattingAveragesService.calculateBaserunningRuns(sb, cs),
      calculateBattingWar: (woba, pa, lg, sbRuns, defR, posA) =>
        leagueBattingAveragesService.calculateBattingWar(woba, pa, lg, sbRuns, defR, posA),
      projectStolenBases: (sr, ste, pa) => HitterRatingEstimatorService.projectStolenBases(sr, ste, pa),
      applyAgingToRates: (rates, a) => HitterRatingEstimatorService.applyAgingToBlendedRates(rates, hitterAgingService.getAgingModifiers(a)),
    });

    const projectedRatings = hitterAgingService.applyAging({
      power: trResult.estimatedPower,
      eye: trResult.estimatedEye,
      avoidK: trResult.estimatedAvoidK,
      contact: trResult.estimatedContact,
    }, age);

    const projection: ProjectedBatter = {
      playerId: trResult.playerId,
      name,
      teamId,
      teamName,
      position,
      positionLabel: POSITION_LABELS[position] || 'UT',
      level,
      parentTeamId,
      age,
      currentTrueRating: trResult.trueRating,
      percentile: trResult.percentile,
      projectedStats: {
        woba: Math.round(modalResult.projWoba * 1000) / 1000,
        avg: Math.round(modalResult.projAvg * 1000) / 1000,
        obp: Math.round(modalResult.projObp * 1000) / 1000,
        slg: Math.round(modalResult.projSlg * 1000) / 1000,
        ops: Math.round(modalResult.projOps * 1000) / 1000,
        wrcPlus: modalResult.projOpsPlus,
        war: Math.round(modalResult.projWar * 10) / 10,
        pa: modalResult.projPa,
        hr: modalResult.projHr,
        rbi: Math.round(modalResult.projHr * 3.5 + modalResult.projPa * 0.08),
        sb: modalResult.projSb,
        hrPct: Math.round(modalResult.projHrPct * 10) / 10,
        bbPct: Math.round(modalResult.projBbPct * 10) / 10,
        kPct: Math.round(modalResult.projKPct * 10) / 10,
        defRuns: modalResult.projDefRuns,
        posAdj: modalResult.projPosAdj,
      },
      estimatedRatings: {
        power: Math.round(projectedRatings.power),
        eye: Math.round(projectedRatings.eye),
        avoidK: Math.round(projectedRatings.avoidK),
        contact: Math.round(projectedRatings.contact),
      },
      scoutingRatings: scouting ? {
        power: scouting.power,
        eye: scouting.eye,
        avoidK: scouting.avoidK,
        contact: scouting.contact ?? 50,
      } : undefined,
    };

    return projection;
  }
}

export const batterProjectionService = new BatterProjectionService();
