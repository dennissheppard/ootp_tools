/**
 * Service for calculating potential stats from OOTP ratings.
 *
 * CALIBRATED FOR WBL (World Baseball League) environment.
 *
 * Key findings from analysis:
 * - OOTP uses 1:1 linear relationships between ratings and stats
 * - The game uses a hidden 500-point scale, displayed as 20-80 (rounded to 5)
 * - WBL is a low-HR environment (~64% of neutral MLB rates)
 * - BABIP does not reliably predict H/9 due to defense/park factors
 *
 * "Three True Outcomes" - stats a pitcher controls:
 * - Strikeouts (Stuff rating)
 * - Walks (Control rating)
 * - Home runs (HRA rating)
 */

export interface PitcherRatings {
  stuff: number;      // 20-80 scale
  control: number;    // 20-80 scale
  hra: number;        // 20-80 scale (home run avoidance)
  movement: number;   // 20-80 scale (derived from HRA + BABIP)
  babip: number;      // 20-80 scale
}

export interface PotentialPitchingStats {
  // Core rate stats (per 9 innings) - "Three True Outcomes"
  k9: number;
  bb9: number;
  hr9: number;
  // Projected counting stats (for specified IP)
  ip: number;
  hr: number;
  bb: number;
  k: number;
  // Derived stats (from K, BB, HR only)
  fip: number;
  war: number;
}

/**
 * WBL-calibrated LINEAR coefficients
 *
 * These are 1:1 relationships in the game engine. Variance in observed
 * data comes from the hidden 500-point scale being rounded to 20-80.
 *
 * Formulas verified against OOTP in-game calculator (Jan 2026):
 * - K/9:  Linearized from WBL data (Stuff has diminishing returns in WBL)
 * - BB/9: Direct 1:1 with Control
 * - HR/9: Verified from calculator, WBL-adjusted (0.64x neutral)
 * - H/9:  BABIP correlation is weak (R²=0.02) due to defense/parks
 */
const WBL_LINEAR = {
  // K/9 = 2.07 + 0.074 * Stuff
  k9: { intercept: 2.07, slope: 0.074 },

  // BB/9 = 5.22 - 0.052 * Control
  bb9: { intercept: 5.22, slope: -0.052 },

  // HR/9 = 2.08 - 0.024 * HRA (verified from OOTP calculator, WBL-adjusted)
  hr9: { intercept: 2.08, slope: -0.024 },
};

// WBL league averages for derived stat calculations
const WBL_LEAGUE = {
  avgFIP: 4.10,
  fipConstant: 3.10,
  runsPerWin: 10,
};

// Default IP for projections (typical full season starter)
const DEFAULT_IP = 180;

export class PotentialStatsService {
  /**
   * Calculate linear: intercept + slope * x
   */
  private static calcLinear(
    coeffs: { intercept: number; slope: number },
    x: number
  ): number {
    return coeffs.intercept + coeffs.slope * x;
  }

  /**
   * Calculate K/9 from Stuff rating (WBL calibrated)
   * Linear: K/9 = 2.07 + 0.074 * Stuff
   */
  static calculateK9(stuff: number): number {
    const k9 = this.calcLinear(WBL_LINEAR.k9, stuff);
    return Math.max(0, Math.min(15, k9));
  }

  /**
   * Calculate BB/9 from Control rating (WBL calibrated)
   * Linear: BB/9 = 5.22 - 0.052 * Control
   * This is a 1:1 relationship in the game engine.
   */
  static calculateBB9(control: number): number {
    const bb9 = this.calcLinear(WBL_LINEAR.bb9, control);
    return Math.max(0, Math.min(10, bb9));
  }

  /**
   * Calculate HR/9 from HRA rating (WBL calibrated)
   * Linear: HR/9 = 2.08 - 0.024 * HRA
   * Verified from OOTP calculator. WBL is ~64% of neutral HR rates.
   */
  static calculateHR9(hra: number): number {
    const hr9 = this.calcLinear(WBL_LINEAR.hr9, hra);
    return Math.max(0, Math.min(3, hr9));
  }

  /**
   * Calculate all potential stats from pitcher ratings
   *
   * Only calculates stats we can reliably predict from ratings:
   * - K, K/9 (from Stuff)
   * - BB, BB/9 (from Control)
   * - HR, HR/9 (from HRA)
   * - FIP, WAR (derived from above)
   *
   * NOT calculated (unreliable due to defense/park factors):
   * - H, H/9 (BABIP doesn't predict)
   * - WHIP (depends on H)
   * - ERA (depends on H)
   * - oAVG (depends on H)
   */
  static calculatePitchingStats(
    ratings: PitcherRatings,
    ip: number = DEFAULT_IP
  ): PotentialPitchingStats {
    // Calculate rate stats - "Three True Outcomes"
    const k9 = this.calculateK9(ratings.stuff);
    const bb9 = this.calculateBB9(ratings.control);
    const hr9 = this.calculateHR9(ratings.hra);

    // Convert to counting stats for specified IP
    const k = Math.round((k9 / 9) * ip);
    const bb = Math.round((bb9 / 9) * ip);
    const hr = Math.round((hr9 / 9) * ip);

    // FIP = ((13*HR) + (3*BB) - (2*K)) / IP + constant
    // FIP only uses K, BB, HR - all of which we can predict
    const fip = ((13 * hr) + (3 * bb) - (2 * k)) / ip + WBL_LEAGUE.fipConstant;

    // WAR = ((lgFIP - FIP) / runsPerWin) * (IP / 9)
    const war = ((WBL_LEAGUE.avgFIP - fip) / WBL_LEAGUE.runsPerWin) * (ip / 9);

    return {
      k9: Math.round(k9 * 10) / 10,
      bb9: Math.round(bb9 * 10) / 10,
      hr9: Math.round(hr9 * 10) / 10,
      ip: Math.round(ip * 10) / 10,
      hr,
      bb,
      k,
      fip: Math.round(Math.max(0, fip) * 100) / 100,
      war: Math.round(war * 10) / 10,
    };
  }

  /**
   * Get the expected range for a stat at a given rating
   *
   * Variance comes from two sources:
   * 1. Rounding: Display rating (20-80) rounds from hidden 500-point scale (±2.5 rating points)
   * 2. Sample size: Small IP = more variance in observed stats
   *
   * These ranges assume ~180 IP sample size.
   */
  static getStatRange(
    stat: 'k9' | 'bb9' | 'hr9',
    rating: number
  ): { low: number; mid: number; high: number } {
    // Variance from ±2.5 rating point rounding, converted to stat impact
    const ranges: Record<string, { ratingVariance: number }> = {
      k9: { ratingVariance: 2.5 * 0.074 },   // ±0.19 K/9 from rounding
      bb9: { ratingVariance: 2.5 * 0.052 },  // ±0.13 BB/9 from rounding
      hr9: { ratingVariance: 2.5 * 0.024 },  // ±0.06 HR/9 from rounding
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
    }

    const v = ranges[stat].ratingVariance;
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
