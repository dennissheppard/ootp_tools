import { MinorLeagueStats, MinorLeagueStatsWithLevel, MinorLeagueLevel } from '../models/Stats';
import { indexedDBService } from './IndexedDBService';
import { apiFetch } from './ApiClient';
import { dateService } from './DateService';
import { LEAGUE_START_YEAR } from './TrueRatingsService';
import { supabaseDataService } from './SupabaseDataService';

export type { MinorLeagueLevel };

const STORAGE_KEY_PREFIX = 'wbl_minor_stats_';
const USE_INDEXEDDB = true; // Feature flag to switch between localStorage and IndexedDB

type StatsHeaderKey = 'id' | 'name' | 'ip' | 'hr' | 'bb' | 'k' | 'hr9' | 'bb9' | 'k9';

const HEADER_ALIASES: Record<StatsHeaderKey, string[]> = {
  id: ['player_id', 'playerid', 'pid', 'id'], // API uses 'player_id' - prioritize it over 'id' (which is row ID)
  name: ['name', 'playername', 'player', 'playerfullname'], // API might not have name
  ip: ['ip', 'innings'],
  hr: ['hr', 'homeruns', 'hra'], // API uses 'hra' (home runs allowed)
  bb: ['bb', 'walks'],
  k: ['k', 'so', 'strikeouts'],
  hr9: ['hr/9', 'hr9', 'homeruns/9'],
  bb9: ['bb/9', 'bb9', 'walks/9'],
  k9: ['k/9', 'k9', 'strikeouts/9'],
};

class MinorLeagueStatsService {
  // Cache for in-flight API requests to prevent duplicate calls
  private inFlightRequests: Map<string, Promise<MinorLeagueStats[]>> = new Map();
  // In-memory cache for Supabase-loaded MiLB stats (avoids repeated DB queries)
  private supabaseCache = new Map<string, MinorLeagueStats[]>();

  parseCsv(csvText: string): MinorLeagueStats[] {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    const headerCells = this.parseCsvLine(lines[0]);
    const { indexMap, hasHeader } = this.buildHeaderMap(headerCells);
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const results: MinorLeagueStats[] = [];

    for (const line of dataLines) {
      const cells = this.parseCsvLine(line);
      if (cells.length === 0) continue;

      // Ensure we have enough columns if there's no header, or specific columns if there is
      if (hasHeader) {
        const id = this.getNumberFromIndex(cells, indexMap.id);
        let name = this.getStringFromIndex(cells, indexMap.name);
        const ip = this.getNumberFromIndex(cells, indexMap.ip);
        const hr = this.getNumberFromIndex(cells, indexMap.hr);
        const bb = this.getNumberFromIndex(cells, indexMap.bb);
        const k = this.getNumberFromIndex(cells, indexMap.k);
        let hr9 = this.getNumberFromIndex(cells, indexMap.hr9);
        let bb9 = this.getNumberFromIndex(cells, indexMap.bb9);
        let k9 = this.getNumberFromIndex(cells, indexMap.k9);

        // Use placeholder name if not provided (API doesn't include player names)
        if (!name && id !== null) {
          name = `Player ${id}`;
        }

        // Calculate rate stats if not provided (API doesn't include them)
        if (ip !== null && ip > 0) {
          if (hr9 === null && hr !== null) hr9 = (hr / ip) * 9;
          if (bb9 === null && bb !== null) bb9 = (bb / ip) * 9;
          if (k9 === null && k !== null) k9 = (k / ip) * 9;
        }

        if (
          id !== null &&
          name &&
          ip !== null &&
          hr !== null &&
          bb !== null &&
          k !== null &&
          hr9 !== null &&
          bb9 !== null &&
          k9 !== null
        ) {
          results.push({ id, name, ip, hr, bb, k, hr9, bb9, k9 });
        }
      } else {
        // Fallback for no header: assume strict order: ID,Name,IP,HR,BB,K,HR/9,BB/9,K/9
        if (cells.length < 9) continue;

        const id = this.parseNumber(cells[0]);
        const name = this.cleanCell(cells[1]);
        const ip = this.parseNumber(cells[2]);
        const hr = this.parseNumber(cells[3]);
        const bb = this.parseNumber(cells[4]);
        const k = this.parseNumber(cells[5]);
        const hr9 = this.parseNumber(cells[6]);
        const bb9 = this.parseNumber(cells[7]);
        const k9 = this.parseNumber(cells[8]);

        if (
          id !== null &&
          name &&
          ip !== null &&
          hr !== null &&
          bb !== null &&
          k !== null &&
          hr9 !== null &&
          bb9 !== null &&
          k9 !== null
        ) {
          results.push({ id, name, ip, hr, bb, k, hr9, bb9, k9 });
        }
      }
    }

    return results;
  }

  private getLeagueId(level: MinorLeagueLevel): number {
    const mapping: Record<MinorLeagueLevel, number> = {
      'aaa': 201,
      'aa': 202,
      'a': 203,
      'r': 204
    };
    return mapping[level];
  }

  async fetchStatsFromApi(year: number, level: MinorLeagueLevel): Promise<MinorLeagueStats[]> {
    // Try Supabase first (hero skips only for the current year — historical years are already in DB)
    if (supabaseDataService.isConfigured) {
      try {
        const rows = await supabaseDataService.getMinorPitchingStats(year, level);
        if (rows.length > 0) {
          // MiLB pitching stats loaded from Supabase
          const stats: MinorLeagueStats[] = rows.map((r: any) => {
            const ip = typeof r.ip === 'string' ? parseFloat(r.ip) : (r.ip || 0);
            const hr = r.hra ?? r.hr ?? 0;
            const bb = r.bb ?? 0;
            const k = r.k ?? 0;
            return {
              id: r.player_id,
              name: `Player ${r.player_id}`,
              ip, hr, bb, k,
              hr9: ip > 0 ? (hr / ip) * 9 : 0,
              bb9: ip > 0 ? (bb / ip) * 9 : 0,
              k9: ip > 0 ? (k / ip) * 9 : 0,
            };
          });
          this.supabaseCache.set(`${year}_${level}`, stats);
          return stats;
        }
      } catch (err) {
        console.warn(`⚠️ Supabase fetch failed for ${level} pitching ${year}, falling back to API:`, err);
      }

      // Supabase is configured but returned no data — don't fall through to API
      console.warn(`⚠️ Supabase returned no ${level} pitching data for ${year} and API fallback is disabled`);
      return [];
    }

    const leagueId = this.getLeagueId(level);
    const url = `/api/playerpitchstatsv2/?year=${year}&lid=${leagueId}&split=1`;

    console.log(`🌐 Fetching ALL ${level.toUpperCase()} players for ${year} from API (1 call for entire league)...`);

    // Emit event for UI feedback
    window.dispatchEvent(new CustomEvent('wbl:fetching-minor-league-data', {
      detail: { year, level }
    }));

    try {
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const csvText = await response.text();
      if (!csvText.trim()) {
        console.warn(`❌ Empty response from API for ${level.toUpperCase()} ${year}`);
        return [];
      }

      console.log(`📄 Received CSV (${csvText.length} chars). First 200 chars:`, csvText.substring(0, 200));

      // Reuse existing CSV parser
      const stats = this.parseCsv(csvText);

      if (stats.length === 0) {
        console.warn(`⚠️ Parser returned 0 records from ${csvText.length} char CSV. First line:`, csvText.split('\n')[0]);
        console.warn(`⚠️ Not caching empty result - will retry on next request`);
      } else {
        // Only cache non-empty results to avoid caching parser errors
        try {
          await this.saveStats(year, level, stats, 'api');
          console.log(`💾 Saved ${stats.length} records to IndexedDB: ${level.toUpperCase()} ${year}`);
        } catch (saveError) {
          console.error(`❌ Failed to save to IndexedDB (data will not be cached): ${saveError}`);
          // Continue anyway - we still have the data in memory
        }
      }

      console.log(`✅ Fetched ${stats.length} records from API: ${level.toUpperCase()} ${year}`);
      this.supabaseCache.set(`${year}_${level}`, stats);

      // Emit success event
      window.dispatchEvent(new CustomEvent('wbl:fetched-minor-league-data', {
        detail: { year, level, recordCount: stats.length }
      }));

      return stats;

    } catch (error) {
      let errorMessage = 'Unknown error occurred';

      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Network error - please check your connection';
        } else if (error.message.includes('404')) {
          errorMessage = 'Data not found on StatsPlus API (may not exist for this year/level)';
        } else if (error.message.includes('429')) {
          errorMessage = 'Rate limited by API - retrying automatically...';
        } else {
          errorMessage = error.message;
        }
      }

      console.error(`Failed to fetch from API: ${level.toUpperCase()} ${year}`, error);

      // Emit error event for UI to display
      window.dispatchEvent(new CustomEvent('wbl:error-fetching-minor-league-data', {
        detail: { year, level, error: errorMessage }
      }));

      throw new Error(`Could not fetch minor league stats: ${errorMessage}`);
    }
  }

  async saveStats(
    year: number,
    level: MinorLeagueLevel,
    stats: MinorLeagueStats[],
    source: 'api' | 'csv' = 'csv'
  ): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      if (USE_INDEXEDDB) {
        // Save league-level data (for Farm Rankings, bulk operations)
        const gameDate = await dateService.getCurrentDateWithFallback();
        await indexedDBService.saveStats(year, level, stats);
        await indexedDBService.saveStatsMetadata(year, level, source, stats.length, gameDate);

        // Also save individual player records (for fast player profile lookups)
        // This creates duplicate data but enables O(1) player lookups via index
        const playerSavePromises = stats.map(playerStat =>
          indexedDBService.savePlayerStats(playerStat.id, year, level, playerStat)
        );
        await Promise.all(playerSavePromises);
      } else {
        localStorage.setItem(this.storageKey(year, level), JSON.stringify(stats));
      }
    } catch (e) {
      console.error('Failed to save stats', e);
      throw e; // Re-throw so UI can handle errors
    }
  }

  async getStats(year: number, level: MinorLeagueLevel): Promise<MinorLeagueStats[]> {
    if (typeof window === 'undefined') return [];

    const cacheKey = `${year}_${level}`;

    // Check if a fetch is already in progress for this year/level
    const inFlightRequest = this.inFlightRequests.get(cacheKey);
    if (inFlightRequest) {
      console.log(`Reusing in-flight request for ${level.toUpperCase()} ${year}`);
      return inFlightRequest;
    }

    // In-memory cache for Supabase-loaded data (avoids repeated DB queries)
    if (supabaseDataService.isConfigured) {
      const cached = this.supabaseCache.get(cacheKey);
      if (cached) return cached;
    }

    // Try IndexedDB first (skip when Supabase configured — query on-demand)
    let stats: MinorLeagueStats[] | null = null;
    if (!supabaseDataService.isConfigured) {
      if (USE_INDEXEDDB) {
        try {
          stats = await indexedDBService.getStats(year, level);
        } catch (err) {
          console.error('Error fetching from IndexedDB:', err);
        }
      } else {
        // Fallback to localStorage
        try {
          const raw = localStorage.getItem(this.storageKey(year, level));
          if (raw) {
            const parsed = JSON.parse(raw);
            stats = Array.isArray(parsed) ? (parsed as MinorLeagueStats[]) : null;
          }
        } catch (err) {
          console.error('Error fetching from localStorage:', err);
        }
      }
    }

    // If found, check metadata to verify it's a valid cached result
    if (stats !== null) {
      const metadata = await indexedDBService.getStatsMetadata(year, level);

      // If no metadata exists, this is stale/corrupted data - fetch from API
      if (!metadata) {
        console.log(`⚠️ Found cached data without metadata for ${level.toUpperCase()} ${year}, re-fetching from API...`);
        return await this.fetchStatsFromApiWithDedup(year, level);
      }

      // CACHE BUST: If API data was fetched before 2026-01-29 (when we fixed player_id parsing),
      // it has wrong IDs (row IDs instead of player IDs). Re-fetch it.
      const PARSER_FIX_DATE = new Date('2026-01-29T12:00:00Z').getTime();
      if (metadata.source === 'api' && metadata.fetchedAt < PARSER_FIX_DATE) {
        console.log(`⚠️ Cache has old player IDs (pre-parser-fix) for ${level.toUpperCase()} ${year} - re-fetching...`);
        return await this.fetchStatsFromApiWithDedup(year, level);
      }

      // If cached data is empty and came from API, don't trust it - might be from parser bugs
      // Only trust empty results from CSV uploads
      if (stats.length === 0 && metadata.source === 'api') {
        console.log(`⚠️ Found empty API result in cache for ${level.toUpperCase()} ${year} - re-fetching in case it was a parser error...`);
        return await this.fetchStatsFromApiWithDedup(year, level);
      }

      // Check if current year data is stale (game date changed)
      const currentYear = await dateService.getCurrentYear();
      if (year === currentYear) {
        const currentGameDate = await dateService.getCurrentDate();
        if (metadata.gameDate !== currentGameDate) {
          console.log(`📅 Cache stale for ${level.toUpperCase()} ${year} (game date changed), re-fetching...`);
          return await this.fetchStatsFromApiWithDedup(year, level);
        }
      }

      // Return cached data
      return stats;
    }

    // Data not found - fetch from API with deduplication
    console.log(`No cached data for ${level.toUpperCase()} ${year}, fetching from API...`);
    return await this.fetchStatsFromApiWithDedup(year, level);
  }

  private async fetchStatsFromApiWithDedup(year: number, level: MinorLeagueLevel): Promise<MinorLeagueStats[]> {
    const cacheKey = `${year}_${level}`;

    // Double-check in-flight cache
    const existing = this.inFlightRequests.get(cacheKey);
    if (existing) return existing;

    // Start the fetch and cache the promise
    const fetchPromise = this.fetchStatsFromApi(year, level)
      .finally(() => {
        // Clean up the in-flight cache when done
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Bulk-fetch all MiLB pitching stats for a year (all 4 levels in 1 query).
   * Populates supabaseCache so individual getStats() calls are instant.
   */
  async prefetchYear(year: number): Promise<void> {
    // Skip levels already cached
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const uncached = levels.filter(l => !this.supabaseCache.has(`${year}_${l}`));
    if (uncached.length === 0) return;

    // Try Supabase bulk query first
    if (supabaseDataService.isConfigured) {
      const rows = await supabaseDataService.getMinorPitchingStatsByYear(year);
      if (rows.length > 0) {
        const leagueToLevel: Record<number, MinorLeagueLevel> = { 201: 'aaa', 202: 'aa', 203: 'a', 204: 'r' };
        const levelMap = new Map<string, MinorLeagueStats[]>();

        for (const r of rows) {
          const level = leagueToLevel[r.league_id];
          if (!level) continue;
          if (!levelMap.has(level)) levelMap.set(level, []);

          const ip = typeof r.ip === 'string' ? parseFloat(r.ip) : (r.ip || 0);
          const hr = r.hra ?? r.hr ?? 0;
          const bb = r.bb ?? 0;
          const k = r.k ?? 0;
          levelMap.get(level)!.push({
            id: r.player_id,
            name: `Player ${r.player_id}`,
            ip, hr, bb, k,
            hr9: ip > 0 ? (hr / ip) * 9 : 0,
            bb9: ip > 0 ? (bb / ip) * 9 : 0,
            k9: ip > 0 ? (k / ip) * 9 : 0,
          });
        }

        for (const [level, stats] of levelMap) {
          this.supabaseCache.set(`${year}_${level}`, stats);
        }
        return;
      }
    }

    // Supabase empty or not configured — fetch all uncached levels from API in parallel
    await Promise.all(uncached.map(level => this.fetchStatsFromApiWithDedup(year, level)));
  }

  async hasStats(year: number, level: MinorLeagueLevel): Promise<boolean> {
    if (typeof window === 'undefined') return false;

    // Check IndexedDB first
    if (USE_INDEXEDDB) {
      try {
        const data = await indexedDBService.getStats(year, level);
        if (data && data.length > 0) return true;
      } catch (err) {
        console.error('Error checking IndexedDB:', err);
      }
    }

    // Fallback to localStorage
    return !!localStorage.getItem(this.storageKey(year, level));
  }

  async clearStats(year: number, level: MinorLeagueLevel): Promise<void> {
    if (typeof window === 'undefined') return;

    // Clear from IndexedDB (both league-level and player-indexed stores)
    if (USE_INDEXEDDB) {
      try {
        await indexedDBService.deleteStats(year, level);
        await indexedDBService.deleteAllPlayerStatsForYearLevel(year, level);
      } catch (err) {
        console.error('Error deleting from IndexedDB:', err);
      }
    }

    // Also clear from localStorage for backward compatibility
    localStorage.removeItem(this.storageKey(year, level));
  }

  /**
   * Get all minor league stats for all players across all levels within a year range.
   * Returns a Map of playerId -> array of stats. Much faster than individual queries.
   */
  async getAllPlayerStatsBatch(
    startYear: number,
    endYear: number
  ): Promise<Map<number, MinorLeagueStatsWithLevel[]>> {
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const playerStatsMap = new Map<number, MinorLeagueStatsWithLevel[]>();

    // Fetch all stats for all years/levels in parallel
    const fetchPromises: Promise<{ year: number; level: MinorLeagueLevel; stats: MinorLeagueStats[] }>[] = [];

    for (let year = startYear; year <= endYear; year++) {
      for (const level of levels) {
        fetchPromises.push(
          this.getStats(year, level).then(stats => ({ year, level, stats }))
        );
      }
    }

    const results = await Promise.all(fetchPromises);

    // Build the map
    for (const { year, level, stats } of results) {
      for (const stat of stats) {
        if (!playerStatsMap.has(stat.id)) {
          playerStatsMap.set(stat.id, []);
        }
        playerStatsMap.get(stat.id)!.push({
          ...stat,
          year,
          level,
        });
      }
    }

    return playerStatsMap;
  }

  /**
   * Get all minor league stats for a specific player across all levels within a year range.
   * Returns stats with level information attached.
   *
   * Optimized: Queries player-indexed store directly (O(1) lookup) instead of loading
   * entire league datasets. Falls back to league lookup if player store unavailable.
   */
  async getPlayerStats(
    playerId: number,
    startYear: number,
    endYear: number
  ): Promise<MinorLeagueStatsWithLevel[]> {
    if (typeof window === 'undefined') return [];

    console.log(`🔍 Looking up player ${playerId} stats (${startYear}-${endYear})...`);

    // Try player-indexed store first (fast path - v3 databases)
    if (USE_INDEXEDDB) {
      const playerRecords = await indexedDBService.getPlayerStats(playerId, startYear, endYear);

      console.log(`   Player-indexed store returned ${playerRecords.length} records`);

      if (playerRecords.length > 0) {
        // Found records in player-indexed store - convert and return
        const results: MinorLeagueStatsWithLevel[] = playerRecords.map(record => ({
          ...record.data,
          year: record.year,
          level: record.level as MinorLeagueLevel,
        }));

        console.log(`✅ Fast lookup successful - ${results.length} seasons found`);
        return results.sort((a, b) => b.year - a.year);
      }

      console.warn(`⚠️ Player-indexed store returned 0 records - falling back to league-level scan`);
    }

    // Supabase single-player query (1 request instead of years × levels)
    if (supabaseDataService.isConfigured) {
      const rows = await supabaseDataService.query<any>(
        'pitching_stats',
        `select=*&player_id=eq.${playerId}&year=gte.${startYear}&year=lte.${endYear}&league_id=in.(201,202,203,204)&split_id=eq.1`
      );
      const leagueToLevel: Record<number, MinorLeagueLevel> = { 201: 'aaa', 202: 'aa', 203: 'a', 204: 'r' };
      // Dedup by year+league (keep row with most IP — the season total)
      const dedupMap = new Map<string, any>();
      for (const r of rows) {
        const key = `${r.year}_${r.league_id}`;
        const existing = dedupMap.get(key);
        const rIp = typeof r.ip === 'string' ? parseFloat(r.ip) : (r.ip || 0);
        const eIp = existing ? (typeof existing.ip === 'string' ? parseFloat(existing.ip) : (existing.ip || 0)) : -1;
        if (!existing || rIp > eIp) dedupMap.set(key, r);
      }
      const results: MinorLeagueStatsWithLevel[] = [];
      for (const r of dedupMap.values()) {
        const level = leagueToLevel[r.league_id];
        if (!level) continue;
        const ip = typeof r.ip === 'string' ? parseFloat(r.ip) : (r.ip || 0);
        const hr = r.hra ?? r.hr ?? 0, bb = r.bb ?? 0, k = r.k ?? 0;
        results.push({
          id: r.player_id, name: `Player ${r.player_id}`,
          ip, hr, bb, k,
          hr9: ip > 0 ? (hr / ip) * 9 : 0,
          bb9: ip > 0 ? (bb / ip) * 9 : 0,
          k9: ip > 0 ? (k / ip) * 9 : 0,
          year: r.year, level,
        });
      }
      return results.sort((a, b) => b.year - a.year);
    }

    // Fallback: Query league-level data (slower, for v2 databases or cache misses)
    console.log(`   Scanning league-level data for player ${playerId}...`);
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const results: MinorLeagueStatsWithLevel[] = [];

    for (let year = startYear; year <= endYear; year++) {
      for (const level of levels) {
        const stats = await this.getStats(year, level);
        const playerStats = stats.find((s) => s.id === playerId);

        if (playerStats) {
          results.push({
            ...playerStats,
            year,
            level,
          });
        }
      }
    }

    return results.sort((a, b) => b.year - a.year);
  }

  /**
   * Get all stored year/level combinations that have data.
   */
  async getAvailableDataSets(): Promise<Array<{ year: number; level: MinorLeagueLevel }>> {
    if (typeof window === 'undefined') return [];
    const results: Array<{ year: number; level: MinorLeagueLevel }> = [];
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];

    // Check years from 2000 to current year + 5
    const maxYear = new Date().getFullYear() + 5;
    for (let year = 2000; year <= maxYear; year++) {
      for (const level of levels) {
        if (await this.hasStats(year, level)) {
          results.push({ year, level });
        }
      }
    }

    return results;
  }

  /**
   * Load default minor league pitching data.
   * Tries Supabase bulk query first (1 request for all years/levels), falls back to CSV.
   */
  async loadDefaultMinorLeagueData(): Promise<{ loaded: number; errors: string[] }> {
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const startYear = LEAGUE_START_YEAR;
    const currentYear = await dateService.getCurrentYear();
    const endYear = currentYear - 1;

    let loaded = 0;
    const errors: string[] = [];

    // Determine which year/level combos are missing
    const missing: { year: number; level: MinorLeagueLevel }[] = [];
    for (let year = startYear; year <= endYear; year++) {
      for (const level of levels) {
        if (!(await this.hasStats(year, level))) {
          missing.push({ year, level });
        }
      }
    }

    if (missing.length === 0) {
      console.log('📦 All minor league pitching data already cached');
      return { loaded: 0, errors: [] };
    }

    console.log(`📦 Loading minor league pitching data (${missing.length} datasets missing)...`);

    // Try Supabase bulk query
    if (supabaseDataService.isConfigured) {
      try {
        const grouped = await supabaseDataService.getAllMinorPitchingStatsBulk(startYear, endYear);

        if (grouped.size > 0) {
          for (const [key, rows] of grouped) {
            const [yearStr, level] = key.split('_');
            const year = parseInt(yearStr, 10);

            // Transform Supabase rows to MinorLeagueStats shape
            const stats: MinorLeagueStats[] = rows.map(row => {
              const ip = parseFloat(row.ip) || 0;
              const hr = row.hra ?? 0;
              const bb = row.bb ?? 0;
              const k = row.k ?? 0;
              return {
                id: row.player_id,
                name: `Player ${row.player_id}`,
                ip, hr, bb, k,
                hr9: ip > 0 ? (hr / ip) * 9 : 0,
                bb9: ip > 0 ? (bb / ip) * 9 : 0,
                k9: ip > 0 ? (k / ip) * 9 : 0,
              };
            });

            if (stats.length > 0) {
              await this.saveStats(year, level as MinorLeagueLevel, stats, 'csv');
              loaded++;
            }
          }

          console.log(`📦 Loaded ${loaded} minor league pitching datasets from Supabase`);
          return { loaded, errors };
        }
      } catch (error) {
        console.warn('Supabase bulk query failed, falling back to CSV:', error);
      }
    }

    // Fallback: load from bundled CSV files
    for (const { year, level } of missing) {
      try {
        const filename = `${year}_${level}.csv`;
        const response = await fetch(`/data/minors/${filename}`);
        if (!response.ok) {
          if (response.status !== 404) errors.push(`${filename}: HTTP ${response.status}`);
          continue;
        }

        const csvText = await response.text();
        const stats = this.parseCsv(csvText);
        if (stats.length === 0) continue;

        await this.saveStats(year, level, stats, 'csv');
        loaded++;
      } catch (error) {
        errors.push(`${year}_${level}: ${error}`);
      }
    }

    console.log(`📦 Minor league pitching load complete: ${loaded} datasets, ${errors.length} errors`);
    return { loaded, errors };
  }

  private storageKey(year: number, level: MinorLeagueLevel): string {
    return `${STORAGE_KEY_PREFIX}${year}_${level}`;
  }

  private getNumberFromIndex(cells: string[], index?: number): number | null {
    if (typeof index !== 'number') return null;
    return this.parseNumber(cells[index]);
  }

  private getStringFromIndex(cells: string[], index?: number): string {
    if (typeof index !== 'number') return '';
    return this.cleanCell(cells[index] ?? '');
  }

  private buildHeaderMap(headerCells: string[]): {
    indexMap: Partial<Record<StatsHeaderKey, number>>;
    hasHeader: boolean;
  } {
    const normalized = headerCells.map((cell) => this.normalizeHeader(cell));
    const indexMap: Partial<Record<StatsHeaderKey, number>> = {};
    let matches = 0;

    (Object.keys(HEADER_ALIASES) as StatsHeaderKey[]).forEach((key) => {
      const aliases = HEADER_ALIASES[key];

      // Find the first alias (in priority order) that exists in the headers
      // This ensures 'player_id' is used before 'id' when both exist
      for (const alias of aliases) {
        const idx = normalized.indexOf(alias);
        if (idx !== -1) {
          indexMap[key] = idx;
          matches += 1;
          break; // Use the first matching alias
        }
      }
    });

    const hasHeader = matches >= 3; // Arbitrary threshold to detect if header exists
    return { indexMap, hasHeader };
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
        values.push(this.cleanCell(current));
        current = '';
      } else {
        current += char;
      }
    }

    values.push(this.cleanCell(current));
    return values;
  }

  private cleanCell(value: string): string {
    return value.replace(/^\ufeff/, '').trim();
  }

  private normalizeHeader(value: string): string {
    return value.replace(/^\ufeff/, '').toLowerCase().replace(/[^a-z0-9/]/g, ''); // Keep / for hr/9 etc
  }

  private parseNumber(value: string | undefined): number | null {
    if (!value) return null;
    const cleaned = String(value).trim();
    if (!cleaned) return null;
    // Handle "1,234.56" format if necessary, though typical CSV is likely plain numbers
    // But CSV might use commas for thousands if quoted, so simple replacement:
    const numStr = cleaned.replace(/,/g, '');
    const num = Number(numStr);
    return Number.isNaN(num) ? null : num;
  }
}

export const minorLeagueStatsService = new MinorLeagueStatsService();
