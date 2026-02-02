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
    // Standard is around 1.15-1.25; we'll derive it from lgOBP relationship
    const wobaScale = lgWoba / lgRpa * 1.15; // Approximate

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
   * Calculate batting WAR from wOBA and PA.
   * Simplified: WAR = wRAA / runsPerWin
   * (Excludes positional adjustment and baserunning)
   */
  calculateBattingWar(woba: number, pa: number, leagueAvg: LeagueBattingAverages): number {
    const wRAA = ((woba - leagueAvg.lgWoba) / leagueAvg.wobaScale) * pa;
    // Add replacement level adjustment (~20 runs per 600 PA)
    const replacementRuns = (pa / 600) * 20;
    const war = (wRAA + replacementRuns) / leagueAvg.runsPerWin;
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
   * Get projected PA based on injury proneness.
   */
  getProjectedPa(injuryProneness?: string): number {
    const normalized = (injuryProneness || 'Normal').toLowerCase();

    switch (normalized) {
      case 'durable':
      case 'wary':
        return 650;
      case 'normal':
        return 585;
      case 'fragile':
        return 490;
      case 'prone':
        return 390;
      default:
        return 585; // Default to Normal
    }
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
