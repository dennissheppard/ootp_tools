import { MinorLeagueStats, MinorLeagueStatsWithLevel, MinorLeagueLevel } from '../models/Stats';
import { indexedDBService } from './IndexedDBService';
import { apiFetch } from './ApiClient';
import { dateService } from './DateService';
import { LEAGUE_START_YEAR } from './TrueRatingsService';

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

    // Try IndexedDB first
    let stats: MinorLeagueStats[] | null = null;
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

    // Fallback: Query league-level data (slower, for v2 databases or cache misses)
    // This will also trigger auto-fetch from API if data doesn't exist
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
   * Load default minor league data from bundled CSV files
   * Tries to load all files from LEAGUE_START_YEAR to current year + 5
   * Silently skips files that don't exist (404)
   * @returns Object with count of files loaded and any errors
   */
  async loadDefaultMinorLeagueData(): Promise<{ loaded: number; errors: string[] }> {
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const startYear = LEAGUE_START_YEAR;
    const currentYear = await dateService.getCurrentYear();
    const endYear = currentYear - 1; // CSVs only bundled for historical years; current year fetched from API on demand

    let loaded = 0;
    const errors: string[] = [];

    console.log(`📦 Loading bundled minor league data (${startYear}-${endYear})...`);

    for (let year = startYear; year <= endYear; year++) {
      for (const level of levels) {
        try {
          const filename = `${year}_${level}.csv`;
          const url = `/data/minors/${filename}`;

          // Check if data already exists in cache
          const existing = await this.hasStats(year, level);
          if (existing) {
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
          const stats = this.parseCsv(csvText);

          if (stats.length === 0) {
            console.warn(`⚠️  ${filename} parsed to 0 records, skipping`);
            continue;
          }

          // Save to IndexedDB with 'csv' source
          await this.saveStats(year, level, stats, 'csv');
          loaded++;
          console.log(`✅ Loaded ${filename} (${stats.length} players)`);

        } catch (error) {
          errors.push(`${year}_${level}: ${error}`);
          console.error(`❌ Failed to load ${year}_${level}:`, error);
        }
      }
    }

    console.log(`📦 Bundled data load complete: ${loaded} datasets loaded, ${errors.length} errors`);
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
