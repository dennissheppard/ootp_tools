/**
 * Service for calculating potential stats from OOTP ratings.
 *
 * CALIBRATED FOR WBL (World Baseball League) environment.
 * Formulas derived from regression analysis of 440+ WBL pitcher-seasons.
 *
 * Note: WBL has significantly lower K rates than neutral MLB environment,
 * especially at high Stuff ratings (diminishing returns).
 */

export interface PitcherRatings {
  stuff: number;      // 20-80 scale
  control: number;    // 20-80 scale
  hra: number;        // 20-80 scale (home run avoidance)
  movement: number;   // 20-80 scale
  babip: number;      // 20-80 scale
}

export interface PotentialPitchingStats {
  // Core rate stats (per 9 innings)
  k9: number;
  bb9: number;
  hr9: number;
  h9: number;
  // Projected counting stats (for specified IP)
  ip: number;
  ha: number;
  hr: number;
  bb: number;
  k: number;
  // Derived stats
  era: number;
  fip: number;
  whip: number;
  oavg: number;
  war: number;
}

/**
 * WBL-calibrated coefficients from regression analysis
 *
 * K/9 vs Stuff:   R² = 0.22 (polynomial for diminishing returns)
 * BB/9 vs Control: R² = 0.43 (strongest relationship)
 * HR/9 vs HRA:    R² = 0.20
 * H/9 vs BABIP:   R² = 0.06 (weak - hits are harder to predict)
 */
const WBL_COEFFICIENTS = {
  // K/9 = -1.654 + 0.223*Stuff - 0.00142*Stuff²
  k9: {
    intercept: -1.654,
    linear: 0.22275,
    quadratic: -0.0014204,
  },
  // BB/9 = 8.267 - 0.170*Control + 0.0011*Control²
  bb9: {
    intercept: 8.267,
    linear: -0.16971,
    quadratic: 0.0010962,
  },
  // HR/9 = 3.989 - 0.098*HRA + 0.00071*HRA²
  hr9: {
    intercept: 3.989,
    linear: -0.09810,
    quadratic: 0.0007065,
  },
  // H/9 = 12.914 - 0.065*BABIP (linear, polynomial doesn't help)
  // Also factor in Movement: -0.037*Movement
  h9: {
    intercept: 12.914,
    babipCoef: -0.06536,
    movementCoef: -0.03712,
  },
};

// WBL league averages for derived stat calculations
const WBL_LEAGUE = {
  avgERA: 4.20,
  avgFIP: 4.10,
  fipConstant: 3.10,
  runsPerWin: 10,
};

// Default IP for projections (typical full season starter)
const DEFAULT_IP = 180;

export class PotentialStatsService {
  /**
   * Calculate polynomial: intercept + linear*x + quadratic*x²
   */
  private static calcPolynomial(
    coeffs: { intercept: number; linear: number; quadratic: number },
    x: number
  ): number {
    return coeffs.intercept + coeffs.linear * x + coeffs.quadratic * x * x;
  }

  /**
   * Calculate K/9 from Stuff rating (WBL calibrated)
   * Shows diminishing returns at high Stuff
   */
  static calculateK9(stuff: number): number {
    const k9 = this.calcPolynomial(WBL_COEFFICIENTS.k9, stuff);
    return Math.max(0, Math.min(15, k9)); // Clamp to reasonable range
  }

  /**
   * Calculate BB/9 from Control rating (WBL calibrated)
   * Strongest predictive relationship (R² = 0.43)
   */
  static calculateBB9(control: number): number {
    const bb9 = this.calcPolynomial(WBL_COEFFICIENTS.bb9, control);
    return Math.max(0, Math.min(10, bb9));
  }

  /**
   * Calculate HR/9 from HRA rating (WBL calibrated)
   */
  static calculateHR9(hra: number): number {
    const hr9 = this.calcPolynomial(WBL_COEFFICIENTS.hr9, hra);
    return Math.max(0, Math.min(3, hr9));
  }

  /**
   * Calculate H/9 from BABIP and Movement ratings (WBL calibrated)
   * Note: This has low predictive power (R² = 0.06) - hits are variable
   */
  static calculateH9(babip: number, movement: number): number {
    const h9 = WBL_COEFFICIENTS.h9.intercept +
      WBL_COEFFICIENTS.h9.babipCoef * babip +
      WBL_COEFFICIENTS.h9.movementCoef * movement;
    return Math.max(5, Math.min(15, h9));
  }

  /**
   * Calculate all potential stats from pitcher ratings
   */
  static calculatePitchingStats(
    ratings: PitcherRatings,
    ip: number = DEFAULT_IP
  ): PotentialPitchingStats {
    // Calculate rate stats
    const k9 = this.calculateK9(ratings.stuff);
    const bb9 = this.calculateBB9(ratings.control);
    const hr9 = this.calculateHR9(ratings.hra);
    const h9 = this.calculateH9(ratings.babip, ratings.movement);

    // Convert to counting stats for specified IP
    const k = Math.round((k9 / 9) * ip);
    const bb = Math.round((bb9 / 9) * ip);
    const hr = Math.round((hr9 / 9) * ip);
    const ha = Math.round((h9 / 9) * ip);

    // Calculate derived stats
    const whip = (bb + ha) / ip;

    // FIP = ((13*HR) + (3*BB) - (2*K)) / IP + constant
    const fip = ((13 * hr) + (3 * bb) - (2 * k)) / ip + WBL_LEAGUE.fipConstant;

    // ERA estimation from component stats
    // Simplified: ERA correlates with FIP but with more variance
    const era = fip + (Math.random() * 0.4 - 0.2); // Add small variance

    // Opponent batting average
    const ab = (ip * 2.9) + ha;
    const oavg = ha / ab;

    // WAR = ((lgFIP - FIP) / runsPerWin) * (IP / 9)
    const war = ((WBL_LEAGUE.avgFIP - fip) / WBL_LEAGUE.runsPerWin) * (ip / 9);

    return {
      k9: Math.round(k9 * 10) / 10,
      bb9: Math.round(bb9 * 10) / 10,
      hr9: Math.round(hr9 * 10) / 10,
      h9: Math.round(h9 * 10) / 10,
      ip: Math.round(ip * 10) / 10,
      ha,
      hr,
      bb,
      k,
      era: Math.round(Math.max(0, era) * 100) / 100,
      fip: Math.round(Math.max(0, fip) * 100) / 100,
      whip: Math.round(whip * 100) / 100,
      oavg: Math.round(oavg * 1000) / 1000,
      war: Math.round(war * 10) / 10,
    };
  }

  /**
   * Get the expected range for a stat at a given rating
   * Useful for showing uncertainty in projections
   */
  static getStatRange(
    stat: 'k9' | 'bb9' | 'hr9' | 'h9',
    rating: number
  ): { low: number; mid: number; high: number } {
    // Approximate ranges based on observed WBL variance
    const ranges: Record<string, { variance: number }> = {
      k9: { variance: 1.5 },   // ±1.5 K/9 typical variance
      bb9: { variance: 0.8 },  // ±0.8 BB/9
      hr9: { variance: 0.4 },  // ±0.4 HR/9
      h9: { variance: 1.5 },   // ±1.5 H/9 (high variance)
    };

    let mid: number;
    switch (stat) {
      case 'k9':
        mid = this.calculateK9(rating);
        break;
      case 'bb9':
        mid = this.calculateBB9(rating);
        break;
      case 'hr9':
        mid = this.calculateHR9(rating);
        break;
      case 'h9':
        mid = this.calculateH9(rating, 50); // Default movement
        break;
    }

    const v = ranges[stat].variance;
    return {
      low: Math.max(0, mid - v),
      mid,
      high: mid + v,
    };
  }

  /**
   * Calculate stats for multiple pitchers from CSV data
   */
  static calculateBulkStats(
    pitchers: Array<{ name?: string; ip?: number } & PitcherRatings>
  ): Array<{ name: string } & PotentialPitchingStats & PitcherRatings> {
    return pitchers.map((pitcher, index) => ({
      name: pitcher.name || `Pitcher ${index + 1}`,
      ...pitcher,
      ...this.calculatePitchingStats(pitcher, pitcher.ip || DEFAULT_IP),
    }));
  }

  /**
   * Parse CSV content into pitcher ratings
   * Expected format: name, stuff, control, hra, movement, babip [, ip]
   */
  static parseCSV(csvContent: string): Array<{ name: string; ip?: number } & PitcherRatings> {
    const lines = csvContent.trim().split('\n');
    const pitchers: Array<{ name: string; ip?: number } & PitcherRatings> = [];

    // Skip header row if present
    const startIndex = lines[0].toLowerCase().includes('stuff') ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split(',').map(s => s.trim());

      let name: string;
      let values: number[];

      if (isNaN(Number(parts[0]))) {
        name = parts[0];
        values = parts.slice(1).map(Number);
      } else {
        name = `Pitcher ${pitchers.length + 1}`;
        values = parts.map(Number);
      }

      if (values.length >= 5 && values.slice(0, 5).every(v => !isNaN(v))) {
        pitchers.push({
          name,
          stuff: values[0],
          control: values[1],
          hra: values[2],
          movement: values[3],
          babip: values[4],
          ip: values[5] || undefined,
        });
      }
    }

    return pitchers;
  }

  /**
   * Validate ratings are within expected range
   */
  static validateRatings(ratings: PitcherRatings): string[] {
    const errors: string[] = [];
    const checkRange = (name: string, value: number, min: number, max: number) => {
      if (value < min || value > max) {
        errors.push(`${name} must be between ${min} and ${max} (got ${value})`);
      }
    };

    checkRange('Stuff', ratings.stuff, 20, 80);
    checkRange('Control', ratings.control, 20, 80);
    checkRange('HRA', ratings.hra, 20, 80);
    checkRange('Movement', ratings.movement, 20, 80);
    checkRange('BABIP', ratings.babip, 20, 80);

    return errors;
  }

  /**
   * Compare two pitchers and explain the differences
   */
  static comparePitchers(
    a: PitcherRatings,
    b: PitcherRatings,
    ip: number = DEFAULT_IP
  ): string {
    const statsA = this.calculatePitchingStats(a, ip);
    const statsB = this.calculatePitchingStats(b, ip);

    const diff = {
      k: statsA.k - statsB.k,
      bb: statsA.bb - statsB.bb,
      hr: statsA.hr - statsB.hr,
      war: statsA.war - statsB.war,
    };

    const lines = [
      `Over ${ip} IP:`,
      `  Ks: ${statsA.k} vs ${statsB.k} (${diff.k > 0 ? '+' : ''}${diff.k})`,
      `  BBs: ${statsA.bb} vs ${statsB.bb} (${diff.bb > 0 ? '+' : ''}${diff.bb})`,
      `  HRs: ${statsA.hr} vs ${statsB.hr} (${diff.hr > 0 ? '+' : ''}${diff.hr})`,
      `  WAR: ${statsA.war.toFixed(1)} vs ${statsB.war.toFixed(1)} (${diff.war > 0 ? '+' : ''}${diff.war.toFixed(1)})`,
    ];

    return lines.join('\n');
  }
}
