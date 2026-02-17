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
import type { SeasonStage } from './DateService';
import { PitcherRole } from '../models/Player';

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
  /** Pitcher role (SP/SW/RP) - if provided, overrides IP-based tier detection */
  role?: PitcherRole;
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
  /** Pitcher role (SP/SW/RP) - used for tier-aware percentile ranking */
  role?: PitcherRole;
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
 * Get dynamic year weights based on continuous season progress (0–1).
 * Linearly interpolates between Opening Day weights [0,5,3,2] and
 * end-of-season weights [5,3,2,0]. Weights always sum to 10.
 *
 * @param progress 0.0 = Opening Day, 1.0 = season complete
 */
export function getYearWeights(progress: number): number[] {
  const t = Math.max(0, Math.min(1, progress));
  return [
    5 * t,           // current year:  0 → 5
    5 - 2 * t,       // year N-1:      5 → 3
    3 - t,           // year N-2:      3 → 2
    2 - 2 * t,       // year N-3:      2 → 0
  ];
}

/** @deprecated Use getYearWeights(progress: number) instead */
export function getYearWeightsLegacy(stage: SeasonStage): number[] {
  switch (stage) {
    case 'early':    return [0, 5, 3, 2];
    case 'q1_done':  return [1.0, 5.0, 2.5, 1.5];
    case 'q2_done':  return [2.5, 4.5, 2.0, 1.0];
    case 'q3_done':  return [4.0, 4.0, 1.5, 0.5];
    case 'complete': return [5, 3, 2, 0];
    default:         return [0, 5, 3, 2];
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

/**
 * THREE-TIER LEAGUE AVERAGES (WBL calibrated Jan 2026)
 *
 * Optimized separately for starters, swingmen, and relievers based on
 * 2015-2020 back-projection data with 70-130 IP swingman boundary.
 *
 * Key findings:
 * - Starters (130+ IP): 306 samples, MAE 0.448, Bias -0.012
 * - Swingmen (70-130 IP): 101 samples, MAE 0.664, Bias -0.001
 * - Relievers (20-70 IP): 235 samples, MAE 0.856, Bias -0.069
 */

/** Default league averages - fallback for starters */
const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = {
  avgK9: 5.60,
  avgBb9: 2.80,
  avgHr9: 0.90,
};

/**
 * Get league averages based on pitcher's role or total IP (three-tier system)
 * Prefers role-based tier if provided, falls back to IP-based
 */
function getLeagueAveragesByRole(role: PitcherRole | undefined, totalIp: number): LeagueAverages {
  const tier = role ?? getRoleFromIp(totalIp);

  if (tier === 'SP') {
    // Starters: 130+ IP - conservative averages
    return {
      avgK9: 5.60,
      avgBb9: 2.80,
      avgHr9: 0.90,
    };
  } else if (tier === 'SW') {
    // Swingmen: 70-130 IP - higher K9 baseline
    return {
      avgK9: 6.60,
      avgBb9: 2.60,
      avgHr9: 0.75,
    };
  } else {
    // Relievers: 20-70 IP - moderate K9 baseline
    return {
      avgK9: 6.40,
      avgBb9: 2.80,
      avgHr9: 0.90,
    };
  }
}

/**
 * Convert IP to role (fallback for when role is not explicitly provided)
 */
function getRoleFromIp(totalIp: number): PitcherRole {
  if (totalIp >= 130) return 'SP';
  if (totalIp >= 70) return 'SW';
  return 'RP';
}

/**
 * Get regression ratio based on pitcher's role or total IP and stat type (three-tier system)
 * Prefers role-based tier if provided, falls back to IP-based
 *
 * Starters get conservative regression (stable samples)
 * Swingmen get moderate regression (medium samples)
 * Relievers get aggressive regression (small, volatile samples)
 */
function getRegressionRatioByRole(role: PitcherRole | undefined, totalIp: number, statType: 'k9' | 'bb9' | 'hr9'): number {
  const tier = role ?? getRoleFromIp(totalIp);

  if (tier === 'SP') {
    // Starters: conservative regression
    switch (statType) {
      case 'k9': return 0.60;
      case 'bb9': return 0.80;
      case 'hr9': return 0.18;
    }
  } else if (tier === 'SW') {
    // Swingmen: moderate regression
    switch (statType) {
      case 'k9': return 1.20;
      case 'bb9': return 0.80;
      case 'hr9': return 0.18;
    }
  } else {
    // Relievers: aggressive regression
    switch (statType) {
      case 'k9': return 1.20;
      case 'bb9': return 0.40;
      case 'hr9': return 0.18;
    }
  }
}

/**
 * Quartile-based regression parameters (optimized from 2017-2020 projection data)
 *
 * Each quartile has:
 * - fipThreshold: Upper FIP bound for this quartile
 * - targetOffset: Offset from league avg (negative = better than avg, positive = worse)
 * - strengthMultiplier: Multiplier on stabilization constant (higher = more regression)
 *
 * Elite pitchers get minimal regression toward elite targets.
 * Bad pitchers get strong regression toward bad targets.
 */
// interface QuartileRegressionParams {
//   fipThreshold: number;
//   targetOffset: number;
//   strengthMultiplier: number;
// }

// const QUARTILE_REGRESSION_PARAMS: QuartileRegressionParams[] = [


/**
 * Elite pitcher-specific parameters (optimized via grid search on top 10 WAR leaders 2018-2020)
 *
 * These parameters are applied to the very best pitchers (top 20 by projected WAR or FIP < 3.5)
 * to match OOTP's tendency to stretch elite performance for dramatic effect.
 *
 * Grid search tested 11,088 combinations and found:
 * - WAR MAE improved 38.7% (1.627 → 0.997)
 * - WAR mean error improved 92.1% (-1.601 → -0.126)
 * - FIP improved 20-29% across metrics
 */
export interface ElitePitcherParams {
  fipThreshold: number;           // FIP cutoff to be considered "elite"
  targetOffset: number;            // Regress toward MUCH better than average
  strengthMultiplier: number;      // Regression strength
  ipProjectionRatio: number;       // IP projection ratio (1.0 = full prior year)
  warMultiplier: number;           // WAR boost to match OOTP's dramatic effect
}

export const ELITE_PITCHER_PARAMS: ElitePitcherParams = {
  fipThreshold: 3.50,
  targetOffset: -1.50,
  strengthMultiplier: 1.50,
  ipProjectionRatio: 1.00,
  warMultiplier: 1.20
};

/**
 * Super Elite pitcher-specific parameters (calibrated from top 10 WAR analysis)
 *
 * Analysis showed top 10 WAR leaders were under-projected by 1.55 WAR on average:
 * - Avg Projected: 3.85 WAR vs Actual: 5.40 WAR
 * - FIP error contributed ~67% of gap (over-projecting FIP by +0.24)
 * - IP error contributed ~33% of gap (under-projecting IP by ~12)
 *
 * Super Elite tier applies MORE aggressive parameters than regular Elite:
 * - Tighter FIP threshold (3.20 vs 3.50)
 * - More aggressive regression target (-2.00 vs -1.50)
 * - Boosted IP projection (1.05x vs 1.00x)
 * - Higher WAR multiplier (1.30x vs 1.20x)
 *
 * This addresses OOTP's tendency to stretch the very top end even more dramatically
 * than the general elite population.
 */
export const SUPER_ELITE_PITCHER_PARAMS: ElitePitcherParams = {
  fipThreshold: 3.20,
  targetOffset: -2.00,
  strengthMultiplier: 1.50,
  ipProjectionRatio: 1.05,
  warMultiplier: 1.30
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
    _leagueAverages: LeagueAverages = DEFAULT_LEAGUE_AVERAGES,
    yearWeights?: number[]
  ): TrueRatingResult[] {
    // Step 1-4: Calculate blended rates for each pitcher
    const results: TrueRatingResult[] = inputs.map(input =>
      this.calculateSinglePitcher(input, yearWeights)
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
   *
   * Note: This method does NOT calculate percentiles or true rating.
   * Use this when you need to rank a single player against a custom distribution.
   */
  calculateSinglePitcher(
    input: TrueRatingInput,
    yearWeights?: number[]
  ): TrueRatingResult {
    // Step 1: Multi-year weighted average
    const weighted = this.calculateWeightedRates(input.yearlyStats, yearWeights);

    // DEBUG: Log input for specific player
    // Use tier-based league averages (role-based if provided, else IP-based)
    const tierBasedAverages = getLeagueAveragesByRole(input.role, weighted.totalIp);

    // Step 2: Three-tier regression (role-based if provided, else IP-based)
    let regressedK9 = this.regressToLeagueMean(
      weighted.k9, weighted.totalIp, tierBasedAverages.avgK9, STABILIZATION.k9, 'k9', weighted, input.role
    );
    let regressedBb9 = this.regressToLeagueMean(
      weighted.bb9, weighted.totalIp, tierBasedAverages.avgBb9, STABILIZATION.bb9, 'bb9', weighted, input.role
    );
    let regressedHr9 = this.regressToLeagueMean(
      weighted.hr9, weighted.totalIp, tierBasedAverages.avgHr9, STABILIZATION.hr9, 'hr9', weighted, input.role
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

    // Determine role: use provided role, or fall back to IP-based
    const determinedRole = input.role ?? getRoleFromIp(weighted.totalIp);

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
      role: determinedRole,
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
   * CONTINUOUS SLIDING SCALE REGRESSION SYSTEM:
   *
   * Prevents "bunching" by using a smooth gradient rather than hard tiers.
   * Historical data shows top 30-40 pitchers need aggressive treatment:
   * - #10 actual: ~3.30 FIP (was projecting 3.75, +0.45 too pessimistic)
   * - #20 actual: ~3.50 FIP (was projecting 3.83, +0.33 too pessimistic)
   * - #30 actual: ~3.72 FIP (was projecting 3.96, +0.24 too pessimistic)
   *
   * The sliding scale creates a smooth distribution:
   * - FIP < 3.0:  targetOffset -3.0  (extremely aggressive, generational talent)
   * - FIP 3.0:    targetOffset -2.8  (elite ace)
   * - FIP 3.5:    targetOffset -2.0  (top 20)
   * - FIP 4.0:    targetOffset -0.8  (top quartile)
   * - FIP 4.2:    targetOffset  0.0  (league average)
   * - FIP 4.5:    targetOffset +1.0  (below average)
   * - FIP > 5.0:  targetOffset +1.5  (poor)
   *
   * IP-AWARE SCALING: Reduces regression strength for low-IP pitchers
   *
   * @param weightedRate - The weighted average rate
   * @param totalIp - Total innings pitched
   * @param leagueRate - League average for this rate
   * @param stabilizationK - IP needed for stat to stabilize
   * @param statType - Type of stat ('k9', 'bb9', 'hr9')
   * @param weightedRates - All weighted rates (for FIP calculation to determine scaling)
   * @param role - Optional pitcher role (SP/SW/RP) for tier-specific regression
   * @returns Regressed rate
   */
  regressToLeagueMean(
    weightedRate: number,
    totalIp: number,
    leagueRate: number,
    stabilizationK: number,
    statType: 'k9' | 'bb9' | 'hr9' = 'k9',
    weightedRates?: WeightedRates,
    role?: PitcherRole
  ): number {
    if (totalIp + stabilizationK === 0) {
      return leagueRate;
    }

    // Determine regression target and strength using continuous sliding scale
    let regressionTarget = leagueRate;
    let adjustedK = stabilizationK; // Default: normal regression strength

    if (weightedRates) {
      // Calculate estimated FIP from weighted rates
      const fipLike = this.calculateFipLike(
        weightedRates.k9,
        weightedRates.bb9,
        weightedRates.hr9
      );
      // BUG FIX: Add FIP constant since calculateTargetOffset expects actual FIP, not FIP-like
      const estimatedFip = fipLike + 3.47;

      // Use continuous sliding scale for targetOffset based on estimatedFip
      // This prevents bunching by treating each pitcher individually
      const targetOffset = this.calculateTargetOffset(estimatedFip);
      const strengthMultiplier = this.calculateStrengthMultiplier(estimatedFip);

      // Calculate regression target based on targetOffset
      // targetOffset represents offset from league average in FIP units
      // Convert FIP offset to K9/BB9/HR9 targets using FIP formula coefficients
      // FIP = (13×HR9 + 3×BB9 - 2×K9) / 9 + constant
      //
      // THREE-TIER REGRESSION RATIOS (optimized Jan 2026):
      // Starters (130+ IP):   k9=0.60, bb9=0.80, hr9=0.18 (conservative)
      // Swingmen (70-130 IP): k9=1.20, bb9=0.80, hr9=0.18 (moderate)
      // Relievers (20-70 IP): k9=1.20, bb9=0.40, hr9=0.18 (aggressive)
      const regressionRatio = getRegressionRatioByRole(role, totalIp, statType);

      switch (statType) {
        case 'k9':
          regressionTarget = leagueRate - (targetOffset * regressionRatio);
          break;
        case 'bb9':
          regressionTarget = leagueRate + (targetOffset * regressionRatio);
          break;
        case 'hr9':
          regressionTarget = leagueRate + (targetOffset * regressionRatio);
          break;
      }

      // Apply tier-specific regression strength
      adjustedK = stabilizationK * strengthMultiplier;
    }

    // IP-AWARE SCALING: Reduce regression strength for low-IP pitchers
    // This addresses systematic over-projection of low-IP pitchers
    // Low IP (30): ipScale = 0.65 (35% reduction in regression)
    // Medium IP (75): ipScale = 0.88 (12% reduction)
    // High IP (100+): ipScale = 1.0 (no reduction)
    const ipConfidence = Math.min(1.0, totalIp / 100); // 0-1 scale
    const ipScale = 0.5 + (ipConfidence * 0.5); // 0.5 to 1.0 scale
    adjustedK = adjustedK * ipScale;

    // Regression formula with quartile-aware adjusted strength
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
   * @param isDebugPlayer - Whether to log debug info (default false)
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
    const scoutWeight = 1 - statsWeight;
    const blended = statsWeight * regressedRate + scoutWeight * scoutingExpectedRate;

    return blended;
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
   * Calculate continuous targetOffset based on estimated FIP
   *
   * Uses piecewise linear interpolation to create smooth transitions:
   * - FIP < 3.0:  -3.0 (generational talent)
   * - FIP 3.0:    -2.8 (elite ace)
   * - FIP 3.5:    -2.0 (top 20 pitcher)
   * - FIP 4.0:    -0.8 (top quartile)
   * - FIP 4.2:     0.0 (league average)
   * - FIP 4.5:    +1.0 (below average)
   * - FIP 5.0:    +1.5 (poor)
   * - FIP > 5.0:  +1.5 (capped)
   *
   * This prevents bunching by creating a smooth gradient
   */
  private calculateTargetOffset(estimatedFip: number): number {
    // Define breakpoints for piecewise linear function
    const breakpoints = [
      { fip: 2.5, offset: -3.0 },
      { fip: 3.0, offset: -2.8 },
      { fip: 3.5, offset: -2.0 },
      { fip: 4.0, offset: -0.8 },
      { fip: 4.2, offset: 0.0 },
      { fip: 4.5, offset: 1.0 },
      { fip: 5.0, offset: 1.5 },
      { fip: 6.0, offset: 1.5 }  // Cap at 1.5 for very poor pitchers
    ];

    // Find the two breakpoints to interpolate between
    if (estimatedFip <= breakpoints[0].fip) {
      return breakpoints[0].offset;
    }
    if (estimatedFip >= breakpoints[breakpoints.length - 1].fip) {
      return breakpoints[breakpoints.length - 1].offset;
    }

    // Linear interpolation between breakpoints
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const lower = breakpoints[i];
      const upper = breakpoints[i + 1];

      if (estimatedFip >= lower.fip && estimatedFip <= upper.fip) {
        const t = (estimatedFip - lower.fip) / (upper.fip - lower.fip);
        return lower.offset + t * (upper.offset - lower.offset);
      }
    }

    return 0.0; // Fallback (shouldn't reach here)
  }

  /**
   * Calculate continuous strengthMultiplier based on estimated FIP
   *
   * Elite pitchers get LESS regression (lower multiplier = trust their stats more)
   * Poor pitchers get MORE regression (higher multiplier = regress harder to mean)
   *
   * - FIP < 3.5:  1.30 (trust elite stats)
   * - FIP 3.5-4.0: 1.50 (moderate)
   * - FIP 4.0-4.5: 1.80 (average)
   * - FIP > 4.5:  2.00 (regress poor pitchers hard)
   */
  private calculateStrengthMultiplier(estimatedFip: number): number {
    // Calibrated Feb 2026: lowered elite multiplier from 1.30 → 0.80
    // to reduce over-regression of proven elite pitchers (pitcher WAR compression fix)
    if (estimatedFip < 3.5) return 0.80;
    if (estimatedFip < 4.0) return 1.50;
    if (estimatedFip < 4.5) return 1.80;
    return 2.00;
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
   * TIER-AWARE PERCENTILES (Jan 2026):
   * Ranks pitchers WITHIN their role tier to prevent relievers from dominating
   * the top percentiles due to their higher K/9 regression baselines.
   *
   * - Starters (SP): Ranked against other starters
   * - Swingmen (SW): Ranked against other swingmen
   * - Relievers (RP): Ranked against other relievers
   *
   * Uses role if available (from player attributes), otherwise falls back to IP.
   *
   * Each tier gets its own 0-100 percentile distribution, so a 5.0 reliever
   * represents top 2.3% of relievers (not top 2.3% overall).
   *
   * Mutates the results array to add percentile values
   */
  calculatePercentiles(results: TrueRatingResult[]): void {
    if (results.length === 0) return;

    // Separate pitchers into tiers based on role (or IP if role not available)
    const starters = results.filter(r => (r.role ?? getRoleFromIp(r.totalIp)) === 'SP');
    const swingmen = results.filter(r => (r.role ?? getRoleFromIp(r.totalIp)) === 'SW');
    const relievers = results.filter(r => (r.role ?? getRoleFromIp(r.totalIp)) === 'RP');

    // Calculate percentiles within each tier
    this.calculatePercentilesForTier(starters);
    this.calculatePercentilesForTier(swingmen);
    this.calculatePercentilesForTier(relievers);
  }

  /**
   * Calculate percentiles for a single tier of pitchers
   * (Internal helper for tier-aware percentile calculation)
   */
  private calculatePercentilesForTier(tierResults: TrueRatingResult[]): void {
    if (tierResults.length === 0) return;

    // Sort by fipLike ascending (lower is better)
    const sorted = [...tierResults].sort((a, b) => a.fipLike - b.fipLike);

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
    const n = tierResults.length;
    tierResults.forEach(result => {
      const rank = ranks.get(result.playerId) || n;
      result.percentile = Math.round(((n - rank + 0.5) / n) * 1000) / 10;
    });
  }

  /**
   * Convert percentile to True Rating (0.5-5.0 scale)
   *
   * Uses bell curve buckets based on normal distribution
   * Public so external callers can convert custom percentile calculations
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
   * Inverse of: K/9 = 2.10 + 0.074×Stuff (must match PotentialStatsService forward formula)
   * Stuff = (K/9 - 2.10) / 0.074
   */
  private estimateStuffFromK9(k9: number): number {
    const rating = (k9 - 2.10) / 0.074;
    // Internal range: 0-100 (wider than display range of 20-80)
    return Math.max(0, Math.min(100, rating));
  }

  /**
   * Estimate Control rating from BB/9
   * Inverse of: BB/9 = 5.30 - 0.052×Control (must match PotentialStatsService forward formula)
   * Control = (5.30 - BB/9) / 0.052
   */
  private estimateControlFromBb9(bb9: number): number {
    const rating = (5.30 - bb9) / 0.052;
    // Internal range: 0-100 (wider than display range of 20-80)
    return Math.max(0, Math.min(100, rating));
  }

  /**
   * Estimate HRA rating from HR/9
   * Inverse of: HR/9 = 2.18 - 0.024×HRA (must match PotentialStatsService forward formula)
   * HRA = (2.18 - HR/9) / 0.024
   */
  private estimateHraFromHr9(hr9: number): number {
    const rating = (2.18 - hr9) / 0.024;
    // Internal range: 0-100 (wider than display range of 20-80)
    return Math.max(0, Math.min(100, rating));
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
