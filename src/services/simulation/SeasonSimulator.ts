/**
 * SeasonSimulator — Phase 4
 *
 * Generates a balanced 162-game schedule and runs N Monte Carlo season simulations.
 * Determines standings, playoff qualifiers, and championship winners.
 * Tracks per-player stats and builds leaderboards.
 */

import type {
  TeamSnapshot,
  BatterSnapshot,
  PitcherSnapshot,
  LeagueAverageRates,
  ScheduledGame,
  TeamSeasonRecord,
  TeamSummary,
  SimulationResults,
  SimConfig,
  SimProgressCallback,
  TeamSeasonState,
  PlayerGameStats,
  PitcherGameStats,
  SimPlayerBattingStats,
  SimPlayerPitchingStats,
  SimLeaderboards,
  PAOutcome,
} from './SimulationTypes';
import { simulateGame, createRNG, computeDefensiveShift, type RNG } from './GameEngine';

// ============================================================================
// Injury-Based Pitcher Availability
// ============================================================================

/** Probability that an SP misses their rotation turn due to injury.
 *  162 games / 5 starters = 32.4 baseline GS.
 *  Target GS: Iron Man ~33, Durable ~32, Normal ~31, Fragile ~28, Wrecked ~24 */
function getSpInjurySkipProb(injuryProneness?: string): number {
  switch (injuryProneness) {
    case 'Iron Man': return 0.00;
    case 'Durable':  return 0.02;
    case 'Normal':   return 0.05;
    case 'Fragile':  return 0.12;
    case 'Wrecked':  return 0.25;
    default:         return 0.05;
  }
}

/** Probability that an RP is unavailable for a given game due to injury */
function getRpInjurySkipProb(injuryProneness?: string): number {
  switch (injuryProneness) {
    case 'Iron Man': return 0.00;
    case 'Durable':  return 0.01;
    case 'Normal':   return 0.03;
    case 'Fragile':  return 0.08;
    case 'Wrecked':  return 0.18;
    default:         return 0.03;
  }
}

// Replacement-level SP used when a scheduled starter is injured.
// Rates: 7.5 K/9, 3.0 BB/9, 1.2 HR/9 (PA_PER_9 = 38).
const REPLACEMENT_SP: PitcherSnapshot = {
  playerId: -9999,
  name: 'IL Replacement',
  role: 'SP',
  pK: 7.5 / 38,
  pBB: 3.0 / 38,
  pHR: 1.2 / 38,
  projectedIp: 150,
  stamina: 40,
  trueRating: 25,
  injuryProneness: 'Normal',
};

// ============================================================================
// Schedule Generation
// ============================================================================

/**
 * Generate a balanced 162-game schedule for all teams.
 * Each team plays every other team roughly evenly, with slight division weighting.
 */
export function generateSchedule(teams: TeamSnapshot[]): ScheduledGame[] {
  const n = teams.length;
  if (n < 2) return [];

  // Build division lookup
  const teamDivMap = new Map<number, number>();
  for (const t of teams) {
    teamDivMap.set(t.teamId, t.divisionId);
  }
  void teamDivMap;

  const schedule: ScheduledGame[] = [];

  // Division-weighted schedule, exactly 162 games per team:
  //   4 division rivals × 18 games = 72
  //   5 same-league other-div × 8  = 40
  //   10 interleague × 5           = 50
  //   Total                        = 162

  for (let i = 0; i < n; i++) {
    const teamA = teams[i];
    for (let j = i + 1; j < n; j++) {
      const teamB = teams[j];

      const sameDivision = teamA.divisionId === teamB.divisionId;
      const sameLeague = teamA.leagueId === teamB.leagueId;

      let totalGames: number;
      if (sameDivision) {
        totalGames = 18;
      } else if (sameLeague) {
        totalGames = 8;
      } else {
        totalGames = 5;
      }

      const homeA = Math.ceil(totalGames / 2);
      const homeB = totalGames - homeA;

      for (let g = 0; g < homeA; g++) {
        schedule.push({ homeTeamId: teamA.teamId, awayTeamId: teamB.teamId });
      }
      for (let g = 0; g < homeB; g++) {
        schedule.push({ homeTeamId: teamB.teamId, awayTeamId: teamA.teamId });
      }
    }
  }

  return schedule;
}

// ============================================================================
// Season Simulation
// ============================================================================

/** How many sims to run before yielding to the browser for UI repaints */
const YIELD_BATCH_SIZE = 10;

/**
 * Run a full Monte Carlo season simulation.
 * Async — yields to the browser every batch so the progress bar updates.
 */
export async function runSeasonSimulation(
  teams: TeamSnapshot[],
  league: LeagueAverageRates,
  config: SimConfig,
  onProgress?: SimProgressCallback,
): Promise<SimulationResults> {
  const startTime = performance.now();
  const schedule = generateSchedule(teams);
  const teamMap = new Map(teams.map(t => [t.teamId, t]));

  // Pre-bake home field advantage into batter snapshots once per sim run.
  // Each team's home-boosted snapshot is used whenever they bat at home.
  const homeBoost = (config.homeFieldAdvantage - 0.5) * 0.4;
  const homeBoostedTeamMap = new Map(teams.map(t => [t.teamId, buildHomeBoostTeam(t, homeBoost)]));

  // Compute league-average defensive shift so team shifts are centered around 0
  const leagueDefShift = teams.reduce((s, t) => s + computeDefensiveShift(t.lineup), 0) / teams.length;

  // Accumulate per-team results across all sims
  const allRecords = new Map<number, TeamSeasonRecord[]>();
  // Track championship leaders for fun progress display
  const champCounts = new Map<number, number>();
  for (const t of teams) {
    allRecords.set(t.teamId, []);
    champCounts.set(t.teamId, 0);
  }

  // Build player → team/league map for leaderboards
  const playerTeamMap = new Map<number, { teamId: number; leagueId: number; name: string }>();
  for (const t of teams) {
    for (const b of [...t.lineup, ...t.bench]) {
      playerTeamMap.set(b.playerId, { teamId: t.teamId, leagueId: t.leagueId, name: b.name });
    }
    for (const p of [...t.rotation, ...t.bullpen]) {
      playerTeamMap.set(p.playerId, { teamId: t.teamId, leagueId: t.leagueId, name: p.name });
    }
  }

  // Running totals across all sims for leaderboards
  const allSimBatterTotals = new Map<number, PlayerGameStats & { woba: number; wobaSum: number }>();
  const allSimPitcherTotals = new Map<number, PitcherGameStats>();
  const allSimGsTotals = new Map<number, number>(); // pitcher playerId → total GS across all sims

  for (let sim = 0; sim < config.numSimulations; sim++) {
    const { records: seasonResult, batterStats, pitcherStats, gsStats } =
      simulateOneSeason(teams, schedule, teamMap, homeBoostedTeamMap, league, config, sim, leagueDefShift, playerTeamMap);

    // Store records and track champions
    for (const [teamId, rec] of seasonResult) {
      allRecords.get(teamId)!.push(rec);
      if (rec.wonChampionship) {
        champCounts.set(teamId, (champCounts.get(teamId) ?? 0) + 1);
      }
    }

    // Aggregate player stats into team-level records for this season
    // (includes phantom callup players registered via phantomRegistry)
    for (const [pid, bs] of batterStats) {
      const info = playerTeamMap.get(pid);
      if (!info) continue;
      const rec = seasonResult.get(info.teamId);
      if (!rec) continue;
      rec.battingAB += bs.ab;
      rec.battingH += bs.h;
      rec.battingHR += bs.hr;
      rec.battingBB += bs.bb;
      rec.battingK += bs.k;
      rec.batting2B += bs.doubles;
      rec.batting3B += bs.triples;
    }
    for (const [pid, ps] of pitcherStats) {
      const info = playerTeamMap.get(pid);
      if (!info || pid < 0) continue;
      const rec = seasonResult.get(info.teamId);
      if (!rec) continue;
      rec.pitchingOuts += ps.outs;
      rec.pitchingER += ps.er;
      rec.pitchingK += ps.k;
      rec.pitchingBB += ps.bb;
      rec.pitchingHR += ps.hr;
    }

    // Accumulate batter stats
    for (const [pid, bs] of batterStats) {
      let acc = allSimBatterTotals.get(pid);
      if (!acc) {
        acc = { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, k: 0, doubles: 0, triples: 0, woba: 0, wobaSum: 0 };
        allSimBatterTotals.set(pid, acc);
      }
      acc.pa += bs.pa;
      acc.ab += bs.ab;
      acc.h += bs.h;
      acc.hr += bs.hr;
      acc.bb += bs.bb;
      acc.k += bs.k;
      acc.doubles += bs.doubles;
      acc.triples += bs.triples;
      // woba approximation from counting stats (per-sim)
      const simWoba = bs.pa > 0
        ? (0.69 * bs.bb + 0.89 * (bs.h - bs.hr - bs.doubles - bs.triples) + 1.27 * bs.doubles + 1.62 * bs.triples + 2.10 * bs.hr) / bs.pa
        : 0;
      acc.wobaSum += simWoba;
    }

    // Accumulate pitcher stats
    for (const [pid, ps] of pitcherStats) {
      let acc = allSimPitcherTotals.get(pid);
      if (!acc) {
        acc = { outs: 0, er: 0, h: 0, hr: 0, bb: 0, k: 0, saves: 0 };
        allSimPitcherTotals.set(pid, acc);
      }
      acc.outs += ps.outs;
      acc.er += ps.er;
      acc.h += ps.h;
      acc.hr += ps.hr;
      acc.bb += ps.bb;
      acc.k += ps.k;
      acc.saves += ps.saves;
    }

    // Accumulate games started
    for (const [pid, gs] of gsStats) {
      allSimGsTotals.set(pid, (allSimGsTotals.get(pid) ?? 0) + gs);
    }

    // Yield to browser every batch for UI updates
    if ((sim + 1) % YIELD_BATCH_SIZE === 0 || sim === config.numSimulations - 1) {
      const champLeader = getChampLeader(champCounts, teams);
      const status = champLeader
        ? `${champLeader.name} leads with ${champLeader.count} title${champLeader.count !== 1 ? 's' : ''}`
        : `Simulating seasons...`;
      onProgress?.(sim + 1, config.numSimulations, status);
      // Yield to browser — allows DOM repaint
      await yieldToUI();
    }
  }

  onProgress?.(config.numSimulations, config.numSimulations, 'Aggregating results...');
  await yieldToUI();

  const teamSummaries = aggregateResults(teams, allRecords, config.numSimulations);

  // Build leaderboards from accumulated stats
  const leaderboards = buildLeaderboards(
    allSimBatterTotals,
    allSimPitcherTotals,
    allSimGsTotals,
    playerTeamMap,
    teams,
    config.numSimulations,
  );

  // ── Defense diagnostic: show team def rating vs RA/G ──
  const defDiag = teams.map(t => {
    const summary = teamSummaries.find(s => s.teamId === t.teamId);
    const defRating = computeDefensiveShift(t.lineup) - leagueDefShift;
    const raPerGame = summary ? summary.meanRA / 162 : 0;
    return { abbr: t.abbr, defShift: defRating, raPerGame };
  }).sort((a, b) => b.defShift - a.defShift);
  console.log(`[Sim Defense] Team def shift vs RA/G (centered, positive = above-avg defense):`);
  for (const d of defDiag.slice(0, 5)) {
    console.log(`  ${d.abbr}: shift=${d.defShift > 0 ? '+' : ''}${(d.defShift * 1000).toFixed(1)} pts, RA/G=${d.raPerGame.toFixed(2)}`);
  }
  console.log(`  ...`);
  for (const d of defDiag.slice(-5)) {
    console.log(`  ${d.abbr}: shift=${d.defShift > 0 ? '+' : ''}${(d.defShift * 1000).toFixed(1)} pts, RA/G=${d.raPerGame.toFixed(2)}`);
  }

  // Per-player breakdown for best and worst 3 defensive teams
  const detailTeams = [...defDiag.slice(0, 3), ...defDiag.slice(-3)];
  for (const d of detailTeams) {
    const team = teams.find(t => t.abbr === d.abbr);
    if (!team) continue;
    
  }
  // ── end defense diagnostic ──

  // ── Team stat calibration diagnostic ──
  const sorted = [...teamSummaries].sort((a, b) => b.meanWins - a.meanWins);
  const statMin = (fn: (s: TeamSummary) => number) => Math.round(Math.min(...sorted.map(fn)));
  const statMax = (fn: (s: TeamSummary) => number) => Math.round(Math.max(...sorted.map(fn)));
  const statMed = (fn: (s: TeamSummary) => number) => {
    const vals = sorted.map(fn).sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  const eraMin = (statMin(s => s.medianPitchingERA * 100) / 100).toFixed(2);
  const eraMed = (statMed(s => s.medianPitchingERA) as number).toFixed(2);
  const eraMax = (statMax(s => s.medianPitchingERA * 100) / 100).toFixed(2);
  const avgMin = (statMin(s => s.medianBattingAvg * 1000) / 1000).toFixed(3);
  const avgMed = (Math.round(statMed(s => s.medianBattingAvg) * 1000) / 1000).toFixed(3);
  const avgMax = (statMax(s => s.medianBattingAvg * 1000) / 1000).toFixed(3);
  console.log(`[SIM_CAL] AVG=${avgMin}/${avgMed}/${avgMax} HR=${statMin(s=>s.medianBattingHR)}/${statMed(s=>s.medianBattingHR)}/${statMax(s=>s.medianBattingHR)} 2B=${statMin(s=>s.medianBatting2B)}/${statMed(s=>s.medianBatting2B)}/${statMax(s=>s.medianBatting2B)} 3B=${statMin(s=>s.medianBatting3B)}/${statMed(s=>s.medianBatting3B)}/${statMax(s=>s.medianBatting3B)} BB=${statMin(s=>s.medianBattingBB)}/${statMed(s=>s.medianBattingBB)}/${statMax(s=>s.medianBattingBB)} K=${statMin(s=>s.medianBattingK)}/${statMed(s=>s.medianBattingK)}/${statMax(s=>s.medianBattingK)} SB=${statMin(s=>s.medianBattingSB)}/${statMed(s=>s.medianBattingSB)}/${statMax(s=>s.medianBattingSB)} R=${statMin(s=>s.medianRS)}/${statMed(s=>s.medianRS)}/${statMax(s=>s.medianRS)} ERA=${eraMin}/${eraMed}/${eraMax} pK=${statMin(s=>s.medianPitchingK)}/${statMed(s=>s.medianPitchingK)}/${statMax(s=>s.medianPitchingK)} pBB=${statMin(s=>s.medianPitchingBB)}/${statMed(s=>s.medianPitchingBB)}/${statMax(s=>s.medianPitchingBB)} pHR=${statMin(s=>s.medianPitchingHR)}/${statMed(s=>s.medianPitchingHR)}/${statMax(s=>s.medianPitchingHR)} RA=${statMin(s=>s.medianRA)}/${statMed(s=>s.medianRA)}/${statMax(s=>s.medianRA)}`);

  return {
    config,
    teamSummaries: sorted,
    elapsedMs: performance.now() - startTime,
    leaderboards,
  };
}

// ============================================================================
// Rest / Lineup Management
// ============================================================================

function getRestThreshold(injuryTier: string): number {
  switch (injuryTier) {
    case 'Wrecked':
    case 'Fragile': return 5;
    case 'Normal': return 7;
    case 'Durable':
    case 'Iron Man': return 9;
    default: return 7;
  }
}

// Replacement-level batter template — phantom callup/minor leaguer
const REPLACEMENT_RATES = {
  pBB: 0.065, pK: 0.230, pHR: 0.018,
  pTriple: 0.003, pDouble: 0.040, pSingle: 0.170,
  pOut: 0.474,
  projectedPa: 200,
  injuryTier: 'Normal' as string,
  speed: 30, stealAggression: 20, stealAbility: 20,
  woba: 0.280, positionRating: 40, defRuns: -2,
};

function makeReplacementBatter(position: string, teamId: number, slotIdx: number): BatterSnapshot {
  // Team-unique negative ID: -(teamId * 100 + slotIdx) to avoid collisions
  return { ...REPLACEMENT_RATES, playerId: -(teamId * 100 + slotIdx), name: `Callup ${position}`, position };
}

// Full-time PA benchmark: a starter playing every game gets ~720 PA
// (162 games × ~4.45 PA/game). Higher value = less resting.
const FULL_TIME_PA = 720;

/** Compute start probability from projected PA (0.0 to 1.0) */
function getStartProb(projectedPa: number): number {
  return Math.min(1.0, Math.max(0.05, projectedPa / FULL_TIME_PA));
}

function buildGameLineup(team: TeamSnapshot, state: TeamSeasonState, rng: RNG, phantomRegistry?: Map<number, { teamId: number; leagueId: number; name: string }>): { snapshot: TeamSnapshot; catcherRested: boolean } {
  const lineup = [...team.lineup];
  let catcherRested = false;
  const usedBenchIds = new Set<number>();

  // For each lineup slot: check PA-budget start probability, then injury rest.
  // Cascade: starter → bench player → phantom replacement.
  for (let i = 0; i < lineup.length; i++) {
    const starter = team.lineup[i];
    let needsSub = false;

    // PA-budget check: roll against start probability
    const startProb = getStartProb(starter.projectedPa);
    if (startProb < 1.0 && rng() > startProb) {
      needsSub = true;
    }

    // Injury-based rest: consecutive starts threshold
    if (!needsSub) {
      const restThreshold = getRestThreshold(starter.injuryTier);
      if (state.consecutiveStarts[i] >= restThreshold) {
        needsSub = true;
      }
    }

    // Catcher fatigue rest (on top of other rest checks)
    if (!needsSub && starter.position === 'C') {
      const maxPa = 162 * 4.5;
      const targetPa = Math.min(starter.projectedPa, maxPa);
      const restDays = Math.max(1, Math.round(162 - targetPa / 4.5));
      const restFreq = Math.max(2, Math.floor((162 - restDays) / restDays));
      if (state.catcherGamesPlayed >= restFreq) {
        needsSub = true;
      }
    }

    if (needsSub) {
      // Try bench player at this position (also subject to their own startProb).
      // Bench players use a reduced start probability to ensure phantoms get
      // a realistic share of PA (~8-12% of team total).
      const BENCH_PROB_SCALE = 0.60;  // bench accepts 60% of their startProb
      let subbed = false;
      for (const bench of team.bench) {
        if (usedBenchIds.has(bench.playerId)) continue;
        if (bench.position !== starter.position && bench.position !== 'DH') continue;
        const benchStartProb = getStartProb(bench.projectedPa) * BENCH_PROB_SCALE;
        if (rng() <= benchStartProb) {
          lineup[i] = bench;
          usedBenchIds.add(bench.playerId);
          subbed = true;
          break;
        }
      }
      // Fallback: any available bench player regardless of position
      if (!subbed) {
        for (const bench of team.bench) {
          if (usedBenchIds.has(bench.playerId)) continue;
          const benchStartProb = getStartProb(bench.projectedPa) * BENCH_PROB_SCALE;
          if (rng() <= benchStartProb) {
            lineup[i] = bench;
            usedBenchIds.add(bench.playerId);
            subbed = true;
            break;
          }
        }
      }
      // Final fallback: phantom replacement-level callup
      if (!subbed) {
        const phantom = makeReplacementBatter(starter.position, team.teamId, i);
        lineup[i] = phantom;
        // Register phantom so its stats count toward team totals
        if (phantomRegistry && !phantomRegistry.has(phantom.playerId)) {
          phantomRegistry.set(phantom.playerId, { teamId: team.teamId, leagueId: team.leagueId, name: phantom.name });
        }
      }

      state.restingSlots.add(i);
      if (starter.position === 'C') catcherRested = true;
    }
  }

  return { snapshot: { ...team, lineup }, catcherRested };
}

function updateSeasonState(state: TeamSeasonState, _gameLineup: TeamSnapshot, _originalTeam: TeamSnapshot, catcherRested: boolean): void {
  for (let i = 0; i < 9; i++) {
    if (state.restingSlots.has(i)) {
      state.consecutiveStarts[i] = 0;
    } else {
      state.consecutiveStarts[i]++;
    }
  }
  if (catcherRested) {
    state.catcherGamesPlayed = 0;
  } else {
    state.catcherGamesPlayed++;
  }
  state.restingSlots.clear();
}

function initTeamSeasonState(): TeamSeasonState {
  return {
    consecutiveStarts: new Array(9).fill(0),
    catcherGamesPlayed: 0,
    restingSlots: new Set<number>(),
    relieverConsecutiveDays: new Map<number, number>(),
  };
}

/** Returns the set of reliever playerIds who have pitched 3+ consecutive days. */
function getTiredRelievers(team: TeamSnapshot, state: TeamSeasonState): Set<number> {
  const tired = new Set<number>();
  for (const p of team.bullpen) {
    if (p.playerId > 0 && (state.relieverConsecutiveDays.get(p.playerId) ?? 0) >= 3) {
      tired.add(p.playerId);
    }
  }
  return tired;
}

/** After each game, increment consecutive days for relievers who appeared; reset the rest. */
function updatePitcherFatigue(
  team: TeamSnapshot,
  state: TeamSeasonState,
  appearedThisGame: Set<number>,
): void {
  for (const p of team.bullpen) {
    if (p.playerId <= 0) continue;
    if (appearedThisGame.has(p.playerId)) {
      state.relieverConsecutiveDays.set(p.playerId, (state.relieverConsecutiveDays.get(p.playerId) ?? 0) + 1);
    } else {
      state.relieverConsecutiveDays.set(p.playerId, 0);
    }
  }
}

// ============================================================================
// Single Season Simulation
// ============================================================================

/** Simulate a single season, returns the records map and per-player stats */
function simulateOneSeason(
  teams: TeamSnapshot[],
  schedule: ScheduledGame[],
  teamMap: Map<number, TeamSnapshot>,
  homeBoostedTeamMap: Map<number, TeamSnapshot>,
  league: LeagueAverageRates,
  config: SimConfig,
  simIndex: number,
  leagueDefShift: number = 0,
  playerTeamMap?: Map<number, { teamId: number; leagueId: number; name: string }>,
): { records: Map<number, TeamSeasonRecord>; batterStats: Map<number, PlayerGameStats>; pitcherStats: Map<number, PitcherGameStats>; gsStats: Map<number, number> } {
  const rng = createRNG(simIndex * 7919 + 42);
  const shuffled = shuffleSchedule(schedule, rng);

  const records = new Map<number, TeamSeasonRecord>();
  for (const t of teams) {
    records.set(t.teamId, {
      teamId: t.teamId, wins: 0, losses: 0,
      runsScored: 0, runsAllowed: 0,
      divisionRank: 0, madePlayoffs: false, wonChampionship: false,
      battingAB: 0, battingH: 0, battingHR: 0, battingBB: 0, battingK: 0,
      batting2B: 0, batting3B: 0, battingSB: 0,
      pitchingOuts: 0, pitchingER: 0, pitchingK: 0, pitchingBB: 0, pitchingHR: 0,
    });
  }

  const rotationIdx = new Map<number, number>();
  for (const t of teams) rotationIdx.set(t.teamId, 0);

  // Pitcher → teamId lookup for per-game fatigue tracking
  const pitcherTeamIdMap = new Map<number, number>();
  for (const t of teams) {
    for (const p of [...t.rotation, ...t.bullpen]) pitcherTeamIdMap.set(p.playerId, t.teamId);
  }

  // Per-season state for rest management
  const seasonStates = new Map<number, TeamSeasonState>();
  for (const t of teams) seasonStates.set(t.teamId, initTeamSeasonState());

  // Catcher rest diagnostic (first sim only)
  const catcherRestCounts = new Map<number, number>(); // teamId → times catcher was rested
  const isDebugSim = simIndex === 0;

  // Per-sim batter and pitcher stats
  const batterStats = new Map<number, PlayerGameStats>();
  const pitcherStats = new Map<number, PitcherGameStats>();
  const gsStats = new Map<number, number>(); // pitcher playerId → games started this season

  // Per-game pitcher appearance tracking (reset before each game)
  let gameHomePitcherIds = new Set<number>();
  let gameAwayPitcherIds = new Set<number>();
  let _curHomeTeamId = -1;
  let _curAwayTeamId = -1;

  function onPA(batterId: number, pitcherId: number, outcome: PAOutcome, runsScored: number): void {
    // Accumulate batter stats
    let bs = batterStats.get(batterId);
    if (!bs) {
      bs = { pa: 0, ab: 0, h: 0, hr: 0, bb: 0, k: 0, doubles: 0, triples: 0 };
      batterStats.set(batterId, bs);
    }
    bs.pa++;
    if (outcome !== 'BB') bs.ab++;
    if (outcome === 'BB') bs.bb++;
    if (outcome === 'K') bs.k++;
    if (outcome === 'HR') { bs.hr++; bs.h++; }
    if (outcome === '1B') bs.h++;
    if (outcome === '2B') { bs.h++; bs.doubles++; }
    if (outcome === '3B') { bs.h++; bs.triples++; }

    // Accumulate pitcher stats
    let ps = pitcherStats.get(pitcherId);
    if (!ps) {
      ps = { outs: 0, er: 0, h: 0, hr: 0, bb: 0, k: 0, saves: 0 };
      pitcherStats.set(pitcherId, ps);
    }
    if (outcome === 'K' || outcome === 'OUT') ps.outs++;
    if (outcome === 'BB') ps.bb++;
    if (outcome === 'K') ps.k++;
    if (outcome === 'HR') { ps.hr++; ps.h++; }
    if (outcome === '1B' || outcome === '2B' || outcome === '3B') ps.h++;
    // Track earned runs
    ps.er += runsScored;

    // Track per-game pitcher appearances for fatigue
    const pitcherTeamId = pitcherTeamIdMap.get(pitcherId);
    if (pitcherTeamId === _curHomeTeamId) gameHomePitcherIds.add(pitcherId);
    else if (pitcherTeamId === _curAwayTeamId) gameAwayPitcherIds.add(pitcherId);
  }

  for (const game of shuffled) {
    const homeBase    = homeBoostedTeamMap.get(game.homeTeamId); // pre-baked home advantage
    const awayBase    = teamMap.get(game.awayTeamId);
    const homeBaseRaw = teamMap.get(game.homeTeamId);            // for season state tracking
    if (!homeBase || !awayBase || !homeBaseRaw) continue;

    const homeSeasonState = seasonStates.get(game.homeTeamId)!;
    const awaySeasonState = seasonStates.get(game.awayTeamId)!;

    // Reset per-game pitcher tracking
    _curHomeTeamId = game.homeTeamId;
    _curAwayTeamId = game.awayTeamId;
    gameHomePitcherIds = new Set();
    gameAwayPitcherIds = new Set();

    // Compute tired relievers (3+ consecutive days) before this game
    const homeTired = getTiredRelievers(homeBaseRaw, homeSeasonState);
    const awayTired = getTiredRelievers(awayBase, awaySeasonState);

    const { snapshot: home, catcherRested: homeCatcherRested } = buildGameLineup(homeBase, homeSeasonState, rng, playerTeamMap);
    const { snapshot: away, catcherRested: awayCatcherRested } = buildGameLineup(awayBase, awaySeasonState, rng, playerTeamMap);

    if (isDebugSim) {
      if (homeCatcherRested) catcherRestCounts.set(game.homeTeamId, (catcherRestCounts.get(game.homeTeamId) ?? 0) + 1);
      if (awayCatcherRested) catcherRestCounts.set(game.awayTeamId, (catcherRestCounts.get(game.awayTeamId) ?? 0) + 1);
    }

    const homeStarter = rotationIdx.get(home.teamId) ?? 0;
    const awayStarter = rotationIdx.get(away.teamId) ?? 0;

    // Injury-based SP skips: injured starter replaced by replacement-level arm.
    // Rotation index still advances (turn consumed). GS credited to the replacement placeholder.
    let gameHome = home;
    let gameAway = away;
    if (rng() < getSpInjurySkipProb(home.rotation[homeStarter]?.injuryProneness)) {
      const rot = [...home.rotation];
      rot[homeStarter] = REPLACEMENT_SP;
      gameHome = { ...home, rotation: rot };
    }
    if (rng() < getSpInjurySkipProb(away.rotation[awayStarter]?.injuryProneness)) {
      const rot = [...away.rotation];
      rot[awayStarter] = REPLACEMENT_SP;
      gameAway = { ...away, rotation: rot };
    }

    // Injury-based RP unavailability: add injured relievers to the tired set.
    const homeUnavail = homeTired.size > 0 ? new Set(homeTired) : new Set<number>();
    const awayUnavail = awayTired.size > 0 ? new Set(awayTired) : new Set<number>();
    for (const p of gameHome.bullpen) {
      if (p.playerId > 0 && rng() < getRpInjurySkipProb(p.injuryProneness)) homeUnavail.add(p.playerId);
    }
    for (const p of gameAway.bullpen) {
      if (p.playerId > 0 && rng() < getRpInjurySkipProb(p.injuryProneness)) awayUnavail.add(p.playerId);
    }

    const result = simulateGame(gameHome, gameAway, homeStarter, awayStarter, league, rng, onPA, homeUnavail, awayUnavail, leagueDefShift);

    // Track games started (only for real pitchers, not replacements)
    const homeStarterPid = gameHome.rotation[homeStarter]?.playerId ?? -1;
    const awayStarterPid = gameAway.rotation[awayStarter]?.playerId ?? -1;
    if (homeStarterPid > 0) gsStats.set(homeStarterPid, (gsStats.get(homeStarterPid) ?? 0) + 1);
    if (awayStarterPid > 0) gsStats.set(awayStarterPid, (gsStats.get(awayStarterPid) ?? 0) + 1);

    const homeRec = records.get(home.teamId)!;
    const awayRec = records.get(away.teamId)!;

    if (result.homeScore > result.awayScore) {
      homeRec.wins++;
      awayRec.losses++;
    } else {
      awayRec.wins++;
      homeRec.losses++;
    }
    homeRec.runsScored += result.homeScore;
    homeRec.runsAllowed += result.awayScore;
    awayRec.runsScored += result.awayScore;
    awayRec.runsAllowed += result.homeScore;
    homeRec.battingSB += result.homeSB;
    awayRec.battingSB += result.awaySB;

    rotationIdx.set(home.teamId, (homeStarter + 1) % Math.max(1, home.rotation.length));
    rotationIdx.set(away.teamId, (awayStarter + 1) % Math.max(1, away.rotation.length));

    // Track closer saves
    if (result.homeCloserSave && result.homeCloserPlayerId >= 0) {
      let ps = pitcherStats.get(result.homeCloserPlayerId);
      if (!ps) { ps = { outs: 0, er: 0, h: 0, hr: 0, bb: 0, k: 0, saves: 0 }; pitcherStats.set(result.homeCloserPlayerId, ps); }
      ps.saves++;
    }
    if (result.awayCloserSave && result.awayCloserPlayerId >= 0) {
      let ps = pitcherStats.get(result.awayCloserPlayerId);
      if (!ps) { ps = { outs: 0, er: 0, h: 0, hr: 0, bb: 0, k: 0, saves: 0 }; pitcherStats.set(result.awayCloserPlayerId, ps); }
      ps.saves++;
    }

    // Update pitcher fatigue (consecutive days tracking)
    updatePitcherFatigue(homeBaseRaw, homeSeasonState, gameHomePitcherIds);
    updatePitcherFatigue(awayBase, awaySeasonState, gameAwayPitcherIds);

    // Update season state for rest management
    updateSeasonState(homeSeasonState, home, homeBaseRaw, homeCatcherRested);
    updateSeasonState(awaySeasonState, away, awayBase, awayCatcherRested);
  }

  // Catcher rest diagnostic (first sim only)
  if (isDebugSim) {
    console.log('[Sim] 🧤 Catcher rest diagnostics (sim #0):');
    for (const t of teams) {
      const restCount = catcherRestCounts.get(t.teamId) ?? 0;
      const catcher = t.lineup.find(b => b.position === 'C');
      const backupC = t.bench.find(b => b.position === 'C');
      const catcherPa = catcher ? (batterStats.get(catcher.playerId)?.pa ?? 0) : 0;
      const state = seasonStates.get(t.teamId)!;
      if (catcher) {
        console.log(`  ${t.abbr}: ${catcher.name} (${catcherPa} PA) rested ${restCount}x | backup: ${backupC?.name ?? 'NONE'} | final catcherGamesPlayed: ${state.catcherGamesPlayed}`);
      }
    }
  }

  if (config.includePlayoffs) {
    determinePlayoffs(records, teams, rng, homeBoostedTeamMap, teamMap, league);
  }

  return { records, batterStats, pitcherStats, gsStats };
}

/**
 * Pre-bake home field advantage into a team's batter snapshots.
 * Applied once per sim run; eliminates per-PA renormalization in GameEngine.
 * Boosts pSingle, pDouble, pHR by (1 + boost), then renormalizes all 7 rates.
 */
function buildHomeBoostTeam(team: TeamSnapshot, boost: number): TeamSnapshot {
  if (boost <= 0) return team;
  const factor = 1 + boost;

  function boostBatter(b: BatterSnapshot): BatterSnapshot {
    const pSingle = b.pSingle * factor;
    const pDouble = b.pDouble * factor;
    const pHR     = b.pHR     * factor;
    const sum = b.pBB + b.pK + pHR + b.pTriple + pDouble + pSingle + b.pOut;
    return {
      ...b,
      pBB:    b.pBB    / sum,
      pK:     b.pK     / sum,
      pHR:    pHR      / sum,
      pTriple: b.pTriple / sum,
      pDouble: pDouble  / sum,
      pSingle: pSingle  / sum,
      pOut:   b.pOut   / sum,
    };
  }

  return { ...team, lineup: team.lineup.map(boostBatter), bench: team.bench.map(boostBatter) };
}

function getChampLeader(champCounts: Map<number, number>, teams: TeamSnapshot[]): { name: string; count: number } | null {
  let maxId = -1, maxCount = 0;
  for (const [id, count] of champCounts) {
    if (count > maxCount) { maxId = id; maxCount = count; }
  }
  if (maxCount === 0) return null;
  const team = teams.find(t => t.teamId === maxId);
  return { name: team?.teamName ?? 'Unknown', count: maxCount };
}

/** Yield to the browser so it can repaint the DOM */
const _yieldChannel = new MessageChannel();
function yieldToUI(): Promise<void> {
  return new Promise(resolve => {
    _yieldChannel.port1.onmessage = () => resolve();
    _yieldChannel.port2.postMessage(null);
  });
}

// ============================================================================
// Series Simulation (Head-to-Head)
// ============================================================================

export async function runSeriesSimulation(
  team1: TeamSnapshot,
  team2: TeamSnapshot,
  league: LeagueAverageRates,
  config: SimConfig,
  onProgress?: SimProgressCallback,
): Promise<SimulationResults> {
  const startTime = performance.now();
  const homeBoost = (config.homeFieldAdvantage - 0.5) * 0.4;
  const boostedTeam1 = buildHomeBoostTeam(team1, homeBoost);
  const boostedTeam2 = buildHomeBoostTeam(team2, homeBoost);

  let team1Wins = 0;
  let team2Wins = 0;
  let totalScore1 = 0;
  let totalScore2 = 0;
  const numGames = config.numSimulations;

  for (let i = 0; i < numGames; i++) {
    const rng = createRNG(i * 6271 + 13);
    const isTeam1Home = i % 2 === 0;
    // Home team uses pre-baked home advantage; away team uses normal snapshot
    const home = isTeam1Home ? boostedTeam1 : boostedTeam2;
    const away = isTeam1Home ? team2 : team1;

    const result = simulateGame(home, away, 0, 0, league, rng);

    const score1 = isTeam1Home ? result.homeScore : result.awayScore;
    const score2 = isTeam1Home ? result.awayScore : result.homeScore;

    totalScore1 += score1;
    totalScore2 += score2;

    if (score1 > score2) team1Wins++;
    else team2Wins++;

    if ((i + 1) % YIELD_BATCH_SIZE === 0) {
      onProgress?.(i + 1, numGames);
      await yieldToUI();
    }
  }

  onProgress?.(numGames, numGames);

  return {
    config,
    teamSummaries: [],
    seriesResult: {
      team1Wins,
      team2Wins,
      team1WinPct: team1Wins / numGames,
      avgScore1: totalScore1 / numGames,
      avgScore2: totalScore2 / numGames,
    },
    elapsedMs: performance.now() - startTime,
  };
}

// ============================================================================
// Playoff Determination + Simulation
// ============================================================================

function determinePlayoffs(
  records: Map<number, TeamSeasonRecord>,
  teams: TeamSnapshot[],
  rng: RNG,
  homeBoostedTeamMap: Map<number, TeamSnapshot>,
  teamMap: Map<number, TeamSnapshot>,
  league: LeagueAverageRates,
): void {
  // 4 division winners + best records get playoff spots
  // Format: 4 division winners, 2 wild cards per league = 12 total
  const divisionTeams = new Map<number, TeamSeasonRecord[]>();
  for (const t of teams) {
    const rec = records.get(t.teamId)!;
    const arr = divisionTeams.get(t.divisionId) ?? [];
    arr.push(rec);
    divisionTeams.set(t.divisionId, arr);
  }

  // Find division winners
  const divWinners: TeamSeasonRecord[] = [];
  const wildCardPool: TeamSeasonRecord[] = [];

  for (const [, divTeams] of divisionTeams) {
    divTeams.sort((a, b) => b.wins - a.wins || (a.runsAllowed - a.runsScored) - (b.runsAllowed - b.runsScored));
    for (let i = 0; i < divTeams.length; i++) {
      divTeams[i].divisionRank = i + 1;
    }
    divWinners.push(divTeams[0]);
    divTeams[0].madePlayoffs = true;
    // Non-winners eligible for wild card
    for (let i = 1; i < divTeams.length; i++) {
      wildCardPool.push(divTeams[i]);
    }
  }
  void divWinners;

  // Wild cards: 2 per league (4 total)
  for (const leagueId of [1, 2]) {
    const leagueWC = wildCardPool
      .filter(r => {
        const t = teams.find(tm => tm.teamId === r.teamId);
        return t?.leagueId === leagueId;
      })
      .sort((a, b) => b.wins - a.wins);
    for (let i = 0; i < Math.min(2, leagueWC.length); i++) {
      leagueWC[i].madePlayoffs = true;
    }
  }

  // Simulate playoffs: simple bracket
  // Each league: WC1 vs DivWinner2, WC2 vs DivWinner1, then LCS, then WS
  const playoffTeams = [...records.values()].filter(r => r.madePlayoffs);

  // Group by league
  for (const leagueId of [1, 2]) {
    const leaguePO = playoffTeams
      .filter(r => {
        const t = teams.find(tm => tm.teamId === r.teamId);
        return t?.leagueId === leagueId;
      })
      .sort((a, b) => b.wins - a.wins);

    if (leaguePO.length < 2) continue;

    // Simple: best record vs worst, 2nd vs 3rd
    const ds1Winner = simulatePlayoffSeries(leaguePO[0], leaguePO[3] ?? leaguePO[leaguePO.length - 1], 5, homeBoostedTeamMap, teamMap, league, rng);
    const ds2Winner = simulatePlayoffSeries(leaguePO[1], leaguePO[2] ?? leaguePO[leaguePO.length - 1], 5, homeBoostedTeamMap, teamMap, league, rng);
    const pennantWinner = simulatePlayoffSeries(
      records.get(ds1Winner)!,
      records.get(ds2Winner)!,
      7, homeBoostedTeamMap, teamMap, league, rng,
    );

    // Tag pennant winner for WS
    (records.get(pennantWinner)! as any)._pennant = leagueId;
  }

  // World Series
  const pennantWinners = [...records.values()].filter((r: any) => r._pennant);
  if (pennantWinners.length === 2) {
    const wsWinner = simulatePlayoffSeries(pennantWinners[0], pennantWinners[1], 7, homeBoostedTeamMap, teamMap, league, rng);
    records.get(wsWinner)!.wonChampionship = true;
  }

  // Clean up temp fields
  for (const r of records.values()) {
    delete (r as any)._pennant;
  }
}

function simulatePlayoffSeries(
  team1Rec: TeamSeasonRecord,
  team2Rec: TeamSeasonRecord,
  gamesNeeded: number,
  homeBoostedTeamMap: Map<number, TeamSnapshot>,
  teamMap: Map<number, TeamSnapshot>,
  league: LeagueAverageRates,
  rng: RNG,
): number {
  const winsNeeded = Math.ceil(gamesNeeded / 2);
  let t1Wins = 0;
  let t2Wins = 0;
  const t1Home = homeBoostedTeamMap.get(team1Rec.teamId)!;
  const t2Home = homeBoostedTeamMap.get(team2Rec.teamId)!;
  const t1Away = teamMap.get(team1Rec.teamId)!;
  const t2Away = teamMap.get(team2Rec.teamId)!;

  while (t1Wins < winsNeeded && t2Wins < winsNeeded) {
    // Home advantage: higher seed gets more home games (2-2-1-1-1 format)
    const gameNum = t1Wins + t2Wins;
    const t1IsHome = gameNum < 2 || gameNum === 4 || gameNum === 6;

    const home = t1IsHome ? t1Home : t2Home;
    const away = t1IsHome ? t2Away : t1Away;
    const starterIdx = (t1Wins + t2Wins) % 4; // cycle through top 4 starters

    const result = simulateGame(home, away, starterIdx, starterIdx, league, rng);

    if (t1IsHome) {
      if (result.homeScore > result.awayScore) t1Wins++;
      else t2Wins++;
    } else {
      if (result.homeScore > result.awayScore) t2Wins++;
      else t1Wins++;
    }
  }

  return t1Wins >= winsNeeded ? team1Rec.teamId : team2Rec.teamId;
}

// ============================================================================
// Results Aggregation
// ============================================================================

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function aggregateResults(
  teams: TeamSnapshot[],
  allRecords: Map<number, TeamSeasonRecord[]>,
  numSims: number,
): TeamSummary[] {
  const empty: TeamSummary = {
    teamId: 0, teamName: '', abbr: '',
    meanWins: 0, medianWins: 0, stdDev: 0,
    minWins: 0, maxWins: 0, p10Wins: 0, p90Wins: 0,
    meanRS: 0, meanRA: 0,
    playoffPct: 0, divisionWinPct: 0, championshipPct: 0,
    medianBattingAvg: 0, medianBattingBB: 0, medianBattingK: 0,
    medianBattingHR: 0, medianBatting2B: 0, medianBatting3B: 0,
    medianBattingSB: 0, medianRS: 0,
    medianPitchingERA: 0, medianPitchingK: 0, medianPitchingBB: 0,
    medianPitchingHR: 0, medianRA: 0,
  };

  return teams.map(t => {
    const records = allRecords.get(t.teamId) ?? [];
    const wins = records.map(r => r.wins).sort((a, b) => a - b);

    if (wins.length === 0) {
      return { ...empty, teamId: t.teamId, teamName: t.teamName, abbr: t.abbr };
    }

    const mean = wins.reduce((a, b) => a + b, 0) / wins.length;
    const variance = wins.reduce((sum, w) => sum + (w - mean) ** 2, 0) / wins.length;

    // Compute per-sim batting/pitching stats for median calculation
    const battingAvgs = records.map(r => r.battingAB > 0 ? r.battingH / r.battingAB : 0);
    const pitchingERAs = records.map(r => {
      const ip = r.pitchingOuts / 3;
      return ip > 0 ? (r.pitchingER / ip) * 9 : 0;
    });

    return {
      teamId: t.teamId,
      teamName: t.teamName,
      abbr: t.abbr,
      meanWins: Math.round(mean * 10) / 10,
      medianWins: wins[Math.floor(wins.length / 2)],
      stdDev: Math.round(Math.sqrt(variance) * 10) / 10,
      minWins: wins[0],
      maxWins: wins[wins.length - 1],
      p10Wins: wins[Math.floor(wins.length * 0.1)],
      p90Wins: wins[Math.floor(wins.length * 0.9)],
      meanRS: Math.round(records.reduce((s, r) => s + r.runsScored, 0) / records.length),
      meanRA: Math.round(records.reduce((s, r) => s + r.runsAllowed, 0) / records.length),
      playoffPct: Math.round(records.filter(r => r.madePlayoffs).length / numSims * 1000) / 10,
      divisionWinPct: Math.round(records.filter(r => r.divisionRank === 1).length / numSims * 1000) / 10,
      championshipPct: Math.round(records.filter(r => r.wonChampionship).length / numSims * 1000) / 10,
      // Median team batting stats
      medianBattingAvg: Math.round(median(battingAvgs) * 1000) / 1000,
      medianBattingBB: median(records.map(r => r.battingBB)),
      medianBattingK: median(records.map(r => r.battingK)),
      medianBattingHR: median(records.map(r => r.battingHR)),
      medianBatting2B: median(records.map(r => r.batting2B)),
      medianBatting3B: median(records.map(r => r.batting3B)),
      medianBattingSB: median(records.map(r => r.battingSB)),
      medianRS: median(records.map(r => r.runsScored)),
      // Median team pitching stats
      medianPitchingERA: Math.round(median(pitchingERAs) * 100) / 100,
      medianPitchingK: median(records.map(r => r.pitchingK)),
      medianPitchingBB: median(records.map(r => r.pitchingBB)),
      medianPitchingHR: median(records.map(r => r.pitchingHR)),
      medianRA: median(records.map(r => r.runsAllowed)),
    };
  });
}

// ============================================================================
// Leaderboard Building
// ============================================================================

function buildLeaderboards(
  allSimBatterTotals: Map<number, PlayerGameStats & { woba: number; wobaSum: number }>,
  allSimPitcherTotals: Map<number, PitcherGameStats>,
  allSimGsTotals: Map<number, number>,
  playerTeamMap: Map<number, { teamId: number; leagueId: number; name: string }>,
  teams: TeamSnapshot[],
  numSims: number,
): SimLeaderboards {
  // Build per-player batting averages (divide totals by numSims)
  // Includes phantom callup players (pid < 0) — they're registered in playerTeamMap
  const allBatters: SimPlayerBattingStats[] = [];
  for (const [pid, totals] of allSimBatterTotals) {
    const info = playerTeamMap.get(pid);
    if (!info) continue;

    const pa = totals.pa / numSims;
    const ab = totals.ab / numSims;
    const h = totals.h / numSims;
    const hr = totals.hr / numSims;
    const bb = totals.bb / numSims;
    const k = totals.k / numSims;
    const doubles = totals.doubles / numSims;
    const triples = totals.triples / numSims;

    const avg = ab > 0 ? h / ab : 0;
    const obp = pa > 0 ? (h + bb) / pa : 0;
    const singles = h - hr - doubles - triples;
    const slg = ab > 0 ? (singles + 2 * doubles + 3 * triples + 4 * hr) / ab : 0;
    const woba = pa > 0
      ? (0.69 * bb + 0.89 * singles + 1.27 * doubles + 1.62 * triples + 2.10 * hr) / pa
      : 0;

    // Minimum PA filter: at least 100 avg PA per season
    if (pa < 100) continue;

    allBatters.push({
      playerId: pid,
      name: info.name,
      teamId: info.teamId,
      leagueId: info.leagueId,
      pa, ab, h, hr, bb, k, doubles, triples,
      avg, obp, slg, woba,
      war: 0, // computed below after lgWoba is known
    });
  }

  // Build per-player pitching averages
  const allPitchers: SimPlayerPitchingStats[] = [];
  for (const [pid, totals] of allSimPitcherTotals) {
    if (pid < 0) continue;
    const info = playerTeamMap.get(pid);
    if (!info) continue;

    const ip = (totals.outs / numSims) / 3;
    const er = totals.er / numSims;
    const h = totals.h / numSims;
    const hr = totals.hr / numSims;
    const bb = totals.bb / numSims;
    const k = totals.k / numSims;
    const saves = totals.saves / numSims;
    const era = ip > 0 ? (er / ip) * 9 : 0;
    // FIP = ((13*HR + 3*BB - 2*K) / IP) + FIP_constant
    const fip = ip > 0 ? ((13 * hr + 3 * bb - 2 * k) / ip) + 3.1 : 0;

    // Minimum IP filter
    if (ip < 20) continue;

    allPitchers.push({
      playerId: pid,
      name: info.name,
      teamId: info.teamId,
      leagueId: info.leagueId,
      ip, er, h, hr, bb, k, era, fip, saves,
      war: 0, // computed below after lgEra is known
    });
  }

  // Compute batter WAR (wins above replacement, not wins above average).
  // WAR = (batting_runs + replacement_runs) / runs_per_win
  // batting_runs = ((wOBA - lgwOBA) / wobaScale) * PA
  // replacement_runs = 20 per 600 PA (prorated) — the value of playing vs a replacement player
  const runsPerWin = 9;
  if (allBatters.length > 0) {
    const lgWoba = allBatters.reduce((s, b) => s + b.woba * b.pa, 0) / allBatters.reduce((s, b) => s + b.pa, 0);
    for (const b of allBatters) {
      const battingRuns = ((b.woba - lgWoba) / 1.15) * b.pa;
      const replacementRuns = 20 * (b.pa / 600);
      b.war = (battingRuns + replacementRuns) / runsPerWin;
    }
  }

  // Build pitcher role lookup (SP vs RP) for diagnostic and FIP correction.
  const pitcherRoleMap = new Map<number, 'SP' | 'RP'>();
  for (const t of teams) {
    for (const p of t.rotation) pitcherRoleMap.set(p.playerId, 'SP');
    for (const p of t.bullpen)  pitcherRoleMap.set(p.playerId, 'RP');
  }

  // Compute pitcher WAR (FIP-based, matching in-game fWAR methodology).
  // Replacement-level FIP ≈ lgERA × 1.38 (FanGraphs standard: ~.380 win% replacement).
  // WAR = ((replFIP - FIP) * IP/9) / runsPerWin
  if (allPitchers.length > 0) {
    const totalIp = allPitchers.reduce((s, p) => s + p.ip, 0);
    const totalEr = allPitchers.reduce((s, p) => s + p.er, 0);
    const lgEra = totalIp > 0 ? totalEr / totalIp * 9 : 4.50;

    // Dynamic FIP constant: compute so lgFIP = lgERA for this sim's run environment.
    // Each pitcher's fip was computed with constant 3.1; fipRaw = fip - 3.1.
    // lgFIP_raw = IP-weighted average raw FIP component.
    const lgFipRaw = totalIp > 0
      ? allPitchers.reduce((s, p) => s + (p.fip - 3.1) * p.ip, 0) / totalIp
      : 1.4;
    const fipConstant = lgEra - lgFipRaw;

    // Apply corrected constant to every pitcher's FIP.
    const constantShift = fipConstant - 3.1;
    if (Math.abs(constantShift) > 0.01) {
      for (const p of allPitchers) p.fip += constantShift;
    }

    // ── ERA vs FIP diagnostic ──────────────────────────────────────────────
    // Logs SP/RP breakdown so ERA-FIP bias can be monitored.
    const spP = allPitchers.filter(p => pitcherRoleMap.get(p.playerId) === 'SP');
    const rpP = allPitchers.filter(p => pitcherRoleMap.get(p.playerId) === 'RP');
    function wAvg(arr: SimPlayerPitchingStats[], fn: (p: SimPlayerPitchingStats) => number): number {
      const totalIpArr = arr.reduce((s, p) => s + p.ip, 0);
      return totalIpArr > 0 ? arr.reduce((s, p) => s + fn(p) * p.ip, 0) / totalIpArr : 0;
    }
    console.log(
      `[Sim FIP] lgERA=${lgEra.toFixed(2)} lgFIP_raw=${lgFipRaw.toFixed(2)} constant=${fipConstant.toFixed(2)} (was 3.10) | ` +
      `SP ERA=${wAvg(spP, p => p.era).toFixed(2)} FIP=${wAvg(spP, p => p.fip).toFixed(2)} K/9=${wAvg(spP, p => p.k / p.ip * 9).toFixed(1)} (n=${spP.length}) | ` +
      `RP ERA=${wAvg(rpP, p => p.era).toFixed(2)} FIP=${wAvg(rpP, p => p.fip).toFixed(2)} K/9=${wAvg(rpP, p => p.k / p.ip * 9).toFixed(1)} (n=${rpP.length})`,
    );
    // IP/GS leaders diagnostic — check if top SP IP and GS are realistic
    const topSpByIp = [...spP].sort((a, b) => b.ip - a.ip).slice(0, 5);
    console.log(`[Sim IP] Top 5 SP: ${topSpByIp.map(p => {
      const gs = (allSimGsTotals.get(p.playerId) ?? 0) / numSims;
      return `${p.name}: ${p.ip.toFixed(0)} IP, ${gs.toFixed(1)} GS`;
    }).join(', ')}`);
    // ── end diagnostic ─────────────────────────────────────────────────────

    const replFip = lgEra * 1.38;
    for (const p of allPitchers) {
      p.war = ((replFip - p.fip) * (p.ip / 9)) / runsPerWin;
    }
  }

  // Build team leagueId lookup
  const teamLeagueMap = new Map<number, number>();
  for (const t of teams) teamLeagueMap.set(t.teamId, t.leagueId);

  const northernBatters = allBatters
    .filter(b => teamLeagueMap.get(b.teamId) === 1)
    .sort((a, b) => b.war - a.war)
    .slice(0, 10);

  const southernBatters = allBatters
    .filter(b => teamLeagueMap.get(b.teamId) === 2)
    .sort((a, b) => b.war - a.war)
    .slice(0, 10);

  const northernPitchers = allPitchers
    .filter(p => teamLeagueMap.get(p.teamId) === 1)
    .sort((a, b) => b.war - a.war)
    .slice(0, 10);

  const southernPitchers = allPitchers
    .filter(p => teamLeagueMap.get(p.teamId) === 2)
    .sort((a, b) => b.war - a.war)
    .slice(0, 10);

  return { northernBatters, southernBatters, northernPitchers, southernPitchers, allBatters, allPitchers };
}

// ============================================================================
// Helpers
// ============================================================================

function shuffleSchedule(schedule: ScheduledGame[], rng: RNG): ScheduledGame[] {
  const arr = [...schedule];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
