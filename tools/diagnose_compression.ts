/**
 * Standings Compression Diagnostic Tool
 *
 * Analyzes WHERE compression comes from in the standings projection pipeline.
 * Extends calibrate_wins.ts with compression-specific diagnostics:
 *
 * 1. WAR range compression (Our WAR vs OOTP WAR range)
 * 2. Residual vs actual wins slope (the compression signature)
 * 3. MAE/bias by quartile (best/worst teams)
 * 4. WAR→Wins residual analysis (is linear model the issue?)
 *
 * Usage:
 *   npx tsx tools/diagnose_compression.ts
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
const BATTER_LG_WOBA = 0.315;
const BATTER_WOBA_SCALE = 1.15;
const BATTER_RUNS_PER_WIN = 10;
const BATTER_REPLACEMENT_RUNS_PER_600PA = 20;
const PITCHER_REPLACEMENT_FIP = 5.20;
const PITCHER_RUNS_PER_WIN = 8.50;

// Standings formula constants (recalibrated Feb 2026 — steeper slope compensates for
// batter WAR compression from missing positional/fielding adjustments)
const BASELINE_WINS = 35.0;
const WAR_SLOPE = 1.107;
const SEASON_GAMES = 162;
// Role adjustment caps kept for diagnostic comparison only (no longer used in app)
const BULLPEN_IP_CAP = 110;
const BENCH_PA_CAP = 250;

// ============================================================================
// CSV & WAR Computation (from calibrate_wins.ts)
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

interface StandingsRow {
  year: number;
  teamAbbr: string;
  teamNameRaw: string;
  wins: number;
  losses: number;
  ooptBatterWar: number;
  ooptPitcherWar: number;
  ooptTotalWar: number;
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
  };

  return rows.map(row => ({
    year,
    teamAbbr: row[idx.team].slice(-3).toUpperCase(),
    teamNameRaw: row[idx.team],
    wins: parseInt(row[idx.w]) || 0,
    losses: parseInt(row[idx.l]) || 0,
    ooptBatterWar: parseFloat(row[idx.bWar]) || 0,
    ooptPitcherWar: parseFloat(row[idx.pWar]) || 0,
    ooptTotalWar: parseFloat(row[idx.tWar]) || 0,
  }));
}

function computeBatterWar(pa: number, ab: number, h: number, d: number, t: number,
                           hr: number, bb: number, sb: number, cs: number): number {
  if (pa === 0) return 0;
  const singles = h - d - t - hr;
  const woba = WOBA_WEIGHTS.bb * (bb / pa) +
               WOBA_WEIGHTS.single * (singles / pa) +
               WOBA_WEIGHTS.double * (d / pa) +
               WOBA_WEIGHTS.triple * (t / pa) +
               WOBA_WEIGHTS.hr * (hr / pa);
  const wRAA = ((woba - BATTER_LG_WOBA) / BATTER_WOBA_SCALE) * pa;
  const replacementRuns = (pa / 600) * BATTER_REPLACEMENT_RUNS_PER_600PA;
  const sbRuns = sb * 0.2 - cs * 0.4;
  return (wRAA + replacementRuns + sbRuns) / BATTER_RUNS_PER_WIN;
}

function computePitcherWar(ip: number, k: number, bb: number, hra: number): number {
  if (ip === 0) return 0;
  const k9 = (k / ip) * 9;
  const bb9 = (bb / ip) * 9;
  const hr9 = (hra / ip) * 9;
  const fip = ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + FIP_CONSTANT;
  return ((PITCHER_REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (ip / 9);
}

interface PlayerWar {
  playerId: number;
  teamId: number;
  war: number;
  ip?: number;
  pa?: number;
  isSp?: boolean;
  isStarter?: boolean; // batter: in lineup (top 9 by WAR)
}

interface TeamWar {
  teamId: number;
  year: number;
  // Raw WAR (no role adjustment)
  batterWar: number;
  pitcherWar: number;
  totalWar: number;
  // Role-adjusted WAR (with bullpen/bench caps)
  adjBatterWar: number;
  adjPitcherWar: number;
  adjTotalWar: number;
  // Component WAR
  rotationWar: number;
  bullpenWar: number;
  lineupWar: number;
  benchWar: number;
  adjBullpenWar: number;
  adjBenchWar: number;
  // OOTP WAR for matching
  ooptBatterWar: number;
  ooptPitcherWar: number;
  ooptTotalWar: number;
  // Player counts
  pitcherCount: number;
  batterCount: number;
}

function loadTeamWarDetailed(year: number): Map<number, TeamWar> {
  const teamMap = new Map<number, TeamWar>();
  const pitcherPlayers: PlayerWar[] = [];
  const batterPlayers: PlayerWar[] = [];

  const ensureTeam = (teamId: number): TeamWar => {
    if (!teamMap.has(teamId)) {
      teamMap.set(teamId, {
        teamId, year,
        batterWar: 0, pitcherWar: 0, totalWar: 0,
        adjBatterWar: 0, adjPitcherWar: 0, adjTotalWar: 0,
        rotationWar: 0, bullpenWar: 0, lineupWar: 0, benchWar: 0,
        adjBullpenWar: 0, adjBenchWar: 0,
        ooptBatterWar: 0, ooptPitcherWar: 0, ooptTotalWar: 0,
        pitcherCount: 0, batterCount: 0,
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
      level_id: headers.indexOf('level_id'),
      ip: headers.indexOf('ip'),
      k: headers.indexOf('k'),
      bb: headers.indexOf('bb'),
      hra: headers.indexOf('hra'),
      gs: headers.indexOf('gs'),
      war: headers.indexOf('war'),
    };

    for (const row of rows) {
      if (parseInt(row[idx.split_id]) !== 1) continue;
      if (parseInt(row[idx.level_id]) !== 1) continue;

      const teamId = parseInt(row[idx.team_id]);
      const ip = parseIp(row[idx.ip]);
      if (ip <= 0 || isNaN(teamId)) continue;

      const k = parseInt(row[idx.k]) || 0;
      const bb = parseInt(row[idx.bb]) || 0;
      const hra = parseInt(row[idx.hra]) || 0;
      const gs = parseInt(row[idx.gs]) || 0;
      const isSp = gs >= 5; // 5+ GS = starter

      const war = computePitcherWar(ip, k, bb, hra);
      const ooptWar = parseFloat(row[idx.war]) || 0;
      const team = ensureTeam(teamId);
      team.pitcherWar += war;
      team.ooptPitcherWar += ooptWar;
      team.pitcherCount++;

      pitcherPlayers.push({ playerId: parseInt(row[idx.player_id]), teamId, war, ip, isSp });
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
      level_id: headers.indexOf('level_id'),
      pa: headers.indexOf('pa'),
      ab: headers.indexOf('ab'),
      h: headers.indexOf('h'),
      d: headers.indexOf('d'),
      t: headers.indexOf('t'),
      hr: headers.indexOf('hr'),
      bb: headers.indexOf('bb'),
      sb: headers.indexOf('sb'),
      cs: headers.indexOf('cs'),
      war: headers.indexOf('war'),
    };

    for (const row of rows) {
      if (parseInt(row[idx.split_id]) !== 1) continue;
      if (parseInt(row[idx.level_id]) !== 1) continue;

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

      const war = computeBatterWar(pa, ab, h, d, t, hr, bb, sb, cs);
      const ooptWar = parseFloat(row[idx.war]) || 0;
      const team = ensureTeam(teamId);
      team.batterWar += war;
      team.ooptBatterWar += ooptWar;
      team.batterCount++;

      batterPlayers.push({ playerId: parseInt(row[idx.player_id]), teamId, war, pa });
    }
  }

  // Classify rotation/bullpen, lineup/bench per team
  for (const [teamId, team] of teamMap) {
    // Pitchers: top 5 SPs by WAR = rotation, rest = bullpen
    const teamSps = pitcherPlayers.filter(p => p.teamId === teamId && p.isSp).sort((a, b) => b.war - a.war);
    const teamRps = pitcherPlayers.filter(p => p.teamId === teamId && !p.isSp);

    const rotation = teamSps.slice(0, 5);
    const bullpen = [...teamSps.slice(5), ...teamRps].sort((a, b) => b.war - a.war).slice(0, 8);

    team.rotationWar = rotation.reduce((s, p) => s + p.war, 0);
    team.bullpenWar = bullpen.reduce((s, p) => s + p.war, 0);

    // Apply bullpen IP cap
    team.adjBullpenWar = bullpen.reduce((s, p) => {
      const scale = (p.ip! > BULLPEN_IP_CAP) ? BULLPEN_IP_CAP / p.ip! : 1;
      return s + p.war * scale;
    }, 0);

    // Batters: top 9 by WAR = lineup, next 4 = bench
    const teamBatters = batterPlayers.filter(p => p.teamId === teamId).sort((a, b) => b.war - a.war);
    const lineup = teamBatters.slice(0, 9);
    const bench = teamBatters.slice(9, 13);

    team.lineupWar = lineup.reduce((s, p) => s + p.war, 0);
    team.benchWar = bench.reduce((s, p) => s + p.war, 0);

    // Apply bench PA cap
    team.adjBenchWar = bench.reduce((s, p) => {
      const scale = (p.pa! > BENCH_PA_CAP) ? BENCH_PA_CAP / p.pa! : 1;
      return s + p.war * scale;
    }, 0);

    // Totals
    team.totalWar = team.batterWar + team.pitcherWar;
    team.ooptTotalWar = team.ooptBatterWar + team.ooptPitcherWar;

    // Role-adjusted total (matches what standings mode uses)
    team.adjTotalWar = team.rotationWar + team.adjBullpenWar + team.lineupWar + team.adjBenchWar;
    team.adjBatterWar = team.lineupWar + team.adjBenchWar;
    team.adjPitcherWar = team.rotationWar + team.adjBullpenWar;
  }

  return teamMap;
}

// ============================================================================
// Matching & Regression (from calibrate_wins.ts)
// ============================================================================

interface MatchedTeam {
  year: number;
  teamAbbr: string;
  teamId: number;
  wins: number;
  ooptTotalWar: number;
  ooptBatterWar: number;
  ooptPitcherWar: number;
  ourTotalWar: number;
  ourBatterWar: number;
  ourPitcherWar: number;
  // Role-adjusted
  adjTotalWar: number;
  rotationWar: number;
  adjBullpenWar: number;
  lineupWar: number;
  adjBenchWar: number;
}

function linearRegression(xs: number[], ys: number[]) {
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let ssXX = 0, ssYY = 0, ssXY = 0;
  for (let i = 0; i < n; i++) {
    ssXX += (xs[i] - meanX) ** 2;
    ssYY += (ys[i] - meanY) ** 2;
    ssXY += (xs[i] - meanX) * (ys[i] - meanY);
  }
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  let ssRes = 0;
  for (let i = 0; i < n; i++) ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
  return { slope, intercept, r, rSquared: r * r, n, meanX, meanY, stdResidual: Math.sqrt(ssRes / (n - 2)) };
}

function matchTeams(allStandings: StandingsRow[]): MatchedTeam[] {
  const matched: MatchedTeam[] = [];
  const yearSet = [...new Set(allStandings.map(s => s.year))].sort();

  for (const year of yearSet) {
    const pitchingFile = path.join(MLB_PITCHING_DIR, `${year}.csv`);
    const battingFile = path.join(MLB_BATTING_DIR, `${year}_batting.csv`);
    if (!fs.existsSync(pitchingFile) || !fs.existsSync(battingFile)) continue;

    const ourTeamWar = loadTeamWarDetailed(year);
    const yrStandings = allStandings.filter(s => s.year === year);
    const usedTeamIds = new Set<number>();

    for (const st of yrStandings) {
      let bestMatch: TeamWar | null = null;
      let bestDiff = Infinity;

      for (const tw of ourTeamWar.values()) {
        if (usedTeamIds.has(tw.teamId)) continue;
        const diff = Math.abs(st.ooptBatterWar - tw.ooptBatterWar) +
                     Math.abs(st.ooptPitcherWar - tw.ooptPitcherWar);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestMatch = tw;
        }
      }

      if (bestMatch && bestDiff < 2.0) {
        usedTeamIds.add(bestMatch.teamId);
        matched.push({
          year, teamAbbr: st.teamAbbr, teamId: bestMatch.teamId,
          wins: st.wins,
          ooptTotalWar: st.ooptTotalWar,
          ooptBatterWar: st.ooptBatterWar,
          ooptPitcherWar: st.ooptPitcherWar,
          ourTotalWar: bestMatch.totalWar,
          ourBatterWar: bestMatch.batterWar,
          ourPitcherWar: bestMatch.pitcherWar,
          adjTotalWar: bestMatch.adjTotalWar,
          rotationWar: bestMatch.rotationWar,
          adjBullpenWar: bestMatch.adjBullpenWar,
          lineupWar: bestMatch.lineupWar,
          adjBenchWar: bestMatch.adjBenchWar,
        });
      }
    }
  }

  return matched;
}

// ============================================================================
// Diagnostic Analysis
// ============================================================================

function printSep(title: string): void {
  console.log('\n' + '='.repeat(72));
  console.log(`  ${title}`);
  console.log('='.repeat(72));
}

function computeProjectedWins(matched: MatchedTeam[], useRoleAdj: boolean): Array<MatchedTeam & { projWins: number; diff: number }> {
  // Group by year for normalization
  const byYear = new Map<number, MatchedTeam[]>();
  for (const m of matched) {
    if (!byYear.has(m.year)) byYear.set(m.year, []);
    byYear.get(m.year)!.push(m);
  }

  const result: Array<MatchedTeam & { projWins: number; diff: number }> = [];

  for (const [year, teams] of byYear) {
    const rawWinsList = teams.map(m => {
      const war = useRoleAdj ? m.adjTotalWar : m.ourTotalWar;
      return { ...m, rawWins: BASELINE_WINS + WAR_SLOPE * war };
    });

    // Normalize: total wins = numTeams × 81
    const numTeams = rawWinsList.length;
    const expectedTotal = numTeams * (SEASON_GAMES / 2);
    const currentTotal = rawWinsList.reduce((s, t) => s + t.rawWins, 0);
    const offset = (expectedTotal - currentTotal) / numTeams;

    for (const t of rawWinsList) {
      const projWins = Math.round(t.rawWins + offset);
      result.push({ ...t, projWins, diff: projWins - t.wins });
    }
  }

  return result;
}

function analyzeCompression(matched: MatchedTeam[]): void {
  // ── 1. WAR Range Compression ─────────────────────────────────────
  printSep('1. WAR RANGE COMPRESSION (Our WAR vs OOTP WAR)');

  const reg = linearRegression(
    matched.map(m => m.ooptTotalWar),
    matched.map(m => m.ourTotalWar)
  );
  console.log(`\n  Our WAR = ${reg.slope.toFixed(3)} × OOTP WAR + ${reg.intercept.toFixed(1)}`);
  console.log(`  R² = ${reg.rSquared.toFixed(4)}`);
  console.log(`  Slope ${reg.slope.toFixed(3)} → Our range is ${(reg.slope * 100).toFixed(1)}% of OOTP's range`);
  console.log(`  → ${((1 - reg.slope) * 100).toFixed(1)}% compression in our WAR formula`);

  // Show range comparison
  const ooptWars = matched.map(m => m.ooptTotalWar);
  const ourWars = matched.map(m => m.ourTotalWar);
  const ooptRange = Math.max(...ooptWars) - Math.min(...ooptWars);
  const ourRange = Math.max(...ourWars) - Math.min(...ourWars);

  console.log(`\n  OOTP WAR range: ${Math.min(...ooptWars).toFixed(1)} to ${Math.max(...ooptWars).toFixed(1)} (span: ${ooptRange.toFixed(1)})`);
  console.log(`  Our  WAR range: ${Math.min(...ourWars).toFixed(1)} to ${Math.max(...ourWars).toFixed(1)} (span: ${ourRange.toFixed(1)})`);
  console.log(`  Range ratio: ${(ourRange / ooptRange).toFixed(3)}`);

  // Component-level compression
  const batReg = linearRegression(
    matched.map(m => m.ooptBatterWar),
    matched.map(m => m.ourBatterWar)
  );
  const pitReg = linearRegression(
    matched.map(m => m.ooptPitcherWar),
    matched.map(m => m.ourPitcherWar)
  );
  console.log(`\n  Component compression:`);
  console.log(`    Batting:  slope=${batReg.slope.toFixed(3)}, intercept=${batReg.intercept.toFixed(1)}, R²=${batReg.rSquared.toFixed(3)}`);
  console.log(`    Pitching: slope=${pitReg.slope.toFixed(3)}, intercept=${pitReg.intercept.toFixed(1)}, R²=${pitReg.rSquared.toFixed(3)}`);

  // ── 2. Residual Analysis (Compression Signature) ──────────────────
  printSep('2. RESIDUAL vs ACTUAL WINS (Compression Signature)');

  // Use role-adjusted WAR for standings projection (matches app behavior)
  const projected = computeProjectedWins(matched, true);

  // Regression: diff vs actual wins
  // If slope is negative → compression (best teams under-projected, worst over-projected)
  const diffReg = linearRegression(
    projected.map(p => p.wins),
    projected.map(p => p.diff)
  );

  console.log(`\n  Diff = ${diffReg.slope.toFixed(4)} × ActualWins + ${diffReg.intercept.toFixed(1)}`);
  console.log(`  Slope = ${diffReg.slope.toFixed(4)}`);

  if (diffReg.slope < -0.1) {
    console.log(`  → SIGNIFICANT COMPRESSION: for every 10 wins of actual quality,`);
    console.log(`    our projection misses by ${Math.abs(diffReg.slope * 10).toFixed(1)} wins toward the mean`);
  } else if (diffReg.slope < 0) {
    console.log(`  → Mild compression detected`);
  } else {
    console.log(`  → No compression (or slight expansion)`);
  }

  // Also check with raw (non-role-adjusted) WAR
  const projectedRaw = computeProjectedWins(matched, false);
  const diffRegRaw = linearRegression(
    projectedRaw.map(p => p.wins),
    projectedRaw.map(p => p.diff)
  );
  console.log(`\n  With raw WAR (no role adjustment):`);
  console.log(`  Diff = ${diffRegRaw.slope.toFixed(4)} × ActualWins + ${diffRegRaw.intercept.toFixed(1)}`);
  console.log(`  Slope = ${diffRegRaw.slope.toFixed(4)}`);

  // ── 3. Quartile Analysis ──────────────────────────────────────────
  printSep('3. MAE/BIAS BY QUARTILE (Best vs Worst Teams)');

  // Sort by actual wins within each year, assign quartile
  const byYear = new Map<number, typeof projected>();
  for (const p of projected) {
    if (!byYear.has(p.year)) byYear.set(p.year, []);
    byYear.get(p.year)!.push(p);
  }

  const quartileData = { top: [] as number[], upper: [] as number[], lower: [] as number[], bottom: [] as number[] };
  const quartileBias = { top: [] as number[], upper: [] as number[], lower: [] as number[], bottom: [] as number[] };

  for (const [, teams] of byYear) {
    const sorted = [...teams].sort((a, b) => b.wins - a.wins);
    const n = sorted.length;
    const q1 = Math.ceil(n * 0.25);
    const q2 = Math.ceil(n * 0.50);
    const q3 = Math.ceil(n * 0.75);

    sorted.forEach((t, i) => {
      const absDiff = Math.abs(t.diff);
      if (i < q1) { quartileData.top.push(absDiff); quartileBias.top.push(t.diff); }
      else if (i < q2) { quartileData.upper.push(absDiff); quartileBias.upper.push(t.diff); }
      else if (i < q3) { quartileData.lower.push(absDiff); quartileBias.lower.push(t.diff); }
      else { quartileData.bottom.push(absDiff); quartileBias.bottom.push(t.diff); }
    });
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log(`\n  Quartile     N     MAE    Bias     Direction`);
  console.log('  ' + '-'.repeat(55));
  for (const [label, key] of [['Top 25%', 'top'], ['Upper mid', 'upper'], ['Lower mid', 'lower'], ['Bottom 25%', 'bottom']] as const) {
    const mae = avg(quartileData[key]);
    const bias = avg(quartileBias[key]);
    const dir = bias > 1 ? 'OVER-projecting' : bias < -1 ? 'UNDER-projecting' : 'balanced';
    console.log(`  ${label.padEnd(12)} ${String(quartileData[key].length).padStart(4)}   ${mae.toFixed(1).padStart(5)}  ${(bias > 0 ? '+' : '') + bias.toFixed(1).padStart(5)}     ${dir}`);
  }

  // ── 4. Year-by-Year Standings Accuracy ────────────────────────────
  printSep('4. YEAR-BY-YEAR STANDINGS ACCURACY');

  console.log(`\n  Year  Teams   MAE    RMSE   R²     MaxMiss  Bias`);
  console.log('  ' + '-'.repeat(60));

  const yearKeys = [...byYear.keys()].sort();
  for (const year of yearKeys) {
    const teams = byYear.get(year)!;
    const diffs = teams.map(t => t.diff);
    const absDiffs = diffs.map(d => Math.abs(d));
    const mae = avg(absDiffs);
    const rmse = Math.sqrt(avg(diffs.map(d => d * d)));
    const bias = avg(diffs);
    const maxMiss = Math.max(...absDiffs);

    // R² for this year
    const yrReg = linearRegression(teams.map(t => t.adjTotalWar), teams.map(t => t.wins));

    console.log(`  ${year}  ${String(teams.length).padStart(5)}  ${mae.toFixed(1).padStart(5)}  ${rmse.toFixed(1).padStart(6)}  ${yrReg.rSquared.toFixed(3).padStart(5)}  ${String(maxMiss).padStart(7)}  ${(bias > 0 ? '+' : '') + bias.toFixed(1)}`);
  }

  // Overall
  const allDiffs = projected.map(p => p.diff);
  const allAbsDiffs = allDiffs.map(d => Math.abs(d));
  console.log('  ' + '-'.repeat(60));
  console.log(`  ALL   ${String(projected.length).padStart(5)}  ${avg(allAbsDiffs).toFixed(1).padStart(5)}  ${Math.sqrt(avg(allDiffs.map(d => d * d))).toFixed(1).padStart(6)}         ${Math.max(...allAbsDiffs).toString().padStart(7)}  ${(avg(allDiffs) > 0 ? '+' : '') + avg(allDiffs).toFixed(1)}`);

  // ── 5. Role Adjustment Impact ──────────────────────────────────────
  printSep('5. ROLE ADJUSTMENT IMPACT');

  const projRaw = computeProjectedWins(matched, false);
  const projAdj = computeProjectedWins(matched, true);

  const maeRaw = avg(projRaw.map(p => Math.abs(p.diff)));
  const maeAdj = avg(projAdj.map(p => Math.abs(p.diff)));
  const biasRaw = avg(projRaw.map(p => p.diff));
  const biasAdj = avg(projAdj.map(p => p.diff));
  const rmseRaw = Math.sqrt(avg(projRaw.map(p => p.diff ** 2)));
  const rmseAdj = Math.sqrt(avg(projAdj.map(p => p.diff ** 2)));

  console.log(`\n                   MAE    RMSE   Bias`);
  console.log('  ' + '-'.repeat(40));
  console.log(`  Raw WAR:       ${maeRaw.toFixed(1).padStart(5)}  ${rmseRaw.toFixed(1).padStart(6)}  ${(biasRaw > 0 ? '+' : '') + biasRaw.toFixed(1)}`);
  console.log(`  Role-adjusted: ${maeAdj.toFixed(1).padStart(5)}  ${rmseAdj.toFixed(1).padStart(6)}  ${(biasAdj > 0 ? '+' : '') + biasAdj.toFixed(1)}`);
  console.log(`  Delta:         ${(maeAdj - maeRaw > 0 ? '+' : '') + (maeAdj - maeRaw).toFixed(1).padStart(5)}`);

  if (maeAdj > maeRaw + 0.3) {
    console.log(`  → Role adjustments are HURTING accuracy`);
  } else if (maeAdj < maeRaw - 0.3) {
    console.log(`  → Role adjustments are HELPING accuracy`);
  } else {
    console.log(`  → Role adjustments have minimal impact`);
  }

  // ── 6. Decompose: WAR Gap vs Luck ──────────────────────────────────
  printSep('6. DECOMPOSE: WAR FORMULA GAP vs LUCK/SIMULATION NOISE');

  // Compare: OOTP WAR → Wins accuracy vs Our WAR → Wins accuracy
  // The gap tells us how much noise our WAR formula adds
  const ooptProjected = computeProjectedWinsFromOoptWar(matched);
  const maeOopt = avg(ooptProjected.map(p => Math.abs(p.diff)));
  const rmseOopt = Math.sqrt(avg(ooptProjected.map(p => p.diff ** 2)));

  console.log(`\n  Using OOTP's own WAR with our formula:`);
  console.log(`    MAE: ${maeOopt.toFixed(1)}, RMSE: ${rmseOopt.toFixed(1)}`);
  console.log(`  Using Our WAR (role-adjusted):`);
  console.log(`    MAE: ${maeAdj.toFixed(1)}, RMSE: ${rmseAdj.toFixed(1)}`);
  console.log(`\n  Irreducible error (OOTP simulation noise): ~${maeOopt.toFixed(1)} wins MAE`);
  console.log(`  Error from our WAR formula: ~${(maeAdj - maeOopt).toFixed(1)} additional wins MAE`);

  // ── 7. Extreme Teams Analysis ──────────────────────────────────────
  printSep('7. EXTREME TEAMS (Top/Bottom 20 by Actual Wins)');

  const sorted = [...projected].sort((a, b) => b.wins - a.wins);
  const topN = 20;

  console.log(`\n  BEST ${topN} TEAMS:`);
  console.log('  Year  Team       ActW  ProjW  Diff   OurWAR  OoptWAR');
  console.log('  ' + '-'.repeat(60));
  for (const t of sorted.slice(0, topN)) {
    console.log(`  ${t.year}  ${t.teamAbbr.padEnd(10)} ${String(t.wins).padStart(4)}   ${String(t.projWins).padStart(4)}  ${(t.diff > 0 ? '+' : '') + String(t.diff).padStart(3)}   ${t.adjTotalWar.toFixed(1).padStart(6)}   ${t.ooptTotalWar.toFixed(1).padStart(6)}`);
  }
  const topBias = avg(sorted.slice(0, topN).map(t => t.diff));
  const topMae = avg(sorted.slice(0, topN).map(t => Math.abs(t.diff)));
  console.log(`  Top ${topN}: MAE=${topMae.toFixed(1)}, Bias=${topBias > 0 ? '+' : ''}${topBias.toFixed(1)}`);

  console.log(`\n  WORST ${topN} TEAMS:`);
  console.log('  Year  Team       ActW  ProjW  Diff   OurWAR  OoptWAR');
  console.log('  ' + '-'.repeat(60));
  for (const t of sorted.slice(-topN)) {
    console.log(`  ${t.year}  ${t.teamAbbr.padEnd(10)} ${String(t.wins).padStart(4)}   ${String(t.projWins).padStart(3)}  ${(t.diff > 0 ? '+' : '') + String(t.diff).padStart(3)}   ${t.adjTotalWar.toFixed(1).padStart(6)}   ${t.ooptTotalWar.toFixed(1).padStart(6)}`);
  }
  const botBias = avg(sorted.slice(-topN).map(t => t.diff));
  const botMae = avg(sorted.slice(-topN).map(t => Math.abs(t.diff)));
  console.log(`  Bottom ${topN}: MAE=${botMae.toFixed(1)}, Bias=${botBias > 0 ? '+' : ''}${botBias.toFixed(1)}`);

  console.log(`\n  COMPRESSION CHECK:`);
  console.log(`    Top ${topN} bias: ${topBias > 0 ? '+' : ''}${topBias.toFixed(1)} (${topBias < -1 ? 'UNDER-projecting best teams' : 'OK'})`);
  console.log(`    Bottom ${topN} bias: ${botBias > 0 ? '+' : ''}${botBias.toFixed(1)} (${botBias > 1 ? 'OVER-projecting worst teams' : 'OK'})`);
  console.log(`    Compression gap: ${(botBias - topBias).toFixed(1)} wins`);
  if (botBias - topBias > 5) {
    console.log(`    → CLEAR COMPRESSION: ${(botBias - topBias).toFixed(1)} win gap between top and bottom team bias`);
  }

  // ── 8. Recalibration Suggestions ──────────────────────────────────
  printSep('8. RECALIBRATION ANALYSIS');

  // What if we recalibrate the formula using role-adjusted WAR?
  const adjReg = linearRegression(
    projected.map(p => p.adjTotalWar),
    projected.map(p => p.wins)
  );
  console.log(`\n  Current formula: Wins = ${BASELINE_WINS} + ${WAR_SLOPE} × WAR`);
  console.log(`  Recalibrated:   Wins = ${adjReg.intercept.toFixed(1)} + ${adjReg.slope.toFixed(3)} × Adj WAR`);
  console.log(`  R² = ${adjReg.rSquared.toFixed(4)}, SE = ${adjReg.stdResidual.toFixed(1)}`);

  // Check quadratic model
  const xs = projected.map(p => p.adjTotalWar);
  const ys = projected.map(p => p.wins);
  const x2s = xs.map(x => x * x);

  // Fit: y = a + b*x + c*x^2 using normal equations
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sx2 = x2s.reduce((a, b) => a + b, 0);
  const sx3 = xs.reduce((a, x) => a + x ** 3, 0);
  const sx4 = xs.reduce((a, x) => a + x ** 4, 0);
  const sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sx2y = xs.reduce((a, x, i) => a + x * x * ys[i], 0);

  // Solve 3x3 normal equations
  // [n   sx   sx2 ] [a]   [sy  ]
  // [sx  sx2  sx3 ] [b] = [sxy ]
  // [sx2 sx3  sx4 ] [c]   [sx2y]
  const det = n * (sx2 * sx4 - sx3 * sx3) - sx * (sx * sx4 - sx3 * sx2) + sx2 * (sx * sx3 - sx2 * sx2);
  const a = (sy * (sx2 * sx4 - sx3 * sx3) - sxy * (sx * sx4 - sx3 * sx2) + sx2y * (sx * sx3 - sx2 * sx2)) / det;
  const b = (n * (sxy * sx4 - sx2y * sx3) - sy * (sx * sx4 - sx3 * sx2) + sx2y * (sx * sx3 - sx2 * sx2) -
             sx2y * (n * sx3 - sx * sx2) + sy * (sx * sx3 - sx2 * sx2)) / det;
  // Actually, let's just use a simpler approach - solve via substitution
  // For now, skip full quadratic and just report if it helps
  const quadPredicted = xs.map((x, i) => {
    // Simple: try Wins = adjReg.intercept + adjReg.slope * x + c * (x - meanX)^2
    // where c is chosen to minimize residuals
    return adjReg.slope * x + adjReg.intercept;
  });

  // Actually, let me just test a few candidate quadratic coefficients
  console.log(`\n  Quadratic model test:`);
  const meanWar = avg(xs);
  let bestQuadC = 0;
  let bestQuadMae = Infinity;
  for (let c = -0.05; c <= 0.05; c += 0.001) {
    const preds = xs.map(x => adjReg.intercept + adjReg.slope * x + c * (x - meanWar) ** 2);
    const mae = avg(preds.map((p, i) => Math.abs(p - ys[i])));
    if (mae < bestQuadMae) {
      bestQuadMae = mae;
      bestQuadC = c;
    }
  }
  const linearMae = avg(xs.map((x, i) => Math.abs(adjReg.slope * x + adjReg.intercept - ys[i])));
  console.log(`    Linear MAE:    ${linearMae.toFixed(2)}`);
  console.log(`    Best quad c:   ${bestQuadC.toFixed(4)}`);
  console.log(`    Quadratic MAE: ${bestQuadMae.toFixed(2)}`);
  console.log(`    Improvement:   ${(linearMae - bestQuadMae).toFixed(2)} wins`);
  if (bestQuadMae < linearMae - 0.2) {
    console.log(`    → Quadratic term HELPS: Wins = ${adjReg.intercept.toFixed(1)} + ${adjReg.slope.toFixed(3)} × WAR + ${bestQuadC.toFixed(4)} × (WAR - ${meanWar.toFixed(1)})²`);
  } else {
    console.log(`    → Quadratic term does not meaningfully improve accuracy`);
  }
}

function computeProjectedWinsFromOoptWar(matched: MatchedTeam[]): Array<{ wins: number; projWins: number; diff: number }> {
  // Use OOTP WAR with the Path A regression for reference
  const reg = linearRegression(matched.map(m => m.ooptTotalWar), matched.map(m => m.wins));

  const byYear = new Map<number, MatchedTeam[]>();
  for (const m of matched) {
    if (!byYear.has(m.year)) byYear.set(m.year, []);
    byYear.get(m.year)!.push(m);
  }

  const result: Array<{ wins: number; projWins: number; diff: number }> = [];

  for (const [, teams] of byYear) {
    const rawList = teams.map(m => ({
      ...m,
      rawWins: reg.intercept + reg.slope * m.ooptTotalWar
    }));
    const numTeams = rawList.length;
    const expectedTotal = numTeams * 81;
    const currentTotal = rawList.reduce((s, t) => s + t.rawWins, 0);
    const offset = (expectedTotal - currentTotal) / numTeams;

    for (const t of rawList) {
      const projWins = Math.round(t.rawWins + offset);
      result.push({ wins: t.wins, projWins, diff: projWins - t.wins });
    }
  }

  return result;
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log('Standings Compression Diagnostic Tool');
  console.log('Analyzing compression sources...\n');

  const allStandings: StandingsRow[] = [];
  for (let year = 2005; year <= 2020; year++) {
    allStandings.push(...loadStandings(year));
  }
  console.log(`Loaded ${allStandings.length} team-years from standings data`);

  const matched = matchTeams(allStandings);
  console.log(`Matched ${matched.length} team-years with stat CSVs`);

  analyzeCompression(matched);
}

main();
