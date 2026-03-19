/**
 * PlateAppearanceEngine — Phase 1
 *
 * Converts batter + pitcher rate stats into a probability vector for each PA,
 * then resolves outcomes via random sampling.
 *
 * Uses the log5 / odds-ratio matchup formula:
 *   P(event) = (P_batter × P_pitcher) / P_league
 * Renormalized so all outcomes sum to 1.0.
 */

import type { BatterSnapshot, PitcherSnapshot, LeagueAverageRates, PAOutcome } from './SimulationTypes';

// ============================================================================
// Probability Vector
// ============================================================================

export interface PAVector {
  pBB: number;
  pK: number;
  pHR: number;
  pTriple: number;
  pDouble: number;
  pSingle: number;
  pOut: number;
}

/** Build a league-average rate vector from aggregate batting data */
export function buildLeagueAverageRates(
  lgBbPct: number,
  lgKPct: number,
  lgHrRate: number,
  lgAvg: number,
  lgDoublesRate: number,
  lgTriplesRate: number,
): LeagueAverageRates {
  // Rates are per-PA
  const bbPct = lgBbPct;
  const kPct = lgKPct;
  // HR rate per PA = hrPerAb * (1 - bbPct)
  const hrRate = lgHrRate * (1 - bbPct);
  const doubleRate = lgDoublesRate * (1 - bbPct);
  const tripleRate = lgTriplesRate * (1 - bbPct);
  // Singles per PA: (AVG - HR/AB - 2B/AB - 3B/AB) * (1 - BB%)
  const singlesPerAb = lgAvg - lgHrRate - lgDoublesRate - lgTriplesRate;
  const singleRate = Math.max(0, singlesPerAb * (1 - bbPct));
  const outRate = Math.max(0, 1 - bbPct - kPct - hrRate - tripleRate - doubleRate - singleRate);
  return { bbPct, kPct, hrRate, singleRate, doubleRate, tripleRate, outRate };
}

// ============================================================================
// Log5 Matchup
// ============================================================================

/**
 * Combine batter and pitcher rates against a league baseline using log5.
 *
 * Two-stage approach:
 * 1. Log5 determines the "three true outcomes" (K, BB, HR) — these are
 *    influenced by both pitcher and batter.
 * 2. The remaining contact probability (1 - K - BB - HR) is distributed
 *    among batted-ball outcomes (1B, 2B, 3B, OUT) using the batter's
 *    batted-ball profile. Pitchers primarily influence TTO; batted-ball
 *    distribution is batter-driven.
 *
 * This ensures a good pitcher (high K, low BB/HR) properly suppresses
 * offense by reducing the contact pool, rather than just reshuffling
 * probability via normalization.
 */
export function computeMatchupVector(
  batter: BatterSnapshot,
  pitcher: PitcherSnapshot,
  league: LeagueAverageRates,
  out: PAVector,
): void {
  // Stage 1: Log5 for three true outcomes
  let pBB = log5(batter.pBB, pitcher.pBB, league.bbPct);
  let pK = log5(batter.pK, pitcher.pK, league.kPct);
  let pHR = log5(batter.pHR, pitcher.pHR, league.hrRate);

  // Clamp TTO total so contact rate stays non-negative
  const ttoTotal = pBB + pK + pHR;
  if (ttoTotal > 0.95) {
    const scale = 0.95 / ttoTotal;
    pBB *= scale;
    pK *= scale;
    pHR *= scale;
  }

  // Stage 2: Remaining probability goes to batted-ball contact outcomes
  const contactRate = 1 - pBB - pK - pHR;

  out.pBB = pBB;
  out.pK = pK;
  out.pHR = pHR;

  // Batter's batted-ball profile: how they distribute contact outcomes
  const batterContact = batter.pSingle + batter.pDouble + batter.pTriple + batter.pOut;
  if (batterContact <= 0) {
    out.pTriple = 0;
    out.pDouble = 0;
    out.pSingle = 0;
    out.pOut = contactRate;
    return;
  }

  out.pSingle = contactRate * (batter.pSingle / batterContact);
  out.pDouble = contactRate * (batter.pDouble / batterContact);
  out.pTriple = contactRate * (batter.pTriple / batterContact);
  out.pOut    = contactRate * (batter.pOut    / batterContact);
}

function log5(pBatter: number, pPitcher: number, pLeague: number): number {
  if (pLeague <= 0 || pLeague >= 1) return pBatter;
  const num = (pBatter * pPitcher) / pLeague;
  const den = num + ((1 - pBatter) * (1 - pPitcher)) / (1 - pLeague);
  if (den <= 0) return pBatter;
  return Math.max(0.001, Math.min(0.999, num / den));
}

// ============================================================================
// Outcome Resolution
// ============================================================================

/**
 * Sample an outcome from the probability vector using a uniform random number.
 */
export function resolvePA(vector: PAVector, rand: number): PAOutcome {
  let cumulative = 0;
  cumulative += vector.pBB;
  if (rand < cumulative) return 'BB';
  cumulative += vector.pK;
  if (rand < cumulative) return 'K';
  cumulative += vector.pHR;
  if (rand < cumulative) return 'HR';
  cumulative += vector.pTriple;
  if (rand < cumulative) return '3B';
  cumulative += vector.pDouble;
  if (rand < cumulative) return '2B';
  cumulative += vector.pSingle;
  if (rand < cumulative) return '1B';
  return 'OUT';
}

// ============================================================================
// Pitcher rate conversion helpers
// ============================================================================

const PA_PER_9_INNINGS = 38; // league average ~4.2 PA/IP × 9

/** Convert pitcher K/9, BB/9, HR/9 to per-PA rates */
export function pitcherRatesToPerPA(k9: number, bb9: number, hr9: number): { pK: number; pBB: number; pHR: number } {
  return {
    pK: Math.min(0.5, k9 / PA_PER_9_INNINGS),
    pBB: Math.min(0.3, bb9 / PA_PER_9_INNINGS),
    pHR: Math.min(0.15, hr9 / PA_PER_9_INNINGS),
  };
}

/** Convert batter per-AB rates to per-PA probability vector */
export function batterRatesToVector(
  bbPct: number,
  kPct: number,
  hrPct: number,
  avg: number,
  doublesRate: number,
  triplesRate: number,
): PAVector {
  // bbPct, kPct are already per-PA
  const pBB = bbPct;
  const pK = kPct;
  // Per-AB rates → per-PA: multiply by (1 - bbPct) since AB = PA - BB
  const contactFraction = 1 - pBB;
  const pHR = hrPct * contactFraction;
  const pDouble = doublesRate * contactFraction;
  const pTriple = triplesRate * contactFraction;
  // Singles per AB = AVG - HR/AB - 2B/AB - 3B/AB
  const singlesPerAb = Math.max(0, avg - hrPct - doublesRate - triplesRate);
  const pSingle = singlesPerAb * contactFraction;
  const pOut = Math.max(0, 1 - pBB - pK - pHR - pTriple - pDouble - pSingle);

  return { pBB, pK, pHR, pTriple, pDouble, pSingle, pOut };
}
