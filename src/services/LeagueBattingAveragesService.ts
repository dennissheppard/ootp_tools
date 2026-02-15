/**
 * LeagueBattingAveragesService
 *
 * Computes and caches league batting averages from WBL MLB data.
 * Used for wRC+ and batting WAR calculations.
 */

export interface LeagueBattingAverages {
  year: number;
  /** League average OBP */
  lgObp: number;
  /** League average SLG */
  lgSlg: number;
  /** League average wOBA */
  lgWoba: number;
  /** League runs per PA */
  lgRpa: number;
  /** wOBA scale factor (typically ~1.15-1.25) */
  wobaScale: number;
  /** Runs per win (typically ~10) */
  runsPerWin: number;
  /** Total league PA (for validation) */
  totalPa: number;
  /** Total league runs */
  totalRuns: number;
}

/** wOBA linear weights (FanGraphs 2021 values, close enough for OOTP) */
const WOBA_WEIGHTS = {
  bb: 0.69,
  hbp: 0.72,
  single: 0.89,
  double: 1.27,
  triple: 1.62,
  hr: 2.10,
};

/** Cache of computed league averages by year */
const leagueAveragesCache = new Map<number, LeagueBattingAverages>();

class LeagueBattingAveragesService {
  /**
   * Load and compute league batting averages for a given year.
   * Results are cached after first computation.
   */
  async getLeagueAverages(year: number): Promise<LeagueBattingAverages | null> {
    // Check cache first
    if (leagueAveragesCache.has(year)) {
      return leagueAveragesCache.get(year)!;
    }

    try {
      const response = await fetch(`/data/mlb_batting/${year}_batting.csv`);
      if (!response.ok) {
        console.warn(`MLB batting data not found for year ${year}`);
        return null;
      }

      const csvText = await response.text();
      const averages = this.computeAveragesFromCsv(csvText, year);

      if (averages) {
        leagueAveragesCache.set(year, averages);
        console.log(`📊 Computed league averages for ${year}: lgOBP=${averages.lgObp.toFixed(3)}, lgSLG=${averages.lgSlg.toFixed(3)}, lgwOBA=${averages.lgWoba.toFixed(3)}`);
      }

      return averages;
    } catch (error) {
      console.error(`Error loading league batting averages for ${year}:`, error);
      return null;
    }
  }

  /**
   * Parse CSV and compute league-wide averages.
   */
  private computeAveragesFromCsv(csvText: string, year: number): LeagueBattingAverages | null {
    const lines = csvText.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return null;

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const colIndex = (name: string) => headers.indexOf(name);

    // Required columns
    const paIdx = colIndex('pa');
    const abIdx = colIndex('ab');
    const hIdx = colIndex('h');
    const dIdx = colIndex('d');
    const tIdx = colIndex('t');
    const hrIdx = colIndex('hr');
    const bbIdx = colIndex('bb');
    const hpIdx = colIndex('hp');
    const sfIdx = colIndex('sf');
    const rIdx = colIndex('r');

    if (paIdx === -1 || abIdx === -1 || hIdx === -1) {
      console.error('Missing required columns in MLB batting CSV');
      return null;
    }

    // Aggregate league totals
    let totalPa = 0;
    let totalAb = 0;
    let totalH = 0;
    let totalD = 0;
    let totalT = 0;
    let totalHr = 0;
    let totalBb = 0;
    let totalHp = 0;
    let totalSf = 0;
    let totalR = 0;

    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');

      const pa = parseInt(cells[paIdx]) || 0;
      if (pa < 1) continue; // Skip players with no PA

      totalPa += pa;
      totalAb += parseInt(cells[abIdx]) || 0;
      totalH += parseInt(cells[hIdx]) || 0;
      totalD += dIdx >= 0 ? (parseInt(cells[dIdx]) || 0) : 0;
      totalT += tIdx >= 0 ? (parseInt(cells[tIdx]) || 0) : 0;
      totalHr += hrIdx >= 0 ? (parseInt(cells[hrIdx]) || 0) : 0;
      totalBb += bbIdx >= 0 ? (parseInt(cells[bbIdx]) || 0) : 0;
      totalHp += hpIdx >= 0 ? (parseInt(cells[hpIdx]) || 0) : 0;
      totalSf += sfIdx >= 0 ? (parseInt(cells[sfIdx]) || 0) : 0;
      totalR += rIdx >= 0 ? (parseInt(cells[rIdx]) || 0) : 0;
    }

    if (totalPa === 0 || totalAb === 0) {
      console.error('No valid batting data found');
      return null;
    }

    // Calculate league averages
    const totalSingles = totalH - totalD - totalT - totalHr;
    const totalTb = totalSingles + 2 * totalD + 3 * totalT + 4 * totalHr;

    // lgAvg available if needed: totalH / totalAb
    const lgObp = (totalH + totalBb + totalHp) / (totalAb + totalBb + totalHp + totalSf);
    const lgSlg = totalTb / totalAb;
    const lgRpa = totalR / totalPa;

    // Calculate league wOBA
    const lgWoba = (
      WOBA_WEIGHTS.bb * totalBb +
      WOBA_WEIGHTS.hbp * totalHp +
      WOBA_WEIGHTS.single * totalSingles +
      WOBA_WEIGHTS.double * totalD +
      WOBA_WEIGHTS.triple * totalT +
      WOBA_WEIGHTS.hr * totalHr
    ) / (totalAb + totalBb + totalHp + totalSf);

    // wOBA scale: converts wOBA to runs (wOBA / wobaScale ≈ runs per PA above average)
    // Standard FanGraphs value is ~1.15-1.25; using fixed value for consistency
    const wobaScale = 1.15;

    // Runs per win (typically ~10 in modern baseball)
    const runsPerWin = 10;

    return {
      year,
      lgObp: Math.round(lgObp * 1000) / 1000,
      lgSlg: Math.round(lgSlg * 1000) / 1000,
      lgWoba: Math.round(lgWoba * 1000) / 1000,
      lgRpa: Math.round(lgRpa * 1000) / 1000,
      wobaScale: Math.round(wobaScale * 100) / 100,
      runsPerWin,
      totalPa,
      totalRuns: totalR,
    };
  }

  /**
   * Calculate wRC (Weighted Runs Created) for a player.
   * wRC = (((wOBA - lgwOBA) / wobaScale) + lgR/PA) × PA
   */
  calculateWrc(woba: number, pa: number, leagueAvg: LeagueBattingAverages): number {
    const wRAA = ((woba - leagueAvg.lgWoba) / leagueAvg.wobaScale) * pa;
    const wRC = wRAA + (leagueAvg.lgRpa * pa);
    return Math.round(wRC * 10) / 10;
  }

  /**
   * Calculate wRC+ (Weighted Runs Created Plus).
   * wRC+ = 100 × (wRC/PA) / (lgR/PA)
   * 100 = league average
   */
  calculateWrcPlus(woba: number, leagueAvg: LeagueBattingAverages): number {
    // wRC+ = ((wRAA/PA + lgR/PA) / lgR/PA) × 100
    const wRaaPerPa = (woba - leagueAvg.lgWoba) / leagueAvg.wobaScale;
    const wrcPlus = ((wRaaPerPa + leagueAvg.lgRpa) / leagueAvg.lgRpa) * 100;
    return Math.round(wrcPlus);
  }

  /**
   * Calculate baserunning runs from stolen bases and caught stealing.
   * Uses standard linear weights: SB × 0.2 − CS × 0.4
   */
  calculateBaserunningRuns(sb: number, cs: number): number {
    return sb * 0.2 - cs * 0.4;
  }

  /**
   * Calculate batting WAR from wOBA and PA.
   * Includes optional baserunning runs (SB/CS value).
   */
  calculateBattingWar(woba: number, pa: number, leagueAvg: LeagueBattingAverages, sbRuns: number = 0): number {
    const wRAA = ((woba - leagueAvg.lgWoba) / leagueAvg.wobaScale) * pa;
    // Add replacement level adjustment (~20 runs per 600 PA)
    const replacementRuns = (pa / 600) * 20;
    const war = (wRAA + replacementRuns + sbRuns) / leagueAvg.runsPerWin;
    return Math.round(war * 10) / 10;
  }

  /**
   * Calculate OPS+ from OBP and SLG.
   * OPS+ = 100 × (OBP/lgOBP + SLG/lgSLG - 1)
   */
  calculateOpsPlus(obp: number, slg: number, leagueAvg: LeagueBattingAverages): number {
    const opsPlus = 100 * (obp / leagueAvg.lgObp + slg / leagueAvg.lgSlg - 1);
    return Math.round(opsPlus);
  }

  /**
   * Get projected PA based on historical stats, age, and injury proneness.
   *
   * Uses a sophisticated blend of:
   * - Historical PA data (weighted by recency)
   * - Age curve adjustments (smooth, not chunked)
   * - Injury rating multipliers
   *
   * The more historical data available, the more we trust it over baseline expectations.
   */
  getProjectedPaWithHistory(
    historicalStats?: Array<{ year: number; pa: number }>,
    currentAge?: number,
    injuryProneness?: string
  ): number {
    // Get baseline PA from old method for players with no history
    if (!historicalStats || historicalStats.length === 0 || !currentAge) {
      return this.getProjectedPa(injuryProneness, currentAge);
    }

    // Filter to last 4 years only
    const sortedStats = [...historicalStats]
      .sort((a, b) => b.year - a.year)
      .slice(0, 4);

    if (sortedStats.length === 0) {
      return this.getProjectedPa(injuryProneness, currentAge);
    }

    // Calculate weighted average PA (more weight to recent years)
    // Weights: 0.40, 0.30, 0.20, 0.10 for years 1-4 back
    const weights = [0.40, 0.30, 0.20, 0.10];
    let weightedPaSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < sortedStats.length; i++) {
      const weight = weights[i] || 0.10;
      weightedPaSum += sortedStats[i].pa * weight;
      totalWeight += weight;
    }

    const historicalAvgPa = weightedPaSum / totalWeight;

    // Calculate the weighted average age during the historical period
    // Assume most recent stats are from 1 year ago (projecting for next season)
    let weightedAgeSum = 0;
    for (let i = 0; i < sortedStats.length; i++) {
      const weight = weights[i] || 0.10;
      const yearsBack = i + 1; // 1 year back for most recent, 2 for next, etc.
      const ageAtTime = currentAge - yearsBack;
      weightedAgeSum += ageAtTime * weight;
    }
    const avgHistoricalAge = weightedAgeSum / totalWeight;

    // Apply age curve adjustment (smooth curve, not buckets)
    // Peak PA happens around age 27-28
    // This adjusts the historical PA for the player's aging from then to now
    const ageCurveMultiplier = this.getAgeCurveMultiplier(currentAge) /
                               this.getAgeCurveMultiplier(avgHistoricalAge);

    const ageAdjustedPa = historicalAvgPa * ageCurveMultiplier;

    // Apply injury multiplier
    const injuryMultiplier = this.getInjuryMultiplier(injuryProneness);
    const injuryAdjustedPa = ageAdjustedPa * injuryMultiplier;

    // Blend with baseline expectation based on amount of historical data
    // More history = more trust in historical data
    // Base trust: 0.60 for 1 year, 0.80 for 2, 0.92 for 3, 0.98 for 4
    // Established full-season players (avg 500+ PA) get a bonus to avoid dragging
    // down consistent performers with a generic baseline
    let trustFactor = Math.min(0.98, 0.40 + (sortedStats.length * 0.20));
    if (historicalAvgPa >= 500 && sortedStats.length >= 2) {
      trustFactor = Math.min(0.98, trustFactor + 0.05);
    }

    // For players with consistent low PAs, use a lower baseline
    // This prevents bench players from being pulled up toward starter PAs
    const baselinePa = historicalAvgPa < 250
      ? Math.min(this.getBaselinePaByAge(currentAge), 350) // Cap baseline at 350 for bench players
      : this.getBaselinePaByAge(currentAge);
    const baselineAdjusted = baselinePa * injuryMultiplier;

    const blendedPa = (injuryAdjustedPa * trustFactor) + (baselineAdjusted * (1 - trustFactor));

    // Clamp to reasonable range (50-700 PA)
    // 50 PA minimum for true bench players, no artificial 200 PA floor
    return Math.round(Math.max(50, Math.min(700, blendedPa)));
  }

  /**
   * Get baseline PA by age (smooth curve, not buckets).
   * Used as fallback or for blending.
   */
  private getBaselinePaByAge(age: number): number {
    // Smooth age curve using a quadratic function
    // Peak at age 27-28 with ~600 PA
    // Young players (21) ~480 PA
    // Older players (39+) ~400 PA

    if (age <= 21) {
      return 480 + (age - 20) * 20; // Ramping up
    } else if (age <= 27) {
      // Rising to peak
      return 480 + ((age - 21) / 6) * 120; // 480 -> 600
    } else if (age <= 32) {
      // Peak plateau (slight variance for realism)
      return 600 - (age - 27) * 2; // 600 -> 590
    } else if (age <= 37) {
      // Decline phase
      return 590 - ((age - 32) / 5) * 140; // 590 -> 450
    } else {
      // Late career
      return Math.max(350, 450 - (age - 37) * 15);
    }
  }

  /**
   * Get age curve multiplier (1.0 = peak, <1.0 = decline, >1.0 = growth).
   * Uses a smooth polynomial curve instead of buckets.
   */
  private getAgeCurveMultiplier(age: number): number {
    // Peak age is 27-28 (multiplier = 1.0)
    // Younger players are still ramping up
    // Older players decline

    const peakAge = 27.5;

    if (age < 23) {
      // Young players: 0.80-0.95 (still gaining playing time)
      return 0.80 + (age - 20) * 0.05;
    } else if (age < peakAge) {
      // Approaching peak: 0.95-1.0
      return 0.95 + ((age - 23) / (peakAge - 23)) * 0.05;
    } else if (age <= 32) {
      // Peak to early decline: 1.0-0.96
      return 1.0 - ((age - peakAge) / 10) * 0.08;
    } else if (age <= 37) {
      // Mid decline: 0.96-0.75
      return 0.96 - ((age - 32) / 5) * 0.21;
    } else {
      // Late career: 0.75-0.60
      return Math.max(0.60, 0.75 - (age - 37) * 0.03);
    }
  }

  /**
   * Get injury multiplier based on injury proneness rating.
   */
  private getInjuryMultiplier(injuryProneness?: string): number {
    const normalized = (injuryProneness || 'Normal').toLowerCase();

    switch (normalized) {
      case 'durable':
        return 1.08;
      case 'wary':
        return 1.04;
      case 'normal':
        return 1.0;
      case 'fragile':
        return 0.90; // Less harsh than 0.85
      case 'prone':
        return 0.78; // Less harsh than 0.70
      default:
        return 1.0;
    }
  }

  /**
   * DEPRECATED: Old chunked PA projection method.
   * Kept for backwards compatibility. Use getProjectedPaWithHistory instead.
   *
   * Get projected PA based on age and injury proneness.
   *
   * Age curve is based on typical MLB playing time patterns:
   * - Ages 21-23: Ramping up (480-550 PA)
   * - Ages 24-32: Peak years (550-600+ PA)
   * - Ages 33-36: Gradual decline (500-550 PA)
   * - Ages 37+: Significant decline (400-480 PA)
   *
   * Injury proneness adjusts from this baseline.
   */
  getProjectedPa(injuryProneness?: string, age?: number): number {
    // Base PA by age (for "normal" injury risk)
    let basePa = 585; // Default

    if (age !== undefined) {
      if (age <= 21) {
        basePa = 480;
      } else if (age <= 23) {
        basePa = 520;
      } else if (age <= 25) {
        basePa = 560;
      } else if (age <= 32) {
        basePa = 600; // Peak years
      } else if (age <= 34) {
        basePa = 560;
      } else if (age <= 36) {
        basePa = 520;
      } else if (age <= 38) {
        basePa = 460;
      } else {
        basePa = 400;
      }
    }

    // Injury modifier (multiplier on base PA)
    const normalized = (injuryProneness || 'Normal').toLowerCase();
    let injuryMultiplier = 1.0;

    switch (normalized) {
      case 'durable':
        injuryMultiplier = 1.08;
        break;
      case 'wary':
        injuryMultiplier = 1.04;
        break;
      case 'normal':
        injuryMultiplier = 1.0;
        break;
      case 'fragile':
        injuryMultiplier = 0.85;
        break;
      case 'prone':
        injuryMultiplier = 0.70;
        break;
      default:
        injuryMultiplier = 1.0;
    }

    return Math.round(basePa * injuryMultiplier);
  }

  /**
   * Clear the cache (useful for testing or forcing reload).
   */
  clearCache(): void {
    leagueAveragesCache.clear();
  }

  /**
   * Check if we have cached averages for a year.
   */
  hasCachedAverages(year: number): boolean {
    return leagueAveragesCache.has(year);
  }
}

export const leagueBattingAveragesService = new LeagueBattingAveragesService();
