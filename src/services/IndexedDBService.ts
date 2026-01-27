/**
 * IndexedDB wrapper for storing large amounts of data
 * Replaces localStorage for scouting and minor league stats
 */

const DB_NAME = 'wbl_database';
const DB_VERSION = 1;
const SCOUTING_STORE = 'scouting_ratings';
const STATS_STORE = 'minor_league_stats';

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
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

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
