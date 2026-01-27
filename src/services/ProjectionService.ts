import { playerService } from './PlayerService';
import { trueRatingsService, TruePlayerStats } from './TrueRatingsService';
import { scoutingDataService } from './ScoutingDataService';
import { dateService } from './DateService';
import { trueRatingsCalculationService, YearlyPitchingStats } from './TrueRatingsCalculationService';
import { agingService } from './AgingService';
import { PotentialStatsService } from './PotentialStatsService';
import { leagueStatsService, LeagueStats } from './LeagueStatsService';
import { PitcherScoutingRatings } from '../models/ScoutingData';
import { teamService } from './TeamService';
import { minorLeagueStatsService } from './MinorLeagueStatsService';
import { ensembleProjectionService } from './EnsembleProjectionService';

export interface ProjectedPlayer {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
  age: number;
  currentTrueRating: number;
  currentPercentile?: number;
  projectedTrueRating: number;
  projectedStats: {
    k9: number;
    bb9: number;
    hr9: number;
    fip: number;
    war: number;
    ip: number; // Default projection IP (e.g. 150 for SP, 60 for RP)
  };
  projectedRatings: {
    stuff: number;
    control: number;
    hra: number;
  };
  /** Role classification (true = starter, false = reliever) */
  isSp: boolean;
  /** Flag indicating this is a prospect without MLB stats */
  isProspect?: boolean;
}

export interface ProjectionContext {
  projections: ProjectedPlayer[];
  statsYear: number;
  usedFallbackStats: boolean;
  totalCurrentIp: number;
}

const PERCENTILE_TO_RATING: Array<{ threshold: number; rating: number }> = [
  { threshold: 97.7, rating: 5.0 },
  { threshold: 93.3, rating: 4.5 },
  { threshold: 84.1, rating: 4.0 },
  { threshold: 69.1, rating: 3.5 },
  { threshold: 50.0, rating: 3.0 },
  { threshold: 30.9, rating: 2.5 },
  { threshold: 15.9, rating: 2.0 },
  { threshold: 6.7, rating: 1.5 },
  { threshold: 2.3, rating: 1.0 },
  { threshold: 0.0, rating: 0.5 },
];

const LEAGUE_START_YEAR = 2000;

class ProjectionService {
  // League IP distribution for percentile-based projections
  private spStaminaDistribution: number[] = [];
  private spIpDistribution: number[] = [];
  private spMaxIp: number = 240; // Max IP from distribution, default to reasonable cap

  private percentileToRating(percentile: number): number {
    for (const { threshold, rating } of PERCENTILE_TO_RATING) {
      if (percentile >= threshold) {
        return rating;
      }
    }
    return 0.5;
  }

  async getProjections(year: number, options?: { forceRosterRefresh?: boolean; useEnsemble?: boolean }): Promise<ProjectedPlayer[]> {
    const context = await this.getProjectionsWithContext(year, options);
    return context.projections;
  }

  async getProjectionsWithContext(year: number, options?: { forceRosterRefresh?: boolean; useEnsemble?: boolean }): Promise<ProjectionContext> {
    // 1. Fetch Data
    const forceRosterRefresh = options?.forceRosterRefresh ?? false;
    const useEnsemble = options?.useEnsemble ?? true; // DEFAULT: Use ensemble (calibrated Jan 2026)
    const [scoutingRatings, allPlayers, allTeams] = await Promise.all([
      scoutingDataService.getLatestScoutingRatings('my'),
      playerService.getAllPlayers(forceRosterRefresh),
      teamService.getAllTeams()
    ]);

    const currentYearStats = await this.safeGetPitchingStats(year);

    const totalCurrentIp = currentYearStats.reduce((sum, stat) => sum + trueRatingsService.parseIp(stat.ip), 0);

    // Check if we have meaningful starter workloads (anyone with 10+ GS indicates mid-season or later)
    const hasStarterWorkloads = currentYearStats.some(stat => stat.gs >= 10);
    console.log(`[IP Distribution Setup] Year=${year}, totalCurrentIp=${totalCurrentIp}, hasStarterWorkloads=${hasStarterWorkloads}`);

    let statsYear = year;
    let usedFallbackStats = false;
    let pitchingStats = currentYearStats;

    if (totalCurrentIp <= 0 && year > LEAGUE_START_YEAR) {
      statsYear = year - 1;
      usedFallbackStats = true;
      pitchingStats = await this.safeGetPitchingStats(statsYear);
    }

    // Build league IP distribution for percentile-based projections
    // Use previous year's stats if current season doesn't have meaningful starter workloads yet
    const distributionYear = !hasStarterWorkloads && year > LEAGUE_START_YEAR ? year - 1 : year;
    console.log(`[IP Distribution Setup] distributionYear=${distributionYear}, willFetchNew=${distributionYear !== year}`);
    const distributionStats = distributionYear !== year
      ? await this.safeGetPitchingStats(distributionYear)
      : currentYearStats;
    console.log(`[IP Distribution Setup] Fetched ${distributionStats.length} stats for distribution`);
    this.buildLeagueIpDistribution(distributionStats, scoutingRatings, distributionYear);

    const multiYearEndYear = usedFallbackStats ? statsYear : year;
    const [leagueAverages, leagueStats, multiYearStats] = await Promise.all([
      this.getLeagueAveragesSafe(statsYear),
      this.getLeagueStatsSafe(statsYear),
      this.getMultiYearStatsSafe(multiYearEndYear, 3)
    ]);

    // 2. Maps
    const playerMap = new Map(allPlayers.map(p => [p.id, p]));
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

    const statsMap = new Map(pitchingStats.map(stat => [stat.player_id, stat]));

    // Fetch Minor League Stats for Readiness Check
    const [aaaStats, aaStats] = await Promise.all([
      minorLeagueStatsService.getStats(statsYear, 'aaa'),
      minorLeagueStatsService.getStats(statsYear, 'aa')
    ]);
    const aaaOrAaPlayerIds = new Set<number>([
        ...aaaStats.map(s => s.id),
        ...aaStats.map(s => s.id)
    ]);

    // 3. Prepare TR Inputs
    const playerIds = new Set<number>();
    multiYearStats.forEach((_stats, playerId) => {
      playerIds.add(playerId);
    });
    pitchingStats.forEach(stat => playerIds.add(stat.player_id));

    const inputs = Array.from(playerIds).map(playerId => {
        const stat = statsMap.get(playerId);
        const player = playerMap.get(playerId);
        const playerName = stat?.playerName
          ?? (player ? `${player.firstName} ${player.lastName}` : 'Unknown Player');
        let scouting = scoutingMap.get(playerId);
        if (!scouting && playerName) {
            const norm = this.normalizeName(playerName);
            const matches = scoutingByName.get(norm);
            if (matches && matches.length === 1) scouting = matches[0];
        }

        return {
            playerId,
            playerName,
            yearlyStats: multiYearStats.get(playerId) ?? [],
            scoutingRatings: scouting
        };
    }).filter(input => input.yearlyStats.length > 0 || input.scoutingRatings);

    // 4. Calculate Current True Ratings
    const trResults = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages);

    // 5. Generate Projections
    const tempProjections: any[] = []; // Temporary array to hold data before ranking
    const currentYear = await dateService.getCurrentYear();

    for (const tr of trResults) {
        const player = playerMap.get(tr.playerId);
        if (!player) continue;

        const ageInYear = this.calculateAgeAtYear(player, currentYear, statsYear);
        const currentStats = statsMap.get(tr.playerId);
        const yearlyStats = multiYearStats.get(tr.playerId);

        // --- READINESS CHECK ---
        // ... (keep logic) ...
        const hasRecentMlb = (currentStats && trueRatingsService.parseIp(currentStats.ip) > 0) ||
            (yearlyStats && yearlyStats.some(y => y.year === statsYear - 1 && y.ip > 0));

        let isMlbReady = hasRecentMlb;

        let scouting = scoutingMap.get(tr.playerId);
        if (!scouting && tr.playerName) {
             const norm = this.normalizeName(tr.playerName);
             const matches = scoutingByName.get(norm);
             if (matches && matches.length === 1) scouting = matches[0];
        }

        // Debug prospect scouting data - log first 3 prospects
        //if (!hasRecentMlb && scouting && tempProjections.length < 3 && console && typeof console.log === 'function') {
            console.log(`[Scouting Data Check] Player ${tr.playerId} (${tr.playerName}) scouting:`, scouting);
            const pitchCount = scouting?.pitches ? Object.keys(scouting?.pitches).length : 0;
            console.log(`[Scouting Data Check] Has ${pitchCount} pitches:`, scouting?.pitches);
        //}

        if (!isMlbReady) {
            // ... (keep logic) ...
            const isUpperMinors = aaaOrAaPlayerIds.has(tr.playerId);
            const ovr = scouting?.ovr ?? 20;
            const pot = scouting?.pot ?? 20;
            const starGap = pot - ovr;
            const isQualityProspect = (ovr >= 45) || (starGap <= 1.0 && pot >= 45);
            
            if (isUpperMinors && (isQualityProspect || tr.trueRating >= 2.0)) {
                isMlbReady = true;
            }
            if (ovr >= 50) isMlbReady = true;
        }

        if (!isMlbReady) continue;
        // -----------------------

        // For projections, prefer current roster mapping from players endpoint.
        // Fall back to stats team_id only if current team is unknown (0).
        const teamId = player.teamId || currentStats?.team_id || 0;
        const team = teamMap.get(teamId);
        const ipResult = this.calculateProjectedIp(scouting, currentStats, yearlyStats, ageInYear + 1, player.role, tr.trueRating, hasRecentMlb);

        const currentRatings = {
            stuff: tr.estimatedStuff,
            control: tr.estimatedControl,
            hra: tr.estimatedHra
        };

        const leagueContext = {
            fipConstant: leagueStats.fipConstant,
            avgFip: leagueStats.avgFip,
            runsPerWin: 8.5
        };

        let projectedK9: number, projectedBb9: number, projectedHr9: number, projectedFip: number, projectedWar: number;
        let projectedRatings: { stuff: number; control: number; hra: number };
        let ensembleMetadata: any = undefined;

        if (useEnsemble) {
            // ENSEMBLE PROJECTION (default as of Jan 2026)
            const ensemble = ensembleProjectionService.calculateEnsemble({
                currentRatings,
                age: ageInYear,
                yearlyStats,
                leagueContext
            });

            projectedK9 = ensemble.k9;
            projectedBb9 = ensemble.bb9;
            projectedHr9 = ensemble.hr9;
            projectedFip = ensemble.fip;

            // Calculate WAR from projected stats (using same FIP calculation as before)
            const potStats = PotentialStatsService.calculatePitchingStats(
                { stuff: currentRatings.stuff, control: currentRatings.control, hra: currentRatings.hra, movement: 50, babip: 50 },
                ipResult.ip,
                leagueContext
            );
            projectedWar = potStats.war; // Use existing WAR calculation

            // Store projected ratings (for display purposes, derive from ensemble stats)
            // Since ensemble works on stats, not ratings, we approximate the ratings
            projectedRatings = agingService.applyAging(currentRatings, ageInYear);

            // Store metadata for future UI enhancements
            ensembleMetadata = ensemble.metadata;

        } else {
            // EXISTING: Single-model projection (unchanged)
            projectedRatings = agingService.applyAging(currentRatings, ageInYear);

            const potStats = PotentialStatsService.calculatePitchingStats(
                { ...projectedRatings, movement: 50, babip: 50 },
                ipResult.ip,
                leagueContext
            );

            projectedK9 = potStats.k9;
            projectedBb9 = potStats.bb9;
            projectedHr9 = potStats.hr9;
            projectedFip = potStats.fip;
            projectedWar = potStats.war;
        }

        // Calculate FIP-like for ranking (same metric as True Ratings)
        const fipLike = trueRatingsCalculationService.calculateFipLike(projectedK9, projectedBb9, projectedHr9);

        tempProjections.push({
            playerId: tr.playerId,
            name: tr.playerName,
            teamId,
            teamName: team ? team.nickname : 'FA',
            age: ageInYear + 1, // Show historical projected age
            currentTrueRating: tr.trueRating,
            currentPercentile: tr.percentile,
            projectedStats: {
                k9: projectedK9,
                bb9: projectedBb9,
                hr9: projectedHr9,
                fip: projectedFip,
                war: projectedWar,
                ip: ipResult.ip
            },
            projectedRatings,
            isSp: ipResult.isSp,
            fipLike, // Temporary for ranking
            projectedTrueRating: 0, // Placeholder
            isProspect: !hasRecentMlb,
            ...(ensembleMetadata && { __ensembleMeta: ensembleMetadata }) // Store ensemble metadata if available
        });
    }

    // 6. Calculate Projected True Ratings via Percentiles
    // Reuse logic from TrueRatingsCalculationService
    // Sort by fipLike ascending (lower is better)
    tempProjections.sort((a, b) => a.fipLike - b.fipLike);

    const ranks = new Map<number, number>();
    let i = 0;
    while (i < tempProjections.length) {
      const currentFip = tempProjections[i].fipLike;
      let j = i;
      while (j < tempProjections.length && tempProjections[j].fipLike === currentFip) {
        j++;
      }
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) {
        ranks.set(tempProjections[k].playerId, avgRank);
      }
      i = j;
    }

    const n = tempProjections.length;
    const projections: ProjectedPlayer[] = tempProjections.map(p => {
      const rank = ranks.get(p.playerId) || n;
      const percentile = Math.round(((n - rank + 0.5) / n) * 1000) / 10;
      const rating = this.percentileToRating(percentile);
      
      if (typeof rating === 'undefined') {
          console.warn('Undefined rating for percentile:', percentile, p);
      }

      return {
          ...p,
          projectedTrueRating: rating
      };
    });

    return {
      projections: projections.sort((a, b) => a.projectedStats.fip - b.projectedStats.fip),
      statsYear,
      usedFallbackStats,
      totalCurrentIp
    };
  }

  /**
   * Project stats for a single player based on current estimated ratings
   */
  async calculateProjection(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    pitchCount: number = 0,
    gs: number = 0,
    leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number },
    stamina?: number,
    injuryProneness?: string,
    historicalStats?: YearlyPitchingStats[],
    trueRating: number = 0,
    pitchRatings?: Record<string, number>
  ): Promise<{
    projectedStats: { k9: number; bb9: number; hr9: number; fip: number; war: number; ip: number };
    projectedRatings: { stuff: number; control: number; hra: number };
  }> {
    // Ensure distributions are loaded (for percentile-based IP projections)
    if (this.spStaminaDistribution.length === 0 || this.spIpDistribution.length === 0) {
      await this.ensureDistributionsLoaded();
    }

    // Apply aging to get projected ratings first
    const projectedRatings = agingService.applyAging(currentRatings, age);

    // Calculate quick FIP estimate for skill-based IP modifier (using dummy 150 IP)
    const tempStats = PotentialStatsService.calculatePitchingStats(
        { ...projectedRatings, movement: 50, babip: 50 },
        150, // dummy IP
        leagueContext
    );
    const estimatedFip = tempStats.fip;

    // Construct dummy scouting object for IP calc
    const dummyScouting: Partial<PitcherScoutingRatings> = {
        stamina,
        injuryProneness,
        // Use actual pitch ratings if provided, otherwise fall back to dummy values
        pitches: pitchRatings || (pitchCount > 0 ? { 'Fastball': 50, 'Curveball': 50, 'Changeup': 50 } : undefined)
    };

    // If using fallback pitches and pitchCount < 3, trim
    if (!pitchRatings && pitchCount < 3 && dummyScouting.pitches) {
         const keys = Object.keys(dummyScouting.pitches);
         while (Object.keys(dummyScouting.pitches).length > pitchCount) {
             delete dummyScouting.pitches[keys.pop()!];
         }
    }

    const dummyStats: Partial<TruePlayerStats> | undefined = gs > 0 ? { gs } : undefined;

    // Infer if player has MLB experience from historical stats
    const totalHistoricalIp = historicalStats?.reduce((sum, s) => sum + s.ip, 0) ?? 0;
    const hasRecentMlb = totalHistoricalIp > 20 || gs > 0;

    const ipResult = this.calculateProjectedIp(
        dummyScouting as PitcherScoutingRatings,
        dummyStats as TruePlayerStats,
        historicalStats,
        age + 1,
        0, // role
        trueRating,
        hasRecentMlb,
        estimatedFip
    );

    // Calculate Stats (projectedRatings already calculated earlier)
    const potStats = PotentialStatsService.calculatePitchingStats(
        { ...projectedRatings, movement: 50, babip: 50 },
        ipResult.ip,
        leagueContext
    );

    return {
        projectedStats: {
            k9: potStats.k9,
            bb9: potStats.bb9,
            hr9: potStats.hr9,
            fip: potStats.fip,
            war: potStats.war,
            ip: ipResult.ip
        },
        projectedRatings
    };
  }

  /**
   * Calculate player age in a specific year based on current age.
   * birthYear = currentYear - currentAge
   * ageInYear = targetYear - birthYear
   */
  public calculateAgeAtYear(player: { age: number }, currentYear: number, targetYear: number): number {
      const birthYear = currentYear - player.age;
      return targetYear - birthYear;
  }

  /**
   * Ensure distributions are loaded (lazy-load if needed)
   */
  private async ensureDistributionsLoaded(): Promise<void> {
    if (this.spStaminaDistribution.length > 0 && this.spIpDistribution.length > 0) {
      return; // Already loaded
    }

    try {
      const currentYear = await dateService.getCurrentYear();
      const currentYearStats = await this.safeGetPitchingStats(currentYear);
      const scoutingRatings = await scoutingDataService.getLatestScoutingRatings('my');

      // Use previous year's stats if current season doesn't have meaningful starter workloads yet
      const hasStarterWorkloads = currentYearStats.some(stat => stat.gs >= 10);
      const distributionYear = !hasStarterWorkloads && currentYear > LEAGUE_START_YEAR ? currentYear - 1 : currentYear;
      const distributionStats = distributionYear !== currentYear
        ? await this.safeGetPitchingStats(distributionYear)
        : currentYearStats;

      this.buildLeagueIpDistribution(distributionStats, scoutingRatings, distributionYear);
    } catch (error) {
      console.warn('[IP Distribution] Failed to load distributions:', error);
      // Distributions will remain empty, fallback to formula-based approach
    }
  }

  /**
   * Build league IP and stamina distributions for percentile-based projections.
   * Separates SP from RP based on GS.
   */
  private buildLeagueIpDistribution(
    stats: TruePlayerStats[],
    scoutingRatings: PitcherScoutingRatings[],
    year?: number
  ): void {
    const spIps: number[] = [];
    const spStaminas: number[] = [];

    const yearInfo = year ? ` from ${year}` : '';
    console.log(`[IP Distribution] Building${yearInfo} with ${stats.length} stats, ${scoutingRatings.length} scouting ratings`);

    // Debug: Check what years are in the stats
    if (stats.length > 0) {
      const years = new Set(stats.map(s => s.year));
      console.log(`[IP Distribution] Stats years in data:`, Array.from(years).sort());
      const totalIp = stats.reduce((sum, s) => sum + trueRatingsService.parseIp(s.ip), 0);
      console.log(`[IP Distribution] Total IP in stats: ${totalIp.toFixed(1)}`);
    }

    // Build scouting map for quick lookups
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

    // Collect SP IP distribution (players with 29+ GS - full season starters)
    // Use 29+ GS to capture peak workload, excluding spot starters and injury-shortened seasons
    let gsCount = 0;
    let gsFullSeasonCount = 0;
    let ipCount = 0;
    const MIN_GS_FOR_PEAK = 29;

    stats.forEach(stat => {
      if (typeof stat.gs === 'number') gsCount++;
      if (stat.gs >= MIN_GS_FOR_PEAK) {
        gsFullSeasonCount++;
        const ip = trueRatingsService.parseIp(stat.ip);
        if (ip > 0) {
          ipCount++;
          spIps.push(ip);
        }
      }
    });

    console.log(`[IP Distribution] Stats analysis: ${stats.length} total, ${gsCount} with GS field, ${gsFullSeasonCount} with GS>=${MIN_GS_FOR_PEAK}, ${ipCount} with GS>=${MIN_GS_FOR_PEAK} and IP>0`);
    console.log(`[IP Distribution] Sample stat:`, stats[0]);
    console.log(`[IP Distribution] Found ${spIps.length} SP with ${MIN_GS_FOR_PEAK}+ GS (full season starters)`);

    // Collect SP stamina distribution from scouting
    scoutingRatings.forEach(s => {
      const pitches = s.pitches ?? {};
      const usablePitches = Object.values(pitches).filter(r => r > 25).length;
      const stam = s.stamina ?? 0;

      // Consider as SP if they have 3+ pitches and stamina >= 35
      if (usablePitches >= 3 && stam >= 35) {
        spStaminas.push(stam);
      }
    });

    console.log(`[IP Distribution] Found ${spStaminas.length} SP prospects with 3+ pitches & stam >= 35`);

    // Sort for percentile calculations
    this.spIpDistribution = spIps.sort((a, b) => a - b);
    this.spStaminaDistribution = spStaminas.sort((a, b) => a - b);

    // Capture max IP for capping projections at 105% of historical max
    if (this.spIpDistribution.length > 0) {
      this.spMaxIp = this.spIpDistribution[this.spIpDistribution.length - 1];
      const ipCap = Math.round(this.spMaxIp * 1.05);
      console.log(`[IP Distribution] IP range: ${this.spIpDistribution[0]} to ${this.spMaxIp} (cap: ${ipCap})`);
    }
    if (this.spStaminaDistribution.length > 0) {
      console.log(`[IP Distribution] Stamina range: ${this.spStaminaDistribution[0]} to ${this.spStaminaDistribution[this.spStaminaDistribution.length - 1]}`);
    }
  }

  /**
   * Get percentile rank for a value in a sorted distribution.
   * Returns 0-100.
   */
  private getPercentile(value: number, distribution: number[]): number {
    if (distribution.length === 0) return 50; // Default to median

    let rank = 0;
    for (const val of distribution) {
      if (val < value) rank++;
      else break;
    }

    return (rank / distribution.length) * 100;
  }

  /**
   * Get value at a specific percentile in a sorted distribution.
   */
  private getValueAtPercentile(percentile: number, distribution: number[]): number {
    if (distribution.length === 0) return 0;

    const index = Math.floor((percentile / 100) * distribution.length);
    const clampedIndex = Math.max(0, Math.min(distribution.length - 1, index));
    return distribution[clampedIndex];
  }

  private calculateProjectedIp(
    scouting: PitcherScoutingRatings | undefined,
    currentStats: TruePlayerStats | undefined,
    historicalStats: YearlyPitchingStats[] | undefined,
    age: number,
    playerRole: number = 0,
    trueRating: number = 0,
    hasRecentMlb: boolean = true,
    projectedFip?: number
  ): { ip: number; isSp: boolean } {
    // 1. Determine Role (SP vs RP)
    let isSp = false;

    // Heuristic 1: Profile (User Priority)
    // 3+ Pitches (> 25) AND Stamina >= 35
    // Count pitches > 25 as "real" pitches (not just organizational filler)
    // For prospects without MLB track record, don't require proven performance
    // For established players, require TR >= 2.0 to be considered a starter
    let meetsProfile = false;
    if (scouting) {
        const pitches = scouting.pitches ?? {};
        const pitchValues = Object.values(pitches);
        const usablePitches = pitchValues.filter(r => r > 25).length;
        const stam = scouting.stamina ?? 0;

        // Debug logging for role classification
        if (console && typeof console.log === 'function') {
            console.log(`[Role Check] usablePitches=${usablePitches}, stamina=${stam}, hasRecentMlb=${hasRecentMlb}, trueRating=${trueRating.toFixed(2)}, isSp=${meetsProfile || playerRole === 11}`);
        }

        if (usablePitches >= 3 && stam >= 35) {
            // If prospect (no MLB experience), profile alone is enough
            // If established player, also require competent performance
            if (!hasRecentMlb || trueRating >= 2.0) {
                meetsProfile = true;
            }
        }
    } else if (!hasRecentMlb && console && typeof console.log === 'function') {
        console.log(`[Role Check] Prospect has NO scouting data`);
    }

    if (meetsProfile) {
        isSp = true;
    } else if (playerRole === 11) {
        // Heuristic 2: Explicit Role (SP)
        isSp = true;
    } else {
        // Heuristic 3: History (Fallback)
        // Check Stats first (GS >= 5)
        if (currentStats && currentStats.gs >= 5) {
            isSp = true;
        } else if (historicalStats && historicalStats.length > 0) {
            // Check most recent season with significant IP
            // Assuming historicalStats is sorted recent first.
            const recent = historicalStats.find(s => trueRatingsService.parseIp(s.ip) > 10);
            if (recent && recent.gs >= 5) {
                isSp = true;
            }
        }
    }

    // 2. Calculate Base IP using Percentile Approach
    const stamina = scouting?.stamina ?? (isSp ? 50 : 30);
    let baseIp: number;

    if (isSp && this.spStaminaDistribution.length > 0 && this.spIpDistribution.length > 0) {
        // Percentile-based approach for SP
        // Get this player's stamina percentile
        const staminaPercentile = this.getPercentile(stamina, this.spStaminaDistribution);

        // Map to IP at that percentile
        baseIp = this.getValueAtPercentile(staminaPercentile, this.spIpDistribution);

        // Debug logging
        if (console && typeof console.log === 'function') {
            console.log(`[IP Projection] Percentile approach: stamina=${stamina}, staminaPct=${staminaPercentile.toFixed(1)}%, baseIP=${baseIp}, isSp=${isSp}`);
        }

        // Floor for prospects with good stamina (prevents unreasonably low projections)
        if (baseIp < 100) baseIp = 100;
    } else {
        // Fallback to formula-based approach if distributions not available
        baseIp = isSp
            ? 100 + (stamina * 1.2) // 30->136, 80->196
            : 30 + (stamina * 0.6); // 20->42, 80->78

        // Clamp
        if (isSp) baseIp = Math.max(100, Math.min(240, baseIp));
        else baseIp = Math.max(30, Math.min(100, baseIp));

        if (console && typeof console.log === 'function') {
            console.log(`[IP Projection] Fallback approach: stamina=${stamina}, baseIP=${baseIp}, isSp=${isSp}, distSizes=[stam:${this.spStaminaDistribution.length}, ip:${this.spIpDistribution.length}]`);
        }
    }

    // 3. Injury Modifier
    const proneness = scouting?.injuryProneness?.toLowerCase() ?? 'normal';
    let injuryMod = 1.0;
    switch (proneness) {
        case 'iron man': injuryMod = 1.15; break;
        case 'durable': injuryMod = 1.08; break;
        case 'normal': injuryMod = 1.0; break;
        case 'fragile': injuryMod = 0.85; break;
        case 'wrecked': injuryMod = 0.65; break;
    }
    baseIp *= injuryMod;

    // 4. Skill Modifier (managers give more IP to better pitchers)
    // Scale IP based on projected skill level (FIP)
    // League average FIP is typically around 4.20
    let skillMod = 1.0;
    if (projectedFip !== undefined) {
        // Better pitchers (lower FIP) get more innings
        if (projectedFip <= 3.50) {
            skillMod = 1.20; // Elite
        } else if (projectedFip <= 4.00) {
            skillMod = 1.10; // Above average
        } else if (projectedFip <= 4.50) {
            skillMod = 1.0; // Average
        } else if (projectedFip <= 5.00) {
            skillMod = 0.90; // Below average
        } else {
            skillMod = 0.80; // Poor
        }
    }
    baseIp *= skillMod;

    // 5. Historical Blend (Durability Evidence)
    // For established players, blend with historical data
    const totalHistoricalIp = historicalStats?.reduce((sum, s) => sum + s.ip, 0) ?? 0;
    const isLimitedExperience = totalHistoricalIp > 0 && totalHistoricalIp < 80 && age < 28;
    const hasStarterProfile = isSp && stamina >= 50;

    // Use weighted average of last 3 years if available
    // Filter out incomplete seasons (< 50 IP for starters who normally throw 120+)
    if (historicalStats && historicalStats.length > 0) {
        // For established starters, exclude seasons with very low IP (likely incomplete/injured)
        const minIpThreshold = isSp ? 50 : 10;
        const completedSeasons = historicalStats.filter(s => s.ip >= minIpThreshold);

        if (console && typeof console.log === 'function' && completedSeasons.length < historicalStats.length) {
            const filtered = historicalStats.filter(s => s.ip < minIpThreshold);
            console.log(`[IP Projection] Filtered ${filtered.length} incomplete season(s): ${filtered.map(s => `${s.year}(${s.ip}IP)`).join(', ')}`);
        }

        let totalWeightedIp = 0;
        let totalWeight = 0;
        const weights = [5, 3, 2]; // Most recent year gets weight 5

        // Use only completed seasons for weighted average
        for (let i = 0; i < Math.min(completedSeasons.length, 3); i++) {
            const stat = completedSeasons[i];
            const weight = weights[i];
            totalWeightedIp += stat.ip * weight;
            totalWeight += weight;
        }

        if (totalWeight > 0) {
            let weightedIp = totalWeightedIp / totalWeight;

            // Breakout / Ramp-Up Detection
            // If the player just threw a full starter workload (>120 IP) and it was a massive jump
            // from the previous year (>1.5x), assume the recent year is the new baseline.
            const recentStats = completedSeasons[0];
            if (completedSeasons.length >= 2) {
                const previousStats = completedSeasons[1];
                if (recentStats.ip > 120 && recentStats.ip > previousStats.ip * 1.5) {
                    weightedIp = recentStats.ip;
                }
            }

            // Special case: Prospects/young players with limited MLB experience
            // Favor model-based projection heavily to avoid anchoring on small samples
            if (isLimitedExperience && hasStarterProfile) {
                // 85% model, 15% limited history
                baseIp = (baseIp * 0.85) + (weightedIp * 0.15);
            } else if (weightedIp > 50) {
                // Established players: trust history more (65% history, 35% model)
                baseIp = (baseIp * 0.35) + (weightedIp * 0.65);
            } else {
                // Low IP players: 50/50 blend
                baseIp = (baseIp * 0.50) + (weightedIp * 0.50);
            }
        }
    } else if (currentStats) {
        // Fallback to single year if no history array
        const rawIp = trueRatingsService.parseIp(currentStats.ip);
        if (rawIp > 0) {
            const isYoungStarterCallup = rawIp < 80 && age < 28 && hasStarterProfile;
            if (isYoungStarterCallup) {
                baseIp = (baseIp * 0.85) + (rawIp * 0.15);
            } else {
                baseIp = (baseIp * 0.50) + (rawIp * 0.50);
            }
        }
    }

    // 6. Age Cliff (The "Geriatric Penalty")
    if (age >= 46) {
        baseIp *= 0.10;
    } else if (age >= 43) {
        baseIp *= 0.40;
    } else if (age >= 40) {
        baseIp *= 0.75;
    }

    // Apply cap at 105% of historical max (prevent unrealistic projections)
    const ipCap = Math.round(this.spMaxIp * 1.05);
    const uncappedIp = baseIp;
    if (isSp && baseIp > ipCap) {
        baseIp = ipCap;
    }

    // Final debug logging
    if (console && typeof console.log === 'function') {
        const cappedNote = uncappedIp > ipCap ? ` (capped from ${Math.round(uncappedIp)})` : '';
        console.log(`[IP Projection] Final: ip=${Math.round(baseIp)}${cappedNote}, injuryMod=${injuryMod.toFixed(2)}, skillMod=${skillMod.toFixed(2)}, projectedFip=${projectedFip?.toFixed(2) ?? 'N/A'}, age=${age}`);
    }

    return { ip: Math.round(baseIp), isSp };
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }

  private async safeGetPitchingStats(year: number): Promise<TruePlayerStats[]> {
    try {
      return await trueRatingsService.getTruePitchingStats(year);
    } catch (error) {
      console.warn(`Projections: no pitching stats for ${year}`, error);
      return [];
    }
  }

  private async getLeagueAveragesSafe(year: number): Promise<{ avgK9: number; avgBb9: number; avgHr9: number }> {
    try {
      return await trueRatingsService.getLeagueAverages(year);
    } catch {
      return trueRatingsCalculationService.getDefaultLeagueAverages();
    }
  }

  private async getMultiYearStatsSafe(endYear: number, yearsBack: number): Promise<Map<number, import('./TrueRatingsCalculationService').YearlyPitchingStats[]>> {
    try {
      return await trueRatingsService.getMultiYearPitchingStats(endYear, yearsBack);
    } catch (error) {
      console.warn('Projections: multi-year stats unavailable', error);
      return new Map();
    }
  }

  private async getLeagueStatsSafe(year: number): Promise<LeagueStats> {
    try {
      const stats = await leagueStatsService.getLeagueStats(year);
      if (!Number.isFinite(stats.fipConstant) || !Number.isFinite(stats.avgFip)) {
        throw new Error('Invalid league stats');
      }
      return stats;
    } catch {
      if (year > LEAGUE_START_YEAR) {
        try {
          const fallback = await leagueStatsService.getLeagueStats(year - 1);
          if (Number.isFinite(fallback.fipConstant) && Number.isFinite(fallback.avgFip)) {
            return fallback;
          }
        } catch {}
      }
      return {
        fipConstant: 3.47,
        avgFip: 4.2,
        replacementFip: 4.2,
        era: 4.2,
        ip: 0,
        k: 0,
        bb: 0,
        hr: 0,
        er: 0
      };
    }
  }
}

export const projectionService = new ProjectionService();
