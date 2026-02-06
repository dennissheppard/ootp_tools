#!/usr/bin/env npx tsx
/**
 * Player Rating Trace Tool
 *
 * Traces how True Ratings (TR) and True Future Ratings (TFR) are calculated
 * for a specific player, showing every step of the calculation pipeline.
 *
 * Reads data from local CSV files in public/data directory.
 *
 * USAGE:
 *   npx tsx tools/trace-rating.ts <player_id> [options]
 *
 * OPTIONS:
 *   --type=<pitcher|batter>  Player type (auto-detected if not specified)
 *   --year=<YYYY>            Base year for stats (default: 2021)
 *   --stage=<stage>          Season stage for year weighting (default: complete)
 *                            Values: early, q1_done, q2_done, q3_done, complete
 *   --tfr                    Calculate TFR instead of TR (for prospects)
 *
 * SCOUTING DATA (optional, for TR blend or TFR calculation):
 *   Pitcher: --stuff=<20-80> --control=<20-80> --hra=<20-80>
 *   Batter:  --power=<20-80> --eye=<20-80> --avoidk=<20-80> --contact=<20-80>
 *
 * EXAMPLES:
 *   npx tsx tools/trace-rating.ts 12797                    # Auto-detect type, TR
 *   npx tsx tools/trace-rating.ts 12797 --type=batter      # Batter TR
 *   npx tsx tools/trace-rating.ts 12797 --stage=q2_done    # Mid-season weighting
 *   npx tsx tools/trace-rating.ts 12797 --tfr              # TFR calculation
 *   npx tsx tools/trace-rating.ts 12797 --power=55 --eye=60 --avoidk=50 --contact=65
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
};

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
}

interface BatterScouting {
  power: number;
  eye: number;
  avoidK: number;
  contact: number;
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
function loadPitcherScouting(playerId: number): PitcherScouting | null {
  const filePath = path.join(DATA_DIR, 'default_osa_scouting.csv');
  if (!fs.existsSync(filePath)) return null;

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const { headers, rows } = parseCSV(csvText);

  const indices = {
    id: headers.indexOf('ID'),
    stuff: headers.indexOf('STU P'),
    control: headers.indexOf('CON P'),
    hra: headers.indexOf('HRR P'),
  };

  for (const row of rows) {
    if (parseInt(row[indices.id]) === playerId) {
      return {
        stuff: parseInt(row[indices.stuff]) || 50,
        control: parseInt(row[indices.control]) || 50,
        hra: parseInt(row[indices.hra]) || 50,
      };
    }
  }
  return null;
}

/**
 * Load batter scouting data from default OSA hitter scouting CSV
 */
function loadBatterScouting(playerId: number): BatterScouting | null {
  const filePath = path.join(DATA_DIR, 'default_hitter_osa_scouting.csv');
  if (!fs.existsSync(filePath)) return null;

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const { headers, rows } = parseCSV(csvText);

  const indices = {
    id: headers.indexOf('ID'),
    power: headers.indexOf('POW P'),
    eye: headers.indexOf('EYE P'),
    avoidK: headers.indexOf('K P'),
    contact: headers.indexOf('CON P'),
  };

  for (const row of rows) {
    if (parseInt(row[indices.id]) === playerId) {
      return {
        power: parseInt(row[indices.power]) || 50,
        eye: parseInt(row[indices.eye]) || 50,
        avoidK: parseInt(row[indices.avoidK]) || 50,
        contact: parseInt(row[indices.contact]) || 50,
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

  console.log('\n--- SUMMARY ---\n');
  console.log(`  Player ID: ${playerId}`);
  console.log(`\n  Scouting Ratings:`);
  console.log(`    Stuff: ${scouting.stuff}, Control: ${scouting.control}, HRA: ${scouting.hra}`);
  console.log(`\n  Minor League Stats: ${totalRawIp.toFixed(1)} IP (${totalWeightedIp.toFixed(1)} weighted)`);
  console.log(`  Scouting Weight: ${(scoutingWeight * 100).toFixed(0)}%`);
  console.log(`\n  Projected Peak Rates:`);
  console.log(`    K/9: ${blendedK9.toFixed(2)}`);
  console.log(`    BB/9: ${blendedBb9.toFixed(2)}`);
  console.log(`    HR/9: ${blendedHr9.toFixed(2)}`);
  console.log(`\n  Projected Peak FIP: ${projFip.toFixed(2)}`);
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

  const scoutBbPct = BATTER_FORMULAS.eye.intercept + BATTER_FORMULAS.eye.slope * scouting.eye;
  const scoutKPct = BATTER_FORMULAS.avoidK.intercept + BATTER_FORMULAS.avoidK.slope * scouting.avoidK;
  const scoutHrPct = scouting.power <= 50
    ? BATTER_FORMULAS.power.low.intercept + BATTER_FORMULAS.power.low.slope * scouting.power
    : BATTER_FORMULAS.power.high.intercept + BATTER_FORMULAS.power.high.slope * scouting.power;
  const scoutAvg = BATTER_FORMULAS.contact.intercept + BATTER_FORMULAS.contact.slope * scouting.contact;

  console.log(`\n  Scouting Expected Rates:`);
  console.log(`    BB%: ${scoutBbPct.toFixed(2)}%`);
  console.log(`    K%: ${scoutKPct.toFixed(2)}%`);
  console.log(`    HR%: ${scoutHrPct.toFixed(3)}%`);
  console.log(`    AVG: ${scoutAvg.toFixed(3)}`);

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

  console.log('\n--- STEP 4: Component-Specific Scouting Weights ---\n');
  console.log(`  Based on MiLB->MLB predictive validity:`);
  console.log(`    Eye (BB%):   r=0.05 -> Always 100% scouting (MiLB BB% is noise)`);
  console.log(`    Contact (AVG): r=0.18 -> Always 100% scouting (MiLB AVG is noise)`);
  console.log(`    AvoidK (K%): r=0.68 -> ${totalWeightedPa < 150 ? '100%' : totalWeightedPa <= 300 ? '65%' : totalWeightedPa <= 500 ? '50%' : '40%'} scouting`);
  console.log(`    Power (HR%): r=0.44 -> ${totalWeightedPa < 150 ? '100%' : totalWeightedPa <= 300 ? '85%' : totalWeightedPa <= 500 ? '80%' : '75%'} scouting`);

  console.log('\n--- STEP 5: Level-Adjusted Minor League Stats ---\n');
  let adjustedKPctSum = 0, adjustedHrPctSum = 0;
  let totalPaWeight = 0;

  for (const s of allMinorStats) {
    const levelAdj = BATTER_LEVEL_ADJUSTMENTS[s.level as keyof typeof BATTER_LEVEL_ADJUSTMENTS];
    if (!levelAdj) continue;

    const rawKPct = (s.k / s.pa) * 100;
    const rawHrPct = (s.hr / s.pa) * 100;

    const adjKPct = rawKPct + levelAdj.kPct;
    const adjHrPct = rawHrPct + levelAdj.hrPct;

    console.log(`  ${s.level.toUpperCase()} (${s.pa} PA):`);
    console.log(`    K%: ${rawKPct.toFixed(1)} + ${levelAdj.kPct} = ${adjKPct.toFixed(1)}`);
    console.log(`    HR%: ${rawHrPct.toFixed(2)} + ${levelAdj.hrPct} = ${adjHrPct.toFixed(2)}`);

    adjustedKPctSum += adjKPct * s.pa;
    adjustedHrPctSum += adjHrPct * s.pa;
    totalPaWeight += s.pa;
  }

  let adjustedKPct = scoutKPct;
  let adjustedHrPct = scoutHrPct;

  if (totalPaWeight > 0) {
    adjustedKPct = adjustedKPctSum / totalPaWeight;
    adjustedHrPct = adjustedHrPctSum / totalPaWeight;
    console.log(`\n  Weighted Adjusted Stats (MLB-equivalent):`);
    console.log(`    K%: ${adjustedKPct.toFixed(1)}%`);
    console.log(`    HR%: ${adjustedHrPct.toFixed(2)}%`);
  }

  console.log('\n--- STEP 6: Blend Scouting and Stats (Component-Specific) ---\n');

  const blendedBbPct = scoutBbPct;
  const blendedAvg = scoutAvg;
  console.log(`  Eye (BB%): 100% scouting = ${blendedBbPct.toFixed(2)}%`);
  console.log(`  Contact (AVG): 100% scouting = ${blendedAvg.toFixed(3)}`);

  const avoidKScoutWeight = totalWeightedPa < 150 ? 1.0 : totalWeightedPa <= 300 ? 0.65 : totalWeightedPa <= 500 ? 0.50 : 0.40;
  const blendedKPct = avoidKScoutWeight * scoutKPct + (1 - avoidKScoutWeight) * adjustedKPct;
  console.log(`  AvoidK (K%): ${(avoidKScoutWeight * 100).toFixed(0)}% scout × ${scoutKPct.toFixed(1)} + ${((1 - avoidKScoutWeight) * 100).toFixed(0)}% stats × ${adjustedKPct.toFixed(1)} = ${blendedKPct.toFixed(1)}%`);

  const powerScoutWeight = totalWeightedPa < 150 ? 1.0 : totalWeightedPa <= 300 ? 0.85 : totalWeightedPa <= 500 ? 0.80 : 0.75;
  const blendedHrPct = powerScoutWeight * scoutHrPct + (1 - powerScoutWeight) * adjustedHrPct;
  console.log(`  Power (HR%): ${(powerScoutWeight * 100).toFixed(0)}% scout × ${scoutHrPct.toFixed(2)} + ${((1 - powerScoutWeight) * 100).toFixed(0)}% stats × ${adjustedHrPct.toFixed(2)} = ${blendedHrPct.toFixed(2)}%`);

  console.log('\n--- STEP 7: Calculate Projected wOBA ---\n');
  const projWoba = calculateWobaFromRates(blendedBbPct, blendedKPct, blendedHrPct, blendedAvg);
  console.log(`  Projected Peak wOBA = ${projWoba.toFixed(3)}`);

  console.log('\n--- SUMMARY ---\n');
  console.log(`  Player ID: ${playerId}`);
  console.log(`\n  Scouting Ratings:`);
  console.log(`    Power: ${scouting.power}, Eye: ${scouting.eye}, AvoidK: ${scouting.avoidK}, Contact: ${scouting.contact}`);
  console.log(`\n  Minor League Stats: ${totalRawPa} PA (${totalWeightedPa.toFixed(0)} weighted)`);
  console.log(`\n  Projected Peak Rates:`);
  console.log(`    BB%: ${blendedBbPct.toFixed(2)}%`);
  console.log(`    K%: ${blendedKPct.toFixed(1)}%`);
  console.log(`    HR%: ${blendedHrPct.toFixed(2)}%`);
  console.log(`    AVG: ${blendedAvg.toFixed(3)}`);
  console.log(`\n  Projected Peak wOBA: ${projWoba.toFixed(3)}`);
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
 */
function calculateWobaFromRates(bbPct: number, _kPct: number, hrPct: number, avg: number): number {
  const bbRate = bbPct / 100;
  const hrRate = hrPct / 100; // Use HR% directly
  const hitRate = avg * (1 - bbRate);
  const tripleRate = hitRate * 0.03;
  const doubleRate = hitRate * 0.20;
  const singleRate = Math.max(0, hitRate - hrRate - tripleRate - doubleRate);

  return Math.max(0.200, Math.min(0.500,
    WOBA_WEIGHTS.bb * bbRate +
    WOBA_WEIGHTS.single * singleRate +
    WOBA_WEIGHTS.double * doubleRate +
    WOBA_WEIGHTS.triple * tripleRate +
    WOBA_WEIGHTS.hr * hrRate
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
  --tfr                    Calculate TFR instead of TR (for prospects)

SEASON STAGES:
  early     - Q1 in progress: current year ignored [0, 5, 3, 2]
  q1_done   - May 15 - Jun 30: current year weight 1.0 [1.0, 5.0, 2.5, 1.5]
  q2_done   - Jul 1 - Aug 14: current year weight 2.5 [2.5, 4.5, 2.0, 1.0]
  q3_done   - Aug 15 - Sep 30: current year weight 4.0 [4.0, 4.0, 1.5, 0.5]
  complete  - Oct 1+: full season weights [5, 3, 2, 0]

SCOUTING DATA (optional for TR, required for TFR):
  Pitcher: --stuff=<20-80> --control=<20-80> --hra=<20-80>
  Batter:  --power=<20-80> --eye=<20-80> --avoidk=<20-80> --contact=<20-80>

EXAMPLES:
  npx tsx tools/trace-rating.ts 12797                    # Auto-detect type, TR (complete season)
  npx tsx tools/trace-rating.ts 12797 --stage=q1_done    # Early season weighting
  npx tsx tools/trace-rating.ts 12797 --type=batter      # Batter TR
  npx tsx tools/trace-rating.ts 12797 --year=2021        # Specify year
  npx tsx tools/trace-rating.ts 12797 --tfr --power=55 --eye=60 --avoidk=50 --contact=65
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
  let stage: SeasonStage = 'complete';

  let pitcherScouting: PitcherScouting | undefined;
  let batterScouting: BatterScouting | undefined;

  for (const arg of args.slice(1)) {
    if (arg.startsWith('--type=')) {
      const val = arg.split('=')[1].toLowerCase();
      if (val === 'pitcher' || val === 'batter') playerType = val;
    } else if (arg.startsWith('--year=')) {
      baseYear = parseInt(arg.split('=')[1]) || baseYear;
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
    } else if (arg.startsWith('--stuff=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.stuff = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--control=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.control = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--hra=')) {
      if (!pitcherScouting) pitcherScouting = { stuff: 50, control: 50, hra: 50 };
      pitcherScouting.hra = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--power=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50 };
      batterScouting.power = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--eye=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50 };
      batterScouting.eye = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--avoidk=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50 };
      batterScouting.avoidK = parseInt(arg.split('=')[1]) || 50;
    } else if (arg.startsWith('--contact=')) {
      if (!batterScouting) batterScouting = { power: 50, eye: 50, avoidK: 50, contact: 50 };
      batterScouting.contact = parseInt(arg.split('=')[1]) || 50;
    }
  }

  // Auto-detect player type if not specified
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
      } else if (minorBatting.length > 0) {
        playerType = 'batter';
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
  }

  // Auto-load scouting data from OSA files if not provided via CLI
  if (playerType === 'pitcher' && !pitcherScouting) {
    const loaded = loadPitcherScouting(playerId);
    if (loaded) {
      pitcherScouting = loaded;
      console.log(`Loaded pitcher scouting from OSA: Stuff=${loaded.stuff}, Control=${loaded.control}, HRA=${loaded.hra}`);
    }
  }
  if (playerType === 'batter' && !batterScouting) {
    const loaded = loadBatterScouting(playerId);
    if (loaded) {
      batterScouting = loaded;
      console.log(`Loaded batter scouting from OSA: Power=${loaded.power}, Eye=${loaded.eye}, AvoidK=${loaded.avoidK}, Contact=${loaded.contact}`);
    }
  }

  // Get year weights based on season stage
  const yearWeights = getYearWeights(stage);

  // Run appropriate trace
  if (isTfr) {
    if (playerType === 'pitcher') {
      if (!pitcherScouting) {
        pitcherScouting = loadPitcherScouting(playerId) ?? undefined;
        if (!pitcherScouting) {
          console.error('Error: TFR requires scouting data. Not found in OSA file. Please provide --stuff, --control, --hra');
          process.exit(1);
        }
        console.log(`Loaded pitcher scouting from OSA: Stuff=${pitcherScouting.stuff}, Control=${pitcherScouting.control}, HRA=${pitcherScouting.hra}`);
      }
      tracePitcherTFR(playerId, baseYear, pitcherScouting);
    } else {
      if (!batterScouting) {
        batterScouting = loadBatterScouting(playerId) ?? undefined;
        if (!batterScouting) {
          console.error('Error: TFR requires scouting data. Not found in OSA file. Please provide --power, --eye, --avoidk, --contact');
          process.exit(1);
        }
        console.log(`Loaded batter scouting from OSA: Power=${batterScouting.power}, Eye=${batterScouting.eye}, AvoidK=${batterScouting.avoidK}, Contact=${batterScouting.contact}`);
      }
      traceBatterTFR(playerId, baseYear, batterScouting);
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
