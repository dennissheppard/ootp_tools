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
import { Player } from '../models/Player';
import { Team } from '../models/Team';
import { trueRatingsService } from './TrueRatingsService';
import { hitterScoutingDataService } from './HitterScoutingDataService';
import { hitterTrueRatingsCalculationService, HitterTrueRatingInput } from './HitterTrueRatingsCalculationService';
import { leagueBattingAveragesService } from './LeagueBattingAveragesService';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';

export interface ProjectedBatter {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
  position: number;
  positionLabel: string;
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
    bbPct?: number;
    kPct?: number;
  };
  /** Estimated ratings from projected stats */
  estimatedRatings: {
    power: number;
    eye: number;
    avoidK: number;
    babip: number;
  };
  /** Scouting ratings if available */
  scoutingRatings?: {
    power: number;
    eye: number;
    avoidK: number;
    babip: number;
  };
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

const POSITION_LABELS: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

class BatterProjectionService {
  async getProjectionsWithContext(year: number): Promise<BatterProjectionContext> {
    // Get all required data
    const [allPlayers, allTeams, scoutingList, leagueAvg] = await Promise.all([
      playerService.getAllPlayers(),
      teamService.getAllTeams(),
      hitterScoutingDataService.getLatestScoutingRatings('osa'),
      leagueBattingAveragesService.getLeagueAverages(year),
    ]);

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
    const multiYearStats = await trueRatingsService.getMultiYearBattingStats(year);

    // Build team lookup
    const teamMap = new Map<number, Team>(allTeams.map(t => [t.id, t]));

    // Filter to MLB batters (not pitchers on MLB rosters)
    const mlbBatters = allPlayers.filter((p: Player) => {
      const team = teamMap.get(p.teamId);
      if (!team || team.parentTeamId !== 0) return false; // Must be on MLB roster
      if (p.position === 1) return false; // Skip pitchers
      return true;
    });

    // Build True Rating inputs for all batters with stats
    const trInputs: HitterTrueRatingInput[] = [];
    const playerInfoMap = new Map<number, { player: Player, teamName: string, scouting?: typeof scoutingList[0], fromMyScout: boolean }>();
    let fromMyScout = 0;
    let fromOSA = 0;

    for (const player of mlbBatters) {
      const playerId = player.id;
      const stats = multiYearStats.get(playerId);

      // Need at least some stats to project
      if (!stats || stats.length === 0) continue;

      const team = teamMap.get(player.teamId);
      const teamName = team?.nickname || 'Unknown';

      // Get scouting data if available
      const scoutingInfo = scoutingMap.get(playerId);
      if (scoutingInfo) {
        if (scoutingInfo.fromMyScout) fromMyScout++;
        else fromOSA++;
      }

      trInputs.push({
        playerId,
        playerName: `${player.firstName} ${player.lastName}`,
        yearlyStats: stats,
        scoutingRatings: scoutingInfo?.rating,
      });

      playerInfoMap.set(playerId, {
        player,
        teamName,
        scouting: scoutingInfo?.rating,
        fromMyScout: scoutingInfo?.fromMyScout ?? false,
      });
    }

    // Calculate True Ratings for all batters at once
    const trResults = hitterTrueRatingsCalculationService.calculateTrueRatings(trInputs);

    // Build projections from True Rating results
    const projections: ProjectedBatter[] = [];

    for (const trResult of trResults) {
      const info = playerInfoMap.get(trResult.playerId);
      if (!info) continue;

      const { player, teamName, scouting } = info;

      // Use projected stats from True Ratings calculation
      const projWoba = trResult.woba;
      const projAvg = trResult.blendedAvg;
      const projBbPct = trResult.blendedBbPct;
      const projKPct = trResult.blendedKPct;

      // Calculate OBP and SLG from components
      const projObp = Math.min(0.450, projAvg + (projBbPct / 100));
      const projIso = HitterRatingEstimatorService.expectedIso(trResult.estimatedPower);
      const projSlg = projAvg + projIso;
      const projOps = projObp + projSlg;

      // Calculate wRC+ and WAR using league averages
      let wrcPlus = 100;
      let projWar = 0;
      const projPa = leagueBattingAveragesService.getProjectedPa(scouting?.injuryProneness, player.age);

      if (leagueAvg) {
        wrcPlus = leagueBattingAveragesService.calculateWrcPlus(projWoba, leagueAvg);
        projWar = leagueBattingAveragesService.calculateBattingWar(projWoba, projPa, leagueAvg);
      }

      // Estimate counting stats from rate stats
      const abPerPa = 0.88;
      const projAb = Math.round(projPa * abPerPa);
      const projHr = Math.round(projAb * projIso * 0.4); // Rough HR estimate
      const projRbi = Math.round(projHr * 3.5 + projPa * 0.08); // Rough RBI estimate
      const projSb = Math.round(projPa * 0.02); // Conservative SB estimate

      projections.push({
        playerId: trResult.playerId,
        name: `${player.firstName} ${player.lastName}`,
        teamId: player.teamId,
        teamName,
        position: player.position,
        positionLabel: POSITION_LABELS[player.position] || 'UT',
        age: player.age,
        currentTrueRating: trResult.trueRating,
        percentile: trResult.percentile,
        projectedStats: {
          woba: Math.round(projWoba * 1000) / 1000,
          avg: Math.round(projAvg * 1000) / 1000,
          obp: Math.round(projObp * 1000) / 1000,
          slg: Math.round(projSlg * 1000) / 1000,
          ops: Math.round(projOps * 1000) / 1000,
          wrcPlus,
          war: Math.round(projWar * 10) / 10,
          pa: projPa,
          hr: projHr,
          rbi: projRbi,
          sb: projSb,
          bbPct: Math.round(projBbPct * 10) / 10,
          kPct: Math.round(projKPct * 10) / 10,
        },
        estimatedRatings: {
          power: trResult.estimatedPower,
          eye: trResult.estimatedEye,
          avoidK: trResult.estimatedAvoidK,
          babip: trResult.estimatedBabip,
        },
        scoutingRatings: scouting ? {
          power: scouting.power,
          eye: scouting.eye,
          avoidK: scouting.avoidK,
          babip: scouting.babip ?? 50,
        } : undefined,
      });
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
}

export const batterProjectionService = new BatterProjectionService();
