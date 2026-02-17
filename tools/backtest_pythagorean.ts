/**
 * Pythagorean vs WAR-Based Wins Backtest Tool
 *
 * Compares two win projection methods against actual standings (2015-2020):
 *   1. WAR-based: Wins = 81 + (WAR − median) × slope (current app formula)
 *   2. Pythagorean: Wins from projected RS/RA using Pythagenpat (exp=1.83)
 *
 * RS = sum of wRC (lineup + bench)   — from projected wOBA × PA
 * RA = sum of FIP × IP / 9           — rotation + bullpen, replacement-filled to 1450 IP
 *
 * Usage:
 *   npx tsx tools/backtest_pythagorean.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const MLB_PITCHING_DIR = path.join(process.cwd(), 'public', 'data', 'mlb');
const MLB_BATTING_DIR = path.join(process.cwd(), 'public', 'data', 'mlb_batting');
const DOB_FILE = path.join(process.cwd(), 'public', 'data', 'mlb_dob.csv');

// ============================================================================
// Constants — faithfully ported from services & calibration tool
// ============================================================================

const SEASON_GAMES = 162;
const PYTH_EXPONENT = 1.83; // Pythagenpat

// WAR→Wins piecewise formula (current app)
const STANDINGS_UPPER_SLOPE = 0.830;
const STANDINGS_LOWER_SLOPE = 0.780;

// RA: pitcher FIP constants
const FIP_CONSTANT = 3.47;
const ROTATION_TARGET_IP = 950;
const BULLPEN_TARGET_IP = 500;
const REPLACEMENT_FIP_PENALTY = 1.00; // lgFIP + 1.00

// RS: wRC constants
const BATTER_LG_WOBA = 0.315;
const BATTER_WOBA_SCALE = 1.15;
const BATTER_LG_RPA = 0.115;

// ── Pitcher projection constants ──
const PITCHER_YEAR_WEIGHTS = [5, 3, 2];
const PITCHER_STABILIZATION = { k9: 50, bb9: 40, hr9: 70 };
const PITCHER_LEAGUE_AVGS = {
  SP: { k9: 5.60, bb9: 2.80, hr9: 0.90 },
  SW: { k9: 6.60, bb9: 2.60, hr9: 0.75 },
  RP: { k9: 6.40, bb9: 2.80, hr9: 0.90 },
};
const PITCHER_REGRESSION_RATIOS: Record<PitcherRole, { k9: number; bb9: number; hr9: number }> = {
  SP: { k9: 0.60, bb9: 0.80, hr9: 0.18 },
  SW: { k9: 1.20, bb9: 0.80, hr9: 0.18 },
  RP: { k9: 1.20, bb9: 0.40, hr9: 0.18 },
};
const PITCHER_K9 = { intercept: 2.10, slope: 0.074 };
const PITCHER_BB9 = { intercept: 5.30, slope: -0.052 };
const PITCHER_HR9 = { intercept: 2.18, slope: -0.024 };
const REPLACEMENT_FIP = 5.20;
const PITCHER_RUNS_PER_WIN = 8.50;

const FIP_TARGET_OFFSET_BREAKPOINTS = [
  { fip: 2.5, offset: -3.0 }, { fip: 3.0, offset: -2.8 }, { fip: 3.5, offset: -2.0 },
  { fip: 4.0, offset: -0.8 }, { fip: 4.2, offset: 0.0 }, { fip: 4.5, offset: 1.0 },
  { fip: 5.0, offset: 1.5 }, { fip: 6.0, offset: 1.5 },
];

// ── Hitter projection constants ──
const HITTER_YEAR_WEIGHTS = [5, 3, 2];
const HITTER_STABILIZATION = { bbPct: 120, kPct: 60, hrPct: 160, iso: 160, avg: 300 };
const HITTER_LEAGUE_AVGS = { avgBbPct: 8.5, avgKPct: 22.0, avgIso: 0.140, avgAvg: 0.260 };

const WOBA_REGRESSION_BREAKPOINTS = [
  { woba: 0.400, offset: -0.040 }, { woba: 0.380, offset: -0.030 },
  { woba: 0.360, offset: -0.020 }, { woba: 0.340, offset: -0.010 },
  { woba: 0.320, offset: 0.000 }, { woba: 0.300, offset: 0.010 },
  { woba: 0.280, offset: 0.020 }, { woba: 0.260, offset: 0.025 },
];
const WOBA_STRENGTH_BREAKPOINTS = [
  { woba: 0.400, multiplier: 0.6 }, { woba: 0.360, multiplier: 0.8 },
  { woba: 0.320, multiplier: 1.0 }, { woba: 0.280, multiplier: 1.2 },
  { woba: 0.260, multiplier: 0.8 },
];

const HITTER_EYE = { intercept: 1.6246, slope: 0.114789 };
const HITTER_AVOIDK = { intercept: 25.10, slope: -0.200303 };
const HITTER_CONTACT = { intercept: 0.035156, slope: 0.003873 };
const HITTER_POWER_LOW = { intercept: -1.034, slope: 0.0637 };
const HITTER_POWER_HIGH = { intercept: -2.75, slope: 0.098 };

const WOBA_WEIGHTS = { bb: 0.69, single: 0.89, double: 1.27, triple: 1.62, hr: 2.10 };
const BATTER_REPLACEMENT_RUNS_PER_600PA = 20;
const BATTER_RUNS_PER_WIN = 10;

// ── Aging ──
function getPitcherAgingModifiers(age: number) {
  if (age < 22) return { stuff: 2.0, control: 3.0, hra: 1.5 };
  if (age < 25) return { stuff: 0.5, control: 1.5, hra: 0.5 };
  if (age < 28) return { stuff: 0, control: 0.5, hra: 0 };
  if (age < 32) return { stuff: -1.5, control: -1.0, hra: -0.5 };
  if (age < 35) return { stuff: -1.5, control: -1.0, hra: -1.0 };
  if (age < 39) return { stuff: -3.0, control: -2.0, hra: -2.0 };
  if (age < 43) return { stuff: -6.0, control: -4.0, hra: -4.0 };
  if (age < 46) return { stuff: -30.0, control: -10.0, hra: -35.0 };
  return { stuff: -50.0, control: -25.0, hra: -55.0 };
}

function getHitterAgingModifiers(age: number) {
  if (age < 22) return { power: 2.5, eye: 2.0, avoidK: 2.5, contact: 2.0 };
  if (age < 25) return { power: 1.5, eye: 1.5, avoidK: 1.0, contact: 1.5 };
  if (age < 27) return { power: 0.5, eye: 1.0, avoidK: 0.5, contact: 0.5 };
  if (age < 30) return { power: 0, eye: 0.5, avoidK: 0, contact: 0 };
  if (age < 33) return { power: -0.5, eye: 0, avoidK: -1.0, contact: -0.5 };
  if (age < 36) return { power: -1.5, eye: -0.5, avoidK: -1.5, contact: -1.0 };
  if (age < 39) return { power: -2.5, eye: -1.5, avoidK: -2.5, contact: -2.0 };
  if (age < 42) return { power: -4.0, eye: -3.0, avoidK: -4.0, contact: -3.5 };
  return { power: -8.0, eye: -5.0, avoidK: -8.0, contact: -6.0 };
}

// ── PA projection ──
const PA_WEIGHTS = [0.40, 0.30, 0.20, 0.10];

function getAgeCurveMultiplier(age: number): number {
  if (age < 23) return 0.80 + (age - 20) * 0.05;
  if (age < 27.5) return 0.95 + ((age - 23) / 4.5) * 0.05;
  if (age <= 32) return 1.0 - ((age - 27.5) / 10) * 0.08;
  if (age <= 37) return 0.96 - ((age - 32) / 5) * 0.21;
  return Math.max(0.60, 0.75 - (age - 37) * 0.03);
}

function getBaselinePaByAge(age: number): number {
  if (age <= 21) return 480 + (age - 20) * 20;
  if (age <= 27) return 480 + ((age - 21) / 6) * 120;
  if (age <= 32) return 600 - (age - 27) * 2;
  if (age <= 37) return 590 - ((age - 32) / 5) * 140;
  return Math.max(350, 450 - (age - 37) * 15);
}

// ── Ensemble ──
const ENSEMBLE_BASE_WEIGHTS = { optimistic: 0.35, neutral: 0.55, pessimistic: 0.10 };
const ENSEMBLE_PARAMS = { ageImpact: 0.35, ipImpact: 0.35 };
const NEUTRAL_AGING_DAMPENING = 0.20;
const ESTABLISHED_IP_MODEL_WEIGHT = 0.45;

// ============================================================================
// CSV Parsing & Data Loading
// ============================================================================

function parseCSV(csvText: string) {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const rows = lines.slice(1).map(l => l.split(',').map(c => c.trim()));
  return { headers, rows };
}

function parseIp(ipStr: string): number {
  const val = parseFloat(ipStr);
  const whole = Math.floor(val);
  const fraction = Math.round((val - whole) * 10);
  return whole + fraction / 3;
}

interface PitchingRow {
  playerId: number; teamId: number; year: number;
  ip: number; k: number; bb: number; hra: number; gs: number;
  k9: number; bb9: number; hr9: number;
}

interface BattingRow {
  playerId: number; teamId: number; year: number; position: number;
  pa: number; ab: number; h: number; d: number; t: number; hr: number;
  bb: number; k: number; sb: number; cs: number;
}

function loadPitchingStats(year: number): PitchingRow[] {
  const filePath = path.join(MLB_PITCHING_DIR, `${year}.csv`);
  if (!fs.existsSync(filePath)) return [];
  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    player_id: headers.indexOf('player_id'), team_id: headers.indexOf('team_id'),
    split_id: headers.indexOf('split_id'), level_id: headers.indexOf('level_id'),
    ip: headers.indexOf('ip'), k: headers.indexOf('k'), bb: headers.indexOf('bb'),
    hra: headers.indexOf('hra'), gs: headers.indexOf('gs'),
  };
  const results: PitchingRow[] = [];
  for (const row of rows) {
    if (parseInt(row[idx.split_id]) !== 1) continue;
    if (parseInt(row[idx.level_id]) !== 1) continue;
    const ip = parseIp(row[idx.ip]);
    if (ip <= 0) continue;
    const k = parseInt(row[idx.k]) || 0;
    const bb = parseInt(row[idx.bb]) || 0;
    const hra = parseInt(row[idx.hra]) || 0;
    results.push({
      playerId: parseInt(row[idx.player_id]), teamId: parseInt(row[idx.team_id]), year, ip, k, bb, hra,
      gs: parseInt(row[idx.gs]) || 0,
      k9: (k / ip) * 9, bb9: (bb / ip) * 9, hr9: (hra / ip) * 9,
    });
  }
  return results;
}

function loadBattingStats(year: number): BattingRow[] {
  const filePath = path.join(MLB_BATTING_DIR, `${year}_batting.csv`);
  if (!fs.existsSync(filePath)) return [];
  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    player_id: headers.indexOf('player_id'), team_id: headers.indexOf('team_id'),
    split_id: headers.indexOf('split_id'), level_id: headers.indexOf('level_id'),
    position: headers.indexOf('position'), pa: headers.indexOf('pa'),
    ab: headers.indexOf('ab'), h: headers.indexOf('h'), d: headers.indexOf('d'),
    t: headers.indexOf('t'), hr: headers.indexOf('hr'), bb: headers.indexOf('bb'),
    k: headers.indexOf('k'), sb: headers.indexOf('sb'), cs: headers.indexOf('cs'),
  };
  const results: BattingRow[] = [];
  for (const row of rows) {
    if (parseInt(row[idx.split_id]) !== 1) continue;
    if (parseInt(row[idx.level_id]) !== 1) continue;
    const pa = parseInt(row[idx.pa]) || 0;
    if (pa <= 0) continue;
    results.push({
      playerId: parseInt(row[idx.player_id]), teamId: parseInt(row[idx.team_id]), year,
      position: parseInt(row[idx.position]) || 0,
      pa, ab: parseInt(row[idx.ab]) || 0, h: parseInt(row[idx.h]) || 0,
      d: parseInt(row[idx.d]) || 0, t: parseInt(row[idx.t]) || 0,
      hr: parseInt(row[idx.hr]) || 0, bb: parseInt(row[idx.bb]) || 0,
      k: parseInt(row[idx.k]) || 0, sb: parseInt(row[idx.sb]) || 0,
      cs: parseInt(row[idx.cs]) || 0,
    });
  }
  return results;
}

function loadDob(): Map<number, number> {
  const dobMap = new Map<number, number>();
  if (!fs.existsSync(DOB_FILE)) return dobMap;
  const { headers, rows } = parseCSV(fs.readFileSync(DOB_FILE, 'utf-8'));
  const idIdx = headers.indexOf('id');
  const dobIdx = headers.indexOf('dob');
  for (const row of rows) {
    const id = parseInt(row[idIdx]);
    const dob = row[dobIdx];
    if (!dob || isNaN(id)) continue;
    const parts = dob.split('/');
    if (parts.length === 3) {
      const year = parseInt(parts[2]);
      if (!isNaN(year)) dobMap.set(id, year);
    }
  }
  return dobMap;
}

interface StandingsRow {
  year: number; teamNameRaw: string; wins: number; losses: number;
  ooptTotalWar: number;
}

function loadStandings(year: number): StandingsRow[] {
  const filePath = path.join(DATA_DIR, `${year}_standings.csv`);
  if (!fs.existsSync(filePath)) return [];
  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    team: headers.indexOf('team'), w: headers.indexOf('w'), l: headers.indexOf('l'),
    tWar: headers.indexOf('totalwar'),
  };
  return rows.map(row => ({
    year, teamNameRaw: row[idx.team],
    wins: parseInt(row[idx.w]) || 0, losses: parseInt(row[idx.l]) || 0,
    ooptTotalWar: parseFloat(row[idx.tWar]) || 0,
  }));
}

// ============================================================================
// Pitcher Projection Pipeline (ported from calibrate_projections.ts)
// ============================================================================

type PitcherRole = 'SP' | 'SW' | 'RP';

function classifyPitcherRole(avgGsPerYear: number, totalIp: number): PitcherRole {
  if (avgGsPerYear >= 5) return 'SP';
  if (totalIp >= 70) return 'SW';
  return 'RP';
}

function getRoleFromIp(totalIp: number): PitcherRole {
  if (totalIp >= 130) return 'SP';
  if (totalIp >= 70) return 'SW';
  return 'RP';
}

function interpolateBreakpoints(value: number, breakpoints: any[], xKey: string, yKey: string): number {
  if (value <= breakpoints[0][xKey]) return breakpoints[0][yKey];
  if (value >= breakpoints[breakpoints.length - 1][xKey]) return breakpoints[breakpoints.length - 1][yKey];
  for (let i = 0; i < breakpoints.length - 1; i++) {
    if (value >= breakpoints[i][xKey] && value <= breakpoints[i + 1][xKey]) {
      const t = (value - breakpoints[i][xKey]) / (breakpoints[i + 1][xKey] - breakpoints[i][xKey]);
      return breakpoints[i][yKey] + t * (breakpoints[i + 1][yKey] - breakpoints[i][yKey]);
    }
  }
  return breakpoints[0][yKey];
}

function calculateFipLike(k9: number, bb9: number, hr9: number): number {
  return (13 * hr9 + 3 * bb9 - 2 * k9) / 9;
}

function calculateFip(k9: number, bb9: number, hr9: number): number {
  return calculateFipLike(k9, bb9, hr9) + FIP_CONSTANT;
}

function calculatePitcherWar(ip: number, k9: number, bb9: number, hr9: number): number {
  const fip = calculateFip(k9, bb9, hr9);
  return ((REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (ip / 9);
}

function pitcherWeightedRates(yearlyStats: PitchingRow[]) {
  if (yearlyStats.length === 0) return { k9: 0, bb9: 0, hr9: 0, totalIp: 0, avgGs: 0 };
  let wK9 = 0, wBb9 = 0, wHr9 = 0, totalWeight = 0, totalIp = 0, totalGs = 0, yearCount = 0;
  const n = Math.min(yearlyStats.length, PITCHER_YEAR_WEIGHTS.length);
  for (let i = 0; i < n; i++) {
    const s = yearlyStats[i];
    const yw = PITCHER_YEAR_WEIGHTS[i];
    if (yw === 0) continue;
    const w = yw * s.ip;
    wK9 += s.k9 * w; wBb9 += s.bb9 * w; wHr9 += s.hr9 * w;
    totalWeight += w; totalIp += s.ip; totalGs += s.gs; yearCount++;
  }
  if (totalWeight === 0) return { k9: 0, bb9: 0, hr9: 0, totalIp: 0, avgGs: 0 };
  return { k9: wK9 / totalWeight, bb9: wBb9 / totalWeight, hr9: wHr9 / totalWeight, totalIp, avgGs: yearCount > 0 ? totalGs / yearCount : 0 };
}

function regressPitcherStat(
  weightedRate: number, totalIp: number, leagueRate: number, stabilizationK: number,
  statType: 'k9' | 'bb9' | 'hr9', allWeighted: { k9: number; bb9: number; hr9: number }, role: PitcherRole
): number {
  if (totalIp + stabilizationK === 0) return leagueRate;
  const fipLike = calculateFipLike(allWeighted.k9, allWeighted.bb9, allWeighted.hr9);
  const estimatedFip = fipLike + FIP_CONSTANT;
  const targetOffset = interpolateBreakpoints(estimatedFip, FIP_TARGET_OFFSET_BREAKPOINTS, 'fip', 'offset');
  let strengthMultiplier: number;
  if (estimatedFip < 3.5) strengthMultiplier = 0.80;
  else if (estimatedFip < 4.0) strengthMultiplier = 1.50;
  else if (estimatedFip < 4.5) strengthMultiplier = 1.80;
  else strengthMultiplier = 2.00;
  const regressionRatio = PITCHER_REGRESSION_RATIOS[role][statType];
  let regressionTarget: number;
  if (statType === 'k9') regressionTarget = leagueRate - (targetOffset * regressionRatio);
  else regressionTarget = leagueRate + (targetOffset * regressionRatio);
  let adjustedK = stabilizationK * strengthMultiplier;
  const ipConfidence = Math.min(1.0, totalIp / 100);
  adjustedK *= 0.5 + ipConfidence * 0.5;
  return (weightedRate * totalIp + regressionTarget * adjustedK) / (totalIp + adjustedK);
}

// Inverse formulas
function estimateStuff(k9: number) { return Math.max(0, Math.min(100, (k9 - PITCHER_K9.intercept) / PITCHER_K9.slope)); }
function estimateControl(bb9: number) { return Math.max(0, Math.min(100, (PITCHER_BB9.intercept - bb9) / (-PITCHER_BB9.slope))); }
function estimateHra(hr9: number) { return Math.max(0, Math.min(100, (PITCHER_HR9.intercept - hr9) / (-PITCHER_HR9.slope))); }

// Forward formulas
function ratingToK9(stuff: number) { return Math.max(0, Math.min(15, PITCHER_K9.intercept + PITCHER_K9.slope * stuff)); }
function ratingToBb9(control: number) { return Math.max(0, Math.min(10, PITCHER_BB9.intercept + PITCHER_BB9.slope * control)); }
function ratingToHr9(hra: number) { return Math.max(0, Math.min(3, PITCHER_HR9.intercept + PITCHER_HR9.slope * hra)); }

function applyPitcherAging(ratings: { stuff: number; control: number; hra: number }, age: number) {
  const mods = getPitcherAgingModifiers(age);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return { stuff: clamp(ratings.stuff + mods.stuff), control: clamp(ratings.control + mods.control), hra: clamp(ratings.hra + mods.hra) };
}

function ensemblePitcherProjection(currentRatings: { stuff: number; control: number; hra: number }, age: number, yearlyStats: PitchingRow[]) {
  const optRatings = applyPitcherAging(currentRatings, age);
  const opt = { k9: ratingToK9(optRatings.stuff), bb9: ratingToBb9(optRatings.control), hr9: ratingToHr9(optRatings.hra) };
  const ageMods = getPitcherAgingModifiers(age);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const neutRatings = {
    stuff: clamp(currentRatings.stuff + ageMods.stuff * NEUTRAL_AGING_DAMPENING),
    control: clamp(currentRatings.control + ageMods.control * NEUTRAL_AGING_DAMPENING),
    hra: clamp(currentRatings.hra + ageMods.hra * NEUTRAL_AGING_DAMPENING),
  };
  const neut = { k9: ratingToK9(neutRatings.stuff), bb9: ratingToBb9(neutRatings.control), hr9: ratingToHr9(neutRatings.hra) };
  let pess = { ...neut };
  if (yearlyStats.length >= 2 && yearlyStats[1].ip >= 10) {
    const currK9 = ratingToK9(currentRatings.stuff);
    const currBb9 = ratingToBb9(currentRatings.control);
    const currHr9 = ratingToHr9(currentRatings.hra);
    pess = {
      k9: Math.max(1, Math.min(15, currK9 + (yearlyStats[0].k9 - yearlyStats[1].k9) * 0.5)),
      bb9: Math.max(0.5, Math.min(10, currBb9 + (yearlyStats[0].bb9 - yearlyStats[1].bb9) * 0.5)),
      hr9: Math.max(0, Math.min(3, currHr9 + (yearlyStats[0].hr9 - yearlyStats[1].hr9) * 0.5)),
    };
  }
  const totalIp = yearlyStats.reduce((s, st) => s + st.ip, 0);
  const ipConf = Math.min(1.0, totalIp / 300);
  const ageFactor = age < 23 ? 0.7 : age < 25 ? 0.5 : age < 28 ? 0.3 : age < 32 ? 0.2 : 0.1;
  let wOpt = ENSEMBLE_BASE_WEIGHTS.optimistic + ageFactor * ENSEMBLE_PARAMS.ageImpact - ipConf * ENSEMBLE_PARAMS.ipImpact;
  let wNeut = ENSEMBLE_BASE_WEIGHTS.neutral - ageFactor * ENSEMBLE_PARAMS.ageImpact * 0.5 + ipConf * ENSEMBLE_PARAMS.ipImpact * 0.75;
  let wPess = ENSEMBLE_BASE_WEIGHTS.pessimistic - ageFactor * ENSEMBLE_PARAMS.ageImpact * 0.5 + ipConf * ENSEMBLE_PARAMS.ipImpact * 0.25;
  wOpt = Math.max(0, wOpt); wNeut = Math.max(0, wNeut); wPess = Math.max(0, wPess);
  const sum = wOpt + wNeut + wPess;
  if (sum === 0) return neut;
  wOpt /= sum; wNeut /= sum; wPess /= sum;
  return {
    k9: opt.k9 * wOpt + neut.k9 * wNeut + pess.k9 * wPess,
    bb9: opt.bb9 * wOpt + neut.bb9 * wNeut + pess.bb9 * wPess,
    hr9: opt.hr9 * wOpt + neut.hr9 * wNeut + pess.hr9 * wPess,
  };
}

function projectPitcherIp(isSp: boolean, age: number, yearlyStats: PitchingRow[], projectedFip: number): number {
  let baseIp = isSp ? 10 + 50 * 3.0 : 30 + 50 * 0.6; // stamina=50 default
  if (isSp) baseIp = Math.max(100, Math.min(280, baseIp));
  else baseIp = Math.max(30, Math.min(100, baseIp));
  if (projectedFip <= 3.50) baseIp *= 1.20;
  else if (projectedFip <= 4.00) baseIp *= 1.10;
  else if (projectedFip <= 4.50) baseIp *= 1.0;
  else if (projectedFip <= 5.00) baseIp *= 0.90;
  else baseIp *= 0.80;
  if (yearlyStats.length > 0) {
    const minIpThreshold = isSp ? 50 : 10;
    const completed = yearlyStats.filter(s => s.ip >= minIpThreshold);
    if (completed.length > 0) {
      let wIp = 0, wTotal = 0;
      const wts = [5, 3, 2];
      for (let i = 0; i < Math.min(completed.length, 3); i++) { wIp += completed[i].ip * wts[i]; wTotal += wts[i]; }
      if (wTotal > 0) {
        const weightedIp = wIp / wTotal;
        if (weightedIp > 50) baseIp = baseIp * ESTABLISHED_IP_MODEL_WEIGHT + weightedIp * (1 - ESTABLISHED_IP_MODEL_WEIGHT);
        else baseIp = baseIp * 0.50 + weightedIp * 0.50;
      }
    }
  }
  if (age >= 46) baseIp *= 0.10;
  else if (age >= 43) baseIp *= 0.40;
  else if (age >= 40) baseIp *= 0.75;
  if (projectedFip < 3.0) baseIp *= 1.08;
  else if (projectedFip < 3.5) { const t = (projectedFip - 3.0) / 0.5; baseIp *= 1.08 - t * 0.05; }
  else if (projectedFip < 4.0) { const t = (projectedFip - 3.5) / 0.5; baseIp *= 1.03 - t * 0.03; }
  return Math.round(baseIp);
}

// ============================================================================
// Hitter Projection Pipeline (ported from calibrate_projections.ts)
// ============================================================================

function hitterWeightedRates(yearlyStats: BattingRow[]) {
  if (yearlyStats.length === 0) return { bbPct: 0, kPct: 0, hrPct: 0, iso: 0, avg: 0, sbPerPa: 0, csPerPa: 0, totalPa: 0 };
  let wBb = 0, wK = 0, wHr = 0, wIso = 0, wAvg = 0, wSb = 0, wCs = 0, totalWeight = 0, totalPa = 0;
  const n = Math.min(yearlyStats.length, HITTER_YEAR_WEIGHTS.length);
  for (let i = 0; i < n; i++) {
    const s = yearlyStats[i];
    const yw = HITTER_YEAR_WEIGHTS[i];
    if (yw === 0 || s.pa === 0) continue;
    const bbPct = (s.bb / s.pa) * 100;
    const kPct = (s.k / s.pa) * 100;
    const hrPct = (s.hr / s.pa) * 100;
    const singles = s.h - s.d - s.t - s.hr;
    const totalBases = singles + 2 * s.d + 3 * s.t + 4 * s.hr;
    const iso = s.ab > 0 ? (totalBases - s.h) / s.ab : 0;
    const avg = s.ab > 0 ? s.h / s.ab : 0;
    const w = yw * s.pa;
    wBb += bbPct * w; wK += kPct * w; wHr += hrPct * w;
    wIso += iso * w; wAvg += avg * w;
    wSb += (s.sb / s.pa) * w; wCs += (s.cs / s.pa) * w;
    totalWeight += w; totalPa += s.pa;
  }
  if (totalWeight === 0) return { bbPct: 0, kPct: 0, hrPct: 0, iso: 0, avg: 0, sbPerPa: 0, csPerPa: 0, totalPa: 0 };
  return { bbPct: wBb / totalWeight, kPct: wK / totalWeight, hrPct: wHr / totalWeight, iso: wIso / totalWeight, avg: wAvg / totalWeight, sbPerPa: wSb / totalWeight, csPerPa: wCs / totalWeight, totalPa };
}

function calculateWobaFromRates(bbPct: number, _kPct: number, hrPct: number, avg: number): number {
  const bbRate = bbPct / 100;
  const hrRate = hrPct / 100;
  const hitRate = avg * (1 - bbRate);
  const tripleRate = hitRate * 0.03;
  const doubleRate = hitRate * 0.20;
  const singleRate = Math.max(0, hitRate - hrRate - tripleRate - doubleRate);
  const woba = WOBA_WEIGHTS.bb * bbRate + WOBA_WEIGHTS.single * singleRate +
    WOBA_WEIGHTS.double * doubleRate + WOBA_WEIGHTS.triple * tripleRate + WOBA_WEIGHTS.hr * hrRate;
  return Math.max(0.200, Math.min(0.500, woba));
}

function regressHitterStat(
  weightedRate: number, totalPa: number, leagueRate: number, stabilizationK: number,
  statType: 'bbPct' | 'kPct' | 'iso' | 'avg', estimatedWoba: number
): number {
  if (totalPa + stabilizationK === 0) return leagueRate;
  const targetOffset = interpolateBreakpoints(estimatedWoba, WOBA_REGRESSION_BREAKPOINTS, 'woba', 'offset');
  const strengthMultiplier = interpolateBreakpoints(estimatedWoba, WOBA_STRENGTH_BREAKPOINTS, 'woba', 'multiplier');
  const multipliers: Record<string, number> = { bbPct: 30, kPct: 50, iso: 1.5, avg: 0.8 };
  let regressionTarget: number;
  if (statType === 'kPct') regressionTarget = leagueRate + (targetOffset * multipliers[statType]);
  else regressionTarget = leagueRate - (targetOffset * multipliers[statType]);
  let adjustedK = stabilizationK * strengthMultiplier;
  const paConfidence = Math.min(1.0, totalPa / 500);
  adjustedK *= 0.5 + paConfidence * 0.5;
  return (weightedRate * totalPa + regressionTarget * adjustedK) / (totalPa + adjustedK);
}

// Inverse
function estimateEye(bbPct: number) { return Math.max(20, Math.min(80, (bbPct - HITTER_EYE.intercept) / HITTER_EYE.slope)); }
function estimateAvoidK(kPct: number) { return Math.max(20, Math.min(80, (kPct - HITTER_AVOIDK.intercept) / HITTER_AVOIDK.slope)); }
function estimateContact(avg: number) { return Math.max(20, Math.min(80, (avg - HITTER_CONTACT.intercept) / HITTER_CONTACT.slope)); }
function estimatePower(hrPct: number) {
  const bp = 2.15;
  if (hrPct <= bp) return Math.max(20, Math.min(80, (hrPct - HITTER_POWER_LOW.intercept) / HITTER_POWER_LOW.slope));
  return Math.max(20, Math.min(80, (hrPct - HITTER_POWER_HIGH.intercept) / HITTER_POWER_HIGH.slope));
}

// Forward
function ratingToBbPct(eye: number) { return HITTER_EYE.intercept + HITTER_EYE.slope * eye; }
function ratingToKPct(avoidK: number) { return HITTER_AVOIDK.intercept + HITTER_AVOIDK.slope * avoidK; }
function ratingToAvg(contact: number) { return HITTER_CONTACT.intercept + HITTER_CONTACT.slope * contact; }
function ratingToHrPct(power: number) {
  if (power <= 50) return Math.max(0, HITTER_POWER_LOW.intercept + HITTER_POWER_LOW.slope * power);
  return Math.max(0, HITTER_POWER_HIGH.intercept + HITTER_POWER_HIGH.slope * power);
}

function applyHitterAging(ratings: { power: number; eye: number; avoidK: number; contact: number }, age: number) {
  const mods = getHitterAgingModifiers(age);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return { power: clamp(ratings.power + mods.power), eye: clamp(ratings.eye + mods.eye), avoidK: clamp(ratings.avoidK + mods.avoidK), contact: clamp(ratings.contact + mods.contact) };
}

function calculateBatterWar(woba: number, pa: number, sbPerPa: number, csPerPa: number): number {
  const wRAA = ((woba - BATTER_LG_WOBA) / BATTER_WOBA_SCALE) * pa;
  const replacementRuns = (pa / 600) * BATTER_REPLACEMENT_RUNS_PER_600PA;
  const sbRuns = sbPerPa * pa * 0.2 - csPerPa * pa * 0.4;
  return (wRAA + replacementRuns + sbRuns) / BATTER_RUNS_PER_WIN;
}

function calculateWrc(woba: number, pa: number): number {
  const wRAA = ((woba - BATTER_LG_WOBA) / BATTER_WOBA_SCALE) * pa;
  return wRAA + (BATTER_LG_RPA * pa);
}

function projectPa(historicalPas: Array<{ year: number; pa: number }>, currentAge: number): number {
  if (historicalPas.length === 0) return getBaselinePaByAge(currentAge);
  const sorted = [...historicalPas].sort((a, b) => b.year - a.year).slice(0, 4);
  let wPaSum = 0, wTotal = 0;
  for (let i = 0; i < sorted.length; i++) { const w = PA_WEIGHTS[i] || 0.10; wPaSum += sorted[i].pa * w; wTotal += w; }
  const historicalAvgPa = wPaSum / wTotal;
  let wAgeSum = 0;
  for (let i = 0; i < sorted.length; i++) { const w = PA_WEIGHTS[i] || 0.10; wAgeSum += (currentAge - (i + 1)) * w; }
  const avgHistoricalAge = wAgeSum / wTotal;
  const ageCurve = getAgeCurveMultiplier(currentAge) / getAgeCurveMultiplier(avgHistoricalAge);
  const ageAdjustedPa = historicalAvgPa * ageCurve;
  let trustFactor = Math.min(0.98, 0.40 + sorted.length * 0.20);
  if (historicalAvgPa >= 500 && sorted.length >= 2) trustFactor = Math.min(0.98, trustFactor + 0.05);
  const baselinePa = historicalAvgPa < 250 ? Math.min(getBaselinePaByAge(currentAge), 350) : getBaselinePaByAge(currentAge);
  const blendedPa = ageAdjustedPa * trustFactor + baselinePa * (1 - trustFactor);
  return Math.round(Math.max(50, Math.min(700, blendedPa)));
}

// ============================================================================
// Main Pipeline — produces WAR + RS/RA per team
// ============================================================================

interface TeamProjection {
  teamId: number;
  totalWar: number;
  rotationWar: number;
  bullpenWar: number;
  lineupWar: number;
  benchWar: number;
  runsScored: number;      // wRC-based
  runsAllowed: number;      // FIP-based, IP-normalized
}

function runProjectionPipeline(projectionYear: number, dobMap: Map<number, number>): Map<number, TeamProjection> {
  // Load multi-year stats (Y-3 through Y-1)
  const allPitching = new Map<number, PitchingRow[]>();
  const allBatting = new Map<number, BattingRow[]>();

  for (let y = projectionYear - 3; y < projectionYear; y++) {
    for (const row of loadPitchingStats(y)) {
      if (!allPitching.has(row.playerId)) allPitching.set(row.playerId, []);
      allPitching.get(row.playerId)!.push(row);
    }
    for (const row of loadBattingStats(y)) {
      if (!allBatting.has(row.playerId)) allBatting.set(row.playerId, []);
      allBatting.get(row.playerId)!.push(row);
    }
  }

  for (const [, stats] of allPitching) stats.sort((a, b) => b.year - a.year);
  for (const [, stats] of allBatting) stats.sort((a, b) => b.year - a.year);

  // Load projection year stats for team assignment
  const projYearPitching = loadPitchingStats(projectionYear);
  const projYearBatting = loadBattingStats(projectionYear);
  const pitcherTeams = new Map<number, number>();
  for (const row of projYearPitching) pitcherTeams.set(row.playerId, row.teamId);
  const batterTeams = new Map<number, number>();
  for (const row of projYearBatting) batterTeams.set(row.playerId, row.teamId);

  // ── Pitcher projections ──
  interface PitcherProj { playerId: number; teamId: number; war: number; ip: number; fip: number; isSp: boolean; }
  const pitcherProjections: PitcherProj[] = [];

  for (const [playerId, yearlyStats] of allPitching) {
    const teamId = pitcherTeams.get(playerId);
    if (teamId === undefined) continue;
    const birthYear = dobMap.get(playerId);
    if (birthYear === undefined) continue;
    const age = projectionYear - birthYear;
    const weighted = pitcherWeightedRates(yearlyStats);
    if (weighted.totalIp === 0) continue;
    const role = classifyPitcherRole(weighted.avgGs, weighted.totalIp);
    const ipRole = getRoleFromIp(weighted.totalIp);
    const effectiveRole = role === 'SP' ? 'SP' : ipRole;
    const leagueAvgs = PITCHER_LEAGUE_AVGS[effectiveRole];
    const allW = { k9: weighted.k9, bb9: weighted.bb9, hr9: weighted.hr9 };
    const rK9 = regressPitcherStat(weighted.k9, weighted.totalIp, leagueAvgs.k9, PITCHER_STABILIZATION.k9, 'k9', allW, effectiveRole);
    const rBb9 = regressPitcherStat(weighted.bb9, weighted.totalIp, leagueAvgs.bb9, PITCHER_STABILIZATION.bb9, 'bb9', allW, effectiveRole);
    const rHr9 = regressPitcherStat(weighted.hr9, weighted.totalIp, leagueAvgs.hr9, PITCHER_STABILIZATION.hr9, 'hr9', allW, effectiveRole);
    const currentRatings = { stuff: estimateStuff(rK9), control: estimateControl(rBb9), hra: estimateHra(rHr9) };
    const projected = ensemblePitcherProjection(currentRatings, age, yearlyStats);
    const projFip = calculateFip(projected.k9, projected.bb9, projected.hr9);
    const isSp = role === 'SP';
    const ip = projectPitcherIp(isSp, age + 1, yearlyStats, projFip);
    const war = calculatePitcherWar(ip, projected.k9, projected.bb9, projected.hr9);
    pitcherProjections.push({ playerId, teamId, war, ip, fip: projFip, isSp });
  }

  // ── Batter projections ──
  interface BatterProj { playerId: number; teamId: number; war: number; pa: number; woba: number; sbPerPa: number; csPerPa: number; }
  const batterProjections: BatterProj[] = [];

  for (const [playerId, yearlyStats] of allBatting) {
    if (yearlyStats.every(s => s.position === 1)) continue;
    const teamId = batterTeams.get(playerId);
    if (teamId === undefined) continue;
    const birthYear = dobMap.get(playerId);
    if (birthYear === undefined) continue;
    const age = projectionYear - birthYear;
    const weighted = hitterWeightedRates(yearlyStats);
    if (weighted.totalPa === 0) continue;
    const rawWoba = calculateWobaFromRates(weighted.bbPct, weighted.kPct, weighted.hrPct, weighted.avg);
    const rBb = regressHitterStat(weighted.bbPct, weighted.totalPa, HITTER_LEAGUE_AVGS.avgBbPct, HITTER_STABILIZATION.bbPct, 'bbPct', rawWoba);
    const rK = regressHitterStat(weighted.kPct, weighted.totalPa, HITTER_LEAGUE_AVGS.avgKPct, HITTER_STABILIZATION.kPct, 'kPct', rawWoba);
    const rHr = weighted.hrPct;
    const rAvg = regressHitterStat(weighted.avg, weighted.totalPa, HITTER_LEAGUE_AVGS.avgAvg, HITTER_STABILIZATION.avg, 'avg', rawWoba);
    const currentRatings = { power: estimatePower(rHr), eye: estimateEye(rBb), avoidK: estimateAvoidK(rK), contact: estimateContact(rAvg) };
    const projRatings = applyHitterAging(currentRatings, age);
    const projBbPct = ratingToBbPct(projRatings.eye);
    const projAvg = ratingToAvg(projRatings.contact);
    const projHrPct = ratingToHrPct(projRatings.power);
    const bbRate = projBbPct / 100;
    const hrRate = projHrPct / 100;
    const hitRate = projAvg * (1 - bbRate);
    const nonHrHitRate = Math.max(0, hitRate - hrRate);
    const tripleRate = nonHrHitRate * 0.08;
    const doubleRate = nonHrHitRate * 0.27;
    const singleRate = nonHrHitRate * 0.65;
    const projWoba = Math.max(0.200, Math.min(0.500,
      WOBA_WEIGHTS.bb * bbRate + WOBA_WEIGHTS.single * singleRate +
      WOBA_WEIGHTS.double * doubleRate + WOBA_WEIGHTS.triple * tripleRate + WOBA_WEIGHTS.hr * hrRate));
    const historicalPas = yearlyStats.map(s => ({ year: s.year, pa: s.pa }));
    const pa = projectPa(historicalPas, age + 1);
    const war = calculateBatterWar(projWoba, pa, weighted.sbPerPa, weighted.csPerPa);
    batterProjections.push({ playerId, teamId, war, pa, woba: projWoba, sbPerPa: weighted.sbPerPa, csPerPa: weighted.csPerPa });
  }

  // ── Team assembly ──
  const pitchersByTeam = new Map<number, PitcherProj[]>();
  for (const p of pitcherProjections) {
    if (!pitchersByTeam.has(p.teamId)) pitchersByTeam.set(p.teamId, []);
    pitchersByTeam.get(p.teamId)!.push(p);
  }

  const battersByTeam = new Map<number, BatterProj[]>();
  for (const b of batterProjections) {
    if (!battersByTeam.has(b.teamId)) battersByTeam.set(b.teamId, []);
    battersByTeam.get(b.teamId)!.push(b);
  }

  const allTeamIds = new Set([...pitchersByTeam.keys(), ...battersByTeam.keys()]);

  // First pass: compute league-average FIP for rotation/bullpen (for replacement fill)
  let totalRotFipIp = 0, totalRotIp = 0, totalBpFipIp = 0, totalBpIp = 0;
  for (const teamId of allTeamIds) {
    const pitchers = pitchersByTeam.get(teamId) || [];
    const sps = pitchers.filter(p => p.isSp).sort((a, b) => b.war - a.war);
    const rps = pitchers.filter(p => !p.isSp);
    const rotation = sps.slice(0, 5);
    const bullpen = [...sps.slice(5), ...rps].sort((a, b) => b.war - a.war).slice(0, 8);
    for (const p of rotation) { totalRotFipIp += p.fip * p.ip; totalRotIp += p.ip; }
    for (const p of bullpen) { totalBpFipIp += p.fip * p.ip; totalBpIp += p.ip; }
  }
  const avgRotFip = totalRotIp > 0 ? totalRotFipIp / totalRotIp : 4.20;
  const avgBpFip = totalBpIp > 0 ? totalBpFipIp / totalBpIp : 4.20;

  // Second pass: assemble teams with RS/RA
  const teamResults = new Map<number, TeamProjection>();

  for (const teamId of allTeamIds) {
    const pitchers = pitchersByTeam.get(teamId) || [];
    const batters = battersByTeam.get(teamId) || [];

    // Pitchers: top 5 SP rotation, next 8 bullpen
    const sps = pitchers.filter(p => p.isSp).sort((a, b) => b.war - a.war);
    const rps = pitchers.filter(p => !p.isSp);
    const rotation = sps.slice(0, 5);
    const bullpen = [...sps.slice(5), ...rps].sort((a, b) => b.war - a.war).slice(0, 8);

    const rotationWar = rotation.reduce((s, p) => s + p.war, 0);
    const bullpenWar = bullpen.reduce((s, p) => s + p.war, 0);

    // RA: FIP × IP / 9, IP-normalized to targets with replacement fill
    const rotationRA = calculateTeamRunsAllowed(rotation, avgRotFip, ROTATION_TARGET_IP);
    const bullpenRA = calculateTeamRunsAllowed(bullpen, avgBpFip, BULLPEN_TARGET_IP);
    const runsAllowed = rotationRA + bullpenRA;

    // Batters: top 9 lineup, next 4 bench
    const sortedBatters = [...batters].sort((a, b) => b.war - a.war);
    const lineup = sortedBatters.slice(0, 9);
    const bench = sortedBatters.slice(9, 13);
    const lineupWar = lineup.reduce((s, b) => s + b.war, 0);
    const benchWar = bench.reduce((s, b) => s + b.war, 0);

    // RS: wRC sum for all batters
    const allBatters = [...lineup, ...bench];
    const runsScored = allBatters.reduce((sum, b) => sum + calculateWrc(b.woba, b.pa), 0);

    const totalWar = rotationWar + bullpenWar + lineupWar + benchWar;

    teamResults.set(teamId, {
      teamId, totalWar, rotationWar, bullpenWar, lineupWar, benchWar,
      runsScored, runsAllowed,
    });
  }

  return teamResults;
}

function calculateTeamRunsAllowed(pitchers: Array<{ fip: number; ip: number }>, leagueAvgFip: number, targetIp: number): number {
  let totalIp = pitchers.reduce((sum, p) => sum + p.ip, 0);
  let runsAllowed = pitchers.reduce((sum, p) => sum + (p.fip * p.ip) / 9, 0);

  if (totalIp < targetIp) {
    const missingIp = targetIp - totalIp;
    const replacementFip = leagueAvgFip + REPLACEMENT_FIP_PENALTY;
    runsAllowed += (replacementFip * missingIp) / 9;
    totalIp = targetIp;
  } else if (totalIp > targetIp) {
    runsAllowed *= targetIp / totalIp;
  }

  return runsAllowed;
}

// ============================================================================
// Pythagorean & WAR-based win calculations
// ============================================================================

function pythagoreanWins(rs: number, ra: number): number {
  if (rs <= 0 || ra <= 0) return 81;
  const pythPct = Math.pow(rs, PYTH_EXPONENT) / (Math.pow(rs, PYTH_EXPONENT) + Math.pow(ra, PYTH_EXPONENT));
  return Math.round(pythPct * SEASON_GAMES);
}

function computeWarBasedWins(teams: TeamProjection[]): Map<number, number> {
  const wars = teams.map(t => t.totalWar).sort((a, b) => a - b);
  const mid = Math.floor(wars.length / 2);
  const medianWar = wars.length % 2 === 0 ? (wars[mid - 1] + wars[mid]) / 2 : wars[mid];

  // Piecewise raw wins
  const rawWins = teams.map(t => {
    const dev = t.totalWar - medianWar;
    const slope = dev > 0 ? STANDINGS_UPPER_SLOPE : STANDINGS_LOWER_SLOPE;
    return { teamId: t.teamId, rawWins: 81 + dev * slope };
  });

  // Zero-sum normalization
  const numTeams = rawWins.length;
  const expectedTotal = numTeams * (SEASON_GAMES / 2);
  const currentTotal = rawWins.reduce((s, t) => s + t.rawWins, 0);
  const offset = (expectedTotal - currentTotal) / numTeams;

  const result = new Map<number, number>();
  for (const t of rawWins) result.set(t.teamId, Math.round(t.rawWins + offset));
  return result;
}

function computePythWins(teams: TeamProjection[]): Map<number, number> {
  // Normalize RS so league-total RS = league-total RA (closed-league constraint)
  const totalRawRs = teams.reduce((s, t) => s + t.runsScored, 0);
  const totalRa = teams.reduce((s, t) => s + t.runsAllowed, 0);
  const rsScale = totalRa > 0 && totalRawRs > 0 ? totalRa / totalRawRs : 1;

  const rawPyth = teams.map(t => {
    const rs = t.runsScored * rsScale;
    return { teamId: t.teamId, rawWins: pythagoreanWins(rs, t.runsAllowed) };
  });

  // Zero-sum normalization (same as WAR-based)
  const numTeams = rawPyth.length;
  const expectedTotal = numTeams * (SEASON_GAMES / 2);
  const currentTotal = rawPyth.reduce((s, t) => s + t.rawWins, 0);
  const offset = (expectedTotal - currentTotal) / numTeams;

  const result = new Map<number, number>();
  for (const t of rawPyth) result.set(t.teamId, Math.round(t.rawWins + offset));
  return result;
}

// ============================================================================
// Team matching (standings name → team ID via WAR proximity)
// ============================================================================

function matchTeamsToStandings(
  teamProjections: Map<number, TeamProjection>,
  standings: StandingsRow[],
  projYearPitching: PitchingRow[],
  projYearBatting: BattingRow[]
): Array<{ teamId: number; actualWins: number }> {
  // Build actual WAR per team from projection-year stats
  const actualWarByTeam = new Map<number, number>();
  for (const row of projYearPitching) {
    const fip = calculateFip(row.k9, row.bb9, row.hr9);
    const war = ((REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (row.ip / 9);
    actualWarByTeam.set(row.teamId, (actualWarByTeam.get(row.teamId) || 0) + war);
  }
  for (const row of projYearBatting) {
    if (row.position === 1) continue;
    const bbPct = (row.bb / row.pa) * 100;
    const kPct = (row.k / row.pa) * 100;
    const hrPct = (row.hr / row.pa) * 100;
    const avg = row.ab > 0 ? row.h / row.ab : 0;
    const woba = calculateWobaFromRates(bbPct, kPct, hrPct, avg);
    const war = calculateBatterWar(woba, row.pa, row.sb / row.pa, row.cs / row.pa);
    actualWarByTeam.set(row.teamId, (actualWarByTeam.get(row.teamId) || 0) + war);
  }

  const matched: Array<{ teamId: number; actualWins: number }> = [];
  const usedTeamIds = new Set<number>();

  for (const st of standings) {
    let bestTeamId = -1;
    let bestDiff = Infinity;
    for (const [teamId, war] of actualWarByTeam) {
      if (usedTeamIds.has(teamId)) continue;
      if (!teamProjections.has(teamId)) continue;
      const diff = Math.abs(st.ooptTotalWar - war);
      if (diff < bestDiff) { bestDiff = diff; bestTeamId = teamId; }
    }
    if (bestTeamId >= 0 && bestDiff < 5.0) {
      usedTeamIds.add(bestTeamId);
      matched.push({ teamId: bestTeamId, actualWins: st.wins });
    }
  }

  return matched;
}

// ============================================================================
// Reporting
// ============================================================================

function printSep(title: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(70));
}

function main() {
  console.log('Pythagorean vs WAR-Based Wins Backtest');
  console.log(`Seasons: 2015-2020 | Pythagenpat exp: ${PYTH_EXPONENT}`);
  console.log(`WAR formula: piecewise (upper=${STANDINGS_UPPER_SLOPE}, lower=${STANDINGS_LOWER_SLOPE})`);
  console.log(`RS: wRC (wOBA/PA) | RA: FIP×IP/9 (IP-normalized, replacement-filled)`);

  const dobMap = loadDob();

  const yearRange = [2015, 2016, 2017, 2018, 2019, 2020];

  interface YearResult {
    year: number;
    numTeams: number;
    totalStandingsTeams: number;
    totalProjectedTeams: number;
    avgActualWinsMatched: number;
    avgActualWinsAll: number;
    warMae: number;
    pythMae: number;
    warRmse: number;
    pythRmse: number;
    warMaxMiss: number;
    pythMaxMiss: number;
    avgRs: number;
    avgRa: number;
    rsScale: number;
  }

  const yearResults: YearResult[] = [];
  const allWarDiffs: number[] = [];
  const allPythDiffs: number[] = [];

  for (const year of yearRange) {
    const standings = loadStandings(year);
    if (standings.length === 0) {
      console.log(`  ${year}: no standings data, skipping`);
      continue;
    }

    const teamProjections = runProjectionPipeline(year, dobMap);
    const teams = Array.from(teamProjections.values());
    if (teams.length === 0) {
      console.log(`  ${year}: no projections, skipping`);
      continue;
    }

    // Match teams to standings
    const projYearPitching = loadPitchingStats(year);
    const projYearBatting = loadBattingStats(year);
    const matchedTeams = matchTeamsToStandings(teamProjections, standings, projYearPitching, projYearBatting);

    if (matchedTeams.length === 0) {
      console.log(`  ${year}: no teams matched, skipping`);
      continue;
    }

    // Match diagnostics
    const avgActualWinsMatched = matchedTeams.reduce((s, m) => s + m.actualWins, 0) / matchedTeams.length;
    const avgActualWinsAll = standings.reduce((s, st) => s + st.wins, 0) / standings.length;

    // Compute wins both ways (using only matched teams)
    const matchedProjections = matchedTeams.map(m => teamProjections.get(m.teamId)!);
    const warWins = computeWarBasedWins(matchedProjections);
    const pythWins = computePythWins(matchedProjections);

    // RS normalization scale for reporting
    const totalRawRs = matchedProjections.reduce((s, t) => s + t.runsScored, 0);
    const totalRa = matchedProjections.reduce((s, t) => s + t.runsAllowed, 0);
    const rsScale = totalRa > 0 && totalRawRs > 0 ? totalRa / totalRawRs : 1;

    const avgRs = matchedProjections.reduce((s, t) => s + t.runsScored * rsScale, 0) / matchedProjections.length;
    const avgRa = matchedProjections.reduce((s, t) => s + t.runsAllowed, 0) / matchedProjections.length;

    // Compare
    let warMae = 0, pythMae = 0, warSse = 0, pythSse = 0;
    let warMaxMiss = 0, pythMaxMiss = 0;

    for (const m of matchedTeams) {
      const wWins = warWins.get(m.teamId) ?? 81;
      const pWins = pythWins.get(m.teamId) ?? 81;
      const warDiff = wWins - m.actualWins;
      const pythDiff = pWins - m.actualWins;

      allWarDiffs.push(warDiff);
      allPythDiffs.push(pythDiff);

      warMae += Math.abs(warDiff);
      pythMae += Math.abs(pythDiff);
      warSse += warDiff * warDiff;
      pythSse += pythDiff * pythDiff;
      warMaxMiss = Math.max(warMaxMiss, Math.abs(warDiff));
      pythMaxMiss = Math.max(pythMaxMiss, Math.abs(pythDiff));
    }

    const n = matchedTeams.length;
    yearResults.push({
      year, numTeams: n,
      totalStandingsTeams: standings.length,
      totalProjectedTeams: teams.length,
      avgActualWinsMatched,
      avgActualWinsAll,
      warMae: warMae / n, pythMae: pythMae / n,
      warRmse: Math.sqrt(warSse / n), pythRmse: Math.sqrt(pythSse / n),
      warMaxMiss, pythMaxMiss,
      avgRs, avgRa, rsScale,
    });
  }

  // ── Year-by-year results ──
  printSep('YEAR-BY-YEAR RESULTS');
  console.log('');
  console.log('  Year  Teams   WAR MAE   Pyth MAE   WAR RMSE  Pyth RMSE  WAR Max   Pyth Max  Avg RS   Avg RA   RS Scale');
  console.log('  ' + '─'.repeat(108));

  for (const yr of yearResults) {
    const winner = yr.pythMae < yr.warMae ? '← Pyth' : yr.warMae < yr.pythMae ? 'WAR →' : 'tie';
    console.log(
      `  ${yr.year}   ${String(yr.numTeams).padStart(3)}` +
      `    ${yr.warMae.toFixed(1).padStart(6)}` +
      `     ${yr.pythMae.toFixed(1).padStart(6)}` +
      `     ${yr.warRmse.toFixed(1).padStart(6)}` +
      `     ${yr.pythRmse.toFixed(1).padStart(6)}` +
      `     ${String(yr.warMaxMiss).padStart(5)}` +
      `     ${String(yr.pythMaxMiss).padStart(5)}` +
      `   ${yr.avgRs.toFixed(0).padStart(5)}` +
      `   ${yr.avgRa.toFixed(0).padStart(5)}` +
      `     ${yr.rsScale.toFixed(3)}` +
      `   ${winner}`
    );
  }

  // ── Aggregate results ──
  if (yearResults.length > 0) {
    printSep('AGGREGATE (All Seasons)');

    const totalTeams = yearResults.reduce((s, yr) => s + yr.numTeams, 0);
    const overallWarMae = allWarDiffs.reduce((s, d) => s + Math.abs(d), 0) / allWarDiffs.length;
    const overallPythMae = allPythDiffs.reduce((s, d) => s + Math.abs(d), 0) / allPythDiffs.length;
    const overallWarRmse = Math.sqrt(allWarDiffs.reduce((s, d) => s + d * d, 0) / allWarDiffs.length);
    const overallPythRmse = Math.sqrt(allPythDiffs.reduce((s, d) => s + d * d, 0) / allPythDiffs.length);
    const overallWarMax = Math.max(...allWarDiffs.map(d => Math.abs(d)));
    const overallPythMax = Math.max(...allPythDiffs.map(d => Math.abs(d)));

    console.log(`\n  Team-seasons: ${totalTeams} across ${yearResults.length} seasons\n`);
    console.log('                  WAR-Based    Pythagorean');
    console.log('                  ─────────    ───────────');
    console.log(`  MAE:            ${overallWarMae.toFixed(2).padStart(7)}      ${overallPythMae.toFixed(2).padStart(7)}`);
    console.log(`  RMSE:           ${overallWarRmse.toFixed(2).padStart(7)}      ${overallPythRmse.toFixed(2).padStart(7)}`);
    console.log(`  Max miss:       ${String(overallWarMax).padStart(7)}      ${String(overallPythMax).padStart(7)}`);

    const warBias = allWarDiffs.reduce((s, d) => s + d, 0) / allWarDiffs.length;
    const pythBias = allPythDiffs.reduce((s, d) => s + d, 0) / allPythDiffs.length;
    console.log(`  Mean bias:      ${(warBias >= 0 ? '+' : '') + warBias.toFixed(2).padStart(6)}      ${(pythBias >= 0 ? '+' : '') + pythBias.toFixed(2).padStart(6)}`);

    // Quartile analysis
    const sortedWarDiffs = [...allWarDiffs].sort((a, b) => a - b);
    const sortedPythDiffs = [...allPythDiffs].sort((a, b) => a - b);
    const q1 = Math.floor(totalTeams * 0.25);
    const q3 = Math.floor(totalTeams * 0.75);

    // By actual wins quartile — sort team-seasons by actual wins
    // Pair diffs with actual wins for quartile analysis
    interface TeamDiff { actualWins: number; warDiff: number; pythDiff: number; }
    const teamDiffs: TeamDiff[] = [];
    let idx = 0;
    for (const yr of yearResults) {
      // We already have the diffs in allWarDiffs/allPythDiffs sequentially
      for (let i = 0; i < yr.numTeams; i++) {
        // We don't have actual wins stored separately, but we can reconstruct:
        // diff = projected - actual, so actual = projected - diff... but we don't have projected wins here
        // Just use the diff arrays directly
        teamDiffs.push({ actualWins: 0, warDiff: allWarDiffs[idx], pythDiff: allPythDiffs[idx] });
        idx++;
      }
    }

    // Top/bottom quartile by diff magnitude
    console.log(`\n  Median absolute error:`);
    const warAbsSorted = allWarDiffs.map(d => Math.abs(d)).sort((a, b) => a - b);
    const pythAbsSorted = allPythDiffs.map(d => Math.abs(d)).sort((a, b) => a - b);
    const medianIdx = Math.floor(warAbsSorted.length / 2);
    console.log(`  WAR:  ${warAbsSorted[medianIdx].toFixed(1)} wins`);
    console.log(`  Pyth: ${pythAbsSorted[medianIdx].toFixed(1)} wins`);

    // Winner
    const winner = overallPythMae < overallWarMae ? 'PYTHAGOREAN' : overallWarMae < overallPythMae ? 'WAR-BASED' : 'TIE';
    const margin = Math.abs(overallWarMae - overallPythMae);
    console.log(`\n  ★ Winner: ${winner} (by ${margin.toFixed(2)} wins MAE)`);

    // Wins where each method is closer
    let warCloser = 0, pythCloser = 0, tied = 0;
    for (let i = 0; i < allWarDiffs.length; i++) {
      const warAbs = Math.abs(allWarDiffs[i]);
      const pythAbs = Math.abs(allPythDiffs[i]);
      if (warAbs < pythAbs) warCloser++;
      else if (pythAbs < warAbs) pythCloser++;
      else tied++;
    }
    console.log(`  WAR closer: ${warCloser}/${totalTeams} (${(warCloser / totalTeams * 100).toFixed(1)}%)`);
    console.log(`  Pyth closer: ${pythCloser}/${totalTeams} (${(pythCloser / totalTeams * 100).toFixed(1)}%)`);
    console.log(`  Tied: ${tied}/${totalTeams}`);
  }

  // ── Match diagnostics ──
  printSep('MATCH DIAGNOSTICS');
  console.log('\n  Year  Standings  Projected  Matched  Avg W (matched)  Avg W (all standings)  Bias explanation');
  console.log('  ' + '─'.repeat(95));
  for (const yr of yearResults) {
    const wDiff = yr.avgActualWinsMatched - yr.avgActualWinsAll;
    console.log(
      `  ${yr.year}      ${String(yr.totalStandingsTeams).padStart(3)}` +
      `        ${String(yr.totalProjectedTeams).padStart(3)}` +
      `      ${String(yr.numTeams).padStart(3)}` +
      `           ${yr.avgActualWinsMatched.toFixed(1).padStart(6)}` +
      `               ${yr.avgActualWinsAll.toFixed(1).padStart(6)}` +
      `         ${(wDiff >= 0 ? '+' : '') + wDiff.toFixed(1)} W`
    );
  }
  console.log(`\n  If matched teams have higher avg actual wins than all teams,`);
  console.log(`  the unmatched teams are weaker → matched set is biased high → negative proj bias.`);

  // ── RS/RA diagnostics ──
  printSep('RS/RA DIAGNOSTICS');
  for (const yr of yearResults) {
    console.log(`  ${yr.year}: Avg RS=${yr.avgRs.toFixed(0)}, Avg RA=${yr.avgRa.toFixed(0)}, RS scale=${yr.rsScale.toFixed(3)} (raw RS was ${(yr.avgRs / yr.rsScale).toFixed(0)})`);
  }

  console.log('\nDone.');
}

main();
