/**
 * GameEngine — Phase 2
 *
 * Simulates a single baseball game between two teams.
 * Tracks innings, outs, base state, score, lineup position.
 * Resolves each PA via PlateAppearanceEngine, advances runners.
 */

import type {
  TeamSnapshot,
  BatterSnapshot,
  LeagueAverageRates,
  GameResult,
  GameState,
  BaseState,
  PAOutcome,
} from './SimulationTypes';
import { computeMatchupVector, resolvePA, type PAVector } from './PlateAppearanceEngine';

// ============================================================================
// Random number generator (seedable via injection)
// ============================================================================

export type RNG = () => number; // returns [0, 1)

/** Simple xorshift128 PRNG for reproducible results */
export function createRNG(seed: number): RNG {
  let s = seed | 0;
  if (s === 0) s = 1;
  // xorshift32
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ============================================================================
// Game Simulation
// ============================================================================

const MAX_INNINGS = 18; // safety cap for extra innings

// ============================================================================
// Team Defense
// ============================================================================

/** Compute team defensive BABIP shift from lineup's projected defensive runs.
 *  defRuns values are already position-weighted (great SS > great 1B) by
 *  DefensiveProjectionService, so no manual positional weighting needed.
 *  Returns a value to subtract from pSingle and add to pOut.
 *  Positive = good defense (fewer hits), negative = bad defense (more hits). */
export function computeDefensiveShift(lineup: BatterSnapshot[]): number {
  // Sum projected defensive runs above average across fielders (exclude DH)
  let teamDefRuns = 0;
  for (const b of lineup) {
    if (b.position === 'DH') continue;
    teamDefRuns += b.defRuns;
  }
  // Convert season defRuns to per-BIP BABIP shift.
  // ~4300 BIP per team per season (162 games × ~38 PA/game × ~0.70 BIP rate).
  // Scaled aggressively (divisor ~1000) to reflect WBL's defense-heavy meta,
  // targeting ~2.5-3 wins for best defensive team vs average.
  return teamDefRuns / 1000;
}

/**
 * Simulate a single game between home and away teams.
 * Returns the final score and number of innings played.
 */
export function simulateGame(
  home: TeamSnapshot,
  away: TeamSnapshot,
  homeStarterIdx: number,
  awayStarterIdx: number,
  league: LeagueAverageRates,
  rng: RNG,
  onPA?: (batterId: number, pitcherId: number, outcome: PAOutcome, runsScored: number) => void,
  homeTiredPitchers?: Set<number>,
  awayTiredPitchers?: Set<number>,
  leagueDefShift?: number,
): GameResult {
  // Pre-allocate one PAVector and reuse it for every plate appearance in this game
  const paVector: PAVector = { pBB: 0, pK: 0, pHR: 0, pTriple: 0, pDouble: 0, pSingle: 0, pOut: 0 };

  // Team defensive BABIP shifts (centered around league average)
  const baseline = leagueDefShift ?? 0;
  const homeDefShift = computeDefensiveShift(home.lineup) - baseline;
  const awayDefShift = computeDefensiveShift(away.lineup) - baseline;

  const state: GameState = {
    inning: 1,
    isBottom: false,
    outs: 0,
    bases: [false, false, false],
    homeScore: 0,
    awayScore: 0,
    homeLineupIdx: 0,
    awayLineupIdx: 0,
    homePitcherIdx: homeStarterIdx,
    awayPitcherIdx: awayStarterIdx,
    homePitcherIsStarter: true,
    awayPitcherIsStarter: true,
    homePitcherPitchCount: 0,
    awayPitcherPitchCount: 0,
    homeSPRunsAllowed: 0,
    awaySPRunsAllowed: 0,
    homeSPInnings: 0,
    awaySPInnings: 0,
    homeCloserUsed: false,
    awayCloserUsed: false,
    homeSetupUsed: false,
    awaySetupUsed: false,
    homePinchedSlots: new Set<number>(),
    awayPinchedSlots: new Set<number>(),
    homeSB: 0,
    awaySB: 0,
  };

  while (true) {
    // Top of inning: away bats, home pitches
    state.isBottom = false;
    state.outs = 0;
    state.bases = [false, false, false];
    simulateHalfInning(state, away, home, league, rng, false, paVector, homeDefShift, onPA, awayTiredPitchers);

    // Bottom of inning: home bats, away pitches
    state.isBottom = true;
    state.outs = 0;
    state.bases = [false, false, false];

    // In bottom of 9+, if home is already winning, game is over
    if (state.inning >= 9 && state.homeScore > state.awayScore) {
      return buildGameResult(state, home, away);
    }

    simulateHalfInning(state, home, away, league, rng, true, paVector, awayDefShift, onPA, homeTiredPitchers);

    // Walk-off check: home took the lead during bottom of 9+
    if (state.inning >= 9 && state.homeScore > state.awayScore) {
      return buildGameResult(state, home, away);
    }

    // End of full inning: if 9+ and not tied, game over
    if (state.inning >= 9 && state.homeScore !== state.awayScore) {
      return buildGameResult(state, home, away);
    }

    state.inning++;

    // Safety: cap extra innings
    if (state.inning > MAX_INNINGS) {
      // Force a winner: team with more runs, or coin flip
      if (state.homeScore === state.awayScore) {
        if (rng() < 0.5) state.homeScore++;
        else state.awayScore++;
      }
      return buildGameResult(state, home, away);
    }
  }
}

function buildGameResult(state: GameState, home: TeamSnapshot, away: TeamSnapshot): GameResult {
  const homeWon = state.homeScore > state.awayScore;
  const margin = Math.abs(state.homeScore - state.awayScore);

  const homeCloserPlayerId = state.homeCloserUsed
    ? (home.bullpen[home.closerIdx]?.playerId ?? -1)
    : -1;
  const awayCloserPlayerId = state.awayCloserUsed
    ? (away.bullpen[away.closerIdx]?.playerId ?? -1)
    : -1;

  const homeCloserSave = state.homeCloserUsed && homeWon && margin <= 3;
  const awayCloserSave = state.awayCloserUsed && !homeWon && margin <= 3;

  return {
    homeScore: state.homeScore,
    awayScore: state.awayScore,
    innings: state.inning,
    homeCloserSave,
    awayCloserSave,
    homeCloserPlayerId,
    awayCloserPlayerId,
    homeSB: state.homeSB,
    awaySB: state.awaySB,
  };
}

// ============================================================================
// Half-Inning Simulation
// ============================================================================

function simulateHalfInning(
  state: GameState,
  battingTeam: TeamSnapshot,
  pitchingTeam: TeamSnapshot,
  league: LeagueAverageRates,
  rng: RNG,
  isHome: boolean,
  paVector: PAVector,
  fieldingDefShift: number,
  onPA?: (batterId: number, pitcherId: number, outcome: PAOutcome, runsScored: number) => void,
  tiredPitchers?: Set<number>,
): void {
  const lineupSize = battingTeam.lineup.length;
  if (lineupSize === 0) return;

  // Track whether SP was in at start of half-inning for innings counting
  const spWasInAtStart = isHome ? state.homePitcherIsStarter : state.awayPitcherIsStarter;

  while (state.outs < 3) {
    // Get current batter
    const lineupIdx = isHome ? state.homeLineupIdx : state.awayLineupIdx;

    // Check for pinch hit / position sub
    const batter = maybePinchHit(state, battingTeam, lineupIdx, isHome);

    // Check for pitching change before PA
    maybeChangePitcher(state, pitchingTeam, isHome, rng, tiredPitchers);

    const pitcher = getCurrentPitcher(state, pitchingTeam, isHome);

    // Compute matchup probability vector into shared paVector (no allocation).
    // Home advantage is pre-baked into home batter snapshots by the caller.
    computeMatchupVector(batter, pitcher, league, paVector);

    // Apply fielding team's defensive BABIP shift (shifts singles ↔ outs).
    if (fieldingDefShift !== 0) {
      const shift = Math.min(fieldingDefShift, paVector.pSingle);  // can't shift more singles than exist
      paVector.pSingle -= shift;
      paVector.pOut += shift;
    }

    // Resolve PA
    const outcome = resolvePA(paVector, rng());

    // Update pitch count for the pitching team's current pitcher
    if (isHome) {
      state.awayPitcherPitchCount += estimatePitches(outcome);
    } else {
      state.homePitcherPitchCount += estimatePitches(outcome);
    }

    // Process outcome
    const runsScored = advanceRunners(state.bases, outcome, rng, state.outs);

    // Stolen base attempt: runner on 1st with 2nd open, using SR/STE scouting ratings.
    // Uses the current batter as a proxy for the runner (the guy who just reached base
    // or was already on 1st). Not perfect but avoids tracking individual runner identity.
    //
    // SR (Stealing Aggressiveness) → attempts per 600 PA (piecewise linear):
    //   SR ≤ 55: attempts = -2.300 + 0.155 * SR
    //   55 < SR ≤ 70: attempts = -62.525 + 1.250 * SR
    //   SR > 70: attempts = -360.0 + 5.5 * SR
    // STE (Stealing Ability) → success rate: 0.160 + 0.0096 * STE
    if (state.bases[0] && !state.bases[1] && state.outs < 2) {
      const sr = batter.stealAggression;
      const ste = batter.stealAbility;
      const successRate = Math.min(0.95, Math.max(0.30, 0.160 + 0.0096 * ste));
      // Only attempt if success rate is above breakeven (~72.5%) — WBL league SB% is 72-75%
      if (successRate >= 0.72) {
        let attemptsPer600: number;
        if (sr <= 55) attemptsPer600 = Math.max(0, -2.300 + 0.155 * sr);
        else if (sr <= 70) attemptsPer600 = -62.525 + 1.250 * sr;
        else attemptsPer600 = -360.0 + 5.5 * sr;
        const attemptRate = Math.min(0.50, (attemptsPer600 / 600) * 4);
        if (rng() < attemptRate) {
          if (rng() < successRate) {
            state.bases[1] = true;
            state.bases[0] = false;
            if (isHome) state.homeSB++; else state.awaySB++;
          } else {
            state.outs++;
            state.bases[0] = false;
          }
        }
      }
    }

    // Track SP runs allowed
    if (isHome) {
      // Away team is pitching
      if (state.awayPitcherIsStarter) {
        state.awaySPRunsAllowed += runsScored;
      }
    } else {
      // Home team is pitching
      if (state.homePitcherIsStarter) {
        state.homeSPRunsAllowed += runsScored;
      }
    }

    if (outcome === 'K' || outcome === 'OUT') {
      state.outs++;
    }

    if (isHome) {
      state.homeScore += runsScored;
      state.homeLineupIdx = (lineupIdx + 1) % lineupSize;
    } else {
      state.awayScore += runsScored;
      state.awayLineupIdx = (lineupIdx + 1) % lineupSize;
    }

    // Fire onPA callback
    onPA?.(batter.playerId, getCurrentPitcherId(state, pitchingTeam, isHome), outcome, runsScored);

    // Walk-off: in bottom of 9+, home takes lead → end immediately
    if (isHome && state.inning >= 9 && state.homeScore > state.awayScore) {
      return;
    }
  }

  // End of half-inning: increment SP innings counter if starter is still in
  if (isHome) {
    if (spWasInAtStart && state.awayPitcherIsStarter) {
      state.awaySPInnings++;
    }
  } else {
    if (spWasInAtStart && state.homePitcherIsStarter) {
      state.homeSPInnings++;
    }
  }
}

// ============================================================================
// Runner Advancement
// ============================================================================

/**
 * Advance runners based on PA outcome. Returns runs scored.
 * Uses empirical MLB probabilities for runner advancement on contact.
 *
 * Key probabilities (from MLB run expectancy data):
 *   Single:  Runner on 2nd scores ~68%. Runner on 1st reaches 3rd ~30%.
 *   Double:  Runner on 1st scores ~52% (otherwise to 3rd).
 *   Out:     Sac fly (runner on 3rd scores) ~18% with < 2 outs only.
 *            Groundout scores runner from 3rd ~10% with < 2 outs.
 *            Productive groundout (runner on 2nd → 3rd) ~18% with < 2 outs only.
 *            Both effects are zero with 2 outs since the out ends the inning before any advancement matters.
 */
function advanceRunners(bases: BaseState, outcome: PAOutcome, rng: RNG, outs: number): number {
  let runs = 0;

  switch (outcome) {
    case 'HR':
      // Everyone scores, including batter
      runs = 1 + (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0);
      bases[0] = false;
      bases[1] = false;
      bases[2] = false;
      break;

    case '3B':
      // All runners score, batter to 3rd
      runs = (bases[0] ? 1 : 0) + (bases[1] ? 1 : 0) + (bases[2] ? 1 : 0);
      bases[0] = false;
      bases[1] = false;
      bases[2] = true;
      break;

    case '2B': {
      // Runner on 3rd always scores
      if (bases[2]) runs++;
      // Runner on 2nd always scores
      if (bases[1]) runs++;
      // Runner on 1st: scores 52%, otherwise to 3rd
      let r1to3on2B = false;
      if (bases[0]) {
        if (rng() < 0.52) runs++;
        else r1to3on2B = true;
      }
      // Reset bases: batter to 2nd, possibly runner from 1st on 3rd
      bases[0] = false;
      bases[1] = true;
      bases[2] = r1to3on2B;
      break;
    }

    case '1B': {
      // Runner on 3rd always scores
      if (bases[2]) runs++;
      // Runner on 2nd: scores 68%, otherwise to 3rd
      let new3rd = false;
      if (bases[1]) {
        if (rng() < 0.68) runs++;
        else new3rd = true;
      }
      // Runner on 1st: to 3rd 30% (if open), otherwise to 2nd
      let new2nd = false;
      if (bases[0]) {
        if (!new3rd && rng() < 0.30) new3rd = true;
        else new2nd = true;
      }
      // Set final base state
      bases[0] = true;   // batter
      bases[1] = new2nd;
      bases[2] = new3rd;
      break;
    }

    case 'BB':
      // Forced advances only
      if (bases[0] && bases[1] && bases[2]) {
        // Bases loaded: run scores
        runs = 1;
        // bases stay loaded
      } else if (bases[0] && bases[1]) {
        // 1st + 2nd: advance to 1st+2nd+3rd
        bases[2] = true;
      } else if (bases[0]) {
        // Runner on 1st → 2nd
        bases[1] = true;
      }
      bases[0] = true;
      break;

    case 'K':
    case 'OUT':
      // Non-K outs can advance runners, but only with < 2 outs — with 2 outs the
      // inning ends on the out, so no runners can score or advance afterward.
      // K never advances runners (no contact).
      if (outcome === 'OUT' && outs < 2) {
        // Sac fly: runner on 3rd scores ~18% of non-K outs with < 2 outs
        if (bases[2] && rng() < 0.18) {
          runs++;
          bases[2] = false;
        }
        // Groundout with runner on 3rd: scores ~10% (productive groundout to IF)
        if (bases[2] && rng() < 0.10) {
          runs++;
          bases[2] = false;
        }
        // Productive groundout: runner on 2nd advances to 3rd ~18% of the time
        if (bases[1] && !bases[2] && rng() < 0.18) {
          bases[2] = true;
          bases[1] = false;
        }
      }
      break;
  }

  return runs;
}

// ============================================================================
// Pitcher Management
// ============================================================================

function getCurrentPitcher(state: GameState, pitchingTeam: TeamSnapshot, isHomeBatting: boolean) {
  if (isHomeBatting) {
    // Away team is pitching
    if (state.awayPitcherIsStarter) {
      return pitchingTeam.rotation[state.awayPitcherIdx % pitchingTeam.rotation.length];
    }
    const bpIdx = state.awayPitcherIdx % Math.max(1, pitchingTeam.bullpen.length);
    return pitchingTeam.bullpen[bpIdx] ?? pitchingTeam.rotation[0];
  } else {
    // Home team is pitching
    if (state.homePitcherIsStarter) {
      return pitchingTeam.rotation[state.homePitcherIdx % pitchingTeam.rotation.length];
    }
    const bpIdx = state.homePitcherIdx % Math.max(1, pitchingTeam.bullpen.length);
    return pitchingTeam.bullpen[bpIdx] ?? pitchingTeam.rotation[0];
  }
}

function getCurrentPitcherId(state: GameState, pitchingTeam: TeamSnapshot, isHomeBatting: boolean): number {
  return getCurrentPitcher(state, pitchingTeam, isHomeBatting).playerId;
}

// Normal reliever stint is ~1 inning; mopup relievers in blowouts go longer
const RELIEVER_PITCH_LIMIT = 35;
const MOPUP_PITCH_LIMIT = 75;   // MR 4+ in blowout losses can go multiple innings
const EXTRA_INNING_PITCH_LIMIT = 50; // any reliever cycles after ~1.5 innings in extras

/** Index of the setup man (2nd-best RP, index 1 after bullpen is sorted desc by trueRating) */
function getSetupIdx(team: TeamSnapshot): number {
  return team.bullpen.length > 1 ? (team.closerIdx + 1) % team.bullpen.length : team.closerIdx;
}

/**
 * Starting bullpen index when the starter is first pulled.
 * Skips the closer (index 0) and setup man (index 1) — they have dedicated roles.
 * Falls back to index 0 if bullpen is too small.
 */
function firstMiddleRelievertIdx(team: TeamSnapshot): number {
  return team.bullpen.length > 2 ? 2 : 0;
}

/**
 * Find the next available (non-tired) reliever starting at startIdx.
 * If all relievers are tired, falls back to startIdx anyway.
 */
function findAvailableRelievertIdx(
  startIdx: number,
  team: TeamSnapshot,
  tiredPitchers?: Set<number>,
): number {
  const n = team.bullpen.length;
  if (n === 0) return 0;
  let idx = startIdx % n;
  if (!tiredPitchers || tiredPitchers.size === 0) return idx;
  for (let i = 0; i < n; i++) {
    if (!tiredPitchers.has(team.bullpen[idx].playerId)) return idx;
    idx = (idx + 1) % n;
  }
  return startIdx % n; // all tired, fall back
}

/**
 * Advance to the next middle reliever, skipping the closer (index 0) and setup man (index 1).
 */
function nextMiddleRelievertIdx(currentIdx: number, team: TeamSnapshot): number {
  const n = team.bullpen.length;
  if (n <= 1) return 0;
  const closer = team.closerIdx;
  const setup = getSetupIdx(team);
  let next = (currentIdx + 1) % n;
  for (let guard = 0; guard < n; guard++) {
    if (next !== closer && next !== setup) return next;
    if (n <= 3) return next; // no choice
    next = (next + 1) % n;
  }
  return next;
}

function maybeChangePitcher(
  state: GameState,
  pitchingTeam: TeamSnapshot,
  isHomeBatting: boolean,
  _rng: RNG,
  tiredPitchers?: Set<number>,
): void {
  if (pitchingTeam.bullpen.length === 0) return;

  const pitchingScore = isHomeBatting ? state.awayScore : state.homeScore;
  const battingScore  = isHomeBatting ? state.homeScore : state.awayScore;
  const lead = pitchingScore - battingScore; // positive = pitching team is winning
  const isBlowoutLoss = lead < -3;

  // ── Starter hook ──
  const isStarter = isHomeBatting ? state.awayPitcherIsStarter : state.homePitcherIsStarter;
  if (isStarter) {
    const pitchCount    = isHomeBatting ? state.awayPitcherPitchCount : state.homePitcherPitchCount;
    const spRunsAllowed = isHomeBatting ? state.awaySPRunsAllowed    : state.homeSPRunsAllowed;
    const spInnings     = isHomeBatting ? state.awaySPInnings        : state.homeSPInnings;

    const starterIdx = isHomeBatting ? state.awayPitcherIdx : state.homePitcherIdx;
    const currentStarter = pitchingTeam.rotation[starterIdx % pitchingTeam.rotation.length];
    // Stamina-based pitch limit: 40 stamina → 90 pitches, 70 stamina → 120 pitches (clamped to [70, 130])
    const pitchLimit = Math.max(70, Math.min(130, (currentStarter?.stamina ?? 50) + 50));

    const earlyHook  = spRunsAllowed > 5 && spInnings <= 4;
    const normalHook = pitchCount >= pitchLimit || (state.inning >= 8 && state.outs === 0 && pitchCount >= 90) || (state.inning >= 7 && state.outs === 0 && pitchCount >= 75 && spRunsAllowed > 3);

    if (earlyHook || normalHook) {
      // In a blowout loss with enough bullpen depth, start with a mopup arm (index 3+)
      const startIdx = (isBlowoutLoss && pitchingTeam.bullpen.length > 4)
        ? findAvailableRelievertIdx(3, pitchingTeam, tiredPitchers)
        : findAvailableRelievertIdx(firstMiddleRelievertIdx(pitchingTeam), pitchingTeam, tiredPitchers);

      if (isHomeBatting) {
        state.awayPitcherIsStarter = false;
        state.awayPitcherIdx = startIdx;
        state.awayPitcherPitchCount = 0;
      } else {
        state.homePitcherIsStarter = false;
        state.homePitcherIdx = startIdx;
        state.homePitcherPitchCount = 0;
      }
    }
  }

  if (isHomeBatting ? state.awayPitcherIsStarter : state.homePitcherIsStarter) return;

  const currentIdx = isHomeBatting ? state.awayPitcherIdx : state.homePitcherIdx;
  const pitchCount = isHomeBatting ? state.awayPitcherPitchCount : state.homePitcherPitchCount;
  const closer     = pitchingTeam.closerIdx;
  const setup      = getSetupIdx(pitchingTeam);
  const isHighValueArm = currentIdx === closer || currentIdx === setup;

  // ── Closer: enters 9th+ at inning start when team is winning ──
  const closerUsed = isHomeBatting ? state.awayCloserUsed : state.homeCloserUsed;
  if (!closerUsed && state.inning >= 9 && lead >= 1 && state.outs === 0 && currentIdx !== closer) {
    const cp = pitchingTeam.bullpen[closer];
    if (!tiredPitchers?.has(cp.playerId)) {
      if (isHomeBatting) {
        state.awayPitcherIdx = closer;
        state.awayPitcherPitchCount = 0;
        state.awayCloserUsed = true;
      } else {
        state.homePitcherIdx = closer;
        state.homePitcherPitchCount = 0;
        state.homeCloserUsed = true;
      }
      return;
    }
  }

  // ── Setup man: enters 7th or 8th at inning start when not getting blown out ──
  const setupUsed = isHomeBatting ? state.awaySetupUsed : state.homeSetupUsed;
  if (!setupUsed && !isHighValueArm && state.inning >= 7 && state.inning <= 8
      && lead > -3 && state.outs === 0) {
    const sp = pitchingTeam.bullpen[setup];
    if (!tiredPitchers?.has(sp.playerId)) {
      if (isHomeBatting) {
        state.awayPitcherIdx = setup;
        state.awayPitcherPitchCount = 0;
        state.awaySetupUsed = true;
      } else {
        state.homePitcherIdx = setup;
        state.homePitcherPitchCount = 0;
        state.homeSetupUsed = true;
      }
      return;
    }
  }

  // ── Extra innings: force-cycle any reliever (including high-value) after ~1.5 innings ──
  if (state.inning > 9 && pitchCount >= EXTRA_INNING_PITCH_LIMIT && state.outs === 0) {
    const nextIdx = findAvailableRelievertIdx(
      nextMiddleRelievertIdx(currentIdx, pitchingTeam), pitchingTeam, tiredPitchers);
    if (isHomeBatting) { state.awayPitcherIdx = nextIdx; state.awayPitcherPitchCount = 0; }
    else               { state.homePitcherIdx = nextIdx; state.homePitcherPitchCount = 0; }
    return;
  }

  // ── Setup man: cycle at the next inning boundary after his stint (1 inning only) ──
  // pitchCount > 0 means he's already thrown pitches this game, so he's done his inning.
  if (currentIdx === setup && pitchCount > 0 && state.outs === 0) {
    const nextIdx = findAvailableRelievertIdx(
      nextMiddleRelievertIdx(currentIdx, pitchingTeam), pitchingTeam, tiredPitchers);
    if (isHomeBatting) { state.awayPitcherIdx = nextIdx; state.awayPitcherPitchCount = 0; }
    else               { state.homePitcherIdx = nextIdx; state.homePitcherPitchCount = 0; }
    return;
  }

  // ── Closer stays through the 9th (extras handled by the force-cycle above) ──
  if (currentIdx === closer) return;

  // ── Cycle middle relievers at inning boundaries ──
  // Mopup arms (index 3+) go longer when team is losing big
  const pitchLimit = (isBlowoutLoss && currentIdx >= 3) ? MOPUP_PITCH_LIMIT : RELIEVER_PITCH_LIMIT;
  if (pitchCount >= pitchLimit && state.outs === 0) {
    const nextIdx = findAvailableRelievertIdx(
      nextMiddleRelievertIdx(currentIdx, pitchingTeam), pitchingTeam, tiredPitchers);
    if (isHomeBatting) { state.awayPitcherIdx = nextIdx; state.awayPitcherPitchCount = 0; }
    else               { state.homePitcherIdx = nextIdx; state.homePitcherPitchCount = 0; }
  }
}

// ============================================================================
// Pinch Hitting / Position Substitutions
// ============================================================================

function maybePinchHit(
  state: GameState,
  battingTeam: TeamSnapshot,
  lineupIdx: number,
  isHome: boolean,
): BatterSnapshot {
  const slotIdx = lineupIdx % battingTeam.lineup.length;
  const currentBatter = battingTeam.lineup[slotIdx];

  // Only in late innings when losing
  if (state.inning < 7 || state.inning > 9) return currentBatter;

  const battingScore = isHome ? state.homeScore : state.awayScore;
  const pitchingScore = isHome ? state.awayScore : state.homeScore;
  if (battingScore >= pitchingScore) return currentBatter;

  if (battingTeam.bench.length === 0) return currentBatter;

  const pinchedSlots = isHome ? state.homePinchedSlots : state.awayPinchedSlots;
  if (pinchedSlots.has(slotIdx)) return currentBatter;

  // Find bench players not already in lineup
  const usedBenchIds = new Set(battingTeam.lineup.map(b => b.playerId));
  const availableBench = battingTeam.bench.filter(b => !usedBenchIds.has(b.playerId));
  if (availableBench.length === 0) return currentBatter;

  // Position sub check first: if player's position rating < 55 and bench has better option
  if (currentBatter.positionRating < 55) {
    const betterPositionPlayer = availableBench.find(
      b => b.position === currentBatter.position && b.positionRating > currentBatter.positionRating,
    );
    if (betterPositionPlayer) {
      pinchedSlots.add(slotIdx);
      return betterPositionPlayer;
    }
  }

  // Pinch hit: find best bench player by woba
  const bestBench = availableBench.reduce((best, b) => b.woba > best.woba ? b : best, availableBench[0]);

  if (bestBench.woba > currentBatter.woba) {
    pinchedSlots.add(slotIdx);
    return bestBench;
  }

  return currentBatter;
}

/** Estimate pitches per PA outcome — calibrated to ~3.4 pitches/PA to match
 *  WBL in-game data (~14.7 pitches/IP, ~90 PPG for 6+ IP starts). */
function estimatePitches(outcome: PAOutcome): number {
  switch (outcome) {
    case 'BB': return 4.8;
    case 'K': return 4.1;
    case 'HR': return 2.9;
    case '1B': case '2B': case '3B': return 2.9;
    case 'OUT': return 3.1;
    default: return 3.3;
  }
}
