/**
 * Win Projection Calibration Tool
 *
 * Analyzes the relationship between WAR and team wins using historical data.
 *
 * Two analyses:
 *   Path A: OOTP WAR (from standings CSVs) vs Wins — validates the general approach
 *   Path B: Our WAR (computed from raw stats) vs Wins — calibrates our specific framework
 *
 * Also compares our WAR to OOTP WAR to identify systematic differences.
 *
 * Usage:
 *   npx tsx tools/calibrate_wins.ts
 *   npx tsx tools/calibrate_wins.ts --year=2020          # Single year deep dive
 *   npx tsx tools/calibrate_wins.ts --path-b-only        # Skip OOTP WAR analysis
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const MLB_PITCHING_DIR = path.join(process.cwd(), 'public', 'data', 'mlb');
const MLB_BATTING_DIR = path.join(process.cwd(), 'public', 'data', 'mlb_batting');

// ============================================================================
// Constants (must match service files)
// ============================================================================

const WOBA_WEIGHTS = { bb: 0.69, single: 0.89, double: 1.27, triple: 1.62, hr: 2.10 };
const FIP_CONSTANT = 3.47;

// Batter WAR constants
const BATTER_LG_WOBA = 0.315;
const BATTER_WOBA_SCALE = 1.15;
const BATTER_RUNS_PER_WIN = 10;
const BATTER_REPLACEMENT_RUNS_PER_600PA = 20;

// Pitcher WAR constants
const PITCHER_REPLACEMENT_FIP = 5.20;
const PITCHER_RUNS_PER_WIN = 8.50;

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
// Standings Data (Path A)
// ============================================================================

interface StandingsRow {
  year: number;
  teamAbbr: string;       // 3-letter abbreviation extracted from mangled name
  teamNameRaw: string;     // Original mangled name from CSV
  wins: number;
  losses: number;
  ooptBatterWar: number;
  ooptPitcherWar: number;
  ooptTotalWar: number;
  winsMinusWar: number;
}

function extractAbbreviation(mangledName: string): string {
  // Names are like "TorontoTOR", "St. LuciaSTU", "Sint MaartenSMT"
  // The last 3 characters are always the abbreviation
  return mangledName.slice(-3).toUpperCase();
}

function loadStandings(year: number): StandingsRow[] {
  const filePath = path.join(DATA_DIR, `${year}_standings.csv`);
  if (!fs.existsSync(filePath)) return [];

  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));

  const idx = {
    team: headers.indexOf('Team'),
    w: headers.indexOf('W'),
    l: headers.indexOf('L'),
    bWar: headers.indexOf('BatterWAR'),
    pWar: headers.indexOf('PitcherWAR'),
    tWar: headers.indexOf('TotalWAR'),
    wMinusWar: headers.indexOf('Wins -WAR'),
  };

  return rows.map(row => ({
    year,
    teamAbbr: extractAbbreviation(row[idx.team]),
    teamNameRaw: row[idx.team],
    wins: parseInt(row[idx.w]) || 0,
    losses: parseInt(row[idx.l]) || 0,
    ooptBatterWar: parseFloat(row[idx.bWar]) || 0,
    ooptPitcherWar: parseFloat(row[idx.pWar]) || 0,
    ooptTotalWar: parseFloat(row[idx.tWar]) || 0,
    winsMinusWar: parseFloat(row[idx.wMinusWar]) || 0,
  }));
}

function loadAllStandings(): StandingsRow[] {
  const all: StandingsRow[] = [];
  for (let year = 2005; year <= 2020; year++) {
    all.push(...loadStandings(year));
  }
  return all;
}

// ============================================================================
// Our WAR Computation (Path B)
// ============================================================================

interface TeamWar {
  teamId: number;
  batterWar: number;
  pitcherWar: number;
  totalWar: number;
  batterCount: number;
  pitcherCount: number;
  // OOTP WAR from the stats CSVs (for matching to standings)
  ooptBatterWar: number;
  ooptPitcherWar: number;
  ooptTotalWar: number;
}

function computeOurBatterWar(pa: number, ab: number, h: number, d: number, t: number,
                              hr: number, bb: number, sb: number, cs: number): number {
  if (pa === 0) return 0;

  const singles = h - d - t - hr;
  const bbRate = bb / pa;
  const singleRate = singles / pa;
  const doubleRate = d / pa;
  const tripleRate = t / pa;
  const hrRate = hr / pa;

  const woba = WOBA_WEIGHTS.bb * bbRate +
               WOBA_WEIGHTS.single * singleRate +
               WOBA_WEIGHTS.double * doubleRate +
               WOBA_WEIGHTS.triple * tripleRate +
               WOBA_WEIGHTS.hr * hrRate;

  const wRAA = ((woba - BATTER_LG_WOBA) / BATTER_WOBA_SCALE) * pa;
  const replacementRuns = (pa / 600) * BATTER_REPLACEMENT_RUNS_PER_600PA;
  const sbRuns = sb * 0.2 - cs * 0.4;

  return (wRAA + replacementRuns + sbRuns) / BATTER_RUNS_PER_WIN;
}

function computeOurPitcherWar(ip: number, k: number, bb: number, hra: number): number {
  if (ip === 0) return 0;

  const k9 = (k / ip) * 9;
  const bb9 = (bb / ip) * 9;
  const hr9 = (hra / ip) * 9;
  const fip = ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + FIP_CONSTANT;

  return ((PITCHER_REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (ip / 9);
}

function loadOurWarByTeam(year: number): Map<number, TeamWar> {
  const teamMap = new Map<number, TeamWar>();

  const ensureTeam = (teamId: number): TeamWar => {
    if (!teamMap.has(teamId)) {
      teamMap.set(teamId, {
        teamId, batterWar: 0, pitcherWar: 0, totalWar: 0,
        batterCount: 0, pitcherCount: 0,
        ooptBatterWar: 0, ooptPitcherWar: 0, ooptTotalWar: 0,
      });
    }
    return teamMap.get(teamId)!;
  };

  // Load pitchers
  const pitchingPath = path.join(MLB_PITCHING_DIR, `${year}.csv`);
  if (fs.existsSync(pitchingPath)) {
    const { headers, rows } = parseCSV(fs.readFileSync(pitchingPath, 'utf-8'));
    const idx = {
      player_id: headers.indexOf('player_id'),
      team_id: headers.indexOf('team_id'),
      split_id: headers.indexOf('split_id'),
      league_id: headers.indexOf('league_id'),
      level_id: headers.indexOf('level_id'),
      ip: headers.indexOf('ip'),
      k: headers.indexOf('k'),
      bb: headers.indexOf('bb'),
      hra: headers.indexOf('hra'),
      war: headers.indexOf('war'),
    };

    for (const row of rows) {
      if (parseInt(row[idx.split_id]) !== 1) continue;     // overall split only
      if (parseInt(row[idx.level_id]) !== 1) continue;      // MLB only (level 1)

      const teamId = parseInt(row[idx.team_id]);
      const ip = parseIp(row[idx.ip]);
      if (ip <= 0 || isNaN(teamId)) continue;

      const k = parseInt(row[idx.k]) || 0;
      const bb = parseInt(row[idx.bb]) || 0;
      const hra = parseInt(row[idx.hra]) || 0;

      const war = computeOurPitcherWar(ip, k, bb, hra);
      const ooptWar = parseFloat(row[idx.war]) || 0;
      const team = ensureTeam(teamId);
      team.pitcherWar += war;
      team.ooptPitcherWar += ooptWar;
      team.pitcherCount++;
    }
  }

  // Load batters
  const battingPath = path.join(MLB_BATTING_DIR, `${year}_batting.csv`);
  if (fs.existsSync(battingPath)) {
    const { headers, rows } = parseCSV(fs.readFileSync(battingPath, 'utf-8'));
    const idx = {
      player_id: headers.indexOf('player_id'),
      team_id: headers.indexOf('team_id'),
      split_id: headers.indexOf('split_id'),
      league_id: headers.indexOf('league_id'),
      level_id: headers.indexOf('level_id'),
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

    for (const row of rows) {
      if (parseInt(row[idx.split_id]) !== 1) continue;     // overall split only
      if (parseInt(row[idx.level_id]) !== 1) continue;      // MLB only (level 1)

      const teamId = parseInt(row[idx.team_id]);
      const pa = parseInt(row[idx.pa]) || 0;
      if (pa <= 0 || isNaN(teamId)) continue;

      const ab = parseInt(row[idx.ab]) || 0;
      const h = parseInt(row[idx.h]) || 0;
      const d = parseInt(row[idx.d]) || 0;
      const t = parseInt(row[idx.t]) || 0;
      const hr = parseInt(row[idx.hr]) || 0;
      const bb = parseInt(row[idx.bb]) || 0;
      const sb = parseInt(row[idx.sb]) || 0;
      const cs = parseInt(row[idx.cs]) || 0;

      const war = computeOurBatterWar(pa, ab, h, d, t, hr, bb, sb, cs);
      const ooptWar = parseFloat(row[idx.war]) || 0;
      const team = ensureTeam(teamId);
      team.batterWar += war;
      team.ooptBatterWar += ooptWar;
      team.batterCount++;
    }
  }

  // Compute totals
  for (const team of teamMap.values()) {
    team.totalWar = team.batterWar + team.pitcherWar;
    team.ooptTotalWar = team.ooptBatterWar + team.ooptPitcherWar;
  }

  return teamMap;
}

// ============================================================================
// Linear Regression
// ============================================================================

interface RegressionResult {
  slope: number;
  intercept: number;
  r: number;
  rSquared: number;
  n: number;
  meanX: number;
  meanY: number;
  stdResidual: number;  // Standard error of residuals
}

function linearRegression(xs: number[], ys: number[]): RegressionResult {
  const n = xs.length;
  if (n < 2) throw new Error('Need at least 2 data points');

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let ssXX = 0, ssYY = 0, ssXY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    ssXX += dx * dx;
    ssYY += dy * dy;
    ssXY += dx * dy;
  }

  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  const rSquared = r * r;

  // Residual standard error
  let ssResidual = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    ssResidual += (ys[i] - predicted) ** 2;
  }
  const stdResidual = Math.sqrt(ssResidual / (n - 2));

  return { slope, intercept, r, rSquared, n, meanX, meanY, stdResidual };
}

// ============================================================================
// Analysis Output
// ============================================================================

function printSeparator(title: string): void {
  console.log('\n' + '='.repeat(72));
  console.log(`  ${title}`);
  console.log('='.repeat(72));
}

function printRegression(label: string, reg: RegressionResult): void {
  console.log(`\n  ${label}:`);
  console.log(`    Formula:  Wins = ${reg.slope.toFixed(3)} × WAR + ${reg.intercept.toFixed(1)}`);
  console.log(`    R² = ${reg.rSquared.toFixed(4)}  (r = ${reg.r.toFixed(4)})`);
  console.log(`    N = ${reg.n} team-seasons`);
  console.log(`    Residual SE = ${reg.stdResidual.toFixed(2)} wins`);
  console.log(`    Mean WAR = ${reg.meanX.toFixed(1)}, Mean Wins = ${reg.meanY.toFixed(1)}`);
  console.log(`    Baseline (WAR=0): ${reg.intercept.toFixed(1)} wins`);
}

// ============================================================================
// Path A: OOTP WAR vs Wins
// ============================================================================

function analyzePathA(standings: StandingsRow[]): RegressionResult {
  printSeparator('PATH A: OOTP WAR vs Wins');

  const wars = standings.map(s => s.ooptTotalWar);
  const wins = standings.map(s => s.wins);
  const reg = linearRegression(wars, wins);

  printRegression('Total WAR → Wins', reg);

  // Also check batter WAR and pitcher WAR separately
  const bReg = linearRegression(standings.map(s => s.ooptBatterWar), wins);
  const pReg = linearRegression(standings.map(s => s.ooptPitcherWar), wins);
  printRegression('Batter WAR → Wins', bReg);
  printRegression('Pitcher WAR → Wins', pReg);

  // Year-by-year summary
  console.log('\n  Year-by-year league averages:');
  console.log('    Year  Teams  AvgWAR  AvgWins  Avg(W-WAR)  R²');
  console.log('    ' + '-'.repeat(56));

  const yearSet = [...new Set(standings.map(s => s.year))].sort();
  for (const yr of yearSet) {
    const yrRows = standings.filter(s => s.year === yr);
    const avgWar = yrRows.reduce((a, s) => a + s.ooptTotalWar, 0) / yrRows.length;
    const avgWins = yrRows.reduce((a, s) => a + s.wins, 0) / yrRows.length;
    const avgWmWar = yrRows.reduce((a, s) => a + s.winsMinusWar, 0) / yrRows.length;
    const yrReg = linearRegression(yrRows.map(s => s.ooptTotalWar), yrRows.map(s => s.wins));
    console.log(`    ${yr}  ${String(yrRows.length).padStart(5)}  ${avgWar.toFixed(1).padStart(6)}  ${avgWins.toFixed(1).padStart(7)}  ${avgWmWar.toFixed(1).padStart(10)}  ${yrReg.rSquared.toFixed(3)}`);
  }

  // Biggest outliers
  console.log('\n  Biggest outliers (Actual - Predicted):');
  const predictions = standings.map(s => ({
    ...s,
    predicted: reg.slope * s.ooptTotalWar + reg.intercept,
    residual: s.wins - (reg.slope * s.ooptTotalWar + reg.intercept),
  }));
  predictions.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));

  console.log('    Year  Team         WAR   Wins  Pred   Diff');
  console.log('    ' + '-'.repeat(50));
  for (const p of predictions.slice(0, 10)) {
    console.log(`    ${p.year}  ${p.teamAbbr.padEnd(10)}  ${p.ooptTotalWar.toFixed(1).padStart(5)}  ${String(p.wins).padStart(4)}  ${p.predicted.toFixed(0).padStart(4)}  ${(p.residual > 0 ? '+' : '') + p.residual.toFixed(1).padStart(5)}`);
  }

  return reg;
}

// ============================================================================
// Path B: Our WAR vs Wins
// ============================================================================

interface MatchedTeamYear {
  year: number;
  teamAbbr: string;
  teamId: number;
  wins: number;
  ooptTotalWar: number;
  ourBatterWar: number;
  ourPitcherWar: number;
  ourTotalWar: number;
}

function analyzePathB(standings: StandingsRow[]): RegressionResult | null {
  printSeparator('PATH B: Our WAR vs Wins');

  // For each year, compute our WAR by team, then match team_ids to standings
  // using the OOTP WAR columns from the stats CSVs (same WAR as standings).
  const yearSet = [...new Set(standings.map(s => s.year))].sort();
  const matched: MatchedTeamYear[] = [];
  let matchFailures = 0;
  let matchSuccesses = 0;

  for (const year of yearSet) {
    const pitchingFile = path.join(MLB_PITCHING_DIR, `${year}.csv`);
    const battingFile = path.join(MLB_BATTING_DIR, `${year}_batting.csv`);

    if (!fs.existsSync(pitchingFile) || !fs.existsSync(battingFile)) {
      console.log(`  ⏭️  Skipping ${year} — missing stats CSVs`);
      continue;
    }

    const ourTeamWar = loadOurWarByTeam(year);
    const yrStandings = standings.filter(s => s.year === year);

    // Match using OOTP WAR from the stats CSVs as a bridge.
    // The stats CSVs contain the same `war` column as the standings, broken down
    // by team_id. Summing by team_id should produce values that closely match
    // the standings. Use both batter and pitcher OOTP WAR for robust matching.
    const teamWarList = [...ourTeamWar.values()];
    const usedTeamIds = new Set<number>();

    for (const st of yrStandings) {
      let bestMatch: TeamWar | null = null;
      let bestDiff = Infinity;

      for (const tw of teamWarList) {
        if (usedTeamIds.has(tw.teamId)) continue;
        // Match on OOTP WAR components (same WAR framework = near-exact match)
        const diff = Math.abs(st.ooptBatterWar - tw.ooptBatterWar) +
                     Math.abs(st.ooptPitcherWar - tw.ooptPitcherWar);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMatch = tw;
        }
      }

      // Accept match if OOTP WAR totals agree within 2.0 (accounts for rounding)
      if (bestMatch && bestDiff < 2.0) {
        usedTeamIds.add(bestMatch.teamId);
        matchSuccesses++;
        matched.push({
          year,
          teamAbbr: st.teamAbbr,
          teamId: bestMatch.teamId,
          wins: st.wins,
          ooptTotalWar: st.ooptTotalWar,
          ourBatterWar: bestMatch.batterWar,
          ourPitcherWar: bestMatch.pitcherWar,
          ourTotalWar: bestMatch.totalWar,
        });
      } else {
        matchFailures++;
        if (bestMatch) {
          console.log(`  ⚠️  ${year} ${st.teamAbbr}: best match teamId=${bestMatch.teamId} but diff=${bestDiff.toFixed(1)} (too large)`);
        }
      }
    }
  }

  if (matched.length < 10) {
    console.log(`\n  ❌ Only matched ${matched.length} team-years — not enough data.`);
    return null;
  }

  console.log(`\n  Matched ${matched.length} team-years (${matchFailures} failures)`);

  // Regression: Our WAR → Wins
  const ourWars = matched.map(m => m.ourTotalWar);
  const wins = matched.map(m => m.wins);
  const reg = linearRegression(ourWars, wins);
  printRegression('Our Total WAR → Wins', reg);

  // Also check components
  const bReg = linearRegression(matched.map(m => m.ourBatterWar), wins);
  const pReg = linearRegression(matched.map(m => m.ourPitcherWar), wins);
  printRegression('Our Batter WAR → Wins', bReg);
  printRegression('Our Pitcher WAR → Wins', pReg);

  // Compare our WAR to OOTP WAR
  printSeparator('OUR WAR vs OOTP WAR COMPARISON');

  const warComparison = linearRegression(
    matched.map(m => m.ooptTotalWar),
    matched.map(m => m.ourTotalWar)
  );
  console.log(`\n  OOTP WAR → Our WAR:`);
  console.log(`    Our WAR = ${warComparison.slope.toFixed(3)} × OOTP WAR + ${warComparison.intercept.toFixed(1)}`);
  console.log(`    R² = ${warComparison.rSquared.toFixed(4)}`);

  const avgOopt = matched.reduce((a, m) => a + m.ooptTotalWar, 0) / matched.length;
  const avgOurs = matched.reduce((a, m) => a + m.ourTotalWar, 0) / matched.length;
  console.log(`    Average OOTP WAR: ${avgOopt.toFixed(1)}`);
  console.log(`    Average Our WAR:  ${avgOurs.toFixed(1)}`);
  console.log(`    Systematic diff:  ${(avgOurs - avgOopt).toFixed(1)} (${avgOurs > avgOopt ? 'ours higher' : 'ours lower'})`);

  // Per-component comparison
  console.log(`\n  Component averages (per team-year):`);
  console.log(`               OOTP     Ours     Diff`);
  const standingsMap = new Map(standings.map(s => [`${s.year}_${s.teamAbbr}`, s]));
  let sumOoptBat = 0, sumOursBat = 0, sumOoptPit = 0, sumOursPit = 0;
  for (const m of matched) {
    const st = standingsMap.get(`${m.year}_${m.teamAbbr}`);
    if (st) {
      sumOoptBat += st.ooptBatterWar;
      sumOoptPit += st.ooptPitcherWar;
    }
    sumOursBat += m.ourBatterWar;
    sumOursPit += m.ourPitcherWar;
  }
  const n = matched.length;
  console.log(`    Batting:  ${(sumOoptBat / n).toFixed(1).padStart(6)}   ${(sumOursBat / n).toFixed(1).padStart(6)}   ${((sumOursBat - sumOoptBat) / n).toFixed(1).padStart(6)}`);
  console.log(`    Pitching: ${(sumOoptPit / n).toFixed(1).padStart(6)}   ${(sumOursPit / n).toFixed(1).padStart(6)}   ${((sumOursPit - sumOoptPit) / n).toFixed(1).padStart(6)}`);
  console.log(`    Total:    ${(avgOopt).toFixed(1).padStart(6)}   ${(avgOurs).toFixed(1).padStart(6)}   ${((avgOurs - avgOopt)).toFixed(1).padStart(6)}`);

  // Year-by-year
  console.log('\n  Year-by-year: Our WAR vs Wins');
  console.log('    Year  Teams  AvgOurWAR  AvgWins  R²');
  console.log('    ' + '-'.repeat(45));

  const matchedYears = [...new Set(matched.map(m => m.year))].sort();
  for (const yr of matchedYears) {
    const yrRows = matched.filter(m => m.year === yr);
    const avgWar = yrRows.reduce((a, m) => a + m.ourTotalWar, 0) / yrRows.length;
    const avgWins = yrRows.reduce((a, m) => a + m.wins, 0) / yrRows.length;
    const yrReg = linearRegression(yrRows.map(m => m.ourTotalWar), yrRows.map(m => m.wins));
    console.log(`    ${yr}  ${String(yrRows.length).padStart(5)}  ${avgWar.toFixed(1).padStart(9)}  ${avgWins.toFixed(1).padStart(7)}  ${yrReg.rSquared.toFixed(3)}`);
  }

  // Sample matches for verification
  console.log('\n  Sample team matches (2020, verify mapping):');
  console.log('    Abbr       TeamID  OoptWAR  OurWAR   Wins');
  console.log('    ' + '-'.repeat(50));
  const yr2020 = matched.filter(m => m.year === 2020).sort((a, b) => b.wins - a.wins);
  for (const m of yr2020.slice(0, 10)) {
    console.log(`    ${m.teamAbbr.padEnd(10)} ${String(m.teamId).padStart(6)}  ${m.ooptTotalWar.toFixed(1).padStart(7)}  ${m.ourTotalWar.toFixed(1).padStart(6)}  ${String(m.wins).padStart(5)}`);
  }

  // Biggest outliers
  console.log('\n  Biggest outliers (Actual Wins - Predicted):');
  const predictions = matched.map(m => ({
    ...m,
    predicted: reg.slope * m.ourTotalWar + reg.intercept,
    residual: m.wins - (reg.slope * m.ourTotalWar + reg.intercept),
  }));
  predictions.sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual));

  console.log('    Year  Team       OurWAR  Wins  Pred   Diff');
  console.log('    ' + '-'.repeat(50));
  for (const p of predictions.slice(0, 10)) {
    console.log(`    ${p.year}  ${p.teamAbbr.padEnd(10)} ${p.ourTotalWar.toFixed(1).padStart(6)}  ${String(p.wins).padStart(4)}  ${p.predicted.toFixed(0).padStart(4)}  ${(p.residual > 0 ? '+' : '') + p.residual.toFixed(1)}`);
  }

  return reg;
}

// ============================================================================
// Summary & Recommendations
// ============================================================================

function printRecommendations(regA: RegressionResult, regB: RegressionResult | null): void {
  printSeparator('RECOMMENDATIONS');

  console.log(`\n  Path A (OOTP WAR):`);
  console.log(`    Wins = ${regA.slope.toFixed(3)} × WAR + ${regA.intercept.toFixed(1)}`);
  console.log(`    Prediction accuracy: ±${regA.stdResidual.toFixed(1)} wins (1 SE)`);
  console.log(`    R² = ${regA.rSquared.toFixed(3)} — WAR explains ${(regA.rSquared * 100).toFixed(1)}% of win variance`);

  if (regB) {
    console.log(`\n  Path B (Our WAR):`);
    console.log(`    Wins = ${regB.slope.toFixed(3)} × WAR + ${regB.intercept.toFixed(1)}`);
    console.log(`    Prediction accuracy: ±${regB.stdResidual.toFixed(1)} wins (1 SE)`);
    console.log(`    R² = ${regB.rSquared.toFixed(3)} — Our WAR explains ${(regB.rSquared * 100).toFixed(1)}% of win variance`);

    if (Math.abs(regB.slope - 1.0) > 0.15) {
      console.log(`\n  ⚠️  Slope ${regB.slope.toFixed(3)} deviates from ideal 1.0`);
      console.log(`    This means 1 WAR ≈ ${regB.slope.toFixed(2)} wins in our framework.`);
      console.log(`    Consider: is our WAR scale inflated/deflated?`);
    }
  }

  console.log(`\n  For projections, use:`);
  if (regB) {
    console.log(`    Projected Wins = ${regB.intercept.toFixed(1)} + ${regB.slope.toFixed(3)} × Σ(team player WAR)`);
  } else {
    console.log(`    Projected Wins = ${regA.intercept.toFixed(1)} + ${regA.slope.toFixed(3)} × Σ(team player WAR)`);
    console.log(`    (Using OOTP WAR coefficients until our WAR is calibrated)`);
  }
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const args = process.argv.slice(2);
  const yearArg = args.find(a => a.startsWith('--year='));
  const pathBOnly = args.includes('--path-b-only');

  console.log('Win Projection Calibration Tool');
  console.log('Analyzing WAR → Wins relationship...\n');

  const standings = loadAllStandings();
  console.log(`Loaded ${standings.length} team-years from standings data (${[...new Set(standings.map(s => s.year))].length} years)`);

  // Unique team abbreviations for reference
  const abbrs = [...new Set(standings.map(s => s.teamAbbr))].sort();
  console.log(`Teams: ${abbrs.join(', ')}`);

  // Check for renamed teams
  const teamHistory = new Map<string, Set<string>>();
  for (const s of standings) {
    if (!teamHistory.has(s.teamAbbr)) teamHistory.set(s.teamAbbr, new Set());
    teamHistory.get(s.teamAbbr)!.add(s.teamNameRaw);
  }
  const renamedTeams = [...teamHistory.entries()].filter(([, names]) => names.size > 1);
  if (renamedTeams.length > 0) {
    console.log('\nTeams with name changes:');
    for (const [abbr, names] of renamedTeams) {
      console.log(`  ${abbr}: ${[...names].join(' → ')}`);
    }
  }

  // Filter to single year if requested
  const filteredStandings = yearArg
    ? standings.filter(s => s.year === parseInt(yearArg.split('=')[1]))
    : standings;

  let regA: RegressionResult | null = null;
  let regB: RegressionResult | null = null;

  if (!pathBOnly) {
    regA = analyzePathA(filteredStandings);
  }

  regB = analyzePathB(filteredStandings);

  if (regA || regB) {
    printRecommendations(regA || regB!, regB);
  }
}

main();
