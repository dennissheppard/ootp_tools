#!/usr/bin/env npx tsx
/**
 * Pitcher WAR Projection Investigation Tool
 *
 * Compares actual 2018-2020 pitcher performance against what the projection
 * system would produce, isolating the gap between projected and actual WAR.
 *
 * Steps:
 * 1. Load actual stats for top pitchers (2018-2020)
 * 2. Calculate formula WAR from actual stats → compare to game WAR
 * 3. Load scouting data → simulate projection pipeline
 * 4. Isolate FIP vs IP contribution to WAR gap
 * 5. Show distribution analysis
 *
 * Usage:
 *   npx tsx tools/investigate-pitcher-war.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ============================================================================
// Constants (matching service files)
// ============================================================================

const FIP_CONSTANT = 3.47;
const REPLACEMENT_FIP = 5.20;
const RUNS_PER_WIN = 8.50;

// Rating→Rate formulas (from PotentialStatsService)
const RATING_FORMULAS = {
  k9:  { intercept: 2.10, slope: 0.074 },
  bb9: { intercept: 5.30, slope: -0.052 },
  hr9: { intercept: 2.18, slope: -0.024 },
};

// Aging modifiers (from AgingService)
function getAgingModifiers(age: number): { stuff: number; control: number; hra: number } {
  if (age < 22) return { stuff: 2.0, control: 3.0, hra: 1.5 };
  if (age < 25) return { stuff: 0.5, control: 1.5, hra: 0.5 };
  if (age < 28) return { stuff: 0, control: 0.5, hra: 0 };
  if (age < 32) return { stuff: -1.5, control: -1.0, hra: -0.5 };
  if (age < 35) return { stuff: -1.5, control: -1.0, hra: -1.0 };
  if (age < 39) return { stuff: -3.0, control: -2.0, hra: -2.0 };
  return { stuff: -6.0, control: -4.0, hra: -4.0 };
}

// Ensemble weights (from EnsembleProjectionService)
const ENSEMBLE = {
  optimistic: 0.35,   // Full aging
  neutral: 0.55,      // 20% aging
  pessimistic: 0.10,  // Trend-based (use neutral for no-trend case)
};

// ============================================================================
// CSV Parsing
// ============================================================================

function parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));
  return { headers, rows };
}

function parseIp(ipStr: string): number {
  const val = parseFloat(ipStr);
  const whole = Math.floor(val);
  const fraction = Math.round((val - whole) * 10);
  return whole + fraction / 3;
}

// ============================================================================
// Data Types
// ============================================================================

interface PitcherStats {
  playerId: number;
  year: number;
  teamId: number;
  ip: number;
  k: number;
  bb: number;
  hr: number;
  gs: number;
  gameWar: number;
  // Computed
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
  formulaWar: number;
}

interface ScoutingData {
  playerId: number;
  name: string;
  stuff: number;
  control: number;
  hra: number;
  stamina: number;
  injury: string;
  dob: string;
  pitchCount: number;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadPitcherStats(year: number, minIp: number = 50): PitcherStats[] {
  const filePath = path.join(DATA_DIR, 'mlb', `${year}.csv`);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return [];
  }

  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    player_id: headers.indexOf('player_id'),
    year: headers.indexOf('year'),
    team_id: headers.indexOf('team_id'),
    split_id: headers.indexOf('split_id'),
    ip: headers.indexOf('ip'),
    k: headers.indexOf('k'),
    bb: headers.indexOf('bb'),
    hra: headers.indexOf('hra'),
    gs: headers.indexOf('gs'),
    war: headers.indexOf('war'),
  };

  const results: PitcherStats[] = [];
  for (const row of rows) {
    if (parseInt(row[idx.split_id]) !== 1) continue;
    const ip = parseIp(row[idx.ip] || '0');
    if (ip < minIp) continue;

    const k = parseInt(row[idx.k]) || 0;
    const bb = parseInt(row[idx.bb]) || 0;
    const hr = parseInt(row[idx.hra]) || 0;
    const k9 = (k / ip) * 9;
    const bb9 = (bb / ip) * 9;
    const hr9 = (hr / ip) * 9;
    const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;
    const formulaWar = ((REPLACEMENT_FIP - fip) / RUNS_PER_WIN) * (ip / 9);

    results.push({
      playerId: parseInt(row[idx.player_id]),
      year: parseInt(row[idx.year]),
      teamId: parseInt(row[idx.team_id]),
      ip,
      k,
      bb,
      hr,
      gs: parseInt(row[idx.gs]) || 0,
      gameWar: parseFloat(row[idx.war]) || 0,
      k9: Math.round(k9 * 100) / 100,
      bb9: Math.round(bb9 * 100) / 100,
      hr9: Math.round(hr9 * 100) / 100,
      fip: Math.round(fip * 100) / 100,
      formulaWar: Math.round(formulaWar * 10) / 10,
    });
  }
  return results;
}

function loadScoutingData(): Map<number, ScoutingData> {
  // Try OSA scouting first, then My Scout
  const files = [
    'default_osa_scouting.csv',
    'pitcher_scouting_osa_2021_07_05.csv',
    'pitcher_scouting_my_2021_07_05.csv',
  ];

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) continue;

    const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));

    // Try to map column names
    const idIdx = headers.indexOf('ID') !== -1 ? headers.indexOf('ID') : headers.indexOf('player_id');
    const nameIdx = headers.indexOf('Name') !== -1 ? headers.indexOf('Name') : headers.indexOf('name');
    const stuffIdx = headers.indexOf('STU P') !== -1 ? headers.indexOf('STU P') : headers.indexOf('stuff');
    const controlIdx = headers.indexOf('CON P') !== -1 ? headers.indexOf('CON P') : headers.indexOf('control');
    const hraIdx = headers.indexOf('HRR P') !== -1 ? headers.indexOf('HRR P') : headers.indexOf('hra');
    const stamIdx = headers.indexOf('STM') !== -1 ? headers.indexOf('STM') : headers.indexOf('stamina');
    const injuryIdx = headers.indexOf('Prone') !== -1 ? headers.indexOf('Prone') : headers.indexOf('injury');
    const dobIdx = headers.indexOf('DOB') !== -1 ? headers.indexOf('DOB') : -1;

    // Count pitch columns
    const pitchCols = ['FBP', 'CHP', 'CBP', 'SLP', 'SIP', 'SPP', 'CTP', 'FOP', 'CCP', 'SCP', 'KCP', 'KNP'];
    const pitchIndices = pitchCols.map(c => headers.indexOf(c)).filter(i => i !== -1);

    if (idIdx === -1 || stuffIdx === -1) continue;

    const map = new Map<number, ScoutingData>();
    for (const row of rows) {
      const id = parseInt(row[idIdx]);
      if (isNaN(id) || id <= 0) continue;

      const stuff = parseInt(row[stuffIdx]) || 0;
      const control = controlIdx >= 0 ? (parseInt(row[controlIdx]) || 0) : 50;
      const hra = hraIdx >= 0 ? (parseInt(row[hraIdx]) || 0) : 50;
      const stamina = stamIdx >= 0 ? (parseInt(row[stamIdx]) || 50) : 50;
      const injury = injuryIdx >= 0 ? row[injuryIdx] : 'Normal';
      const dob = dobIdx >= 0 ? row[dobIdx] : '';
      const name = nameIdx >= 0 ? row[nameIdx] : `Player ${id}`;

      // Count pitches (non-dash, non-zero)
      let pitchCount = 0;
      for (const pi of pitchIndices) {
        const val = row[pi];
        if (val && val !== '-' && val !== '0' && parseInt(val) > 0) {
          pitchCount++;
        }
      }

      if (stuff > 0) {
        map.set(id, { playerId: id, name, stuff, control, hra, stamina, injury, dob, pitchCount });
      }
    }

    if (map.size > 0) {
      console.log(`Loaded ${map.size} scouting records from ${file}`);
      return map;
    }
  }

  console.log('No scouting data found');
  return new Map();
}

// ============================================================================
// Analysis Functions
// ============================================================================

function ratingToK9(stuff: number): number {
  return Math.max(0, Math.min(15, RATING_FORMULAS.k9.intercept + RATING_FORMULAS.k9.slope * stuff));
}

function ratingToBb9(control: number): number {
  return Math.max(0, Math.min(10, RATING_FORMULAS.bb9.intercept + RATING_FORMULAS.bb9.slope * control));
}

function ratingToHr9(hra: number): number {
  return Math.max(0, Math.min(3, RATING_FORMULAS.hr9.intercept + RATING_FORMULAS.hr9.slope * hra));
}

function calculateFip(k9: number, bb9: number, hr9: number): number {
  return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;
}

function calculateWar(fip: number, ip: number): number {
  return ((REPLACEMENT_FIP - fip) / RUNS_PER_WIN) * (ip / 9);
}

/** Back-calculate rating from observed rate */
function k9ToRating(k9: number): number {
  return (k9 - RATING_FORMULAS.k9.intercept) / RATING_FORMULAS.k9.slope;
}
function bb9ToRating(bb9: number): number {
  return (bb9 - RATING_FORMULAS.bb9.intercept) / RATING_FORMULAS.bb9.slope;
}
function hr9ToRating(hr9: number): number {
  return (hr9 - RATING_FORMULAS.hr9.intercept) / RATING_FORMULAS.hr9.slope;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

// Age calculation from DOB string like "03/28/1987" and reference year
function calculateAge(dob: string, year: number): number {
  const parts = dob.split('/');
  if (parts.length !== 3) return 27; // default
  const birthYear = parseInt(parts[2]);
  return year - birthYear;
}

/** Simulate the projection pipeline for a single pitcher */
function simulateProjection(
  scouting: ScoutingData,
  age: number,
  historicalIp?: number
): { projK9: number; projBb9: number; projHr9: number; projFip: number; projIp: number; projWar: number } {
  // Step 1: Convert ratings to rates (current ability)
  const baseK9 = ratingToK9(scouting.stuff);
  const baseBb9 = ratingToBb9(scouting.control);
  const baseHr9 = ratingToHr9(scouting.hra);

  // Step 2: Ensemble projection
  // Optimistic: full aging curve
  const ageMods = getAgingModifiers(age);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));

  const optStuff = clamp(scouting.stuff + ageMods.stuff);
  const optControl = clamp(scouting.control + ageMods.control);
  const optHra = clamp(scouting.hra + ageMods.hra);
  const optK9 = ratingToK9(optStuff);
  const optBb9 = ratingToBb9(optControl);
  const optHr9 = ratingToHr9(optHra);

  // Neutral: 20% aging
  const clamp20_80 = (v: number) => Math.max(20, Math.min(80, v));
  const neuStuff = clamp20_80(scouting.stuff + ageMods.stuff * 0.2);
  const neuControl = clamp20_80(scouting.control + ageMods.control * 0.2);
  const neuHra = clamp20_80(scouting.hra + ageMods.hra * 0.2);
  const neuK9 = ratingToK9(neuStuff);
  const neuBb9 = ratingToBb9(neuControl);
  const neuHr9 = ratingToHr9(neuHra);

  // Pessimistic: falls back to neutral when no trend data
  const pesK9 = neuK9;
  const pesBb9 = neuBb9;
  const pesHr9 = neuHr9;

  // Blend (using base ensemble weights — real system adjusts dynamically)
  const projK9 = optK9 * ENSEMBLE.optimistic + neuK9 * ENSEMBLE.neutral + pesK9 * ENSEMBLE.pessimistic;
  const projBb9 = optBb9 * ENSEMBLE.optimistic + neuBb9 * ENSEMBLE.neutral + pesBb9 * ENSEMBLE.pessimistic;
  const projHr9 = optHr9 * ENSEMBLE.optimistic + neuHr9 * ENSEMBLE.neutral + pesHr9 * ENSEMBLE.pessimistic;

  const projFip = calculateFip(projK9, projBb9, projHr9);

  // Step 3: IP projection
  const isSp = scouting.pitchCount >= 3 && scouting.stamina >= 35;
  let baseIp: number;
  if (isSp) {
    baseIp = 10 + scouting.stamina * 3.0;
    baseIp = Math.max(100, Math.min(280, baseIp));
  } else {
    baseIp = 30 + scouting.stamina * 0.6;
    baseIp = Math.max(30, Math.min(100, baseIp));
  }

  // Injury modifier
  const proneness = scouting.injury.toLowerCase();
  let injuryMod = 1.0;
  switch (proneness) {
    case 'iron man': injuryMod = 1.15; break;
    case 'durable': injuryMod = 1.08; break;
    case 'normal': injuryMod = 1.0; break;
    case 'fragile': injuryMod = 0.92; break;
    case 'wrecked': injuryMod = 0.75; break;
  }
  baseIp *= injuryMod;

  // Skill modifier
  if (projFip <= 3.50) baseIp *= 1.20;
  else if (projFip <= 4.00) baseIp *= 1.10;
  else if (projFip <= 4.50) baseIp *= 1.0;
  else if (projFip <= 5.00) baseIp *= 0.90;
  else baseIp *= 0.80;

  // Historical blend (65% history, 35% model for established)
  if (historicalIp && historicalIp > 50) {
    baseIp = (baseIp * 0.35) + (historicalIp * 0.65);
  }

  // Elite pitcher boost
  if (projFip < 3.0) baseIp *= 1.08;
  else if (projFip < 3.5) {
    const t = (projFip - 3.0) / 0.5;
    baseIp *= 1.08 - t * 0.05;
  } else if (projFip < 4.0) {
    const t = (projFip - 3.5) / 0.5;
    baseIp *= 1.03 - t * 0.03;
  }

  const projIp = Math.round(baseIp);
  const projWar = calculateWar(projFip, projIp);

  return {
    projK9: Math.round(projK9 * 100) / 100,
    projBb9: Math.round(projBb9 * 100) / 100,
    projHr9: Math.round(projHr9 * 100) / 100,
    projFip: Math.round(projFip * 100) / 100,
    projIp,
    projWar: Math.round(projWar * 10) / 10,
  };
}

// ============================================================================
// STEP 1: Formula WAR vs Game WAR for Top Pitchers
// ============================================================================

function step1_formulaVsGameWar(allStats: PitcherStats[]) {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 1: Formula WAR vs Game WAR — Top 10 by Game WAR');
  console.log('='.repeat(80));
  console.log('WAR Formula: ((5.20 - FIP) / 8.50) × (IP / 9)');
  console.log('FIP Formula: ((13×HR/9 + 3×BB/9 - 2×K/9) / 9) + 3.47\n');

  for (const year of [2018, 2019, 2020]) {
    const yearStats = allStats.filter(s => s.year === year);
    const top10 = yearStats.sort((a, b) => b.gameWar - a.gameWar).slice(0, 10);

    console.log(`--- ${year} Top 10 by Game WAR (min 50 IP) ---`);
    console.log(
      'Rank'.padStart(4) + ' ' +
      'ID'.padStart(6) + '  ' +
      'GS'.padStart(3) + ' ' +
      'IP'.padStart(6) + ' ' +
      'K/9'.padStart(5) + ' ' +
      'BB/9'.padStart(5) + ' ' +
      'HR/9'.padStart(5) + ' ' +
      'FIP'.padStart(5) + ' ' +
      'fWAR'.padStart(5) + ' ' +
      'gWAR'.padStart(5) + ' ' +
      'Gap'.padStart(5)
    );

    for (let i = 0; i < top10.length; i++) {
      const p = top10[i];
      const gap = p.formulaWar - p.gameWar;
      console.log(
        `${(i + 1)}`.padStart(4) + ' ' +
        `${p.playerId}`.padStart(6) + '  ' +
        `${p.gs}`.padStart(3) + ' ' +
        `${p.ip.toFixed(1)}`.padStart(6) + ' ' +
        `${p.k9.toFixed(2)}`.padStart(5) + ' ' +
        `${p.bb9.toFixed(2)}`.padStart(5) + ' ' +
        `${p.hr9.toFixed(2)}`.padStart(5) + ' ' +
        `${p.fip.toFixed(2)}`.padStart(5) + ' ' +
        `${p.formulaWar.toFixed(1)}`.padStart(5) + ' ' +
        `${p.gameWar.toFixed(1)}`.padStart(5) + ' ' +
        `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}`.padStart(5)
      );
    }

    // Summary
    const fWarValues = top10.map(p => p.formulaWar);
    const gWarValues = top10.map(p => p.gameWar);
    const gaps = top10.map(p => p.formulaWar - p.gameWar);
    console.log(`\n  Top-10 avg: fWAR=${mean(fWarValues).toFixed(2)}, gWAR=${mean(gWarValues).toFixed(2)}, avg gap=${mean(gaps).toFixed(2)}`);
    console.log(`  Max gWAR: ${Math.max(...gWarValues).toFixed(1)}, Max fWAR: ${Math.max(...fWarValues).toFixed(1)}`);
    console.log('');
  }
}

// ============================================================================
// STEP 2: WAR Distribution Shape (Projected vs Actual)
// ============================================================================

function step2_distributionShape(allStats: PitcherStats[]) {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 2: WAR Distribution Shape — Actual (2018-2020)');
  console.log('='.repeat(80));

  const allGameWar = allStats.map(p => p.gameWar);
  const allFormulaWar = allStats.map(p => p.formulaWar);
  const starterWar = allStats.filter(p => p.gs >= 15).map(p => p.gameWar);
  const starterFormulaWar = allStats.filter(p => p.gs >= 15).map(p => p.formulaWar);

  console.log('\nAll pitchers (50+ IP):');
  console.log(`  n = ${allGameWar.length}`);
  console.log(`  Game WAR:    p50=${percentile(allGameWar, 50).toFixed(1)}, p90=${percentile(allGameWar, 90).toFixed(1)}, p95=${percentile(allGameWar, 95).toFixed(1)}, p99=${percentile(allGameWar, 99).toFixed(1)}, max=${Math.max(...allGameWar).toFixed(1)}`);
  console.log(`  Formula WAR: p50=${percentile(allFormulaWar, 50).toFixed(1)}, p90=${percentile(allFormulaWar, 90).toFixed(1)}, p95=${percentile(allFormulaWar, 95).toFixed(1)}, p99=${percentile(allFormulaWar, 99).toFixed(1)}, max=${Math.max(...allFormulaWar).toFixed(1)}`);

  console.log('\nStarters (15+ GS):');
  console.log(`  n = ${starterWar.length}`);
  console.log(`  Game WAR:    p50=${percentile(starterWar, 50).toFixed(1)}, p90=${percentile(starterWar, 90).toFixed(1)}, p95=${percentile(starterWar, 95).toFixed(1)}, p99=${percentile(starterWar, 99).toFixed(1)}, max=${Math.max(...starterWar).toFixed(1)}`);
  console.log(`  Formula WAR: p50=${percentile(starterFormulaWar, 50).toFixed(1)}, p90=${percentile(starterFormulaWar, 90).toFixed(1)}, p95=${percentile(starterFormulaWar, 95).toFixed(1)}, p99=${percentile(starterFormulaWar, 99).toFixed(1)}, max=${Math.max(...starterFormulaWar).toFixed(1)}`);

  // Year-by-year
  for (const year of [2018, 2019, 2020]) {
    const yearStats = allStats.filter(s => s.year === year && s.gs >= 15);
    const gWar = yearStats.map(p => p.gameWar);
    const fWar = yearStats.map(p => p.formulaWar);
    console.log(`\n  ${year} starters (n=${gWar.length}):`);
    console.log(`    Game WAR:    p95=${percentile(gWar, 95).toFixed(1)}, max=${Math.max(...gWar).toFixed(1)}`);
    console.log(`    Formula WAR: p95=${percentile(fWar, 95).toFixed(1)}, max=${Math.max(...fWar).toFixed(1)}`);
  }
}

// ============================================================================
// STEP 3: Isolate FIP vs IP
// ============================================================================

function step3_isolateFipVsIp(allStats: PitcherStats[]) {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 3: Isolate FIP vs IP Contribution to WAR Gap');
  console.log('='.repeat(80));
  console.log('\nFor top 5 pitchers by game WAR each year:');
  console.log('  - warWithActualIp:  formula WAR using actual FIP but actual IP (= formula WAR)');
  console.log('  - warWith200Ip:     formula WAR using actual FIP but standardized 200 IP');
  console.log('  - warWith220Ip:     formula WAR using actual FIP but 220 IP');
  console.log('');

  for (const year of [2018, 2019, 2020]) {
    const yearStats = allStats.filter(s => s.year === year && s.gs >= 15);
    const top5 = yearStats.sort((a, b) => b.gameWar - a.gameWar).slice(0, 5);

    console.log(`--- ${year} ---`);
    console.log(
      'ID'.padStart(6) + '  ' +
      'IP'.padStart(5) + ' ' +
      'FIP'.padStart(5) + ' ' +
      'gWAR'.padStart(5) + ' ' +
      'fWAR'.padStart(5) + ' ' +
      'w/200'.padStart(5) + ' ' +
      'w/220'.padStart(5) + ' ' +
      'IP_gap'.padStart(7) + ' ' +
      'FIP_gap'.padStart(8)
    );

    for (const p of top5) {
      const warWith200 = calculateWar(p.fip, 200);
      const warWith220 = calculateWar(p.fip, 220);

      // IP gap: what the pitcher lost by not pitching 220 IP
      const ipGap = warWith220 - p.formulaWar;
      // FIP gap: difference between formula WAR (with actual stats) and game WAR
      const fipGap = p.formulaWar - p.gameWar;

      console.log(
        `${p.playerId}`.padStart(6) + '  ' +
        `${p.ip.toFixed(0)}`.padStart(5) + ' ' +
        `${p.fip.toFixed(2)}`.padStart(5) + ' ' +
        `${p.gameWar.toFixed(1)}`.padStart(5) + ' ' +
        `${p.formulaWar.toFixed(1)}`.padStart(5) + ' ' +
        `${warWith200.toFixed(1)}`.padStart(5) + ' ' +
        `${warWith220.toFixed(1)}`.padStart(5) + ' ' +
        `${ipGap >= 0 ? '+' : ''}${ipGap.toFixed(1)}`.padStart(7) + ' ' +
        `${fipGap >= 0 ? '+' : ''}${fipGap.toFixed(1)}`.padStart(8)
      );
    }
    console.log('');
  }

  // What FIP is needed for 6 WAR at various IP levels?
  console.log('\n--- FIP needed for target WAR at various IP ---');
  console.log('WAR = ((5.20 - FIP) / 8.50) × (IP / 9)');
  console.log('Solving: FIP = 5.20 - (WAR × 8.50 × 9 / IP)');
  for (const targetWar of [5.0, 5.5, 6.0, 6.5, 7.0]) {
    const row: string[] = [`WAR=${targetWar.toFixed(1)}:`];
    for (const ip of [180, 190, 200, 210, 220]) {
      const fipNeeded = REPLACEMENT_FIP - (targetWar * RUNS_PER_WIN * 9 / ip);
      row.push(`${ip}IP→FIP ${fipNeeded.toFixed(2)}`);
    }
    console.log('  ' + row.join('  '));
  }
}

// ============================================================================
// STEP 4: Projection Simulation (with Scouting Data)
// ============================================================================

function step4_projectionSimulation(allStats: PitcherStats[], scouting: Map<number, ScoutingData>) {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 4: Projection Simulation — Scouting→Projected vs Actual');
  console.log('='.repeat(80));

  if (scouting.size === 0) {
    console.log('  No scouting data available — skipping projection simulation');
    return;
  }

  // Use 2020 stats as the "known actual" and simulate what projection would produce
  const year2020 = allStats.filter(s => s.year === 2020 && s.gs >= 15);
  const top20 = year2020.sort((a, b) => b.gameWar - a.gameWar).slice(0, 20);

  let matched = 0;
  let totalFipGap = 0;
  let totalIpGap = 0;
  let totalWarGap = 0;

  console.log('\nTop 20 starters by 2020 game WAR — projected (from scouting) vs actual:\n');
  console.log(
    'ID'.padStart(6) + '  ' +
    'Name'.padEnd(20) + ' ' +
    'Age'.padStart(3) + ' ' +
    'STU'.padStart(3) + ' ' +
    'CON'.padStart(3) + ' ' +
    'HRA'.padStart(3) + '  ' +
    'aFIP'.padStart(5) + ' ' +
    'pFIP'.padStart(5) + ' ' +
    'aIP'.padStart(4) + ' ' +
    'pIP'.padStart(4) + ' ' +
    'aWAR'.padStart(5) + ' ' +
    'pWAR'.padStart(5) + ' ' +
    'gap'.padStart(5)
  );

  for (const actual of top20) {
    const scout = scouting.get(actual.playerId);
    if (!scout) continue;

    matched++;
    const age = scout.dob ? calculateAge(scout.dob, 2020) : 27;
    const proj = simulateProjection(scout, age, actual.ip);

    const fipGap = proj.projFip - actual.fip;
    const ipGap = proj.projIp - actual.ip;
    const warGap = proj.projWar - actual.formulaWar;
    totalFipGap += fipGap;
    totalIpGap += ipGap;
    totalWarGap += warGap;

    console.log(
      `${actual.playerId}`.padStart(6) + '  ' +
      scout.name.substring(0, 20).padEnd(20) + ' ' +
      `${age}`.padStart(3) + ' ' +
      `${scout.stuff}`.padStart(3) + ' ' +
      `${scout.control}`.padStart(3) + ' ' +
      `${scout.hra}`.padStart(3) + '  ' +
      `${actual.fip.toFixed(2)}`.padStart(5) + ' ' +
      `${proj.projFip.toFixed(2)}`.padStart(5) + ' ' +
      `${actual.ip.toFixed(0)}`.padStart(4) + ' ' +
      `${proj.projIp}`.padStart(4) + ' ' +
      `${actual.formulaWar.toFixed(1)}`.padStart(5) + ' ' +
      `${proj.projWar.toFixed(1)}`.padStart(5) + ' ' +
      `${warGap >= 0 ? '+' : ''}${warGap.toFixed(1)}`.padStart(5)
    );
  }

  if (matched > 0) {
    console.log(`\n  Matched ${matched}/${top20.length} pitchers with scouting data`);
    console.log(`  Avg FIP gap (proj - actual): ${(totalFipGap / matched).toFixed(2)} (positive = over-projecting FIP = under-projecting quality)`);
    console.log(`  Avg IP gap (proj - actual):  ${(totalIpGap / matched).toFixed(1)}`);
    console.log(`  Avg WAR gap (proj - actual): ${(totalWarGap / matched).toFixed(2)}`);
  }
}

// ============================================================================
// STEP 5: What-If Analysis — Theoretical WAR Ceiling
// ============================================================================

function step5_theoreticalCeiling(scouting: Map<number, ScoutingData>) {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 5: Theoretical WAR Ceiling from Rating→Rate Formulas');
  console.log('='.repeat(80));

  // What does the formula produce for elite ratings?
  console.log('\nRating→Rate→FIP→WAR for various rating combinations:');
  console.log('(Assuming 200 IP, replacement FIP=5.20, R/W=8.50)\n');

  console.log(
    'STU'.padStart(3) + ' ' +
    'CON'.padStart(3) + ' ' +
    'HRA'.padStart(3) + '  ' +
    'K/9'.padStart(5) + ' ' +
    'BB/9'.padStart(5) + ' ' +
    'HR/9'.padStart(5) + '  ' +
    'FIP'.padStart(5) + '  ' +
    'WAR@180'.padStart(7) + ' ' +
    'WAR@200'.padStart(7) + ' ' +
    'WAR@220'.padStart(7)
  );

  const combos = [
    { stuff: 80, control: 80, hra: 80, label: 'Elite all' },
    { stuff: 80, control: 55, hra: 55, label: 'Stuff ace' },
    { stuff: 75, control: 75, hra: 75, label: 'Top 5 starter' },
    { stuff: 70, control: 70, hra: 70, label: 'Above avg' },
    { stuff: 65, control: 65, hra: 65, label: 'Good starter' },
    { stuff: 60, control: 60, hra: 60, label: 'Average starter' },
    { stuff: 50, control: 50, hra: 50, label: 'Replacement' },
  ];

  for (const c of combos) {
    const k9 = ratingToK9(c.stuff);
    const bb9 = ratingToBb9(c.control);
    const hr9 = ratingToHr9(c.hra);
    const fip = calculateFip(k9, bb9, hr9);
    const war180 = calculateWar(fip, 180);
    const war200 = calculateWar(fip, 200);
    const war220 = calculateWar(fip, 220);

    console.log(
      `${c.stuff}`.padStart(3) + ' ' +
      `${c.control}`.padStart(3) + ' ' +
      `${c.hra}`.padStart(3) + '  ' +
      `${k9.toFixed(2)}`.padStart(5) + ' ' +
      `${bb9.toFixed(2)}`.padStart(5) + ' ' +
      `${hr9.toFixed(2)}`.padStart(5) + '  ' +
      `${fip.toFixed(2)}`.padStart(5) + '  ' +
      `${war180.toFixed(1)}`.padStart(7) + ' ' +
      `${war200.toFixed(1)}`.padStart(7) + ' ' +
      `${war220.toFixed(1)}`.padStart(7) +
      `  (${c.label})`
    );
  }

  // What ratings do actual top pitchers back-calculate to?
  console.log('\n\nBack-calculating ratings from actual 2018-2020 elite stats:');
  console.log('(What scouting ratings would need to be to match observed rates)\n');

  // Hardcode a few known elite seasons from the data
  const eliteSeasons = [
    { k9: 10.5, bb9: 2.0, hr9: 0.5, ip: 210, label: 'Typical ace season' },
    { k9: 12.0, bb9: 2.5, hr9: 0.6, ip: 200, label: 'Elite K, good control' },
    { k9: 8.0, bb9: 1.5, hr9: 0.5, ip: 220, label: 'Control artist + durability' },
    { k9: 11.0, bb9: 1.8, hr9: 0.4, ip: 215, label: 'Generational (deGrom-type)' },
  ];

  console.log(
    'K/9'.padStart(5) + ' ' +
    'BB/9'.padStart(5) + ' ' +
    'HR/9'.padStart(5) + '  ' +
    '→STU'.padStart(5) + ' ' +
    '→CON'.padStart(5) + ' ' +
    '→HRA'.padStart(5) + '  ' +
    'FIP'.padStart(5) + '  ' +
    'WAR'.padStart(5) + '  ' +
    'Label'
  );

  for (const e of eliteSeasons) {
    const impliedStuff = k9ToRating(e.k9);
    const impliedControl = bb9ToRating(e.bb9);
    const impliedHra = hr9ToRating(e.hr9);
    const fip = calculateFip(e.k9, e.bb9, e.hr9);
    const war = calculateWar(fip, e.ip);

    console.log(
      `${e.k9.toFixed(1)}`.padStart(5) + ' ' +
      `${e.bb9.toFixed(1)}`.padStart(5) + ' ' +
      `${e.hr9.toFixed(1)}`.padStart(5) + '  ' +
      `${impliedStuff.toFixed(0)}`.padStart(5) + ' ' +
      `${impliedControl.toFixed(0)}`.padStart(5) + ' ' +
      `${impliedHra.toFixed(0)}`.padStart(5) + '  ' +
      `${fip.toFixed(2)}`.padStart(5) + '  ' +
      `${war.toFixed(1)}`.padStart(5) + '  ' +
      e.label
    );
  }

  // Step 6: Analyze what the scouting data distribution looks like for top pitchers
  if (scouting.size > 0) {
    console.log('\n\nScouting rating distribution for all pitchers in data:');
    const scouts = Array.from(scouting.values());
    const stuffs = scouts.map(s => s.stuff).sort((a, b) => a - b);
    const controls = scouts.map(s => s.control).sort((a, b) => a - b);
    const hras = scouts.map(s => s.hra).sort((a, b) => a - b);

    console.log(`  n = ${scouts.length}`);
    console.log(`  Stuff:   p50=${percentile(stuffs, 50)}, p90=${percentile(stuffs, 90)}, p95=${percentile(stuffs, 95)}, max=${Math.max(...stuffs)}`);
    console.log(`  Control: p50=${percentile(controls, 50)}, p90=${percentile(controls, 90)}, p95=${percentile(controls, 95)}, max=${Math.max(...controls)}`);
    console.log(`  HRA:     p50=${percentile(hras, 50)}, p90=${percentile(hras, 90)}, p95=${percentile(hras, 95)}, max=${Math.max(...hras)}`);

    // Top scouting profiles
    console.log('\n  Top 10 pitchers by stuff rating:');
    const byStuff = scouts.sort((a, b) => b.stuff - a.stuff).slice(0, 10);
    for (const s of byStuff) {
      const k9 = ratingToK9(s.stuff);
      const bb9 = ratingToBb9(s.control);
      const hr9 = ratingToHr9(s.hra);
      const fip = calculateFip(k9, bb9, hr9);
      const war200 = calculateWar(fip, 200);
      console.log(`    ${s.name.substring(0, 18).padEnd(18)} STU=${s.stuff} CON=${s.control} HRA=${s.hra} STM=${s.stamina} → FIP=${fip.toFixed(2)}, WAR@200=${war200.toFixed(1)}`);
    }
  }
}

// ============================================================================
// STEP 6: Ensemble Impact Analysis
// ============================================================================

function step6_ensembleImpact() {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 6: Ensemble Projection Impact on Elite Pitchers');
  console.log('='.repeat(80));
  console.log('\nHow ensemble blending affects projection for a 27-year-old ace (STU=75, CON=75, HRA=75):');

  const ages = [24, 25, 27, 29, 31, 33];
  const ratings = { stuff: 75, control: 75, hra: 75 };

  console.log(
    'Age'.padStart(3) + '  ' +
    'AgeMod'.padStart(12) + '  ' +
    'OptK9'.padStart(6) + ' ' +
    'NeuK9'.padStart(6) + ' ' +
    'BlendK9'.padStart(7) + '  ' +
    'OptFIP'.padStart(6) + ' ' +
    'NeuFIP'.padStart(6) + ' ' +
    'BlendFIP'.padStart(8) + '  ' +
    'WAR@200'.padStart(7)
  );

  for (const age of ages) {
    const mods = getAgingModifiers(age);

    // Optimistic
    const optStuff = Math.max(0, Math.min(100, ratings.stuff + mods.stuff));
    const optControl = Math.max(0, Math.min(100, ratings.control + mods.control));
    const optHra = Math.max(0, Math.min(100, ratings.hra + mods.hra));
    const optK9 = ratingToK9(optStuff);
    const optBb9 = ratingToBb9(optControl);
    const optHr9 = ratingToHr9(optHra);
    const optFip = calculateFip(optK9, optBb9, optHr9);

    // Neutral (20% aging)
    const neuStuff = Math.max(20, Math.min(80, ratings.stuff + mods.stuff * 0.2));
    const neuControl = Math.max(20, Math.min(80, ratings.control + mods.control * 0.2));
    const neuHra = Math.max(20, Math.min(80, ratings.hra + mods.hra * 0.2));
    const neuK9 = ratingToK9(neuStuff);
    const neuBb9 = ratingToBb9(neuControl);
    const neuHr9 = ratingToHr9(neuHra);
    const neuFip = calculateFip(neuK9, neuBb9, neuHr9);

    // Blend
    const blK9 = optK9 * 0.35 + neuK9 * 0.65;
    const blBb9 = optBb9 * 0.35 + neuBb9 * 0.65;
    const blHr9 = optHr9 * 0.35 + neuHr9 * 0.65;
    const blFip = calculateFip(blK9, blBb9, blHr9);
    const blWar = calculateWar(blFip, 200);

    console.log(
      `${age}`.padStart(3) + '  ' +
      `S${mods.stuff >= 0 ? '+' : ''}${mods.stuff}/C${mods.control >= 0 ? '+' : ''}${mods.control}`.padStart(12) + '  ' +
      `${optK9.toFixed(2)}`.padStart(6) + ' ' +
      `${neuK9.toFixed(2)}`.padStart(6) + ' ' +
      `${blK9.toFixed(2)}`.padStart(7) + '  ' +
      `${optFip.toFixed(2)}`.padStart(6) + ' ' +
      `${neuFip.toFixed(2)}`.padStart(6) + ' ' +
      `${blFip.toFixed(2)}`.padStart(8) + '  ' +
      `${blWar.toFixed(1)}`.padStart(7)
    );
  }
}

// ============================================================================
// STEP 7: Full Pipeline Simulation (True Rating → Projection)
// ============================================================================

// True Rating constants (from TrueRatingsCalculationService)
const TR_CONSTANTS = {
  leagueAvg: { k9: 5.60, bb9: 2.80, hr9: 0.90 },
  stabilization: { k9: 50, bb9: 40, hr9: 70 },
  regressionRatio: { k9: 0.60, bb9: 0.80, hr9: 0.18 }, // SP role
  scoutingBlendIp: 60,
};

// Inverse formulas (from TrueRatingsCalculationService — note slightly different intercepts)
// Inverse formulas MUST match forward formulas in PotentialStatsService (2.10, 5.30, 2.18)
function estimateStuff(k9: number): number { return Math.max(0, Math.min(100, (k9 - 2.10) / 0.074)); }
function estimateControl(bb9: number): number { return Math.max(0, Math.min(100, (5.30 - bb9) / 0.052)); }
function estimateHra(hr9: number): number { return Math.max(0, Math.min(100, (2.18 - hr9) / 0.024)); }

// FIP-aware regression (continuous scaling from TrueRatingsCalculationService)
function calculateTargetOffset(estimatedFip: number): number {
  const breakpoints = [
    { fip: 2.5, offset: -3.0 },
    { fip: 3.0, offset: -2.8 },
    { fip: 3.5, offset: -2.0 },
    { fip: 4.0, offset: -0.8 },
    { fip: 4.2, offset:  0.0 },
    { fip: 4.5, offset: +1.0 },
    { fip: 5.0, offset: +1.5 },
    { fip: 6.0, offset: +1.5 },
  ];
  if (estimatedFip <= breakpoints[0].fip) return breakpoints[0].offset;
  if (estimatedFip >= breakpoints[breakpoints.length - 1].fip) return breakpoints[breakpoints.length - 1].offset;
  for (let i = 0; i < breakpoints.length - 1; i++) {
    if (estimatedFip >= breakpoints[i].fip && estimatedFip <= breakpoints[i + 1].fip) {
      const t = (estimatedFip - breakpoints[i].fip) / (breakpoints[i + 1].fip - breakpoints[i].fip);
      return breakpoints[i].offset + t * (breakpoints[i + 1].offset - breakpoints[i].offset);
    }
  }
  return 0;
}

function calculateStrengthMultiplier(estimatedFip: number): number {
  if (estimatedFip < 3.5) return 1.30;
  if (estimatedFip < 4.0) return 1.50;
  if (estimatedFip < 4.5) return 1.80;
  return 2.00;
}

function regressRate(
  weightedRate: number,
  totalIp: number,
  leagueRate: number,
  stabilizationK: number,
  statType: 'k9' | 'bb9' | 'hr9',
  estimatedFip: number
): number {
  const targetOffset = calculateTargetOffset(estimatedFip);
  const strengthMultiplier = calculateStrengthMultiplier(estimatedFip);
  const ratio = TR_CONSTANTS.regressionRatio[statType];

  let regressionTarget: number;
  if (statType === 'k9') {
    regressionTarget = leagueRate - (targetOffset * ratio);
  } else {
    regressionTarget = leagueRate + (targetOffset * ratio);
  }

  let adjustedK = stabilizationK * strengthMultiplier;
  const ipConfidence = Math.min(1.0, totalIp / 100);
  const ipScale = 0.5 + (ipConfidence * 0.5);
  adjustedK = adjustedK * ipScale;

  return (weightedRate * totalIp + regressionTarget * adjustedK) / (totalIp + adjustedK);
}

function blendWithScouting(
  regressedRate: number,
  scoutingExpectedRate: number,
  totalIp: number
): number {
  const statsWeight = totalIp / (totalIp + TR_CONSTANTS.scoutingBlendIp);
  return statsWeight * regressedRate + (1 - statsWeight) * scoutingExpectedRate;
}

interface MultiYearPitcherData {
  years: PitcherStats[];
  scouting?: ScoutingData;
}

function simulateFullPipeline(data: MultiYearPitcherData): {
  // True Rating estimation
  weightedK9: number; weightedBb9: number; weightedHr9: number; totalIp: number;
  regressedK9: number; regressedBb9: number; regressedHr9: number;
  blendedK9: number; blendedBb9: number; blendedHr9: number;
  estStuff: number; estControl: number; estHra: number;
  trFip: number;
  // Projection
  projK9: number; projBb9: number; projHr9: number;
  projFip: number; projIp: number; projWar: number;
  // Component contributions
  kLoss: number; bbLoss: number; hrLoss: number;
} {
  const yearWeights = [5, 3, 2];

  // Step 1: Weighted multi-year average
  let wK9Sum = 0, wBb9Sum = 0, wHr9Sum = 0, totalWeight = 0, totalIp = 0;
  for (let i = 0; i < Math.min(data.years.length, yearWeights.length); i++) {
    const stats = data.years[i];
    const w = yearWeights[i] * stats.ip;
    wK9Sum += stats.k9 * w;
    wBb9Sum += stats.bb9 * w;
    wHr9Sum += stats.hr9 * w;
    totalWeight += w;
    totalIp += stats.ip;
  }
  const weightedK9 = wK9Sum / totalWeight;
  const weightedBb9 = wBb9Sum / totalWeight;
  const weightedHr9 = wHr9Sum / totalWeight;

  // Step 2: Calculate estimated FIP for regression scaling
  const fipLike = (13 * weightedHr9 + 3 * weightedBb9 - 2 * weightedK9) / 9;
  const estimatedFip = fipLike + FIP_CONSTANT;

  // Step 3: Regress toward league mean (FIP-aware)
  const regressedK9 = regressRate(weightedK9, totalIp, TR_CONSTANTS.leagueAvg.k9, TR_CONSTANTS.stabilization.k9, 'k9', estimatedFip);
  const regressedBb9 = regressRate(weightedBb9, totalIp, TR_CONSTANTS.leagueAvg.bb9, TR_CONSTANTS.stabilization.bb9, 'bb9', estimatedFip);
  const regressedHr9 = regressRate(weightedHr9, totalIp, TR_CONSTANTS.leagueAvg.hr9, TR_CONSTANTS.stabilization.hr9, 'hr9', estimatedFip);

  // Step 4: Blend with scouting (if available)
  let blendedK9 = regressedK9, blendedBb9 = regressedBb9, blendedHr9 = regressedHr9;
  if (data.scouting) {
    const scoutK9 = ratingToK9(data.scouting.stuff);
    const scoutBb9 = ratingToBb9(data.scouting.control);
    const scoutHr9 = ratingToHr9(data.scouting.hra);
    blendedK9 = blendWithScouting(regressedK9, scoutK9, totalIp);
    blendedBb9 = blendWithScouting(regressedBb9, scoutBb9, totalIp);
    blendedHr9 = blendWithScouting(regressedHr9, scoutHr9, totalIp);
  }

  // Step 5: Estimate ratings from blended rates
  const estStuff = estimateStuff(blendedK9);
  const estControl = estimateControl(blendedBb9);
  const estHra = estimateHra(blendedHr9);
  const trFip = calculateFip(blendedK9, blendedBb9, blendedHr9);

  // Step 6: Project to next year via ensemble
  const age = data.scouting ? calculateAge(data.scouting.dob, data.years[0].year) : 27;
  const ageMods = getAgingModifiers(age);
  const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
  const clamp80 = (v: number) => Math.max(20, Math.min(80, v));

  // Optimistic (full aging)
  const optK9 = ratingToK9(clamp100(estStuff + ageMods.stuff));
  const optBb9 = ratingToBb9(clamp100(estControl + ageMods.control));
  const optHr9 = ratingToHr9(clamp100(estHra + ageMods.hra));

  // Neutral (20% aging) — note: neutral model clamps at 20-80 in the actual service
  const neuK9 = ratingToK9(clamp80(estStuff + ageMods.stuff * 0.2));
  const neuBb9 = ratingToBb9(clamp80(estControl + ageMods.control * 0.2));
  const neuHr9 = ratingToHr9(clamp80(estHra + ageMods.hra * 0.2));

  // Pessimistic = neutral (no trend data)
  // Blend: 35% optimistic, 55% neutral, 10% pessimistic (= 65% neutral effectively)
  const projK9 = optK9 * 0.35 + neuK9 * 0.65;
  const projBb9 = optBb9 * 0.35 + neuBb9 * 0.65;
  const projHr9 = optHr9 * 0.35 + neuHr9 * 0.65;
  const projFip = calculateFip(projK9, projBb9, projHr9);

  // Step 7: Project IP
  const stamina = data.scouting?.stamina ?? 50;
  const isSp = (data.scouting?.pitchCount ?? 3) >= 3 && stamina >= 35;
  let baseIp: number;
  if (isSp) {
    baseIp = 10 + stamina * 3.0;
    baseIp = Math.max(100, Math.min(280, baseIp));
  } else {
    baseIp = 30 + stamina * 0.6;
    baseIp = Math.max(30, Math.min(100, baseIp));
  }

  // Injury modifier — only apply when no historical data to blend with
  // (history already captures durability; applying both double-penalizes)
  const hasHistory = data.years.length > 0 && data.years[0].ip >= 50;
  if (!hasHistory) {
    const proneness = (data.scouting?.injury ?? 'Normal').toLowerCase();
    let injuryMod = 1.0;
    switch (proneness) {
      case 'iron man': injuryMod = 1.15; break;
      case 'durable': injuryMod = 1.08; break;
      case 'fragile': injuryMod = 0.92; break;
      case 'wrecked': injuryMod = 0.75; break;
    }
    baseIp *= injuryMod;
  }

  // Skill modifier
  if (projFip <= 3.50) baseIp *= 1.20;
  else if (projFip <= 4.00) baseIp *= 1.10;
  else if (projFip <= 4.50) baseIp *= 1.0;
  else if (projFip <= 5.00) baseIp *= 0.90;
  else baseIp *= 0.80;

  // Historical blend (65% history / 35% model for established)
  const historicalIp = data.years.map(y => y.ip);
  const recentIp = historicalIp[0] ?? 0;
  if (recentIp > 50) {
    // Use weighted average of recent seasons
    let wIp = 0, wIpW = 0;
    const ipWeights = [5, 3, 2];
    for (let i = 0; i < Math.min(historicalIp.length, ipWeights.length); i++) {
      if (historicalIp[i] >= 50) { // Skip injured seasons
        wIp += historicalIp[i] * ipWeights[i];
        wIpW += ipWeights[i];
      }
    }
    if (wIpW > 0) {
      const weightedHistIp = wIp / wIpW;
      baseIp = (baseIp * 0.35) + (weightedHistIp * 0.65);
    }
  }

  // Elite pitcher IP boost
  if (projFip < 3.0) baseIp *= 1.08;
  else if (projFip < 3.5) {
    const t = (projFip - 3.0) / 0.5;
    baseIp *= 1.08 - t * 0.05;
  } else if (projFip < 4.0) {
    const t = (projFip - 3.5) / 0.5;
    baseIp *= 1.03 - t * 0.03;
  }

  const projIp = Math.round(baseIp);
  const projWar = calculateWar(projFip, projIp);

  // Component losses (vs weighted average of actual stats)
  const actualK9 = data.years[0].k9;
  const actualBb9 = data.years[0].bb9;
  const actualHr9 = data.years[0].hr9;
  const kLoss = projK9 - actualK9; // Negative = lost strikeouts (worse projection)
  const bbLoss = projBb9 - actualBb9; // Positive = more walks (worse projection)
  const hrLoss = projHr9 - actualHr9; // Positive = more HR (worse projection)

  return {
    weightedK9, weightedBb9, weightedHr9, totalIp,
    regressedK9, regressedBb9, regressedHr9,
    blendedK9, blendedBb9, blendedHr9,
    estStuff, estControl, estHra,
    trFip,
    projK9, projBb9, projHr9,
    projFip, projIp, projWar,
    kLoss, bbLoss, hrLoss,
  };
}

function step7_fullPipelineSimulation(allStats: PitcherStats[], scouting: Map<number, ScoutingData>) {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 7: Full Pipeline Simulation (Actual Stats → True Rating → Projection)');
  console.log('='.repeat(80));
  console.log('\nSimulates: multi-year weighted stats → FIP-aware regression → scouting blend');
  console.log('           → rating estimation → ensemble aging → IP projection → WAR');

  // Get top 10 starters by 2020 game WAR
  const year2020 = allStats.filter(s => s.year === 2020 && s.gs >= 15);
  const top10 = year2020.sort((a, b) => b.gameWar - a.gameWar).slice(0, 10);

  // Build multi-year data for each
  console.log('\n--- Top 10 Starters by 2020 Game WAR ---\n');

  let totalFipGap = 0, totalIpGap = 0, totalWarGap = 0, count = 0;

  // Header
  console.log(
    'ID'.padStart(6) + '  ' +
    'Name'.padEnd(16) + ' ' +
    'aK9'.padStart(5) + ' ' +
    'pK9'.padStart(5) + ' ' +
    'aBB9'.padStart(5) + ' ' +
    'pBB9'.padStart(5) + ' ' +
    'aHR9'.padStart(5) + ' ' +
    'pHR9'.padStart(5) + '  ' +
    'aFIP'.padStart(5) + ' ' +
    'trFIP'.padStart(5) + ' ' +
    'pFIP'.padStart(5) + '  ' +
    'aIP'.padStart(4) + ' ' +
    'pIP'.padStart(4) + '  ' +
    'fWAR'.padStart(5) + ' ' +
    'pWAR'.padStart(5) + ' ' +
    'gap'.padStart(5)
  );

  for (const pitcher of top10) {
    // Collect multi-year data (most recent first): 2020, 2019, 2018
    const years: PitcherStats[] = [pitcher];
    for (const year of [2019, 2018]) {
      const yearData = allStats.find(s => s.year === year && s.playerId === pitcher.playerId);
      if (yearData) years.push(yearData);
    }

    const scout = scouting.get(pitcher.playerId);
    const result = simulateFullPipeline({ years, scouting: scout });
    count++;

    const fipGap = result.projFip - pitcher.fip;
    const ipGap = result.projIp - pitcher.ip;
    const warGap = result.projWar - pitcher.formulaWar;
    totalFipGap += fipGap;
    totalIpGap += ipGap;
    totalWarGap += warGap;

    const name = scout?.name ?? `Player ${pitcher.playerId}`;
    console.log(
      `${pitcher.playerId}`.padStart(6) + '  ' +
      name.substring(0, 16).padEnd(16) + ' ' +
      `${pitcher.k9.toFixed(1)}`.padStart(5) + ' ' +
      `${result.projK9.toFixed(1)}`.padStart(5) + ' ' +
      `${pitcher.bb9.toFixed(1)}`.padStart(5) + ' ' +
      `${result.projBb9.toFixed(1)}`.padStart(5) + ' ' +
      `${pitcher.hr9.toFixed(2)}`.padStart(5) + ' ' +
      `${result.projHr9.toFixed(2)}`.padStart(5) + '  ' +
      `${pitcher.fip.toFixed(2)}`.padStart(5) + ' ' +
      `${result.trFip.toFixed(2)}`.padStart(5) + ' ' +
      `${result.projFip.toFixed(2)}`.padStart(5) + '  ' +
      `${pitcher.ip.toFixed(0)}`.padStart(4) + ' ' +
      `${result.projIp}`.padStart(4) + '  ' +
      `${pitcher.formulaWar.toFixed(1)}`.padStart(5) + ' ' +
      `${result.projWar.toFixed(1)}`.padStart(5) + ' ' +
      `${warGap >= 0 ? '+' : ''}${warGap.toFixed(1)}`.padStart(5)
    );
  }

  console.log(`\n  Average gaps (projected - actual):`);
  console.log(`    FIP: ${(totalFipGap / count).toFixed(3)} (positive = projected worse than actual)`);
  console.log(`    IP:  ${(totalIpGap / count).toFixed(1)}`);
  console.log(`    WAR: ${(totalWarGap / count).toFixed(2)}`);

  // Detailed breakdown for top pitcher
  const topPitcher = top10[0];
  const topYears: PitcherStats[] = [topPitcher];
  for (const year of [2019, 2018]) {
    const yearData = allStats.find(s => s.year === year && s.playerId === topPitcher.playerId);
    if (yearData) topYears.push(yearData);
  }
  const topScout = scouting.get(topPitcher.playerId);
  const topResult = simulateFullPipeline({ years: topYears, scouting: topScout });

  console.log(`\n--- Detailed Breakdown: Top Pitcher (${topScout?.name ?? topPitcher.playerId}) ---`);
  console.log(`  2020 actual:     K/9=${topPitcher.k9.toFixed(2)}, BB/9=${topPitcher.bb9.toFixed(2)}, HR/9=${topPitcher.hr9.toFixed(2)}, FIP=${topPitcher.fip.toFixed(2)}, IP=${topPitcher.ip.toFixed(0)}, fWAR=${topPitcher.formulaWar.toFixed(1)}, gWAR=${topPitcher.gameWar.toFixed(1)}`);
  console.log(`  Scouting:        STU=${topScout?.stuff ?? '?'}, CON=${topScout?.control ?? '?'}, HRA=${topScout?.hra ?? '?'}, STM=${topScout?.stamina ?? '?'}, ${topScout?.injury ?? '?'}`);
  console.log(`  Weighted avg:    K/9=${topResult.weightedK9.toFixed(2)}, BB/9=${topResult.weightedBb9.toFixed(2)}, HR/9=${topResult.weightedHr9.toFixed(2)}`);
  console.log(`  After regression: K/9=${topResult.regressedK9.toFixed(2)}, BB/9=${topResult.regressedBb9.toFixed(2)}, HR/9=${topResult.regressedHr9.toFixed(2)}`);
  console.log(`  After scouting:  K/9=${topResult.blendedK9.toFixed(2)}, BB/9=${topResult.blendedBb9.toFixed(2)}, HR/9=${topResult.blendedHr9.toFixed(2)}`);
  console.log(`  Est. ratings:    Stuff=${topResult.estStuff.toFixed(1)}, Control=${topResult.estControl.toFixed(1)}, HRA=${topResult.estHra.toFixed(1)}`);
  console.log(`  TR FIP:          ${topResult.trFip.toFixed(2)}`);
  console.log(`  After ensemble:  K/9=${topResult.projK9.toFixed(2)}, BB/9=${topResult.projBb9.toFixed(2)}, HR/9=${topResult.projHr9.toFixed(2)}`);
  console.log(`  Projected:       FIP=${topResult.projFip.toFixed(2)}, IP=${topResult.projIp}, WAR=${topResult.projWar.toFixed(1)}`);

  // FIP decomposition: how much does each component lose?
  const actualFip = topPitcher.fip;
  const projFip = topResult.projFip;
  const fipFromK = (-2 * (topResult.projK9 - topPitcher.k9)) / 9;
  const fipFromBb = (3 * (topResult.projBb9 - topPitcher.bb9)) / 9;
  const fipFromHr = (13 * (topResult.projHr9 - topPitcher.hr9)) / 9;

  console.log(`\n  FIP Gap Decomposition (projected - actual = ${(projFip - actualFip).toFixed(3)}):`);
  console.log(`    K/9 contribution:  ${fipFromK >= 0 ? '+' : ''}${fipFromK.toFixed(3)} (K/9 change: ${topResult.kLoss >= 0 ? '+' : ''}${topResult.kLoss.toFixed(2)})`);
  console.log(`    BB/9 contribution: ${fipFromBb >= 0 ? '+' : ''}${fipFromBb.toFixed(3)} (BB/9 change: ${topResult.bbLoss >= 0 ? '+' : ''}${topResult.bbLoss.toFixed(2)})`);
  console.log(`    HR/9 contribution: ${fipFromHr >= 0 ? '+' : ''}${fipFromHr.toFixed(3)} (HR/9 change: ${topResult.hrLoss >= 0 ? '+' : ''}${topResult.hrLoss.toFixed(2)})`);

  // WAR decomposition
  const warFromFip = calculateWar(projFip, topPitcher.ip) - calculateWar(actualFip, topPitcher.ip);
  const warFromIp = calculateWar(actualFip, topResult.projIp) - calculateWar(actualFip, topPitcher.ip);
  console.log(`\n  WAR Gap Decomposition (projected ${topResult.projWar.toFixed(1)} - actual ${topPitcher.formulaWar.toFixed(1)} = ${(topResult.projWar - topPitcher.formulaWar).toFixed(1)}):`);
  console.log(`    From FIP:     ${warFromFip >= 0 ? '+' : ''}${warFromFip.toFixed(1)} (projected FIP into actual IP)`);
  console.log(`    From IP:      ${warFromIp >= 0 ? '+' : ''}${warFromIp.toFixed(1)} (actual FIP into projected IP)`);
  console.log(`    Interaction:  ${((topResult.projWar - topPitcher.formulaWar) - warFromFip - warFromIp).toFixed(1)}`);
}

// ============================================================================
// STEP 8: Rating Clamping Analysis
// ============================================================================

function step8_ratingClampingAnalysis(allStats: PitcherStats[]) {
  console.log('\n' + '='.repeat(80));
  console.log('STEP 8: Rating Clamping Impact (0-100 → 20-80 round-trip loss)');
  console.log('='.repeat(80));
  console.log('\nThe projection pipeline: actual_stat → estimate_rating(0-100) → clamp(0-100) → project_stat');
  console.log('The neutral model clamps at 20-80. How much does this lose for elite pitchers?');

  // For each top pitcher, show the rating estimate and clamping impact
  const year2020 = allStats.filter(s => s.year === 2020 && s.gs >= 15);
  const top10 = year2020.sort((a, b) => b.gameWar - a.gameWar).slice(0, 10);

  console.log('\n' +
    'ID'.padStart(6) + '  ' +
    'K/9'.padStart(5) + ' ' +
    '→STU'.padStart(5) + ' ' +
    'cSTU'.padStart(4) + ' ' +
    'BB/9'.padStart(5) + ' ' +
    '→CON'.padStart(5) + ' ' +
    'cCON'.padStart(4) + ' ' +
    'HR/9'.padStart(5) + ' ' +
    '→HRA'.padStart(5) + ' ' +
    'cHRA'.padStart(4) + '  ' +
    'actFIP'.padStart(6) + ' ' +
    'rtFIP'.padStart(6) + ' ' +
    'clFIP'.padStart(6) + ' ' +
    'FIPgap'.padStart(6)
  );

  for (const p of top10) {
    const estS = estimateStuff(p.k9);
    const estC = estimateControl(p.bb9);
    const estH = estimateHra(p.hr9);
    // Clamped versions (neutral model: 20-80)
    const clS = Math.max(20, Math.min(80, estS));
    const clC = Math.max(20, Math.min(80, estC));
    const clH = Math.max(20, Math.min(80, estH));
    // Round-trip FIP
    const rtK9 = ratingToK9(estS); // using unclamped
    const rtBb9 = ratingToBb9(estC);
    const rtHr9 = ratingToHr9(estH);
    const rtFip = calculateFip(rtK9, rtBb9, rtHr9);
    // Clamped FIP
    const clK9 = ratingToK9(clS);
    const clBb9 = ratingToBb9(clC);
    const clHr9 = ratingToHr9(clH);
    const clFip = calculateFip(clK9, clBb9, clHr9);

    console.log(
      `${p.playerId}`.padStart(6) + '  ' +
      `${p.k9.toFixed(1)}`.padStart(5) + ' ' +
      `${estS.toFixed(0)}`.padStart(5) + ' ' +
      `${clS.toFixed(0)}`.padStart(4) + ' ' +
      `${p.bb9.toFixed(1)}`.padStart(5) + ' ' +
      `${estC.toFixed(0)}`.padStart(5) + ' ' +
      `${clC.toFixed(0)}`.padStart(4) + ' ' +
      `${p.hr9.toFixed(2)}`.padStart(5) + ' ' +
      `${estH.toFixed(0)}`.padStart(5) + ' ' +
      `${clH.toFixed(0)}`.padStart(4) + '  ' +
      `${p.fip.toFixed(2)}`.padStart(6) + ' ' +
      `${rtFip.toFixed(2)}`.padStart(6) + ' ' +
      `${clFip.toFixed(2)}`.padStart(6) + ' ' +
      `${(clFip - p.fip).toFixed(2)}`.padStart(6)
    );
  }

  console.log('\nNote: Optimistic model uses 0-100 range (no clamping loss)');
  console.log('      Neutral model uses 20-80 range (clamping at extremes)');
  console.log('      Since neutral gets 65% weight, clamping impact = ~65% of FIP gap');
}

// ============================================================================
// Main
// ============================================================================

function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║         Pitcher WAR Projection Investigation — February 2026           ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');

  // Load data
  const allStats: PitcherStats[] = [];
  for (const year of [2018, 2019, 2020]) {
    const yearData = loadPitcherStats(year);
    allStats.push(...yearData);
    console.log(`Loaded ${yearData.length} pitchers for ${year} (50+ IP)`);
  }

  const scouting = loadScoutingData();

  // Run analysis steps
  step1_formulaVsGameWar(allStats);
  step2_distributionShape(allStats);
  step3_isolateFipVsIp(allStats);
  step4_projectionSimulation(allStats, scouting);
  step5_theoreticalCeiling(scouting);
  step6_ensembleImpact();
  step7_fullPipelineSimulation(allStats, scouting);
  step8_ratingClampingAnalysis(allStats);

  console.log('\n' + '='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
}

main();
