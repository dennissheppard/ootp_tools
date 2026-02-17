import { teamService } from './TeamService';
import { trueRatingsService } from './TrueRatingsService';
import { scoutingDataFallbackService } from './ScoutingDataFallbackService';
import { trueRatingsCalculationService } from './TrueRatingsCalculationService';
import { leagueStatsService } from './LeagueStatsService';
import { fipWarService } from './FipWarService';
import { RatingEstimatorService } from './RatingEstimatorService';
import { PitcherScoutingRatings, HitterScoutingRatings } from '../models/ScoutingData';
import { projectionService } from './ProjectionService';
import { dateService } from './DateService';
import { playerService } from './PlayerService';
import { trueFutureRatingService } from './TrueFutureRatingService';
import { hitterTrueFutureRatingService, HitterTrueFutureRatingInput } from './HitterTrueFutureRatingService';
import { hitterScoutingDataService } from './HitterScoutingDataService';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';
import { batterProjectionService } from './BatterProjectionService';
import { minorLeagueBattingStatsService } from './MinorLeagueBattingStatsService';
import { leagueBattingAveragesService } from './LeagueBattingAveragesService';
import { contractService } from './ContractService';
import { prospectDevelopmentCurveService } from './ProspectDevelopmentCurveService';

export interface RatedPlayer {
  playerId: number;
  name: string;
  trueRating: number;
  trueStuff: number;
  trueControl: number;
  trueHra: number;
  pitchCount: number;
  isSp: boolean;
  stats: {
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
    gs: number;
    era: number;
    fip: number;
    war?: number;
  };
}

export interface PitcherTfrSourceData {
    trueFutureRating: number;
    tfrPercentile: number;
    stuff: number;
    control: number;
    hra: number;
    projK9: number;
    projBb9: number;
    projHr9: number;
    projFip: number;
}

export interface RatedProspect {
    playerId: number;
    name: string;
    trueFutureRating: number;
    age: number;
    level: string;
    teamId: number;
    orgId: number;
    peakFip: number;
    peakWar: number;
    peakIp?: number;
    projK9?: number;
    projBb9?: number;
    projHr9?: number;
    percentile?: number;
    percentileRank?: number;
    stuffPercentile?: number;
    controlPercentile?: number;
    hraPercentile?: number;
    /** True ratings - normalized from percentiles across all prospects (20-80 scale) */
    trueRatings?: {
        stuff: number;
        control: number;
        hra: number;
    };
    potentialRatings: {
        stuff: number;
        control: number;
        hra: number;
    };
    scoutingRatings: {
        stuff: number;
        control: number;
        hra: number;
        stamina: number;
        pitches: number;
    };
    stats: {
        ip: number;
        k9: number;
        bb9: number;
        hr9: number;
    };
    /** Raw (unadjusted) MiLB stats — for development curve TR */
    rawStats?: {
        k9: number;
        bb9: number;
        hr9: number;
    };
    /** Development-curve-based True Rating (current ability estimate) */
    developmentTR?: {
        stuff: number;
        control: number;
        hra: number;
    };
    /** Total minor league IP */
    totalMinorIp?: number;
    /** TFR computed with each scout source as priority (for modal toggle) */
    tfrBySource?: { my?: PitcherTfrSourceData; osa?: PitcherTfrSourceData };
}

export interface FarmSystemRankings {
    teamId: number;
    teamName: string;
    rotationScore: number;
    bullpenScore: number;
    rotation: RatedProspect[]; // Top 5
    bullpen: RatedProspect[];  // Top 5
    allProspects: RatedProspect[]; // Full List
}

export interface FarmSystemOverview {
    teamId: number;
    teamName: string;
    totalWar: number;
    prospectCount: number;
    topProspectName: string;
    topProspectId: number;
    tierCounts: {
        elite: number; // 4.5+
        aboveAvg: number; // 3.5 - 4.0
        average: number; // 2.5 - 3.0
        fringe: number; // < 2.5
    };
}

export interface FarmData {
    reports: FarmSystemRankings[];
    systems: FarmSystemOverview[];
    prospects: RatedProspect[];
}

// ============================================================================
// Hitter Prospect Interfaces
// ============================================================================

export interface BatterTfrSourceData {
    trueFutureRating: number;
    tfrPercentile: number;
    power: number;
    eye: number;
    avoidK: number;
    contact: number;
    gap: number;
    speed: number;
    projBbPct: number;
    projKPct: number;
    projHrPct: number;
    projAvg: number;
    projObp: number;
    projSlg: number;
    projWoba: number;
}

export interface RatedHitterProspect {
    playerId: number;
    name: string;
    trueFutureRating: number;
    age: number;
    level: string;
    teamId: number;
    team: string;
    orgId: number;
    /** Parent organization name */
    parentOrg: string;
    /** Projected wOBA at peak */
    projWoba: number;
    /** Percentile rank among hitter prospects */
    percentile: number;
    /** Global rank among hitter prospects (1-based) */
    percentileRank?: number;
    /** Projected rate stats */
    projBbPct: number;
    projKPct: number;
    projHrPct: number;
    projIso: number;
    projAvg: number;
    /** Derived rate stats */
    projObp: number;
    projSlg: number;
    projOps: number;
    /** Projected PA (based on injury proneness) */
    projPa: number;
    /** wRC+ (100 = league average) */
    wrcPlus: number;
    /** Projected batting WAR */
    projWar: number;
    /** Total minor league PA */
    totalMinorPa: number;
    /** Injury proneness */
    injuryProneness?: string;
    /** Scouting ratings */
    scoutingRatings: {
        power: number;
        eye: number;
        avoidK: number;
        contact: number;
        gap: number;
        speed: number;
        ovr: number;
        pot: number;
    };
    /** True ratings - normalized from percentiles across all prospects (20-80 scale) */
    trueRatings: {
        power: number;
        eye: number;
        avoidK: number;
        contact: number;
        gap: number;
        speed: number;
    };
    /** Level-adjusted minor league stats (before scouting blend) for current ability estimation */
    adjustedStats?: {
        bbPct: number;
        kPct: number;
        hrPct: number;
        avg: number;
    };
    /** Raw (unadjusted) MiLB stats — for development curve TR */
    rawStats?: {
        bbPct: number;
        kPct: number;
        hrPct: number;
        avg: number;
    };
    /** Development-curve-based True Rating (current ability estimate) */
    developmentTR?: {
        eye: number;
        avoidK: number;
        power: number;
        contact: number;
        gap: number;
        speed: number;
    };
    /** Position */
    position: number;
    /** Whether this player qualifies for Farm Rankings (career AB <= 130) */
    isFarmEligible?: boolean;
    /** TFR computed with each scout source as priority (for modal toggle) */
    tfrBySource?: { my?: BatterTfrSourceData; osa?: BatterTfrSourceData };
}

export interface HitterFarmSystemRankings {
    teamId: number;
    teamName: string;
    totalScore: number;
    allProspects: RatedHitterProspect[];
}

export interface HitterFarmSystemOverview {
    teamId: number;
    teamName: string;
    totalScore: number;
    prospectCount: number;
    topProspectName: string;
    topProspectId: number;
    tierCounts: {
        elite: number;     // TFR >= 4.5
        aboveAvg: number;  // TFR 3.5-4.4
        average: number;   // TFR 2.5-3.4
        fringe: number;    // TFR < 2.5
    };
}

export interface HitterFarmData {
    reports: HitterFarmSystemRankings[];
    systems: HitterFarmSystemOverview[];
    prospects: RatedHitterProspect[];
}

// ============================================================================
// Power Rankings Interfaces
// ============================================================================

export interface RatedPitcher {
  playerId: number;
  name: string;
  trueRating: number;
  trueStuff: number;
  trueControl: number;
  trueHra: number;
  role: string;  // 'SP' | 'RP'
  stats?: {
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
    era: number;
    fip: number;
    war?: number;
  };
}

export interface RatedBatter {
  playerId: number;
  name: string;
  position: number;
  positionLabel: string;
  trueRating: number;
  estimatedPower: number;
  estimatedEye: number;
  estimatedAvoidK: number;
  estimatedContact: number;
  estimatedGap?: number;
  estimatedSpeed?: number;
  blendedBbPct?: number;
  blendedKPct?: number;
  blendedHrPct?: number;
  blendedAvg?: number;
  blendedDoublesRate?: number;
  blendedTriplesRate?: number;
  woba?: number;
  projWar?: number;
  percentile?: number;
  stats?: {
    pa: number;
    avg: number;
    obp: number;
    slg: number;
    ops: number;
    hr: number;
    war?: number;
  };
}

export interface TeamPowerRanking {
  teamId: number;
  teamName: string;
  teamRating: number;  // Weighted 0.5-5.0 scale
  seasonYear?: number; // Year this ranking is from (used in All-Time mode)

  // Component scores
  rotationRating: number;
  bullpenRating: number;
  lineupRating: number;
  benchRating: number;

  // Player rosters
  rotation: RatedPitcher[];      // Top 5 SP
  bullpen: RatedPitcher[];       // Top 8 RP
  lineup: RatedBatter[];         // 9 position players
  bench: RatedBatter[];          // Remaining players

  // Metadata
  totalRosterSize: number;       // Should be 26
}

// ============================================================================
// Team Rating Result (for Projections)
// ============================================================================

export interface TeamRatingResult {
  teamId: number;
  teamName: string;
  seasonYear?: number;
  rotationRunsAllowed: number;
  bullpenRunsAllowed: number;
  rotationLeagueAvgRuns: number;
  bullpenLeagueAvgRuns: number;
  rotationRunsSaved: number;
  bullpenRunsSaved: number;
  rotationWar: number;
  bullpenWar: number;
  rotation: RatedPlayer[];
  bullpen: RatedPlayer[];

  // NEW: Batter projections
  lineup?: RatedBatter[];
  bench?: RatedBatter[];
  lineupWar?: number;
  benchWar?: number;
  totalWar?: number;  // rotationWar + bullpenWar + lineupWar
  runsScored?: number;     // Team wRC total (lineup + bench)
  totalRunsAllowed?: number; // rotationRunsAllowed + bullpenRunsAllowed
}

class TeamRatingsService {
  private _unifiedHitterCache = new Map<number, HitterFarmData>();
  private _pitcherFarmCache = new Map<number, FarmData>();

  /**
   * Get Power Rankings for all MLB teams
   * Ranks teams by weighted Team Rating = 40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench
   */
  async getPowerRankings(year: number): Promise<TeamPowerRanking[]> {
    // 1. Fetch all required data
    const [allTeams, pitchingStats, leagueAverages] = await Promise.all([
      teamService.getAllTeams(),
      trueRatingsService.getTruePitchingStats(year),
      trueRatingsService.getLeagueAverages(year)
    ]);

    // Fetch batting stats and scouting
    const [battingStats, myScoutingRatings, osaScoutingRatings] = await Promise.all([
      trueRatingsService.getTrueBattingStats(year),
      hitterScoutingDataService.getLatestScoutingRatings('my'),
      hitterScoutingDataService.getLatestScoutingRatings('osa'),
    ]);

    // 2. Get multi-year stats for pitcher True Ratings
    const multiYearPitchingStats = await trueRatingsService.getMultiYearPitchingStats(year, 3);

    // 3. Calculate True Ratings for all pitchers (only those with stats in this year)
    const scoutingMap = new Map(await scoutingDataFallbackService.getScoutingRatingsWithFallback(year).then(s => s.ratings.map(r => [r.playerId, r])));

    // Filter to MLB pitchers only (level_id === 1)
    const mlbPitchingStats = pitchingStats.filter(stat => stat.level_id === 1);

    const pitcherTrInputs = mlbPitchingStats.map(stat => ({
      playerId: stat.player_id,
      playerName: stat.playerName,
      yearlyStats: multiYearPitchingStats.get(stat.player_id) ?? [],
      scoutingRatings: scoutingMap.get(stat.player_id)
    }));
    const pitcherTrResults = trueRatingsCalculationService.calculateTrueRatings(pitcherTrInputs, leagueAverages);
    const pitcherTrMap = new Map(pitcherTrResults.map(tr => [tr.playerId, tr]));

    // 4. Calculate True Ratings for all batters
    const hitterScoutingMap = new Map<number, any>();
    for (const rating of osaScoutingRatings) {
      hitterScoutingMap.set(rating.playerId, rating);
    }
    for (const rating of myScoutingRatings) {
      hitterScoutingMap.set(rating.playerId, rating);
    }

    // Filter to MLB batters only (level_id === 1, position !== 1)
    const mlbBattingStats = battingStats.filter(stat => stat.level_id === 1 && stat.position !== 1);

    // 4. Use canonical hitter True Ratings (shared cache with TrueRatingsView)
    const batterTrMap = await trueRatingsService.getHitterTrueRatings(year);

    // 5. Build team rosters from stats data (not from player service)
    const teamMap = new Map(allTeams.map(t => [t.id, t]));

    // Get unique MLB team IDs that actually have stats (this naturally excludes All-Star teams)
    // Check both current year and prior year in case we're in spring training with no current stats
    const teamsWithStats = new Set<number>();
    mlbPitchingStats.forEach(s => {
      const statTeam = teamMap.get(s.team_id);
      const actualTeamId = statTeam?.parentTeamId || s.team_id;
      teamsWithStats.add(actualTeamId);
    });
    mlbBattingStats.forEach(s => {
      const statTeam = teamMap.get(s.team_id);
      const actualTeamId = statTeam?.parentTeamId || s.team_id;
      teamsWithStats.add(actualTeamId);
    });

    // If no stats for current year, check prior year to identify valid MLB teams
    if (teamsWithStats.size === 0) {
      const [priorPitching, priorBatting] = await Promise.all([
        trueRatingsService.getTruePitchingStats(year - 1),
        trueRatingsService.getTrueBattingStats(year - 1)
      ]);
      priorPitching.filter(s => s.level_id === 1).forEach(s => {
        const statTeam = teamMap.get(s.team_id);
        const actualTeamId = statTeam?.parentTeamId || s.team_id;
        teamsWithStats.add(actualTeamId);
      });
      priorBatting.filter(s => s.level_id === 1).forEach(s => {
        const statTeam = teamMap.get(s.team_id);
        const actualTeamId = statTeam?.parentTeamId || s.team_id;
        teamsWithStats.add(actualTeamId);
      });
    }

    // Filter to MLB teams that have stats
    const mlbTeams = allTeams.filter(t => t.parentTeamId === 0 && teamsWithStats.has(t.id));

    const powerRankings: TeamPowerRanking[] = [];

    for (const team of mlbTeams) {
      // Get pitchers and batters from this team's stats
      const teamPitchingStats = mlbPitchingStats.filter(s => {
        const statTeam = teamMap.get(s.team_id);
        // Handle parent team mapping
        const actualTeamId = statTeam?.parentTeamId || s.team_id;
        return actualTeamId === team.id;
      });

      const teamBattingStats = mlbBattingStats.filter(s => {
        const statTeam = teamMap.get(s.team_id);
        const actualTeamId = statTeam?.parentTeamId || s.team_id;
        return actualTeamId === team.id;
      });


      // Build rated pitchers from stats
      const ratedPitchers: RatedPitcher[] = teamPitchingStats.map(stat => {
        const trData = pitcherTrMap.get(stat.player_id);
        const scouting = scoutingMap.get(stat.player_id);

        // Determine role (SP vs RP) - use multiple signals like getTeamRatings does
        const pitches = scouting?.pitches ?? {};
        const usablePitchCount = Object.values(pitches).filter(v => v >= 45).length;
        const stamina = scouting?.stamina ?? 0;

        // Priority 1: Check historical stats (most reliable)
        const historicalStats = multiYearPitchingStats.get(stat.player_id) ?? [];
        const totalGs = historicalStats.reduce((sum, s) => sum + (s.gs ?? 0), 0);
        const hasStarterHistory = totalGs >= 5;

        // Priority 2: Check current year stats
        const hasStarterRole = stat.gs >= 5;

        // Priority 3: Check scouting profile
        const hasStarterProfile = usablePitchCount >= 3 && stamina >= 30;

        // Classify as SP if they have any evidence of being a starter
        const isSp = hasStarterHistory || hasStarterRole || hasStarterProfile;

        const ip = trueRatingsService.parseIp(stat.ip);

        return {
          playerId: stat.player_id,
          name: stat.playerName,
          trueRating: trData?.trueRating ?? 0.5,
          trueStuff: trData?.estimatedStuff ?? 20,
          trueControl: trData?.estimatedControl ?? 20,
          trueHra: trData?.estimatedHra ?? 20,
          role: isSp ? 'SP' : 'RP',
          stats: {
            ip,
            k9: ip > 0 ? (stat.k / ip) * 9 : 0,
            bb9: ip > 0 ? (stat.bb / ip) * 9 : 0,
            hr9: ip > 0 ? (stat.hra / ip) * 9 : 0,
            era: ip > 0 ? (stat.er / ip) * 9 : 0,
            fip: 0,
            war: stat.war
          }
        };
      }).filter(p => p.trueRating > 0.5);

      // Build rated batters from stats
      // Include all batters - use True Rating if available, otherwise use scouting or default
      const ratedBatters: RatedBatter[] = teamBattingStats.map(stat => {
        const trData = batterTrMap.get(stat.player_id);
        const scouting = hitterScoutingMap.get(stat.player_id);

        // Use True Rating if available, otherwise estimate from scouting or use default
        let trueRating = (trData as any)?.trueRating ?? 0;
        if (trueRating === 0 && scouting) {
          // Estimate rating from scouting: average of key tools on 20-80 scale, converted to 0.5-5.0
          const avgTool = ((scouting.power ?? 50) + (scouting.eye ?? 50) + (scouting.avoidK ?? 50) + (scouting.contact ?? 50)) / 4;
          trueRating = 0.5 + (avgTool - 20) / 60 * 4.5; // Map 20-80 to 0.5-5.0
          trueRating = Math.round(trueRating * 2) / 2; // Round to nearest 0.5
        }
        if (trueRating === 0) {
          trueRating = 2.0; // Default for players without TR or scouting
        }

        return {
          playerId: stat.player_id,
          name: stat.playerName,
          position: stat.position,
          positionLabel: this.getPositionLabel(stat.position),
          trueRating,
          estimatedPower: (trData as any)?.estimatedPower ?? scouting?.power ?? 50,
          estimatedEye: (trData as any)?.estimatedEye ?? scouting?.eye ?? 50,
          estimatedAvoidK: (trData as any)?.estimatedAvoidK ?? scouting?.avoidK ?? 50,
          estimatedContact: (trData as any)?.estimatedContact ?? scouting?.contact ?? 50,
          estimatedGap: (trData as any)?.estimatedGap,
          estimatedSpeed: (trData as any)?.estimatedSpeed,
          blendedBbPct: trData?.blendedBbPct,
          blendedKPct: trData?.blendedKPct,
          blendedHrPct: trData?.blendedHrPct,
          blendedAvg: trData?.blendedAvg,
          blendedDoublesRate: trData?.blendedDoublesRate,
          blendedTriplesRate: trData?.blendedTriplesRate,
          woba: trData?.woba,
          projWar: trData?.war,
          percentile: trData?.percentile,
          stats: {
            pa: stat.pa,
            avg: stat.avg,
            obp: stat.obp,
            slg: stat.ab > 0 ? ((stat.h + stat.d + 2 * stat.t + 3 * stat.hr) / stat.ab) : 0,
            ops: stat.obp + (stat.ab > 0 ? ((stat.h + stat.d + 2 * stat.t + 3 * stat.hr) / stat.ab) : 0),
            hr: stat.hr,
            war: stat.war
          }
        };
      });

      // Construct optimal roster allocation
      // 1. Fill rotation with top 5 actual starters (by role)
      const starters = ratedPitchers.filter(p => p.role === 'SP')
        .sort((a, b) => b.trueRating - a.trueRating);
      const rotation = starters.slice(0, 5);

      // 2. Everyone else goes to bullpen (relievers + overflow starters)
      const rotationIds = new Set(rotation.map(p => p.playerId));
      const bullpen = ratedPitchers
        .filter(p => !rotationIds.has(p.playerId))
        .sort((a, b) => b.trueRating - a.trueRating)
        .slice(0, 8);

      // Debug: Only log when pitching staff is incomplete
      if (rotation.length < 5 || bullpen.length === 0) {
        console.warn(`[TeamRatings] ${team.name}: Pitching issue - ${rotation.length}/5 rotation, ${bullpen.length}/8 bullpen (${ratedPitchers.length} total pitchers)`);
      }

      const lineup = this.constructOptimalLineup(ratedBatters);

      // Debug: Only log when lineup is incomplete
      if (lineup.length < 9) {
        const filledPositions = new Set(lineup.map(l => l.positionLabel));
        const allPositions = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];
        const missing = allPositions.filter(p => !filledPositions.has(p));
        console.warn(`[TeamRatings] ${team.name}: Missing lineup positions: ${missing.join(', ')} (${ratedBatters.length} batters available)`);
      }

      const bench = ratedBatters
        .filter(b => !lineup.some(l => l.playerId === b.playerId))
        .sort((a, b) => b.trueRating - a.trueRating)
        .slice(0, 4);

      // Calculate component scores
      const rotationRating = rotation.length > 0 ? rotation.reduce((sum, p) => sum + p.trueRating, 0) / rotation.length : 0;
      const bullpenRating = bullpen.length > 0 ? bullpen.reduce((sum, p) => sum + p.trueRating, 0) / bullpen.length : 0;
      const lineupRating = lineup.length > 0 ? lineup.reduce((sum, b) => sum + b.trueRating, 0) / lineup.length : 0;
      const benchRating = bench.length > 0 ? bench.reduce((sum, b) => sum + b.trueRating, 0) / bench.length : 0;

      // Calculate Team Rating (weighted average)
      const teamRating = (rotationRating * 0.40) + (lineupRating * 0.40) + (bullpenRating * 0.15) + (benchRating * 0.05);

      powerRankings.push({
        teamId: team.id,
        teamName: team.nickname,
        teamRating,
        rotationRating,
        bullpenRating,
        lineupRating,
        benchRating,
        rotation,
        bullpen,
        lineup,
        bench,
        totalRosterSize: rotation.length + bullpen.length + lineup.length + bench.length
      });
    }

    // Sort by Team Rating descending
    return powerRankings.sort((a, b) => b.teamRating - a.teamRating);
  }

  /**
   * Get All-Time Power Rankings across all historical years.
   * Runs getPowerRankings for each year, tags results with seasonYear,
   * and returns all teams sorted by teamRating descending.
   * Uses batched parallel processing for performance.
   */
  async getAllTimePowerRankings(
    startYear: number = 2000,
    endYear?: number,
    onProgress?: (completed: number, total: number) => void
  ): Promise<TeamPowerRanking[]> {
    const finalEndYear = endYear ?? (await dateService.getCurrentYear() - 1);
    const years = Array.from(
      { length: finalEndYear - startYear + 1 },
      (_, i) => startYear + i
    );

    const allRankings: TeamPowerRanking[] = [];
    let completed = 0;

    // Process in batches of 3 to avoid overwhelming IndexedDB
    const batchSize = 3;
    for (let i = 0; i < years.length; i += batchSize) {
      const batch = years.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (year) => {
          try {
            const rankings = await this.getPowerRankings(year);
            return rankings.map(r => ({ ...r, seasonYear: year }));
          } catch (err) {
            console.warn(`[AllTime] Failed to load year ${year}:`, err);
            return [];
          }
        })
      );

      for (const yearRankings of batchResults) {
        allRankings.push(...yearRankings);
      }

      completed += batch.length;
      onProgress?.(completed, years.length);
    }

    // Sort all teams across all years by teamRating descending
    return allRankings.sort((a, b) => b.teamRating - a.teamRating);
  }

  /**
   * Construct optimal 9-player lineup with position flexibility
   * Uses scarcity-based assignment: fill most constrained positions first
   * to avoid putting flexible players where specialists should go.
   *
   * Position flexibility rules:
   * - SS can play 1B, 2B, 3B, SS
   * - CF can play LF, CF, RF
   * - LF can play LF, RF
   * - RF can play LF, RF
   * - All other positions: natural position only
   */
  private constructOptimalLineup(
    batters: RatedBatter[],
    getValue: (b: RatedBatter) => number = (b) => b.trueRating
  ): RatedBatter[] {
    const lineup: RatedBatter[] = [];
    const used = new Set<number>();

    // Sort batters by the provided value function (TR for power rankings, WAR for projections)
    const sorted = [...batters].sort((a, b) => getValue(b) - getValue(a));

    // Position slots and which player positions can fill them
    // Based on flexibility rules: SS→1B/2B/3B/SS, CF→LF/CF/RF, LF↔RF
    const positionSlots = [
      { label: 'C', position: 2, canPlay: [2] },           // C only
      { label: '1B', position: 3, canPlay: [3, 6] },       // 1B or SS
      { label: '2B', position: 4, canPlay: [4, 6] },       // 2B or SS
      { label: 'SS', position: 6, canPlay: [6] },          // SS only
      { label: '3B', position: 5, canPlay: [5, 6] },       // 3B or SS
      { label: 'LF', position: 7, canPlay: [7, 8, 9] },    // LF, CF, or RF
      { label: 'CF', position: 8, canPlay: [8] },          // CF only
      { label: 'RF', position: 9, canPlay: [9, 7, 8] },    // RF, LF, or CF
    ];

    // Fill positions by scarcity - most constrained positions first
    // This prevents putting a SS at 1B when a dedicated 1B exists
    const remainingSlots = [...positionSlots];

    while (remainingSlots.length > 0) {
      // Count eligible players for each remaining slot
      const slotScarcity = remainingSlots.map(slot => {
        const eligibleCount = sorted.filter(b =>
          !used.has(b.playerId) && slot.canPlay.includes(b.position)
        ).length;
        return { slot, eligibleCount };
      });

      // Sort by scarcity (fewest eligible players first)
      slotScarcity.sort((a, b) => a.eligibleCount - b.eligibleCount);

      // Fill the most constrained slot
      const { slot } = slotScarcity[0];
      let filled = false;

      for (const batter of sorted) {
        if (used.has(batter.playerId)) continue;
        if (slot.canPlay.includes(batter.position)) {
          lineup.push({
            ...batter,
            position: slot.position,
            positionLabel: slot.label
          });
          used.add(batter.playerId);
          filled = true;
          break;
        }
      }

      // Remove this slot from remaining
      const slotIndex = remainingSlots.findIndex(s => s.label === slot.label);
      remainingSlots.splice(slotIndex, 1);

      // If not filled with eligible player, try fallback with best available
      if (!filled) {
        for (const batter of sorted) {
          if (used.has(batter.playerId)) continue;
          lineup.push({
            ...batter,
            position: slot.position,
            positionLabel: slot.label
          });
          used.add(batter.playerId);
          break;
        }
      }
    }

    // Assign best remaining player to DH
    for (const batter of sorted) {
      if (used.has(batter.playerId)) continue;
      lineup.push({ ...batter, position: 10, positionLabel: 'DH' });
      used.add(batter.playerId);
      break;
    }

    return lineup;
  }

  private getPositionLabel(position: number): string {
    const labels: Record<number, string> = {
      1: 'P', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'LF', 8: 'CF', 9: 'RF', 10: 'DH'
    };
    return labels[position] ?? 'Unknown';
  }

  async getFarmData(year: number): Promise<FarmData> {
      const cached = this._pitcherFarmCache.get(year);
      if (cached) return cached;

      // Fetch scouting data first to handle fallback logic
      let scoutingData = await scoutingDataFallbackService.getScoutingRatingsWithFallback(year);
      if (scoutingData.ratings.length === 0) {
          console.warn(`[FarmRankings] No scouting data for ${year}. Falling back to latest...`);
          scoutingData = await scoutingDataFallbackService.getScoutingRatingsWithFallback();
      }

      const [allPlayers, tfrResults, tfrResultsOsa, teams, contracts] = await Promise.all([
          playerService.getAllPlayers(),
          trueFutureRatingService.getProspectTrueFutureRatings(year),
          trueFutureRatingService.getProspectTrueFutureRatings(year, 'osa'),
          teamService.getAllTeams(),
          contractService.getAllContracts()
      ]);

      // Build secondary TFR map (OSA priority) for tfrBySource
      const tfrMyMap = new Map(tfrResults.map(t => [t.playerId, t]));
      const tfrOsaMap = new Map(tfrResultsOsa.map(t => [t.playerId, t]));

      const playerMap = new Map(allPlayers.map(p => [p.id, p]));
      const teamMap = new Map(teams.map(t => [t.id, t]));
      const scoutingMap = new Map(scoutingData.ratings.map(s => [s.playerId, s]));

      // Use FipWarService calibrated defaults (replacementFip=5.20, runsPerWin=8.50)

      const orgGroups = new Map<number, { rotation: RatedProspect[], bullpen: RatedProspect[] }>();
      const allProspects: RatedProspect[] = [];

      let processedCount = 0;

      tfrResults.forEach(tfr => {
          const player = playerMap.get(tfr.playerId);
          if (!player) return;

          // Determine Organization ID via Team Service lookup
          const team = teamMap.get(player.teamId);
          if (!team) return;

          // Skip MLB-level teams (parentTeamId === 0 means root org)
          // But allow IC players through (identified by contract leagueId === -200)
          let orgId = team.parentTeamId;
          if (orgId === 0) {
              const contract = contracts.get(tfr.playerId);
              if (!contract || contract.leagueId !== -200) return; // Skip MLB players
              // IC player on a root-level team - use the team's own ID as org
              // (IC teams are sometimes root orgs in OOTP)
              orgId = team.id;
          }

          processedCount++;
          const scouting = scoutingMap.get(tfr.playerId);
          
          const pitches = scouting?.pitches ?? {};
          const pitchCount = Object.values(pitches).filter(v => v >= 45).length; // Usable pitches
          const stamina = scouting?.stamina ?? 0;
          const injury = scouting?.injuryProneness;

          // Classification: SP if Stamina >= 30 AND 3+ Usable Pitches
          const isSp = stamina >= 30 && pitchCount >= 3;

          // Calculate realistic IP projection based on stamina and injury proneness
          // PEAK PROJECTION: Age 27 peak assumes healthy, full workload season
          let projectedIp: number;
          if (isSp) {
              // SP: Peak workload formula
              // Elite starters (70+ stamina) should project to 220-240+ IP
              // stamina 50 → 180 IP, 60 → 210 IP, 70 → 240 IP
              const baseIp = 30 + (stamina * 3.0); // More aggressive for peak projection

              // Injury adjustment (less aggressive for peak - assume healthy season)
              let injuryFactor = 1.0;
              if (injury === 'Normal') injuryFactor = 1.0;
              else if (injury === 'Fragile') injuryFactor = 0.90; // Still capable of workhorse season
              else if (injury === 'Durable') injuryFactor = 1.10;
              else if (injury === 'Wrecked') injuryFactor = 0.75; // Significantly limits ceiling
              else if (injury === 'Ironman') injuryFactor = 1.15;

              projectedIp = Math.round(baseIp * injuryFactor);

              // Skill modifier (managers give more IP to better pitchers)
              let skillMod = 1.0;
              if (tfr.projFip <= 3.50) skillMod = 1.20;
              else if (tfr.projFip <= 4.00) skillMod = 1.10;
              else if (tfr.projFip <= 4.50) skillMod = 1.0;
              else if (tfr.projFip <= 5.00) skillMod = 0.90;
              else skillMod = 0.80;
              projectedIp = Math.round(projectedIp * skillMod);

              // Elite FIP boost
              let ipBoost = 1.0;
              if (tfr.projFip < 3.0) ipBoost = 1.08;
              else if (tfr.projFip < 3.5) ipBoost = 1.08 - ((tfr.projFip - 3.0) / 0.5) * 0.05;
              else if (tfr.projFip < 4.0) ipBoost = 1.03 - ((tfr.projFip - 3.5) / 0.5) * 0.03;
              if (ipBoost > 1.0) projectedIp = Math.round(projectedIp * ipBoost);

              projectedIp = Math.max(120, Math.min(260, projectedIp));
          } else {
              // RP: 50-75 IP typical range
              const baseIp = 50 + (stamina * 0.5); // stamina 30 → 65, 50 → 75

              let injuryFactor = 1.0;
              if (injury === 'Normal') injuryFactor = 1.0;
              else if (injury === 'Fragile') injuryFactor = 0.90;
              else if (injury === 'Durable') injuryFactor = 1.10;
              else if (injury === 'Wrecked') injuryFactor = 0.75;
              else if (injury === 'Ironman') injuryFactor = 1.15;

              projectedIp = Math.round(baseIp * injuryFactor);

              // Skill modifier for RP too
              let skillMod = 1.0;
              if (tfr.projFip <= 3.50) skillMod = 1.20;
              else if (tfr.projFip <= 4.00) skillMod = 1.10;
              else if (tfr.projFip <= 4.50) skillMod = 1.0;
              else if (tfr.projFip <= 5.00) skillMod = 0.90;
              else skillMod = 0.80;
              projectedIp = Math.round(projectedIp * skillMod);

              // Elite FIP boost
              let ipBoost = 1.0;
              if (tfr.projFip < 3.0) ipBoost = 1.08;
              else if (tfr.projFip < 3.5) ipBoost = 1.08 - ((tfr.projFip - 3.0) / 0.5) * 0.05;
              else if (tfr.projFip < 4.0) ipBoost = 1.03 - ((tfr.projFip - 3.5) / 0.5) * 0.03;
              if (ipBoost > 1.0) projectedIp = Math.round(projectedIp * ipBoost);

              projectedIp = Math.max(40, Math.min(80, projectedIp));
          }

          const peakWar = fipWarService.calculateWar(tfr.projFip, projectedIp);

          // Determine level label - use contract to detect IC players
          const playerContract = contracts.get(tfr.playerId);
          const levelLabel = (playerContract && playerContract.leagueId === -200)
              ? 'IC'
              : this.getLevelLabel(player.level);

          const prospect: RatedProspect = {
              playerId: tfr.playerId,
              name: tfr.playerName,
              trueFutureRating: tfr.trueFutureRating,
              percentile: tfr.percentile,
              stuffPercentile: tfr.stuffPercentile,
              controlPercentile: tfr.controlPercentile,
              hraPercentile: tfr.hraPercentile,
              trueRatings: {
                  stuff: tfr.trueStuff,
                  control: tfr.trueControl,
                  hra: tfr.trueHra,
              },
              age: tfr.age,
              level: levelLabel,
              teamId: player.teamId,
              orgId: orgId,
              peakFip: tfr.projFip,
              peakWar: peakWar,
              peakIp: projectedIp,
              projK9: tfr.projK9,
              projBb9: tfr.projBb9,
              projHr9: tfr.projHr9,
              potentialRatings: {
                  stuff: tfr.projK9,
                  control: tfr.projBb9,
                  hra: tfr.projHr9
              },
              scoutingRatings: {
                  stuff: scouting?.stuff ?? 0,
                  control: scouting?.control ?? 0,
                  hra: scouting?.hra ?? 0,
                  stamina,
                  pitches: pitchCount
              },
              stats: {
                  ip: projectedIp,
                  k9: tfr.adjustedK9,
                  bb9: tfr.adjustedBb9,
                  hr9: tfr.adjustedHr9
              },
              rawStats: tfr.rawK9 !== undefined ? { k9: tfr.rawK9, bb9: tfr.rawBb9!, hr9: tfr.rawHr9! } : undefined,
              totalMinorIp: tfr.totalMinorIp,
          };

          // Build tfrBySource from both TFR runs
          const buildPitcherTfrSource = (t: typeof tfr): PitcherTfrSourceData => ({
              trueFutureRating: t.trueFutureRating,
              tfrPercentile: t.percentile,
              stuff: t.trueStuff,
              control: t.trueControl,
              hra: t.trueHra,
              projK9: t.projK9,
              projBb9: t.projBb9,
              projHr9: t.projHr9,
              projFip: t.projFip,
          });
          const myTfr = tfrMyMap.get(tfr.playerId);
          const osaTfr = tfrOsaMap.get(tfr.playerId);
          if (myTfr || osaTfr) {
              prospect.tfrBySource = {};
              if (myTfr) prospect.tfrBySource.my = buildPitcherTfrSource(myTfr);
              if (osaTfr) prospect.tfrBySource.osa = buildPitcherTfrSource(osaTfr);
          }

          // Calculate development-curve-based TR for pitcher prospects
          prospect.developmentTR = prospectDevelopmentCurveService.calculatePitcherProspectTR(prospect);

          allProspects.push(prospect);

          if (!orgGroups.has(orgId)) {
              orgGroups.set(orgId, { rotation: [], bullpen: [] });
          }
          const group = orgGroups.get(orgId)!;
          if (isSp) {
              group.rotation.push(prospect);
          } else {
              group.bullpen.push(prospect);
          }
      });

      // IMPORTANT: Sort and assign percentileRank BEFORE generating reports/systems
      // (tierCounts depend on percentileRank being set)
      const sortedProspects = allProspects.sort((a, b) => {
          if (b.percentile !== undefined && a.percentile !== undefined && b.percentile !== a.percentile) {
              return b.percentile - a.percentile;
          }
          if (b.trueFutureRating !== a.trueFutureRating) {
              return b.trueFutureRating - a.trueFutureRating;
          }
          return b.peakWar - a.peakWar;
      });

      // Assign percentile ranks (1-based) after sorting
      sortedProspects.forEach((prospect, index) => {
          prospect.percentileRank = index + 1;
      });

      // Generate Reports (Rotation/Bullpen top 5s)
      const reports: FarmSystemRankings[] = [];
      const systems: FarmSystemOverview[] = [];

      orgGroups.forEach((group, orgId) => {
          const team = teamMap.get(orgId);
          if (!team) return;

          // 1. Reports Data
          group.rotation.sort((a, b) => b.peakWar - a.peakWar);
          const topRotation = group.rotation.slice(0, 5);
          const rotationScore = topRotation.reduce((sum, p) => sum + Math.max(0, p.peakWar), 0);

          group.bullpen.sort((a, b) => b.peakWar - a.peakWar);
          const topBullpen = group.bullpen.slice(0, 5);
          const bullpenScore = topBullpen.reduce((sum, p) => sum + Math.max(0, p.peakWar), 0);

          reports.push({
              teamId: orgId,
              teamName: team.nickname,
              rotationScore,
              bullpenScore,
              rotation: topRotation,
              bullpen: topBullpen,
              allProspects: [...group.rotation, ...group.bullpen].sort((a, b) => b.peakWar - a.peakWar)
          });

          // 2. System Overview Data
          const allOrgProspects = [...group.rotation, ...group.bullpen];

          // Top Prospect - Highest Peak WAR, with TFR as tie-breaker
          const topProspect = allOrgProspects.reduce((prev, current) => {
              if (current.peakWar > prev.peakWar) return current;
              if (current.peakWar === prev.peakWar && current.trueFutureRating > prev.trueFutureRating) return current;
              return prev;
          });

          // Tiers - bucket prospects by global rank
          const tierCounts = {
              elite: 0,       // Top 100 (ranks 1-100)
              aboveAvg: 0,    // Next 200 (ranks 101-300)
              average: 0,     // Next 200 (ranks 301-500)
              fringe: 0       // Rest (ranks 501+)
          };

          allOrgProspects.forEach(p => {
              const rank = p.percentileRank || 9999;
              if (rank <= 100) tierCounts.elite++;
              else if (rank <= 300) tierCounts.aboveAvg++;
              else if (rank <= 500) tierCounts.average++;
              else tierCounts.fringe++;
          });

          // Calculate Farm Score based on tier counts
          // Elite: 10 pts each, Good: 5 pts each, Avg: 1 pt each
          // No points for depth/fringe
          const totalWar = (tierCounts.elite * 10) +
                           (tierCounts.aboveAvg * 5) +
                           (tierCounts.average * 1);

          systems.push({
              teamId: orgId,
              teamName: team.nickname,
              totalWar,
              prospectCount: allOrgProspects.length,
              topProspectName: topProspect.name,
              topProspectId: topProspect.playerId,
              tierCounts
          });
      });

      const result: FarmData = {
          reports,
          systems: systems.sort((a, b) => b.totalWar - a.totalWar),
          prospects: sortedProspects
      };
      this._pitcherFarmCache.set(year, result);
      return result;
  }

  /**
   * Get unified hitter TFR data for an expanded pool of players.
   * Uses gate check (age < 26 OR starGap >= 0.5) instead of careerAb <= 130.
   * Each result includes isFarmEligible for backward compat with Farm Rankings.
   */
  async getUnifiedHitterTfrData(year: number): Promise<HitterFarmData> {
      const cached = this._unifiedHitterCache.get(year);
      if (cached) return cached;

      // Fetch hitter scouting data and league averages in parallel
      const [myScoutingRatings, osaScoutingRatings, leagueAvg, careerAbMap, contracts] = await Promise.all([
          hitterScoutingDataService.getLatestScoutingRatings('my'),
          hitterScoutingDataService.getLatestScoutingRatings('osa'),
          leagueBattingAveragesService.getLeagueAverages(year),
          this.getCareerMlbAbMap(year),
          contractService.getAllContracts()
      ]);

      // Merge scouting data (my takes priority)
      const scoutingMap = new Map<number, HitterScoutingRatings>();
      for (const rating of osaScoutingRatings) {
          if (rating.playerId > 0) scoutingMap.set(rating.playerId, rating);
      }
      for (const rating of myScoutingRatings) {
          if (rating.playerId > 0) scoutingMap.set(rating.playerId, rating);
      }

      // Also build OSA-priority map for secondary TFR run
      const scoutingMapOsa = new Map<number, HitterScoutingRatings>();
      for (const rating of myScoutingRatings) {
          if (rating.playerId > 0) scoutingMapOsa.set(rating.playerId, rating);
      }
      for (const rating of osaScoutingRatings) {
          if (rating.playerId > 0) scoutingMapOsa.set(rating.playerId, rating);
      }

      if (scoutingMap.size === 0) {
          console.warn(`[UnifiedHitterTfr] No hitter scouting data found.`);
          return { reports: [], systems: [], prospects: [] };
      }

      if (!leagueAvg) {
          console.warn(`[UnifiedHitterTfr] No league averages found for ${year}, using defaults.`);
      }

      // Fetch player and team data
      const [allPlayers, teams] = await Promise.all([
          playerService.getAllPlayers(),
          teamService.getAllTeams()
      ]);

      const playerMap = new Map(allPlayers.map(p => [p.id, p]));
      const teamMap = new Map(teams.map(t => [t.id, t]));

      // Fetch minor league batting stats for TFR calculation
      const allMinorStats = await minorLeagueBattingStatsService.getAllPlayerStatsBatch(
          year - 2,
          year
      );

      // Build TFR inputs using expanded gate check
      const tfrInputs: HitterTrueFutureRatingInput[] = [];
      const prospectPlayerMap = new Map<number, { player: any; scouting: HitterScoutingRatings; careerAb: number }>();

      scoutingMap.forEach((scouting, playerId) => {
          const player = playerMap.get(playerId);
          if (!player) return;

          const team = teamMap.get(player.teamId);
          if (!team) return;

          const careerAb = careerAbMap.get(playerId) ?? 0;
          const starGap = (scouting.pot ?? 0) - (scouting.ovr ?? 0);

          // Gate check: only calculate TFR if age < 26 OR starGap >= 0.5
          if (player.age >= 26 && starGap < 0.5) return;

          // Still need some evidence of professional activity
          const minorStats = allMinorStats.get(playerId) ?? [];
          const totalPa = minorStats.reduce((sum, s) => sum + s.pa, 0);

          if (totalPa === 0 && careerAb === 0) {
              // No stats at all — check for a professional contract
              const contract = contracts.get(playerId);
              if (!contract || contract.leagueId === 0) {
                  return; // Truly amateur/unsigned, skip
              }
          }

          tfrInputs.push({
              playerId,
              playerName: scouting.playerName ?? `${player.firstName} ${player.lastName}`,
              age: player.age,
              scouting,
              minorLeagueStats: minorStats,
          });

          prospectPlayerMap.set(playerId, { player, scouting, careerAb });
      });

      // Build secondary (OSA-priority) TFR inputs for tfrBySource
      const tfrInputsOsa: HitterTrueFutureRatingInput[] = tfrInputs.map(input => {
          const osaScouting = scoutingMapOsa.get(input.playerId);
          return osaScouting ? { ...input, scouting: osaScouting } : input;
      });

      // Calculate True Future Ratings for both scout priorities
      const [tfrResults, tfrResultsOsa] = await Promise.all([
          hitterTrueFutureRatingService.calculateTrueFutureRatings(tfrInputs, leagueAvg ?? undefined),
          hitterTrueFutureRatingService.calculateTrueFutureRatings(tfrInputsOsa, leagueAvg ?? undefined),
      ]);

      // Build maps for both TFR runs
      const tfrMyResultMap = new Map(tfrResults.map(t => [t.playerId, t]));
      const tfrOsaResultMap = new Map(tfrResultsOsa.map(t => [t.playerId, t]));

      // Build empirical PA distributions from MLB peak-age data by injury category
      const empiricalPaByInjury = await hitterTrueFutureRatingService.buildMLBPaByInjury(scoutingMap);

      // Build prospect list grouped by organization
      const orgGroups = new Map<number, RatedHitterProspect[]>();
      const allProspects: RatedHitterProspect[] = [];

      tfrResults.forEach(tfr => {
          const prospectInfo = prospectPlayerMap.get(tfr.playerId);
          if (!prospectInfo) return;

          const { player, scouting, careerAb } = prospectInfo;
          const team = teamMap.get(player.teamId);
          if (!team) return;

          // For IC players on root-level teams, orgId is the team itself
          const orgId = team.parentTeamId !== 0 ? team.parentTeamId : team.id;

          // Calculate derived stats
          const projSlg = tfr.projAvg + tfr.projIso;
          const projObp = tfr.projAvg + (tfr.projBbPct / 100); // Simplified OBP
          const projOps = projObp + projSlg;
          const injury = scouting.injuryProneness ?? 'Normal';
          const projPa = empiricalPaByInjury.get(injury)
              ?? empiricalPaByInjury.get('Normal')
              ?? leagueBattingAveragesService.getProjectedPa(scouting.injuryProneness);

          // Calculate wRC+ and WAR using league averages (include baserunning from SR/STE)
          let wrcPlus = 100; // Default to league average
          let projWar = 0;
          const sr = scouting.stealingAggressiveness;
          const ste = scouting.stealingAbility;
          let sbRuns = 0;
          if (sr !== undefined && ste !== undefined) {
              const sbProj = HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa);
              sbRuns = leagueBattingAveragesService.calculateBaserunningRuns(sbProj.sb, sbProj.cs);
          }
          if (leagueAvg) {
              wrcPlus = leagueBattingAveragesService.calculateWrcPlus(tfr.projWoba, leagueAvg);
              projWar = leagueBattingAveragesService.calculateBattingWar(tfr.projWoba, projPa, leagueAvg, sbRuns);
          } else {
              // Fallback calculation when league averages not available
              const lgWoba = 0.315;
              const wobaScale = 1.15;
              const runsPerWin = 10;
              const wRAA = ((tfr.projWoba - lgWoba) / wobaScale) * projPa;
              const replacementRuns = (projPa / 600) * 20;
              projWar = Math.round(((wRAA + replacementRuns + sbRuns) / runsPerWin) * 10) / 10;
          }

          // Determine level label - use contract to detect IC players
          const playerContract = contracts.get(tfr.playerId);
          const hitterLevelLabel = (playerContract && playerContract.leagueId === -200)
              ? 'IC'
              : this.getLevelLabel(player.level);

          const prospect: RatedHitterProspect = {
              playerId: tfr.playerId,
              name: tfr.playerName,
              trueFutureRating: tfr.trueFutureRating,
              percentile: tfr.percentile,
              age: tfr.age,
              level: hitterLevelLabel,
              teamId: player.teamId,
              team: team.nickname,
              orgId,
              parentOrg: teamMap.get(orgId)?.nickname ?? team.nickname,
              projWoba: tfr.projWoba,
              projBbPct: tfr.projBbPct,
              projKPct: tfr.projKPct,
              projHrPct: tfr.projHrPct,
              projIso: tfr.projIso,
              projAvg: tfr.projAvg,
              projObp: Math.round(projObp * 1000) / 1000,
              projSlg: Math.round(projSlg * 1000) / 1000,
              projOps: Math.round(projOps * 1000) / 1000,
              projPa,
              wrcPlus,
              projWar,
              totalMinorPa: tfr.totalMinorPa,
              injuryProneness: scouting.injuryProneness,
              scoutingRatings: {
                  power: scouting.power,
                  eye: scouting.eye,
                  avoidK: scouting.avoidK,
                  contact: scouting.contact ?? 50,
                  gap: scouting.gap ?? 50,
                  speed: scouting.speed ?? 50,
                  ovr: scouting.ovr,
                  pot: scouting.pot,
              },
              trueRatings: {
                  power: tfr.truePower,
                  eye: tfr.trueEye,
                  avoidK: tfr.trueAvoidK,
                  contact: tfr.trueContact,
                  gap: tfr.trueGap,
                  speed: tfr.trueSpeed,
              },
              adjustedStats: {
                  bbPct: tfr.adjustedBbPct,
                  kPct: tfr.adjustedKPct,
                  hrPct: tfr.adjustedHrPct,
                  avg: tfr.adjustedAvg,
              },
              rawStats: tfr.rawBbPct !== undefined ? {
                  bbPct: tfr.rawBbPct,
                  kPct: tfr.rawKPct!,
                  hrPct: tfr.rawHrPct!,
                  avg: tfr.rawAvg!,
              } : undefined,
              position: player.position,
              isFarmEligible: careerAb <= 130,
          };

          // Build tfrBySource from both TFR runs
          const buildBatterTfrSource = (t: typeof tfr): BatterTfrSourceData => {
              const pSlg = t.projAvg + t.projIso;
              const pObp = t.projAvg + (t.projBbPct / 100);
              return {
                  trueFutureRating: t.trueFutureRating,
                  tfrPercentile: t.percentile,
                  power: t.truePower,
                  eye: t.trueEye,
                  avoidK: t.trueAvoidK,
                  contact: t.trueContact,
                  gap: t.trueGap,
                  speed: t.trueSpeed,
                  projBbPct: t.projBbPct,
                  projKPct: t.projKPct,
                  projHrPct: t.projHrPct,
                  projAvg: t.projAvg,
                  projObp: Math.round(pObp * 1000) / 1000,
                  projSlg: Math.round(pSlg * 1000) / 1000,
                  projWoba: t.projWoba,
              };
          };
          const myBatterTfr = tfrMyResultMap.get(tfr.playerId);
          const osaBatterTfr = tfrOsaResultMap.get(tfr.playerId);
          if (myBatterTfr || osaBatterTfr) {
              prospect.tfrBySource = {};
              if (myBatterTfr) prospect.tfrBySource.my = buildBatterTfrSource(myBatterTfr);
              if (osaBatterTfr) prospect.tfrBySource.osa = buildBatterTfrSource(osaBatterTfr);
          }

          // Compute development-curve-based TR
          prospect.developmentTR = prospectDevelopmentCurveService.calculateProspectTR(prospect);

          allProspects.push(prospect);

          // Only include farm-eligible players in org groups (for Farm Rankings reports)
          if (prospect.isFarmEligible) {
              if (!orgGroups.has(orgId)) {
                  orgGroups.set(orgId, []);
              }
              orgGroups.get(orgId)!.push(prospect);
          }
      });

      // Sort all prospects by percentile and assign global ranks
      allProspects.sort((a, b) => {
          if (b.percentile !== a.percentile) return b.percentile - a.percentile;
          return b.trueFutureRating - a.trueFutureRating;
      });

      allProspects.forEach((prospect, index) => {
          prospect.percentileRank = index + 1;
      });

      // Generate reports and system overviews
      const reports: HitterFarmSystemRankings[] = [];
      const systems: HitterFarmSystemOverview[] = [];

      orgGroups.forEach((prospects, orgId) => {
          const team = teamMap.get(orgId);
          if (!team) return;

          // Sort by percentile/TFR descending
          prospects.sort((a, b) => {
              if (b.percentile !== a.percentile) return b.percentile - a.percentile;
              return b.trueFutureRating - a.trueFutureRating;
          });

          // Calculate score using global rank buckets
          const tierCounts = {
              elite: 0,       // Top 100 (ranks 1-100)
              aboveAvg: 0,    // Next 200 (ranks 101-300)
              average: 0,     // Next 200 (ranks 301-500)
              fringe: 0       // Rest (ranks 501+)
          };

          prospects.forEach(p => {
              const rank = p.percentileRank || 9999;
              if (rank <= 100) tierCounts.elite++;
              else if (rank <= 300) tierCounts.aboveAvg++;
              else if (rank <= 500) tierCounts.average++;
              else tierCounts.fringe++;
          });

          const totalScore = (tierCounts.elite * 10) + (tierCounts.aboveAvg * 5) + (tierCounts.average * 1);

          reports.push({
              teamId: orgId,
              teamName: team.nickname,
              totalScore,
              allProspects: prospects,
          });

          const topProspect = prospects[0];
          systems.push({
              teamId: orgId,
              teamName: team.nickname,
              totalScore,
              prospectCount: prospects.length,
              topProspectName: topProspect?.name ?? '',
              topProspectId: topProspect?.playerId ?? 0,
              tierCounts,
          });
      });

      // allProspects already sorted and ranked above
      const result: HitterFarmData = {
          reports: reports.sort((a, b) => b.totalScore - a.totalScore),
          systems: systems.sort((a, b) => b.totalScore - a.totalScore),
          prospects: allProspects,
      };
      this._unifiedHitterCache.set(year, result);
      return result;
  }

  /**
   * Get hitter prospect farm data for all organizations.
   * Delegates to getUnifiedHitterTfrData() and filters to farm-eligible players only.
   */
  async getHitterFarmData(year: number): Promise<HitterFarmData> {
      const unified = await this.getUnifiedHitterTfrData(year);
      return {
          reports: unified.reports,
          systems: unified.systems,
          prospects: unified.prospects.filter(p => p.isFarmEligible),
      };
  }

  private async getCareerMlbAbMap(currentYear: number): Promise<Map<number, number>> {
      const startYear = Math.max(2000, currentYear - 10);
      const promises = [];
      for (let y = startYear; y <= currentYear; y++) {
          promises.push(trueRatingsService.getTrueBattingStats(y));
      }
      
      const results = await Promise.all(promises);
      const map = new Map<number, number>();
      
      results.flat().forEach(stat => {
          const ab = stat.ab;
          const current = map.get(stat.player_id) || 0;
          map.set(stat.player_id, current + ab);
      });
      
      return map;
  }

  private getLevelLabel(level: number): string {
      // WBL-specific level mapping (verified with actual 2020 data)
      // 1: MLB, 2: AAA (league_id 201), 3: AA (league_id 202),
      // 4: A (league_id 203), 6: R (league_id 204)
      // WBL does NOT have Short-A, A+, or A- levels
      switch(level) {
          case 1: return 'MLB';
          case 2: return 'AAA';
          case 3: return 'AA';
          case 4: return 'A';
          case 5: return 'Short-A'; // Not used in WBL
          case 6: return 'R'; // Rookie
          case 7: return 'R'; // Also Rookie (fallback)
          case 8: return 'IC'; // International Complex
          default: return `Lvl ${level}`;
      }
  }

  async getProjectedTeamRatings(baseYear: number): Promise<TeamRatingResult[]> {
      const [pitcherProjections, leagueStats, batterProjectionsCtx, leagueBattingAvg] = await Promise.all([
        projectionService.getProjections(baseYear, { forceRosterRefresh: false }),
        leagueStatsService.getLeagueStats(baseYear),
        batterProjectionService.getProjectionsWithContext(baseYear),
        leagueBattingAveragesService.getLeagueAverages(baseYear)
      ]);

      const teamGroups = new Map<number, {
        rotation: RatedPlayer[],
        bullpen: RatedPlayer[],
        batters: RatedBatter[]
      }>();
      const teams = await teamService.getAllTeams();
      const teamMap = new Map(teams.map(t => [t.id, t]));

      // Process pitcher projections
      pitcherProjections.forEach(p => {
          if (p.teamId === 0) return; // Skip FA

          // Use the role classification from the projection service
          // (already determined based on scouting, historical GS, etc.)
          const isSp = p.isSp;

          const ratedPlayer: RatedPlayer = {
              playerId: p.playerId,
              name: p.name,
              trueRating: p.projectedTrueRating,
              trueStuff: p.projectedRatings.stuff,
              trueControl: p.projectedRatings.control,
              trueHra: p.projectedRatings.hra,
              pitchCount: 0, // Not available in projection output, but used for classification which is already done
              isSp,
              stats: {
                  ip: p.projectedStats.ip,
                  k9: p.projectedStats.k9,
                  bb9: p.projectedStats.bb9,
                  hr9: p.projectedStats.hr9,
                  gs: isSp ? 30 : 0, // Mock GS
                  era: 0, // ERA not projected
                  fip: p.projectedStats.fip,
                  war: p.projectedStats.war
              }
          };

          if (!teamGroups.has(p.teamId)) {
              teamGroups.set(p.teamId, { rotation: [], bullpen: [], batters: [] });
          }
          const group = teamGroups.get(p.teamId)!;
          if (isSp) {
              group.rotation.push(ratedPlayer);
          } else {
              group.bullpen.push(ratedPlayer);
          }
      });

      // Process batter projections
      batterProjectionsCtx.projections.forEach(b => {
          if (b.teamId === 0) return; // Skip FA

          const ratedBatter: RatedBatter = {
              playerId: b.playerId,
              name: b.name,
              position: b.position,
              positionLabel: b.positionLabel,
              trueRating: b.currentTrueRating,
              estimatedPower: b.estimatedRatings.power,
              estimatedEye: b.estimatedRatings.eye,
              estimatedAvoidK: b.estimatedRatings.avoidK,
              estimatedContact: b.estimatedRatings.contact,
              blendedBbPct: b.projectedStats.bbPct,
              blendedKPct: b.projectedStats.kPct,
              blendedHrPct: b.projectedStats.hrPct,
              blendedAvg: b.projectedStats.avg,
              woba: b.projectedStats.woba,
              projWar: b.projectedStats.war,
              percentile: b.percentile,
              stats: {
                  pa: b.projectedStats.pa,
                  avg: b.projectedStats.avg,
                  obp: b.projectedStats.obp,
                  slg: b.projectedStats.slg,
                  ops: b.projectedStats.ops,
                  hr: b.projectedStats.hr,
                  war: b.projectedStats.war
              }
          };

          if (!teamGroups.has(b.teamId)) {
              teamGroups.set(b.teamId, { rotation: [], bullpen: [], batters: [] });
          }
          const group = teamGroups.get(b.teamId)!;
          group.batters.push(ratedBatter);
      });

      // 1. Organize Groups & Calculate Role-Specific Baselines
      // We need to compare Starters to Starters and Relievers to Relievers.
      // Comparing a Starter to the overall League Average (which includes elite relievers)
      // unfairly penalizes rotations.
      
      let totalRotationFipIp = 0;
      let totalRotationIp = 0;
      let totalBullpenFipIp = 0;
      let totalBullpenIp = 0;

      teamGroups.forEach((group, teamId) => {
          const team = teamMap.get(teamId);
          if (team && team.parentTeamId !== 0) return;

          // Sort Rotation by Projected TR desc
          group.rotation.sort((a, b) => b.trueRating - a.trueRating);

          // Handle Overflow: Move starters beyond top 5 to bullpen
          if (group.rotation.length > 5) {
              const overflow = group.rotation.slice(5);
              group.bullpen.push(...overflow);
              group.rotation = group.rotation.slice(0, 5);
          }

          // Sort Bullpen by Projected TR desc (now includes overflow starters)
          group.bullpen.sort((a, b) => b.trueRating - a.trueRating);

          // Aggregate stats for Baseline Calculation (using top 5 rotation, top 8 bullpen)
          const topRotation = group.rotation;
          const topBullpen = group.bullpen.slice(0, 8);

          topRotation.forEach(p => {
              if (p.stats.ip > 0) {
                  totalRotationFipIp += p.stats.fip * p.stats.ip;
                  totalRotationIp += p.stats.ip;
              }
          });

          topBullpen.forEach(p => {
              if (p.stats.ip > 0) {
                  totalBullpenFipIp += p.stats.fip * p.stats.ip;
                  totalBullpenIp += p.stats.ip;
              }
          });
      });

      const avgRotationFip = totalRotationIp > 0 ? totalRotationFipIp / totalRotationIp : leagueStats.avgFip;
      const avgBullpenFip = totalBullpenIp > 0 ? totalBullpenFipIp / totalBullpenIp : leagueStats.avgFip;

      // 2. Calculate Runs Allowed & Zero-Sum Baseline
      const teamRunTotals: Array<{
          teamId: number;
          teamName: string;
          rotationRuns: number;
          bullpenRuns: number;
          rotationWar: number;
          bullpenWar: number;
          group: { rotation: RatedPlayer[]; bullpen: RatedPlayer[] };
      }> = [];

      let grandTotalRotationRuns = 0;
      let grandTotalBullpenRuns = 0;
      let count = 0;

      teamGroups.forEach((group, teamId) => {
          const team = teamMap.get(teamId);
          if (team && team.parentTeamId !== 0) return;

          const topRotation = group.rotation;
          const topBullpen = group.bullpen.slice(0, 8);
          
          // Use role-specific averages for replacement level
          // Pass avgRotationFip as the "League Average" to the helper.
          // The helper uses this to calculate replacement level (Input + 1.00)
          const rotationRuns = this.calculateRunSummary(topRotation, avgRotationFip, 950);
          const bullpenRuns = this.calculateRunSummary(topBullpen, avgBullpenFip, 500);

          // Calculate Team WAR
          const rotationWar = topRotation.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);
          const bullpenWar = topBullpen.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);

          grandTotalRotationRuns += rotationRuns.runsAllowed;
          grandTotalBullpenRuns += bullpenRuns.runsAllowed;
          count++;

          teamRunTotals.push({
              teamId,
              teamName: team ? team.nickname : `Team ${teamId}`,
              rotationRuns: rotationRuns.runsAllowed,
              bullpenRuns: bullpenRuns.runsAllowed,
              rotationWar,
              bullpenWar,
              group
          });
      });

      // Calculate the Global Average Runs (The "Zero Line" for Runs Saved)
      // This represents the average performance of a constructed team (including replacement filler)
      const globalAvgRotationRuns = count > 0 ? grandTotalRotationRuns / count : 0;
      const globalAvgBullpenRuns = count > 0 ? grandTotalBullpenRuns / count : 0;

      // 3. Finalize Results with batter data
      const results: TeamRatingResult[] = teamRunTotals.map(r => {
          const group = r.group;

          // Sort batters by projected WAR — top 9 are lineup, next 4 are bench.
          // Matches the calibration tool pipeline (simple WAR sort, no position scarcity).
          const sortedBatters = (group as any).batters.sort((a: RatedBatter, b: RatedBatter) => (b.stats?.war ?? 0) - (a.stats?.war ?? 0));
          const lineup = sortedBatters.slice(0, 9);
          const bench = sortedBatters.slice(9, 13);

          // Calculate WAR
          const lineupWar = lineup.reduce((sum: number, b: RatedBatter) => sum + (b.stats?.war ?? 0), 0);
          const benchWar = bench.reduce((sum: number, b: RatedBatter) => sum + (b.stats?.war ?? 0), 0);
          const totalWar = r.rotationWar + r.bullpenWar + lineupWar;

          // Calculate Runs Scored from wRC (lineup + bench)
          const allBatters = [...lineup, ...bench];
          let runsScored = 0;
          if (leagueBattingAvg) {
              runsScored = allBatters.reduce((sum: number, b: RatedBatter) => {
                  return sum + leagueBattingAveragesService.calculateWrc(b.woba ?? 0, b.stats?.pa ?? 0, leagueBattingAvg);
              }, 0);
          } else {
              // Fallback: lgRpa ≈ 0.115, lgWoba ≈ 0.315, wobaScale ≈ 1.15
              runsScored = allBatters.reduce((sum: number, b: RatedBatter) => {
                  const wRAA = (((b.woba ?? 0) - 0.315) / 1.15) * (b.stats?.pa ?? 0);
                  return sum + wRAA + (0.115 * (b.stats?.pa ?? 0));
              }, 0);
          }

          const totalRunsAllowed = r.rotationRuns + r.bullpenRuns;

          return {
              teamId: r.teamId,
              teamName: r.teamName,
              seasonYear: baseYear + 1,
              rotationRunsAllowed: r.rotationRuns,
              bullpenRunsAllowed: r.bullpenRuns,
              rotationLeagueAvgRuns: globalAvgRotationRuns,
              bullpenLeagueAvgRuns: globalAvgBullpenRuns,
              rotationRunsSaved: globalAvgRotationRuns - r.rotationRuns,
              bullpenRunsSaved: globalAvgBullpenRuns - r.bullpenRuns,
              rotationWar: r.rotationWar,
              bullpenWar: r.bullpenWar,
              rotation: r.group.rotation,
              bullpen: r.group.bullpen,
              lineup,
              bench,
              lineupWar,
              benchWar,
              totalWar,
              runsScored,
              totalRunsAllowed
          };
      });

      return results;
  }

  async getTeamRatings(year: number): Promise<TeamRatingResult[]> {
    const currentYear = await dateService.getCurrentYear();
    const isHistoricalYear = year < currentYear;

    const pitchingStatsPromise = isHistoricalYear
      ? trueRatingsService.getTruePitchingStatsByTeam(year)
      : trueRatingsService.getTruePitchingStats(year);
    const combinedPitchingStatsPromise = isHistoricalYear
      ? trueRatingsService.getTruePitchingStats(year)
      : pitchingStatsPromise;

    // 1. Fetch Data
    const [pitchingStats, leagueStats, scoutingFallback, multiYearStats, allTeams, combinedPitchingStats] = await Promise.all([
      pitchingStatsPromise,
      leagueStatsService.getLeagueStats(year),
      scoutingDataFallbackService.getScoutingRatingsWithFallback(year),
      trueRatingsService.getMultiYearPitchingStats(year, 3),
      teamService.getAllTeams(),
      combinedPitchingStatsPromise
    ]);
    const scoutingRatings = scoutingFallback.ratings;

    // Note: getLeagueAverages removed from promise all since it wasn't being used directly in inputs anymore?
    // Wait, TrueRatingsCalculationService needs leagueAverages.
    // Let's re-add it to be safe and match original logic.
    const leagueAverages = await trueRatingsService.getLeagueAverages(year);

    // 2. Maps for lookup
    const teamMap = new Map(allTeams.map(t => [t.id, t]));
    const scoutingMap = new Map<number, PitcherScoutingRatings>();
    const scoutingByName = new Map<string, PitcherScoutingRatings[]>();

    scoutingRatings.forEach(s => {
      if (s.playerId > 0) scoutingMap.set(s.playerId, s);
      if (s.playerName) {
        const norm = this.normalizeName(s.playerName);
        if (norm) {
             const list = scoutingByName.get(norm) ?? [];
             list.push(s);
             scoutingByName.set(norm, list);
        }
      }
    });

    // 3. Prepare Input for TR Calculation
    const inputs = combinedPitchingStats.map(stat => {
        let scouting = scoutingMap.get(stat.player_id);
        if (!scouting && stat.playerName) {
            const norm = this.normalizeName(stat.playerName);
            const matches = scoutingByName.get(norm);
            if (matches && matches.length === 1) scouting = matches[0];
        }

        return {
            playerId: stat.player_id,
            playerName: stat.playerName,
            yearlyStats: multiYearStats.get(stat.player_id) ?? [],
            scoutingRatings: scouting
        };
    });

    // 4. Calculate True Ratings
    const trResults = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages);
    const trMap = new Map(trResults.map(tr => [tr.playerId, tr]));
    const fipLikeValues = trResults.map(tr => tr.fipLike).sort((a, b) => a - b);

    const percentileForFipLike = (fipLike: number): number => {
        if (fipLikeValues.length === 0) return 50;
        let lower = 0;
        while (lower < fipLikeValues.length && fipLikeValues[lower] < fipLike) lower++;
        let upper = lower;
        while (upper < fipLikeValues.length && fipLikeValues[upper] === fipLike) upper++;
        const avgRank = (lower + upper + 2) / 2;
        const n = fipLikeValues.length + 1;
        return Math.round(((n - avgRank + 0.5) / n) * 1000) / 10;
    };

    // 5. Process Players & Classify
    const teamGroups = new Map<number, { rotation: RatedPlayer[], bullpen: RatedPlayer[] }>();

    pitchingStats.forEach(stat => {
        const rawTeamId = stat.team_id;
        if (rawTeamId === 0) return;
        const teamEntry = teamMap.get(rawTeamId);
        const teamId = teamEntry?.parentTeamId ? teamEntry.parentTeamId : rawTeamId;
        if (teamId === 0) return;

        const trData = trMap.get(stat.player_id);

        // Stats parsing
        const ip = trueRatingsService.parseIp(stat.ip);
        const k9 = ip > 0 ? (stat.k / ip) * 9 : 0;
        const bb9 = ip > 0 ? (stat.bb / ip) * 9 : 0;
        const hr9 = ip > 0 ? (stat.hra / ip) * 9 : 0;
        const era = ip > 0 ? (stat.er / ip) * 9 : 0;
        const fip = fipWarService.calculateFip({ ip, k9, bb9, hr9 }, leagueStats.fipConstant);

        const fallback =
            !trData && isHistoricalYear
                ? (() => {
                      const fipLike = trueRatingsCalculationService.calculateFipLike(k9, bb9, hr9);
                      const percentile = percentileForFipLike(fipLike);
                      return {
                          trueRating: trueRatingsCalculationService.percentileToRating(percentile),
                          estimatedStuff: RatingEstimatorService.estimateStuff(k9, ip).rating,
                          estimatedControl: RatingEstimatorService.estimateControl(bb9, ip).rating,
                          estimatedHra: RatingEstimatorService.estimateHRA(hr9, ip).rating
                      };
                  })()
                : null;

        if (!trData && !fallback) return;

        // Get scouting for pitch count
        let scouting = scoutingMap.get(stat.player_id);
        if (!scouting && stat.playerName) {
            const norm = this.normalizeName(stat.playerName);
            const matches = scoutingByName.get(norm);
            if (matches && matches.length === 1) scouting = matches[0];
        }

        const pitches = scouting?.pitches ?? {};
        const allPitchCount = Object.keys(pitches).length;
        const usablePitchCount = Object.values(pitches).filter(rating => rating >= 45).length;

        // Classification Logic
        // Priority 1: Check multi-year GS history (most reliable)
        const historicalStats = multiYearStats.get(stat.player_id) ?? [];
        const totalGs = historicalStats.reduce((sum, s) => sum + (s.gs ?? 0), 0);
        const hasStarterHistory = totalGs >= 5;

        // Priority 2: Check current year stats
        const hasStarterRole = stat.gs >= 5;

        // Priority 3: Check scouting profile (usable pitches + stamina)
        const stamina = scouting?.stamina ?? 0;
        const hasStarterProfile = usablePitchCount >= 3 && stamina >= 30;

        // Classify as SP if they have starter history OR current starter role OR clear starter profile
        // BUT require at least some evidence (not just 3 weak pitches)
        let isSp = false;
        let classificationReason = 'RP (default)';

        if (isHistoricalYear) {
            if (hasStarterRole) {
                isSp = true;
                classificationReason = `SP (${stat.gs} GS this year)`;
            } else {
                classificationReason = `RP (${stat.gs} GS this year)`;
            }
        } else {
            if (hasStarterHistory || hasStarterRole) {
                // Stats say starter
                isSp = true;
                classificationReason = hasStarterHistory
                    ? `SP (${totalGs} total GS in last 3 years)`
                    : `SP (${stat.gs} GS this year)`;
            } else if (hasStarterProfile && allPitchCount > 0) {
                // Scouting says starter (only if we have actual scouting data)
                isSp = true;
                classificationReason = `SP (${usablePitchCount} pitches, ${stamina} stam)`;
            } else if (allPitchCount === 0 && stat.gs >= 1) {
                // Fallback: No scouting data, but started some games this year
                isSp = true;
                classificationReason = `SP (${stat.gs} GS, no scouting)`;
            } else {
                classificationReason = `RP (${usablePitchCount}/${allPitchCount} pitches, ${stamina} stam, ${totalGs} GS)`;
            }
        }

        // Debug logging for high-rated relievers in rotations
        if (isSp && (stat.playerName.includes('DEBUG') || Math.random() < 0.01)) {
            console.log(`[Team Ratings] ${stat.playerName}: ${classificationReason}`, {
                currentGS: stat.gs,
                totalGs,
                usablePitchCount,
                allPitchCount,
                stamina,
                historicalStats: historicalStats.map(s => ({ year: s.year, gs: s.gs, ip: s.ip }))
            });
        }

        const ratedPlayer: RatedPlayer = {
            playerId: stat.player_id,
            name: stat.playerName,
            trueRating: trData?.trueRating ?? fallback?.trueRating ?? 0.5,
            trueStuff: trData?.estimatedStuff ?? fallback?.estimatedStuff ?? 20,
            trueControl: trData?.estimatedControl ?? fallback?.estimatedControl ?? 20,
            trueHra: trData?.estimatedHra ?? fallback?.estimatedHra ?? 20,
            pitchCount: usablePitchCount,
            isSp,
            stats: {
                ip, k9, bb9, hr9, gs: stat.gs,
                era, fip,
                war: stat.war
            }
        };

        if (!teamGroups.has(teamId)) {
            teamGroups.set(teamId, { rotation: [], bullpen: [] });
        }
        const group = teamGroups.get(teamId)!;
        if (isSp) {
            group.rotation.push(ratedPlayer);
        } else {
            group.bullpen.push(ratedPlayer);
        }
    });

    // 6. Aggregate per Team (Two-Pass Approach)
    // Pass 1: Organize and Calculate League Baselines
    
    let totalRotationFipIp = 0;
    let totalRotationIp = 0;
    let totalBullpenFipIp = 0;
    let totalBullpenIp = 0;

    teamGroups.forEach((group, teamId) => {
        const team = teamMap.get(teamId);
        if (team && team.parentTeamId !== 0) return;

        // Sort Rotation (historical years prioritize actual usage)
        group.rotation.sort(isHistoricalYear
            ? (a, b) => (b.stats.gs - a.stats.gs) || (b.stats.ip - a.stats.ip) || (b.trueRating - a.trueRating)
            : (a, b) => b.trueRating - a.trueRating
        );

        // Handle Overflow
        if (group.rotation.length > 5) {
            const overflow = group.rotation.slice(5);
            group.bullpen.push(...overflow);
            group.rotation = group.rotation.slice(0, 5);
        }

        // Sort Bullpen
        group.bullpen.sort((a, b) => b.trueRating - a.trueRating);
        
        // Aggregate for Baseline Calculation
        const topRotation = group.rotation;
        const topBullpen = group.bullpen.slice(0, 5);

        topRotation.forEach(p => {
             if (p.stats.ip > 0) {
                 totalRotationFipIp += p.stats.fip * p.stats.ip;
                 totalRotationIp += p.stats.ip;
             }
        });

        topBullpen.forEach(p => {
             if (p.stats.ip > 0) {
                 totalBullpenFipIp += p.stats.fip * p.stats.ip;
                 totalBullpenIp += p.stats.ip;
             }
        });
    });

    const avgRotationFip = totalRotationIp > 0 ? totalRotationFipIp / totalRotationIp : leagueStats.avgFip;
    const avgBullpenFip = totalBullpenIp > 0 ? totalBullpenFipIp / totalBullpenIp : leagueStats.avgFip;

    // Pass 2: Calculate Runs Allowed & Zero-Sum Baseline
    const teamRunTotals: Array<{
        teamId: number;
        teamName: string;
        rotationRuns: number;
        bullpenRuns: number;
        rotationWar: number;
        bullpenWar: number;
        group: { rotation: RatedPlayer[]; bullpen: RatedPlayer[] };
    }> = [];

    let grandTotalRotationRuns = 0;
    let grandTotalBullpenRuns = 0;
    let count = 0;

    teamGroups.forEach((group, teamId) => {
        const team = teamMap.get(teamId);
        if (team && team.parentTeamId !== 0) return;

        const topRotation = group.rotation;
        const topBullpen = group.bullpen.slice(0, 5);

        // Use role-specific averages for replacement level
        const rotationRuns = this.calculateRunSummary(topRotation, avgRotationFip, 950);
        const bullpenRuns = this.calculateRunSummary(topBullpen, avgBullpenFip, 500);

        // Calculate Team WAR
        const rotationWar = topRotation.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);
        const bullpenWar = topBullpen.reduce((sum, p) => sum + (p.stats.war ?? 0), 0);

        grandTotalRotationRuns += rotationRuns.runsAllowed;
        grandTotalBullpenRuns += bullpenRuns.runsAllowed;
        count++;

        teamRunTotals.push({
            teamId,
            teamName: team ? team.nickname : `Team ${teamId}`,
            rotationRuns: rotationRuns.runsAllowed,
            bullpenRuns: bullpenRuns.runsAllowed,
            rotationWar,
            bullpenWar,
            group
        });
    });

    // Calculate the Global Average Runs (The "Zero Line" for Runs Saved)
    const globalAvgRotationRuns = count > 0 ? grandTotalRotationRuns / count : 0;
    const globalAvgBullpenRuns = count > 0 ? grandTotalBullpenRuns / count : 0;

    const results: TeamRatingResult[] = teamRunTotals.map(r => {
        return {
            teamId: r.teamId,
            teamName: r.teamName,
            seasonYear: year,
            rotationRunsAllowed: r.rotationRuns,
            bullpenRunsAllowed: r.bullpenRuns,
            rotationLeagueAvgRuns: globalAvgRotationRuns,
            bullpenLeagueAvgRuns: globalAvgBullpenRuns,
            rotationRunsSaved: globalAvgRotationRuns - r.rotationRuns,
            bullpenRunsSaved: globalAvgBullpenRuns - r.bullpenRuns,
            rotationWar: r.rotationWar,
            bullpenWar: r.bullpenWar,
            rotation: r.group.rotation,
            bullpen: r.group.bullpen
        };
    });

    return results;
  }

  async getAllTimeTeamRatings(years: number[]): Promise<TeamRatingResult[]> {
    const results: TeamRatingResult[] = [];
    for (const year of years) {
      try {
        const yearly = await this.getTeamRatings(year);
        results.push(...yearly);
      } catch (error) {
        console.warn(`TeamRatings: failed to load year ${year}`, error);
      }
    }
    return results;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }

  private calculateRunSummary(players: RatedPlayer[], leagueAvgFip: number, targetIp: number): { runsAllowed: number; leagueAvgRuns: number; runsSaved: number } {
    let totalIp = players.reduce((sum, player) => sum + (Number.isFinite(player.stats.ip) ? player.stats.ip : 0), 0);
    
    // Calculate raw runs allowed from the players we have
    let runsAllowed = players.reduce((sum, player) => {
      if (!Number.isFinite(player.stats.fip) || !Number.isFinite(player.stats.ip)) return sum;
      return sum + this.calculateRunsAllowed(player.stats.fip, player.stats.ip);
    }, 0);

    // If total IP is less than target, fill with Replacement Level (League Avg FIP + 1.00)
    // This penalizes teams with shallow depth / low projections
    if (totalIp < targetIp) {
        const missingIp = targetIp - totalIp;
        const replacementFip = leagueAvgFip + 1.00;
        const replacementRuns = this.calculateRunsAllowed(replacementFip, missingIp);
        
        runsAllowed += replacementRuns;
        totalIp = targetIp; // Normalize total IP to target for league average calc
    } else if (totalIp > targetIp) {
        // Normalize to targetIp to prevent volume punishment/reward distortion in rankings
        // We only want to measure the *quality* of the rotation over a standard season duration
        // otherwise, a team pitching 1000 innings at a 4.00 FIP looks "worse" (more runs allowed)
        // than a team pitching 950 innings at a 4.00 FIP, despite being identical in quality.
        const ratio = targetIp / totalIp;
        runsAllowed = runsAllowed * ratio;
        totalIp = targetIp;
    }

    // League Average Benchmark uses the TARGET IP (normalized)
    const leagueAvgRuns = this.calculateRunsAllowed(leagueAvgFip, totalIp);
    
    return {
      runsAllowed,
      leagueAvgRuns,
      runsSaved: leagueAvgRuns - runsAllowed,
    };
  }

  private calculateRunsAllowed(fip: number, ip: number): number {
    if (!Number.isFinite(fip) || !Number.isFinite(ip) || ip <= 0) return 0;
    return (fip * ip) / 9;
  }
}

export const teamRatingsService = new TeamRatingsService();
