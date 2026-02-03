/**
 * HitterTrueRatingsCalculationService
 *
 * Calculates league-relative "True Ratings" (0.5-5.0 scale) for hitters
 * based on their performance stats, optionally blended with scouting data.
 *
 * Process:
 * 1. Multi-year weighted average (recent years weighted more)
 * 2. TIER-AWARE REGRESSION (prevents over-projection of bad hitters):
 *    - Elite performance (wOBA >= .380): Regress toward elite target
 *    - Good performance (.340-.380): Regress toward above-average target
 *    - Average performance (.300-.340): Regress toward league average
 *    - Below average (.260-.300): Regress toward below-average target
 *    - Poor performance (< .260): Minimal regression - trust their bad performance
 *    - Smooth blending between tiers to avoid cliffs
 * 3. Optional blend with scouting ratings
 * 4. Calculate wOBA (weighted On-Base Average)
 * 5. Rank percentile across all hitters
 * 6. Convert percentile to 0.5-5.0 rating scale
 */

import { HitterScoutingRatings } from '../models/ScoutingData';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';
import { SeasonStage } from './DateService';

// ============================================================================
// Interfaces
// ============================================================================

/**
 * Single year of hitting stats
 */
export interface YearlyHittingStats {
  year: number;
  pa: number;       // Plate appearances
  ab: number;       // At bats
  h: number;        // Hits
  d: number;        // Doubles
  t: number;        // Triples
  hr: number;       // Home runs
  bb: number;       // Walks
  k: number;        // Strikeouts
  sb?: number;      // Stolen bases
  cs?: number;      // Caught stealing
}

/**
 * Input for True Rating calculation
 */
export interface HitterTrueRatingInput {
  playerId: number;
  playerName: string;
  /** Multi-year stats (most recent first) */
  yearlyStats: YearlyHittingStats[];
  scoutingRatings?: HitterScoutingRatings;
}

/**
 * Output from True Rating calculation
 */
export interface HitterTrueRatingResult {
  playerId: number;
  playerName: string;
  /** Blended rate stats after all calculations */
  blendedBbPct: number;
  blendedKPct: number;
  blendedIso: number;
  blendedAvg: number;
  /** Estimated ratings (from performance, 20-80 scale) */
  estimatedPower: number;
  estimatedEye: number;
  estimatedAvoidK: number;
  estimatedContact: number;
  /** wOBA (weighted On-Base Average) - lower is worse */
  woba: number;
  /** Percentile rank (0-100, higher is better) */
  percentile: number;
  /** Final True Rating (0.5-5.0 scale) */
  trueRating: number;
  /** Total PA used in calculation */
  totalPa: number;
}

/**
 * League average rates needed for regression
 */
export interface HitterLeagueAverages {
  avgBbPct: number;   // League average BB%
  avgKPct: number;    // League average K%
  avgIso: number;     // League average ISO
  avgAvg: number;     // League average batting average
}

/**
 * Weighted rate stats after multi-year averaging
 */
interface WeightedRates {
  bbPct: number;
  kPct: number;
  iso: number;
  avg: number;
  doublesRate: number;
  triplesRate: number;
  totalPa: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Year weights for multi-year averaging (most recent first) */
const YEAR_WEIGHTS = [5, 3, 2];

/**
 * Get dynamic year weights based on the current stage of the season.
 */
export function getYearWeights(stage: SeasonStage): number[] {
  switch (stage) {
    case 'early':    return [0, 5, 3, 2];
    case 'q1_done':  return [1.0, 5.0, 2.5, 1.5];
    case 'q2_done':  return [2.5, 4.5, 2.0, 1.0];
    case 'q3_done':  return [4.0, 4.0, 1.5, 0.5];
    case 'complete': return [5, 3, 2, 0];
    default:         return [0, 5, 3, 2];
  }
}

/** Stabilization constants (PA needed for stat to stabilize) */
const STABILIZATION = {
  bbPct: 120,
  kPct: 60,
  iso: 160,
  avg: 400,  // Using lower value for regression purposes
};

/** PA threshold for scouting blend confidence */
const SCOUTING_BLEND_CONFIDENCE_PA = 200;

/** Default league averages (WBL calibrated) */
const DEFAULT_LEAGUE_AVERAGES: HitterLeagueAverages = {
  avgBbPct: 8.5,    // ~8.5% walk rate
  avgKPct: 22.0,    // ~22% strikeout rate
  avgIso: 0.140,    // ~.140 ISO
  avgAvg: 0.260,    // ~.260 batting average
};

/**
 * TIER-AWARE REGRESSION SYSTEM
 *
 * Similar to pitcher system, uses continuous sliding scale based on wOBA.
 * Prevents bunching by regressing elite hitters toward elite targets,
 * and poor hitters toward poor targets.
 *
 * wOBA breakpoints (piecewise linear interpolation):
 * - wOBA >= .400: targetOffset -0.040 (generational talent)
 * - wOBA .380:    targetOffset -0.030 (elite)
 * - wOBA .360:    targetOffset -0.020 (excellent)
 * - wOBA .340:    targetOffset -0.010 (above average)
 * - wOBA .320:    targetOffset  0.000 (league average)
 * - wOBA .300:    targetOffset +0.010 (below average)
 * - wOBA .280:    targetOffset +0.020 (poor)
 * - wOBA < .260:  targetOffset +0.025 (minimal regression for truly bad)
 */
const WOBA_REGRESSION_BREAKPOINTS = [
  { woba: 0.400, offset: -0.040 },
  { woba: 0.380, offset: -0.030 },
  { woba: 0.360, offset: -0.020 },
  { woba: 0.340, offset: -0.010 },
  { woba: 0.320, offset: 0.000 },
  { woba: 0.300, offset: 0.010 },
  { woba: 0.280, offset: 0.020 },
  { woba: 0.260, offset: 0.025 },
];

/**
 * Strength multiplier breakpoints based on wOBA
 * Elite hitters get weaker regression (lower multiplier)
 * Poor hitters get stronger regression toward poor targets
 */
const WOBA_STRENGTH_BREAKPOINTS = [
  { woba: 0.400, multiplier: 0.6 },  // Elite: weak regression
  { woba: 0.360, multiplier: 0.8 },  // Excellent: moderate-weak
  { woba: 0.320, multiplier: 1.0 },  // Average: normal
  { woba: 0.280, multiplier: 1.2 },  // Below avg: stronger
  { woba: 0.260, multiplier: 0.8 },  // Poor: trust the bad performance
];

/**
 * Percentile thresholds for True Rating conversion
 * Based on normal distribution (bell curve) buckets
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

/** wOBA weights (2024 FanGraphs linear weights) */
const WOBA_WEIGHTS = {
  bb: 0.69,
  single: 0.89,
  double: 1.27,
  triple: 1.62,
  hr: 2.10,
};

// ============================================================================
// Service Class
// ============================================================================

class HitterTrueRatingsCalculationService {
  /**
   * Calculate True Ratings for a list of hitters
   */
  calculateTrueRatings(
    inputs: HitterTrueRatingInput[],
    leagueAverages: HitterLeagueAverages = DEFAULT_LEAGUE_AVERAGES,
    yearWeights?: number[]
  ): HitterTrueRatingResult[] {
    // Step 1-4: Calculate blended rates for each hitter
    const results: HitterTrueRatingResult[] = inputs.map(input =>
      this.calculateSingleHitter(input, leagueAverages, yearWeights)
    );

    // Step 5: Calculate percentiles across all hitters
    this.calculatePercentiles(results);

    // Step 6: Convert percentiles to ratings
    results.forEach(result => {
      result.trueRating = this.percentileToRating(result.percentile);
    });

    return results;
  }

  /**
   * Calculate blended rates and wOBA for a single hitter
   */
  calculateSingleHitter(
    input: HitterTrueRatingInput,
    leagueAverages: HitterLeagueAverages = DEFAULT_LEAGUE_AVERAGES,
    yearWeights?: number[]
  ): HitterTrueRatingResult {
    // Step 1: Multi-year weighted average
    const weighted = this.calculateWeightedRates(input.yearlyStats, yearWeights);

    // Step 2: Tier-aware regression (based on estimated wOBA performance)
    // First calculate raw wOBA to determine performance tier
    const rawWoba = this.calculateWobaFromRates(
      weighted.bbPct, weighted.kPct, weighted.iso, weighted.avg
    );

    let regressedBbPct = this.regressToMeanTierAware(
      weighted.bbPct, weighted.totalPa, leagueAverages.avgBbPct, STABILIZATION.bbPct, 'bbPct', rawWoba
    );
    let regressedKPct = this.regressToMeanTierAware(
      weighted.kPct, weighted.totalPa, leagueAverages.avgKPct, STABILIZATION.kPct, 'kPct', rawWoba
    );
    let regressedIso = this.regressToMeanTierAware(
      weighted.iso, weighted.totalPa, leagueAverages.avgIso, STABILIZATION.iso, 'iso', rawWoba
    );
    let regressedAvg = this.regressToMeanTierAware(
      weighted.avg, weighted.totalPa, leagueAverages.avgAvg, STABILIZATION.avg, 'avg', rawWoba
    );

    // Step 3: Optional scouting blend
    let blendedBbPct = regressedBbPct;
    let blendedKPct = regressedKPct;
    let blendedIso = regressedIso;
    let blendedAvg = regressedAvg;

    if (input.scoutingRatings) {
      const scoutExpected = this.scoutingToExpectedRates(input.scoutingRatings);
      blendedBbPct = this.blendWithScouting(regressedBbPct, scoutExpected.bbPct, weighted.totalPa);
      blendedKPct = this.blendWithScouting(regressedKPct, scoutExpected.kPct, weighted.totalPa);
      blendedIso = this.blendWithScouting(regressedIso, scoutExpected.iso, weighted.totalPa);
      blendedAvg = this.blendWithScouting(regressedAvg, scoutExpected.avg, weighted.totalPa);
    }

    // Estimate ratings from blended rates
    const estimatedPower = this.estimatePowerFromIso(blendedIso);
    const estimatedEye = this.estimateEyeFromBbPct(blendedBbPct);
    const estimatedAvoidK = this.estimateAvoidKFromKPct(blendedKPct);
    const estimatedContact = this.estimateContactFromAvg(blendedAvg);

    // Step 4: Calculate wOBA from blended rates
    const woba = this.calculateWobaFromRates(blendedBbPct, blendedKPct, blendedIso, blendedAvg);

    return {
      playerId: input.playerId,
      playerName: input.playerName,
      blendedBbPct: Math.round(blendedBbPct * 10) / 10,
      blendedKPct: Math.round(blendedKPct * 10) / 10,
      blendedIso: Math.round(blendedIso * 1000) / 1000,
      blendedAvg: Math.round(blendedAvg * 1000) / 1000,
      estimatedPower: Math.round(estimatedPower),
      estimatedEye: Math.round(estimatedEye),
      estimatedAvoidK: Math.round(estimatedAvoidK),
      estimatedContact: Math.round(estimatedContact),
      woba: Math.round(woba * 1000) / 1000,
      percentile: 0,
      trueRating: 0,
      totalPa: Math.round(weighted.totalPa),
    };
  }

  /**
   * Calculate multi-year weighted average of rate stats
   */
  calculateWeightedRates(
    yearlyStats: YearlyHittingStats[],
    yearWeights: number[] = YEAR_WEIGHTS
  ): WeightedRates {
    if (yearlyStats.length === 0) {
      return { bbPct: 0, kPct: 0, iso: 0, avg: 0, doublesRate: 0, triplesRate: 0, totalPa: 0 };
    }

    let weightedBbPctSum = 0;
    let weightedKPctSum = 0;
    let weightedIsoSum = 0;
    let weightedAvgSum = 0;
    let weightedDoublesSum = 0;
    let weightedTriplesSum = 0;
    let totalWeight = 0;
    let totalPa = 0;

    const yearsToProcess = Math.min(yearlyStats.length, yearWeights.length);

    for (let i = 0; i < yearsToProcess; i++) {
      const stats = yearlyStats[i];
      const yearWeight = yearWeights[i];

      if (yearWeight === 0 || stats.pa === 0) continue;

      // Calculate rate stats for this year
      const bbPct = (stats.bb / stats.pa) * 100;
      const kPct = (stats.k / stats.pa) * 100;
      const singles = stats.h - stats.d - stats.t - stats.hr;
      const totalBases = singles + 2 * stats.d + 3 * stats.t + 4 * stats.hr;
      const iso = stats.ab > 0 ? (totalBases - stats.h) / stats.ab : 0;
      const avg = stats.ab > 0 ? stats.h / stats.ab : 0;
      const doublesRate = stats.ab > 0 ? stats.d / stats.ab : 0;
      const triplesRate = stats.ab > 0 ? stats.t / stats.ab : 0;

      const weight = yearWeight * stats.pa;

      weightedBbPctSum += bbPct * weight;
      weightedKPctSum += kPct * weight;
      weightedIsoSum += iso * weight;
      weightedAvgSum += avg * weight;
      weightedDoublesSum += doublesRate * weight;
      weightedTriplesSum += triplesRate * weight;

      totalWeight += weight;
      totalPa += stats.pa;
    }

    if (totalWeight === 0) {
      return { bbPct: 0, kPct: 0, iso: 0, avg: 0, doublesRate: 0, triplesRate: 0, totalPa: 0 };
    }

    return {
      bbPct: weightedBbPctSum / totalWeight,
      kPct: weightedKPctSum / totalWeight,
      iso: weightedIsoSum / totalWeight,
      avg: weightedAvgSum / totalWeight,
      doublesRate: weightedDoublesSum / totalWeight,
      triplesRate: weightedTriplesSum / totalWeight,
      totalPa,
    };
  }

  /**
   * Simple regression toward league mean (legacy method, kept for backwards compatibility)
   */
  regressToMean(
    weightedRate: number,
    totalPa: number,
    leagueRate: number,
    stabilizationK: number
  ): number {
    if (totalPa + stabilizationK === 0) {
      return leagueRate;
    }
    return (weightedRate * totalPa + leagueRate * stabilizationK) / (totalPa + stabilizationK);
  }

  /**
   * Tier-aware regression toward performance-appropriate target
   *
   * CONTINUOUS SLIDING SCALE REGRESSION:
   * - Elite hitters (wOBA >= .380): Regress toward elite targets
   * - Average hitters (.300-.340): Regress toward league average
   * - Poor hitters (< .280): Minimal regression - trust bad performance
   *
   * Also includes PA-aware scaling to reduce regression for low-PA hitters.
   */
  regressToMeanTierAware(
    weightedRate: number,
    totalPa: number,
    leagueRate: number,
    stabilizationK: number,
    statType: 'bbPct' | 'kPct' | 'iso' | 'avg',
    estimatedWoba: number
  ): number {
    if (totalPa + stabilizationK === 0) {
      return leagueRate;
    }

    // Calculate target offset based on wOBA performance tier
    const targetOffset = this.calculateWobaTargetOffset(estimatedWoba);
    const strengthMultiplier = this.calculateWobaStrengthMultiplier(estimatedWoba);

    // Calculate regression target based on performance tier
    // Offset represents deviation from league average in wOBA units
    // Convert wOBA offset to component-specific targets
    let regressionTarget = leagueRate;

    // Different stats contribute differently to wOBA
    // BB%: Higher is better → positive offset means regress toward HIGHER BB%
    // K%:  Lower is better → positive offset means regress toward HIGHER K% (worse)
    // ISO: Higher is better → positive offset means regress toward HIGHER ISO
    // AVG: Higher is better → positive offset means regress toward HIGHER AVG
    switch (statType) {
      case 'bbPct':
        // BB% correlates positively with wOBA
        // Elite hitters (negative offset) regress toward HIGHER BB%
        regressionTarget = leagueRate - (targetOffset * 30); // ~3% BB% shift per .010 wOBA
        break;
      case 'kPct':
        // K% correlates negatively with wOBA
        // Elite hitters (negative offset) regress toward LOWER K%
        regressionTarget = leagueRate + (targetOffset * 50); // ~5% K% shift per .010 wOBA
        break;
      case 'iso':
        // ISO correlates positively with wOBA
        // Elite hitters (negative offset) regress toward HIGHER ISO
        regressionTarget = leagueRate - (targetOffset * 1.5); // ~.015 ISO shift per .010 wOBA
        break;
      case 'avg':
        // AVG correlates positively with wOBA
        // Elite hitters (negative offset) regress toward HIGHER AVG
        regressionTarget = leagueRate - (targetOffset * 0.8); // ~.008 AVG shift per .010 wOBA
        break;
    }

    // Apply tier-specific regression strength
    let adjustedK = stabilizationK * strengthMultiplier;

    // PA-AWARE SCALING: Reduce regression strength for low-PA hitters
    // Low PA (100): paScale = 0.60 (40% reduction in regression)
    // Medium PA (300): paScale = 0.85 (15% reduction)
    // High PA (500+): paScale = 1.0 (no reduction)
    const paConfidence = Math.min(1.0, totalPa / 500);
    const paScale = 0.5 + (paConfidence * 0.5); // 0.5 to 1.0 scale
    adjustedK = adjustedK * paScale;

    // Regression formula with tier-aware adjusted strength
    return (weightedRate * totalPa + regressionTarget * adjustedK) / (totalPa + adjustedK);
  }

  /**
   * Calculate continuous target offset based on wOBA
   * Uses piecewise linear interpolation
   */
  private calculateWobaTargetOffset(estimatedWoba: number): number {
    const breakpoints = WOBA_REGRESSION_BREAKPOINTS;

    // Handle edge cases
    if (estimatedWoba >= breakpoints[0].woba) {
      return breakpoints[0].offset;
    }
    if (estimatedWoba <= breakpoints[breakpoints.length - 1].woba) {
      return breakpoints[breakpoints.length - 1].offset;
    }

    // Linear interpolation between breakpoints
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const upper = breakpoints[i];
      const lower = breakpoints[i + 1];

      if (estimatedWoba <= upper.woba && estimatedWoba >= lower.woba) {
        const t = (estimatedWoba - lower.woba) / (upper.woba - lower.woba);
        return lower.offset + t * (upper.offset - lower.offset);
      }
    }

    return 0.0; // Fallback
  }

  /**
   * Calculate regression strength multiplier based on wOBA
   * Uses piecewise linear interpolation
   */
  private calculateWobaStrengthMultiplier(estimatedWoba: number): number {
    const breakpoints = WOBA_STRENGTH_BREAKPOINTS;

    // Handle edge cases
    if (estimatedWoba >= breakpoints[0].woba) {
      return breakpoints[0].multiplier;
    }
    if (estimatedWoba <= breakpoints[breakpoints.length - 1].woba) {
      return breakpoints[breakpoints.length - 1].multiplier;
    }

    // Linear interpolation between breakpoints
    for (let i = 0; i < breakpoints.length - 1; i++) {
      const upper = breakpoints[i];
      const lower = breakpoints[i + 1];

      if (estimatedWoba <= upper.woba && estimatedWoba >= lower.woba) {
        const t = (estimatedWoba - lower.woba) / (upper.woba - lower.woba);
        return lower.multiplier + t * (upper.multiplier - lower.multiplier);
      }
    }

    return 1.0; // Fallback
  }

  /**
   * Blend regressed stats with scouting-expected rates
   */
  blendWithScouting(
    regressedRate: number,
    scoutingExpectedRate: number,
    totalPa: number,
    confidencePa: number = SCOUTING_BLEND_CONFIDENCE_PA
  ): number {
    const statsWeight = totalPa / (totalPa + confidencePa);
    const scoutWeight = 1 - statsWeight;
    return statsWeight * regressedRate + scoutWeight * scoutingExpectedRate;
  }

  /**
   * Convert scouting ratings to expected rate stats
   */
  private scoutingToExpectedRates(scouting: HitterScoutingRatings): {
    bbPct: number;
    kPct: number;
    iso: number;
    avg: number;
  } {
    // Validate required scouting fields
    if (scouting.contact == null || Number.isNaN(scouting.contact)) {
      throw new Error(`Missing contact rating for player ${scouting.playerId}. Please clear cached data and re-run onboarding to reload scouting data.`);
    }
    return {
      bbPct: HitterRatingEstimatorService.expectedBbPct(scouting.eye),
      kPct: HitterRatingEstimatorService.expectedKPct(scouting.avoidK),
      iso: HitterRatingEstimatorService.expectedIso(scouting.power),
      avg: HitterRatingEstimatorService.expectedAvg(scouting.contact),
    };
  }

  /**
   * Calculate wOBA from rate stats
   * This is an approximation since we don't have exact counting stats
   */
  calculateWobaFromRates(bbPct: number, _kPct: number, iso: number, avg: number): number {
    // Approximate plate appearance outcomes
    // Note: kPct not directly used in wOBA calculation but kept for API consistency
    const bbRate = bbPct / 100;
    const hitRate = avg * (1 - bbRate); // Approximate hit rate accounting for walks

    // Rough estimates of hit types based on ISO/AVG relationship
    // Average distribution: ~65% singles, ~20% doubles, ~3% triples, ~12% HR
    // Adjust based on ISO (higher ISO = more HR/XBH)
    const isoFactor = iso / 0.140; // Normalize to league average
    const hrRate = hitRate * 0.12 * isoFactor;
    const tripleRate = hitRate * 0.03;
    const doubleRate = hitRate * 0.20;
    const singleRate = hitRate - hrRate - tripleRate - doubleRate;

    // Calculate wOBA
    const woba =
      WOBA_WEIGHTS.bb * bbRate +
      WOBA_WEIGHTS.single * Math.max(0, singleRate) +
      WOBA_WEIGHTS.double * doubleRate +
      WOBA_WEIGHTS.triple * tripleRate +
      WOBA_WEIGHTS.hr * hrRate;

    return Math.max(0.200, Math.min(0.500, woba));
  }

  /**
   * Calculate percentile rankings for all hitters
   */
  calculatePercentiles(results: HitterTrueRatingResult[]): void {
    if (results.length === 0) return;

    // Sort by wOBA descending (higher is better)
    // Handle NaN values to prevent infinite sort loop
    const sorted = [...results].sort((a, b) => {
      const aWoba = Number.isNaN(a.woba) ? 0 : a.woba;
      const bWoba = Number.isNaN(b.woba) ? 0 : b.woba;
      return bWoba - aWoba;
    });

    // Assign ranks (handle ties with average rank)
    const ranks = new Map<number, number>();
    let i = 0;
    while (i < sorted.length) {
      const currentWoba = sorted[i].woba;
      let j = i;
      while (j < sorted.length && sorted[j].woba === currentWoba) {
        j++;
      }
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) {
        ranks.set(sorted[k].playerId, avgRank);
      }
      i = j;
    }

    // Convert rank to percentile (higher woba = higher percentile)
    const n = results.length;
    results.forEach(result => {
      const rank = ranks.get(result.playerId) || n;
      result.percentile = Math.round(((n - rank + 0.5) / n) * 1000) / 10;
    });
  }

  /**
   * Convert percentile to True Rating (0.5-5.0 scale)
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
   * Estimate Power rating from ISO
   *
   * Uses INVERSE of HitterRatingEstimatorService.expectedIso() coefficients.
   * Note: expectedIso uses HR% conversion with approximate ISO factor,
   * but we estimate from ISO directly here. The coefficients should be
   * calibrated to match the round-trip behavior.
   *
   * HR% = -1.30 + 0.058434 * power (from HitterRatingEstimatorService)
   * ISO ≈ HR% * 3 + 0.05 (approximate conversion used in expectedIso)
   *
   * For consistency, derive power from ISO using the inverse relationship.
   */
  private estimatePowerFromIso(iso: number): number {
    // ISO ≈ HR% * 3 + 0.05, so HR% ≈ (ISO - 0.05) / 3
    // HR% = -1.30 + 0.058434 * power
    // power = (HR% + 1.30) / 0.058434
    const hrPct = (iso - 0.05) / 3 * 100; // Convert ISO to HR%
    const rating = (hrPct + 1.30) / 0.058434;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate Eye rating from BB%
   *
   * Uses INVERSE of HitterRatingEstimatorService.expectedBbPct() coefficients.
   * BB% = 0.64 + 0.114789 * eye (from HitterRatingEstimatorService)
   * eye = (BB% - 0.64) / 0.114789
   */
  private estimateEyeFromBbPct(bbPct: number): number {
    // MUST match inverse of HitterRatingEstimatorService coefficients
    // BB% = 0.64 + 0.114789 * eye
    // eye = (BB% - 0.64) / 0.114789
    const rating = (bbPct - 0.64) / 0.114789;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate AvoidK rating from K%
   *
   * Uses INVERSE of HitterRatingEstimatorService.expectedKPct() coefficients.
   * K% = 25.35 - 0.200303 * avoidK (from HitterRatingEstimatorService)
   * avoidK = (25.35 - K%) / 0.200303
   */
  private estimateAvoidKFromKPct(kPct: number): number {
    // MUST match inverse of HitterRatingEstimatorService coefficients
    // K% = 25.35 + (-0.200303) * avoidK = 25.35 - 0.200303 * avoidK
    // avoidK = (25.35 - K%) / 0.200303
    const rating = (25.35 - kPct) / 0.200303;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate Contact rating from AVG
   *
   * Uses INVERSE of HitterRatingEstimatorService.expectedAvg() coefficients.
   * AVG = 0.0772 + 0.00316593 * contact (from HitterRatingEstimatorService)
   * contact = (AVG - 0.0772) / 0.00316593
   */
  private estimateContactFromAvg(avg: number): number {
    // MUST match inverse of HitterRatingEstimatorService coefficients
    // AVG = 0.0772 + 0.00316593 * contact
    // contact = (AVG - 0.0772) / 0.00316593
    const rating = (avg - 0.0772) / 0.00316593;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Get default league averages
   */
  getDefaultLeagueAverages(): HitterLeagueAverages {
    return { ...DEFAULT_LEAGUE_AVERAGES };
  }

  /**
   * Get stabilization constants
   */
  getStabilizationConstants(): typeof STABILIZATION {
    return { ...STABILIZATION };
  }
}

export const hitterTrueRatingsCalculationService = new HitterTrueRatingsCalculationService();
export { HitterTrueRatingsCalculationService };
