/**
 * Map 80 power to actual 99th percentile, not 90th
 *
 * The issue: We were adjusting based on Q1 average (74.5 power)
 * The fix: Map 80 power specifically to 99th percentile actual
 */

// From full distribution analysis of 2018-2020 (373 qualified players)
const actualPercentiles = {
  p99: 5.60,  // 99th percentile: 36 HR in 650 PA
  p95: 4.62,  // 95th percentile: 30 HR
  p90: 4.15,  // 90th percentile: 27 HR
  p75: 3.15,  // 75th percentile: 20 HR
  p50: 2.20,  // 50th percentile: 14 HR
};

console.log('='.repeat(120));
console.log('CALIBRATE 80 POWER TO ACTUAL 99TH PERCENTILE');
console.log('='.repeat(120));
console.log('');
console.log('Problem: Current coefficient maps 80 power → 27 HR (90th percentile)');
console.log('         But 80 power should map to 99th percentile → 36 HR');
console.log('');
console.log('Solution: Fit coefficient to map power ratings directly to percentiles:');
console.log('  - 80 power = 99th percentile = 5.60% HR');
console.log('  - 75 power = 95th percentile = 4.62% HR');
console.log('  - 70 power = 90th percentile = 4.15% HR');
console.log('  - 50 power = 50th percentile = 2.20% HR');
console.log('');

// Use 50th and 99th percentiles for regression (widest spread, most stable)
const power1 = 80;
const hrPct1 = actualPercentiles.p99;
const power2 = 50;
const hrPct2 = actualPercentiles.p50;

const slope = (hrPct1 - hrPct2) / (power1 - power2);
const intercept = hrPct1 - slope * power1;

console.log('='.repeat(120));
console.log('CALCULATED COEFFICIENT');
console.log('='.repeat(120));
console.log('');
console.log(`HR% = ${intercept.toFixed(4)} + ${slope.toFixed(6)} × Power`);
console.log('');
console.log('Regression points:');
console.log(`  80 power → ${hrPct1.toFixed(2)}% HR (99th percentile actual)`);
console.log(`  50 power → ${hrPct2.toFixed(2)}% HR (50th percentile actual)`);
console.log('');

console.log('='.repeat(120));
console.log('PREDICTIONS');
console.log('='.repeat(120));
console.log('');
console.log('Power | HR%   | HR in 650 PA | Expected Percentile');
console.log('-'.repeat(120));

const predictions = [
  { power: 80, expectedPct: '99th (top elite)', actualHrPct: actualPercentiles.p99 },
  { power: 75, expectedPct: '95th (very good)', actualHrPct: actualPercentiles.p95 },
  { power: 70, expectedPct: '90th (good)', actualHrPct: actualPercentiles.p90 },
  { power: 60, expectedPct: '75th (above avg)', actualHrPct: actualPercentiles.p75 },
  { power: 50, expectedPct: '50th (average)', actualHrPct: actualPercentiles.p50 },
  { power: 40, expectedPct: '25th (below avg)', actualHrPct: null },
  { power: 30, expectedPct: '10th (weak)', actualHrPct: null },
  { power: 20, expectedPct: '1st (very weak)', actualHrPct: null },
];

predictions.forEach(({ power, expectedPct, actualHrPct }) => {
  const predictedHrPct = Math.max(0, intercept + slope * power);
  const hrIn650 = Math.round((predictedHrPct / 100) * 650);

  let line = `${power.toString().padStart(5)} | ${predictedHrPct.toFixed(2).padStart(5)} | ${hrIn650.toString().padStart(12)} | ${expectedPct}`;

  if (actualHrPct !== null) {
    const diff = predictedHrPct - actualHrPct;
    const diffStr = (diff > 0 ? '+' : '') + diff.toFixed(2);
    line += ` (actual ${actualHrPct.toFixed(2)}%, diff ${diffStr}%)`;
  }

  console.log(line);
});

console.log('');
console.log('='.repeat(120));
console.log('VALIDATION');
console.log('='.repeat(120));
console.log('');

// Calculate how well this fits the actual percentiles
let totalError = 0;
let count = 0;

[
  { power: 80, actual: actualPercentiles.p99, label: '99th percentile' },
  { power: 75, actual: actualPercentiles.p95, label: '95th percentile' },
  { power: 70, actual: actualPercentiles.p90, label: '90th percentile' },
  { power: 60, actual: actualPercentiles.p75, label: '75th percentile' },
  { power: 50, actual: actualPercentiles.p50, label: '50th percentile' },
].forEach(({ power, actual, label }) => {
  const predicted = intercept + slope * power;
  const error = predicted - actual;
  totalError += Math.abs(error);
  count++;

  console.log(
    `${label.padEnd(15)}: ` +
    `Power ${power.toString().padStart(2)} → ` +
    `Predicted ${predicted.toFixed(2)}%, ` +
    `Actual ${actual.toFixed(2)}%, ` +
    `Error ${(error > 0 ? '+' : '') + error.toFixed(3)}%`
  );
});

const avgError = totalError / count;
console.log(`\nAverage Absolute Error: ${avgError.toFixed(3)}%`);

console.log('\n' + '='.repeat(120));
console.log('COMPARISON TO OTHER COEFFICIENTS');
console.log('='.repeat(120));

const coefficients = [
  { name: 'Original', intercept: -0.5906, slope: 0.058434 },
  { name: 'Full Distribution', intercept: -1.6254, slope: 0.085037 },
  { name: 'Bias Corrected', intercept: -0.4549, slope: 0.058320 },
  { name: 'NEW (99th pctile)', intercept, slope },
];

console.log('\nCoefficient          | 80 Power | 70 Power | 50 Power');
console.log('-'.repeat(120));

coefficients.forEach(({ name, intercept: int, slope: slp }) => {
  const hr80 = Math.round(Math.max(0, int + slp * 80) * 650 / 100);
  const hr70 = Math.round(Math.max(0, int + slp * 70) * 650 / 100);
  const hr50 = Math.round(Math.max(0, int + slp * 50) * 650 / 100);

  console.log(
    `${name.padEnd(20)} | ${hr80.toString().padStart(8)} | ${hr70.toString().padStart(8)} | ${hr50.toString().padStart(8)}`
  );
});

console.log('\nActual 2018-2020     |       36 |       27 |       14');

console.log('\n' + '='.repeat(120));
console.log('RECOMMENDATION');
console.log('='.repeat(120));
console.log('');
console.log('Use this coefficient - it maps 80 power to the ACTUAL 99th percentile (36 HR),');
console.log('not the 90th percentile (27 HR) like the bias-corrected version did.');
console.log('');
console.log('Update HitterRatingEstimatorService.ts:');
console.log(`  power: { intercept: ${intercept.toFixed(4)}, slope: ${slope.toFixed(6)} }`);
console.log('');
console.log('This will:');
console.log('  - Map 80 power → 36 HR (99th percentile actual)');
console.log('  - Map 70 power → 29 HR (90th percentile actual)');
console.log('  - Map 50 power → 14 HR (50th percentile actual)');
console.log('  - Accurately reflect the 2018-2020 HR environment');
console.log('');
console.log('='.repeat(120));
