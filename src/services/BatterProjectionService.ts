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
  hitterTrueRatingsCalculationService,
  HitterTrueRatingInput,
  HitterTrueRatingResult,
  YearlyHittingStats,
} from './HitterTrueRatingsCalculationService';
import { leagueBattingAveragesService, LeagueBattingAverages } from './LeagueBattingAveragesService';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';
import { hitterAgingService } from './HitterAgingService';
import { dateService } from './DateService';
import { HitterScoutingRatings } from '../models/ScoutingData';

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
    hrPct?: number;
    bbPct?: number;
    kPct?: number;
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
    method: 'scouting' | 'fallback';
    sr?: number;
    ste?: number;
    sb: number;
    cs: number;
    sbRuns: number;
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
  name: string;
  scouting?: HitterScoutingRatings;
  fromMyScout: boolean;
}

const POSITION_LABELS: Record<number, string> = {
  1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH',
};

class BatterProjectionService {
  async getProjectionsWithContext(
    year: number,
    options?: { tracePlayerId?: number; trace?: BatterProjectionCalculationTrace }
  ): Promise<BatterProjectionContext> {
    // Get all required data
    const [allPlayers, allTeams, scoutingList, leagueAvgCurrent, currentYear] = await Promise.all([
      playerService.getAllPlayers(),
      teamService.getAllTeams(),
      hitterScoutingDataService.getLatestScoutingRatings('osa'),
      leagueBattingAveragesService.getLeagueAverages(year),
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
    // Use prior season to avoid contamination from partial current season data
    const multiYearStats = await trueRatingsService.getMultiYearBattingStats(year - 1);

    // Get current-year batting stats to build stats-driven player pool
    // This ensures we capture all players who batted, not just current roster
    let battingStats: TruePlayerBattingStats[] = [];
    try {
      battingStats = await trueRatingsService.getTrueBattingStats(year);
    } catch {
      // Fall back to prior year if current year stats unavailable
      try {
        battingStats = await trueRatingsService.getTrueBattingStats(year - 1);
      } catch {
        battingStats = [];
      }
    }

    // Build lookup maps
    const teamMap = new Map<number, Team>(allTeams.map(t => [t.id, t]));
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));
    const battingStatsMap = new Map<number, TruePlayerBattingStats>();
    for (const stat of battingStats) {
      battingStatsMap.set(stat.player_id, stat);
    }

    // Build stats-driven player pool (like pitcher ProjectionService)
    // Include anyone who has batting stats OR multi-year history
    const playerIds = new Set<number>();
    multiYearStats.forEach((_stats, playerId) => playerIds.add(playerId));
    battingStats.forEach(stat => playerIds.add(stat.player_id));

    // Build True Rating inputs for all batters with stats
    const trInputs: HitterTrueRatingInput[] = [];
    const playerInfoMap = new Map<number, BatterProjectionPlayerInfo>();
    let fromMyScout = 0;
    let fromOSA = 0;

    for (const playerId of playerIds) {
      const player = playerMap.get(playerId);
      const stat = battingStatsMap.get(playerId);
      const stats = multiYearStats.get(playerId);

      // Skip if no player record (can't determine age for aging curves)
      if (!player) continue;

      // Determine position: prefer player record, fall back to stats
      const position = player.position || stat?.position || 0;
      if (position === 1) continue; // Skip pitchers

      // Need at least some stats or scouting to project
      const scoutingInfo = scoutingMap.get(playerId);
      if ((!stats || stats.length === 0) && !scoutingInfo) continue;

      // Use stats-year team_id (where they played), not current roster team
      const teamId = stat?.team_id || player.teamId || 0;
      const team = teamMap.get(teamId);
      const teamName = team?.nickname || 'Unknown';

      // Get player name
      const playerName = stat?.playerName
        ?? (player ? `${player.firstName} ${player.lastName}` : 'Unknown Player');

      // Calculate age in the stats year
      const birthYear = currentYear - player.age;
      const ageInYear = year - birthYear;

      if (scoutingInfo) {
        if (scoutingInfo.fromMyScout) fromMyScout++;
        else fromOSA++;
      }

      trInputs.push({
        playerId,
        playerName,
        yearlyStats: stats ?? [],
        scoutingRatings: scoutingInfo?.rating,
      });

      playerInfoMap.set(playerId, {
        age: ageInYear,
        teamId,
        teamName,
        position,
        name: playerName,
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

      const trace = options?.trace && options.tracePlayerId === trResult.playerId
        ? options.trace
        : undefined;
      projections.push(
        this.calculateProjectionFromTrueRating(
          trResult,
          info,
          leagueAvg,
          multiYearStats.get(trResult.playerId) || [],
          trace
        )
      );
    }

    // Sort by WAR descending
    projections.sort((a, b) => b.projectedStats.war - a.projectedStats.war);

    // Overlay canonical True Ratings for display consistency
    // Use currentYear (not `year` which is statsBaseYear = currentYear - 1)
    const canonicalBatterTR = await trueRatingsService.getHitterTrueRatings(currentYear);
    for (const p of projections) {
      const canonical = canonicalBatterTR.get(p.playerId);
      if (canonical) {
        p.currentTrueRating = canonical.trueRating;
        p.percentile = canonical.percentile;
      }
    }

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
    trace?: BatterProjectionCalculationTrace
  ): ProjectedBatter {
    const { age, teamId, teamName, position, name, scouting, fromMyScout } = info;

    const currentRatings = {
      power: trResult.estimatedPower,
      eye: trResult.estimatedEye,
      avoidK: trResult.estimatedAvoidK,
      contact: trResult.estimatedContact,
    };

    const historicalPaData = historicalStats.map((s) => ({ year: s.year, pa: s.pa }));
    if (trace) {
      trace.input = {
        playerId: trResult.playerId,
        playerName: name,
        age,
        currentTrueRating: trResult.trueRating,
        percentile: trResult.percentile,
        currentRatings: { ...currentRatings },
        hasScouting: Boolean(scouting),
        scoutingSource: scouting ? (fromMyScout ? 'my' : 'osa') : undefined,
        scoutingInjuryProneness: scouting?.injuryProneness,
        historicalPaData: [...historicalPaData],
      };
    }

    const projectedRatings = hitterAgingService.applyAging(currentRatings, age);
    if (trace) {
      trace.projectedRatings = { ...projectedRatings };
    }

    const projBbPct = HitterRatingEstimatorService.expectedBbPct(projectedRatings.eye);
    const projKPct = HitterRatingEstimatorService.expectedKPct(projectedRatings.avoidK);
    const projAvg = HitterRatingEstimatorService.expectedAvg(projectedRatings.contact);
    const projHrPct = HitterRatingEstimatorService.expectedHrPct(projectedRatings.power);
    if (trace) {
      trace.projectedRates = {
        bbPct: projBbPct,
        kPct: projKPct,
        avg: projAvg,
        hrPct: projHrPct,
      };
    }

    const bbRate = projBbPct / 100;
    const hitRate = projAvg * (1 - bbRate);
    const hrRate = projHrPct / 100;
    const nonHrHitRate = Math.max(0, hitRate - hrRate);
    const tripleRate = nonHrHitRate * 0.08;
    const doubleRate = nonHrHitRate * 0.27;
    const singleRate = nonHrHitRate * 0.65;

    const projWoba = Math.max(0.200, Math.min(0.500,
      0.69 * bbRate +
      0.89 * singleRate +
      1.27 * doubleRate +
      1.62 * tripleRate +
      2.10 * hrRate
    ));
    const projIso = hrRate * 3 + doubleRate + (tripleRate * 2);
    const projObp = Math.min(0.450, projAvg + (projBbPct / 100));
    const projSlg = projAvg + projIso;
    const projOps = projObp + projSlg;
    if (trace) {
      trace.wobaComponents = {
        bbRate,
        singleRate,
        doubleRate,
        tripleRate,
        hrRate,
        woba: projWoba,
        iso: projIso,
        obp: projObp,
        slg: projSlg,
        ops: projOps,
      };
    }

    const projPa = leagueBattingAveragesService.getProjectedPaWithHistory(
      historicalPaData,
      age,
      scouting?.injuryProneness
    );
    if (trace) {
      trace.playingTime = {
        projectedPa: projPa,
        injuryProneness: scouting?.injuryProneness,
        historicalPaData: [...historicalPaData],
      };
    }

    const projHr = Math.round(projPa * (projHrPct / 100));
    const projRbi = Math.round(projHr * 3.5 + projPa * 0.08);

    const sr = scouting?.stealingAggressiveness;
    const ste = scouting?.stealingAbility;
    let projSb: number;
    let projCs: number;
    let sbMethod: 'scouting' | 'fallback';
    if (sr !== undefined && ste !== undefined) {
      const sbProj = HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa);
      projSb = sbProj.sb;
      projCs = sbProj.cs;
      sbMethod = 'scouting';
    } else {
      projSb = Math.round(projPa * 0.02);
      projCs = Math.round(projPa * 0.005);
      sbMethod = 'fallback';
    }

    const sbRuns = leagueBattingAveragesService.calculateBaserunningRuns(projSb, projCs);
    if (trace) {
      trace.stolenBaseProjection = {
        method: sbMethod,
        sr,
        ste,
        sb: projSb,
        cs: projCs,
        sbRuns,
      };
    }

    let wrcPlus = 100;
    let projWar = 0;
    if (leagueAvg) {
      wrcPlus = leagueBattingAveragesService.calculateWrcPlus(projWoba, leagueAvg);
      projWar = leagueBattingAveragesService.calculateBattingWar(projWoba, projPa, leagueAvg, sbRuns);
    }
    if (trace) {
      trace.runValueOutput = {
        hasLeagueAverages: Boolean(leagueAvg),
        wrcPlus,
        war: projWar,
      };
    }

    const projection: ProjectedBatter = {
      playerId: trResult.playerId,
      name,
      teamId,
      teamName,
      position,
      positionLabel: POSITION_LABELS[position] || 'UT',
      age,
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
        hrPct: Math.round(projHrPct * 10) / 10,
        bbPct: Math.round(projBbPct * 10) / 10,
        kPct: Math.round(projKPct * 10) / 10,
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

    if (trace) {
      trace.output = {
        projectedStats: { ...projection.projectedStats },
        estimatedRatings: { ...projection.estimatedRatings },
      };
    }

    return projection;
  }
}

export const batterProjectionService = new BatterProjectionService();
