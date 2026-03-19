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

  // Calibrate batting average: the pre-season projection model under-projects AVG.
  // Compute current league AVG from batter vectors, then scale pSingle to match
  // the known WBL league average (~.273). This also fixes OBP as a side effect.
  // Target slightly above WBL actual (.273) to compensate for log5 compression
  const TARGET_LEAGUE_AVG = 0.278;
  const allBatters = teams.flatMap(t => t.lineup);
  let totalH = 0, totalAB = 0;
  for (const b of allBatters) {
    const ab = 1 - b.pBB; // AB fraction of PA
    totalH += (b.pSingle + b.pDouble + b.pTriple + b.pHR) * ab; // hits per AB (approximate)
    totalAB += ab;
  }
  // Hits per AB = (pSingle + pDouble + pTriple + pHR) summed, then divide by sum of AB fractions
  // Simpler: just average the hit rates
  const currentAvg = allBatters.length > 0
    ? allBatters.reduce((s, b) => {
        const abFrac = 1 - b.pBB;
        return s + (b.pSingle + b.pDouble + b.pTriple + b.pHR) / abFrac;
      }, 0) / allBatters.length
    : TARGET_LEAGUE_AVG;

  if (currentAvg > 0 && currentAvg < TARGET_LEAGUE_AVG) {
    // Scale up pSingle for all batters (and bench) to close the AVG gap.
    // Only adjust singles — XBH rates are already calibrated.
    const deficit = TARGET_LEAGUE_AVG - currentAvg; // e.g., .273 - .265 = .008
    // deficit in AVG = deficit in singles per AB. Convert to per-PA boost:
    const singleBoostPerPA = deficit * (1 - 0.07); // avg bbPct ~7%
    for (const team of teams) {
      for (const b of [...team.lineup, ...team.bench]) {
        b.pSingle += singleBoostPerPA;
        b.pOut = Math.max(0, b.pOut - singleBoostPerPA);
      }
    }
  }

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
