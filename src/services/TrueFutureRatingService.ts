/**
 * TrueFutureRatingService
 *
 * Calculates True Future Rating (TFR) for minor league prospects.
 * Projects what they would be as major leaguers by blending:
 * - Scouting ratings (potential Stuff/Control/HRA)
 * - Minor league performance (adjusted for level)
 *
 * The scouting weight varies based on age, development stage (star gap),
 * and sample size (minor league IP).
 */

import { PitcherScoutingRatings } from '../models/ScoutingData';
import { MinorLeagueStatsWithLevel, MinorLeagueLevel } from '../models/Stats';
import { PotentialStatsService } from './PotentialStatsService';
import { minorLeagueStatsService } from './MinorLeagueStatsService';
import { scoutingDataFallbackService } from './ScoutingDataFallbackService';
import { trueRatingsService } from './TrueRatingsService';
import { trueRatingsCalculationService } from './TrueRatingsCalculationService';

// ============================================================================
// Interfaces
// ============================================================================

export interface TrueFutureRatingInput {
  playerId: number;
  playerName: string;
  age: number;
  scouting: PitcherScoutingRatings;
  minorLeagueStats: MinorLeagueStatsWithLevel[];
  /** True Rating if player has MLB stats (for comparison) */
  trueRating?: number;
}

export interface TrueFutureRatingResult {
  playerId: number;
  playerName: string;
  age: number;
  /** Star gap (POT - OVR), indicates development stage */
  starGap: number;
  /** Weight given to scouting (0-1) */
  scoutingWeight: number;
  /** Scouting-expected rates */
  scoutK9: number;
  scoutBb9: number;
  scoutHr9: number;
  /** Adjusted minor league rates (MLB-equivalent) */
  adjustedK9: number;
  adjustedBb9: number;
  adjustedHr9: number;
  /** Blended projected rates */
  projK9: number;
  projBb9: number;
  projHr9: number;
  /** Projected FIP */
  projFip: number;
  /** Percentile rank against MLB pitchers */
  percentile: number;
  /** True Future Rating (0.5-5.0 scale) */
  trueFutureRating: number;
  /** True Rating if available (for comparison) */
  trueRating?: number;
  /** Total minor league IP */
  totalMinorIp: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Level adjustments to translate minor league stats to MLB-equivalent
 *
 * UPDATED: January 31, 2026 (2017 Validation Results)
 * Previous values (from OOTP 25+26 research) were 2-3x too aggressive
 * 2017→2021 validation showed actual changes much smaller than expected
 *
 * Validation results (54 AAA→MLB transitions):
 * - K/9: Expected +0.27, Actual +0.01 → Reduced to +0.10
 * - BB/9: Expected -0.06, Actual +0.02 → Reduced to 0.00 (no change)
 * - HR/9: Expected +0.39, Actual +0.26 → Reduced to +0.20
 *
 * Individual transitions (proportionally adjusted ~50-65%):
 * - AAA→MLB: k9: +0.10, bb9: 0.00, hr9: +0.20
 * - AA→AAA: k9: -0.08, bb9: +0.18, hr9: +0.02
 * - A→AA: k9: -0.10, bb9: +0.04, hr9: +0.05
 * - R→A: k9: -0.04, bb9: +0.14, hr9: +0.03
 *
 * Lower levels are cumulative: AA = (AA→AAA) + (AAA→MLB), etc.
 */
const LEVEL_ADJUSTMENTS: Record<MinorLeagueLevel, { k9: number; bb9: number; hr9: number }> = {
  // AAA → MLB (reduced ~50-65% from original)
  aaa: { k9: 0.10, bb9: 0.00, hr9: 0.20 },

  // AA → MLB (cumulative: AA→AAA + AAA→MLB)
  // k9: -0.08 + 0.10 = 0.02, bb9: +0.18 + 0.00 = +0.18, hr9: +0.02 + 0.20 = +0.22
  aa: { k9: 0.02, bb9: 0.18, hr9: 0.22 },

  // A → MLB (cumulative: A→AA + AA→AAA + AAA→MLB)
  // k9: -0.10 + (-0.08) + 0.10 = -0.08, bb9: +0.04 + 0.18 + 0.00 = +0.22, hr9: +0.05 + 0.02 + 0.20 = +0.27
  a: { k9: -0.08, bb9: 0.22, hr9: 0.27 },

  // Rookie → MLB (cumulative: R→A + A→AA + AA→AAA + AAA→MLB)
  // k9: -0.04 + (-0.10) + (-0.08) + 0.10 = -0.12, bb9: +0.14 + 0.04 + 0.18 + 0.00 = +0.36, hr9: +0.03 + 0.05 + 0.02 + 0.20 = +0.30
  r: { k9: -0.12, bb9: 0.36, hr9: 0.30 },
};

/** Year weights for minor league stats (current year, previous year) */
const MINOR_YEAR_WEIGHTS = [5, 3];

/** FIP constant (WBL calibrated) */
const FIP_CONSTANT = 3.47;

/**
 * Percentile thresholds for TFR (True Future Rating) conversion
 *
 * v9 (2026-01-30) - Final calibration for realistic prospect distribution:
 * Target: Elite (4.5+) = 2-4%, Above Avg (4.0-4.5) = 4-5%
 * More generous than OOTP (1.6% at 4★+) but still selective
 * - 5.0: Top 2% (~21 prospects) - true elite talents
 * - 4.5: Top 4% (~43 total at 4.5+) - future stars
 * - 4.0: Top 8% (~86 total at 4.0+) - solid MLB upside
 * - 3.5: Top 25% (~268 at 3.5+) - legitimate prospects
 * - 3.0+: Top 45% - everyone with a shot
 */
const PERCENTILE_TO_RATING: Array<{ threshold: number; rating: number }> = [
  { threshold: 98.0, rating: 5.0 },  // Elite: Top 2% (~21 prospects)
  { threshold: 96.0, rating: 4.5 },  // Star: Top 4% (~43 total at 4.5+)
  { threshold: 92.0, rating: 4.0 },  // Above Avg: Top 8% (~86 total at 4.0+)
  { threshold: 75.0, rating: 3.5 },  // Average: Top 25% (~268 total at 3.5+)
  { threshold: 55.0, rating: 3.0 },  // Fringe: Top 45%
  { threshold: 35.0, rating: 2.5 },  // Below Avg
  { threshold: 18.0, rating: 2.0 },  // Poor
  { threshold: 8.0, rating: 1.5 },   // Very Poor
  { threshold: 3.0, rating: 1.0 },   // Replacement
  { threshold: 0.0, rating: 0.5 },   // Bust
];

// ============================================================================
// Service Class
// ============================================================================

class TrueFutureRatingService {
  /**
   * Calculate scouting weight based on age, star gap, and IP.
   *
   * Higher weight = trust scouting more (stats are noise)
   * Lower weight = trust stats more (player is developed)
   *
   * UPDATED: January 31, 2026 - Reduced weight for older prospects
   * Older players are closer to their ceiling - trust track record over scout projection
   * Peak development age is 21-24, after that rely more on stats
   */
  calculateScoutingWeight(age: number, starGap: number, totalMinorIp: number): number {
    // Age-based base weight (trust stats more as players age)
    let baseWeight: number;

    if (age >= 30) baseWeight = 0.20; // 30+: Almost entirely trust stats
    else if (age >= 27) baseWeight = 0.30; // 27-29: Mostly trust stats
    else if (age >= 25) baseWeight = 0.40; // 25-26: Trust stats more than scouts
    else if (age >= 23) baseWeight = 0.60; // 23-24: Balance (peak dev age)
    else baseWeight = 0.70; // <23: Trust scouts more (less developed)

    // For young prospects only, add bonuses for rawness
    if (age < 25) {
      // More raw (larger gap) = trust scouting more
      const gapBonus = (starGap / 4.0) * 0.12; // 0% to 12%

      // Less IP = trust scouting more (stats are noisy)
      const ipFactor = (50 / (50 + totalMinorIp)) * 0.12; // 0% to 12%

      return Math.min(0.90, baseWeight + gapBonus + ipFactor);
    }

    // For older prospects (25+), no bonuses - just use base weight
    return baseWeight;
  }

  /**
   * Apply level adjustments to translate minor league stats to MLB-equivalent.
   */
  applyLevelAdjustments(
    k9: number,
    bb9: number,
    hr9: number,
    level: MinorLeagueLevel
  ): { k9: number; bb9: number; hr9: number } {
    const adj = LEVEL_ADJUSTMENTS[level];
    return {
      k9: k9 + adj.k9,
      bb9: bb9 + adj.bb9,
      hr9: hr9 + adj.hr9,
    };
  }

  /**
   * Calculate weighted average of minor league stats across levels and years.
   * More recent years weighted higher. Stats weighted by IP.
   */
  calculateWeightedMinorStats(
    stats: MinorLeagueStatsWithLevel[],
    currentYear: number
  ): { k9: number; bb9: number; hr9: number; totalIp: number } | null {
    if (stats.length === 0) {
      return null;
    }

    let weightedK9Sum = 0;
    let weightedBb9Sum = 0;
    let weightedHr9Sum = 0;
    let totalWeight = 0;
    let totalIp = 0;

    for (const stat of stats) {
      // Calculate year weight (current year = 5, previous = 3, older = 2)
      const yearDiff = currentYear - stat.year;
      let yearWeight = 2;
      if (yearDiff === 0) yearWeight = MINOR_YEAR_WEIGHTS[0];
      else if (yearDiff === 1) yearWeight = MINOR_YEAR_WEIGHTS[1];

      // Apply level adjustments to this season's stats
      const adjusted = this.applyLevelAdjustments(stat.k9, stat.bb9, stat.hr9, stat.level);

      // Weight is yearWeight * IP
      const weight = yearWeight * stat.ip;

      weightedK9Sum += adjusted.k9 * weight;
      weightedBb9Sum += adjusted.bb9 * weight;
      weightedHr9Sum += adjusted.hr9 * weight;

      totalWeight += weight;
      totalIp += stat.ip;
    }

    if (totalWeight === 0) {
      return null;
    }

    return {
      k9: weightedK9Sum / totalWeight,
      bb9: weightedBb9Sum / totalWeight,
      hr9: weightedHr9Sum / totalWeight,
      totalIp,
    };
  }

  /**
   * Calculate scouting-expected rates from potential ratings.
   */
  scoutingToExpectedRates(scouting: PitcherScoutingRatings): { k9: number; bb9: number; hr9: number } {
    return {
      k9: PotentialStatsService.calculateK9(scouting.stuff),
      bb9: PotentialStatsService.calculateBB9(scouting.control),
      hr9: PotentialStatsService.calculateHR9(scouting.hra),
    };
  }

  /**
   * Calculate FIP from rate stats.
   */
  calculateFip(k9: number, bb9: number, hr9: number): number {
    return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;
  }

  /**
   * Convert percentile to True Rating (0.5-5.0 scale).
   */
  percentileToRating(percentile: number): number {
    for (const { threshold, rating } of PERCENTILE_TO_RATING) {
      if (percentile >= threshold) {
        return rating;
      }
    }
    return 0.5;
  }

  /**
   * Calculate True Future Rating for a single player.
   */
  calculateTrueFutureRating(input: TrueFutureRatingInput): Omit<TrueFutureRatingResult, 'percentile' | 'trueFutureRating'> {
    const { scouting, minorLeagueStats, age } = input;

    // Calculate star gap (default to 2 if not available)
    const ovr = scouting.ovr ?? 2.0;
    const pot = scouting.pot ?? ovr;
    const starGap = Math.max(0, pot - ovr);

    // Calculate weighted minor league stats
    const currentYear = minorLeagueStats.length > 0
      ? Math.max(...minorLeagueStats.map(s => s.year))
      : new Date().getFullYear();

    const weightedStats = this.calculateWeightedMinorStats(minorLeagueStats, currentYear);
    const totalMinorIp = weightedStats?.totalIp ?? 0;

    // Calculate scouting weight
    const scoutingWeight = this.calculateScoutingWeight(age, starGap, totalMinorIp);

    // Calculate scouting-expected rates
    const scoutRates = this.scoutingToExpectedRates(scouting);

    // If no minor league stats, use scouting only
    let adjustedK9 = scoutRates.k9;
    let adjustedBb9 = scoutRates.bb9;
    let adjustedHr9 = scoutRates.hr9;

    if (weightedStats) {
      adjustedK9 = weightedStats.k9;
      adjustedBb9 = weightedStats.bb9;
      adjustedHr9 = weightedStats.hr9;
    }

    // Blend scouting and stats
    const projK9 = scoutingWeight * scoutRates.k9 + (1 - scoutingWeight) * adjustedK9;
    const projBb9 = scoutingWeight * scoutRates.bb9 + (1 - scoutingWeight) * adjustedBb9;
    const projHr9 = scoutingWeight * scoutRates.hr9 + (1 - scoutingWeight) * adjustedHr9;

    // Calculate projected FIP
    const projFip = this.calculateFip(projK9, projBb9, projHr9);

    return {
      playerId: input.playerId,
      playerName: input.playerName,
      age,
      starGap,
      scoutingWeight,
      scoutK9: Math.round(scoutRates.k9 * 100) / 100,
      scoutBb9: Math.round(scoutRates.bb9 * 100) / 100,
      scoutHr9: Math.round(scoutRates.hr9 * 100) / 100,
      adjustedK9: Math.round(adjustedK9 * 100) / 100,
      adjustedBb9: Math.round(adjustedBb9 * 100) / 100,
      adjustedHr9: Math.round(adjustedHr9 * 100) / 100,
      projK9: Math.round(projK9 * 100) / 100,
      projBb9: Math.round(projBb9 * 100) / 100,
      projHr9: Math.round(projHr9 * 100) / 100,
      projFip: Math.round(projFip * 100) / 100,
      trueRating: input.trueRating,
      totalMinorIp,
    };
  }

  /**
   * Calculate confidence factor based on certainty of projection reaching peak.
   * Lower confidence = more regression toward replacement level.
   *
   * UPDATED: January 31, 2026 - Added age penalty for older prospects
   * 2017 validation showed 30-year-old prospects getting elite TFR ratings
   * Older players are less likely to develop further - already near ceiling
   *
   * Returns value between 0 and 1:
   * - 1.0 = very confident (peak development age, near MLB, good data)
   * - 0.3 = very uncertain (too young/old, far from MLB, limited data)
   */
  calculateConfidenceFactor(
    age: number,
    level: string,
    totalMinorIp: number,
    scoutFip: number,
    adjustedFip: number
  ): number {
    let confidence = 1.0;

    // Age factor: Peak development window is 21-24
    // Too young = uncertain development, too old = limited upside
    if (age <= 19) confidence *= 0.75; // Very young, highly uncertain
    else if (age <= 20) confidence *= 0.84; // Still developing
    else if (age <= 22) confidence *= 0.95; // Good development window
    else if (age <= 24) confidence *= 1.00; // Peak development age - BEST prospects
    else if (age <= 26) confidence *= 0.85; // Past peak, limited upside
    else if (age <= 28) confidence *= 0.65; // Old for prospect, ceiling likely reached
    else if (age <= 30) confidence *= 0.45; // Very old, minimal upside
    else confidence *= 0.25; // 31+ = organizational filler, not a prospect

    // Level factor: Rookie-only penalty
    // Optimizer found 0.929 but that still gives 24% rookies in top 100 (target: 3-10%)
    // Manual adjustment to 0.87 for stronger penalty
    const levelLower = level.toLowerCase();
    if (levelLower.includes('r') || levelLower.includes('rookie')) {
      confidence *= 0.87; // Strong penalty for extreme distance from MLB
    }
    // AAA, AA, A: No penalty (scouting weight already handles this)

    // Sample size factor: Less proven = more uncertain
    // Tuned via complete optimization (score 49.5/100)
    if (totalMinorIp < 50) confidence *= 0.80;  // (optimized: 0.798)
    else if (totalMinorIp < 100) confidence *= 0.92;  // (optimized: 0.919)
    else if (totalMinorIp < 200) confidence *= 0.95;  // (optimized: 0.949)
    // 200+ IP stays at 1.0 (proven over full season+)

    // Scout-stat agreement: If stats way worse than scout projects, reduce confidence
    // Tuned via complete optimization (score 49.5/100)
    const scoutStatGap = Math.abs(adjustedFip - scoutFip);
    if (scoutStatGap > 2.0) confidence *= 0.75;  // Huge disagreement (optimized: 0.753)
    else if (scoutStatGap > 1.5) confidence *= 0.93;  // Large disagreement (optimized: 0.931)
    else if (scoutStatGap > 1.0) confidence *= 0.97;  // Moderate disagreement (optimized: 0.973)
    // Gap < 1.0 stays at 1.0 (scout and stats agree)

    return Math.max(0.59, confidence); // Floor at 59% confidence (optimized: 0.595)
  }

  /**
   * Apply regression toward average prospect outcome based on confidence.
   *
   * Logic: Not every prospect reaches their peak. We regress projections
   * toward "average prospect outcome" based on uncertainty.
   *
   * This is ONLY used for ranking/percentile calculation.
   * Peak projections (for WAR, etc.) should use un-regressed values.
   *
   * High confidence: Little regression (they'll likely reach peak)
   * Low confidence: More regression (bust risk is higher)
   */
  applyConfidenceRegression(projFip: number, confidence: number): number {
    // Average outcome for prospects who make MLB (accounting for bust rate)
    // Most prospects never reach their peak, so this is well below replacement
    // Tuned via complete optimization (score 49.5/100): 4.88 FIP
    const averageProspectFip = 4.88;

    // Use linear confidence for aggressive regression
    // This ensures proper separation between high/low confidence prospects
    // confidence=1.0: no regression (use projFip as-is)
    // confidence=0.7: 70% peak, 30% average = ~3.98 for 3.50 peak
    // confidence=0.6: 60% peak, 40% average = ~4.14 for 3.50 peak
    // confidence=0.5: 50% peak, 50% average = ~4.30 for 3.50 peak
    return confidence * projFip + (1 - confidence) * averageProspectFip;
  }

  /**
   * Calculate True Future Ratings for multiple players and rank against MLB pitchers.
   *
   * @param inputs - Array of prospect inputs
   * @param mlbFips - Array of current MLB pitcher FIPs (for percentile ranking)
   * @returns Array of TrueFutureRatingResult with percentiles and ratings
   */
  calculateTrueFutureRatings(
    inputs: TrueFutureRatingInput[],
    mlbFips: number[]
  ): TrueFutureRatingResult[] {
    // Calculate base results (peak projections)
    const results = inputs.map(input => this.calculateTrueFutureRating(input));

    // Calculate confidence-adjusted FIPs for ranking (but keep peak projections)
    const resultsWithConfidence = results.map(result => {
      // Determine level (from input's latest minor league stats)
      const input = inputs.find(i => i.playerId === result.playerId);
      const latestLevel = input?.minorLeagueStats.length
        ? input.minorLeagueStats[input.minorLeagueStats.length - 1].level
        : 'a';

      // Calculate scout-expected FIP (for comparison)
      const scoutFip = this.calculateFip(result.scoutK9, result.scoutBb9, result.scoutHr9);

      // Calculate adjusted minor league FIP (for comparison)
      const adjustedFip = this.calculateFip(result.adjustedK9, result.adjustedBb9, result.adjustedHr9);

      // Calculate confidence in projection reaching peak
      const confidence = this.calculateConfidenceFactor(
        result.age,
        latestLevel,
        result.totalMinorIp,
        scoutFip,
        adjustedFip
      );

      // Apply regression for ranking only (don't overwrite peak projection)
      const rankingFip = this.applyConfidenceRegression(result.projFip, confidence);

      return {
        result,
        rankingFip // Use this for percentile, keep result.projFip for Peak WAR
      };
    });

    // Combine ranking FIPs with MLB FIPs for percentile calculation
    const allFips = [...mlbFips, ...resultsWithConfidence.map(r => r.rankingFip)];
    allFips.sort((a, b) => a - b); // Lower FIP is better

    const n = allFips.length;

    // Calculate percentile for each prospect using ranking FIP
    return resultsWithConfidence.map(({ result, rankingFip }) => {
      // Find rank (1-indexed, lower FIP = better rank)
      let rank = 1;
      for (const fip of allFips) {
        if (fip < rankingFip) rank++;
        else break;
      }

      // Handle ties by averaging
      let tiedCount = 0;
      for (const fip of allFips) {
        if (fip === rankingFip) tiedCount++;
      }
      const avgRank = rank + (tiedCount - 1) / 2;

      // Convert rank to percentile (inverted so higher = better)
      const percentile = Math.round(((n - avgRank + 0.5) / n) * 1000) / 10;
      const trueFutureRating = this.percentileToRating(percentile);

      // Return result with original projFip (for Peak WAR) but adjusted ranking
      return {
        ...result,
        percentile,
        trueFutureRating,
      };
    });
  }

  /**
   * Get all prospects with scouting data for a given year and calculate their TFR.
   *
   * @param year - The year to analyze
   * @returns Array of TrueFutureRatingResult
   */
  async getProspectTrueFutureRatings(
    year: number
  ): Promise<TrueFutureRatingResult[]> {
    // Get scouting data with fallback (My Scout > OSA)
    let scoutingFallback = await scoutingDataFallbackService.getScoutingRatingsWithFallback(year);
    if (scoutingFallback.ratings.length === 0) {
        console.warn(`[TFR] No scouting data found for ${year}. Falling back to latest available data.`);
        scoutingFallback = await scoutingDataFallbackService.getScoutingRatingsWithFallback();
    }

    const scoutingRatings = scoutingFallback.ratings;
    if (scoutingRatings.length === 0) {
      console.warn('[TFR] No scouting data found (even latest). Cannot calculate True Future Ratings.');
      return [];
    }

    // Get MLB pitcher FIPs for percentile ranking
    const mlbStats = await trueRatingsService.getTruePitchingStats(year);
    const leagueAverages = await trueRatingsService.getLeagueAverages(year);
    const multiYearStats = await trueRatingsService.getMultiYearPitchingStats(year, 3);

    // Calculate True Ratings for MLB pitchers to get their FIP distribution
    const mlbInputs = mlbStats.map(stat => ({
      playerId: stat.player_id,
      playerName: stat.playerName,
      yearlyStats: multiYearStats.get(stat.player_id) ?? [],
      scoutingRatings: scoutingRatings.find(s => s.playerId === stat.player_id),
    }));

    const mlbTrueRatings = trueRatingsCalculationService.calculateTrueRatings(mlbInputs, leagueAverages);

    // Filter MLB FIPs to prime years only (ages 25-32) for fair comparison
    // Prospects project to peak at 25-27, so compare vs MLB prime, not all ages
    // Ages 25-32 in OOTP: ~4.31-4.38 FIP avg (vs 4.35 all ages)
    const primeYearsFips = mlbTrueRatings
      .filter(tr => {
        const scouting = scoutingRatings.find(s => s.playerId === tr.playerId);
        const age = scouting?.age ?? 0;
        return age >= 25 && age <= 32;
      })
      .map(tr => tr.fipLike + FIP_CONSTANT);

    // Use prime years FIPs for percentile comparison
    const mlbFips = primeYearsFips.length > 200 ? primeYearsFips : mlbTrueRatings.map(tr => tr.fipLike + FIP_CONSTANT);

    // Build map of MLB True Ratings by player ID
    const mlbTrMap = new Map(mlbTrueRatings.map(tr => [tr.playerId, tr.trueRating]));

    // Build prospect inputs
    const prospectInputs: TrueFutureRatingInput[] = [];

    // ⚡ PERFORMANCE FIX: Fetch ALL minor league stats upfront in bulk
    // instead of querying per-player (4 levels × 3 years = 12 API calls total)
    const allMinorLeagueStats = await minorLeagueStatsService.getAllPlayerStatsBatch(
      year - 2,
      year
    );

    for (const scouting of scoutingRatings) {
      // Skip if no valid ID or ratings
      if (scouting.playerId <= 0) continue;

      // Look up this player's stats from the bulk-fetched data
      const minorStats = allMinorLeagueStats.get(scouting.playerId) ?? [];

      // IMPORTANT: Only include players who actually played in the minors during this period
      // This excludes amateur/draft prospects who have scouting ratings but haven't debuted yet
      // For example, if analyzing 2020, only include players with 2018-2020 minor league stats
      const totalIp = minorStats.reduce((sum, stat) => sum + stat.ip, 0);
      if (totalIp === 0) continue; // Skip players with no minor league experience in this period

      // Get age (from scouting data or estimate)
      const age = scouting.age ?? 22; // Default to 22 if not available

      prospectInputs.push({
        playerId: scouting.playerId,
        playerName: scouting.playerName ?? `Player ${scouting.playerId}`,
        age,
        scouting,
        minorLeagueStats: minorStats,
        trueRating: mlbTrMap.get(scouting.playerId),
      });
    }

    // Calculate TFR for all prospects
    return this.calculateTrueFutureRatings(prospectInputs, mlbFips);
  }

  /**
   * Get TFR for a single player.
   */
  async getPlayerTrueFutureRating(
    playerId: number,
    year: number
  ): Promise<TrueFutureRatingResult | null> {
    const allResults = await this.getProspectTrueFutureRatings(year);
    return allResults.find(r => r.playerId === playerId) ?? null;
  }
}

export const trueFutureRatingService = new TrueFutureRatingService();
