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
import { trueRatingsService } from './TrueRatingsService';

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
  /** Percentile rank for Eye component (0-100) */
  eyePercentile: number;
  /** Percentile rank for AvoidK component (0-100) */
  avoidKPercentile: number;
  /** Percentile rank for Power component (0-100) */
  powerPercentile: number;
  /** Percentile rank for Contact component (0-100) */
  contactPercentile: number;
  /** Scouting-expected rates */
  scoutBbPct: number;
  scoutKPct: number;
  scoutHrPct: number;
  scoutAvg: number;
  /** Adjusted minor league rates (MLB-equivalent) */
  adjustedBbPct: number;
  adjustedKPct: number;
  adjustedHrPct: number;
  adjustedAvg: number;
  /** Projected rates (mapped from MLB distributions) */
  projBbPct: number;
  projKPct: number;
  projHrPct: number;
  projAvg: number;
  /** Projected ISO (Isolated Power) */
  projIso: number;
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

/**
 * Intermediate result with blended component values (before percentile ranking)
 */
export interface HitterComponentBlendedResult {
  playerId: number;
  playerName: string;
  age: number;
  /** Scouting-expected rates */
  scoutBbPct: number;
  scoutKPct: number;
  scoutHrPct: number;
  scoutAvg: number;
  /** Adjusted minor league rates (MLB-equivalent) */
  adjustedBbPct: number;
  adjustedKPct: number;
  adjustedHrPct: number;
  adjustedAvg: number;
  /** Blended component values (weighted scout + stats) */
  eyeValue: number;      // Blended BB%
  avoidKValue: number;   // Blended K%
  powerValue: number;    // Blended HR%
  contactValue: number;    // Blended AVG
  /** Total minor league PA */
  totalMinorPa: number;
  /** Total weighted PA for reliability */
  totalWeightedPa: number;
  /** True Rating if available (for comparison) */
  trueRating?: number;
}

/**
 * MLB peak-age distribution for hitter stat mapping
 */
export interface MLBHitterPercentileDistribution {
  bbPctValues: number[];  // Sorted ascending (higher is better)
  kPctValues: number[];   // Sorted ascending (lower is better)
  hrPctValues: number[];  // Sorted ascending (higher is better) - HR per PA
  avgValues: number[];    // Sorted ascending (higher is better)
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
 * - Lower HR% (facing better pitchers who limit power)
 */
const LEVEL_ADJUSTMENTS: Record<MinorLeagueLevel, {
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
}> = {
  // AAA → MLB: Minor adjustment (AAA pitching closer to MLB)
  aaa: { bbPct: 0, kPct: 2.0, hrPct: -0.3, avg: -0.020 },

  // AA → MLB (cumulative): Moderate adjustment
  aa: { bbPct: -0.5, kPct: 3.5, hrPct: -0.6, avg: -0.035 },

  // A → MLB (cumulative): Larger adjustment (weaker pitching)
  a: { bbPct: -1.0, kPct: 5.0, hrPct: -1.0, avg: -0.050 },

  // Rookie → MLB (cumulative): Largest adjustment
  r: { bbPct: -1.5, kPct: 7.0, hrPct: -1.5, avg: -0.065 },
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

/**
 * Component-specific scouting weights based on predictive validity analysis.
 *
 * From MiLB→MLB transition analysis (2015-2021, n=316):
 * - K%:  r = 0.68 (strong predictor)  → Trust stats more
 * - HR%: r = 0.44 (moderate predictor) → Moderate trust
 * - BB%: r = 0.05 (not predictive)    → Rely on scouting
 * - AVG: r = 0.18 (not predictive)    → Rely on scouting
 *
 * Higher scouting weight = trust scouting more, stats less
 */
const COMPONENT_SCOUTING_WEIGHTS = {
  /**
   * AvoidK (K%): MiLB K% strongly predicts MLB K% (r=0.68)
   * Can trust stats significantly - lower scouting weight
   */
  avoidK: {
    minPa: 150,      // Below this, 100% scout
    lowPa: 300,      // 150-300 PA threshold
    highPa: 500,     // 300-500 PA threshold
    weights: {
      belowMin: 1.0,   // 100% scout
      lowRange: 0.65,  // 65% scout, 35% stats
      midRange: 0.50,  // 50% scout, 50% stats
      highRange: 0.40, // 40% scout, 60% stats
    },
  },

  /**
   * Power (HR%): MiLB HR% moderately predicts MLB HR% (r=0.44)
   * However, TFR validation showed +0.91% HR% bias - we were over-projecting.
   * Increase scouting weight to reduce trust in inflated MiLB HR%.
   */
  power: {
    minPa: 150,
    lowPa: 300,
    highPa: 500,
    weights: {
      belowMin: 1.0,   // 100% scout
      lowRange: 0.85,  // 85% scout, 15% stats (was 75/25)
      midRange: 0.80,  // 80% scout, 20% stats (was 65/35)
      highRange: 0.75, // 75% scout, 25% stats (was 55/45)
    },
  },

  /**
   * Eye (BB%): MiLB BB% does NOT predict MLB BB% (r=0.05)
   * Eye rating → BB% is very reliable in OOTP engine (r=0.99)
   * Use 100% scouting - MiLB walk rate is noise
   */
  eye: {
    minPa: 150,
    lowPa: 300,
    highPa: 500,
    weights: {
      belowMin: 1.0,   // 100% scout
      lowRange: 1.0,   // 100% scout
      midRange: 1.0,   // 100% scout
      highRange: 1.0,  // 100% scout
    },
  },

  /**
   * Contact (AVG): MiLB AVG does NOT predict MLB AVG (r=0.18)
   * Contact → AVG is strong in OOTP engine (r=0.97)
   * Use 100% scouting - MiLB batting average is noise
   */
  contact: {
    minPa: 150,
    lowPa: 300,
    highPa: 500,
    weights: {
      belowMin: 1.0,   // 100% scout
      lowRange: 1.0,   // 100% scout
      midRange: 1.0,   // 100% scout
      highRange: 1.0,  // 100% scout
    },
  },
};

// ============================================================================
// Service Class
// ============================================================================

class HitterTrueFutureRatingService {
  /**
   * Calculate scouting weight for a specific component based on PA.
   * Different components have different predictive validity from MiLB stats.
   */
  calculateComponentScoutingWeight(
    component: 'eye' | 'avoidK' | 'power' | 'contact',
    weightedPa: number
  ): number {
    const config = COMPONENT_SCOUTING_WEIGHTS[component];

    if (weightedPa < config.minPa) return config.weights.belowMin;
    if (weightedPa <= config.lowPa) return config.weights.lowRange;
    if (weightedPa <= config.highPa) return config.weights.midRange;
    return config.weights.highRange;
  }

  /**
   * @deprecated Use calculateComponentScoutingWeight instead.
   * Calculate scouting weight based on level-weighted PA (experience).
   * Kept for backwards compatibility.
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
    hrPct: number,
    avg: number,
    level: MinorLeagueLevel
  ): { bbPct: number; kPct: number; hrPct: number; avg: number } {
    const adj = LEVEL_ADJUSTMENTS[level];
    return {
      bbPct: bbPct + adj.bbPct,
      kPct: kPct + adj.kPct,
      hrPct: hrPct + adj.hrPct,
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
    hrPct: number;
    avg: number;
    totalPa: number;
    weightedPa: number;
  } | null {
    if (stats.length === 0) {
      return null;
    }

    let weightedBbPctSum = 0;
    let weightedKPctSum = 0;
    let weightedHrPctSum = 0;
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
      // HR% = HR per PA as percentage (need to access hr from stats)
      const hrPct = (stat as any).hr ? ((stat as any).hr / stat.pa) * 100 : 0;
      const avgVal = stat.avg ?? (stat.h / stat.ab);

      // Apply level adjustments
      const adjusted = this.applyLevelAdjustments(bbPct, kPct, hrPct, avgVal, stat.level);

      const weight = yearWeight * stat.pa;

      weightedBbPctSum += adjusted.bbPct * weight;
      weightedKPctSum += adjusted.kPct * weight;
      weightedHrPctSum += adjusted.hrPct * weight;
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
      hrPct: weightedHrPctSum / totalWeight,
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
    hrPct: number;
    avg: number;
  } {
    return {
      bbPct: HitterRatingEstimatorService.expectedBbPct(scouting.eye),
      kPct: HitterRatingEstimatorService.expectedKPct(scouting.avoidK),
      hrPct: HitterRatingEstimatorService.expectedHrPct(scouting.power),
      avg: HitterRatingEstimatorService.expectedAvg(scouting.contact),
    };
  }

  /**
   * Calculate wOBA from rate stats
   *
   * Uses HR% directly (not derived from ISO) since Power rating maps to HR rate.
   * Doubles/triples are estimated from hits based on typical MLB distributions.
   */
  calculateWobaFromRates(bbPct: number, _kPct: number, hrPct: number, avg: number): number {
    // Convert percentages to rates per PA
    const bbRate = bbPct / 100;
    const hrRate = hrPct / 100;

    // Hit rate (excluding walks and HRs for simplicity)
    // In reality: PA = AB + BB + HBP + SF + SH, Hits = AVG * AB
    // Simplify: hitRate ≈ avg * (1 - bbRate)
    const hitRate = avg * (1 - bbRate);

    // Non-HR hits (singles + doubles + triples)
    const nonHrHitRate = Math.max(0, hitRate - hrRate);

    // Distribute non-HR hits: ~65% singles, ~25% doubles, ~10% triples (rough MLB averages)
    // These ratios can be refined with Gap/Speed ratings but we keep it simple here
    const singleRate = nonHrHitRate * 0.65;
    const doubleRate = nonHrHitRate * 0.27;
    const tripleRate = nonHrHitRate * 0.08;

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
   * Build MLB percentile distributions from 2015-2020 peak-age batting data.
   * Returns sorted arrays of BB%, K%, HR%, AVG for mapping prospect percentiles.
   *
   * Uses ages 25-29 only (peak years) to build distributions.
   * This ensures we're mapping prospect peaks to actual MLB peaks.
   */
  async buildMLBHitterPercentileDistribution(): Promise<MLBHitterPercentileDistribution> {
    const years = [2015, 2016, 2017, 2018, 2019, 2020];
    const allBbPct: number[] = [];
    const allKPct: number[] = [];
    const allHrPct: number[] = [];
    const allAvg: number[] = [];

    // Load DOB data to filter by age
    const dobMap = await this.loadPlayerDOBs();

    // Load MLB batting data for all years
    for (const year of years) {
      try {
        const mlbStats = await trueRatingsService.getTrueBattingStats(year);

        // Extract rate stats from peak-age hitters only (25-29)
        for (const stat of mlbStats) {
          const pa = stat.pa;

          // Require minimum PA to avoid small-sample outliers
          // 300 PA is about half a season
          if (pa < 300) continue;

          // Calculate age for this season
          const age = this.calculateAge(dobMap.get(stat.player_id), year);
          if (!age || age < 25 || age > 29) continue; // Skip non-peak ages

          // Calculate rate stats
          const bbPct = (stat.bb / pa) * 100;
          const kPct = (stat.k / pa) * 100;
          const hrPct = (stat.hr / pa) * 100;  // HR% = HR per PA as percentage

          // Validate rates are reasonable (filter extreme outliers)
          if (bbPct >= 2 && bbPct <= 25 && kPct >= 5 && kPct <= 40 &&
              hrPct >= 0 && hrPct <= 10 && stat.avg >= 0.150 && stat.avg <= 0.400) {
            allBbPct.push(bbPct);
            allKPct.push(kPct);
            allHrPct.push(hrPct);
            allAvg.push(stat.avg);
          }
        }
      } catch (error) {
        console.warn(`Failed to load MLB batting data for ${year}, skipping:`, error);
      }
    }

    // Sort arrays (for percentile lookup)
    allBbPct.sort((a, b) => a - b);  // Ascending: lower values = lower percentile
    allKPct.sort((a, b) => a - b);   // Ascending: lower values = lower percentile (but lower is better)
    allHrPct.sort((a, b) => a - b);  // Ascending: lower values = lower percentile
    allAvg.sort((a, b) => a - b);    // Ascending: lower values = lower percentile

    console.log(`📊 Built MLB hitter distributions: ${allBbPct.length} peak-age hitters (ages 25-29) from 2015-2020`);

    return {
      bbPctValues: allBbPct,
      kPctValues: allKPct,
      hrPctValues: allHrPct,
      avgValues: allAvg,
    };
  }

  /**
   * Load player DOBs from mlb_dob.csv
   */
  private async loadPlayerDOBs(): Promise<Map<number, Date>> {
    try {
      const response = await fetch('/data/mlb_dob.csv');
      const csvText = await response.text();

      const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const dobMap = new Map<number, Date>();

      // Skip header
      for (let i = 1; i < lines.length; i++) {
        const [idStr, dobStr] = lines[i].split(',');
        const playerId = parseInt(idStr, 10);

        if (!playerId || !dobStr) continue;

        // Parse MM/DD/YYYY format
        const [month, day, year] = dobStr.split('/').map(s => parseInt(s, 10));
        if (!month || !day || !year) continue;

        const dob = new Date(year, month - 1, day);
        dobMap.set(playerId, dob);
      }

      return dobMap;
    } catch (error) {
      console.warn('Failed to load DOB data, using all ages:', error);
      return new Map();
    }
  }

  /**
   * Calculate age at the start of a season
   */
  private calculateAge(dob: Date | undefined, season: number): number | null {
    if (!dob) return null;

    const seasonStart = new Date(season, 3, 1); // April 1st of season year
    const ageMs = seasonStart.getTime() - dob.getTime();
    const age = Math.floor(ageMs / (1000 * 60 * 60 * 24 * 365.25));

    return age;
  }

  /**
   * Map a prospect's percentile to the corresponding MLB rate value.
   * Uses linear interpolation on the sorted MLB distribution.
   *
   * @param percentile - Prospect's percentile rank (0-100)
   * @param mlbValues - Sorted array of MLB rates
   * @returns Interpolated MLB rate at that percentile
   */
  mapPercentileToMLBValue(percentile: number, mlbValues: number[]): number {
    if (mlbValues.length === 0) {
      throw new Error('MLB distribution is empty');
    }

    // Clamp percentile to 0-100
    const clampedPercentile = Math.max(0, Math.min(100, percentile));

    // Convert percentile to array index (0-100 → 0 to length-1)
    const position = (clampedPercentile / 100) * (mlbValues.length - 1);

    // Get floor and ceiling indices
    const lowerIdx = Math.floor(position);
    const upperIdx = Math.ceil(position);

    // Handle edge cases
    if (lowerIdx === upperIdx) {
      return mlbValues[lowerIdx];
    }

    // Linear interpolation
    const lowerValue = mlbValues[lowerIdx];
    const upperValue = mlbValues[upperIdx];
    const fraction = position - lowerIdx;

    return lowerValue + (upperValue - lowerValue) * fraction;
  }

  /**
   * Rank prospects by each component and assign percentiles.
   * Returns a map of playerId to component percentiles.
   *
   * @param componentResults - Array of component-blended results
   * @returns Map of playerId to { eyePercentile, avoidKPercentile, powerPercentile, contactPercentile }
   */
  rankProspectsByComponent(
    componentResults: HitterComponentBlendedResult[]
  ): Map<number, { eyePercentile: number; avoidKPercentile: number; powerPercentile: number; contactPercentile: number }> {
    const percentiles = new Map<number, { eyePercentile: number; avoidKPercentile: number; powerPercentile: number; contactPercentile: number }>();

    if (componentResults.length === 0) {
      return percentiles;
    }

    const n = componentResults.length;

    // Rank by Eye (BB% - higher is better)
    const eyeSorted = [...componentResults].sort((a, b) => b.eyeValue - a.eyeValue);
    for (let i = 0; i < n; i++) {
      const prospect = eyeSorted[i];
      const eyePercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;

      if (!percentiles.has(prospect.playerId)) {
        percentiles.set(prospect.playerId, { eyePercentile: 0, avoidKPercentile: 0, powerPercentile: 0, contactPercentile: 0 });
      }
      percentiles.get(prospect.playerId)!.eyePercentile = eyePercentile;
    }

    // Rank by AvoidK (K% - lower is better, so sort ascending)
    const avoidKSorted = [...componentResults].sort((a, b) => a.avoidKValue - b.avoidKValue);
    for (let i = 0; i < n; i++) {
      const prospect = avoidKSorted[i];
      const avoidKPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;

      percentiles.get(prospect.playerId)!.avoidKPercentile = avoidKPercentile;
    }

    // Rank by Power (ISO - higher is better)
    const powerSorted = [...componentResults].sort((a, b) => b.powerValue - a.powerValue);
    for (let i = 0; i < n; i++) {
      const prospect = powerSorted[i];
      const powerPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;

      percentiles.get(prospect.playerId)!.powerPercentile = powerPercentile;
    }

    // Rank by Contact (AVG - higher is better)
    const contactSorted = [...componentResults].sort((a, b) => b.contactValue - a.contactValue);
    for (let i = 0; i < n; i++) {
      const prospect = contactSorted[i];
      const contactPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;

      percentiles.get(prospect.playerId)!.contactPercentile = contactPercentile;
    }

    return percentiles;
  }

  /**
   * Calculate blended component values for a single player.
   * Returns eye/avoidK/power/contact values (before percentile ranking and MLB mapping).
   *
   * Uses COMPONENT-SPECIFIC scouting weights based on predictive validity
   * (from MiLB→MLB transition analysis, n=316):
   *
   * - AvoidK:  MiLB K% strongly predicts MLB K% (r=0.68) → trust stats 35-60%
   * - Power:   MiLB HR% moderately predicts MLB HR% (r=0.44) → trust stats 25-45%
   * - Eye:     MiLB BB% does NOT predict MLB BB% (r=0.05) → 100% scouting
   * - Contact: MiLB AVG does NOT predict MLB AVG (r=0.18) → 100% scouting
   */
  calculateComponentBlend(input: HitterTrueFutureRatingInput): HitterComponentBlendedResult {
    const { scouting, minorLeagueStats, age } = input;

    // Calculate weighted minor league stats
    const currentYear = minorLeagueStats.length > 0
      ? Math.max(...minorLeagueStats.map(s => s.year))
      : new Date().getFullYear();

    const weightedStats = this.calculateWeightedMinorStats(minorLeagueStats, currentYear);
    const totalMinorPa = weightedStats?.totalPa ?? 0;
    const weightedPa = weightedStats?.weightedPa ?? 0;

    // Calculate component-specific scouting weights based on predictive validity
    const eyeScoutWeight = this.calculateComponentScoutingWeight('eye', weightedPa);
    const avoidKScoutWeight = this.calculateComponentScoutingWeight('avoidK', weightedPa);
    const powerScoutWeight = this.calculateComponentScoutingWeight('power', weightedPa);
    const contactScoutWeight = this.calculateComponentScoutingWeight('contact', weightedPa);

    // Calculate scouting-expected rates
    const scoutRates = this.scoutingToExpectedRates(scouting);

    // If no minor league stats, use scouting only
    let adjustedBbPct = scoutRates.bbPct;
    let adjustedKPct = scoutRates.kPct;
    let adjustedHrPct = scoutRates.hrPct;
    let adjustedAvg = scoutRates.avg;

    if (weightedStats) {
      adjustedBbPct = weightedStats.bbPct;
      adjustedKPct = weightedStats.kPct;
      adjustedHrPct = weightedStats.hrPct;
      adjustedAvg = weightedStats.avg;
    }

    // Blend scouting and stats with COMPONENT-SPECIFIC weights
    // Eye (BB%): 100% scout - MiLB BB% doesn't predict MLB BB% (r=0.05)
    const eyeValue = eyeScoutWeight * scoutRates.bbPct + (1 - eyeScoutWeight) * adjustedBbPct;
    // AvoidK (K%): ~40-65% scout - MiLB K% strongly predicts MLB K% (r=0.68)
    const avoidKValue = avoidKScoutWeight * scoutRates.kPct + (1 - avoidKScoutWeight) * adjustedKPct;
    // Power (HR%): ~55-75% scout - MiLB HR% moderately predicts MLB HR% (r=0.44)
    const powerValue = powerScoutWeight * scoutRates.hrPct + (1 - powerScoutWeight) * adjustedHrPct;
    // Contact (AVG): 100% scout - MiLB AVG doesn't predict MLB AVG (r=0.18)
    const contactValue = contactScoutWeight * scoutRates.avg + (1 - contactScoutWeight) * adjustedAvg;

    return {
      playerId: input.playerId,
      playerName: input.playerName,
      age,
      scoutBbPct: Math.round(scoutRates.bbPct * 10) / 10,
      scoutKPct: Math.round(scoutRates.kPct * 10) / 10,
      scoutHrPct: Math.round(scoutRates.hrPct * 100) / 100,
      scoutAvg: Math.round(scoutRates.avg * 1000) / 1000,
      adjustedBbPct: Math.round(adjustedBbPct * 10) / 10,
      adjustedKPct: Math.round(adjustedKPct * 10) / 10,
      adjustedHrPct: Math.round(adjustedHrPct * 100) / 100,
      adjustedAvg: Math.round(adjustedAvg * 1000) / 1000,
      eyeValue: Math.round(eyeValue * 100) / 100,
      avoidKValue: Math.round(avoidKValue * 100) / 100,
      powerValue: Math.round(powerValue * 100) / 100,  // HR% as percentage
      contactValue: Math.round(contactValue * 1000) / 1000,
      totalMinorPa,
      totalWeightedPa: weightedPa,
      trueRating: input.trueRating,
    };
  }

  /**
   * Calculate True Future Ratings for multiple hitter prospects.
   *
   * NEW ALGORITHM:
   * 1. Blend scouting + stats separately for each component (eye/avoidK/power/contact)
   * 2. Rank prospects by each component to get percentiles
   * 3. Map percentiles to MLB distributions (2015-2020)
   * 4. Calculate peak wOBA from mapped rates
   * 5. Rank by wOBA for final TFR rating
   */
  async calculateTrueFutureRatings(
    inputs: HitterTrueFutureRatingInput[]
  ): Promise<HitterTrueFutureRatingResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    // Step 1: Calculate component blends for all prospects
    const componentResults = inputs.map(input => this.calculateComponentBlend(input));

    // Step 2: Rank by each component to get percentiles
    const componentPercentiles = this.rankProspectsByComponent(componentResults);

    // Step 3: Load MLB distribution for mapping
    const mlbDist = await this.buildMLBHitterPercentileDistribution();

    // Step 4: Map percentiles to MLB rates and calculate wOBA
    const resultsWithWoba = componentResults.map(result => {
      const percentiles = componentPercentiles.get(result.playerId)!;

      // Map percentiles to MLB distribution values
      // For eye (BB%): higher percentile = higher BB% (use percentile as-is)
      // For avoidK (K%): higher percentile = lower K% (invert percentile)
      // For power (HR%): higher percentile = higher HR% (use percentile as-is)
      // For contact (AVG): higher percentile = higher AVG (use percentile as-is)
      let projBbPct = this.mapPercentileToMLBValue(percentiles.eyePercentile, mlbDist.bbPctValues);
      let projKPct = this.mapPercentileToMLBValue(100 - percentiles.avoidKPercentile, mlbDist.kPctValues);
      let projHrPct = this.mapPercentileToMLBValue(percentiles.powerPercentile, mlbDist.hrPctValues);
      let projAvg = this.mapPercentileToMLBValue(percentiles.contactPercentile, mlbDist.avgValues);

      // Clamp to realistic ranges
      projBbPct = Math.max(3.0, Math.min(20.0, projBbPct));
      projKPct = Math.max(5.0, Math.min(35.0, projKPct));
      projHrPct = Math.max(0.5, Math.min(8.0, projHrPct));  // HR% range
      projAvg = Math.max(0.200, Math.min(0.350, projAvg));

      // Calculate peak wOBA from mapped rates
      const projWoba = this.calculateWobaFromRates(projBbPct, projKPct, projHrPct, projAvg);

      return {
        ...result,
        eyePercentile: Math.round(percentiles.eyePercentile * 10) / 10,
        avoidKPercentile: Math.round(percentiles.avoidKPercentile * 10) / 10,
        powerPercentile: Math.round(percentiles.powerPercentile * 10) / 10,
        contactPercentile: Math.round(percentiles.contactPercentile * 10) / 10,
        projBbPct: Math.round(projBbPct * 10) / 10,
        projKPct: Math.round(projKPct * 10) / 10,
        projHrPct: Math.round(projHrPct * 100) / 100,
        projAvg: Math.round(projAvg * 1000) / 1000,
        // Calculate ISO from HR%: ISO ≈ HR% * 3 (since HR = 3 extra bases) + base XBH contribution
        projIso: Math.round(((projHrPct / 100) * 3 + 0.05) * 1000) / 1000,
        projWoba: Math.round(projWoba * 1000) / 1000,
      };
    });

    // Step 5: Rank by wOBA among prospects to get final percentile and TFR rating
    const sortedByWoba = [...resultsWithWoba].sort((a, b) => b.projWoba - a.projWoba);
    const n = sortedByWoba.length;

    return sortedByWoba.map((result, index) => {
      // Calculate percentile rank (higher wOBA = better = higher percentile)
      const percentile = n > 1 ? ((n - index - 1) / (n - 1)) * 100 : 50;
      const trueFutureRating = this.percentileToRating(percentile);

      return {
        playerId: result.playerId,
        playerName: result.playerName,
        age: result.age,
        eyePercentile: result.eyePercentile,
        avoidKPercentile: result.avoidKPercentile,
        powerPercentile: result.powerPercentile,
        contactPercentile: result.contactPercentile,
        scoutBbPct: result.scoutBbPct,
        scoutKPct: result.scoutKPct,
        scoutHrPct: result.scoutHrPct,
        scoutAvg: result.scoutAvg,
        adjustedBbPct: result.adjustedBbPct,
        adjustedKPct: result.adjustedKPct,
        adjustedHrPct: result.adjustedHrPct,
        adjustedAvg: result.adjustedAvg,
        projBbPct: result.projBbPct,
        projKPct: result.projKPct,
        projHrPct: result.projHrPct,
        projAvg: result.projAvg,
        projIso: result.projIso,
        projWoba: result.projWoba,
        percentile: Math.round(percentile * 10) / 10,
        trueFutureRating,
        trueRating: result.trueRating,
        totalMinorPa: result.totalMinorPa,
      };
    });
  }

  /**
   * Calculate TFR for a single hitter prospect (simplified).
   * Uses component-specific scouting weights based on predictive validity.
   */
  calculateTrueFutureRating(input: HitterTrueFutureRatingInput): {
    projWoba: number;
    projBbPct: number;
    projKPct: number;
    projHrPct: number;
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

    // Component-specific scouting weights
    const eyeScoutWeight = this.calculateComponentScoutingWeight('eye', weightedPa);
    const avoidKScoutWeight = this.calculateComponentScoutingWeight('avoidK', weightedPa);
    const powerScoutWeight = this.calculateComponentScoutingWeight('power', weightedPa);
    const contactScoutWeight = this.calculateComponentScoutingWeight('contact', weightedPa);

    const scoutRates = this.scoutingToExpectedRates(scouting);

    let adjustedBbPct = scoutRates.bbPct;
    let adjustedKPct = scoutRates.kPct;
    let adjustedHrPct = scoutRates.hrPct;
    let adjustedAvg = scoutRates.avg;

    if (weightedStats) {
      adjustedBbPct = weightedStats.bbPct;
      adjustedKPct = weightedStats.kPct;
      adjustedHrPct = weightedStats.hrPct;
      adjustedAvg = weightedStats.avg;
    }

    // Blend with component-specific weights
    const projBbPct = eyeScoutWeight * scoutRates.bbPct + (1 - eyeScoutWeight) * adjustedBbPct;
    const projKPct = avoidKScoutWeight * scoutRates.kPct + (1 - avoidKScoutWeight) * adjustedKPct;
    const projHrPct = powerScoutWeight * scoutRates.hrPct + (1 - powerScoutWeight) * adjustedHrPct;
    const projAvg = contactScoutWeight * scoutRates.avg + (1 - contactScoutWeight) * adjustedAvg;

    const projWoba = this.calculateWobaFromRates(projBbPct, projKPct, projHrPct, projAvg);

    return {
      projWoba: Math.round(projWoba * 1000) / 1000,
      projBbPct: Math.round(projBbPct * 10) / 10,
      projKPct: Math.round(projKPct * 10) / 10,
      projHrPct: Math.round(projHrPct * 100) / 100,
      projAvg: Math.round(projAvg * 1000) / 1000,
      totalMinorPa,
    };
  }
}

export const hitterTrueFutureRatingService = new HitterTrueFutureRatingService();
export { HitterTrueFutureRatingService };
