/**
 * Gap/Speed Impact Test
 *
 * Validates the impact of adding Gap/Speed-based doubles/triples distribution
 * on True Future Ratings. Compares old fixed-constant approach vs new dynamic approach.
 *
 * USAGE: npx tsx tools/test_gap_speed_impact.ts
 */

import { HitterTrueFutureRatingService } from '../src/services/HitterTrueFutureRatingService';
import { hitterScoutingDataService } from '../src/services/HitterScoutingDataService';
import { minorLeagueStatsService } from '../src/services/MinorLeagueStatsService';
import type { HitterTrueFutureRatingInput } from '../src/services/HitterTrueFutureRatingService';

// ============================================================================
// Test Configuration
// ============================================================================

const TEST_CONFIG = {
  minAge: 16,
  maxAge: 25,
  minPA: 100,
  sampleSize: 50, // Take top N prospects by PA for focused comparison
};

// ============================================================================
// Mock Old Implementation (Fixed Constants)
// ============================================================================

class OldHitterTrueFutureRatingService extends HitterTrueFutureRatingService {
  /**
   * Old calculateWobaFromRates using fixed 65/27/8 distribution
   */
  calculateWobaFromRates(
    bbPct: number,
    _kPct: number,
    hrPct: number,
    avg: number,
    _gap?: number,  // Ignored in old version
    _speed?: number // Ignored in old version
  ): number {
    const WOBA_WEIGHTS = {
      bb: 0.69,
      single: 0.89,
      double: 1.27,
      triple: 1.62,
      hr: 2.10,
    };

    const bbRate = bbPct / 100;
    const hrRate = hrPct / 100;
    const hitRate = avg * (1 - bbRate);
    const nonHrHitRate = Math.max(0, hitRate - hrRate);

    // FIXED CONSTANTS (old approach)
    const singleRate = nonHrHitRate * 0.65;
    const doubleRate = nonHrHitRate * 0.27;
    const tripleRate = nonHrHitRate * 0.08;

    const woba =
      WOBA_WEIGHTS.bb * bbRate +
      WOBA_WEIGHTS.single * singleRate +
      WOBA_WEIGHTS.double * doubleRate +
      WOBA_WEIGHTS.triple * tripleRate +
      WOBA_WEIGHTS.hr * hrRate;

    return Math.max(0.200, Math.min(0.500, woba));
  }
}

// ============================================================================
// Data Loading
// ============================================================================

async function loadProspectData(): Promise<HitterTrueFutureRatingInput[]> {
  const scoutingData = await hitterScoutingDataService.getLatestScoutingRatings();

  // Get all minor league stats for past 5 years
  const currentYear = new Date().getFullYear();
  const allMinorStatsMap = await minorLeagueStatsService.getAllPlayerStatsBatch(currentYear - 5, currentYear);

  // Filter prospects by age and PA
  const prospects: HitterTrueFutureRatingInput[] = [];

  for (const scouting of scoutingData) {
    const age = scouting.age ?? 99;
    if (age < TEST_CONFIG.minAge || age > TEST_CONFIG.maxAge) continue;

    const playerStats = allMinorStatsMap.get(scouting.playerId) ?? [];
    const totalPa = playerStats.reduce((sum, s) => sum + s.pa, 0);

    if (totalPa < TEST_CONFIG.minPA) continue;

    prospects.push({
      playerId: scouting.playerId,
      playerName: scouting.playerName ?? `Player ${scouting.playerId}`,
      age,
      scouting,
      minorLeagueStats: playerStats,
    });
  }

  // Sort by total PA descending and take top N
  prospects.sort((a, b) => {
    const paA = a.minorLeagueStats.reduce((sum, s) => sum + s.pa, 0);
    const paB = b.minorLeagueStats.reduce((sum, s) => sum + s.pa, 0);
    return paB - paA;
  });

  return prospects.slice(0, TEST_CONFIG.sampleSize);
}

// ============================================================================
// Analysis
// ============================================================================

interface ComparisonResult {
  playerId: number;
  playerName: string;
  age: number;
  gap: number;
  speed: number;
  oldWoba: number;
  newWoba: number;
  wobaDiff: number;
  oldRank: number;
  newRank: number;
  rankChange: number;
}

async function runComparison(): Promise<ComparisonResult[]> {
  console.log('Loading prospect data...');
  const prospects = await loadProspectData();
  console.log(`Loaded ${prospects.length} prospects\n`);

  console.log('Running OLD system (fixed 65/27/8 distribution)...');
  const oldService = new OldHitterTrueFutureRatingService();
  const oldResults = await oldService.calculateTrueFutureRatings(prospects);

  console.log('Running NEW system (Gap/Speed-based distribution)...');
  const newService = new HitterTrueFutureRatingService();
  const newResults = await newService.calculateTrueFutureRatings(prospects);

  // Sort by wOBA to get rankings
  const oldSorted = [...oldResults].sort((a, b) => b.projWoba - a.projWoba);
  const newSorted = [...newResults].sort((a, b) => b.projWoba - a.projWoba);

  const oldRanks = new Map(oldSorted.map((r, idx) => [r.playerId, idx + 1]));
  const newRanks = new Map(newSorted.map((r, idx) => [r.playerId, idx + 1]));

  // Build comparison
  const comparison: ComparisonResult[] = prospects.map(p => {
    const oldResult = oldResults.find(r => r.playerId === p.playerId)!;
    const newResult = newResults.find(r => r.playerId === p.playerId)!;

    return {
      playerId: p.playerId,
      playerName: p.playerName,
      age: p.age,
      gap: p.scouting.gap ?? 50,
      speed: p.scouting.speed ?? 50,
      oldWoba: oldResult.projWoba,
      newWoba: newResult.projWoba,
      wobaDiff: newResult.projWoba - oldResult.projWoba,
      oldRank: oldRanks.get(p.playerId)!,
      newRank: newRanks.get(p.playerId)!,
      rankChange: oldRanks.get(p.playerId)! - newRanks.get(p.playerId)!,
    };
  });

  return comparison;
}

// ============================================================================
// Reporting
// ============================================================================

function printSummaryStats(results: ComparisonResult[]) {
  console.log('\n' + '='.repeat(80));
  console.log('IMPACT SUMMARY');
  console.log('='.repeat(80));

  // wOBA changes
  const wobaDiffs = results.map(r => r.wobaDiff);
  const meanWobaDiff = wobaDiffs.reduce((a, b) => a + b, 0) / wobaDiffs.length;
  const absWobaDiffs = wobaDiffs.map(d => Math.abs(d));
  const meanAbsWobaDiff = absWobaDiffs.reduce((a, b) => a + b, 0) / absWobaDiffs.length;
  const maxWobaDiff = Math.max(...wobaDiffs);
  const minWobaDiff = Math.min(...wobaDiffs);

  console.log('\nwOBA Changes:');
  console.log(`  Mean change:     ${meanWobaDiff >= 0 ? '+' : ''}${meanWobaDiff.toFixed(4)}`);
  console.log(`  Mean |change|:   ${meanAbsWobaDiff.toFixed(4)}`);
  console.log(`  Max increase:    +${maxWobaDiff.toFixed(4)}`);
  console.log(`  Max decrease:    ${minWobaDiff.toFixed(4)}`);

  // Ranking changes
  const rankChanges = results.map(r => Math.abs(r.rankChange));
  const meanRankChange = rankChanges.reduce((a, b) => a + b, 0) / rankChanges.length;
  const maxRankChange = Math.max(...rankChanges);

  console.log('\nRanking Changes:');
  console.log(`  Mean |change|:   ${meanRankChange.toFixed(1)} positions`);
  console.log(`  Max change:      ${maxRankChange} positions`);

  // Out-of-bounds check
  const outOfBounds = results.filter(r => r.newWoba < 0.200 || r.newWoba > 0.500);
  console.log(`\nOut-of-bounds wOBA: ${outOfBounds.length} / ${results.length}`);

  // Red flags
  console.log('\n' + '='.repeat(80));
  console.log('RED FLAGS');
  console.log('='.repeat(80));

  let hasRedFlags = false;

  if (Math.abs(meanWobaDiff) > 0.010) {
    console.log(`❌ Mean wOBA shift (${meanWobaDiff.toFixed(4)}) exceeds threshold (0.010)`);
    hasRedFlags = true;
  } else {
    console.log(`✅ Mean wOBA shift within threshold`);
  }

  if (outOfBounds.length > 0) {
    console.log(`❌ ${outOfBounds.length} players with out-of-bounds wOBA`);
    hasRedFlags = true;
  } else {
    console.log(`✅ All wOBA values within 0.200-0.500 bounds`);
  }

  // Check for massive ranking changes among average players (gap/speed near 50)
  const avgPlayers = results.filter(r => Math.abs(r.gap - 50) < 10 && Math.abs(r.speed - 50) < 50);
  const avgPlayersLargeChange = avgPlayers.filter(r => Math.abs(r.rankChange) > 10);

  if (avgPlayersLargeChange.length > avgPlayers.length * 0.1) {
    console.log(`❌ ${avgPlayersLargeChange.length} average players with >10 position change`);
    hasRedFlags = true;
  } else {
    console.log(`✅ Average players show stable rankings`);
  }

  if (!hasRedFlags) {
    console.log('\n✅ All validation checks passed!');
  }
}

function printTopChanges(results: ComparisonResult[], n: number = 10) {
  console.log('\n' + '='.repeat(80));
  console.log(`TOP ${n} GAINERS (New System)`);
  console.log('='.repeat(80));

  const topGainers = [...results]
    .sort((a, b) => b.wobaDiff - a.wobaDiff)
    .slice(0, n);

  console.log('Player'.padEnd(25) + 'Gap'.padEnd(6) + 'Speed'.padEnd(8) + 'Old wOBA'.padEnd(10) + 'New wOBA'.padEnd(10) + 'Δ'.padEnd(8) + 'Rank Δ');
  console.log('-'.repeat(80));

  for (const r of topGainers) {
    const name = r.playerName.substring(0, 23).padEnd(25);
    const gap = r.gap.toString().padEnd(6);
    const speed = r.speed.toString().padEnd(8);
    const oldWoba = r.oldWoba.toFixed(3).padEnd(10);
    const newWoba = r.newWoba.toFixed(3).padEnd(10);
    const diff = (r.wobaDiff >= 0 ? '+' : '') + r.wobaDiff.toFixed(4);
    const rankChange = (r.rankChange > 0 ? '+' : '') + r.rankChange.toString();

    console.log(name + gap + speed + oldWoba + newWoba + diff.padEnd(8) + rankChange);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`TOP ${n} LOSERS (New System)`);
  console.log('='.repeat(80));

  const topLosers = [...results]
    .sort((a, b) => a.wobaDiff - b.wobaDiff)
    .slice(0, n);

  console.log('Player'.padEnd(25) + 'Gap'.padEnd(6) + 'Speed'.padEnd(8) + 'Old wOBA'.padEnd(10) + 'New wOBA'.padEnd(10) + 'Δ'.padEnd(8) + 'Rank Δ');
  console.log('-'.repeat(80));

  for (const r of topLosers) {
    const name = r.playerName.substring(0, 23).padEnd(25);
    const gap = r.gap.toString().padEnd(6);
    const speed = r.speed.toString().padEnd(8);
    const oldWoba = r.oldWoba.toFixed(3).padEnd(10);
    const newWoba = r.newWoba.toFixed(3).padEnd(10);
    const diff = (r.wobaDiff >= 0 ? '+' : '') + r.wobaDiff.toFixed(4);
    const rankChange = (r.rankChange > 0 ? '+' : '') + r.rankChange.toString();

    console.log(name + gap + speed + oldWoba + newWoba + diff.padEnd(8) + rankChange);
  }
}

function printGapSpeedCorrelation(results: ComparisonResult[]) {
  console.log('\n' + '='.repeat(80));
  console.log('GAP/SPEED CORRELATION WITH WOBA CHANGE');
  console.log('='.repeat(80));

  // Calculate Pearson correlation: wobaDiff ~ gap
  const n = results.length;
  const meanGap = results.reduce((s, r) => s + r.gap, 0) / n;
  const meanWobaDiff = results.reduce((s, r) => s + r.wobaDiff, 0) / n;

  let numerator = 0;
  let denomGap = 0;
  let denomWoba = 0;

  for (const r of results) {
    numerator += (r.gap - meanGap) * (r.wobaDiff - meanWobaDiff);
    denomGap += (r.gap - meanGap) ** 2;
    denomWoba += (r.wobaDiff - meanWobaDiff) ** 2;
  }

  const corrGap = numerator / Math.sqrt(denomGap * denomWoba);

  // Calculate Pearson correlation: wobaDiff ~ speed
  const meanSpeed = results.reduce((s, r) => s + r.speed, 0) / n;

  numerator = 0;
  let denomSpeed = 0;
  denomWoba = 0;

  for (const r of results) {
    numerator += (r.speed - meanSpeed) * (r.wobaDiff - meanWobaDiff);
    denomSpeed += (r.speed - meanSpeed) ** 2;
    denomWoba += (r.wobaDiff - meanWobaDiff) ** 2;
  }

  const corrSpeed = numerator / Math.sqrt(denomSpeed * denomWoba);

  console.log(`\nGap → wOBA Δ correlation:   r = ${corrGap.toFixed(3)}`);
  console.log(`Speed → wOBA Δ correlation: r = ${corrSpeed.toFixed(3)}`);

  console.log('\nExpectation: High Gap should increase wOBA (positive r)');
  console.log('             High Speed should slightly increase wOBA (small positive r)');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('GAP/SPEED IMPACT TEST');
  console.log('='.repeat(80));
  console.log(`\nTest Configuration:`);
  console.log(`  Age range:     ${TEST_CONFIG.minAge}-${TEST_CONFIG.maxAge}`);
  console.log(`  Min PA:        ${TEST_CONFIG.minPA}`);
  console.log(`  Sample size:   ${TEST_CONFIG.sampleSize} prospects`);

  const results = await runComparison();

  printSummaryStats(results);
  printTopChanges(results);
  printGapSpeedCorrelation(results);

  console.log('\n' + '='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  console.log('\n✅ Integration test finished!\n');
}

main().catch(error => {
  console.error('Error during test:', error);
  process.exit(1);
});
