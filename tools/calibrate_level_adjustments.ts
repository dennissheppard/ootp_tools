/**
 * Calibrate Hitter Level Adjustments
 *
 * Finds players who played at minor league levels and then MLB,
 * calculates the stat deltas to determine how much to adjust
 * minor league stats to get MLB-equivalent values.
 *
 * Methodology:
 * - Find players with MiLB stats at level X in year N (min 100 PA)
 * - Find same players with MLB stats in year N or N+1 (min 200 PA)
 * - Calculate delta: MLB_stat - MiLB_stat for each rate stat
 * - Report median adjustments by level
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ============================================================================
// Types
// ============================================================================

type MinorLevel = 'aaa' | 'aa' | 'a' | 'r';

interface BattingRow {
  player_id: number;
  year: number;
  level: MinorLevel | 'mlb';
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
}

interface RateStats {
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
}

interface TransitionPair {
  playerId: number;
  milbYear: number;
  mlbYear: number;
  level: MinorLevel;
  milbPa: number;
  mlbPa: number;
  milbStats: RateStats;
  mlbStats: RateStats;
  delta: RateStats;
}

// ============================================================================
// CSV Parsing
// ============================================================================

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Parse MLB batting CSV (different column layout from minors)
 */
function parseMLBBattingCsv(csvText: string): BattingRow[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const results: BattingRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 34) continue;

    const row: BattingRow = {
      player_id: parseInt(cells[1], 10),
      year: parseInt(cells[2], 10),
      level: 'mlb',
      pa: parseInt(cells[12], 10),
      ab: parseInt(cells[9], 10),
      h: parseInt(cells[10], 10),
      d: parseInt(cells[16], 10),
      t: parseInt(cells[17], 10),
      hr: parseInt(cells[18], 10),
      bb: parseInt(cells[23], 10),
      k: parseInt(cells[11], 10),
    };

    if (!isNaN(row.player_id) && row.pa > 0) {
      results.push(row);
    }
  }

  return results;
}

/**
 * Parse minors batting CSV
 * Header: id,player_id,year,team_id,game_id,league_id,level_id,split_id,position,
 *         ab,h,k,pa,pitches_seen,g,gs,d,t,hr,r,rbi,sb,cs,bb,ibb,gdp,sh,sf,hp,ci,wpa,stint,ubr,war
 */
function parseMinorsBattingCsv(csvText: string, level: MinorLevel): BattingRow[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const results: BattingRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 25) continue;

    const row: BattingRow = {
      player_id: parseInt(cells[1], 10),
      year: parseInt(cells[2], 10),
      level: level,
      pa: parseInt(cells[12], 10),
      ab: parseInt(cells[9], 10),
      h: parseInt(cells[10], 10),
      d: parseInt(cells[16], 10),
      t: parseInt(cells[17], 10),
      hr: parseInt(cells[18], 10),
      bb: parseInt(cells[24], 10),
      k: parseInt(cells[11], 10),
    };

    if (!isNaN(row.player_id) && row.pa > 0) {
      results.push(row);
    }
  }

  return results;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadMLBBattingData(years: number[]): BattingRow[] {
  const allRows: BattingRow[] = [];

  for (const year of years) {
    const filename = `${year}_batting.csv`;
    const filepath = path.join(DATA_DIR, 'mlb_batting', filename);

    if (!fs.existsSync(filepath)) continue;

    const csvText = fs.readFileSync(filepath, 'utf-8');
    const rows = parseMLBBattingCsv(csvText);
    allRows.push(...rows);
  }

  return allRows;
}

function loadMinorsBattingData(years: number[], level: MinorLevel): BattingRow[] {
  const allRows: BattingRow[] = [];

  for (const year of years) {
    const filename = `${year}_${level}_batting.csv`;
    const filepath = path.join(DATA_DIR, 'minors_batting', filename);

    if (!fs.existsSync(filepath)) continue;

    const csvText = fs.readFileSync(filepath, 'utf-8');
    const rows = parseMinorsBattingCsv(csvText, level);
    allRows.push(...rows);
  }

  return allRows;
}

// ============================================================================
// Analysis Functions
// ============================================================================

function calculateRateStats(row: BattingRow): RateStats {
  return {
    bbPct: (row.bb / row.pa) * 100,
    kPct: (row.k / row.pa) * 100,
    hrPct: (row.hr / row.pa) * 100,
    avg: row.ab > 0 ? row.h / row.ab : 0,
  };
}

/**
 * Find players who transitioned from a minor league level to MLB
 * within 0-1 years.
 */
function findTransitions(
  minorsData: BattingRow[],
  mlbData: BattingRow[],
  level: MinorLevel,
  minMinorPa: number = 100,
  minMlbPa: number = 200
): TransitionPair[] {
  const transitions: TransitionPair[] = [];

  // Index MLB data by player_id and year for quick lookup
  const mlbByPlayerYear = new Map<string, BattingRow>();
  for (const row of mlbData) {
    const key = `${row.player_id}-${row.year}`;
    const existing = mlbByPlayerYear.get(key);
    // Keep the one with more PA if duplicates
    if (!existing || row.pa > existing.pa) {
      mlbByPlayerYear.set(key, row);
    }
  }

  // For each minor league season, look for MLB data same year or next year
  for (const minorRow of minorsData) {
    if (minorRow.pa < minMinorPa) continue;

    // Look for MLB stats in same year or next year
    for (const yearOffset of [0, 1]) {
      const mlbYear = minorRow.year + yearOffset;
      const mlbKey = `${minorRow.player_id}-${mlbYear}`;
      const mlbRow = mlbByPlayerYear.get(mlbKey);

      if (mlbRow && mlbRow.pa >= minMlbPa) {
        const milbStats = calculateRateStats(minorRow);
        const mlbStats = calculateRateStats(mlbRow);

        // Validate stats are in reasonable ranges
        if (milbStats.avg > 0.100 && milbStats.avg < 0.450 &&
            mlbStats.avg > 0.100 && mlbStats.avg < 0.450) {
          transitions.push({
            playerId: minorRow.player_id,
            milbYear: minorRow.year,
            mlbYear: mlbYear,
            level: level,
            milbPa: minorRow.pa,
            mlbPa: mlbRow.pa,
            milbStats,
            mlbStats,
            delta: {
              bbPct: mlbStats.bbPct - milbStats.bbPct,
              kPct: mlbStats.kPct - milbStats.kPct,
              hrPct: mlbStats.hrPct - milbStats.hrPct,
              avg: mlbStats.avg - milbStats.avg,
            },
          });
          break; // Use only the first match (prefer same year)
        }
      }
    }
  }

  return transitions;
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

// ============================================================================
// Main Analysis
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('WBL HITTER LEVEL ADJUSTMENT CALIBRATION');
  console.log('='.repeat(80));

  // Use modern era for consistency
  const years: number[] = [];
  for (let y = 2015; y <= 2021; y++) {
    years.push(y);
  }

  console.log(`\nLoading data for years ${years[0]}-${years[years.length - 1]}...`);

  // Load MLB data
  const mlbData = loadMLBBattingData(years);
  console.log(`  MLB records: ${mlbData.length}`);

  // Load minors data by level
  const levels: MinorLevel[] = ['aaa', 'aa', 'a', 'r'];
  const minorsDataByLevel = new Map<MinorLevel, BattingRow[]>();

  for (const level of levels) {
    const data = loadMinorsBattingData(years, level);
    minorsDataByLevel.set(level, data);
    console.log(`  ${level.toUpperCase()} records: ${data.length}`);
  }

  // Analysis parameters
  const MIN_MINOR_PA = 100;
  const MIN_MLB_PA = 200;

  console.log(`\nFinding transitions (MiLB ${MIN_MINOR_PA}+ PA → MLB ${MIN_MLB_PA}+ PA)...`);

  // Find transitions for each level
  const transitionsByLevel = new Map<MinorLevel, TransitionPair[]>();

  for (const level of levels) {
    const minorsData = minorsDataByLevel.get(level)!;
    const transitions = findTransitions(minorsData, mlbData, level, MIN_MINOR_PA, MIN_MLB_PA);
    transitionsByLevel.set(level, transitions);
    console.log(`  ${level.toUpperCase()}: ${transitions.length} player transitions found`);
  }

  // Calculate adjustments for each level
  console.log('\n' + '='.repeat(80));
  console.log('LEVEL ADJUSTMENT ANALYSIS');
  console.log('='.repeat(80));

  const levelLabels: Record<MinorLevel, string> = {
    aaa: 'AAA',
    aa: 'AA',
    a: 'A',
    r: 'Rookie',
  };

  const results: Record<MinorLevel, { median: RateStats; mean: RateStats; count: number }> = {} as any;

  for (const level of levels) {
    const transitions = transitionsByLevel.get(level)!;

    if (transitions.length < 10) {
      console.log(`\n--- ${levelLabels[level]} → MLB ---`);
      console.log(`  Insufficient data (${transitions.length} transitions, need 10+)`);
      continue;
    }

    const bbDeltas = transitions.map(t => t.delta.bbPct);
    const kDeltas = transitions.map(t => t.delta.kPct);
    const hrDeltas = transitions.map(t => t.delta.hrPct);
    const avgDeltas = transitions.map(t => t.delta.avg);

    results[level] = {
      median: {
        bbPct: calculateMedian(bbDeltas),
        kPct: calculateMedian(kDeltas),
        hrPct: calculateMedian(hrDeltas),
        avg: calculateMedian(avgDeltas),
      },
      mean: {
        bbPct: calculateMean(bbDeltas),
        kPct: calculateMean(kDeltas),
        hrPct: calculateMean(hrDeltas),
        avg: calculateMean(avgDeltas),
      },
      count: transitions.length,
    };

    console.log(`\n--- ${levelLabels[level]} → MLB (${transitions.length} transitions) ---`);
    console.log('  Delta = MLB - MiLB (negative means MiLB inflated, positive means MiLB deflated)');
    console.log('');
    console.log('  BB% Delta:');
    console.log(`    Median: ${results[level].median.bbPct >= 0 ? '+' : ''}${results[level].median.bbPct.toFixed(2)}%`);
    console.log(`    Mean:   ${results[level].mean.bbPct >= 0 ? '+' : ''}${results[level].mean.bbPct.toFixed(2)}%`);
    console.log(`    10th:   ${calculatePercentile(bbDeltas, 10).toFixed(2)}%`);
    console.log(`    90th:   ${calculatePercentile(bbDeltas, 90).toFixed(2)}%`);

    console.log('');
    console.log('  K% Delta:');
    console.log(`    Median: ${results[level].median.kPct >= 0 ? '+' : ''}${results[level].median.kPct.toFixed(2)}%`);
    console.log(`    Mean:   ${results[level].mean.kPct >= 0 ? '+' : ''}${results[level].mean.kPct.toFixed(2)}%`);
    console.log(`    10th:   ${calculatePercentile(kDeltas, 10).toFixed(2)}%`);
    console.log(`    90th:   ${calculatePercentile(kDeltas, 90).toFixed(2)}%`);

    console.log('');
    console.log('  HR% Delta:');
    console.log(`    Median: ${results[level].median.hrPct >= 0 ? '+' : ''}${results[level].median.hrPct.toFixed(2)}%`);
    console.log(`    Mean:   ${results[level].mean.hrPct >= 0 ? '+' : ''}${results[level].mean.hrPct.toFixed(2)}%`);
    console.log(`    10th:   ${calculatePercentile(hrDeltas, 10).toFixed(2)}%`);
    console.log(`    90th:   ${calculatePercentile(hrDeltas, 90).toFixed(2)}%`);

    console.log('');
    console.log('  AVG Delta:');
    console.log(`    Median: ${results[level].median.avg >= 0 ? '+' : ''}${results[level].median.avg.toFixed(3)}`);
    console.log(`    Mean:   ${results[level].mean.avg >= 0 ? '+' : ''}${results[level].mean.avg.toFixed(3)}`);
    console.log(`    10th:   ${calculatePercentile(avgDeltas, 10).toFixed(3)}`);
    console.log(`    90th:   ${calculatePercentile(avgDeltas, 90).toFixed(3)}`);
  }

  // Summary table
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY: MEDIAN ADJUSTMENTS (MiLB → MLB equivalent)');
  console.log('='.repeat(80));
  console.log('\nTo convert MiLB stats to MLB-equivalent, ADD these values:');
  console.log('');
  console.log('| Level  | BB% Adj | K% Adj  | HR% Adj | AVG Adj | N      |');
  console.log('|--------|---------|---------|---------|---------|--------|');

  for (const level of levels) {
    if (results[level]) {
      const r = results[level];
      console.log(
        `| ${levelLabels[level].padEnd(6)} | ${(r.median.bbPct >= 0 ? '+' : '') + r.median.bbPct.toFixed(2).padStart(5)}% | ${(r.median.kPct >= 0 ? '+' : '') + r.median.kPct.toFixed(2).padStart(5)}% | ${(r.median.hrPct >= 0 ? '+' : '') + r.median.hrPct.toFixed(2).padStart(5)}% | ${(r.median.avg >= 0 ? '+' : '') + r.median.avg.toFixed(3).padStart(6)} | ${r.count.toString().padStart(6)} |`
      );
    }
  }

  // Compare to current adjustments
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON: Current vs Calibrated Adjustments');
  console.log('='.repeat(80));

  const currentAdjustments: Record<MinorLevel, RateStats> = {
    aaa: { bbPct: 0, kPct: 2.0, hrPct: -0.3, avg: -0.020 },
    aa: { bbPct: -0.5, kPct: 3.5, hrPct: -0.6, avg: -0.035 },
    a: { bbPct: -1.0, kPct: 5.0, hrPct: -1.0, avg: -0.050 },
    r: { bbPct: -1.5, kPct: 7.0, hrPct: -1.5, avg: -0.065 },
  };

  console.log('\n--- BB% Adjustment ---');
  console.log('| Level  | Current | Calibrated | Diff    |');
  console.log('|--------|---------|------------|---------|');
  for (const level of levels) {
    if (results[level]) {
      const curr = currentAdjustments[level].bbPct;
      const cal = results[level].median.bbPct;
      const diff = cal - curr;
      console.log(
        `| ${levelLabels[level].padEnd(6)} | ${(curr >= 0 ? '+' : '') + curr.toFixed(2).padStart(5)}% | ${(cal >= 0 ? '+' : '') + cal.toFixed(2).padStart(8)}% | ${(diff >= 0 ? '+' : '') + diff.toFixed(2).padStart(5)}% |`
      );
    }
  }

  console.log('\n--- K% Adjustment ---');
  console.log('| Level  | Current | Calibrated | Diff    |');
  console.log('|--------|---------|------------|---------|');
  for (const level of levels) {
    if (results[level]) {
      const curr = currentAdjustments[level].kPct;
      const cal = results[level].median.kPct;
      const diff = cal - curr;
      console.log(
        `| ${levelLabels[level].padEnd(6)} | ${(curr >= 0 ? '+' : '') + curr.toFixed(2).padStart(5)}% | ${(cal >= 0 ? '+' : '') + cal.toFixed(2).padStart(8)}% | ${(diff >= 0 ? '+' : '') + diff.toFixed(2).padStart(5)}% |`
      );
    }
  }

  console.log('\n--- HR% Adjustment ---');
  console.log('| Level  | Current | Calibrated | Diff    |');
  console.log('|--------|---------|------------|---------|');
  for (const level of levels) {
    if (results[level]) {
      const curr = currentAdjustments[level].hrPct;
      const cal = results[level].median.hrPct;
      const diff = cal - curr;
      console.log(
        `| ${levelLabels[level].padEnd(6)} | ${(curr >= 0 ? '+' : '') + curr.toFixed(2).padStart(5)}% | ${(cal >= 0 ? '+' : '') + cal.toFixed(2).padStart(8)}% | ${(diff >= 0 ? '+' : '') + diff.toFixed(2).padStart(5)}% |`
      );
    }
  }

  console.log('\n--- AVG Adjustment ---');
  console.log('| Level  | Current | Calibrated | Diff    |');
  console.log('|--------|---------|------------|---------|');
  for (const level of levels) {
    if (results[level]) {
      const curr = currentAdjustments[level].avg;
      const cal = results[level].median.avg;
      const diff = cal - curr;
      console.log(
        `| ${levelLabels[level].padEnd(6)} | ${(curr >= 0 ? '+' : '') + curr.toFixed(3).padStart(6)} | ${(cal >= 0 ? '+' : '') + cal.toFixed(3).padStart(9)} | ${(diff >= 0 ? '+' : '') + diff.toFixed(3).padStart(6)} |`
      );
    }
  }

  // Output code snippet
  console.log('\n' + '='.repeat(80));
  console.log('SUGGESTED CODE UPDATE (HitterTrueFutureRatingService.ts)');
  console.log('='.repeat(80));

  console.log(`
const LEVEL_ADJUSTMENTS: Record<MinorLeagueLevel, {
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
}> = {`);

  for (const level of levels) {
    if (results[level]) {
      const r = results[level].median;
      const label = levelLabels[level];
      console.log(`  // ${label} → MLB (${results[level].count} transitions)`);
      console.log(`  ${level}: { bbPct: ${r.bbPct.toFixed(2)}, kPct: ${r.kPct.toFixed(2)}, hrPct: ${r.hrPct.toFixed(2)}, avg: ${r.avg.toFixed(3)} },`);
      console.log('');
    }
  }

  console.log('};');

  // Predictive validity analysis
  console.log('\n' + '='.repeat(80));
  console.log('PREDICTIVE VALIDITY: Do MiLB stats predict MLB performance?');
  console.log('='.repeat(80));
  console.log('\nCorrelation between MiLB and MLB stats for same players:');
  console.log('(r > 0.5 = strong, 0.3-0.5 = moderate, < 0.3 = weak)');

  for (const level of levels) {
    const transitions = transitionsByLevel.get(level)!;
    if (transitions.length < 15) continue;

    const bbCorr = calculateCorrelation(
      transitions.map(t => t.milbStats.bbPct),
      transitions.map(t => t.mlbStats.bbPct)
    );
    const kCorr = calculateCorrelation(
      transitions.map(t => t.milbStats.kPct),
      transitions.map(t => t.mlbStats.kPct)
    );
    const hrCorr = calculateCorrelation(
      transitions.map(t => t.milbStats.hrPct),
      transitions.map(t => t.mlbStats.hrPct)
    );
    const avgCorr = calculateCorrelation(
      transitions.map(t => t.milbStats.avg),
      transitions.map(t => t.mlbStats.avg)
    );

    console.log(`\n--- ${levelLabels[level]} → MLB (n=${transitions.length}) ---`);
    console.log(`  BB%: r = ${bbCorr.toFixed(3)} ${getCorrelationLabel(bbCorr)}`);
    console.log(`  K%:  r = ${kCorr.toFixed(3)} ${getCorrelationLabel(kCorr)}`);
    console.log(`  HR%: r = ${hrCorr.toFixed(3)} ${getCorrelationLabel(hrCorr)}`);
    console.log(`  AVG: r = ${avgCorr.toFixed(3)} ${getCorrelationLabel(avgCorr)}`);
  }

  // Combined analysis across all levels
  const allTransitions = [...transitionsByLevel.get('aaa')!, ...transitionsByLevel.get('aa')!];
  if (allTransitions.length > 50) {
    console.log(`\n--- Combined AAA+AA → MLB (n=${allTransitions.length}) ---`);
    const bbCorr = calculateCorrelation(
      allTransitions.map(t => t.milbStats.bbPct),
      allTransitions.map(t => t.mlbStats.bbPct)
    );
    const kCorr = calculateCorrelation(
      allTransitions.map(t => t.milbStats.kPct),
      allTransitions.map(t => t.mlbStats.kPct)
    );
    const hrCorr = calculateCorrelation(
      allTransitions.map(t => t.milbStats.hrPct),
      allTransitions.map(t => t.mlbStats.hrPct)
    );
    const avgCorr = calculateCorrelation(
      allTransitions.map(t => t.milbStats.avg),
      allTransitions.map(t => t.mlbStats.avg)
    );

    console.log(`  BB%: r = ${bbCorr.toFixed(3)} ${getCorrelationLabel(bbCorr)}`);
    console.log(`  K%:  r = ${kCorr.toFixed(3)} ${getCorrelationLabel(kCorr)}`);
    console.log(`  HR%: r = ${hrCorr.toFixed(3)} ${getCorrelationLabel(hrCorr)}`);
    console.log(`  AVG: r = ${avgCorr.toFixed(3)} ${getCorrelationLabel(avgCorr)}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('CALIBRATION COMPLETE');
  console.log('='.repeat(80));
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

function getCorrelationLabel(r: number): string {
  const abs = Math.abs(r);
  if (abs >= 0.7) return '(STRONG)';
  if (abs >= 0.5) return '(moderate-strong)';
  if (abs >= 0.3) return '(moderate)';
  if (abs >= 0.1) return '(weak)';
  return '(negligible)';
}

main().catch(console.error);
