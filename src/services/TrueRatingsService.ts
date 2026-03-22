import { Player } from '../models/Player';
import { HitterScoutingRatings, PitcherScoutingRatings } from '../models/ScoutingData';
import { playerService } from './PlayerService';
import { statsService } from './StatsService';
import { dateService } from './DateService';
import { LeagueAverages, YearlyPitchingStats, TrueRatingInput, TrueRatingResult, trueRatingsCalculationService, getYearWeights as getPitcherYearWeights } from './TrueRatingsCalculationService';
import { YearlyHittingStats, HitterTrueRatingInput, HitterTrueRatingResult, hitterTrueRatingsCalculationService, getYearWeights as getHitterYearWeights } from './HitterTrueRatingsCalculationService';
import { hitterScoutingDataService } from './HitterScoutingDataService';
import { scoutingDataFallbackService } from './ScoutingDataFallbackService';
import { determinePitcherRole, PitcherRoleInput } from '../models/Player';
import { DevelopmentSnapshotRecord } from './IndexedDBService';
import { supabaseDataService } from './SupabaseDataService';
import { apiFetch } from './ApiClient';
import { indexedDBService } from './IndexedDBService';
import { developmentSnapshotService } from './DevelopmentSnapshotService';
import { minorLeagueBattingStatsService } from './MinorLeagueBattingStatsService';
import { minorLeagueStatsService } from './MinorLeagueStatsService';
import { leagueBattingAveragesService } from './LeagueBattingAveragesService';
import { fipWarService } from './FipWarService';
import { teamService } from './TeamService';
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

  // Cache for canonical True Ratings (keyed by year)
  private hitterTrCache: Map<number, Map<number, HitterTrueRatingResult>> = new Map();
  private hitterTrInFlight: Map<number, Promise<Map<number, HitterTrueRatingResult>>> = new Map();
  private pitcherTrCache: Map<number, Map<number, TrueRatingResult>> = new Map();
  private pitcherTrInFlight: Map<number, Promise<Map<number, TrueRatingResult>>> = new Map();

  /**
   * Bulk-fetch stats from Supabase for a year range and populate per-year in-memory caches.
   * Turns N individual queries into 1 bulk query. No-op if Supabase not configured or all years cached.
   */
  async prefetchPitchingStats(startYear: number, endYear: number): Promise<void> {
    if (!supabaseDataService.isConfigured) return;
    const needed = [];
    for (let y = startYear; y <= endYear; y++) {
      if (!this.inMemoryPitchingCache.has(y) && y >= LEAGUE_START_YEAR) needed.push(y);
    }
    if (needed.length === 0) return;

    const allRows = await supabaseDataService.getPitchingStatsBulk(needed[0], needed[needed.length - 1], 200);
    if (allRows.length === 0) return;

    const statPlayerIds = [...new Set(allRows.map(r => r.player_id))];
    const players = await playerService.getPlayersByIds(statPlayerIds);
    const playerMap = new Map<number, Player>();
    for (const p of players) playerMap.set(p.id, p);

    const byYear = new Map<number, any[]>();
    for (const row of allRows) {
      if (!byYear.has(row.year)) byYear.set(row.year, []);
      byYear.get(row.year)!.push(row);
    }

    for (const [year, rows] of byYear) {
      if (this.inMemoryPitchingCache.has(year)) continue;
      const processed = rows.map(stat => ({
        ...stat,
        playerName: playerMap.get(stat.player_id)
          ? `${playerMap.get(stat.player_id)!.firstName} ${playerMap.get(stat.player_id)!.lastName}`
          : 'Unknown Player',
        position: playerMap.get(stat.player_id)?.position || 1,
      })) as TruePlayerStats[];
      this.inMemoryPitchingCache.set(year, this.combinePitchingStats(processed));
    }
  }

  async prefetchBattingStats(startYear: number, endYear: number): Promise<void> {
    if (!supabaseDataService.isConfigured) return;
    const needed = [];
    for (let y = startYear; y <= endYear; y++) {
      if (!this.inMemoryBattingCache.has(y) && y >= LEAGUE_START_YEAR) needed.push(y);
    }
    if (needed.length === 0) return;

    const allRows = await supabaseDataService.getBattingStatsBulk(needed[0], needed[needed.length - 1], 200);
    if (allRows.length === 0) return;

    const statPlayerIds = [...new Set(allRows.map(r => r.player_id))];
    const players = await playerService.getPlayersByIds(statPlayerIds);
    const playerMap = new Map<number, Player>();
    for (const p of players) playerMap.set(p.id, p);

    const byYear = new Map<number, any[]>();
    for (const row of allRows) {
      if (!byYear.has(row.year)) byYear.set(row.year, []);
      byYear.get(row.year)!.push(row);
    }

    for (const [year, rows] of byYear) {
      if (this.inMemoryBattingCache.has(year)) continue;
      const processed = rows.map(stat => {
        const b = stat as any;
        b.avg = b.ab > 0 ? b.h / b.ab : 0;
        b.obp = b.pa > 0 ? (b.h + b.bb + (b.hp || 0)) / b.pa : 0;
        return {
          ...stat,
          playerName: playerMap.get(stat.player_id)
            ? `${playerMap.get(stat.player_id)!.firstName} ${playerMap.get(stat.player_id)!.lastName}`
            : 'Unknown Player',
          position: playerMap.get(stat.player_id)?.position || (stat as any).position,
        };
      }) as TruePlayerBattingStats[];
      this.inMemoryBattingCache.set(year, this.combineBattingStats(processed));
    }
  }

  public async getTruePitchingStats(year: number): Promise<TruePlayerStats[]> {
    if (year < LEAGUE_START_YEAR) return [];

    // Check in-memory cache first
    if (this.inMemoryPitchingCache.has(year)) {
      return this.inMemoryPitchingCache.get(year)!;
    }

    // Check IndexedDB cache (skip when Supabase configured — query on-demand)
    if (!supabaseDataService.isConfigured) {
      const cached = await this.loadFromCache<TruePlayerStats[]>(year, 'pitching');
      if (cached) {
        const normalized = this.combinePitchingStats(cached);
        this.inMemoryPitchingCache.set(year, normalized);
        if (normalized.length !== cached.length) {
          await this.saveToCache(year, normalized, 'pitching');
        }
        return normalized;
      }
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

    // Cache permanently if the year is completed (historical) — skip when Supabase is source of truth
    if (!supabaseDataService.isConfigured) {
      const currentYear = await dateService.getCurrentYear();
      await this.saveToCache(year, normalized, 'pitching', year < currentYear);
    }

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

    // Check IndexedDB cache (skip when Supabase configured — query on-demand)
    if (!supabaseDataService.isConfigured) {
      const cached = await this.loadFromCache<TruePlayerBattingStats[]>(year, 'batting');
      if (cached) {
        const normalized = this.combineBattingStats(cached);
        this.inMemoryBattingCache.set(year, normalized);
        if (normalized.length !== cached.length) {
          await this.saveToCache(year, normalized, 'batting');
        }
        return normalized;
      }
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

    // Cache permanently if the year is completed (historical) — skip when Supabase is source of truth
    if (!supabaseDataService.isConfigured) {
      const currentYear = await dateService.getCurrentYear();
      await this.saveToCache(year, normalized, 'batting', year < currentYear);
    }

    return normalized;
  }

  /**
   * Load historical MLB pitching data.
   * Tries Supabase bulk query first (1 request for all years), falls back to CSV files.
   */
  async loadDefaultMlbData(): Promise<{ loaded: number; errors: string[] }> {
    const startYear = LEAGUE_START_YEAR;
    const currentYear = await dateService.getCurrentYear();
    const endYear = currentYear - 1;

    let loaded = 0;
    const errors: string[] = [];

    // Determine which years are missing from cache
    const missingYears: number[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const existing = await this.loadFromCache<TruePlayerStats[]>(year, 'pitching');
      if (!existing || existing.length === 0) {
        missingYears.push(year);
      }
    }

    if (missingYears.length === 0) {
      console.log('📦 All MLB pitching data already cached');
      return { loaded: 0, errors: [] };
    }

    console.log(`📦 Loading MLB pitching data (${missingYears.length} years missing)...`);

    // Try Supabase bulk query first
    if (supabaseDataService.isConfigured) {
      try {
        const allRows = await supabaseDataService.getPitchingStatsBulk(
          missingYears[0], missingYears[missingYears.length - 1], 200
        );

        if (allRows.length > 0) {
          const statPlayerIds = [...new Set(allRows.map(r => r.player_id))];
          const players = await playerService.getPlayersByIds(statPlayerIds);
          const playerMap = new Map<number, Player>();
          for (const player of players) playerMap.set(player.id, player);

          // Group by year
          const byYear = new Map<number, any[]>();
          for (const row of allRows) {
            if (!byYear.has(row.year)) byYear.set(row.year, []);
            byYear.get(row.year)!.push(row);
          }

          for (const [year, rows] of byYear) {
            const processedStats = rows.map(stat => ({
              ...stat,
              playerName: playerMap.get(stat.player_id)
                ? `${playerMap.get(stat.player_id)!.firstName} ${playerMap.get(stat.player_id)!.lastName}`
                : 'Unknown Player',
              position: playerMap.get(stat.player_id)?.position || 1
            })) as TruePlayerStats[];

            const normalized = this.combinePitchingStats(processedStats);
            await this.saveToCache(year, normalized, 'pitching', true);
            loaded++;
          }

          console.log(`📦 Loaded ${loaded} years of MLB pitching from Supabase`);
          return { loaded, errors };
        }
      } catch (error) {
        console.warn('Supabase bulk query failed, falling back to CSV:', error);
      }
    }

    // Fallback: load from bundled CSV files
    for (const year of missingYears) {
      try {
        const url = `/data/mlb/${year}.csv`;
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status !== 404) errors.push(`${year}.csv: HTTP ${response.status}`);
          continue;
        }

        const csvText = await response.text();
        const rawStats = this.parseStatsCsv(csvText, 'pitching') as TruePitchingStats[];
        if (rawStats.length === 0) continue;

        const csvPlayerIds = rawStats.map(s => s.player_id);
        const players = await playerService.getPlayersByIds(csvPlayerIds);
        const playerMap = new Map<number, Player>();
        for (const player of players) playerMap.set(player.id, player);

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
        await this.saveToCache(year, normalized, 'pitching', true);
        loaded++;
      } catch (error) {
        errors.push(`${year}: ${error}`);
      }
    }

    console.log(`📦 MLB pitching load complete: ${loaded} datasets, ${errors.length} errors`);
    return { loaded, errors };
  }

  /**
   * Load historical MLB batting data.
   * Tries Supabase bulk query first, falls back to CSV files.
   */
  async loadDefaultMlbBattingData(): Promise<{ loaded: number; errors: string[] }> {
    const startYear = LEAGUE_START_YEAR;
    const currentYear = await dateService.getCurrentYear();
    const endYear = currentYear - 1;

    let loaded = 0;
    const errors: string[] = [];

    // Determine which years are missing from cache
    const missingYears: number[] = [];
    for (let year = startYear; year <= endYear; year++) {
      const existing = await this.loadFromCache<TruePlayerBattingStats[]>(year, 'batting');
      if (!existing || existing.length === 0) {
        missingYears.push(year);
      }
    }

    if (missingYears.length === 0) {
      console.log('📦 All MLB batting data already cached');
      return { loaded: 0, errors: [] };
    }

    console.log(`📦 Loading MLB batting data (${missingYears.length} years missing)...`);

    // Try Supabase bulk query first
    if (supabaseDataService.isConfigured) {
      try {
        const allRows = await supabaseDataService.getBattingStatsBulk(
          missingYears[0], missingYears[missingYears.length - 1], 200
        );

        if (allRows.length > 0) {
          const players = await playerService.getAllPlayers();
          const playerMap = new Map<number, Player>();
          for (const player of players) playerMap.set(player.id, player);

          const byYear = new Map<number, any[]>();
          for (const row of allRows) {
            if (!byYear.has(row.year)) byYear.set(row.year, []);
            byYear.get(row.year)!.push(row);
          }

          for (const [year, rows] of byYear) {
            const processedStats = rows.map(stat => ({
              ...stat,
              playerName: playerMap.get(stat.player_id)
                ? `${playerMap.get(stat.player_id)!.firstName} ${playerMap.get(stat.player_id)!.lastName}`
                : 'Unknown Player',
              position: playerMap.get(stat.player_id)?.position ?? stat.position ?? 0
            })) as TruePlayerBattingStats[];

            const normalized = this.combineBattingStats(processedStats);
            await this.saveToCache(year, normalized, 'batting', true);
            loaded++;
          }

          console.log(`📦 Loaded ${loaded} years of MLB batting from Supabase`);
          return { loaded, errors };
        }
      } catch (error) {
        console.warn('Supabase bulk query failed, falling back to CSV:', error);
      }
    }

    // Fallback: load from bundled CSV files
    for (const year of missingYears) {
      try {
        const url = `/data/mlb_batting/${year}_batting.csv`;
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status !== 404) errors.push(`${year}_batting.csv: HTTP ${response.status}`);
          continue;
        }

        const csvText = await response.text();
        const rawStats = this.parseStatsCsv(csvText, 'batting') as TrueBattingStats[];
        if (rawStats.length === 0) continue;

        const players = await playerService.getAllPlayers();
        const playerMap = new Map<number, Player>();
        for (const player of players) playerMap.set(player.id, player);

        const processedStats = rawStats
          .map(stat => ({
            ...stat,
            playerName: playerMap.get(stat.player_id)
              ? `${playerMap.get(stat.player_id)!.firstName} ${playerMap.get(stat.player_id)!.lastName}`
              : 'Unknown Player',
            position: playerMap.get(stat.player_id)?.position ?? (stat as any).position ?? 0
          }))
          .filter(s => s.split_id === 1) as TruePlayerBattingStats[];

        const normalized = this.combineBattingStats(processedStats);
        await this.saveToCache(year, normalized, 'batting', true);
        loaded++;
      } catch (error) {
        errors.push(`${year}: ${error}`);
      }
    }

    console.log(`📦 MLB batting load complete: ${loaded} datasets, ${errors.length} errors`);
    return { loaded, errors };
  }

  private async fetchAndProcessStats(year: number, type: StatsType, apiEndpoint: string): Promise<(TruePlayerStats | TruePlayerBattingStats)[]> {
    if (year < LEAGUE_START_YEAR) return [];

    // Try Supabase first (hero skips only for the current year — historical years are already in DB)
    if (supabaseDataService.isConfigured) {
      try {
        const leagueId = 200; // MLB
        const rows = type === 'pitching'
          ? await supabaseDataService.getPitchingStats(year, leagueId)
          : await supabaseDataService.getBattingStats(year, leagueId);

        if (rows.length > 0) {
          const ids = rows.map(r => r.player_id);

          // For batting: always fetch player info (name + primary position from players table)
          // because batting_stats.position can be 0/NULL for split_id=1, and the TR cache
          // doesn't store hitter positions.
          // For pitching: try TR cache first (position is always 1), fall back to info lookup.
          let trNameMap: Map<number, { name: string; position: number }> | null = null;
          let infoMap: Map<number, { name: string; position: number }> | null = null;

          if (type === 'pitching') {
            trNameMap = this.getPlayerNameMapFromTR(year, type);
            if (!trNameMap || trNameMap.size === 0) {
              infoMap = await playerService.getPlayerInfoByIds(ids);
            }
          } else {
            // Batting: need positions from player table; try TR cache for names only
            infoMap = await playerService.getPlayerInfoByIds(ids);
            trNameMap = this.getPlayerNameMapFromTR(year, type);
          }

          return rows.map(stat => {
            if (type === 'batting') {
              const b = stat as any;
              b.avg = b.ab > 0 ? b.h / b.ab : 0;
              b.obp = b.pa > 0 ? (b.h + b.bb + (b.hp || 0)) / b.pa : 0;
            }
            const trEntry = trNameMap?.get(stat.player_id);
            const info = infoMap?.get(stat.player_id);
            const playerName = trEntry?.name
              ?? info?.name
              ?? `Player ${stat.player_id}`;
            const position = info?.position || trEntry?.position || (type === 'pitching' ? 1 : stat.position);
            return {
              ...stat,
              playerName,
              position,
            };
          });
        }
      } catch (err) {
        console.warn(`⚠️ Supabase fetch failed for ${type} ${year}, falling back to API:`, err);
      }

      // Supabase is configured but returned no data — don't fall through to API
      console.warn(`⚠️ Supabase returned no ${type} stats for ${year} and API fallback is disabled`);
      return [];
    }

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
   * Extract player name+position map from cached TR data.
   * Returns null if TR data isn't cached yet for this year.
   * Used by fetchAndProcessStats to avoid 16-page playerService.getAllPlayers() call.
   */
  public getPlayerNameMapFromTR(year: number, type: 'pitching' | 'batting'): Map<number, { name: string; position: number }> | null {
    if (type === 'pitching') {
      const cached = this.pitcherTrCache.get(year);
      if (!cached || cached.size === 0) return null;
      const map = new Map<number, { name: string; position: number }>();
      cached.forEach((result, playerId) => {
        map.set(playerId, { name: result.playerName, position: 1 });
      });
      return map;
    } else {
      const cached = this.hitterTrCache.get(year);
      if (!cached || cached.size === 0) return null;
      const map = new Map<number, { name: string; position: number }>();
      cached.forEach((result, playerId) => {
        map.set(playerId, { name: result.playerName, position: 0 });
      });
      return map;
    }
  }

  /**
   * Get player names for a set of player IDs
   * Useful for building TrueRatingInput objects
   *
   * @param playerIds - Set or array of player IDs
   * @returns Map of playerId → playerName
   */
  public async getPlayerNames(playerIds: Iterable<number>): Promise<Map<number, string>> {
    const ids = [...playerIds];
    if (ids.length === 0) return new Map();

    // If players are already cached, use the cache (no extra requests)
    if (playerService.hasCachedPlayers()) {
      const players = await playerService.getAllPlayers();
      const playerMap = new Map<number, string>();
      const idSet = new Set(ids);
      for (const player of players) {
        if (idSet.has(player.id)) {
          playerMap.set(player.id, `${player.firstName} ${player.lastName}`);
        }
      }
      return playerMap;
    }

    // Targeted fetch: only the IDs we need (1 request instead of 15)
    return playerService.getPlayerNamesByIds(ids);
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
   * Canonical hitter True Ratings calculation, cached per year.
   * All views should use this instead of computing TR independently.
   *
   * Uses the same parameters as TrueRatingsView:
   * - Pool: ALL batters from getMultiYearBattingStats with totalPa >= 30
   * - Scouting: both my and osa (my overrides osa)
   * - Year weights: dynamic via getSeasonProgress() when year === currentYear
   * - League averages: getDefaultLeagueAverages()
   * - League batting averages: year-specific from leagueBattingAveragesService
   */
  /**
   * Bulk-prefetch all data needed for local TR/TFR computation into in-memory caches.
   * After this resolves, every service call in the computation paths hits cache.
   * No-op when Supabase is not configured.
   */
  async warmCachesForComputation(year: number): Promise<void> {
    if (!supabaseDataService.isConfigured) return;

    const startYear = Math.max(LEAGUE_START_YEAR, year - 6);

    await Promise.all([
      // MLB batting + pitching stats: 1 bulk query each
      this.prefetchBattingStats(startYear, year),
      this.prefetchPitchingStats(startYear, year),
      // MiLB stats: 3 years × 2 types = 6 queries
      minorLeagueBattingStatsService.prefetchYear(year - 2),
      minorLeagueBattingStatsService.prefetchYear(year - 1),
      minorLeagueBattingStatsService.prefetchYear(year),
      minorLeagueStatsService.prefetchYear(year - 2),
      minorLeagueStatsService.prefetchYear(year - 1),
      minorLeagueStatsService.prefetchYear(year),
      // Entity caches (players loaded lazily by views that need them)
      teamService.getAllTeams(),
    ]);
  }

  public clearCaches(): void {
    this.hitterTrCache.clear();
    this.pitcherTrCache.clear();
    this.hitterTrInFlight.clear();
    this.pitcherTrInFlight.clear();
  }

  public async getHitterTrueRatings(year: number): Promise<Map<number, HitterTrueRatingResult>> {
    // Return from cache if available
    const cached = this.hitterTrCache.get(year);
    if (cached) return cached;

    // Deduplicate in-flight requests
    const existing = this.hitterTrInFlight.get(year);
    if (existing) return existing;

    const promise = this.computeHitterTrueRatings(year).finally(() => {
      this.hitterTrInFlight.delete(year);
    });
    this.hitterTrInFlight.set(year, promise);
    return promise;
  }

  private async computeHitterTrueRatings(year: number): Promise<Map<number, HitterTrueRatingResult>> {
    // Follower fast path: use pre-computed TR from Supabase (skip when custom scouting uploaded)
    if (supabaseDataService.isConfigured && !supabaseDataService.hasCustomScouting) {
      try {
        const rows = await supabaseDataService.getPlayerRatings('hitter_tr');
        if (rows.length > 0) {
          console.log(`⚡ Loaded ${rows.length} pre-computed hitter TR from Supabase`);
          const map = new Map<number, HitterTrueRatingResult>();
          for (const row of rows) map.set(row.player_id, row.data);
          this.hitterTrCache.set(year, map);
          return map;
        }
        console.log('⚠️ player_ratings has 0 hitter_tr rows — falling back to computation');
      } catch (err) {
        console.warn('⚠️ Failed to load pre-computed hitter TR, falling back to computation:', err);
      }
    }

    const currentYear = await dateService.getCurrentYear();

    // Dynamic year weights for current season — rolling progress-based
    let yearWeights: number[] | undefined;
    if (year >= currentYear) {
      // Current year: use season progress. Future year (offseason projections): progress=0.
      const progress = year === currentYear ? await dateService.getSeasonProgress() : 0;
      yearWeights = getHitterYearWeights(progress);
    }

    // Fetch multi-year stats and scouting data in parallel
    const [multiYearStats, myScoutingRatings, osaScoutingRatings, leagueBattingAvg] = await Promise.all([
      this.getMultiYearBattingStats(year),
      hitterScoutingDataService.getLatestScoutingRatings('my'),
      hitterScoutingDataService.getLatestScoutingRatings('osa'),
      leagueBattingAveragesService.getLeagueAverages(year),
    ]);

    // Build scouting lookup (my overrides osa)
    const scoutingById = new Map<number, HitterScoutingRatings>();
    for (const r of osaScoutingRatings) {
      if (r.playerId > 0) scoutingById.set(r.playerId, r);
    }
    for (const r of myScoutingRatings) {
      if (r.playerId > 0) scoutingById.set(r.playerId, r);
    }

    // Get player names for any batters missing from single-year stats
    const allBatters = await this.getTrueBattingStats(year);
    const nameMap = new Map<number, string>();
    for (const b of allBatters) {
      nameMap.set(b.player_id, b.playerName);
    }
    // Fill gaps from playerService
    const missingIds: number[] = [];
    multiYearStats.forEach((_, pid) => {
      if (!nameMap.has(pid)) missingIds.push(pid);
    });
    if (missingIds.length > 0) {
      const extraNames = await this.getPlayerNames(missingIds);
      extraNames.forEach((name, pid) => nameMap.set(pid, name));
    }

    // Build inputs: ALL batters with totalPa >= 30
    const inputs: HitterTrueRatingInput[] = [];
    multiYearStats.forEach((stats, pid) => {
      const totalPa = stats.reduce((sum, s) => sum + s.pa, 0);
      if (totalPa < 30) return;

      inputs.push({
        playerId: pid,
        playerName: nameMap.get(pid) ?? 'Unknown',
        yearlyStats: stats,
        scoutingRatings: scoutingById.get(pid),
        targetYear: year,
      });
    });

    const leagueAverages = hitterTrueRatingsCalculationService.getDefaultLeagueAverages();
    const results = hitterTrueRatingsCalculationService.calculateTrueRatings(
      inputs, leagueAverages, yearWeights, leagueBattingAvg ?? undefined
    );

    const resultMap = new Map<number, HitterTrueRatingResult>();
    for (const r of results) {
      resultMap.set(r.playerId, r);
    }

    this.hitterTrCache.set(year, resultMap);
    return resultMap;
  }

  /**
   * Canonical pitcher True Ratings calculation, cached per year.
   * All views should use this instead of computing TR independently.
   */
  public async getPitcherTrueRatings(year: number): Promise<Map<number, TrueRatingResult>> {
    const cached = this.pitcherTrCache.get(year);
    if (cached) return cached;

    const existing = this.pitcherTrInFlight.get(year);
    if (existing) return existing;

    const promise = this.computePitcherTrueRatings(year).finally(() => {
      this.pitcherTrInFlight.delete(year);
    });
    this.pitcherTrInFlight.set(year, promise);
    return promise;
  }

  private async computePitcherTrueRatings(year: number): Promise<Map<number, TrueRatingResult>> {
    // Follower fast path: use pre-computed TR from Supabase (skip when custom scouting uploaded)
    if (supabaseDataService.isConfigured && !supabaseDataService.hasCustomScouting) {
      try {
        const rows = await supabaseDataService.getPlayerRatings('pitcher_tr');
        if (rows.length > 0) {
          console.log(`⚡ Loaded ${rows.length} pre-computed pitcher TR from Supabase`);
          const map = new Map<number, TrueRatingResult>();
          for (const row of rows) map.set(row.player_id, row.data);
          this.pitcherTrCache.set(year, map);
          return map;
        }
        console.log('⚠️ player_ratings has 0 pitcher_tr rows — falling back to computation');
      } catch (err) {
        console.warn('⚠️ Failed to load pre-computed pitcher TR, falling back to computation:', err);
      }
    }

    const currentYear = await dateService.getCurrentYear();

    // Dynamic year weights for current season — rolling progress-based
    let yearWeights: number[] | undefined;
    if (year >= currentYear) {
      const progress = year === currentYear ? await dateService.getSeasonProgress() : 0;
      yearWeights = getPitcherYearWeights(progress);
    }

    const [multiYearStats, leagueAverages, scoutingFallback] = await Promise.all([
      this.getMultiYearPitchingStats(year),
      this.getLeagueAverages(year),
      scoutingDataFallbackService.getScoutingRatingsWithFallback(year),
    ]);

    // Build scouting lookup
    const scoutingMap = new Map(scoutingFallback.ratings.map(r => [r.playerId, r]));
    // Load only players referenced by stats or scouting (not all 16K)
    const relevantIds = [...new Set([...multiYearStats.keys(), ...scoutingMap.keys()])];
    const relevantPlayers = await playerService.getPlayersByIds(relevantIds);
    const playerMap = new Map(relevantPlayers.map(p => [p.id, p]));

    // Get player names from single-year stats
    const allPitchers = await this.getTruePitchingStats(year);
    const nameMap = new Map<number, string>();
    for (const p of allPitchers) {
      nameMap.set(p.player_id, p.playerName);
    }
    const missingIds: number[] = [];
    multiYearStats.forEach((_, pid) => {
      if (!nameMap.has(pid)) missingIds.push(pid);
    });
    if (missingIds.length > 0) {
      const extraNames = await this.getPlayerNames(missingIds);
      extraNames.forEach((name, pid) => nameMap.set(pid, name));
    }

    // Build inputs: ALL pitchers with totalIp >= 10
    const inputs: TrueRatingInput[] = [];
    multiYearStats.forEach((stats, pid) => {
      const totalIp = stats.reduce((sum, s) => sum + s.ip, 0);
      if (totalIp < 10) return;

      const scouting = scoutingMap.get(pid);
      const player = playerMap.get(pid);

      // Determine pitcher role
      const pitcherStats = allPitchers.find(p => p.player_id === pid);
      const roleInput: PitcherRoleInput = {
        pitchRatings: scouting?.pitches,
        stamina: scouting?.stamina,
        ootpRole: player?.role,
        gamesStarted: pitcherStats?.gs,
        inningsPitched: pitcherStats ? this.parseIp(pitcherStats.ip) : undefined,
      };

      inputs.push({
        playerId: pid,
        playerName: nameMap.get(pid) ?? 'Unknown',
        yearlyStats: stats,
        scoutingRatings: scouting,
        role: determinePitcherRole(roleInput),
        targetYear: year,
      });
    });

    const results = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages, yearWeights);

    const resultMap = new Map<number, TrueRatingResult>();
    for (const r of results) {
      resultMap.set(r.playerId, r);
    }

    this.pitcherTrCache.set(year, resultMap);
    return resultMap;
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
    // For the current year, use canonical TR to ensure consistency with other views
    const canonicalCurrentTR = await this.getPitcherTrueRatings(endYear);
    const results: DevelopmentSnapshotRecord[] = [];
    for (const year of playerYears) {
      let playerResult: TrueRatingResult | undefined;

      if (year === endYear) {
        // Current year: use canonical TR (consistent with TrueRatingsView)
        playerResult = canonicalCurrentTR.get(playerId);
      } else {
        // Historical years: recalculate (no canonical cache for past years)
        const multiYearStats = await this.getMultiYearPitchingStats(year, 4);
        const leagueAvg = await this.getLeagueAverages(year);

        const inputs: TrueRatingInput[] = [];
        multiYearStats.forEach((stats, pid) => {
          inputs.push({
            playerId: pid,
            playerName: '',
            yearlyStats: stats,
            targetYear: year,
          });
        });

        const trResults = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAvg);
        playerResult = trResults.find(r => r.playerId === playerId);
      }

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
    // For the current year, use canonical TR to ensure consistency with other views
    const canonicalCurrentTR = await this.getHitterTrueRatings(endYear);
    const results: DevelopmentSnapshotRecord[] = [];
    for (const year of playerYears) {
      let playerResult: HitterTrueRatingResult | undefined;

      if (year === endYear) {
        // Current year: use canonical TR (consistent with TrueRatingsView)
        playerResult = canonicalCurrentTR.get(playerId);
      } else {
        // Historical years: recalculate (no canonical cache for past years)
        const multiYearStats = await this.getMultiYearBattingStats(year, 4);

        const inputs: HitterTrueRatingInput[] = [];
        multiYearStats.forEach((stats, pid) => {
          inputs.push({
            playerId: pid,
            playerName: '',
            yearlyStats: stats,
            targetYear: year,
          });
        });

        const trResults = hitterTrueRatingsCalculationService.calculateTrueRatings(inputs);
        playerResult = trResults.find(r => r.playerId === playerId);
      }

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
          trueGap: playerResult.estimatedGap ?? 50,
          trueSpeed: playerResult.estimatedSpeed ?? 50,
          trueRating: playerResult.trueRating,
          source: 'calculated',
        });
      }
    }

    return results.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get historical raw batting stats for an MLB player, one record per year.
   * Combines stints within the same year. Only processes splitId === 1 (overall).
   */
  public async getHistoricalBatterStats(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    const allStats = await statsService.getBattingStats(playerId);
    if (allStats.length === 0) return [];

    // Group by year, filter to splitId === 1
    const byYear = new Map<number, { ab: number; pa: number; h: number; d: number; t: number; hr: number; bb: number; k: number; sb: number; cs: number; hp: number; sf: number }>();

    for (const stat of allStats) {
      if (stat.splitId !== 1) continue;
      if (!byYear.has(stat.year)) {
        byYear.set(stat.year, { ab: 0, pa: 0, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 0, sb: 0, cs: 0, hp: 0, sf: 0 });
      }
      const entry = byYear.get(stat.year)!;
      entry.ab += stat.ab;
      entry.pa += stat.pa;
      entry.h += stat.h;
      entry.d += stat.d;
      entry.t += stat.t;
      entry.hr += stat.hr;
      entry.bb += stat.bb;
      entry.k += stat.k;
      entry.sb += stat.sb;
      entry.cs += stat.cs;
      entry.hp += stat.hp;
      entry.sf += stat.sf;
    }

    const results: DevelopmentSnapshotRecord[] = [];
    const years = [...byYear.keys()].sort();
    for (const year of years) {
      const totals = byYear.get(year)!;
      if (totals.pa === 0) continue;

      // Calculate offensive WAR (OPS+ based, matching TrueRatingsView.calculateOffensiveWar)
      let offWar = 0;
      const obpDenom = totals.ab + totals.bb + totals.hp + totals.sf;
      const obp = obpDenom > 0 ? (totals.h + totals.bb + totals.hp) / obpDenom : 0;
      const tb = totals.h + totals.d + (2 * totals.t) + (3 * totals.hr);
      const slg = totals.ab > 0 ? tb / totals.ab : 0;

      const leagueAvg = await leagueBattingAveragesService.getLeagueAverages(year);
      if (leagueAvg && totals.ab > 0) {
        const opsPlus = leagueBattingAveragesService.calculateOpsPlus(obp, slg, leagueAvg);
        const runsPerWin = 10;
        const runsAboveAvg = ((opsPlus - 100) / 10) * (totals.pa / 600) * 10;
        const replacementRuns = (totals.pa / 600) * 20;
        const sbRuns = totals.sb * 0.2 - totals.cs * 0.4;
        offWar = (runsAboveAvg + replacementRuns + sbRuns) / runsPerWin;
      }

      results.push({
        key: `${playerId}_stat_${year}`,
        playerId,
        date: `${year}-07-01`,
        snapshotType: 'data_upload',
        playerType: 'hitter',
        statAvg: totals.ab > 0 ? totals.h / totals.ab : 0,
        statHrPct: (totals.hr / totals.pa) * 100,
        statBbPct: (totals.bb / totals.pa) * 100,
        statKPct: (totals.k / totals.pa) * 100,
        statHr: totals.hr,
        statBb: totals.bb,
        statK: totals.k,
        stat2b: totals.d,
        stat3b: totals.t,
        statSb: totals.sb,
        statSbPct: (totals.sb + totals.cs) > 0 ? (totals.sb / (totals.sb + totals.cs)) * 100 : 0,
        statWar: Math.round(offWar * 10) / 10,
        source: 'calculated',
      });
    }

    return results;
  }

  /**
   * Get historical raw pitching stats for an MLB player, one record per year.
   * Combines stints within the same year. Only processes splitId === 1 (overall).
   */
  public async getHistoricalPitcherStats(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    const allStats = await statsService.getPitchingStats(playerId);
    if (allStats.length === 0) return [];

    // Group by year, filter to splitId === 1
    const byYear = new Map<number, { ipOuts: number; hr: number; bb: number; k: number }>();

    for (const stat of allStats) {
      if (stat.splitId !== 1) continue;
      if (!byYear.has(stat.year)) {
        byYear.set(stat.year, { ipOuts: 0, hr: 0, bb: 0, k: 0 });
      }
      const entry = byYear.get(stat.year)!;
      entry.ipOuts += this.ipToOuts(stat.ip);
      entry.hr += stat.hr;
      entry.bb += stat.bb;
      entry.k += stat.k;
    }

    const results: DevelopmentSnapshotRecord[] = [];
    byYear.forEach((totals, year) => {
      const ip = totals.ipOuts / 3;
      if (ip <= 0) return;
      const hr9 = (totals.hr / ip) * 9;
      const bb9 = (totals.bb / ip) * 9;
      const k9 = (totals.k / ip) * 9;
      const fip = ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + 3.47;
      // Calculate FIP WAR using FipWarService constants
      const war = fipWarService.calculateWar(fip, ip);
      results.push({
        key: `${playerId}_stat_${year}`,
        playerId,
        date: `${year}-07-01`,
        snapshotType: 'data_upload',
        playerType: 'pitcher',
        statFip: Math.round(fip * 100) / 100,
        statHr9: Math.round(hr9 * 100) / 100,
        statBb9: Math.round(bb9 * 100) / 100,
        statK9: Math.round(k9 * 100) / 100,
        statHr: totals.hr,
        statBb: totals.bb,
        statK: totals.k,
        statWar: war,
        source: 'calculated',
      });
    });

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

        // Build TFR inputs for prospects at this date — load only snapshot players
        const snapshotIds = hitterSnapshotsAtDate.map(s => s.playerId);
        const snapshotPlayers = await playerService.getPlayersByIds(snapshotIds);
        const playerMap = new Map(snapshotPlayers.map(p => [p.id, p]));

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

        // Build TFR inputs for prospects at this date — load only snapshot players
        const snapshotIds = pitcherSnapshotsAtDate.map(s => s.playerId);
        const snapshotPlayers = await playerService.getPlayersByIds(snapshotIds);
        const playerMap = new Map(snapshotPlayers.map(p => [p.id, p]));

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
