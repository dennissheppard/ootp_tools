/**
 * Projection-Based Calibration Tool
 *
 * Replays the full projection pipeline for historical years (2005-2020):
 *   stats → True Ratings → aging → projected stats → WAR
 * Then calibrates a WAR→Wins formula against the PROJECTED WAR values
 * (not the actual-stats WAR that diagnose_compression.ts uses).
 *
 * This matches what the UI standings mode actually computes.
 *
 * Modes:
 *   npx tsx tools/calibrate_projections.ts           -- baseline run
 *   npx tsx tools/calibrate_projections.ts --sweep    -- parameter sweep
 *
 * Usage:
 *   npx tsx tools/calibrate_projections.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const MLB_PITCHING_DIR = path.join(process.cwd(), 'public', 'data', 'mlb');
const MLB_BATTING_DIR = path.join(process.cwd(), 'public', 'data', 'mlb_batting');
const DOB_FILE = path.join(process.cwd(), 'public', 'data', 'mlb_dob.csv');

// ============================================================================
// TUNING CONFIG — all compression-related constants in one place
// ============================================================================

interface TuningConfig {
  /** SP K/9 regression ratio (current service: 0.60) */
  spK9RegressionRatio: number;
  /** Strength multiplier for elite pitchers (FIP < 3.5, current: 0.80) */
  eliteStrengthMultiplier: number;
  /** Neutral model aging dampening factor (current: 0.20) */
  neutralAgingDampening: number;
  /** Model weight in IP blend for established pitchers (current: 0.45) */
  establishedIpModelWeight: number;
  /** WAR multiplier for elite pitchers (FIP < 3.50, current: 1.00 = disabled) */
  eliteWarMultiplier: number;
  /** WAR multiplier for super-elite pitchers (FIP < 3.20, current: 1.00 = disabled) */
  superEliteWarMultiplier: number;
}

const BASELINE_TUNING: TuningConfig = {
  spK9RegressionRatio: 0.60,
  eliteStrengthMultiplier: 0.80,
  neutralAgingDampening: 0.20,
  establishedIpModelWeight: 0.45,
  eliteWarMultiplier: 1.00,
  superEliteWarMultiplier: 1.00,
};

// Active tuning config — modified during sweeps
let TUNING: TuningConfig = { ...BASELINE_TUNING };

// ============================================================================
// Constants — faithfully ported from services
// ============================================================================

// --- Pitcher regression (TrueRatingsCalculationService) ---
const PITCHER_YEAR_WEIGHTS = [5, 3, 2];
const PITCHER_STABILIZATION = { k9: 50, bb9: 40, hr9: 70 };

const PITCHER_LEAGUE_AVGS = {
  SP: { k9: 5.60, bb9: 2.80, hr9: 0.90 },
  SW: { k9: 6.60, bb9: 2.60, hr9: 0.75 },
  RP: { k9: 6.40, bb9: 2.80, hr9: 0.90 },
};

const PITCHER_REGRESSION_RATIOS_BASE = {
  SP: { k9: 0.60, bb9: 0.80, hr9: 0.18 },
  SW: { k9: 1.20, bb9: 0.80, hr9: 0.18 },
  RP: { k9: 1.20, bb9: 0.40, hr9: 0.18 },
};

/** Get regression ratios, using TUNING override for SP K/9 */
function getPitcherRegressionRatios(role: PitcherRole, statType: 'k9' | 'bb9' | 'hr9'): number {
  if (role === 'SP' && statType === 'k9') return TUNING.spK9RegressionRatio;
  return PITCHER_REGRESSION_RATIOS_BASE[role][statType];
}

// FIP → targetOffset breakpoints
const FIP_TARGET_OFFSET_BREAKPOINTS = [
  { fip: 2.5, offset: -3.0 },
  { fip: 3.0, offset: -2.8 },
  { fip: 3.5, offset: -2.0 },
  { fip: 4.0, offset: -0.8 },
  { fip: 4.2, offset: 0.0 },
  { fip: 4.5, offset: 1.0 },
  { fip: 5.0, offset: 1.5 },
  { fip: 6.0, offset: 1.5 },
];

// Pitcher rating formulas (must match PotentialStatsService & TrueRatingsCalculationService)
const PITCHER_K9 = { intercept: 2.10, slope: 0.074 };
const PITCHER_BB9 = { intercept: 5.30, slope: -0.052 };
const PITCHER_HR9 = { intercept: 2.18, slope: -0.024 };
const FIP_CONSTANT = 3.47;
const REPLACEMENT_FIP = 5.20;
const PITCHER_RUNS_PER_WIN = 8.50;

// --- Pitcher aging (AgingService) ---
function getPitcherAgingModifiers(age: number): { stuff: number; control: number; hra: number } {
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

// --- Ensemble projection (EnsembleProjectionService) ---
const ENSEMBLE_BASE_WEIGHTS = { optimistic: 0.35, neutral: 0.55, pessimistic: 0.10 };
const ENSEMBLE_PARAMS = { ageImpact: 0.35, ipImpact: 0.35, trendImpact: 0.40, volatilityImpact: 0.80 };

// --- Hitter regression (HitterTrueRatingsCalculationService) ---
const HITTER_YEAR_WEIGHTS = [5, 3, 2];
const HITTER_STABILIZATION = { bbPct: 120, kPct: 60, hrPct: 160, iso: 160, avg: 300 };
const HITTER_LEAGUE_AVGS = { avgBbPct: 8.5, avgKPct: 22.0, avgIso: 0.140, avgAvg: 0.260 };

const WOBA_REGRESSION_BREAKPOINTS = [
  { woba: 0.400, offset: -0.040 },
  { woba: 0.380, offset: -0.030 },
  { woba: 0.360, offset: -0.020 },
  { woba: 0.340, offset: -0.010 },
  { woba: 0.320, offset: 0.000 },
  { woba: 0.300, offset: 0.010 },
  { woba: 0.280, offset: 0.020 },
  { woba: 0.260, offset: 0.025 },
];

const WOBA_STRENGTH_BREAKPOINTS = [
  { woba: 0.400, multiplier: 0.6 },
  { woba: 0.360, multiplier: 0.8 },
  { woba: 0.320, multiplier: 1.0 },
  { woba: 0.280, multiplier: 1.2 },
  { woba: 0.260, multiplier: 0.8 },
];

// Hitter forward coefficients
const HITTER_EYE = { intercept: 1.6246, slope: 0.114789 };      // Eye → BB%
const HITTER_AVOIDK = { intercept: 25.10, slope: -0.200303 };   // AvoidK → K%
const HITTER_CONTACT = { intercept: 0.035156, slope: 0.003873 }; // Contact → AVG
const HITTER_POWER_LOW = { intercept: -1.034, slope: 0.0637 };   // Power≤50 → HR%
const HITTER_POWER_HIGH = { intercept: -2.75, slope: 0.098 };    // Power>50 → HR%

const WOBA_WEIGHTS = { bb: 0.69, single: 0.89, double: 1.27, triple: 1.62, hr: 2.10 };
const BATTER_LG_WOBA = 0.315;
const BATTER_WOBA_SCALE = 1.15;
const BATTER_RUNS_PER_WIN = 10;
const BATTER_REPLACEMENT_RUNS_PER_600PA = 20;

// --- Hitter aging (HitterAgingService) ---
function getHitterAgingModifiers(age: number): { power: number; eye: number; avoidK: number; contact: number } {
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

// --- PA projection (LeagueBattingAveragesService) ---
const PA_WEIGHTS = [0.40, 0.30, 0.20, 0.10];

function getAgeCurveMultiplier(age: number): number {
  const peakAge = 27.5;
  if (age < 23) return 0.80 + (age - 20) * 0.05;
  if (age < peakAge) return 0.95 + ((age - 23) / (peakAge - 23)) * 0.05;
  if (age <= 32) return 1.0 - ((age - peakAge) / 10) * 0.08;
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

// --- Standings formula (current app values — piecewise) ---
// App now uses piecewise slopes above/below median WAR:
//   Wins = 81 + (WAR - medianWAR) × slope, with zero-sum normalization
const CURRENT_UPPER_SLOPE = 0.830;  // Above-median teams
const CURRENT_LOWER_SLOPE = 0.780;  // Below-median teams
// Legacy linear formula (used by section 2/3 comparisons)
const CURRENT_BASELINE_WINS = 51.7;
const CURRENT_WAR_SLOPE = 0.687;
const SEASON_GAMES = 162;

// ============================================================================
// CSV Parsing
// ============================================================================

function parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
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

// ============================================================================
// Data Loading
// ============================================================================

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
    player_id: headers.indexOf('player_id'),
    team_id: headers.indexOf('team_id'),
    split_id: headers.indexOf('split_id'),
    level_id: headers.indexOf('level_id'),
    ip: headers.indexOf('ip'),
    k: headers.indexOf('k'),
    bb: headers.indexOf('bb'),
    hra: headers.indexOf('hra'),
    gs: headers.indexOf('gs'),
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
      playerId: parseInt(row[idx.player_id]),
      teamId: parseInt(row[idx.team_id]),
      year,
      ip, k, bb, hra,
      gs: parseInt(row[idx.gs]) || 0,
      k9: (k / ip) * 9,
      bb9: (bb / ip) * 9,
      hr9: (hra / ip) * 9,
    });
  }
  return results;
}

function loadBattingStats(year: number): BattingRow[] {
  const filePath = path.join(MLB_BATTING_DIR, `${year}_batting.csv`);
  if (!fs.existsSync(filePath)) return [];
  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    player_id: headers.indexOf('player_id'),
    team_id: headers.indexOf('team_id'),
    split_id: headers.indexOf('split_id'),
    level_id: headers.indexOf('level_id'),
    position: headers.indexOf('position'),
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
  };
  const results: BattingRow[] = [];
  for (const row of rows) {
    if (parseInt(row[idx.split_id]) !== 1) continue;
    if (parseInt(row[idx.level_id]) !== 1) continue;
    const pa = parseInt(row[idx.pa]) || 0;
    if (pa <= 0) continue;
    results.push({
      playerId: parseInt(row[idx.player_id]),
      teamId: parseInt(row[idx.team_id]),
      year,
      position: parseInt(row[idx.position]) || 0,
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
    // Format: MM/DD/YYYY
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
  ooptBatterWar: number; ooptPitcherWar: number; ooptTotalWar: number;
}

function loadStandings(year: number): StandingsRow[] {
  const filePath = path.join(DATA_DIR, `${year}_standings.csv`);
  if (!fs.existsSync(filePath)) return [];
  const { headers, rows } = parseCSV(fs.readFileSync(filePath, 'utf-8'));
  const idx = {
    team: headers.indexOf('team'),
    w: headers.indexOf('w'),
    l: headers.indexOf('l'),
    bWar: headers.indexOf('batterwar'),
    pWar: headers.indexOf('pitcherwar'),
    tWar: headers.indexOf('totalwar'),
  };
  return rows.map(row => ({
    year,
    teamNameRaw: row[idx.team],
    wins: parseInt(row[idx.w]) || 0,
    losses: parseInt(row[idx.l]) || 0,
    ooptBatterWar: parseFloat(row[idx.bWar]) || 0,
    ooptPitcherWar: parseFloat(row[idx.pWar]) || 0,
    ooptTotalWar: parseFloat(row[idx.tWar]) || 0,
  }));
}

// ============================================================================
// Pitcher Projection Pipeline
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

/** Piecewise linear interpolation */
function interpolateBreakpoints(value: number, breakpoints: Array<{ fip?: number; woba?: number; offset?: number; multiplier?: number }>, xKey: string, yKey: string): number {
  const arr = breakpoints as any[];
  if (value <= arr[0][xKey]) return arr[0][yKey];
  if (value >= arr[arr.length - 1][xKey]) return arr[arr.length - 1][yKey];
  for (let i = 0; i < arr.length - 1; i++) {
    if (value >= arr[i][xKey] && value <= arr[i + 1][xKey]) {
      const t = (value - arr[i][xKey]) / (arr[i + 1][xKey] - arr[i][xKey]);
      return arr[i][yKey] + t * (arr[i + 1][yKey] - arr[i][yKey]);
    }
  }
  return arr[0][yKey];
}

function calculateFipLike(k9: number, bb9: number, hr9: number): number {
  return (13 * hr9 + 3 * bb9 - 2 * k9) / 9;
}

function calculateFip(k9: number, bb9: number, hr9: number): number {
  return calculateFipLike(k9, bb9, hr9) + FIP_CONSTANT;
}

/** Calculate pitcher WAR with optional TUNING multiplier */
function calculatePitcherWar(ip: number, k9: number, bb9: number, hr9: number): number {
  const fip = calculateFip(k9, bb9, hr9);
  let war = ((REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (ip / 9);

  // Apply WAR multiplier from TUNING (only for positive WAR / elite pitchers)
  if (war > 0) {
    if (fip < 3.20) {
      war *= TUNING.superEliteWarMultiplier;
    } else if (fip < 3.50) {
      // Linear interpolation between super-elite and elite
      const t = (fip - 3.20) / (3.50 - 3.20);
      const mult = TUNING.superEliteWarMultiplier + t * (TUNING.eliteWarMultiplier - TUNING.superEliteWarMultiplier);
      war *= mult;
    } else if (fip < 4.20) {
      // Linear interpolation between elite and 1.00 at FIP 4.20
      const t = (fip - 3.50) / (4.20 - 3.50);
      const mult = TUNING.eliteWarMultiplier + t * (1.00 - TUNING.eliteWarMultiplier);
      war *= mult;
    }
  }

  return war;
}

/** Multi-year weighted average of pitcher rate stats */
function pitcherWeightedRates(yearlyStats: PitchingRow[]): { k9: number; bb9: number; hr9: number; totalIp: number; avgGs: number } {
  if (yearlyStats.length === 0) return { k9: 0, bb9: 0, hr9: 0, totalIp: 0, avgGs: 0 };
  let wK9 = 0, wBb9 = 0, wHr9 = 0, totalWeight = 0, totalIp = 0, totalGs = 0, yearCount = 0;
  const yearsToProcess = Math.min(yearlyStats.length, PITCHER_YEAR_WEIGHTS.length);
  for (let i = 0; i < yearsToProcess; i++) {
    const s = yearlyStats[i];
    const yw = PITCHER_YEAR_WEIGHTS[i];
    if (yw === 0) continue;
    const w = yw * s.ip;
    wK9 += s.k9 * w;
    wBb9 += s.bb9 * w;
    wHr9 += s.hr9 * w;
    totalWeight += w;
    totalIp += s.ip;
    totalGs += s.gs;
    yearCount++;
  }
  if (totalWeight === 0) return { k9: 0, bb9: 0, hr9: 0, totalIp: 0, avgGs: 0 };
  return {
    k9: wK9 / totalWeight,
    bb9: wBb9 / totalWeight,
    hr9: wHr9 / totalWeight,
    totalIp,
    avgGs: yearCount > 0 ? totalGs / yearCount : 0,
  };
}

/** Tier-aware regression for a single pitcher rate stat — uses TUNING */
function regressPitcherStat(
  weightedRate: number, totalIp: number, leagueRate: number, stabilizationK: number,
  statType: 'k9' | 'bb9' | 'hr9', allWeighted: { k9: number; bb9: number; hr9: number },
  role: PitcherRole
): number {
  if (totalIp + stabilizationK === 0) return leagueRate;

  const fipLike = calculateFipLike(allWeighted.k9, allWeighted.bb9, allWeighted.hr9);
  const estimatedFip = fipLike + FIP_CONSTANT;

  const targetOffset = interpolateBreakpoints(estimatedFip, FIP_TARGET_OFFSET_BREAKPOINTS, 'fip', 'offset');

  // Strength multiplier — uses TUNING for elite tier
  let strengthMultiplier: number;
  if (estimatedFip < 3.5) strengthMultiplier = TUNING.eliteStrengthMultiplier;
  else if (estimatedFip < 4.0) strengthMultiplier = 1.50;
  else if (estimatedFip < 4.5) strengthMultiplier = 1.80;
  else strengthMultiplier = 2.00;

  // Regression ratio — uses TUNING for SP K/9
  const regressionRatio = getPitcherRegressionRatios(role, statType);

  let regressionTarget: number;
  if (statType === 'k9') {
    regressionTarget = leagueRate - (targetOffset * regressionRatio);
  } else {
    regressionTarget = leagueRate + (targetOffset * regressionRatio);
  }

  let adjustedK = stabilizationK * strengthMultiplier;

  // IP-aware scaling
  const ipConfidence = Math.min(1.0, totalIp / 100);
  const ipScale = 0.5 + (ipConfidence * 0.5);
  adjustedK *= ipScale;

  return (weightedRate * totalIp + regressionTarget * adjustedK) / (totalIp + adjustedK);
}

/** Inverse formulas: rate stat → rating (0-100 internal scale) */
function estimateStuff(k9: number): number { return Math.max(0, Math.min(100, (k9 - PITCHER_K9.intercept) / PITCHER_K9.slope)); }
function estimateControl(bb9: number): number { return Math.max(0, Math.min(100, (PITCHER_BB9.intercept - bb9) / (-PITCHER_BB9.slope))); }
function estimateHra(hr9: number): number { return Math.max(0, Math.min(100, (PITCHER_HR9.intercept - hr9) / (-PITCHER_HR9.slope))); }

/** Forward formulas: rating → rate stat */
function ratingToK9(stuff: number): number { return Math.max(0, Math.min(15, PITCHER_K9.intercept + PITCHER_K9.slope * stuff)); }
function ratingToBb9(control: number): number { return Math.max(0, Math.min(10, PITCHER_BB9.intercept + PITCHER_BB9.slope * control)); }
function ratingToHr9(hra: number): number { return Math.max(0, Math.min(3, PITCHER_HR9.intercept + PITCHER_HR9.slope * hra)); }

/** Apply pitcher aging to ratings */
function applyPitcherAging(ratings: { stuff: number; control: number; hra: number }, age: number) {
  const mods = getPitcherAgingModifiers(age);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return {
    stuff: clamp(ratings.stuff + mods.stuff),
    control: clamp(ratings.control + mods.control),
    hra: clamp(ratings.hra + mods.hra),
  };
}

/** Simplified ensemble projection for pitchers — uses TUNING.neutralAgingDampening */
function ensemblePitcherProjection(
  currentRatings: { stuff: number; control: number; hra: number },
  age: number,
  yearlyStats: PitchingRow[]
): { k9: number; bb9: number; hr9: number } {
  // Optimistic: full aging
  const optRatings = applyPitcherAging(currentRatings, age);
  const opt = { k9: ratingToK9(optRatings.stuff), bb9: ratingToBb9(optRatings.control), hr9: ratingToHr9(optRatings.hra) };

  // Neutral: TUNING-controlled dampening (default 20% of aging)
  const ageMods = getPitcherAgingModifiers(age);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const damp = TUNING.neutralAgingDampening;
  const neutRatings = {
    stuff: clamp(currentRatings.stuff + ageMods.stuff * damp),
    control: clamp(currentRatings.control + ageMods.control * damp),
    hra: clamp(currentRatings.hra + ageMods.hra * damp),
  };
  const neut = { k9: ratingToK9(neutRatings.stuff), bb9: ratingToBb9(neutRatings.control), hr9: ratingToHr9(neutRatings.hra) };

  // Pessimistic: trend-based (or fallback to neutral)
  let pess = { ...neut };
  if (yearlyStats.length >= 2 && yearlyStats[1].ip >= 10) {
    const currK9 = ratingToK9(currentRatings.stuff);
    const currBb9 = ratingToBb9(currentRatings.control);
    const currHr9 = ratingToHr9(currentRatings.hra);
    // 50% dampening on trend
    pess = {
      k9: Math.max(1, Math.min(15, currK9 + (yearlyStats[0].k9 - yearlyStats[1].k9) * 0.5)),
      bb9: Math.max(0.5, Math.min(10, currBb9 + (yearlyStats[0].bb9 - yearlyStats[1].bb9) * 0.5)),
      hr9: Math.max(0, Math.min(3, currHr9 + (yearlyStats[0].hr9 - yearlyStats[1].hr9) * 0.5)),
    };
  }

  // Calculate weights (simplified: use base weights + age/ip adjustments)
  const totalIp = yearlyStats.reduce((s, st) => s + st.ip, 0);
  const ipConf = Math.min(1.0, totalIp / 300);
  const ageFactor = age < 23 ? 0.7 : age < 25 ? 0.5 : age < 28 ? 0.3 : age < 32 ? 0.2 : 0.1;

  let wOpt = ENSEMBLE_BASE_WEIGHTS.optimistic + ageFactor * ENSEMBLE_PARAMS.ageImpact - ipConf * ENSEMBLE_PARAMS.ipImpact;
  let wNeut = ENSEMBLE_BASE_WEIGHTS.neutral - ageFactor * ENSEMBLE_PARAMS.ageImpact * 0.5 + ipConf * ENSEMBLE_PARAMS.ipImpact * 0.75;
  let wPess = ENSEMBLE_BASE_WEIGHTS.pessimistic - ageFactor * ENSEMBLE_PARAMS.ageImpact * 0.5 + ipConf * ENSEMBLE_PARAMS.ipImpact * 0.25;

  wOpt = Math.max(0, wOpt);
  wNeut = Math.max(0, wNeut);
  wPess = Math.max(0, wPess);
  const sum = wOpt + wNeut + wPess;
  if (sum === 0) return neut;
  wOpt /= sum; wNeut /= sum; wPess /= sum;

  return {
    k9: opt.k9 * wOpt + neut.k9 * wNeut + pess.k9 * wPess,
    bb9: opt.bb9 * wOpt + neut.bb9 * wNeut + pess.bb9 * wPess,
    hr9: opt.hr9 * wOpt + neut.hr9 * wNeut + pess.hr9 * wPess,
  };
}

/** Project IP for a pitcher — uses TUNING.establishedIpModelWeight */
function projectPitcherIp(
  isSp: boolean, age: number, yearlyStats: PitchingRow[], projectedFip: number
): number {
  const stamina = 50; // default (no scouting data)
  let baseIp = isSp ? 10 + stamina * 3.0 : 30 + stamina * 0.6;
  if (isSp) baseIp = Math.max(100, Math.min(280, baseIp));
  else baseIp = Math.max(30, Math.min(100, baseIp));

  // Skill modifier
  if (projectedFip <= 3.50) baseIp *= 1.20;
  else if (projectedFip <= 4.00) baseIp *= 1.10;
  else if (projectedFip <= 4.50) baseIp *= 1.0;
  else if (projectedFip <= 5.00) baseIp *= 0.90;
  else baseIp *= 0.80;

  // Historical blend — uses TUNING for model weight
  if (yearlyStats.length > 0) {
    const minIpThreshold = isSp ? 50 : 10;
    const completed = yearlyStats.filter(s => s.ip >= minIpThreshold);
    if (completed.length > 0) {
      let wIp = 0, wTotal = 0;
      const wts = [5, 3, 2];
      for (let i = 0; i < Math.min(completed.length, 3); i++) {
        wIp += completed[i].ip * wts[i];
        wTotal += wts[i];
      }
      if (wTotal > 0) {
        const weightedIp = wIp / wTotal;
        const modelWeight = TUNING.establishedIpModelWeight;
        if (weightedIp > 50) baseIp = baseIp * modelWeight + weightedIp * (1 - modelWeight);
        else baseIp = baseIp * 0.50 + weightedIp * 0.50;
      }
    }
  }

  // Age cliff
  if (age >= 46) baseIp *= 0.10;
  else if (age >= 43) baseIp *= 0.40;
  else if (age >= 40) baseIp *= 0.75;

  // Elite IP boost
  if (projectedFip < 3.0) baseIp *= 1.08;
  else if (projectedFip < 3.5) {
    const t = (projectedFip - 3.0) / 0.5;
    baseIp *= 1.08 - t * 0.05;
  } else if (projectedFip < 4.0) {
    const t = (projectedFip - 3.5) / 0.5;
    baseIp *= 1.03 - t * 0.03;
  }

  return Math.round(baseIp);
}

// ============================================================================
// Hitter Projection Pipeline (unchanged — separate pipeline)
// ============================================================================

/** Multi-year weighted average of hitter rate stats */
function hitterWeightedRates(yearlyStats: BattingRow[]): {
  bbPct: number; kPct: number; hrPct: number; iso: number; avg: number;
  sbPerPa: number; csPerPa: number; totalPa: number;
} {
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
  return {
    bbPct: wBb / totalWeight, kPct: wK / totalWeight, hrPct: wHr / totalWeight,
    iso: wIso / totalWeight, avg: wAvg / totalWeight,
    sbPerPa: wSb / totalWeight, csPerPa: wCs / totalWeight,
    totalPa,
  };
}

/** Calculate wOBA from rate stats (matching HitterTrueRatingsCalculationService) */
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

/** wOBA-based regression target offset */
function getWobaTargetOffset(woba: number): number {
  return interpolateBreakpoints(woba, WOBA_REGRESSION_BREAKPOINTS, 'woba', 'offset');
}

function getWobaStrengthMultiplier(woba: number): number {
  return interpolateBreakpoints(woba, WOBA_STRENGTH_BREAKPOINTS, 'woba', 'multiplier');
}

/** Tier-aware regression for hitter stats */
function regressHitterStat(
  weightedRate: number, totalPa: number, leagueRate: number, stabilizationK: number,
  statType: 'bbPct' | 'kPct' | 'iso' | 'avg', estimatedWoba: number
): number {
  if (totalPa + stabilizationK === 0) return leagueRate;
  const targetOffset = getWobaTargetOffset(estimatedWoba);
  const strengthMultiplier = getWobaStrengthMultiplier(estimatedWoba);

  const multipliers: Record<string, number> = { bbPct: 30, kPct: 50, iso: 1.5, avg: 0.8 };
  let regressionTarget: number;
  if (statType === 'kPct') {
    regressionTarget = leagueRate + (targetOffset * multipliers[statType]);
  } else {
    regressionTarget = leagueRate - (targetOffset * multipliers[statType]);
  }

  let adjustedK = stabilizationK * strengthMultiplier;
  const paConfidence = Math.min(1.0, totalPa / 500);
  const paScale = 0.5 + paConfidence * 0.5;
  adjustedK *= paScale;

  return (weightedRate * totalPa + regressionTarget * adjustedK) / (totalPa + adjustedK);
}

/** Inverse formulas: hitter rate stat → rating (20-80 scale) */
function estimateEye(bbPct: number): number { return Math.max(20, Math.min(80, (bbPct - HITTER_EYE.intercept) / HITTER_EYE.slope)); }
function estimateAvoidK(kPct: number): number { return Math.max(20, Math.min(80, (kPct - HITTER_AVOIDK.intercept) / HITTER_AVOIDK.slope)); }
function estimateContact(avg: number): number { return Math.max(20, Math.min(80, (avg - HITTER_CONTACT.intercept) / HITTER_CONTACT.slope)); }
function estimatePower(hrPct: number): number {
  const bp = 2.15;
  if (hrPct <= bp) return Math.max(20, Math.min(80, (hrPct - HITTER_POWER_LOW.intercept) / HITTER_POWER_LOW.slope));
  return Math.max(20, Math.min(80, (hrPct - HITTER_POWER_HIGH.intercept) / HITTER_POWER_HIGH.slope));
}

/** Forward formulas: hitter rating → rate stat */
function ratingToBbPct(eye: number): number { return HITTER_EYE.intercept + HITTER_EYE.slope * eye; }
function ratingToKPct(avoidK: number): number { return HITTER_AVOIDK.intercept + HITTER_AVOIDK.slope * avoidK; }
function ratingToAvg(contact: number): number { return HITTER_CONTACT.intercept + HITTER_CONTACT.slope * contact; }
function ratingToHrPct(power: number): number {
  if (power <= 50) return Math.max(0, HITTER_POWER_LOW.intercept + HITTER_POWER_LOW.slope * power);
  return Math.max(0, HITTER_POWER_HIGH.intercept + HITTER_POWER_HIGH.slope * power);
}

/** Apply hitter aging to ratings */
function applyHitterAging(ratings: { power: number; eye: number; avoidK: number; contact: number }, age: number) {
  const mods = getHitterAgingModifiers(age);
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return {
    power: clamp(ratings.power + mods.power),
    eye: clamp(ratings.eye + mods.eye),
    avoidK: clamp(ratings.avoidK + mods.avoidK),
    contact: clamp(ratings.contact + mods.contact),
  };
}

/** Calculate batter WAR from wOBA, PA, and SB/CS */
function calculateBatterWar(woba: number, pa: number, sbPerPa: number, csPerPa: number): number {
  const wRAA = ((woba - BATTER_LG_WOBA) / BATTER_WOBA_SCALE) * pa;
  const replacementRuns = (pa / 600) * BATTER_REPLACEMENT_RUNS_PER_600PA;
  const sbRuns = sbPerPa * pa * 0.2 - csPerPa * pa * 0.4;
  return (wRAA + replacementRuns + sbRuns) / BATTER_RUNS_PER_WIN;
}

/** Project PA using historical blend + age curve */
function projectPa(historicalPas: Array<{ year: number; pa: number }>, currentAge: number): number {
  if (historicalPas.length === 0) return getBaselinePaByAge(currentAge);

  const sorted = [...historicalPas].sort((a, b) => b.year - a.year).slice(0, 4);
  let wPaSum = 0, wTotal = 0;
  for (let i = 0; i < sorted.length; i++) {
    const w = PA_WEIGHTS[i] || 0.10;
    wPaSum += sorted[i].pa * w;
    wTotal += w;
  }
  const historicalAvgPa = wPaSum / wTotal;

  // Average historical age
  let wAgeSum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const w = PA_WEIGHTS[i] || 0.10;
    wAgeSum += (currentAge - (i + 1)) * w;
  }
  const avgHistoricalAge = wAgeSum / wTotal;

  const ageCurve = getAgeCurveMultiplier(currentAge) / getAgeCurveMultiplier(avgHistoricalAge);
  const ageAdjustedPa = historicalAvgPa * ageCurve;

  let trustFactor = Math.min(0.98, 0.40 + sorted.length * 0.20);
  if (historicalAvgPa >= 500 && sorted.length >= 2) trustFactor = Math.min(0.98, trustFactor + 0.05);

  const baselinePa = historicalAvgPa < 250
    ? Math.min(getBaselinePaByAge(currentAge), 350)
    : getBaselinePaByAge(currentAge);
  const blendedPa = ageAdjustedPa * trustFactor + baselinePa * (1 - trustFactor);
  return Math.round(Math.max(50, Math.min(700, blendedPa)));
}

// ============================================================================
// Main Pipeline
// ============================================================================

interface ProjectedTeam {
  teamId: number;
  year: number;
  pitcherWar: number;
  batterWar: number;
  totalWar: number;
  rotationWar: number;
  bullpenWar: number;
  lineupWar: number;
  benchWar: number;
  pitcherCount: number;
  batterCount: number;
}

interface PitcherProjection { playerId: number; teamId: number; year?: number; war: number; ip: number; isSp: boolean; fip: number; actualIp?: number; }

function runProjectionPipeline(projectionYear: number, dobMap: Map<number, number>): { teams: Map<number, ProjectedTeam>; pitchers: PitcherProjection[] } {
  // Load multi-year stats (Y-3 through Y-1)
  const allPitching: Map<number, PitchingRow[]> = new Map();
  const allBatting: Map<number, BattingRow[]> = new Map();

  for (let y = projectionYear - 3; y < projectionYear; y++) {
    const pitching = loadPitchingStats(y);
    for (const row of pitching) {
      if (!allPitching.has(row.playerId)) allPitching.set(row.playerId, []);
      allPitching.get(row.playerId)!.push(row);
    }
    const batting = loadBattingStats(y);
    for (const row of batting) {
      if (!allBatting.has(row.playerId)) allBatting.set(row.playerId, []);
      allBatting.get(row.playerId)!.push(row);
    }
  }

  // Sort each player's stats by year descending (most recent first)
  for (const [, stats] of allPitching) stats.sort((a, b) => b.year - a.year);
  for (const [, stats] of allBatting) stats.sort((a, b) => b.year - a.year);

  // Load projection year stats for team assignment
  const projYearPitching = loadPitchingStats(projectionYear);
  const projYearBatting = loadBattingStats(projectionYear);

  // Build team assignment maps and actual IP lookup (from projection year stats)
  const pitcherTeams = new Map<number, number>();
  const actualIpMap = new Map<number, number>();
  for (const row of projYearPitching) {
    pitcherTeams.set(row.playerId, row.teamId);
    actualIpMap.set(row.playerId, row.ip);
  }
  const batterTeams = new Map<number, number>();
  for (const row of projYearBatting) batterTeams.set(row.playerId, row.teamId);

  // ─── Pitcher projections ───
  const pitcherProjections: PitcherProjection[] = [];

  for (const [playerId, yearlyStats] of allPitching) {
    const teamId = pitcherTeams.get(playerId);
    if (teamId === undefined) continue;

    const birthYear = dobMap.get(playerId);
    if (birthYear === undefined) continue;
    const age = projectionYear - birthYear;

    const weighted = pitcherWeightedRates(yearlyStats);
    if (weighted.totalIp === 0) continue;

    // Classify role
    const role = classifyPitcherRole(weighted.avgGs, weighted.totalIp);
    const ipRole = getRoleFromIp(weighted.totalIp);
    const effectiveRole = role === 'SP' ? 'SP' : ipRole;

    const leagueAvgs = PITCHER_LEAGUE_AVGS[effectiveRole];

    // Tier-aware regression
    const allW = { k9: weighted.k9, bb9: weighted.bb9, hr9: weighted.hr9 };
    const regressedK9 = regressPitcherStat(weighted.k9, weighted.totalIp, leagueAvgs.k9, PITCHER_STABILIZATION.k9, 'k9', allW, effectiveRole);
    const regressedBb9 = regressPitcherStat(weighted.bb9, weighted.totalIp, leagueAvgs.bb9, PITCHER_STABILIZATION.bb9, 'bb9', allW, effectiveRole);
    const regressedHr9 = regressPitcherStat(weighted.hr9, weighted.totalIp, leagueAvgs.hr9, PITCHER_STABILIZATION.hr9, 'hr9', allW, effectiveRole);

    // Estimate ratings
    const currentRatings = {
      stuff: estimateStuff(regressedK9),
      control: estimateControl(regressedBb9),
      hra: estimateHra(regressedHr9),
    };

    // Ensemble projection (aging + trend blend)
    const projected = ensemblePitcherProjection(currentRatings, age, yearlyStats);
    const projFip = calculateFip(projected.k9, projected.bb9, projected.hr9);

    // Project IP
    const isSp = role === 'SP';
    const ip = projectPitcherIp(isSp, age + 1, yearlyStats, projFip);

    // Calculate WAR (includes TUNING multiplier)
    const war = calculatePitcherWar(ip, projected.k9, projected.bb9, projected.hr9);

    pitcherProjections.push({ playerId, teamId, year: projectionYear, war, ip, isSp, fip: projFip, actualIp: actualIpMap.get(playerId) });
  }

  // ─── Batter projections ───
  interface BatterProjection { playerId: number; teamId: number; war: number; pa: number; }
  const batterProjections: BatterProjection[] = [];

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
    const rIso = regressHitterStat(weighted.iso, weighted.totalPa, HITTER_LEAGUE_AVGS.avgIso, HITTER_STABILIZATION.iso, 'iso', rawWoba);
    const rAvg = regressHitterStat(weighted.avg, weighted.totalPa, HITTER_LEAGUE_AVGS.avgAvg, HITTER_STABILIZATION.avg, 'avg', rawWoba);

    const currentRatings = {
      power: estimatePower(rHr),
      eye: estimateEye(rBb),
      avoidK: estimateAvoidK(rK),
      contact: estimateContact(rAvg),
    };

    const projRatings = applyHitterAging(currentRatings, age);

    const projBbPct = ratingToBbPct(projRatings.eye);
    const projKPct = ratingToKPct(projRatings.avoidK);
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
      WOBA_WEIGHTS.bb * bbRate +
      WOBA_WEIGHTS.single * singleRate +
      WOBA_WEIGHTS.double * doubleRate +
      WOBA_WEIGHTS.triple * tripleRate +
      WOBA_WEIGHTS.hr * hrRate
    ));

    const historicalPas = yearlyStats.map(s => ({ year: s.year, pa: s.pa }));
    const pa = projectPa(historicalPas, age + 1);

    const war = calculateBatterWar(projWoba, pa, weighted.sbPerPa, weighted.csPerPa);

    batterProjections.push({ playerId, teamId, war, pa });
  }

  // ─── Team assembly ───
  const teamMap = new Map<number, ProjectedTeam>();
  const ensureTeam = (teamId: number): ProjectedTeam => {
    if (!teamMap.has(teamId)) {
      teamMap.set(teamId, {
        teamId, year: projectionYear,
        pitcherWar: 0, batterWar: 0, totalWar: 0,
        rotationWar: 0, bullpenWar: 0, lineupWar: 0, benchWar: 0,
        pitcherCount: 0, batterCount: 0,
      });
    }
    return teamMap.get(teamId)!;
  };

  const pitchersByTeam = new Map<number, PitcherProjection[]>();
  for (const p of pitcherProjections) {
    if (!pitchersByTeam.has(p.teamId)) pitchersByTeam.set(p.teamId, []);
    pitchersByTeam.get(p.teamId)!.push(p);
  }

  for (const [teamId, pitchers] of pitchersByTeam) {
    const team = ensureTeam(teamId);
    const sps = pitchers.filter(p => p.isSp).sort((a, b) => b.war - a.war);
    const rps = pitchers.filter(p => !p.isSp);
    const rotation = sps.slice(0, 5);
    const bullpen = [...sps.slice(5), ...rps].sort((a, b) => b.war - a.war).slice(0, 8);
    team.rotationWar = rotation.reduce((s, p) => s + p.war, 0);
    team.bullpenWar = bullpen.reduce((s, p) => s + p.war, 0);
    team.pitcherWar = team.rotationWar + team.bullpenWar;
    team.pitcherCount = rotation.length + bullpen.length;
  }

  const battersByTeam = new Map<number, { playerId: number; teamId: number; war: number; pa: number }[]>();
  for (const b of batterProjections) {
    if (!battersByTeam.has(b.teamId)) battersByTeam.set(b.teamId, []);
    battersByTeam.get(b.teamId)!.push(b);
  }

  for (const [teamId, batters] of battersByTeam) {
    const team = ensureTeam(teamId);
    const sorted = [...batters].sort((a, b) => b.war - a.war);
    const lineup = sorted.slice(0, 9);
    const bench = sorted.slice(9, 13);
    team.lineupWar = lineup.reduce((s, p) => s + p.war, 0);
    team.benchWar = bench.reduce((s, p) => s + p.war, 0);
    team.batterWar = team.lineupWar + team.benchWar;
    team.batterCount = lineup.length + bench.length;
  }

  for (const team of teamMap.values()) {
    team.totalWar = team.pitcherWar + team.batterWar;
  }

  return { teams: teamMap, pitchers: pitcherProjections };
}

// ============================================================================
// Calibration & Reporting
// ============================================================================

function linearRegression(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return { slope: 0, intercept: 0, r: 0, rSquared: 0, n, stdResidual: 0 };
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let ssXX = 0, ssYY = 0, ssXY = 0;
  for (let i = 0; i < n; i++) {
    ssXX += (xs[i] - meanX) ** 2;
    ssYY += (ys[i] - meanY) ** 2;
    ssXY += (xs[i] - meanX) * (ys[i] - meanY);
  }
  if (ssXX === 0 || ssYY === 0) return { slope: 0, intercept: meanY, r: 0, rSquared: 0, n, stdResidual: 0 };
  const slope = ssXY / ssXX;
  const intercept = meanY - slope * meanX;
  const r = ssXY / Math.sqrt(ssXX * ssYY);
  let ssRes = 0;
  for (let i = 0; i < n; i++) ssRes += (ys[i] - (slope * xs[i] + intercept)) ** 2;
  return { slope, intercept, r, rSquared: r * r, n, stdResidual: Math.sqrt(ssRes / Math.max(1, n - 2)) };
}

const avg = (arr: number[]) => arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

interface MatchedTeam {
  year: number;
  teamId: number;
  wins: number;
  projectedWar: number;
  projBatterWar: number;
  projPitcherWar: number;
  ooptTotalWar: number;
  ooptBatterWar: number;
  ooptPitcherWar: number;
  rotationWar: number;
}

/** Compact metrics for sweep mode */
interface SweepMetrics {
  pitcherSlope: number;
  pitcherR2: number;
  batterSlope: number;
  batterR2: number;
  overallSlope: number;
  overallR2: number;
  mae: number;
  rotationSlope: number;
  rotationR2: number;
  bottomQuartileBias: number;
}

function matchTeams(
  projectedTeamsByYear: Map<number, Map<number, ProjectedTeam>>,
  standingsByYear: Map<number, StandingsRow[]>,
  actualStatsByYear: Map<number, { teamId: number; war: number }[]>
): MatchedTeam[] {
  const matched: MatchedTeam[] = [];

  for (const [year, standings] of standingsByYear) {
    const projected = projectedTeamsByYear.get(year);
    if (!projected) continue;

    const actualStats = actualStatsByYear.get(year);
    if (!actualStats) continue;

    const usedTeamIds = new Set<number>();
    for (const st of standings) {
      let bestMatch: { teamId: number; war: number } | null = null;
      let bestDiff = Infinity;
      for (const actual of actualStats) {
        if (usedTeamIds.has(actual.teamId)) continue;
        const diff = Math.abs(st.ooptTotalWar - actual.war);
        if (diff < bestDiff) { bestDiff = diff; bestMatch = actual; }
      }
      if (bestMatch && bestDiff < 5.0) {
        usedTeamIds.add(bestMatch.teamId);
        const proj = projected.get(bestMatch.teamId);
        if (proj) {
          matched.push({
            year, teamId: bestMatch.teamId, wins: st.wins,
            projectedWar: proj.totalWar,
            projBatterWar: proj.batterWar,
            projPitcherWar: proj.pitcherWar,
            ooptTotalWar: st.ooptTotalWar,
            ooptBatterWar: st.ooptBatterWar,
            ooptPitcherWar: st.ooptPitcherWar,
            rotationWar: proj.rotationWar,
          });
        }
      }
    }
  }

  return matched;
}

function computeMetrics(matched: MatchedTeam[]): SweepMetrics {
  if (matched.length === 0) {
    return { pitcherSlope: 0, pitcherR2: 0, batterSlope: 0, batterR2: 0, overallSlope: 0, overallR2: 0, mae: 99, rotationSlope: 0, rotationR2: 0, bottomQuartileBias: 0 };
  }

  const pitReg = linearRegression(matched.map(m => m.ooptPitcherWar), matched.map(m => m.projPitcherWar));
  const batReg = linearRegression(matched.map(m => m.ooptBatterWar), matched.map(m => m.projBatterWar));
  const overallReg = linearRegression(matched.map(m => m.ooptTotalWar), matched.map(m => m.projectedWar));

  // Rotation-specific R² (top 5 SP per team)
  const rotReg = linearRegression(matched.map(m => m.ooptPitcherWar), matched.map(m => m.rotationWar));

  // WAR→Wins calibration for MAE
  const projWars = matched.map(m => m.projectedWar);
  const calReg = linearRegression(projWars, matched.map(m => m.wins));

  const byYear = new Map<number, MatchedTeam[]>();
  for (const m of matched) {
    if (!byYear.has(m.year)) byYear.set(m.year, []);
    byYear.get(m.year)!.push(m);
  }

  let allDiffs: number[] = [];
  let bottomDiffs: number[] = [];
  for (const [, teams] of byYear) {
    const rawList = teams.map(m => ({
      ...m, rawWins: calReg.intercept + calReg.slope * m.projectedWar
    }));
    const numTeams = rawList.length;
    const expectedTotal = numTeams * (SEASON_GAMES / 2);
    const currentTotal = rawList.reduce((s, t) => s + t.rawWins, 0);
    const offset = (expectedTotal - currentTotal) / numTeams;
    const results = rawList.map(t => ({
      wins: t.wins,
      projWins: Math.round(t.rawWins + offset),
      diff: Math.round(t.rawWins + offset) - t.wins,
    }));

    const sorted = [...results].sort((a, b) => b.wins - a.wins);
    const n = sorted.length;
    const q3 = Math.ceil(n * 0.75);
    sorted.forEach((t, i) => {
      allDiffs.push(t.diff);
      if (i >= q3) bottomDiffs.push(t.diff);
    });
  }

  const mae = avg(allDiffs.map(d => Math.abs(d)));
  const bottomQuartileBias = avg(bottomDiffs);

  return {
    pitcherSlope: pitReg.slope,
    pitcherR2: pitReg.rSquared,
    batterSlope: batReg.slope,
    batterR2: batReg.rSquared,
    overallSlope: overallReg.slope,
    overallR2: overallReg.rSquared,
    mae,
    rotationSlope: rotReg.slope,
    rotationR2: rotReg.rSquared,
    bottomQuartileBias,
  };
}

function matchAndCalibrate(
  projectedTeamsByYear: Map<number, Map<number, ProjectedTeam>>,
  standingsByYear: Map<number, StandingsRow[]>,
  actualStatsByYear: Map<number, { teamId: number; war: number }[]>,
  allPitchers: PitcherProjection[],
  data?: PreloadedData
): void {
  const matched = matchTeams(projectedTeamsByYear, standingsByYear, actualStatsByYear);

  if (matched.length === 0) {
    console.log('No matched teams found!');
    return;
  }

  console.log(`\nMatched ${matched.length} team-years across ${new Set(matched.map(m => m.year)).size} seasons\n`);

  // ─── TUNING config display ───
  printSep('TUNING CONFIG');
  console.log(`  spK9RegressionRatio:    ${TUNING.spK9RegressionRatio}`);
  console.log(`  eliteStrengthMultiplier: ${TUNING.eliteStrengthMultiplier}`);
  console.log(`  neutralAgingDampening:   ${TUNING.neutralAgingDampening}`);
  console.log(`  establishedIpModelWeight: ${TUNING.establishedIpModelWeight}`);
  console.log(`  eliteWarMultiplier:      ${TUNING.eliteWarMultiplier}`);
  console.log(`  superEliteWarMultiplier: ${TUNING.superEliteWarMultiplier}`);

  // ─── 1. Projected WAR Range Analysis ───
  printSep('1. PROJECTED WAR RANGE vs OOTP WAR');
  const projWars = matched.map(m => m.projectedWar);
  const ooptWars = matched.map(m => m.ooptTotalWar);
  const projRange = Math.max(...projWars) - Math.min(...projWars);
  const ooptRange = Math.max(...ooptWars) - Math.min(...ooptWars);

  console.log(`  OOTP WAR range:      ${Math.min(...ooptWars).toFixed(1)} to ${Math.max(...ooptWars).toFixed(1)} (span: ${ooptRange.toFixed(1)})`);
  console.log(`  Projected WAR range: ${Math.min(...projWars).toFixed(1)} to ${Math.max(...projWars).toFixed(1)} (span: ${projRange.toFixed(1)})`);
  console.log(`  Range ratio: ${(projRange / ooptRange).toFixed(3)}`);
  console.log(`  Compression: ${((1 - projRange / ooptRange) * 100).toFixed(1)}%`);

  const reg = linearRegression(ooptWars, projWars);
  console.log(`\n  Projected = ${reg.slope.toFixed(3)} × OOTP WAR + ${reg.intercept.toFixed(1)}`);
  console.log(`  R² = ${reg.rSquared.toFixed(4)}`);

  // Component-level
  const batReg = linearRegression(
    matched.map(m => m.ooptBatterWar), matched.map(m => m.projBatterWar));
  const pitReg = linearRegression(
    matched.map(m => m.ooptPitcherWar), matched.map(m => m.projPitcherWar));
  console.log(`\n  Component compression:`);
  console.log(`    Batting:  slope=${batReg.slope.toFixed(3)}, R²=${batReg.rSquared.toFixed(3)}`);
  console.log(`    Pitching: slope=${pitReg.slope.toFixed(3)}, R²=${pitReg.rSquared.toFixed(3)}`);

  // Rotation-specific
  const rotReg = linearRegression(
    matched.map(m => m.ooptPitcherWar), matched.map(m => m.rotationWar));
  console.log(`    Rotation: slope=${rotReg.slope.toFixed(3)}, R²=${rotReg.rSquared.toFixed(3)}`);

  // ─── 1b. WAR Distribution Percentiles ───
  printSep('1b. WAR DISTRIBUTION PERCENTILES');

  const projPitWars = matched.map(m => m.projPitcherWar);
  const ooptPitWars = matched.map(m => m.ooptPitcherWar);

  console.log(`\n  Percentile    Projected     OOTP Actual`);
  console.log('  ' + '-'.repeat(45));
  for (const p of [10, 25, 50, 75, 90]) {
    console.log(`  p${String(p).padStart(2)}          ${percentile(projPitWars, p).toFixed(1).padStart(7)}       ${percentile(ooptPitWars, p).toFixed(1).padStart(7)}`);
  }
  console.log(`  (pitcher WAR only — team-level)`);

  // ─── 1c. Top 20 Pitcher Diagnostics ───
  printSep('1c. TOP 20 PITCHER PROJECTIONS (by WAR)');

  const topPitchers = [...allPitchers].sort((a, b) => b.war - a.war).slice(0, 20);
  console.log(`\n  Rank  Player    Team  SP?   IP    FIP    WAR`);
  console.log('  ' + '-'.repeat(55));
  topPitchers.forEach((p, i) => {
    console.log(`  ${String(i + 1).padStart(4)}  ${String(p.playerId).padStart(8)}  ${String(p.teamId).padStart(4)}  ${p.isSp ? 'SP' : 'RP'}   ${String(p.ip).padStart(4)}  ${p.fip.toFixed(2).padStart(5)}  ${p.war.toFixed(1).padStart(5)}`);
  });

  // ─── 2. Calibrate: Projected WAR → Wins ───
  printSep('2. CALIBRATION: Projected WAR → Wins');

  const calReg = linearRegression(projWars, matched.map(m => m.wins));
  console.log(`\n  Best fit: Wins = ${calReg.intercept.toFixed(1)} + ${calReg.slope.toFixed(3)} × Projected WAR`);
  console.log(`  R² = ${calReg.rSquared.toFixed(4)}, SE = ${calReg.stdResidual.toFixed(1)}`);
  console.log(`\n  Current app formula: Wins = ${CURRENT_BASELINE_WINS} + ${CURRENT_WAR_SLOPE} × WAR`);

  // ─── 3. Compare formulas ───
  printSep('3. FORMULA COMPARISON (with zero-sum normalization)');

  const byYear = new Map<number, MatchedTeam[]>();
  for (const m of matched) {
    if (!byYear.has(m.year)) byYear.set(m.year, []);
    byYear.get(m.year)!.push(m);
  }

  function applyFormula(_matched: MatchedTeam[], intercept: number, slope: number): Array<{ wins: number; projWins: number; diff: number; year: number }> {
    const results: Array<{ wins: number; projWins: number; diff: number; year: number }> = [];
    for (const [year, teams] of byYear) {
      const rawList = teams.map(m => ({
        ...m, rawWins: intercept + slope * m.projectedWar
      }));
      const numTeams = rawList.length;
      const expectedTotal = numTeams * (SEASON_GAMES / 2);
      const currentTotal = rawList.reduce((s, t) => s + t.rawWins, 0);
      const offset = (expectedTotal - currentTotal) / numTeams;
      for (const t of rawList) {
        const projWins = Math.round(t.rawWins + offset);
        results.push({ wins: t.wins, projWins, diff: projWins - t.wins, year });
      }
    }
    return results;
  }

  const currentResults = applyFormula(matched, CURRENT_BASELINE_WINS, CURRENT_WAR_SLOPE);
  const newResults = applyFormula(matched, calReg.intercept, calReg.slope);

  const currentMae = avg(currentResults.map(r => Math.abs(r.diff)));
  const newMae = avg(newResults.map(r => Math.abs(r.diff)));
  const currentRmse = Math.sqrt(avg(currentResults.map(r => r.diff ** 2)));
  const newRmse = Math.sqrt(avg(newResults.map(r => r.diff ** 2)));

  console.log(`\n  Formula                              MAE    RMSE   Bias`);
  console.log('  ' + '-'.repeat(60));
  console.log(`  Current (${CURRENT_BASELINE_WINS} + ${CURRENT_WAR_SLOPE} × WAR)    ${currentMae.toFixed(1).padStart(5)}  ${currentRmse.toFixed(1).padStart(6)}  ${(avg(currentResults.map(r => r.diff)) > 0 ? '+' : '') + avg(currentResults.map(r => r.diff)).toFixed(1)}`);
  console.log(`  New (${calReg.intercept.toFixed(1)} + ${calReg.slope.toFixed(3)} × WAR)   ${newMae.toFixed(1).padStart(5)}  ${newRmse.toFixed(1).padStart(6)}  ${(avg(newResults.map(r => r.diff)) > 0 ? '+' : '') + avg(newResults.map(r => r.diff)).toFixed(1)}`);

  if (newMae < currentMae - 0.1) {
    console.log(`\n  → NEW FORMULA IS BETTER by ${(currentMae - newMae).toFixed(1)} MAE`);
    console.log(`  → Recommend updating TeamRatingsView.ts:`);
    console.log(`       STANDINGS_BASELINE_WINS = ${calReg.intercept.toFixed(1)}`);
    console.log(`       STANDINGS_WAR_SLOPE = ${calReg.slope.toFixed(3)}`);
  } else {
    console.log(`\n  → Difference is minimal (${Math.abs(currentMae - newMae).toFixed(2)} MAE)`);
  }

  // ─── 4. Year-by-year breakdown ───
  printSep('4. YEAR-BY-YEAR ACCURACY (using new calibration)');

  console.log(`\n  Year  Teams   MAE    RMSE   Bias    AvgProjWAR  AvgOoptWAR`);
  console.log('  ' + '-'.repeat(65));

  const yearKeys = [...byYear.keys()].sort();
  for (const year of yearKeys) {
    const yrResults = newResults.filter(r => r.year === year);
    const yrMatched = byYear.get(year)!;
    const diffs = yrResults.map(r => r.diff);
    const mae = avg(diffs.map(d => Math.abs(d)));
    const rmse = Math.sqrt(avg(diffs.map(d => d ** 2)));
    const bias = avg(diffs);
    const avgProjWar = avg(yrMatched.map(m => m.projectedWar));
    const avgOoptWar = avg(yrMatched.map(m => m.ooptTotalWar));

    console.log(`  ${year}  ${String(yrResults.length).padStart(5)}  ${mae.toFixed(1).padStart(5)}  ${rmse.toFixed(1).padStart(6)}  ${(bias > 0 ? '+' : '') + bias.toFixed(1).padStart(5)}    ${avgProjWar.toFixed(1).padStart(8)}    ${avgOoptWar.toFixed(1).padStart(8)}`);
  }
  console.log('  ' + '-'.repeat(65));
  console.log(`  ALL   ${String(newResults.length).padStart(5)}  ${newMae.toFixed(1).padStart(5)}  ${newRmse.toFixed(1).padStart(6)}  ${(avg(newResults.map(r => r.diff)) > 0 ? '+' : '') + avg(newResults.map(r => r.diff)).toFixed(1).padStart(5)}`);

  // ─── 5. Quartile bias ───
  printSep('5. QUARTILE BIAS (best vs worst teams)');

  const quartileData = { top: [] as number[], upper: [] as number[], lower: [] as number[], bottom: [] as number[] };
  for (const [, teams] of byYear) {
    const yrRes = newResults.filter(r => r.year === teams[0].year);
    const sorted = [...yrRes].sort((a, b) => b.wins - a.wins);
    const n = sorted.length;
    const q1 = Math.ceil(n * 0.25);
    const q2 = Math.ceil(n * 0.50);
    const q3 = Math.ceil(n * 0.75);
    sorted.forEach((t, i) => {
      if (i < q1) quartileData.top.push(t.diff);
      else if (i < q2) quartileData.upper.push(t.diff);
      else if (i < q3) quartileData.lower.push(t.diff);
      else quartileData.bottom.push(t.diff);
    });
  }

  console.log(`\n  Quartile     N     MAE    Bias     Direction`);
  console.log('  ' + '-'.repeat(55));
  for (const [label, key] of [['Top 25%', 'top'], ['Upper mid', 'upper'], ['Lower mid', 'lower'], ['Bottom 25%', 'bottom']] as const) {
    const data = quartileData[key];
    const mae = avg(data.map(d => Math.abs(d)));
    const bias = avg(data);
    const dir = bias > 1 ? 'OVER-projecting' : bias < -1 ? 'UNDER-projecting' : 'balanced';
    console.log(`  ${label.padEnd(12)} ${String(data.length).padStart(4)}   ${mae.toFixed(1).padStart(5)}  ${(bias > 0 ? '+' : '') + bias.toFixed(1).padStart(5)}     ${dir}`);
  }

  const topBias = avg(quartileData.top);
  const botBias = avg(quartileData.bottom);
  console.log(`\n  Compression gap: ${(botBias - topBias).toFixed(1)} wins (top25 bias vs bottom25 bias)`);

  // ─── 6. Actual-stats comparison ───
  printSep('6. COMPARISON: Projection-Based vs Actual-Stats Calibration');
  console.log(`\n  The diagnose_compression.ts tool uses actual stats to compute WAR.`);
  console.log(`  This tool uses the projection pipeline (which adds compression).`);
  console.log(`\n  Projection-based calibration:`);
  console.log(`    Wins = ${calReg.intercept.toFixed(1)} + ${calReg.slope.toFixed(3)} × Projected WAR`);
  console.log(`    MAE = ${newMae.toFixed(1)}, RMSE = ${newRmse.toFixed(1)}`);
  console.log(`\n  Current formula (calibrated on actual stats):`);
  console.log(`    Wins = ${CURRENT_BASELINE_WINS} + ${CURRENT_WAR_SLOPE} × WAR`);
  console.log(`    MAE (when applied to projected WAR) = ${currentMae.toFixed(1)}, RMSE = ${currentRmse.toFixed(1)}`);

  if (calReg.slope > CURRENT_WAR_SLOPE + 0.05) {
    console.log(`\n  → Steeper slope (${calReg.slope.toFixed(3)} vs ${CURRENT_WAR_SLOPE}) confirms projection compression.`);
    console.log(`    The pipeline compresses WAR, so a steeper slope is needed to`);
    console.log(`    spread projected wins back out to match actual win range.`);
  }

  // ─── 7. IP Decomposition: Is IP the source of pitcher WAR compression? ───
  printSep('7. IP DECOMPOSITION: Where does pitcher WAR compression come from?');
  console.log(`\n  Testing: projected FIP × actual IP vs projected FIP × projected IP`);
  console.log(`  If "hybrid" (proj FIP × actual IP) is much less compressed,`);
  console.log(`  then IP projection is the bottleneck.\n`);

  // Group pitchers by year+team for lookup
  const pitchersByYearTeam = new Map<string, PitcherProjection[]>();
  for (const p of allPitchers) {
    if (p.year === undefined) continue;
    const key = `${p.year}_${p.teamId}`;
    if (!pitchersByYearTeam.has(key)) pitchersByYearTeam.set(key, []);
    pitchersByYearTeam.get(key)!.push(p);
  }

  // For each matched team-year, compute three versions of pitcher WAR:
  // A) Standard: projected FIP × projected IP (what we do now)
  // B) Hybrid: projected FIP × actual IP (isolates FIP quality)
  // C) Team-IP-Budget: projected FIP, redistribute fixed team IP budget
  interface IpDecompRow {
    year: number;
    teamId: number;
    ooptPitcherWar: number;
    projPitcherWar: number;       // A: proj FIP × proj IP
    hybridPitcherWar: number;     // B: proj FIP × actual IP
    budgetPitcherWar: number;     // C: proj FIP × budget-allocated IP
  }

  const ipDecompRows: IpDecompRow[] = [];

  for (const m of matched) {
    const teamPitchers = pitchersByYearTeam.get(`${m.year}_${m.teamId}`) || [];
    if (teamPitchers.length === 0) continue;

    // A) Standard (already have this)
    const projPitcherWar = m.projPitcherWar;

    // B) Hybrid: use projected FIP but actual IP
    let hybridWar = 0;
    let matchedPitcherCount = 0;
    for (const p of teamPitchers) {
      const actualIp = p.actualIp;
      if (actualIp !== undefined && actualIp > 0) {
        const fip = p.fip;
        let war = ((REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (actualIp / 9);
        // Apply same WAR multiplier as pipeline
        if (war > 0) {
          if (fip < 3.20) war *= TUNING.superEliteWarMultiplier;
          else if (fip < 3.50) {
            const t = (fip - 3.20) / (3.50 - 3.20);
            war *= TUNING.superEliteWarMultiplier + t * (TUNING.eliteWarMultiplier - TUNING.superEliteWarMultiplier);
          } else if (fip < 4.20) {
            const t = (fip - 3.50) / (4.20 - 3.50);
            war *= TUNING.eliteWarMultiplier + t * (1.0 - TUNING.eliteWarMultiplier);
          }
        }
        hybridWar += war;
        matchedPitcherCount++;
      }
    }

    // C) Team-IP-Budget: allocate ~1458 IP proportionally to projected IP shares
    const TEAM_IP_BUDGET = 9 * 162 + 10; // 1468 = regulation + ~10 extra innings
    const totalProjIp = teamPitchers.reduce((s, p) => s + p.ip, 0);
    let budgetWar = 0;
    if (totalProjIp > 0) {
      for (const p of teamPitchers) {
        const ipShare = p.ip / totalProjIp;
        const budgetIp = ipShare * TEAM_IP_BUDGET;
        const fip = p.fip;
        let war = ((REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (budgetIp / 9);
        if (war > 0) {
          if (fip < 3.20) war *= TUNING.superEliteWarMultiplier;
          else if (fip < 3.50) {
            const t = (fip - 3.20) / (3.50 - 3.20);
            war *= TUNING.superEliteWarMultiplier + t * (TUNING.eliteWarMultiplier - TUNING.superEliteWarMultiplier);
          } else if (fip < 4.20) {
            const t = (fip - 3.50) / (4.20 - 3.50);
            war *= TUNING.eliteWarMultiplier + t * (1.0 - TUNING.eliteWarMultiplier);
          }
        }
        budgetWar += war;
      }
    }

    ipDecompRows.push({
      year: m.year, teamId: m.teamId,
      ooptPitcherWar: m.ooptPitcherWar,
      projPitcherWar, hybridPitcherWar: hybridWar, budgetPitcherWar: budgetWar,
    });
  }

  if (ipDecompRows.length > 0) {
    const ooptPitWars = ipDecompRows.map(r => r.ooptPitcherWar);

    // A) Standard
    const regA = linearRegression(ooptPitWars, ipDecompRows.map(r => r.projPitcherWar));
    // B) Hybrid (proj FIP × actual IP)
    const regB = linearRegression(ooptPitWars, ipDecompRows.map(r => r.hybridPitcherWar));
    // C) Budget
    const regC = linearRegression(ooptPitWars, ipDecompRows.map(r => r.budgetPitcherWar));

    console.log(`  Method                           Slope   R²      MAE`);
    console.log('  ' + '-'.repeat(60));

    const maeA = avg(ipDecompRows.map(r => Math.abs(r.projPitcherWar - r.ooptPitcherWar)));
    const maeB = avg(ipDecompRows.map(r => Math.abs(r.hybridPitcherWar - r.ooptPitcherWar)));
    const maeC = avg(ipDecompRows.map(r => Math.abs(r.budgetPitcherWar - r.ooptPitcherWar)));

    console.log(`  A) Proj FIP × Proj IP (current)  ${regA.slope.toFixed(3).padStart(6)}  ${regA.rSquared.toFixed(3).padStart(5)}  ${maeA.toFixed(1).padStart(5)}`);
    console.log(`  B) Proj FIP × Actual IP (hybrid) ${regB.slope.toFixed(3).padStart(6)}  ${regB.rSquared.toFixed(3).padStart(5)}  ${maeB.toFixed(1).padStart(5)}`);
    console.log(`  C) Proj FIP × Budget IP (1468)   ${regC.slope.toFixed(3).padStart(6)}  ${regC.rSquared.toFixed(3).padStart(5)}  ${maeC.toFixed(1).padStart(5)}`);

    const compressionA = ((1 - regA.slope) * 100);
    const compressionB = ((1 - regB.slope) * 100);
    const compressionC = ((1 - regC.slope) * 100);

    console.log(`\n  Compression: A=${compressionA.toFixed(0)}%  B=${compressionB.toFixed(0)}%  C=${compressionC.toFixed(0)}%`);

    if (regB.slope > regA.slope + 0.05) {
      const improvement = ((regB.slope - regA.slope) / (1.0 - regA.slope) * 100);
      console.log(`\n  → Hybrid (actual IP) recovers ${improvement.toFixed(0)}% of the compression gap.`);
      console.log(`    IP projection IS a significant source of compression.`);
    } else {
      console.log(`\n  → Hybrid (actual IP) barely helps — FIP regression is the main compressor.`);
    }

    // Individual IP accuracy (using allPitchers which already has actualIp)
    const ipErrors: number[] = [];
    const ipPctErrors: number[] = [];
    for (const p of allPitchers) {
      if (p.actualIp !== undefined && p.actualIp >= 30) {
        ipErrors.push(p.ip - p.actualIp);
        ipPctErrors.push((p.ip - p.actualIp) / p.actualIp * 100);
      }
    }

    if (ipErrors.length > 0) {
      const ipMae = avg(ipErrors.map(e => Math.abs(e)));
      const ipBias = avg(ipErrors);
      const ipPctMae = avg(ipPctErrors.map(e => Math.abs(e)));
      const ipPctBias = avg(ipPctErrors);

      console.log(`\n  Individual IP Projection Accuracy (pitchers ≥30 actual IP):`);
      console.log(`    N = ${ipErrors.length}`);
      console.log(`    IP MAE:  ${ipMae.toFixed(1)} innings`);
      console.log(`    IP Bias: ${(ipBias > 0 ? '+' : '')}${ipBias.toFixed(1)} innings (positive = over-projecting)`);
      console.log(`    IP% MAE: ${ipPctMae.toFixed(1)}%`);
      console.log(`    IP% Bias: ${(ipPctBias > 0 ? '+' : '')}${ipPctBias.toFixed(1)}%`);

      // IP accuracy by actual IP tier
      const tiers = [
        { label: '200+ IP (aces)', min: 200, max: 999 },
        { label: '150-199 (starters)', min: 150, max: 199 },
        { label: '100-149 (mixed)', min: 100, max: 149 },
        { label: '50-99 (bullpen/spot)', min: 50, max: 99 },
        { label: '30-49 (low usage)', min: 30, max: 49 },
      ];

      console.log(`\n  IP Projection by Actual IP Tier:`);
      console.log(`    Tier                  N    Proj IP  Actual IP  Bias    MAE`);
      console.log('    ' + '-'.repeat(62));

      for (const tier of tiers) {
        const tierPitchers = allPitchers.filter(p =>
          p.actualIp !== undefined && p.actualIp >= tier.min && p.actualIp <= tier.max
        );
        if (tierPitchers.length > 0) {
          const avgProj = avg(tierPitchers.map(p => p.ip));
          const avgActual = avg(tierPitchers.map(p => p.actualIp!));
          const tierBias = avg(tierPitchers.map(p => p.ip - p.actualIp!));
          const tierMae = avg(tierPitchers.map(p => Math.abs(p.ip - p.actualIp!)));
          console.log(`    ${tier.label.padEnd(22)} ${String(tierPitchers.length).padStart(3)}   ${avgProj.toFixed(0).padStart(6)}   ${avgActual.toFixed(0).padStart(8)}  ${(tierBias > 0 ? '+' : '') + tierBias.toFixed(0).padStart(5)}  ${tierMae.toFixed(0).padStart(5)}`);
        }
      }
    }
  }

  // ─── 8. Team-Level Spread Adjustment ───
  // Individual projections are good (FIP MAE 0.58), but regression compresses
  // the team-level spread. Instead of changing individual projections, stretch
  // the team-level WAR distribution back out before converting to wins.
  //
  // adjustedWAR = leagueAvgWAR + (teamWAR - leagueAvgWAR) × spreadFactor
  //
  // This is conceptually "de-regressing" at the team level: team composition
  // is signal (roster construction), not noise, so it shouldn't be regressed away.

  printSep('8. TEAM-LEVEL SPREAD ADJUSTMENT');
  console.log(`\n  Sweeping pitcher & batter spread factors to find optimal de-compression.`);
  console.log(`  Individual FIP projections stay untouched — only team-level aggregation changes.\n`);

  // Group matched teams by year for zero-sum normalization
  const spreadByYear = new Map<number, MatchedTeam[]>();
  for (const m of matched) {
    if (!spreadByYear.has(m.year)) spreadByYear.set(m.year, []);
    spreadByYear.get(m.year)!.push(m);
  }

  interface SpreadResult {
    pitcherSpread: number;
    batterSpread: number;
    mae: number;
    rmse: number;
    topQuartileBias: number;
    bottomQuartileBias: number;
    compressionGap: number;
    bestIntercept: number;
    bestSlope: number;
    pitcherSlope: number;
    pitcherR2: number;
  }

  const spreadResults: SpreadResult[] = [];

  // Sweep pitcher spread from 1.0 to 3.0, batter spread from 1.0 to 2.5
  for (let ps = 1.0; ps <= 3.0; ps += 0.1) {
    for (let bs = 1.0; bs <= 2.5; bs += 0.1) {
      // Apply spread factors per-year (so the mean is computed within each year)
      const adjustedMatched: Array<{ m: MatchedTeam; adjustedWar: number; adjustedPitWar: number; adjustedBatWar: number }> = [];

      for (const [, yearTeams] of spreadByYear) {
        const avgPitWar = avg(yearTeams.map(t => t.projPitcherWar));
        const avgBatWar = avg(yearTeams.map(t => t.projBatterWar));

        for (const m of yearTeams) {
          const adjPit = avgPitWar + (m.projPitcherWar - avgPitWar) * ps;
          const adjBat = avgBatWar + (m.projBatterWar - avgBatWar) * bs;
          adjustedMatched.push({
            m, adjustedWar: adjPit + adjBat, adjustedPitWar: adjPit, adjustedBatWar: adjBat,
          });
        }
      }

      // Fit WAR→Wins on adjusted WAR
      const adjWars = adjustedMatched.map(a => a.adjustedWar);
      const adjWins = adjustedMatched.map(a => a.m.wins);
      const adjReg = linearRegression(adjWars, adjWins);

      // Compute pitcher-level compression with spread applied
      const adjPitReg = linearRegression(
        adjustedMatched.map(a => a.m.ooptPitcherWar),
        adjustedMatched.map(a => a.adjustedPitWar)
      );

      // Apply with zero-sum normalization per year
      const diffs: number[] = [];
      const topDiffs: number[] = [];
      const bottomDiffs: number[] = [];

      for (const [, yearTeams] of spreadByYear) {
        const yearAdj = adjustedMatched.filter(a => a.m.year === yearTeams[0].year);
        const rawList = yearAdj.map(a => ({
          wins: a.m.wins, rawWins: adjReg.intercept + adjReg.slope * a.adjustedWar,
        }));
        const numTeams = rawList.length;
        const expectedTotal = numTeams * (SEASON_GAMES / 2);
        const currentTotal = rawList.reduce((s, t) => s + t.rawWins, 0);
        const offset = (expectedTotal - currentTotal) / numTeams;

        const results = rawList.map(t => ({
          wins: t.wins, projWins: Math.round(t.rawWins + offset),
          diff: Math.round(t.rawWins + offset) - t.wins,
        }));

        const sorted = [...results].sort((a, b) => b.wins - a.wins);
        const n = sorted.length;
        const q1 = Math.ceil(n * 0.25);
        const q3 = Math.ceil(n * 0.75);

        sorted.forEach((t, i) => {
          diffs.push(t.diff);
          if (i < q1) topDiffs.push(t.diff);
          if (i >= q3) bottomDiffs.push(t.diff);
        });
      }

      const mae = avg(diffs.map(d => Math.abs(d)));
      const rmse = Math.sqrt(avg(diffs.map(d => d ** 2)));
      const topBias = avg(topDiffs);
      const bottomBias = avg(bottomDiffs);

      spreadResults.push({
        pitcherSpread: ps, batterSpread: bs,
        mae, rmse,
        topQuartileBias: topBias, bottomQuartileBias: bottomBias,
        compressionGap: bottomBias - topBias,
        bestIntercept: adjReg.intercept, bestSlope: adjReg.slope,
        pitcherSlope: adjPitReg.slope, pitcherR2: adjPitReg.rSquared,
      });
    }
  }

  // Sort by composite score: MAE + compression gap penalty
  spreadResults.sort((a, b) => {
    // Primary: minimize MAE. Secondary: minimize compression gap.
    const scoreA = a.mae + Math.abs(a.compressionGap) * 0.1;
    const scoreB = b.mae + Math.abs(b.compressionGap) * 0.1;
    return scoreA - scoreB;
  });

  console.log(`  Top 15 configurations (sorted by MAE + compression penalty):\n`);
  console.log(`  Rank  PitSF  BatSF   MAE   RMSE  TopQ   BotQ   Gap    Pit.Slope  WAR→Wins`);
  console.log('  ' + '-'.repeat(80));

  for (let i = 0; i < Math.min(15, spreadResults.length); i++) {
    const r = spreadResults[i];
    console.log(
      `  ${String(i + 1).padStart(4)}  ${r.pitcherSpread.toFixed(1).padStart(5)}  ${r.batterSpread.toFixed(1).padStart(5)}` +
      `  ${r.mae.toFixed(1).padStart(5)}  ${r.rmse.toFixed(1).padStart(5)}` +
      `  ${(r.topQuartileBias > 0 ? '+' : '') + r.topQuartileBias.toFixed(1).padStart(5)}` +
      `  ${(r.bottomQuartileBias > 0 ? '+' : '') + r.bottomQuartileBias.toFixed(1).padStart(5)}` +
      `  ${r.compressionGap.toFixed(1).padStart(5)}` +
      `  ${r.pitcherSlope.toFixed(3).padStart(9)}` +
      `  ${r.bestIntercept.toFixed(1)}+${r.bestSlope.toFixed(3)}×WAR`
    );
  }

  // Also show the baseline (no spread) for comparison
  const baseline = spreadResults.find(r => Math.abs(r.pitcherSpread - 1.0) < 0.01 && Math.abs(r.batterSpread - 1.0) < 0.01);
  if (baseline) {
    console.log(`\n  Baseline (no spread adjustment):`);
    console.log(`    MAE=${baseline.mae.toFixed(1)}  TopQ=${baseline.topQuartileBias.toFixed(1)}  BotQ=${baseline.bottomQuartileBias.toFixed(1)}  Gap=${baseline.compressionGap.toFixed(1)}`);
  }

  const winner = spreadResults[0];
  console.log(`\n  Winner:`);
  console.log(`    Pitcher spread: ${winner.pitcherSpread.toFixed(1)}x`);
  console.log(`    Batter spread:  ${winner.batterSpread.toFixed(1)}x`);
  console.log(`    WAR→Wins: ${winner.bestIntercept.toFixed(1)} + ${winner.bestSlope.toFixed(3)} × adjustedWAR`);
  console.log(`    MAE: ${winner.mae.toFixed(1)} (was ${baseline?.mae.toFixed(1) ?? '?'})`);
  console.log(`    Compression gap: ${winner.compressionGap.toFixed(1)} wins (was ${baseline?.compressionGap.toFixed(1) ?? '?'})`);
  console.log(`    Pitcher WAR slope: ${winner.pitcherSlope.toFixed(3)} (was ${baseline?.pitcherSlope.toFixed(3) ?? '?'})`);

  if (baseline && winner.mae < baseline.mae - 0.1) {
    console.log(`\n  → SPREAD ADJUSTMENT HELPS: ${(baseline.mae - winner.mae).toFixed(1)} MAE improvement`);
    console.log(`    Compression gap reduced from ${baseline.compressionGap.toFixed(1)} to ${winner.compressionGap.toFixed(1)} wins`);
  } else {
    console.log(`\n  → Spread adjustment provides minimal MAE improvement.`);
  }

  // ─── 9. Non-Linear De-Compression ───
  // The linear spread factor is mathematically equivalent to adjusting the
  // WAR→Wins slope. Non-linear approaches can capture the ASYMMETRIC compression
  // (top teams compressed more than bottom teams).
  //
  // Strategies tested:
  //   A) Power curve: deviation^power (amplifies extremes more than middle)
  //   B) Asymmetric piecewise: separate upper/lower spread factors
  //   C) Quadratic WAR→Wins: Wins = a + b×WAR + c×WAR² (direct non-linear fit)

  printSep('9. NON-LINEAR DE-COMPRESSION');
  console.log(`\n  Testing non-linear strategies that can capture asymmetric compression.`);
  console.log(`  (Top teams under-projected more than bottom teams over-projected)\n`);

  // Helper: evaluate a WAR→Wins mapping with zero-sum normalization
  function evaluateMapping(
    adjustedWars: Array<{ m: MatchedTeam; adjWar: number }>,
    winsFormula: (adjWar: number) => number
  ): { mae: number; rmse: number; topBias: number; botBias: number; gap: number } {
    const diffs: number[] = [];
    const topDiffs: number[] = [];
    const botDiffs: number[] = [];

    for (const [, yearTeams] of spreadByYear) {
      const yearAdj = adjustedWars.filter(a => a.m.year === yearTeams[0].year);
      if (yearAdj.length === 0) continue;
      const rawList = yearAdj.map(a => ({ wins: a.m.wins, rawWins: winsFormula(a.adjWar) }));
      const numTeams = rawList.length;
      const expectedTotal = numTeams * (SEASON_GAMES / 2);
      const currentTotal = rawList.reduce((s, t) => s + t.rawWins, 0);
      const offset = (expectedTotal - currentTotal) / numTeams;
      const results = rawList.map(t => ({
        wins: t.wins, diff: Math.round(t.rawWins + offset) - t.wins,
      }));
      const sorted = [...results].sort((a, b) => b.wins - a.wins);
      const n = sorted.length;
      const q1 = Math.ceil(n * 0.25);
      const q3 = Math.ceil(n * 0.75);
      sorted.forEach((t, i) => {
        diffs.push(t.diff);
        if (i < q1) topDiffs.push(t.diff);
        if (i >= q3) botDiffs.push(t.diff);
      });
    }
    const mae = avg(diffs.map(d => Math.abs(d)));
    const rmse = Math.sqrt(avg(diffs.map(d => d ** 2)));
    return { mae, rmse, topBias: avg(topDiffs), botBias: avg(botDiffs), gap: avg(botDiffs) - avg(topDiffs) };
  }

  // ─── Strategy A: Power Curve ───
  // adjustedDeviation = sign(d) × |d|^power
  // Applied separately to pitcher & batter WAR deviations from yearly mean
  console.log(`  Strategy A: Power Curve (deviation^power)`);
  console.log(`  ' + '-'.repeat(65));`);

  interface NonLinearResult {
    label: string;
    params: string;
    mae: number;
    rmse: number;
    topBias: number;
    botBias: number;
    gap: number;
  }
  const nlResults: NonLinearResult[] = [];

  for (let power = 1.0; power <= 2.0; power += 0.1) {
    const adjusted: Array<{ m: MatchedTeam; adjWar: number }> = [];
    for (const [, yearTeams] of spreadByYear) {
      const avgPit = avg(yearTeams.map(t => t.projPitcherWar));
      const avgBat = avg(yearTeams.map(t => t.projBatterWar));
      // Compute std for normalization (so power doesn't change scale too much)
      const stdPit = Math.sqrt(avg(yearTeams.map(t => (t.projPitcherWar - avgPit) ** 2))) || 1;
      const stdBat = Math.sqrt(avg(yearTeams.map(t => (t.projBatterWar - avgBat) ** 2))) || 1;

      for (const m of yearTeams) {
        // Normalize, apply power, then rescale
        const pitDev = (m.projPitcherWar - avgPit) / stdPit;
        const batDev = (m.projBatterWar - avgBat) / stdBat;
        const adjPitDev = Math.sign(pitDev) * Math.pow(Math.abs(pitDev), power);
        const adjBatDev = Math.sign(batDev) * Math.pow(Math.abs(batDev), power);
        const adjPit = avgPit + adjPitDev * stdPit;
        const adjBat = avgBat + adjBatDev * stdBat;
        adjusted.push({ m, adjWar: adjPit + adjBat });
      }
    }
    // Fit linear WAR→Wins on adjusted values
    const adjReg = linearRegression(adjusted.map(a => a.adjWar), adjusted.map(a => a.m.wins));
    const result = evaluateMapping(adjusted, w => adjReg.intercept + adjReg.slope * w);
    nlResults.push({ label: 'Power', params: `p=${power.toFixed(1)}`, ...result });
  }

  // ─── Strategy B: Asymmetric Spread ───
  // Different spread factors for above-avg vs below-avg teams
  console.log(`  Strategy B: Asymmetric Spread (separate upper/lower factors)`);

  for (let upper = 1.0; upper <= 3.0; upper += 0.2) {
    for (let lower = 0.5; lower <= 2.0; lower += 0.2) {
      const adjusted: Array<{ m: MatchedTeam; adjWar: number }> = [];
      for (const [, yearTeams] of spreadByYear) {
        const avgPit = avg(yearTeams.map(t => t.projPitcherWar));
        const avgBat = avg(yearTeams.map(t => t.projBatterWar));
        for (const m of yearTeams) {
          const pitDev = m.projPitcherWar - avgPit;
          const batDev = m.projBatterWar - avgBat;
          const adjPit = avgPit + pitDev * (pitDev > 0 ? upper : lower);
          const adjBat = avgBat + batDev * (batDev > 0 ? upper : lower);
          adjusted.push({ m, adjWar: adjPit + adjBat });
        }
      }
      const adjReg = linearRegression(adjusted.map(a => a.adjWar), adjusted.map(a => a.m.wins));
      const result = evaluateMapping(adjusted, w => adjReg.intercept + adjReg.slope * w);
      nlResults.push({ label: 'Asym', params: `u=${upper.toFixed(1)},l=${lower.toFixed(1)}`, ...result });
    }
  }

  // ─── Strategy C: Quadratic WAR→Wins (no spread, direct non-linear fit) ───
  // Wins = a + b×WAR + c×(WAR - avgWAR)²
  // The quadratic term captures the asymmetry directly
  console.log(`  Strategy C: Quadratic WAR→Wins\n`);

  // Build raw (unadjusted) WAR for each matched team
  const rawAdjusted = matched.map(m => ({ m, adjWar: m.projectedWar }));

  // Fit quadratic: minimize sum of (wins_i - a - b*WAR_i - c*(WAR_i - mean)²)²
  // Use grid search over c, with a and b optimized via linear regression on residuals
  const globalAvgWar = avg(matched.map(m => m.projectedWar));

  for (let c = -0.10; c <= 0.10; c += 0.005) {
    // Compute WAR + c*(WAR-avg)² as a combined feature, then fit linearly
    const adjustedFeature = matched.map(m => m.projectedWar + c * (m.projectedWar - globalAvgWar) ** 2);
    const quadReg = linearRegression(adjustedFeature, matched.map(m => m.wins));
    const result = evaluateMapping(
      matched.map((m, i) => ({ m, adjWar: adjustedFeature[i] })),
      w => quadReg.intercept + quadReg.slope * w
    );
    nlResults.push({ label: 'Quad', params: `c=${c.toFixed(3)}`, ...result });
  }

  // ─── Strategy D: Piecewise WAR→Wins slope (kink at median) ───
  // Two-pass sweep: coarse grid, then fine-grained around the best
  console.log(`  Strategy D: Piecewise WAR→Wins (different slopes above/below median)\n`);

  // Helper to evaluate a piecewise config
  function evalPiecewise(upperSlope: number, lowerSlope: number): NonLinearResult {
    const diffs: number[] = [];
    const topDiffs: number[] = [];
    const botDiffs: number[] = [];

    for (const [, yearTeams] of spreadByYear) {
      const medianWar = percentile(yearTeams.map(t => t.projectedWar), 50);
      const rawList = yearTeams.map(m => {
        const dev = m.projectedWar - medianWar;
        const slope = dev > 0 ? upperSlope : lowerSlope;
        return { wins: m.wins, rawWins: 81 + dev * slope };
      });
      const numTeams = rawList.length;
      const expectedTotal = numTeams * (SEASON_GAMES / 2);
      const currentTotal = rawList.reduce((s, t) => s + t.rawWins, 0);
      const offset = (expectedTotal - currentTotal) / numTeams;
      const results = rawList.map(t => ({
        wins: t.wins, diff: Math.round(t.rawWins + offset) - t.wins,
      }));
      const sorted = [...results].sort((a, b) => b.wins - a.wins);
      const n = sorted.length;
      const q1 = Math.ceil(n * 0.25);
      const q3 = Math.ceil(n * 0.75);
      sorted.forEach((t, i) => {
        diffs.push(t.diff);
        if (i < q1) topDiffs.push(t.diff);
        if (i >= q3) botDiffs.push(t.diff);
      });
    }
    const mae = avg(diffs.map(d => Math.abs(d)));
    const rmse = Math.sqrt(avg(diffs.map(d => d ** 2)));
    return {
      label: 'Pwise',
      params: `u=${upperSlope.toFixed(3)},l=${lowerSlope.toFixed(3)}`,
      mae, rmse,
      topBias: avg(topDiffs), botBias: avg(botDiffs),
      gap: avg(botDiffs) - avg(topDiffs),
    };
  }

  // Pass 1: Coarse sweep (step 0.05)
  console.log(`  Pass 1: Coarse sweep (step 0.05)...`);
  const coarseResults: NonLinearResult[] = [];
  for (let u = 0.5; u <= 1.5; u += 0.05) {
    for (let l = 0.3; l <= 1.2; l += 0.05) {
      coarseResults.push(evalPiecewise(u, l));
    }
  }
  coarseResults.sort((a, b) => a.mae - b.mae);
  const coarseWinner = coarseResults[0];
  const cwU = parseFloat(coarseWinner.params.split(',')[0].split('=')[1]);
  const cwL = parseFloat(coarseWinner.params.split(',')[1].split('=')[1]);
  console.log(`  Coarse winner: u=${cwU.toFixed(2)}, l=${cwL.toFixed(2)}, MAE=${coarseWinner.mae.toFixed(2)}`);

  // Pass 2: Fine sweep around coarse winner (step 0.01)
  console.log(`  Pass 2: Fine sweep around winner (step 0.01)...`);
  const fineResults: NonLinearResult[] = [];
  for (let u = cwU - 0.10; u <= cwU + 0.10; u += 0.01) {
    for (let l = cwL - 0.10; l <= cwL + 0.10; l += 0.01) {
      if (u <= 0 || l <= 0) continue;
      fineResults.push(evalPiecewise(u, l));
    }
  }
  fineResults.sort((a, b) => a.mae - b.mae);
  nlResults.push(...fineResults);

  console.log(`\n  ── PIECEWISE FINE SWEEP: Top 20 ──\n`);
  console.log(`  Rank  Upper  Lower   MAE    RMSE   TopQ    BotQ    Gap`);
  console.log('  ' + '-'.repeat(65));
  for (let i = 0; i < Math.min(20, fineResults.length); i++) {
    const r = fineResults[i];
    const u = parseFloat(r.params.split(',')[0].split('=')[1]);
    const l = parseFloat(r.params.split(',')[1].split('=')[1]);
    console.log(
      `  ${String(i + 1).padStart(4)}  ${u.toFixed(3).padStart(5)}  ${l.toFixed(3).padStart(5)}` +
      `  ${r.mae.toFixed(2).padStart(6)}  ${r.rmse.toFixed(2).padStart(6)}` +
      `  ${(r.topBias > 0 ? '+' : '') + r.topBias.toFixed(1).padStart(6)}` +
      `  ${(r.botBias > 0 ? '+' : '') + r.botBias.toFixed(1).padStart(6)}` +
      `  ${r.gap.toFixed(1).padStart(5)}`
    );
  }

  // Also add the other strategies for the combined ranking
  nlResults.push(...coarseResults);

  // Sort all results
  nlResults.sort((a, b) => {
    const scoreA = a.mae + Math.abs(a.gap) * 0.05;
    const scoreB = b.mae + Math.abs(b.gap) * 0.05;
    return scoreA - scoreB;
  });

  // Print top results by strategy
  console.log(`\n  ── ALL STRATEGIES: Top 5 each ──\n`);
  console.log(`  Strategy  Params              MAE   RMSE  TopQ   BotQ   Gap`);
  console.log('  ' + '-'.repeat(70));

  const strategies = ['Power', 'Asym', 'Quad', 'Pwise'];
  for (const strat of strategies) {
    const stratResults = nlResults.filter(r => r.label === strat);
    stratResults.sort((a, b) => a.mae - b.mae);
    for (let i = 0; i < Math.min(5, stratResults.length); i++) {
      const r = stratResults[i];
      console.log(
        `  ${r.label.padEnd(8)}  ${r.params.padEnd(18)}` +
        `  ${r.mae.toFixed(1).padStart(5)}  ${r.rmse.toFixed(1).padStart(5)}` +
        `  ${(r.topBias > 0 ? '+' : '') + r.topBias.toFixed(1).padStart(5)}` +
        `  ${(r.botBias > 0 ? '+' : '') + r.botBias.toFixed(1).padStart(5)}` +
        `  ${r.gap.toFixed(1).padStart(5)}`
      );
    }
    console.log('');
  }

  // Overall winner
  const nlWinner = nlResults[0];
  console.log(`  ── OVERALL WINNER ──`);
  console.log(`  ${nlWinner.label} (${nlWinner.params})`);
  console.log(`    MAE: ${nlWinner.mae.toFixed(1)} (baseline: ${baseline?.mae.toFixed(1) ?? '?'})`);
  console.log(`    Compression gap: ${nlWinner.gap.toFixed(1)} (baseline: ${baseline?.compressionGap.toFixed(1) ?? '?'})`);
  console.log(`    Top quartile bias: ${nlWinner.topBias.toFixed(1)} (baseline: ${baseline?.topQuartileBias.toFixed(1) ?? '?'})`);
  console.log(`    Bottom quartile bias: ${nlWinner.botBias.toFixed(1)} (baseline: ${baseline?.bottomQuartileBias.toFixed(1) ?? '?'})`);

  if (baseline && nlWinner.mae < baseline.mae - 0.2) {
    console.log(`\n  → NON-LINEAR APPROACH WINS: ${(baseline.mae - nlWinner.mae).toFixed(1)} MAE improvement`);
  } else if (baseline && Math.abs(nlWinner.gap) < Math.abs(baseline.compressionGap) - 2) {
    console.log(`\n  → Modest MAE gain but compression gap reduced by ${(Math.abs(baseline.compressionGap) - Math.abs(nlWinner.gap)).toFixed(1)} wins`);
  } else {
    console.log(`\n  → Non-linear approach provides limited improvement over linear baseline.`);
  }
}

function printSep(title: string): void {
  console.log('\n' + '='.repeat(72));
  console.log(`  ${title}`);
  console.log('='.repeat(72));
}

// ============================================================================
// Actual-Stats Team WAR for matching
// ============================================================================

function computeActualStatsTeamWar(year: number): Array<{ teamId: number; war: number; batterWar: number; pitcherWar: number }> {
  const teamWar = new Map<number, { batter: number; pitcher: number }>();
  const ensure = (id: number) => { if (!teamWar.has(id)) teamWar.set(id, { batter: 0, pitcher: 0 }); return teamWar.get(id)!; };

  const pitchingPath = path.join(MLB_PITCHING_DIR, `${year}.csv`);
  if (fs.existsSync(pitchingPath)) {
    const { headers, rows } = parseCSV(fs.readFileSync(pitchingPath, 'utf-8'));
    const idx = { team_id: headers.indexOf('team_id'), split_id: headers.indexOf('split_id'), level_id: headers.indexOf('level_id'), ip: headers.indexOf('ip'), k: headers.indexOf('k'), bb: headers.indexOf('bb'), hra: headers.indexOf('hra') };
    for (const row of rows) {
      if (parseInt(row[idx.split_id]) !== 1 || parseInt(row[idx.level_id]) !== 1) continue;
      const teamId = parseInt(row[idx.team_id]);
      const ip = parseIp(row[idx.ip]);
      if (ip <= 0 || isNaN(teamId)) continue;
      const k9 = (parseInt(row[idx.k]) || 0) / ip * 9;
      const bb9 = (parseInt(row[idx.bb]) || 0) / ip * 9;
      const hr9 = (parseInt(row[idx.hra]) || 0) / ip * 9;
      const fip = calculateFip(k9, bb9, hr9);
      const war = ((REPLACEMENT_FIP - fip) / PITCHER_RUNS_PER_WIN) * (ip / 9);
      ensure(teamId).pitcher += war;
    }
  }

  const battingPath = path.join(MLB_BATTING_DIR, `${year}_batting.csv`);
  if (fs.existsSync(battingPath)) {
    const { headers, rows } = parseCSV(fs.readFileSync(battingPath, 'utf-8'));
    const idx = { team_id: headers.indexOf('team_id'), split_id: headers.indexOf('split_id'), level_id: headers.indexOf('level_id'), pa: headers.indexOf('pa'), ab: headers.indexOf('ab'), h: headers.indexOf('h'), d: headers.indexOf('d'), t: headers.indexOf('t'), hr: headers.indexOf('hr'), bb: headers.indexOf('bb'), sb: headers.indexOf('sb'), cs: headers.indexOf('cs') };
    for (const row of rows) {
      if (parseInt(row[idx.split_id]) !== 1 || parseInt(row[idx.level_id]) !== 1) continue;
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
      const singles = h - d - t - hr;
      const woba = WOBA_WEIGHTS.bb * (bb / pa) + WOBA_WEIGHTS.single * (singles / pa) +
        WOBA_WEIGHTS.double * (d / pa) + WOBA_WEIGHTS.triple * (t / pa) + WOBA_WEIGHTS.hr * (hr / pa);
      const wRAA = ((woba - BATTER_LG_WOBA) / BATTER_WOBA_SCALE) * pa;
      const repRuns = (pa / 600) * BATTER_REPLACEMENT_RUNS_PER_600PA;
      const sbRuns = sb * 0.2 - cs * 0.4;
      const war = (wRAA + repRuns + sbRuns) / BATTER_RUNS_PER_WIN;
      ensure(teamId).batter += war;
    }
  }

  return [...teamWar.entries()].map(([teamId, w]) => ({
    teamId, war: w.batter + w.pitcher, batterWar: w.batter, pitcherWar: w.pitcher,
  }));
}

// ============================================================================
// Data loading helper (shared between baseline and sweep)
// ============================================================================

interface PreloadedData {
  dobMap: Map<number, number>;
  standingsByYear: Map<number, StandingsRow[]>;
  actualStatsByYear: Map<number, Array<{ teamId: number; war: number }>>;
  validYears: number[];
}

function preloadData(): PreloadedData {
  const dobMap = loadDob();
  const standingsByYear = new Map<number, StandingsRow[]>();
  const actualStatsByYear = new Map<number, Array<{ teamId: number; war: number }>>();
  const validYears: number[] = [];

  const START_YEAR = 2005;
  const END_YEAR = 2020;

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const standings = loadStandings(year);
    if (standings.length === 0) continue;

    const priorYearFile = path.join(MLB_PITCHING_DIR, `${year - 1}.csv`);
    if (!fs.existsSync(priorYearFile)) continue;

    standingsByYear.set(year, standings);
    const actualStats = computeActualStatsTeamWar(year);
    actualStatsByYear.set(year, actualStats);
    validYears.push(year);
  }

  return { dobMap, standingsByYear, actualStatsByYear, validYears };
}

function runAllProjections(data: PreloadedData): { projectedByYear: Map<number, Map<number, ProjectedTeam>>; allPitchers: PitcherProjection[] } {
  const projectedByYear = new Map<number, Map<number, ProjectedTeam>>();
  const allPitchers: PitcherProjection[] = [];

  for (const year of data.validYears) {
    const result = runProjectionPipeline(year, data.dobMap);
    projectedByYear.set(year, result.teams);
    allPitchers.push(...result.pitchers);
  }

  return { projectedByYear, allPitchers };
}

// ============================================================================
// Parameter Sweep
// ============================================================================

interface SweepResult {
  config: TuningConfig;
  metrics: SweepMetrics;
  /** Composite score: pitcher slope × 0.4 + pitcher R² × 0.3 + (8.0 - MAE)/8.0 × 0.3 */
  score: number;
}

function calculateScore(m: SweepMetrics): number {
  // Prioritize: pitcher signal recovery (slope + R²), while guarding MAE and bottom quartile
  const slopeScore = Math.min(1.0, m.pitcherSlope / 1.0); // 1.0 = perfect
  const r2Score = Math.min(1.0, m.pitcherR2 / 0.5);       // 0.5 R² would be excellent
  const maeScore = Math.max(0, (8.5 - m.mae) / 3.0);       // 5.5 MAE = 1.0, 8.5 = 0.0
  const bottomPenalty = m.bottomQuartileBias > 3.0 ? -0.2 : m.bottomQuartileBias > 2.0 ? -0.1 : 0;
  return slopeScore * 0.35 + r2Score * 0.30 + maeScore * 0.35 + bottomPenalty;
}

function runSweep(data: PreloadedData): void {
  console.log('\n' + '='.repeat(72));
  console.log('  PARAMETER SWEEP');
  console.log('='.repeat(72));

  // ─── Round 1: Solo parameter sweeps ───
  console.log('\n--- Round 1: Solo Parameter Sweeps ---\n');

  const paramSets: { name: string; key: keyof TuningConfig; values: number[] }[] = [
    { name: 'SP K/9 Regression Ratio', key: 'spK9RegressionRatio', values: [0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60] },
    { name: 'Elite Strength Multiplier', key: 'eliteStrengthMultiplier', values: [0.80, 0.90, 1.00, 1.10, 1.20, 1.30] },
    { name: 'Neutral Aging Dampening', key: 'neutralAgingDampening', values: [0.20, 0.30, 0.35, 0.40, 0.50] },
    { name: 'Established IP Model Weight', key: 'establishedIpModelWeight', values: [0.35, 0.40, 0.45, 0.50, 0.55] },
  ];

  const soloWinners: Map<string, { value: number; metrics: SweepMetrics; score: number }> = new Map();

  for (const param of paramSets) {
    console.log(`  ${param.name}:`);
    console.log(`    Value   PitSlope  PitR²   BatSlope  MAE    Score   BotBias`);
    console.log('    ' + '-'.repeat(65));

    let bestScore = -Infinity;
    let bestValue = param.values[0];
    let bestMetrics: SweepMetrics | null = null;

    for (const val of param.values) {
      // Reset to baseline, then set this parameter
      TUNING = { ...BASELINE_TUNING };
      (TUNING as any)[param.key] = val;

      const { projectedByYear } = runAllProjections(data);
      const matched = matchTeams(projectedByYear, data.standingsByYear, data.actualStatsByYear);
      const metrics = computeMetrics(matched);
      const score = calculateScore(metrics);

      const isBest = score > bestScore;
      if (isBest) { bestScore = score; bestValue = val; bestMetrics = metrics; }

      console.log(`    ${String(val).padStart(5)}   ${metrics.pitcherSlope.toFixed(3).padStart(7)}  ${metrics.pitcherR2.toFixed(3).padStart(5)}   ${metrics.batterSlope.toFixed(3).padStart(7)}  ${metrics.mae.toFixed(1).padStart(5)}  ${score.toFixed(3).padStart(6)}   ${metrics.bottomQuartileBias.toFixed(1).padStart(6)}${isBest ? ' ←' : ''}`);
    }

    soloWinners.set(param.key, { value: bestValue, metrics: bestMetrics!, score: bestScore });
    console.log(`    → Best: ${bestValue} (score=${bestScore.toFixed(3)})\n`);
  }

  // ─── Round 2: Combine top parameters ───
  console.log('\n--- Round 2: Combined Parameter Search ---\n');

  // Take best 2 values per parameter (± one step from solo winner)
  const combineParams: { key: keyof TuningConfig; values: number[] }[] = [];
  for (const param of paramSets) {
    const winner = soloWinners.get(param.key)!;
    const idx = param.values.indexOf(winner.value);
    const candidates = new Set<number>();
    candidates.add(winner.value);
    if (idx > 0) candidates.add(param.values[idx - 1]);
    if (idx < param.values.length - 1) candidates.add(param.values[idx + 1]);
    combineParams.push({ key: param.key, values: [...candidates] });
  }

  const totalCombos = combineParams.reduce((p, c) => p * c.values.length, 1);
  console.log(`  Testing ${totalCombos} combinations...\n`);

  const allResults: SweepResult[] = [];

  // Generate all combinations
  function* combinations(params: typeof combineParams, current: Partial<TuningConfig> = {}): Generator<TuningConfig> {
    if (params.length === 0) {
      yield { ...BASELINE_TUNING, ...current } as TuningConfig;
      return;
    }
    const [first, ...rest] = params;
    for (const val of first.values) {
      yield* combinations(rest, { ...current, [first.key]: val });
    }
  }

  let comboCount = 0;
  for (const config of combinations(combineParams)) {
    TUNING = config;
    const { projectedByYear } = runAllProjections(data);
    const matched = matchTeams(projectedByYear, data.standingsByYear, data.actualStatsByYear);
    const metrics = computeMetrics(matched);
    const score = calculateScore(metrics);
    allResults.push({ config, metrics, score });
    comboCount++;
    if (comboCount % 10 === 0) process.stdout.write(`  ${comboCount}/${totalCombos}...\r`);
  }

  // Sort by score
  allResults.sort((a, b) => b.score - a.score);

  console.log(`\n  Top 10 combinations:\n`);
  console.log(`  Rank  K9Reg  StrMul  AgeDmp  IpWgt   PitSlp  PitR²   MAE    Score`);
  console.log('  ' + '-'.repeat(72));

  for (let i = 0; i < Math.min(10, allResults.length); i++) {
    const r = allResults[i];
    const c = r.config;
    console.log(`  ${String(i + 1).padStart(4)}  ${c.spK9RegressionRatio.toFixed(2).padStart(5)}  ${c.eliteStrengthMultiplier.toFixed(2).padStart(5)}  ${c.neutralAgingDampening.toFixed(2).padStart(5)}  ${c.establishedIpModelWeight.toFixed(2).padStart(5)}   ${r.metrics.pitcherSlope.toFixed(3).padStart(6)}  ${r.metrics.pitcherR2.toFixed(3).padStart(5)}  ${r.metrics.mae.toFixed(1).padStart(5)}  ${r.score.toFixed(3).padStart(6)}`);
  }

  // ─── Round 3: WAR multiplier on top of best combo (if pitcher slope still < 0.65) ───
  const best = allResults[0];
  if (best.metrics.pitcherSlope < 0.65) {
    console.log(`\n--- Round 3: WAR Multiplier Test (pitcher slope ${best.metrics.pitcherSlope.toFixed(3)} < 0.65) ---\n`);

    const warMultValues = [
      { elite: 1.05, superElite: 1.08 },
      { elite: 1.10, superElite: 1.15 },
      { elite: 1.15, superElite: 1.20 },
      { elite: 1.10, superElite: 1.20 },
    ];

    console.log(`  Elite  SuperE  PitSlp  PitR²   MAE    Score   BotBias`);
    console.log('  ' + '-'.repeat(60));

    let bestR3Score = best.score;
    let bestR3Config = best.config;

    for (const wm of warMultValues) {
      TUNING = { ...best.config, eliteWarMultiplier: wm.elite, superEliteWarMultiplier: wm.superElite };
      const { projectedByYear } = runAllProjections(data);
      const matched = matchTeams(projectedByYear, data.standingsByYear, data.actualStatsByYear);
      const metrics = computeMetrics(matched);
      const score = calculateScore(metrics);

      const isBest = score > bestR3Score;
      if (isBest) { bestR3Score = score; bestR3Config = { ...TUNING }; }

      console.log(`  ${wm.elite.toFixed(2).padStart(5)}  ${wm.superElite.toFixed(2).padStart(5)}   ${metrics.pitcherSlope.toFixed(3).padStart(6)}  ${metrics.pitcherR2.toFixed(3).padStart(5)}  ${metrics.mae.toFixed(1).padStart(5)}  ${score.toFixed(3).padStart(6)}   ${metrics.bottomQuartileBias.toFixed(1).padStart(6)}${isBest ? ' ←' : ''}`);
    }

    if (bestR3Score > best.score) {
      console.log(`\n  → Round 3 improved score: ${best.score.toFixed(3)} → ${bestR3Score.toFixed(3)}`);
      allResults[0] = { config: bestR3Config, metrics: best.metrics, score: bestR3Score };
    } else {
      console.log(`\n  → Round 3 did not improve; WAR multiplier not needed.`);
    }
  } else {
    console.log(`\n  Pitcher slope ${best.metrics.pitcherSlope.toFixed(3)} >= 0.65, skipping WAR multiplier test.`);
  }

  // ─── Final: Run full report with winner ───
  const winner = allResults[0];
  TUNING = winner.config;

  console.log('\n' + '='.repeat(72));
  console.log('  WINNING CONFIGURATION');
  console.log('='.repeat(72));
  console.log(`  spK9RegressionRatio:     ${TUNING.spK9RegressionRatio}`);
  console.log(`  eliteStrengthMultiplier: ${TUNING.eliteStrengthMultiplier}`);
  console.log(`  neutralAgingDampening:   ${TUNING.neutralAgingDampening}`);
  console.log(`  establishedIpModelWeight: ${TUNING.establishedIpModelWeight}`);
  console.log(`  eliteWarMultiplier:      ${TUNING.eliteWarMultiplier}`);
  console.log(`  superEliteWarMultiplier: ${TUNING.superEliteWarMultiplier}`);
  console.log(`\n  Score: ${winner.score.toFixed(3)}`);
  console.log(`  Pitcher slope: ${winner.metrics.pitcherSlope.toFixed(3)} (was ${soloWinners.get('spK9RegressionRatio') ? computeMetrics(matchTeams(runAllProjections({ ...data }).projectedByYear, data.standingsByYear, data.actualStatsByYear)).pitcherSlope.toFixed(3) : 'N/A'} at baseline)`);

  // Run full report with winning config
  console.log('\n\n--- Full Report with Winning Config ---');
  const { projectedByYear: winnerProjected, allPitchers: winnerPitchers } = runAllProjections(data);
  matchAndCalibrate(winnerProjected, data.standingsByYear, data.actualStatsByYear, winnerPitchers, data);
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  const isSweep = process.argv.includes('--sweep');

  console.log('Projection-Based Calibration Tool');
  console.log(`Mode: ${isSweep ? 'PARAMETER SWEEP' : 'BASELINE'}`);
  console.log('Replaying projection pipeline for historical years...\n');

  const data = preloadData();
  console.log(`Loaded ${data.dobMap.size} DOB entries, ${data.validYears.length} valid years (${data.validYears[0]}-${data.validYears[data.validYears.length - 1]})`);

  if (isSweep) {
    // First show baseline
    console.log('\n--- Baseline Run ---');
    TUNING = { ...BASELINE_TUNING };
    const { projectedByYear: baseProjected, allPitchers: basePitchers } = runAllProjections(data);
    const baseMatched = matchTeams(baseProjected, data.standingsByYear, data.actualStatsByYear);
    const baseMetrics = computeMetrics(baseMatched);
    console.log(`  Baseline: pitcher slope=${baseMetrics.pitcherSlope.toFixed(3)}, R²=${baseMetrics.pitcherR2.toFixed(3)}, MAE=${baseMetrics.mae.toFixed(1)}`);

    runSweep(data);
  } else {
    // Standard baseline run
    TUNING = { ...BASELINE_TUNING };

    for (const year of data.validYears) {
      process.stdout.write(`  Projecting ${year}...`);
      const result = runProjectionPipeline(year, data.dobMap);
      const teams = [...result.teams.values()];
      const avgWar = teams.reduce((s, t) => s + t.totalWar, 0) / teams.length;
      console.log(` ${teams.length} teams, avg WAR=${avgWar.toFixed(1)}`);
    }

    const { projectedByYear, allPitchers } = runAllProjections(data);
    console.log(`\nProjected ${projectedByYear.size} years`);
    matchAndCalibrate(projectedByYear, data.standingsByYear, data.actualStatsByYear, allPitchers, data);
  }
}

main();
