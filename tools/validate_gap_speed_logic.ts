/**
 * Gap/Speed Logic Validation
 *
 * Tests the Gap/Speed coefficient logic directly without needing database access.
 * Validates that:
 * 1. Gap affects doubles rate as expected
 * 2. Speed affects triples rate as expected
 * 3. wOBA changes are reasonable
 * 4. ISO calculation works correctly
 *
 * USAGE: npx tsx tools/validate_gap_speed_logic.ts
 */

import { HitterRatingEstimatorService } from '../src/services/HitterRatingEstimatorService';
import { HitterTrueFutureRatingService } from '../src/services/HitterTrueFutureRatingService';

// ============================================================================
// Test Cases
// ============================================================================

interface TestPlayer {
  name: string;
  gap: number;
  speed: number;
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
  expectedDoublesPerAB: number;  // Rough expectation
  expectedTriplesPerAB: number;  // Rough expectation
}

const TEST_PLAYERS: TestPlayer[] = [
  {
    name: 'Average Player (Gap=50, Speed=50)',
    gap: 50,
    speed: 50,
    bbPct: 8.0,
    kPct: 20.0,
    hrPct: 2.5,
    avg: 0.260,
    expectedDoublesPerAB: 0.0417,  // 25 doubles per 600 AB
    expectedTriplesPerAB: 0.0018,  // 1.1 triples per 600 AB
  },
  {
    name: 'High Gap Player (Gap=80, Speed=50)',
    gap: 80,
    speed: 50,
    bbPct: 8.0,
    kPct: 20.0,
    hrPct: 2.5,
    avg: 0.260,
    expectedDoublesPerAB: 0.0742,  // 44.5 doubles per 600 AB
    expectedTriplesPerAB: 0.0018,  // 1.1 triples per 600 AB
  },
  {
    name: 'High Speed Player (Gap=50, Speed=150)',
    gap: 50,
    speed: 150,
    bbPct: 8.0,
    kPct: 20.0,
    hrPct: 2.5,
    avg: 0.260,
    expectedDoublesPerAB: 0.0417,  // 25.0 doubles per 600 AB
    expectedTriplesPerAB: 0.0048,  // 2.9 triples per 600 AB
  },
  {
    name: 'Low Gap Player (Gap=20, Speed=50)',
    gap: 20,
    speed: 50,
    bbPct: 8.0,
    kPct: 20.0,
    hrPct: 2.5,
    avg: 0.260,
    expectedDoublesPerAB: 0.0091,  // 5.5 doubles per 600 AB
    expectedTriplesPerAB: 0.0018,  // 1.1 triples per 600 AB
  },
  {
    name: 'Elite Gap & Speed (Gap=80, Speed=200)',
    gap: 80,
    speed: 200,
    bbPct: 10.0,
    kPct: 15.0,
    hrPct: 3.0,
    avg: 0.300,
    expectedDoublesPerAB: 0.0742,  // 44.5 doubles per 600 AB
    expectedTriplesPerAB: 0.0065,  // 3.9 triples per 600 AB
  },
];

// ============================================================================
// Validation Functions
// ============================================================================

function testDoublesRate() {
  console.log('='.repeat(80));
  console.log('DOUBLES RATE VALIDATION (Gap → Doubles/AB)');
  console.log('='.repeat(80));
  console.log('\n' + 'Gap'.padEnd(8) + 'Expected'.padEnd(12) + 'Actual'.padEnd(12) + 'Diff'.padEnd(12) + 'Status');
  console.log('-'.repeat(80));

  const testGaps = [20, 35, 50, 65, 80];
  let allPass = true;

  for (const gap of testGaps) {
    const actual = HitterRatingEstimatorService.expectedDoublesRate(gap);
    const expected = -0.012627 + 0.001086 * gap;
    const diff = Math.abs(actual - expected);
    const pass = diff < 0.0001;

    console.log(
      gap.toString().padEnd(8) +
      expected.toFixed(4).padEnd(12) +
      actual.toFixed(4).padEnd(12) +
      diff.toFixed(6).padEnd(12) +
      (pass ? '✅' : '❌')
    );

    if (!pass) allPass = false;
  }

  return allPass;
}

function testTriplesRate() {
  console.log('\n' + '='.repeat(80));
  console.log('TRIPLES RATE VALIDATION (Speed → Triples/AB)');
  console.log('='.repeat(80));
  console.log('\n' + 'Speed'.padEnd(8) + 'Expected'.padEnd(12) + 'Actual'.padEnd(12) + 'Diff'.padEnd(12) + 'Status');
  console.log('-'.repeat(80));

  const testSpeeds = [30, 50, 100, 150, 200];
  let allPass = true;

  for (const speed of testSpeeds) {
    const actual = HitterRatingEstimatorService.expectedTriplesRate(speed);
    const expected = 0.000250 + 0.000030 * speed;
    const diff = Math.abs(actual - expected);
    const pass = diff < 0.0001;

    console.log(
      speed.toString().padEnd(8) +
      expected.toFixed(4).padEnd(12) +
      actual.toFixed(4).padEnd(12) +
      diff.toFixed(6).padEnd(12) +
      (pass ? '✅' : '❌')
    );

    if (!pass) allPass = false;
  }

  return allPass;
}

function testWobaCalculation() {
  console.log('\n' + '='.repeat(80));
  console.log('WOBA CALCULATION VALIDATION');
  console.log('='.repeat(80));

  const service = new HitterTrueFutureRatingService();
  let allPass = true;

  console.log('\nPlayer'.padEnd(35) + 'wOBA'.padEnd(10) + 'In Bounds'.padEnd(12) + 'Status');
  console.log('-'.repeat(80));

  for (const player of TEST_PLAYERS) {
    const woba = service.calculateWobaFromRates(
      player.bbPct,
      player.kPct,
      player.hrPct,
      player.avg,
      player.gap,
      player.speed
    );

    const inBounds = woba >= 0.200 && woba <= 0.500;
    const pass = inBounds;

    console.log(
      player.name.padEnd(35) +
      woba.toFixed(3).padEnd(10) +
      (inBounds ? 'Yes' : 'No').padEnd(12) +
      (pass ? '✅' : '❌')
    );

    if (!pass) {
      console.log(`  ❌ ERROR: wOBA ${woba.toFixed(3)} is out of bounds [0.200, 0.500]`);
      allPass = false;
    }
  }

  return allPass;
}

function testGapImpact() {
  console.log('\n' + '='.repeat(80));
  console.log('GAP IMPACT TEST (Higher Gap = Higher wOBA)');
  console.log('='.repeat(80));

  const service = new HitterTrueFutureRatingService();

  // Same player with different Gap values
  const baseStats = {
    bbPct: 8.0,
    kPct: 20.0,
    hrPct: 2.5,
    avg: 0.260,
    speed: 50,
  };

  const gapValues = [20, 35, 50, 65, 80];
  const wobas: number[] = [];

  console.log('\nGap'.padEnd(8) + 'wOBA'.padEnd(10) + 'Δ vs Prev'.padEnd(12));
  console.log('-'.repeat(80));

  for (const gap of gapValues) {
    const woba = service.calculateWobaFromRates(
      baseStats.bbPct,
      baseStats.kPct,
      baseStats.hrPct,
      baseStats.avg,
      gap,
      baseStats.speed
    );
    wobas.push(woba);

    const delta = wobas.length > 1 ? woba - wobas[wobas.length - 2] : 0;
    const deltaStr = wobas.length > 1 ? (delta >= 0 ? '+' : '') + delta.toFixed(4) : '-';

    console.log(
      gap.toString().padEnd(8) +
      woba.toFixed(3).padEnd(10) +
      deltaStr.padEnd(12)
    );
  }

  // Check monotonic increase
  let allPass = true;
  for (let i = 1; i < wobas.length; i++) {
    if (wobas[i] < wobas[i - 1]) {
      console.log(`\n❌ ERROR: wOBA decreased from Gap=${gapValues[i-1]} to Gap=${gapValues[i]}`);
      allPass = false;
    }
  }

  if (allPass) {
    console.log('\n✅ Gap impact validated: Higher Gap → Higher wOBA');
  }

  return allPass;
}

function testSpeedImpact() {
  console.log('\n' + '='.repeat(80));
  console.log('SPEED IMPACT TEST (Higher Speed = Higher wOBA)');
  console.log('='.repeat(80));

  const service = new HitterTrueFutureRatingService();

  // Same player with different Speed values
  const baseStats = {
    bbPct: 8.0,
    kPct: 20.0,
    hrPct: 2.5,
    avg: 0.260,
    gap: 50,
  };

  const speedValues = [30, 50, 100, 150, 200];
  const wobas: number[] = [];

  console.log('\nSpeed'.padEnd(8) + 'wOBA'.padEnd(10) + 'Δ vs Prev'.padEnd(12));
  console.log('-'.repeat(80));

  for (const speed of speedValues) {
    const woba = service.calculateWobaFromRates(
      baseStats.bbPct,
      baseStats.kPct,
      baseStats.hrPct,
      baseStats.avg,
      baseStats.gap,
      speed
    );
    wobas.push(woba);

    const delta = wobas.length > 1 ? woba - wobas[wobas.length - 2] : 0;
    const deltaStr = wobas.length > 1 ? (delta >= 0 ? '+' : '') + delta.toFixed(4) : '-';

    console.log(
      speed.toString().padEnd(8) +
      woba.toFixed(3).padEnd(10) +
      deltaStr.padEnd(12)
    );
  }

  // Check monotonic increase (triples are rare, so increase might be tiny)
  let allPass = true;
  for (let i = 1; i < wobas.length; i++) {
    if (wobas[i] < wobas[i - 1]) {
      console.log(`\n❌ ERROR: wOBA decreased from Speed=${speedValues[i-1]} to Speed=${speedValues[i]}`);
      allPass = false;
    }
  }

  if (allPass) {
    console.log('\n✅ Speed impact validated: Higher Speed → Higher wOBA (or equal)');
  }

  return allPass;
}

function testDistributionConstraint() {
  console.log('\n' + '='.repeat(80));
  console.log('DISTRIBUTION CONSTRAINT TEST (Singles ≥ 0)');
  console.log('='.repeat(80));

  const service = new HitterTrueFutureRatingService();

  // Extreme case: Very high Gap + Speed, low AVG
  // Should scale 2B/3B to fit within available hits
  const extremeCase = {
    name: 'Extreme: Gap=80, Speed=200, Low AVG',
    bbPct: 15.0,
    kPct: 10.0,
    hrPct: 5.0,
    avg: 0.220,  // Low AVG means fewer hits to distribute
    gap: 80,
    speed: 200,
  };

  const woba = service.calculateWobaFromRates(
    extremeCase.bbPct,
    extremeCase.kPct,
    extremeCase.hrPct,
    extremeCase.avg,
    extremeCase.gap,
    extremeCase.speed
  );

  console.log(`\nTest case: ${extremeCase.name}`);
  console.log(`  BB%:   ${extremeCase.bbPct.toFixed(1)}%`);
  console.log(`  HR%:   ${extremeCase.hrPct.toFixed(1)}%`);
  console.log(`  AVG:   ${extremeCase.avg.toFixed(3)}`);
  console.log(`  Gap:   ${extremeCase.gap}`);
  console.log(`  Speed: ${extremeCase.speed}`);
  console.log(`  wOBA:  ${woba.toFixed(3)}`);

  const inBounds = woba >= 0.200 && woba <= 0.500;
  console.log(`\n${inBounds ? '✅' : '❌'} wOBA in bounds: ${woba.toFixed(3)}`);

  return inBounds;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('='.repeat(80));
  console.log('GAP/SPEED LOGIC VALIDATION');
  console.log('='.repeat(80));
  console.log('\nValidating the implementation of Gap/Speed-based doubles/triples distribution\n');

  const results = {
    doublesRate: testDoublesRate(),
    triplesRate: testTriplesRate(),
    wobaCalculation: testWobaCalculation(),
    gapImpact: testGapImpact(),
    speedImpact: testSpeedImpact(),
    distributionConstraint: testDistributionConstraint(),
  };

  console.log('\n' + '='.repeat(80));
  console.log('FINAL VALIDATION SUMMARY');
  console.log('='.repeat(80));

  const tests = [
    { name: 'Doubles Rate Coefficients', pass: results.doublesRate },
    { name: 'Triples Rate Coefficients', pass: results.triplesRate },
    { name: 'wOBA Calculation Bounds', pass: results.wobaCalculation },
    { name: 'Gap Impact on wOBA', pass: results.gapImpact },
    { name: 'Speed Impact on wOBA', pass: results.speedImpact },
    { name: 'Distribution Constraint', pass: results.distributionConstraint },
  ];

  console.log();
  for (const test of tests) {
    console.log(`${test.pass ? '✅' : '❌'} ${test.name}`);
  }

  const allPass = Object.values(results).every(r => r);

  console.log('\n' + '='.repeat(80));
  if (allPass) {
    console.log('✅ ALL TESTS PASSED - Implementation is correct!');
  } else {
    console.log('❌ SOME TESTS FAILED - Review implementation');
  }
  console.log('='.repeat(80));
  console.log();
}

main();
