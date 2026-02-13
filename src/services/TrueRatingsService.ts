import { Player } from '../models/Player';
import { HitterScoutingRatings, PitcherScoutingRatings } from '../models/ScoutingData';
import { playerService } from './PlayerService';
import { statsService } from './StatsService';
import { dateService } from './DateService';
import { LeagueAverages, YearlyPitchingStats, TrueRatingInput, trueRatingsCalculationService } from './TrueRatingsCalculationService';
import { YearlyHittingStats, HitterTrueRatingInput, hitterTrueRatingsCalculationService } from './HitterTrueRatingsCalculationService';
import { DevelopmentSnapshotRecord } from './IndexedDBService';
import { apiFetch } from './ApiClient';
import { indexedDBService } from './IndexedDBService';
import { developmentSnapshotService } from './DevelopmentSnapshotService';
import { minorLeagueBattingStatsService } from './MinorLeagueBattingStatsService';
import { minorLeagueStatsService } from './MinorLeagueStatsService';
// Type-only imports to avoid circular dependency (both TFR services import trueRatingsService)
import type { HitterTrueFutureRatingInput } from './HitterTrueFutureRatingService';
import type { TrueFutureRatingInput } from './TrueFutureRatingService';

/**
 * Yearly stats detail for player profile modal
 */
export interface PlayerYearlyDetail {
  year: number;
  ip: number;
  fip: number;  // Changed from era to fip (fielding independent pitching)
  k9: number;
  bb9: number;
  hr9: number;
  war: number;
  gs: number;
}

// From https://atl-01.statsplus.net/world/api/playerpitchstatsv2/?year=2020
export interface TruePitchingStats {
  id: number;
  player_id: number;
  year: number;
  team_id: number;
  game_id: number;
  league_id: number;
  level_id: number;
  split_id: number;
  position?: number;
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

// True Ratings endpoints live under the "world" league slug.
const API_BASE = '/api';
export const LEAGUE_START_YEAR = 2000;

class TrueRatingsService {
  private inMemoryPitchingCache: Map<number, TruePlayerStats[]> = new Map();
  private inMemoryBattingCache: Map<number, TruePlayerBattingStats[]> = new Map();
  private inMemoryPitchingByTeamCache: Map<number, TruePlayerStats[]> = new Map();

  // Cache for in-flight API requests to prevent duplicate calls
  private inFlightPitchingRequests: Map<number, Promise<TruePlayerStats[]>> = new Map();
  private inFlightBattingRequests: Map<number, Promise<TruePlayerBattingStats[]>> = new Map();

  public async getTruePitchingStats(year: number): Promise<TruePlayerStats[]> {
    if (year < LEAGUE_START_YEAR) return [];

    // Check in-memory cache first
    if (this.inMemoryPitchingCache.has(year)) {
      return this.inMemoryPitchingCache.get(year)!;
    }

    // Check IndexedDB cache
    const cached = await this.loadFromCache<TruePlayerStats[]>(year, 'pitching');
    if (cached) {
      const normalized = this.combinePitchingStats(cached);
      this.inMemoryPitchingCache.set(year, normalized);
      if (normalized.length !== cached.length) {
        await this.saveToCache(year, normalized, 'pitching');
      }
      return normalized;
    }

    // Check if request is already in-flight
    const existing = this.inFlightPitchingRequests.get(year);
    if (existing) {
      return existing;
    }

    // Start the fetch and cache the promise
    const fetchPromise = this.fetchPitchingStatsInternal(year)
      .finally(() => {
        // Clean up the in-flight cache when done
        this.inFlightPitchingRequests.delete(year);
      });

    this.inFlightPitchingRequests.set(year, fetchPromise);
    return fetchPromise;
  }

  private async fetchPitchingStatsInternal(year: number): Promise<TruePlayerStats[]> {
    const playerStats = await this.fetchAndProcessStats(year, 'pitching', 'playerpitchstatsv2') as TruePlayerStats[];
    const normalized = this.combinePitchingStats(playerStats);
    this.inMemoryPitchingCache.set(year, normalized);

    // Cache permanently if the year is completed (historical)
    const currentYear = await dateService.getCurrentYear();
    await this.saveToCache(year, normalized, 'pitching', year < currentYear);

    return normalized;
  }

  public async getTruePitchingStatsByTeam(year: number): Promise<TruePlayerStats[]> {
    if (year < LEAGUE_START_YEAR) return [];

    if (this.inMemoryPitchingByTeamCache.has(year)) {
      return this.inMemoryPitchingByTeamCache.get(year)!;
    }

    const playerStats = await this.fetchAndProcessStats(year, 'pitching', 'playerpitchstatsv2') as TruePlayerStats[];
    const normalized = this.combinePitchingStatsByTeam(playerStats);
    this.inMemoryPitchingByTeamCache.set(year, normalized);

    return normalized;
  }

  public async getTrueBattingStats(year: number): Promise<TruePlayerBattingStats[]> {
    // Check in-memory cache first
    if (this.inMemoryBattingCache.has(year)) {
      return this.inMemoryBattingCache.get(year)!;
    }

    // Check IndexedDB cache
    const cached = await this.loadFromCache<TruePlayerBattingStats[]>(year, 'batting');
    if (cached) {
      const normalized = this.combineBattingStats(cached);
      this.inMemoryBattingCache.set(year, normalized);
      if (normalized.length !== cached.length) {
        await this.saveToCache(year, normalized, 'batting');
      }
      return normalized;
    }

    // Check if request is already in-flight
    const existing = this.inFlightBattingRequests.get(year);
    if (existing) {
      return existing;
    }

    // Start the fetch and cache the promise
    const fetchPromise = this.fetchBattingStatsInternal(year)
      .finally(() => {
        // Clean up the in-flight cache when done
        this.inFlightBattingRequests.delete(year);
      });

    this.inFlightBattingRequests.set(year, fetchPromise);
    return fetchPromise;
  }

  private async fetchBattingStatsInternal(year: number): Promise<TruePlayerBattingStats[]> {
    const playerStats = await this.fetchAndProcessStats(year, 'batting', 'playerbatstatsv2') as TruePlayerBattingStats[];
    const normalized = this.combineBattingStats(playerStats);
    this.inMemoryBattingCache.set(year, normalized);

    // Cache permanently if the year is completed (historical)
    const currentYear = await dateService.getCurrentYear();
    await this.saveToCache(year, normalized, 'batting', year < currentYear);

    return normalized;
  }

  /**
   * Load bundled MLB pitching data from CSV files
   * @returns Object with count of files loaded and any errors
   */
  async loadDefaultMlbData(): Promise<{ loaded: number; errors: string[] }> {
    const startYear = LEAGUE_START_YEAR;
    const currentYear = await dateService.getCurrentYear();
    const endYear = currentYear - 1; // Only load historical years; current year comes from API

    let loaded = 0;
    const errors: string[] = [];

    console.log(`📦 Loading bundled MLB data (${startYear}-${endYear})...`);

    for (let year = startYear; year <= endYear; year++) {
      try {
        const filename = `${year}.csv`;
        const url = `/data/mlb/${filename}`;

        // Check if data already exists in cache
        const existing = await this.loadFromCache<TruePlayerStats[]>(year, 'pitching');
        if (existing && existing.length > 0) {
          console.log(`⏭️  Skipping ${filename} (already cached)`);
          continue;
        }

        // Fetch the bundled CSV
        const response = await fetch(url);
        if (!response.ok) {
          // Don't error on 404 - some years might not have data
          if (response.status === 404) {
            console.log(`⏭️  Skipping ${filename} (not in bundle)`);
          } else {
            errors.push(`${filename}: HTTP ${response.status}`);
          }
          continue;
        }

        const csvText = await response.text();
        const rawStats = this.parseStatsCsv(csvText, 'pitching') as TruePitchingStats[];

        if (rawStats.length === 0) {
          console.warn(`⚠️  ${filename} parsed to 0 records, skipping`);
          continue;
        }

        // Process stats to add player info (same as fetchAndProcessStats)
        const players = await playerService.getAllPlayers();
        const playerMap = new Map<number, Player>();
        for (const player of players) {
          playerMap.set(player.id, player);
        }

        const processedStats = rawStats
          .map(stat => ({
            ...stat,
            playerName: playerMap.get(stat.player_id)
              ? `${playerMap.get(stat.player_id)!.firstName} ${playerMap.get(stat.player_id)!.lastName}`
              : 'Unknown Player',
            position: playerMap.get(stat.player_id)?.position || 1
          }))
          .filter(s => s.split_id === 1) as TruePlayerStats[];

        const normalized = this.combinePitchingStats(processedStats);

        // Save to cache (permanent cache for historical data)
        await this.saveToCache(year, normalized, 'pitching', true);
        loaded++;
        console.log(`✅ Loaded ${filename} (${normalized.length} players)`);

      } catch (error) {
        errors.push(`${year}: ${error}`);
        console.error(`❌ Failed to load ${year}:`, error);
      }
    }

    console.log(`📦 Bundled MLB data load complete: ${loaded} datasets loaded, ${errors.length} errors`);
    return { loaded, errors };
  }

  private async fetchAndProcessStats(year: number, type: StatsType, apiEndpoint: string): Promise<(TruePlayerStats | TruePlayerBattingStats)[]> {
    if (year < LEAGUE_START_YEAR) return [];

    const response = await apiFetch(`${API_BASE}/${apiEndpoint}/?year=${year}`);
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
          playerName: player ? `${player.firstName} ${player.lastName}` : 'Unknown Player',
          position: player ? player.position : (type === 'pitching' ? 1 : (stat as any).position)
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

  private combinePitchingStats(stats: TruePlayerStats[]): TruePlayerStats[] {
    const combined = new Map<number, TruePlayerStats>();
    const combinedOuts = new Map<number, number>();
    const skipKeys = new Set([
      'id',
      'player_id',
      'year',
      'team_id',
      'game_id',
      'league_id',
      'level_id',
      'split_id',
      'stint',
      'outs',
      'ipf',
    ]);

    for (const stat of stats) {
      const playerId = stat.player_id;
      const existing = combined.get(playerId);
      const outs = typeof stat.outs === 'number' ? stat.outs : this.ipToOuts(stat.ip);

      if (!existing) {
        const cloned: TruePlayerStats = { ...stat };
        combined.set(playerId, cloned);
        combinedOuts.set(playerId, outs);
        continue;
      }

      combinedOuts.set(playerId, (combinedOuts.get(playerId) ?? 0) + outs);

      Object.keys(stat).forEach((key) => {
        if (key === 'ip' || key === 'playerName') return;
        if (skipKeys.has(key)) return;
        const value = (stat as any)[key];
        if (typeof value === 'number') {
          const current = (existing as any)[key];
          (existing as any)[key] = (typeof current === 'number' ? current : 0) + value;
        }
      });
    }

    combined.forEach((stat, playerId) => {
      const outs = combinedOuts.get(playerId) ?? 0;
      stat.outs = outs;
      stat.ip = this.formatOutsToIp(outs);
      if (typeof stat.ipf === 'number') {
        stat.ipf = Math.round((outs / 3) * 10) / 10;
      }
    });

    return Array.from(combined.values());
  }

  private combinePitchingStatsByTeam(stats: TruePlayerStats[]): TruePlayerStats[] {
    const combined = new Map<string, TruePlayerStats>();
    const combinedOuts = new Map<string, number>();
    const skipKeys = new Set([
      'id',
      'player_id',
      'year',
      'team_id',
      'game_id',
      'league_id',
      'level_id',
      'split_id',
      'stint',
      'outs',
      'ipf',
    ]);

    for (const stat of stats) {
      const teamId = stat.team_id ?? 0;
      if (teamId === 0) continue;
      const key = `${stat.player_id}-${teamId}`;
      const existing = combined.get(key);
      const outs = typeof stat.outs === 'number' ? stat.outs : this.ipToOuts(stat.ip);

      if (!existing) {
        const cloned: TruePlayerStats = { ...stat };
        combined.set(key, cloned);
        combinedOuts.set(key, outs);
        continue;
      }

      combinedOuts.set(key, (combinedOuts.get(key) ?? 0) + outs);

      Object.keys(stat).forEach((k) => {
        if (k === 'ip' || k === 'playerName') return;
        if (skipKeys.has(k)) return;
        const value = (stat as any)[k];
        if (typeof value === 'number') {
          const current = (existing as any)[k];
          (existing as any)[k] = (typeof current === 'number' ? current : 0) + value;
        }
      });
    }

    combined.forEach((stat, key) => {
      const outs = combinedOuts.get(key) ?? 0;
      stat.outs = outs;
      stat.ip = this.formatOutsToIp(outs);
      if (typeof stat.ipf === 'number') {
        stat.ipf = Math.round((outs / 3) * 10) / 10;
      }
    });

    return Array.from(combined.values());
  }

  private combineBattingStats(stats: TruePlayerBattingStats[]): TruePlayerBattingStats[] {
    const combined = new Map<number, TruePlayerBattingStats>();
    const skipKeys = new Set([
      'id',
      'player_id',
      'year',
      'team_id',
      'game_id',
      'league_id',
      'level_id',
      'split_id',
      'stint',
      'position',
    ]);

    for (const stat of stats) {
      const playerId = stat.player_id;
      const existing = combined.get(playerId);
      if (!existing) {
        combined.set(playerId, { ...stat });
        continue;
      }

      Object.keys(stat).forEach((key) => {
        if (key === 'playerName') return;
        if (skipKeys.has(key)) return;
        const value = (stat as any)[key];
        if (typeof value === 'number') {
          const current = (existing as any)[key];
          (existing as any)[key] = (typeof current === 'number' ? current : 0) + value;
        }
      });
    }

    combined.forEach((stat) => {
      stat.avg = stat.ab > 0 ? stat.h / stat.ab : 0;
      stat.obp = stat.pa > 0 ? (stat.h + stat.bb + stat.hp) / stat.pa : 0;
    });

    return Array.from(combined.values());
  }

  private ipToOuts(ipValue: string | number): number {
    const innings = this.parseIp(ipValue);
    return Math.round(innings * 3);
  }

  private formatOutsToIp(outs: number): string {
    if (!Number.isFinite(outs) || outs <= 0) return '0.0';
    const fullInnings = Math.floor(outs / 3);
    const partialOuts = outs % 3;
    return `${fullInnings}.${partialOuts}`;
  }

  private async loadFromCache<T>(year: number, type: StatsType): Promise<T | null> {
    try {
      const cached = await indexedDBService.getMlbLeagueStats(year, type);
      if (!cached) return null;

      const { data, fetchedAt, gameDate } = cached;

      // If timestamp is 0, it's a permanent cache (historical), so skip staleness check
      if (fetchedAt === 0) {
        return data as T;
      }

      // Check if cache is stale (game date changed or missing)
      const currentGameDate = await dateService.getCurrentDate();
      if (gameDate !== currentGameDate) {
        await this.clearCache(year, type);
        return null;
      }

      return data as T;
    } catch (error) {
      console.error(`Error loading ${type} cache for ${year}:`, error);
      await this.clearCache(year, type);
      return null;
    }
  }

  private async saveToCache(year: number, stats: any[], type: StatsType, isPermanent: boolean = false): Promise<void> {
    try {
      const gameDate = await dateService.getCurrentDate();
      await indexedDBService.saveMlbLeagueStats(year, type, stats, isPermanent, gameDate);
    } catch (error) {
      // Cache write failed
      console.error(`❌ Failed to save ${type} data for ${year} to IndexedDB:`, error);
    }
  }

  private async clearCache(year: number, type: StatsType): Promise<void> {
    try {
      await indexedDBService.deleteMlbLeagueStats(year, type);
    } catch (error) {
      console.error(`Error clearing ${type} cache for ${year}:`, error);
    }
  }

  /**
   * Parse IP string to numeric value
   * OOTP stores IP as "X.Y" where Y is partial innings (0, 1, or 2 outs)
   * e.g., "150.2" = 150 2/3 innings
   */
  public parseIp(ipValue: string | number): number {
    if (ipValue === null || ipValue === undefined) return 0;
    const parts = String(ipValue).split('.');
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
    let allStats: TruePlayerStats[] = [];
    try {
      allStats = await this.getTruePitchingStats(year);
    } catch (error) {
      console.warn(`Failed to load league averages for ${year}, using defaults.`, error);
      return {
        avgK9: 7.5,
        avgBb9: 3.0,
        avgHr9: 0.85,
        totalPitchers: 0,
      };
    }

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
   * @param yearsBack - Number of years to fetch (default 4 to support dynamic season weighting)
   * @param minIpPerYear - Minimum IP in a year to include that year's stats (default 1)
   * @returns Map of playerId → YearlyPitchingStats[]
   */
  public async getMultiYearPitchingStats(
    endYear: number,
    yearsBack: number = 4,
    minIpPerYear: number = 1
  ): Promise<Map<number, YearlyPitchingStats[]>> {
    // Fetch all years in parallel (leverages existing caching)
    const years = Array.from({ length: yearsBack }, (_, i) => endYear - i)
      .filter(y => y >= LEAGUE_START_YEAR);
    const yearlyDataPromises = years.map(async year => {
      try {
        return await this.getTruePitchingStats(year);
      } catch (error) {
        console.warn(`Failed to load pitching stats for ${year}, skipping.`, error);
        return [] as TruePlayerStats[];
      }
    });
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
          gs: pitcher.gs
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
   * Fetch and aggregate batting stats across multiple years for hitter True Rating calculation.
   *
   * Returns a map of playerId → yearly stats array (most recent first).
   * Handles players who didn't bat in all years.
   * Leverages existing caching for each year's data.
   *
   * @param endYear - The most recent year to include
   * @param yearsBack - Number of years to fetch (default 4 to support dynamic season weighting)
   * @param minPaPerYear - Minimum PA in a year to include that year's stats (default 10)
   * @returns Map of playerId → YearlyHittingStats[]
   */
  public async getMultiYearBattingStats(
    endYear: number,
    yearsBack: number = 4,
    minPaPerYear: number = 10
  ): Promise<Map<number, YearlyHittingStats[]>> {
    const years = Array.from({ length: yearsBack }, (_, i) => endYear - i)
      .filter(y => y >= LEAGUE_START_YEAR);

    const yearlyDataPromises = years.map(async year => {
      try {
        return await this.getTrueBattingStats(year);
      } catch (error) {
        console.warn(`Failed to load batting stats for ${year}, skipping.`, error);
        return [] as TruePlayerBattingStats[];
      }
    });
    const yearlyData = await Promise.all(yearlyDataPromises);

    const playerStatsMap = new Map<number, YearlyHittingStats[]>();

    for (let i = 0; i < years.length; i++) {
      const year = years[i];
      const statsForYear = yearlyData[i];

      for (const batter of statsForYear) {
        if (batter.pa < minPaPerYear) continue;

        const yearlyStats: YearlyHittingStats = {
          year,
          pa: batter.pa,
          ab: batter.ab,
          h: batter.h,
          d: batter.d,
          t: batter.t,
          hr: batter.hr,
          bb: batter.bb,
          k: batter.k,
          sb: batter.sb,
          cs: batter.cs,
        };

        if (!playerStatsMap.has(batter.player_id)) {
          playerStatsMap.set(batter.player_id, []);
        }
        playerStatsMap.get(batter.player_id)!.push(yearlyStats);
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

  /**
   * Get a single player's multi-year pitching stats with full detail
   * Used for player profile modal
   *
   * @param playerId - The player's ID
   * @param endYear - The most recent year to include
   * @param yearsBack - Number of years to fetch (default 5)
   * @returns Array of yearly stats, most recent first
   */
  public async getPlayerYearlyStats(
    playerId: number,
    endYear: number,
    yearsBack: number = 5
  ): Promise<PlayerYearlyDetail[]> {
    const results: PlayerYearlyDetail[] = [];
    const minYear = endYear - yearsBack + 1; // e.g. 2021 - 5 + 1 = 2017. Range: 2017..2021

    try {
      // Fetch all historical stats for the player in one efficient API call
      // This avoids downloading full league files for every year
      const apiStats = await statsService.getPitchingStats(playerId);

      // Filter and Group by Year
      const statsByYear = new Map<number, {
        ipOuts: number;
        er: number;
        k: number;
        bb: number;
        hr: number;
        war: number;
        gs: number;
      }>();

      for (const stat of apiStats) {
        // Filter by year range and split (1 = overall)
        if (stat.year > endYear || stat.year < minYear || stat.year < LEAGUE_START_YEAR || stat.splitId !== 1) {
          continue;
        }

        if (!statsByYear.has(stat.year)) {
          statsByYear.set(stat.year, { ipOuts: 0, er: 0, k: 0, bb: 0, hr: 0, war: 0, gs: 0 });
        }

        const entry = statsByYear.get(stat.year)!;
        
        // IP in apiStats is OOTP format (e.g. 150.2)
        // Convert to outs for accurate summing
        const outs = this.ipToOuts(stat.ip);
        
        entry.ipOuts += outs;
        entry.er += stat.er;
        entry.k += stat.k;
        entry.bb += stat.bb;
        entry.hr += stat.hr;
        entry.war += stat.war;
        entry.gs += stat.gs;
      }

      // Calculate rates and format
      statsByYear.forEach((totals, year) => {
        const ip = totals.ipOuts / 3;
        if (ip > 0) {
          const k9 = (totals.k / ip) * 9;
          const bb9 = (totals.bb / ip) * 9;
          const hr9 = (totals.hr / ip) * 9;
          const fip = ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + 3.47; // FIP constant for WBL

          results.push({
            year,
            ip: Math.round(ip * 10) / 10,
            fip: Math.round(fip * 100) / 100,
            k9: Math.round(k9 * 100) / 100,
            bb9: Math.round(bb9 * 100) / 100,
            hr9: Math.round(hr9 * 100) / 100,
            war: Math.round(totals.war * 10) / 10,
            gs: totals.gs
          });
        }
      });

    } catch (error) {
      console.warn(`Could not fetch stats for player ${playerId}:`, error);
    }

    // Sort by year descending (most recent first)
    return results.sort((a, b) => b.year - a.year);
  }

  /**
   * Calculate historical True Ratings for a pitcher across all years with MLB data.
   * For each year, runs the full TR pipeline (all pitchers, percentile ranking)
   * and extracts the target player's component ratings.
   *
   * @param playerId - The player ID to calculate historical TRs for
   * @returns Array of synthetic DevelopmentSnapshotRecord objects (one per year)
   */
  public async calculateHistoricalPitcherTR(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    const endYear = await dateService.getCurrentYear();
    const yearRange = Array.from(
      { length: endYear - LEAGUE_START_YEAR + 1 },
      (_, i) => LEAGUE_START_YEAR + i
    );

    // Pre-fetch all single-year stats in parallel to warm cache
    const singleYearStatsArr = await Promise.all(
      yearRange.map(y => this.getTruePitchingStats(y).catch(() => [] as TruePlayerStats[]))
    );

    // Find years where the target player has data
    const playerYears: number[] = [];
    for (let i = 0; i < yearRange.length; i++) {
      if (singleYearStatsArr[i].some(s => s.player_id === playerId)) {
        playerYears.push(yearRange[i]);
      }
    }

    if (playerYears.length === 0) return [];

    // For each year with data, calculate TRs for ALL pitchers to get percentiles
    const results: DevelopmentSnapshotRecord[] = [];
    for (const year of playerYears) {
      const multiYearStats = await this.getMultiYearPitchingStats(year, 4);
      const leagueAvg = await this.getLeagueAverages(year);

      // Build inputs for all pitchers (no scouting blend for historical)
      const inputs: TrueRatingInput[] = [];
      multiYearStats.forEach((stats, pid) => {
        inputs.push({
          playerId: pid,
          playerName: '',
          yearlyStats: stats,
        });
      });

      const trResults = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAvg);
      const playerResult = trResults.find(r => r.playerId === playerId);

      if (playerResult) {
        results.push({
          key: `${playerId}_${year}-07-01`,
          playerId,
          date: `${year}-07-01`,
          snapshotType: 'data_upload',
          playerType: 'pitcher',
          trueStuff: playerResult.estimatedStuff,
          trueControl: playerResult.estimatedControl,
          trueHra: playerResult.estimatedHra,
          trueRating: playerResult.trueRating,
          source: 'calculated',
        });
      }
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate historical True Ratings for a batter across all years with MLB data.
   * For each year, runs the full TR pipeline (all batters, percentile ranking)
   * and extracts the target player's component ratings.
   *
   * @param playerId - The player ID to calculate historical TRs for
   * @returns Array of synthetic DevelopmentSnapshotRecord objects (one per year)
   */
  public async calculateHistoricalBatterTR(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    const endYear = await dateService.getCurrentYear();
    const yearRange = Array.from(
      { length: endYear - LEAGUE_START_YEAR + 1 },
      (_, i) => LEAGUE_START_YEAR + i
    );

    // Pre-fetch all single-year stats in parallel to warm cache
    const singleYearStatsArr = await Promise.all(
      yearRange.map(y => this.getTrueBattingStats(y).catch(() => [] as TruePlayerBattingStats[]))
    );

    // Find years where the target player has data
    const playerYears: number[] = [];
    for (let i = 0; i < yearRange.length; i++) {
      if (singleYearStatsArr[i].some(s => s.player_id === playerId)) {
        playerYears.push(yearRange[i]);
      }
    }

    if (playerYears.length === 0) return [];

    // For each year with data, calculate TRs for ALL batters to get percentiles
    const results: DevelopmentSnapshotRecord[] = [];
    for (const year of playerYears) {
      const multiYearStats = await this.getMultiYearBattingStats(year, 4);

      // Build inputs for all batters (no scouting blend for historical)
      const inputs: HitterTrueRatingInput[] = [];
      multiYearStats.forEach((stats, pid) => {
        inputs.push({
          playerId: pid,
          playerName: '',
          yearlyStats: stats,
        });
      });

      const trResults = hitterTrueRatingsCalculationService.calculateTrueRatings(inputs);
      const playerResult = trResults.find(r => r.playerId === playerId);

      if (playerResult) {
        results.push({
          key: `${playerId}_${year}-07-01`,
          playerId,
          date: `${year}-07-01`,
          snapshotType: 'data_upload',
          playerType: 'hitter',
          truePower: playerResult.estimatedPower,
          trueEye: playerResult.estimatedEye,
          trueAvoidK: playerResult.estimatedAvoidK,
          trueContact: playerResult.estimatedContact,
          trueGap: playerResult.estimatedGap,
          trueSpeed: playerResult.estimatedSpeed,
          trueRating: playerResult.trueRating,
          source: 'calculated',
        });
      }
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate historical TFR for a hitter prospect across all scouting snapshot dates.
   * For each unique date, runs the full TFR pipeline with the entire prospect pool
   * at that date, then extracts the target player's component ratings.
   *
   * @param playerId - The player ID to calculate historical TFR for
   * @returns Array of synthetic DevelopmentSnapshotRecord objects (one per snapshot date)
   */
  public async calculateHistoricalHitterTFR(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    // Get all scouting snapshots for this player
    const playerSnapshots = await developmentSnapshotService.getPlayerSnapshots(playerId);
    const hitterSnapshots = playerSnapshots.filter(s =>
      s.playerType === 'hitter' || s.scoutPower !== undefined || s.scoutEye !== undefined
    );

    if (hitterSnapshots.length === 0) return [];

    // Extract unique dates
    const uniqueDates = [...new Set(hitterSnapshots.map(s => s.date))].sort();

    const currentYear = await dateService.getCurrentYear();
    const results: DevelopmentSnapshotRecord[] = [];

    for (const date of uniqueDates) {
      try {
        // Get ALL hitter scouting snapshots at this date
        const allSnapshotsAtDate = await developmentSnapshotService.getSnapshotsByDate(date);
        const hitterSnapshotsAtDate = allSnapshotsAtDate.filter(s =>
          s.playerType === 'hitter' || s.scoutPower !== undefined || s.scoutEye !== undefined
        );

        if (hitterSnapshotsAtDate.length === 0) continue;

        // Determine year from date
        const year = parseInt(date.substring(0, 4), 10);

        // Fetch all minor league batting stats for the pool
        const allMinorStats = await minorLeagueBattingStatsService.getAllPlayerStatsBatch(
          Math.max(year - 2, 2000),
          Math.min(year, currentYear)
        );

        // Build TFR inputs for all prospects at this date
        const allPlayers = await playerService.getAllPlayers();
        const playerMap = new Map(allPlayers.map(p => [p.id, p]));

        const tfrInputs: HitterTrueFutureRatingInput[] = [];
        for (const snap of hitterSnapshotsAtDate) {
          const player = playerMap.get(snap.playerId);
          const age = snap.age ?? player?.age ?? 22;

          // Convert snapshot to HitterScoutingRatings
          const scouting: HitterScoutingRatings = {
            playerId: snap.playerId,
            power: snap.scoutPower ?? 50,
            eye: snap.scoutEye ?? 50,
            avoidK: snap.scoutAvoidK ?? 50,
            contact: snap.scoutBabip ?? 50,
            gap: snap.scoutGap ?? 50,
            speed: snap.scoutSpeed ?? 50,
            ovr: snap.scoutOvr ?? 2.5,
            pot: snap.scoutPot ?? 2.5,
          };

          const minorStats = allMinorStats.get(snap.playerId) ?? [];

          tfrInputs.push({
            playerId: snap.playerId,
            playerName: player ? `${player.firstName} ${player.lastName}` : 'Unknown',
            age,
            scouting,
            minorLeagueStats: minorStats,
          });
        }

        if (tfrInputs.length === 0) continue;

        // Calculate TFR for the full pool (dynamic import to avoid circular dependency)
        const { hitterTrueFutureRatingService } = await import('./HitterTrueFutureRatingService');
        const tfrResults = await hitterTrueFutureRatingService.calculateTrueFutureRatings(tfrInputs);

        // Find target player in results
        const playerResult = tfrResults.find(r => r.playerId === playerId);
        if (playerResult) {
          results.push({
            key: `${playerId}_${date}_tfr`,
            playerId,
            date,
            snapshotType: 'data_upload',
            playerType: 'hitter',
            truePower: playerResult.truePower,
            trueEye: playerResult.trueEye,
            trueAvoidK: playerResult.trueAvoidK,
            trueContact: playerResult.trueContact,
            trueGap: playerResult.trueGap,
            trueSpeed: playerResult.trueSpeed,
            trueFutureRating: playerResult.trueFutureRating,
            source: 'calculated',
          });
        }
      } catch (error) {
        console.warn(`Failed to calculate hitter TFR for date ${date}:`, error);
      }
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Calculate historical TFR for a pitcher prospect across all scouting snapshot dates.
   * For each unique date, runs the full TFR pipeline with the entire prospect pool
   * at that date, then extracts the target player's component ratings.
   *
   * @param playerId - The player ID to calculate historical TFR for
   * @returns Array of synthetic DevelopmentSnapshotRecord objects (one per snapshot date)
   */
  public async calculateHistoricalPitcherTFR(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    // Get all scouting snapshots for this player
    const playerSnapshots = await developmentSnapshotService.getPlayerSnapshots(playerId);
    const pitcherSnapshots = playerSnapshots.filter(s =>
      s.playerType === 'pitcher' || s.scoutStuff !== undefined || s.scoutControl !== undefined
    );

    if (pitcherSnapshots.length === 0) return [];

    // Extract unique dates
    const uniqueDates = [...new Set(pitcherSnapshots.map(s => s.date))].sort();

    const currentYear = await dateService.getCurrentYear();
    const results: DevelopmentSnapshotRecord[] = [];

    for (const date of uniqueDates) {
      try {
        // Get ALL pitcher scouting snapshots at this date
        const allSnapshotsAtDate = await developmentSnapshotService.getSnapshotsByDate(date);
        const pitcherSnapshotsAtDate = allSnapshotsAtDate.filter(s =>
          s.playerType === 'pitcher' || s.scoutStuff !== undefined || s.scoutControl !== undefined
        );

        if (pitcherSnapshotsAtDate.length === 0) continue;

        // Determine year from date
        const year = parseInt(date.substring(0, 4), 10);

        // Fetch all minor league pitching stats for the pool
        const allMinorStats = await minorLeagueStatsService.getAllPlayerStatsBatch(
          Math.max(year - 2, 2000),
          Math.min(year, currentYear)
        );

        // Build TFR inputs for all prospects at this date
        const allPlayers = await playerService.getAllPlayers();
        const playerMap = new Map(allPlayers.map(p => [p.id, p]));

        const tfrInputs: TrueFutureRatingInput[] = [];
        for (const snap of pitcherSnapshotsAtDate) {
          const player = playerMap.get(snap.playerId);
          const age = snap.age ?? player?.age ?? 22;

          // Convert snapshot to PitcherScoutingRatings
          const scouting: PitcherScoutingRatings = {
            playerId: snap.playerId,
            stuff: snap.scoutStuff ?? 50,
            control: snap.scoutControl ?? 50,
            hra: snap.scoutHra ?? 50,
            ovr: snap.scoutOvr ?? 2.5,
            pot: snap.scoutPot ?? 2.5,
          };

          const minorStats = allMinorStats.get(snap.playerId) ?? [];

          tfrInputs.push({
            playerId: snap.playerId,
            playerName: player ? `${player.firstName} ${player.lastName}` : 'Unknown',
            age,
            scouting,
            minorLeagueStats: minorStats,
          });
        }

        if (tfrInputs.length === 0) continue;

        // Calculate TFR for the full pool (dynamic import to avoid circular dependency)
        const { trueFutureRatingService } = await import('./TrueFutureRatingService');
        const tfrResults = await trueFutureRatingService.calculateTrueFutureRatings(tfrInputs);

        // Find target player in results
        const playerResult = tfrResults.find(r => r.playerId === playerId);
        if (playerResult) {
          results.push({
            key: `${playerId}_${date}_tfr`,
            playerId,
            date,
            snapshotType: 'data_upload',
            playerType: 'pitcher',
            trueStuff: playerResult.trueStuff,
            trueControl: playerResult.trueControl,
            trueHra: playerResult.trueHra,
            trueFutureRating: playerResult.trueFutureRating,
            source: 'calculated',
          });
        }
      } catch (error) {
        console.warn(`Failed to calculate pitcher TFR for date ${date}:`, error);
      }
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }
}

export const trueRatingsService = new TrueRatingsService();
