/**
 * SimulationService — Orchestration layer
 *
 * Loads team/player data from existing services (TrueRatings, TeamRatings,
 * LeagueBattingAverages) and converts them into TeamSnapshot[] for the
 * simulation engine.
 */

import { teamRatingsService, type RatedBatter, type RatedPitcher, type RatedPlayer } from '../TeamRatingsService';
import type { TeamSnapshot, BatterSnapshot, PitcherSnapshot, LeagueAverageRates, SimConfig, SimulationResults, SimProgressCallback } from './SimulationTypes';
import { batterRatesToVector, pitcherRatesToPerPA } from './PlateAppearanceEngine';
import { runSeasonSimulation, runSeriesSimulation } from './SeasonSimulator';

// ============================================================================
// Team name → division mapping (no abbreviation on Team model)
// ============================================================================

/** Maps substrings found in team full names to division/league info */
const TEAM_NAME_PATTERNS: Array<{ pattern: string; divisionId: number; leagueId: number; abbr: string }> = [
  // Great White North (div 1, league 1)
  { pattern: 'Huskies', divisionId: 1, leagueId: 1, abbr: 'TOR' },
  { pattern: 'Hunters', divisionId: 1, leagueId: 1, abbr: 'LON' },
  { pattern: 'Homewreckers', divisionId: 1, leagueId: 1, abbr: 'VAN' },
  { pattern: 'Boazu', divisionId: 1, leagueId: 1, abbr: 'LAP' },
  { pattern: 'Spiders', divisionId: 1, leagueId: 1, abbr: 'CLE' },
  // Midnight Express (div 2, league 1)
  { pattern: 'Outlaws', divisionId: 2, leagueId: 1, abbr: 'NKO' },
  { pattern: 'Centurions', divisionId: 2, leagueId: 1, abbr: 'ROM' },
  { pattern: 'Bite', divisionId: 2, leagueId: 1, abbr: 'ADE' },
  { pattern: 'Dragons', divisionId: 2, leagueId: 1, abbr: 'AMS' },
  { pattern: 'Tigers', divisionId: 2, leagueId: 1, abbr: 'TOK' },
  // Archipelago (div 3, league 2)
  { pattern: 'Sugar Kings', divisionId: 3, leagueId: 2, abbr: 'HAV' },
  { pattern: 'Shellbacks', divisionId: 3, leagueId: 2, abbr: 'GAL' },
  { pattern: 'Mermen', divisionId: 3, leagueId: 2, abbr: 'STL' },
  { pattern: 'Sun Chasers', divisionId: 3, leagueId: 2, abbr: 'SMN' },
  { pattern: 'Bedouins', divisionId: 3, leagueId: 2, abbr: 'DUB' },
  // Pablo Escobar (div 4, league 2)
  { pattern: 'Blucifers', divisionId: 4, leagueId: 2, abbr: 'DEN' },
  { pattern: 'Surfers', divisionId: 4, leagueId: 2, abbr: 'CAL' },
  { pattern: 'Blue Wave', divisionId: 4, leagueId: 2, abbr: 'CUR' },
  { pattern: 'Honu', divisionId: 4, leagueId: 2, abbr: 'HON' },
  { pattern: 'Red Coats', divisionId: 4, leagueId: 2, abbr: 'LDN' },
];

function lookupDivision(teamName: string): { divisionId: number; leagueId: number; abbr: string } {
  const match = TEAM_NAME_PATTERNS.find(p => teamName.includes(p.pattern));
  return match ?? { divisionId: 1, leagueId: 1, abbr: teamName.substring(0, 3).toUpperCase() };
}

// ============================================================================
// Data Loading
// ============================================================================

/** Default batter rates when blended rates are missing */
const DEFAULT_BATTER = {
  bbPct: 0.08,
  kPct: 0.22,
  hrPct: 0.03,
  avg: 0.250,
  doublesRate: 0.045,
  triplesRate: 0.005,
  speed: 50,
};

/** Default pitcher rates */
const DEFAULT_PITCHER = {
  k9: 7.5,
  bb9: 3.0,
  hr9: 1.2,
  stamina: 50,
  trueRating: 40,
};

function computeWoba(
  pBB: number,
  pSingle: number,
  pDouble: number,
  pTriple: number,
  pHR: number,
): number {
  return 0.69 * pBB + 0.89 * pSingle + 1.27 * pDouble + 1.62 * pTriple + 2.10 * pHR;
}

function convertBatter(b: RatedBatter): BatterSnapshot {
  // blendedBbPct/KPct/HrPct are stored as whole-number percentages (e.g. 8.5 = 8.5%)
  // batterRatesToVector expects decimals (0.085), so divide by 100.
  // blendedAvg, blendedDoublesRate, blendedTriplesRate are already decimals.
  const bbPct = (b.blendedBbPct ?? DEFAULT_BATTER.bbPct * 100) / 100;
  const kPct = (b.blendedKPct ?? DEFAULT_BATTER.kPct * 100) / 100;
  const hrPct = (b.blendedHrPct ?? DEFAULT_BATTER.hrPct * 100) / 100;
  const avg = b.blendedAvg ?? DEFAULT_BATTER.avg;
  const doublesRate = b.blendedDoublesRate ?? DEFAULT_BATTER.doublesRate;
  const triplesRate = b.blendedTriplesRate ?? DEFAULT_BATTER.triplesRate;

  const vector = batterRatesToVector(bbPct, kPct, hrPct, avg, doublesRate, triplesRate);

  const woba = b.woba ?? computeWoba(vector.pBB, vector.pSingle, vector.pDouble, vector.pTriple, vector.pHR);

  return {
    playerId: b.playerId,
    name: b.name,
    position: b.positionLabel,
    ...vector,
    projectedPa: b.stats?.pa ?? 500,
    injuryTier: (b as any).injuryProneness ?? 'Normal',
    speed: b.estimatedSpeed ?? DEFAULT_BATTER.speed,
    stealAggression: b.stealAggression ?? 50,
    stealAbility: b.stealAbility ?? 50,
    woba,
    positionRating: (b as any).positionRating ?? 50,
    defRuns: (b as any).defRuns ?? 0,
  };
}

function convertPitcher(p: RatedPitcher | RatedPlayer): PitcherSnapshot {
  const k9 = p.stats?.k9 ?? DEFAULT_PITCHER.k9;
  const bb9 = p.stats?.bb9 ?? DEFAULT_PITCHER.bb9;
  const hr9 = p.stats?.hr9 ?? DEFAULT_PITCHER.hr9;
  const rates = pitcherRatesToPerPA(k9, bb9, hr9);

  // RatedPitcher has `role: string`, RatedPlayer has `isSp: boolean`
  const isSp = 'role' in p ? p.role === 'SP' : p.isSp;

  return {
    playerId: p.playerId,
    name: p.name,
    role: isSp ? 'SP' : 'RP',
    ...rates,
    projectedIp: p.stats?.ip ?? (isSp ? 180 : 60),
    stamina: (p as any).stamina ?? DEFAULT_PITCHER.stamina,
    trueRating: p.trueRating ?? DEFAULT_PITCHER.trueRating,
    injuryProneness: (p as any).injuryProneness ?? 'Normal',
  };
}

/**
 * Load all team data and convert to TeamSnapshot[] for simulation.
 * Uses projected/blended rates (not raw stats) so small-sample pitchers
 * get regressed toward league averages instead of using extreme raw rates.
 */
export async function loadTeamSnapshots(year: number): Promise<TeamSnapshot[]> {
  const projected = await teamRatingsService.getProjectedTeamRatings(year, { preSeasonOnly: true });

  const teams = projected.map(r => {
    const div = lookupDivision(r.teamName);

    const lineup = (r.lineup ?? []).map(convertBatter);
    const bench = (r.bench ?? []).map(convertBatter);
    const rotation = r.rotation.map(convertPitcher);
    const bullpen = r.bullpen.map(convertPitcher);

    // Ensure minimum roster sizes with placeholder players
    while (lineup.length < 9) {
      lineup.push(createPlaceholderBatter(lineup.length));
    }
    while (rotation.length < 5) {
      rotation.push(createPlaceholderPitcher(rotation.length, 'SP'));
    }

    // Sort bullpen descending by trueRating; best RP is the closer at index 0
    bullpen.sort((a, b) => b.trueRating - a.trueRating);
    const closerIdx = 0;

    return {
      teamId: r.teamId ?? 0,
      teamName: r.teamName,
      abbr: div.abbr,
      leagueId: div.leagueId,
      divisionId: div.divisionId,
      lineup,
      bench,
      rotation,
      bullpen,
      closerIdx,
    };
  });

  // ── XBH mean-shift calibration ──
  // Multiplicative boost to compensate for log5 + contact-pool compression
  // ── Team-level XBH spread amplification ──
  // The projection system produces narrow team-level 2B/3B variance (~20 doubles
  // range across 20 teams). Instead of distorting individual batter rates (which
  // creates unrealistic player lines), we amplify the deviation of each TEAM's
  // average XBH rate from the league mean, then scale all batters on that team
  // proportionally. This preserves realistic individual rate relationships while
  // creating historical team-level spread.
  const TEAM_DOUBLE_SPREAD = 17.0;   // team-level 2B deviation amplifier
  const TEAM_TRIPLE_SPREAD = 45.0;   // team-level 3B deviation amplifier
  const DOUBLE_MEAN_MULT = 1.08;
  const TRIPLE_MEAN_MULT = 1.20;

  // Compute league-wide average 2B/3B rates from lineup batters
  const allLineup = teams.flatMap(t => t.lineup);
  const lgPDbl = allLineup.reduce((s, b) => s + b.pDouble, 0) / allLineup.length;
  const lgPTri = allLineup.reduce((s, b) => s + b.pTriple, 0) / allLineup.length;
  const _spreadDebug: Record<string, any> = {};
  if (typeof window !== 'undefined') (window as any).__spreadDebug = _spreadDebug;

  for (const team of teams) {
    const lu = team.lineup;
    if (lu.length === 0) continue;

    // Compute this team's average 2B/3B rate
    const teamAvgDbl = lu.reduce((s, b) => s + b.pDouble, 0) / lu.length;
    const teamAvgTri = lu.reduce((s, b) => s + b.pTriple, 0) / lu.length;

    // Amplify team deviation from league mean
    const ampTeamDbl = lgPDbl + (teamAvgDbl - lgPDbl) * TEAM_DOUBLE_SPREAD;
    const ampTeamTri = lgPTri + (teamAvgTri - lgPTri) * TEAM_TRIPLE_SPREAD;

    // Compute team-level multiplier (preserves within-team relative differences)
    const dblMult = teamAvgDbl > 0 ? Math.max(0.3, (ampTeamDbl / teamAvgDbl)) * DOUBLE_MEAN_MULT : 1;
    const triMult = teamAvgTri > 0 ? Math.max(0.3, (ampTeamTri / teamAvgTri)) * TRIPLE_MEAN_MULT : 1;

    _spreadDebug[team.abbr] = { teamAvgDbl, lgPDbl, dev: teamAvgDbl - lgPDbl, ampTeamDbl, dblMult, triMult };

    // Apply to all batters on this team (lineup + bench)
    for (const b of [...lu, ...team.bench]) {
      const oldDbl = b.pDouble;
      const oldTri = b.pTriple;
      b.pDouble *= dblMult;
      b.pTriple *= triMult;

      // Absorb XBH change: 70% from singles, 30% from outs.
      // Taking mostly from singles corrects the hit-type mix (too many 1B vs XBH)
      // while taking a little from outs nudges AVG up toward the ~.273 target.
      const xbhDelta = (b.pDouble - oldDbl) + (b.pTriple - oldTri);
      if (xbhDelta !== 0) {
        const fromSingles = xbhDelta * 0.70;
        const fromOuts = xbhDelta * 0.30;
        if (b.pSingle > fromSingles + 0.01 && b.pOut > fromOuts + 0.01) {
          b.pSingle -= fromSingles;
          b.pOut -= fromOuts;
        } else {
          // Fallback: split proportionally if pools are too small
          const soPool = b.pSingle + b.pOut;
          if (soPool > 0.05) {
            const singleShare = b.pSingle / soPool;
            b.pSingle = Math.max(0.01, b.pSingle - xbhDelta * singleShare);
            b.pOut = Math.max(0.01, b.pOut - xbhDelta * (1 - singleShare));
          }
        }
      }
    }
  }

  // AVG calibration removed — individual projections should drive team-level
  // stats naturally. A hardcoded league AVG target inflated every batter's
  // sim line ~13 points above their canonical projection.

  // ── Per-team rate diagnostic ──
  const teamDblRates = teams.map(t => {
    const lu = t.lineup;
    const avgDbl = lu.reduce((s, b) => s + b.pDouble, 0) / lu.length;
    const avgHR = lu.reduce((s, b) => s + b.pHR, 0) / lu.length;
    const avgTri = lu.reduce((s, b) => s + b.pTriple, 0) / lu.length;
    return { abbr: t.abbr, dbl: avgDbl, hr: avgHR, tri: avgTri };
  }).sort((a, b) => a.dbl - b.dbl);
  const dblMin = (teamDblRates[0].dbl * 5400).toFixed(0);
  const dblMax = (teamDblRates[teamDblRates.length - 1].dbl * 5400).toFixed(0);
  const hrMin = (Math.min(...teamDblRates.map(t => t.hr)) * 5400).toFixed(0);
  const hrMax = (Math.max(...teamDblRates.map(t => t.hr)) * 5400).toFixed(0);
  const triMin = (Math.min(...teamDblRates.map(t => t.tri)) * 5400).toFixed(0);
  const triMax = (Math.max(...teamDblRates.map(t => t.tri)) * 5400).toFixed(0);
  console.log(`[SIM_RATES] Pre-sim projected per-5400AB: 2B=${dblMin}-${dblMax} HR=${hrMin}-${hrMax} 3B=${triMin}-${triMax} | ${teamDblRates[0].abbr}(low 2B)=${(teamDblRates[0].dbl*5400).toFixed(0)} ${teamDblRates[teamDblRates.length-1].abbr}(high 2B)=${(teamDblRates[teamDblRates.length-1].dbl*5400).toFixed(0)}`);

  // Debug: expose snapshots for inspection
  if (typeof window !== 'undefined') (window as any).__simSnapshots = teams;

  return teams;
}

/**
 * Compute league-average per-PA rates from the team snapshots themselves.
 * This guarantees the log5 baseline matches the actual population of
 * batter/pitcher rates in the simulation.
 */
export function computeLeagueRatesFromSnapshots(teams: TeamSnapshot[]): LeagueAverageRates {
  // Average all batters' PA vectors to get the league baseline
  let totalBB = 0, totalK = 0, totalHR = 0;
  let totalSingle = 0, totalDouble = 0, totalTriple = 0, totalOut = 0;
  let count = 0;

  for (const team of teams) {
    for (const b of team.lineup) {
      totalBB += b.pBB;
      totalK += b.pK;
      totalHR += b.pHR;
      totalSingle += b.pSingle;
      totalDouble += b.pDouble;
      totalTriple += b.pTriple;
      totalOut += b.pOut;
      count++;
    }
  }

  if (count === 0) {
    return {
      bbPct: 0.083, kPct: 0.215, hrRate: 0.030,
      singleRate: 0.153, doubleRate: 0.045, tripleRate: 0.005, outRate: 0.669,
    };
  }

  // Also average pitcher TTO rates to get the pitcher-side baseline
  let pitcherK = 0, pitcherBB = 0, pitcherHR = 0;
  let pCount = 0;
  for (const team of teams) {
    for (const p of [...team.rotation, ...team.bullpen]) {
      pitcherK += p.pK;
      pitcherBB += p.pBB;
      pitcherHR += p.pHR;
      pCount++;
    }
  }
  // Suppress unused variable warnings
  void pitcherK; void pitcherBB; void pitcherHR; void pCount;

  // The league average should be the geometric mean of batter and pitcher rates
  // (since log5 computes batter*pitcher/league, league = sqrt(batter_avg * pitcher_avg)
  // is one valid baseline). In practice, using the batter average works well since
  // the log5 formula self-corrects when the baseline matches the population.
  return {
    bbPct: totalBB / count,
    kPct: totalK / count,
    hrRate: totalHR / count,
    singleRate: totalSingle / count,
    doubleRate: totalDouble / count,
    tripleRate: totalTriple / count,
    outRate: totalOut / count,
  };
}

// ============================================================================
// Placeholder players (for incomplete rosters)
// ============================================================================

function createPlaceholderBatter(idx: number): BatterSnapshot {
  const v = batterRatesToVector(
    DEFAULT_BATTER.bbPct,
    DEFAULT_BATTER.kPct,
    DEFAULT_BATTER.hrPct,
    DEFAULT_BATTER.avg,
    DEFAULT_BATTER.doublesRate,
    DEFAULT_BATTER.triplesRate,
  );
  const woba = computeWoba(v.pBB, v.pSingle, v.pDouble, v.pTriple, v.pHR);
  return {
    playerId: -1000 - idx,
    name: 'Replacement',
    position: 'DH',
    ...v,
    projectedPa: 400,
    injuryTier: 'Normal',
    speed: 45,
    stealAggression: 40,
    stealAbility: 40,
    woba,
    positionRating: 50,
    defRuns: 0,
  };
}

function createPlaceholderPitcher(idx: number, role: 'SP' | 'RP'): PitcherSnapshot {
  const rates = pitcherRatesToPerPA(DEFAULT_PITCHER.k9, DEFAULT_PITCHER.bb9, DEFAULT_PITCHER.hr9);
  return {
    playerId: -2000 - idx,
    name: 'Replacement',
    role,
    ...rates,
    projectedIp: role === 'SP' ? 150 : 50,
    stamina: DEFAULT_PITCHER.stamina,
    trueRating: DEFAULT_PITCHER.trueRating,
    injuryProneness: 'Normal',
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run a full simulation (season or series) with data loading.
 */
export async function runSimulation(
  config: SimConfig,
  onProgress?: SimProgressCallback,
): Promise<SimulationResults> {
  // Load team data, then compute league baseline from the actual population
  const teams = await loadTeamSnapshots(config.year);
  const league = computeLeagueRatesFromSnapshots(teams);

  // Debug dump available: call debugDumpTeams(teams, league) from console or uncomment below
  // debugDumpTeams(teams, league);

  if (config.mode === 'series' && config.teams) {
    const [id1, id2] = config.teams;
    const team1 = teams.find(t => t.teamId === id1);
    const team2 = teams.find(t => t.teamId === id2);
    if (!team1 || !team2) {
      throw new Error(`Team not found: ${id1} or ${id2}`);
    }
    return runSeriesSimulation(team1, team2, league, config, onProgress);
  }

  return runSeasonSimulation(teams, league, config, onProgress);
}

// ============================================================================
// Debug / diagnostics
// ============================================================================

/** Call from devtools: window._simDebug() after running a simulation */
export function debugDumpTeams(teams: TeamSnapshot[], league: LeagueAverageRates): void {
  console.group('🎲 Simulation Debug Dump');

  console.log('League baseline:', {
    bbPct: (league.bbPct * 100).toFixed(1) + '%',
    kPct: (league.kPct * 100).toFixed(1) + '%',
    hrRate: (league.hrRate * 100).toFixed(2) + '%',
    singleRate: (league.singleRate * 100).toFixed(1) + '%',
    outRate: (league.outRate * 100).toFixed(1) + '%',
  });

  const rows = teams.map(t => {
    const lu = t.lineup;
    const avgBB = lu.reduce((s, b) => s + b.pBB, 0) / lu.length;
    const avgK = lu.reduce((s, b) => s + b.pK, 0) / lu.length;
    const avgHR = lu.reduce((s, b) => s + b.pHR, 0) / lu.length;
    const avg1B = lu.reduce((s, b) => s + b.pSingle, 0) / lu.length;
    const avgOut = lu.reduce((s, b) => s + b.pOut, 0) / lu.length;
    const obp = lu.reduce((s, b) => s + b.pBB + b.pSingle + b.pDouble + b.pTriple + b.pHR, 0) / lu.length;

    const allP = [...t.rotation, ...t.bullpen];
    const avgPK = allP.length > 0 ? allP.reduce((s, p) => s + p.pK, 0) / allP.length : 0;
    const avgPBB = allP.length > 0 ? allP.reduce((s, p) => s + p.pBB, 0) / allP.length : 0;
    const avgPHR = allP.length > 0 ? allP.reduce((s, p) => s + p.pHR, 0) / allP.length : 0;
    const realBatters = lu.filter(b => b.playerId > 0).length;
    const realPitchers = allP.filter(p => p.playerId > 0).length;

    return {
      team: t.teamName,
      div: t.divisionId,
      lg: t.leagueId,
      batters: `${realBatters}/${lu.length}`,
      'BB%': (avgBB * 100).toFixed(1),
      'K%': (avgK * 100).toFixed(1),
      'HR%': (avgHR * 100).toFixed(2),
      '1B%': (avg1B * 100).toFixed(1),
      'Out%': (avgOut * 100).toFixed(1),
      OBP: (obp * 100).toFixed(1),
      pitchers: `${realPitchers}/${allP.length}`,
      'pK%': (avgPK * 100).toFixed(1),
      'pBB%': (avgPBB * 100).toFixed(1),
      'pHR%': (avgPHR * 100).toFixed(2),
    };
  }).sort((a, b) => parseFloat(b.OBP) - parseFloat(a.OBP));

  console.table(rows);

  // Flag any teams where all batters have identical rates (sign of all-defaults)
  for (const t of teams) {
    const uniqueBBs = new Set(t.lineup.map(b => b.pBB.toFixed(4)));
    if (uniqueBBs.size === 1 && t.lineup.length > 1) {
      console.warn(`⚠️ ${t.teamName}: All ${t.lineup.length} batters have IDENTICAL BB rates — likely all defaults`);
    }
  }

  // Division assignment check
  const divCounts = new Map<number, string[]>();
  for (const t of teams) {
    const arr = divCounts.get(t.divisionId) ?? [];
    arr.push(t.teamName);
    divCounts.set(t.divisionId, arr);
  }
  console.log('Division assignments:');
  for (const [div, names] of divCounts) {
    console.log(`  Div ${div} (${names.length} teams): ${names.join(', ')}`);
  }

  // Schedule game count check
  const gamesPerTeam = new Map<number, number>();
  for (const t of teams) gamesPerTeam.set(t.teamId, 0);
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i], b = teams[j];
      const sameDivision = a.divisionId === b.divisionId;
      const sameLeague = a.leagueId === b.leagueId;
      const games = sameDivision ? 18 : sameLeague ? 8 : 5;
      gamesPerTeam.set(a.teamId, (gamesPerTeam.get(a.teamId) ?? 0) + games);
      gamesPerTeam.set(b.teamId, (gamesPerTeam.get(b.teamId) ?? 0) + games);
    }
  }
  const gameCounts = [...gamesPerTeam.entries()].map(([id, g]) => {
    const t = teams.find(t => t.teamId === id);
    return { team: t?.teamName ?? String(id), games: g };
  });
  const badSchedule = gameCounts.filter(g => g.games !== 162);
  if (badSchedule.length > 0) {
    console.warn('⚠️ SCHEDULE ERROR — teams not at 162 games:', badSchedule);
  } else {
    console.log('✓ All teams play exactly 162 games');
  }

  console.groupEnd();
}

/**
 * Dump a team's roster stats from the last simulation.
 * Call from devtools: window._simRoster('DEN') or window._simRoster('Denver')
 */
export function dumpTeamRoster(results: SimulationResults, teamQuery: string): void {
  if (!results.leaderboards) { console.log('No leaderboard data'); return; }
  const { allBatters, allPitchers } = results.leaderboards;
  if (!allBatters) { console.log('No full roster data — re-run simulation'); return; }

  const q = teamQuery.toUpperCase();
  const summary = results.teamSummaries.find(s =>
    s.abbr.toUpperCase() === q || s.teamName.toUpperCase().includes(q)
  );
  if (!summary) { console.log(`Team "${teamQuery}" not found. Teams: ${results.teamSummaries.map(s => s.abbr).join(', ')}`); return; }
  const teamId = summary.teamId;

  console.log(`\n=== ${summary.teamName} (${summary.abbr}) — Simulated Roster ===`);
  console.log(`Team: ${summary.meanWins}W, RS=${summary.medianRS}, RA=${summary.medianRA}\n`);

  // Batters
  const batters = allBatters.filter(b => b.teamId === teamId).sort((a, b) => b.pa - a.pa);
  const batLines = batters.map(b =>
    `${b.name.padEnd(22)} ${String(Math.round(b.pa)).padStart(4)} ${String(Math.round(b.ab)).padStart(4)} ${b.avg.toFixed(3)} ${b.obp.toFixed(3)} ${b.slg.toFixed(3)} ${String(Math.round(b.hr)).padStart(3)} ${String(Math.round(b.doubles)).padStart(3)} ${String(Math.round(b.triples)).padStart(3)} ${String(Math.round(b.bb)).padStart(3)} ${String(Math.round(b.k)).padStart(4)} ${b.war.toFixed(1).padStart(5)}`
  );
  console.log(`[SIM_ROSTER] BATTERS\nPlayer                  PA   AB   AVG   OBP   SLG  HR  2B  3B  BB    K   WAR\n${batLines.join('\n')}`);

  // Team batting totals
  const totPA = batters.reduce((s, b) => s + b.pa, 0);
  const totAB = batters.reduce((s, b) => s + b.ab, 0);
  const totH = batters.reduce((s, b) => s + b.h, 0);
  const tot2B = batters.reduce((s, b) => s + b.doubles, 0);
  const tot3B = batters.reduce((s, b) => s + b.triples, 0);
  const totHR = batters.reduce((s, b) => s + b.hr, 0);
  const totBB = batters.reduce((s, b) => s + b.bb, 0);
  const totK = batters.reduce((s, b) => s + b.k, 0);
  console.log(`TEAM TOTALS: PA=${Math.round(totPA)} AB=${Math.round(totAB)} AVG=${(totH/totAB).toFixed(3)} H=${Math.round(totH)} 2B=${Math.round(tot2B)} 3B=${Math.round(tot3B)} HR=${Math.round(totHR)} BB=${Math.round(totBB)} K=${Math.round(totK)}`);

  // Pitchers
  const pitchers = allPitchers.filter(p => p.teamId === teamId).sort((a, b) => b.ip - a.ip);
  if (pitchers.length > 0) {
    const pitLines = pitchers.map(p =>
      `${p.name.padEnd(22)} ${String(Math.round(p.ip)).padStart(4)} ${p.era.toFixed(2).padStart(5)} ${p.fip.toFixed(2).padStart(5)} ${String(Math.round(p.k)).padStart(4)} ${String(Math.round(p.bb)).padStart(3)} ${String(Math.round(p.hr)).padStart(3)} ${p.war.toFixed(1).padStart(5)}`
    );
    console.log(`[SIM_ROSTER] PITCHERS\nPlayer                  IP   ERA   FIP    K  BB  HR   WAR\n${pitLines.join('\n')}`);
  }
}

// Wire roster dump to window for devtools access
if (typeof window !== 'undefined') {
  (window as any)._simRoster = (teamQuery: string) => {
    const results = (window as any).__lastSimResults;
    if (!results) { console.log('No simulation results. Run a sim first.'); return; }
    dumpTeamRoster(results, teamQuery);
  };
}
