/**
 * TrueRatingsCalculationService
 *
 * Calculates league-relative "True Ratings" (0.5-5.0 scale) for pitchers
 * based on their performance stats, optionally blended with scouting data.
 *
 * Process:
 * 1. Multi-year weighted average (recent years weighted more)
 * 2. THREE-TIER REGRESSION (prevents over-projection of bad players):
 *    - Good performance (FIP ≤ 4.5): Regress toward league average (4.20 FIP)
 *    - Bad performance (4.5 < FIP ≤ 6.0): Regress toward replacement level (5.50 FIP)
 *    - Terrible performance (FIP > 6.0): MINIMAL regression - trust their awful performance
 *    - Smooth blending between tiers to avoid cliffs
 * 3. Optional blend with scouting ratings
 * 4. Calculate FIP-like metric
 * 5. Rank percentile across all pitchers
 * 6. Convert percentile to 0.5-5.0 rating scale
 */

import { PotentialStatsService } from './PotentialStatsService';
import { SeasonStage } from './DateService';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Scouting ratings for a pitcher (20-80 scale)
 * Defined here for Phase 2; will be imported from ScoutingData.ts when Phase 1 is complete
 */
export interface PitcherScoutingRatings {
  playerId: number;
  playerName?: string;
  control: number;   // 20-80 scale
  stuff: number;     // 20-80 scale
  hra: number;       // 20-80 scale
  age?: number;
}

/**
 * Single year of pitching stats
 */
export interface YearlyPitchingStats {
  year: number;
  ip: number;
  k9: number;
  bb9: number;
  hr9: number;
  gs: number;
}

/**
 * Input for True Rating calculation
 */
export interface TrueRatingInput {
  playerId: number;
  playerName: string;
  /** Multi-year stats (most recent first) */
  yearlyStats: YearlyPitchingStats[];
  scoutingRatings?: PitcherScoutingRatings;
}

/**
 * Output from True Rating calculation
 */
export interface TrueRatingResult {
  playerId: number;
  playerName: string;
  /** Blended rates after all calculations */
  blendedK9: number;
  blendedBb9: number;
  blendedHr9: number;
  /** Estimated ratings (from performance, 20-80 scale) */
  estimatedStuff: number;
  estimatedControl: number;
  estimatedHra: number;
  /** FIP-like metric (lower is better) */
  fipLike: number;
  /** Percentile rank (0-100, higher is better) */
  percentile: number;
  /** Final True Rating (0.5-5.0 scale) */
  trueRating: number;
  /** Total IP used in calculation */
  totalIp: number;
}

/**
 * League average rates needed for regression
 */
export interface LeagueAverages {
  avgK9: number;
  avgBb9: number;
  avgHr9: number;
}

/**
 * Weighted rate stats after multi-year averaging
 */
interface WeightedRates {
  k9: number;
  bb9: number;
  hr9: number;
  totalIp: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Year weights for multi-year averaging (most recent first) - used for historical years */
const YEAR_WEIGHTS = [5, 3, 2];

/**
 * Get dynamic year weights based on the current stage of the season.
 * During the season, current year stats are gradually weighted in,
 * stealing weight from older years as the season progresses.
 *
 * Returns weights for [current year, N-1, N-2, N-3].
 * Weights always sum to 10.
 */
export function getYearWeights(stage: SeasonStage): number[] {
  switch (stage) {
    case 'early':    return [0, 5, 3, 2];           // Q1 in progress - no current season yet
    case 'q1_done':  return [1.0, 5.0, 2.5, 1.5];   // May 15 - Jun 30
    case 'q2_done':  return [2.5, 4.5, 2.0, 1.0];   // Jul 1 - Aug 14
    case 'q3_done':  return [4.0, 4.0, 1.5, 0.5];   // Aug 15 - Sep 30
    case 'complete': return [5, 3, 2, 0];           // Oct 1+ - standard 3-year weights
    default:         return [0, 5, 3, 2];           // Fallback to no current season
  }
}

/** Stabilization constants (IP needed for stat to stabilize) */
const STABILIZATION = {
  bb9: 40,
  k9: 50,
  hr9: 70,
};

/** IP threshold for scouting blend confidence */
const SCOUTING_BLEND_CONFIDENCE_IP = 60;

/** Default league averages (WBL calibrated) */
const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = {
  avgK9: 7.5,
  avgBb9: 3.0,
  avgHr9: 0.85,
};

/**
 * Replacement-level rates (for fringe MLB pitchers, ~5.50 FIP)
 * Used for multi-tier regression to avoid over-projecting bad players
 */
const REPLACEMENT_LEVEL_RATES = {
  k9: 5.5,   // Well below league average
  bb9: 4.0,  // Above league average (poor control)
  hr9: 1.3,  // Above league average (gopher balls)
};

/**
 * Terrible pitcher rates (for truly awful pitchers, ~7.50 FIP)
 * Used for minimal regression - trust their bad performance
 */
const TERRIBLE_LEVEL_RATES = {
  k9: 4.5,   // Truly awful strikeout rate
  bb9: 5.0,  // Terrible control
  hr9: 1.6,  // Serves up homers
};

/**
 * Percentile thresholds for True Rating conversion
 * Based on normal distribution (bell curve) buckets
 * Lower bound is inclusive, maps to corresponding rating
 */
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

// ============================================================================
// Service Class
// ============================================================================

class TrueRatingsCalculationService {
  /**
   * Calculate True Ratings for a list of pitchers
   *
   * @param inputs - Array of pitcher inputs with yearly stats and optional scouting
   * @param leagueAverages - League-wide averages for regression (uses defaults if not provided)
   * @param yearWeights - Optional custom year weights for dynamic season weighting
   * @returns Array of TrueRatingResult with percentiles and ratings
   */
  calculateTrueRatings(
    inputs: TrueRatingInput[],
    leagueAverages: LeagueAverages = DEFAULT_LEAGUE_AVERAGES,
    yearWeights?: number[]
  ): TrueRatingResult[] {
    // Step 1-4: Calculate blended rates for each pitcher
    const results: TrueRatingResult[] = inputs.map(input =>
      this.calculateSinglePitcher(input, leagueAverages, yearWeights)
    );

    // Step 5: Calculate percentiles across all pitchers
    this.calculatePercentiles(results);

    // Step 6: Convert percentiles to ratings
    results.forEach(result => {
      result.trueRating = this.percentileToRating(result.percentile);
    });

    return results;
  }

  /**
   * Calculate blended rates and FIP-like for a single pitcher
   * (Steps 1-4 of the process)
   */
  private calculateSinglePitcher(
    input: TrueRatingInput,
    leagueAverages: LeagueAverages,
    yearWeights?: number[]
  ): TrueRatingResult {
    // Step 1: Multi-year weighted average
    const weighted = this.calculateWeightedRates(input.yearlyStats, yearWeights);

    // Step 2: Two-tier regression (toward league avg or replacement level)
    let regressedK9 = this.regressToLeagueMean(
      weighted.k9, weighted.totalIp, leagueAverages.avgK9, STABILIZATION.k9, 'k9', weighted
    );
    let regressedBb9 = this.regressToLeagueMean(
      weighted.bb9, weighted.totalIp, leagueAverages.avgBb9, STABILIZATION.bb9, 'bb9', weighted
    );
    let regressedHr9 = this.regressToLeagueMean(
      weighted.hr9, weighted.totalIp, leagueAverages.avgHr9, STABILIZATION.hr9, 'hr9', weighted
    );

    // Step 3: Optional scouting blend
    let blendedK9 = regressedK9;
    let blendedBb9 = regressedBb9;
    let blendedHr9 = regressedHr9;

    if (input.scoutingRatings) {
      const scoutExpected = this.scoutingToExpectedRates(input.scoutingRatings);
      blendedK9 = this.blendWithScouting(regressedK9, scoutExpected.k9, weighted.totalIp);
      blendedBb9 = this.blendWithScouting(regressedBb9, scoutExpected.bb9, weighted.totalIp);
      blendedHr9 = this.blendWithScouting(regressedHr9, scoutExpected.hr9, weighted.totalIp);
    }

    // Estimate ratings from blended rates (using inverse formulas)
    const estimatedStuff = this.estimateStuffFromK9(blendedK9);
    const estimatedControl = this.estimateControlFromBb9(blendedBb9);
    const estimatedHra = this.estimateHraFromHr9(blendedHr9);

    // Step 4: Calculate FIP-like metric
    const fipLike = this.calculateFipLike(blendedK9, blendedBb9, blendedHr9);

    return {
      playerId: input.playerId,
      playerName: input.playerName,
      blendedK9: Math.round(blendedK9 * 100) / 100,
      blendedBb9: Math.round(blendedBb9 * 100) / 100,
      blendedHr9: Math.round(blendedHr9 * 100) / 100,
      estimatedStuff: Math.round(estimatedStuff),
      estimatedControl: Math.round(estimatedControl),
      estimatedHra: Math.round(estimatedHra),
      fipLike: Math.round(fipLike * 100) / 100,
      percentile: 0, // Will be calculated in bulk
      trueRating: 0, // Will be calculated after percentile
      totalIp: Math.round(weighted.totalIp * 10) / 10,
    };
  }

  /**
   * Step 2.2: Calculate multi-year weighted average of rate stats
   *
   * Weights: Year N (most recent) = 5, N-1 = 3, N-2 = 2 (or dynamic based on season progress)
   * IP-weighted within each year for accuracy
   *
   * @param yearlyStats - Stats by year (most recent first)
   * @param yearWeights - Optional custom weights array (defaults to standard [5, 3, 2])
   * @returns Weighted rates and total IP
   */
  calculateWeightedRates(
    yearlyStats: YearlyPitchingStats[],
    yearWeights: number[] = YEAR_WEIGHTS
  ): WeightedRates {
    if (yearlyStats.length === 0) {
      return { k9: 0, bb9: 0, hr9: 0, totalIp: 0 };
    }

    let weightedK9Sum = 0;
    let weightedBb9Sum = 0;
    let weightedHr9Sum = 0;
    let totalWeight = 0;
    let totalIp = 0;

    // Process up to the number of weights provided
    const yearsToProcess = Math.min(yearlyStats.length, yearWeights.length);

    for (let i = 0; i < yearsToProcess; i++) {
      const stats = yearlyStats[i];
      const yearWeight = yearWeights[i];

      // Skip years with 0 weight (e.g., early season before current year counts)
      if (yearWeight === 0) continue;

      // Weight is yearWeight * IP for that year
      const weight = yearWeight * stats.ip;

      weightedK9Sum += stats.k9 * weight;
      weightedBb9Sum += stats.bb9 * weight;
      weightedHr9Sum += stats.hr9 * weight;

      totalWeight += weight;
      totalIp += stats.ip;
    }

    if (totalWeight === 0) {
      return { k9: 0, bb9: 0, hr9: 0, totalIp: 0 };
    }

    return {
      k9: weightedK9Sum / totalWeight,
      bb9: weightedBb9Sum / totalWeight,
      hr9: weightedHr9Sum / totalWeight,
      totalIp,
    };
  }

  /**
   * Step 2.3: Regress a rate stat toward the appropriate target
   *
   * THREE-TIER REGRESSION SYSTEM WITH IP-AWARE SCALING:
   * - Good performance (FIP ≤ 4.5): Regress toward league average (4.20 FIP)
   * - Bad performance (4.5 < FIP ≤ 6.0): Regress toward replacement level (5.50 FIP)
   * - Terrible performance (FIP > 6.0): MINIMAL regression - trust their awful performance
   *
   * IP-AWARE SCALING (addresses low-IP over-projection):
   * - Low IP (20-60): Reduced regression strength (trust their performance more)
   * - Medium IP (60-100): Moderate reduction
   * - High IP (100+): Full regression strength (standard behavior)
   *
   * This prevents over-projection of low-IP pitchers and rebuilding team players.
   *
   * Formula: regressed = (weighted × IP + target × adjustedK) / (IP + adjustedK)
   * Where adjustedK varies by both performance tier AND IP confidence
   *
   * @param weightedRate - The weighted average rate
   * @param totalIp - Total innings pitched
   * @param leagueRate - League average for this rate
   * @param stabilizationK - IP needed for stat to stabilize
   * @param statType - Type of stat ('k9', 'bb9', 'hr9') for replacement-level lookup
   * @param weightedRates - All weighted rates (for FIP calculation to determine quality tier)
   * @returns Regressed rate
   */
  regressToLeagueMean(
    weightedRate: number,
    totalIp: number,
    leagueRate: number,
    stabilizationK: number,
    statType: 'k9' | 'bb9' | 'hr9' = 'k9',
    weightedRates?: WeightedRates
  ): number {
    if (totalIp + stabilizationK === 0) {
      return leagueRate;
    }

    // Determine regression target and strength using three-tier system
    let regressionTarget = leagueRate;
    let adjustedK = stabilizationK; // Default: normal regression strength

    if (weightedRates) {
      // Calculate estimated FIP from weighted rates (using constant 3.47)
      const estimatedFip = this.calculateFipLike(
        weightedRates.k9,
        weightedRates.bb9,
        weightedRates.hr9
      );

      // Get replacement-level and terrible-level targets for this stat
      const replacementRate = REPLACEMENT_LEVEL_RATES[statType];
      const terribleRate = TERRIBLE_LEVEL_RATES[statType];

      // Three-tier regression logic:
      if (estimatedFip > 6.0) {
        // TERRIBLE performance - minimal regression, trust the bad data
        // Reduce regression strength by 70% (use only 30% of stabilization constant)
        adjustedK = stabilizationK * 0.3;
        regressionTarget = terribleRate;
      } else if (estimatedFip > 5.0) {
        // BAD performance - regress toward replacement level
        // Blend replacement and terrible if FIP is 5.0-6.0
        if (estimatedFip > 5.5) {
          // Very bad (5.5-6.0): blend replacement and terrible
          const blendFactor = (estimatedFip - 5.5) / 0.5; // 0 to 1
          regressionTarget = replacementRate * (1 - blendFactor) + terribleRate * blendFactor;
          // Also reduce regression strength slightly
          adjustedK = stabilizationK * (1 - blendFactor * 0.4); // 100% to 60%
        } else {
          // Bad (5.0-5.5): pure replacement level
          regressionTarget = replacementRate;
        }
      } else if (estimatedFip > 4.5) {
        // MARGINAL performance - blend league avg and replacement level
        // Linear interpolation: 4.5 FIP = 100% league, 5.0 FIP = 100% replacement
        const blendFactor = (estimatedFip - 4.5) / 0.5; // 0 to 1
        regressionTarget = leagueRate * (1 - blendFactor) + replacementRate * blendFactor;
      }
      // else: Good performance (FIP ≤ 4.5) - use normal league average
    }

    // IP-AWARE SCALING: Reduce regression strength for low-IP pitchers
    // This addresses systematic over-projection of low-IP pitchers (+0.153 bias)
    // Low IP (30): ipScale = 0.65 (35% reduction in regression)
    // Medium IP (75): ipScale = 0.88 (12% reduction)
    // High IP (100+): ipScale = 1.0 (no reduction)
    const ipConfidence = Math.min(1.0, totalIp / 100); // 0-1 scale
    const ipScale = 0.5 + (ipConfidence * 0.5); // 0.5 to 1.0 scale
    adjustedK = adjustedK * ipScale;

    // Regression formula with IP-aware adjusted strength
    return (weightedRate * totalIp + regressionTarget * adjustedK) / (totalIp + adjustedK);
  }

  /**
   * Step 2.4: Blend regressed stats with scouting-expected rates
   *
   * Formula: w_stats = IP / (IP + confidenceIp)
   * Final = w_stats * regressed + (1 - w_stats) * scoutExpected
   *
   * @param regressedRate - Rate after regression to mean
   * @param scoutingExpectedRate - Expected rate from scouting ratings
   * @param totalIp - Total innings pitched
   * @param confidenceIp - IP at which stats and scouting are equally weighted (default 60)
   * @returns Blended rate
   */
  blendWithScouting(
    regressedRate: number,
    scoutingExpectedRate: number,
    totalIp: number,
    confidenceIp: number = SCOUTING_BLEND_CONFIDENCE_IP
  ): number {
    const statsWeight = totalIp / (totalIp + confidenceIp);
    return statsWeight * regressedRate + (1 - statsWeight) * scoutingExpectedRate;
  }

  /**
   * Convert scouting ratings to expected rate stats
   * Uses formulas from PotentialStatsService
   */
  private scoutingToExpectedRates(scouting: PitcherScoutingRatings): { k9: number; bb9: number; hr9: number } {
    return {
      k9: PotentialStatsService.calculateK9(scouting.stuff),
      bb9: PotentialStatsService.calculateBB9(scouting.control),
      hr9: PotentialStatsService.calculateHR9(scouting.hra),
    };
  }

  /**
   * Step 2.5: Calculate FIP-like metric (without constant)
   *
   * FIP-like = (13×HR/9 + 3×BB/9 - 2×K/9) / 9
   *
   * Lower is better. We omit the FIP constant since we're only ranking.
   */
  calculateFipLike(k9: number, bb9: number, hr9: number): number {
    return (13 * hr9 + 3 * bb9 - 2 * k9) / 9;
  }

  /**
   * Step 2.6: Calculate percentile rankings for all pitchers
   *
   * Ranks by fipLike (lower is better), then converts to percentile
   * where higher percentile = better pitcher
   *
   * Mutates the results array to add percentile values
   */
  calculatePercentiles(results: TrueRatingResult[]): void {
    if (results.length === 0) return;

    // Sort by fipLike ascending (lower is better)
    const sorted = [...results].sort((a, b) => a.fipLike - b.fipLike);

    // Assign ranks (handle ties with average rank)
    const ranks = new Map<number, number>();
    let i = 0;
    while (i < sorted.length) {
      const currentFip = sorted[i].fipLike;
      let j = i;
      // Find all pitchers with same fipLike
      while (j < sorted.length && sorted[j].fipLike === currentFip) {
        j++;
      }
      // Average rank for ties (1-indexed)
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) {
        ranks.set(sorted[k].playerId, avgRank);
      }
      i = j;
    }

    // Convert rank to percentile (inverted so higher = better)
    // Percentile = (n - rank + 0.5) / n * 100
    const n = results.length;
    results.forEach(result => {
      const rank = ranks.get(result.playerId) || n;
      result.percentile = Math.round(((n - rank + 0.5) / n) * 1000) / 10;
    });
  }

  /**
   * Step 2.7: Convert percentile to True Rating (0.5-5.0 scale)
   *
   * Uses bell curve buckets based on normal distribution
   */
  percentileToRating(percentile: number): number {
    for (const { threshold, rating } of PERCENTILE_TO_RATING) {
      if (percentile >= threshold) {
        return rating;
      }
    }
    return 0.5; // Fallback for very low percentiles
  }

  /**
   * Estimate Stuff rating from K/9
   * Inverse of: K/9 = 2.07 + 0.074×Stuff
   * Stuff = (K/9 - 2.07) / 0.074
   */
  private estimateStuffFromK9(k9: number): number {
    const rating = (k9 - 2.07) / 0.074;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate Control rating from BB/9
   * Inverse of: BB/9 = 5.22 - 0.052×Control
   * Control = (5.22 - BB/9) / 0.052
   */
  private estimateControlFromBb9(bb9: number): number {
    const rating = (5.22 - bb9) / 0.052;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate HRA rating from HR/9
   * Inverse of: HR/9 = 2.08 - 0.024×HRA
   * HRA = (2.08 - HR/9) / 0.024
   */
  private estimateHraFromHr9(hr9: number): number {
    const rating = (2.08 - hr9) / 0.024;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Get default league averages
   */
  getDefaultLeagueAverages(): LeagueAverages {
    return { ...DEFAULT_LEAGUE_AVERAGES };
  }

  /**
   * Get stabilization constants
   */
  getStabilizationConstants(): typeof STABILIZATION {
    return { ...STABILIZATION };
  }
}

export const trueRatingsCalculationService = new TrueRatingsCalculationService();
export { TrueRatingsCalculationService };
