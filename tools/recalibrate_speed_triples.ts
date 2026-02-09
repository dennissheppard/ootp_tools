/**
 * Speed → Triples Recalibration for WBL
 *
 * Uses OOTP game mechanic: Average runner (Speed=100) has triples:doubles ratio of 0.133
 * Calibrates Speed coefficient to match WBL actual triples data.
 *
 * USAGE: npx tsx tools/recalibrate_speed_triples.ts
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
  year: number;
  pa: number;
  ab: number;
  bb: number;
  doubles: number;
  triples: number;
  bbPct: number;
  doublesPerAB: number;
  triplesPerAB: number;
  triplesDoublesRatio: number;
  estimatedGap: number;
  estimatedSpeed?: number;
  projTriples?: number;
}

interface SpeedFormula {
  intercept: number;
  slope: number;
  label: string;
}

interface CalibrationResult {
  formula: SpeedFormula;
  totalActualTriples: number;
  totalProjTriples: number;
  mae: number;
  bias: number;
  percentError: number;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadWBLBattingStats(years: number[], minPA: number = 300): WBLPlayer[] {
  const allPlayers: WBLPlayer[] = [];

  for (const year of years) {
    const filePath = path.join(__dirname, '..', 'public', 'data', 'mlb_batting', `${year}_batting.csv`);

    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');

    const indices = {
      player_id: headers.indexOf('player_id'),
      pa: headers.indexOf('pa'),
      ab: headers.indexOf('ab'),
      bb: headers.indexOf('bb'),
      d: headers.indexOf('d'),
      t: headers.indexOf('t'),
    };

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');

      const pa = parseInt(values[indices.pa]) || 0;
      if (pa < minPA) continue;

      const ab = parseInt(values[indices.ab]) || 0;
      if (ab === 0) continue;

      const bb = parseInt(values[indices.bb]) || 0;
      const doubles = parseInt(values[indices.d]) || 0;
      const triples = parseInt(values[indices.t]) || 0;

      if (doubles === 0) continue; // Can't calculate ratio

      const doublesPerAB = doubles / ab;
      const triplesPerAB = triples / ab;

      // Estimate Gap from doubles
      const estimatedGap = Math.max(20, Math.min(80, (doublesPerAB + 0.012627) / 0.001086));

      allPlayers.push({
        playerId: parseInt(values[indices.player_id]),
        year,
        pa,
        ab,
        bb,
        doubles,
        triples,
        bbPct: (bb / pa) * 100,
        doublesPerAB,
        triplesPerAB,
        triplesDoublesRatio: triples / doubles,
        estimatedGap,
      });
    }
  }

  return allPlayers;
}

// ============================================================================
// Speed Estimation
// ============================================================================

/**
 * Estimate Speed from triples:doubles ratio.
 * Based on OOTP mechanic: Speed=100 → ratio=0.133
 */
function estimateSpeedFromRatio(triplesDoublesRatio: number, baseRatio: number = 0.133): number {
  // Scale linearly around the anchor point
  // Speed=100 at ratio=baseRatio
  // Assume Speed=200 doubles the ratio, Speed=20 reduces it to ~0

  // Linear mapping: speed = 100 * (ratio / baseRatio)
  // But constrain to 20-200 range
  const speed = 100 * (triplesDoublesRatio / baseRatio);
  return Math.max(20, Math.min(200, speed));
}

/**
 * Alternative: Estimate Speed from absolute triples rate
 */
function estimateSpeedFromTriples(triplesPerAB: number, formula: SpeedFormula): number {
  const speed = (triplesPerAB - formula.intercept) / formula.slope;
  return Math.max(20, Math.min(200, speed));
}

// ============================================================================
// Formula Testing
// ============================================================================

/**
 * Generate Speed formula candidates based on different anchor points.
 *
 * Anchor: Speed=100 should produce triplesRate that gives ratio to doubles.
 *
 * For Speed=100 runner with doublesRate D:
 *   triplesRate = D * ratio
 *   triplesRate = intercept + slope * 100
 *   D * ratio = intercept + slope * 100
 *
 * We also want Speed=20 to produce very few triples (near 0)
 *   0 ≈ intercept + slope * 20
 *   intercept ≈ -20 * slope
 *
 * Combining:
 *   D * ratio = -20 * slope + 100 * slope
 *   D * ratio = 80 * slope
 *   slope = (D * ratio) / 80
 *   intercept = -20 * slope
 */
function generateFormulaFromRatio(
  avgDoublesPerAB: number,
  triplesDoublesRatio: number
): SpeedFormula {
  // Expected triples rate for Speed=100
  const expectedTriplesAt100 = avgDoublesPerAB * triplesDoublesRatio;

  // Solve for slope assuming Speed=20 gives ~0 triples
  const slope = expectedTriplesAt100 / 80;
  const intercept = -20 * slope;

  return {
    intercept,
    slope,
    label: `Ratio=${triplesDoublesRatio.toFixed(3)}`,
  };
}

function testFormula(players: WBLPlayer[], formula: SpeedFormula): CalibrationResult {
  let totalActualTriples = 0;
  let totalProjTriples = 0;
  const errors: number[] = [];

  for (const player of players) {
    // Estimate Speed from actual triples:doubles ratio
    const estimatedSpeed = estimateSpeedFromRatio(player.triplesDoublesRatio, 0.133);

    // Project triples using formula
    const bbRate = player.bbPct / 100;
    const projTriplesPerAB = formula.intercept + formula.slope * estimatedSpeed;
    const projTriples = projTriplesPerAB * (1 - bbRate) * player.pa;

    player.estimatedSpeed = estimatedSpeed;
    player.projTriples = projTriples;

    totalActualTriples += player.triples;
    totalProjTriples += projTriples;
    errors.push(projTriples - player.triples);
  }

  const mae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / players.length;
  const bias = errors.reduce((sum, e) => sum + e, 0) / players.length;
  const percentError = ((totalProjTriples - totalActualTriples) / totalActualTriples) * 100;

  return {
    formula,
    totalActualTriples,
    totalProjTriples,
    mae,
    bias,
    percentError,
  };
}

// ============================================================================
// Optimization
// ============================================================================

function findOptimalRatio(players: WBLPlayer[], avgDoublesPerAB: number): CalibrationResult[] {
  console.log('='.repeat(80));
  console.log('TESTING DIFFERENT TRIPLES:DOUBLES RATIOS');
  console.log('='.repeat(80));
  console.log('\nOOTP baseline: 0.133 (average runner)');
  console.log('Testing ratios from 0.100 to 0.180 to find best fit for WBL\n');

  const results: CalibrationResult[] = [];

  // Test ratios from 0.100 to 0.180 in steps of 0.005
  for (let ratio = 0.100; ratio <= 0.180; ratio += 0.005) {
    const formula = generateFormulaFromRatio(avgDoublesPerAB, ratio);
    const result = testFormula(players, formula);
    results.push(result);
  }

  // Sort by absolute percent error
  results.sort((a, b) => Math.abs(a.percentError) - Math.abs(b.percentError));

  console.log('Ratio   Intercept    Slope       Total Proj  Total Actual  Error %   MAE   Bias');
  console.log('-'.repeat(90));

  for (let i = 0; i < Math.min(15, results.length); i++) {
    const r = results[i];
    const ratio = r.formula.label.replace('Ratio=', '');
    console.log(
      ratio.padEnd(8) +
      r.formula.intercept.toFixed(6).padEnd(13) +
      r.formula.slope.toFixed(6).padEnd(12) +
      r.totalProjTriples.toFixed(0).padEnd(12) +
      r.totalActualTriples.toFixed(0).padEnd(14) +
      (r.percentError >= 0 ? '+' : '') + r.percentError.toFixed(1).padEnd(10) +
      r.mae.toFixed(2).padEnd(6) +
      (r.bias >= 0 ? '+' : '') + r.bias.toFixed(2)
    );
  }

  return results;
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('='.repeat(80));
  console.log('WBL SPEED → TRIPLES RECALIBRATION');
  console.log('='.repeat(80));
  console.log('\nUsing OOTP game mechanic: Average runner (Speed=100) → triples:doubles = 0.133');
  console.log('Finding optimal ratio for WBL league\n');

  // Load WBL data
  const years = [2018, 2019, 2020];
  const minPA = 300;

  console.log(`Loading WBL MLB data (${years.join(', ')}, min ${minPA} PA)...`);
  const players = loadWBLBattingStats(years, minPA);
  console.log(`Loaded ${players.length} player-seasons\n`);

  if (players.length === 0) {
    console.error('❌ No data loaded');
    return;
  }

  // Calculate WBL statistics
  const totalDoubles = players.reduce((sum, p) => sum + p.doubles, 0);
  const totalTriples = players.reduce((sum, p) => sum + p.triples, 0);
  const avgDoublesPerPlayer = totalDoubles / players.length;
  const avgTriplesPerPlayer = totalTriples / players.length;
  const totalDoublesPerAB = players.reduce((sum, p) => sum + p.doublesPerAB, 0) / players.length;
  const actualRatio = totalTriples / totalDoubles;

  console.log('WBL League Statistics:');
  console.log(`  Total Doubles:  ${totalDoubles}`);
  console.log(`  Total Triples:  ${totalTriples}`);
  console.log(`  Avg Doubles/Player: ${avgDoublesPerPlayer.toFixed(1)}`);
  console.log(`  Avg Triples/Player: ${avgTriplesPerPlayer.toFixed(1)}`);
  console.log(`  Avg Doubles/AB: ${totalDoublesPerAB.toFixed(4)}`);
  console.log(`  Actual Triples:Doubles Ratio: ${actualRatio.toFixed(3)}`);
  console.log(`  OOTP Expected Ratio (Speed=100): 0.133`);
  console.log(`  Difference: ${((actualRatio - 0.133) / 0.133 * 100).toFixed(1)}%\n`);

  // Find optimal ratio
  const results = findOptimalRatio(players, totalDoublesPerAB);

  // Show best result
  const best = results[0];
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDED FORMULA');
  console.log('='.repeat(80));
  console.log(`\nBest triples:doubles ratio: ${best.formula.label.replace('Ratio=', '')}`);
  console.log(`\nSpeed → Triples/AB formula:`);
  console.log(`  triplesRate = ${best.formula.intercept.toFixed(6)} + ${best.formula.slope.toFixed(6)} * speed`);
  console.log(`\nAccuracy:`);
  console.log(`  Total projected: ${best.totalProjTriples.toFixed(0)} vs actual: ${best.totalActualTriples.toFixed(0)}`);
  console.log(`  Error: ${best.percentError >= 0 ? '+' : ''}${best.percentError.toFixed(1)}%`);
  console.log(`  MAE: ${best.mae.toFixed(2)} triples per player`);
  console.log(`  Bias: ${best.bias >= 0 ? '+' : ''}${best.bias.toFixed(2)}`);

  console.log(`\nUpdate in HitterRatingEstimatorService.ts (line ~135):`);
  console.log(`\n  // Speed (20-200) → Triples/AB`);
  console.log(`  // Calibrated for WBL: Speed=100 → triples:doubles ratio ≈ ${best.formula.label.replace('Ratio=', '')}`);
  console.log(`  // T/AB = ${best.formula.intercept.toFixed(6)} + ${best.formula.slope.toFixed(6)} * speed`);
  console.log(`  speed: { intercept: ${best.formula.intercept.toFixed(6)}, slope: ${best.formula.slope.toFixed(6)} },`);

  // Test at key Speed values
  console.log('\n' + '='.repeat(80));
  console.log('EXAMPLE PROJECTIONS');
  console.log('='.repeat(80));
  console.log('\nFor a player with 25 doubles per 600 AB:');
  console.log('\nSpeed   Triples/AB   Triples/600AB   3B:2B Ratio');
  console.log('-'.repeat(60));

  const testSpeeds = [20, 50, 100, 150, 200];
  const doublesAt600 = 25;
  const doublesPerAB = doublesAt600 / 600;

  for (const speed of testSpeeds) {
    const triplesPerAB = best.formula.intercept + best.formula.slope * speed;
    const triplesAt600 = triplesPerAB * 600;
    const ratio = triplesPerAB / doublesPerAB;

    console.log(
      speed.toString().padEnd(8) +
      triplesPerAB.toFixed(4).padEnd(13) +
      triplesAt600.toFixed(1).padEnd(16) +
      ratio.toFixed(3)
    );
  }

  // Compare to current formula
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON TO CURRENT FORMULA');
  console.log('='.repeat(80));

  const currentFormula: SpeedFormula = {
    intercept: 0.000250,
    slope: 0.000030,
    label: 'Current',
  };

  console.log('\nCurrent: triplesRate = 0.000250 + 0.000030 * speed');
  console.log(`New:     triplesRate = ${best.formula.intercept.toFixed(6)} + ${best.formula.slope.toFixed(6)} * speed\n`);

  console.log('Speed   Current 3B/600AB   New 3B/600AB   Difference');
  console.log('-'.repeat(60));

  for (const speed of testSpeeds) {
    const currentTriples = (currentFormula.intercept + currentFormula.slope * speed) * 600;
    const newTriples = (best.formula.intercept + best.formula.slope * speed) * 600;
    const diff = newTriples - currentTriples;

    console.log(
      speed.toString().padEnd(8) +
      currentTriples.toFixed(1).padEnd(19) +
      newTriples.toFixed(1).padEnd(15) +
      (diff >= 0 ? '+' : '') + diff.toFixed(1)
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Recalibration complete!');
  console.log('='.repeat(80));
  console.log();
}

main();
