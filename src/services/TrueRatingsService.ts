import { Player } from '../models/Player';
import { playerService } from './PlayerService';

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
}

export const trueRatingsService = new TrueRatingsService();
