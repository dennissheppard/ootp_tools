/**
 * Stolen Base Projection Validation
 *
 * Tests whether SR/STE-based projections produce realistic SB/CS totals
 * by comparing projected vs actual MLB stats.
 *
 * Approach:
 * 1. Load hitter scouting data (SR/STE per player) from scouting CSVs
 * 2. Load MLB batting stats (SB/CS per player) from batting CSVs
 * 3. Match players by ID
 * 4. Project SB/CS using SR/STE ratings + actual PA
 * 5. Compare projections to actuals at league and individual level
 *
 * USAGE: npx tsx tools/validate_sb_projections.ts
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

interface ScoutingPlayer {
  playerId: number;
  playerName: string;
  sr: number;    // Stealing Aggressiveness (20-80)
  ste: number;   // Stealing Ability (20-80)
  speed: number; // Speed rating (20-80)
}

interface BattingPlayer {
  playerId: number;
  playerName: string;
  year: number;
  pa: number;
  ab: number;
  sb: number;
  cs: number;
  attempts: number; // sb + cs
}

interface MatchedPlayer {
  playerId: number;
  playerName: string;
  year: number;
  pa: number;
  sr: number;
  ste: number;
  speed: number;
  actualSb: number;
  actualCs: number;
  actualAttempts: number;
  actualSuccessRate: number;
  projSb: number;
  projCs: number;
  projAttempts: number;
  projSuccessRate: number;
}

// ============================================================================
// CSV Parsing
// ============================================================================

function parseScoutingCsv(filePath: string): ScoutingPlayer[] {
  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idIdx = headers.indexOf('id');
  const nameIdx = headers.indexOf('name');
  const srIdx = headers.indexOf('sr');
  const steIdx = headers.indexOf('ste');
  const speIdx = headers.indexOf('spe');

  if (idIdx === -1 || srIdx === -1 || steIdx === -1) {
    console.error('Missing required columns in scouting CSV. Headers found:', headers.join(', '));
    return [];
  }

  const players: ScoutingPlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const playerId = parseInt(values[idIdx]);
    const sr = parseInt(values[srIdx]);
    const ste = parseInt(values[steIdx]);
    const speed = speIdx !== -1 ? parseInt(values[speIdx]) : 50;

    if (isNaN(playerId) || isNaN(sr) || isNaN(ste)) continue;

    players.push({
      playerId,
      playerName: values[nameIdx]?.trim() || 'Unknown',
      sr,
      ste,
      speed,
    });
  }

  return players;
}

function parseBattingCsv(filePath: string, year: number): BattingPlayer[] {
  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const indices: Record<string, number> = {};
  headers.forEach((h, i) => indices[h] = i);

  const players: BattingPlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');

    // Only total stats (split_id = 1)
    const splitId = parseInt(values[indices['split_id']]);
    if (splitId !== 1) continue;

    // Only MLB level (level_id = 1)
    const levelId = parseInt(values[indices['level_id']]);
    if (levelId !== 1) continue;

    const pa = parseInt(values[indices['pa']]) || 0;
    const ab = parseInt(values[indices['ab']]) || 0;
    const sb = parseInt(values[indices['sb']]) || 0;
    const cs = parseInt(values[indices['cs']]) || 0;
    const playerId = parseInt(values[indices['player_id']]);

    if (isNaN(playerId) || pa === 0) continue;

    players.push({
      playerId,
      playerName: '', // Will be filled from scouting if matched
      year,
      pa,
      ab,
      sb,
      cs,
      attempts: sb + cs,
    });
  }

  return players;
}

// ============================================================================
// Matching & Projection
// ============================================================================

function matchAndProject(
  scouting: ScoutingPlayer[],
  batting: BattingPlayer[],
  minPa: number = 200
): MatchedPlayer[] {
  const scoutLookup = new Map<number, ScoutingPlayer>();
  for (const s of scouting) {
    scoutLookup.set(s.playerId, s);
  }

  const matched: MatchedPlayer[] = [];
  for (const b of batting) {
    if (b.pa < minPa) continue;

    const scout = scoutLookup.get(b.playerId);
    if (!scout) continue;

    const proj = HitterRatingEstimatorService.projectStolenBases(scout.sr, scout.ste, b.pa);
    const projAttempts = proj.sb + proj.cs;
    const actualAttempts = b.sb + b.cs;

    matched.push({
      playerId: b.playerId,
      playerName: scout.playerName,
      year: b.year,
      pa: b.pa,
      sr: scout.sr,
      ste: scout.ste,
      speed: scout.speed,
      actualSb: b.sb,
      actualCs: b.cs,
      actualAttempts,
      actualSuccessRate: actualAttempts > 0 ? b.sb / actualAttempts : 0,
      projSb: proj.sb,
      projCs: proj.cs,
      projAttempts,
      projSuccessRate: projAttempts > 0 ? proj.sb / projAttempts : 0,
    });
  }

  return matched;
}

// ============================================================================
// Analysis & Reporting
// ============================================================================

function printLeagueTotals(matched: MatchedPlayer[]) {
  const totalActualSb = matched.reduce((s, p) => s + p.actualSb, 0);
  const totalProjSb = matched.reduce((s, p) => s + p.projSb, 0);
  const totalActualCs = matched.reduce((s, p) => s + p.actualCs, 0);
  const totalProjCs = matched.reduce((s, p) => s + p.projCs, 0);
  const totalActualAttempts = matched.reduce((s, p) => s + p.actualAttempts, 0);
  const totalProjAttempts = matched.reduce((s, p) => s + p.projAttempts, 0);

  const actualLeagueSuccessRate = totalActualAttempts > 0
    ? (totalActualSb / totalActualAttempts * 100) : 0;
  const projLeagueSuccessRate = totalProjAttempts > 0
    ? (totalProjSb / totalProjAttempts * 100) : 0;

  console.log('\n' + '='.repeat(80));
  console.log('LEAGUE TOTALS');
  console.log('='.repeat(80));
  console.log(`Matched players: ${matched.length}`);
  console.log(`Mean PA: ${(matched.reduce((s, p) => s + p.pa, 0) / matched.length).toFixed(0)}`);

  console.log('\n                 Actual     Projected  Diff       Diff%');
  console.log('-'.repeat(65));
  console.log(`SB:              ${pad(totalActualSb)}${pad(totalProjSb)}${padSigned(totalProjSb - totalActualSb)}${padPct(totalProjSb, totalActualSb)}`);
  console.log(`CS:              ${pad(totalActualCs)}${pad(totalProjCs)}${padSigned(totalProjCs - totalActualCs)}${padPct(totalProjCs, totalActualCs)}`);
  console.log(`Attempts:        ${pad(totalActualAttempts)}${pad(totalProjAttempts)}${padSigned(totalProjAttempts - totalActualAttempts)}${padPct(totalProjAttempts, totalActualAttempts)}`);
  console.log(`Success Rate:    ${actualLeagueSuccessRate.toFixed(1)}%      ${projLeagueSuccessRate.toFixed(1)}%      ${(projLeagueSuccessRate - actualLeagueSuccessRate).toFixed(1)}pp`);
}

function printErrorMetrics(matched: MatchedPlayer[]) {
  const sbErrors = matched.map(p => p.projSb - p.actualSb);
  const csErrors = matched.map(p => p.projCs - p.actualCs);
  const attemptErrors = matched.map(p => p.projAttempts - p.actualAttempts);

  const sbMae = sbErrors.reduce((s, e) => s + Math.abs(e), 0) / matched.length;
  const sbBias = sbErrors.reduce((s, e) => s + e, 0) / matched.length;
  const attemptMae = attemptErrors.reduce((s, e) => s + Math.abs(e), 0) / matched.length;
  const attemptBias = attemptErrors.reduce((s, e) => s + e, 0) / matched.length;

  const sbRmse = Math.sqrt(sbErrors.reduce((s, e) => s + e * e, 0) / matched.length);

  console.log('\n' + '='.repeat(80));
  console.log('ERROR METRICS (Per Player)');
  console.log('='.repeat(80));
  console.log(`\nSB:       MAE = ${sbMae.toFixed(1)}, Bias = ${sbBias >= 0 ? '+' : ''}${sbBias.toFixed(1)}, RMSE = ${sbRmse.toFixed(1)}`);
  console.log(`Attempts: MAE = ${attemptMae.toFixed(1)}, Bias = ${attemptBias >= 0 ? '+' : ''}${attemptBias.toFixed(1)}`);

  // Mean actual for context
  const meanActualSb = matched.reduce((s, p) => s + p.actualSb, 0) / matched.length;
  const meanActualAttempts = matched.reduce((s, p) => s + p.actualAttempts, 0) / matched.length;
  console.log(`\nMean Actual SB/player: ${meanActualSb.toFixed(1)}`);
  console.log(`Mean Actual Attempts/player: ${meanActualAttempts.toFixed(1)}`);
}

function printByBucket(matched: MatchedPlayer[]) {
  console.log('\n' + '='.repeat(80));
  console.log('BY SR BUCKET (Steal Aggressiveness)');
  console.log('='.repeat(80));

  const srBuckets = [
    { label: 'SR 20-34 (Low)', min: 20, max: 34 },
    { label: 'SR 35-49 (Below Avg)', min: 35, max: 49 },
    { label: 'SR 50-64 (Avg/Above)', min: 50, max: 64 },
    { label: 'SR 65-80 (High/Elite)', min: 65, max: 80 },
  ];

  console.log('\nBucket               Count  AvgSR  ActSB  ProjSB  Bias    ActAtt ProjAtt');
  console.log('-'.repeat(80));

  for (const bucket of srBuckets) {
    const group = matched.filter(p => p.sr >= bucket.min && p.sr <= bucket.max);
    if (group.length === 0) continue;

    const avgSr = group.reduce((s, p) => s + p.sr, 0) / group.length;
    const avgActSb = group.reduce((s, p) => s + p.actualSb, 0) / group.length;
    const avgProjSb = group.reduce((s, p) => s + p.projSb, 0) / group.length;
    const avgActAtt = group.reduce((s, p) => s + p.actualAttempts, 0) / group.length;
    const avgProjAtt = group.reduce((s, p) => s + p.projAttempts, 0) / group.length;
    const bias = avgProjSb - avgActSb;

    console.log(
      bucket.label.padEnd(21) +
      group.length.toString().padEnd(7) +
      avgSr.toFixed(0).padEnd(7) +
      avgActSb.toFixed(1).padEnd(7) +
      avgProjSb.toFixed(1).padEnd(8) +
      (bias >= 0 ? '+' : '') + bias.toFixed(1).padStart(5).padEnd(8) +
      avgActAtt.toFixed(1).padEnd(7) +
      avgProjAtt.toFixed(1)
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('BY STE BUCKET (Steal Ability → Success Rate)');
  console.log('='.repeat(80));

  const steBuckets = [
    { label: 'STE 20-34 (Low)', min: 20, max: 34 },
    { label: 'STE 35-49 (Below Avg)', min: 35, max: 49 },
    { label: 'STE 50-64 (Avg/Above)', min: 50, max: 64 },
    { label: 'STE 65-80 (High/Elite)', min: 65, max: 80 },
  ];

  console.log('\nBucket               Count  AvgSTE ActSR%  ProjSR% Bias');
  console.log('-'.repeat(65));

  for (const bucket of steBuckets) {
    const group = matched.filter(p => p.ste >= bucket.min && p.ste <= bucket.max);
    // Only include players with steal attempts for success rate analysis
    const withAttempts = group.filter(p => p.actualAttempts > 0);
    if (group.length === 0) continue;

    const avgSte = group.reduce((s, p) => s + p.ste, 0) / group.length;
    const projSuccessRate = HitterRatingEstimatorService.expectedStealSuccessRate(avgSte) * 100;

    let actualSuccessRate = 0;
    if (withAttempts.length > 0) {
      const totalSb = withAttempts.reduce((s, p) => s + p.actualSb, 0);
      const totalAtt = withAttempts.reduce((s, p) => s + p.actualAttempts, 0);
      actualSuccessRate = totalAtt > 0 ? (totalSb / totalAtt) * 100 : 0;
    }

    console.log(
      bucket.label.padEnd(21) +
      group.length.toString().padEnd(7) +
      avgSte.toFixed(0).padEnd(7) +
      actualSuccessRate.toFixed(1).padEnd(8) +
      projSuccessRate.toFixed(1).padEnd(8) +
      ((projSuccessRate - actualSuccessRate) >= 0 ? '+' : '') +
      (projSuccessRate - actualSuccessRate).toFixed(1) + 'pp'
    );
  }
}

function printSbDistribution(matched: MatchedPlayer[]) {
  console.log('\n' + '='.repeat(80));
  console.log('SB DISTRIBUTION (Actual vs Projected)');
  console.log('='.repeat(80));

  const buckets = [
    { label: '0', min: 0, max: 0 },
    { label: '1-3', min: 1, max: 3 },
    { label: '4-9', min: 4, max: 9 },
    { label: '10-19', min: 10, max: 19 },
    { label: '20-29', min: 20, max: 29 },
    { label: '30+', min: 30, max: 999 },
  ];

  console.log('\nRange     Actual  Projected');
  console.log('-'.repeat(35));

  for (const bucket of buckets) {
    const actualCount = matched.filter(
      p => p.actualSb >= bucket.min && p.actualSb <= bucket.max
    ).length;
    const projCount = matched.filter(
      p => p.projSb >= bucket.min && p.projSb <= bucket.max
    ).length;

    console.log(
      bucket.label.padEnd(10) +
      actualCount.toString().padEnd(8) +
      projCount.toString().padEnd(8)
    );
  }
}

function printTopPlayers(matched: MatchedPlayer[], n: number = 15) {
  console.log('\n' + '='.repeat(80));
  console.log(`TOP ${n} SB LEADERS (Actual vs Projected)`);
  console.log('='.repeat(80));

  const sorted = [...matched].sort((a, b) => b.actualSb - a.actualSb);

  console.log(
    '\n' +
    'Player'.padEnd(22) +
    'PA'.padEnd(5) +
    'SR'.padEnd(5) +
    'STE'.padEnd(5) +
    'ActSB'.padEnd(7) +
    'PrjSB'.padEnd(7) +
    'Err'.padEnd(6) +
    'ActAtt'.padEnd(7) +
    'PrjAtt'.padEnd(7) +
    'ActSR%'.padEnd(7) +
    'PrjSR%'
  );
  console.log('-'.repeat(80));

  for (const p of sorted.slice(0, n)) {
    const err = p.projSb - p.actualSb;
    console.log(
      p.playerName.substring(0, 20).padEnd(22) +
      p.pa.toString().padEnd(5) +
      p.sr.toString().padEnd(5) +
      p.ste.toString().padEnd(5) +
      p.actualSb.toString().padEnd(7) +
      p.projSb.toString().padEnd(7) +
      ((err >= 0 ? '+' : '') + err).padEnd(6) +
      p.actualAttempts.toString().padEnd(7) +
      p.projAttempts.toString().padEnd(7) +
      (p.actualAttempts > 0 ? (p.actualSuccessRate * 100).toFixed(0) + '%' : '—').padEnd(7) +
      (p.projAttempts > 0 ? (p.projSuccessRate * 100).toFixed(0) + '%' : '—')
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`BIGGEST OVERESTIMATES`);
  console.log('='.repeat(80));

  const overestimates = [...matched].sort((a, b) => (b.projSb - b.actualSb) - (a.projSb - a.actualSb));

  console.log(
    '\n' +
    'Player'.padEnd(22) +
    'PA'.padEnd(5) +
    'SR'.padEnd(5) +
    'STE'.padEnd(5) +
    'ActSB'.padEnd(7) +
    'PrjSB'.padEnd(7) +
    'Error'
  );
  console.log('-'.repeat(60));

  for (const p of overestimates.slice(0, 10)) {
    const err = p.projSb - p.actualSb;
    console.log(
      p.playerName.substring(0, 20).padEnd(22) +
      p.pa.toString().padEnd(5) +
      p.sr.toString().padEnd(5) +
      p.ste.toString().padEnd(5) +
      p.actualSb.toString().padEnd(7) +
      p.projSb.toString().padEnd(7) +
      (err >= 0 ? '+' : '') + err
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`BIGGEST UNDERESTIMATES`);
  console.log('='.repeat(80));

  console.log(
    '\n' +
    'Player'.padEnd(22) +
    'PA'.padEnd(5) +
    'SR'.padEnd(5) +
    'STE'.padEnd(5) +
    'ActSB'.padEnd(7) +
    'PrjSB'.padEnd(7) +
    'Error'
  );
  console.log('-'.repeat(60));

  for (const p of overestimates.slice(-10).reverse()) {
    const err = p.projSb - p.actualSb;
    console.log(
      p.playerName.substring(0, 20).padEnd(22) +
      p.pa.toString().padEnd(5) +
      p.sr.toString().padEnd(5) +
      p.ste.toString().padEnd(5) +
      p.actualSb.toString().padEnd(7) +
      p.projSb.toString().padEnd(7) +
      (err >= 0 ? '+' : '') + err
    );
  }
}

function printCoefficients() {
  console.log('\n' + '='.repeat(80));
  console.log('CURRENT COEFFICIENTS');
  console.log('='.repeat(80));

  console.log('\nSR → Steal Attempts per 600 PA:');
  for (const sr of [20, 30, 40, 50, 60, 70, 80]) {
    const att = HitterRatingEstimatorService.expectedStealAttempts(sr);
    console.log(`  SR ${sr}: ${att.toFixed(1)} attempts/600PA`);
  }

  console.log('\nSTE → Steal Success Rate:');
  for (const ste of [20, 30, 40, 50, 60, 70, 80]) {
    const rate = HitterRatingEstimatorService.expectedStealSuccessRate(ste);
    console.log(`  STE ${ste}: ${(rate * 100).toFixed(1)}%`);
  }

  console.log('\nProjected SB for 600 PA at various SR/STE combos:');
  console.log('       STE20  STE35  STE50  STE65  STE80');
  for (const sr of [20, 35, 50, 65, 80]) {
    const row = `SR ${sr.toString().padEnd(3)}`;
    const cells = [20, 35, 50, 65, 80].map(ste => {
      const proj = HitterRatingEstimatorService.projectStolenBases(sr, ste, 600);
      return proj.sb.toString().padEnd(7);
    });
    console.log(`  ${row} ${cells.join('')}`);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function pad(val: number): string {
  return val.toString().padEnd(11);
}

function padSigned(val: number): string {
  return ((val >= 0 ? '+' : '') + val).padEnd(11);
}

function padPct(proj: number, actual: number): string {
  if (actual === 0) return 'N/A';
  const pct = ((proj / actual) - 1) * 100;
  return (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('STOLEN BASE PROJECTION VALIDATION');
  console.log('SR/STE Ratings → SB/CS Projection Accuracy');
  console.log('='.repeat(80));

  // Print current coefficient curves
  printCoefficients();

  // Load scouting data
  const dataDir = path.join(__dirname, '..', 'public', 'data');

  // Try multiple scouting files (prefer my, fall back to osa)
  const scoutingFiles = [
    'hitter_scouting_my_2021_06_14.csv',
    'hitter_scouting_my_2021_05_31.csv',
    'hitter_scouting_osa_2021_06_14.csv',
  ];

  let scoutingPlayers: ScoutingPlayer[] = [];
  let scoutingFile = '';
  for (const file of scoutingFiles) {
    const filePath = path.join(dataDir, file);
    if (fs.existsSync(filePath)) {
      scoutingPlayers = parseScoutingCsv(filePath);
      scoutingFile = file;
      break;
    }
  }

  if (scoutingPlayers.length === 0) {
    console.error('\nERROR: No scouting CSV found with SR/STE data.');
    console.error('Looked for:', scoutingFiles.join(', '));
    process.exit(1);
  }

  console.log(`\nLoaded scouting data: ${scoutingPlayers.length} players from ${scoutingFile}`);

  // Show SR/STE distribution in scouting data
  const srValues = scoutingPlayers.map(p => p.sr);
  const steValues = scoutingPlayers.map(p => p.ste);
  console.log(`SR  range: ${Math.min(...srValues)}-${Math.max(...srValues)}, mean=${(srValues.reduce((a, b) => a + b, 0) / srValues.length).toFixed(1)}, median=${srValues.sort((a, b) => a - b)[Math.floor(srValues.length / 2)]}`);
  console.log(`STE range: ${Math.min(...steValues)}-${Math.max(...steValues)}, mean=${(steValues.reduce((a, b) => a + b, 0) / steValues.length).toFixed(1)}, median=${steValues.sort((a, b) => a - b)[Math.floor(steValues.length / 2)]}`);

  // Load batting stats from multiple years
  const battingYears = [2020, 2021, 2019, 2018];
  let allBatting: BattingPlayer[] = [];

  for (const year of battingYears) {
    const battingPath = path.join(dataDir, 'mlb_batting', `${year}_batting.csv`);
    if (fs.existsSync(battingPath)) {
      const yearBatting = parseBattingCsv(battingPath, year);
      console.log(`Loaded ${year} batting: ${yearBatting.length} players (all PA)`);
      allBatting.push(...yearBatting);
    }
  }

  if (allBatting.length === 0) {
    console.error('\nERROR: No batting CSVs found in public/data/mlb_batting/');
    process.exit(1);
  }

  // Test with different minimum PA thresholds
  const minPaValues = [200, 300, 100];

  for (const minPa of minPaValues) {
    console.log('\n\n');
    console.log('#'.repeat(80));
    console.log(`# VALIDATION WITH MIN PA = ${minPa}`);
    console.log('#'.repeat(80));

    // Test each year individually
    for (const year of battingYears) {
      const yearBatting = allBatting.filter(b => b.year === year);
      const matched = matchAndProject(scoutingPlayers, yearBatting, minPa);

      if (matched.length < 10) {
        console.log(`\n--- ${year}: Only ${matched.length} matched players (skipping) ---`);
        continue;
      }

      console.log(`\n${'*'.repeat(80)}`);
      console.log(`* YEAR ${year} (min ${minPa} PA)`);
      console.log(`${'*'.repeat(80)}`);

      printLeagueTotals(matched);
      printErrorMetrics(matched);
      printByBucket(matched);
      printSbDistribution(matched);
      printTopPlayers(matched);
    }

    // Combined multi-year analysis
    const allMatched = matchAndProject(scoutingPlayers, allBatting, minPa);
    if (allMatched.length >= 20) {
      console.log(`\n${'*'.repeat(80)}`);
      console.log(`* ALL YEARS COMBINED (${battingYears.join(', ')}, min ${minPa} PA)`);
      console.log(`${'*'.repeat(80)}`);

      printLeagueTotals(allMatched);
      printErrorMetrics(allMatched);
      printByBucket(allMatched);
      printSbDistribution(allMatched);
    }
  }

  // Final summary
  console.log('\n\n' + '='.repeat(80));
  console.log('INTERPRETATION GUIDE');
  console.log('='.repeat(80));
  console.log(`
KEY METRICS TO CHECK:
  1. League Total SB Diff% should be within ±20%
     → If too high: SR slope is too steep (reduce 0.4833)
     → If too low: SR slope is too flat (increase 0.4833)

  2. League Success Rate should be within ±5pp of actual
     → If too high: STE intercept is too high (reduce 0.4333)
     → If too low: STE intercept is too low (increase 0.4333)

  3. SR bucket bias should be consistent across buckets
     → If low-SR over-projects: intercept too high (more negative)
     → If high-SR under-projects: slope too low
     → Non-linear pattern may need piecewise coefficients

  4. SB Distribution shape should match
     → Too many 0s in projected: slope too flat
     → Not enough 0s: intercept too high

  5. Top player accuracy matters most for UI
     → SB leaders (20+) should project within ±5
     → Low-SB players (0-3) are less important

NOTE: Scouting ratings are from mid-2021, so 2020 data is the best comparison
(closest in time). Older years may show drift as rosters change.
`);
}

main().catch(error => {
  console.error('Error during validation:', error);
  process.exit(1);
});
