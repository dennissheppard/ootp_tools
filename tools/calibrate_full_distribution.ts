/**
 * Calibrate power coefficient using FULL HR distribution
 *
 * Instead of only looking at top-3 HR leaders, this analyzes ALL players
 * with 500+ PA from 2018-2020 and fits a coefficient that matches the
 * entire distribution from weak to elite power.
 *
 * Maps HR% percentiles to power ratings:
 * - Bottom 10% (10th percentile) → 20 power
 * - 25th percentile → 35 power
 * - 50th percentile → 50 power
 * - 75th percentile → 65 power
 * - 90th percentile → 75 power
 * - 95th percentile → 78 power
 * - Top 5% (99th percentile) → 80 power
 *
 * Run with: npx tsx tools/calibrate_full_distribution.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface BattingStats {
  player_id: number;
  year: number;
  pa: number;
  hr: number;
  hrPct: number;
}

// Read batting stats from CSV
function loadBattingStats(year: number): BattingStats[] {
  const filePath = path.join(__dirname, '..', 'public', 'data', 'mlb_batting', `${year}_batting.csv`);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
  });

  return records
    .map((r: any) => ({
      player_id: r.player_id,
      year: r.year,
      pa: r.pa,
      hr: r.hr,
      hrPct: (r.hr / r.pa) * 100,
    }))
    .filter((b: BattingStats) => b.pa >= 500); // Min 500 PA for qualified players
}

// Calculate percentile value from sorted array
function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

// Simple linear regression
function linearRegression(points: { x: number; y: number }[]): { intercept: number; slope: number; r2: number } {
  const n = points.length;
  const sumX = points.reduce((sum, p) => sum + p.x, 0);
  const sumY = points.reduce((sum, p) => sum + p.y, 0);
  const sumXY = points.reduce((sum, p) => sum + p.x * p.y, 0);
  const sumX2 = points.reduce((sum, p) => sum + p.x * p.x, 0);
  const sumY2 = points.reduce((sum, p) => sum + p.y * p.y, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  // Calculate R²
  const meanY = sumY / n;
  const ssTotal = points.reduce((sum, p) => sum + Math.pow(p.y - meanY, 2), 0);
  const ssResidual = points.reduce((sum, p) => {
    const predicted = intercept + slope * p.x;
    return sum + Math.pow(p.y - predicted, 2);
  }, 0);
  const r2 = 1 - (ssResidual / ssTotal);

  return { intercept, slope, r2 };
}

async function calibrateFullDistribution() {
  console.log('='.repeat(120));
  console.log('FULL DISTRIBUTION POWER COEFFICIENT CALIBRATION');
  console.log('='.repeat(120));
  console.log('');
  console.log('Analyzing ALL qualified players (500+ PA) from 2018-2020');
  console.log('Maps HR% percentiles to power ratings using the full distribution');
  console.log('');

  const years = [2018, 2019, 2020];
  const allPlayers: BattingStats[] = [];

  // Collect all qualified players
  for (const year of years) {
    const yearStats = loadBattingStats(year);
    allPlayers.push(...yearStats);
    console.log(`${year}: ${yearStats.length} qualified players (500+ PA)`);
  }

  console.log(`\nTotal: ${allPlayers.length} player-seasons`);

  // Extract HR% values
  const hrPcts = allPlayers.map(p => p.hrPct);

  console.log('\n' + '='.repeat(120));
  console.log('HR% DISTRIBUTION');
  console.log('='.repeat(120));

  // Define percentile-to-power mapping
  // This maps HR performance percentiles to power ratings on 20-80 scale
  const percentileMap = [
    { percentile: 1, power: 20, label: 'Bottom (1st percentile)' },
    { percentile: 5, power: 25, label: 'Very Weak (5th percentile)' },
    { percentile: 10, power: 30, label: 'Weak (10th percentile)' },
    { percentile: 25, power: 40, label: 'Below Average (25th percentile)' },
    { percentile: 50, power: 50, label: 'Average (50th percentile)' },
    { percentile: 75, power: 60, label: 'Above Average (75th percentile)' },
    { percentile: 90, power: 70, label: 'Good (90th percentile)' },
    { percentile: 95, power: 75, label: 'Very Good (95th percentile)' },
    { percentile: 98, power: 78, label: 'Elite (98th percentile)' },
    { percentile: 99, power: 80, label: 'Top Elite (99th percentile)' },
  ];

  console.log('\nPercentile | Power | HR%   | HR in 650 PA | Label');
  console.log('-'.repeat(120));

  const regressionPoints: { x: number; y: number }[] = [];

  percentileMap.forEach(({ percentile: pct, power, label }) => {
    const hrPct = percentile(hrPcts, pct);
    const hrIn650 = Math.round((hrPct / 100) * 650);

    console.log(
      `${pct.toString().padStart(4)}%      | ` +
      `${power.toString().padStart(5)} | ` +
      `${hrPct.toFixed(2).padStart(5)} | ` +
      `${hrIn650.toString().padStart(12)} | ` +
      `${label}`
    );

    regressionPoints.push({ x: power, y: hrPct });
  });

  console.log('\n' + '='.repeat(120));
  console.log('LINEAR REGRESSION FIT');
  console.log('='.repeat(120));

  const regression = linearRegression(regressionPoints);

  console.log(`\nBest Fit Coefficient: HR% = ${regression.intercept.toFixed(4)} + ${regression.slope.toFixed(6)} × Power`);
  console.log(`R² = ${regression.r2.toFixed(4)} (goodness of fit)`);

  console.log('\n' + '-'.repeat(120));
  console.log('PREDICTIONS WITH NEW COEFFICIENT:');
  console.log('-'.repeat(120));
  console.log('\nPower | Predicted HR% | HR in 650 PA');
  console.log('-'.repeat(50));

  [20, 30, 40, 50, 60, 70, 75, 78, 80].forEach(power => {
    const predictedHrPct = Math.max(0, regression.intercept + regression.slope * power);
    const hrIn650 = Math.round((predictedHrPct / 100) * 650);
    console.log(`${power.toString().padStart(5)} | ${predictedHrPct.toFixed(2).padStart(13)} | ${hrIn650.toString().padStart(12)}`);
  });

  console.log('\n' + '='.repeat(120));
  console.log('VALIDATION: Check fit against actual percentiles');
  console.log('='.repeat(120));
  console.log('\nPercentile | Actual HR% | Predicted HR% | Error    | Power Rating');
  console.log('-'.repeat(120));

  let totalError = 0;
  percentileMap.forEach(({ percentile: pct, power, label }) => {
    const actualHrPct = percentile(hrPcts, pct);
    const predictedHrPct = Math.max(0, regression.intercept + regression.slope * power);
    const error = predictedHrPct - actualHrPct;
    totalError += Math.abs(error);

    console.log(
      `${pct.toString().padStart(4)}%      | ` +
      `${actualHrPct.toFixed(2).padStart(10)} | ` +
      `${predictedHrPct.toFixed(2).padStart(13)} | ` +
      `${(error > 0 ? '+' : '') + error.toFixed(2).padStart(7)} | ` +
      `${power}`
    );
  });

  const avgError = totalError / percentileMap.length;
  console.log(`\nAverage Absolute Error: ${avgError.toFixed(3)}%`);

  console.log('\n' + '='.repeat(120));
  console.log('CURRENT COEFFICIENT (for comparison):');
  console.log('='.repeat(120));
  const currentIntercept = -7.7945;
  const currentSlope = 0.171882;
  console.log(`HR% = ${currentIntercept.toFixed(4)} + ${currentSlope.toFixed(6)} × Power`);
  console.log('\nPower | Current HR% | HR in 650 PA');
  console.log('-'.repeat(50));
  [20, 30, 40, 50, 60, 70, 75, 78, 80].forEach(power => {
    const hrPct = Math.max(0, currentIntercept + currentSlope * power);
    const hrIn650 = Math.round((hrPct / 100) * 650);
    console.log(`${power.toString().padStart(5)} | ${hrPct.toFixed(2).padStart(11)} | ${hrIn650.toString().padStart(12)}`);
  });

  console.log('\n' + '='.repeat(120));
  console.log('RECOMMENDATION:');
  console.log('='.repeat(120));
  console.log('');
  console.log('Use the new coefficient from the linear regression fit.');
  console.log('This is calibrated to the FULL distribution of players (500+ PA, 2018-2020),');
  console.log('not just the top-3 HR leaders, so it will work well across all power levels.');
  console.log('');
  console.log(`Update HitterRatingEstimatorService.ts:`);
  console.log(`  power: { intercept: ${regression.intercept.toFixed(4)}, slope: ${regression.slope.toFixed(6)} }`);
  console.log('');
  console.log('='.repeat(120));
}

// Run the calibration
calibrateFullDistribution()
  .then(() => {
    console.log('\nCalibration complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error running calibration:', err);
    process.exit(1);
  });
