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

/** Level adjustments to translate minor league stats to MLB-equivalent */
const LEVEL_ADJUSTMENTS: Record<MinorLeagueLevel, { k9: number; bb9: number; hr9: number }> = {
  aaa: { k9: 0.30, bb9: -0.42, hr9: 0.14 },
  aa: { k9: 0.33, bb9: -0.47, hr9: 0.06 },
  a: { k9: 0.22, bb9: -0.59, hr9: 0.07 },
  r: { k9: 0.45, bb9: -0.58, hr9: 0.06 },
};

/** Year weights for minor league stats (current year, previous year) */
const MINOR_YEAR_WEIGHTS = [5, 3];

/** FIP constant (WBL calibrated) */
const FIP_CONSTANT = 3.47;

/** Percentile thresholds for True Rating conversion */
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

class TrueFutureRatingService {
  /**
   * Calculate scouting weight based on age, star gap, and IP.
   *
   * Higher weight = trust scouting more (stats are noise)
   * Lower weight = trust stats more (player is developed)
   *
   * MiLB stats in OOTP are unreliable - correlation to potential is weak.
   * When we HAVE scouting data, we should trust it heavily.
   */
  calculateScoutingWeight(age: number, starGap: number, totalMinorIp: number): number {
    // Older players: stats become more reliable as they mature
    if (age >= 30) return 0.40;
    if (age >= 27) return 0.50;

    // For younger players, trust scouting heavily since MiLB stats are noisy
    const baseWeight = 0.65;

    // More raw (larger gap) = trust scouting more
    const gapBonus = (starGap / 4.0) * 0.15; // 0% to 15%

    // Less IP = trust scouting more (stats are noisy)
    const ipFactor = (50 / (50 + totalMinorIp)) * 0.15; // 0% to 15%

    return Math.min(0.95, baseWeight + gapBonus + ipFactor);
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
    // Calculate base results
    const results = inputs.map(input => this.calculateTrueFutureRating(input));

    // Combine prospect FIPs with MLB FIPs for percentile calculation
    const allFips = [...mlbFips, ...results.map(r => r.projFip)];
    allFips.sort((a, b) => a - b); // Lower FIP is better

    const n = allFips.length;

    // Calculate percentile for each prospect
    return results.map(result => {
      // Find rank (1-indexed, lower FIP = better rank)
      let rank = 1;
      for (const fip of allFips) {
        if (fip < result.projFip) rank++;
        else break;
      }

      // Handle ties by averaging
      let tiedCount = 0;
      for (const fip of allFips) {
        if (fip === result.projFip) tiedCount++;
      }
      const avgRank = rank + (tiedCount - 1) / 2;

      // Convert rank to percentile (inverted so higher = better)
      const percentile = Math.round(((n - avgRank + 0.5) / n) * 1000) / 10;
      const trueFutureRating = this.percentileToRating(percentile);

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
    const mlbFips = mlbTrueRatings.map(tr => tr.fipLike + FIP_CONSTANT);

    // Build map of MLB True Ratings by player ID
    const mlbTrMap = new Map(mlbTrueRatings.map(tr => [tr.playerId, tr.trueRating]));

    // Build prospect inputs
    const prospectInputs: TrueFutureRatingInput[] = [];

    for (const scouting of scoutingRatings) {
      // Skip if no valid ID or ratings
      if (scouting.playerId <= 0) continue;

      // Get minor league stats for this player (last 3 years)
      const minorStats = await minorLeagueStatsService.getPlayerStats(
        scouting.playerId,
        year - 2,
        year
      );

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
