/**
 * DefensiveProjectionService
 *
 * Projects defensive value (defRuns + posAdj) for batters.
 *
 * Two input sources, blended by MLB innings:
 * 1. Historical DRS: 5-year weighted, regressed toward 0 (3000 IP stabilization)
 * 2. Scouting fielding ratings: 20-80 ratings → expected defensive runs (position-specific)
 *
 * When DRS is unavailable (API empty), falls back to scouting-only.
 */

import { Position } from '../models/Player';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface FieldingScouting {
  ifRange?: number;   // 20-80
  ifArm?: number;
  ifDP?: number;
  ifErr?: number;
  ofRange?: number;
  ofArm?: number;
  ofErr?: number;
  cArm?: number;
  cBlock?: number;
  cFrm?: number;
  /** Position-specific ability ratings (pos2=C, pos3=1B, ..., pos9=RF) */
  posRatings?: Record<string, number>;
}

export interface DrsHistoryRow {
  year: number;
  position: number;
  g: number;
  ip: number;
  drs: number;
  zr: number;
  framing: number;
}

export interface DefensiveProjectionResult {
  defRuns: number;
  posAdj: number;
  /** Total = defRuns + posAdj */
  totalDefValue: number;
  /** Source used: 'drs', 'scouting', 'blended' */
  source: 'drs' | 'scouting' | 'blended';
}

// ──────────────────────────────────────────────
// Positional adjustments (runs per 162 games)
// ──────────────────────────────────────────────

const POSITION_ADJ: Record<number, number> = {
  [Position.Catcher]: 12.5,
  [Position.Shortstop]: 7.5,
  [Position.CenterField]: 2.5,
  [Position.SecondBase]: 2.5,
  [Position.ThirdBase]: 2.5,
  [Position.LeftField]: -7.5,
  [Position.RightField]: -7.5,
  [Position.FirstBase]: -12.5,
  [Position.DesignatedHitter]: -17.5,
};

// ──────────────────────────────────────────────
// ZiPS year-weights for 5-year window
// ──────────────────────────────────────────────

function yearWeight(yearsAgo: number): number {
  // Most recent = 3.0, then 2.0, 1.5, 1.0, 0.5
  const weights = [3.0, 2.0, 1.5, 1.0, 0.5];
  return weights[yearsAgo] ?? 0;
}

// ──────────────────────────────────────────────
// Defensive aging
// ──────────────────────────────────────────────

function defensiveAgingFactor(age: number): number {
  if (age > 27) return Math.max(0.40, 1.0 - (age - 27) * 0.035);
  if (age < 24) return 0.85 + (age - 20) * 0.0375;
  return 1.0;
}

// ──────────────────────────────────────────────
// Scouting → defensive runs estimate
// ──────────────────────────────────────────────

/**
 * Convert fielding scouting ratings to estimated defensive runs.
 * Position-specific: different positions weight different ratings.
 *
 * Scale: 50 = average (0 runs), each 10 points ≈ ±5 runs.
 * This is calibrated so that elite fielders (80) ≈ +15 runs,
 * terrible fielders (20) ≈ -15 runs.
 */
function scoutingToDefRuns(position: number, fielding: FieldingScouting): number {
  const scale = (rating: number | undefined): number => {
    if (rating === undefined || rating === 0) return 0;
    return (rating - 50) * 0.5;  // 10 points on 20-80 scale ≈ 5 runs
  };

  // Position-specific ability rating (pos2 for C, pos3 for 1B, etc.)
  const posKey = `pos${position}`;
  const posAbility = fielding.posRatings?.[posKey];
  const posScale = posAbility !== undefined ? scale(posAbility) : 0;

  switch (position) {
    case Position.Catcher:
      // Catcher: framing is huge, then blocking, arm
      return (
        scale(fielding.cFrm) * 0.50 +
        scale(fielding.cBlock) * 0.25 +
        scale(fielding.cArm) * 0.15 +
        posScale * 0.10
      );

    case Position.FirstBase:
      // 1B: minimal defensive value, mostly range and errors
      return (
        scale(fielding.ifRange) * 0.50 +
        scale(fielding.ifErr) * 0.30 +
        posScale * 0.20
      );

    case Position.SecondBase:
    case Position.Shortstop:
      // Middle infield: range dominant, DP important, arm matters
      return (
        scale(fielding.ifRange) * 0.40 +
        scale(fielding.ifDP) * 0.20 +
        scale(fielding.ifArm) * 0.20 +
        scale(fielding.ifErr) * 0.10 +
        posScale * 0.10
      );

    case Position.ThirdBase:
      // 3B: arm is key, range matters
      return (
        scale(fielding.ifArm) * 0.35 +
        scale(fielding.ifRange) * 0.35 +
        scale(fielding.ifErr) * 0.15 +
        posScale * 0.15
      );

    case Position.LeftField:
    case Position.RightField:
      // Corner OF: arm important, range less than CF
      return (
        scale(fielding.ofRange) * 0.35 +
        scale(fielding.ofArm) * 0.35 +
        scale(fielding.ofErr) * 0.15 +
        posScale * 0.15
      );

    case Position.CenterField:
      // CF: range is king
      return (
        scale(fielding.ofRange) * 0.55 +
        scale(fielding.ofArm) * 0.20 +
        scale(fielding.ofErr) * 0.10 +
        posScale * 0.15
      );

    case Position.DesignatedHitter:
      return 0;

    default:
      return 0;
  }
}

// ──────────────────────────────────────────────
// DRS → projected defensive runs
// ──────────────────────────────────────────────

/**
 * Project defensive runs from DRS history.
 * Uses ZiPS-style weighted ZR per IP, regressed toward 0 with 3000 IP stabilization.
 */
function drsToDefRuns(drsHistory: DrsHistoryRow[], currentYear: number): number {
  let weightedZr = 0;
  let weightedIp = 0;
  let weightedFraming = 0;

  for (const row of drsHistory) {
    const yearsAgo = currentYear - row.year;
    if (yearsAgo < 0 || yearsAgo > 4) continue;
    const w = yearWeight(yearsAgo);
    const ip = parseFloat(String(row.ip)) || 0;
    weightedZr += row.zr * w;
    weightedIp += ip * w;
    weightedFraming += row.framing * w;
  }

  if (weightedIp === 0) return 0;

  // Regress toward 0 using 3000 IP stabilization
  const zrPerIp = weightedZr / weightedIp;
  const rawIp = weightedIp;
  const zrRate = (zrPerIp * rawIp) / (rawIp + 3000);

  // Project over full season (1350 IP ≈ 162 games)
  const defRuns = zrRate * 1350;

  // Framing (catchers only, same regression)
  const framingPerIp = weightedFraming / weightedIp;
  const framingRate = (framingPerIp * rawIp) / (rawIp + 3000);
  const framingRuns = framingRate * 1350;

  return defRuns + framingRuns;
}

// ──────────────────────────────────────────────
// Best defensive position for prospects
// ──────────────────────────────────────────────

/**
 * For prospects/draftees with no MLB track record, find the position where
 * they'd provide the most total defensive value (defRuns + posAdj).
 * This avoids penalizing a draftee listed at CF who's really a corner OF.
 */
function bestDefensivePosition(
  fielding: FieldingScouting,
  age: number,
  projPa: number,
): { position: number; defRuns: number; posAdj: number } | null {
  const candidates = [
    Position.Catcher, Position.FirstBase, Position.SecondBase,
    Position.ThirdBase, Position.Shortstop,
    Position.LeftField, Position.CenterField, Position.RightField,
  ];

  let best: { position: number; defRuns: number; posAdj: number } | null = null;
  let bestTotal = -Infinity;

  for (const pos of candidates) {
    // Only consider positions where the player has a non-zero ability rating
    const posKey = `pos${pos}`;
    const posAbility = fielding.posRatings?.[posKey];
    if (posAbility === undefined || posAbility <= 0) continue;

    const rawDefRuns = scoutingToDefRuns(pos, fielding);
    const defRuns = Math.round(rawDefRuns * defensiveAgingFactor(age) * (projPa / 650) * 10) / 10;
    const posAdj = Math.round((POSITION_ADJ[pos] ?? 0) * (projPa / 650) * 10) / 10;
    const total = defRuns + posAdj;

    if (total > bestTotal) {
      bestTotal = total;
      best = { position: pos, defRuns, posAdj };
    }
  }

  return best;
}

// ──────────────────────────────────────────────
// Main projection function
// ──────────────────────────────────────────────

/**
 * Project defensive value for a player.
 *
 * @param position - Player's fielding position (Position enum)
 * @param age - Player's age
 * @param projPa - Projected plate appearances (for playing time proration)
 * @param fielding - Scouting fielding ratings (from scout API)
 * @param drsHistory - DRS history rows (optional, empty if API unavailable)
 * @param currentYear - Current season year
 * @param careerMlbIp - Career MLB innings played (for blend weight)
 */
export function projectDefensiveValue(
  position: number,
  age: number,
  projPa: number,
  fielding: FieldingScouting | null,
  drsHistory: DrsHistoryRow[] | null,
  currentYear: number,
  careerMlbIp: number = 0,
  isDraftee: boolean = false,
): DefensiveProjectionResult {
  // For draftees with fielding scouting, find their best defensive position
  // instead of using the game-assigned position (which may be suboptimal)
  if (isDraftee && fielding && fielding.posRatings) {
    const best = bestDefensivePosition(fielding, age, projPa);
    if (best) {
      return {
        defRuns: best.defRuns,
        posAdj: best.posAdj,
        totalDefValue: Math.round((best.defRuns + best.posAdj) * 10) / 10,
        source: 'scouting',
      };
    }
  }

  // DH gets no defensive value, only negative positional adjustment
  if (position === Position.DesignatedHitter) {
    const posAdj = (POSITION_ADJ[position] ?? 0) * (projPa / 650);
    return { defRuns: 0, posAdj: Math.round(posAdj * 10) / 10, totalDefValue: Math.round(posAdj * 10) / 10, source: 'scouting' };
  }

  // Positional adjustment, prorated by PA (650 = full season)
  const posAdj = (POSITION_ADJ[position] ?? 0) * (projPa / 650);

  // Calculate scouting-based estimate
  let scoutDefRuns = 0;
  if (fielding) {
    scoutDefRuns = scoutingToDefRuns(position, fielding);
  }

  // Calculate DRS-based estimate
  let drsDefRuns = 0;
  const hasDrs = drsHistory && drsHistory.length > 0;
  if (hasDrs) {
    drsDefRuns = drsToDefRuns(drsHistory, currentYear);
  }

  // Blend: weight DRS vs scouting by MLB IP
  // At 0 IP → 100% scouting, at 3000+ IP → ~90% DRS
  let defRuns: number;
  let source: DefensiveProjectionResult['source'];

  if (!hasDrs) {
    // No DRS data → pure scouting
    defRuns = scoutDefRuns;
    source = 'scouting';
  } else if (careerMlbIp === 0) {
    // Prospect with DRS somehow — still trust scouting more
    defRuns = scoutDefRuns;
    source = 'scouting';
  } else {
    // Blend: sigmoid-like weight toward DRS as IP increases
    const drsWeight = Math.min(0.90, careerMlbIp / (careerMlbIp + 1500));
    defRuns = drsDefRuns * drsWeight + scoutDefRuns * (1 - drsWeight);
    source = 'blended';
  }

  // Apply defensive aging
  defRuns *= defensiveAgingFactor(age);

  // Prorate by playing time (PA relative to full season)
  defRuns *= (projPa / 650);

  // Round to 1 decimal
  defRuns = Math.round(defRuns * 10) / 10;
  const roundedPosAdj = Math.round(posAdj * 10) / 10;

  return {
    defRuns,
    posAdj: roundedPosAdj,
    totalDefValue: Math.round((defRuns + roundedPosAdj) * 10) / 10,
    source,
  };
}

/**
 * Extract FieldingScouting from raw scouting data (from hitter_scouting.raw_data.fielding).
 */
export function parseFieldingScouting(rawFielding: any): FieldingScouting | null {
  if (!rawFielding) return null;

  const posRatings: Record<string, number> = {};
  for (let i = 2; i <= 9; i++) {
    const val = parseInt(rawFielding[`pos${i}`], 10);
    if (val > 0) posRatings[`pos${i}`] = val;
  }

  return {
    ifRange: parseInt(rawFielding.ifRange, 10) || undefined,
    ifArm: parseInt(rawFielding.ifArm, 10) || undefined,
    ifDP: parseInt(rawFielding.ifDP, 10) || undefined,
    ifErr: parseInt(rawFielding.ifErr, 10) || undefined,
    ofRange: parseInt(rawFielding.ofRange, 10) || undefined,
    ofArm: parseInt(rawFielding.ofArm, 10) || undefined,
    ofErr: parseInt(rawFielding.ofErr, 10) || undefined,
    cArm: parseInt(rawFielding.cArm, 10) || undefined,
    cBlock: parseInt(rawFielding.cBlock, 10) || undefined,
    cFrm: parseInt(rawFielding.cFrm, 10) || undefined,
    posRatings: Object.keys(posRatings).length > 0 ? posRatings : undefined,
  };
}
