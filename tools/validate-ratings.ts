/**
 * TR Validation Tool
 *
 * Automated checks for the True Rating system:
 * 1. Formula WAR vs Game WAR — correlation and outliers
 * 2. Distribution shape — are ratings roughly centered?
 * 3. Round-trip consistency — actual stat → rating → implied stat
 * 4. Year-over-year stability — do ratings change proportionally to stats?
 *
 * Usage:
 *   npx tsx tools/validate-ratings.ts [--year=2020] [--check=all|war|dist|roundtrip|stability]
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'public', 'data');

// ============================================================================
// Constants (must match service files)
// ============================================================================

const WOBA_WEIGHTS = { bb: 0.69, single: 0.89, double: 1.27, triple: 1.62, hr: 2.10 };
const FIP_CONSTANT = 3.47;

// Batter WAR constants
const BATTER_LG_WOBA = 0.315;
const BATTER_WOBA_SCALE = 1.15;
const BATTER_RUNS_PER_WIN = 10;
const BATTER_REPLACEMENT_RUNS = 20;

// Pitcher WAR constants
const PITCHER_REPLACEMENT_FIP = 5.20;
const PITCHER_RUNS_PER_WIN = 8.50;

// ============================================================================
// CSV Parsing (same as trace-rating.ts)
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
// Data Loading
// ============================================================================

interface BatterRow {
  playerId: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
  sb: number;
  cs: number;
  gameWar: number;
}

interface PitcherRow {
  playerId: number;
  ip: number;
  k: number;
  bb: number;
  hra: number;
  gs: number;
  gameWar: number;
}

function loadAllBatters(year: number, minPa: number = 200): BatterRow[] {
  const filePath = path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return [];
  }

  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    player_id: headers.indexOf('player_id'),
    split_id: headers.indexOf('split_id'),
    pa: headers.indexOf('pa'),
    ab: headers.indexOf('ab'),
    h: headers.indexOf('h'),
    d: headers.indexOf('d'),
    t: headers.indexOf('t'),
    hr: headers.indexOf('hr'),
    bb: headers.indexOf('bb'),
    k: headers.indexOf('k'),
    sb: headers.indexOf('sb'),
    cs: headers.indexOf('cs'),
    war: headers.indexOf('war'),
  };

  const results: BatterRow[] = [];
  for (const row of rows) {
    if (parseInt(row[idx.split_id]) !== 1) continue;
    const pa = parseInt(row[idx.pa]) || 0;
    if (pa < minPa) continue;

    results.push({
      playerId: parseInt(row[idx.player_id]),
      pa,
      ab: parseInt(row[idx.ab]) || 0,
      h: parseInt(row[idx.h]) || 0,
      d: parseInt(row[idx.d]) || 0,
      t: parseInt(row[idx.t]) || 0,
      hr: parseInt(row[idx.hr]) || 0,
      bb: parseInt(row[idx.bb]) || 0,
      k: parseInt(row[idx.k]) || 0,
      sb: parseInt(row[idx.sb]) || 0,
      cs: parseInt(row[idx.cs]) || 0,
      gameWar: parseFloat(row[idx.war]) || 0,
    });
  }
  return results;
}

function loadAllPitchers(year: number, minIp: number = 50): PitcherRow[] {
  const filePath = path.join(DATA_DIR, 'mlb', `${year}.csv`);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    return [];
  }

  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    player_id: headers.indexOf('player_id'),
    split_id: headers.indexOf('split_id'),
    ip: headers.indexOf('ip'),
    k: headers.indexOf('k'),
    bb: headers.indexOf('bb'),
    hra: headers.indexOf('hra'),
    gs: headers.indexOf('gs'),
    war: headers.indexOf('war'),
  };

  const results: PitcherRow[] = [];
  for (const row of rows) {
    if (parseInt(row[idx.split_id]) !== 1) continue;
    const ip = parseIp(row[idx.ip] || '0');
    if (ip < minIp) continue;

    results.push({
      playerId: parseInt(row[idx.player_id]),
      ip,
      k: parseInt(row[idx.k]) || 0,
      bb: parseInt(row[idx.bb]) || 0,
      hra: parseInt(row[idx.hra]) || 0,
      gs: parseInt(row[idx.gs]) || 0,
      gameWar: parseFloat(row[idx.war]) || 0,
    });
  }
  return results;
}

// ============================================================================
// WAR Computation (must match service implementations)
// ============================================================================

function computeBatterWar(b: BatterRow): { woba: number; wRAA: number; sbRuns: number; war: number } {
  const bbRate = b.bb / b.pa;
  const singles = Math.max(0, b.h - b.d - b.t - b.hr);
  const singleRate = singles / b.pa;
  const doubleRate = b.d / b.pa;
  const tripleRate = b.t / b.pa;
  const hrRate = b.hr / b.pa;

  const woba =
    WOBA_WEIGHTS.bb * bbRate +
    WOBA_WEIGHTS.single * singleRate +
    WOBA_WEIGHTS.double * doubleRate +
    WOBA_WEIGHTS.triple * tripleRate +
    WOBA_WEIGHTS.hr * hrRate;

  const wRAA = ((woba - BATTER_LG_WOBA) / BATTER_WOBA_SCALE) * 600;
  const sbRuns = (b.sb * 0.2 - b.cs * 0.4) * (600 / b.pa);
  const war = (wRAA + BATTER_REPLACEMENT_RUNS + sbRuns) / BATTER_RUNS_PER_WIN;

  return { woba, wRAA, sbRuns, war };
}

function computePitcherFip(p: PitcherRow): number {
  const k9 = (p.k / p.ip) * 9;
  const bb9 = (p.bb / p.ip) * 9;
  const hr9 = (p.hra / p.ip) * 9;
  return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;
}

function computePitcherWar(p: PitcherRow): { fip: number; war: number } {
  const fip = computePitcherFip(p);
  const war = ((PITCHER_REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (p.ip / 9);
  return { fip, war };
}

// ============================================================================
// Statistical Helpers
// ============================================================================

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function correlation(x: number[], y: number[]): number {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

function formatPct(n: number, decimals: number = 1): string {
  return n.toFixed(decimals) + '%';
}

// ============================================================================
// Check 1: Formula WAR vs Game WAR
// ============================================================================

function checkWarCorrelation(year: number): void {
  console.log('\n' + '='.repeat(80));
  console.log(`CHECK 1: Formula WAR vs Game WAR (${year})`);
  console.log('='.repeat(80));

  // --- Batters ---
  console.log('\n--- BATTERS (200+ PA) ---\n');
  const batters = loadAllBatters(year, 200);
  if (batters.length === 0) {
    console.log('  No batter data found.');
  } else {
    const formulaWars: number[] = [];
    const gameWars: number[] = [];
    const outliers: { id: number; formula: number; game: number; diff: number }[] = [];

    for (const b of batters) {
      const { war } = computeBatterWar(b);
      formulaWars.push(war);
      gameWars.push(b.gameWar);

      const diff = Math.abs(war - b.gameWar);
      if (diff > 3.0) {
        outliers.push({ id: b.playerId, formula: war, game: b.gameWar, diff });
      }
    }

    const r = correlation(formulaWars, gameWars);
    console.log(`  Players: ${batters.length}`);
    console.log(`  Correlation (r): ${r.toFixed(4)}`);
    console.log(`  Formula WAR: mean=${mean(formulaWars).toFixed(2)}, stddev=${stddev(formulaWars).toFixed(2)}`);
    console.log(`  Game WAR:    mean=${mean(gameWars).toFixed(2)}, stddev=${stddev(gameWars).toFixed(2)}`);

    const diffs = formulaWars.map((f, i) => f - gameWars[i]);
    console.log(`  Difference (formula - game): mean=${mean(diffs).toFixed(2)}, stddev=${stddev(diffs).toFixed(2)}`);
    console.log(`    P10=${percentile(diffs, 10).toFixed(2)}, P50=${percentile(diffs, 50).toFixed(2)}, P90=${percentile(diffs, 90).toFixed(2)}`);

    if (outliers.length > 0) {
      console.log(`\n  Outliers (|diff| > 3.0 WAR): ${outliers.length}`);
      outliers.sort((a, b) => b.diff - a.diff);
      for (const o of outliers.slice(0, 10)) {
        console.log(`    Player ${o.id}: formula=${o.formula.toFixed(1)}, game=${o.game.toFixed(1)}, diff=${(o.formula - o.game).toFixed(1)}`);
      }
    } else {
      console.log(`\n  No outliers (all within 3.0 WAR). PASS`);
    }

    // Sanity thresholds
    if (r > 0.75) {
      console.log(`\n  [PASS] Correlation ${r.toFixed(3)} > 0.75`);
    } else if (r > 0.60) {
      console.log(`\n  [WARN] Correlation ${r.toFixed(3)} is moderate (0.60-0.75)`);
    } else {
      console.log(`\n  [FAIL] Correlation ${r.toFixed(3)} < 0.60 — formula may be miscalibrated`);
    }
  }

  // --- Pitchers ---
  console.log('\n--- PITCHERS (50+ IP) ---\n');
  const pitchers = loadAllPitchers(year, 50);
  if (pitchers.length === 0) {
    console.log('  No pitcher data found.');
  } else {
    const formulaWars: number[] = [];
    const gameWars: number[] = [];
    const outliers: { id: number; formula: number; game: number; diff: number }[] = [];

    for (const p of pitchers) {
      const { war } = computePitcherWar(p);
      formulaWars.push(war);
      gameWars.push(p.gameWar);

      const diff = Math.abs(war - p.gameWar);
      if (diff > 3.0) {
        outliers.push({ id: p.playerId, formula: war, game: p.gameWar, diff });
      }
    }

    const r = correlation(formulaWars, gameWars);
    console.log(`  Players: ${pitchers.length}`);
    console.log(`  Correlation (r): ${r.toFixed(4)}`);
    console.log(`  Formula WAR: mean=${mean(formulaWars).toFixed(2)}, stddev=${stddev(formulaWars).toFixed(2)}`);
    console.log(`  Game WAR:    mean=${mean(gameWars).toFixed(2)}, stddev=${stddev(gameWars).toFixed(2)}`);

    const diffs = formulaWars.map((f, i) => f - gameWars[i]);
    console.log(`  Difference (formula - game): mean=${mean(diffs).toFixed(2)}, stddev=${stddev(diffs).toFixed(2)}`);

    if (outliers.length > 0) {
      console.log(`\n  Outliers (|diff| > 3.0 WAR): ${outliers.length}`);
      outliers.sort((a, b) => b.diff - a.diff);
      for (const o of outliers.slice(0, 10)) {
        console.log(`    Player ${o.id}: formula=${o.formula.toFixed(1)}, game=${o.game.toFixed(1)}, diff=${(o.formula - o.game).toFixed(1)}`);
      }
    } else {
      console.log(`\n  No outliers (all within 3.0 WAR). PASS`);
    }

    if (r > 0.75) {
      console.log(`\n  [PASS] Correlation ${r.toFixed(3)} > 0.75`);
    } else if (r > 0.60) {
      console.log(`\n  [WARN] Correlation ${r.toFixed(3)} is moderate (0.60-0.75)`);
    } else {
      console.log(`\n  [FAIL] Correlation ${r.toFixed(3)} < 0.60`);
    }
  }
}

// ============================================================================
// Check 2: Distribution Shape
// ============================================================================

function checkDistributions(year: number): void {
  console.log('\n' + '='.repeat(80));
  console.log(`CHECK 2: Rate Distributions (${year})`);
  console.log('='.repeat(80));

  // --- Batters ---
  console.log('\n--- BATTERS (200+ PA) ---\n');
  const batters = loadAllBatters(year, 200);
  if (batters.length > 0) {
    const bbPcts = batters.map(b => (b.bb / b.pa) * 100);
    const kPcts = batters.map(b => (b.k / b.pa) * 100);
    const hrPcts = batters.map(b => (b.hr / b.pa) * 100);
    const avgs = batters.map(b => b.ab > 0 ? b.h / b.ab : 0);
    const wars = batters.map(b => computeBatterWar(b).war);

    const printDist = (label: string, values: number[], fmt: (n: number) => string) => {
      console.log(`  ${label} (n=${values.length}):`);
      console.log(`    Mean=${fmt(mean(values))}, StdDev=${fmt(stddev(values))}`);
      console.log(`    P5=${fmt(percentile(values, 5))}, P25=${fmt(percentile(values, 25))}, P50=${fmt(percentile(values, 50))}, P75=${fmt(percentile(values, 75))}, P95=${fmt(percentile(values, 95))}`);
    };

    printDist('BB%', bbPcts, n => formatPct(n));
    printDist('K%', kPcts, n => formatPct(n));
    printDist('HR%', hrPcts, n => formatPct(n));
    printDist('AVG', avgs, n => n.toFixed(3));
    printDist('WAR/600', wars, n => n.toFixed(1));

    // League totals
    const totalPa = batters.reduce((s, b) => s + b.pa, 0);
    const totalHr = batters.reduce((s, b) => s + b.hr, 0);
    const totalBb = batters.reduce((s, b) => s + b.bb, 0);
    const totalK = batters.reduce((s, b) => s + b.k, 0);
    const totalH = batters.reduce((s, b) => s + b.h, 0);
    const totalAb = batters.reduce((s, b) => s + b.ab, 0);
    console.log(`\n  League Totals (200+ PA qualifiers):`);
    console.log(`    Players: ${batters.length}, Total PA: ${totalPa}`);
    console.log(`    HR: ${totalHr}, BB: ${totalBb}, K: ${totalK}, H: ${totalH}`);
    console.log(`    League AVG: ${(totalH / totalAb).toFixed(3)}, League BB%: ${formatPct((totalBb / totalPa) * 100)}, League K%: ${formatPct((totalK / totalPa) * 100)}`);
  }

  // --- Pitchers ---
  console.log('\n--- PITCHERS (50+ IP) ---\n');
  const pitchers = loadAllPitchers(year, 50);
  if (pitchers.length > 0) {
    const k9s = pitchers.map(p => (p.k / p.ip) * 9);
    const bb9s = pitchers.map(p => (p.bb / p.ip) * 9);
    const hr9s = pitchers.map(p => (p.hra / p.ip) * 9);
    const fips = pitchers.map(p => computePitcherFip(p));

    const printDist = (label: string, values: number[], fmt: (n: number) => string) => {
      console.log(`  ${label} (n=${values.length}):`);
      console.log(`    Mean=${fmt(mean(values))}, StdDev=${fmt(stddev(values))}`);
      console.log(`    P5=${fmt(percentile(values, 5))}, P25=${fmt(percentile(values, 25))}, P50=${fmt(percentile(values, 50))}, P75=${fmt(percentile(values, 75))}, P95=${fmt(percentile(values, 95))}`);
    };

    printDist('K/9', k9s, n => n.toFixed(2));
    printDist('BB/9', bb9s, n => n.toFixed(2));
    printDist('HR/9', hr9s, n => n.toFixed(2));
    printDist('FIP', fips, n => n.toFixed(2));

    const totalIp = pitchers.reduce((s, p) => s + p.ip, 0);
    const totalK = pitchers.reduce((s, p) => s + p.k, 0);
    const totalBb = pitchers.reduce((s, p) => s + p.bb, 0);
    const totalHra = pitchers.reduce((s, p) => s + p.hra, 0);
    console.log(`\n  League Totals (50+ IP qualifiers):`);
    console.log(`    Pitchers: ${pitchers.length}, Total IP: ${totalIp.toFixed(1)}`);
    console.log(`    K: ${totalK}, BB: ${totalBb}, HR: ${totalHra}`);
    console.log(`    League K/9: ${((totalK / totalIp) * 9).toFixed(2)}, League BB/9: ${((totalBb / totalIp) * 9).toFixed(2)}, League HR/9: ${((totalHra / totalIp) * 9).toFixed(2)}`);
  }
}

// ============================================================================
// Check 3: Year-over-Year Stability
// ============================================================================

function checkStability(year1: number, year2: number): void {
  console.log('\n' + '='.repeat(80));
  console.log(`CHECK 3: Year-over-Year Stability (${year1} vs ${year2})`);
  console.log('='.repeat(80));

  // --- Batters ---
  console.log('\n--- BATTERS ---\n');
  const batters1 = loadAllBatters(year1, 300);
  const batters2 = loadAllBatters(year2, 300);

  const bMap1 = new Map(batters1.map(b => [b.playerId, b]));
  const bMap2 = new Map(batters2.map(b => [b.playerId, b]));

  const commonBatters = batters1.filter(b => bMap2.has(b.playerId));
  console.log(`  Players in both years (300+ PA each): ${commonBatters.length}`);

  if (commonBatters.length >= 10) {
    const war1: number[] = [];
    const war2: number[] = [];
    const warDiffs: number[] = [];
    const bigSwings: { id: number; w1: number; w2: number; diff: number }[] = [];

    for (const b1 of commonBatters) {
      const b2 = bMap2.get(b1.playerId)!;
      const w1 = computeBatterWar(b1).war;
      const w2 = computeBatterWar(b2).war;
      war1.push(w1);
      war2.push(w2);
      const diff = w2 - w1;
      warDiffs.push(diff);

      if (Math.abs(diff) > 3.0) {
        bigSwings.push({ id: b1.playerId, w1, w2, diff });
      }
    }

    const r = correlation(war1, war2);
    console.log(`  WAR correlation (${year1} vs ${year2}): r=${r.toFixed(4)}`);
    console.log(`  WAR change: mean=${mean(warDiffs).toFixed(2)}, stddev=${stddev(warDiffs).toFixed(2)}`);
    console.log(`    P10=${percentile(warDiffs, 10).toFixed(2)}, P50=${percentile(warDiffs, 50).toFixed(2)}, P90=${percentile(warDiffs, 90).toFixed(2)}`);

    if (bigSwings.length > 0) {
      console.log(`\n  Big swings (|diff| > 3.0 WAR): ${bigSwings.length}`);
      bigSwings.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      for (const s of bigSwings.slice(0, 5)) {
        console.log(`    Player ${s.id}: ${year1}=${s.w1.toFixed(1)} → ${year2}=${s.w2.toFixed(1)} (${s.diff > 0 ? '+' : ''}${s.diff.toFixed(1)})`);
      }
    }

    if (r > 0.50) {
      console.log(`\n  [PASS] Year-over-year correlation ${r.toFixed(3)} > 0.50`);
    } else if (r > 0.30) {
      console.log(`\n  [WARN] Year-over-year correlation ${r.toFixed(3)} is weak (0.30-0.50)`);
    } else {
      console.log(`\n  [FAIL] Year-over-year correlation ${r.toFixed(3)} < 0.30 — ratings may be too volatile`);
    }
  }

  // --- Pitchers ---
  console.log('\n--- PITCHERS ---\n');
  const pitchers1 = loadAllPitchers(year1, 80);
  const pitchers2 = loadAllPitchers(year2, 80);

  const pMap1 = new Map(pitchers1.map(p => [p.playerId, p]));
  const pMap2 = new Map(pitchers2.map(p => [p.playerId, p]));

  const commonPitchers = pitchers1.filter(p => pMap2.has(p.playerId));
  console.log(`  Players in both years (80+ IP each): ${commonPitchers.length}`);

  if (commonPitchers.length >= 10) {
    const fip1: number[] = [];
    const fip2: number[] = [];
    const fipDiffs: number[] = [];

    for (const p1 of commonPitchers) {
      const p2 = pMap2.get(p1.playerId)!;
      const f1 = computePitcherFip(p1);
      const f2 = computePitcherFip(p2);
      fip1.push(f1);
      fip2.push(f2);
      fipDiffs.push(f2 - f1);
    }

    const r = correlation(fip1, fip2);
    console.log(`  FIP correlation (${year1} vs ${year2}): r=${r.toFixed(4)}`);
    console.log(`  FIP change: mean=${mean(fipDiffs).toFixed(2)}, stddev=${stddev(fipDiffs).toFixed(2)}`);

    if (r > 0.50) {
      console.log(`\n  [PASS] Year-over-year correlation ${r.toFixed(3)} > 0.50`);
    } else if (r > 0.30) {
      console.log(`\n  [WARN] Year-over-year correlation ${r.toFixed(3)} is weak (0.30-0.50)`);
    } else {
      console.log(`\n  [FAIL] Year-over-year correlation ${r.toFixed(3)} < 0.30`);
    }
  }
}

// ============================================================================
// Check 4: Extreme Value Detection
// ============================================================================

function checkExtremes(year: number): void {
  console.log('\n' + '='.repeat(80));
  console.log(`CHECK 4: Extreme Value Detection (${year})`);
  console.log('='.repeat(80));

  // --- Batters ---
  console.log('\n--- BATTERS (200+ PA) ---\n');
  const batters = loadAllBatters(year, 200);
  if (batters.length > 0) {
    const issues: string[] = [];

    for (const b of batters) {
      const bbPct = (b.bb / b.pa) * 100;
      const kPct = (b.k / b.pa) * 100;
      const hrPct = (b.hr / b.pa) * 100;
      const avg = b.ab > 0 ? b.h / b.ab : 0;
      const { war, woba } = computeBatterWar(b);

      if (bbPct > 25) issues.push(`Player ${b.playerId}: BB% = ${bbPct.toFixed(1)}% (>25%)`);
      if (kPct > 40) issues.push(`Player ${b.playerId}: K% = ${kPct.toFixed(1)}% (>40%)`);
      if (avg < 0.100 && b.ab > 100) issues.push(`Player ${b.playerId}: AVG = ${avg.toFixed(3)} (<.100)`);
      if (war > 12) issues.push(`Player ${b.playerId}: WAR = ${war.toFixed(1)} (>12)`);
      if (war < -5) issues.push(`Player ${b.playerId}: WAR = ${war.toFixed(1)} (<-5)`);
      if (woba > 0.500) issues.push(`Player ${b.playerId}: wOBA = ${woba.toFixed(3)} (>0.500)`);
      if (woba < 0.200 && b.pa > 300) issues.push(`Player ${b.playerId}: wOBA = ${woba.toFixed(3)} (<0.200)`);
    }

    if (issues.length === 0) {
      console.log(`  No extreme values detected. [PASS]`);
    } else {
      console.log(`  ${issues.length} extreme values detected:`);
      for (const issue of issues) {
        console.log(`    ${issue}`);
      }
    }
  }

  // --- Pitchers ---
  console.log('\n--- PITCHERS (50+ IP) ---\n');
  const pitchers = loadAllPitchers(year, 50);
  if (pitchers.length > 0) {
    const issues: string[] = [];

    for (const p of pitchers) {
      const k9 = (p.k / p.ip) * 9;
      const bb9 = (p.bb / p.ip) * 9;
      const hr9 = (p.hra / p.ip) * 9;
      const fip = computePitcherFip(p);

      if (k9 > 15) issues.push(`Player ${p.playerId}: K/9 = ${k9.toFixed(2)} (>15)`);
      if (bb9 > 8) issues.push(`Player ${p.playerId}: BB/9 = ${bb9.toFixed(2)} (>8)`);
      if (hr9 > 3) issues.push(`Player ${p.playerId}: HR/9 = ${hr9.toFixed(2)} (>3)`);
      if (fip > 8) issues.push(`Player ${p.playerId}: FIP = ${fip.toFixed(2)} (>8)`);
      if (fip < 1.5) issues.push(`Player ${p.playerId}: FIP = ${fip.toFixed(2)} (<1.5)`);
    }

    if (issues.length === 0) {
      console.log(`  No extreme values detected. [PASS]`);
    } else {
      console.log(`  ${issues.length} extreme values detected:`);
      for (const issue of issues) {
        console.log(`    ${issue}`);
      }
    }
  }
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);
let year = 2020;
let check = 'all';

for (const arg of args) {
  if (arg.startsWith('--year=')) {
    year = parseInt(arg.split('=')[1]) || 2020;
  } else if (arg.startsWith('--check=')) {
    check = arg.split('=')[1];
  }
}

console.log('='.repeat(80));
console.log(`TR VALIDATION REPORT — Year: ${year}`);
console.log('='.repeat(80));

const checks: Record<string, () => void> = {
  war: () => checkWarCorrelation(year),
  dist: () => checkDistributions(year),
  stability: () => checkStability(year - 1, year),
  extremes: () => checkExtremes(year),
};

if (check === 'all') {
  for (const fn of Object.values(checks)) fn();
} else if (checks[check]) {
  checks[check]();
} else {
  console.error(`Unknown check: ${check}. Valid: all, war, dist, stability, extremes`);
  process.exit(1);
}

console.log('\n' + '='.repeat(80));
console.log('Validation complete.');
console.log('='.repeat(80));
