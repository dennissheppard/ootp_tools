/**
 * IndexedDB wrapper for storing large amounts of data
 * Replaces localStorage for scouting and minor league stats
 */

const DB_NAME = 'wbl_database';
const DB_VERSION = 11;
const SCOUTING_STORE = 'scouting_ratings';
const STATS_STORE = 'minor_league_stats';
const METADATA_STORE = 'minor_league_metadata';
const PLAYER_STATS_STORE = 'player_minor_league_stats'; // New: indexed by playerId for fast lookups
const MLB_PLAYER_STATS_STORE = 'mlb_player_pitching_stats'; // MLB player-specific stats cache
const MLB_LEAGUE_STATS_STORE = 'mlb_league_stats'; // Full MLB league data by year (replaces localStorage)
const PLAYERS_STORE = 'players'; // Player roster cache
const TEAMS_STORE = 'teams'; // Team list cache
const DEVELOPMENT_SNAPSHOTS_STORE = 'player_development_snapshots'; // v7: Historical TR/TFR/scouting tracking

// v8: Batting stats stores
const BATTING_STATS_STORE = 'minor_league_batting_stats'; // League-level batting data by year/level
const PLAYER_BATTING_STATS_STORE = 'player_minor_league_batting_stats'; // Player-indexed batting stats
const MLB_PLAYER_BATTING_STATS_STORE = 'mlb_player_batting_stats'; // MLB player batting stats cache
const HITTER_SCOUTING_STORE = 'hitter_scouting_ratings'; // Hitter scouting data (future)
const AI_SCOUTING_BLURB_STORE = 'ai_scouting_blurbs'; // v9: AI-generated scouting reports
const TEAM_PLANNING_OVERRIDES_STORE = 'team_planning_overrides'; // v10: User cell overrides in team planning grid
const PLAYER_DEV_OVERRIDES_STORE = 'player_dev_overrides'; // v11: Per-player development curve overrides

export interface ScoutingRecord {
  key: string; // Format: "YYYY-MM-DD_source"
  date: string;
  source: string;
  data: any[];
}

export interface StatsRecord {
  key: string; // Format: "year_level"
  year: number;
  level: string;
  data: any[];
}

export interface StatsMetadataRecord {
  key: string; // Format: "year_level" or "batting_year_level"
  year: number;
  level: string;
  source: 'api' | 'csv';
  fetchedAt: number; // timestamp
  recordCount: number;
  gameDate?: string; // Game date when data was cached (YYYY-MM-DD)
}

export interface PlayerStatsRecord {
  key: string; // Format: "playerId_year_level"
  playerId: number;
  year: number;
  level: string;
  data: any; // Single player's stats
}

export interface MlbPlayerPitchingStatsRecord {
  key: string; // Format: "playerId" or "playerId_year"
  playerId: number;
  year?: number; // Optional: if present, this is year-specific data
  data: any[]; // Array of PitchingStats
  fetchedAt: number; // timestamp for cache invalidation
  gameDate?: string; // game date when data was cached
}

export interface MlbLeagueStatsRecord {
  key: string; // Format: "pitching_YEAR" or "batting_YEAR"
  type: 'pitching' | 'batting';
  year: number;
  data: any[]; // Full league array of TruePlayerStats
  fetchedAt: number; // timestamp (0 = permanent cache for historical years)
  gameDate?: string; // game date when data was cached
}

export interface PlayersRecord {
  key: string; // Always "current" (single record)
  data: any[]; // Array of Player objects
  fetchedAt: number; // timestamp for cache invalidation
  gameDate?: string; // game date when data was cached
}

export interface TeamsRecord {
  key: string; // Always "current" (single record)
  data: any[]; // Array of Team objects
  fetchedAt: number; // timestamp for cache invalidation
}

export interface DevelopmentSnapshotRecord {
  key: string; // Format: "playerId_YYYY-MM-DD"
  playerId: number;
  date: string; // YYYY-MM-DD
  snapshotType: 'data_upload' | 'manual';
  playerType?: 'pitcher' | 'hitter'; // Distinguish pitcher vs hitter snapshots
  // Core ratings (nullable - may not have all data)
  trueRating?: number;
  trueFutureRating?: number;
  // Pitcher scouting ratings (20-80 scale)
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
  // Hitter scouting ratings (20-80 scale)
  scoutPower?: number;
  scoutEye?: number;
  scoutAvoidK?: number;
  scoutBabip?: number;
  scoutGap?: number;
  scoutSpeed?: number;  // Note: 20-200 scale
  // Star ratings (0.5-5.0 scale)
  scoutOvr?: number;
  scoutPot?: number;
  // Pitcher True Ratings (20-80 scale, calculated from stats)
  trueStuff?: number;
  trueControl?: number;
  trueHra?: number;
  // Hitter True Ratings (20-80 scale, calculated from stats)
  truePower?: number;
  trueEye?: number;
  trueAvoidK?: number;
  trueContact?: number;
  trueGap?: number;
  trueSpeed?: number;
  // Batter stat fields (raw MLB stats for stats chart mode)
  statAvg?: number;
  statHrPct?: number;
  statBbPct?: number;
  statKPct?: number;
  statHr?: number;
  statBb?: number;
  statK?: number;
  stat2b?: number;
  stat3b?: number;
  statSb?: number;
  statSbPct?: number;
  statWar?: number;
  // Pitcher stat fields (raw MLB stats for stats chart mode)
  statFip?: number;
  statHr9?: number;
  statBb9?: number;
  statK9?: number;
  // Metadata
  source: 'my' | 'osa' | 'calculated';
  level?: string; // MLB, AAA, AA, A, R
  age?: number;
}

// v8: Batting stats records
export interface BattingStatsRecord {
  key: string; // Format: "year_level"
  year: number;
  level: string;
  data: any[];
}

export interface PlayerBattingStatsRecord {
  key: string; // Format: "playerId_year_level"
  playerId: number;
  year: number;
  level: string;
  data: any; // Single player's batting stats
}

export interface MlbPlayerBattingStatsRecord {
  key: string; // Format: "playerId" or "playerId_year"
  playerId: number;
  year?: number;
  data: any[]; // Array of BattingStats
  fetchedAt: number;
  gameDate?: string; // game date when data was cached
}

export interface AIScoutingBlurbRecord {
  key: string;           // "playerId_pitcher" or "playerId_hitter"
  playerId: number;
  playerType: 'pitcher' | 'hitter';
  blurbText: string;
  dataHash: string;
  generatedAt: number;
}

export interface TeamPlanningOverrideRecord {
  key: string;             // "teamId_position_year"
  teamId: number;
  position: string;        // "C", "SP1", etc.
  year: number;
  playerId: number | null;
  playerName: string;
  age: number;
  rating: number;
  salary: number;
  contractStatus: string;
  level?: string;
  isProspect?: boolean;
  sourceType: 'extend' | 'org' | 'trade-target' | 'fa-target' | 'clear';
  createdAt: number;
}

export interface PlayerDevOverrideRecord {
  key: string;             // playerId as string
  playerId: number;
  effectiveFromYear: number; // grid year from which dev override applies (forward only)
}

class IndexedDBService {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;

        // Warn if not on latest version (user needs to close ALL tabs and reopen)
        if (this.db.version < DB_VERSION) {
          console.warn(`⚠️ IndexedDB is on v${this.db.version} but code expects v${DB_VERSION}. Close ALL browser tabs and reopen to upgrade.`);
        }

        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;
        const newVersion = event.newVersion;
        console.log(`🔄 IndexedDB upgrading from v${oldVersion} to v${newVersion}...`);

        // Create scouting ratings store
        if (!db.objectStoreNames.contains(SCOUTING_STORE)) {
          const scoutingStore = db.createObjectStore(SCOUTING_STORE, { keyPath: 'key' });
          scoutingStore.createIndex('date', 'date', { unique: false });
          scoutingStore.createIndex('source', 'source', { unique: false });
        }

        // Create minor league stats store
        if (!db.objectStoreNames.contains(STATS_STORE)) {
          const statsStore = db.createObjectStore(STATS_STORE, { keyPath: 'key' });
          statsStore.createIndex('year', 'year', { unique: false });
          statsStore.createIndex('level', 'level', { unique: false });
        }

        // Create minor league metadata store
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          const metadataStore = db.createObjectStore(METADATA_STORE, { keyPath: 'key' });
          metadataStore.createIndex('year', 'year', { unique: false });
          metadataStore.createIndex('level', 'level', { unique: false });
          metadataStore.createIndex('source', 'source', { unique: false });
          metadataStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          console.log(`✅ Created metadata store for API/CSV source tracking`);
        }

        // Create player-indexed minor league stats store (v3)
        if (!db.objectStoreNames.contains(PLAYER_STATS_STORE)) {
          const playerStatsStore = db.createObjectStore(PLAYER_STATS_STORE, { keyPath: 'key' });
          playerStatsStore.createIndex('playerId', 'playerId', { unique: false });
          playerStatsStore.createIndex('year', 'year', { unique: false });
          playerStatsStore.createIndex('level', 'level', { unique: false });
          console.log(`✅ Created player-indexed stats store for fast single-player lookups`);
        }

        // Create MLB player pitching stats cache (v4)
        if (!db.objectStoreNames.contains(MLB_PLAYER_STATS_STORE)) {
          const mlbPlayerStatsStore = db.createObjectStore(MLB_PLAYER_STATS_STORE, { keyPath: 'key' });
          mlbPlayerStatsStore.createIndex('playerId', 'playerId', { unique: false });
          mlbPlayerStatsStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          console.log(`✅ Created MLB player pitching stats cache for StatsService`);
        }

        // Create MLB league stats store (v5) - replaces localStorage for TrueRatingsService
        if (!db.objectStoreNames.contains(MLB_LEAGUE_STATS_STORE)) {
          const mlbLeagueStatsStore = db.createObjectStore(MLB_LEAGUE_STATS_STORE, { keyPath: 'key' });
          mlbLeagueStatsStore.createIndex('type', 'type', { unique: false });
          mlbLeagueStatsStore.createIndex('year', 'year', { unique: false });
          mlbLeagueStatsStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          console.log(`✅ Created MLB league stats store (replaces localStorage)`);
        }

        // Create players cache store (v6) - replaces localStorage for PlayerService
        if (!db.objectStoreNames.contains(PLAYERS_STORE)) {
          const playersStore = db.createObjectStore(PLAYERS_STORE, { keyPath: 'key' });
          playersStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          console.log(`✅ Created players cache store (replaces localStorage)`);
        }

        // Create teams cache store (v6) - replaces localStorage for TeamService
        if (!db.objectStoreNames.contains(TEAMS_STORE)) {
          const teamsStore = db.createObjectStore(TEAMS_STORE, { keyPath: 'key' });
          teamsStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          console.log(`✅ Created teams cache store (replaces localStorage)`);
        }

        // Create development snapshots store (v7) - for tracking player development over time
        if (!db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
          const devSnapshotsStore = db.createObjectStore(DEVELOPMENT_SNAPSHOTS_STORE, { keyPath: 'key' });
          devSnapshotsStore.createIndex('playerId', 'playerId', { unique: false });
          devSnapshotsStore.createIndex('date', 'date', { unique: false });
          devSnapshotsStore.createIndex('playerId_date', ['playerId', 'date'], { unique: false });
          console.log(`✅ Created development snapshots store for player tracking`);
        }

        // Create minor league batting stats store (v8)
        if (!db.objectStoreNames.contains(BATTING_STATS_STORE)) {
          const battingStatsStore = db.createObjectStore(BATTING_STATS_STORE, { keyPath: 'key' });
          battingStatsStore.createIndex('year', 'year', { unique: false });
          battingStatsStore.createIndex('level', 'level', { unique: false });
          console.log(`✅ Created minor league batting stats store`);
        }

        // Create player-indexed minor league batting stats store (v8)
        if (!db.objectStoreNames.contains(PLAYER_BATTING_STATS_STORE)) {
          const playerBattingStatsStore = db.createObjectStore(PLAYER_BATTING_STATS_STORE, { keyPath: 'key' });
          playerBattingStatsStore.createIndex('playerId', 'playerId', { unique: false });
          playerBattingStatsStore.createIndex('year', 'year', { unique: false });
          playerBattingStatsStore.createIndex('level', 'level', { unique: false });
          console.log(`✅ Created player-indexed batting stats store`);
        }

        // Create MLB player batting stats cache (v8)
        if (!db.objectStoreNames.contains(MLB_PLAYER_BATTING_STATS_STORE)) {
          const mlbBattingStatsStore = db.createObjectStore(MLB_PLAYER_BATTING_STATS_STORE, { keyPath: 'key' });
          mlbBattingStatsStore.createIndex('playerId', 'playerId', { unique: false });
          mlbBattingStatsStore.createIndex('fetchedAt', 'fetchedAt', { unique: false });
          console.log(`✅ Created MLB player batting stats cache`);
        }

        // Create hitter scouting ratings store (v8) - for future hitter scouting data
        if (!db.objectStoreNames.contains(HITTER_SCOUTING_STORE)) {
          const hitterScoutingStore = db.createObjectStore(HITTER_SCOUTING_STORE, { keyPath: 'key' });
          hitterScoutingStore.createIndex('date', 'date', { unique: false });
          hitterScoutingStore.createIndex('source', 'source', { unique: false });
          console.log(`✅ Created hitter scouting ratings store`);
        }

        // Create AI scouting blurbs store (v9)
        if (!db.objectStoreNames.contains(AI_SCOUTING_BLURB_STORE)) {
          const aiBlurbStore = db.createObjectStore(AI_SCOUTING_BLURB_STORE, { keyPath: 'key' });
          aiBlurbStore.createIndex('playerId', 'playerId', { unique: false });
          console.log(`✅ Created AI scouting blurbs cache store`);
        }

        // Create team planning overrides store (v10)
        if (!db.objectStoreNames.contains(TEAM_PLANNING_OVERRIDES_STORE)) {
          const overridesStore = db.createObjectStore(TEAM_PLANNING_OVERRIDES_STORE, { keyPath: 'key' });
          overridesStore.createIndex('teamId', 'teamId', { unique: false });
          console.log(`✅ Created team planning overrides store`);
        }

        // Create player development overrides store (v11)
        if (!db.objectStoreNames.contains(PLAYER_DEV_OVERRIDES_STORE)) {
          db.createObjectStore(PLAYER_DEV_OVERRIDES_STORE, { keyPath: 'key' });
          console.log(`✅ Created player development overrides store`);
        }

        console.log(`✅ IndexedDB upgrade complete (now v${newVersion})`);
      };
    });

    return this.initPromise;
  }

  // Scouting methods
  async saveScoutingRatings(date: string, source: string, data: any[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const key = `${date}_${source}`;
    const record: ScoutingRecord = { key, date, source, data };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SCOUTING_STORE], 'readwrite');
      const store = transaction.objectStore(SCOUTING_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getScoutingRatings(date: string, source: string): Promise<any[] | null> {
    await this.init();
    if (!this.db) return null;

    const key = `${date}_${source}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SCOUTING_STORE], 'readonly');
      const store = transaction.objectStore(SCOUTING_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as ScoutingRecord | undefined;
        resolve(record?.data || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllScoutingKeys(source: string): Promise<{ date: string; key: string }[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SCOUTING_STORE], 'readonly');
      const store = transaction.objectStore(SCOUTING_STORE);
      const index = store.index('source');
      const request = index.getAll(source);

      request.onsuccess = () => {
        const records = request.result as ScoutingRecord[];
        resolve(records.map(r => ({ date: r.date, key: r.key })));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteScoutingRatings(key: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SCOUTING_STORE], 'readwrite');
      const store = transaction.objectStore(SCOUTING_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Hitter scouting ratings methods
  async saveHitterScoutingRatings(date: string, source: string, data: any[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const key = `${date}_${source}`;
    const record: ScoutingRecord = { key, date, source, data };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([HITTER_SCOUTING_STORE], 'readwrite');
      const store = transaction.objectStore(HITTER_SCOUTING_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getHitterScoutingRatings(date: string, source: string): Promise<any[] | null> {
    await this.init();
    if (!this.db) return null;

    const key = `${date}_${source}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([HITTER_SCOUTING_STORE], 'readonly');
      const store = transaction.objectStore(HITTER_SCOUTING_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as ScoutingRecord | undefined;
        resolve(record?.data || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllHitterScoutingKeys(source: string): Promise<{ date: string; key: string }[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([HITTER_SCOUTING_STORE], 'readonly');
      const store = transaction.objectStore(HITTER_SCOUTING_STORE);
      const index = store.index('source');
      const request = index.getAll(source);

      request.onsuccess = () => {
        const records = request.result as ScoutingRecord[];
        resolve(records.map(r => ({ date: r.date, key: r.key })));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteHitterScoutingRatings(key: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([HITTER_SCOUTING_STORE], 'readwrite');
      const store = transaction.objectStore(HITTER_SCOUTING_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Minor league stats methods
  async saveStats(year: number, level: string, data: any[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const key = `${year}_${level}`;
    const record: StatsRecord = { key, year, level, data };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STATS_STORE], 'readwrite');
      const store = transaction.objectStore(STATS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getStats(year: number, level: string): Promise<any[] | null> {
    await this.init();
    if (!this.db) return null;

    const key = `${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STATS_STORE], 'readonly');
      const store = transaction.objectStore(STATS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as StatsRecord | undefined;
        resolve(record?.data || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteStats(year: number, level: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    const key = `${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STATS_STORE], 'readwrite');
      const store = transaction.objectStore(STATS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Minor league metadata methods
  async saveStatsMetadata(
    year: number,
    level: string,
    source: 'api' | 'csv',
    recordCount: number,
    gameDate?: string,
    keyPrefix?: string
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Check if metadata store exists (graceful degradation for v1 databases)
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      console.warn(`⚠️ Cannot save metadata - IndexedDB is v${this.db.version} but needs v${DB_VERSION}. CLOSE ALL BROWSER TABS and reopen to upgrade. Data will not be cached until upgrade completes.`);
      return;
    }

    const key = keyPrefix ? `${keyPrefix}_${year}_${level}` : `${year}_${level}`;
    const record: StatsMetadataRecord = {
      key,
      year,
      level,
      source,
      fetchedAt: Date.now(),
      recordCount,
      gameDate
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([METADATA_STORE], 'readwrite');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getStatsMetadata(year: number, level: string, keyPrefix?: string): Promise<StatsMetadataRecord | null> {
    await this.init();
    if (!this.db) return null;

    // Check if metadata store exists (graceful degradation for v1 databases)
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      return null;
    }

    const key = keyPrefix ? `${keyPrefix}_${year}_${level}` : `${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([METADATA_STORE], 'readonly');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllStatsMetadata(): Promise<StatsMetadataRecord[]> {
    await this.init();
    if (!this.db) return [];

    // Check if metadata store exists (graceful degradation for v1 databases)
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([METADATA_STORE], 'readonly');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteStatsMetadata(year: number, level: string, keyPrefix?: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    // Check if metadata store exists (graceful degradation for v1 databases)
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      return;
    }

    const key = keyPrefix ? `${keyPrefix}_${year}_${level}` : `${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([METADATA_STORE], 'readwrite');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Player-indexed stats methods (v3)
  async savePlayerStats(playerId: number, year: number, level: string, data: any): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Check if player stats store exists (graceful degradation for v2 databases)
    if (!this.db.objectStoreNames.contains(PLAYER_STATS_STORE)) {
      console.warn(`⚠️ Cannot save player stats - IndexedDB is v${this.db.version} but needs v3. Close ALL browser tabs and reopen to upgrade.`);
      return;
    }

    const key = `${playerId}_${year}_${level}`;
    const record: PlayerStatsRecord = { key, playerId, year, level, data };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYER_STATS_STORE);
      const request = store.put(record);

      request.onsuccess = () => {
        // Only log occasionally to avoid spam (every 100th save)
        if (Math.random() < 0.01) {
          console.log(`💾 Saved player-indexed record: ${key}`);
        }
        resolve();
      };
      request.onerror = () => {
        console.error(`❌ Failed to save player-indexed record ${key}:`, request.error);
        reject(request.error);
      };
    });
  }

  async getPlayerStats(playerId: number, startYear?: number, endYear?: number): Promise<PlayerStatsRecord[]> {
    await this.init();
    if (!this.db) {
      console.warn('🔍 getPlayerStats: DB not initialized');
      return [];
    }

    // Check if player stats store exists (graceful degradation for v2 databases)
    if (!this.db.objectStoreNames.contains(PLAYER_STATS_STORE)) {
      console.warn(`🔍 getPlayerStats: PLAYER_STATS_STORE does not exist (DB v${this.db.version}). Need v3. Close all tabs and reopen.`);
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_STATS_STORE], 'readonly');
      const store = transaction.objectStore(PLAYER_STATS_STORE);
      const index = store.index('playerId');
      const request = index.getAll(playerId);

      request.onsuccess = () => {
        let records = request.result as PlayerStatsRecord[];

        console.log(`🔍 getPlayerStats: Found ${records.length} total records for player ${playerId}`);

        // Filter by year range if provided
        if (startYear !== undefined && endYear !== undefined) {
          records = records.filter(r => r.year >= startYear && r.year <= endYear);
          console.log(`🔍 getPlayerStats: After filtering to ${startYear}-${endYear}: ${records.length} records`);
        }

        resolve(records);
      };
      request.onerror = () => {
        console.error(`🔍 getPlayerStats: Error querying player ${playerId}:`, request.error);
        reject(request.error);
      };
    });
  }

  async deletePlayerStats(playerId: number, year: number, level: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    // Check if player stats store exists (graceful degradation for v2 databases)
    if (!this.db.objectStoreNames.contains(PLAYER_STATS_STORE)) {
      return;
    }

    const key = `${playerId}_${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYER_STATS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteAllPlayerStatsForYearLevel(year: number, level: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    // Check if player stats store exists (graceful degradation for v2 databases)
    if (!this.db.objectStoreNames.contains(PLAYER_STATS_STORE)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYER_STATS_STORE);
      const yearIndex = store.index('year');
      const request = yearIndex.openCursor(IDBKeyRange.only(year));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          const record = cursor.value as PlayerStatsRecord;
          if (record.level === level) {
            cursor.delete();
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  async hasMinorLeagueData(): Promise<boolean> {
    await this.init();
    if (!this.db) return false;

    // Check if we have any minor league stats cached
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([METADATA_STORE], 'readonly');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result > 0);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Migration helper: get all data for migration
  async getAllScoutingData(): Promise<ScoutingRecord[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([SCOUTING_STORE], 'readonly');
      const store = transaction.objectStore(SCOUTING_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllStatsData(): Promise<StatsRecord[]> {
    await this.init();
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STATS_STORE], 'readonly');
      const store = transaction.objectStore(STATS_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // MLB Player Pitching Stats methods
  async saveMlbPlayerPitchingStats(playerId: number, data: any[], year?: number, gameDate?: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const key = year ? `${playerId}_${year}` : `${playerId}`;
    const record: MlbPlayerPitchingStatsRecord = {
      key,
      playerId,
      year,
      data,
      fetchedAt: Date.now(),
      gameDate
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_PLAYER_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(MLB_PLAYER_STATS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMlbPlayerPitchingStats(playerId: number, year?: number): Promise<{ data: any[]; fetchedAt: number; gameDate?: string } | null> {
    await this.init();
    if (!this.db) return null;

    const key = year ? `${playerId}_${year}` : `${playerId}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_PLAYER_STATS_STORE], 'readonly');
      const store = transaction.objectStore(MLB_PLAYER_STATS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as MlbPlayerPitchingStatsRecord | undefined;
        if (record) {
          resolve({ data: record.data, fetchedAt: record.fetchedAt, gameDate: record.gameDate });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMlbPlayerPitchingStats(playerId: number, year?: number): Promise<void> {
    await this.init();
    if (!this.db) return;

    const key = year ? `${playerId}_${year}` : `${playerId}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_PLAYER_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(MLB_PLAYER_STATS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // MLB League Stats methods (replaces localStorage for TrueRatingsService)
  async saveMlbLeagueStats(year: number, type: 'pitching' | 'batting', data: any[], isPermanent: boolean = false, gameDate?: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const key = `${type}_${year}`;
    const record: MlbLeagueStatsRecord = {
      key,
      type,
      year,
      data,
      fetchedAt: isPermanent ? 0 : Date.now(),
      gameDate
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_LEAGUE_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(MLB_LEAGUE_STATS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMlbLeagueStats(year: number, type: 'pitching' | 'batting'): Promise<{ data: any[]; fetchedAt: number; gameDate?: string } | null> {
    await this.init();
    if (!this.db) return null;

    const key = `${type}_${year}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_LEAGUE_STATS_STORE], 'readonly');
      const store = transaction.objectStore(MLB_LEAGUE_STATS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as MlbLeagueStatsRecord | undefined;
        if (record) {
          resolve({ data: record.data, fetchedAt: record.fetchedAt, gameDate: record.gameDate });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMlbLeagueStats(year: number, type: 'pitching' | 'batting'): Promise<void> {
    await this.init();
    if (!this.db) return;

    const key = `${type}_${year}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_LEAGUE_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(MLB_LEAGUE_STATS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Players cache methods (replaces localStorage for PlayerService)
  async savePlayers(data: any[], gameDate?: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const record: PlayersRecord = {
      key: 'current',
      data,
      fetchedAt: Date.now(),
      gameDate
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYERS_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYERS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPlayers(): Promise<{ data: any[]; fetchedAt: number; gameDate?: string } | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYERS_STORE], 'readonly');
      const store = transaction.objectStore(PLAYERS_STORE);
      const request = store.get('current');

      request.onsuccess = () => {
        const record = request.result as PlayersRecord | undefined;
        if (record) {
          resolve({ data: record.data, fetchedAt: record.fetchedAt, gameDate: record.gameDate });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Teams cache methods (replaces localStorage for TeamService)
  async saveTeams(data: any[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    const record: TeamsRecord = {
      key: 'current',
      data,
      fetchedAt: Date.now()
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([TEAMS_STORE], 'readwrite');
      const store = transaction.objectStore(TEAMS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getTeams(): Promise<{ data: any[]; fetchedAt: number } | null> {
    await this.init();
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([TEAMS_STORE], 'readonly');
      const store = transaction.objectStore(TEAMS_STORE);
      const request = store.get('current');

      request.onsuccess = () => {
        const record = request.result as TeamsRecord | undefined;
        if (record) {
          resolve({ data: record.data, fetchedAt: record.fetchedAt });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // Development Snapshots methods (v7)
  async saveDevelopmentSnapshot(snapshot: DevelopmentSnapshotRecord): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
      console.warn(`⚠️ Cannot save development snapshot - IndexedDB needs upgrade to v7. Close ALL browser tabs and reopen.`);
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DEVELOPMENT_SNAPSHOTS_STORE], 'readwrite');
      const store = transaction.objectStore(DEVELOPMENT_SNAPSHOTS_STORE);
      const request = store.put(snapshot);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveDevelopmentSnapshots(snapshots: DevelopmentSnapshotRecord[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
      console.warn(`⚠️ Cannot save development snapshots - IndexedDB needs upgrade to v7. Close ALL browser tabs and reopen.`);
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DEVELOPMENT_SNAPSHOTS_STORE], 'readwrite');
      const store = transaction.objectStore(DEVELOPMENT_SNAPSHOTS_STORE);

      let completed = 0;
      const total = snapshots.length;

      if (total === 0) {
        resolve();
        return;
      }

      for (const snapshot of snapshots) {
        const request = store.put(snapshot);
        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      }
    });
  }

  async getPlayerDevelopmentSnapshots(playerId: number): Promise<DevelopmentSnapshotRecord[]> {
    await this.init();
    if (!this.db) return [];

    if (!this.db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DEVELOPMENT_SNAPSHOTS_STORE], 'readonly');
      const store = transaction.objectStore(DEVELOPMENT_SNAPSHOTS_STORE);
      const index = store.index('playerId');
      const request = index.getAll(playerId);

      request.onsuccess = () => {
        const records = request.result as DevelopmentSnapshotRecord[];
        // Sort by date ascending (oldest first)
        records.sort((a, b) => a.date.localeCompare(b.date));
        resolve(records);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllDevelopmentSnapshots(): Promise<DevelopmentSnapshotRecord[]> {
    await this.init();
    if (!this.db) return [];

    if (!this.db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DEVELOPMENT_SNAPSHOTS_STORE], 'readonly');
      const store = transaction.objectStore(DEVELOPMENT_SNAPSHOTS_STORE);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteDevelopmentSnapshot(key: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DEVELOPMENT_SNAPSHOTS_STORE], 'readwrite');
      const store = transaction.objectStore(DEVELOPMENT_SNAPSHOTS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getDevelopmentSnapshotsByDate(date: string): Promise<DevelopmentSnapshotRecord[]> {
    await this.init();
    if (!this.db) return [];

    if (!this.db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DEVELOPMENT_SNAPSHOTS_STORE], 'readonly');
      const store = transaction.objectStore(DEVELOPMENT_SNAPSHOTS_STORE);
      const index = store.index('date');
      const request = index.getAll(date);

      request.onsuccess = () => {
        resolve(request.result as DevelopmentSnapshotRecord[]);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteAllDevelopmentSnapshots(): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(DEVELOPMENT_SNAPSHOTS_STORE)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([DEVELOPMENT_SNAPSHOTS_STORE], 'readwrite');
      const store = transaction.objectStore(DEVELOPMENT_SNAPSHOTS_STORE);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Minor league batting stats methods (v8)
  async saveBattingStats(year: number, level: string, data: any[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(BATTING_STATS_STORE)) {
      console.warn(`⚠️ Cannot save batting stats - IndexedDB needs upgrade to v8. Close ALL browser tabs and reopen.`);
      return;
    }

    const key = `${year}_${level}`;
    const record: BattingStatsRecord = { key, year, level, data };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([BATTING_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(BATTING_STATS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getBattingStats(year: number, level: string): Promise<any[] | null> {
    await this.init();
    if (!this.db) return null;

    if (!this.db.objectStoreNames.contains(BATTING_STATS_STORE)) {
      return null;
    }

    const key = `${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([BATTING_STATS_STORE], 'readonly');
      const store = transaction.objectStore(BATTING_STATS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as BattingStatsRecord | undefined;
        resolve(record?.data || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteBattingStats(year: number, level: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(BATTING_STATS_STORE)) {
      return;
    }

    const key = `${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([BATTING_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(BATTING_STATS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Player-indexed batting stats methods (v8)
  async savePlayerBattingStats(playerId: number, year: number, level: string, data: any): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(PLAYER_BATTING_STATS_STORE)) {
      console.warn(`⚠️ Cannot save player batting stats - IndexedDB needs upgrade to v8. Close ALL browser tabs and reopen.`);
      return;
    }

    const key = `${playerId}_${year}_${level}`;
    const record: PlayerBattingStatsRecord = { key, playerId, year, level, data };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_BATTING_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYER_BATTING_STATS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPlayerBattingStats(playerId: number, startYear?: number, endYear?: number): Promise<PlayerBattingStatsRecord[]> {
    await this.init();
    if (!this.db) return [];

    if (!this.db.objectStoreNames.contains(PLAYER_BATTING_STATS_STORE)) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_BATTING_STATS_STORE], 'readonly');
      const store = transaction.objectStore(PLAYER_BATTING_STATS_STORE);
      const index = store.index('playerId');
      const request = index.getAll(playerId);

      request.onsuccess = () => {
        let records = request.result as PlayerBattingStatsRecord[];

        // Filter by year range if provided
        if (startYear !== undefined && endYear !== undefined) {
          records = records.filter(r => r.year >= startYear && r.year <= endYear);
        }

        resolve(records);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deletePlayerBattingStats(playerId: number, year: number, level: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(PLAYER_BATTING_STATS_STORE)) {
      return;
    }

    const key = `${playerId}_${year}_${level}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_BATTING_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYER_BATTING_STATS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // MLB Player Batting Stats methods (v8)
  async saveMlbPlayerBattingStats(playerId: number, data: any[], year?: number, gameDate?: string): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(MLB_PLAYER_BATTING_STATS_STORE)) {
      console.warn(`⚠️ Cannot save MLB batting stats - IndexedDB needs upgrade to v8. Close ALL browser tabs and reopen.`);
      return;
    }

    const key = year ? `${playerId}_${year}` : `${playerId}`;
    const record: MlbPlayerBattingStatsRecord = {
      key,
      playerId,
      year,
      data,
      fetchedAt: Date.now(),
      gameDate
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_PLAYER_BATTING_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(MLB_PLAYER_BATTING_STATS_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getMlbPlayerBattingStats(playerId: number, year?: number): Promise<{ data: any[]; fetchedAt: number; gameDate?: string } | null> {
    await this.init();
    if (!this.db) return null;

    if (!this.db.objectStoreNames.contains(MLB_PLAYER_BATTING_STATS_STORE)) {
      return null;
    }

    const key = year ? `${playerId}_${year}` : `${playerId}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_PLAYER_BATTING_STATS_STORE], 'readonly');
      const store = transaction.objectStore(MLB_PLAYER_BATTING_STATS_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as MlbPlayerBattingStatsRecord | undefined;
        if (record) {
          resolve({ data: record.data, fetchedAt: record.fetchedAt, gameDate: record.gameDate });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteMlbPlayerBattingStats(playerId: number, year?: number): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(MLB_PLAYER_BATTING_STATS_STORE)) {
      return;
    }

    const key = year ? `${playerId}_${year}` : `${playerId}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([MLB_PLAYER_BATTING_STATS_STORE], 'readwrite');
      const store = transaction.objectStore(MLB_PLAYER_BATTING_STATS_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Check if we have batting data
  // AI Scouting Blurb methods (v9)
  async saveAIBlurb(record: AIScoutingBlurbRecord): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(AI_SCOUTING_BLURB_STORE)) {
      console.warn(`⚠️ Cannot save AI blurb - IndexedDB needs upgrade to v9. Close ALL browser tabs and reopen.`);
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([AI_SCOUTING_BLURB_STORE], 'readwrite');
      const store = transaction.objectStore(AI_SCOUTING_BLURB_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAIBlurb(playerId: number, playerType: 'pitcher' | 'hitter'): Promise<AIScoutingBlurbRecord | null> {
    await this.init();
    if (!this.db) return null;

    if (!this.db.objectStoreNames.contains(AI_SCOUTING_BLURB_STORE)) {
      return null;
    }

    const key = `${playerId}_${playerType}`;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([AI_SCOUTING_BLURB_STORE], 'readonly');
      const store = transaction.objectStore(AI_SCOUTING_BLURB_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        resolve(request.result as AIScoutingBlurbRecord | null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async hasMinorLeagueBattingData(): Promise<boolean> {
    await this.init();
    if (!this.db) return false;

    if (!this.db.objectStoreNames.contains(BATTING_STATS_STORE)) {
      return false;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([BATTING_STATS_STORE], 'readonly');
      const store = transaction.objectStore(BATTING_STATS_STORE);
      const request = store.count();

      request.onsuccess = () => {
        resolve(request.result > 0);
      };
      request.onerror = () => reject(request.error);
    });
  }
  // Team Planning Override methods (v10)
  async saveTeamPlanningOverride(record: TeamPlanningOverrideRecord): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(TEAM_PLANNING_OVERRIDES_STORE)) {
      console.warn(`⚠️ Cannot save planning override - IndexedDB needs upgrade to v10. Close ALL browser tabs and reopen.`);
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([TEAM_PLANNING_OVERRIDES_STORE], 'readwrite');
      const store = transaction.objectStore(TEAM_PLANNING_OVERRIDES_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveTeamPlanningOverrides(records: TeamPlanningOverrideRecord[]): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(TEAM_PLANNING_OVERRIDES_STORE)) {
      console.warn(`⚠️ Cannot save planning overrides - IndexedDB needs upgrade to v10. Close ALL browser tabs and reopen.`);
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([TEAM_PLANNING_OVERRIDES_STORE], 'readwrite');
      const store = transaction.objectStore(TEAM_PLANNING_OVERRIDES_STORE);

      let completed = 0;
      const total = records.length;

      if (total === 0) {
        resolve();
        return;
      }

      for (const record of records) {
        const request = store.put(record);
        request.onsuccess = () => {
          completed++;
          if (completed === total) resolve();
        };
        request.onerror = () => reject(request.error);
      }
    });
  }

  async getTeamPlanningOverrides(teamId: number): Promise<TeamPlanningOverrideRecord[]> {
    await this.init();
    if (!this.db) return [];

    if (!this.db.objectStoreNames.contains(TEAM_PLANNING_OVERRIDES_STORE)) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([TEAM_PLANNING_OVERRIDES_STORE], 'readonly');
      const store = transaction.objectStore(TEAM_PLANNING_OVERRIDES_STORE);
      const index = store.index('teamId');
      const request = index.getAll(teamId);

      request.onsuccess = () => {
        resolve(request.result as TeamPlanningOverrideRecord[]);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteTeamPlanningOverride(key: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(TEAM_PLANNING_OVERRIDES_STORE)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([TEAM_PLANNING_OVERRIDES_STORE], 'readwrite');
      const store = transaction.objectStore(TEAM_PLANNING_OVERRIDES_STORE);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteAllTeamPlanningOverrides(teamId: number): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(TEAM_PLANNING_OVERRIDES_STORE)) {
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([TEAM_PLANNING_OVERRIDES_STORE], 'readwrite');
      const store = transaction.objectStore(TEAM_PLANNING_OVERRIDES_STORE);
      const index = store.index('teamId');
      const request = index.openCursor(IDBKeyRange.only(teamId));

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
  // Player development override methods (v11)

  async savePlayerDevOverride(playerId: number, effectiveFromYear: number): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    if (!this.db.objectStoreNames.contains(PLAYER_DEV_OVERRIDES_STORE)) {
      console.warn(`⚠️ Cannot save dev override - IndexedDB needs upgrade to v11. Close ALL browser tabs and reopen.`);
      return;
    }

    const record: PlayerDevOverrideRecord = { key: String(playerId), playerId, effectiveFromYear };
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_DEV_OVERRIDES_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYER_DEV_OVERRIDES_STORE);
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deletePlayerDevOverride(playerId: number): Promise<void> {
    await this.init();
    if (!this.db) return;

    if (!this.db.objectStoreNames.contains(PLAYER_DEV_OVERRIDES_STORE)) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_DEV_OVERRIDES_STORE], 'readwrite');
      const store = transaction.objectStore(PLAYER_DEV_OVERRIDES_STORE);
      const request = store.delete(String(playerId));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPlayerDevOverrides(): Promise<Array<{ playerId: number; effectiveFromYear: number }>> {
    await this.init();
    if (!this.db) return [];

    if (!this.db.objectStoreNames.contains(PLAYER_DEV_OVERRIDES_STORE)) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PLAYER_DEV_OVERRIDES_STORE], 'readonly');
      const store = transaction.objectStore(PLAYER_DEV_OVERRIDES_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result as PlayerDevOverrideRecord[];
        // effectiveFromYear may be absent on records saved before this field was added;
        // default to 2000 so old overrides continue to apply to all years.
        resolve(records.map(r => ({ playerId: r.playerId, effectiveFromYear: r.effectiveFromYear ?? 2000 })));
      };
      request.onerror = () => reject(request.error);
    });
  }
}

export const indexedDBService = new IndexedDBService();
