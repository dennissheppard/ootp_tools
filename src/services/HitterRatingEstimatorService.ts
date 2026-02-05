/**
 * HitterRatingEstimatorService
 *
 * Estimates hitter ratings (20-80 scale) from performance statistics.
 * Regression coefficients calibrated from OOTP engine test data (n=225).
 *
 * Key mappings (based on OOTP engine logic):
 * - Eye (20-80) → BB%
 * - AvoidK (20-80) → K% (inverse)
 * - Power (20-80) → HR% (HR per PA)
 * - Contact (20-80) → AVG (batting average) - composite of Hit Tool + AvoidK
 * - Gap (20-80) → Doubles rate
 * - Speed (20-200) → Triples rate
 *
 * Note: Contact rating is used instead of Hit Tool for AVG prediction.
 * Contact = ~60% Hit Tool + ~40% AvoidK, and correlates much better
 * with AVG (r=0.97) than Hit Tool alone (r=0.82).
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
  contact: RatingEstimate;
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
  hr_pct: 170,   // HR% takes longer to stabilize (rare events)
  avg: 910,      // AVG (BABIP) takes a long time
  doubles: 250,  // Doubles rate
  triples: 500,  // Triples are rare, need large sample
};

/**
 * Regression coefficients calibrated from OOTP engine test data (n=225)
 *
 * Format: statValue = intercept + slope * rating
 * Inverse: rating = (statValue - intercept) / slope
 *
 * Contact is used instead of Hit Tool for AVG - it's a composite rating
 * (~60% Hit Tool + ~40% AvoidK) that correlates much better with AVG (r=0.97).
 */
const REGRESSION_COEFFICIENTS = {
  // Eye (20-80) → BB%
  // BB% = 1.6246 + 0.114789 * eye
  // Intercept calibrated via automated optimization (tools/calibrate_batter_coefficients.ts)
  // At 20: 1.6246 + 0.114789 * 20 = 3.92%
  // At 50: 1.6246 + 0.114789 * 50 = 7.36%
  // At 80: 1.6246 + 0.114789 * 80 = 10.81%
  eye: { intercept: 1.6246, slope: 0.114789 },

  // AvoidK (20-80) → K% (inverse)
  // K% = 25.10 - 0.200303 * avoidK
  // Intercept calibrated to minimize K% projection bias
  // At 20: 25.10 - 0.200303 * 20 = 21.09%
  // At 50: 25.10 - 0.200303 * 50 = 15.09%
  // At 80: 25.10 - 0.200303 * 80 = 9.08%
  avoidK: { intercept: 25.10, slope: -0.200303 },

  // Power (20-80) → HR%
  // PIECEWISE LINEAR: Different slopes for low vs high power
  // Calibrated to 2018-2020 backcasting (bias near 0 for all quartiles)
  //
  // The relationship between power and HR% is non-linear:
  // - Low power (20-50): flatter slope (weak hitters cluster together)
  // - High power (50-80): moderate slope (elite power separates)
  //
  // Segment 1 (power <= 50): HR% = -1.034 + 0.0637 * power
  //   At 20: 0.24% (2 HR in 650 PA)
  //   At 50: 2.15% (14 HR in 650 PA)
  //
  // Segment 2 (power > 50): HR% = -2.75 + 0.098 * power
  //   At 50: 2.15% (14 HR in 650 PA) - continuous with low segment
  //   At 80: 5.09% (33 HR in 650 PA)
  //
  // See expectedHrPct() for the piecewise implementation.
  power: {
    low: { intercept: -1.034, slope: 0.0637 },   // power 20-50
    high: { intercept: -2.75, slope: 0.098 },    // power 50-80
  },

  // Contact (20-80) → AVG (.113 to .345)
  // Contact = ~60% Hit Tool + ~40% AvoidK (OOTP composite rating)
  // AVG = 0.035156 + 0.003873 * contact
  // Slope calibrated for True Ratings to match distribution of other components
  // Anchored so 57 contact = .260 (league average)
  // At 20: 0.035156 + 0.003873 * 20 = 0.113 (poor)
  // At 50: 0.035156 + 0.003873 * 50 = 0.229 (below avg)
  // At 57: 0.035156 + 0.003873 * 57 = 0.256 (league avg)
  // At 75: 0.035156 + 0.003873 * 75 = 0.326 (excellent)
  // At 80: 0.035156 + 0.003873 * 80 = 0.345 (elite, top 2-4)
  // Contact correlates with AVG at r=0.97 (vs Hit Tool alone at r=0.82)
  contact: { intercept: 0.035156, slope: 0.003873 },

  // Gap (20-80) → Doubles/AB (0.008 to 0.055)
  // D/AB = -0.004 + 0.00078 * gap
  // At 20: -0.004 + 0.00078 * 20 = 0.012
  // At 80: -0.004 + 0.00078 * 80 = 0.058
  // Gap determines extra-base hit type after hit is decided
  gap: { intercept: -0.004, slope: 0.00078 },

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
   * Estimate Power rating from HR%
   * HR% = HR / PA * 100
   * Power rating specifically maps to home run rate in OOTP
   *
   * Uses PIECEWISE LINEAR inverse (matching expectedHrPct):
   * - HR% <= 2.15 (50th percentile): use low segment
   * - HR% > 2.15: use high segment
   */
  static estimatePower(hrPct: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.power;

    // Breakpoint: 50 power = 2.15% HR (50th percentile)
    const breakpointHrPct = 2.15;
    let rawRating: number;

    if (hrPct <= breakpointHrPct) {
      // Low power segment
      rawRating = (hrPct - coef.low.intercept) / coef.low.slope;
    } else {
      // High power segment
      rawRating = (hrPct - coef.high.intercept) / coef.high.slope;
    }

    const rating = this.capRating(Math.round(rawRating));

    const { confidence, multiplier } = this.getConfidence(pa, STABILIZATION.hr_pct);
    const uncertainty = 8 * multiplier;

    return {
      rating,
      low: this.capRating(Math.round(rawRating - uncertainty)),
      high: this.capRating(Math.round(rawRating + uncertainty)),
      confidence,
    };
  }

  /**
   * Estimate Contact rating from batting average
   * Contact is a composite of Hit Tool + AvoidK that predicts AVG well (r=0.97)
   */
  static estimateContact(avg: number, pa: number): RatingEstimate {
    const coef = REGRESSION_COEFFICIENTS.contact;
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

    // Calculate HR% (HR per PA as percentage) - Power maps to HR rate
    const hrPct = (stats.hr / stats.pa) * 100;

    // Doubles and triples rates (per AB)
    const doublesRate = stats.d / stats.ab;
    const triplesRate = stats.t / stats.ab;

    // Calculate wOBA
    const woba = this.calculateWoba(stats);

    return {
      power: this.estimatePower(hrPct, stats.pa),
      eye: this.estimateEye(bbPct, stats.pa),
      avoidK: this.estimateAvoidK(kPct, stats.pa),
      contact: this.estimateContact(avg, stats.pa),
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

  /**
   * Calculate expected HR% from Power rating
   * Returns HR per PA as a percentage (e.g., 4.0 means 4% HR/PA)
   *
   * Uses PIECEWISE LINEAR function calibrated to 2018-2020 actual percentiles:
   * - Power 20-50: flatter slope (weak hitters cluster together)
   * - Power 50-80: moderate slope (elite power separates more)
   *
   * This ensures:
   * - 20 power → 0.24% → 2 HR (1st percentile, not 0!)
   * - 50 power → 2.15% → 14 HR (50th percentile)
   * - 80 power → 5.09% → 33 HR (elite performers)
   */
  static expectedHrPct(power: number): number {
    const coef = REGRESSION_COEFFICIENTS.power;
    let hrPct: number;

    if (power <= 50) {
      // Low power segment: flatter slope
      hrPct = coef.low.intercept + coef.low.slope * power;
    } else {
      // High power segment: steeper slope
      hrPct = coef.high.intercept + coef.high.slope * power;
    }

    return Math.max(0, hrPct); // Clamp to 0% minimum (safety)
  }

  /**
   * @deprecated Use expectedHrPct instead. Power maps to HR%, not ISO.
   * ISO is affected by doubles/triples which are driven by Gap/Speed.
   */
  static expectedIso(power: number): number {
    // Legacy support - estimate ISO from HR% by adding typical 2B/3B contribution
    const hrPct = this.expectedHrPct(power);
    // Rough conversion: ISO ≈ HR% * 3 (since HR = 3 extra bases) + base XBH contribution
    // This is approximate - for accurate ISO, use Gap and Speed ratings too
    return (hrPct / 100) * 3 + 0.05;
  }

  static expectedAvg(contact: number): number {
    const coef = REGRESSION_COEFFICIENTS.contact;
    return coef.intercept + coef.slope * contact;
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
