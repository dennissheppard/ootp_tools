#!/usr/bin/env npx tsx
/**
 * Player Rating Trace Tool
 *
 * Traces how True Ratings (TR) and True Future Ratings (TFR) are calculated
 * for a specific player, showing every step of the calculation pipeline.
 *
 * Reads data from local CSV files in public/data directory.
 *
 * For prospects (players with no MLB stats), TFR mode is automatically enabled.
 *
 * USAGE:
 *   npx tsx tools/trace-rating.ts <player_id> [options]
 *
 * OPTIONS:
 *   --type=<pitcher|batter>  Player type (auto-detected if not specified)
 *   --year=<YYYY>            Base year for stats (default: 2021)
 *   --stage=<stage>          Season stage for year weighting (default: complete)
 *                            Values: early, q1_done, q2_done, q3_done, complete
 *   --tfr                    Calculate TFR instead of TR (auto-enabled for prospects)
 *   --full                   Full TFR mode: rank against ALL prospects, map to MLB distributions
 *
 * SCOUTING DATA (optional, for TR blend or TFR calculation):
 *   Pitcher: --stuff=<20-80> --control=<20-80> --hra=<20-80>
 *            --stamina=<20-80> --injury=<Iron Man|Durable|Normal|Fragile|Wrecked>
 *   Batter:  --power=<20-80> --eye=<20-80> --avoidk=<20-80> --contact=<20-80>
 *            --gap=<20-80> --speed=<20-80>
 *
 * EXAMPLES:
 *   npx tsx tools/trace-rating.ts 12797                    # Auto-detect type, TR
 *   npx tsx tools/trace-rating.ts 12797 --type=batter      # Batter TR
 *   npx tsx tools/trace-rating.ts 12797 --stage=q2_done    # Mid-season weighting
 *   npx tsx tools/trace-rating.ts 15354                    # Prospect auto-uses TFR
 *   npx tsx tools/trace-rating.ts 12797 --power=55 --gap=60 --speed=70
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ============================================================================
// Constants (mirrored from services)
// ============================================================================

/** Season stage for dynamic year weighting */
type SeasonStage = 'early' | 'q1_done' | 'q2_done' | 'q3_done' | 'complete';

/**
 * Get dynamic year weights based on the current stage of the season.
 * During the season, current year stats are gradually weighted in,
 * stealing weight from older years as the season progresses.
 *
 * Returns weights for [current year, N-1, N-2, N-3].
 * Weights always sum to 10.
 */
function getYearWeights(stage: SeasonStage): number[] {
  switch (stage) {
    case 'early':    return [0, 5, 3, 2];           // Q1 in progress - no current season yet
    case 'q1_done':  return [1.0, 5.0, 2.5, 1.5];   // May 15 - Jun 30
    case 'q2_done':  return [2.5, 4.5, 2.0, 1.0];   // Jul 1 - Aug 14
    case 'q3_done':  return [4.0, 4.0, 1.5, 0.5];   // Aug 15 - Sep 30
    case 'complete': return [5, 3, 2, 0];           // Oct 1+ - standard 3-year weights
    default:         return [0, 5, 3, 2];           // Fallback to no current season
  }
}

const DEFAULT_YEAR_WEIGHTS = [5, 3, 2];

// Pitcher constants
const PITCHER_STABILIZATION = { bb9: 40, k9: 50, hr9: 70 };
const PITCHER_LEAGUE_AVERAGES = {
  SP: { k9: 5.60, bb9: 2.80, hr9: 0.90 },
  SW: { k9: 6.60, bb9: 2.60, hr9: 0.75 },
  RP: { k9: 6.40, bb9: 2.80, hr9: 0.90 },
};
const PITCHER_REGRESSION_RATIOS = {
  SP: { k9: 0.60, bb9: 0.80, hr9: 0.18 },
  SW: { k9: 1.20, bb9: 0.80, hr9: 0.18 },
  RP: { k9: 1.20, bb9: 0.40, hr9: 0.18 },
};
const SCOUTING_BLEND_IP = 60;

// Rating formulas (pitcher)
const PITCHER_FORMULAS = {
  k9: { intercept: 2.10, slope: 0.074 },
  bb9: { intercept: 5.30, slope: -0.052 },
  hr9: { intercept: 2.18, slope: -0.024 },
};

// Batter constants
const BATTER_STABILIZATION = { bbPct: 120, kPct: 60, hrPct: 160, iso: 160, avg: 300 };
const BATTER_LEAGUE_AVERAGES = { bbPct: 8.5, kPct: 22.0, iso: 0.140, avg: 0.260 };

/**
 * Component-specific PA thresholds for scouting blend.
 * At threshold PA, blend is 50/50. At 2x, blend is 67/33. At 3x, blend is 75/25.
 *
 * - K%: Lower (120 PA) - stats are predictive, K% stabilizes quickly
 * - BB%: Medium (200 PA) - scouts can see plate discipline
 * - HR%: Higher (350 PA) - power is volatile, scouts see bat speed/exit velo
 * - AVG: Higher (350 PA) - scouts can evaluate contact skills
 *
 * Note: ISO is not blended - we use HR% directly for power estimation.
 */
const SCOUTING_BLEND_THRESHOLDS = {
  kPct: 120,
  bbPct: 200,
  hrPct: 350,
  avg: 350,
};

// Rating formulas (batter)
const BATTER_FORMULAS = {
  eye: { intercept: 1.6246, slope: 0.114789 },
  avoidK: { intercept: 25.10, slope: -0.200303 },
  power: { low: { intercept: -1.034, slope: 0.0637 }, high: { intercept: -2.75, slope: 0.098 } },
  contact: { intercept: 0.035156, slope: 0.003873 },
  // Gap (20-80) → Doubles per AB
  gap: { intercept: -0.012627, slope: 0.001086 },
  // Speed (20-200) → Triples per AB (use convertSpeed2080To20200 first)
  speed: { intercept: -0.001657, slope: 0.000083 },
};

/**
 * Convert speed from 20-80 scale (scouting) to 20-200 scale (calibration data).
 */
function convertSpeed2080To20200(speed80: number): number {
  const clamped = Math.max(20, Math.min(80, speed80));
  return 20 + ((clamped - 20) / 60) * 180;
}

/**
 * Calculate expected doubles rate (per AB) from gap rating (20-80 scale).
 */
function expectedDoublesRate(gap: number): number {
  const coef = BATTER_FORMULAS.gap;
  return Math.max(0, coef.intercept + coef.slope * gap);
}

/**
 * Calculate expected triples rate (per AB) from speed rating (20-80 scale).
 */
function expectedTriplesRate(speed: number): number {
  const speed200 = convertSpeed2080To20200(speed);
  const coef = BATTER_FORMULAS.speed;
  return Math.max(0, coef.intercept + coef.slope * speed200);
}

// wOBA weights
const WOBA_WEIGHTS = { bb: 0.69, single: 0.89, double: 1.27, triple: 1.62, hr: 2.10 };

// FIP constant
const FIP_CONSTANT = 3.47;

// Percentile to rating mapping
const PERCENTILE_TO_RATING = [
  { threshold: 97.7, rating: 5.0 },
  { threshold: 93.3, rating: 4.5 },
  { threshold: 84.1, rating: 4.0 },
  { threshold: 69.1, rating: 3.5 },
  { threshold: 50.0, rating: 3.0 },
  { threshold: 30.9, rating: 2.5 },
  { threshold: 15.9, rating: 2.0 },
  { threshold: 6.7, rating: 1.5 },
  { threshold: 2.3, rating: 1.0 },
  { threshold: 0.0, rating: 0.5 },
];

// TFR percentile thresholds
const TFR_PERCENTILE_TO_RATING = [
  { threshold: 99.0, rating: 5.0 },
  { threshold: 97.0, rating: 4.5 },
  { threshold: 93.0, rating: 4.0 },
  { threshold: 75.0, rating: 3.5 },
  { threshold: 60.0, rating: 3.0 },
  { threshold: 35.0, rating: 2.5 },
  { threshold: 20.0, rating: 2.0 },
  { threshold: 10.0, rating: 1.5 },
  { threshold: 5.0, rating: 1.0 },
  { threshold: 0.0, rating: 0.5 },
];

// Minor league level adjustments (pitcher)
const PITCHER_LEVEL_ADJUSTMENTS = {
  aaa: { k9: 0.10, bb9: 0.00, hr9: 0.20 },
  aa: { k9: 0.02, bb9: 0.18, hr9: 0.22 },
  a: { k9: -0.08, bb9: 0.22, hr9: 0.27 },
  r: { k9: -0.12, bb9: 0.36, hr9: 0.30 },
};

// Minor league level adjustments (batter)
const BATTER_LEVEL_ADJUSTMENTS = {
  aaa: { bbPct: 0, kPct: 2.0, hrPct: -0.3, avg: -0.020 },
  aa: { bbPct: -0.5, kPct: 3.5, hrPct: -0.6, avg: -0.035 },
  a: { bbPct: -1.0, kPct: 5.0, hrPct: -1.0, avg: -0.050 },
  r: { bbPct: -1.5, kPct: 7.0, hrPct: -1.5, avg: -0.065 },
};

// Level IP/PA weights for TFR
const LEVEL_WEIGHTS = { aaa: 1.0, aa: 0.7, a: 0.4, r: 0.2 };

// ============================================================================
// Interfaces
// ============================================================================

interface PitchingStats {
  year: number;
  ip: number;
  k: number;
  bb: number;
  hra: number;
  gs: number;
}

interface BattingStats {
  year: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
}

interface MinorLeaguePitchingStats extends PitchingStats {
  level: string;
}

interface MinorLeagueBattingStats extends BattingStats {
  level: string;
}

interface PitcherScouting {
  stuff: number;
  control: number;
  hra: number;
  stamina?: number;
  injury?: string;
  pitches?: Record<string, number>;
}

interface BatterScouting {
  power: number;
  eye: number;
  avoidK: number;
  contact: number;
  gap: number;
  speed: number;
  injury?: string;
  sr?: number;   // Stealing aggressiveness (20-80)
  ste?: number;  // Stealing ability (20-80)
}

// ============================================================================
// CSV Parsing Functions (Local Files)
// ============================================================================

function parseCSV(csvText: string): { headers: string[]; rows: string[][] } {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => line.split(','));
  return { headers, rows };
}

function parseIp(ipStr: string): number {
  const parts = ipStr.split('.');
  const innings = parseInt(parts[0]) || 0;
  const thirds = parseInt(parts[1]) || 0;
  return innings + thirds / 3;
}

function loadMLBPitchingStats(playerId: number, year: number): PitchingStats | null {
  const filePath = path.join(DATA_DIR, 'mlb', `${year}.csv`);
  if (!fs.existsSync(filePath)) return null;

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const { headers, rows } = parseCSV(csvText);

  const indices = {
    player_id: headers.indexOf('player_id'),
    split_id: headers.indexOf('split_id'),
    ip: headers.indexOf('ip'),
    k: headers.indexOf('k'),
    bb: headers.indexOf('bb'),
    hra: headers.indexOf('hra'),
    gs: headers.indexOf('gs'),
  };

  for (const row of rows) {
    if (parseInt(row[indices.player_id]) === playerId && parseInt(row[indices.split_id]) === 1) {
      const ip = parseIp(row[indices.ip] || '0');
      if (ip > 0) {
        return {
          year,
          ip,
          k: parseInt(row[indices.k]) || 0,
          bb: parseInt(row[indices.bb]) || 0,
          hra: parseInt(row[indices.hra]) || 0,
          gs: parseInt(row[indices.gs]) || 0,
        };
      }
    }
  }
  return null;
}

function loadMLBBattingStats(playerId: number, year: number): BattingStats | null {
  const filePath = path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`);
  if (!fs.existsSync(filePath)) return null;

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const { headers, rows } = parseCSV(csvText);

  const indices = {
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
  };

  for (const row of rows) {
    if (parseInt(row[indices.player_id]) === playerId && parseInt(row[indices.split_id]) === 1) {
      const pa = parseInt(row[indices.pa]) || 0;
      if (pa > 0) {
        return {
          year,
          pa,
          ab: parseInt(row[indices.ab]) || 0,
          h: parseInt(row[indices.h]) || 0,
          d: parseInt(row[indices.d]) || 0,
          t: parseInt(row[indices.t]) || 0,
          hr: parseInt(row[indices.hr]) || 0,
          bb: parseInt(row[indices.bb]) || 0,
          k: parseInt(row[indices.k]) || 0,
        };
      }
    }
  }
  return null;
}

function loadMinorLeaguePitchingStats(playerId: number, year: number): MinorLeaguePitchingStats[] {
  const levels = ['aaa', 'aa', 'a', 'r'];
  const results: MinorLeaguePitchingStats[] = [];

  for (const level of levels) {
    const filePath = path.join(DATA_DIR, 'minors', `${year}_${level}.csv`);
    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(csvText);

    const indices = {
      player_id: headers.indexOf('player_id'),
      split_id: headers.indexOf('split_id'),
      ip: headers.indexOf('ip'),
      k: headers.indexOf('k'),
      bb: headers.indexOf('bb'),
      hra: headers.indexOf('hra'),
      gs: headers.indexOf('gs'),
    };

    for (const row of rows) {
      if (parseInt(row[indices.player_id]) === playerId && parseInt(row[indices.split_id]) === 1) {
        const ip = parseIp(row[indices.ip] || '0');
        if (ip > 0) {
          results.push({
            year,
            level,
            ip,
            k: parseInt(row[indices.k]) || 0,
            bb: parseInt(row[indices.bb]) || 0,
            hra: parseInt(row[indices.hra]) || 0,
            gs: parseInt(row[indices.gs]) || 0,
          });
        }
      }
    }
  }

  return results;
}

function loadMinorLeagueBattingStats(playerId: number, year: number): MinorLeagueBattingStats[] {
  const levels = ['aaa', 'aa', 'a', 'r'];
  const results: MinorLeagueBattingStats[] = [];

  for (const level of levels) {
    const filePath = path.join(DATA_DIR, 'minors_batting', `${year}_${level}_batting.csv`);
    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(csvText);

    const indices = {
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
    };

    for (const row of rows) {
      if (parseInt(row[indices.player_id]) === playerId && parseInt(row[indices.split_id]) === 1) {
        const pa = parseInt(row[indices.pa]) || 0;
        if (pa > 0) {
          results.push({
            year,
            level,
            pa,
            ab: parseInt(row[indices.ab]) || 0,
            h: parseInt(row[indices.h]) || 0,
            d: parseInt(row[indices.d]) || 0,
            t: parseInt(row[indices.t]) || 0,
            hr: parseInt(row[indices.hr]) || 0,
            bb: parseInt(row[indices.bb]) || 0,
            k: parseInt(row[indices.k]) || 0,
          });
        }
      }
    }
  }

  return results;
}

/**
 * Load pitcher scouting data from default OSA scouting CSV
 */
/**
 * Find the most recent pitcher scouting file for a given source (my or osa)
 */
function findLatestPitcherScoutingFile(source: 'my' | 'osa'): string | null {
  const files = fs.readdirSync(DATA_DIR).filter(f =>
    f.startsWith('pitcher_scouting_') && f.includes(`_${source}_`) && f.endsWith('.csv')
  );

  if (files.length === 0) {
    // Fall back to default files
    if (source === 'osa') {
      const defaultOsa = path.join(DATA_DIR, 'default_osa_scouting.csv');
      if (fs.existsSync(defaultOsa)) return defaultOsa;
    }
    return null;
  }

  files.sort().reverse();
  return path.join(DATA_DIR, files[0]);
}

const PITCH_COLUMNS = ['FBP', 'CHP', 'CBP', 'SLP', 'SIP', 'SPP', 'CTP', 'FOP', 'CCP', 'SCP', 'KCP', 'KNP'];

function loadPitcherScouting(playerId: number, source: 'my' | 'osa' = 'osa'): PitcherScouting | null {
  const filePath = findLatestPitcherScoutingFile(source);
  if (!filePath || !fs.existsSync(filePath)) {
    if (source === 'my') {
      console.log(`  No "my" pitcher scouting file found, falling back to OSA`);
      return loadPitcherScouting(playerId, 'osa');
    }
    return null;
  }

  console.log(`  Loading pitcher scouting from: ${path.basename(filePath)}`);

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const { headers, rows } = parseCSV(csvText);

  const indices = {
    id: headers.indexOf('ID'),
    stuff: headers.indexOf('STU P'),
    control: headers.indexOf('CON P'),
    hra: headers.indexOf('HRR P'),
    stamina: headers.indexOf('STM'),
    injury: headers.indexOf('Prone'),
  };

  // Build pitch column indices
  const pitchIndices: { name: string; idx: number }[] = [];
  for (const col of PITCH_COLUMNS) {
    const idx = headers.indexOf(col);
    if (idx >= 0) pitchIndices.push({ name: col, idx });
  }

  for (const row of rows) {
    if (parseInt(row[indices.id]) === playerId) {
      const pitches: Record<string, number> = {};
      for (const p of pitchIndices) {
        const val = row[p.idx]?.trim();
        if (val && val !== '-' && val !== '') {
          pitches[p.name] = parseInt(val) || 0;
        }
      }

      return {
        stuff: parseInt(row[indices.stuff]) || 50,
        control: parseInt(row[indices.control]) || 50,
        hra: parseInt(row[indices.hra]) || 50,
        stamina: indices.stamina >= 0 ? (parseInt(row[indices.stamina]) || 50) : undefined,
        injury: indices.injury >= 0 ? (row[indices.injury]?.trim() || 'Normal') : undefined,
        pitches,
      };
    }
  }
  return null;
}

/**
 * Find the most recent hitter scouting file for a given source (my or osa)
 */
function findLatestHitterScoutingFile(source: 'my' | 'osa'): string | null {
  const files = fs.readdirSync(DATA_DIR).filter(f =>
    f.startsWith('hitter_scouting_') && f.includes(`_${source}_`) && f.endsWith('.csv')
  );

  if (files.length === 0) {
    // Fall back to default files
    if (source === 'osa') {
      const defaultOsa = path.join(DATA_DIR, 'default_hitter_osa_scouting.csv');
      if (fs.existsSync(defaultOsa)) return defaultOsa;
    }
    return null;
  }

  // Sort by date (files are named like hitter_scouting_my_2021_05_31.csv)
  files.sort().reverse();
  return path.join(DATA_DIR, files[0]);
}

/**
 * Load batter scouting data from hitter scouting CSV
 * @param playerId Player ID to look up
 * @param source Scouting source: 'my' for personal scouting, 'osa' for OSA scouting
 */
function loadBatterScouting(playerId: number, source: 'my' | 'osa' = 'osa'): BatterScouting | null {
  const filePath = findLatestHitterScoutingFile(source);
  if (!filePath || !fs.existsSync(filePath)) {
    // Fall back to default OSA if my scouting not found
    if (source === 'my') {
      console.log(`  No "my" scouting file found, falling back to OSA`);
      return loadBatterScouting(playerId, 'osa');
    }
    return null;
  }

  console.log(`  Loading scouting from: ${path.basename(filePath)}`);

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const { headers, rows } = parseCSV(csvText);

  const indices = {
    id: headers.indexOf('ID'),
    power: headers.indexOf('POW P'),
    eye: headers.indexOf('EYE P'),
    avoidK: headers.indexOf('K P'),
    contact: headers.indexOf('CON P'),
    gap: headers.indexOf('GAP P'),
    speed: headers.indexOf('SPE'),
    injury: headers.indexOf('Prone'),
    sr: headers.indexOf('SR'),
    ste: headers.indexOf('STE'),
  };

  for (const row of rows) {
    if (parseInt(row[indices.id]) === playerId) {
      return {
        power: parseInt(row[indices.power]) || 50,
        eye: parseInt(row[indices.eye]) || 50,
        avoidK: parseInt(row[indices.avoidK]) || 50,
        contact: parseInt(row[indices.contact]) || 50,
        gap: parseInt(row[indices.gap]) || 50,
        speed: parseInt(row[indices.speed]) || 50,
        injury: indices.injury >= 0 ? (row[indices.injury]?.trim() || 'Normal') : 'Normal',
        sr: indices.sr >= 0 ? parseInt(row[indices.sr]) || undefined : undefined,
        ste: indices.ste >= 0 ? parseInt(row[indices.ste]) || undefined : undefined,
      };
    }
  }
  return null;
}

// ============================================================================
// Utility Functions
// ============================================================================

function getRoleFromIp(totalIp: number): 'SP' | 'SW' | 'RP' {
  if (totalIp >= 130) return 'SP';
  if (totalIp >= 70) return 'SW';
  return 'RP';
}

function percentileToRating(percentile: number, isTfr: boolean = false): number {
  const thresholds = isTfr ? TFR_PERCENTILE_TO_RATING : PERCENTILE_TO_RATING;
  for (const { threshold, rating } of thresholds) {
    if (percentile >= threshold) return rating;
  }
  return 0.5;
}

function calculateFipLike(k9: number, bb9: number, hr9: number): number {
  return (13 * hr9 + 3 * bb9 - 2 * k9) / 9;
}

function calculateFip(k9: number, bb9: number, hr9: number): number {
  return calculateFipLike(k9, bb9, hr9) + FIP_CONSTANT;
}

// ============================================================================
// Pitcher TR Trace
// ============================================================================

function tracePitcherTR(
  playerId: number,
  baseYear: number,
  scouting?: PitcherScouting,
  yearWeights: number[] = DEFAULT_YEAR_WEIGHTS,
  stage?: SeasonStage
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`PITCHER TRUE RATING TRACE: Player ID ${playerId}`);
  console.log('='.repeat(80));

  if (stage) {
    console.log(`\n  Season Stage: ${stage}`);
  }

  // Fetch multi-year stats (up to 4 years for dynamic weighting)
  console.log('\n--- STEP 1: Loading Multi-Year Stats from Local Files ---\n');
  const yearlyStats: PitchingStats[] = [];
  const yearsToLoad = Math.max(3, yearWeights.length);
  for (let y = baseYear; y >= baseYear - (yearsToLoad - 1); y--) {
    const stats = loadMLBPitchingStats(playerId, y);
    if (stats && stats.ip > 0) {
      yearlyStats.push(stats);
      const k9 = (stats.k / stats.ip) * 9;
      const bb9 = (stats.bb / stats.ip) * 9;
      const hr9 = (stats.hra / stats.ip) * 9;
      console.log(`  ${stats.year}: ${stats.ip.toFixed(1)} IP, K/9=${k9.toFixed(2)}, BB/9=${bb9.toFixed(2)}, HR/9=${hr9.toFixed(2)}, GS=${stats.gs}`);
    }
  }

  if (yearlyStats.length === 0) {
    console.log('  No MLB pitching stats found.');
    return;
  }

  // Calculate weighted averages
  console.log('\n--- STEP 2: Multi-Year Weighted Average ---\n');
  console.log('  Year weights: [' + yearWeights.slice(0, yearlyStats.length).join(', ') + ']');

  let weightedK9Sum = 0, weightedBb9Sum = 0, weightedHr9Sum = 0;
  let totalWeight = 0, totalIp = 0;

  for (let i = 0; i < yearlyStats.length && i < yearWeights.length; i++) {
    const s = yearlyStats[i];
    const w = yearWeights[i];

    // Skip years with 0 weight (e.g., early season before current year counts)
    if (w === 0) {
      console.log(`  ${s.year}: weight=0 (SKIPPED - season stage)`);
      continue;
    }

    const k9 = (s.k / s.ip) * 9;
    const bb9 = (s.bb / s.ip) * 9;
    const hr9 = (s.hra / s.ip) * 9;
    const weight = w * s.ip;

    console.log(`  ${s.year}: weight=${w} × ${s.ip.toFixed(1)}IP = ${weight.toFixed(1)}`);
    console.log(`         K/9=${k9.toFixed(2)} × ${weight.toFixed(1)} = ${(k9 * weight).toFixed(2)}`);
    console.log(`         BB/9=${bb9.toFixed(2)} × ${weight.toFixed(1)} = ${(bb9 * weight).toFixed(2)}`);
    console.log(`         HR/9=${hr9.toFixed(2)} × ${weight.toFixed(1)} = ${(hr9 * weight).toFixed(2)}`);

    weightedK9Sum += k9 * weight;
    weightedBb9Sum += bb9 * weight;
    weightedHr9Sum += hr9 * weight;
    totalWeight += weight;
    totalIp += s.ip;
  }

  const weightedK9 = weightedK9Sum / totalWeight;
  const weightedBb9 = weightedBb9Sum / totalWeight;
  const weightedHr9 = weightedHr9Sum / totalWeight;

  console.log(`\n  Weighted Averages:`);
  console.log(`    K/9  = ${weightedK9Sum.toFixed(2)} / ${totalWeight.toFixed(1)} = ${weightedK9.toFixed(2)}`);
  console.log(`    BB/9 = ${weightedBb9Sum.toFixed(2)} / ${totalWeight.toFixed(1)} = ${weightedBb9.toFixed(2)}`);
  console.log(`    HR/9 = ${weightedHr9Sum.toFixed(2)} / ${totalWeight.toFixed(1)} = ${weightedHr9.toFixed(2)}`);
  console.log(`    Total IP: ${totalIp.toFixed(1)}`);

  // Determine role
  const role = getRoleFromIp(totalIp);
  console.log(`\n  Determined Role: ${role} (based on ${totalIp.toFixed(1)} IP)`);

  // Calculate regression
  console.log('\n--- STEP 3: Tier-Aware Regression ---\n');

  const fipLikeRaw = calculateFipLike(weightedK9, weightedBb9, weightedHr9);
  const estimatedFip = fipLikeRaw + FIP_CONSTANT;
  console.log(`  Estimated FIP: ${fipLikeRaw.toFixed(2)} + ${FIP_CONSTANT} = ${estimatedFip.toFixed(2)}`);

  const targetOffset = calculateTargetOffset(estimatedFip);
  const strengthMultiplier = calculateStrengthMultiplier(estimatedFip);
  console.log(`  Target Offset: ${targetOffset.toFixed(3)} (from FIP breakpoints)`);
  console.log(`  Strength Multiplier: ${strengthMultiplier.toFixed(2)}`);

  const leagueAvg = PITCHER_LEAGUE_AVERAGES[role];
  const regRatios = PITCHER_REGRESSION_RATIOS[role];
  console.log(`\n  League Averages (${role}): K/9=${leagueAvg.k9}, BB/9=${leagueAvg.bb9}, HR/9=${leagueAvg.hr9}`);
  console.log(`  Regression Ratios (${role}): K/9=${regRatios.k9}, BB/9=${regRatios.bb9}, HR/9=${regRatios.hr9}`);

  const ipConfidence = Math.min(1.0, totalIp / 100);
  const ipScale = 0.5 + (ipConfidence * 0.5);
  console.log(`\n  IP Confidence: min(1.0, ${totalIp.toFixed(1)}/100) = ${ipConfidence.toFixed(3)}`);
  console.log(`  IP Scale: 0.5 + (${ipConfidence.toFixed(3)} × 0.5) = ${ipScale.toFixed(3)}`);

  const regressStat = (
    weighted: number,
    leagueRate: number,
    stabilizationK: number,
    statName: string,
    ratio: number
  ): number => {
    const regressionTarget = statName === 'K/9'
      ? leagueRate - (targetOffset * ratio)
      : leagueRate + (targetOffset * ratio);
    const adjustedK = stabilizationK * strengthMultiplier * ipScale;
    const regressed = (weighted * totalIp + regressionTarget * adjustedK) / (totalIp + adjustedK);

    console.log(`\n  ${statName} Regression:`);
    console.log(`    Target = ${leagueRate.toFixed(2)} ${statName === 'K/9' ? '-' : '+'} (${targetOffset.toFixed(3)} × ${ratio}) = ${regressionTarget.toFixed(2)}`);
    console.log(`    Adjusted K = ${stabilizationK} × ${strengthMultiplier.toFixed(2)} × ${ipScale.toFixed(3)} = ${adjustedK.toFixed(2)}`);
    console.log(`    Regressed = (${weighted.toFixed(2)} × ${totalIp.toFixed(1)} + ${regressionTarget.toFixed(2)} × ${adjustedK.toFixed(2)}) / (${totalIp.toFixed(1)} + ${adjustedK.toFixed(2)})`);
    console.log(`             = ${regressed.toFixed(2)}`);

    return regressed;
  };

  let regressedK9 = regressStat(weightedK9, leagueAvg.k9, PITCHER_STABILIZATION.k9, 'K/9', regRatios.k9);
  let regressedBb9 = regressStat(weightedBb9, leagueAvg.bb9, PITCHER_STABILIZATION.bb9, 'BB/9', regRatios.bb9);
  let regressedHr9 = regressStat(weightedHr9, leagueAvg.hr9, PITCHER_STABILIZATION.hr9, 'HR/9', regRatios.hr9);

  let blendedK9 = regressedK9;
  let blendedBb9 = regressedBb9;
  let blendedHr9 = regressedHr9;

  if (scouting) {
    console.log('\n--- STEP 4: Scouting Blend ---\n');
    console.log(`  Scouting Ratings: Stuff=${scouting.stuff}, Control=${scouting.control}, HRA=${scouting.hra}`);

    const scoutK9 = PITCHER_FORMULAS.k9.intercept + PITCHER_FORMULAS.k9.slope * scouting.stuff;
    const scoutBb9 = PITCHER_FORMULAS.bb9.intercept + PITCHER_FORMULAS.bb9.slope * scouting.control;
    const scoutHr9 = PITCHER_FORMULAS.hr9.intercept + PITCHER_FORMULAS.hr9.slope * scouting.hra;

    console.log(`\n  Scouting Expected Rates:`);
    console.log(`    K/9 = ${PITCHER_FORMULAS.k9.intercept} + ${PITCHER_FORMULAS.k9.slope} × ${scouting.stuff} = ${scoutK9.toFixed(2)}`);
    console.log(`    BB/9 = ${PITCHER_FORMULAS.bb9.intercept} + (${PITCHER_FORMULAS.bb9.slope}) × ${scouting.control} = ${scoutBb9.toFixed(2)}`);
    console.log(`    HR/9 = ${PITCHER_FORMULAS.hr9.intercept} + (${PITCHER_FORMULAS.hr9.slope}) × ${scouting.hra} = ${scoutHr9.toFixed(2)}`);

    const statsWeight = totalIp / (totalIp + SCOUTING_BLEND_IP);
    const scoutWeight = 1 - statsWeight;
    console.log(`\n  Blend Weights: stats=${(statsWeight * 100).toFixed(1)}%, scouting=${(scoutWeight * 100).toFixed(1)}%`);
    console.log(`    Formula: IP / (IP + ${SCOUTING_BLEND_IP}) = ${totalIp.toFixed(1)} / ${(totalIp + SCOUTING_BLEND_IP).toFixed(1)}`);

    blendedK9 = statsWeight * regressedK9 + scoutWeight * scoutK9;
    blendedBb9 = statsWeight * regressedBb9 + scoutWeight * scoutBb9;
    blendedHr9 = statsWeight * regressedHr9 + scoutWeight * scoutHr9;

    console.log(`\n  Blended Rates:`);
    console.log(`    K/9 = ${statsWeight.toFixed(3)} × ${regressedK9.toFixed(2)} + ${scoutWeight.toFixed(3)} × ${scoutK9.toFixed(2)} = ${blendedK9.toFixed(2)}`);
    console.log(`    BB/9 = ${statsWeight.toFixed(3)} × ${regressedBb9.toFixed(2)} + ${scoutWeight.toFixed(3)} × ${scoutBb9.toFixed(2)} = ${blendedBb9.toFixed(2)}`);
    console.log(`    HR/9 = ${statsWeight.toFixed(3)} × ${regressedHr9.toFixed(2)} + ${scoutWeight.toFixed(3)} × ${scoutHr9.toFixed(2)} = ${blendedHr9.toFixed(2)}`);
  } else {
    console.log('\n--- STEP 4: Scouting Blend (SKIPPED - no scouting data provided) ---\n');
  }

  console.log('\n--- STEP 5: Estimate Ratings from Blended Rates ---\n');

  const estimatedStuff = Math.max(0, Math.min(100, (blendedK9 - PITCHER_FORMULAS.k9.intercept) / PITCHER_FORMULAS.k9.slope));
  const estimatedControl = Math.max(0, Math.min(100, (PITCHER_FORMULAS.bb9.intercept - blendedBb9) / Math.abs(PITCHER_FORMULAS.bb9.slope)));
  const estimatedHra = Math.max(0, Math.min(100, (PITCHER_FORMULAS.hr9.intercept - blendedHr9) / Math.abs(PITCHER_FORMULAS.hr9.slope)));

  console.log(`  Inverse Formulas (rating = (stat - intercept) / slope):`);
  console.log(`    Stuff = (${blendedK9.toFixed(2)} - ${PITCHER_FORMULAS.k9.intercept}) / ${PITCHER_FORMULAS.k9.slope} = ${estimatedStuff.toFixed(0)}`);
  console.log(`    Control = (${PITCHER_FORMULAS.bb9.intercept} - ${blendedBb9.toFixed(2)}) / ${Math.abs(PITCHER_FORMULAS.bb9.slope)} = ${estimatedControl.toFixed(0)}`);
  console.log(`    HRA = (${PITCHER_FORMULAS.hr9.intercept} - ${blendedHr9.toFixed(2)}) / ${Math.abs(PITCHER_FORMULAS.hr9.slope)} = ${estimatedHra.toFixed(0)}`);

  console.log('\n--- STEP 6: Calculate FIP ---\n');
  const fipLikeFinal = calculateFipLike(blendedK9, blendedBb9, blendedHr9);
  const fipFinal = fipLikeFinal + FIP_CONSTANT;
  console.log(`  FIP-like = (13 × ${blendedHr9.toFixed(2)} + 3 × ${blendedBb9.toFixed(2)} - 2 × ${blendedK9.toFixed(2)}) / 9 = ${fipLikeFinal.toFixed(3)}`);
  console.log(`  FIP = ${fipLikeFinal.toFixed(3)} + ${FIP_CONSTANT} = ${fipFinal.toFixed(2)}`);

  console.log('\n--- STEP 7: Percentile Ranking ---\n');
  console.log(`  Note: Percentile is calculated by ranking this player's FIP-like against all MLB pitchers`);
  console.log(`        in the same role (${role}). This requires comparing against the full dataset.`);

  console.log('\n--- SUMMARY ---\n');
  console.log(`  Player ID: ${playerId}`);
  console.log(`  Role: ${role}`);
  console.log(`  Total IP: ${totalIp.toFixed(1)}`);
  console.log(`\n  Final Blended Rates:`);
  console.log(`    K/9:  ${blendedK9.toFixed(2)}`);
  console.log(`    BB/9: ${blendedBb9.toFixed(2)}`);
  console.log(`    HR/9: ${blendedHr9.toFixed(2)}`);
  console.log(`\n  Estimated Ratings (20-80 scale):`);
  console.log(`    Stuff:   ${Math.round(estimatedStuff)}`);
  console.log(`    Control: ${Math.round(estimatedControl)}`);
  console.log(`    HRA:     ${Math.round(estimatedHra)}`);
  console.log(`\n  Projected FIP: ${fipFinal.toFixed(2)}`);
}

// ============================================================================
// Batter TR Trace
// ============================================================================

function traceBatterTR(
  playerId: number,
  baseYear: number,
  scouting?: BatterScouting,
  yearWeights: number[] = DEFAULT_YEAR_WEIGHTS,
  stage?: SeasonStage
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`BATTER TRUE RATING TRACE: Player ID ${playerId}`);
  console.log('='.repeat(80));

  if (stage) {
    console.log(`\n  Season Stage: ${stage}`);
  }

  // Fetch multi-year stats (up to 4 years for dynamic weighting)
  console.log('\n--- STEP 1: Loading Multi-Year Stats from Local Files ---\n');
  const yearlyStats: BattingStats[] = [];
  const yearsToLoad = Math.max(3, yearWeights.length);
  for (let y = baseYear; y >= baseYear - (yearsToLoad - 1); y--) {
    const stats = loadMLBBattingStats(playerId, y);
    if (stats && stats.pa > 0) {
      yearlyStats.push(stats);
      const bbPct = (stats.bb / stats.pa) * 100;
      const kPct = (stats.k / stats.pa) * 100;
      const hrPct = (stats.hr / stats.pa) * 100;
      const avg = stats.ab > 0 ? stats.h / stats.ab : 0;
      console.log(`  ${stats.year}: ${stats.pa} PA, ${stats.ab} AB, ${stats.h} H, ${stats.d} 2B, ${stats.t} 3B, ${stats.hr} HR, ${stats.bb} BB, ${stats.k} K`);
      console.log(`         BB%=${bbPct.toFixed(1)}, K%=${kPct.toFixed(1)}, HR%=${hrPct.toFixed(2)}, AVG=${avg.toFixed(3)}`);
    }
  }

  if (yearlyStats.length === 0) {
    console.log('  No MLB batting stats found.');
    return;
  }

  // Calculate weighted averages
  console.log('\n--- STEP 2: Multi-Year Weighted Average ---\n');
  console.log('  Year weights: [' + yearWeights.slice(0, yearlyStats.length).join(', ') + ']');

  let weightedBbPctSum = 0, weightedKPctSum = 0, weightedHrPctSum = 0;
  let weightedIsoSum = 0, weightedAvgSum = 0;
  let totalWeight = 0, totalPa = 0;

  for (let i = 0; i < yearlyStats.length && i < yearWeights.length; i++) {
    const s = yearlyStats[i];
    const w = yearWeights[i];

    // Skip years with 0 weight (e.g., early season before current year counts)
    if (w === 0) {
      console.log(`  ${s.year}: weight=0 (SKIPPED - season stage)`);
      continue;
    }

    const bbPct = (s.bb / s.pa) * 100;
    const kPct = (s.k / s.pa) * 100;
    const hrPct = (s.hr / s.pa) * 100;
    const singles = s.h - s.d - s.t - s.hr;
    const totalBases = singles + 2 * s.d + 3 * s.t + 4 * s.hr;
    const iso = s.ab > 0 ? (totalBases - s.h) / s.ab : 0;
    const avg = s.ab > 0 ? s.h / s.ab : 0;
    const weight = w * s.pa;

    console.log(`  ${s.year}: weight=${w} × ${s.pa}PA = ${weight.toFixed(0)}`);
    console.log(`         BB%=${bbPct.toFixed(2)} × ${weight.toFixed(0)} = ${(bbPct * weight).toFixed(1)}`);
    console.log(`         K%=${kPct.toFixed(2)} × ${weight.toFixed(0)} = ${(kPct * weight).toFixed(1)}`);
    console.log(`         HR%=${hrPct.toFixed(3)} × ${weight.toFixed(0)} = ${(hrPct * weight).toFixed(2)}`);
    console.log(`         ISO=${iso.toFixed(3)} × ${weight.toFixed(0)} = ${(iso * weight).toFixed(2)}`);
    console.log(`         AVG=${avg.toFixed(3)} × ${weight.toFixed(0)} = ${(avg * weight).toFixed(2)}`);

    weightedBbPctSum += bbPct * weight;
    weightedKPctSum += kPct * weight;
    weightedHrPctSum += hrPct * weight;
    weightedIsoSum += iso * weight;
    weightedAvgSum += avg * weight;
    totalWeight += weight;
    totalPa += s.pa;
  }

  const weightedBbPct = weightedBbPctSum / totalWeight;
  const weightedKPct = weightedKPctSum / totalWeight;
  const weightedHrPct = weightedHrPctSum / totalWeight;
  const weightedIso = weightedIsoSum / totalWeight;
  const weightedAvg = weightedAvgSum / totalWeight;

  console.log(`\n  Weighted Averages (divided by total weight ${totalWeight.toFixed(0)}):`);
  console.log(`    BB%  = ${weightedBbPct.toFixed(2)}%`);
  console.log(`    K%   = ${weightedKPct.toFixed(2)}%`);
  console.log(`    HR%  = ${weightedHrPct.toFixed(3)}%`);
  console.log(`    ISO  = ${weightedIso.toFixed(3)}`);
  console.log(`    AVG  = ${weightedAvg.toFixed(3)}`);
  console.log(`    Total PA: ${totalPa}`);

  // Calculate raw wOBA for tier determination (using HR% directly, not ISO)
  const rawWoba = calculateWobaFromRates(weightedBbPct, weightedKPct, weightedHrPct, weightedAvg);
  console.log(`\n  Raw wOBA (for tier determination): ${rawWoba.toFixed(3)}`);

  // Tier-aware regression
  console.log('\n--- STEP 3: Tier-Aware Regression ---\n');

  const wobaTargetOffset = calculateWobaTargetOffset(rawWoba);
  const wobaStrengthMultiplier = calculateWobaStrengthMultiplier(rawWoba);
  console.log(`  wOBA Target Offset: ${wobaTargetOffset.toFixed(4)}`);
  console.log(`  wOBA Strength Multiplier: ${wobaStrengthMultiplier.toFixed(2)}`);

  const paConfidence = Math.min(1.0, totalPa / 500);
  const paScale = 0.5 + (paConfidence * 0.5);
  console.log(`\n  PA Confidence: min(1.0, ${totalPa}/500) = ${paConfidence.toFixed(3)}`);
  console.log(`  PA Scale: 0.5 + (${paConfidence.toFixed(3)} × 0.5) = ${paScale.toFixed(3)}`);

  const regressBatterStat = (
    weighted: number,
    leagueRate: number,
    stabilizationK: number,
    statName: string,
    wobaMultiplier: number,
    higherIsBetter: boolean
  ): number => {
    const regressionTarget = higherIsBetter
      ? leagueRate - (wobaTargetOffset * wobaMultiplier)
      : leagueRate + (wobaTargetOffset * wobaMultiplier);
    const adjustedK = stabilizationK * wobaStrengthMultiplier * paScale;
    const regressed = (weighted * totalPa + regressionTarget * adjustedK) / (totalPa + adjustedK);

    console.log(`\n  ${statName} Regression:`);
    console.log(`    League Avg: ${typeof leagueRate === 'number' && leagueRate < 1 ? leagueRate.toFixed(3) : leagueRate}, Multiplier: ${wobaMultiplier}`);
    console.log(`    Target = ${typeof leagueRate === 'number' && leagueRate < 1 ? leagueRate.toFixed(3) : leagueRate} ${higherIsBetter ? '-' : '+'} (${wobaTargetOffset.toFixed(4)} × ${wobaMultiplier}) = ${typeof regressionTarget === 'number' && regressionTarget < 1 ? regressionTarget.toFixed(3) : regressionTarget.toFixed(2)}`);
    console.log(`    Adjusted K = ${stabilizationK} × ${wobaStrengthMultiplier.toFixed(2)} × ${paScale.toFixed(3)} = ${adjustedK.toFixed(2)}`);
    console.log(`    Regressed = ${typeof regressed === 'number' && regressed < 1 ? regressed.toFixed(3) : regressed.toFixed(2)}`);

    return regressed;
  };

  const regressedBbPct = regressBatterStat(weightedBbPct, BATTER_LEAGUE_AVERAGES.bbPct, BATTER_STABILIZATION.bbPct, 'BB%', 30, true);
  const regressedKPct = regressBatterStat(weightedKPct, BATTER_LEAGUE_AVERAGES.kPct, BATTER_STABILIZATION.kPct, 'K%', 50, false);
  console.log(`\n  HR% Regression: SKIPPED (handled by projection coefficient)`);
  const regressedHrPct = weightedHrPct;
  const regressedIso = regressBatterStat(weightedIso, BATTER_LEAGUE_AVERAGES.iso, BATTER_STABILIZATION.iso, 'ISO', 1.5, true);
  const regressedAvg = regressBatterStat(weightedAvg, BATTER_LEAGUE_AVERAGES.avg, BATTER_STABILIZATION.avg, 'AVG', 0.8, true);

  let blendedBbPct = regressedBbPct;
  let blendedKPct = regressedKPct;
  let blendedHrPct = regressedHrPct;
  let blendedIso = regressedIso;
  let blendedAvg = regressedAvg;

  if (scouting) {
    console.log('\n--- STEP 4: Scouting Blend (Component-Specific Thresholds) ---\n');
    console.log(`  Scouting Ratings: Power=${scouting.power}, Eye=${scouting.eye}, AvoidK=${scouting.avoidK}, Contact=${scouting.contact}`);

    const scoutBbPct = BATTER_FORMULAS.eye.intercept + BATTER_FORMULAS.eye.slope * scouting.eye;
    const scoutKPct = BATTER_FORMULAS.avoidK.intercept + BATTER_FORMULAS.avoidK.slope * scouting.avoidK;
    const scoutHrPct = scouting.power <= 50
      ? BATTER_FORMULAS.power.low.intercept + BATTER_FORMULAS.power.low.slope * scouting.power
      : BATTER_FORMULAS.power.high.intercept + BATTER_FORMULAS.power.high.slope * scouting.power;
    const scoutAvg = BATTER_FORMULAS.contact.intercept + BATTER_FORMULAS.contact.slope * scouting.contact;
    const scoutIso = (scoutHrPct / 100) * 3 + 0.05;

    console.log(`\n  Scouting Expected Rates:`);
    console.log(`    BB%: ${scoutBbPct.toFixed(2)}%`);
    console.log(`    K%: ${scoutKPct.toFixed(2)}%`);
    console.log(`    HR%: ${scoutHrPct.toFixed(3)}%`);
    console.log(`    AVG: ${scoutAvg.toFixed(3)}`);

    // Component-specific blend weights (ISO not blended - we use HR% directly)
    const calcBlend = (threshold: number) => {
      const statsW = totalPa / (totalPa + threshold);
      return { stats: statsW, scout: 1 - statsW };
    };

    const blendK = calcBlend(SCOUTING_BLEND_THRESHOLDS.kPct);
    const blendBb = calcBlend(SCOUTING_BLEND_THRESHOLDS.bbPct);
    const blendHr = calcBlend(SCOUTING_BLEND_THRESHOLDS.hrPct);
    const blendAvgW = calcBlend(SCOUTING_BLEND_THRESHOLDS.avg);

    console.log(`\n  Component-Specific Blend Weights (PA / (PA + threshold)):`);
    console.log(`    K%:  ${totalPa} / (${totalPa} + ${SCOUTING_BLEND_THRESHOLDS.kPct}) = ${(blendK.stats * 100).toFixed(1)}% stats, ${(blendK.scout * 100).toFixed(1)}% scout`);
    console.log(`    BB%: ${totalPa} / (${totalPa} + ${SCOUTING_BLEND_THRESHOLDS.bbPct}) = ${(blendBb.stats * 100).toFixed(1)}% stats, ${(blendBb.scout * 100).toFixed(1)}% scout`);
    console.log(`    HR%: ${totalPa} / (${totalPa} + ${SCOUTING_BLEND_THRESHOLDS.hrPct}) = ${(blendHr.stats * 100).toFixed(1)}% stats, ${(blendHr.scout * 100).toFixed(1)}% scout`);
    console.log(`    AVG: ${totalPa} / (${totalPa} + ${SCOUTING_BLEND_THRESHOLDS.avg}) = ${(blendAvgW.stats * 100).toFixed(1)}% stats, ${(blendAvgW.scout * 100).toFixed(1)}% scout`);
    console.log(`    ISO: (not blended - derived from HR%)`);

    console.log(`\n  Rationale: K% stabilizes quickly (trust stats). HR%/AVG more volatile (trust scouts longer).`);

    blendedBbPct = blendBb.stats * regressedBbPct + blendBb.scout * scoutBbPct;
    blendedKPct = blendK.stats * regressedKPct + blendK.scout * scoutKPct;
    blendedHrPct = blendHr.stats * regressedHrPct + blendHr.scout * scoutHrPct;
    blendedAvg = blendAvgW.stats * regressedAvg + blendAvgW.scout * scoutAvg;
    // ISO not blended - keep regressed value (used only for display, not wOBA)

    console.log(`\n  Blended Rates:`);
    console.log(`    BB%: ${blendBb.stats.toFixed(3)} × ${regressedBbPct.toFixed(2)} + ${blendBb.scout.toFixed(3)} × ${scoutBbPct.toFixed(2)} = ${blendedBbPct.toFixed(2)}%`);
    console.log(`    K%:  ${blendK.stats.toFixed(3)} × ${regressedKPct.toFixed(2)} + ${blendK.scout.toFixed(3)} × ${scoutKPct.toFixed(2)} = ${blendedKPct.toFixed(2)}%`);
    console.log(`    HR%: ${blendHr.stats.toFixed(3)} × ${regressedHrPct.toFixed(3)} + ${blendHr.scout.toFixed(3)} × ${scoutHrPct.toFixed(3)} = ${blendedHrPct.toFixed(3)}%`);
    console.log(`    AVG: ${blendAvgW.stats.toFixed(3)} × ${regressedAvg.toFixed(3)} + ${blendAvgW.scout.toFixed(3)} × ${scoutAvg.toFixed(3)} = ${blendedAvg.toFixed(3)}`);
  } else {
    console.log('\n--- STEP 4: Scouting Blend (SKIPPED - no scouting data provided) ---\n');
  }

  // Calculate wOBA using HR% directly (not ISO)
  console.log('\n--- STEP 5: Calculate wOBA ---\n');
  const finalWoba = calculateWobaFromRates(blendedBbPct, blendedKPct, blendedHrPct, blendedAvg);
  console.log(`  wOBA = ${finalWoba.toFixed(3)}`);

  // Estimate ratings
  console.log('\n--- STEP 6: Estimate Ratings (Formula-Based) ---\n');
  console.log(`  Note: True Ratings actually use PERCENTILE-based component ratings,`);
  console.log(`        ranking each player against all others in the same season.`);
  console.log(`        Below are formula-based estimates for reference:\n`);

  const estEye = Math.max(20, Math.min(80, (blendedBbPct - BATTER_FORMULAS.eye.intercept) / BATTER_FORMULAS.eye.slope));
  const estAvoidK = Math.max(20, Math.min(80, (blendedKPct - BATTER_FORMULAS.avoidK.intercept) / BATTER_FORMULAS.avoidK.slope));
  const estPower = blendedHrPct <= 2.15
    ? (blendedHrPct - BATTER_FORMULAS.power.low.intercept) / BATTER_FORMULAS.power.low.slope
    : (blendedHrPct - BATTER_FORMULAS.power.high.intercept) / BATTER_FORMULAS.power.high.slope;
  const estContact = Math.max(20, Math.min(80, (blendedAvg - BATTER_FORMULAS.contact.intercept) / BATTER_FORMULAS.contact.slope));

  console.log(`  Eye (from BB%):     ${estEye.toFixed(0)}`);
  console.log(`  AvoidK (from K%):   ${estAvoidK.toFixed(0)}`);
  console.log(`  Power (from HR%):   ${Math.max(20, Math.min(80, estPower)).toFixed(0)}`);
  console.log(`  Contact (from AVG): ${estContact.toFixed(0)}`);

  console.log('\n--- SUMMARY ---\n');
  console.log(`  Player ID: ${playerId}`);
  console.log(`  Total PA: ${totalPa}`);
  console.log(`\n  Final Blended Rates:`);
  console.log(`    BB%:  ${blendedBbPct.toFixed(2)}%`);
  console.log(`    K%:   ${blendedKPct.toFixed(2)}%`);
  console.log(`    HR%:  ${blendedHrPct.toFixed(3)}%`);
  console.log(`    ISO:  ${blendedIso.toFixed(3)}`);
  console.log(`    AVG:  ${blendedAvg.toFixed(3)}`);
  console.log(`\n  Projected wOBA: ${finalWoba.toFixed(3)}`);
}

// ============================================================================
// TFR Trace Functions
// ============================================================================

function tracePitcherTFR(
  playerId: number,
  baseYear: number,
  scouting: PitcherScouting
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`PITCHER TRUE FUTURE RATING (TFR) TRACE: Player ID ${playerId}`);
  console.log('='.repeat(80));

  console.log('\n--- STEP 1: Scouting Ratings ---\n');
  console.log(`  Stuff:   ${scouting.stuff}`);
  console.log(`  Control: ${scouting.control}`);
  console.log(`  HRA:     ${scouting.hra}`);

  const scoutK9 = PITCHER_FORMULAS.k9.intercept + PITCHER_FORMULAS.k9.slope * scouting.stuff;
  const scoutBb9 = PITCHER_FORMULAS.bb9.intercept + PITCHER_FORMULAS.bb9.slope * scouting.control;
  const scoutHr9 = PITCHER_FORMULAS.hr9.intercept + PITCHER_FORMULAS.hr9.slope * scouting.hra;

  console.log(`\n  Scouting Expected Rates:`);
  console.log(`    K/9 = ${PITCHER_FORMULAS.k9.intercept} + ${PITCHER_FORMULAS.k9.slope} × ${scouting.stuff} = ${scoutK9.toFixed(2)}`);
  console.log(`    BB/9 = ${PITCHER_FORMULAS.bb9.intercept} + (${PITCHER_FORMULAS.bb9.slope}) × ${scouting.control} = ${scoutBb9.toFixed(2)}`);
  console.log(`    HR/9 = ${PITCHER_FORMULAS.hr9.intercept} + (${PITCHER_FORMULAS.hr9.slope}) × ${scouting.hra} = ${scoutHr9.toFixed(2)}`);

  console.log('\n--- STEP 2: Minor League Stats ---\n');
  const allMinorStats: MinorLeaguePitchingStats[] = [];
  for (let y = baseYear; y >= baseYear - 3; y--) {
    const stats = loadMinorLeaguePitchingStats(playerId, y);
    allMinorStats.push(...stats);
  }

  if (allMinorStats.length === 0) {
    console.log('  No minor league pitching stats found.');
    console.log('  Using 100% scouting weight.');
  } else {
    for (const s of allMinorStats) {
      const k9 = (s.k / s.ip) * 9;
      const bb9 = (s.bb / s.ip) * 9;
      const hr9 = (s.hra / s.ip) * 9;
      console.log(`  ${s.year} ${s.level.toUpperCase()}: ${s.ip.toFixed(1)} IP, K/9=${k9.toFixed(2)}, BB/9=${bb9.toFixed(2)}, HR/9=${hr9.toFixed(2)}`);
    }
  }

  console.log('\n--- STEP 3: Calculate Level-Weighted IP ---\n');
  let totalWeightedIp = 0;
  let totalRawIp = 0;
  for (const s of allMinorStats) {
    const levelWeight = LEVEL_WEIGHTS[s.level as keyof typeof LEVEL_WEIGHTS] || 0.2;
    const weightedIp = s.ip * levelWeight;
    totalWeightedIp += weightedIp;
    totalRawIp += s.ip;
    console.log(`  ${s.level.toUpperCase()}: ${s.ip.toFixed(1)} IP × ${levelWeight} = ${weightedIp.toFixed(1)} weighted IP`);
  }
  console.log(`\n  Total Raw IP: ${totalRawIp.toFixed(1)}`);
  console.log(`  Total Weighted IP: ${totalWeightedIp.toFixed(1)}`);

  console.log('\n--- STEP 4: Determine Scouting Weight ---\n');
  let scoutingWeight: number;
  if (totalWeightedIp < 75) {
    scoutingWeight = 1.0;
    console.log(`  Weighted IP < 75: 100% scouting`);
  } else if (totalWeightedIp <= 150) {
    scoutingWeight = 0.8;
    console.log(`  Weighted IP 75-150: 80% scouting`);
  } else if (totalWeightedIp <= 250) {
    scoutingWeight = 0.7;
    console.log(`  Weighted IP 151-250: 70% scouting`);
  } else {
    scoutingWeight = 0.6;
    console.log(`  Weighted IP 250+: 60% scouting`);
  }

  console.log('\n--- STEP 5: Level-Adjusted Minor League Stats ---\n');
  let adjustedK9Sum = 0, adjustedBb9Sum = 0, adjustedHr9Sum = 0;
  let totalIpWeight = 0;

  for (const s of allMinorStats) {
    const levelAdj = PITCHER_LEVEL_ADJUSTMENTS[s.level as keyof typeof PITCHER_LEVEL_ADJUSTMENTS];
    if (!levelAdj) continue;

    const rawK9 = (s.k / s.ip) * 9;
    const rawBb9 = (s.bb / s.ip) * 9;
    const rawHr9 = (s.hra / s.ip) * 9;

    const adjK9 = rawK9 + levelAdj.k9;
    const adjBb9 = rawBb9 + levelAdj.bb9;
    const adjHr9 = rawHr9 + levelAdj.hr9;

    console.log(`  ${s.level.toUpperCase()} (${s.ip.toFixed(1)} IP):`);
    console.log(`    K/9: ${rawK9.toFixed(2)} + ${levelAdj.k9} = ${adjK9.toFixed(2)}`);
    console.log(`    BB/9: ${rawBb9.toFixed(2)} + ${levelAdj.bb9} = ${adjBb9.toFixed(2)}`);
    console.log(`    HR/9: ${rawHr9.toFixed(2)} + ${levelAdj.hr9} = ${adjHr9.toFixed(2)}`);

    adjustedK9Sum += adjK9 * s.ip;
    adjustedBb9Sum += adjBb9 * s.ip;
    adjustedHr9Sum += adjHr9 * s.ip;
    totalIpWeight += s.ip;
  }

  let adjustedK9 = scoutK9;
  let adjustedBb9 = scoutBb9;
  let adjustedHr9 = scoutHr9;

  if (totalIpWeight > 0) {
    adjustedK9 = adjustedK9Sum / totalIpWeight;
    adjustedBb9 = adjustedBb9Sum / totalIpWeight;
    adjustedHr9 = adjustedHr9Sum / totalIpWeight;
    console.log(`\n  Weighted Adjusted Stats (MLB-equivalent):`);
    console.log(`    K/9: ${adjustedK9.toFixed(2)}`);
    console.log(`    BB/9: ${adjustedBb9.toFixed(2)}`);
    console.log(`    HR/9: ${adjustedHr9.toFixed(2)}`);
  }

  console.log('\n--- STEP 6: Blend Scouting and Stats ---\n');
  const statsWeight = 1 - scoutingWeight;
  console.log(`  Scouting Weight: ${(scoutingWeight * 100).toFixed(0)}%`);
  console.log(`  Stats Weight: ${(statsWeight * 100).toFixed(0)}%`);

  const blendedK9 = scoutingWeight * scoutK9 + statsWeight * adjustedK9;
  const blendedBb9 = scoutingWeight * scoutBb9 + statsWeight * adjustedBb9;
  const blendedHr9 = scoutingWeight * scoutHr9 + statsWeight * adjustedHr9;

  console.log(`\n  Blended Rates:`);
  console.log(`    K/9 = ${scoutingWeight.toFixed(2)} × ${scoutK9.toFixed(2)} + ${statsWeight.toFixed(2)} × ${adjustedK9.toFixed(2)} = ${blendedK9.toFixed(2)}`);
  console.log(`    BB/9 = ${scoutingWeight.toFixed(2)} × ${scoutBb9.toFixed(2)} + ${statsWeight.toFixed(2)} × ${adjustedBb9.toFixed(2)} = ${blendedBb9.toFixed(2)}`);
  console.log(`    HR/9 = ${scoutingWeight.toFixed(2)} × ${scoutHr9.toFixed(2)} + ${statsWeight.toFixed(2)} × ${adjustedHr9.toFixed(2)} = ${blendedHr9.toFixed(2)}`);

  console.log('\n--- STEP 7: Calculate Projected FIP ---\n');
  const projFip = calculateFip(blendedK9, blendedBb9, blendedHr9);
  console.log(`  Projected FIP = ${projFip.toFixed(2)}`);

  // --- STEP 8: IP Projection ---
  console.log('\n--- STEP 8: Projected IP ---\n');

  const stamina = scouting.stamina ?? 50;
  const injury = scouting.injury ?? 'Normal';
  const pitches = scouting.pitches ?? {};

  console.log(`  Stamina: ${stamina}`);
  console.log(`  Injury:  ${injury}`);

  // Show pitches
  const pitchEntries = Object.entries(pitches).filter(([, v]) => v > 0);
  if (pitchEntries.length > 0) {
    console.log(`  Pitches: ${pitchEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  // Role classification (matches ProjectionService: pitches >= 25, stamina >= 35)
  const usablePitchCount = Object.values(pitches).filter(v => v >= 25).length;
  const isSp = stamina >= 35 && usablePitchCount >= 3;
  console.log(`\n  Usable pitches (≥25 rating): ${usablePitchCount}`);
  console.log(`  Role classification: ${isSp ? 'STARTER' : 'RELIEVER'} (need stamina≥35 AND 3+ pitches≥25)`);

  // 8a. Base IP from stamina
  let baseIp: number;
  if (isSp) {
    baseIp = 30 + (stamina * 3.0);
    console.log(`\n  8a. SP Base IP = 30 + (${stamina} × 3.0) = ${baseIp.toFixed(0)}`);
  } else {
    baseIp = 50 + (stamina * 0.5);
    console.log(`\n  8a. RP Base IP = 50 + (${stamina} × 0.5) = ${baseIp.toFixed(0)}`);
  }

  // 8b. Injury modifier
  let injuryFactor = 1.0;
  switch (injury) {
    case 'Iron Man': case 'Ironman': injuryFactor = 1.15; break;
    case 'Durable': injuryFactor = 1.10; break;
    case 'Normal': injuryFactor = 1.0; break;
    case 'Fragile': injuryFactor = 0.90; break;
    case 'Wrecked': injuryFactor = 0.75; break;
  }
  baseIp *= injuryFactor;
  console.log(`  8b. Injury modifier: ${injury} → ×${injuryFactor.toFixed(2)} → ${baseIp.toFixed(0)}`);

  // 8c. Skill modifier (better pitchers get more innings)
  let skillMod = 1.0;
  if (projFip <= 3.50) skillMod = 1.20;
  else if (projFip <= 4.00) skillMod = 1.10;
  else if (projFip <= 4.50) skillMod = 1.0;
  else if (projFip <= 5.00) skillMod = 0.90;
  else skillMod = 0.80;
  baseIp *= skillMod;
  console.log(`  8c. Skill modifier: FIP ${projFip.toFixed(2)} → ×${skillMod.toFixed(2)} → ${baseIp.toFixed(0)}`);

  // 8d. Historical blend (for MLB players with career stats)
  // Load MLB IP history from recent years
  const mlbIpHistory: { year: number; ip: number; gs: number }[] = [];
  for (let y = baseYear; y >= baseYear - 5; y--) {
    const mlbStats = loadMLBPitchingStats(playerId, y);
    if (mlbStats && mlbStats.ip > 0) {
      mlbIpHistory.push({ year: y, ip: mlbStats.ip, gs: mlbStats.gs });
    }
  }
  mlbIpHistory.sort((a, b) => b.year - a.year); // Most recent first

  if (mlbIpHistory.length > 0) {
    const minIpThreshold = isSp ? 50 : 10;
    const completedSeasons = mlbIpHistory.filter(s => s.ip >= minIpThreshold);
    console.log(`  8d. Historical IP blend:`);
    console.log(`      All MLB seasons: ${mlbIpHistory.map(s => `${s.year}=${Math.round(s.ip)}IP`).join(', ')}`);
    console.log(`      Completed seasons (≥${minIpThreshold} IP): ${completedSeasons.map(s => `${s.year}=${Math.round(s.ip)}IP`).join(', ')}`);

    if (completedSeasons.length > 0) {
      const weights = [5, 3, 2];
      let totalWeightedIp = 0;
      let totalWeight = 0;
      for (let i = 0; i < Math.min(completedSeasons.length, 3); i++) {
        totalWeightedIp += completedSeasons[i].ip * weights[i];
        totalWeight += weights[i];
      }
      const weightedIp = totalWeightedIp / totalWeight;
      console.log(`      Weighted avg (5/3/2): ${weightedIp.toFixed(1)} IP`);

      // Established players: 35% model + 65% history
      const modelIp = baseIp;
      baseIp = (baseIp * 0.35) + (weightedIp * 0.65);
      console.log(`      Blend: 35% model (${modelIp.toFixed(0)}) + 65% history (${weightedIp.toFixed(0)}) = ${baseIp.toFixed(0)}`);
    }
  } else {
    console.log(`  8d. Historical IP blend: No MLB history found (pure model projection)`);
  }

  // 8e. Elite pitcher boost
  let eliteBoost = 1.0;
  if (projFip < 3.0) eliteBoost = 1.08;
  else if (projFip < 3.5) eliteBoost = 1.08 - ((projFip - 3.0) / 0.5) * 0.05;
  else if (projFip < 4.0) eliteBoost = 1.03 - ((projFip - 3.5) / 0.5) * 0.03;
  if (eliteBoost > 1.0) {
    baseIp *= eliteBoost;
    console.log(`  8e. Elite FIP boost: ×${eliteBoost.toFixed(2)} → ${baseIp.toFixed(0)}`);
  } else {
    console.log(`  8e. Elite FIP boost: none (FIP ≥ 4.0)`);
  }

  // Final clamp
  let projectedIp: number;
  if (isSp) {
    projectedIp = Math.round(Math.max(120, Math.min(260, baseIp)));
    console.log(`  Clamped (120-260): ${projectedIp} IP`);
  } else {
    projectedIp = Math.round(Math.max(40, Math.min(80, baseIp)));
    console.log(`  Clamped (40-80): ${projectedIp} IP`);
  }

  console.log(`\n  ► Projected IP: ${projectedIp}`);

  // WAR calculation (matches FipWarService: replacement 5.20, runsPerWin 8.50)
  const replacementFip = 5.20;
  const runsPerWin = 8.50;
  const peakWar = ((replacementFip - projFip) / runsPerWin) * (projectedIp / 9);
  console.log(`\n  WAR = ((${replacementFip.toFixed(2)} - ${projFip.toFixed(2)}) / ${runsPerWin.toFixed(1)}) × (${projectedIp} / 9)`);
  console.log(`      = ${((replacementFip - projFip) / runsPerWin).toFixed(3)} × ${(projectedIp / 9).toFixed(1)}`);
  console.log(`      = ${peakWar.toFixed(1)} WAR`);

  // --- STEP 9: Current True Rating Derivation (Development Curves) ---
  console.log('\n--- STEP 9: Current True Rating (TR) via Development Curves ---\n');
  console.log('  TR represents current ability on the radar chart (blue solid line).');
  console.log('  TFR represents peak potential (green dashed line).');
  console.log('  TR is derived from data-driven development curves (135 MLB pitchers, 2012+ debuts).');
  console.log('  For each component: cohort selection -> expected MiLB stat at age -> dev fraction -> baseline TR.');
  console.log('  Individual adjustment: (actual raw - expected) / expected x shrinkage x sensitivity.\n');

  const pitcherDobMap = loadDOBMap();
  const trAge = calculateAge(pitcherDobMap.get(playerId), baseYear) ?? 22;
  console.log(`  Age: ${trAge}`);
  console.log(`  Total MiLB IP: ${totalRawIp.toFixed(1)}\n`);

  // Calculate raw (unadjusted) IP-weighted stats
  let rawK9 = 0, rawBb9 = 0, rawHr9 = 0;
  if (totalRawIp > 0) {
    let k9IpSum = 0, bb9IpSum = 0, hr9IpSum = 0;
    for (const s of allMinorStats) {
      const sk9 = (s.k / s.ip) * 9;
      const sbb9 = (s.bb / s.ip) * 9;
      const shr9 = (s.hra / s.ip) * 9;
      k9IpSum += sk9 * s.ip;
      bb9IpSum += sbb9 * s.ip;
      hr9IpSum += shr9 * s.ip;
    }
    rawK9 = k9IpSum / totalRawIp;
    rawBb9 = bb9IpSum / totalRawIp;
    rawHr9 = hr9IpSum / totalRawIp;
    console.log(`  Raw IP-weighted stats: K/9=${rawK9.toFixed(2)}, BB/9=${rawBb9.toFixed(2)}, HR/9=${rawHr9.toFixed(2)}`);
  }

  // Derive TFR ratings from blended rates (same formula as TrueRatingsView fallback)
  const tfrStuff = Math.round(20 + ((Math.max(3.0, Math.min(11.0, blendedK9)) - 3.0) / 8.0) * 60);
  const tfrControl = Math.round(20 + ((7.0 - Math.max(0.85, Math.min(7.0, blendedBb9))) / 6.15) * 60);
  const tfrHra = Math.round(20 + ((2.5 - Math.max(0.20, Math.min(2.5, blendedHr9))) / 2.30) * 60);

  console.log(`\n  TFR Ratings (derived from blended rates): Stuff=${tfrStuff}, Control=${tfrControl}, HRA=${tfrHra}\n`);

  const pitcherComponents = [
    { name: 'Stuff',   key: 'stuff',   tfrVal: tfrStuff,   peakStat: blendedK9,  rawStat: totalRawIp > 0 ? rawK9 : undefined,  lower: false },
    { name: 'Control', key: 'control', tfrVal: tfrControl, peakStat: blendedBb9, rawStat: totalRawIp > 0 ? rawBb9 : undefined, lower: true },
    { name: 'HRA',     key: 'hra',     tfrVal: tfrHra,     peakStat: blendedHr9, rawStat: totalRawIp > 0 ? rawHr9 : undefined, lower: true },
  ];

  console.log(`  ${'Component'.padEnd(10)} ${'Cohort'.padEnd(12)} ${'Expected'.padEnd(10)} ${'Actual Raw'.padEnd(12)} ${'DevFrac'.padEnd(8)} ${'Base'.padEnd(6)} ${'Adj'.padEnd(8)} ${'TFR'.padEnd(6)} Final TR  Gap`);
  console.log(`  ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(5)}`);

  const pitcherDevCurveDiag = getPitcherDevelopmentCurveDiagnosticsLocal(trAge, totalRawIp);

  for (const c of pitcherComponents) {
    const diag = pitcherDevCurveDiag(c.key, c.tfrVal, c.peakStat, c.rawStat, c.lower);
    const gap = c.tfrVal - diag.finalTR;
    const expectedStr = diag.expectedRaw !== undefined ? diag.expectedRaw.toFixed(2) : '—';
    const actualStr = c.rawStat !== undefined ? c.rawStat.toFixed(2) : '—';
    const adjStr = diag.ratingAdjust !== 0 ? (diag.ratingAdjust > 0 ? '+' : '') + diag.ratingAdjust.toFixed(1) : '0';
    console.log(`  ${c.name.padEnd(10)} ${diag.cohortLabel.padEnd(12)} ${expectedStr.padEnd(10)} ${actualStr.padEnd(12)} ${diag.devFraction.toFixed(2).padEnd(8)} ${String(diag.baseline).padEnd(6)} ${adjStr.padEnd(8)} ${String(c.tfrVal).padEnd(6)} ${String(diag.finalTR).padEnd(10)} +${gap}`);
  }

  console.log(`\n  Stabilization IP: Stuff=100, Control=150, HRA=200`);
  console.log(`  Sensitivity: ${TRACE_SENSITIVITY_POINTS} rating points per 100% deviation from expected curve value.`);

  console.log('\n--- SUMMARY ---\n');
  console.log(`  Player ID: ${playerId}`);
  console.log(`\n  Scouting Ratings:`);
  console.log(`    Stuff: ${scouting.stuff}, Control: ${scouting.control}, HRA: ${scouting.hra}`);
  console.log(`    Stamina: ${stamina}, Injury: ${injury}`);
  if (pitchEntries.length > 0) {
    console.log(`    Pitches: ${pitchEntries.map(([k, v]) => `${k}=${v}`).join(', ')} (${usablePitchCount} usable)`);
  }
  console.log(`\n  Minor League Stats: ${totalRawIp.toFixed(1)} IP (${totalWeightedIp.toFixed(1)} weighted)`);
  console.log(`  Scouting Weight: ${(scoutingWeight * 100).toFixed(0)}%`);
  console.log(`\n  Projected Peak Rates (TFR):`);
  console.log(`    K/9: ${blendedK9.toFixed(2)} (TFR Stuff: ${tfrStuff})`);
  console.log(`    BB/9: ${blendedBb9.toFixed(2)} (TFR Control: ${tfrControl})`);
  console.log(`    HR/9: ${blendedHr9.toFixed(2)} (TFR HRA: ${tfrHra})`);
  console.log(`\n  Current TR (Development Curves):`);
  for (const c of pitcherComponents) {
    const diag = pitcherDevCurveDiag(c.key, c.tfrVal, c.peakStat, c.rawStat, c.lower);
    console.log(`    ${c.name}: ${diag.finalTR} (TFR: ${c.tfrVal}, gap: +${c.tfrVal - diag.finalTR})`);
  }
  console.log(`\n  Projected Peak FIP: ${projFip.toFixed(2)}`);
  console.log(`  Role: ${isSp ? 'SP' : 'RP'}`);
  console.log(`  Projected Peak IP: ${projectedIp}`);
  console.log(`  Projected Peak WAR: ${peakWar.toFixed(1)}`);
}

function tracePitcherTFRFull(
  playerId: number,
  baseYear: number,
  scouting: PitcherScouting
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`PITCHER TFR (FULL MODE): Player ID ${playerId}`);
  console.log('='.repeat(80));

  // --- STEP 1: Scouting Ratings ---
  console.log('\n--- STEP 1: Scouting Ratings ---\n');
  console.log(`  Stuff:   ${scouting.stuff}`);
  console.log(`  Control: ${scouting.control}`);
  console.log(`  HRA:     ${scouting.hra}`);
  console.log(`  Stamina: ${scouting.stamina ?? '?'}`);
  console.log(`  Injury:  ${scouting.injury ?? 'Normal'}`);

  const pitches = scouting.pitches ?? {};
  const pitchEntries = Object.entries(pitches).filter(([, v]) => v > 0);
  if (pitchEntries.length > 0) {
    console.log(`  Pitches: ${pitchEntries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  const scoutK9 = PITCHER_FORMULAS.k9.intercept + PITCHER_FORMULAS.k9.slope * scouting.stuff;
  const scoutBb9 = PITCHER_FORMULAS.bb9.intercept + PITCHER_FORMULAS.bb9.slope * scouting.control;
  const scoutHr9 = PITCHER_FORMULAS.hr9.intercept + PITCHER_FORMULAS.hr9.slope * scouting.hra;

  console.log(`\n  Scouting Expected Rates:`);
  console.log(`    K/9 = ${PITCHER_FORMULAS.k9.intercept} + ${PITCHER_FORMULAS.k9.slope} × ${scouting.stuff} = ${scoutK9.toFixed(2)}`);
  console.log(`    BB/9 = ${PITCHER_FORMULAS.bb9.intercept} + (${PITCHER_FORMULAS.bb9.slope}) × ${scouting.control} = ${scoutBb9.toFixed(2)}`);
  console.log(`    HR/9 = ${PITCHER_FORMULAS.hr9.intercept} + (${PITCHER_FORMULAS.hr9.slope}) × ${scouting.hra} = ${scoutHr9.toFixed(2)}`);

  // --- STEP 2: Minor League Stats ---
  console.log('\n--- STEP 2: Minor League Stats ---\n');
  const allMinorStats: MinorLeaguePitchingStats[] = [];
  for (let y = baseYear; y >= baseYear - 3; y--) {
    const stats = loadMinorLeaguePitchingStats(playerId, y);
    allMinorStats.push(...stats);
  }

  if (allMinorStats.length === 0) {
    console.log('  No minor league pitching stats found.');
    console.log('  Using 100% scouting weight.');
  } else {
    for (const s of allMinorStats) {
      const k9 = (s.k / s.ip) * 9;
      const bb9 = (s.bb / s.ip) * 9;
      const hr9 = (s.hra / s.ip) * 9;
      console.log(`  ${s.year} ${s.level.toUpperCase()}: ${s.ip.toFixed(1)} IP, K/9=${k9.toFixed(2)}, BB/9=${bb9.toFixed(2)}, HR/9=${hr9.toFixed(2)}`);
    }
  }

  // --- STEP 3: Level-Weighted IP ---
  console.log('\n--- STEP 3: Calculate Level-Weighted IP ---\n');
  let totalWeightedIp = 0;
  let totalRawIp = 0;
  for (const s of allMinorStats) {
    const levelWeight = LEVEL_WEIGHTS[s.level as keyof typeof LEVEL_WEIGHTS] || 0.2;
    const weightedIp = s.ip * levelWeight;
    totalWeightedIp += weightedIp;
    totalRawIp += s.ip;
    console.log(`  ${s.level.toUpperCase()}: ${s.ip.toFixed(1)} IP × ${levelWeight} = ${weightedIp.toFixed(1)} weighted IP`);
  }
  console.log(`\n  Total Raw IP: ${totalRawIp.toFixed(1)}`);
  console.log(`  Total Weighted IP: ${totalWeightedIp.toFixed(1)}`);

  // --- STEP 4: Scouting Weight ---
  console.log('\n--- STEP 4: Determine Scouting Weight ---\n');
  let scoutingWeight: number;
  if (totalWeightedIp < 75) {
    scoutingWeight = 1.0;
    console.log(`  Weighted IP < 75: 100% scouting`);
  } else if (totalWeightedIp <= 150) {
    scoutingWeight = 0.8;
    console.log(`  Weighted IP 75-150: 80% scouting`);
  } else if (totalWeightedIp <= 250) {
    scoutingWeight = 0.7;
    console.log(`  Weighted IP 151-250: 70% scouting`);
  } else {
    scoutingWeight = 0.6;
    console.log(`  Weighted IP 250+: 60% scouting`);
  }

  // --- STEP 5: Level-Adjusted Stats ---
  console.log('\n--- STEP 5: Level-Adjusted Minor League Stats ---\n');
  let adjustedK9Sum = 0, adjustedBb9Sum = 0, adjustedHr9Sum = 0;
  let totalIpWeight = 0;

  for (const s of allMinorStats) {
    const levelAdj = PITCHER_LEVEL_ADJUSTMENTS[s.level as keyof typeof PITCHER_LEVEL_ADJUSTMENTS];
    if (!levelAdj) continue;

    const rawK9 = (s.k / s.ip) * 9;
    const rawBb9 = (s.bb / s.ip) * 9;
    const rawHr9 = (s.hra / s.ip) * 9;

    const adjK9 = rawK9 + levelAdj.k9;
    const adjBb9 = rawBb9 + levelAdj.bb9;
    const adjHr9 = rawHr9 + levelAdj.hr9;

    console.log(`  ${s.level.toUpperCase()} (${s.ip.toFixed(1)} IP):`);
    console.log(`    K/9: ${rawK9.toFixed(2)} + ${levelAdj.k9} = ${adjK9.toFixed(2)}`);
    console.log(`    BB/9: ${rawBb9.toFixed(2)} + ${levelAdj.bb9} = ${adjBb9.toFixed(2)}`);
    console.log(`    HR/9: ${rawHr9.toFixed(2)} + ${levelAdj.hr9} = ${adjHr9.toFixed(2)}`);

    adjustedK9Sum += adjK9 * s.ip;
    adjustedBb9Sum += adjBb9 * s.ip;
    adjustedHr9Sum += adjHr9 * s.ip;
    totalIpWeight += s.ip;
  }

  let adjustedK9 = scoutK9;
  let adjustedBb9 = scoutBb9;
  let adjustedHr9 = scoutHr9;

  if (totalIpWeight > 0) {
    adjustedK9 = adjustedK9Sum / totalIpWeight;
    adjustedBb9 = adjustedBb9Sum / totalIpWeight;
    adjustedHr9 = adjustedHr9Sum / totalIpWeight;
    console.log(`\n  Weighted Adjusted Stats (MLB-equivalent):`);
    console.log(`    K/9: ${adjustedK9.toFixed(2)}`);
    console.log(`    BB/9: ${adjustedBb9.toFixed(2)}`);
    console.log(`    HR/9: ${adjustedHr9.toFixed(2)}`);
  }

  // --- STEP 6: Blend ---
  console.log('\n--- STEP 6: Blend Scouting and Stats ---\n');
  const statsWeight = 1 - scoutingWeight;
  console.log(`  Scouting Weight: ${(scoutingWeight * 100).toFixed(0)}%`);
  console.log(`  Stats Weight: ${(statsWeight * 100).toFixed(0)}%`);

  const blendedK9 = scoutingWeight * scoutK9 + statsWeight * adjustedK9;
  const blendedBb9 = scoutingWeight * scoutBb9 + statsWeight * adjustedBb9;
  const blendedHr9 = scoutingWeight * scoutHr9 + statsWeight * adjustedHr9;

  console.log(`\n  Blended Rates:`);
  console.log(`    K/9 = ${scoutingWeight.toFixed(2)} × ${scoutK9.toFixed(2)} + ${statsWeight.toFixed(2)} × ${adjustedK9.toFixed(2)} = ${blendedK9.toFixed(2)}`);
  console.log(`    BB/9 = ${scoutingWeight.toFixed(2)} × ${scoutBb9.toFixed(2)} + ${statsWeight.toFixed(2)} × ${adjustedBb9.toFixed(2)} = ${blendedBb9.toFixed(2)}`);
  console.log(`    HR/9 = ${scoutingWeight.toFixed(2)} × ${scoutHr9.toFixed(2)} + ${statsWeight.toFixed(2)} × ${adjustedHr9.toFixed(2)} = ${blendedHr9.toFixed(2)}`);

  // --- STEP 6b: Ceiling Boost ---
  console.log('\n--- STEP 6b: Ceiling Boost ---\n');
  const CEILING_BOOST = 0.30;
  const avgK9 = PITCHER_FORMULAS.k9.intercept + PITCHER_FORMULAS.k9.slope * 50;
  const avgBb9 = PITCHER_FORMULAS.bb9.intercept + PITCHER_FORMULAS.bb9.slope * 50;
  const avgHr9 = PITCHER_FORMULAS.hr9.intercept + PITCHER_FORMULAS.hr9.slope * 50;

  console.log(`  Average rates (rating 50): K/9=${avgK9.toFixed(2)}, BB/9=${avgBb9.toFixed(2)}, HR/9=${avgHr9.toFixed(2)}`);
  console.log(`  Ceiling boost factor: ${CEILING_BOOST}`);

  const ceilingK9 = blendedK9 + (blendedK9 - avgK9) * CEILING_BOOST;
  const ceilingBb9 = blendedBb9 + (blendedBb9 - avgBb9) * CEILING_BOOST;
  const ceilingHr9 = blendedHr9 + (blendedHr9 - avgHr9) * CEILING_BOOST;

  console.log(`\n  Ceiling-boosted rates:`);
  console.log(`    K/9:  ${blendedK9.toFixed(2)} + (${blendedK9.toFixed(2)} - ${avgK9.toFixed(2)}) × ${CEILING_BOOST} = ${ceilingK9.toFixed(2)}`);
  console.log(`    BB/9: ${blendedBb9.toFixed(2)} + (${blendedBb9.toFixed(2)} - ${avgBb9.toFixed(2)}) × ${CEILING_BOOST} = ${ceilingBb9.toFixed(2)}`);
  console.log(`    HR/9: ${blendedHr9.toFixed(2)} + (${blendedHr9.toFixed(2)} - ${avgHr9.toFixed(2)}) × ${CEILING_BOOST} = ${ceilingHr9.toFixed(2)}`);

  // --- STEP 7: Projected FIP ---
  console.log('\n--- STEP 7: Calculate Projected FIP ---\n');
  const projFip = calculateFip(ceilingK9, ceilingBb9, ceilingHr9);
  console.log(`  Projected FIP (ceiling-boosted) = ${projFip.toFixed(2)}`);

  // --- STEP 8: MLB FIP Distribution & TFR ---
  console.log('\n--- STEP 8: Final TFR (MLB FIP Distribution) ---\n');

  const dobMap = loadDOBMap();
  const pitcherMlbDist = buildMLBPitcherDistributions(dobMap);
  console.log(`  Built distributions from ${pitcherMlbDist.count} peak-age MLB pitchers`);

  const fipPercentile = findValuePercentileInMLB(projFip, pitcherMlbDist.fipValues, false);
  const tfrRating = percentileToRating(fipPercentile, true);

  console.log(`\n  MLB FIP Distribution: ${pitcherMlbDist.fipValues.length} peak-age pitchers (ages 25-29, 50+ IP, 2015-2020)`);
  console.log(`    Min=${pitcherMlbDist.fipValues[0]?.toFixed(2)}, Median=${pitcherMlbDist.fipValues[Math.floor(pitcherMlbDist.fipValues.length / 2)]?.toFixed(2)}, Max=${pitcherMlbDist.fipValues[pitcherMlbDist.fipValues.length - 1]?.toFixed(2)}`);
  console.log(`\n  FIP Percentile: ${fipPercentile.toFixed(1)} (vs MLB peak-age pitchers)`);
  console.log(`  True Future Rating: ${tfrRating.toFixed(1)} stars`);

  // --- STEP 9: IP Projection ---
  console.log('\n--- STEP 9: Projected IP ---\n');

  const stamina = scouting.stamina ?? 50;
  const injury = scouting.injury ?? 'Normal';

  console.log(`  Stamina: ${stamina}`);
  console.log(`  Injury:  ${injury}`);

  const usablePitchCount = Object.values(pitches).filter(v => v >= 25).length;
  const isSp = stamina >= 35 && usablePitchCount >= 3;
  console.log(`\n  Usable pitches (≥25 rating): ${usablePitchCount}`);
  console.log(`  Role classification: ${isSp ? 'STARTER' : 'RELIEVER'} (need stamina≥35 AND 3+ pitches≥25)`);

  let baseIp: number;
  if (isSp) {
    baseIp = 30 + (stamina * 3.0);
    console.log(`\n  9a. SP Base IP = 30 + (${stamina} × 3.0) = ${baseIp.toFixed(0)}`);
  } else {
    baseIp = 50 + (stamina * 0.5);
    console.log(`\n  9a. RP Base IP = 50 + (${stamina} × 0.5) = ${baseIp.toFixed(0)}`);
  }

  let injuryFactor = 1.0;
  switch (injury) {
    case 'Iron Man': case 'Ironman': injuryFactor = 1.15; break;
    case 'Durable': injuryFactor = 1.10; break;
    case 'Normal': injuryFactor = 1.0; break;
    case 'Fragile': injuryFactor = 0.90; break;
    case 'Wrecked': injuryFactor = 0.75; break;
  }
  baseIp *= injuryFactor;
  console.log(`  9b. Injury modifier: ${injury} → ×${injuryFactor.toFixed(2)} → ${baseIp.toFixed(0)}`);

  let skillMod = 1.0;
  if (projFip <= 3.50) skillMod = 1.20;
  else if (projFip <= 4.00) skillMod = 1.10;
  else if (projFip <= 4.50) skillMod = 1.0;
  else if (projFip <= 5.00) skillMod = 0.90;
  else skillMod = 0.80;
  baseIp *= skillMod;
  console.log(`  9c. Skill modifier: FIP ${projFip.toFixed(2)} → ×${skillMod.toFixed(2)} → ${baseIp.toFixed(0)}`);

  const mlbIpHistory: { year: number; ip: number; gs: number }[] = [];
  for (let y = baseYear; y >= baseYear - 5; y--) {
    const mlbStats = loadMLBPitchingStats(playerId, y);
    if (mlbStats && mlbStats.ip > 0) {
      mlbIpHistory.push({ year: y, ip: mlbStats.ip, gs: mlbStats.gs });
    }
  }
  mlbIpHistory.sort((a, b) => b.year - a.year);

  if (mlbIpHistory.length > 0) {
    const minIpThreshold = isSp ? 50 : 10;
    const completedSeasons = mlbIpHistory.filter(s => s.ip >= minIpThreshold);
    console.log(`  9d. Historical IP blend:`);
    console.log(`      All MLB seasons: ${mlbIpHistory.map(s => `${s.year}=${Math.round(s.ip)}IP`).join(', ')}`);
    console.log(`      Completed seasons (≥${minIpThreshold} IP): ${completedSeasons.map(s => `${s.year}=${Math.round(s.ip)}IP`).join(', ')}`);

    if (completedSeasons.length > 0) {
      const weights = [5, 3, 2];
      let totalWeightedIpCalc = 0;
      let totalWeight = 0;
      for (let i = 0; i < Math.min(completedSeasons.length, 3); i++) {
        totalWeightedIpCalc += completedSeasons[i].ip * weights[i];
        totalWeight += weights[i];
      }
      const weightedIp = totalWeightedIpCalc / totalWeight;
      console.log(`      Weighted avg (5/3/2): ${weightedIp.toFixed(1)} IP`);

      const modelIp = baseIp;
      baseIp = (baseIp * 0.35) + (weightedIp * 0.65);
      console.log(`      Blend: 35% model (${modelIp.toFixed(0)}) + 65% history (${weightedIp.toFixed(0)}) = ${baseIp.toFixed(0)}`);
    }
  } else {
    console.log(`  9d. Historical IP blend: No MLB history found (pure model projection)`);
  }

  let eliteBoost = 1.0;
  if (projFip < 3.0) eliteBoost = 1.08;
  else if (projFip < 3.5) eliteBoost = 1.08 - ((projFip - 3.0) / 0.5) * 0.05;
  else if (projFip < 4.0) eliteBoost = 1.03 - ((projFip - 3.5) / 0.5) * 0.03;
  if (eliteBoost > 1.0) {
    baseIp *= eliteBoost;
    console.log(`  9e. Elite FIP boost: ×${eliteBoost.toFixed(2)} → ${baseIp.toFixed(0)}`);
  } else {
    console.log(`  9e. Elite FIP boost: none (FIP ≥ 4.0)`);
  }

  let projectedIp: number;
  if (isSp) {
    projectedIp = Math.round(Math.max(120, Math.min(260, baseIp)));
    console.log(`  Clamped (120-260): ${projectedIp} IP`);
  } else {
    projectedIp = Math.round(Math.max(40, Math.min(80, baseIp)));
    console.log(`  Clamped (40-80): ${projectedIp} IP`);
  }

  console.log(`\n  ► Projected IP: ${projectedIp}`);

  const replacementFip = 5.20;
  const runsPerWin = 8.50;
  const peakWar = ((replacementFip - projFip) / runsPerWin) * (projectedIp / 9);
  console.log(`\n  WAR = ((${replacementFip.toFixed(2)} - ${projFip.toFixed(2)}) / ${runsPerWin.toFixed(1)}) × (${projectedIp} / 9)`);
  console.log(`      = ${((replacementFip - projFip) / runsPerWin).toFixed(3)} × ${(projectedIp / 9).toFixed(1)}`);
  console.log(`      = ${peakWar.toFixed(1)} WAR`);

  // --- STEP 10: Development Curves ---
  console.log('\n--- STEP 10: Current True Rating (TR) via Development Curves ---\n');
  console.log('  TR represents current ability on the radar chart (blue solid line).');
  console.log('  TFR represents peak potential (green dashed line).');
  console.log('  TR is derived from data-driven development curves (135 MLB pitchers, 2012+ debuts).');
  console.log('  For each component: cohort selection -> expected MiLB stat at age -> dev fraction -> baseline TR.');
  console.log('  Individual adjustment: (actual raw - expected) / expected x shrinkage x sensitivity.\n');

  const trAge = calculateAge(dobMap.get(playerId), baseYear) ?? 22;
  console.log(`  Age: ${trAge}`);
  console.log(`  Total MiLB IP: ${totalRawIp.toFixed(1)}\n`);

  let rawK9 = 0, rawBb9 = 0, rawHr9 = 0;
  if (totalRawIp > 0) {
    let k9IpSum = 0, bb9IpSum = 0, hr9IpSum = 0;
    for (const s of allMinorStats) {
      const sk9 = (s.k / s.ip) * 9;
      const sbb9 = (s.bb / s.ip) * 9;
      const shr9 = (s.hra / s.ip) * 9;
      k9IpSum += sk9 * s.ip;
      bb9IpSum += sbb9 * s.ip;
      hr9IpSum += shr9 * s.ip;
    }
    rawK9 = k9IpSum / totalRawIp;
    rawBb9 = bb9IpSum / totalRawIp;
    rawHr9 = hr9IpSum / totalRawIp;
    console.log(`  Raw IP-weighted stats: K/9=${rawK9.toFixed(2)}, BB/9=${rawBb9.toFixed(2)}, HR/9=${rawHr9.toFixed(2)}`);
  }

  const tfrStuff = Math.round(20 + ((Math.max(3.0, Math.min(11.0, ceilingK9)) - 3.0) / 8.0) * 60);
  const tfrControl = Math.round(20 + ((7.0 - Math.max(0.85, Math.min(7.0, ceilingBb9))) / 6.15) * 60);
  const tfrHra = Math.round(20 + ((2.5 - Math.max(0.20, Math.min(2.5, ceilingHr9))) / 2.30) * 60);

  console.log(`\n  TFR Ratings (derived from ceiling-boosted rates): Stuff=${tfrStuff}, Control=${tfrControl}, HRA=${tfrHra}\n`);

  const pitcherComponents = [
    { name: 'Stuff',   key: 'stuff',   tfrVal: tfrStuff,   peakStat: ceilingK9,  rawStat: totalRawIp > 0 ? rawK9 : undefined,  lower: false },
    { name: 'Control', key: 'control', tfrVal: tfrControl, peakStat: ceilingBb9, rawStat: totalRawIp > 0 ? rawBb9 : undefined, lower: true },
    { name: 'HRA',     key: 'hra',     tfrVal: tfrHra,     peakStat: ceilingHr9, rawStat: totalRawIp > 0 ? rawHr9 : undefined, lower: true },
  ];

  console.log(`  ${'Component'.padEnd(10)} ${'Cohort'.padEnd(12)} ${'Expected'.padEnd(10)} ${'Actual Raw'.padEnd(12)} ${'DevFrac'.padEnd(8)} ${'Base'.padEnd(6)} ${'Adj'.padEnd(8)} ${'TFR'.padEnd(6)} Final TR  Gap`);
  console.log(`  ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(5)}`);

  const pitcherDevCurveDiag = getPitcherDevelopmentCurveDiagnosticsLocal(trAge, totalRawIp);

  for (const c of pitcherComponents) {
    const diag = pitcherDevCurveDiag(c.key, c.tfrVal, c.peakStat, c.rawStat, c.lower);
    const gap = c.tfrVal - diag.finalTR;
    const expectedStr = diag.expectedRaw !== undefined ? diag.expectedRaw.toFixed(2) : '—';
    const actualStr = c.rawStat !== undefined ? c.rawStat.toFixed(2) : '—';
    const adjStr = diag.ratingAdjust !== 0 ? (diag.ratingAdjust > 0 ? '+' : '') + diag.ratingAdjust.toFixed(1) : '0';
    console.log(`  ${c.name.padEnd(10)} ${diag.cohortLabel.padEnd(12)} ${expectedStr.padEnd(10)} ${actualStr.padEnd(12)} ${diag.devFraction.toFixed(2).padEnd(8)} ${String(diag.baseline).padEnd(6)} ${adjStr.padEnd(8)} ${String(c.tfrVal).padEnd(6)} ${String(diag.finalTR).padEnd(10)} +${gap}`);
  }

  console.log(`\n  Stabilization IP: Stuff=100, Control=150, HRA=200`);
  console.log(`  Sensitivity: ${TRACE_SENSITIVITY_POINTS} rating points per 100% deviation from expected curve value.`);

  // --- SUMMARY ---
  console.log('\n--- SUMMARY ---\n');
  console.log(`  Player ID: ${playerId}`);
  console.log(`\n  Scouting Ratings:`);
  console.log(`    Stuff: ${scouting.stuff}, Control: ${scouting.control}, HRA: ${scouting.hra}`);
  console.log(`    Stamina: ${stamina}, Injury: ${injury}`);
  if (pitchEntries.length > 0) {
    console.log(`    Pitches: ${pitchEntries.map(([k, v]) => `${k}=${v}`).join(', ')} (${usablePitchCount} usable)`);
  }
  console.log(`\n  Minor League Stats: ${totalRawIp.toFixed(1)} IP (${totalWeightedIp.toFixed(1)} weighted)`);
  console.log(`  Scouting Weight: ${(scoutingWeight * 100).toFixed(0)}%`);
  console.log(`\n  Projected Peak Rates (TFR, ceiling-boosted):`);
  console.log(`    K/9: ${ceilingK9.toFixed(2)} (TFR Stuff: ${tfrStuff})`);
  console.log(`    BB/9: ${ceilingBb9.toFixed(2)} (TFR Control: ${tfrControl})`);
  console.log(`    HR/9: ${ceilingHr9.toFixed(2)} (TFR HRA: ${tfrHra})`);
  console.log(`\n  Current TR (Development Curves):`);
  for (const c of pitcherComponents) {
    const diag = pitcherDevCurveDiag(c.key, c.tfrVal, c.peakStat, c.rawStat, c.lower);
    console.log(`    ${c.name}: ${diag.finalTR} (TFR: ${c.tfrVal}, gap: +${c.tfrVal - diag.finalTR})`);
  }
  console.log(`\n  Projected Peak FIP: ${projFip.toFixed(2)} (ceiling-boosted)`);
  console.log(`  Role: ${isSp ? 'SP' : 'RP'}`);
  console.log(`  Projected Peak IP: ${projectedIp}`);
  console.log(`  Projected Peak WAR: ${peakWar.toFixed(1)}`);
  console.log(`  TFR: ${tfrRating.toFixed(1)} stars (${fipPercentile.toFixed(1)}th percentile vs MLB peak-age FIP)`);
}

function traceBatterTFR(
  playerId: number,
  baseYear: number,
  scouting: BatterScouting
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`BATTER TRUE FUTURE RATING (TFR) TRACE: Player ID ${playerId}`);
  console.log('='.repeat(80));

  console.log('\n--- STEP 1: Scouting Ratings ---\n');
  console.log(`  Power:   ${scouting.power}`);
  console.log(`  Eye:     ${scouting.eye}`);
  console.log(`  AvoidK:  ${scouting.avoidK}`);
  console.log(`  Contact: ${scouting.contact}`);
  console.log(`  Gap:     ${scouting.gap}`);
  console.log(`  Speed:   ${scouting.speed}`);

  const scoutBbPct = BATTER_FORMULAS.eye.intercept + BATTER_FORMULAS.eye.slope * scouting.eye;
  const scoutKPct = BATTER_FORMULAS.avoidK.intercept + BATTER_FORMULAS.avoidK.slope * scouting.avoidK;
  const scoutHrPct = scouting.power <= 50
    ? BATTER_FORMULAS.power.low.intercept + BATTER_FORMULAS.power.low.slope * scouting.power
    : BATTER_FORMULAS.power.high.intercept + BATTER_FORMULAS.power.high.slope * scouting.power;
  const scoutAvg = BATTER_FORMULAS.contact.intercept + BATTER_FORMULAS.contact.slope * scouting.contact;

  // Calculate doubles and triples rates from Gap and Speed
  const scoutDoublesRate = expectedDoublesRate(scouting.gap);
  const scoutTriplesRate = expectedTriplesRate(scouting.speed);
  const speed200 = convertSpeed2080To20200(scouting.speed);

  console.log(`\n  Scouting Expected Rates:`);
  console.log(`    BB%: ${scoutBbPct.toFixed(2)}%`);
  console.log(`    K%: ${scoutKPct.toFixed(2)}%`);
  console.log(`    HR%: ${scoutHrPct.toFixed(3)}%`);
  console.log(`    AVG: ${scoutAvg.toFixed(3)}`);
  console.log(`    2B/AB: ${scoutDoublesRate.toFixed(4)} (${(scoutDoublesRate * 600).toFixed(1)} per 600 AB)`);
  console.log(`    3B/AB: ${scoutTriplesRate.toFixed(4)} (${(scoutTriplesRate * 600).toFixed(1)} per 600 AB) [Speed ${scouting.speed}→${speed200.toFixed(0)} on 200 scale]`);

  console.log('\n--- STEP 2: Minor League Stats ---\n');
  const allMinorStats: MinorLeagueBattingStats[] = [];
  for (let y = baseYear; y >= baseYear - 3; y--) {
    const stats = loadMinorLeagueBattingStats(playerId, y);
    allMinorStats.push(...stats);
  }

  if (allMinorStats.length === 0) {
    console.log('  No minor league batting stats found.');
    console.log('  Using 100% scouting weight for all components.');
  } else {
    for (const s of allMinorStats) {
      const bbPct = (s.bb / s.pa) * 100;
      const kPct = (s.k / s.pa) * 100;
      const hrPct = (s.hr / s.pa) * 100;
      const avg = s.ab > 0 ? s.h / s.ab : 0;
      console.log(`  ${s.year} ${s.level.toUpperCase()}: ${s.pa} PA, BB%=${bbPct.toFixed(1)}, K%=${kPct.toFixed(1)}, HR%=${hrPct.toFixed(2)}, AVG=${avg.toFixed(3)}`);
    }
  }

  console.log('\n--- STEP 3: Calculate Level-Weighted PA ---\n');
  let totalWeightedPa = 0;
  let totalRawPa = 0;
  for (const s of allMinorStats) {
    const levelWeight = LEVEL_WEIGHTS[s.level as keyof typeof LEVEL_WEIGHTS] || 0.2;
    const weightedPa = s.pa * levelWeight;
    totalWeightedPa += weightedPa;
    totalRawPa += s.pa;
    console.log(`  ${s.level.toUpperCase()}: ${s.pa} PA × ${levelWeight} = ${weightedPa.toFixed(0)} weighted PA`);
  }
  console.log(`\n  Total Raw PA: ${totalRawPa}`);
  console.log(`  Total Weighted PA: ${totalWeightedPa.toFixed(0)}`);

  console.log('\n--- STEP 4: Ceiling Boost (100% Scouting) ---\n');
  console.log(`  TFR uses 100% scouting potential ratings with ceiling boost.`);
  console.log(`  MiLB stats affect TR (development curves), not TFR (ceiling projection).`);

  const CEILING_BOOST_FACTOR = 0.35;
  const avgRates = scoutingToExpectedRates({ eye: 50, avoidK: 50, power: 50, contact: 50, gap: 50, speed: 50 } as BatterScouting);

  console.log(`\n  Anchor rates (rating 50 average):`);
  console.log(`    BB%: ${avgRates.bbPct.toFixed(2)}%, K%: ${avgRates.kPct.toFixed(2)}%, HR%: ${avgRates.hrPct.toFixed(3)}%, AVG: ${avgRates.avg.toFixed(3)}`);

  const blendedBbPct = scoutBbPct + (scoutBbPct - avgRates.bbPct) * CEILING_BOOST_FACTOR;
  const blendedKPct = scoutKPct + (scoutKPct - avgRates.kPct) * CEILING_BOOST_FACTOR;
  const blendedHrPct = scoutHrPct + (scoutHrPct - avgRates.hrPct) * CEILING_BOOST_FACTOR;
  const blendedAvg = scoutAvg + (scoutAvg - avgRates.avg) * CEILING_BOOST_FACTOR;

  console.log(`\n  Ceiling boost (factor = ${CEILING_BOOST_FACTOR}):`);
  console.log(`    Eye (BB%):     ${scoutBbPct.toFixed(2)}% + (${scoutBbPct.toFixed(2)} - ${avgRates.bbPct.toFixed(2)}) × ${CEILING_BOOST_FACTOR} = ${blendedBbPct.toFixed(2)}%`);
  console.log(`    AvoidK (K%):   ${scoutKPct.toFixed(2)}% + (${scoutKPct.toFixed(2)} - ${avgRates.kPct.toFixed(2)}) × ${CEILING_BOOST_FACTOR} = ${blendedKPct.toFixed(2)}%`);
  console.log(`    Power (HR%):   ${scoutHrPct.toFixed(3)}% + (${scoutHrPct.toFixed(3)} - ${avgRates.hrPct.toFixed(3)}) × ${CEILING_BOOST_FACTOR} = ${blendedHrPct.toFixed(3)}%`);
  console.log(`    Contact (AVG): ${scoutAvg.toFixed(3)} + (${scoutAvg.toFixed(3)} - ${avgRates.avg.toFixed(3)}) × ${CEILING_BOOST_FACTOR} = ${blendedAvg.toFixed(3)}`);
  console.log(`    Gap (2B): 100% scouting = ${scoutDoublesRate.toFixed(4)}/AB (${(scoutDoublesRate * 600).toFixed(1)} per 600 AB)`);
  console.log(`    Speed (3B): 100% scouting = ${scoutTriplesRate.toFixed(4)}/AB (${(scoutTriplesRate * 600).toFixed(1)} per 600 AB)`);

  console.log('\n--- STEP 5: Calculate Projected wOBA ---\n');
  console.log(`  Using Gap=${scouting.gap} and Speed=${scouting.speed} for doubles/triples rates`);
  const projWoba = calculateWobaFromRatesService(blendedBbPct, blendedKPct, blendedHrPct, blendedAvg, scouting.gap, scouting.speed);
  console.log(`  Projected Peak wOBA = ${projWoba.toFixed(3)}`);

  console.log('\n--- SUMMARY ---\n');
  console.log(`  Player ID: ${playerId}`);
  console.log(`\n  Scouting Ratings:`);
  console.log(`    Power: ${scouting.power}, Eye: ${scouting.eye}, AvoidK: ${scouting.avoidK}, Contact: ${scouting.contact}`);
  console.log(`    Gap: ${scouting.gap}, Speed: ${scouting.speed}`);
  console.log(`\n  Projected Peak Rates (ceiling-boosted):`);
  console.log(`    BB%: ${blendedBbPct.toFixed(2)}%`);
  console.log(`    K%: ${blendedKPct.toFixed(1)}%`);
  console.log(`    HR%: ${blendedHrPct.toFixed(2)}%`);
  console.log(`    AVG: ${blendedAvg.toFixed(3)}`);
  console.log(`    2B/AB: ${scoutDoublesRate.toFixed(4)} (${(scoutDoublesRate * 600).toFixed(1)} per 600 AB)`);
  console.log(`    3B/AB: ${scoutTriplesRate.toFixed(4)} (${(scoutTriplesRate * 600).toFixed(1)} per 600 AB)`);
  console.log(`\n  Projected Peak wOBA: ${projWoba.toFixed(3)}`);

  // --- Stats-Based Current TR (simplified) ---
  console.log('\n--- STEP 6: Current True Rating (TR) — Stats-Based Estimate ---\n');
  console.log('  TR (radar chart blue line) derived from adjusted MiLB stats → 20-80 scale.');
  console.log('  Capped by age-based development factor to ensure TR ≤ TFR.\n');

  const trAge = 22; // fallback — full mode uses actual age from player DB
  // In simple mode we don't have TFR true ratings, so show stats conversion only
  const statsEye = Math.round(20 + ((Math.max(3, Math.min(16, blendedBbPct)) - 3) / 13) * 60);
  const statsAvoidK = Math.round(20 + ((35 - Math.max(8, Math.min(35, adjustedKPct))) / 27) * 60);
  const statsPower = Math.round(20 + ((Math.max(0.5, Math.min(6, adjustedHrPct)) - 0.5) / 5.5) * 60);
  const statsContact = Math.round(20 + ((Math.max(0.200, Math.min(0.340, blendedAvg)) - 0.200) / 0.140) * 60);

  console.log(`  Stats → TR conversion (linear interpolation within MLB ranges):`);
  console.log(`    Eye:     BB% ${blendedBbPct.toFixed(2)}%  (range 3-16%)    → ${statsEye}`);
  console.log(`    AvoidK:  K%  ${adjustedKPct.toFixed(2)}%  (range 35-8% inv) → ${statsAvoidK}`);
  console.log(`    Power:   HR% ${adjustedHrPct.toFixed(3)}%  (range 0.5-6%)   → ${statsPower}`);
  console.log(`    Contact: AVG ${blendedAvg.toFixed(3)}   (range .200-.340)  → ${statsContact}`);
  console.log(`    Gap:     (no stats) → uses development-discounted TFR`);
  console.log(`    Speed:   (no stats) → uses development-discounted TFR`);
  console.log(`\n  Note: These are UNCAPPED stats-based values. The modal applies a`);
  console.log(`  development cap: min(statsTR, 50 + (TFR - 50) × devFactor).`);
  console.log(`  Run with --full to see the complete TR vs TFR comparison table.`);

  console.log('\n--- NOTE: Modal vs Tool Difference ---\n');
  console.log(`  This tool shows SCOUTING-BASED rates (from coefficient formulas).`);
  console.log(`  The modal shows PERCENTILE-MAPPED rates which are different:`);
  console.log(`    1. Modal ranks this player against ALL prospects by each component`);
  console.log(`    2. Converts rank to percentile (e.g., 85th percentile for Eye)`);
  console.log(`    3. Maps percentile to MLB peak-age distribution (2015-2020, ages 25-29)`);
  console.log(`    4. True Ratings = 20 + (percentile × 0.6) on 20-80 scale`);
  console.log(`  Run with --full to see modal-equivalent values and TR derivation table.`);
}

// ============================================================================
// Helper Functions for Regression
// ============================================================================

function calculateTargetOffset(estimatedFip: number): number {
  const breakpoints = [
    { fip: 2.5, offset: -3.0 },
    { fip: 3.0, offset: -2.8 },
    { fip: 3.5, offset: -2.0 },
    { fip: 4.0, offset: -0.8 },
    { fip: 4.2, offset: 0.0 },
    { fip: 4.5, offset: 1.0 },
    { fip: 5.0, offset: 1.5 },
    { fip: 6.0, offset: 1.5 },
  ];

  if (estimatedFip <= breakpoints[0].fip) return breakpoints[0].offset;
  if (estimatedFip >= breakpoints[breakpoints.length - 1].fip) return breakpoints[breakpoints.length - 1].offset;

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const lower = breakpoints[i];
    const upper = breakpoints[i + 1];
    if (estimatedFip >= lower.fip && estimatedFip <= upper.fip) {
      const t = (estimatedFip - lower.fip) / (upper.fip - lower.fip);
      return lower.offset + t * (upper.offset - lower.offset);
    }
  }
  return 0.0;
}

function calculateStrengthMultiplier(estimatedFip: number): number {
  if (estimatedFip < 3.5) return 1.30;
  if (estimatedFip < 4.0) return 1.50;
  if (estimatedFip < 4.5) return 1.80;
  return 2.00;
}

/**
 * Calculate wOBA from rate stats using HR% directly (not ISO).
 * Uses Gap and Speed ratings for doubles/triples projections.
 *
 * @param bbPct BB% (per PA)
 * @param _kPct K% (per PA) - not directly used in wOBA but passed for signature consistency
 * @param hrPct HR% (per PA)
 * @param avg Batting average (H/AB)
 * @param gap Gap rating (20-80) for doubles projection
 * @param speed Speed rating (20-80) for triples projection
 */
function calculateWobaFromRates(
  bbPct: number,
  _kPct: number,
  hrPct: number,
  avg: number,
  gap: number = 50,
  speed: number = 50
): number {
  const bbRate = bbPct / 100;    // BB per PA
  const hrRate = hrPct / 100;    // HR per PA

  // Calculate AB rate (approximate: 1 - BB rate - HBP rate, assume ~1% HBP)
  const abRate = 1 - bbRate - 0.01;

  // Doubles and triples rates are per AB, convert to per PA
  const doublesPerAb = expectedDoublesRate(gap);
  const triplesPerAb = expectedTriplesRate(speed);
  const doubleRate = doublesPerAb * abRate;  // Convert to per PA
  const tripleRate = triplesPerAb * abRate;  // Convert to per PA

  // Hit rate per PA = AVG * AB_rate
  const hitRate = avg * abRate;

  // HR per PA (already have this)
  // Singles = Hits - HR - 2B - 3B (all per PA)
  const hrPerPa = hrRate;
  const singleRate = Math.max(0, hitRate - hrPerPa - doubleRate - tripleRate);

  return Math.max(0.200, Math.min(0.500,
    WOBA_WEIGHTS.bb * bbRate +
    WOBA_WEIGHTS.single * singleRate +
    WOBA_WEIGHTS.double * doubleRate +
    WOBA_WEIGHTS.triple * tripleRate +
    WOBA_WEIGHTS.hr * hrPerPa
  ));
}

function calculateWobaTargetOffset(estimatedWoba: number): number {
  const breakpoints = [
    { woba: 0.400, offset: -0.040 },
    { woba: 0.380, offset: -0.030 },
    { woba: 0.360, offset: -0.020 },
    { woba: 0.340, offset: -0.010 },
    { woba: 0.320, offset: 0.000 },
    { woba: 0.300, offset: 0.010 },
    { woba: 0.280, offset: 0.020 },
    { woba: 0.260, offset: 0.025 },
  ];

  if (estimatedWoba >= breakpoints[0].woba) return breakpoints[0].offset;
  if (estimatedWoba <= breakpoints[breakpoints.length - 1].woba) return breakpoints[breakpoints.length - 1].offset;

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const upper = breakpoints[i];
    const lower = breakpoints[i + 1];
    if (estimatedWoba <= upper.woba && estimatedWoba >= lower.woba) {
      const t = (estimatedWoba - lower.woba) / (upper.woba - lower.woba);
      return lower.offset + t * (upper.offset - lower.offset);
    }
  }
  return 0.0;
}

function calculateWobaStrengthMultiplier(estimatedWoba: number): number {
  const breakpoints = [
    { woba: 0.400, multiplier: 0.6 },
    { woba: 0.360, multiplier: 0.8 },
    { woba: 0.320, multiplier: 1.0 },
    { woba: 0.280, multiplier: 1.2 },
    { woba: 0.260, multiplier: 0.8 },
  ];

  if (estimatedWoba >= breakpoints[0].woba) return breakpoints[0].multiplier;
  if (estimatedWoba <= breakpoints[breakpoints.length - 1].woba) return breakpoints[breakpoints.length - 1].multiplier;

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const upper = breakpoints[i];
    const lower = breakpoints[i + 1];
    if (estimatedWoba <= upper.woba && estimatedWoba >= lower.woba) {
      const t = (estimatedWoba - lower.woba) / (upper.woba - lower.woba);
      return lower.multiplier + t * (upper.multiplier - lower.multiplier);
    }
  }
  return 1.0;
}

// ============================================================================
// Full TFR Mode - Bulk Data Loading
// ============================================================================

interface AllBatterScoutingEntry {
  playerId: number;
  name: string;
  scouting: BatterScouting;
}

/**
 * Load ALL batter scouting data from the scouting CSV.
 */
function loadAllBatterScouting(source: 'my' | 'osa'): AllBatterScoutingEntry[] {
  const filePath = findLatestHitterScoutingFile(source);
  if (!filePath || !fs.existsSync(filePath)) return [];

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const { headers, rows } = parseCSV(csvText);

  const indices = {
    id: headers.indexOf('ID'),
    name: headers.indexOf('Name'),
    power: headers.indexOf('POW P'),
    eye: headers.indexOf('EYE P'),
    avoidK: headers.indexOf('K P'),
    contact: headers.indexOf('CON P'),
    gap: headers.indexOf('GAP P'),
    speed: headers.indexOf('SPE'),
    injury: headers.indexOf('Prone'),
    sr: headers.indexOf('SR'),
    ste: headers.indexOf('STE'),
  };

  const results: AllBatterScoutingEntry[] = [];
  for (const row of rows) {
    const playerId = parseInt(row[indices.id]);
    if (isNaN(playerId)) continue;

    results.push({
      playerId,
      name: row[indices.name] || `Player ${playerId}`,
      scouting: {
        power: parseInt(row[indices.power]) || 50,
        eye: parseInt(row[indices.eye]) || 50,
        avoidK: parseInt(row[indices.avoidK]) || 50,
        contact: parseInt(row[indices.contact]) || 50,
        gap: parseInt(row[indices.gap]) || 50,
        speed: parseInt(row[indices.speed]) || 50,
        injury: indices.injury >= 0 ? (row[indices.injury]?.trim() || 'Normal') : 'Normal',
        sr: indices.sr >= 0 ? parseInt(row[indices.sr]) || undefined : undefined,
        ste: indices.ste >= 0 ? parseInt(row[indices.ste]) || undefined : undefined,
      },
    });
  }
  return results;
}

/**
 * Load minor league batting stats for ALL players across all levels for a range of years.
 * Returns Map<playerId, MinorLeagueBattingStats[]>.
 */
function loadAllMinorLeagueBattingStats(startYear: number, endYear: number): Map<number, MinorLeagueBattingStats[]> {
  const levels = ['aaa', 'aa', 'a', 'r'];
  const result = new Map<number, MinorLeagueBattingStats[]>();

  for (let year = startYear; year <= endYear; year++) {
    for (const level of levels) {
      const filePath = path.join(DATA_DIR, 'minors_batting', `${year}_${level}_batting.csv`);
      if (!fs.existsSync(filePath)) continue;

      const csvText = fs.readFileSync(filePath, 'utf-8');
      const { headers, rows } = parseCSV(csvText);

      const indices = {
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
      };

      for (const row of rows) {
        const splitId = parseInt(row[indices.split_id]);
        if (splitId !== 1) continue;

        const playerId = parseInt(row[indices.player_id]);
        const pa = parseInt(row[indices.pa]) || 0;
        if (isNaN(playerId) || pa <= 0) continue;

        const stat: MinorLeagueBattingStats = {
          year,
          level,
          pa,
          ab: parseInt(row[indices.ab]) || 0,
          h: parseInt(row[indices.h]) || 0,
          d: parseInt(row[indices.d]) || 0,
          t: parseInt(row[indices.t]) || 0,
          hr: parseInt(row[indices.hr]) || 0,
          bb: parseInt(row[indices.bb]) || 0,
          k: parseInt(row[indices.k]) || 0,
        };

        if (!result.has(playerId)) {
          result.set(playerId, []);
        }
        result.get(playerId)!.push(stat);
      }
    }
  }
  return result;
}

/**
 * Load career MLB AB for all players up to the given year.
 * Returns Map<playerId, totalCareerAB>.
 */
function loadCareerMLBAb(upToYear: number): Map<number, number> {
  const startYear = Math.max(2000, upToYear - 10);
  const result = new Map<number, number>();

  for (let year = startYear; year <= upToYear; year++) {
    const filePath = path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`);
    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(csvText);

    const playerIdIdx = headers.indexOf('player_id');
    const splitIdIdx = headers.indexOf('split_id');
    const abIdx = headers.indexOf('ab');

    for (const row of rows) {
      if (parseInt(row[splitIdIdx]) !== 1) continue;
      const playerId = parseInt(row[playerIdIdx]);
      const ab = parseInt(row[abIdx]) || 0;
      if (isNaN(playerId)) continue;

      result.set(playerId, (result.get(playerId) || 0) + ab);
    }
  }
  return result;
}

function loadCareerMLBStats(upToYear: number): Map<number, { ab: number; pa: number; h: number; bb: number; k: number; hr: number }> {
  const startYear = Math.max(2000, upToYear - 10);
  const result = new Map<number, { ab: number; pa: number; h: number; bb: number; k: number; hr: number }>();

  for (let year = startYear; year <= upToYear; year++) {
    const filePath = path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`);
    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(csvText);

    const playerIdIdx = headers.indexOf('player_id');
    const splitIdIdx = headers.indexOf('split_id');
    const abIdx = headers.indexOf('ab');
    const paIdx = headers.indexOf('pa');
    const hIdx = headers.indexOf('h');
    const bbIdx = headers.indexOf('bb');
    const kIdx = headers.indexOf('k');
    const hrIdx = headers.indexOf('hr');

    for (const row of rows) {
      if (parseInt(row[splitIdIdx]) !== 1) continue;
      const playerId = parseInt(row[playerIdIdx]);
      if (isNaN(playerId)) continue;

      const current = result.get(playerId) ?? { ab: 0, pa: 0, h: 0, bb: 0, k: 0, hr: 0 };
      current.ab += parseInt(row[abIdx]) || 0;
      current.pa += parseInt(row[paIdx]) || 0;
      current.h += parseInt(row[hIdx]) || 0;
      current.bb += parseInt(row[bbIdx]) || 0;
      current.k += parseInt(row[kIdx]) || 0;
      current.hr += parseInt(row[hrIdx]) || 0;
      result.set(playerId, current);
    }
  }
  return result;
}

/**
 * Load player DOB map from mlb_dob.csv.
 * Returns Map<playerId, Date>.
 */
function loadDOBMap(): Map<number, Date> {
  const dobMap = new Map<number, Date>();

  // Load MLB DOB
  const mlbDobPath = path.join(DATA_DIR, 'mlb_dob.csv');
  if (fs.existsSync(mlbDobPath)) {
    const csvText = fs.readFileSync(mlbDobPath, 'utf-8');
    const lines = csvText.trim().split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const [idStr, dobStr] = lines[i].split(',');
      const playerId = parseInt(idStr, 10);
      if (!playerId || !dobStr) continue;
      const [month, day, year] = dobStr.split('/').map(s => parseInt(s, 10));
      if (!month || !day || !year) continue;
      dobMap.set(playerId, new Date(year, month - 1, day));
    }
  }

  // Also load minor league DOBs
  for (const level of ['a', 'aa', 'aaa', 'rookie']) {
    const dobPath = path.join(DATA_DIR, `${level}_dob.csv`);
    if (!fs.existsSync(dobPath)) continue;
    const csvText = fs.readFileSync(dobPath, 'utf-8');
    const lines = csvText.trim().split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const [idStr, dobStr] = lines[i].split(',');
      const playerId = parseInt(idStr, 10);
      if (!playerId || !dobStr || dobMap.has(playerId)) continue;
      const [month, day, year] = dobStr.split('/').map(s => parseInt(s, 10));
      if (!month || !day || !year) continue;
      dobMap.set(playerId, new Date(year, month - 1, day));
    }
  }

  return dobMap;
}

/**
 * Calculate age at the start of a season (April 1st).
 */
function calculateAge(dob: Date | undefined, season: number): number | null {
  if (!dob) return null;
  const seasonStart = new Date(season, 3, 1); // April 1st
  const ageMs = seasonStart.getTime() - dob.getTime();
  return Math.floor(ageMs / (1000 * 60 * 60 * 24 * 365.25));
}

interface MLBDistributions {
  bbPctValues: number[];
  kPctValues: number[];
  hrPctValues: number[];
  avgValues: number[];
  warValues: number[];
  count: number;
}

/**
 * Build MLB peak-age distributions from 2015-2020 batting data.
 * Filters: ages 25-29, 300+ PA, reasonable rate ranges.
 * Returns sorted arrays for percentile mapping.
 */
function buildMLBDistributions(dobMap: Map<number, Date>): MLBDistributions {
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const allBbPct: number[] = [];
  const allKPct: number[] = [];
  const allHrPct: number[] = [];
  const allAvg: number[] = [];
  const allWar: number[] = [];

  // WAR constants (same as used for prospects)
  const lgWoba = 0.315;
  const wobaScale = 1.15;
  const runsPerWin = 10;
  const replacementRuns = 20;

  for (const year of years) {
    const filePath = path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`);
    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(csvText);

    const indices = {
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
    };

    for (const row of rows) {
      if (parseInt(row[indices.split_id]) !== 1) continue;

      const playerId = parseInt(row[indices.player_id]);
      const pa = parseInt(row[indices.pa]) || 0;
      if (pa < 300) continue;

      const age = calculateAge(dobMap.get(playerId), year);
      if (!age || age < 25 || age > 29) continue;

      const ab = parseInt(row[indices.ab]) || 0;
      const h = parseInt(row[indices.h]) || 0;
      const d = parseInt(row[indices.d]) || 0;
      const t = parseInt(row[indices.t]) || 0;
      const hr = parseInt(row[indices.hr]) || 0;
      const bb = parseInt(row[indices.bb]) || 0;
      const k = parseInt(row[indices.k]) || 0;
      const sb = parseInt(row[indices.sb]) || 0;
      const cs = parseInt(row[indices.cs]) || 0;

      const bbPct = (bb / pa) * 100;
      const kPct = (k / pa) * 100;
      const hrPct = (hr / pa) * 100;
      const avg = ab > 0 ? h / ab : 0;

      // Validate rates are reasonable (same filters as service)
      if (bbPct >= 2 && bbPct <= 25 && kPct >= 5 && kPct <= 40 &&
          hrPct >= 0 && hrPct <= 10 && avg >= 0.150 && avg <= 0.400) {
        allBbPct.push(bbPct);
        allKPct.push(kPct);
        allHrPct.push(hrPct);
        allAvg.push(avg);

        // Compute WAR per 600 PA from actual stats
        const bbRate = bb / pa;
        const singleRate = Math.max(0, (h - d - t - hr)) / pa;
        const doubleRate = d / pa;
        const tripleRate = t / pa;
        const hrRate = hr / pa;

        const woba =
          WOBA_WEIGHTS.bb * bbRate +
          WOBA_WEIGHTS.single * singleRate +
          WOBA_WEIGHTS.double * doubleRate +
          WOBA_WEIGHTS.triple * tripleRate +
          WOBA_WEIGHTS.hr * hrRate;

        const wRAA = ((woba - lgWoba) / wobaScale) * 600;
        const sbRuns = (sb * 0.2 - cs * 0.4) * (600 / pa);
        const war = (wRAA + replacementRuns + sbRuns) / runsPerWin;
        allWar.push(Math.round(war * 10) / 10);
      }
    }
  }

  // Sort ascending for percentile lookup
  allBbPct.sort((a, b) => a - b);
  allKPct.sort((a, b) => a - b);
  allHrPct.sort((a, b) => a - b);
  allAvg.sort((a, b) => a - b);
  allWar.sort((a, b) => a - b);

  return {
    bbPctValues: allBbPct,
    kPctValues: allKPct,
    hrPctValues: allHrPct,
    avgValues: allAvg,
    warValues: allWar,
    count: allBbPct.length,
  };
}

interface MLBPitcherDistributions {
  k9Values: number[];
  bb9Values: number[];
  hr9Values: number[];
  fipValues: number[];
  count: number;
}

/**
 * Build MLB peak-age pitcher distributions from 2015-2020 pitching data.
 * Mirrors TrueFutureRatingService.buildMLBPercentileDistribution().
 */
function buildMLBPitcherDistributions(dobMap: Map<number, Date>): MLBPitcherDistributions {
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const allK9: number[] = [];
  const allBb9: number[] = [];
  const allHr9: number[] = [];
  const allFip: number[] = [];

  for (const year of years) {
    const filePath = path.join(DATA_DIR, 'mlb', `${year}.csv`);
    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(csvText);

    const indices = {
      player_id: headers.indexOf('player_id'),
      split_id: headers.indexOf('split_id'),
      ip: headers.indexOf('ip'),
      k: headers.indexOf('k'),
      bb: headers.indexOf('bb'),
      hra: headers.indexOf('hra'),
    };

    for (const row of rows) {
      if (parseInt(row[indices.split_id]) !== 1) continue;

      const playerId = parseInt(row[indices.player_id]);
      const ip = parseIp(row[indices.ip] || '0');
      if (ip < 50) continue;

      const age = calculateAge(dobMap.get(playerId), year);
      if (!age || age < 25 || age > 29) continue;

      const k = parseInt(row[indices.k]) || 0;
      const bb = parseInt(row[indices.bb]) || 0;
      const hra = parseInt(row[indices.hra]) || 0;

      const k9 = (k / ip) * 9;
      const bb9 = (bb / ip) * 9;
      const hr9 = (hra / ip) * 9;

      // Validate rates (same filters as service)
      if (k9 > 2 && k9 < 15 && bb9 >= 0.5 && bb9 < 8 && hr9 >= 0.2 && hr9 < 3) {
        allK9.push(k9);
        allBb9.push(bb9);
        allHr9.push(hr9);

        const fip = calculateFip(k9, bb9, hr9);
        allFip.push(Math.round(fip * 100) / 100);
      }
    }
  }

  allK9.sort((a, b) => a - b);
  allBb9.sort((a, b) => a - b);
  allHr9.sort((a, b) => a - b);
  allFip.sort((a, b) => a - b);

  return {
    k9Values: allK9,
    bb9Values: allBb9,
    hr9Values: allHr9,
    fipValues: allFip,
    count: allK9.length,
  };
}

// ============================================================================
// Full TFR Mode - Pipeline Functions (mirrors HitterTrueFutureRatingService)
// ============================================================================

/** Minor league year weights: [current year, previous year, older] */
const MINOR_YEAR_WEIGHTS = [5, 3];

/**
 * Calculate scouting-expected rates from scouting ratings.
 */
function scoutingToExpectedRates(scouting: BatterScouting) {
  const bbPct = BATTER_FORMULAS.eye.intercept + BATTER_FORMULAS.eye.slope * scouting.eye;
  const kPct = BATTER_FORMULAS.avoidK.intercept + BATTER_FORMULAS.avoidK.slope * scouting.avoidK;
  const hrPct = scouting.power <= 50
    ? BATTER_FORMULAS.power.low.intercept + BATTER_FORMULAS.power.low.slope * scouting.power
    : BATTER_FORMULAS.power.high.intercept + BATTER_FORMULAS.power.high.slope * scouting.power;
  const avg = BATTER_FORMULAS.contact.intercept + BATTER_FORMULAS.contact.slope * scouting.contact;
  return { bbPct, kPct, hrPct, avg };
}

interface ComponentBlendResult {
  playerId: number;
  name: string;
  eyeValue: number;      // Blended BB%
  avoidKValue: number;   // Blended K%
  powerValue: number;    // Blended HR%
  contactValue: number;  // Blended AVG
  gapValue: number;      // Scout Gap (20-80)
  speedValue: number;    // Scout Speed (20-80)
  totalPa: number;
  weightedPa: number;
  // Detailed rates for display
  scoutBbPct: number;
  scoutKPct: number;
  scoutHrPct: number;
  scoutAvg: number;
  adjustedBbPct: number;
  adjustedKPct: number;
  adjustedHrPct: number;
  adjustedAvg: number;
  rawBbPct?: number;
  rawKPct?: number;
  rawHrPct?: number;
  rawAvg?: number;
  age?: number;
}

/**
 * Calculate weighted average of minor league stats (mirrors service's calculateWeightedMinorStats).
 */
function calculateWeightedMinorStats(
  stats: MinorLeagueBattingStats[],
  currentYear: number
): { bbPct: number; kPct: number; hrPct: number; avg: number; rawBbPct: number; rawKPct: number; rawHrPct: number; rawAvg: number; totalPa: number; weightedPa: number } | null {
  if (stats.length === 0) return null;

  let weightedBbPctSum = 0, weightedKPctSum = 0, weightedHrPctSum = 0, weightedAvgSum = 0;
  let rawBbPctSum = 0, rawKPctSum = 0, rawHrPctSum = 0, rawAvgSum = 0;
  let totalWeight = 0, totalPa = 0, weightedPa = 0;

  for (const stat of stats) {
    if (stat.pa === 0) continue;

    const yearDiff = currentYear - stat.year;
    let yearWeight = 2;
    if (yearDiff === 0) yearWeight = MINOR_YEAR_WEIGHTS[0];
    else if (yearDiff === 1) yearWeight = MINOR_YEAR_WEIGHTS[1];

    const bbPct = (stat.bb / stat.pa) * 100;
    const kPct = (stat.k / stat.pa) * 100;
    const hrPct = (stat.hr / stat.pa) * 100;
    const avg = stat.ab > 0 ? stat.h / stat.ab : 0;

    // Apply level adjustments
    const levelAdj = BATTER_LEVEL_ADJUSTMENTS[stat.level as keyof typeof BATTER_LEVEL_ADJUSTMENTS];
    if (!levelAdj) continue;

    const adjBbPct = bbPct + levelAdj.bbPct;
    const adjKPct = kPct + levelAdj.kPct;
    const adjHrPct = hrPct + levelAdj.hrPct;
    const adjAvg = avg + levelAdj.avg;

    const weight = yearWeight * stat.pa;
    weightedBbPctSum += adjBbPct * weight;
    weightedKPctSum += adjKPct * weight;
    weightedHrPctSum += adjHrPct * weight;
    weightedAvgSum += adjAvg * weight;
    rawBbPctSum += bbPct * weight;
    rawKPctSum += kPct * weight;
    rawHrPctSum += hrPct * weight;
    rawAvgSum += avg * weight;
    totalWeight += weight;
    totalPa += stat.pa;

    const levelWeight = LEVEL_WEIGHTS[stat.level as keyof typeof LEVEL_WEIGHTS] || 0.2;
    weightedPa += stat.pa * levelWeight;
  }

  if (totalWeight === 0) return null;

  return {
    bbPct: weightedBbPctSum / totalWeight,
    kPct: weightedKPctSum / totalWeight,
    hrPct: weightedHrPctSum / totalWeight,
    avg: weightedAvgSum / totalWeight,
    rawBbPct: rawBbPctSum / totalWeight,
    rawKPct: rawKPctSum / totalWeight,
    rawHrPct: rawHrPctSum / totalWeight,
    rawAvg: rawAvgSum / totalWeight,
    totalPa,
    weightedPa,
  };
}

/**
 * Calculate component blend for a single prospect (mirrors service's calculateComponentBlend).
 */
function calculateComponentBlendLocal(
  playerId: number,
  name: string,
  scouting: BatterScouting,
  minorStats: MinorLeagueBattingStats[],
  baseYear: number
): ComponentBlendResult {
  const currentYear = minorStats.length > 0
    ? Math.max(...minorStats.map(s => s.year))
    : baseYear;

  const weightedStats = calculateWeightedMinorStats(minorStats, currentYear);
  const totalPa = weightedStats?.totalPa ?? 0;
  const weightedPa = weightedStats?.weightedPa ?? 0;

  // 100% scouting for TFR — MiLB stats only stored for display, not blended
  const scoutRates = scoutingToExpectedRates(scouting);

  // Ceiling boost: project peak outcomes above league average (rating 50)
  const CEILING_BOOST_FACTOR = 0.35;
  const avgRates = scoutingToExpectedRates({ eye: 50, avoidK: 50, power: 50, contact: 50, gap: 50, speed: 50 } as BatterScouting);

  const eyeValue = scoutRates.bbPct + (scoutRates.bbPct - avgRates.bbPct) * CEILING_BOOST_FACTOR;
  const avoidKValue = scoutRates.kPct + (scoutRates.kPct - avgRates.kPct) * CEILING_BOOST_FACTOR;
  const powerValue = scoutRates.hrPct + (scoutRates.hrPct - avgRates.hrPct) * CEILING_BOOST_FACTOR;
  const contactValue = scoutRates.avg + (scoutRates.avg - avgRates.avg) * CEILING_BOOST_FACTOR;
  const gapValue = scouting.gap;
  const speedValue = scouting.speed;

  // MiLB adjusted stats (for display only — used by development curves for TR, not TFR)
  let adjustedBbPct = scoutRates.bbPct;
  let adjustedKPct = scoutRates.kPct;
  let adjustedHrPct = scoutRates.hrPct;
  let adjustedAvg = scoutRates.avg;

  if (weightedStats) {
    adjustedBbPct = weightedStats.bbPct;
    adjustedKPct = weightedStats.kPct;
    adjustedHrPct = weightedStats.hrPct;
    adjustedAvg = weightedStats.avg;
  }

  return {
    playerId,
    name,
    eyeValue: Math.round(eyeValue * 100) / 100,
    avoidKValue: Math.round(avoidKValue * 100) / 100,
    powerValue: Math.round(powerValue * 100) / 100,
    contactValue: Math.round(contactValue * 1000) / 1000,
    gapValue,
    speedValue,
    totalPa,
    weightedPa,
    scoutBbPct: scoutRates.bbPct,
    scoutKPct: scoutRates.kPct,
    scoutHrPct: scoutRates.hrPct,
    scoutAvg: scoutRates.avg,
    adjustedBbPct,
    adjustedKPct,
    adjustedHrPct,
    adjustedAvg,
    rawBbPct: weightedStats ? Math.round(weightedStats.rawBbPct * 10) / 10 : undefined,
    rawKPct: weightedStats ? Math.round(weightedStats.rawKPct * 10) / 10 : undefined,
    rawHrPct: weightedStats ? Math.round(weightedStats.rawHrPct * 100) / 100 : undefined,
    rawAvg: weightedStats ? Math.round(weightedStats.rawAvg * 1000) / 1000 : undefined,
  };
}

interface ComponentPercentiles {
  eyePercentile: number;
  avoidKPercentile: number;
  powerPercentile: number;
  contactPercentile: number;
  gapPercentile: number;
  speedPercentile: number;
}

/**
 * Rank prospects by each component and assign percentiles (mirrors service's rankProspectsByComponent).
 */
function rankProspectsByComponentLocal(
  blendedResults: ComponentBlendResult[]
): Map<number, ComponentPercentiles> {
  const percentiles = new Map<number, ComponentPercentiles>();
  if (blendedResults.length === 0) return percentiles;

  const n = blendedResults.length;

  // Initialize all entries
  for (const r of blendedResults) {
    percentiles.set(r.playerId, { eyePercentile: 0, avoidKPercentile: 0, powerPercentile: 0, contactPercentile: 0, gapPercentile: 0, speedPercentile: 0 });
  }

  // Eye (BB% - higher is better): sort descending, rank 0 = best = highest percentile
  const eyeSorted = [...blendedResults].sort((a, b) => b.eyeValue - a.eyeValue);
  for (let i = 0; i < n; i++) {
    percentiles.get(eyeSorted[i].playerId)!.eyePercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
  }

  // AvoidK (K% - lower is better): sort ascending, rank 0 = best = highest percentile
  const avoidKSorted = [...blendedResults].sort((a, b) => a.avoidKValue - b.avoidKValue);
  for (let i = 0; i < n; i++) {
    percentiles.get(avoidKSorted[i].playerId)!.avoidKPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
  }

  // Power (HR% - higher is better)
  const powerSorted = [...blendedResults].sort((a, b) => b.powerValue - a.powerValue);
  for (let i = 0; i < n; i++) {
    percentiles.get(powerSorted[i].playerId)!.powerPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
  }

  // Contact (AVG - higher is better)
  const contactSorted = [...blendedResults].sort((a, b) => b.contactValue - a.contactValue);
  for (let i = 0; i < n; i++) {
    percentiles.get(contactSorted[i].playerId)!.contactPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
  }

  // Gap (20-80 - higher is better)
  const gapSorted = [...blendedResults].sort((a, b) => b.gapValue - a.gapValue);
  for (let i = 0; i < n; i++) {
    percentiles.get(gapSorted[i].playerId)!.gapPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
  }

  // Speed (20-80 - higher is better)
  const speedSorted = [...blendedResults].sort((a, b) => b.speedValue - a.speedValue);
  for (let i = 0; i < n; i++) {
    percentiles.get(speedSorted[i].playerId)!.speedPercentile = n > 1 ? ((n - i - 1) / (n - 1)) * 100 : 50;
  }

  return percentiles;
}

/**
 * Map a percentile to the corresponding MLB rate value using linear interpolation.
 * (Mirrors service's mapPercentileToMLBValue)
 */
function mapPercentileToMLBValueLocal(percentile: number, mlbValues: number[]): number {
  if (mlbValues.length === 0) return 0;

  const clamped = Math.max(0, Math.min(100, percentile));
  const position = (clamped / 100) * (mlbValues.length - 1);
  const lowerIdx = Math.floor(position);
  const upperIdx = Math.ceil(position);

  if (lowerIdx === upperIdx) return mlbValues[lowerIdx];

  const fraction = position - lowerIdx;
  return mlbValues[lowerIdx] + (mlbValues[upperIdx] - mlbValues[lowerIdx]) * fraction;
}

/**
 * Calculate wOBA from rates using the service's formula (to match modal output).
 * Key difference from the existing calculateWobaFromRates: uses (1 - bbRate) for AB rate.
 */
function calculateWobaFromRatesService(
  bbPct: number,
  _kPct: number,
  hrPct: number,
  avg: number,
  gap: number = 50,
  speed: number = 50
): number {
  const bbRate = bbPct / 100;
  const hrRate = hrPct / 100;

  const hitRate = avg * (1 - bbRate);
  const nonHrHitRate = Math.max(0, hitRate - hrRate);

  const rawDoublesRate = expectedDoublesRate(gap);
  const rawTriplesRate = expectedTriplesRate(speed);

  const doublesRatePA = rawDoublesRate * (1 - bbRate);
  const triplesRatePA = rawTriplesRate * (1 - bbRate);

  const totalXbhRate = doublesRatePA + triplesRatePA;
  let doubleRate = doublesRatePA;
  let tripleRate = triplesRatePA;

  if (totalXbhRate > nonHrHitRate) {
    const scale = nonHrHitRate / totalXbhRate;
    doubleRate = doublesRatePA * scale;
    tripleRate = triplesRatePA * scale;
  }

  const singleRate = Math.max(0, nonHrHitRate - doubleRate - tripleRate);

  const woba =
    WOBA_WEIGHTS.bb * bbRate +
    WOBA_WEIGHTS.single * singleRate +
    WOBA_WEIGHTS.double * doubleRate +
    WOBA_WEIGHTS.triple * tripleRate +
    WOBA_WEIGHTS.hr * hrRate;

  return Math.max(0.200, Math.min(0.500, woba));
}

/**
 * Project stolen bases from SR/STE ratings (mirrors HitterRatingEstimatorService.projectStolenBases).
 */
function projectStolenBases(sr: number, ste: number, pa: number): { sb: number; cs: number } {
  let attempts: number;
  if (sr <= 55) attempts = -2.300 + 0.155 * sr;
  else if (sr <= 70) attempts = -62.525 + 1.250 * sr;
  else attempts = -360.0 + 5.5 * sr;
  attempts = Math.max(0, attempts) * (pa / 600);
  const rate = Math.max(0.30, Math.min(0.98, 0.160 + 0.0096 * ste));
  return { sb: Math.round(attempts * rate), cs: Math.round(attempts * (1 - rate)) };
}

/**
 * Find where a value falls in a sorted MLB distribution.
 * Returns 0-100 percentile indicating what fraction of MLB hitters are at or below this value.
 * (Mirrors service's findValuePercentileInDistribution)
 */
function findValuePercentileInMLB(value: number, sortedValues: number[], higherIsBetter: boolean): number {
  if (sortedValues.length === 0) return 50;

  const n = sortedValues.length;

  // Binary search: find how many values are <= this value
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedValues[mid] <= value) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // lo = number of values <= value

  const fractionAtOrBelow = lo / n * 100;

  if (higherIsBetter) {
    return Math.max(0, Math.min(100, fractionAtOrBelow));
  } else {
    return Math.max(0, Math.min(100, 100 - fractionAtOrBelow));
  }
}

// ============================================================================
// Empirical PA Distribution by Injury
// ============================================================================

interface EmpiricalPaResult {
  projPa: number;
  percentile: number;
}

/** Injury tier → percentile in combined PA distribution */
const INJURY_TIER_PERCENTILES: Record<string, number> = {
  'Iron Man': 0.90,
  'Durable': 0.80,
  'Normal': 0.70,
  'Fragile': 0.50,
  'Wrecked': 0.25,
};

/**
 * Build empirical peak PA projections from MLB peak-age hitters (2015-2020, ages 25-29, 400+ PA).
 *
 * Pools ALL full seasons into one combined distribution, then maps each injury tier
 * to a fixed percentile. This avoids small-sample noise from per-category splits
 * and guarantees monotonic ordering (Iron Man > Durable > Normal > Fragile > Wrecked).
 */
function buildEmpiricalPaDistribution(
  dobMap: Map<number, Date>
): { tiers: Map<string, EmpiricalPaResult>; totalSeasons: number } {
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const allPa: number[] = [];

  for (const year of years) {
    const filePath = path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`);
    if (!fs.existsSync(filePath)) continue;

    const csvText = fs.readFileSync(filePath, 'utf-8');
    const { headers, rows } = parseCSV(csvText);

    const indices = {
      player_id: headers.indexOf('player_id'),
      split_id: headers.indexOf('split_id'),
      pa: headers.indexOf('pa'),
    };

    for (const row of rows) {
      if (parseInt(row[indices.split_id]) !== 1) continue;

      const playerId = parseInt(row[indices.player_id]);
      const pa = parseInt(row[indices.pa]) || 0;
      if (pa < 400) continue;

      const age = calculateAge(dobMap.get(playerId), year);
      if (!age || age < 25 || age > 29) continue;

      allPa.push(pa);
    }
  }

  const tiers = new Map<string, EmpiricalPaResult>();

  if (allPa.length === 0) {
    // Hardcoded fallback
    tiers.set('Iron Man', { projPa: 670, percentile: 0.90 });
    tiers.set('Durable', { projPa: 650, percentile: 0.80 });
    tiers.set('Normal', { projPa: 630, percentile: 0.70 });
    tiers.set('Fragile', { projPa: 600, percentile: 0.50 });
    tiers.set('Wrecked', { projPa: 550, percentile: 0.25 });
    return { tiers, totalSeasons: 0 };
  }

  allPa.sort((a, b) => a - b);

  for (const [tier, pctl] of Object.entries(INJURY_TIER_PERCENTILES)) {
    const idx = Math.min(Math.floor(allPa.length * pctl), allPa.length - 1);
    tiers.set(tier, { projPa: allPa[idx], percentile: pctl });
  }

  return { tiers, totalSeasons: allPa.length };
}

// ============================================================================
// Development Curve Constants (mirrored from ProspectDevelopmentCurveService)
// ============================================================================

interface TraceCohortCurve {
  label: string;
  cohortMin: number;
  cohortMax: number;
  points: Record<number, number>;
}

const TRACE_DEV_CURVES: Record<string, TraceCohortCurve[]> = {
  eye: [
    { label: '3-5%', cohortMin: 3, cohortMax: 5, points: { 18: 6.7, 19: 7.3, 20: 7.5, 21: 7.6, 22: 7.0, 23: 7.2, 24: 7.5, 25: 6.2, 26: 6.4 } },
    { label: '5-7%', cohortMin: 5, cohortMax: 7, points: { 18: 7.6, 19: 7.9, 20: 8.4, 21: 8.9, 22: 8.9, 23: 9.3, 24: 9.1, 25: 9.6, 26: 8.1 } },
    { label: '7-9%', cohortMin: 7, cohortMax: 9, points: { 18: 7.3, 19: 8.0, 20: 8.7, 21: 9.8, 22: 10.1, 23: 10.9, 24: 11.9, 25: 10.5, 26: 11.4 } },
    { label: '9-11%', cohortMin: 9, cohortMax: 11, points: { 19: 9.0, 20: 11.7, 21: 12.6, 22: 13.1, 23: 14.3, 24: 13.1, 25: 13.5, 26: 14.2 } },
    { label: '11%+', cohortMin: 11, cohortMax: 25, points: { 18: 9.4, 19: 10.1, 20: 10.4, 21: 14.1, 22: 11.5, 23: 14.3, 24: 12.5 } },
  ],
  avoidK: [
    { label: '8-12%', cohortMin: 8, cohortMax: 12, points: { 18: 13.6, 19: 14.5, 20: 14.0, 21: 11.8, 22: 11.8, 23: 10.0, 24: 9.1, 25: 7.1, 26: 8.9 } },
    { label: '12-16%', cohortMin: 12, cohortMax: 16, points: { 18: 14.3, 19: 14.0, 20: 13.9, 21: 13.1, 22: 12.6, 23: 12.1, 24: 11.6, 25: 12.3, 26: 12.9 } },
    { label: '16-20%', cohortMin: 16, cohortMax: 20, points: { 18: 15.4, 19: 14.9, 20: 14.6, 21: 14.7, 22: 15.2, 23: 15.6, 24: 14.2, 25: 14.3, 26: 13.1 } },
    { label: '20-25%', cohortMin: 20, cohortMax: 25, points: { 18: 19.6, 19: 18.1, 20: 17.0, 21: 16.9, 22: 17.7, 23: 18.6, 24: 17.8, 25: 18.1, 26: 19.0 } },
  ],
  power: [
    { label: '0-1.5%', cohortMin: 0, cohortMax: 1.5, points: { 18: 1.77, 19: 1.75, 20: 1.85, 21: 1.73, 22: 1.74, 23: 1.65, 24: 1.64, 25: 1.81, 26: 1.68 } },
    { label: '1.5-3%', cohortMin: 1.5, cohortMax: 3, points: { 18: 1.95, 19: 2.21, 20: 2.41, 21: 2.51, 22: 2.46, 23: 2.68, 24: 2.84, 25: 2.51, 26: 2.88 } },
    { label: '3-4.5%', cohortMin: 3, cohortMax: 4.5, points: { 18: 2.72, 19: 2.67, 20: 3.18, 21: 3.73, 22: 3.73, 23: 3.76, 24: 3.65, 25: 3.87, 26: 5.80 } },
  ],
  contact: [
    { label: '.200-.240', cohortMin: 0.200, cohortMax: 0.240, points: { 18: 0.250, 19: 0.246, 20: 0.264, 21: 0.265, 22: 0.260, 23: 0.254, 24: 0.257, 25: 0.242, 26: 0.247 } },
    { label: '.240-.270', cohortMin: 0.240, cohortMax: 0.270, points: { 18: 0.257, 19: 0.260, 20: 0.271, 21: 0.280, 22: 0.277, 23: 0.275, 24: 0.274, 25: 0.261, 26: 0.252 } },
    { label: '.270-.300', cohortMin: 0.270, cohortMax: 0.300, points: { 18: 0.243, 19: 0.266, 20: 0.277, 21: 0.280, 22: 0.282, 23: 0.286, 24: 0.296, 25: 0.275, 26: 0.283 } },
    { label: '.300-.330', cohortMin: 0.300, cohortMax: 0.330, points: { 18: 0.271, 19: 0.269, 20: 0.285, 21: 0.293, 22: 0.290, 23: 0.302, 24: 0.293, 25: 0.297 } },
  ],
};

const TRACE_STABILIZATION_PA: Record<string, number> = { eye: 600, avoidK: 200, power: 400, contact: 400 };
const TRACE_SENSITIVITY_POINTS: Record<string, number> = { eye: 8, avoidK: 8, power: 8, contact: 25 };

// Pitcher development curves (from tools/research/explore_pitcher_development.ts)
const TRACE_PITCHER_DEV_CURVES: Record<string, TraceCohortCurve[]> = {
  stuff: [
    { label: '4-6', cohortMin: 4, cohortMax: 6, points: { 18: 5.09, 19: 5.33, 20: 5.47, 21: 5.54, 22: 5.24, 23: 5.32, 24: 5.11, 25: 5.21, 26: 5.45 } },
    { label: '6-8', cohortMin: 6, cohortMax: 8, points: { 18: 5.64, 19: 5.45, 20: 5.76, 21: 5.90, 22: 6.03, 23: 6.35, 24: 6.37, 25: 6.65, 26: 6.68 } },
    { label: '8-10', cohortMin: 8, cohortMax: 10, points: { 18: 6.50, 19: 6.80, 20: 7.20, 21: 7.60, 22: 7.90, 23: 8.20, 24: 8.50, 25: 8.80, 26: 9.00 } },
  ],
  control: [
    { label: '1.5-2.5', cohortMin: 1.5, cohortMax: 2.5, points: { 18: 3.23, 19: 3.12, 20: 2.71, 21: 2.42, 22: 2.26, 23: 1.99, 24: 1.77, 25: 1.77 } },
    { label: '2.5-3.5', cohortMin: 2.5, cohortMax: 3.5, points: { 18: 3.41, 19: 3.26, 20: 3.03, 21: 2.70, 22: 2.95, 23: 2.90, 24: 3.34, 25: 3.49, 26: 3.79 } },
    { label: '3.5-4.5', cohortMin: 3.5, cohortMax: 4.5, points: { 19: 3.63, 20: 3.93, 21: 2.76, 22: 2.99, 23: 3.12, 24: 3.51, 25: 2.44, 26: 4.26 } },
  ],
  hra: [
    { label: '0.5-0.8', cohortMin: 0.5, cohortMax: 0.8, points: { 18: 0.67, 19: 0.67, 20: 0.67, 21: 0.52, 22: 0.58, 23: 0.54, 24: 0.42, 25: 0.36 } },
    { label: '0.8-1.1', cohortMin: 0.8, cohortMax: 1.1, points: { 18: 0.85, 19: 0.75, 20: 0.66, 21: 0.61, 22: 0.61, 23: 0.57, 24: 0.62, 25: 0.60, 26: 0.67 } },
    { label: '1.1-1.5', cohortMin: 1.1, cohortMax: 1.5, points: { 18: 0.55, 19: 0.71, 20: 0.79, 21: 0.53, 22: 0.69, 23: 0.53, 24: 0.61, 25: 0.65 } },
  ],
};

const TRACE_PITCHER_STABILIZATION_IP: Record<string, number> = { stuff: 100, control: 150, hra: 200 };

function getPitcherDevelopmentCurveDiagnosticsLocal(age: number, totalIp: number) {
  return (component: string, tfrRating: number, peakStat: number, rawStat: number | undefined, lowerIsBetter: boolean) => {
    const curves = TRACE_PITCHER_DEV_CURVES[component];
    if (!curves) return { cohortLabel: 'N/A', expectedRaw: undefined, devFraction: 0.5, baseline: tfrRating, ratingAdjust: 0, finalTR: tfrRating };

    // Select cohort
    let cohort = curves[curves.length - 1];
    for (const c of curves) {
      if (peakStat >= c.cohortMin && peakStat < c.cohortMax) { cohort = c; break; }
    }
    if (peakStat < curves[0].cohortMin) cohort = curves[0];

    // Interpolate expected value at age
    const ages = Object.keys(cohort.points).map(Number).sort((a, b) => a - b);
    let expectedRaw: number | undefined;
    if (ages.length > 0) {
      if (age <= ages[0]) expectedRaw = cohort.points[ages[0]];
      else if (age >= ages[ages.length - 1]) expectedRaw = cohort.points[ages[ages.length - 1]];
      else {
        for (let i = 0; i < ages.length - 1; i++) {
          if (age >= ages[i] && age <= ages[i + 1]) {
            const t = (age - ages[i]) / (ages[i + 1] - ages[i]);
            expectedRaw = cohort.points[ages[i]] + t * (cohort.points[ages[i + 1]] - cohort.points[ages[i]]);
            break;
          }
        }
      }
    }

    // Dev fraction
    let devFraction: number;
    if (lowerIsBetter) {
      const minAge = ages[0], maxAge = ages[ages.length - 1];
      devFraction = maxAge > minAge ? Math.max(0, Math.min(1, (age - minAge) / (maxAge - minAge))) : 0.5;
    } else {
      const valAtMin = cohort.points[ages[0]];
      const valAtMax = cohort.points[ages[ages.length - 1]];
      if (Math.abs(valAtMax - valAtMin) < 0.001 || expectedRaw === undefined) {
        devFraction = 0.5;
      } else {
        devFraction = Math.max(0, Math.min(1, (expectedRaw - valAtMin) / (valAtMax - valAtMin)));
      }
    }

    const baseline = Math.round(20 + (tfrRating - 20) * devFraction);

    // Individual adjustment
    let ratingAdjust = 0;
    if (rawStat !== undefined && totalIp > 0 && expectedRaw !== undefined && expectedRaw > 0) {
      let deviation = (rawStat - expectedRaw) / expectedRaw;
      if (lowerIsBetter) deviation = -deviation;
      const stabilization = TRACE_PITCHER_STABILIZATION_IP[component] ?? 200;
      const shrinkage = totalIp / (totalIp + stabilization);
      ratingAdjust = deviation * shrinkage * (TRACE_SENSITIVITY_POINTS[component] ?? 8);
    }

    const finalTR = Math.round(Math.max(20, Math.min(tfrRating, baseline + ratingAdjust)));

    return { cohortLabel: cohort.label, expectedRaw, devFraction, baseline, ratingAdjust: Math.round(ratingAdjust * 10) / 10, finalTR };
  };
}

function getDevelopmentCurveDiagnosticsLocal(age: number, totalPa: number) {
  return (component: string, tfrRating: number, peakStat: number, rawStat: number | undefined, lowerIsBetter: boolean) => {
    const curves = TRACE_DEV_CURVES[component];
    if (!curves) return { cohortLabel: 'N/A', expectedRaw: undefined, devFraction: 0.5, baseline: tfrRating, ratingAdjust: 0, finalTR: tfrRating };

    // Select cohort
    let cohort = curves[curves.length - 1];
    for (const c of curves) {
      if (peakStat >= c.cohortMin && peakStat < c.cohortMax) { cohort = c; break; }
    }
    if (peakStat < curves[0].cohortMin) cohort = curves[0];

    // Interpolate expected value at age
    const ages = Object.keys(cohort.points).map(Number).sort((a, b) => a - b);
    let expectedRaw: number | undefined;
    if (ages.length > 0) {
      if (age <= ages[0]) expectedRaw = cohort.points[ages[0]];
      else if (age >= ages[ages.length - 1]) expectedRaw = cohort.points[ages[ages.length - 1]];
      else {
        for (let i = 0; i < ages.length - 1; i++) {
          if (age >= ages[i] && age <= ages[i + 1]) {
            const t = (age - ages[i]) / (ages[i + 1] - ages[i]);
            expectedRaw = cohort.points[ages[i]] + t * (cohort.points[ages[i + 1]] - cohort.points[ages[i]]);
            break;
          }
        }
      }
    }

    // Dev fraction
    let devFraction: number;
    if (lowerIsBetter) {
      const minAge = ages[0], maxAge = ages[ages.length - 1];
      devFraction = maxAge > minAge ? Math.max(0, Math.min(1, (age - minAge) / (maxAge - minAge))) : 0.5;
    } else {
      const valAtMin = cohort.points[ages[0]];
      const valAtMax = cohort.points[ages[ages.length - 1]];
      if (Math.abs(valAtMax - valAtMin) < 0.001 || expectedRaw === undefined) {
        devFraction = 0.5;
      } else {
        devFraction = Math.max(0, Math.min(1, (expectedRaw - valAtMin) / (valAtMax - valAtMin)));
      }
    }

    const baseline = Math.round(20 + (tfrRating - 20) * devFraction);

    // Individual adjustment
    let ratingAdjust = 0;
    if (rawStat !== undefined && totalPa > 0 && expectedRaw !== undefined && expectedRaw > 0) {
      let deviation = (rawStat - expectedRaw) / expectedRaw;
      if (lowerIsBetter) deviation = -deviation;
      const stabilization = TRACE_STABILIZATION_PA[component] ?? 400;
      const shrinkage = totalPa / (totalPa + stabilization);
      ratingAdjust = deviation * shrinkage * (TRACE_SENSITIVITY_POINTS[component] ?? 8);
    }

    const finalTR = Math.round(Math.max(20, Math.min(tfrRating, baseline + ratingAdjust)));

    return { cohortLabel: cohort.label, expectedRaw, devFraction, baseline, ratingAdjust: Math.round(ratingAdjust * 10) / 10, finalTR };
  };
}

// ============================================================================
// Full TFR Mode - Main Trace Function
// ============================================================================

function traceBatterTFRFull(
  playerId: number,
  baseYear: number,
  scouting: BatterScouting,
  scoutingSource: 'my' | 'osa'
): void {
  console.log('\n' + '='.repeat(80));
  console.log(`BATTER TFR (FULL MODE): Player ID ${playerId}`);
  console.log('='.repeat(80));

  // --- STEP 1: Scouting Ratings ---
  console.log('\n--- STEP 1: Scouting Ratings ---\n');
  console.log(`  Power:   ${scouting.power}`);
  console.log(`  Eye:     ${scouting.eye}`);
  console.log(`  AvoidK:  ${scouting.avoidK}`);
  console.log(`  Contact: ${scouting.contact}`);
  console.log(`  Gap:     ${scouting.gap}`);
  console.log(`  Speed:   ${scouting.speed}`);
  console.log(`  Injury:  ${scouting.injury ?? 'Normal'}`);

  const scoutRates = scoutingToExpectedRates(scouting);
  const scoutDoublesRate = expectedDoublesRate(scouting.gap);
  const scoutTriplesRate = expectedTriplesRate(scouting.speed);

  console.log(`\n  Scouting Expected Rates:`);
  console.log(`    BB%: ${scoutRates.bbPct.toFixed(2)}%`);
  console.log(`    K%: ${scoutRates.kPct.toFixed(2)}%`);
  console.log(`    HR%: ${scoutRates.hrPct.toFixed(3)}%`);
  console.log(`    AVG: ${scoutRates.avg.toFixed(3)}`);
  console.log(`    2B/AB: ${scoutDoublesRate.toFixed(4)} (${(scoutDoublesRate * 600).toFixed(1)} per 600 AB)`);
  console.log(`    3B/AB: ${scoutTriplesRate.toFixed(4)} (${(scoutTriplesRate * 600).toFixed(1)} per 600 AB)`);

  // --- STEP 2: Load All Prospects ---
  console.log('\n--- STEP 2: Load All Prospects ---\n');
  const scoutingFile = findLatestHitterScoutingFile(scoutingSource);
  console.log(`  Source: ${scoutingFile ? path.basename(scoutingFile) : 'N/A'}`);

  const allScouting = loadAllBatterScouting(scoutingSource);
  console.log(`  Loaded ${allScouting.length} players from scouting file`);

  // Filter to prospects (<=130 career MLB AB)
  console.log(`\n  Loading career MLB AB to filter prospects...`);
  const careerAbMap = loadCareerMLBAb(baseYear);
  const careerMlbStatsMap = loadCareerMLBStats(baseYear);
  const prospects = allScouting.filter(s => (careerAbMap.get(s.playerId) ?? 0) <= 130);
  console.log(`  After career AB filter (<=130): ${prospects.length} prospects`);

  // Verify target player is in the list
  const targetInList = prospects.find(p => p.playerId === playerId);
  if (!targetInList) {
    console.log(`\n  WARNING: Target player ${playerId} not found in prospect list.`);
    console.log(`    Career MLB AB: ${careerAbMap.get(playerId) ?? 'N/A'}`);
    console.log(`    Adding target player to prospect pool for comparison.`);
    prospects.push({ playerId, name: `Player ${playerId}`, scouting });
  }

  // --- STEP 3: Minor League Stats ---
  console.log('\n--- STEP 3: Minor League Stats ---\n');
  const startYear = baseYear - 3;
  console.log(`  Loading minor league stats for years ${startYear}-${baseYear}...`);
  const allMinorStats = loadAllMinorLeagueBattingStats(startYear, baseYear);
  console.log(`  Found minor league stats for ${allMinorStats.size} unique players`);

  // Show target player's stats
  const targetMinorStats = allMinorStats.get(playerId) || [];
  if (targetMinorStats.length === 0) {
    console.log(`\n  Target player: No minor league stats found`);
  } else {
    console.log(`\n  Target player's minor league stats:`);
    for (const s of targetMinorStats) {
      const bbPct = (s.bb / s.pa) * 100;
      const kPct = (s.k / s.pa) * 100;
      const hrPct = (s.hr / s.pa) * 100;
      const avg = s.ab > 0 ? s.h / s.ab : 0;
      console.log(`    ${s.year} ${s.level.toUpperCase()}: ${s.pa} PA, BB%=${bbPct.toFixed(1)}, K%=${kPct.toFixed(1)}, HR%=${hrPct.toFixed(2)}, AVG=${avg.toFixed(3)}`);
    }
  }

  // --- STEP 4: Component Blends for ALL prospects ---
  console.log('\n--- STEP 4: Component Blends ---\n');
  const blendedResults: ComponentBlendResult[] = [];
  let prospectsWithStats = 0;

  for (const prospect of prospects) {
    const minorStats = allMinorStats.get(prospect.playerId) || [];
    if (minorStats.length > 0) prospectsWithStats++;

    const blend = calculateComponentBlendLocal(
      prospect.playerId,
      prospect.name,
      prospect.scouting,
      minorStats,
      baseYear
    );
    blendedResults.push(blend);
  }

  console.log(`  Calculated component blends for ${blendedResults.length} prospects`);
  console.log(`  Prospects with minor league stats: ${prospectsWithStats}`);
  console.log(`  Prospects with scouting only: ${blendedResults.length - prospectsWithStats}`);

  // Show target player's blend details
  const targetBlend = blendedResults.find(r => r.playerId === playerId);
  if (targetBlend) {
    const CEILING_BOOST_FACTOR = 0.35;
    console.log(`\n  Target Player Component Blends (ceiling boost = ${CEILING_BOOST_FACTOR}, 100% scouting):`);
    console.log(`    Eye (BB%):     scout=${targetBlend.scoutBbPct.toFixed(2)}%, ceiling-boosted=${targetBlend.eyeValue.toFixed(2)}%`);
    console.log(`    AvoidK (K%):   scout=${targetBlend.scoutKPct.toFixed(2)}%, ceiling-boosted=${targetBlend.avoidKValue.toFixed(2)}%`);
    console.log(`    Power (HR%):   scout=${targetBlend.scoutHrPct.toFixed(3)}%, ceiling-boosted=${targetBlend.powerValue.toFixed(3)}%`);
    console.log(`    Contact (AVG): scout=${targetBlend.scoutAvg.toFixed(3)}, ceiling-boosted=${targetBlend.contactValue.toFixed(3)}`);
    console.log(`    Gap:           ${targetBlend.gapValue} (100% scout)`);
    console.log(`    Speed:         ${targetBlend.speedValue} (100% scout)`);
    if (targetBlend.adjustedBbPct !== targetBlend.scoutBbPct) {
      console.log(`\n    MiLB adjusted rates (for TR development curves, NOT used in TFR):`);
      console.log(`      BB%: ${targetBlend.adjustedBbPct.toFixed(2)}%, K%: ${targetBlend.adjustedKPct.toFixed(2)}%, HR%: ${targetBlend.adjustedHrPct.toFixed(3)}%, AVG: ${targetBlend.adjustedAvg.toFixed(3)}`);
    }
  }

  // --- STEP 5: MLB Percentile Rankings (Direct Comparison) ---
  console.log('\n--- STEP 5: MLB Percentile Rankings (Direct Comparison) ---\n');
  console.log(`  Loading DOB data and building MLB distributions (2015-2020, ages 25-29, 300+ PA)...`);
  const dobMap = loadDOBMap();
  const mlbDist = buildMLBDistributions(dobMap);
  console.log(`  Built distributions from ${mlbDist.count} peak-age MLB hitters`);

  // Also rank Gap/Speed among prospects (no MLB distribution for these)
  const prospectPercentiles = rankProspectsByComponentLocal(blendedResults);

  if (targetBlend) {
    // Find blended rate's percentile directly in MLB distribution
    const eyePercentile = findValuePercentileInMLB(targetBlend.eyeValue, mlbDist.bbPctValues, true);
    const avoidKPercentile = findValuePercentileInMLB(targetBlend.avoidKValue, mlbDist.kPctValues, false);
    const powerPercentile = findValuePercentileInMLB(targetBlend.powerValue, mlbDist.hrPctValues, true);
    const contactPercentile = findValuePercentileInMLB(targetBlend.contactValue, mlbDist.avgValues, true);

    // Gap/Speed still ranked among prospects
    const targetProspectPctls = prospectPercentiles.get(playerId);
    const gapPercentile = targetProspectPctls?.gapPercentile ?? 50;
    const speedPercentile = targetProspectPctls?.speedPercentile ?? 50;

    console.log(`\n  Blended rates compared to MLB peak-age hitters:`);
    console.log(`    Eye (BB%):     ${targetBlend.eyeValue.toFixed(2)}% -> ${eyePercentile.toFixed(1)}th percentile in MLB`);
    console.log(`    AvoidK (K%):   ${targetBlend.avoidKValue.toFixed(2)}% -> ${avoidKPercentile.toFixed(1)}th percentile in MLB`);
    console.log(`    Power (HR%):   ${targetBlend.powerValue.toFixed(3)}% -> ${powerPercentile.toFixed(1)}th percentile in MLB`);
    console.log(`    Contact (AVG): ${targetBlend.contactValue.toFixed(3)} -> ${contactPercentile.toFixed(1)}th percentile in MLB`);
    console.log(`    Gap:           ${gapPercentile.toFixed(1)}th percentile (among prospects)`);
    console.log(`    Speed:         ${speedPercentile.toFixed(1)}th percentile (among prospects)`);

    // --- STEP 6: TFR Component Ratings ---
    console.log('\n--- STEP 6: TFR Component Ratings (from MLB percentiles) ---\n');
    console.log('  These are PEAK POTENTIAL ratings (green dashed line on radar chart).');
    console.log('  Current TR (blue solid line) is derived in Step 11 via development curves.\n');
    const trueEye = Math.round(20 + (eyePercentile / 100) * 60);
    const trueAvoidK = Math.round(20 + (avoidKPercentile / 100) * 60);
    const truePower = Math.round(20 + (powerPercentile / 100) * 60);
    const trueContact = Math.round(20 + (contactPercentile / 100) * 60);
    const trueGap = Math.round(20 + (gapPercentile / 100) * 60);
    const trueSpeed = Math.round(20 + (speedPercentile / 100) * 60);

    console.log(`  TFR Eye:     ${trueEye}  (${eyePercentile.toFixed(1)}th MLB pctl -> 20 + ${(eyePercentile / 100 * 60).toFixed(1)} = ${trueEye})`);
    console.log(`  TFR AvoidK:  ${trueAvoidK}  (${avoidKPercentile.toFixed(1)}th MLB pctl -> 20 + ${(avoidKPercentile / 100 * 60).toFixed(1)} = ${trueAvoidK})`);
    console.log(`  TFR Power:   ${truePower}  (${powerPercentile.toFixed(1)}th MLB pctl -> 20 + ${(powerPercentile / 100 * 60).toFixed(1)} = ${truePower})`);
    console.log(`  TFR Contact: ${trueContact}  (${contactPercentile.toFixed(1)}th MLB pctl -> 20 + ${(contactPercentile / 100 * 60).toFixed(1)} = ${trueContact})`);
    console.log(`  TFR Gap:     ${trueGap}  (${gapPercentile.toFixed(1)}th prospect pctl)`);
    console.log(`  TFR Speed:   ${trueSpeed}  (${speedPercentile.toFixed(1)}th prospect pctl)`);

    // --- STEP 7: Projected Rates (Ceiling-Boosted Rates) ---
    console.log('\n--- STEP 7: Projected Peak Rates (ceiling-boosted) ---\n');
    let projBbPct = Math.max(3.0, Math.min(20.0, targetBlend.eyeValue));
    let projKPct = Math.max(5.0, Math.min(35.0, targetBlend.avoidKValue));
    let projHrPct = Math.max(0.5, Math.min(8.0, targetBlend.powerValue));
    let projAvg = Math.max(0.200, Math.min(0.350, targetBlend.contactValue));

    console.log(`  Projected rates = ceiling-boosted scouting rates:`);
    console.log(`    BB%:  ${projBbPct.toFixed(2)}%  (ceiling-boosted Eye)`);
    console.log(`    K%:   ${projKPct.toFixed(2)}%  (ceiling-boosted AvoidK)`);
    console.log(`    HR%:  ${projHrPct.toFixed(3)}%  (ceiling-boosted Power)`);
    console.log(`    AVG:  ${projAvg.toFixed(3)}  (ceiling-boosted Contact)`);

    // --- STEP 8: Projected wOBA ---
    console.log('\n--- STEP 8: Projected Peak wOBA ---\n');
    const wobaFromBlended = calculateWobaFromRatesService(projBbPct, projKPct, projHrPct, projAvg, scouting.gap, scouting.speed);
    const wobaFromScouting = calculateWobaFromRatesService(scoutRates.bbPct, scoutRates.kPct, scoutRates.hrPct, scoutRates.avg, scouting.gap, scouting.speed);

    console.log(`  wOBA (from blended rates) = ${wobaFromBlended.toFixed(3)}`);
    console.log(`  wOBA (from scouting rates) = ${wobaFromScouting.toFixed(3)}`);

    // --- STEP 9: Final TFR ---
    console.log('\n--- STEP 9: Final TFR (MLB WAR Distribution) ---\n');

    // WAR coefficients (from HitterTrueFutureRatingService)
    const lgWoba = 0.315;
    const wobaScale = 1.15;
    const runsPerWin = 10;
    const replacementRuns = 20;

    // Calculate WAR for the target player
    const targetSbRuns = (() => {
      if (scouting.sr !== undefined && scouting.ste !== undefined) {
        const sbProj = projectStolenBases(scouting.sr, scouting.ste, 600);
        return sbProj.sb * 0.2 - sbProj.cs * 0.4;
      }
      return 0;
    })();
    const targetWRAA = ((wobaFromBlended - lgWoba) / wobaScale) * 600;
    const targetWar = Math.round(((targetWRAA + replacementRuns + targetSbRuns) / runsPerWin) * 10) / 10;

    // Map WAR to MLB peak-year WAR distribution (not prospect pool)
    const warPercentile = findValuePercentileInMLB(targetWar, mlbDist.warValues, true);
    const tfrRating = percentileToRating(warPercentile, true);

    console.log(`  Target WAR breakdown:`);
    console.log(`    wOBA=${wobaFromBlended.toFixed(3)}, wRAA=${targetWRAA.toFixed(1)}, sbRuns=${targetSbRuns.toFixed(1)}, replacementRuns=${replacementRuns}`);
    console.log(`    WAR = (${targetWRAA.toFixed(1)} + ${replacementRuns} + ${targetSbRuns.toFixed(1)}) / ${runsPerWin} = ${targetWar.toFixed(1)}`);
    console.log(`\n  MLB WAR Distribution: ${mlbDist.warValues.length} peak-age hitters (ages 25-29, 300+ PA, 2015-2020)`);
    console.log(`    Min=${mlbDist.warValues[0]?.toFixed(1)}, Median=${mlbDist.warValues[Math.floor(mlbDist.warValues.length / 2)]?.toFixed(1)}, Max=${mlbDist.warValues[mlbDist.warValues.length - 1]?.toFixed(1)}`);
    console.log(`\n  WAR Percentile: ${warPercentile.toFixed(1)} (vs MLB peak-age hitters)`);
    console.log(`  True Future Rating: ${tfrRating.toFixed(1)} stars`);

    // --- STEP 10: Projected PA (Empirical) ---
    console.log('\n--- STEP 10: Projected PA (Empirical) ---\n');
    console.log(`  Building combined PA distribution from MLB peak-age hitters (2015-2020, ages 25-29, 400+ PA)...`);

    const { tiers: empiricalPa, totalSeasons } = buildEmpiricalPaDistribution(dobMap);

    console.log(`  Total full seasons in distribution: ${totalSeasons}`);
    console.log(`\n  Projected Peak PA by Injury Tier (percentile in combined distribution):`);
    const injuryOrder = ['Iron Man', 'Durable', 'Normal', 'Fragile', 'Wrecked'];
    for (const cat of injuryOrder) {
      const entry = empiricalPa.get(cat);
      if (entry) {
        console.log(`    ${cat.padEnd(10)}: ${entry.projPa} PA  (${(entry.percentile * 100).toFixed(0)}th percentile)`);
      }
    }

    const playerInjury = scouting.injury ?? 'Normal';
    const projectedPa = empiricalPa.get(playerInjury)?.projPa
      ?? empiricalPa.get('Normal')?.projPa
      ?? 620;

    console.log(`\n  Player injury rating: ${playerInjury}`);
    console.log(`  Projected PA: ${projectedPa}`);

    // --- SUMMARY ---
    console.log('\n--- SUMMARY ---\n');
    console.log(`  Player ID: ${playerId}`);
    console.log(`  Scouting Source: ${scoutingSource.toUpperCase()}`);
    console.log(`  Prospect Pool: ${prospects.length} prospects`);
    console.log(`  Method: Direct MLB Comparison (blended rates vs MLB peak-age distribution)`);

    console.log(`\n  TFR Component Ratings (20-80 scale, peak potential):`);
    console.log(`    Eye:     ${trueEye}  (MLB percentile: ${eyePercentile.toFixed(1)})`);
    console.log(`    AvoidK:  ${trueAvoidK}  (MLB percentile: ${avoidKPercentile.toFixed(1)})`);
    console.log(`    Power:   ${truePower}  (MLB percentile: ${powerPercentile.toFixed(1)})`);
    console.log(`    Contact: ${trueContact}  (MLB percentile: ${contactPercentile.toFixed(1)})`);
    console.log(`    Gap:     ${trueGap}  (prospect percentile: ${gapPercentile.toFixed(1)})`);
    console.log(`    Speed:   ${trueSpeed}  (prospect percentile: ${speedPercentile.toFixed(1)})`);

    console.log(`\n  Projected Peak Rates (blended):`);
    console.log(`    BB%:  ${projBbPct.toFixed(2)}%`);
    console.log(`    K%:   ${projKPct.toFixed(2)}%`);
    console.log(`    HR%:  ${projHrPct.toFixed(3)}%`);
    console.log(`    AVG:  ${projAvg.toFixed(3)}`);

    console.log(`\n  Projected Peak wOBA: ${wobaFromBlended.toFixed(3)}`);
    console.log(`  Projected WAR/600PA: ${targetWar.toFixed(1)}`);
    console.log(`  Projected PA: ${projectedPa} (${playerInjury} injury, empirical)`);
    console.log(`  TFR: ${tfrRating.toFixed(1)} stars (${warPercentile.toFixed(1)}th percentile vs MLB peak-age WAR)`);

    // --- STEP 11: Current True Rating Derivation (Development Curves) ---
    console.log('\n--- STEP 11: Current True Rating (TR) via Development Curves ---\n');
    console.log('  TR represents current ability on the radar chart (blue solid line).');
    console.log('  TFR represents peak potential (green dashed line).');
    console.log('  TR is derived from data-driven development curves (245 MLB players, 2012+ debuts).');
    console.log('  For each component: cohort selection → expected MiLB stat at age → dev fraction → baseline TR.');
    console.log('  Individual adjustment: (actual raw - expected) / expected × shrinkage × sensitivity.\n');

    const trAge = calculateAge(dobMap.get(playerId), baseYear) ?? 22;
    console.log(`  Age: ${trAge}`);
    console.log(`  Total MiLB PA: ${targetBlend?.totalPa ?? 0}`);

    // MLB career stats for additional adjustment
    const mlbCareer = careerMlbStatsMap.get(playerId);
    const mlbForTR = (mlbCareer && mlbCareer.pa > 0 && mlbCareer.ab > 0) ? {
      avg: mlbCareer.h / mlbCareer.ab,
      bbPct: (mlbCareer.bb / mlbCareer.pa) * 100,
      kPct: (mlbCareer.k / mlbCareer.pa) * 100,
      hrPct: (mlbCareer.hr / mlbCareer.pa) * 100,
      pa: mlbCareer.pa,
    } : undefined;
    if (mlbForTR) {
      console.log(`  MLB Career PA: ${mlbForTR.pa} (AVG=${mlbForTR.avg.toFixed(3)}, BB%=${mlbForTR.bbPct.toFixed(1)}, K%=${mlbForTR.kPct.toFixed(1)}, HR%=${mlbForTR.hrPct.toFixed(2)})`);
    } else {
      console.log(`  MLB Career PA: 0`);
    }
    console.log('');

    const MLB_STAB: Record<string, number> = { eye: 200, avoidK: 120, power: 350, contact: 350 };

    if (targetBlend) {
      const projBbPct = targetBlend.eyeValue;
      const projKPct = targetBlend.avoidKValue;
      const projHrPct = targetBlend.powerValue;
      const projAvg = targetBlend.contactValue;

      const components = [
        { name: 'Eye',     key: 'eye',     tfrVal: trueEye,     peakStat: projBbPct, rawStat: targetBlend.rawBbPct, lower: false, unit: '%', mlbStat: mlbForTR?.bbPct, mlbExpected: projBbPct },
        { name: 'AvoidK',  key: 'avoidK',  tfrVal: trueAvoidK,  peakStat: projKPct,  rawStat: targetBlend.rawKPct,  lower: true,  unit: '%', mlbStat: mlbForTR?.kPct,  mlbExpected: projKPct },
        { name: 'Power',   key: 'power',   tfrVal: truePower,   peakStat: projHrPct, rawStat: targetBlend.rawHrPct, lower: false, unit: '%', mlbStat: mlbForTR?.hrPct, mlbExpected: projHrPct },
        { name: 'Contact', key: 'contact', tfrVal: trueContact, peakStat: projAvg,   rawStat: targetBlend.rawAvg,   lower: false, unit: '',  mlbStat: mlbForTR?.avg,   mlbExpected: projAvg },
      ];

      console.log(`  ${'Component'.padEnd(10)} ${'Cohort'.padEnd(12)} ${'Expected'.padEnd(10)} ${'Actual Raw'.padEnd(12)} ${'DevFrac'.padEnd(8)} ${'Base'.padEnd(6)} ${'MiLBAdj'.padEnd(8)} ${'MLBAdj'.padEnd(8)} ${'TFR'.padEnd(6)} Final TR  Gap`);
      console.log(`  ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(10)} ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(8)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(10)} ${'─'.repeat(5)}`);

      const devCurveDiag = getDevelopmentCurveDiagnosticsLocal(trAge, targetBlend.totalPa);

      for (const c of components) {
        const diag = devCurveDiag(c.key, c.tfrVal, c.peakStat, c.rawStat, c.lower);

        // Compute MLB adjustment separately for display
        let mlbAdj = 0;
        if (mlbForTR && c.mlbStat !== undefined && c.mlbExpected > 0) {
          let mlbDev = (c.mlbStat - c.mlbExpected) / c.mlbExpected;
          if (c.lower) mlbDev = -mlbDev;
          const mlbShrinkage = mlbForTR.pa / (mlbForTR.pa + (MLB_STAB[c.key] ?? 350));
          mlbAdj = mlbDev * mlbShrinkage * (TRACE_SENSITIVITY_POINTS[c.key] ?? 8);
        }

        const totalAdj = diag.ratingAdjust + mlbAdj;
        const finalTR = Math.round(Math.max(20, Math.min(c.tfrVal, diag.baseline + totalAdj)));
        const gap = c.tfrVal - finalTR;
        const expectedStr = diag.expectedRaw !== undefined ? (c.unit === '%' ? diag.expectedRaw.toFixed(1) + '%' : diag.expectedRaw.toFixed(3)) : '—';
        const actualStr = c.rawStat !== undefined ? (c.unit === '%' ? c.rawStat.toFixed(1) + '%' : c.rawStat.toFixed(3)) : '—';
        const milbAdjStr = diag.ratingAdjust !== 0 ? (diag.ratingAdjust > 0 ? '+' : '') + diag.ratingAdjust.toFixed(1) : '0';
        const mlbAdjStr = mlbAdj !== 0 ? (mlbAdj > 0 ? '+' : '') + mlbAdj.toFixed(1) : '—';
        console.log(`  ${c.name.padEnd(10)} ${diag.cohortLabel.padEnd(12)} ${expectedStr.padEnd(10)} ${actualStr.padEnd(12)} ${diag.devFraction.toFixed(2).padEnd(8)} ${String(diag.baseline).padEnd(6)} ${milbAdjStr.padEnd(8)} ${mlbAdjStr.padEnd(8)} ${String(c.tfrVal).padEnd(6)} ${String(finalTR).padEnd(10)} +${gap}`);
      }

      // Gap/Speed use average devFraction
      const avgDevFrac = components.reduce((sum, c) => {
        const diag = devCurveDiag(c.key, c.tfrVal, c.peakStat, c.rawStat, c.lower);
        return sum + diag.devFraction;
      }, 0) / components.length;

      const gapTR = Math.round(Math.max(20, Math.min(trueGap, 20 + (trueGap - 20) * avgDevFrac)));
      const speedTR = Math.round(Math.max(20, Math.min(trueSpeed, 20 + (trueSpeed - 20) * avgDevFrac)));
      console.log(`  ${'Gap'.padEnd(10)} ${'(avg frac)'.padEnd(12)} ${'—'.padEnd(10)} ${'—'.padEnd(12)} ${avgDevFrac.toFixed(2).padEnd(8)} ${String(gapTR).padEnd(6)} ${'—'.padEnd(8)} ${'—'.padEnd(8)} ${String(trueGap).padEnd(6)} ${String(gapTR).padEnd(10)} +${trueGap - gapTR}`);
      console.log(`  ${'Speed'.padEnd(10)} ${'(avg frac)'.padEnd(12)} ${'—'.padEnd(10)} ${'—'.padEnd(12)} ${avgDevFrac.toFixed(2).padEnd(8)} ${String(speedTR).padEnd(6)} ${'—'.padEnd(8)} ${'—'.padEnd(8)} ${String(trueSpeed).padEnd(6)} ${String(speedTR).padEnd(10)} +${trueSpeed - speedTR}`);

      console.log(`\n  Stabilization PA (MiLB): Eye=600, AvoidK=200, Power=400, Contact=400`);
      console.log(`  Stabilization PA (MLB):  Eye=200, AvoidK=120, Power=350, Contact=350`);
      console.log(`  Sensitivity: Eye=8, AvoidK=8, Power=8, Contact=25 rating points per 100% deviation.`);
    }
  }
}

// ============================================================================
// Main
// ============================================================================

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Player Rating Trace Tool

Traces how True Ratings (TR) and True Future Ratings (TFR) are calculated
for a specific player, showing every step of the calculation pipeline.

Reads data from local CSV files in public/data directory.

USAGE:
  npx tsx tools/trace-rating.ts <player_id> [options]

OPTIONS:
  --type=<pitcher|batter>  Player type (auto-detected if not specified)
  --year=<YYYY>            Base year for stats (default: 2021)
  --stage=<stage>          Season stage for year weighting (default: complete)
                           Values: early, q1_done, q2_done, q3_done, complete
  --tfr                    Calculate TFR instead of TR (auto-enabled for prospects)
  --full                   Full TFR mode: rank against ALL prospects, map to MLB distributions
  --scouting=<my|osa>      Scouting source: 'my' or 'osa' (default: osa)

SEASON STAGES:
  early     - Q1 in progress: current year ignored [0, 5, 3, 2]
  q1_done   - May 15 - Jun 30: current year weight 1.0 [1.0, 5.0, 2.5, 1.5]
  q2_done   - Jul 1 - Aug 14: current year weight 2.5 [2.5, 4.5, 2.0, 1.0]
  q3_done   - Aug 15 - Sep 30: current year weight 4.0 [4.0, 4.0, 1.5, 0.5]
  complete  - Oct 1+: full season weights [5, 3, 2, 0]

SCOUTING DATA (optional for TR, required for TFR):
  Pitcher: --stuff=<20-80> --control=<20-80> --hra=<20-80>
           --stamina=<20-80> --injury=<Iron Man|Durable|Normal|Fragile|Wrecked>
  Batter:  --power=<20-80> --eye=<20-80> --avoidk=<20-80> --contact=<20-80>
           --gap=<20-80> --speed=<20-80>

EXAMPLES:
  npx tsx tools/trace-rating.ts 12797                    # Auto-detect type, TR (complete season)
  npx tsx tools/trace-rating.ts 12797 --stage=q1_done    # Early season weighting
  npx tsx tools/trace-rating.ts 12797 --type=batter      # Batter TR
  npx tsx tools/trace-rating.ts 12797 --year=2021        # Specify year
  npx tsx tools/trace-rating.ts 15354                    # Prospect auto-uses TFR
  npx tsx tools/trace-rating.ts 12797 --tfr --power=55 --eye=60 --avoidk=50 --contact=65 --gap=55 --speed=60
`);
    process.exit(0);
  }

  const playerId = parseInt(args[0]);
  if (isNaN(playerId)) {
    console.error('Error: Invalid player ID');
    process.exit(1);
  }

  let playerType: 'pitcher' | 'batter' | undefined;
  let baseYear = 2021;
  let isTfr = false;
  let isFull = false;
  let stage: SeasonStage = 'complete';
  let scoutingSource: 'my' | 'osa' = 'osa';

  let pitcherScouting: PitcherScouting | undefined;
  let batterScouting: BatterScouting | undefined;

  for (const arg of args.slice(1)) {
    if (arg.startsWith('--type=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (val === 'pitcher' || val === 'batter') playerType = val;
    } else if (arg.startsWith('--year=')) {
      baseYear = parseInt(arg.split('=')[1]) || baseYear;
    } else if (arg.startsWith('--scouting=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (val === 'my' || val === 'osa') scoutingSource = val;
    } else if (arg.startsWith('--stage=')) {
      const val = arg.split('=')[1].toLowerCase() as SeasonStage;
      if (['early', 'q1_done', 'q2_done', 'q3_done', 'complete'].includes(val)) {
        stage = val;
      } else {
        console.error(`Error: Invalid stage "${val}". Valid values: early, q1_done, q2_done, q3_done, complete`);
        process.exit(1);
      }
    } else if (arg === '--tfr') {
      isTfr = true;
    } else if (arg === '--full') {
      isFull = true;
      isTfr = true;  // --full implies TFR mode
    } else if (arg.startsWith('--stuff=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.stuff = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--control=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.control = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--hra=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.hra = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--stamina=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.stamina = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--injury=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.injury = arg.split('=')[1].trim();
    } else if (arg.startsWith('--power=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50, gap: 50, speed: 50 };
      batterScouting.power = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--eye=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50, gap: 50, speed: 50 };
      batterScouting.eye = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--avoidk=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50, gap: 50, speed: 50 };
      batterScouting.avoidK = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--contact=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50, gap: 50, speed: 50 };
      batterScouting.contact = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--gap=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50, gap: 50, speed: 50 };
      batterScouting.gap = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--speed=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50, gap: 50, speed: 50 };
      batterScouting.speed = parseInt(arg.split('=')[1]) || 50;
    }
  }

  // Auto-detect player type if not specified
  // Also auto-enable TFR mode for prospects (players with no MLB stats)
  let detectedFromMinors = false;
  if (!playerType) {
    // Check MLB stats first
    const pitchingStats = loadMLBPitchingStats(playerId, baseYear);
    const battingStats = loadMLBBattingStats(playerId, baseYear);

    if (pitchingStats && pitchingStats.ip > 0) {
      playerType = 'pitcher';
    } else if (battingStats && battingStats.pa > 0) {
      playerType = 'batter';
    } else {
      // Check minor leagues
      const minorPitching = loadMinorLeaguePitchingStats(playerId, baseYear);
      const minorBatting = loadMinorLeagueBattingStats(playerId, baseYear);

      if (minorPitching.length > 0) {
        playerType = 'pitcher';
        detectedFromMinors = true;
      } else if (minorBatting.length > 0) {
        playerType = 'batter';
        detectedFromMinors = true;
      } else {
        if (pitcherScouting) playerType = 'pitcher';
        else if (batterScouting) playerType = 'batter';
        else {
          console.error('Error: Could not auto-detect player type. Please specify --type=pitcher or --type=batter');
          process.exit(1);
        }
      }
    }
    console.log(`Auto-detected player type: ${playerType}`);

    // If player was detected from minor leagues (no MLB stats), auto-enable TFR mode
    if (detectedFromMinors && !isTfr) {
      console.log(`No MLB stats found - automatically switching to TFR (prospect) mode.`);
      isTfr = true;
    }
  }

  // Auto-load scouting data from files if not provided via CLI
  if (playerType === 'pitcher' && !pitcherScouting) {
    const loaded = loadPitcherScouting(playerId, scoutingSource);
    if (loaded) {
      pitcherScouting = loaded;
      console.log(`Loaded pitcher scouting (${scoutingSource.toUpperCase()}): Stuff=${loaded.stuff}, Control=${loaded.control}, HRA=${loaded.hra}, Stamina=${loaded.stamina ?? '?'}, Injury=${loaded.injury ?? '?'}`);
    }
  }
  if (playerType === 'batter' && !batterScouting) {
    const loaded = loadBatterScouting(playerId, scoutingSource);
    if (loaded) {
      batterScouting = loaded;
      console.log(`Loaded batter scouting (${scoutingSource.toUpperCase()}): Power=${loaded.power}, Eye=${loaded.eye}, AvoidK=${loaded.avoidK}, Contact=${loaded.contact}, Gap=${loaded.gap}, Speed=${loaded.speed}`);
    }
  }

  // Get year weights based on season stage
  const yearWeights = getYearWeights(stage);

  // If user explicitly set type but didn't use --tfr, check if player is a prospect
  // (has minor league stats but no MLB stats)
  if (!isTfr && !detectedFromMinors) {
    const hasMLBStats = playerType === 'pitcher'
      ? loadMLBPitchingStats(playerId, baseYear) !== null
      : loadMLBBattingStats(playerId, baseYear) !== null;

    if (!hasMLBStats) {
      const hasMinorStats = playerType === 'pitcher'
        ? loadMinorLeaguePitchingStats(playerId, baseYear).length > 0
        : loadMinorLeagueBattingStats(playerId, baseYear).length > 0;

      if (hasMinorStats) {
        console.log(`No MLB stats found for ${baseYear} - automatically switching to TFR (prospect) mode.`);
        isTfr = true;
      }
    }
  }

  // Run appropriate trace
  if (isTfr) {
    if (playerType === 'pitcher') {
      if (!pitcherScouting) {
        pitcherScouting = loadPitcherScouting(playerId, scoutingSource) ?? undefined;
        if (!pitcherScouting) {
          console.error(`Error: TFR requires scouting data. Not found in ${scoutingSource.toUpperCase()} file. Please provide --stuff, --control, --hra`);
          process.exit(1);
        }
        console.log(`Loaded pitcher scouting (${scoutingSource.toUpperCase()}): Stuff=${pitcherScouting.stuff}, Control=${pitcherScouting.control}, HRA=${pitcherScouting.hra}, Stamina=${pitcherScouting.stamina ?? '?'}, Injury=${pitcherScouting.injury ?? '?'}`);
      }
      if (isFull) {
        tracePitcherTFRFull(playerId, baseYear, pitcherScouting);
      } else {
        tracePitcherTFR(playerId, baseYear, pitcherScouting);
      }
    } else {
      if (!batterScouting) {
        batterScouting = loadBatterScouting(playerId, scoutingSource) ?? undefined;
        if (!batterScouting) {
          console.error(`Error: TFR requires scouting data. Not found in ${scoutingSource.toUpperCase()} file. Please provide --power, --eye, --avoidk, --contact`);
          process.exit(1);
        }
        console.log(`Loaded batter scouting (${scoutingSource.toUpperCase()}): Power=${batterScouting.power}, Eye=${batterScouting.eye}, AvoidK=${batterScouting.avoidK}, Contact=${batterScouting.contact}, Gap=${batterScouting.gap}, Speed=${batterScouting.speed}`);
      }
      if (isFull) {
        traceBatterTFRFull(playerId, baseYear, batterScouting, scoutingSource);
      } else {
        traceBatterTFR(playerId, baseYear, batterScouting);
      }
    }
  } else {
    if (playerType === 'pitcher') {
      tracePitcherTR(playerId, baseYear, pitcherScouting, yearWeights, stage);
    } else {
      traceBatterTR(playerId, baseYear, batterScouting, yearWeights, stage);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('Trace complete!');
  console.log('='.repeat(80) + '\n');
}

main();
