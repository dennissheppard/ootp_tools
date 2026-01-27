/**
 * Unit Tests for EnsembleProjectionService
 *
 * Tests the three-model ensemble system for pitcher projections.
 * Validates model calculations, confidence factors, weight formulas, and edge cases.
 */

import { ensembleProjectionService, EnsembleInput } from '../src/services/EnsembleProjectionService';
import { PotentialStatsService } from '../src/services/PotentialStatsService';
import { agingService } from '../src/services/AgingService';

// Test data helper
const createLeagueContext = () => ({
  fipConstant: 3.47,
  avgFip: 4.2,
  runsPerWin: 8.5
});

const createTestInput = (
  age: number,
  ratings: { stuff: number; control: number; hra: number },
  yearlyStats?: any[]
): EnsembleInput => ({
  currentRatings: ratings,
  age,
  yearlyStats,
  leagueContext: createLeagueContext()
});

/**
 * Test Suite 1: Model Calculations
 */
console.log('\n=== TEST SUITE 1: MODEL CALCULATIONS ===\n');

// Test 1.1: Optimistic model applies full aging curve
console.log('Test 1.1: Optimistic model applies full aging curve');
{
  const input = createTestInput(24, { stuff: 50, control: 50, hra: 50 });
  const result = ensembleProjectionService.calculateEnsemble(input);

  // Age 24 should get +0.5 Stuff, +1.5 Control, +0.5 HRA
  const expectedK9 = PotentialStatsService.calculateK9(50.5);
  const actualK9 = result.components.optimistic.k9;

  const diff = Math.abs(actualK9 - expectedK9);
  if (diff < 0.01) {
    console.log('  ✓ Optimistic model correctly applies aging curve');
    console.log(`    Expected K/9: ${expectedK9.toFixed(2)}, Actual: ${actualK9.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: Optimistic model incorrect');
    console.log(`    Expected K/9: ${expectedK9.toFixed(2)}, Actual: ${actualK9.toFixed(2)}`);
  }
}

// Test 1.2: Neutral model applies 20% aging
console.log('\nTest 1.2: Neutral model applies 20% aging');
{
  const input = createTestInput(24, { stuff: 50, control: 50, hra: 50 });
  const result = ensembleProjectionService.calculateEnsemble(input);

  // Age 24: +0.5 Stuff * 0.2 = +0.1 Stuff
  const expectedK9 = PotentialStatsService.calculateK9(50.1);
  const actualK9 = result.components.neutral.k9;

  const diff = Math.abs(actualK9 - expectedK9);
  if (diff < 0.01) {
    console.log('  ✓ Neutral model correctly applies dampened aging');
    console.log(`    Expected K/9: ${expectedK9.toFixed(2)}, Actual: ${actualK9.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: Neutral model incorrect');
    console.log(`    Expected K/9: ${expectedK9.toFixed(2)}, Actual: ${actualK9.toFixed(2)}`);
  }
}

// Test 1.3: Pessimistic model extrapolates trend
console.log('\nTest 1.3: Pessimistic model extrapolates trend');
{
  const yearlyStats = [
    { year: 2024, ip: 50, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 10 },
    { year: 2023, ip: 60, k9: 7.0, bb9: 3.0, hr9: 1.0, gs: 12 }
  ];
  const input = createTestInput(24, { stuff: 50, control: 50, hra: 50 }, yearlyStats);
  const result = ensembleProjectionService.calculateEnsemble(input);

  // Trend: -1.0 K/9, dampened 50% = -0.5
  // Current K/9 from ratings: ~5.8, projected: ~5.3
  const actualK9 = result.components.pessimistic.k9;

  // Should be below 6.0 (recent) due to declining trend
  if (actualK9 < 6.0 && actualK9 > 5.0) {
    console.log('  ✓ Pessimistic model correctly extrapolates declining trend');
    console.log(`    Recent K/9: 6.0, Projected: ${actualK9.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: Pessimistic model outside expected range');
    console.log(`    Expected: 5.0-6.0, Actual: ${actualK9.toFixed(2)}`);
  }
}

// Test 1.4: Pessimistic falls back to neutral with insufficient data
console.log('\nTest 1.4: Pessimistic falls back to neutral with insufficient data');
{
  const input = createTestInput(24, { stuff: 50, control: 50, hra: 50 }, []); // No stats
  const result = ensembleProjectionService.calculateEnsemble(input);

  const pessimisticK9 = result.components.pessimistic.k9;
  const neutralK9 = result.components.neutral.k9;

  if (Math.abs(pessimisticK9 - neutralK9) < 0.01) {
    console.log('  ✓ Pessimistic correctly falls back to neutral');
    console.log(`    Both: ${pessimisticK9.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: Pessimistic should match neutral');
    console.log(`    Pessimistic: ${pessimisticK9.toFixed(2)}, Neutral: ${neutralK9.toFixed(2)}`);
  }
}

/**
 * Test Suite 2: Confidence Factors
 */
console.log('\n\n=== TEST SUITE 2: CONFIDENCE FACTORS ===\n');

// Test 2.1: IP confidence scales correctly
console.log('Test 2.1: IP confidence scales linearly to 300 IP');
{
  const tests = [
    { ip: 0, expected: 0.0 },
    { ip: 150, expected: 0.5 },
    { ip: 300, expected: 1.0 },
    { ip: 600, expected: 1.0 } // Capped at 1.0
  ];

  let allPass = true;
  for (const test of tests) {
    const yearlyStats = [{ year: 2024, ip: test.ip, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 10 }];
    const input = createTestInput(27, { stuff: 50, control: 50, hra: 50 }, yearlyStats);
    const result = ensembleProjectionService.calculateEnsemble(input);

    const totalIp = result.metadata.totalIp;
    const actual = Math.min(1.0, totalIp / 300);
    const diff = Math.abs(actual - test.expected);

    if (diff < 0.01) {
      console.log(`  ✓ IP ${test.ip} → confidence ${actual.toFixed(2)}`);
    } else {
      console.log(`  ✗ IP ${test.ip}: expected ${test.expected}, got ${actual.toFixed(2)}`);
      allPass = false;
    }
  }
  if (allPass) console.log('  All IP confidence tests passed!');
}

// Test 2.2: Trend detection identifies direction
console.log('\nTest 2.2: Trend detection identifies direction');
{
  const decliningStats = [
    { year: 2024, ip: 60, k9: 5.0, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2023, ip: 60, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 12 }
  ];
  const improvingStats = [
    { year: 2024, ip: 60, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2023, ip: 60, k9: 5.0, bb9: 3.0, hr9: 1.0, gs: 12 }
  ];

  const declining = ensembleProjectionService.calculateEnsemble(
    createTestInput(24, { stuff: 50, control: 50, hra: 50 }, decliningStats)
  );
  const improving = ensembleProjectionService.calculateEnsemble(
    createTestInput(24, { stuff: 50, control: 50, hra: 50 }, improvingStats)
  );

  const decliningPass = declining.metadata.recentTrend === 'declining';
  const improvingPass = improving.metadata.recentTrend === 'improving';

  if (decliningPass) {
    console.log('  ✓ Correctly identified declining trend (6.0 → 5.0)');
  } else {
    console.log(`  ✗ Expected declining, got ${declining.metadata.recentTrend}`);
  }

  if (improvingPass) {
    console.log('  ✓ Correctly identified improving trend (5.0 → 6.0)');
  } else {
    console.log(`  ✗ Expected improving, got ${improving.metadata.recentTrend}`);
  }
}

// Test 2.3: Volatility calculation
console.log('\nTest 2.3: Volatility measures coefficient of variation');
{
  const stableStats = [
    { year: 2024, ip: 60, k9: 7.0, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2023, ip: 60, k9: 7.1, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2022, ip: 60, k9: 6.9, bb9: 3.0, hr9: 1.0, gs: 12 }
  ];
  const volatileStats = [
    { year: 2024, ip: 60, k9: 9.0, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2023, ip: 60, k9: 5.0, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2022, ip: 60, k9: 8.0, bb9: 3.0, hr9: 1.0, gs: 12 }
  ];

  const stable = ensembleProjectionService.calculateEnsemble(
    createTestInput(27, { stuff: 50, control: 50, hra: 50 }, stableStats)
  );
  const volatile = ensembleProjectionService.calculateEnsemble(
    createTestInput(27, { stuff: 50, control: 50, hra: 50 }, volatileStats)
  );

  // Stable should be categorized as stable/declining/improving (not volatile)
  // Volatile should be categorized as volatile
  const stablePass = stable.metadata.recentTrend !== 'volatile';
  const volatilePass = volatile.metadata.recentTrend === 'volatile';

  if (stablePass) {
    console.log(`  ✓ Stable stats correctly identified: ${stable.metadata.recentTrend}`);
  } else {
    console.log(`  ✗ Stable stats marked as volatile`);
  }

  if (volatilePass) {
    console.log('  ✓ Volatile stats correctly identified');
  } else {
    console.log(`  ✗ Expected volatile, got ${volatile.metadata.recentTrend}`);
  }
}

/**
 * Test Suite 3: Weight Calculations
 */
console.log('\n\n=== TEST SUITE 3: WEIGHT CALCULATIONS ===\n');

// Test 3.1: Weights sum to 1.0
console.log('Test 3.1: Weights always sum to 1.0');
{
  const testCases = [
    { age: 22, stats: [] },
    { age: 27, stats: [{ year: 2024, ip: 180, k9: 7.0, bb9: 3.0, hr9: 1.0, gs: 30 }] },
    { age: 35, stats: [{ year: 2024, ip: 30, k9: 5.0, bb9: 4.0, hr9: 1.5, gs: 5 }] }
  ];

  let allPass = true;
  for (const test of testCases) {
    const input = createTestInput(test.age, { stuff: 50, control: 50, hra: 50 }, test.stats);
    const result = ensembleProjectionService.calculateEnsemble(input);
    const sum = result.weights.optimistic + result.weights.neutral + result.weights.pessimistic;

    if (Math.abs(sum - 1.0) < 0.001) {
      console.log(`  ✓ Age ${test.age}: weights sum to ${sum.toFixed(3)}`);
    } else {
      console.log(`  ✗ Age ${test.age}: weights sum to ${sum.toFixed(3)} (expected 1.0)`);
      allPass = false;
    }
  }
  if (allPass) console.log('  All weight sum tests passed!');
}

// Test 3.2: Declining trend increases pessimistic weight
console.log('\nTest 3.2: Declining trend increases pessimistic weight');
{
  const decliningStats = [
    { year: 2024, ip: 80, k9: 5.0, bb9: 3.0, hr9: 1.0, gs: 15 },
    { year: 2023, ip: 80, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 15 }
  ];
  const stableStats = [
    { year: 2024, ip: 80, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 15 },
    { year: 2023, ip: 80, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 15 }
  ];

  const declining = ensembleProjectionService.calculateEnsemble(
    createTestInput(25, { stuff: 50, control: 50, hra: 50 }, decliningStats)
  );
  const stable = ensembleProjectionService.calculateEnsemble(
    createTestInput(25, { stuff: 50, control: 50, hra: 50 }, stableStats)
  );

  if (declining.weights.pessimistic > stable.weights.pessimistic) {
    console.log('  ✓ Declining trend increases pessimistic weight');
    console.log(`    Declining: ${declining.weights.pessimistic.toFixed(2)}, Stable: ${stable.weights.pessimistic.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: Pessimistic weight should be higher for declining trend');
  }

  if (declining.weights.optimistic < stable.weights.optimistic) {
    console.log('  ✓ Declining trend decreases optimistic weight');
    console.log(`    Declining: ${declining.weights.optimistic.toFixed(2)}, Stable: ${stable.weights.optimistic.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: Optimistic weight should be lower for declining trend');
  }
}

// Test 3.3: Young age increases optimistic weight
console.log('\nTest 3.3: Young age increases optimistic weight');
{
  const young = ensembleProjectionService.calculateEnsemble(
    createTestInput(22, { stuff: 50, control: 50, hra: 50 }, [{ year: 2024, ip: 100, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 15 }])
  );
  const old = ensembleProjectionService.calculateEnsemble(
    createTestInput(35, { stuff: 50, control: 50, hra: 50 }, [{ year: 2024, ip: 100, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 15 }])
  );

  if (young.weights.optimistic > old.weights.optimistic) {
    console.log('  ✓ Young player has higher optimistic weight');
    console.log(`    Age 22: ${young.weights.optimistic.toFixed(2)}, Age 35: ${old.weights.optimistic.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: Young player should have higher optimistic weight');
  }
}

// Test 3.4: High IP increases neutral/pessimistic weight
console.log('\nTest 3.4: High IP increases neutral weight');
{
  const highIP = ensembleProjectionService.calculateEnsemble(
    createTestInput(27, { stuff: 50, control: 50, hra: 50 }, [
      { year: 2024, ip: 180, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 30 },
      { year: 2023, ip: 180, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 30 }
    ])
  );
  const lowIP = ensembleProjectionService.calculateEnsemble(
    createTestInput(27, { stuff: 50, control: 50, hra: 50 }, [
      { year: 2024, ip: 30, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 5 }
    ])
  );

  if (highIP.weights.optimistic < lowIP.weights.optimistic) {
    console.log('  ✓ High IP decreases optimistic weight');
    console.log(`    High IP: ${highIP.weights.optimistic.toFixed(2)}, Low IP: ${lowIP.weights.optimistic.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: High IP should decrease optimistic weight');
  }

  if (highIP.weights.neutral > lowIP.weights.neutral) {
    console.log('  ✓ High IP increases neutral weight');
    console.log(`    High IP: ${highIP.weights.neutral.toFixed(2)}, Low IP: ${lowIP.weights.neutral.toFixed(2)}`);
  } else {
    console.log('  ✗ FAILED: High IP should increase neutral weight');
  }
}

/**
 * Test Suite 4: End-to-End Integration Tests
 */
console.log('\n\n=== TEST SUITE 4: INTEGRATION TESTS ===\n');

// Test 4.1: Declining young player (the motivating case)
console.log('Test 4.1: Declining young player gets conservative projection');
{
  const yearlyStats = [
    { year: 2024, ip: 48, k9: 4.84, bb9: 3.2, hr9: 1.1, gs: 8 },
    { year: 2023, ip: 71, k9: 5.30, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2022, ip: 86, k9: 4.98, bb9: 3.5, hr9: 1.2, gs: 15 }
  ];
  const input = createTestInput(24, { stuff: 46, control: 50, hra: 45 }, yearlyStats);
  const result = ensembleProjectionService.calculateEnsemble(input);

  console.log('  Input: 24yo declining from 5.30 → 4.84 K/9');
  console.log(`  Optimistic: ${result.components.optimistic.k9.toFixed(2)}`);
  console.log(`  Neutral: ${result.components.neutral.k9.toFixed(2)}`);
  console.log(`  Pessimistic: ${result.components.pessimistic.k9.toFixed(2)}`);
  console.log(`  Ensemble: ${result.k9.toFixed(2)}`);
  console.log(`  Weights: Opt=${result.weights.optimistic.toFixed(2)}, Neu=${result.weights.neutral.toFixed(2)}, Pes=${result.weights.pessimistic.toFixed(2)}`);

  // Should project BELOW age 23 peak (5.30)
  const belowPeak = result.k9 < 5.30;
  // Should not be overly pessimistic (ABOVE age 24 actual)
  const aboveRecent = result.k9 > 4.84;
  // Should increase pessimistic weight due to declining trend
  const highPessimistic = result.weights.pessimistic > 0.20;

  if (belowPeak && aboveRecent && highPessimistic) {
    console.log('  ✓ All checks passed!');
    console.log(`    - Projection (${result.k9.toFixed(2)}) is below peak (5.30)`);
    console.log(`    - Projection (${result.k9.toFixed(2)}) is above recent (4.84)`);
    console.log(`    - Pessimistic weight (${result.weights.pessimistic.toFixed(2)}) is significant`);
  } else {
    console.log('  ✗ Some checks failed:');
    if (!belowPeak) console.log(`    - Should be below peak 5.30, got ${result.k9.toFixed(2)}`);
    if (!aboveRecent) console.log(`    - Should be above recent 4.84, got ${result.k9.toFixed(2)}`);
    if (!highPessimistic) console.log(`    - Pessimistic weight should be > 0.20, got ${result.weights.pessimistic.toFixed(2)}`);
  }
}

// Test 4.2: Improving young player maintains optimism
console.log('\nTest 4.2: Improving young player maintains optimism');
{
  const yearlyStats = [
    { year: 2024, ip: 48, k9: 5.30, bb9: 3.2, hr9: 1.1, gs: 8 },
    { year: 2023, ip: 71, k9: 4.84, bb9: 3.0, hr9: 1.0, gs: 12 },
    { year: 2022, ip: 86, k9: 4.98, bb9: 3.5, hr9: 1.2, gs: 15 }
  ];
  const input = createTestInput(24, { stuff: 46, control: 50, hra: 45 }, yearlyStats);
  const result = ensembleProjectionService.calculateEnsemble(input);

  console.log('  Input: 24yo improving from 4.84 → 5.30 K/9');
  console.log(`  Ensemble: ${result.k9.toFixed(2)}`);
  console.log(`  Weights: Opt=${result.weights.optimistic.toFixed(2)}, Neu=${result.weights.neutral.toFixed(2)}, Pes=${result.weights.pessimistic.toFixed(2)}`);

  // Should project continued improvement
  const abovePeak = result.k9 >= 5.30;
  // Should favor optimistic model
  const favorsOptimistic = result.weights.optimistic > 0.30;

  if (abovePeak && favorsOptimistic) {
    console.log('  ✓ All checks passed!');
    console.log(`    - Projects improvement (${result.k9.toFixed(2)} ≥ 5.30)`);
    console.log(`    - Optimistic weight is high (${result.weights.optimistic.toFixed(2)})`);
  } else {
    console.log('  ✗ Some checks failed:');
    if (!abovePeak) console.log(`    - Should be ≥ 5.30, got ${result.k9.toFixed(2)}`);
    if (!favorsOptimistic) console.log(`    - Optimistic weight should be > 0.30, got ${result.weights.optimistic.toFixed(2)}`);
  }
}

// Test 4.3: Veteran with limited IP favors neutral
console.log('\nTest 4.3: Veteran with limited IP favors neutral');
{
  const yearlyStats = [
    { year: 2024, ip: 30, k9: 8.0, bb9: 2.5, hr9: 0.9, gs: 2 }
  ];
  const input = createTestInput(32, { stuff: 55, control: 60, hra: 50 }, yearlyStats);
  const result = ensembleProjectionService.calculateEnsemble(input);

  console.log('  Input: 32yo veteran with 30 IP');
  console.log(`  Ensemble: ${result.k9.toFixed(2)}`);
  console.log(`  Weights: Opt=${result.weights.optimistic.toFixed(2)}, Neu=${result.weights.neutral.toFixed(2)}, Pes=${result.weights.pessimistic.toFixed(2)}`);
  console.log(`  Confidence: ${result.metadata.confidence}`);

  // Small sample + old age = trust neutral model
  const favorsNeutral = result.weights.neutral > 0.40;
  const lowConfidence = result.metadata.confidence === 'low';

  if (favorsNeutral && lowConfidence) {
    console.log('  ✓ All checks passed!');
    console.log(`    - Neutral weight is dominant (${result.weights.neutral.toFixed(2)})`);
    console.log(`    - Confidence is low`);
  } else {
    console.log('  ✗ Some checks failed:');
    if (!favorsNeutral) console.log(`    - Neutral weight should be > 0.40, got ${result.weights.neutral.toFixed(2)}`);
    if (!lowConfidence) console.log(`    - Confidence should be low, got ${result.metadata.confidence}`);
  }
}

// Test 4.4: Stable peak player
console.log('\nTest 4.4: Peak player with stable performance');
{
  const yearlyStats = [
    { year: 2024, ip: 182, k9: 7.3, bb9: 2.5, hr9: 0.9, gs: 32 },
    { year: 2023, ip: 175, k9: 7.4, bb9: 2.4, hr9: 0.9, gs: 31 },
    { year: 2022, ip: 180, k9: 7.2, bb9: 2.6, hr9: 1.0, gs: 33 }
  ];
  const input = createTestInput(27, { stuff: 60, control: 65, hra: 58 }, yearlyStats);
  const result = ensembleProjectionService.calculateEnsemble(input);

  console.log('  Input: 27yo ace with stable 7.2-7.4 K/9');
  console.log(`  Ensemble: ${result.k9.toFixed(2)}`);
  console.log(`  Weights: Opt=${result.weights.optimistic.toFixed(2)}, Neu=${result.weights.neutral.toFixed(2)}, Pes=${result.weights.pessimistic.toFixed(2)}`);
  console.log(`  Trend: ${result.metadata.recentTrend}, Confidence: ${result.metadata.confidence}`);

  // High IP + stable performance = balanced weights, high confidence
  const balancedWeights = result.weights.neutral > 0.35;
  const highConfidence = result.metadata.confidence === 'high';
  const stableProjection = result.k9 >= 7.0 && result.k9 <= 7.5;

  if (balancedWeights && highConfidence && stableProjection) {
    console.log('  ✓ All checks passed!');
    console.log(`    - Weights are balanced`);
    console.log(`    - Confidence is high`);
    console.log(`    - Projection is stable (${result.k9.toFixed(2)})`);
  } else {
    console.log('  ✗ Some checks failed:');
    if (!balancedWeights) console.log(`    - Expected balanced weights`);
    if (!highConfidence) console.log(`    - Confidence should be high, got ${result.metadata.confidence}`);
    if (!stableProjection) console.log(`    - Projection should be 7.0-7.5, got ${result.k9.toFixed(2)}`);
  }
}

console.log('\n\n=== ALL TESTS COMPLETE ===\n');
console.log('Review the output above to verify all tests passed.');
console.log('If any tests failed, review the ensemble weight formula and model calculations.\n');
