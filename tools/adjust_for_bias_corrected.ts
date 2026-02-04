/**
 * CORRECTED bias adjustment
 *
 * Bias = Actual - Projected
 * Negative bias = Over-projecting (need to reduce)
 * Positive bias = Under-projecting (need to increase)
 */

// Current coefficient (the one that made things worse)
const currentIntercept = -3.1496;
const currentSlope = 0.116624;

// Observed biases from 2018-2020 backcasting with CURRENT coefficient
const biases = {
  q1: { powerRange: [69, 80], midpoint: 74.5, bias: -1.649 },  // Over-projecting
  q2: { powerRange: [58, 69], midpoint: 63.5, bias: -1.477 },  // Over-projecting
  q3: { powerRange: [40, 57], midpoint: 48.5, bias: -0.459 },  // Over-projecting
  q4: { powerRange: [18, 39], midpoint: 28.5, bias: +1.033 },  // Under-projecting
};

console.log('='.repeat(120));
console.log('CORRECTED BIAS-ADJUSTED POWER COEFFICIENT');
console.log('='.repeat(120));
console.log('');
console.log('Bias = Actual - Projected');
console.log('  - Negative bias = Over-projecting (need to REDUCE projection)');
console.log('  - Positive bias = Under-projecting (need to INCREASE projection)');
console.log('');
console.log('Current situation:');
console.log('  - Elite (Q1): -1.649% bias → Over-projecting, need to reduce by 1.649%');
console.log('  - Weak (Q4): +1.033% bias → Under-projecting, need to increase by 1.033%');
console.log('');
console.log('Solution: FLATTEN the slope (decrease it) to reduce elite and increase weak projections');
console.log('');

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

// Desired predictions
// Bias = Actual - Projected, so Actual = Projected + Bias
// We want new Projected = Actual, so:
// newProjected = currentProjected + bias
const desiredHrPctElite = currentHrPctElite + biasElite; // Add negative bias (reduces prediction)
const desiredHrPctWeak = currentHrPctWeak + biasWeak;   // Add positive bias (increases prediction)

console.log('Desired Predictions (to match actuals):');
console.log(`  Elite (${powerElite} power): ${desiredHrPctElite.toFixed(3)}% (${biasElite.toFixed(3)}%)`);
console.log(`  Weak (${powerWeak} power): ${desiredHrPctWeak.toFixed(3)}% (+${biasWeak.toFixed(3)}%)`);
console.log('');

// Solve for new slope and intercept
const newSlope = (desiredHrPctElite - desiredHrPctWeak) / (powerElite - powerWeak);
const newIntercept = desiredHrPctElite - newSlope * powerElite;

console.log('='.repeat(120));
console.log('CORRECTED COEFFICIENT');
console.log('='.repeat(120));
console.log('');
console.log(`HR% = ${newIntercept.toFixed(4)} + ${newSlope.toFixed(6)} × Power`);
console.log('');
console.log('Comparison:');
console.log(`  Current:   HR% = ${currentIntercept.toFixed(4)} + ${currentSlope.toFixed(6)} × Power`);
console.log(`  Corrected: HR% = ${newIntercept.toFixed(4)} + ${newSlope.toFixed(6)} × Power`);
console.log('');
console.log(`  Slope change: ${currentSlope.toFixed(6)} → ${newSlope.toFixed(6)} (${((newSlope / currentSlope - 1) * 100).toFixed(1)}% ${newSlope < currentSlope ? 'decrease' : 'increase'})`);
console.log('');

console.log('='.repeat(120));
console.log('PREDICTIONS WITH CORRECTED COEFFICIENT');
console.log('='.repeat(120));
console.log('');
console.log('Power | Current HR% | Corrected HR% | Change   | HR in 650 PA (Corrected)');
console.log('-'.repeat(120));

[20, 30, 40, 50, 60, 70, 75, 78, 80].forEach(power => {
  const currentHrPct = Math.max(0, currentIntercept + currentSlope * power);
  const correctedHrPct = Math.max(0, newIntercept + newSlope * power);
  const change = correctedHrPct - currentHrPct;
  const hrIn650 = Math.round((correctedHrPct / 100) * 650);

  console.log(
    `${power.toString().padStart(5)} | ` +
    `${currentHrPct.toFixed(2).padStart(11)} | ` +
    `${correctedHrPct.toFixed(2).padStart(13)} | ` +
    `${(change > 0 ? '+' : '') + change.toFixed(2).padStart(7)} | ` +
    `${hrIn650.toString().padStart(24)}`
  );
});

console.log('');
console.log('='.repeat(120));
console.log('EXPECTED BIAS AFTER CORRECTION');
console.log('='.repeat(120));
console.log('');
console.log('Quartile | Power Range | Current Bias | Expected New Bias');
console.log('-'.repeat(120));

Object.entries(biases).forEach(([quartile, data]) => {
  const currentBias = data.bias;
  const midpoint = data.midpoint;

  // Calculate change in prediction at midpoint
  const oldPrediction = currentIntercept + currentSlope * midpoint;
  const newPrediction = newIntercept + newSlope * midpoint;
  const predictionChange = newPrediction - oldPrediction;

  // Expected new bias = current bias - prediction change
  // (because bias = actual - projected, so reducing projected increases bias)
  const expectedNewBias = currentBias - predictionChange;

  console.log(
    `${quartile.toUpperCase().padEnd(8)} | ` +
    `${data.powerRange[0]}-${data.powerRange[1]}        | ` +
    `${(currentBias > 0 ? '+' : '') + currentBias.toFixed(3).padStart(12)} | ` +
    `${(expectedNewBias > 0 ? '+' : '') + expectedNewBias.toFixed(3).padStart(17)}`
  );
});

console.log('');
console.log('='.repeat(120));
console.log('RECOMMENDATION');
console.log('='.repeat(120));
console.log('');
console.log('Update HitterRatingEstimatorService.ts:');
console.log('');
console.log(`  power: { intercept: ${newIntercept.toFixed(4)}, slope: ${newSlope.toFixed(6)} }`);
console.log('');
console.log('This flatter slope will:');
console.log('  - Reduce elite power projections (fix over-projection)');
console.log('  - Increase weak power projections (fix under-projection)');
console.log('  - Bring biases closer to 0% across all quartiles');
console.log('');
console.log('='.repeat(120));
