/**
 * Calibrate Hitter Rating Coefficients
 *
 * Analyzes WBL batting data to find optimal coefficients for:
 * - Power → HR%
 * - Eye → BB%
 * - AvoidK → K%
 * - BABIP → AVG
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ============================================================================
// Data Loading
// ============================================================================

interface MLBBattingRow {
  player_id: number;
  year: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
}

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

function parseMLBBattingCsv(csvText: string): MLBBattingRow[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const results: MLBBattingRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < 34) continue;

    const row: MLBBattingRow = {
      player_id: parseInt(cells[1], 10),
      year: parseInt(cells[2], 10),
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

function loadMLBBattingData(years: number[]): MLBBattingRow[] {
  const allRows: MLBBattingRow[] = [];

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

// ============================================================================
// Analysis Functions
// ============================================================================

interface StatDistribution {
  values: number[];
  min: number;
  max: number;
  mean: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
}

function calculateDistribution(values: number[]): StatDistribution {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const getPercentile = (p: number) => {
    const idx = Math.floor((p / 100) * (n - 1));
    return sorted[idx];
  };

  return {
    values: sorted,
    min: sorted[0],
    max: sorted[n - 1],
    mean,
    median: getPercentile(50),
    p10: getPercentile(10),
    p25: getPercentile(25),
    p75: getPercentile(75),
    p90: getPercentile(90),
    p95: getPercentile(95),
    p99: getPercentile(99),
  };
}

function analyzeWBLDistributions(rows: MLBBattingRow[], minPa: number): {
  hrPct: StatDistribution;
  bbPct: StatDistribution;
  kPct: StatDistribution;
  avg: StatDistribution;
} {
  const hrPctValues: number[] = [];
  const bbPctValues: number[] = [];
  const kPctValues: number[] = [];
  const avgValues: number[] = [];

  for (const row of rows) {
    if (row.pa < minPa) continue;

    const hrPct = (row.hr / row.pa) * 100;
    const bbPct = (row.bb / row.pa) * 100;
    const kPct = (row.k / row.pa) * 100;
    const avg = row.ab > 0 ? row.h / row.ab : 0;

    // Filter extreme outliers
    if (hrPct >= 0 && hrPct <= 15 &&
        bbPct >= 0 && bbPct <= 30 &&
        kPct >= 0 && kPct <= 50 &&
        avg >= 0.100 && avg <= 0.450) {
      hrPctValues.push(hrPct);
      bbPctValues.push(bbPct);
      kPctValues.push(kPct);
      avgValues.push(avg);
    }
  }

  return {
    hrPct: calculateDistribution(hrPctValues),
    bbPct: calculateDistribution(bbPctValues),
    kPct: calculateDistribution(kPctValues),
    avg: calculateDistribution(avgValues),
  };
}

/**
 * Given a target distribution, find optimal linear coefficients
 * that map rating (20-80) to the stat range.
 *
 * We want:
 * - Rating 20 → low end of distribution (e.g., 10th percentile)
 * - Rating 50 → median
 * - Rating 80 → high end (e.g., 90th percentile)
 */
function findOptimalCoefficients(
  dist: StatDistribution,
  lowRating: number = 20,
  highRating: number = 80,
  lowPercentile: number = 10,
  highPercentile: number = 90
): { intercept: number; slope: number; r20: number; r50: number; r80: number } {
  const lowValue = dist.values[Math.floor((lowPercentile / 100) * (dist.values.length - 1))];
  const highValue = dist.values[Math.floor((highPercentile / 100) * (dist.values.length - 1))];

  // stat = intercept + slope * rating
  // lowValue = intercept + slope * lowRating
  // highValue = intercept + slope * highRating
  //
  // slope = (highValue - lowValue) / (highRating - lowRating)
  // intercept = lowValue - slope * lowRating

  const slope = (highValue - lowValue) / (highRating - lowRating);
  const intercept = lowValue - slope * lowRating;

  return {
    intercept,
    slope,
    r20: intercept + slope * 20,
    r50: intercept + slope * 50,
    r80: intercept + slope * 80,
  };
}

/**
 * For K%, the relationship is inverse (higher rating = lower K%)
 */
function findOptimalCoefficientsInverse(
  dist: StatDistribution,
  lowRating: number = 20,
  highRating: number = 80,
  lowPercentile: number = 10,  // Low K% (good) for high rating
  highPercentile: number = 90  // High K% (bad) for low rating
): { intercept: number; slope: number; r20: number; r50: number; r80: number } {
  const lowKPct = dist.values[Math.floor((lowPercentile / 100) * (dist.values.length - 1))];
  const highKPct = dist.values[Math.floor((highPercentile / 100) * (dist.values.length - 1))];

  // For inverse:
  // Rating 80 (high) → lowKPct (good/low K%)
  // Rating 20 (low) → highKPct (bad/high K%)
  //
  // K% = intercept + slope * rating (slope will be negative)
  // highKPct = intercept + slope * 20
  // lowKPct = intercept + slope * 80
  //
  // slope = (lowKPct - highKPct) / (80 - 20) = (lowKPct - highKPct) / 60
  // intercept = highKPct - slope * 20

  const slope = (lowKPct - highKPct) / (highRating - lowRating);
  const intercept = highKPct - slope * lowRating;

  return {
    intercept,
    slope,
    r20: intercept + slope * 20,
    r50: intercept + slope * 50,
    r80: intercept + slope * 80,
  };
}

// ============================================================================
// Main
// ============================================================================

function runAnalysis(label: string, years: number[]) {
  console.log('\n' + '#'.repeat(80));
  console.log(`# ${label}`);
  console.log('#'.repeat(80));

  console.log(`\nLoading WBL MLB batting data (${years[0]}-${years[years.length - 1]})...`);
  const allRows = loadMLBBattingData(years);
  console.log(`  Total records: ${allRows.length}`);

  // Analyze with different PA thresholds
  const thresholds = [200, 300, 400];

  for (const minPa of thresholds) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`ANALYSIS: Min ${minPa} PA`);
    console.log('='.repeat(80));

    const dists = analyzeWBLDistributions(allRows, minPa);
    const qualifiedCount = dists.hrPct.values.length;
    console.log(`\nQualified player-seasons: ${qualifiedCount}`);

    // HR% Distribution
    console.log('\n--- HR% (HR per PA as percentage) ---');
    console.log(`  Min:    ${dists.hrPct.min.toFixed(2)}%`);
    console.log(`  10th:   ${dists.hrPct.p10.toFixed(2)}%`);
    console.log(`  25th:   ${dists.hrPct.p25.toFixed(2)}%`);
    console.log(`  Median: ${dists.hrPct.median.toFixed(2)}%`);
    console.log(`  Mean:   ${dists.hrPct.mean.toFixed(2)}%`);
    console.log(`  75th:   ${dists.hrPct.p75.toFixed(2)}%`);
    console.log(`  90th:   ${dists.hrPct.p90.toFixed(2)}%`);
    console.log(`  95th:   ${dists.hrPct.p95.toFixed(2)}%`);
    console.log(`  Max:    ${dists.hrPct.max.toFixed(2)}%`);

    // BB% Distribution
    console.log('\n--- BB% (BB per PA as percentage) ---');
    console.log(`  Min:    ${dists.bbPct.min.toFixed(2)}%`);
    console.log(`  10th:   ${dists.bbPct.p10.toFixed(2)}%`);
    console.log(`  25th:   ${dists.bbPct.p25.toFixed(2)}%`);
    console.log(`  Median: ${dists.bbPct.median.toFixed(2)}%`);
    console.log(`  Mean:   ${dists.bbPct.mean.toFixed(2)}%`);
    console.log(`  75th:   ${dists.bbPct.p75.toFixed(2)}%`);
    console.log(`  90th:   ${dists.bbPct.p90.toFixed(2)}%`);
    console.log(`  Max:    ${dists.bbPct.max.toFixed(2)}%`);

    // K% Distribution
    console.log('\n--- K% (K per PA as percentage) ---');
    console.log(`  Min:    ${dists.kPct.min.toFixed(2)}%`);
    console.log(`  10th:   ${dists.kPct.p10.toFixed(2)}%`);
    console.log(`  25th:   ${dists.kPct.p25.toFixed(2)}%`);
    console.log(`  Median: ${dists.kPct.median.toFixed(2)}%`);
    console.log(`  Mean:   ${dists.kPct.mean.toFixed(2)}%`);
    console.log(`  75th:   ${dists.kPct.p75.toFixed(2)}%`);
    console.log(`  90th:   ${dists.kPct.p90.toFixed(2)}%`);
    console.log(`  Max:    ${dists.kPct.max.toFixed(2)}%`);

    // AVG Distribution
    console.log('\n--- AVG (Batting Average) ---');
    console.log(`  Min:    ${dists.avg.min.toFixed(3)}`);
    console.log(`  10th:   ${dists.avg.p10.toFixed(3)}`);
    console.log(`  25th:   ${dists.avg.p25.toFixed(3)}`);
    console.log(`  Median: ${dists.avg.median.toFixed(3)}`);
    console.log(`  Mean:   ${dists.avg.mean.toFixed(3)}`);
    console.log(`  75th:   ${dists.avg.p75.toFixed(3)}`);
    console.log(`  90th:   ${dists.avg.p90.toFixed(3)}`);
    console.log(`  Max:    ${dists.avg.max.toFixed(3)}`);
  }

  // Calculate optimal coefficients using 300 PA threshold
  console.log('\n' + '='.repeat(80));
  console.log('OPTIMAL COEFFICIENTS (based on 300 PA, 10th-90th percentile range)');
  console.log('='.repeat(80));

  const dists = analyzeWBLDistributions(allRows, 300);

  // Power → HR%
  const hrCoef = findOptimalCoefficients(dists.hrPct, 20, 80, 10, 90);
  console.log('\n--- Power → HR% ---');
  console.log(`  Formula: HR% = ${hrCoef.intercept.toFixed(4)} + ${hrCoef.slope.toFixed(6)} * power`);
  console.log(`  Rating 20: ${hrCoef.r20.toFixed(2)}%`);
  console.log(`  Rating 50: ${hrCoef.r50.toFixed(2)}%`);
  console.log(`  Rating 80: ${hrCoef.r80.toFixed(2)}%`);

  // Eye → BB%
  const bbCoef = findOptimalCoefficients(dists.bbPct, 20, 80, 10, 90);
  console.log('\n--- Eye → BB% ---');
  console.log(`  Formula: BB% = ${bbCoef.intercept.toFixed(4)} + ${bbCoef.slope.toFixed(6)} * eye`);
  console.log(`  Rating 20: ${bbCoef.r20.toFixed(2)}%`);
  console.log(`  Rating 50: ${bbCoef.r50.toFixed(2)}%`);
  console.log(`  Rating 80: ${bbCoef.r80.toFixed(2)}%`);

  // AvoidK → K% (inverse)
  const kCoef = findOptimalCoefficientsInverse(dists.kPct, 20, 80, 10, 90);
  console.log('\n--- AvoidK → K% (inverse relationship) ---');
  console.log(`  Formula: K% = ${kCoef.intercept.toFixed(4)} + ${kCoef.slope.toFixed(6)} * avoidK`);
  console.log(`  Rating 20 (low contact): ${kCoef.r20.toFixed(2)}%`);
  console.log(`  Rating 50 (average):     ${kCoef.r50.toFixed(2)}%`);
  console.log(`  Rating 80 (high contact): ${kCoef.r80.toFixed(2)}%`);

  // BABIP → AVG
  const avgCoef = findOptimalCoefficients(dists.avg, 20, 80, 10, 90);
  console.log('\n--- BABIP/HitTool → AVG ---');
  console.log(`  Formula: AVG = ${avgCoef.intercept.toFixed(6)} + ${avgCoef.slope.toFixed(8)} * babip`);
  console.log(`  Rating 20: ${avgCoef.r20.toFixed(3)}`);
  console.log(`  Rating 50: ${avgCoef.r50.toFixed(3)}`);
  console.log(`  Rating 80: ${avgCoef.r80.toFixed(3)}`);

  // Compare to current coefficients
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON: Current vs Optimal Coefficients');
  console.log('='.repeat(80));

  console.log('\n--- Power → HR% ---');
  console.log('  Current: HR% = -0.17 + 0.0833 * power');
  console.log(`  Optimal: HR% = ${hrCoef.intercept.toFixed(4)} + ${hrCoef.slope.toFixed(6)} * power`);
  console.log(`  Current R50: ${(-0.17 + 0.0833 * 50).toFixed(2)}%`);
  console.log(`  Optimal R50: ${hrCoef.r50.toFixed(2)}%`);
  console.log(`  WBL Median:  ${dists.hrPct.median.toFixed(2)}%`);

  console.log('\n--- Eye → BB% ---');
  console.log('  Current: BB% = 2.0 + 0.15 * eye');
  console.log(`  Optimal: BB% = ${bbCoef.intercept.toFixed(4)} + ${bbCoef.slope.toFixed(6)} * eye`);
  console.log(`  Current R50: ${(2.0 + 0.15 * 50).toFixed(2)}%`);
  console.log(`  Optimal R50: ${bbCoef.r50.toFixed(2)}%`);
  console.log(`  WBL Median:  ${dists.bbPct.median.toFixed(2)}%`);

  console.log('\n--- AvoidK → K% ---');
  console.log('  Current: K% = 45.5 - 0.467 * avoidK');
  console.log(`  Optimal: K% = ${kCoef.intercept.toFixed(4)} + ${kCoef.slope.toFixed(6)} * avoidK`);
  console.log(`  Current R50: ${(45.5 - 0.467 * 50).toFixed(2)}%`);
  console.log(`  Optimal R50: ${kCoef.r50.toFixed(2)}%`);
  console.log(`  WBL Median:  ${dists.kPct.median.toFixed(2)}%`);

  console.log('\n--- BABIP → AVG ---');
  console.log('  Current: AVG = 0.139 + 0.00236 * babip');
  console.log(`  Optimal: AVG = ${avgCoef.intercept.toFixed(6)} + ${avgCoef.slope.toFixed(8)} * babip`);
  console.log(`  Current R50: ${(0.139 + 0.00236 * 50).toFixed(3)}`);
  console.log(`  Optimal R50: ${avgCoef.r50.toFixed(3)}`);
  console.log(`  WBL Median:  ${dists.avg.median.toFixed(3)}`);

  // Output code snippet
  console.log('\n' + '='.repeat(80));
  console.log('SUGGESTED CODE UPDATE (HitterRatingEstimatorService.ts)');
  console.log('='.repeat(80));
  console.log(`
const REGRESSION_COEFFICIENTS = {
  // Eye (20-80) → BB% (${bbCoef.r20.toFixed(1)}% to ${bbCoef.r80.toFixed(1)}%)
  eye: { intercept: ${bbCoef.intercept.toFixed(4)}, slope: ${bbCoef.slope.toFixed(6)} },

  // AvoidK (20-80) → K% (inverse: ${kCoef.r20.toFixed(1)}% to ${kCoef.r80.toFixed(1)}%)
  avoidK: { intercept: ${kCoef.intercept.toFixed(4)}, slope: ${kCoef.slope.toFixed(6)} },

  // Power (20-80) → HR% (${hrCoef.r20.toFixed(2)}% to ${hrCoef.r80.toFixed(2)}%)
  power: { intercept: ${hrCoef.intercept.toFixed(4)}, slope: ${hrCoef.slope.toFixed(6)} },

  // BABIP/HitTool (20-80) → AVG (${avgCoef.r20.toFixed(3)} to ${avgCoef.r80.toFixed(3)})
  babip: { intercept: ${avgCoef.intercept.toFixed(6)}, slope: ${avgCoef.slope.toFixed(8)} },
};
`);

  console.log('\n' + '='.repeat(80));
  console.log(`CALIBRATION COMPLETE FOR ${label}`);
  console.log('='.repeat(80));
}

async function main() {
  console.log('='.repeat(80));
  console.log('WBL HITTER COEFFICIENT CALIBRATION');
  console.log('='.repeat(80));

  // Build year arrays
  const ALL_YEARS: number[] = [];
  for (let y = 2000; y <= 2021; y++) {
    ALL_YEARS.push(y);
  }

  const MODERN_YEARS: number[] = [];
  for (let y = 2015; y <= 2021; y++) {
    MODERN_YEARS.push(y);
  }

  // Run analysis for both eras
  runAnalysis('ALL YEARS (2000-2021)', ALL_YEARS);
  runAnalysis('MODERN ERA (2015-2021)', MODERN_YEARS);

  // Summary comparison
  console.log('\n' + '#'.repeat(80));
  console.log('# ERA COMPARISON SUMMARY (300 PA, R50 values)');
  console.log('#'.repeat(80));

  const allDists = analyzeWBLDistributions(loadMLBBattingData(ALL_YEARS), 300);
  const modernDists = analyzeWBLDistributions(loadMLBBattingData(MODERN_YEARS), 300);

  console.log('\n| Stat | All Years Median | Modern Era Median | Difference |');
  console.log('|------|------------------|-------------------|------------|');
  console.log(`| HR%  | ${allDists.hrPct.median.toFixed(2)}%           | ${modernDists.hrPct.median.toFixed(2)}%             | ${(modernDists.hrPct.median - allDists.hrPct.median).toFixed(2)}%       |`);
  console.log(`| BB%  | ${allDists.bbPct.median.toFixed(2)}%           | ${modernDists.bbPct.median.toFixed(2)}%             | ${(modernDists.bbPct.median - allDists.bbPct.median).toFixed(2)}%       |`);
  console.log(`| K%   | ${allDists.kPct.median.toFixed(2)}%          | ${modernDists.kPct.median.toFixed(2)}%            | ${(modernDists.kPct.median - allDists.kPct.median).toFixed(2)}%       |`);
  console.log(`| AVG  | ${allDists.avg.median.toFixed(3)}           | ${modernDists.avg.median.toFixed(3)}             | ${(modernDists.avg.median - allDists.avg.median).toFixed(3)}      |`);
}

main().catch(console.error);
