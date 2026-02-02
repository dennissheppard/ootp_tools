/**
 * HitterTrueFutureRatingService
 *
 * Calculates True Future Rating (TFR) for minor league hitter prospects.
 * Projects what they would be as major leaguers by blending:
 * - Scouting ratings (potential Power/Eye/AvoidK/etc.)
 * - Minor league performance (adjusted for level)
 *
 * The scouting weight varies based on age, development stage (star gap),
 * and sample size (minor league PA).
 */

import { HitterScoutingRatings } from '../models/ScoutingData';
import { MinorLeagueBattingStatsWithLevel, MinorLeagueLevel } from '../models/Stats';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';

// ============================================================================
// Interfaces
// ============================================================================

export interface HitterTrueFutureRatingInput {
  playerId: number;
  playerName: string;
  age: number;
  scouting: HitterScoutingRatings;
  minorLeagueStats: MinorLeagueBattingStatsWithLevel[];
  /** True Rating if player has MLB stats (for comparison) */
  trueRating?: number;
}

export interface HitterTrueFutureRatingResult {
  playerId: number;
  playerName: string;
  age: number;
  /** Scouting-expected rates */
  scoutBbPct: number;
  scoutKPct: number;
  scoutIso: number;
  scoutAvg: number;
  /** Adjusted minor league rates (MLB-equivalent) */
  adjustedBbPct: number;
  adjustedKPct: number;
  adjustedIso: number;
  adjustedAvg: number;
  /** Projected rates (blended scout + stats) */
  projBbPct: number;
  projKPct: number;
  projIso: number;
  projAvg: number;
  /** Projected peak wOBA */
  projWoba: number;
  /** Percentile rank among all prospects */
  percentile: number;
  /** True Future Rating (0.5-5.0 scale) */
  trueFutureRating: number;
  /** True Rating if available (for comparison) */
  trueRating?: number;
  /** Total minor league PA */
  totalMinorPa: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Level adjustments to translate minor league stats to MLB-equivalent
 * Hitter adjustments differ from pitcher adjustments
 *
 * Higher levels have better pitching, so hitters see:
 * - Lower AVG, more Ks at higher levels
 * - Similar BB% (plate discipline transfers)
 * - Lower ISO (facing better pitchers)
 */
const LEVEL_ADJUSTMENTS: Record<MinorLeagueLevel, {
  bbPct: number;
  kPct: number;
  iso: number;
  avg: number;
}> = {
  // AAA → MLB
  aaa: { bbPct: 0, kPct: 2.0, iso: -0.015, avg: -0.020 },

  // AA → MLB (cumulative)
  aa: { bbPct: -0.5, kPct: 3.5, iso: -0.025, avg: -0.035 },

  // A → MLB (cumulative)
  a: { bbPct: -1.0, kPct: 5.0, iso: -0.035, avg: -0.050 },

  // Rookie → MLB (cumulative)
  r: { bbPct: -1.5, kPct: 7.0, iso: -0.045, avg: -0.065 },
};

/** Year weights for minor league stats (current year, previous year) */
const MINOR_YEAR_WEIGHTS = [5, 3];

/**
 * Level weights for PA reliability calculation
 */
const LEVEL_PA_WEIGHTS: Record<MinorLeagueLevel, number> = {
  aaa: 1.0,
  aa: 0.7,
  a: 0.4,
  r: 0.2,
};

/**
 * Percentile thresholds for TFR conversion
 */
const PERCENTILE_TO_RATING: Array<{ threshold: number; rating: number }> = [
  { threshold: 99.0, rating: 5.0 },
  { threshold: 97.0, rating: 4.5 },
  { threshold: 93.0, rating: 4.0 },
  { threshold: 75.0, rating: 3.5 },
  { threshold: 60.0, rating: 3.0 },
  { threshold: 35.0, rating: 2.5 },
  { threshold: 20.0, rating: 2.0 },
  { threshold: 10.0, rating: 1.5 },
  { threshold: 5.0, rating: 1.0 },
  { threshold: 0.0, rating: 0.5 },
];

/** wOBA weights */
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

class HitterTrueFutureRatingService {
  /**
   * Calculate scouting weight based on level-weighted PA (experience).
   */
  calculateScoutingWeight(weightedPa: number): number {
    if (weightedPa < 150) return 1.0;       // 100% scout
    else if (weightedPa <= 300) return 0.8;  // 80% scout
    else if (weightedPa <= 500) return 0.7;  // 70% scout
    else return 0.6;                          // 60% scout
  }

  /**
   * Apply level adjustments to translate minor league stats to MLB-equivalent.
   */
  applyLevelAdjustments(
    bbPct: number,
    kPct: number,
    iso: number,
    avg: number,
    level: MinorLeagueLevel
  ): { bbPct: number; kPct: number; iso: number; avg: number } {
    const adj = LEVEL_ADJUSTMENTS[level];
    return {
      bbPct: bbPct + adj.bbPct,
      kPct: kPct + adj.kPct,
      iso: iso + adj.iso,
      avg: avg + adj.avg,
    };
  }

  /**
   * Calculate weighted average of minor league stats across levels and years.
   */
  calculateWeightedMinorStats(
    stats: MinorLeagueBattingStatsWithLevel[],
    currentYear: number
  ): {
    bbPct: number;
    kPct: number;
    iso: number;
    avg: number;
    totalPa: number;
    weightedPa: number;
  } | null {
    if (stats.length === 0) {
      return null;
    }

    let weightedBbPctSum = 0;
    let weightedKPctSum = 0;
    let weightedIsoSum = 0;
    let weightedAvgSum = 0;
    let totalWeight = 0;
    let totalPa = 0;
    let weightedPa = 0;

    for (const stat of stats) {
      if (stat.pa === 0) continue;

      // Calculate year weight
      const yearDiff = currentYear - stat.year;
      let yearWeight = 2;
      if (yearDiff === 0) yearWeight = MINOR_YEAR_WEIGHTS[0];
      else if (yearDiff === 1) yearWeight = MINOR_YEAR_WEIGHTS[1];

      // Calculate rate stats
      const bbPct = stat.bb_pct ?? (stat.bb / stat.pa) * 100;
      const kPct = stat.k_pct ?? (stat.k / stat.pa) * 100;
      const isoVal = stat.iso ?? (stat.slg ?? 0) - (stat.avg ?? 0);
      const avgVal = stat.avg ?? (stat.h / stat.ab);

      // Apply level adjustments
      const adjusted = this.applyLevelAdjustments(bbPct, kPct, isoVal, avgVal, stat.level);

      const weight = yearWeight * stat.pa;

      weightedBbPctSum += adjusted.bbPct * weight;
      weightedKPctSum += adjusted.kPct * weight;
      weightedIsoSum += adjusted.iso * weight;
      weightedAvgSum += adjusted.avg * weight;

      totalWeight += weight;
      totalPa += stat.pa;

      // Level-weighted PA for reliability
      const levelWeight = LEVEL_PA_WEIGHTS[stat.level] ?? 0.5;
      weightedPa += stat.pa * levelWeight;
    }

    if (totalWeight === 0) {
      return null;
    }

    return {
      bbPct: weightedBbPctSum / totalWeight,
      kPct: weightedKPctSum / totalWeight,
      iso: weightedIsoSum / totalWeight,
      avg: weightedAvgSum / totalWeight,
      totalPa,
      weightedPa,
    };
  }

  /**
   * Calculate scouting-expected rates from potential ratings.
   */
  scoutingToExpectedRates(scouting: HitterScoutingRatings): {
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
   */
  calculateWobaFromRates(bbPct: number, _kPct: number, iso: number, avg: number): number {
    // Note: kPct not directly used in wOBA calculation but kept for API consistency
    const bbRate = bbPct / 100;
    const hitRate = avg * (1 - bbRate);
    const isoFactor = iso / 0.140;

    const hrRate = hitRate * 0.12 * Math.max(0.5, Math.min(2.0, isoFactor));
    const tripleRate = hitRate * 0.03;
    const doubleRate = hitRate * 0.20;
    const singleRate = Math.max(0, hitRate - hrRate - tripleRate - doubleRate);

    const woba =
      WOBA_WEIGHTS.bb * bbRate +
      WOBA_WEIGHTS.single * singleRate +
      WOBA_WEIGHTS.double * doubleRate +
      WOBA_WEIGHTS.triple * tripleRate +
      WOBA_WEIGHTS.hr * hrRate;

    return Math.max(0.200, Math.min(0.500, woba));
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
   * Calculate True Future Ratings for multiple hitter prospects.
   */
  async calculateTrueFutureRatings(
    inputs: HitterTrueFutureRatingInput[]
  ): Promise<HitterTrueFutureRatingResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    // Step 1: Calculate blended projections for all prospects
    const resultsWithWoba = inputs.map(input => {
      const { scouting, minorLeagueStats, age } = input;

      // Calculate weighted minor league stats
      const currentYear = minorLeagueStats.length > 0
        ? Math.max(...minorLeagueStats.map(s => s.year))
        : new Date().getFullYear();

      const weightedStats = this.calculateWeightedMinorStats(minorLeagueStats, currentYear);
      const totalMinorPa = weightedStats?.totalPa ?? 0;
      const weightedPa = weightedStats?.weightedPa ?? 0;

      // Calculate scouting weight
      const scoutingWeight = this.calculateScoutingWeight(weightedPa);

      // Calculate scouting-expected rates
      const scoutRates = this.scoutingToExpectedRates(scouting);

      // Use scouting if no stats, otherwise blend
      let adjustedBbPct = scoutRates.bbPct;
      let adjustedKPct = scoutRates.kPct;
      let adjustedIso = scoutRates.iso;
      let adjustedAvg = scoutRates.avg;

      if (weightedStats) {
        adjustedBbPct = weightedStats.bbPct;
        adjustedKPct = weightedStats.kPct;
        adjustedIso = weightedStats.iso;
        adjustedAvg = weightedStats.avg;
      }

      // Blend scouting and stats
      const projBbPct = scoutingWeight * scoutRates.bbPct + (1 - scoutingWeight) * adjustedBbPct;
      const projKPct = scoutingWeight * scoutRates.kPct + (1 - scoutingWeight) * adjustedKPct;
      const projIso = scoutingWeight * scoutRates.iso + (1 - scoutingWeight) * adjustedIso;
      const projAvg = scoutingWeight * scoutRates.avg + (1 - scoutingWeight) * adjustedAvg;

      // Calculate projected wOBA
      const projWoba = this.calculateWobaFromRates(projBbPct, projKPct, projIso, projAvg);

      return {
        playerId: input.playerId,
        playerName: input.playerName,
        age,
        scoutBbPct: Math.round(scoutRates.bbPct * 10) / 10,
        scoutKPct: Math.round(scoutRates.kPct * 10) / 10,
        scoutIso: Math.round(scoutRates.iso * 1000) / 1000,
        scoutAvg: Math.round(scoutRates.avg * 1000) / 1000,
        adjustedBbPct: Math.round(adjustedBbPct * 10) / 10,
        adjustedKPct: Math.round(adjustedKPct * 10) / 10,
        adjustedIso: Math.round(adjustedIso * 1000) / 1000,
        adjustedAvg: Math.round(adjustedAvg * 1000) / 1000,
        projBbPct: Math.round(projBbPct * 10) / 10,
        projKPct: Math.round(projKPct * 10) / 10,
        projIso: Math.round(projIso * 1000) / 1000,
        projAvg: Math.round(projAvg * 1000) / 1000,
        projWoba: Math.round(projWoba * 1000) / 1000,
        totalMinorPa,
        trueRating: input.trueRating,
        percentile: 0,
        trueFutureRating: 0,
      };
    });

    // Step 2: Rank by wOBA to get percentiles and TFR
    const sortedByWoba = [...resultsWithWoba].sort((a, b) => b.projWoba - a.projWoba);
    const n = sortedByWoba.length;

    return sortedByWoba.map((result, index) => {
      const percentile = n > 1 ? ((n - index - 1) / (n - 1)) * 100 : 50;
      const trueFutureRating = this.percentileToRating(percentile);

      return {
        ...result,
        percentile: Math.round(percentile * 10) / 10,
        trueFutureRating,
      };
    });
  }

  /**
   * Calculate TFR for a single hitter prospect (simplified).
   */
  calculateTrueFutureRating(input: HitterTrueFutureRatingInput): {
    projWoba: number;
    projBbPct: number;
    projKPct: number;
    projIso: number;
    projAvg: number;
    totalMinorPa: number;
  } {
    const { scouting, minorLeagueStats } = input;

    const currentYear = minorLeagueStats.length > 0
      ? Math.max(...minorLeagueStats.map(s => s.year))
      : new Date().getFullYear();

    const weightedStats = this.calculateWeightedMinorStats(minorLeagueStats, currentYear);
    const totalMinorPa = weightedStats?.totalPa ?? 0;
    const weightedPa = weightedStats?.weightedPa ?? 0;

    const scoutingWeight = this.calculateScoutingWeight(weightedPa);
    const scoutRates = this.scoutingToExpectedRates(scouting);

    let adjustedBbPct = scoutRates.bbPct;
    let adjustedKPct = scoutRates.kPct;
    let adjustedIso = scoutRates.iso;
    let adjustedAvg = scoutRates.avg;

    if (weightedStats) {
      adjustedBbPct = weightedStats.bbPct;
      adjustedKPct = weightedStats.kPct;
      adjustedIso = weightedStats.iso;
      adjustedAvg = weightedStats.avg;
    }

    const projBbPct = scoutingWeight * scoutRates.bbPct + (1 - scoutingWeight) * adjustedBbPct;
    const projKPct = scoutingWeight * scoutRates.kPct + (1 - scoutingWeight) * adjustedKPct;
    const projIso = scoutingWeight * scoutRates.iso + (1 - scoutingWeight) * adjustedIso;
    const projAvg = scoutingWeight * scoutRates.avg + (1 - scoutingWeight) * adjustedAvg;

    const projWoba = this.calculateWobaFromRates(projBbPct, projKPct, projIso, projAvg);

    return {
      projWoba: Math.round(projWoba * 1000) / 1000,
      projBbPct: Math.round(projBbPct * 10) / 10,
      projKPct: Math.round(projKPct * 10) / 10,
      projIso: Math.round(projIso * 1000) / 1000,
      projAvg: Math.round(projAvg * 1000) / 1000,
      totalMinorPa,
    };
  }
}

export const hitterTrueFutureRatingService = new HitterTrueFutureRatingService();
export { HitterTrueFutureRatingService };
