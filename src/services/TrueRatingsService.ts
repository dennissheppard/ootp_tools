import { Player } from '../models/Player';
import { playerService } from './PlayerService';
import { LeagueAverages, YearlyPitchingStats } from './TrueRatingsCalculationService';

// From https://statsplus.net/wbl/api/playerpitchstatsv2/?year=2020
export interface TruePitchingStats {
  id: number;
  player_id: number;
  year: number;
  team_id: number;
  game_id: number;
  league_id: number;
  level_id: number;
  split_id: number;
  ip: string;
  ab: number;
  tb: number;
  ha: number;
  k: number;
  bf: number;
  rs: number;
  bb: number;
  r: number;
  er: number;
  gb: number;
  fb: number;
  pi: number;
  ipf: number;
  g: number;
  gs: number;
  w: number;
  l: number;
  s: number;
  sa: number;
  da: number;
  sh: number;
  sf: number;
  ta: number;
  hra: number;
  bk: number;
  ci: number;
  iw: number;
  wp: number;
  hp: number;
  gf: number;
  dp: number;
  qs: number;
  svo: number;
  bs: number;
  ra: number;
  cg: number;
  sho: number;
  sb: number;
  cs: number;
  hld: number;
  ir: number;
  irs: number;
  wpa: number;
  li: number;
  stint: number;
  outs: number;
  sd: number;
  md: number;
  war: number;
  ra9war: number;
}

export interface TrueBattingStats {
    id: number;
    player_id: number;
    year: number;
    team_id: number;
    game_id: number;
    league_id: number;
    level_id: number;
    split_id: number;
    position: number;
    ab: number;
    h: number;
    k: number;
    pa: number;
    pitches_seen: number;
    g: number;
    gs: number;
    d: number;
    t: number;
    hr: number;
    r: number;
    rbi: number;
    sb: number;
    cs: number;
    bb: number;
    ibb: number;
    gdp: number;
    sh: number;
    sf: number;
    hp: number;
    ci: number;
    wpa: number;
    stint: number;
    ubr: number;
    war: number;
    avg: number;
    obp: number;
}

export interface TruePlayerStats extends TruePitchingStats {
  playerName: string;
}

export interface TruePlayerBattingStats extends TrueBattingStats {
  playerName: string;
}

type StatsType = 'pitching' | 'batting';

const API_BASE = '/api-wbl/api';
const CACHE_KEY_PREFIX = 'wbl_true_ratings_cache_';
const CACHE_TIMESTAMP_KEY_PREFIX = 'wbl_true_ratings_cache_timestamp_';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

class TrueRatingsService {
  private inMemoryPitchingCache: Map<number, TruePlayerStats[]> = new Map();
  private inMemoryBattingCache: Map<number, TruePlayerBattingStats[]> = new Map();

  public async getTruePitchingStats(year: number): Promise<TruePlayerStats[]> {
    if (this.inMemoryPitchingCache.has(year)) {
      return this.inMemoryPitchingCache.get(year)!;
    }

    const cached = this.loadFromCache<TruePlayerStats[]>(year, 'pitching');
    if (cached) {
      this.inMemoryPitchingCache.set(year, cached);
      return cached;
    }

    const playerStats = await this.fetchAndProcessStats(year, 'pitching', 'playerpitchstatsv2') as TruePlayerStats[];
    this.inMemoryPitchingCache.set(year, playerStats);
    this.saveToCache(year, playerStats, 'pitching');
    return playerStats;
  }

  public async getTrueBattingStats(year: number): Promise<TruePlayerBattingStats[]> {
    if (this.inMemoryBattingCache.has(year)) {
      return this.inMemoryBattingCache.get(year)!;
    }

    const cached = this.loadFromCache<TruePlayerBattingStats[]>(year, 'batting');
    if (cached) {
      this.inMemoryBattingCache.set(year, cached);
      return cached;
    }
    
    const playerStats = await this.fetchAndProcessStats(year, 'batting', 'playerbatstatsv2') as TruePlayerBattingStats[];
    this.inMemoryBattingCache.set(year, playerStats);
    this.saveToCache(year, playerStats, 'batting');
    return playerStats;
  }

  private async fetchAndProcessStats(year: number, type: StatsType, apiEndpoint: string): Promise<(TruePlayerStats | TruePlayerBattingStats)[]> {
    const response = await fetch(`${API_BASE}/${apiEndpoint}/?year=${year}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch true ${type} stats for ${year}`);
    }

    const csvText = await response.text();
    const stats = this.parseStatsCsv(csvText, type);
    const players = await playerService.getAllPlayers();
    
    const playerMap = new Map<number, Player>();
    for (const player of players) {
      playerMap.set(player.id, player);
    }

    return stats
      .map(stat => {
        const player = playerMap.get(stat.player_id);
        return {
          ...stat,
          playerName: player ? `${player.firstName} ${player.lastName}` : 'Unknown Player'
        };
      })
      .filter(s => s.split_id === 1);
  }

  private parseStatsCsv(csv: string, type: StatsType): (TruePitchingStats | TrueBattingStats)[] {
    const lines = csv.trim().split('\n');
    const header = this.parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);

    return dataLines.map((line) => {
        const values = this.parseCsvLine(line);
        const entry: any = {};
        header.forEach((h, i) => {
            const key = h.trim();
            const value = values[i];
            if (key === 'ip') {
                entry[key] = value;
            } else {
                entry[key] = isNaN(Number(value)) || value === '' ? value : Number(value);
            }
        });

        if (type === 'batting') {
            const battingStat = entry as TrueBattingStats;
            battingStat.avg = battingStat.ab > 0 ? battingStat.h / battingStat.ab : 0;
            battingStat.obp = battingStat.pa > 0 ? (battingStat.h + battingStat.bb + battingStat.hp) / battingStat.pa : 0;
        }

        return entry;
    });
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    return values;
  }

  private loadFromCache<T>(year: number, type: StatsType): T | null {
    try {
      const timestampKey = `${CACHE_TIMESTAMP_KEY_PREFIX}${type}_${year}`;
      const cacheKey = `${CACHE_KEY_PREFIX}${type}_${year}`;
      
      const timestamp = localStorage.getItem(timestampKey);
      if (!timestamp) return null;

      const parsedTimestamp = parseInt(timestamp, 10);

      // If timestamp is 0, it's a permanent cache, so skip age check
      if (parsedTimestamp === 0) {
        const cached = localStorage.getItem(cacheKey);
        return cached ? JSON.parse(cached) as T : null;
      }

      const cacheAge = Date.now() - parsedTimestamp;
      if (cacheAge > CACHE_DURATION_MS) {
        this.clearCache(year, type); // Clear expired cache
        return null;
      }

      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;

      return JSON.parse(cached) as T;
    } catch {
      this.clearCache(year, type);
      return null;
    }
  }

  private saveToCache(year: number, stats: any[], type: StatsType): void {
    try {
      const timestampKey = `${CACHE_TIMESTAMP_KEY_PREFIX}${type}_${year}`;
      const cacheKey = `${CACHE_KEY_PREFIX}${type}_${year}`;
      localStorage.setItem(cacheKey, JSON.stringify(stats));
      // For years before 2020, set a special timestamp (0) to indicate permanent cache
      // Otherwise, set current timestamp for 24-hour expiration
      localStorage.setItem(timestampKey, (year < 2020 ? 0 : Date.now()).toString());
    } catch {
      // Cache write failed (e.g., quota exceeded), ignore
    }
  }

  private clearCache(year: number, type: StatsType): void {
    const timestampKey = `${CACHE_TIMESTAMP_KEY_PREFIX}${type}_${year}`;
    const cacheKey = `${CACHE_KEY_PREFIX}${type}_${year}`;
    localStorage.removeItem(cacheKey);
    localStorage.removeItem(timestampKey);
  }

  /**
   * Parse IP string to numeric value
   * OOTP stores IP as "X.Y" where Y is partial innings (0, 1, or 2 outs)
   * e.g., "150.2" = 150 2/3 innings
   */
  public parseIp(ipString: string): number {
    if (!ipString) return 0;
    const parts = ipString.split('.');
    const fullInnings = parseInt(parts[0], 10) || 0;
    const partialOuts = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
    // Convert partial outs (0, 1, 2) to fractional innings
    return fullInnings + (partialOuts / 3);
  }

  /**
   * Calculate league-wide averages for regression calculations
   *
   * @param year - The year to calculate averages for
   * @param minIp - Minimum IP to qualify (default 20)
   * @returns League averages for K/9, BB/9, HR/9
   */
  public async getLeagueAverages(year: number, minIp: number = 20): Promise<LeagueAverages & { totalPitchers: number }> {
    const allStats = await this.getTruePitchingStats(year);

    // Filter to qualified pitchers
    const qualified = allStats.filter(p => this.parseIp(p.ip) >= minIp);

    if (qualified.length === 0) {
      // Return defaults if no qualified pitchers
      return {
        avgK9: 7.5,
        avgBb9: 3.0,
        avgHr9: 0.85,
        totalPitchers: 0,
      };
    }

    // Calculate IP-weighted league averages
    let totalIp = 0;
    let totalK = 0;
    let totalBb = 0;
    let totalHr = 0;

    for (const pitcher of qualified) {
      const ip = this.parseIp(pitcher.ip);
      totalIp += ip;
      totalK += pitcher.k;
      totalBb += pitcher.bb;
      totalHr += pitcher.hra; // Note: 'hra' in the API is home runs allowed (the stat)
    }

    // Convert to per-9 rates
    const avgK9 = totalIp > 0 ? (totalK / totalIp) * 9 : 7.5;
    const avgBb9 = totalIp > 0 ? (totalBb / totalIp) * 9 : 3.0;
    const avgHr9 = totalIp > 0 ? (totalHr / totalIp) * 9 : 0.85;

    return {
      avgK9: Math.round(avgK9 * 100) / 100,
      avgBb9: Math.round(avgBb9 * 100) / 100,
      avgHr9: Math.round(avgHr9 * 100) / 100,
      totalPitchers: qualified.length,
    };
  }

  /**
   * Fetch and aggregate pitching stats across multiple years
   *
   * Returns a map of playerId → yearly stats array (most recent first)
   * Handles players who didn't pitch in all years.
   * Leverages existing caching for each year's data.
   *
   * @param endYear - The most recent year to include
   * @param yearsBack - Number of years to fetch (default 3)
   * @param minIpPerYear - Minimum IP in a year to include that year's stats (default 1)
   * @returns Map of playerId → YearlyPitchingStats[]
   */
  public async getMultiYearPitchingStats(
    endYear: number,
    yearsBack: number = 3,
    minIpPerYear: number = 1
  ): Promise<Map<number, YearlyPitchingStats[]>> {
    // Fetch all years in parallel (leverages existing caching)
    const years = Array.from({ length: yearsBack }, (_, i) => endYear - i);
    const yearlyDataPromises = years.map(year => this.getTruePitchingStats(year));
    const yearlyData = await Promise.all(yearlyDataPromises);

    // Group stats by player ID
    const playerStatsMap = new Map<number, YearlyPitchingStats[]>();

    for (let i = 0; i < years.length; i++) {
      const year = years[i];
      const statsForYear = yearlyData[i];

      for (const pitcher of statsForYear) {
        const ip = this.parseIp(pitcher.ip);

        // Skip if below minimum IP threshold
        if (ip < minIpPerYear) continue;

        // Calculate rate stats
        const k9 = ip > 0 ? (pitcher.k / ip) * 9 : 0;
        const bb9 = ip > 0 ? (pitcher.bb / ip) * 9 : 0;
        const hr9 = ip > 0 ? (pitcher.hra / ip) * 9 : 0; // 'hra' is HR allowed stat

        const yearlyStats: YearlyPitchingStats = {
          year,
          ip: Math.round(ip * 10) / 10,
          k9: Math.round(k9 * 100) / 100,
          bb9: Math.round(bb9 * 100) / 100,
          hr9: Math.round(hr9 * 100) / 100,
        };

        // Add to player's stats array
        if (!playerStatsMap.has(pitcher.player_id)) {
          playerStatsMap.set(pitcher.player_id, []);
        }
        playerStatsMap.get(pitcher.player_id)!.push(yearlyStats);
      }
    }

    // Sort each player's stats by year descending (most recent first)
    playerStatsMap.forEach(stats => {
      stats.sort((a, b) => b.year - a.year);
    });

    return playerStatsMap;
  }

  /**
   * Get player names for a set of player IDs
   * Useful for building TrueRatingInput objects
   *
   * @param playerIds - Set or array of player IDs
   * @returns Map of playerId → playerName
   */
  public async getPlayerNames(playerIds: Iterable<number>): Promise<Map<number, string>> {
    const players = await playerService.getAllPlayers();
    const playerMap = new Map<number, string>();

    const idSet = new Set(playerIds);
    for (const player of players) {
      if (idSet.has(player.id)) {
        playerMap.set(player.id, `${player.firstName} ${player.lastName}`);
      }
    }

    return playerMap;
  }
}

export const trueRatingsService = new TrueRatingsService();
