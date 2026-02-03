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
  /** Percentile rank for BABIP component (0-100) */
  babipPercentile: number;
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
  /** Projected rates (mapped from MLB distributions) */
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
  scoutIso: number;
  scoutAvg: number;
  /** Adjusted minor league rates (MLB-equivalent) */
  adjustedBbPct: number;
  adjustedKPct: number;
  adjustedIso: number;
  adjustedAvg: number;
  /** Blended component values (weighted scout + stats) */
  eyeValue: number;      // Blended BB%
  avoidKValue: number;   // Blended K%
  powerValue: number;    // Blended ISO
  babipValue: number;    // Blended AVG
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
  isoValues: number[];    // Sorted ascending (higher is better)
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
   * Build MLB percentile distributions from 2015-2020 peak-age batting data.
   * Returns sorted arrays of BB%, K%, ISO, AVG for mapping prospect percentiles.
   *
   * Uses ages 25-29 only (peak years) to build distributions.
   * This ensures we're mapping prospect peaks to actual MLB peaks.
   */
  async buildMLBHitterPercentileDistribution(): Promise<MLBHitterPercentileDistribution> {
    const years = [2015, 2016, 2017, 2018, 2019, 2020];
    const allBbPct: number[] = [];
    const allKPct: number[] = [];
    const allIso: number[] = [];
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

          // Calculate ISO from stats
          const singles = stat.h - stat.d - stat.t - stat.hr;
          const totalBases = singles + 2 * stat.d + 3 * stat.t + 4 * stat.hr;
          const slg = stat.ab > 0 ? totalBases / stat.ab : 0;
          const iso = slg - stat.avg;

          // Validate rates are reasonable (filter extreme outliers)
          if (bbPct >= 2 && bbPct <= 25 && kPct >= 5 && kPct <= 40 &&
              iso >= 0.02 && iso <= 0.400 && stat.avg >= 0.150 && stat.avg <= 0.400) {
            allBbPct.push(bbPct);
            allKPct.push(kPct);
            allIso.push(iso);
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
    allIso.sort((a, b) => a - b);    // Ascending: lower values = lower percentile
    allAvg.sort((a, b) => a - b);    // Ascending: lower values = lower percentile

    console.log(`📊 Built MLB hitter distributions: ${allBbPct.length} peak-age hitters (ages 25-29) from 2015-2020`);

    return {
      bbPctValues: allBbPct,
      kPctValues: allKPct,
      isoValues: allIso,
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
   * @returns Map of playerId to { eyePercentile, avoidKPercentile, powerPercentile, babipPercentile }
   */
  rankProspectsByComponent(
    componentResults: HitterComponentBlendedResult[]
  ): Map<number, { eyePercentile: number; avoidKPercentile: number; powerPercentile: number; babipPercentile: number }> {
    const percentiles = new Map<number, { eyePercentile: number; avoidKPercentile: number; powerPercentile: number; babipPercentile: number }>();

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
        percentiles.set(prospect.playerId, { eyePercentile: 0, avoidKPercentile: 0, powerPercentile: 0, babipPercentile: 0 });
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

    // Rank by BABIP (AVG - higher is better)
    const babipSorted = [...componentResults].sort((a, b) => b.babipValue - a.babipValue);
    for (let i = 0; i < n; i++) {
      const prospect = babipSorted[i];
      const babipPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;

      percentiles.get(prospect.playerId)!.babipPercentile = babipPercentile;
    }

    return percentiles;
  }

  /**
   * Calculate blended component values for a single player.
   * Returns eye/avoidK/power/babip values (before percentile ranking and MLB mapping).
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

    // Calculate scouting weight (PA-based)
    const scoutingWeight = this.calculateScoutingWeight(weightedPa);

    // Calculate scouting-expected rates
    const scoutRates = this.scoutingToExpectedRates(scouting);

    // If no minor league stats, use scouting only
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

    // Blend scouting and stats SEPARATELY for each component
    const eyeValue = scoutingWeight * scoutRates.bbPct + (1 - scoutingWeight) * adjustedBbPct;
    const avoidKValue = scoutingWeight * scoutRates.kPct + (1 - scoutingWeight) * adjustedKPct;
    const powerValue = scoutingWeight * scoutRates.iso + (1 - scoutingWeight) * adjustedIso;
    const babipValue = scoutingWeight * scoutRates.avg + (1 - scoutingWeight) * adjustedAvg;

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
      eyeValue: Math.round(eyeValue * 100) / 100,
      avoidKValue: Math.round(avoidKValue * 100) / 100,
      powerValue: Math.round(powerValue * 1000) / 1000,
      babipValue: Math.round(babipValue * 1000) / 1000,
      totalMinorPa,
      totalWeightedPa: weightedPa,
      trueRating: input.trueRating,
    };
  }

  /**
   * Calculate True Future Ratings for multiple hitter prospects.
   *
   * NEW ALGORITHM:
   * 1. Blend scouting + stats separately for each component (eye/avoidK/power/babip)
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
      // For power (ISO): higher percentile = higher ISO (use percentile as-is)
      // For babip (AVG): higher percentile = higher AVG (use percentile as-is)
      let projBbPct = this.mapPercentileToMLBValue(percentiles.eyePercentile, mlbDist.bbPctValues);
      let projKPct = this.mapPercentileToMLBValue(100 - percentiles.avoidKPercentile, mlbDist.kPctValues);
      let projIso = this.mapPercentileToMLBValue(percentiles.powerPercentile, mlbDist.isoValues);
      let projAvg = this.mapPercentileToMLBValue(percentiles.babipPercentile, mlbDist.avgValues);

      // Clamp to realistic ranges
      projBbPct = Math.max(3.0, Math.min(20.0, projBbPct));
      projKPct = Math.max(5.0, Math.min(35.0, projKPct));
      projIso = Math.max(0.05, Math.min(0.350, projIso));
      projAvg = Math.max(0.200, Math.min(0.350, projAvg));

      // Calculate peak wOBA from mapped rates
      const projWoba = this.calculateWobaFromRates(projBbPct, projKPct, projIso, projAvg);

      return {
        ...result,
        eyePercentile: Math.round(percentiles.eyePercentile * 10) / 10,
        avoidKPercentile: Math.round(percentiles.avoidKPercentile * 10) / 10,
        powerPercentile: Math.round(percentiles.powerPercentile * 10) / 10,
        babipPercentile: Math.round(percentiles.babipPercentile * 10) / 10,
        projBbPct: Math.round(projBbPct * 10) / 10,
        projKPct: Math.round(projKPct * 10) / 10,
        projIso: Math.round(projIso * 1000) / 1000,
        projAvg: Math.round(projAvg * 1000) / 1000,
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
        babipPercentile: result.babipPercentile,
        scoutBbPct: result.scoutBbPct,
        scoutKPct: result.scoutKPct,
        scoutIso: result.scoutIso,
        scoutAvg: result.scoutAvg,
        adjustedBbPct: result.adjustedBbPct,
        adjustedKPct: result.adjustedKPct,
        adjustedIso: result.adjustedIso,
        adjustedAvg: result.adjustedAvg,
        projBbPct: result.projBbPct,
        projKPct: result.projKPct,
        projIso: result.projIso,
        projAvg: result.projAvg,
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
