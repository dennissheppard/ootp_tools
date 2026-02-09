/**
 * Doubles/Triples Projection Validation
 *
 * Tests whether Gap/Speed-based projections produce realistic doubles/triples totals
 * by comparing projected vs actual MLB stats from 2018-present.
 *
 * This helps answer: "Can I trust the projected 50 doubles, or do I need to see Gap rating?"
 *
 * USAGE: npx tsx tools/validate_doubles_triples_projections.ts
 */

import { HitterRatingEstimatorService } from '../src/services/HitterRatingEstimatorService';

const API_BASE = 'https://atl-01.statsplus.net/world/api';

// ============================================================================
// Data Types
// ============================================================================

interface MLBPlayer {
  playerId: number;
  playerName: string;
  year: number;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  bb: number;
  k: number;
  // Derived stats
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
  // Projected (from our system)
  projDoubles?: number;
  projTriples?: number;
}

interface ValidationMetrics {
  totalActualDoubles: number;
  totalProjDoubles: number;
  totalActualTriples: number;
  totalProjTriples: number;
  meanActualDoublesPerPlayer: number;
  meanProjDoublesPerPlayer: number;
  meanActualTriplesPerPlayer: number;
  meanProjTriplesPerPlayer: number;
  doublesMae: number;
  doublesBias: number;
  triplesMae: number;
  triplesBias: number;
  playerCount: number;
}

// ============================================================================
// Gap/Speed Estimation
// ============================================================================

/**
 * Estimate Gap rating from actual doubles rate.
 * Inverse of: doublesRate = -0.012627 + 0.001086 * gap
 * gap = (doublesRate + 0.012627) / 0.001086
 */
function estimateGapFromDoubles(doublesPerAB: number): number {
  const gap = (doublesPerAB + 0.012627) / 0.001086;
  return Math.max(20, Math.min(80, gap));
}

/**
 * Estimate Speed rating from actual triples rate.
 * Inverse of: triplesRate = 0.000250 + 0.000030 * speed
 * speed = (triplesRate - 0.000250) / 0.000030
 */
function estimateSpeedFromTriples(triplesPerAB: number): number {
  const speed = (triplesPerAB - 0.000250) / 0.000030;
  return Math.max(20, Math.min(200, speed));
}

// ============================================================================
// Data Loading
// ============================================================================

async function fetchMLBBattingStats(
  startYear: number,
  endYear: number,
  minPA: number = 300
): Promise<MLBPlayer[]> {
  const players: MLBPlayer[] = [];

  for (let year = startYear; year <= endYear; year++) {
    console.log(`  Fetching ${year} MLB data...`);

    const url = `${API_BASE}/playerbatstatsv2/?year=${year}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`  Failed to fetch ${year}, skipping`);
      continue;
    }

    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');

    const indices = {
      player_id: headers.indexOf('player_id'),
      player_name: headers.indexOf('player_name'),
      split_id: headers.indexOf('split_id'),
      pa: headers.indexOf('pa'),
      ab: headers.indexOf('ab'),
      h: headers.indexOf('h'),
      d: headers.indexOf('d'),
      t: headers.indexOf('t'),
      hr: headers.indexOf('hr'),
      bb: headers.indexOf('bb'),
      k: headers.indexOf('k'),
    };

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const splitId = parseInt(values[indices.split_id]);
      if (splitId !== 1) continue; // Total stats only

      const pa = parseInt(values[indices.pa]) || 0;
      if (pa < minPA) continue;

      const ab = parseInt(values[indices.ab]) || 0;
      const h = parseInt(values[indices.h]) || 0;
      const doubles = parseInt(values[indices.d]) || 0;
      const triples = parseInt(values[indices.t]) || 0;
      const hr = parseInt(values[indices.hr]) || 0;
      const bb = parseInt(values[indices.bb]) || 0;
      const k = parseInt(values[indices.k]) || 0;

      players.push({
        playerId: parseInt(values[indices.player_id]),
        playerName: values[indices.player_name] || 'Unknown',
        year,
        pa,
        ab,
        h,
        doubles,
        triples,
        hr,
        bb,
        k,
        bbPct: (bb / pa) * 100,
        kPct: (k / pa) * 100,
        hrPct: (hr / pa) * 100,
        avg: ab > 0 ? h / ab : 0,
      });
    }
  }

  return players;
}

// ============================================================================
// Projection Logic
// ============================================================================

/**
 * Project doubles and triples using our Gap/Speed system.
 *
 * Strategy:
 * 1. Estimate Gap from actual doubles rate
 * 2. Estimate Speed from actual triples rate
 * 3. Use our projection formulas to project doubles/triples
 *
 * This tests: "If we know a player's rates and estimate their Gap/Speed,
 * do we project realistic doubles/triples totals?"
 */
function projectDoublesTriples(player: MLBPlayer): { projDoubles: number; projTriples: number } {
  // Estimate Gap and Speed from actual rates
  const doublesPerAB = player.doubles / player.ab;
  const triplesPerAB = player.triples / player.ab;

  const estimatedGap = estimateGapFromDoubles(doublesPerAB);
  const estimatedSpeed = estimateSpeedFromTriples(triplesPerAB);

  // Project using our formulas
  const bbRate = player.bbPct / 100;
  const projDoublesPerAB = HitterRatingEstimatorService.expectedDoublesRate(estimatedGap);
  const projTriplesPerAB = HitterRatingEstimatorService.expectedTriplesRate(estimatedSpeed);

  // Convert to PA basis and scale to actual PA
  const projDoubles = projDoublesPerAB * (1 - bbRate) * player.pa;
  const projTriples = projTriplesPerAB * (1 - bbRate) * player.pa;

  return { projDoubles, projTriples };
}

/**
 * Alternative: Project using league-average Gap/Speed to test if defaults are reasonable.
 */
function projectWithAverageGapSpeed(player: MLBPlayer): { projDoubles: number; projTriples: number } {
  const gap = 50;  // League average
  const speed = 50; // League average

  const bbRate = player.bbPct / 100;
  const projDoublesPerAB = HitterRatingEstimatorService.expectedDoublesRate(gap);
  const projTriplesPerAB = HitterRatingEstimatorService.expectedTriplesRate(speed);

  const projDoubles = projDoublesPerAB * (1 - bbRate) * player.pa;
  const projTriples = projTriplesPerAB * (1 - bbRate) * player.pa;

  return { projDoubles, projTriples };
}

// ============================================================================
// Validation
// ============================================================================

function calculateMetrics(players: MLBPlayer[]): ValidationMetrics {
  const totalActualDoubles = players.reduce((sum, p) => sum + p.doubles, 0);
  const totalProjDoubles = players.reduce((sum, p) => sum + (p.projDoubles || 0), 0);
  const totalActualTriples = players.reduce((sum, p) => sum + p.triples, 0);
  const totalProjTriples = players.reduce((sum, p) => sum + (p.projTriples || 0), 0);

  const meanActualDoublesPerPlayer = totalActualDoubles / players.length;
  const meanProjDoublesPerPlayer = totalProjDoubles / players.length;
  const meanActualTriplesPerPlayer = totalActualTriples / players.length;
  const meanProjTriplesPerPlayer = totalProjTriples / players.length;

  // Calculate MAE and bias
  const doublesErrors = players.map(p => (p.projDoubles || 0) - p.doubles);
  const triplesErrors = players.map(p => (p.projTriples || 0) - p.triples);

  const doublesMae = doublesErrors.reduce((sum, e) => sum + Math.abs(e), 0) / players.length;
  const triplesMae = triplesErrors.reduce((sum, e) => sum + Math.abs(e), 0) / players.length;
  const doublesBias = doublesErrors.reduce((sum, e) => sum + e, 0) / players.length;
  const triplesBias = triplesErrors.reduce((sum, e) => sum + e, 0) / players.length;

  return {
    totalActualDoubles,
    totalProjDoubles,
    totalActualTriples,
    totalProjTriples,
    meanActualDoublesPerPlayer,
    meanProjDoublesPerPlayer,
    meanActualTriplesPerPlayer,
    meanProjTriplesPerPlayer,
    doublesMae,
    doublesBias,
    triplesMae,
    triplesBias,
    playerCount: players.length,
  };
}

function printMetrics(label: string, metrics: ValidationMetrics) {
  console.log('\n' + '='.repeat(80));
  console.log(label);
  console.log('='.repeat(80));

  console.log(`\nPlayers analyzed: ${metrics.playerCount}`);

  console.log('\n--- DOUBLES ---');
  console.log(`Total Actual:  ${metrics.totalActualDoubles.toFixed(0)}`);
  console.log(`Total Projected: ${metrics.totalProjDoubles.toFixed(0)}`);
  console.log(`Difference:    ${(metrics.totalProjDoubles - metrics.totalActualDoubles).toFixed(0)} (${((metrics.totalProjDoubles / metrics.totalActualDoubles - 1) * 100).toFixed(1)}%)`);
  console.log(`\nMean per player:`);
  console.log(`  Actual:      ${metrics.meanActualDoublesPerPlayer.toFixed(1)}`);
  console.log(`  Projected:   ${metrics.meanProjDoublesPerPlayer.toFixed(1)}`);
  console.log(`  MAE:         ${metrics.doublesMae.toFixed(1)}`);
  console.log(`  Bias:        ${metrics.doublesBias >= 0 ? '+' : ''}${metrics.doublesBias.toFixed(1)}`);

  console.log('\n--- TRIPLES ---');
  console.log(`Total Actual:  ${metrics.totalActualTriples.toFixed(0)}`);
  console.log(`Total Projected: ${metrics.totalProjTriples.toFixed(0)}`);
  console.log(`Difference:    ${(metrics.totalProjTriples - metrics.totalActualTriples).toFixed(0)} (${((metrics.totalProjTriples / metrics.totalActualTriples - 1) * 100).toFixed(1)}%)`);
  console.log(`\nMean per player:`);
  console.log(`  Actual:      ${metrics.meanActualTriplesPerPlayer.toFixed(1)}`);
  console.log(`  Projected:   ${metrics.meanProjTriplesPerPlayer.toFixed(1)}`);
  console.log(`  MAE:         ${metrics.triplesMae.toFixed(1)}`);
  console.log(`  Bias:        ${metrics.triplesBias >= 0 ? '+' : ''}${metrics.triplesBias.toFixed(1)}`);
}

function printDistributions(players: MLBPlayer[]) {
  console.log('\n' + '='.repeat(80));
  console.log('DOUBLES DISTRIBUTION (Actual vs Projected)');
  console.log('='.repeat(80));

  const buckets = [
    { label: '0-9', min: 0, max: 9 },
    { label: '10-19', min: 10, max: 19 },
    { label: '20-29', min: 20, max: 29 },
    { label: '30-39', min: 30, max: 39 },
    { label: '40-49', min: 40, max: 49 },
    { label: '50+', min: 50, max: 999 },
  ];

  console.log('\nRange     Actual  Projected');
  console.log('-'.repeat(40));

  for (const bucket of buckets) {
    const actualCount = players.filter(
      p => p.doubles >= bucket.min && p.doubles <= bucket.max
    ).length;
    const projCount = players.filter(
      p => (p.projDoubles || 0) >= bucket.min && (p.projDoubles || 0) <= bucket.max
    ).length;

    console.log(
      bucket.label.padEnd(10) +
      actualCount.toString().padEnd(8) +
      projCount.toString().padEnd(8)
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('TRIPLES DISTRIBUTION (Actual vs Projected)');
  console.log('='.repeat(80));

  const triplesBuckets = [
    { label: '0', min: 0, max: 0 },
    { label: '1-2', min: 1, max: 2 },
    { label: '3-4', min: 3, max: 4 },
    { label: '5-6', min: 5, max: 6 },
    { label: '7-9', min: 7, max: 9 },
    { label: '10+', min: 10, max: 999 },
  ];

  console.log('\nRange     Actual  Projected');
  console.log('-'.repeat(40));

  for (const bucket of triplesBuckets) {
    const actualCount = players.filter(
      p => p.triples >= bucket.min && p.triples <= bucket.max
    ).length;
    const projCount = players.filter(
      p => (p.projTriples || 0) >= bucket.min && (p.projTriples || 0) <= bucket.max
    ).length;

    console.log(
      bucket.label.padEnd(10) +
      actualCount.toString().padEnd(8) +
      projCount.toString().padEnd(8)
    );
  }
}

function printTopErrors(players: MLBPlayer[], n: number = 10) {
  console.log('\n' + '='.repeat(80));
  console.log(`TOP ${n} DOUBLES OVERESTIMATES`);
  console.log('='.repeat(80));

  const sortedByDoublesError = [...players].sort(
    (a, b) => ((b.projDoubles || 0) - b.doubles) - ((a.projDoubles || 0) - a.doubles)
  );

  console.log('\nPlayer'.padEnd(25) + 'Year'.padEnd(6) + 'Actual'.padEnd(8) + 'Proj'.padEnd(8) + 'Error');
  console.log('-'.repeat(80));

  for (const p of sortedByDoublesError.slice(0, n)) {
    const error = (p.projDoubles || 0) - p.doubles;
    console.log(
      p.playerName.substring(0, 23).padEnd(25) +
      p.year.toString().padEnd(6) +
      p.doubles.toString().padEnd(8) +
      (p.projDoubles || 0).toFixed(0).padEnd(8) +
      (error >= 0 ? '+' : '') + error.toFixed(0)
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`TOP ${n} DOUBLES UNDERESTIMATES`);
  console.log('='.repeat(80));

  console.log('\nPlayer'.padEnd(25) + 'Year'.padEnd(6) + 'Actual'.padEnd(8) + 'Proj'.padEnd(8) + 'Error');
  console.log('-'.repeat(80));

  for (const p of sortedByDoublesError.slice(-n).reverse()) {
    const error = (p.projDoubles || 0) - p.doubles;
    console.log(
      p.playerName.substring(0, 23).padEnd(25) +
      p.year.toString().padEnd(6) +
      p.doubles.toString().padEnd(8) +
      (p.projDoubles || 0).toFixed(0).padEnd(8) +
      (error >= 0 ? '+' : '') + error.toFixed(0)
    );
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('DOUBLES/TRIPLES PROJECTION VALIDATION');
  console.log('='.repeat(80));
  console.log('\nThis test validates whether Gap/Speed-based projections produce');
  console.log('realistic doubles and triples totals compared to actual MLB stats.\n');

  const startYear = 2018;
  const endYear = 2024;
  const minPA = 300;

  console.log(`Loading MLB data (${startYear}-${endYear}, min ${minPA} PA)...`);
  const players = await fetchMLBBattingStats(startYear, endYear, minPA);
  console.log(`  Loaded ${players.length} player-seasons\n`);

  // Test 1: Estimate Gap/Speed from actual rates, then project
  console.log('TEST 1: Estimating Gap/Speed from actual rates, then projecting...');
  for (const player of players) {
    const { projDoubles, projTriples } = projectDoublesTriples(player);
    player.projDoubles = projDoubles;
    player.projTriples = projTriples;
  }

  const metrics1 = calculateMetrics(players);
  printMetrics('TEST 1 RESULTS: Estimated Gap/Speed from Actuals', metrics1);
  printDistributions(players);
  printTopErrors(players);

  // Test 2: Use league-average Gap/Speed (50/50) for everyone
  console.log('\n\nTEST 2: Using league-average Gap=50, Speed=50 for all players...');
  for (const player of players) {
    const { projDoubles, projTriples } = projectWithAverageGapSpeed(player);
    player.projDoubles = projDoubles;
    player.projTriples = projTriples;
  }

  const metrics2 = calculateMetrics(players);
  printMetrics('TEST 2 RESULTS: League-Average Gap/Speed (50/50)', metrics2);

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('INTERPRETATION');
  console.log('='.repeat(80));
  console.log('\nTEST 1 (Estimated Gap/Speed):');
  console.log('  - This tests the "round-trip" accuracy of our formulas');
  console.log('  - If MAE is low, our formulas correctly capture the Gap/Speed → 2B/3B relationship');
  console.log('  - This is a best-case scenario (we know the true Gap/Speed)');

  console.log('\nTEST 2 (Average Gap/Speed):');
  console.log('  - This tests what happens when we use default Gap=50, Speed=50');
  console.log('  - If totals are close to actual, league-average assumptions are reasonable');
  console.log('  - This represents prospects where we don\'t have reliable scouting');

  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATION');
  console.log('='.repeat(80));

  if (metrics1.doublesMae < 5 && metrics1.triplesMae < 2) {
    console.log('\n✅ TEST 1: Excellent accuracy - formulas are well-calibrated');
  } else if (metrics1.doublesMae < 8 && metrics1.triplesMae < 3) {
    console.log('\n✅ TEST 1: Good accuracy - formulas are reasonably calibrated');
  } else {
    console.log('\n⚠️  TEST 1: Moderate accuracy - consider recalibration');
  }

  const doublesOffPct = Math.abs((metrics2.totalProjDoubles / metrics2.totalActualDoubles - 1) * 100);
  const triplesOffPct = Math.abs((metrics2.totalProjTriples / metrics2.totalActualTriples - 1) * 100);

  if (doublesOffPct < 10 && triplesOffPct < 20) {
    console.log('✅ TEST 2: League totals close - you can trust projected totals');
    console.log('           → Gap/Speed ratings may not need to be visible in UI');
  } else {
    console.log('⚠️  TEST 2: League totals diverge - Gap/Speed visibility may be helpful');
    console.log('           → Consider showing Gap in expanded view for context');
  }

  console.log('\n' + '='.repeat(80));
  console.log();
}

main().catch(error => {
  console.error('Error during validation:', error);
  process.exit(1);
});
