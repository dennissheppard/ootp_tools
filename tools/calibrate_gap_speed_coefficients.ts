/**
 * Gap/Speed Coefficient Calibration Script
 *
 * This script calibrates the Gap → Doubles% and Speed → Triples% coefficients
 * using actual OOTP player data.
 *
 * USAGE: npx tsx tools/calibrate_gap_speed_coefficients.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Data Types
// ============================================================================

interface PlayerData {
  gap: number;
  speed: number;
  ab: number;
  doubles: number;
  triples: number;
  doublesRate: number;  // doubles / AB
  triplesRate: number;  // triples / AB
}

interface RegressionResult {
  intercept: number;
  slope: number;
  rSquared: number;
  n: number;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadOotpData(csvPath: string): PlayerData[] {
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');

  const indices = {
    gap: headers.indexOf('gap'),
    speed: headers.indexOf('speed'),
    plate_appearances: headers.indexOf('plate_appearances'),
    hits: headers.indexOf('hits'),
    doubles: headers.indexOf('doubles'),
    triples: headers.indexOf('triples'),
    hr: headers.indexOf('HR'),
    bb: headers.indexOf('BB'),
  };

  const players: PlayerData[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');

    const gap = parseInt(values[indices.gap]);
    const speed = parseInt(values[indices.speed]);
    const pa = parseInt(values[indices.plate_appearances]);
    const bb = parseInt(values[indices.bb]);
    const hits = parseInt(values[indices.hits]);
    const doubles = parseInt(values[indices.doubles]);
    const triples = parseInt(values[indices.triples]);
    const hr = parseInt(values[indices.hr]);

    // Calculate AB (PA - BB - other non-AB outcomes, simplified as PA - BB)
    const ab = pa - bb;

    if (ab < 100) continue; // Skip low sample sizes

    players.push({
      gap,
      speed,
      ab,
      doubles,
      triples,
      doublesRate: doubles / ab,
      triplesRate: triples / ab,
    });
  }

  return players;
}

// ============================================================================
// Regression Analysis
// ============================================================================

/**
 * Calculate linear regression: y = intercept + slope * x
 * Returns intercept, slope, and R²
 */
function linearRegression(
  data: PlayerData[],
  xField: 'gap' | 'speed',
  yField: 'doublesRate' | 'triplesRate'
): RegressionResult {
  const n = data.length;

  // Calculate means
  const meanX = data.reduce((sum, p) => sum + p[xField], 0) / n;
  const meanY = data.reduce((sum, p) => sum + p[yField], 0) / n;

  // Calculate slope and intercept
  let numerator = 0;
  let denominator = 0;

  for (const p of data) {
    const x = p[xField];
    const y = p[yField];
    numerator += (x - meanX) * (y - meanY);
    denominator += (x - meanX) * (x - meanX);
  }

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;

  // Calculate R²
  let ssTotal = 0;
  let ssResidual = 0;

  for (const p of data) {
    const x = p[xField];
    const y = p[yField];
    const predicted = intercept + slope * x;

    ssTotal += (y - meanY) ** 2;
    ssResidual += (y - predicted) ** 2;
  }

  const rSquared = 1 - (ssResidual / ssTotal);

  return { intercept, slope, rSquared, n };
}

// ============================================================================
// Validation
// ============================================================================

function validateRegression(
  result: RegressionResult,
  name: string,
  minRSquared: number = 0.70
): boolean {
  console.log(`\n${name} Regression Results:`);
  console.log('─'.repeat(60));
  console.log(`  Intercept: ${result.intercept.toFixed(6)}`);
  console.log(`  Slope:     ${result.slope.toFixed(6)}`);
  console.log(`  R²:        ${result.rSquared.toFixed(4)}`);
  console.log(`  N:         ${result.n}`);

  if (result.rSquared < minRSquared) {
    console.log(`\n❌ WARNING: R² (${result.rSquared.toFixed(4)}) is below threshold (${minRSquared})`);
    return false;
  } else {
    console.log(`\n✅ PASS: R² meets threshold (≥ ${minRSquared})`);
    return true;
  }
}

/**
 * Show example predictions for different rating values
 */
function showExamples(result: RegressionResult, ratingName: string, rateName: string) {
  console.log(`\n${ratingName} → ${rateName} Examples:`);
  console.log('─'.repeat(60));
  console.log(`${'Rating'.padEnd(10)} ${rateName.padEnd(15)} ${'Per 600 AB'.padEnd(15)}`);
  console.log('─'.repeat(60));

  for (const rating of [20, 35, 50, 65, 80]) {
    const rate = result.intercept + result.slope * rating;
    const per600 = rate * 600;
    console.log(`${rating.toString().padEnd(10)} ${rate.toFixed(4).padEnd(15)} ${per600.toFixed(1).padEnd(15)}`);
  }
}

/**
 * Analyze distribution to ensure we have good variation
 */
function analyzeDistribution(data: PlayerData[]) {
  console.log('\n' + '='.repeat(60));
  console.log('DATA DISTRIBUTION ANALYSIS');
  console.log('='.repeat(60));

  // Gap distribution
  const gaps = data.map(p => p.gap);
  const gapMin = Math.min(...gaps);
  const gapMax = Math.max(...gaps);
  const gapMean = gaps.reduce((a, b) => a + b, 0) / gaps.length;

  console.log(`\nGap Ratings:`);
  console.log(`  Min:  ${gapMin}`);
  console.log(`  Max:  ${gapMax}`);
  console.log(`  Mean: ${gapMean.toFixed(1)}`);

  // Speed distribution
  const speeds = data.map(p => p.speed);
  const speedMin = Math.min(...speeds);
  const speedMax = Math.max(...speeds);
  const speedMean = speeds.reduce((a, b) => a + b, 0) / speeds.length;

  console.log(`\nSpeed Ratings:`);
  console.log(`  Min:  ${speedMin}`);
  console.log(`  Max:  ${speedMax}`);
  console.log(`  Mean: ${speedMean.toFixed(1)}`);

  // Doubles rate distribution
  const doublesRates = data.map(p => p.doublesRate);
  const doublesMin = Math.min(...doublesRates);
  const doublesMax = Math.max(...doublesRates);
  const doublesMean = doublesRates.reduce((a, b) => a + b, 0) / doublesRates.length;

  console.log(`\nDoubles/AB:`);
  console.log(`  Min:  ${doublesMin.toFixed(4)}`);
  console.log(`  Max:  ${doublesMax.toFixed(4)}`);
  console.log(`  Mean: ${doublesMean.toFixed(4)}`);

  // Triples rate distribution
  const triplesRates = data.map(p => p.triplesRate);
  const triplesMin = Math.min(...triplesRates);
  const triplesMax = Math.max(...triplesRates);
  const triplesMean = triplesRates.reduce((a, b) => a + b, 0) / triplesRates.length;

  console.log(`\nTriples/AB:`);
  console.log(`  Min:  ${triplesMin.toFixed(4)}`);
  console.log(`  Max:  ${triplesMax.toFixed(4)}`);
  console.log(`  Mean: ${triplesMean.toFixed(4)}`);

  console.log(`\nTotal Players: ${data.length}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('GAP/SPEED COEFFICIENT CALIBRATION');
  console.log('='.repeat(60));

  // Load data
  const csvPath = path.join(__dirname, '..', 'ootp_hitter_data_20260201.csv');
  console.log(`\nLoading data from: ${csvPath}`);

  const data = loadOotpData(csvPath);
  console.log(`Loaded ${data.length} players with sufficient AB`);

  // Analyze distribution
  analyzeDistribution(data);

  // Run regressions
  console.log('\n' + '='.repeat(60));
  console.log('REGRESSION ANALYSIS');
  console.log('='.repeat(60));

  const doublesRegression = linearRegression(data, 'gap', 'doublesRate');
  const doublesValid = validateRegression(doublesRegression, 'Gap → Doubles/AB');
  showExamples(doublesRegression, 'Gap', 'Doubles/AB');

  const triplesRegression = linearRegression(data, 'speed', 'triplesRate');
  const triplesValid = validateRegression(triplesRegression, 'Speed → Triples/AB');
  showExamples(triplesRegression, 'Speed', 'Triples/AB');

  // Final recommendations
  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDED COEFFICIENT UPDATES');
  console.log('='.repeat(60));

  console.log('\nIn src/services/HitterRatingEstimatorService.ts:');
  console.log('\nReplace lines 123-132 with:\n');
  console.log('```typescript');
  console.log('private static readonly REGRESSION_COEFFICIENTS = {');
  console.log('  eye: { intercept: 1.6246, slope: 0.114789 },');
  console.log('  avoidK: { intercept: 25.9942, slope: -0.200303 },');
  console.log('  power: { intercept: -0.5906, slope: 0.058434 },');
  console.log('  contact: { intercept: 0.035156, slope: 0.00395741 },');
  console.log('  // Calibrated from OOTP data (n=' + doublesRegression.n + ', R²=' + doublesRegression.rSquared.toFixed(2) + ')');
  console.log(`  gap: { intercept: ${doublesRegression.intercept.toFixed(6)}, slope: ${doublesRegression.slope.toFixed(6)} },`);
  console.log('  // Calibrated from OOTP data (n=' + triplesRegression.n + ', R²=' + triplesRegression.rSquared.toFixed(2) + ')');
  console.log(`  speed: { intercept: ${triplesRegression.intercept.toFixed(6)}, slope: ${triplesRegression.slope.toFixed(6)} },`);
  console.log('};');
  console.log('```');

  // Success criteria
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION STATUS');
  console.log('='.repeat(60));

  const allValid = doublesValid && triplesValid;

  if (allValid) {
    console.log('\n✅ All regressions meet R² ≥ 0.70 threshold');
    console.log('✅ Ready to proceed with implementation');
  } else {
    console.log('\n❌ Some regressions below threshold - review before proceeding');
    console.log('❌ Consider non-linear relationships or additional variables');
  }

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ Calibration complete!\n');
}

main().catch(error => {
  console.error('Error during calibration:', error);
  process.exit(1);
});
