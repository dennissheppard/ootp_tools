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
import { contractService } from './ContractService';

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

/**
 * Intermediate result with blended component values (before percentile ranking)
 */
export interface ComponentBlendedResult {
  playerId: number;
  playerName: string;
  age: number;
  /** Scouting-expected rates */
  scoutK9: number;
  scoutBb9: number;
  scoutHr9: number;
  /** Adjusted minor league rates (MLB-equivalent) */
  adjustedK9: number;
  adjustedBb9: number;
  adjustedHr9: number;
  /** Blended component values (weighted scout + stats) */
  stuffValue: number;   // Blended K9
  controlValue: number; // Blended BB9
  hraValue: number;     // Blended HR9
  /** Total minor league IP */
  totalMinorIp: number;
  /** True Rating if available (for comparison) */
  trueRating?: number;
}

export interface TrueFutureRatingResult {
  playerId: number;
  playerName: string;
  age: number;
  /** Percentile rank for Stuff component (0-100) */
  stuffPercentile: number;
  /** Percentile rank for Control component (0-100) */
  controlPercentile: number;
  /** Percentile rank for HRA component (0-100) */
  hraPercentile: number;
  /** True ratings - normalized from percentiles (20-80 scale) */
  trueStuff: number;
  trueControl: number;
  trueHra: number;
  /** Scouting-expected rates */
  scoutK9: number;
  scoutBb9: number;
  scoutHr9: number;
  /** Adjusted minor league rates (MLB-equivalent) */
  adjustedK9: number;
  adjustedBb9: number;
  adjustedHr9: number;
  /** Projected rates (mapped from MLB distributions) */
  projK9: number;
  projBb9: number;
  projHr9: number;
  /** Projected peak FIP */
  projFip: number;
  /** Percentile rank among all prospects */
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

/**
 * Level weights for IP reliability calculation
 *
 * Converts raw IP to "AAA-equivalent IP" for scouting weight determination.
 * 100 IP in Rookie ball is much less reliable than 100 IP in AAA.
 *
 * TUNABLE: These values can be optimized via parameter search
 */
const LEVEL_IP_WEIGHTS: Record<MinorLeagueLevel, number> = {
  aaa: 1.0,  // Full weight - AAA IP is highly reliable
  aa: 0.7,   // 100 AA IP = 70 "AAA-equivalent" IP
  a: 0.4,    // 100 A IP = 40 "AAA-equivalent" IP
  r: 0.2,    // 100 R IP = 20 "AAA-equivalent" IP (very unreliable)
};

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
  { threshold: 99.0, rating: 5.0 },  // Elite: Top 1% (~10 prospects)
  { threshold: 97.0, rating: 4.5 },  // Star: 97-99% (~20 prospects)
  { threshold: 93.0, rating: 4.0 },  // Above Avg: 93-97% (~40 prospects)
  { threshold: 75.0, rating: 3.5 },  // Average: 75-93% (~180 prospects)
  { threshold: 60.0, rating: 3.0 },  // Fringe: 60-75% (~150 prospects)
  { threshold: 35.0, rating: 2.5 },  // Below Avg: 35-60% (~250 prospects)
  { threshold: 20.0, rating: 2.0 },  // Poor: 20-35% (~150 prospects)
  { threshold: 10.0, rating: 1.5 },  // Very Poor: 10-20% (~100 prospects)
  { threshold: 5.0, rating: 1.0 },   // Replacement: 5-10% (~50 prospects)
  { threshold: 0.0, rating: 0.5 },   // Bust: 0-5% (~50 prospects)
];

// ============================================================================
// MLB Distribution Interface
// ============================================================================

export interface MLBPercentileDistribution {
  k9Values: number[];   // Sorted ascending (higher is better)
  bb9Values: number[];  // Sorted ascending (lower is better)
  hr9Values: number[];  // Sorted ascending (lower is better)
}

// ============================================================================
// Service Class
// ============================================================================

class TrueFutureRatingService {
  /**
   * Calculate scouting weight based on level-weighted IP (experience).
   *
   * Higher weight = trust scouting more (limited stats)
   * Lower weight = trust stats more (proven track record)
   *
   * UPDATED: January 31, 2026 - Level-weighted IP approach
   * Weight determined by "AAA-equivalent IP", not raw IP
   * IP is weighted by level (AAA=1.0, AA=0.7, A=0.4, R=0.2)
   *
   * Weighted IP < 75: 100% scout (no reliable stats)
   * Weighted IP 76-150: 80% scout (emerging track record)
   * Weighted IP 151-250: 70% scout (solid sample)
   * Weighted IP 250+: 60% scout (extensive track record)
   *
   * Example: 150 IP in Rookie (150 * 0.2 = 30 weighted) → 100% scout weight
   *          150 IP in AAA (150 * 1.0 = 150 weighted) → 80% scout weight
   */
  calculateScoutingWeight(weightedIp: number): number {
    if (weightedIp < 75) return 1.0;       // 100% scout
    else if (weightedIp <= 150) return 0.8; // 80% scout
    else if (weightedIp <= 250) return 0.7; // 70% scout
    else return 0.6;                          // 60% scout
  }

  /**
   * Build MLB percentile distributions from 2015-2020 peak-age data.
   * Returns sorted arrays of K9, BB9, HR9 rates for mapping prospect percentiles.
   *
   * UPDATED: January 31, 2026 - Peak-age filtering
   * Uses ages 25-29 only (peak years) to build distributions
   * This ensures we're mapping prospect peaks to actual MLB peaks
   */
  async buildMLBPercentileDistribution(): Promise<MLBPercentileDistribution> {
    const years = [2015, 2016, 2017, 2018, 2019, 2020];
    const allK9: number[] = [];
    const allBb9: number[] = [];
    const allHr9: number[] = [];

    // Load DOB data to filter by age
    const dobMap = await this.loadPlayerDOBs();

    // Load MLB data for all years
    for (const year of years) {
      try {
        const mlbStats = await trueRatingsService.getTruePitchingStats(year);

        // Extract rate stats from peak-age pitchers only (25-29)
        for (const stat of mlbStats) {
          const ip = trueRatingsService.parseIp(stat.ip);

          // Require minimum IP to avoid small-sample outliers
          // 50 IP is about 1/3 of a starter season or a full reliever season
          if (ip < 50) continue;

          // Calculate age for this season
          const age = this.calculateAge(dobMap.get(stat.player_id), year);
          if (!age || age < 25 || age > 29) continue; // Skip non-peak ages

          // Calculate rate stats from counting stats
          const k9 = (stat.k / ip) * 9;
          const bb9 = (stat.bb / ip) * 9;
          const hr9 = (stat.hra / ip) * 9;

          // Validate rates are reasonable (filter extreme outliers)
          // These are very generous bounds - just catching data errors
          if (k9 > 2 && k9 < 15 && bb9 >= 0.5 && bb9 < 8 && hr9 >= 0.2 && hr9 < 3) {
            allK9.push(k9);
            allBb9.push(bb9);
            allHr9.push(hr9);
          }
        }
      } catch (error) {
        console.warn(`Failed to load MLB data for ${year}, skipping:`, error);
      }
    }

    // Sort arrays (for percentile lookup)
    allK9.sort((a, b) => a - b);  // Ascending: lower values = lower percentile
    allBb9.sort((a, b) => a - b); // Ascending: lower values = lower percentile (better)
    allHr9.sort((a, b) => a - b); // Ascending: lower values = lower percentile (better)

    console.log(`📊 Built MLB distributions: ${allK9.length} peak-age pitchers (ages 25-29) from 2015-2020`);

    return {
      k9Values: allK9,
      bb9Values: allBb9,
      hr9Values: allHr9,
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

      console.log(`📅 Loaded ${dobMap.size} player DOBs`);
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
   * @returns Map of playerId to { stuffPercentile, controlPercentile, hraPercentile }
   */
  rankProspectsByComponent(
    componentResults: ComponentBlendedResult[]
  ): Map<number, { stuffPercentile: number; controlPercentile: number; hraPercentile: number }> {
    const percentiles = new Map<number, { stuffPercentile: number; controlPercentile: number; hraPercentile: number }>();

    if (componentResults.length === 0) {
      return percentiles;
    }

    const n = componentResults.length;

    // Handle single prospect edge case - assign 50th percentile (no ranking possible)
    if (n === 1) {
      const prospect = componentResults[0];
      percentiles.set(prospect.playerId, { stuffPercentile: 50, controlPercentile: 50, hraPercentile: 50 });
      return percentiles;
    }

    // Rank by Stuff (K9 - higher is better)
    const stuffSorted = [...componentResults].sort((a, b) => b.stuffValue - a.stuffValue);
    for (let i = 0; i < n; i++) {
      const prospect = stuffSorted[i];
      const stuffPercentile = ((n - i - 1) / (n - 1)) * 100;

      if (!percentiles.has(prospect.playerId)) {
        percentiles.set(prospect.playerId, { stuffPercentile: 0, controlPercentile: 0, hraPercentile: 0 });
      }
      percentiles.get(prospect.playerId)!.stuffPercentile = stuffPercentile;
    }

    // Rank by Control (BB9 - lower is better, so invert)
    const controlSorted = [...componentResults].sort((a, b) => a.controlValue - b.controlValue);
    for (let i = 0; i < n; i++) {
      const prospect = controlSorted[i];
      const controlPercentile = ((n - i - 1) / (n - 1)) * 100;

      percentiles.get(prospect.playerId)!.controlPercentile = controlPercentile;
    }

    // Rank by HRA (HR9 - lower is better, so invert)
    const hraSorted = [...componentResults].sort((a, b) => a.hraValue - b.hraValue);
    for (let i = 0; i < n; i++) {
      const prospect = hraSorted[i];
      const hraPercentile = ((n - i - 1) / (n - 1)) * 100;

      percentiles.get(prospect.playerId)!.hraPercentile = hraPercentile;
    }

    return percentiles;
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
   *
   * UPDATED: Now also returns level-weighted IP for scouting weight calculation.
   */
  calculateWeightedMinorStats(
    stats: MinorLeagueStatsWithLevel[],
    currentYear: number
  ): { k9: number; bb9: number; hr9: number; totalIp: number; weightedIp: number } | null {
    if (stats.length === 0) {
      return null;
    }

    let weightedK9Sum = 0;
    let weightedBb9Sum = 0;
    let weightedHr9Sum = 0;
    let totalWeight = 0;
    let totalIp = 0;
    let weightedIp = 0;

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

      // Calculate level-weighted IP for reliability assessment
      // AAA IP is worth 1.0x, AA worth 0.7x, A worth 0.4x, R worth 0.2x
      const levelWeight = LEVEL_IP_WEIGHTS[stat.level] ?? 0.5;
      weightedIp += stat.ip * levelWeight;
    }

    if (totalWeight === 0) {
      return null;
    }

    return {
      k9: weightedK9Sum / totalWeight,
      bb9: weightedBb9Sum / totalWeight,
      hr9: weightedHr9Sum / totalWeight,
      totalIp,
      weightedIp, // "AAA-equivalent IP" for scouting weight determination
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
   * Calculate True Future Rating for a single player (simplified version).
   * NOTE: This is a legacy function for individual prospect lookups.
   * For accurate TFR ratings, use calculateTrueFutureRatings() with full prospect pool.
   *
   * This function estimates TFR without MLB distribution mapping or proper percentile ranking.
   * It's useful for quick estimates but won't be as accurate as the full algorithm.
   */
  calculateTrueFutureRating(input: TrueFutureRatingInput): {
    projFip: number;
    projK9: number;
    projBb9: number;
    projHr9: number;
    totalMinorIp: number;
  } {
    const componentBlend = this.calculateComponentBlend(input);

    // For individual calculations, just use the blended values directly
    // (without MLB distribution mapping)
    const projFip = this.calculateFip(
      componentBlend.stuffValue,
      componentBlend.controlValue,
      componentBlend.hraValue
    );

    return {
      projFip: Math.round(projFip * 100) / 100,
      projK9: Math.round(componentBlend.stuffValue * 100) / 100,
      projBb9: Math.round(componentBlend.controlValue * 100) / 100,
      projHr9: Math.round(componentBlend.hraValue * 100) / 100,
      totalMinorIp: componentBlend.totalMinorIp,
    };
  }

  /**
   * Calculate blended component values for a single player.
   * Returns stuff/control/HRA values (before percentile ranking and MLB mapping).
   */
  calculateComponentBlend(input: TrueFutureRatingInput): ComponentBlendedResult {
    const { scouting, minorLeagueStats, age } = input;

    // Calculate weighted minor league stats
    const currentYear = minorLeagueStats.length > 0
      ? Math.max(...minorLeagueStats.map(s => s.year))
      : new Date().getFullYear();

    const weightedStats = this.calculateWeightedMinorStats(minorLeagueStats, currentYear);
    const totalMinorIp = weightedStats?.totalIp ?? 0;
    const weightedIp = weightedStats?.weightedIp ?? 0;

    // Calculate scouting weight (level-weighted IP-based)
    // Use weightedIp instead of totalIp to account for level reliability
    const scoutingWeight = this.calculateScoutingWeight(weightedIp);

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

    // Blend scouting and stats SEPARATELY for each component
    const stuffValue = scoutingWeight * scoutRates.k9 + (1 - scoutingWeight) * adjustedK9;
    const controlValue = scoutingWeight * scoutRates.bb9 + (1 - scoutingWeight) * adjustedBb9;
    const hraValue = scoutingWeight * scoutRates.hr9 + (1 - scoutingWeight) * adjustedHr9;

    return {
      playerId: input.playerId,
      playerName: input.playerName,
      age,
      scoutK9: Math.round(scoutRates.k9 * 100) / 100,
      scoutBb9: Math.round(scoutRates.bb9 * 100) / 100,
      scoutHr9: Math.round(scoutRates.hr9 * 100) / 100,
      adjustedK9: Math.round(adjustedK9 * 100) / 100,
      adjustedBb9: Math.round(adjustedBb9 * 100) / 100,
      adjustedHr9: Math.round(adjustedHr9 * 100) / 100,
      stuffValue: Math.round(stuffValue * 100) / 100,
      controlValue: Math.round(controlValue * 100) / 100,
      hraValue: Math.round(hraValue * 100) / 100,
      totalMinorIp,
      trueRating: input.trueRating,
    };
  }

  /**
   * Calculate True Future Ratings for multiple players using percentile-based approach.
   *
   * NEW ALGORITHM (January 31, 2026):
   * 1. Blend scouting + stats separately for each component (stuff/control/HRA)
   * 2. Rank prospects by each component to get percentiles
   * 3. Map percentiles to MLB distributions (2015-2020)
   * 4. Calculate peak FIP from mapped rates
   * 5. Rank by FIP for final TFR rating
   *
   * @param inputs - Array of prospect inputs
   * @returns Array of TrueFutureRatingResult with percentiles and ratings
   */
  async calculateTrueFutureRatings(
    inputs: TrueFutureRatingInput[]
  ): Promise<TrueFutureRatingResult[]> {
    if (inputs.length === 0) {
      return [];
    }

    // Step 1: Calculate component blends for all prospects
    const componentResults = inputs.map(input => this.calculateComponentBlend(input));

    // Step 2: Rank by each component to get percentiles
    const componentPercentiles = this.rankProspectsByComponent(componentResults);

    // Step 3: Load MLB distribution for mapping
    const mlbDist = await this.buildMLBPercentileDistribution();

    // Step 4: Map percentiles to MLB rates and calculate FIP
    const resultsWithFip = componentResults.map(result => {
      const percentiles = componentPercentiles.get(result.playerId)!;

      // Map percentiles to MLB distribution values
      // For stuff (K9): higher percentile = higher K9 (use percentile as-is)
      // For control (BB9): higher percentile = lower BB9 (invert percentile)
      // For HRA (HR9): higher percentile = lower HR9 (invert percentile)
      let projK9 = this.mapPercentileToMLBValue(percentiles.stuffPercentile, mlbDist.k9Values);
      let projBb9 = this.mapPercentileToMLBValue(100 - percentiles.controlPercentile, mlbDist.bb9Values);
      let projHr9 = this.mapPercentileToMLBValue(100 - percentiles.hraPercentile, mlbDist.hr9Values);

      // Clamp to realistic ranges based on actual MLB peak-age extremes
      // Best observed: K9 9.79, BB9 0.89, HR9 0.2 (Dave Larocque 2020, 123 IP)
      // Allow generational prospects (80/80/80 scouting) to achieve historical bests
      // If someone is truly elite at ALL three phases, extreme FIP (~2.0) is mathematically correct
      projK9 = Math.max(3.0, Math.min(11.0, projK9));   // Max K9: 9.79, allow 11.0 for peak ceiling
      projBb9 = Math.max(0.85, Math.min(7.0, projBb9));  // Min BB9: 0.89 actual, allow 0.85
      projHr9 = Math.max(0.20, Math.min(2.5, projHr9));  // Min HR9: 0.2 actual (Dave Larocque)

      // Calculate peak FIP from mapped rates
      const projFip = this.calculateFip(projK9, projBb9, projHr9);

      return {
        ...result,
        stuffPercentile: Math.round(percentiles.stuffPercentile * 10) / 10,
        controlPercentile: Math.round(percentiles.controlPercentile * 10) / 10,
        hraPercentile: Math.round(percentiles.hraPercentile * 10) / 10,
        projK9: Math.round(projK9 * 100) / 100,
        projBb9: Math.round(projBb9 * 100) / 100,
        projHr9: Math.round(projHr9 * 100) / 100,
        projFip: Math.round(projFip * 100) / 100,
      };
    });

    // Step 5: Rank by FIP among prospects to get final percentile and TFR rating
    const sortedByFip = [...resultsWithFip].sort((a, b) => a.projFip - b.projFip);
    const n = sortedByFip.length;

    return sortedByFip.map((result, index) => {
      // Calculate percentile rank (lower FIP = better = higher percentile)
      // Handle n=1 edge case to avoid division by zero
      const percentile = n === 1 ? 50 : ((n - index - 1) / (n - 1)) * 100;
      const trueFutureRating = this.percentileToRating(percentile);

      // Calculate true ratings from percentiles: rating = 20 + (percentile / 100) * 60
      // This normalizes across all prospects - 50th percentile = 50 rating
      const trueStuff = Math.round(20 + (result.stuffPercentile / 100) * 60);
      const trueControl = Math.round(20 + (result.controlPercentile / 100) * 60);
      const trueHra = Math.round(20 + (result.hraPercentile / 100) * 60);

      return {
        ...result,
        trueStuff,
        trueControl,
        trueHra,
        percentile: Math.round(percentile * 10) / 10,
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

    // Build map of MLB True Ratings by player ID (for comparison)
    const mlbStats = await trueRatingsService.getTruePitchingStats(year);
    const leagueAverages = await trueRatingsService.getLeagueAverages(year);
    const multiYearStats = await trueRatingsService.getMultiYearPitchingStats(year, 3);

    const mlbInputs = mlbStats.map(stat => ({
      playerId: stat.player_id,
      playerName: stat.playerName,
      yearlyStats: multiYearStats.get(stat.player_id) ?? [],
      scoutingRatings: scoutingRatings.find(s => s.playerId === stat.player_id),
    }));

    const mlbTrueRatings = trueRatingsCalculationService.calculateTrueRatings(mlbInputs, leagueAverages);
    const mlbTrMap = new Map(mlbTrueRatings.map(tr => [tr.playerId, tr.trueRating]));

    // Fetch career MLB IP to exclude veterans (>50 IP)
    const careerIpMap = await this.getCareerMlbIpMap(year);
    
    // Fetch contracts to identify affiliated players who haven't played yet (e.g. IC/DSL)
    const contracts = await contractService.getAllContracts();

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

      // Exclude players with significant MLB experience (> 50 IP)
      const careerIp = careerIpMap.get(scouting.playerId) ?? 0;
      if (careerIp > 50) continue;

      // Look up this player's stats from the bulk-fetched data
      const minorStats = allMinorLeagueStats.get(scouting.playerId) ?? [];

      // IMPORTANT: Only include players who actually played in the minors during this period OR are affiliated
      // This excludes amateur/draft prospects who have scouting ratings but haven't debuted yet
      // UNLESS they are signed to a pro team (e.g. International Complex players with no stats)
      const totalIp = minorStats.reduce((sum, stat) => sum + stat.ip, 0);
      
      if (totalIp === 0) {
          // If no stats, check if they have a professional contract
          // Amateurs (Draft Pool) usually don't have a contract entry or have league_id=0/null
          const contract = contracts.get(scouting.playerId);
          if (!contract || contract.leagueId === 0) {
              continue; // Truly amateur/unsigned, skip
          }
          // If they have a contract (e.g. league_id = -200 for IC, or others), include them
      }

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

    // Calculate TFR for all prospects using new percentile-based algorithm
    return await this.calculateTrueFutureRatings(prospectInputs);
  }

  /**
   * Get career MLB IP for all players (last 10 years).
   */
  private async getCareerMlbIpMap(currentYear: number): Promise<Map<number, number>> {
      const startYear = Math.max(2000, currentYear - 10);
      const promises = [];
      for (let y = startYear; y <= currentYear; y++) {
          promises.push(trueRatingsService.getTruePitchingStats(y));
      }
      
      const results = await Promise.all(promises);
      const map = new Map<number, number>();
      
      results.flat().forEach(stat => {
          const ip = trueRatingsService.parseIp(stat.ip);
          const current = map.get(stat.player_id) || 0;
          map.set(stat.player_id, current + ip);
      });
      
      return map;
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
