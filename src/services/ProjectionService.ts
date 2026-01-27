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

class ProjectionService {
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
    let statsYear = year;
    let usedFallbackStats = false;
    let pitchingStats = currentYearStats;

    if (totalCurrentIp <= 0 && year > 1900) {
      statsYear = year - 1;
      usedFallbackStats = true;
      pitchingStats = await this.safeGetPitchingStats(statsYear);
    }

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
    const aaaStats = minorLeagueStatsService.getStats(statsYear, 'aaa');
    const aaStats = minorLeagueStatsService.getStats(statsYear, 'aa');
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
        const ipResult = this.calculateProjectedIp(scouting, currentStats, yearlyStats, ageInYear + 1, player.role, tr.trueRating);

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
  calculateProjection(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    pitchCount: number = 0,
    gs: number = 0,
    leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number },
    stamina?: number,
    injuryProneness?: string,
    historicalStats?: YearlyPitchingStats[],
    trueRating: number = 0
  ): {
    projectedStats: { k9: number; bb9: number; hr9: number; fip: number; war: number; ip: number };
    projectedRatings: { stuff: number; control: number; hra: number };
  } {
    // Construct dummy scouting object for IP calc
    const dummyScouting: Partial<PitcherScoutingRatings> = {
        stamina,
        injuryProneness,
        pitches: pitchCount > 0 ? { 'Fastball': 50, 'Curveball': 50, 'Changeup': 50 } : undefined // Rough hack to simulate pitch count
    };
    
    // If pitchCount < 3, ensure we pass that
    if (pitchCount < 3 && dummyScouting.pitches) {
         // remove keys
         const keys = Object.keys(dummyScouting.pitches);
         while (Object.keys(dummyScouting.pitches).length > pitchCount) {
             delete dummyScouting.pitches[keys.pop()!];
         }
    }

    const dummyStats: Partial<TruePlayerStats> | undefined = gs > 0 ? { gs } : undefined;

    const ipResult = this.calculateProjectedIp(
        dummyScouting as PitcherScoutingRatings,
        dummyStats as TruePlayerStats,
        historicalStats,
        age + 1,
        0, // role
        trueRating
    );

    // Apply Aging
    const projectedRatings = agingService.applyAging(currentRatings, age);

    // Calculate Stats
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

  private calculateProjectedIp(
    scouting: PitcherScoutingRatings | undefined,
    currentStats: TruePlayerStats | undefined,
    historicalStats: YearlyPitchingStats[] | undefined,
    age: number,
    playerRole: number = 0,
    trueRating: number = 0
  ): { ip: number; isSp: boolean } {
    // 1. Determine Role (SP vs RP)
    let isSp = false;

    // Heuristic 1: Profile (User Priority)
    // 3+ Pitches (>= 45) AND Stamina >= 35 AND True Rating >= 2.0
    let meetsProfile = false;
    if (scouting) {
        const pitches = scouting.pitches ?? {};
        const usablePitches = Object.values(pitches).filter(r => r >= 45).length;
        const stam = scouting.stamina ?? 0;
        
        if (usablePitches >= 3 && stam >= 35 && trueRating >= 2.0) {
            meetsProfile = true;
        }
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

    // 2. Base IP
    // Default stamina if missing
    const stamina = scouting?.stamina ?? (isSp ? 50 : 30);
    
    let baseIp = isSp 
        ? 100 + (stamina * 1.2) // 30->136, 80->196
        : 30 + (stamina * 0.6); // 20->42, 80->78
    
    // Clamp
    if (isSp) baseIp = Math.max(100, Math.min(240, baseIp));
    else baseIp = Math.max(30, Math.min(100, baseIp));

    // 3. Injury Modifier
    const proneness = scouting?.injuryProneness?.toLowerCase() ?? 'normal';
    let injuryMod = 1.0;
    switch (proneness) {
        case 'iron man': injuryMod = 1.15; break;
        case 'durable': injuryMod = 1.08; break; // bit better than normal
        case 'normal': injuryMod = 1.0; break;
        case 'fragile': injuryMod = 0.85; break; // was 0.75
        case 'wrecked': injuryMod = 0.60; break; // was 0.40
    }
    baseIp *= injuryMod;

    // 4. Historical Blend (Durability Evidence)
    // Special case detection: Late-season callups / breakout candidates
    const totalHistoricalIp = historicalStats?.reduce((sum, s) => sum + s.ip, 0) ?? 0;
    const isLimitedExperience = totalHistoricalIp > 0 && totalHistoricalIp < 80 && age < 28;
    const hasStarterProfile = isSp && stamina >= 50;

    // Use weighted average of last 3 years if available
    if (historicalStats && historicalStats.length > 0) {
        let totalWeightedIp = 0;
        let totalWeight = 0;
        const weights = [5, 3, 2]; // Most recent year gets weight 5

        // historicalStats is sorted recent first (descending year)
        for (let i = 0; i < Math.min(historicalStats.length, 3); i++) {
            const stat = historicalStats[i];
            const weight = weights[i];
            // Use the IP directly (it's already parsed in YearlyPitchingStats)
            totalWeightedIp += stat.ip * weight;
            totalWeight += weight;
        }

        if (totalWeight > 0) {
            let weightedIp = totalWeightedIp / totalWeight;

            // NEW: Breakout / Ramp-Up Detection
            // If the player just threw a full starter workload (>120 IP) and it was a massive jump
            // from the previous year (>1.5x), assume the recent year is the new baseline.
            // This handles "Callup (95 IP) -> Full Season (186 IP)" scenarios where the weighted average
            // would unfairly drag them down.
            const recentStats = historicalStats[0];
            if (historicalStats.length >= 2) {
                const previousStats = historicalStats[1];
                if (recentStats.ip > 120 && recentStats.ip > previousStats.ip * 1.5) {
                    weightedIp = recentStats.ip;
                }
            }

            // Special case: Late-season callups / 2nd year starters
            // If a young pitcher has limited MLB IP but projects as a full-time starter,
            // heavily favor stamina-based projection over limited historical data
            if (isLimitedExperience && hasStarterProfile) {
                // 90% stamina-based model, 10% limited history
                // This prevents projecting 40 IP for a rookie who's expected to be a full-time starter
                baseIp = (baseIp * 0.90) + (weightedIp * 0.10);
            } else if (weightedIp > 50) {
                // If the player has established history (>50 IP avg), trust history more
                // 70% History, 30% Model
                // This prevents "Wrecked" label from destroying the projection of a guy who just threw 180 IP
                baseIp = (baseIp * 0.30) + (weightedIp * 0.70);
            } else {
                // For low IP players, trust the model/scouting more (50/50)
                baseIp = (baseIp * 0.50) + (weightedIp * 0.50);
            }
        }
    } else if (currentStats) {
        // Fallback to single year if no history array
        const rawIp = trueRatingsService.parseIp(currentStats.ip);
        if (rawIp > 0) {
            // Similar logic: if young starter with limited IP, favor model
            const isYoungStarterCallup = rawIp < 80 && age < 28 && hasStarterProfile;
            if (isYoungStarterCallup) {
                baseIp = (baseIp * 0.90) + (rawIp * 0.10);
            } else {
                baseIp = (baseIp * 0.50) + (rawIp * 0.50);
            }
        }
    }

    // 5. Age Cliff (The "Geriatric Penalty")
    // Severe penalties for 40+ to model rapid decline in durability/likelihood of playing
    if (age >= 46) {
        baseIp *= 0.10; // 150 -> 15
    } else if (age >= 43) {
        baseIp *= 0.40; // 150 -> 60
    } else if (age >= 40) {
        baseIp *= 0.75; // 150 -> 112
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
      if (year > 1900) {
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
