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
// Calibration Constants (tune these to match WBL historical team stat ranges)
// ============================================================================

// Spread amplification: amplify batter/pitcher deviations from league average
// before log5 to counteract log5's compression of extreme rates.
// >1 = more spread between good and bad hitters/pitchers.
const HR_BATTER_SPREAD = 1.50;    // Power hitters hit more HR, weak hitters fewer
const HR_PITCHER_SPREAD = 1.50;   // Bad pitchers allow more HR, good pitchers fewer
const K_PITCHER_SPREAD = 1.50;    // Good K pitchers K more, bad K fewer
const POST_HR_MULT = 1.12;        // Post-log5 HR boost (NOT absorbed by league baseline)

// XBH contact-pool protection: fraction of batter's raw 2B/3B rate preserved
// from contact-pool compression. The contact pool (1-BB-K-HR) shrinks when
// facing good pitchers, which uniformly suppresses all contact outcomes.
// In reality, doubles/triples are more batter-driven than pitcher-driven.
// 0 = full compression (current), 1 = ignore pitching effect on XBH entirely.
const XBH_PROTECT = 0.40;

// ============================================================================
// Log5 Matchup
// ============================================================================

/**
 * Combine batter and pitcher rates against a league baseline using log5.
 *
 * Two-stage approach:
 * 1. Log5 determines the "three true outcomes" (K, BB, HR) — these are
 *    influenced by both pitcher and batter. Spread amplification on HR and
 *    pitcher K to counteract log5 compression.
 * 2. The remaining contact probability (1 - K - BB - HR) is distributed
 *    among batted-ball outcomes (1B, 2B, 3B, OUT) using the batter's
 *    batted-ball profile. XBH rates are partially protected from contact-pool
 *    compression via blending with the batter's raw rate.
 */
export function computeMatchupVector(
  batter: BatterSnapshot,
  pitcher: PitcherSnapshot,
  league: LeagueAverageRates,
  out: PAVector,
): void {
  // Stage 1: Log5 for three true outcomes with spread amplification
  // Amplify deviations from league average before log5
  const ampBatterHR = Math.max(0.001, league.hrRate + (batter.pHR - league.hrRate) * HR_BATTER_SPREAD);
  const ampPitcherHR = Math.max(0.001, league.hrRate + (pitcher.pHR - league.hrRate) * HR_PITCHER_SPREAD);
  const ampPitcherK = Math.max(0.01, league.kPct + (pitcher.pK - league.kPct) * K_PITCHER_SPREAD);

  let pBB = log5(batter.pBB, pitcher.pBB, league.bbPct);
  let pK = log5(batter.pK, ampPitcherK, league.kPct);
  let pHR = log5(ampBatterHR, ampPitcherHR, league.hrRate) * POST_HR_MULT;

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

  // XBH contact-pool protection: blend compressed rate with batter's raw rate
  // to preserve more individual variance in doubles/triples
  const batterNaturalContact = 1 - batter.pBB - batter.pK - batter.pHR;
  const xbhContact = contactRate * (1 - XBH_PROTECT) + batterNaturalContact * XBH_PROTECT;

  let rawDouble = xbhContact * (batter.pDouble / batterContact);
  let rawTriple = xbhContact * (batter.pTriple / batterContact);

  // Clamp XBH so they don't exceed the actual contact rate
  const xbhTotal = rawDouble + rawTriple;
  if (xbhTotal > contactRate * 0.40) {
    const scale = (contactRate * 0.40) / xbhTotal;
    rawDouble *= scale;
    rawTriple *= scale;
  }

  out.pDouble = rawDouble;
  out.pTriple = rawTriple;

  // Singles and outs get the remainder, proportioned by batter profile
  const remaining = contactRate - out.pDouble - out.pTriple;
  const soTotal = batter.pSingle + batter.pOut;
  if (soTotal > 0) {
    out.pSingle = remaining * (batter.pSingle / soTotal);
    out.pOut = remaining * (batter.pOut / soTotal);
  } else {
    out.pSingle = 0;
    out.pOut = remaining;
  }
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
