/**
 * WBL Doubles/Triples Projection Validation
 *
 * Tests whether Gap/Speed-based projections produce realistic doubles/triples totals
 * by comparing projected vs actual WBL MLB stats from 2018-2020.
 *
 * This answers: "Can I trust the projected 50 doubles for WBL prospects?"
 *
 * USAGE: npx tsx tools/validate_wbl_doubles_triples.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { HitterRatingEstimatorService } from '../src/services/HitterRatingEstimatorService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Data Types
// ============================================================================

interface WBLPlayer {
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
  // Projected
  projDoubles?: number;
  projTriples?: number;
  estimatedGap?: number;
  estimatedSpeed?: number;
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
 */
function estimateGapFromDoubles(doublesPerAB: number): number {
  const gap = (doublesPerAB + 0.012627) / 0.001086;
  return Math.max(20, Math.min(80, gap));
}

/**
 * Estimate Speed rating from actual triples rate.
 * Inverse of: triplesRate = -0.001657 + 0.000083 * speed
 */
function estimateSpeedFromTriples(triplesPerAB: number): number {
  const speed = (triplesPerAB + 0.001657) / 0.000083;
  return Math.max(20, Math.min(200, speed));
}

// ============================================================================
// Data Loading
// ============================================================================

function loadWBLBattingStats(year: number, minPA: number = 300): WBLPlayer[] {
  const filePath = path.join(__dirname, '..', 'public', 'data', 'mlb_batting', `${year}_batting.csv`);

  if (!fs.existsSync(filePath)) {
    console.warn(`  File not found: ${filePath}`);
    return [];
  }

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');

  const indices = {
    player_id: headers.indexOf('player_id'),
    pa: headers.indexOf('pa'),
    ab: headers.indexOf('ab'),
    h: headers.indexOf('h'),
    d: headers.indexOf('d'),
    t: headers.indexOf('t'),
    hr: headers.indexOf('hr'),
    bb: headers.indexOf('bb'),
    k: headers.indexOf('k'),
  };

  const players: WBLPlayer[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');

    const pa = parseInt(values[indices.pa]) || 0;
    if (pa < minPA) continue;

    const ab = parseInt(values[indices.ab]) || 0;
    if (ab === 0) continue;

    const h = parseInt(values[indices.h]) || 0;
    const doubles = parseInt(values[indices.d]) || 0;
    const triples = parseInt(values[indices.t]) || 0;
    const hr = parseInt(values[indices.hr]) || 0;
    const bb = parseInt(values[indices.bb]) || 0;
    const k = parseInt(values[indices.k]) || 0;

    players.push({
      playerId: parseInt(values[indices.player_id]),
      playerName: `Player ${values[indices.player_id]}`,
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
      avg: h / ab,
    });
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
 * This tests: "If we estimate Gap/Speed from actuals, do we get accurate projections?"
 */
function projectDoublesTriples(player: WBLPlayer): {
  projDoubles: number;
  projTriples: number;
  estimatedGap: number;
  estimatedSpeed: number;
} {
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

  return { projDoubles, projTriples, estimatedGap, estimatedSpeed };
}

/**
 * Alternative: Project using league-average Gap/Speed.
 */
function projectWithAverageGapSpeed(player: WBLPlayer): { projDoubles: number; projTriples: number } {
  const gap = 50;
  const speed = 50;

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

function calculateMetrics(players: WBLPlayer[]): ValidationMetrics {
  const totalActualDoubles = players.reduce((sum, p) => sum + p.doubles, 0);
  const totalProjDoubles = players.reduce((sum, p) => sum + (p.projDoubles || 0), 0);
  const totalActualTriples = players.reduce((sum, p) => sum + p.triples, 0);
  const totalProjTriples = players.reduce((sum, p) => sum + (p.projTriples || 0), 0);

  const meanActualDoublesPerPlayer = totalActualDoubles / players.length;
  const meanProjDoublesPerPlayer = totalProjDoubles / players.length;
  const meanActualTriplesPerPlayer = totalActualTriples / players.length;
  const meanProjTriplesPerPlayer = totalProjTriples / players.length;

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
  console.log(`Total Actual:    ${metrics.totalActualDoubles.toFixed(0)}`);
  console.log(`Total Projected: ${metrics.totalProjDoubles.toFixed(0)}`);
  console.log(`Difference:      ${(metrics.totalProjDoubles - metrics.totalActualDoubles).toFixed(0)} (${((metrics.totalProjDoubles / metrics.totalActualDoubles - 1) * 100).toFixed(1)}%)`);
  console.log(`\nMean per player:`);
  console.log(`  Actual:        ${metrics.meanActualDoublesPerPlayer.toFixed(1)}`);
  console.log(`  Projected:     ${metrics.meanProjDoublesPerPlayer.toFixed(1)}`);
  console.log(`  MAE:           ${metrics.doublesMae.toFixed(1)}`);
  console.log(`  Bias:          ${metrics.doublesBias >= 0 ? '+' : ''}${metrics.doublesBias.toFixed(1)}`);

  console.log('\n--- TRIPLES ---');
  console.log(`Total Actual:    ${metrics.totalActualTriples.toFixed(0)}`);
  console.log(`Total Projected: ${metrics.totalProjTriples.toFixed(0)}`);
  console.log(`Difference:      ${(metrics.totalProjTriples - metrics.totalActualTriples).toFixed(0)} (${((metrics.totalProjTriples / metrics.totalActualTriples - 1) * 100).toFixed(1)}%)`);
  console.log(`\nMean per player:`);
  console.log(`  Actual:        ${metrics.meanActualTriplesPerPlayer.toFixed(1)}`);
  console.log(`  Projected:     ${metrics.meanProjTriplesPerPlayer.toFixed(1)}`);
  console.log(`  MAE:           ${metrics.triplesMae.toFixed(1)}`);
  console.log(`  Bias:          ${metrics.triplesBias >= 0 ? '+' : ''}${metrics.triplesBias.toFixed(1)}`);
}

function printDistributions(players: WBLPlayer[]) {
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

function printGapSpeedDistribution(players: WBLPlayer[]) {
  console.log('\n' + '='.repeat(80));
  console.log('WBL GAP/SPEED DISTRIBUTION (Estimated from Actual Rates)');
  console.log('='.repeat(80));

  const gaps = players.map(p => p.estimatedGap || 50).filter(g => g > 0);
  const speeds = players.map(p => p.estimatedSpeed || 50).filter(s => s > 0);

  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const meanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const minGap = Math.min(...gaps);
  const maxGap = Math.max(...gaps);
  const minSpeed = Math.min(...speeds);
  const maxSpeed = Math.max(...speeds);

  console.log('\nGap Ratings:');
  console.log(`  Mean:  ${meanGap.toFixed(1)}`);
  console.log(`  Min:   ${minGap.toFixed(0)}`);
  console.log(`  Max:   ${maxGap.toFixed(0)}`);

  console.log('\nSpeed Ratings:');
  console.log(`  Mean:  ${meanSpeed.toFixed(1)}`);
  console.log(`  Min:   ${minSpeed.toFixed(0)}`);
  console.log(`  Max:   ${maxSpeed.toFixed(0)}`);

  console.log('\nInterpretation:');
  console.log(`  - If mean Gap ≈ 50, our calibration matches WBL's league-average doubles rate`);
  console.log(`  - If mean Gap > 50, WBL players hit more doubles than our calibration expects`);
  console.log(`  - If mean Gap < 50, WBL players hit fewer doubles than our calibration expects`);
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('='.repeat(80));
  console.log('WBL DOUBLES/TRIPLES PROJECTION VALIDATION');
  console.log('='.repeat(80));
  console.log('\nValidating Gap/Speed-based projections against WBL MLB stats (2018-2020)\n');

  const years = [2018, 2019, 2020];
  const minPA = 300;

  console.log(`Loading WBL MLB data (${years.join(', ')}, min ${minPA} PA)...`);
  const allPlayers: WBLPlayer[] = [];

  for (const year of years) {
    const players = loadWBLBattingStats(year, minPA);
    allPlayers.push(...players);
    console.log(`  ${year}: ${players.length} players`);
  }

  console.log(`\nTotal: ${allPlayers.length} player-seasons\n`);

  if (allPlayers.length === 0) {
    console.error('❌ No data loaded. Check file paths in public/data/mlb_batting/');
    return;
  }

  // Test 1: Estimate Gap/Speed from actual rates, then project
  console.log('TEST 1: Round-trip accuracy (Estimate Gap/Speed → Project)...');
  for (const player of allPlayers) {
    const { projDoubles, projTriples, estimatedGap, estimatedSpeed } = projectDoublesTriples(player);
    player.projDoubles = projDoubles;
    player.projTriples = projTriples;
    player.estimatedGap = estimatedGap;
    player.estimatedSpeed = estimatedSpeed;
  }

  const metrics1 = calculateMetrics(allPlayers);
  printMetrics('TEST 1 RESULTS: Round-Trip Accuracy', metrics1);
  printDistributions(allPlayers);
  printGapSpeedDistribution(allPlayers);

  // Test 2: Use league-average Gap/Speed
  console.log('\n\nTEST 2: Using league-average Gap=50, Speed=50 for all players...');
  for (const player of allPlayers) {
    const { projDoubles, projTriples } = projectWithAverageGapSpeed(player);
    player.projDoubles = projDoubles;
    player.projTriples = projTriples;
  }

  const metrics2 = calculateMetrics(allPlayers);
  printMetrics('TEST 2 RESULTS: League-Average Defaults (Gap=50, Speed=50)', metrics2);

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATION FOR WBL');
  console.log('='.repeat(80));

  if (metrics1.doublesMae < 5 && metrics1.triplesMae < 2) {
    console.log('\n✅ TEST 1: Excellent round-trip accuracy');
    console.log('   → Formulas correctly capture Gap/Speed → doubles/triples relationship for WBL');
  } else if (metrics1.doublesMae < 8 && metrics1.triplesMae < 3) {
    console.log('\n✅ TEST 1: Good round-trip accuracy');
    console.log('   → Formulas are reasonably calibrated for WBL');
  } else {
    console.log('\n⚠️  TEST 1: Moderate accuracy - consider WBL-specific recalibration');
  }

  const doublesOffPct = Math.abs((metrics2.totalProjDoubles / metrics2.totalActualDoubles - 1) * 100);
  const triplesOffPct = Math.abs((metrics2.totalProjTriples / metrics2.totalActualTriples - 1) * 100);

  console.log('\n✅ TEST 2: League-average baseline');
  if (doublesOffPct < 10 && triplesOffPct < 20) {
    console.log(`   → Defaults reasonable (2B: ${doublesOffPct.toFixed(1)}% off, 3B: ${triplesOffPct.toFixed(1)}% off)`);
    console.log('   → You can trust projected totals when Gap/Speed scouting is available');
  } else {
    console.log(`   → Defaults diverge (2B: ${doublesOffPct.toFixed(1)}% off, 3B: ${triplesOffPct.toFixed(1)}% off)`);
    console.log('   → Gap/Speed visibility helpful for interpreting projections');
  }

  console.log('\n' + '='.repeat(80));
  console.log('UI RECOMMENDATION');
  console.log('='.repeat(80));
  console.log('\nBased on these results:');
  if (doublesOffPct > 10 || metrics1.doublesMae > 5) {
    console.log('⚠️  Show Gap (and AvoidK) in expanded view - ratings carry important context');
  } else {
    console.log('✅ Projections are accurate - could hide Gap, but showing in expanded view');
    console.log('   provides valuable context for trade/draft decisions');
  }
  console.log('\n' + '='.repeat(80));
  console.log();
}

main();
