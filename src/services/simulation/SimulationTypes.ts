/**
 * SimulationTypes — Interfaces for the Monte Carlo season simulation engine.
 */

// ============================================================================
// Configuration
// ============================================================================

export interface SimConfig {
  numSimulations: number;       // default 1000
  mode: 'season' | 'series';   // full season or head-to-head
  teams?: [number, number];     // for series mode: [teamA, teamB]
  seriesLength?: number;        // for playoff series (5 or 7)
  includePlayoffs: boolean;
  homeFieldAdvantage: number;   // default 0.54 (home win rate)
  year: number;                 // season year for data loading
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  numSimulations: 1000,
  mode: 'season',
  includePlayoffs: true,
  homeFieldAdvantage: 0.54,
  year: 2021,
};

// ============================================================================
// Team / Player Snapshots (serializable data for sim engine)
// ============================================================================

export interface BatterSnapshot {
  playerId: number;
  name: string;
  position: string;
  // Per-PA probability vector (sums to 1.0)
  pBB: number;
  pK: number;
  pHR: number;
  pTriple: number;
  pDouble: number;
  pSingle: number;
  pOut: number;
  // Workload
  projectedPa: number;
  injuryTier: string;
  // Baserunning
  speed: number;  // 20-80 scale, for runner advancement
  stealAggression: number;  // 20-80 scale (SR rating)
  stealAbility: number;     // 20-80 scale (STE rating)
  // New fields
  woba: number;           // pre-computed, used for pinch-hit decisions
  positionRating: number; // 20-80 rating at their assigned position (default 50)
  defRuns: number;        // projected defensive runs above average (already position-weighted)
}

export interface PitcherSnapshot {
  playerId: number;
  name: string;
  role: 'SP' | 'RP';
  // Per-PA rates (used in log5 matchup)
  pK: number;
  pBB: number;
  pHR: number;
  // Workload
  projectedIp: number;
  stamina: number;   // 20-80 scale
  // New fields
  trueRating: number;  // used to identify the closer (highest-rated RP)
  injuryProneness: string;  // 'Iron Man' | 'Durable' | 'Normal' | 'Fragile' | 'Wrecked'
}

export interface TeamSnapshot {
  teamId: number;
  teamName: string;
  abbr: string;
  leagueId: number;    // 1 = Northern, 2 = Southern
  divisionId: number;  // 1-4
  lineup: BatterSnapshot[];     // 9 batters in batting order
  bench: BatterSnapshot[];      // backup batters
  rotation: PitcherSnapshot[];  // 5 starters
  bullpen: PitcherSnapshot[];   // relievers
  closerIdx: number;  // index of best RP in bullpen (pre-sorted desc by trueRating)
}

// ============================================================================
// League Averages (baseline for log5)
// ============================================================================

export interface LeagueAverageRates {
  bbPct: number;
  kPct: number;
  hrRate: number;     // HR per PA
  singleRate: number;
  doubleRate: number;
  tripleRate: number;
  outRate: number;
}

// ============================================================================
// Game State
// ============================================================================

export type BaseState = [boolean, boolean, boolean]; // [1B occupied, 2B occupied, 3B occupied]

export interface GameState {
  inning: number;
  isBottom: boolean;
  outs: number;
  bases: BaseState;
  homeScore: number;
  awayScore: number;
  homeLineupIdx: number;
  awayLineupIdx: number;
  homePitcherIdx: number;  // index into rotation/bullpen
  awayPitcherIdx: number;
  homePitcherIsStarter: boolean;
  awayPitcherIsStarter: boolean;
  homePitcherPitchCount: number;
  awayPitcherPitchCount: number;
  // SP tracking
  homeSPRunsAllowed: number;
  awaySPRunsAllowed: number;
  homeSPInnings: number;       // full innings completed by starter
  awaySPInnings: number;
  // Closer/setup tracking
  homeCloserUsed: boolean;
  awayCloserUsed: boolean;
  homeSetupUsed: boolean;
  awaySetupUsed: boolean;
  // Pinch hit tracking
  homePinchedSlots: Set<number>;
  awayPinchedSlots: Set<number>;
}

export type PAOutcome = 'BB' | 'K' | 'HR' | '3B' | '2B' | '1B' | 'OUT';

// ============================================================================
// Game Result
// ============================================================================

export interface GameResult {
  homeScore: number;
  awayScore: number;
  innings: number;
  homeCloserSave: boolean;
  awayCloserSave: boolean;
  homeCloserPlayerId: number;  // -1 if closer wasn't used
  awayCloserPlayerId: number;
}

// ============================================================================
// Player Stats Tracking
// ============================================================================

export interface PlayerGameStats {
  pa: number;
  ab: number;
  h: number;
  hr: number;
  bb: number;
  k: number;
  doubles: number;
  triples: number;
}

export interface PitcherGameStats {
  outs: number;     // outs recorded (divide by 3 for IP)
  er: number;       // earned runs
  h: number;
  hr: number;
  bb: number;
  k: number;
  saves: number;
}

export interface SimPlayerBattingStats {
  playerId: number;
  name: string;
  teamId: number;
  leagueId: number;
  pa: number;
  ab: number;
  h: number;
  hr: number;
  bb: number;
  k: number;
  doubles: number;
  triples: number;
  avg: number;
  obp: number;
  slg: number;
  woba: number;
  war: number;
}

export interface SimPlayerPitchingStats {
  playerId: number;
  name: string;
  teamId: number;
  leagueId: number;
  ip: number;
  er: number;
  h: number;
  hr: number;
  bb: number;
  k: number;
  era: number;
  fip: number;
  saves: number;
  war: number;
}

export interface SimLeaderboards {
  northernBatters: SimPlayerBattingStats[];
  southernBatters: SimPlayerBattingStats[];
  northernPitchers: SimPlayerPitchingStats[];
  southernPitchers: SimPlayerPitchingStats[];
}

// ============================================================================
// Season Simulation Results
// ============================================================================

export interface TeamSeasonRecord {
  teamId: number;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  divisionRank: number;
  madePlayoffs: boolean;
  wonChampionship: boolean;
}

export interface TeamSummary {
  teamId: number;
  teamName: string;
  abbr: string;
  meanWins: number;
  medianWins: number;
  stdDev: number;
  minWins: number;
  maxWins: number;
  p10Wins: number;
  p90Wins: number;
  meanRS: number;     // average runs scored per season
  meanRA: number;     // average runs allowed per season
  playoffPct: number;
  divisionWinPct: number;
  championshipPct: number;
}

export interface SimulationResults {
  config: SimConfig;
  teamSummaries: TeamSummary[];
  // For series mode
  seriesResult?: {
    team1Wins: number;
    team2Wins: number;
    team1WinPct: number;
    avgScore1: number;
    avgScore2: number;
  };
  elapsedMs: number;
  leaderboards?: SimLeaderboards;
}

// ============================================================================
// Team Season State (for rest/injury tracking across a season)
// ============================================================================

export interface TeamSeasonState {
  consecutiveStarts: number[];  // per lineup slot (9 entries), consecutive game starts
  catcherGamesPlayed: number;   // games since last catcher rest
  restingSlots: Set<number>;    // lineup slots resting this game (set before each game, cleared after)
  relieverConsecutiveDays: Map<number, number>;  // playerId → consecutive days pitched (reset to 0 on rest day)
}

// ============================================================================
// Division / League structure
// ============================================================================

export interface DivisionInfo {
  id: number;
  name: string;
  leagueId: number;  // 1 = Northern, 2 = Southern
  leagueName: string;
  teamAbbrs: string[];
}

export const DIVISIONS: DivisionInfo[] = [
  { id: 1, name: 'Great White North', leagueId: 1, leagueName: 'Northern League', teamAbbrs: ['TOR', 'LON', 'VAN', 'LAP', 'CLE'] },
  { id: 2, name: 'Midnight Express', leagueId: 1, leagueName: 'Northern League', teamAbbrs: ['NKO', 'ROM', 'ADE', 'AMS', 'TOK'] },
  { id: 3, name: 'Archipelago', leagueId: 2, leagueName: 'Southern League', teamAbbrs: ['HAV', 'GAL', 'STL', 'SMN', 'DUB'] },
  { id: 4, name: 'Pablo Escobar', leagueId: 2, leagueName: 'Southern League', teamAbbrs: ['DEN', 'CAL', 'CUR', 'HON', 'LDN'] },
];

/** Look up division for a team abbreviation */
export function getDivisionForTeam(abbr: string): DivisionInfo | undefined {
  return DIVISIONS.find(d => d.teamAbbrs.includes(abbr));
}

// ============================================================================
// Schedule
// ============================================================================

export interface ScheduledGame {
  homeTeamId: number;
  awayTeamId: number;
}

// ============================================================================
// Progress callback
// ============================================================================

export type SimProgressCallback = (completed: number, total: number, status?: string) => void;
