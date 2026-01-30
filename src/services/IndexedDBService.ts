/**
 * IndexedDB wrapper for storing large amounts of data
 * Replaces localStorage for scouting and minor league stats
 */

const DB_NAME = 'wbl_database';
const DB_VERSION = 3;
const SCOUTING_STORE = 'scouting_ratings';
const STATS_STORE = 'minor_league_stats';
const METADATA_STORE = 'minor_league_metadata';
const PLAYER_STATS_STORE = 'player_minor_league_stats'; // New: indexed by playerId for fast lookups

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
  key: string; // Format: "year_level"
  year: number;
  level: string;
  source: 'api' | 'csv';
  fetchedAt: number; // timestamp
  recordCount: number;
}

export interface PlayerStatsRecord {
  key: string; // Format: "playerId_year_level"
  playerId: number;
  year: number;
  level: string;
  data: any; // Single player's stats
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
        console.log(`✅ IndexedDB initialized (v${this.db.version})`);

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
    recordCount: number
  ): Promise<void> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');

    // Check if metadata store exists (graceful degradation for v1 databases)
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      console.warn(`⚠️ Cannot save metadata - IndexedDB is v${this.db.version} but needs v${DB_VERSION}. CLOSE ALL BROWSER TABS and reopen to upgrade. Data will not be cached until upgrade completes.`);
      return;
    }

    const key = `${year}_${level}`;
    const record: StatsMetadataRecord = {
      key,
      year,
      level,
      source,
      fetchedAt: Date.now(),
      recordCount
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([METADATA_STORE], 'readwrite');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.put(record);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getStatsMetadata(year: number, level: string): Promise<StatsMetadataRecord | null> {
    await this.init();
    if (!this.db) return null;

    // Check if metadata store exists (graceful degradation for v1 databases)
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      return null;
    }

    const key = `${year}_${level}`;

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

  async deleteStatsMetadata(year: number, level: string): Promise<void> {
    await this.init();
    if (!this.db) return;

    // Check if metadata store exists (graceful degradation for v1 databases)
    if (!this.db.objectStoreNames.contains(METADATA_STORE)) {
      return;
    }

    const key = `${year}_${level}`;

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
}

export const indexedDBService = new IndexedDBService();
