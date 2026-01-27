/**
 * Service for calculating ensemble projections using multiple models.
 *
 * Combines three projection approaches to handle edge cases better:
 * - Optimistic: Standard aging curves (current system)
 * - Neutral: Conservative aging (20% of normal adjustment)
 * - Pessimistic: Trend continuation (dampened 50%)
 *
 * Dynamic weights adjust based on:
 * - IP confidence (more IP = trust recent performance)
 * - Age factor (younger = expect more development)
 * - Trend direction (declining/improving/stable)
 * - Volatility (high variance = favor neutral)
 */

import { agingService, RatingModifiers } from './AgingService';
import { PotentialStatsService } from './PotentialStatsService';
import { YearlyPitchingStats } from './TrueRatingsCalculationService';

export interface EnsembleProjection {
  // Final blended rates
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;

  // Individual model outputs (for debugging/calibration)
  components: {
    optimistic: { k9: number; bb9: number; hr9: number; fip: number };
    neutral: { k9: number; bb9: number; hr9: number; fip: number };
    pessimistic: { k9: number; bb9: number; hr9: number; fip: number };
  };

  // Weights used in final blend
  weights: {
    optimistic: number;
    neutral: number;
    pessimistic: number;
  };

  // Metadata for understanding the projection
  metadata: {
    totalIp: number;
    recentTrend: 'improving' | 'declining' | 'stable' | 'volatile';
    trendMagnitude: number; // e.g., -0.46 K/9 change
    confidence: 'low' | 'medium' | 'high';
  };
}

export interface EnsembleInput {
  currentRatings: { stuff: number; control: number; hra: number };
  age: number;
  yearlyStats?: YearlyPitchingStats[];
  leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number };
}

/**
 * Configurable weight parameters for calibration
 */
export interface WeightParams {
  baseOptimistic: number;
  baseNeutral: number;
  basePessimistic: number;
  ageImpact: number;
  ipImpact: number;
  trendImpact: number;
  volatilityImpact: number;
}

/**
 * Default weight parameters (CALIBRATED - Jan 2026)
 *
 * Calibrated on 2015-2020 historical data (42,768 combinations tested)
 * Performance vs baseline (0.825 K/9 MAE):
 * - K/9 MAE: 0.798 (3.3% improvement)
 * - K/9 Bias: +0.024 (nearly perfect)
 * - FIP MAE: 0.602 (excellent)
 * - All metrics improved with no negative side effects
 */
const DEFAULT_WEIGHT_PARAMS: WeightParams = {
  baseOptimistic: 0.35,
  baseNeutral: 0.55,
  basePessimistic: 0.10,
  ageImpact: 0.35,
  ipImpact: 0.35,
  trendImpact: 0.40,
  volatilityImpact: 0.80
};

class EnsembleProjectionService {
  private weightParams: WeightParams = DEFAULT_WEIGHT_PARAMS;

  /**
   * Set custom weight parameters (for calibration)
   */
  setWeightParams(params: WeightParams): void {
    this.weightParams = params;
  }

  /**
   * Reset to default weight parameters
   */
  resetWeightParams(): void {
    this.weightParams = DEFAULT_WEIGHT_PARAMS;
  }

  /**
   * Get current weight parameters
   */
  getWeightParams(): WeightParams {
    return { ...this.weightParams };
  }
  /**
   * Calculate ensemble projection from multiple models
   */
  calculateEnsemble(input: EnsembleInput): EnsembleProjection {
    const { currentRatings, age, yearlyStats, leagueContext } = input;

    // STEP 1: Calculate all three models
    const optimistic = this.calculateOptimisticModel(currentRatings, age, leagueContext);
    const neutral = this.calculateNeutralModel(currentRatings, age, leagueContext);
    const pessimistic = this.calculatePessimisticModel(
      currentRatings,
      age,
      yearlyStats,
      leagueContext
    );

    // STEP 2: Calculate confidence factors
    const totalIp = yearlyStats?.reduce((sum, s) => sum + s.ip, 0) ?? 0;
    const ipConfidence = this.calculateIpConfidence(totalIp);
    const ageFactor = this.calculateAgeFactor(age);
    const trendFactor = yearlyStats && yearlyStats.length >= 2
      ? this.calculateTrendFactor(yearlyStats)
      : { direction: 'stable' as const, magnitude: 0, confidence: 0 };
    const trendVolatility = yearlyStats && yearlyStats.length >= 3
      ? this.calculateTrendVolatility(yearlyStats)
      : 0.15; // Default moderate volatility

    // STEP 3: Calculate ensemble weights (using calibrated parameters)
    const weights = this.calculateEnsembleWeights(
      ipConfidence,
      ageFactor,
      trendVolatility,
      trendFactor
    );

    // STEP 4: Blend projections
    const blendedK9 =
      optimistic.k9 * weights.optimistic +
      neutral.k9 * weights.neutral +
      pessimistic.k9 * weights.pessimistic;

    const blendedBb9 =
      optimistic.bb9 * weights.optimistic +
      neutral.bb9 * weights.neutral +
      pessimistic.bb9 * weights.pessimistic;

    const blendedHr9 =
      optimistic.hr9 * weights.optimistic +
      neutral.hr9 * weights.neutral +
      pessimistic.hr9 * weights.pessimistic;

    const blendedFip =
      optimistic.fip * weights.optimistic +
      neutral.fip * weights.neutral +
      pessimistic.fip * weights.pessimistic;

    // STEP 5: Generate metadata
    const metadata = {
      totalIp,
      recentTrend: this.determineTrendCategory(trendFactor, trendVolatility),
      trendMagnitude: trendFactor.magnitude,
      confidence: ipConfidence > 0.7 ? 'high' as const :
                  ipConfidence > 0.4 ? 'medium' as const :
                  'low' as const
    };

    return {
      k9: Math.round(blendedK9 * 100) / 100,
      bb9: Math.round(blendedBb9 * 100) / 100,
      hr9: Math.round(blendedHr9 * 100) / 100,
      fip: Math.round(blendedFip * 100) / 100,
      components: { optimistic, neutral, pessimistic },
      weights,
      metadata
    };
  }

  /**
   * Optimistic Model: Current system with full aging curve
   */
  private calculateOptimisticModel(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number }
  ): { k9: number; bb9: number; hr9: number; fip: number } {
    // Apply standard aging curve
    const projectedRatings = agingService.applyAging(currentRatings, age);

    const k9 = PotentialStatsService.calculateK9(projectedRatings.stuff);
    const bb9 = PotentialStatsService.calculateBB9(projectedRatings.control);
    const hr9 = PotentialStatsService.calculateHR9(projectedRatings.hra);

    return {
      k9,
      bb9,
      hr9,
      fip: this.calculateFip(k9, bb9, hr9, leagueContext.fipConstant)
    };
  }

  /**
   * Neutral Model: Conservative aging (20% of normal adjustment)
   */
  private calculateNeutralModel(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number }
  ): { k9: number; bb9: number; hr9: number; fip: number } {
    // Get aging modifiers but only apply 20%
    const agingMods = agingService.getAgingModifiers(age);
    const dampedMods: RatingModifiers = {
      stuff: agingMods.stuff * 0.2,
      control: agingMods.control * 0.2,
      hra: agingMods.hra * 0.2
    };

    // Apply dampened aging with clamping
    const clamp = (val: number) => Math.max(20, Math.min(80, val));
    const projectedRatings = {
      stuff: clamp(currentRatings.stuff + dampedMods.stuff),
      control: clamp(currentRatings.control + dampedMods.control),
      hra: clamp(currentRatings.hra + dampedMods.hra)
    };

    const k9 = PotentialStatsService.calculateK9(projectedRatings.stuff);
    const bb9 = PotentialStatsService.calculateBB9(projectedRatings.control);
    const hr9 = PotentialStatsService.calculateHR9(projectedRatings.hra);

    return {
      k9,
      bb9,
      hr9,
      fip: this.calculateFip(k9, bb9, hr9, leagueContext.fipConstant)
    };
  }

  /**
   * Pessimistic Model: Trend-based projection (dampened 50%)
   */
  private calculatePessimisticModel(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    yearlyStats: YearlyPitchingStats[] | undefined,
    leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number }
  ): { k9: number; bb9: number; hr9: number; fip: number } {
    // If no trend data available, fall back to neutral model
    if (!yearlyStats || yearlyStats.length < 2) {
      return this.calculateNeutralModel(currentRatings, age, leagueContext);
    }

    // Calculate recent trends (year-over-year change)
    const recentK9 = yearlyStats[0].k9;
    const previousK9 = yearlyStats[1].k9;
    const k9Trend = recentK9 - previousK9;

    const recentBb9 = yearlyStats[0].bb9;
    const previousBb9 = yearlyStats[1].bb9;
    const bb9Trend = recentBb9 - previousBb9;

    const recentHr9 = yearlyStats[0].hr9;
    const previousHr9 = yearlyStats[1].hr9;
    const hr9Trend = recentHr9 - previousHr9;

    // Calculate IP confidence for adaptive dampening
    const totalIp = yearlyStats.reduce((sum, s) => sum + s.ip, 0);
    const ipConfidence = this.calculateIpConfidence(totalIp);

    // ENHANCED: Adaptive dampening based on player context
    // Young declining players and old declining players need higher dampening
    // Improving players should be more conservative (could be variance)
    const k9Dampening = this.calculateAdaptiveDampening(age, k9Trend, ipConfidence);
    const bb9Dampening = this.calculateAdaptiveDampening(age, bb9Trend, ipConfidence);
    const hr9Dampening = this.calculateAdaptiveDampening(age, hr9Trend, ipConfidence);

    // Convert current ratings to stats as baseline
    const currentK9 = PotentialStatsService.calculateK9(currentRatings.stuff);
    const currentBb9 = PotentialStatsService.calculateBB9(currentRatings.control);
    const currentHr9 = PotentialStatsService.calculateHR9(currentRatings.hra);

    // Apply adaptive trend
    const projK9 = currentK9 + (k9Trend * k9Dampening);
    const projBb9 = currentBb9 + (bb9Trend * bb9Dampening);
    const projHr9 = currentHr9 + (hr9Trend * hr9Dampening);

    // Clamp to reasonable ranges
    const k9 = Math.max(1.0, Math.min(15.0, projK9));
    const bb9 = Math.max(0.5, Math.min(10.0, projBb9));
    const hr9 = Math.max(0.0, Math.min(3.0, projHr9));

    return {
      k9,
      bb9,
      hr9,
      fip: this.calculateFip(k9, bb9, hr9, leagueContext.fipConstant)
    };
  }

  /**
   * Calculate adaptive dampening factor for trend continuation
   *
   * Logic:
   * - Young declining players (age <27, negative trend): Trust the decline more (70-80%)
   * - Old declining players (age >=32, negative trend): Expect continued decline (75-85%)
   * - Improving players: Be conservative, could be variance (30-40%)
   * - Stable/small trends: Moderate dampening (40-50%)
   * - More IP = more confidence in the trend
   */
  private calculateAdaptiveDampening(age: number, trend: number, ipConfidence: number): number {
    let baseDampening = 0.5; // Default 50%

    // Young declining players (<27 years old, negative K/9 trend)
    // These are the problematic cases - development may have stalled
    if (age < 27 && trend < -0.3) {
      baseDampening = 0.65 + (ipConfidence * 0.15); // 65-80%
    } else if (age < 27 && trend < -0.15) {
      baseDampening = 0.55 + (ipConfidence * 0.10); // 55-65%
    }

    // Old declining players (32+)
    // Expect continued decline due to age
    else if (age >= 32 && trend < -0.2) {
      baseDampening = 0.70 + (ipConfidence * 0.15); // 70-85%
    } else if (age >= 32 && trend < -0.1) {
      baseDampening = 0.60 + (ipConfidence * 0.10); // 60-70%
    }

    // Improving players - be more conservative
    // Could be small sample variance or breakout
    else if (trend > 0.4) {
      baseDampening = 0.30 + (ipConfidence * 0.10); // 30-40%
    } else if (trend > 0.2) {
      baseDampening = 0.40 + (ipConfidence * 0.10); // 40-50%
    }

    // Small trends - moderate dampening
    else if (Math.abs(trend) < 0.15) {
      baseDampening = 0.35 + (ipConfidence * 0.10); // 35-45%
    }

    return Math.min(0.9, Math.max(0.2, baseDampening)); // Clamp to 20-90%
  }

  /**
   * Calculate IP confidence factor (0-1 scale)
   * More IP = higher confidence in recent performance
   */
  private calculateIpConfidence(totalIp: number): number {
    // Linear scale: 0 IP = 0.0, 300 IP = 1.0 (capped)
    return Math.min(1.0, totalIp / 300);
  }

  /**
   * Calculate age factor (0-1 scale)
   * Younger players = higher optimistic weight (more development expected)
   * Older players = higher neutral/pessimistic weight (established talent)
   */
  private calculateAgeFactor(age: number): number {
    if (age < 23) return 0.7;      // Rapid development expected
    if (age < 25) return 0.5;      // Still developing
    if (age < 28) return 0.3;      // Peak plateau
    if (age < 32) return 0.2;      // Slow decline
    return 0.1;                     // Established decline
  }

  /**
   * Calculate trend direction, magnitude, and confidence
   */
  private calculateTrendFactor(yearlyStats: YearlyPitchingStats[]): {
    direction: 'improving' | 'declining' | 'stable';
    magnitude: number;
    confidence: number;
  } {
    if (!yearlyStats || yearlyStats.length < 2) {
      return { direction: 'stable', magnitude: 0, confidence: 0 };
    }

    const recent = yearlyStats[0];
    const previous = yearlyStats[1];

    const change = recent.k9 - previous.k9;
    const percentChange = change / previous.k9;

    // Weight by IP (more IP = more confident in trend)
    const ipWeight = Math.min(1.0, recent.ip / 60);
    const volatility = this.calculateTrendVolatility(yearlyStats);
    const confidence = ipWeight * (1 - volatility);

    let direction: 'improving' | 'declining' | 'stable';
    if (Math.abs(percentChange) < 0.05) {
      direction = 'stable';
    } else {
      direction = change > 0 ? 'improving' : 'declining';
    }

    return { direction, magnitude: change, confidence };
  }

  /**
   * Calculate trend volatility using coefficient of variation
   * Low volatility = stable performance (trust trend more)
   * High volatility = noisy (trust neutral more)
   */
  private calculateTrendVolatility(yearlyStats: YearlyPitchingStats[]): number {
    if (!yearlyStats || yearlyStats.length < 3) {
      return 0.15; // Default moderate volatility
    }

    const k9Values = yearlyStats.slice(0, 3).map(s => s.k9);
    const mean = k9Values.reduce((a, b) => a + b) / k9Values.length;

    // Avoid division by zero
    if (mean === 0) return 0.15;

    const stdDev = Math.sqrt(
      k9Values.reduce((sum, k9) => sum + Math.pow(k9 - mean, 2), 0) / k9Values.length
    );

    // Coefficient of variation
    return stdDev / mean;
  }

  /**
   * Calculate ensemble weights based on confidence factors
   */
  private calculateEnsembleWeights(
    ipConfidence: number,      // 0-1
    ageFactor: number,         // 0-1
    trendVolatility: number,   // 0-0.5 typically
    trendFactor: { direction: string; magnitude: number; confidence: number }
  ): { optimistic: number; neutral: number; pessimistic: number } {

    const params = this.weightParams;

    // Base weights (from calibrated parameters)
    let wOptimistic = params.baseOptimistic;
    let wNeutral = params.baseNeutral;
    let wPessimistic = params.basePessimistic;

    // Adjust for age (younger = more optimistic)
    wOptimistic += ageFactor * params.ageImpact;
    wNeutral -= ageFactor * (params.ageImpact * 0.5);
    wPessimistic -= ageFactor * (params.ageImpact * 0.5);

    // Adjust for IP confidence (more IP = trust recent performance)
    wOptimistic -= ipConfidence * params.ipImpact;
    wNeutral += ipConfidence * (params.ipImpact * 0.75);
    wPessimistic += ipConfidence * (params.ipImpact * 0.25);

    // Adjust for volatility (high volatility = favor neutral)
    const volatilityPenalty = Math.min(0.2, trendVolatility * params.volatilityImpact);
    wOptimistic -= volatilityPenalty;
    wNeutral += volatilityPenalty;

    // Adjust for trend direction (only if high confidence)
    if (trendFactor.confidence > 0.5) {
      if (trendFactor.direction === 'declining') {
        wPessimistic += params.trendImpact;
        wOptimistic -= params.trendImpact;
      } else if (trendFactor.direction === 'improving') {
        wPessimistic -= params.trendImpact * 0.67;
        wOptimistic += params.trendImpact * 0.67;
      }
    }

    // Ensure non-negative weights
    wOptimistic = Math.max(0, wOptimistic);
    wNeutral = Math.max(0, wNeutral);
    wPessimistic = Math.max(0, wPessimistic);

    // Normalize to sum to 1.0
    const sum = wOptimistic + wNeutral + wPessimistic;
    if (sum === 0) {
      // Fallback to neutral if all weights are zero
      return { optimistic: 0, neutral: 1, pessimistic: 0 };
    }

    return {
      optimistic: wOptimistic / sum,
      neutral: wNeutral / sum,
      pessimistic: wPessimistic / sum
    };
  }

  /**
   * Determine overall trend category
   */
  private determineTrendCategory(
    trendFactor: { direction: string; magnitude: number; confidence: number },
    volatility: number
  ): 'improving' | 'declining' | 'stable' | 'volatile' {
    // High volatility overrides direction
    if (volatility > 0.25) {
      return 'volatile';
    }

    return trendFactor.direction as 'improving' | 'declining' | 'stable';
  }

  /**
   * Calculate FIP from component stats
   * Formula: FIP = ((13×HR/9 + 3×BB/9 - 2×K/9) / 9) + constant
   */
  private calculateFip(k9: number, bb9: number, hr9: number, fipConstant: number): number {
    return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + fipConstant;
  }
}

export const ensembleProjectionService = new EnsembleProjectionService();
