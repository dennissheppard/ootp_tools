/**
 * SupabaseDataService
 *
 * Central data access layer that queries Supabase PostgREST API and returns
 * data in the same format as the existing CSV parsers. IndexedDB remains as
 * a local cache; Supabase is the source of truth.
 *
 * Uses the same env vars as AnalyticsService:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 */

// Re-export the stat types so consumers can import from here
export type { TruePitchingStats, TruePlayerStats, TrueBattingStats, TruePlayerBattingStats } from './TrueRatingsService';

// Level ID mapping (matches OOTP convention in CSV data)
export const LEVEL_IDS: Record<string, number> = {
  mlb: 1,    // league_id 200
  aaa: 2,    // league_id 201
  aa: 2,     // league_id 202  (level_id in CSV is always 2 for minors but league_id differs)
  a: 2,      // league_id 203
  r: 2,      // league_id 204
};

export const LEAGUE_IDS: Record<string, number> = {
  mlb: 200,
  aaa: 201,
  aa: 202,
  a: 203,
  r: 204,
};

// Reverse lookup: league_id → level name
const LEAGUE_ID_TO_LEVEL: Record<number, string> = {
  200: 'mlb',
  201: 'aaa',
  202: 'aa',
  203: 'a',
  204: 'r',
};

interface DataVersionEntry {
  table_name: string;
  updated_at: string;
  version: number;
  game_date?: string;
}

interface ContractRow {
  player_id: number;
  team_id: number;
  league_id: number;
  is_major: boolean;
  season_year: number;
  years: number;
  current_year: number;
  salaries: number[];
  no_trade: boolean;
  last_year_team_option: boolean;
  last_year_player_option: boolean;
  last_year_vesting_option: boolean;
}

class SupabaseDataService {
  private supabaseUrl: string;
  private supabaseKey: string;
  private configured: boolean;
  private _dobCache: Map<number, Date> | null = null;
  private _playersCache: any[] | null = null;
  private _playersCachePromise: Promise<any[]> | null = null;
  private _teamsCache: any[] | null = null;
  private _precomputedCache = new Map<string, any>();
  private _gameDatePromise: Promise<string | null> | null = null;
  private _cachedGameDate: string | null | undefined = undefined; // undefined = not fetched
  private static readonly CUSTOM_SCOUTING_KEY = 'wbl-has-custom-scouting';

  private _hasCustomScouting = false;

  get hasCustomScouting(): boolean {
    return this._hasCustomScouting;
  }

  set hasCustomScouting(value: boolean) {
    this._hasCustomScouting = value;
    try {
      if (value) {
        localStorage.setItem(SupabaseDataService.CUSTOM_SCOUTING_KEY, '1');
      } else {
        localStorage.removeItem(SupabaseDataService.CUSTOM_SCOUTING_KEY);
      }
    } catch { /* localStorage unavailable */ }
  }

  constructor() {
    this.supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL
      ?? (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.VITE_SUPABASE_URL) ?? '';
    this.supabaseKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY
      ?? (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.VITE_SUPABASE_ANON_KEY) ?? '';
    this.configured = Boolean(this.supabaseUrl && this.supabaseKey);

    // Restore custom scouting flag from localStorage (survives refresh)
    try {
      this._hasCustomScouting = localStorage.getItem(SupabaseDataService.CUSTOM_SCOUTING_KEY) === '1';
    } catch { /* ignore */ }

    if (!this.configured && typeof window !== 'undefined') {
      console.log('📦 SupabaseDataService disabled — using local CSV/API');
    }
  }

  get isConfigured(): boolean {
    return this.configured;
  }

  // ──────────────────────────────────────────────
  // Generic REST helpers
  // ──────────────────────────────────────────────

  async query<T>(table: string, params: string): Promise<T[]> {
    if (!this.configured) return [];

    const PAGE_SIZE = 1000;
    const allRows: T[] = [];
    let offset = 0;

    while (true) {
      const url = `${this.supabaseUrl}/rest/v1/${table}?${params}&offset=${offset}&limit=${PAGE_SIZE}`;
      const response = await fetch(url, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Prefer': 'count=exact',
        },
      });

      if (!response.ok) {
        throw new Error(`Supabase query failed: ${table}?${params} → ${response.status}`);
      }

      const rows: T[] = await response.json();
      allRows.push(...rows);

      // If we got fewer rows than page size, we've reached the end
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    return allRows;
  }

  // ──────────────────────────────────────────────
  // Cache invalidation
  // ──────────────────────────────────────────────

  /**
   * Fetch data_version table from Supabase and compare with local versions.
   * Returns table names that need cache invalidation.
   */
  async checkForUpdates(): Promise<string[]> {
    if (!this.configured) return [];

    try {
      const versions = await this.query<DataVersionEntry>('data_version', 'select=*');
      const localVersionsJson = localStorage.getItem('wbl-data-versions');
      const localVersions: Record<string, number> = localVersionsJson
        ? JSON.parse(localVersionsJson) : {};

      const stale: string[] = [];
      const newVersions: Record<string, number> = {};

      for (const entry of versions) {
        newVersions[entry.table_name] = entry.version;
        if ((localVersions[entry.table_name] ?? 0) < entry.version) {
          stale.push(entry.table_name);
        }
      }

      // Save new versions to localStorage
      localStorage.setItem('wbl-data-versions', JSON.stringify(newVersions));

      return stale;
    } catch (error) {
      console.warn('Failed to check data versions:', error);
      return [];
    }
  }

  // ──────────────────────────────────────────────
  // Pitching stats
  // ──────────────────────────────────────────────

  /**
   * Fetch pitching stats for a single year and level.
   * Returns rows in the same shape as TruePitchingStats from CSV.
   */
  async getPitchingStats(year: number, leagueId: number): Promise<any[]> {
    const params = `select=*&year=eq.${year}&league_id=eq.${leagueId}&split_id=eq.1&order=player_id`;
    return this.query('pitching_stats', params);
  }

  /**
   * Fetch pitching stats for multiple years at once (bulk query).
   * Replaces 21 individual CSV fetches with one query.
   */
  async getPitchingStatsBulk(startYear: number, endYear: number, leagueId: number): Promise<any[]> {
    const params = `select=*&year=gte.${startYear}&year=lte.${endYear}&league_id=eq.${leagueId}&split_id=eq.1&order=year,player_id&limit=100000`;
    return this.query('pitching_stats', params);
  }

  /**
   * Fetch pitching stats for a specific player across all years.
   */
  async getPlayerPitchingStats(playerId: number): Promise<any[]> {
    const params = `select=*&player_id=eq.${playerId}&split_id=eq.1&order=year`;
    return this.query('pitching_stats', params);
  }

  // ──────────────────────────────────────────────
  // Batting stats
  // ──────────────────────────────────────────────

  async getBattingStats(year: number, leagueId: number): Promise<any[]> {
    const params = `select=*&year=eq.${year}&league_id=eq.${leagueId}&split_id=eq.1&order=player_id`;
    return this.query('batting_stats', params);
  }

  async getBattingStatsBulk(startYear: number, endYear: number, leagueId: number): Promise<any[]> {
    const params = `select=*&year=gte.${startYear}&year=lte.${endYear}&league_id=eq.${leagueId}&split_id=eq.1&order=year,player_id&limit=100000`;
    return this.query('batting_stats', params);
  }

  async getPlayerBattingStats(playerId: number): Promise<any[]> {
    const params = `select=*&player_id=eq.${playerId}&split_id=eq.1&order=year`;
    return this.query('batting_stats', params);
  }

  // ──────────────────────────────────────────────
  // Minor league stats (same tables, different league_id)
  // ──────────────────────────────────────────────

  /**
   * Fetch minor league pitching stats for a year and level.
   * Returns in same shape as MinorLeagueStats after transformation.
   */
  async getMinorPitchingStats(year: number, level: string): Promise<any[]> {
    const leagueId = LEAGUE_IDS[level];
    if (!leagueId) return [];
    return this.getPitchingStats(year, leagueId);
  }

  async getMinorPitchingStatsBulk(startYear: number, endYear: number, level: string): Promise<any[]> {
    const leagueId = LEAGUE_IDS[level];
    if (!leagueId) return [];
    return this.getPitchingStatsBulk(startYear, endYear, leagueId);
  }

  async getMinorBattingStats(year: number, level: string): Promise<any[]> {
    const leagueId = LEAGUE_IDS[level];
    if (!leagueId) return [];
    return this.getBattingStats(year, leagueId);
  }

  async getMinorBattingStatsBulk(startYear: number, endYear: number, level: string): Promise<any[]> {
    const leagueId = LEAGUE_IDS[level];
    if (!leagueId) return [];
    return this.getBattingStatsBulk(startYear, endYear, leagueId);
  }

  /**
   * Fetch ALL minor league pitching stats for a range of years across all levels.
   * Returns rows grouped by year+level for bulk IndexedDB caching.
   */
  async getAllMinorPitchingStatsBulk(startYear: number, endYear: number): Promise<Map<string, any[]>> {
    const params = `select=*&year=gte.${startYear}&year=lte.${endYear}&league_id=gte.201&league_id=lte.204&split_id=eq.1&order=year,league_id,player_id&limit=500000`;
    const rows = await this.query<any>('pitching_stats', params);

    // Group by year_level key
    const grouped = new Map<string, any[]>();
    for (const row of rows) {
      const level = LEAGUE_ID_TO_LEVEL[row.league_id] || 'unknown';
      const key = `${row.year}_${level}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    return grouped;
  }

  async getAllMinorBattingStatsBulk(startYear: number, endYear: number): Promise<Map<string, any[]>> {
    const params = `select=*&year=gte.${startYear}&year=lte.${endYear}&league_id=gte.201&league_id=lte.204&split_id=eq.1&order=year,league_id,player_id&limit=500000`;
    const rows = await this.query<any>('batting_stats', params);

    const grouped = new Map<string, any[]>();
    for (const row of rows) {
      const level = LEAGUE_ID_TO_LEVEL[row.league_id] || 'unknown';
      const key = `${row.year}_${level}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }
    return grouped;
  }

  /**
   * Fetch all minor league pitching stats for a year across all MiLB levels in 1 query.
   * Returns all 4 levels (201-204) at once — caller groups by league_id.
   */
  async getMinorPitchingStatsByYear(year: number): Promise<any[]> {
    return this.query('pitching_stats', `select=*&year=eq.${year}&league_id=in.(201,202,203,204)&split_id=eq.1&order=league_id,player_id`);
  }

  /**
   * Fetch all minor league batting stats for a year across all MiLB levels in 1 query.
   */
  async getMinorBattingStatsByYear(year: number): Promise<any[]> {
    return this.query('batting_stats', `select=*&year=eq.${year}&league_id=in.(201,202,203,204)&split_id=eq.1&order=league_id,player_id`);
  }

  // ──────────────────────────────────────────────
  // Scouting data
  // ──────────────────────────────────────────────

  /**
   * Fetch pitcher scouting data from Supabase (OSA only).
   * 'my' scouting is team-specific privileged data stored only in IndexedDB.
   * Always uses compact precomputed lookup (1 request) when available, instead of
   * raw scouting table (~24 paginated requests). Missing fields (pitches, personality)
   * are acceptable for bulk consumers; profile modals do single-player queries.
   */
  async getPitcherScouting(): Promise<any[]> {
    const lookup = await this.getPrecomputedScoutingLookup('pitcher');
    if (lookup) {
      // [stuff, control, hra, ovr, pot, lev, hsc, name, age, stamina, pitches]
      const results: any[] = [];
      for (const [id, vals] of lookup) {
        const pitchesStr = vals[10] as string;
        let pitches: Record<string, number> | undefined;
        if (pitchesStr) {
          try { pitches = JSON.parse(pitchesStr); } catch { /* ignore */ }
        }
        results.push({
          playerId: id,
          playerName: vals[7] as string || undefined,
          stuff: vals[0] as number,
          control: vals[1] as number,
          hra: vals[2] as number,
          ovr: vals[3] as number,
          pot: vals[4] as number,
          lev: vals[5] as string,
          hsc: vals[6] as string,
          age: vals[8] as number,
          stamina: vals[9] as number,
          pitches,
        });
      }
      return results;
    }
    const params = `select=*&source=eq.osa&order=player_id`;
    const rows = await this.query<any>('pitcher_scouting', params);
    return rows.map(row => this.transformPitcherScoutingRow(row));
  }

  /**
   * Fetch hitter scouting data from Supabase (OSA only).
   * 'my' scouting is team-specific privileged data stored only in IndexedDB.
   * Always uses compact precomputed lookup (1 request) when available, instead of
   * raw scouting table (~25 paginated requests). Missing fields (personality, stealing)
   * are acceptable for bulk consumers; profile modals do single-player queries.
   */
  async getHitterScouting(): Promise<any[]> {
    const lookup = await this.getPrecomputedScoutingLookup('hitter');
    if (lookup) {
      // [contact, power, eye, avoidK, gap, speed, ovr, pot, lev, hsc, name, age, sbAgg, sbAbility, injury]
      const results: any[] = [];
      for (const [id, vals] of lookup) {
        results.push({
          playerId: id,
          playerName: vals[10] as string || undefined,
          contact: vals[0] as number,
          power: vals[1] as number,
          eye: vals[2] as number,
          avoidK: vals[3] as number,
          gap: vals[4] as number,
          speed: vals[5] as number,
          ovr: vals[6] as number,
          pot: vals[7] as number,
          lev: vals[8] as string,
          hsc: vals[9] as string,
          age: vals[11] as number,
          stealingAggressiveness: (vals[12] as number) || undefined,
          stealingAbility: (vals[13] as number) || undefined,
          injuryProneness: (vals[14] as string) || undefined,
        });
      }
      return results;
    }
    const params = `select=*&source=eq.osa&order=player_id`;
    const rows = await this.query<any>('hitter_scouting', params);
    return rows.map(row => this.transformHitterScoutingRow(row));
  }

  /**
   * Fetch raw fielding scouting ratings for a player from hitter_scouting.raw_data.fielding.
   * Returns the fielding object or null if not available.
   */
  async getFieldingScoutingForPlayer(playerId: number): Promise<any | null> {
    if (!this.configured) return null;
    try {
      const rows = await this.query<any>('hitter_scouting', `select=raw_data&source=eq.osa&player_id=eq.${playerId}&order=snapshot_date.desc&limit=1`);
      return rows[0]?.raw_data?.fielding ?? null;
    } catch { return null; }
  }

  // ──────────────────────────────────────────────
  // Player DOBs
  // ──────────────────────────────────────────────

  /**
   * Fetch player DOBs from Supabase players table.
   * Returns Map<playerId, Date> matching the format of loadPlayerDOBs().
   */
  async getPlayerDOBs(): Promise<Map<number, Date>> {
    if (this._dobCache) return this._dobCache;

    const params = `select=id,dob&dob=not.is.null`;
    const rows = await this.query<{ id: number; dob: string }>('players', params);

    const dobMap = new Map<number, Date>();
    for (const row of rows) {
      if (row.dob) {
        dobMap.set(row.id, new Date(row.dob));
      }
    }
    this._dobCache = dobMap;
    return dobMap;
  }

  // ──────────────────────────────────────────────
  // Players & Teams
  // ──────────────────────────────────────────────

  async getPlayers(): Promise<any[]> {
    if (this._playersCache) return this._playersCache;
    // Deduplicate concurrent calls
    if (!this._playersCachePromise) {
      this._playersCachePromise = this.query('players', 'select=*&first_name=not.is.null&limit=50000')
        .then(rows => { this._playersCache = rows; return rows; })
        .finally(() => { this._playersCachePromise = null; });
    }
    return this._playersCachePromise;
  }

  async getTeams(): Promise<any[]> {
    if (this._teamsCache) return this._teamsCache;
    this._teamsCache = await this.query('teams', 'select=*&order=id');
    return this._teamsCache;
  }

  // ──────────────────────────────────────────────
  // Contracts
  // ──────────────────────────────────────────────

  async getContracts(): Promise<ContractRow[]> {
    return this.query<ContractRow>('contracts', 'select=*&limit=50000');
  }

  // ──────────────────────────────────────────────
  // Player ratings (pre-computed TR/TFR)
  // ──────────────────────────────────────────────

  /**
   * Bulk fetch pre-computed ratings by type (e.g. 'pitcher_tr', 'hitter_tfr').
   */
  async getPlayerRatings(ratingType: string): Promise<{ player_id: number; rating_type: string; data: any }[]> {
    return this.query('player_ratings', `select=*&rating_type=eq.${ratingType}&order=player_id`);
  }

  /**
   * Fetch all pre-computed ratings for a single player (1-4 rows).
   */
  async getPlayerRating(playerId: number): Promise<{ player_id: number; rating_type: string; data: any }[]> {
    return this.query('player_ratings', `select=*&player_id=eq.${playerId}`);
  }

  /**
   * Upsert pre-computed rating rows. Uses composite PK (player_id, rating_type).
   */
  async upsertPlayerRatings(rows: { player_id: number; rating_type: string; data: any }[]): Promise<void> {
    await this.upsert('player_ratings', rows, 'player_id,rating_type');
  }

  // ──────────────────────────────────────────────
  // Precomputed cache (static data that persists across syncs)
  // ──────────────────────────────────────────────

  /**
   * Fetch the current game_date, cached per session.
   * Used as a cache key for localStorage — when CLI syncs and calls
   * complete_sync(), the game_date changes and all cached data is invalidated.
   */
  private async getGameDateCached(): Promise<string | null> {
    if (this._cachedGameDate !== undefined) return this._cachedGameDate;
    if (!this._gameDatePromise) {
      this._gameDatePromise = this.getGameDate().then(gd => {
        this._cachedGameDate = gd;
        return gd;
      });
    }
    return this._gameDatePromise;
  }

  /**
   * Clear stale localStorage entries when game_date changes.
   */
  private clearStalePrecomputedCache(): void {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('wbl-pc-')) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch { /* storage unavailable */ }
  }

  async getPrecomputed(key: string): Promise<any | null> {
    if (!this.configured) return null;
    if (this._precomputedCache.has(key)) return this._precomputedCache.get(key);

    const gameDate = await this.getGameDateCached();

    // Check localStorage (invalidated when game_date changes after CLI sync)
    if (gameDate) {
      try {
        const cached = localStorage.getItem(`wbl-pc-${key}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.gd === gameDate) {
            this._precomputedCache.set(key, parsed.data);
            return parsed.data;
          }
          // game_date changed — clear all stale entries
          this.clearStalePrecomputedCache();
        }
      } catch { /* storage unavailable or corrupt */ }
    }

    // Fetch from Supabase
    try {
      const rows = await this.query<{ key: string; data: any }>('precomputed_cache', `select=data&key=eq.${key}`);
      const val = rows[0]?.data ?? null;
      if (val !== null) {
        this._precomputedCache.set(key, val);
        // Persist to localStorage for future page loads
        if (gameDate) {
          try {
            localStorage.setItem(`wbl-pc-${key}`, JSON.stringify({ gd: gameDate, data: val }));
          } catch { /* storage full or unavailable */ }
        }
      }
      return val;
    } catch {
      return null;
    }
  }

  async setPrecomputed(key: string, data: any): Promise<void> {
    await this.upsert('precomputed_cache', [{ key, data }], 'key');
  }

  /**
   * Get pre-computed compact scouting lookup.
   * Pitcher format: { [playerId]: [stuff, control, hra, ovr, pot, lev, hsc, ?name, ?age, ?stamina] }
   * Hitter format: { [playerId]: [contact, power, eye, avoidK, gap, speed, ovr, pot, lev, hsc, ?name, ?age] }
   */
  async getPrecomputedScoutingLookup(type: 'pitcher' | 'hitter'): Promise<Map<number, (number | string)[]> | null> {
    const data = await this.getPrecomputed(`${type}_scouting_lookup`);
    if (!data) return null;
    const map = new Map<number, (number | string)[]>();
    for (const [id, values] of Object.entries(data)) {
      map.set(Number(id), values as (number | string)[]);
    }
    return map;
  }

  /**
   * Get pre-computed compact contract lookup.
   * Format: { [playerId]: [salary, leagueId, yearsRemaining] }
   */
  async getPrecomputedContractLookup(): Promise<Map<number, number[]> | null> {
    const data = await this.getPrecomputed('contract_lookup');
    if (!data) return null;
    const map = new Map<number, number[]>();
    for (const [id, values] of Object.entries(data)) {
      map.set(Number(id), values as number[]);
    }
    return map;
  }

  /**
   * Get pre-computed DOB lookup. Format: { [playerId]: birthYear }
   */
  async getPrecomputedDobLookup(): Promise<Map<number, number> | null> {
    const data = await this.getPrecomputed('dob_lookup');
    if (!data) return null;
    const map = new Map<number, number>();
    for (const [id, birthYear] of Object.entries(data)) {
      map.set(Number(id), birthYear as number);
    }
    return map;
  }

  // ──────────────────────────────────────────────
  // Write helpers (hero sync)
  // ──────────────────────────────────────────────

  /**
   * Upsert rows into a table. Batches in chunks of 500.
   * Uses PostgREST merge-duplicates for idempotent writes.
   */
  async upsert(table: string, rows: any[], onConflict?: string): Promise<void> {
    if (!this.configured || rows.length === 0) return;

    const BATCH_SIZE = 1000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const url = `${this.supabaseUrl}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates',
        },
        body: JSON.stringify(batch),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        console.error(`❌ Supabase upsert FAILED: ${table} batch ${i / BATCH_SIZE} → ${response.status}`, body);
        throw new Error(`Supabase upsert failed: ${table} batch ${i / BATCH_SIZE} → ${response.status} ${body}`);
      }
    }
  }

  /**
   * Call an RPC function on Supabase.
   */
  async rpc<T = any>(fn: string, args: Record<string, any> = {}): Promise<T> {
    const url = `${this.supabaseUrl}/rest/v1/rpc/${fn}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': this.supabaseKey,
        'Authorization': `Bearer ${this.supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Supabase RPC ${fn} failed: ${response.status} ${body}`);
    }

    const text = await response.text();
    if (!text) return undefined as any;
    return JSON.parse(text);
  }

  // ──────────────────────────────────────────────
  // Sync orchestration
  // ──────────────────────────────────────────────

  async getGameDate(): Promise<string | null> {
    if (!this.configured) return null;
    try {
      const rows = await this.query<DataVersionEntry>('data_version', 'select=game_date&table_name=eq.game_state');
      return rows[0]?.game_date ?? null;
    } catch {
      return null;
    }
  }

  async claimSync(newDate: string): Promise<boolean> {
    const result = await this.rpc<boolean>('claim_sync', { new_date: newDate });
    console.log(`🔒 claimSync(${newDate}) → ${result}`);
    return result;
  }

  /**
   * Clobber contracts before hero re-inserts fresh data.
   * Players/teams are upserted (FK constraints from stats tables prevent DELETE).
   * Stats are upserted to preserve historical data.
   */
  async clearForSync(): Promise<void> {
    await this.rpc<void>('clear_for_sync');
  }

  async completeSync(syncDate: string): Promise<void> {
    await this.rpc<void>('complete_sync', { sync_date: syncDate });
  }

  // ──────────────────────────────────────────────
  // Upsert methods for hero sync
  // ──────────────────────────────────────────────

  async upsertPlayers(players: any[]): Promise<void> {
    const rows = players.map(p => ({
      id: p.id,
      first_name: p.firstName,
      last_name: p.lastName,
      team_id: p.teamId || null,           // 0 = free agent/retired → null (no FK target)
      parent_team_id: p.parentTeamId || null, // 0 = MLB org (no parent) → null
      level: String(p.level),
      league_id: p.leagueId ?? null,
      position: p.position,
      role: p.role,
      age: p.age,
      retired: p.retired ?? false,
    }));
    await this.upsert('players', rows, 'id');
  }

  async upsertTeams(teams: any[]): Promise<void> {
    const rows = teams.map(t => ({
      id: t.id,
      name: t.name,
      nickname: t.nickname,
      parent_team_id: t.parentTeamId,
      league_id: t.leagueId ?? null,
    }));
    await this.upsert('teams', rows, 'id');
  }

  async upsertContracts(contracts: Array<{ playerId: number; teamId: number; leagueId: number; isMajor: boolean; seasonYear: number; years: number; currentYear: number; salaries: number[]; noTrade: boolean; lastYearTeamOption: boolean; lastYearPlayerOption: boolean; lastYearVestingOption: boolean }>): Promise<void> {
    const rows = contracts.map(c => ({
      player_id: c.playerId,
      team_id: c.teamId,
      league_id: c.leagueId,
      is_major: c.isMajor,
      season_year: c.seasonYear,
      years: c.years,
      current_year: c.currentYear,
      salaries: c.salaries,
      no_trade: c.noTrade,
      last_year_team_option: c.lastYearTeamOption,
      last_year_player_option: c.lastYearPlayerOption,
      last_year_vesting_option: c.lastYearVestingOption,
    }));
    await this.upsert('contracts', rows, 'player_id');
  }

  // Column whitelists — only send columns that exist in the DB.
  // StatsPlus CSVs have extra columns (cg, sho, hld, ir, irs, etc.)
  // and parseStatsCsv adds computed fields (avg, obp). PostgREST
  // rejects rows with unknown columns, so we strip them here.
  private static readonly PITCHING_COLS = new Set([
    'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
    'ip', 'ab', 'tb', 'ha', 'k', 'bf', 'rs', 'bb', 'r', 'er', 'gb', 'fb', 'pi', 'ipf',
    'g', 'gs', 'w', 'l', 's', 'sa', 'da', 'sh', 'sf', 'ta', 'hra', 'bk', 'ci', 'iw',
    'wp', 'hp', 'gf', 'dp', 'qs', 'svo', 'bs', 'ra', 'war', 'fip', 'babip', 'whip',
  ]);

  private static readonly BATTING_COLS = new Set([
    'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
    'position', 'ab', 'h', 'k', 'pa', 'pitches_seen', 'g', 'gs', 'd', 't', 'hr', 'r',
    'rbi', 'sb', 'cs', 'bb', 'ibb', 'gdp', 'sh', 'sf', 'hp', 'ci', 'wpa', 'stint',
    'ubr', 'war',
  ]);

  private filterColumns(rows: any[], allowedCols: Set<string>): any[] {
    return rows.map(row => {
      const filtered: any = {};
      for (const key of Object.keys(row)) {
        if (allowedCols.has(key)) filtered[key] = row[key];
      }
      return filtered;
    });
  }

  async upsertPitchingStats(stats: any[]): Promise<void> {
    const filtered = this.filterColumns(stats, SupabaseDataService.PITCHING_COLS);
    await this.upsert('pitching_stats', filtered, 'player_id,year,league_id,split_id');
  }

  async upsertBattingStats(stats: any[]): Promise<void> {
    const filtered = this.filterColumns(stats, SupabaseDataService.BATTING_COLS);
    await this.upsert('batting_stats', filtered, 'player_id,year,league_id,split_id');
  }

  // ──────────────────────────────────────────────
  // Row transformers (Supabase JSON → existing format)
  // ──────────────────────────────────────────────

  /**
   * Transform pitcher_scouting row to PitcherScoutingRatings shape.
   */
  transformPitcherScoutingRow(row: any): any {
    const rawData = row.raw_data || {};
    return {
      playerId: row.player_id,
      playerName: row.player_name || undefined,
      stuff: row.stuff,
      control: row.control,
      hra: row.hra,
      stamina: row.stamina || undefined,
      injuryProneness: row.injury_proneness || undefined,
      age: row.age || undefined,
      ovr: row.ovr || undefined,
      pot: row.pot || undefined,
      pitches: rawData.pitches || undefined,
      leadership: rawData.leadership || undefined,
      loyalty: rawData.loyalty || undefined,
      adaptability: rawData.adaptability || undefined,
      greed: rawData.greed || undefined,
      workEthic: rawData.workEthic || undefined,
      intelligence: rawData.intelligence || undefined,
      pitcherType: row.pitcher_type || rawData.pitcherType || undefined,
      babip: row.babip || rawData.babip || undefined,
      lev: row.lev || undefined,
      hsc: row.hsc || undefined,
      dob: row.dob || undefined,
      source: row.source,
    };
  }

  /**
   * Transform hitter_scouting row to HitterScoutingRatings shape.
   */
  transformHitterScoutingRow(row: any): any {
    const rawData = row.raw_data || {};
    return {
      playerId: row.player_id,
      playerName: row.player_name || undefined,
      power: row.power,
      eye: row.eye,
      avoidK: row.avoid_k,
      contact: row.contact ?? 50,
      gap: row.gap ?? 50,
      speed: row.speed ?? 50,
      stealingAggressiveness: row.stealing_aggressiveness || undefined,
      stealingAbility: row.stealing_ability || undefined,
      injuryProneness: row.injury_proneness || undefined,
      age: row.age || undefined,
      ovr: row.ovr,
      pot: row.pot,
      leadership: rawData.leadership || undefined,
      loyalty: rawData.loyalty || undefined,
      adaptability: rawData.adaptability || undefined,
      greed: rawData.greed || undefined,
      workEthic: rawData.workEthic || undefined,
      intelligence: rawData.intelligence || undefined,
      pos: row.pos || undefined,
      lev: row.lev || undefined,
      hsc: row.hsc || undefined,
      dob: row.dob || undefined,
      source: row.source,
    };
  }
}

export const supabaseDataService = new SupabaseDataService();
