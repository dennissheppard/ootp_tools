/**
 * Test: K/9 Projection for Players with Downward Trajectory
 *
 * This test explores how the projection system handles players who show
 * declining performance despite being in their "development" years.
 */

import { trueRatingsCalculationService, YearlyPitchingStats } from '../src/services/TrueRatingsCalculationService';
import { agingService } from '../src/services/AgingService';
import { PotentialStatsService } from '../src/services/PotentialStatsService';

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

// Comparison: 25-year-old with IMPROVING K/9
const improvingPlayer = {
  playerId: 99998,
  playerName: "Test Player (Improving)",
  yearlyStats: [
    { year: 2024, ip: 48, k9: 5.30, bb9: 3.2, hr9: 1.1, gs: 8 },  // Age 24 - Improving
    { year: 2023, ip: 71, k9: 4.84, bb9: 3.0, hr9: 1.0, gs: 12 }, // Age 23
    { year: 2022, ip: 86, k9: 4.98, bb9: 3.5, hr9: 1.2, gs: 15 }, // Age 22
  ] as YearlyPitchingStats[],
};

const leagueAverages = {
  avgK9: 7.5,
  avgBb9: 3.0,
  avgHr9: 0.85,
};

console.log("=".repeat(80));
console.log("K/9 PROJECTION TEST: Declining vs Improving Trajectories");
console.log("=".repeat(80));
console.log();

// Test both players
for (const player of [testPlayer, improvingPlayer]) {
  console.log(`\n${"─".repeat(80)}`);
  console.log(`Player: ${player.playerName}`);
  console.log(`${"─".repeat(80)}`);

  // Show historical trend
  console.log("\nHistorical Performance:");
  player.yearlyStats.slice().reverse().forEach((stat, idx) => {
    const age = 22 + idx; // Assuming starts at 22
    console.log(`  Age ${age}: ${stat.k9.toFixed(2)} K/9 (${stat.ip} IP)`);
  });

  // Calculate trend
  const recentK9 = player.yearlyStats[0].k9;
  const previousK9 = player.yearlyStats[1].k9;
  const trendPercent = ((recentK9 - previousK9) / previousK9 * 100).toFixed(1);
  const trendDirection = recentK9 > previousK9 ? "↗" : recentK9 < previousK9 ? "↘" : "→";
  console.log(`\nRecent Trend (Age 23→24): ${previousK9.toFixed(2)} → ${recentK9.toFixed(2)} (${trendDirection} ${trendPercent}%)`);

  // Step 1: Calculate weighted average
  const weighted = trueRatingsCalculationService.calculateWeightedRates(player.yearlyStats);
  console.log(`\n[Step 1] Weighted Average (5:3:2 by year, IP-weighted):`);
  console.log(`  K/9: ${weighted.k9.toFixed(2)}`);
  console.log(`  Total IP: ${weighted.totalIp}`);

  // Step 2: Regression to league mean
  const stabilizationK = 50;
  const regressedK9 = trueRatingsCalculationService.regressToLeagueMean(
    weighted.k9,
    weighted.totalIp,
    leagueAverages.avgK9,
    stabilizationK
  );
  console.log(`\n[Step 2] Regression to League Mean (K=${stabilizationK} IP):`);
  console.log(`  Before: ${weighted.k9.toFixed(2)}`);
  console.log(`  After:  ${regressedK9.toFixed(2)} ${regressedK9 > weighted.k9 ? "↗" : "↘"} (${((regressedK9 - weighted.k9) / weighted.k9 * 100).toFixed(1)}%)`);
  console.log(`  Formula: (${weighted.k9.toFixed(2)} × ${weighted.totalIp} + ${leagueAverages.avgK9} × ${stabilizationK}) / (${weighted.totalIp} + ${stabilizationK})`);

  // Step 3: Estimate current rating
  const currentStuff = (regressedK9 - 2.10) / 0.074;
  console.log(`\n[Step 3] Estimate Current Rating:`);
  console.log(`  K/9 ${regressedK9.toFixed(2)} → Stuff ${currentStuff.toFixed(1)}`);
  console.log(`  Formula: (${regressedK9.toFixed(2)} - 2.10) / 0.074`);

  // Step 4: Apply aging (24 → 25)
  const age = 24;
  const agingMods = agingService.getAgingModifiers(age);
  const projectedStuff = currentStuff + agingMods.stuff;
  console.log(`\n[Step 4] Apply Aging Curve (Age ${age} → ${age + 1}):`);
  console.log(`  Aging Modifier: +${agingMods.stuff.toFixed(1)} Stuff`);
  console.log(`  Current Stuff: ${currentStuff.toFixed(1)}`);
  console.log(`  Projected Stuff: ${projectedStuff.toFixed(1)}`);

  // Step 5: Convert back to K/9
  const projectedK9 = 2.10 + 0.074 * projectedStuff;
  console.log(`\n[Step 5] Convert to Projected K/9:`);
  console.log(`  Projected K/9: ${projectedK9.toFixed(2)}`);
  console.log(`  Formula: 2.10 + 0.074 × ${projectedStuff.toFixed(1)}`);

  // Compare to historical
  const vs23 = projectedK9 - player.yearlyStats[1].k9;
  const vs24 = projectedK9 - player.yearlyStats[0].k9;
  console.log(`\n[Result] Projection vs Historical:`);
  console.log(`  vs Age 23 (career high): ${vs23 >= 0 ? "+" : ""}${vs23.toFixed(2)} K/9`);
  console.log(`  vs Age 24 (most recent):  ${vs24 >= 0 ? "+" : ""}${vs24.toFixed(2)} K/9`);

  // Flag if projecting career high despite decline
  if (recentK9 < previousK9 && projectedK9 > previousK9) {
    console.log(`\n  ⚠️  WARNING: Projecting career high (${projectedK9.toFixed(2)}) despite recent decline!`);
  }

  console.log();
}

console.log("\n" + "=".repeat(80));
console.log("ALTERNATIVE APPROACHES");
console.log("=".repeat(80));

// Alternative 1: Regress toward replacement level instead of league average
console.log("\n[Alternative 1] Regress toward Replacement Level (5.5 K/9) instead of League Avg (7.5)");
const replacementK9 = 5.5;
const altRegressed = trueRatingsCalculationService.regressToLeagueMean(
  5.04, // Weighted average for declining player
  205,  // Total IP
  replacementK9,
  50    // Stabilization K
);
const altStuff = (altRegressed - 2.10) / 0.074;
const altProjectedStuff = altStuff + 0.5; // Age 24 modifier
const altProjectedK9 = 2.10 + 0.074 * altProjectedStuff;

console.log(`  Regressed K/9: ${altRegressed.toFixed(2)} (vs ${5.52} with league avg)`);
console.log(`  Current Stuff: ${altStuff.toFixed(1)} (vs ${46.2} with league avg)`);
console.log(`  Projected K/9: ${altProjectedK9.toFixed(2)} (vs ${5.56} with league avg)`);

// Alternative 2: Momentum-adjusted aging
console.log("\n[Alternative 2] Momentum-Adjusted Aging");
const momentum = testPlayer.yearlyStats[0].k9 - testPlayer.yearlyStats[1].k9; // -0.46
const ipConfidence = testPlayer.yearlyStats[0].ip / 50; // 0.96
const adjustedMomentum = momentum * ipConfidence; // -0.44

console.log(`  Recent change: ${momentum.toFixed(2)} K/9`);
console.log(`  IP confidence factor: ${ipConfidence.toFixed(2)}`);
console.log(`  Adjusted momentum: ${adjustedMomentum.toFixed(2)}`);

let agingAdjustment = 0.5; // Default for age 24
if (adjustedMomentum < -0.3) {
  agingAdjustment = 0.0; // Eliminate development boost for declining players
  console.log(`  ⚠️ Declining trajectory detected! Reducing aging boost: +0.5 → +0.0`);
}

const momentumStuff = 46.2 + agingAdjustment;
const momentumK9 = 2.10 + 0.074 * momentumStuff;
console.log(`  Momentum-adjusted K/9: ${momentumK9.toFixed(2)} (vs ${5.56} baseline)`);

// Alternative 3: Multi-model ensemble
console.log("\n[Alternative 3] Multi-Model Ensemble");
const optimistic = 5.56; // Current system
const neutral = 5.04;    // No aging adjustment
const pessimistic = testPlayer.yearlyStats[0].k9; // Assume no improvement from age 24

// Weight by IP confidence (more IP = trust neutral/pessimistic more)
const ipWeight = Math.min(1.0, 205 / 300); // 0.68
const optimisticWeight = 1 - ipWeight; // 0.32
const neutralWeight = ipWeight * 0.7;   // 0.48
const pessimisticWeight = ipWeight * 0.3; // 0.20

const ensemble = (optimistic * optimisticWeight + neutral * neutralWeight + pessimistic * pessimisticWeight) /
                 (optimisticWeight + neutralWeight + pessimisticWeight);

console.log(`  Optimistic (current): ${optimistic.toFixed(2)} (weight: ${optimisticWeight.toFixed(2)})`);
console.log(`  Neutral (no aging):   ${neutral.toFixed(2)} (weight: ${neutralWeight.toFixed(2)})`);
console.log(`  Pessimistic (flat):   ${pessimistic.toFixed(2)} (weight: ${pessimisticWeight.toFixed(2)})`);
console.log(`  Ensemble average:     ${ensemble.toFixed(2)}`);

console.log("\n" + "=".repeat(80));
console.log("SUMMARY");
console.log("=".repeat(80));

console.log("\nProjected K/9 for Declining Player (Age 25):");
console.log(`  Current System:           5.56 K/9 ⚠️ Career high despite decline`);
console.log(`  Alt 1 (Replacement Reg):  ${altProjectedK9.toFixed(2)} K/9`);
console.log(`  Alt 2 (Momentum Adj):     ${momentumK9.toFixed(2)} K/9`);
console.log(`  Alt 3 (Ensemble):         ${ensemble.toFixed(2)} K/9`);
console.log();

console.log("Historical Context:");
console.log(`  Age 22: 4.98 K/9`);
console.log(`  Age 23: 5.30 K/9 ★ Career high`);
console.log(`  Age 24: 4.84 K/9 ↘ Decline`);
console.log();
