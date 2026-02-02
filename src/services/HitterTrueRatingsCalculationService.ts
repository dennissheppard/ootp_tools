/**
 * HitterTrueRatingsCalculationService
 *
 * Calculates league-relative "True Ratings" (0.5-5.0 scale) for hitters
 * based on their performance stats, optionally blended with scouting data.
 *
 * Process:
 * 1. Multi-year weighted average (recent years weighted more)
 * 2. Regression toward league mean based on sample size
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
  estimatedBabip: number;
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

    // Step 2: Regression toward league mean
    let regressedBbPct = this.regressToMean(
      weighted.bbPct, weighted.totalPa, leagueAverages.avgBbPct, STABILIZATION.bbPct
    );
    let regressedKPct = this.regressToMean(
      weighted.kPct, weighted.totalPa, leagueAverages.avgKPct, STABILIZATION.kPct
    );
    let regressedIso = this.regressToMean(
      weighted.iso, weighted.totalPa, leagueAverages.avgIso, STABILIZATION.iso
    );
    let regressedAvg = this.regressToMean(
      weighted.avg, weighted.totalPa, leagueAverages.avgAvg, STABILIZATION.avg
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
    const estimatedBabip = this.estimateBabipFromAvg(blendedAvg);

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
      estimatedBabip: Math.round(estimatedBabip),
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
   * Regress a rate stat toward the league mean
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
    return {
      bbPct: HitterRatingEstimatorService.expectedBbPct(scouting.eye),
      kPct: HitterRatingEstimatorService.expectedKPct(scouting.avoidK),
      iso: HitterRatingEstimatorService.expectedIso(scouting.power),
      avg: HitterRatingEstimatorService.expectedAvg(scouting.babip),
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
    const sorted = [...results].sort((a, b) => b.woba - a.woba);

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
   */
  private estimatePowerFromIso(iso: number): number {
    // ISO = -0.088 + 0.0036 * power
    // power = (ISO + 0.088) / 0.0036
    const rating = (iso + 0.088) / 0.0036;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate Eye rating from BB%
   */
  private estimateEyeFromBbPct(bbPct: number): number {
    // BB% = -3.18 + 0.206 * eye
    // eye = (BB% + 3.18) / 0.206
    const rating = (bbPct + 3.18) / 0.206;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate AvoidK rating from K%
   */
  private estimateAvoidKFromKPct(kPct: number): number {
    // K% = 45.5 - 0.467 * avoidK
    // avoidK = (45.5 - K%) / 0.467
    const rating = (45.5 - kPct) / 0.467;
    return Math.max(20, Math.min(80, rating));
  }

  /**
   * Estimate BABIP rating from AVG
   */
  private estimateBabipFromAvg(avg: number): number {
    // AVG = 0.139 + 0.00236 * babip
    // babip = (AVG - 0.139) / 0.00236
    const rating = (avg - 0.139) / 0.00236;
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
