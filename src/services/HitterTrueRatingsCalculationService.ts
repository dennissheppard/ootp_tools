/**
 * HitterTrueRatingsCalculationService
 *
 * Calculates league-relative "True Ratings" (0.5-5.0 scale) for hitters
 * based on their performance stats, optionally blended with scouting data.
 *
 * Process:
 * 1. Multi-year weighted average (recent years weighted more)
 * 2. TIER-AWARE REGRESSION for BB%, K%, ISO, AVG (prevents over-projection of bad hitters):
 *    - Elite performance (wOBA >= .380): Regress toward elite target
 *    - Good performance (.340-.380): Regress toward above-average target
 *    - Average performance (.300-.340): Regress toward league average
 *    - Below average (.260-.300): Regress toward below-average target
 *    - Poor performance (< .260): Minimal regression - trust their bad performance
 *    - Smooth blending between tiers to avoid cliffs
 *    - NOTE: HR% is NOT regressed here - the projection coefficient handles it
 * 3. Optional blend with scouting ratings
 * 4. Calculate wOBA (weighted On-Base Average)
 * 5. Rank percentile across all hitters
 * 6. Convert percentile to 0.5-5.0 rating scale
 */

import { HitterScoutingRatings } from '../models/ScoutingData';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';
import type { SeasonStage } from './DateService';
import { LeagueBattingAverages } from './LeagueBattingAveragesService';

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
  blendedHrPct: number;
  blendedIso: number;
  blendedAvg: number;
  blendedDoublesRate: number;
  blendedTriplesRate: number;
  /** Estimated ratings (from performance, 20-80 scale) */
  estimatedPower: number;
  estimatedEye: number;
  estimatedAvoidK: number;
  estimatedContact: number;
  estimatedGap: number;
  estimatedSpeed: number;
  /** wOBA (weighted On-Base Average) - lower is worse */
  woba: number;
  /** WAR per 600 PA (used for ranking) */
  war: number;
  /** Percentile rank (0-100, higher is better) */
  percentile: number;
  /** Final True Rating (0.5-5.0 scale) */
  trueRating: number;
  /** Total PA used in calculation */
  totalPa: number;
}

export interface HitterRegressionTrace {
  weightedRate: number;
  totalPa: number;
  leagueRate: number;
  stabilizationK: number;
  statType: 'bbPct' | 'kPct' | 'iso' | 'avg';
  estimatedWoba: number;
  targetOffset: number;
  strengthMultiplier: number;
  regressionTarget: number;
  adjustedKBeforePaScale: number;
  paScale: number;
  adjustedKAfterPaScale: number;
  regressedRate: number;
}

export interface HitterTrueRatingTrace {
  input?: {
    playerId: number;
    playerName: string;
    yearlyStats: YearlyHittingStats[];
    yearWeights: number[];
    hasScouting: boolean;
  };
  weightedRates?: {
    bbPct: number;
    kPct: number;
    hrPct: number;
    iso: number;
    avg: number;
    doublesRate: number;
    triplesRate: number;
    sbPerPa: number;
    csPerPa: number;
    totalPa: number;
  };
  rawWoba?: number;
  regression?: {
    bbPct: HitterRegressionTrace;
    kPct: HitterRegressionTrace;
    iso: HitterRegressionTrace;
    avg: HitterRegressionTrace;
  };
  scoutingBlend?: {
    effectiveDevRatio: number;
    scoutingExpectedRates: { bbPct: number; kPct: number; hrPct: number; iso: number; avg: number };
    weights: {
      bbPct: { baseScoutWeight: number; scoutBoost: number; scoutWeight: number; confidencePa: number };
      kPct: { baseScoutWeight: number; scoutBoost: number; scoutWeight: number; confidencePa: number };
      hrPct: { baseScoutWeight: number; scoutBoost: number; scoutWeight: number; confidencePa: number };
      avg: { baseScoutWeight: number; scoutBoost: number; scoutWeight: number; confidencePa: number };
    };
    regressedRates: { bbPct: number; kPct: number; hrPct: number; iso: number; avg: number };
    blendedRates: { bbPct: number; kPct: number; hrPct: number; iso: number; avg: number };
  };
  output?: {
    blendedBbPct: number;
    blendedKPct: number;
    blendedHrPct: number;
    blendedIso: number;
    blendedAvg: number;
    woba: number;
  };
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
  hrPct: number;
  iso: number;
  avg: number;
  doublesRate: number;
  triplesRate: number;
  sbPerPa: number;
  csPerPa: number;
  totalPa: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Year weights for multi-year averaging (most recent first) */
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

/** Stabilization constants (PA needed for stat to stabilize) */
const STABILIZATION = {
  bbPct: 120,
  kPct: 60,
  hrPct: 160,
  iso: 160,
  avg: 300,  // Reduced from 400 to trust elite hitters with 500+ PA more
};

/**
 * Component-specific PA thresholds for scouting blend confidence.
 *
 * At the threshold PA, blend is 50/50 stats/scouting.
 * Scouting blend target is OVR/POT-scaled potential (not raw potential),
 * so these thresholds remain appropriate.
 *
 * - K%:  Lower threshold (120 PA) — K% stabilizes quickly, stats are predictive
 * - BB%: Medium threshold (200 PA) — Stabilizes at 120 PA
 * - HR%: Higher threshold (350 PA) — Power volatile, scouts see bat speed early
 * - AVG: Higher threshold (350 PA) — Stabilizes at 300 PA
 */
const SCOUTING_BLEND_THRESHOLDS = {
  kPct: 120,
  bbPct: 200,
  hrPct: 350,
  avg: 350,
};

/** Fallback threshold when component not specified */
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
    yearWeights?: number[],
    leagueBattingAverages?: LeagueBattingAverages
  ): HitterTrueRatingResult[] {
    // Step 1: Compute weighted rates for each player (needed for SB/CS rates)
    const weightedRatesMap = new Map<number, WeightedRates>();
    for (const input of inputs) {
      const weighted = this.calculateWeightedRates(input.yearlyStats, yearWeights);
      weightedRatesMap.set(input.playerId, weighted);
    }

    // Step 2-4: Calculate blended rates and wOBA for each hitter
    const results: HitterTrueRatingResult[] = inputs.map(input =>
      this.calculateSingleHitter(input, leagueAverages, yearWeights)
    );

    // Step 4.5: Calculate percentile-based component ratings
    this.calculateComponentRatingsFromPercentiles(results);

    // Step 4.6: Compute WAR per 600 PA for ranking
    const lgWoba = leagueBattingAverages?.lgWoba ?? 0.315;
    const wobaScale = leagueBattingAverages?.wobaScale ?? 1.15;
    const runsPerWin = leagueBattingAverages?.runsPerWin ?? 10;

    results.forEach(result => {
      const weighted = weightedRatesMap.get(result.playerId);
      const sbPerPa = weighted?.sbPerPa ?? 0;
      const csPerPa = weighted?.csPerPa ?? 0;

      // Standardized 600 PA for ranking (rate-stat based, not volume)
      const sb600 = sbPerPa * 600;
      const cs600 = csPerPa * 600;
      const sbRuns = sb600 * 0.2 - cs600 * 0.4;
      const wRAA = ((result.woba - lgWoba) / wobaScale) * 600;
      const replacementRuns = 20; // 20 runs per 600 PA
      result.war = Math.round(((wRAA + replacementRuns + sbRuns) / runsPerWin) * 10) / 10;
    });

    // Step 5: Calculate percentiles across all hitters (now by WAR instead of wOBA)
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
    yearWeights?: number[],
    trace?: HitterTrueRatingTrace
  ): HitterTrueRatingResult {
    const resolvedYearWeights = yearWeights ?? YEAR_WEIGHTS;

    // Step 1: Multi-year weighted average
    const weighted = this.calculateWeightedRates(input.yearlyStats, resolvedYearWeights);

    if (trace) {
      trace.input = {
        playerId: input.playerId,
        playerName: input.playerName,
        yearlyStats: input.yearlyStats.map((s) => ({ ...s })),
        yearWeights: [...resolvedYearWeights],
        hasScouting: !!input.scoutingRatings,
      };
      trace.weightedRates = { ...weighted };
    }

    // Step 2: Tier-aware regression (based on estimated wOBA performance)
    // First calculate raw wOBA to determine performance tier
    const rawWoba = this.calculateWobaFromRates(
      weighted.bbPct, weighted.kPct, weighted.iso, weighted.avg
    );

    if (trace) {
      trace.rawWoba = rawWoba;
    }

    const bbTrace: HitterRegressionTrace = {
      weightedRate: 0,
      totalPa: 0,
      leagueRate: 0,
      stabilizationK: 0,
      statType: 'bbPct',
      estimatedWoba: rawWoba,
      targetOffset: 0,
      strengthMultiplier: 0,
      regressionTarget: 0,
      adjustedKBeforePaScale: 0,
      paScale: 0,
      adjustedKAfterPaScale: 0,
      regressedRate: 0,
    };
    const kTrace: HitterRegressionTrace = {
      weightedRate: 0,
      totalPa: 0,
      leagueRate: 0,
      stabilizationK: 0,
      statType: 'kPct',
      estimatedWoba: rawWoba,
      targetOffset: 0,
      strengthMultiplier: 0,
      regressionTarget: 0,
      adjustedKBeforePaScale: 0,
      paScale: 0,
      adjustedKAfterPaScale: 0,
      regressedRate: 0,
    };
    const isoTrace: HitterRegressionTrace = {
      weightedRate: 0,
      totalPa: 0,
      leagueRate: 0,
      stabilizationK: 0,
      statType: 'iso',
      estimatedWoba: rawWoba,
      targetOffset: 0,
      strengthMultiplier: 0,
      regressionTarget: 0,
      adjustedKBeforePaScale: 0,
      paScale: 0,
      adjustedKAfterPaScale: 0,
      regressedRate: 0,
    };
    const avgTrace: HitterRegressionTrace = {
      weightedRate: 0,
      totalPa: 0,
      leagueRate: 0,
      stabilizationK: 0,
      statType: 'avg',
      estimatedWoba: rawWoba,
      targetOffset: 0,
      strengthMultiplier: 0,
      regressionTarget: 0,
      adjustedKBeforePaScale: 0,
      paScale: 0,
      adjustedKAfterPaScale: 0,
      regressedRate: 0,
    };

    let regressedBbPct = this.regressToMeanTierAware(
      weighted.bbPct, weighted.totalPa, leagueAverages.avgBbPct, STABILIZATION.bbPct, 'bbPct', rawWoba, trace ? bbTrace : undefined
    );
    let regressedKPct = this.regressToMeanTierAware(
      weighted.kPct, weighted.totalPa, leagueAverages.avgKPct, STABILIZATION.kPct, 'kPct', rawWoba, trace ? kTrace : undefined
    );
    // DON'T regress HR% - the projection coefficient already handles regression
    // implicitly (it's calibrated to actual historical outcomes). Multi-year
    // weighting already provides natural smoothing. Regressing here causes
    // "double regression" and under-projects elite power hitters by ~1% HR rate.
    let regressedHrPct = weighted.hrPct;
    let regressedIso = this.regressToMeanTierAware(
      weighted.iso, weighted.totalPa, leagueAverages.avgIso, STABILIZATION.iso, 'iso', rawWoba, trace ? isoTrace : undefined
    );
    let regressedAvg = this.regressToMeanTierAware(
      weighted.avg, weighted.totalPa, leagueAverages.avgAvg, STABILIZATION.avg, 'avg', rawWoba, trace ? avgTrace : undefined
    );

    if (trace) {
      trace.regression = {
        bbPct: bbTrace,
        kPct: kTrace,
        iso: isoTrace,
        avg: avgTrace,
      };
    }

    // Step 3: OVR/POT-scaled scouting blend
    // Scouting component ratings are POTENTIAL (ceiling) values, not current ability.
    // We scale them toward league average (50) by devRatio = OVR/POT before blending,
    // so a 2★/4★ player's blend target is halfway between league avg and their ceiling.
    let blendedBbPct = regressedBbPct;
    let blendedKPct = regressedKPct;
    let blendedHrPct = regressedHrPct;
    let blendedIso = regressedIso;
    let blendedAvg = regressedAvg;

    if (input.scoutingRatings) {
      const effectiveDevRatio = this.getEffectiveDevRatio(input.scoutingRatings, weighted.totalPa);
      const scoutExpected = this.scoutingToExpectedRates(input.scoutingRatings, effectiveDevRatio);
      const bbWeights = this.getScoutingBlendWeights(weighted.totalPa, SCOUTING_BLEND_THRESHOLDS.bbPct, effectiveDevRatio);
      const kWeights = this.getScoutingBlendWeights(weighted.totalPa, SCOUTING_BLEND_THRESHOLDS.kPct, effectiveDevRatio);
      const hrWeights = this.getScoutingBlendWeights(weighted.totalPa, SCOUTING_BLEND_THRESHOLDS.hrPct, effectiveDevRatio);
      const avgWeights = this.getScoutingBlendWeights(weighted.totalPa, SCOUTING_BLEND_THRESHOLDS.avg, effectiveDevRatio);

      blendedBbPct = (1 - bbWeights.scoutWeight) * regressedBbPct + bbWeights.scoutWeight * scoutExpected.bbPct;
      blendedKPct = (1 - kWeights.scoutWeight) * regressedKPct + kWeights.scoutWeight * scoutExpected.kPct;
      blendedHrPct = (1 - hrWeights.scoutWeight) * regressedHrPct + hrWeights.scoutWeight * scoutExpected.hrPct;
      blendedAvg = (1 - avgWeights.scoutWeight) * regressedAvg + avgWeights.scoutWeight * scoutExpected.avg;

      if (trace) {
        trace.scoutingBlend = {
          effectiveDevRatio,
          scoutingExpectedRates: { ...scoutExpected },
          weights: {
            bbPct: { ...bbWeights, confidencePa: SCOUTING_BLEND_THRESHOLDS.bbPct },
            kPct: { ...kWeights, confidencePa: SCOUTING_BLEND_THRESHOLDS.kPct },
            hrPct: { ...hrWeights, confidencePa: SCOUTING_BLEND_THRESHOLDS.hrPct },
            avg: { ...avgWeights, confidencePa: SCOUTING_BLEND_THRESHOLDS.avg },
          },
          regressedRates: {
            bbPct: regressedBbPct,
            kPct: regressedKPct,
            hrPct: regressedHrPct,
            iso: regressedIso,
            avg: regressedAvg,
          },
          blendedRates: {
            bbPct: blendedBbPct,
            kPct: blendedKPct,
            hrPct: blendedHrPct,
            iso: blendedIso,
            avg: blendedAvg,
          },
        };
      }
    }

    // Step 4: Calculate wOBA from blended rates (using HR% directly, not ISO)
    const woba = this.calculateWobaFromRates(blendedBbPct, blendedKPct, blendedHrPct, blendedAvg);

    if (trace) {
      trace.output = {
        blendedBbPct,
        blendedKPct,
        blendedHrPct,
        blendedIso,
        blendedAvg,
        woba,
      };
    }

    // Note: Component ratings (Power, Eye, AvK, Contact, Gap, Speed) will be calculated
    // via percentile ranking in calculateComponentRatingsFromPercentiles()
    // after all players' blended stats are determined

    return {
      playerId: input.playerId,
      playerName: input.playerName,
      blendedBbPct: Math.round(blendedBbPct * 10) / 10,
      blendedKPct: Math.round(blendedKPct * 10) / 10,
      blendedHrPct: Math.round(blendedHrPct * 10) / 10,
      blendedIso: Math.round(blendedIso * 1000) / 1000,
      blendedAvg: Math.round(blendedAvg * 1000) / 1000,
      blendedDoublesRate: Math.round(weighted.doublesRate * 10000) / 10000,
      blendedTriplesRate: Math.round(weighted.triplesRate * 10000) / 10000,
      estimatedPower: 0, // Calculated via percentile in next step
      estimatedEye: 0,   // Calculated via percentile in next step
      estimatedAvoidK: 0, // Calculated via percentile in next step
      estimatedContact: 0, // Calculated via percentile in next step
      estimatedGap: 0,    // Calculated via percentile in next step
      estimatedSpeed: 0,  // Calculated via percentile in next step
      woba: Math.round(woba * 1000) / 1000,
      war: 0, // Computed in calculateTrueRatings after all players processed
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
      return { bbPct: 0, kPct: 0, hrPct: 0, iso: 0, avg: 0, doublesRate: 0, triplesRate: 0, sbPerPa: 0, csPerPa: 0, totalPa: 0 };
    }

    let weightedBbPctSum = 0;
    let weightedKPctSum = 0;
    let weightedHrPctSum = 0;
    let weightedIsoSum = 0;
    let weightedAvgSum = 0;
    let weightedDoublesSum = 0;
    let weightedTriplesSum = 0;
    let weightedSbPerPaSum = 0;
    let weightedCsPerPaSum = 0;
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
      const hrPct = (stats.hr / stats.pa) * 100;
      const singles = stats.h - stats.d - stats.t - stats.hr;
      const totalBases = singles + 2 * stats.d + 3 * stats.t + 4 * stats.hr;
      const iso = stats.ab > 0 ? (totalBases - stats.h) / stats.ab : 0;
      const avg = stats.ab > 0 ? stats.h / stats.ab : 0;
      const doublesRate = stats.ab > 0 ? stats.d / stats.ab : 0;
      const triplesRate = stats.ab > 0 ? stats.t / stats.ab : 0;
      const sbPerPa = (stats.sb ?? 0) / stats.pa;
      const csPerPa = (stats.cs ?? 0) / stats.pa;

      const weight = yearWeight * stats.pa;

      weightedBbPctSum += bbPct * weight;
      weightedKPctSum += kPct * weight;
      weightedHrPctSum += hrPct * weight;
      weightedIsoSum += iso * weight;
      weightedAvgSum += avg * weight;
      weightedDoublesSum += doublesRate * weight;
      weightedTriplesSum += triplesRate * weight;
      weightedSbPerPaSum += sbPerPa * weight;
      weightedCsPerPaSum += csPerPa * weight;

      totalWeight += weight;
      totalPa += stats.pa;
    }

    if (totalWeight === 0) {
      return { bbPct: 0, kPct: 0, hrPct: 0, iso: 0, avg: 0, doublesRate: 0, triplesRate: 0, sbPerPa: 0, csPerPa: 0, totalPa: 0 };
    }

    return {
      bbPct: weightedBbPctSum / totalWeight,
      kPct: weightedKPctSum / totalWeight,
      hrPct: weightedHrPctSum / totalWeight,
      iso: weightedIsoSum / totalWeight,
      avg: weightedAvgSum / totalWeight,
      doublesRate: weightedDoublesSum / totalWeight,
      triplesRate: weightedTriplesSum / totalWeight,
      sbPerPa: weightedSbPerPaSum / totalWeight,
      csPerPa: weightedCsPerPaSum / totalWeight,
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
    estimatedWoba: number,
    trace?: HitterRegressionTrace
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
    const adjustedKBeforePaScale = adjustedK;

    // PA-AWARE SCALING: Reduce regression strength for low-PA hitters
    // Low PA (100): paScale = 0.60 (40% reduction in regression)
    // Medium PA (300): paScale = 0.85 (15% reduction)
    // High PA (500+): paScale = 1.0 (no reduction)
    const paConfidence = Math.min(1.0, totalPa / 500);
    const paScale = 0.5 + (paConfidence * 0.5); // 0.5 to 1.0 scale
    adjustedK = adjustedK * paScale;

    // Regression formula with tier-aware adjusted strength
    const regressedRate = (weightedRate * totalPa + regressionTarget * adjustedK) / (totalPa + adjustedK);

    if (trace) {
      trace.weightedRate = weightedRate;
      trace.totalPa = totalPa;
      trace.leagueRate = leagueRate;
      trace.stabilizationK = stabilizationK;
      trace.statType = statType;
      trace.estimatedWoba = estimatedWoba;
      trace.targetOffset = targetOffset;
      trace.strengthMultiplier = strengthMultiplier;
      trace.regressionTarget = regressionTarget;
      trace.adjustedKBeforePaScale = adjustedKBeforePaScale;
      trace.paScale = paScale;
      trace.adjustedKAfterPaScale = adjustedK;
      trace.regressedRate = regressedRate;
    }

    return regressedRate;
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
   * Blend regressed stats with scouting-expected rates.
   *
   * effectiveDevRatio BOOSTS scouting weight for unproven players.
   * Until a player has proven themselves (effectiveDevRatio → 1.0),
   * scouting gets a louder voice — anchoring both overperformers
   * and underperformers toward the (already development-scaled) target.
   *
   * Combined with target scaling in scoutingToExpectedRates, this creates
   * a double anchor: unproven players' targets are pulled toward league
   * average AND those targets get more weight.
   */
  blendWithScouting(
    regressedRate: number,
    scoutingExpectedRate: number,
    totalPa: number,
    confidencePa: number = SCOUTING_BLEND_CONFIDENCE_PA,
    effectiveDevRatio: number = 1.0,
  ): number {
    const { scoutWeight } = this.getScoutingBlendWeights(totalPa, confidencePa, effectiveDevRatio);
    return (1 - scoutWeight) * regressedRate + scoutWeight * scoutingExpectedRate;
  }

  private getScoutingBlendWeights(
    totalPa: number,
    confidencePa: number,
    effectiveDevRatio: number
  ): { baseScoutWeight: number; scoutBoost: number; scoutWeight: number } {
    const baseScoutWeight = confidencePa / (totalPa + confidencePa);
    const scoutBoost = 1 - effectiveDevRatio;
    const scoutWeight = Math.min(0.95, baseScoutWeight + scoutBoost * (1 - baseScoutWeight));
    return { baseScoutWeight, scoutBoost, scoutWeight };
  }

  /**
   * Compute effective development ratio combining star gap and MLB experience.
   *
   * Two independent signals for how "proven" a player is:
   * 1. Star gap (OVR/POT): How close to ceiling per the game's assessment
   * 2. PA accumulation: How much MLB evidence we have
   *
   * Uses geometric mean so scouting is suppressed when EITHER signal says
   * "unproven", but recovers when either signal is strong.
   *
   * Experience thresholds:
   * - With star gap (devRatio < 1.0): 1200 PA (~2 full seasons to develop)
   * - No star gap (devRatio = 1.0): 500 PA (~1 full season to "prove it")
   */
  private getEffectiveDevRatio(scouting: HitterScoutingRatings, totalPa: number): number {
    const ovr = scouting.ovr ?? scouting.pot ?? 3.0;
    const pot = scouting.pot ?? 3.0;
    const devRatio = pot > 0 ? Math.min(1.0, ovr / pot) : 1.0;

    const experienceThreshold = devRatio < 1.0 ? 1200 : 500;
    const experienceDev = Math.min(1.0, totalPa / experienceThreshold);

    return Math.sqrt(devRatio * experienceDev);
  }

  /**
   * Convert scouting ratings to expected rate stats, scaled toward league average.
   *
   * Scouting component ratings are POTENTIAL (ceiling) values. To estimate current ability,
   * we scale each component toward league average (50) by a development ratio:
   *   scaledComponent = 50 + (potential - 50) × devRatio
   *
   * When effectiveDevRatio is provided (geometric mean of star gap + MLB experience),
   * it pulls scouting targets closer to league average for unproven players. This works
   * symmetrically: it dampens scouting inflation for underperformers AND preserves
   * scouting's ability to pull down overperformers on small samples.
   *
   * @param scouting - Player's scouting ratings
   * @param effectiveDevRatio - Combined star-gap + experience ratio (0–1). If omitted,
   *   falls back to pure star-gap devRatio (OVR/POT).
   */
  private scoutingToExpectedRates(scouting: HitterScoutingRatings, effectiveDevRatio?: number): {
    bbPct: number;
    kPct: number;
    hrPct: number;
    iso: number;
    avg: number;
  } {
    if (scouting.contact == null || Number.isNaN(scouting.contact)) {
      throw new Error(`Missing contact rating for player ${scouting.playerId}. Please clear cached data and re-run onboarding to reload scouting data.`);
    }

    // Use effectiveDevRatio if provided (star gap + experience);
    // otherwise fall back to pure star-gap ratio
    const ovr = scouting.ovr ?? scouting.pot ?? 3.0;
    const pot = scouting.pot ?? 3.0;
    const devRatio = effectiveDevRatio ?? (pot > 0 ? Math.min(1.0, ovr / pot) : 1.0);

    // Scale each component from potential toward league average (50 on 20-80 scale)
    const LEAGUE_AVG = 50;
    const scale = (raw: number) => LEAGUE_AVG + (raw - LEAGUE_AVG) * devRatio;

    return {
      bbPct: HitterRatingEstimatorService.expectedBbPct(scale(scouting.eye)),
      kPct: HitterRatingEstimatorService.expectedKPct(scale(scouting.avoidK)),
      hrPct: HitterRatingEstimatorService.expectedHrPct(scale(scouting.power)),
      iso: HitterRatingEstimatorService.expectedIso(scale(scouting.power)),
      avg: HitterRatingEstimatorService.expectedAvg(scale(scouting.contact)),
    };
  }

  /**
   * Calculate wOBA from rate stats
   * Uses HR% directly (not ISO) per the HR%-based power estimation fix.
   */
  calculateWobaFromRates(bbPct: number, _kPct: number, hrPct: number, avg: number): number {
    // Approximate plate appearance outcomes
    const bbRate = bbPct / 100;
    const hrRate = hrPct / 100; // Use HR% directly, not ISO-derived
    const hitRate = avg * (1 - bbRate); // Approximate hit rate accounting for walks

    // Estimate hit type distribution (doubles, triples, singles)
    // HR rate is known directly, estimate the rest
    const tripleRate = hitRate * 0.03;
    const doubleRate = hitRate * 0.20;
    const singleRate = Math.max(0, hitRate - hrRate - tripleRate - doubleRate);

    // Calculate wOBA
    const woba =
      WOBA_WEIGHTS.bb * bbRate +
      WOBA_WEIGHTS.single * singleRate +
      WOBA_WEIGHTS.double * doubleRate +
      WOBA_WEIGHTS.triple * tripleRate +
      WOBA_WEIGHTS.hr * hrRate;

    return Math.max(0.200, Math.min(0.500, woba));
  }

  /**
   * Calculate component ratings (Power, Eye, AvK, Contact, Gap, Speed) from percentile rankings
   * within the season. This ensures the league leader always gets ~80 rating regardless
   * of absolute stat values, accounting for year-to-year offensive environment changes.
   */
  private calculateComponentRatingsFromPercentiles(results: HitterTrueRatingResult[]): void {
    if (results.length === 0) return;

    // Helper function to calculate percentile-based rating for a stat
    const calculateRatingFromPercentile = (
      results: HitterTrueRatingResult[],
      statGetter: (r: HitterTrueRatingResult) => number,
      ascending: boolean = false // false for stats where higher is better
    ): Map<number, number> => {
      // Sort by stat (handle NaN values)
      const sorted = [...results].sort((a, b) => {
        const aVal = Number.isNaN(statGetter(a)) ? (ascending ? Infinity : -Infinity) : statGetter(a);
        const bVal = Number.isNaN(statGetter(b)) ? (ascending ? Infinity : -Infinity) : statGetter(b);
        return ascending ? (aVal - bVal) : (bVal - aVal);
      });

      // Calculate percentile for each player
      const ratings = new Map<number, number>();
      sorted.forEach((result, index) => {
        // Percentile: 0 (worst) to 100 (best)
        const percentile = ((sorted.length - index - 1) / (sorted.length - 1)) * 100;

        // Map percentile to rating (20-80 display scale)
        // Linear transformation: rating = 20 + (percentile / 100) * 60
        // Top player (100%ile) → 80, Bottom player (0%ile) → 20, Median (50%ile) → 50
        const rating = 20 + (percentile / 100) * 60;
        ratings.set(result.playerId, Math.max(20, Math.min(80, rating)));
      });

      return ratings;
    };

    // Calculate ratings for each component
    const powerRatings = calculateRatingFromPercentile(results, r => r.blendedHrPct, false);
    const eyeRatings = calculateRatingFromPercentile(results, r => r.blendedBbPct, false);
    const avoidKRatings = calculateRatingFromPercentile(results, r => r.blendedKPct, true); // Lower K% is better
    const contactRatings = calculateRatingFromPercentile(results, r => r.blendedAvg, false);
    const gapRatings = calculateRatingFromPercentile(results, r => r.blendedDoublesRate, false); // Higher doubles = better gap
    const speedRatings = calculateRatingFromPercentile(results, r => r.blendedTriplesRate, false); // Higher triples = better speed

    // Assign ratings to each result
    results.forEach(result => {
      result.estimatedPower = Math.round(powerRatings.get(result.playerId) ?? 50);
      result.estimatedEye = Math.round(eyeRatings.get(result.playerId) ?? 50);
      result.estimatedAvoidK = Math.round(avoidKRatings.get(result.playerId) ?? 50);
      result.estimatedContact = Math.round(contactRatings.get(result.playerId) ?? 50);
      result.estimatedGap = Math.round(gapRatings.get(result.playerId) ?? 50);
      result.estimatedSpeed = Math.round(speedRatings.get(result.playerId) ?? 50);
    });
  }

  /**
   * Calculate percentile rankings for all hitters (ranked by WAR per 600 PA)
   */
  calculatePercentiles(results: HitterTrueRatingResult[]): void {
    if (results.length === 0) return;

    // Sort by WAR descending (higher is better)
    // Handle NaN values to prevent infinite sort loop
    const sorted = [...results].sort((a, b) => {
      const aWar = Number.isNaN(a.war) ? -999 : a.war;
      const bWar = Number.isNaN(b.war) ? -999 : b.war;
      return bWar - aWar;
    });

    // Assign ranks (handle ties with average rank)
    const ranks = new Map<number, number>();
    let i = 0;
    while (i < sorted.length) {
      const currentWar = sorted[i].war;
      let j = i;
      while (j < sorted.length && sorted[j].war === currentWar) {
        j++;
      }
      const avgRank = (i + 1 + j) / 2;
      for (let k = i; k < j; k++) {
        ranks.set(sorted[k].playerId, avgRank);
      }
      i = j;
    }

    // Convert rank to percentile (higher WAR = higher percentile)
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
   * NOTE: Component ratings (Power, Eye, AvK, Contact) are now calculated via
   * percentile ranking in calculateComponentRatingsFromPercentiles() rather than
   * using fixed formula-based thresholds. This ensures the league leader always
   * gets an elite rating regardless of year-to-year offensive environment changes.
   *
   * The old formula-based estimation methods have been removed as they created
   * unfair comparisons across different offensive environments (e.g., a .315
   * league-leader getting only a 71 rating while a .380 league-leader from a
   * different year got 80).
   */

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
