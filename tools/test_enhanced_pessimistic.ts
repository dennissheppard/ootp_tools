/**
 * Quick test of enhanced pessimistic model with adaptive dampening
 * Tests the original declining player case
 */

import { ensembleProjectionService } from '../src/services/EnsembleProjectionService';

// The original problematic case:
// Age 24 pitcher with declining K/9: 5.30 (age 23) → 4.84 (age 24)
// Current system projects: 5.56 K/9 (unrealistic career high!)
// Target: <5.35 K/9 (should be at or below previous peak)

const testCase = {
  currentRatings: { stuff: 46, control: 50, hra: 45 },
  age: 24,
  yearlyStats: [
    { year: 2024, ip: 48, k9: 4.84, bb9: 3.2, hr9: 1.1, gs: 8, era: 4.2, war: 0.5 },
    { year: 2023, ip: 71, k9: 5.30, bb9: 3.0, hr9: 1.0, gs: 12, era: 3.8, war: 1.2 },
    { year: 2022, ip: 86, k9: 4.98, bb9: 3.5, hr9: 1.2, gs: 15, era: 4.5, war: 0.8 }
  ],
  leagueContext: { fipConstant: 3.47, avgFip: 4.2, runsPerWin: 8.5 }
};

console.log('='.repeat(80));
console.log('ENHANCED PESSIMISTIC MODEL TEST');
console.log('='.repeat(80));
console.log('\nTest Case: Declining Young Player (Age 24)');
console.log('Historical Performance:');
console.log('  Age 22: 4.98 K/9 (86 IP)');
console.log('  Age 23: 5.30 K/9 (71 IP) ← Career high');
console.log('  Age 24: 4.84 K/9 (48 IP) ← Declined -0.46');
console.log('\nCurrent System: 5.56 K/9 (projects career high despite decline) ✗');
console.log('Target: <5.35 K/9 (should not exceed previous peak)');
console.log();

// Test with default (uncalibrated) weights
const result = ensembleProjectionService.calculateEnsemble(testCase);

console.log('-'.repeat(80));
console.log('ENSEMBLE PROJECTION (Enhanced Pessimistic Model)');
console.log('-'.repeat(80));
console.log('\nFinal Projection:');
console.log(`  K/9:  ${result.k9.toFixed(2)}`);
console.log(`  BB/9: ${result.bb9.toFixed(2)}`);
console.log(`  HR/9: ${result.hr9.toFixed(2)}`);
console.log(`  FIP:  ${result.fip.toFixed(2)}`);

console.log('\nModel Components:');
console.log(`  Optimistic:  ${result.components.optimistic.k9.toFixed(2)} K/9 (standard aging)`);
console.log(`  Neutral:     ${result.components.neutral.k9.toFixed(2)} K/9 (conservative aging)`);
console.log(`  Pessimistic: ${result.components.pessimistic.k9.toFixed(2)} K/9 (adaptive trend) ← Enhanced!`);

console.log('\nEnsemble Weights:');
console.log(`  Optimistic:  ${(result.weights.optimistic * 100).toFixed(1)}%`);
console.log(`  Neutral:     ${(result.weights.neutral * 100).toFixed(1)}%`);
console.log(`  Pessimistic: ${(result.weights.pessimistic * 100).toFixed(1)}%`);

console.log('\nMetadata:');
console.log(`  Total IP:    ${result.metadata.totalIp}`);
console.log(`  Trend:       ${result.metadata.recentTrend} (${result.metadata.trendMagnitude >= 0 ? '+' : ''}${result.metadata.trendMagnitude.toFixed(2)})`);
console.log(`  Confidence:  ${result.metadata.confidence}`);

console.log('\n' + '-'.repeat(80));
console.log('EVALUATION');
console.log('-'.repeat(80));

const meetsTarget = result.k9 <= 5.35;
const improvement = 5.56 - result.k9;

console.log(`\nProjected K/9: ${result.k9.toFixed(2)}`);
console.log(`Target: ≤5.35`);
console.log(`Status: ${meetsTarget ? '✓ PASS' : '✗ MISS'} (${meetsTarget ? 'below' : 'above'} previous peak)`);
console.log(`\nImprovement vs Current System:`);
console.log(`  Old: 5.56 K/9`);
console.log(`  New: ${result.k9.toFixed(2)} K/9`);
console.log(`  Δ:   ${improvement >= 0 ? '-' : '+'}${Math.abs(improvement).toFixed(2)} (${meetsTarget ? 'better ✓' : 'not enough ✗'})`);

console.log();
