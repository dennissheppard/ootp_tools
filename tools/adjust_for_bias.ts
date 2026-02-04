/**
 * Calculate power coefficient adjustment to fix quartile bias
 *
 * Uses the observed bias from backcasting to adjust the coefficient
 * and minimize systematic under/over-prediction by power level
 */

// Current coefficient
const currentIntercept = -1.6254;
const currentSlope = 0.085037;

// Observed biases from 2018-2020 backcasting
const biases = {
  q1: { powerRange: [69, 80], midpoint: 74.5, bias: -0.829 },
  q2: { powerRange: [58, 69], midpoint: 63.5, bias: -0.993 },
  q3: { powerRange: [40, 57], midpoint: 48.5, bias: -0.427 },
  q4: { powerRange: [18, 39], midpoint: 28.5, bias: +0.624 },
};

console.log('='.repeat(120));
console.log('BIAS-ADJUSTED POWER COEFFICIENT CALCULATION');
console.log('='.repeat(120));
console.log('');
console.log('Goal: Eliminate systematic bias by power level');
console.log('  - Elite/Good power: Currently under-predicting by ~0.9%');
console.log('  - Weak power: Currently over-predicting by ~0.6%');
console.log('');

// Strategy: Adjust to zero out Q1 (elite) and Q4 (weak) biases
// This is done by finding a new slope and intercept such that:
// - At Q1 midpoint (74.5 power): Add 0.829% to prediction
// - At Q4 midpoint (28.5 power): Subtract 0.624% from prediction

const powerElite = biases.q1.midpoint;
const powerWeak = biases.q4.midpoint;
const biasElite = biases.q1.bias;
const biasWeak = biases.q4.bias;

// Current predictions
const currentHrPctElite = currentIntercept + currentSlope * powerElite;
const currentHrPctWeak = currentIntercept + currentSlope * powerWeak;

console.log('Current Predictions:');
console.log(`  Elite (${powerElite} power): ${currentHrPctElite.toFixed(3)}%`);
console.log(`  Weak (${powerWeak} power): ${currentHrPctWeak.toFixed(3)}%`);
console.log('');

// Desired predictions (current + bias adjustment)
const desiredHrPctElite = currentHrPctElite - biasElite; // Subtract because bias is negative (we're under-predicting)
const desiredHrPctWeak = currentHrPctWeak - biasWeak;   // Subtract because bias is positive (we're over-predicting)

console.log('Desired Predictions (after bias correction):');
console.log(`  Elite (${powerElite} power): ${desiredHrPctElite.toFixed(3)}% (${biasElite > 0 ? '+' : ''}${-biasElite.toFixed(3)}%)`);
console.log(`  Weak (${powerWeak} power): ${desiredHrPctWeak.toFixed(3)}% (${biasWeak > 0 ? '' : '+'}${-biasWeak.toFixed(3)}%)`);
console.log('');

// Solve for new slope and intercept
// y = mx + b
// desiredHrPctElite = newSlope * powerElite + newIntercept
// desiredHrPctWeak = newSlope * powerWeak + newIntercept
//
// Solving:
// desiredHrPctElite - desiredHrPctWeak = newSlope * (powerElite - powerWeak)
// newSlope = (desiredHrPctElite - desiredHrPctWeak) / (powerElite - powerWeak)

const newSlope = (desiredHrPctElite - desiredHrPctWeak) / (powerElite - powerWeak);
const newIntercept = desiredHrPctElite - newSlope * powerElite;

console.log('='.repeat(120));
console.log('ADJUSTED COEFFICIENT');
console.log('='.repeat(120));
console.log('');
console.log(`HR% = ${newIntercept.toFixed(4)} + ${newSlope.toFixed(6)} × Power`);
console.log('');
console.log('Comparison to Current:');
console.log(`  Current:  HR% = ${currentIntercept.toFixed(4)} + ${currentSlope.toFixed(6)} × Power`);
console.log(`  Adjusted: HR% = ${newIntercept.toFixed(4)} + ${newSlope.toFixed(6)} × Power`);
console.log('');
console.log(`  Slope change: ${currentSlope.toFixed(6)} → ${newSlope.toFixed(6)} (${((newSlope / currentSlope - 1) * 100).toFixed(1)}% increase)`);
console.log('');

console.log('='.repeat(120));
console.log('PREDICTIONS WITH ADJUSTED COEFFICIENT');
console.log('='.repeat(120));
console.log('');
console.log('Power | Current HR% | Adjusted HR% | Change   | HR in 650 PA (Adjusted)');
console.log('-'.repeat(120));

[20, 30, 40, 50, 60, 70, 75, 78, 80].forEach(power => {
  const currentHrPct = currentIntercept + currentSlope * power;
  const adjustedHrPct = Math.max(0, newIntercept + newSlope * power);
  const change = adjustedHrPct - currentHrPct;
  const hrIn650 = Math.round((adjustedHrPct / 100) * 650);

  console.log(
    `${power.toString().padStart(5)} | ` +
    `${currentHrPct.toFixed(2).padStart(11)} | ` +
    `${adjustedHrPct.toFixed(2).padStart(12)} | ` +
    `${(change > 0 ? '+' : '') + change.toFixed(2).padStart(7)} | ` +
    `${hrIn650.toString().padStart(23)}`
  );
});

console.log('');
console.log('='.repeat(120));
console.log('EXPECTED BIAS REDUCTION');
console.log('='.repeat(120));
console.log('');
console.log('Quartile | Power Range | Old Bias | Expected New Bias');
console.log('-'.repeat(120));

Object.entries(biases).forEach(([quartile, data]) => {
  const oldBias = data.bias;
  const midpoint = data.midpoint;

  // Calculate expected new bias at midpoint
  const currentPrediction = currentIntercept + currentSlope * midpoint;
  const newPrediction = newIntercept + newSlope * midpoint;
  const biasReduction = newPrediction - currentPrediction;
  const expectedNewBias = oldBias + biasReduction;

  console.log(
    `${quartile.toUpperCase().padEnd(8)} | ` +
    `${data.powerRange[0]}-${data.powerRange[1]}        | ` +
    `${(oldBias > 0 ? '+' : '') + oldBias.toFixed(3).padStart(7)} | ` +
    `${(expectedNewBias > 0 ? '+' : '') + expectedNewBias.toFixed(3).padStart(17)}`
  );
});

console.log('');
console.log('='.repeat(120));
console.log('RECOMMENDATION');
console.log('='.repeat(120));
console.log('');
console.log('Update HitterRatingEstimatorService.ts with the adjusted coefficient:');
console.log('');
console.log(`  power: { intercept: ${newIntercept.toFixed(4)}, slope: ${newSlope.toFixed(6)} }`);
console.log('');
console.log('This should:');
console.log('  - Increase elite power projections by ~0.8%');
console.log('  - Decrease weak power projections by ~0.6%');
console.log('  - Nearly eliminate systematic bias by power level');
console.log('');
console.log('='.repeat(120));
