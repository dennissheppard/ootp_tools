import { MinorLeagueBattingStats, MinorLeagueBattingStatsWithLevel, MinorLeagueLevel } from '../models/Stats';
import { indexedDBService } from './IndexedDBService';
import { apiFetch } from './ApiClient';
import { dateService } from './DateService';
import { LEAGUE_START_YEAR } from './TrueRatingsService';
import { supabaseDataService } from './SupabaseDataService';

export type { MinorLeagueLevel };

type BattingHeaderKey = 'id' | 'name' | 'pa' | 'ab' | 'h' | 'd' | 't' | 'hr' | 'bb' | 'k' | 'sb' | 'cs' |
  'avg' | 'obp' | 'slg' | 'ops' | 'iso' | 'bb_pct' | 'k_pct';

const HEADER_ALIASES: Record<BattingHeaderKey, string[]> = {
  id: ['player_id', 'playerid', 'pid', 'id'],
  name: ['name', 'playername', 'player', 'playerfullname'],
  pa: ['pa', 'plate_appearances', 'plateappearances'],
  ab: ['ab', 'at_bats', 'atbats'],
  h: ['h', 'hits', 'ha'],
  d: ['d', '2b', 'doubles', 'db'],
  t: ['t', '3b', 'triples', 'tp'],
  hr: ['hr', 'homeruns', 'home_runs'],
  bb: ['bb', 'walks', 'base_on_balls'],
  k: ['k', 'so', 'strikeouts', 'ks'],
  sb: ['sb', 'stolen_bases', 'stolenbases'],
  cs: ['cs', 'caught_stealing', 'caughtstealing'],
  avg: ['avg', 'ba', 'batting_average', 'battingaverage'],
  obp: ['obp', 'on_base', 'onbase', 'on_base_percentage'],
  slg: ['slg', 'slugging', 'slugging_percentage'],
  ops: ['ops', 'on_base_plus_slugging'],
  iso: ['iso', 'isolated_power', 'isolatedpower'],
  bb_pct: ['bb%', 'bbpct', 'bb_pct', 'walkrate', 'walk_rate'],
  k_pct: ['k%', 'kpct', 'k_pct', 'strikeoutrate', 'strikeout_rate'],
};

class MinorLeagueBattingStatsService {
  private inFlightRequests: Map<string, Promise<MinorLeagueBattingStats[]>> = new Map();
  // In-memory cache for Supabase-loaded MiLB batting stats (avoids repeated DB queries)
  private supabaseCache = new Map<string, MinorLeagueBattingStats[]>();

  parseCsv(csvText: string): MinorLeagueBattingStats[] {
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

    const results: MinorLeagueBattingStats[] = [];

    for (const line of dataLines) {
      const cells = this.parseCsvLine(line);
      if (cells.length === 0) continue;

      if (hasHeader) {
        const id = this.getNumberFromIndex(cells, indexMap.id);
        let name = this.getStringFromIndex(cells, indexMap.name);
        const pa = this.getNumberFromIndex(cells, indexMap.pa);
        const ab = this.getNumberFromIndex(cells, indexMap.ab);
        const h = this.getNumberFromIndex(cells, indexMap.h);
        const d = this.getNumberFromIndex(cells, indexMap.d);
        const t = this.getNumberFromIndex(cells, indexMap.t);
        const hr = this.getNumberFromIndex(cells, indexMap.hr);
        const bb = this.getNumberFromIndex(cells, indexMap.bb);
        const k = this.getNumberFromIndex(cells, indexMap.k);
        const sb = this.getNumberFromIndex(cells, indexMap.sb) ?? 0;
        const cs = this.getNumberFromIndex(cells, indexMap.cs) ?? 0;

        // Try to get rate stats from CSV, otherwise calculate them
        let avg = this.getNumberFromIndex(cells, indexMap.avg);
        let obp = this.getNumberFromIndex(cells, indexMap.obp);
        let slg = this.getNumberFromIndex(cells, indexMap.slg);
        let ops = this.getNumberFromIndex(cells, indexMap.ops);
        let iso = this.getNumberFromIndex(cells, indexMap.iso);
        let bb_pct = this.getNumberFromIndex(cells, indexMap.bb_pct);
        let k_pct = this.getNumberFromIndex(cells, indexMap.k_pct);

        // Use placeholder name if not provided
        if (!name && id !== null) {
          name = `Player ${id}`;
        }

        // Calculate rate stats if not provided
        if (ab !== null && ab > 0 && h !== null) {
          if (avg === null) avg = h / ab;
        }

        if (pa !== null && pa > 0) {
          // Calculate OBP: (H + BB + HBP) / (AB + BB + HBP + SF)
          // Simplified without HBP/SF: (H + BB) / PA
          if (obp === null && h !== null && bb !== null) {
            obp = (h + bb) / pa;
          }

          // Calculate BB% and K%
          if (bb_pct === null && bb !== null) bb_pct = bb / pa;
          if (k_pct === null && k !== null) k_pct = k / pa;
        }

        if (ab !== null && ab > 0 && h !== null && d !== null && t !== null && hr !== null) {
          // Calculate SLG: (1B + 2*2B + 3*3B + 4*HR) / AB
          const singles = h - d - t - hr;
          if (slg === null) {
            slg = (singles + 2 * d + 3 * t + 4 * hr) / ab;
          }
        }

        // Calculate OPS and ISO from AVG and SLG
        if (obp !== null && slg !== null && ops === null) {
          ops = obp + slg;
        }
        if (slg !== null && avg !== null && iso === null) {
          iso = slg - avg;
        }

        // Skip records without essential data
        if (
          id !== null &&
          name &&
          pa !== null &&
          ab !== null &&
          h !== null &&
          d !== null &&
          t !== null &&
          hr !== null &&
          bb !== null &&
          k !== null
        ) {
          results.push({
            id,
            name,
            pa,
            ab,
            h,
            d,
            t,
            hr,
            bb,
            k,
            sb: sb ?? 0,
            cs: cs ?? 0,
            avg: avg ?? 0,
            obp: obp ?? 0,
            slg: slg ?? 0,
            ops: ops ?? 0,
            iso: iso ?? 0,
            bb_pct: bb_pct ?? 0,
            k_pct: k_pct ?? 0,
          });
        }
      } else {
        // Fallback for no header - skip for now (API always has headers)
        console.warn('No header detected in batting CSV - skipping row');
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

  async fetchStatsFromApi(year: number, level: MinorLeagueLevel): Promise<MinorLeagueBattingStats[]> {
    // Try Supabase first (hero skips only for the current year — historical years are already in DB)
    if (supabaseDataService.isConfigured) {
      try {
        const rows = await supabaseDataService.getMinorBattingStats(year, level);
        if (rows.length > 0) {
          // MiLB batting stats loaded from Supabase
          const stats: MinorLeagueBattingStats[] = rows.map((r: any) => {
            const ab = r.ab ?? 0;
            const h = r.h ?? 0;
            const pa = r.pa ?? 0;
            const d = r.d ?? 0;
            const t = r.t ?? 0;
            const hr = r.hr ?? 0;
            const bb = r.bb ?? 0;
            const k = r.k ?? 0;
            const sb = r.sb ?? 0;
            const cs = r.cs ?? 0;
            const avg = ab > 0 ? h / ab : 0;
            const obp = pa > 0 ? (h + bb) / pa : 0;
            const slg = ab > 0 ? (h - d - t - hr + d * 2 + t * 3 + hr * 4) / ab : 0;
            return {
              id: r.player_id,
              name: `Player ${r.player_id}`,
              pa, ab, h, d, t, hr, bb, k, sb, cs,
              avg, obp, slg,
              ops: obp + slg,
              iso: slg - avg,
              bb_pct: pa > 0 ? bb / pa : 0,
              k_pct: pa > 0 ? k / pa : 0,
            };
          });
          this.supabaseCache.set(`${year}_${level}`, stats);
          return stats;
        }
      } catch (err) {
        console.warn(`⚠️ Supabase fetch failed for ${level} batting ${year}, falling back to API:`, err);
      }

      // Supabase is configured but returned no data — don't fall through to API
      console.warn(`⚠️ Supabase returned no ${level} batting data for ${year} and API fallback is disabled`);
      return [];
    }

    const leagueId = this.getLeagueId(level);
    const url = `/api/playerbatstatsv2/?year=${year}&lid=${leagueId}&split=1`;

    console.log(`🌐 Fetching ALL ${level.toUpperCase()} batting stats for ${year} from API...`);

    window.dispatchEvent(new CustomEvent('wbl:fetching-minor-league-batting-data', {
      detail: { year, level }
    }));

    try {
      const response = await apiFetch(url);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const csvText = await response.text();
      if (!csvText.trim()) {
        console.warn(`❌ Empty response from API for ${level.toUpperCase()} batting ${year}`);
        return [];
      }

      console.log(`📄 Received batting CSV (${csvText.length} chars). First 200 chars:`, csvText.substring(0, 200));

      const stats = this.parseCsv(csvText);

      if (stats.length === 0) {
        console.warn(`⚠️ Parser returned 0 batting records from ${csvText.length} char CSV.`);
      } else {
        try {
          await this.saveStats(year, level, stats, 'api');
          console.log(`💾 Saved ${stats.length} batting records to IndexedDB: ${level.toUpperCase()} ${year}`);
        } catch (saveError) {
          console.error(`❌ Failed to save batting stats to IndexedDB: ${saveError}`);
        }
      }

      console.log(`✅ Fetched ${stats.length} batting records from API: ${level.toUpperCase()} ${year}`);
      this.supabaseCache.set(`${year}_${level}`, stats);

      window.dispatchEvent(new CustomEvent('wbl:fetched-minor-league-batting-data', {
        detail: { year, level, recordCount: stats.length }
      }));

      return stats;

    } catch (error) {
      let errorMessage = 'Unknown error occurred';

      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Network error - please check your connection';
        } else if (error.message.includes('404')) {
          errorMessage = 'Data not found on StatsPlus API';
        } else if (error.message.includes('429')) {
          errorMessage = 'Rate limited by API';
        } else {
          errorMessage = error.message;
        }
      }

      console.error(`Failed to fetch batting stats from API: ${level.toUpperCase()} ${year}`, error);

      window.dispatchEvent(new CustomEvent('wbl:error-fetching-minor-league-batting-data', {
        detail: { year, level, error: errorMessage }
      }));

      throw new Error(`Could not fetch minor league batting stats: ${errorMessage}`);
    }
  }

  async saveStats(
    year: number,
    level: MinorLeagueLevel,
    stats: MinorLeagueBattingStats[],
    source: 'api' | 'csv' = 'csv'
  ): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      // Save league-level data
      const gameDate = await dateService.getCurrentDateWithFallback();
      await indexedDBService.saveBattingStats(year, level, stats);
      await indexedDBService.saveStatsMetadata(year, level, source, stats.length, gameDate, 'batting');

      // Save individual player records for fast lookups
      const playerSavePromises = stats.map(playerStat =>
        indexedDBService.savePlayerBattingStats(playerStat.id, year, level, playerStat)
      );
      await Promise.all(playerSavePromises);
    } catch (e) {
      console.error('Failed to save batting stats', e);
      throw e;
    }
  }

  async getStats(year: number, level: MinorLeagueLevel): Promise<MinorLeagueBattingStats[]> {
    if (typeof window === 'undefined') return [];

    const cacheKey = `batting_${year}_${level}`;

    // Check if a fetch is already in progress
    const inFlightRequest = this.inFlightRequests.get(cacheKey);
    if (inFlightRequest) {
      console.log(`Reusing in-flight batting request for ${level.toUpperCase()} ${year}`);
      return inFlightRequest;
    }

    // In-memory cache for Supabase-loaded data (avoids repeated DB queries)
    if (supabaseDataService.isConfigured) {
      const cached = this.supabaseCache.get(`${year}_${level}`);
      if (cached) return cached;
    }

    // Try IndexedDB first (skip when Supabase configured — query on-demand)
    let stats: MinorLeagueBattingStats[] | null = null;
    if (!supabaseDataService.isConfigured) {
      try {
        stats = await indexedDBService.getBattingStats(year, level);
      } catch (err) {
        console.error('Error fetching batting stats from IndexedDB:', err);
      }
    }

    // If found, check if current year data is stale (game date changed)
    if (stats !== null && stats.length > 0) {
      const currentYear = await dateService.getCurrentYear();
      if (year === currentYear) {
        const metadata = await indexedDBService.getStatsMetadata(year, level, 'batting');
        const currentGameDate = await dateService.getCurrentDate();
        if (!metadata || metadata.gameDate !== currentGameDate) {
          console.log(`📅 Batting cache stale for ${level.toUpperCase()} ${year} (game date changed), re-fetching...`);
          return await this.fetchStatsFromApiWithDedup(year, level);
        }
      }
      return stats;
    }

    // Data not found - fetch from API with deduplication
    console.log(`No cached batting data for ${level.toUpperCase()} ${year}, fetching from API...`);
    return await this.fetchStatsFromApiWithDedup(year, level);
  }

  private async fetchStatsFromApiWithDedup(year: number, level: MinorLeagueLevel): Promise<MinorLeagueBattingStats[]> {
    const cacheKey = `batting_${year}_${level}`;

    const existing = this.inFlightRequests.get(cacheKey);
    if (existing) return existing;

    const fetchPromise = this.fetchStatsFromApi(year, level)
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, fetchPromise);
    return fetchPromise;
  }

  /**
   * Bulk-fetch all MiLB batting stats for a year (all 4 levels in 1 query).
   * Populates supabaseCache so individual getStats() calls are instant.
   */
  async prefetchYear(year: number): Promise<void> {
    // Skip levels already cached
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const uncached = levels.filter(l => !this.supabaseCache.has(`${year}_${l}`));
    if (uncached.length === 0) return;

    // Try Supabase bulk query first
    if (supabaseDataService.isConfigured) {
      const rows = await supabaseDataService.getMinorBattingStatsByYear(year);
      if (rows.length > 0) {
        const leagueToLevel: Record<number, MinorLeagueLevel> = { 201: 'aaa', 202: 'aa', 203: 'a', 204: 'r' };
        const levelMap = new Map<string, MinorLeagueBattingStats[]>();

        for (const r of rows) {
          const level = leagueToLevel[r.league_id];
          if (!level) continue;
          if (!levelMap.has(level)) levelMap.set(level, []);

          const ab = r.ab ?? 0;
          const h = r.h ?? 0;
          const pa = r.pa ?? 0;
          const d = r.d ?? 0;
          const t = r.t ?? 0;
          const hr = r.hr ?? 0;
          const bb = r.bb ?? 0;
          const k = r.k ?? 0;
          const sb = r.sb ?? 0;
          const cs = r.cs ?? 0;
          const avg = ab > 0 ? h / ab : 0;
          const obp = pa > 0 ? (h + bb) / pa : 0;
          const slg = ab > 0 ? (h - d - t - hr + d * 2 + t * 3 + hr * 4) / ab : 0;

          levelMap.get(level)!.push({
            id: r.player_id,
            name: `Player ${r.player_id}`,
            pa, ab, h, d, t, hr, bb, k, sb, cs,
            avg, obp, slg,
            ops: obp + slg,
            iso: slg - avg,
            bb_pct: pa > 0 ? bb / pa : 0,
            k_pct: pa > 0 ? k / pa : 0,
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

    try {
      const data = await indexedDBService.getBattingStats(year, level);
      return data !== null && data.length > 0;
    } catch (err) {
      console.error('Error checking batting stats in IndexedDB:', err);
      return false;
    }
  }

  async clearStats(year: number, level: MinorLeagueLevel): Promise<void> {
    if (typeof window === 'undefined') return;

    try {
      await indexedDBService.deleteBattingStats(year, level);
    } catch (err) {
      console.error('Error deleting batting stats from IndexedDB:', err);
    }
  }

  /**
   * Get all minor league batting stats for a specific player across all levels within a year range.
   */
  async getPlayerStats(
    playerId: number,
    startYear: number,
    endYear: number
  ): Promise<MinorLeagueBattingStatsWithLevel[]> {
    if (typeof window === 'undefined') return [];

    console.log(`🔍 Looking up player ${playerId} batting stats (${startYear}-${endYear})...`);

    // Try player-indexed store first (fast path)
    const playerRecords = await indexedDBService.getPlayerBattingStats(playerId, startYear, endYear);

    if (playerRecords.length > 0) {
      const results: MinorLeagueBattingStatsWithLevel[] = playerRecords.map(record => ({
        ...record.data,
        year: record.year,
        level: record.level as MinorLeagueLevel,
      }));

      console.log(`✅ Fast batting lookup successful - ${results.length} seasons found`);
      return results.sort((a, b) => b.year - a.year);
    }

    // Supabase single-player query (1 request instead of years × levels)
    if (supabaseDataService.isConfigured) {
      const rows = await supabaseDataService.query<any>(
        'batting_stats',
        `select=*&player_id=eq.${playerId}&year=gte.${startYear}&year=lte.${endYear}&league_id=in.(201,202,203,204)&split_id=eq.1`
      );
      const leagueToLevel: Record<number, MinorLeagueLevel> = { 201: 'aaa', 202: 'aa', 203: 'a', 204: 'r' };
      // Dedup by year+league (keep row with most PA — the season total)
      const dedupMap = new Map<string, any>();
      for (const r of rows) {
        const key = `${r.year}_${r.league_id}`;
        const existing = dedupMap.get(key);
        if (!existing || (r.pa ?? 0) > (existing.pa ?? 0)) dedupMap.set(key, r);
      }
      const results: MinorLeagueBattingStatsWithLevel[] = [];
      for (const r of dedupMap.values()) {
        const level = leagueToLevel[r.league_id];
        if (!level) continue;
        const ab = r.ab ?? 0, h = r.h ?? 0, pa = r.pa ?? 0, d = r.d ?? 0, t = r.t ?? 0;
        const hr = r.hr ?? 0, bb = r.bb ?? 0, k = r.k ?? 0, sb = r.sb ?? 0, cs = r.cs ?? 0;
        const avg = ab > 0 ? h / ab : 0;
        const obp = pa > 0 ? (h + bb) / pa : 0;
        const slg = ab > 0 ? (h - d - t - hr + d * 2 + t * 3 + hr * 4) / ab : 0;
        results.push({
          id: r.player_id, name: `Player ${r.player_id}`,
          pa, ab, h, d, t, hr, bb, k, sb, cs,
          avg, obp, slg, ops: obp + slg, iso: slg - avg,
          bb_pct: pa > 0 ? bb / pa : 0, k_pct: pa > 0 ? k / pa : 0,
          year: r.year, level,
        });
      }
      return results.sort((a, b) => b.year - a.year);
    }

    // Fallback: Query league-level data
    console.log(`   Scanning league-level batting data for player ${playerId}...`);
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const results: MinorLeagueBattingStatsWithLevel[] = [];

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
   * Get all minor league batting stats for all players across all levels within a year range.
   * Used for batch TFR calculations.
   */
  async getAllPlayerStatsBatch(
    startYear: number,
    endYear: number
  ): Promise<Map<number, MinorLeagueBattingStatsWithLevel[]>> {
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const playerStatsMap = new Map<number, MinorLeagueBattingStatsWithLevel[]>();

    // Fetch all stats for all years/levels in parallel
    const fetchPromises: Promise<{ year: number; level: MinorLeagueLevel; stats: MinorLeagueBattingStats[] }>[] = [];

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

    // Sort each player's stats by year descending
    playerStatsMap.forEach(stats => {
      stats.sort((a, b) => b.year - a.year);
    });

    return playerStatsMap;
  }

  /**
   * Load default minor league batting data.
   * Tries Supabase bulk query first, falls back to CSV.
   */
  async loadDefaultMinorLeagueBattingData(): Promise<{ loaded: number; errors: string[] }> {
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
      console.log('📦 All minor league batting data already cached');
      return { loaded: 0, errors: [] };
    }

    console.log(`📦 Loading minor league batting data (${missing.length} datasets missing)...`);

    // Try Supabase bulk query
    if (supabaseDataService.isConfigured) {
      try {
        const grouped = await supabaseDataService.getAllMinorBattingStatsBulk(startYear, endYear);

        if (grouped.size > 0) {
          for (const [key, rows] of grouped) {
            const [yearStr, level] = key.split('_');
            const year = parseInt(yearStr, 10);

            // Transform Supabase rows to MinorLeagueBattingStats shape
            const stats: MinorLeagueBattingStats[] = rows.map(row => {
              const pa = row.pa ?? 0;
              const ab = row.ab ?? 0;
              const h = row.h ?? 0;
              const d = row.d ?? 0;
              const t = row.t ?? 0;
              const hr = row.hr ?? 0;
              const bb = row.bb ?? 0;
              const k = row.k ?? 0;
              const sb = row.sb ?? 0;
              const cs = row.cs ?? 0;

              const avg = ab > 0 ? h / ab : 0;
              const obp = pa > 0 ? (h + bb) / pa : 0;
              const singles = h - d - t - hr;
              const slg = ab > 0 ? (singles + 2 * d + 3 * t + 4 * hr) / ab : 0;
              const ops = obp + slg;
              const iso = slg - avg;
              const bb_pct = pa > 0 ? bb / pa : 0;
              const k_pct = pa > 0 ? k / pa : 0;

              return {
                id: row.player_id,
                name: `Player ${row.player_id}`,
                pa, ab, h, d, t, hr, bb, k, sb, cs,
                avg, obp, slg, ops, iso, bb_pct, k_pct,
              };
            });

            if (stats.length > 0) {
              await this.saveStats(year, level as MinorLeagueLevel, stats, 'csv');
              loaded++;
            }
          }

          console.log(`📦 Loaded ${loaded} minor league batting datasets from Supabase`);
          return { loaded, errors };
        }
      } catch (error) {
        console.warn('Supabase bulk query failed, falling back to CSV:', error);
      }
    }

    // Fallback: load from bundled CSV files
    for (const { year, level } of missing) {
      try {
        const filename = `${year}_${level}_batting.csv`;
        const response = await fetch(`/data/minors_batting/${filename}`);
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
        errors.push(`${year}_${level}_batting: ${error}`);
      }
    }

    console.log(`📦 Minor league batting load complete: ${loaded} datasets, ${errors.length} errors`);
    return { loaded, errors };
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
    indexMap: Partial<Record<BattingHeaderKey, number>>;
    hasHeader: boolean;
  } {
    const normalized = headerCells.map((cell) => this.normalizeHeader(cell));
    const indexMap: Partial<Record<BattingHeaderKey, number>> = {};
    let matches = 0;

    (Object.keys(HEADER_ALIASES) as BattingHeaderKey[]).forEach((key) => {
      const aliases = HEADER_ALIASES[key];

      for (const alias of aliases) {
        const idx = normalized.indexOf(alias);
        if (idx !== -1) {
          indexMap[key] = idx;
          matches += 1;
          break;
        }
      }
    });

    const hasHeader = matches >= 3;
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
    return value.replace(/^\ufeff/, '').toLowerCase().replace(/[^a-z0-9%/]/g, '');
  }

  private parseNumber(value: string | undefined): number | null {
    if (!value) return null;
    const cleaned = String(value).trim();
    if (!cleaned) return null;
    const numStr = cleaned.replace(/,/g, '');
    const num = Number(numStr);
    return Number.isNaN(num) ? null : num;
  }
}

export const minorLeagueBattingStatsService = new MinorLeagueBattingStatsService();
