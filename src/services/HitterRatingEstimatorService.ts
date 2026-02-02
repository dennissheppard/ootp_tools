/**
 * HitterRatingEstimatorService
 *
 * Estimates hitter ratings (20-80 scale) from performance statistics.
 * Regression coefficients calibrated from ootp_hitter_data_20260201.csv.
 *
 * Key mappings:
 * - Power (20-80) → ISO (Isolated Power)
 * - Eye (20-80) → BB%
 * - AvoidK (20-80) → K% (inverse)
 * - BABIP (20-80) → Batting Average
 * - Gap (20-80) → Doubles rate
 * - Speed (20-200) → Triples rate
 */

interface HitterStatInput {
  pa: number;      // Plate appearances
  ab: number;      // At bats
  h: number;       // Hits
  d: number;       // Doubles
  t: number;       // Triples
  hr: number;      // Home runs
  bb: number;      // Walks
  k: number;       // Strikeouts
  sb?: number;     // Stolen bases (optional)
}

interface RatingEstimate {
  rating: number;
  low: number;
  high: number;
  confidence: 'high' | 'moderate' | 'low';
}

interface EstimatedHitterRatings {
  power: RatingEstimate;
  eye: RatingEstimate;
  avoidK: RatingEstimate;
  babip: RatingEstimate;
  gap: RatingEstimate;
  speed: RatingEstimate;
  woba?: number;
}

/**
 * Stabilization constants (PA needed for stat to stabilize)
 * Based on baseball research and OOTP simulation patterns
 */
const STABILIZATION = {
  bb_pct: 120,   // BB% stabilizes relatively quickly
  k_pct: 60,     // K% stabilizes very quickly
  iso: 160,      // ISO takes longer to stabilize
  avg: 910,      // AVG (BABIP) takes a long time
  doubles: 250,  // Doubles rate
  triples: 500,  // Triples are rare, need large sample
};

/**
 * Regression coefficients calibrated from OOTP hitter data
 *
 * Format: statValue = intercept + slope * rating
 * Inverse: rating = (statValue - intercept) / slope
 */
const REGRESSION_COEFFICIENTS = {
  // Eye (20-80) → BB% (3% to 14%)
  // BB% = -3.18 + 0.206 * eye
  eye: { intercept: -3.18, slope: 0.206 },

  // AvoidK (20-80) → K% (inverse: 33% to 8%)
  // K% = 45.5 - 0.467 * avoidK
  avoidK: { intercept: 45.5, slope: -0.467 },

  // Power (20-80) → ISO (0.03 to 0.22)
  // ISO = -0.088 + 0.0036 * power
  power: { intercept: -0.088, slope: 0.0036 },

  // BABIP rating (20-80) → AVG (0.18 to 0.30)
  // AVG = 0.139 + 0.00236 * babip
  babip: { intercept: 0.139, slope: 0.00236 },

  // Gap (20-80) → Doubles/AB (0.01 to 0.05)
  // D/AB = -0.004 + 0.00058 * gap
  gap: { intercept: -0.004, slope: 0.00058 },

  // Speed (20-200) → Triples/AB (0.002 to 0.015)
  // T/AB = 0.001 + 0.000067 * speed
  speed: { intercept: 0.001, slope: 0.000067 },
};

class HitterRatingEstimatorService {
  private static capRating(rating: number, min: number = 20, max: number = 80): number {
    return Math.max(min, Math.min(max, rating));
  }

  private static getConfidence(
    pa: number,
    stabilizationPa: number
  ): { confidence: 'high' | 'moderate' | 'low'; multiplier: number } {
    if (pa >= stabilizationPa) {
      return { confidence: 'high', multiplier: 1 };
    } else if (pa >= stabilizationPa / 2) {
      return { confidence: 'moderate', multiplier: 1.5 };
    } else {
      return { confidence: 'low', multiplier: 2 };
    }
  }

  /**
   * Estimate Eye rating from BB%
   * BB% = BB / PA * 100
   */
  static estimateEye(bbPct: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.eye;
    // rating = (bbPct - intercept) / slope
    const rawRating = (bbPct - coef.intercept) / coef.slope;
    const rating = this.capRating(Math.round(rawRating));

    const { confidence, multiplier } = this.getConfidence(pa, STABILIZATION.bb_pct);
    const uncertainty = 5 * multiplier;

    return {
      rating,
      low: this.capRating(Math.round(rawRating - uncertainty)),
      high: this.capRating(Math.round(rawRating + uncertainty)),
      confidence,
    };
  }

  /**
   * Estimate AvoidK rating from K%
   * K% = K / PA * 100
   */
  static estimateAvoidK(kPct: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.avoidK;
    // K% = intercept + slope * avoidK (slope is negative)
    // avoidK = (K% - intercept) / slope
    const rawRating = (kPct - coef.intercept) / coef.slope;
    const rating = this.capRating(Math.round(rawRating));

    const { confidence, multiplier } = this.getConfidence(pa, STABILIZATION.k_pct);
    const uncertainty = 5 * multiplier;

    return {
      rating,
      low: this.capRating(Math.round(rawRating - uncertainty)),
      high: this.capRating(Math.round(rawRating + uncertainty)),
      confidence,
    };
  }

  /**
   * Estimate Power rating from ISO
   * ISO = SLG - AVG = (TB - H) / AB
   */
  static estimatePower(iso: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.power;
    const rawRating = (iso - coef.intercept) / coef.slope;
    const rating = this.capRating(Math.round(rawRating));

    const { confidence, multiplier } = this.getConfidence(pa, STABILIZATION.iso);
    const uncertainty = 8 * multiplier;

    return {
      rating,
      low: this.capRating(Math.round(rawRating - uncertainty)),
      high: this.capRating(Math.round(rawRating + uncertainty)),
      confidence,
    };
  }

  /**
   * Estimate BABIP rating from batting average
   * Uses AVG as proxy since true BABIP calculation requires more data
   */
  static estimateBabip(avg: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.babip;
    const rawRating = (avg - coef.intercept) / coef.slope;
    const rating = this.capRating(Math.round(rawRating));

    const { confidence, multiplier } = this.getConfidence(pa, STABILIZATION.avg);
    const uncertainty = 10 * multiplier;

    return {
      rating,
      low: this.capRating(Math.round(rawRating - uncertainty)),
      high: this.capRating(Math.round(rawRating + uncertainty)),
      confidence,
    };
  }

  /**
   * Estimate Gap rating from doubles rate
   * Doubles rate = D / AB
   */
  static estimateGap(doublesRate: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.gap;
    const rawRating = (doublesRate - coef.intercept) / coef.slope;
    const rating = this.capRating(Math.round(rawRating));

    const { confidence, multiplier } = this.getConfidence(pa, STABILIZATION.doubles);
    const uncertainty = 8 * multiplier;

    return {
      rating,
      low: this.capRating(Math.round(rawRating - uncertainty)),
      high: this.capRating(Math.round(rawRating + uncertainty)),
      confidence,
    };
  }

  /**
   * Estimate Speed rating from triples rate
   * Triples rate = T / AB
   * Note: Speed uses 20-200 scale
   */
  static estimateSpeed(triplesRate: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.speed;
    const rawRating = (triplesRate - coef.intercept) / coef.slope;
    const rating = Math.max(20, Math.min(200, Math.round(rawRating)));

    const { confidence, multiplier } = this.getConfidence(pa, STABILIZATION.triples);
    const uncertainty = 20 * multiplier;

    return {
      rating,
      low: Math.max(20, Math.min(200, Math.round(rawRating - uncertainty))),
      high: Math.max(20, Math.min(200, Math.round(rawRating + uncertainty))),
      confidence,
    };
  }

  /**
   * Calculate wOBA (weighted On-Base Average)
   * wOBA = (0.69×BB + 0.72×HBP + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR) / PA
   * Note: HBP not available in our data, so we use simplified formula
   */
  static calculateWoba(stats: HitterStatInput): number {
    const singles = stats.h - stats.d - stats.t - stats.hr;
    const woba = (
      0.69 * stats.bb +
      0.89 * singles +
      1.27 * stats.d +
      1.62 * stats.t +
      2.10 * stats.hr
    ) / stats.pa;
    return Math.round(woba * 1000) / 1000;
  }

  /**
   * Estimate all ratings from stats
   */
  static estimateAll(stats: HitterStatInput): EstimatedHitterRatings {
    // Calculate rate stats
    const bbPct = (stats.bb / stats.pa) * 100;
    const kPct = (stats.k / stats.pa) * 100;
    const avg = stats.h / stats.ab;

    // Calculate ISO: (TB - H) / AB
    const singles = stats.h - stats.d - stats.t - stats.hr;
    const totalBases = singles + 2 * stats.d + 3 * stats.t + 4 * stats.hr;
    const iso = (totalBases - stats.h) / stats.ab;

    // Doubles and triples rates
    const doublesRate = stats.d / stats.ab;
    const triplesRate = stats.t / stats.ab;

    // Calculate wOBA
    const woba = this.calculateWoba(stats);

    return {
      power: this.estimatePower(iso, stats.pa),
      eye: this.estimateEye(bbPct, stats.pa),
      avoidK: this.estimateAvoidK(kPct, stats.pa),
      babip: this.estimateBabip(avg, stats.pa),
      gap: this.estimateGap(doublesRate, stats.pa),
      speed: this.estimateSpeed(triplesRate, stats.pa),
      woba,
    };
  }

  /**
   * Calculate expected stat from rating (forward calculation)
   */
  static expectedBbPct(eye: number): number {
    const coef = REGRESSION_COEFFICIENTS.eye;
    return coef.intercept + coef.slope * eye;
  }

  static expectedKPct(avoidK: number): number {
    const coef = REGRESSION_COEFFICIENTS.avoidK;
    return coef.intercept + coef.slope * avoidK;
  }

  static expectedIso(power: number): number {
    const coef = REGRESSION_COEFFICIENTS.power;
    return coef.intercept + coef.slope * power;
  }

  static expectedAvg(babip: number): number {
    const coef = REGRESSION_COEFFICIENTS.babip;
    return coef.intercept + coef.slope * babip;
  }

  static expectedDoublesRate(gap: number): number {
    const coef = REGRESSION_COEFFICIENTS.gap;
    return coef.intercept + coef.slope * gap;
  }

  static expectedTriplesRate(speed: number): number {
    const coef = REGRESSION_COEFFICIENTS.speed;
    return coef.intercept + coef.slope * speed;
  }

  /**
   * Compare estimated rating to scouting rating
   */
  static compareToScout(estimated: RatingEstimate, scoutRating: number): string {
    if (scoutRating >= estimated.low && scoutRating <= estimated.high) {
      return "Accurate";
    } else if (scoutRating < estimated.low) {
      return "Scout LOW";
    } else {
      return "Scout HIGH";
    }
  }
}

export { HitterRatingEstimatorService };
export type { HitterStatInput, EstimatedHitterRatings };
export type { RatingEstimate as HitterRatingEstimate };
