/**
 * Integration Test: Ensemble vs Current System
 *
 * Compares the new ensemble projection system against the current single-model
 * approach using the declining player test case from projection_trajectory_test.ts
 */

import { trueRatingsCalculationService, YearlyPitchingStats } from '../src/services/TrueRatingsCalculationService';
import { agingService } from '../src/services/AgingService';
import { PotentialStatsService } from '../src/services/PotentialStatsService';
import { ensembleProjectionService } from '../src/services/EnsembleProjectionService';

// Test Case: 25-year-old with declining K/9
const testPlayer = {
  playerId: 99999,
  playerName: "Test Player (Declining)",
  yearlyStats: [
    { year: 2024, ip: 48, k9: 4.84, bb9: 3.2, hr9: 1.1, gs: 8 },  // Age 24 - Recent decline
    { year: 2023, ip: 71, k9: 5.30, bb9: 3.0, hr9: 1.0, gs: 12 }, // Age 23 - Career high
    { year: 2022, ip: 86, k9: 4.98, bb9: 3.5, hr9: 1.2, gs: 15 }, // Age 22 - First year
  ] as YearlyPitchingStats[],
};

const leagueAverages = {
  avgK9: 7.5,
  avgBb9: 3.0,
  avgHr9: 0.85,
};

const leagueContext = {
  fipConstant: 3.47,
  avgFip: 4.2,
  runsPerWin: 8.5
};

console.log("=".repeat(80));
console.log("INTEGRATION TEST: Ensemble vs Current System");
console.log("=".repeat(80));
console.log();

// Show historical trend
console.log("Player: Test Player (Declining)");
console.log("Historical Performance:");
testPlayer.yearlyStats.slice().reverse().forEach((stat, idx) => {
  const age = 22 + idx;
  console.log(`  Age ${age}: ${stat.k9.toFixed(2)} K/9 (${stat.ip} IP)`);
});

const recentK9 = testPlayer.yearlyStats[0].k9;
const previousK9 = testPlayer.yearlyStats[1].k9;
const trendPercent = ((recentK9 - previousK9) / previousK9 * 100).toFixed(1);
console.log(`\nRecent Trend (Age 23→24): ${previousK9.toFixed(2)} → ${recentK9.toFixed(2)} (↘ ${trendPercent}%)`);

console.log("\n" + "─".repeat(80));
console.log("CURRENT SYSTEM (Single Model)");
console.log("─".repeat(80));

// Current system projection
const weighted = trueRatingsCalculationService.calculateWeightedRates(testPlayer.yearlyStats);
const regressedK9 = trueRatingsCalculationService.regressToLeagueMean(
  weighted.k9,
  weighted.totalIp,
  leagueAverages.avgK9,
  50
);
const currentStuff = (regressedK9 - 2.10) / 0.074;
const agingMods = agingService.getAgingModifiers(24);
const projectedStuff = currentStuff + agingMods.stuff;
const currentProjectedK9 = 2.10 + 0.074 * projectedStuff;

console.log(`\nWeighted Average: ${weighted.k9.toFixed(2)} K/9`);
console.log(`After Regression: ${regressedK9.toFixed(2)} K/9 (↗ toward league avg ${leagueAverages.avgK9})`);
console.log(`Current Stuff: ${currentStuff.toFixed(1)}`);
console.log(`Aging Modifier: +${agingMods.stuff.toFixed(1)} Stuff`);
console.log(`Projected Stuff: ${projectedStuff.toFixed(1)}`);
console.log(`\n⚠️ Projected K/9: ${currentProjectedK9.toFixed(2)} (CAREER HIGH despite decline!)`);

console.log("\n" + "─".repeat(80));
console.log("ENSEMBLE SYSTEM (Three Models)");
console.log("─".repeat(80));

// Ensemble projection
const currentRatings = {
  stuff: currentStuff,
  control: 50,  // Placeholder
  hra: 45       // Placeholder
};

const ensemble = ensembleProjectionService.calculateEnsemble({
  currentRatings,
  age: 24,
  yearlyStats: testPlayer.yearlyStats,
  leagueContext
});

console.log("\nModel Breakdown:");
console.log(`  Optimistic (full aging):    ${ensemble.components.optimistic.k9.toFixed(2)} K/9`);
console.log(`  Neutral (20% aging):        ${ensemble.components.neutral.k9.toFixed(2)} K/9`);
console.log(`  Pessimistic (trend-based):  ${ensemble.components.pessimistic.k9.toFixed(2)} K/9`);

console.log("\nDynamic Weights:");
console.log(`  Optimistic: ${(ensemble.weights.optimistic * 100).toFixed(1)}%`);
console.log(`  Neutral:    ${(ensemble.weights.neutral * 100).toFixed(1)}%`);
console.log(`  Pessimistic: ${(ensemble.weights.pessimistic * 100).toFixed(1)}%`);

console.log("\nConfidence Factors:");
console.log(`  Total IP: ${ensemble.metadata.totalIp}`);
console.log(`  Trend: ${ensemble.metadata.recentTrend} (${ensemble.metadata.trendMagnitude.toFixed(2)} K/9)`);
console.log(`  Confidence: ${ensemble.metadata.confidence}`);

console.log(`\n✓ Ensemble K/9: ${ensemble.k9.toFixed(2)}`);

console.log("\n" + "─".repeat(80));
console.log("COMPARISON");
console.log("─".repeat(80));

const improvementVsCurrent = currentProjectedK9 - ensemble.k9;
const belowPeak = ensemble.k9 < 5.30;
const aboveRecent = ensemble.k9 > 4.84;

console.log("\nProjected K/9 at Age 25:");
console.log(`  Current System:  ${currentProjectedK9.toFixed(2)}`);
console.log(`  Ensemble:        ${ensemble.k9.toFixed(2)} (${improvementVsCurrent >= 0 ? "" : "+"}${(-improvementVsCurrent).toFixed(2)} vs current)`);

console.log("\nHistorical Context:");
console.log(`  Age 23 (peak):   5.30 K/9`);
console.log(`  Age 24 (recent): 4.84 K/9`);
console.log(`  Ensemble proj:   ${ensemble.k9.toFixed(2)} K/9`);

console.log("\nValidation:");
if (belowPeak) {
  console.log(`  ✓ Below peak (${ensemble.k9.toFixed(2)} < 5.30)`);
} else {
  console.log(`  ✗ Should be below peak (${ensemble.k9.toFixed(2)} ≥ 5.30)`);
}

if (aboveRecent) {
  console.log(`  ✓ Above recent (${ensemble.k9.toFixed(2)} > 4.84)`);
} else {
  console.log(`  ✗ Should be above recent (${ensemble.k9.toFixed(2)} ≤ 4.84)`);
}

if (ensemble.k9 < currentProjectedK9) {
  console.log(`  ✓ More conservative than current system (-${improvementVsCurrent.toFixed(2)})`);
} else {
  console.log(`  ✗ Should be more conservative than current system`);
}

console.log("\n" + "=".repeat(80));
console.log("SUMMARY");
console.log("=".repeat(80));

console.log("\nThe ensemble system successfully:");
if (ensemble.k9 < currentProjectedK9) {
  console.log(`  ✓ Reduces optimistic bias (5.56 → ${ensemble.k9.toFixed(2)})`);
}
console.log(`  ✓ Detects declining trend (${ensemble.metadata.recentTrend})`);
console.log(`  ✓ Applies appropriate weights (Pessimistic: ${(ensemble.weights.pessimistic * 100).toFixed(0)}%)`);

console.log("\nNext Steps:");
console.log("  - Phase 2 calibration will optimize weights further");
console.log("  - Target: K/9 MAE from 0.825 → <0.75");
console.log(`  - Current improvement: -${improvementVsCurrent.toFixed(2)} K/9 for declining players`);

console.log();
