export interface PitchingStats {
  id: number;
  playerId: number;
  year: number;
  teamId: number;
  leagueId: number;
  levelId: number;
  splitId: number;
  // Core stats
  ip: number;       // Innings pitched
  w: number;        // Wins
  l: number;        // Losses
  era: number;      // Earned run average (calculated)
  g: number;        // Games
  gs: number;       // Games started
  sv: number;       // Saves
  // Batters faced
  bf: number;       // Batters faced
  ab: number;       // At bats
  ha: number;       // Hits allowed
  er: number;       // Earned runs
  r: number;        // Runs
  bb: number;       // Walks
  k: number;        // Strikeouts
  hr: number;       // Home runs allowed
  // Advanced
  whip: number;     // Walks + hits per inning pitched (calculated)
  k9: number;       // Strikeouts per 9 innings (calculated)
  bb9: number;      // Walks per 9 innings (calculated)
  war: number;      // Wins above replacement
  // Additional
  cg: number;       // Complete games
  sho: number;      // Shutouts
  hld: number;      // Holds
  bs: number;       // Blown saves
  qs: number;       // Quality starts
}

export interface BattingStats {
  id: number;
  playerId: number;
  year: number;
  teamId: number;
  leagueId: number;
  levelId: number;
  splitId: number;
  // Core stats
  g: number;        // Games
  ab: number;       // At bats
  pa: number;       // Plate appearances
  h: number;        // Hits
  d: number;        // Doubles
  t: number;        // Triples
  hr: number;       // Home runs
  r: number;        // Runs
  rbi: number;      // Runs batted in
  bb: number;       // Walks
  k: number;        // Strikeouts
  sb: number;       // Stolen bases
  cs: number;       // Caught stealing
  // Calculated
  avg: number;      // Batting average
  obp: number;      // On-base percentage
  slg: number;      // Slugging percentage
  ops: number;      // On-base plus slugging
  war: number;      // Wins above replacement
  // Additional
  ibb: number;      // Intentional walks
  hp: number;       // Hit by pitch
  sh: number;       // Sacrifice hits
  sf: number;       // Sacrifice flies
  gdp: number;      // Ground into double play
}

export type Stats = PitchingStats | BattingStats;

export function isPitchingStats(stats: Stats): stats is PitchingStats {
  return 'ip' in stats && 'era' in stats;
}

export function isBattingStats(stats: Stats): stats is BattingStats {
  return 'avg' in stats && 'obp' in stats;
}
