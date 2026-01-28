import { PitcherScoutingRatings } from '../models/ScoutingData';
import { indexedDBService } from './IndexedDBService';

type ScoutingHeaderKey = 'playerId' | 'playerName' | 'stuff' | 'control' | 'hra' | 'age' | 'ovr' | 'pot' | 'stamina' | 'injuryProneness';

const STORAGE_KEY_PREFIX = 'wbl_scouting_ratings_';
const USE_INDEXEDDB = true; // Feature flag to switch between localStorage and IndexedDB

const HEADER_ALIASES: Record<ScoutingHeaderKey, string[]> = {
  playerId: ['playerid', 'player_id', 'id', 'pid'],
  playerName: ['playername', 'player_name', 'name', 'player'],
  stuff: ['stuff', 'stu', 'stf', 'stup', 'stfp', 'stuffp'],
  control: ['control', 'con', 'ctl', 'conp', 'controlp'],
  hra: ['hra', 'hr', 'hrr', 'hravoid', 'hravoidance', 'hrrp', 'hrp'],
  age: ['age'],
  ovr: ['ovr', 'overall', 'cur', 'current'],
  pot: ['pot', 'potential', 'ceil', 'ceiling'],
  stamina: ['stm', 'stamina', 'stam'],
  injuryProneness: ['prone', 'injury', 'injuryproneness', 'inj']
};

export type ScoutingSource = 'my' | 'osa';

class ScoutingDataService {
  parseScoutingCsv(csvText: string, source: ScoutingSource = 'my'): PitcherScoutingRatings[] {
    const lines = csvText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      return [];
    }

    const headerCells = this.parseCsvLine(lines[0]);
    const { indexMap, pitchIndexMap, hasHeader } = this.buildHeaderMap(headerCells);
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const results: PitcherScoutingRatings[] = [];

    for (const line of dataLines) {
      const cells = this.parseCsvLine(line);
      if (cells.length === 0) continue;

      if (hasHeader) {
        const stuff = this.getNumberFromIndex(cells, indexMap.stuff);
        const control = this.getNumberFromIndex(cells, indexMap.control);
        const hra = this.getNumberFromIndex(cells, indexMap.hra);

        if (!this.isNumber(stuff) || !this.isNumber(control) || !this.isNumber(hra)) {
          continue;
        }

        const rawId = this.getNumberFromIndex(cells, indexMap.playerId);
        const playerId = this.isNumber(rawId) ? Math.round(rawId) : -1;
        const playerName = this.getStringFromIndex(cells, indexMap.playerName);
        const age = this.getNumberFromIndex(cells, indexMap.age);
        
        // Parse Stamina and Injury Proneness
        const stamina = this.getNumberFromIndex(cells, indexMap.stamina);
        const injuryProneness = this.getStringFromIndex(cells, indexMap.injuryProneness);

        // Parse star ratings (OVR/POT) - handles "X.X Stars" format
        const ovr = this.parseStarRating(cells, indexMap.ovr);
        const pot = this.parseStarRating(cells, indexMap.pot);

        // Parse pitches
        const pitches: Record<string, number> = {};
        for (const [pitchName, idx] of Object.entries(pitchIndexMap)) {
            const val = this.getNumberFromIndex(cells, idx);
            if (this.isNumber(val) && val > 0) {
                pitches[pitchName] = val;
            }
        }

        results.push({
          playerId,
          playerName: playerName || undefined,
          stuff,
          control,
          hra,
          stamina: this.isNumber(stamina) ? stamina : undefined,
          injuryProneness: injuryProneness || undefined,
          age: this.isNumber(age) ? Math.round(age) : undefined,
          ovr: this.isNumber(ovr) ? ovr : undefined,
          pot: this.isNumber(pot) ? pot : undefined,
          pitches: Object.keys(pitches).length > 0 ? pitches : undefined,
          source,
        });
      } else {
        const firstCell = this.cleanCell(cells[0] ?? '');
        const firstNumber = this.parseNumber(firstCell);
        let playerId = -1;
        let playerName: string | undefined;
        let startIndex = 1;

        if (firstNumber !== null) {
          playerId = Math.round(firstNumber);
          const maybeName = this.cleanCell(cells[1] ?? '');
          if (maybeName && this.parseNumber(maybeName) === null) {
            playerName = maybeName;
            startIndex = 2;
          }
        } else if (firstCell) {
          playerName = firstCell;
        }

        const numericValues = cells
          .slice(startIndex)
          .map((cell) => this.parseNumber(cell))
          .filter((value): value is number => value !== null);

        if (numericValues.length < 3) {
          continue;
        }

        const [stuff, control, hra] = numericValues;

        results.push({
          playerId,
          playerName,
          stuff,
          control,
          hra,
          source,
        });
      }
    }

    return results;
  }

  async saveScoutingRatings(date: string, ratings: PitcherScoutingRatings[], source: ScoutingSource = 'my'): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      if (USE_INDEXEDDB) {
        await indexedDBService.saveScoutingRatings(date, source, ratings);
      } else {
        const key = this.storageKey(date, source);
        localStorage.setItem(key, JSON.stringify(ratings));
      }
    } catch (e) {
      console.error('Failed to save scouting ratings', e);
      throw e; // Re-throw so UI can handle quota errors
    }
  }

  async getLatestScoutingRatings(source: ScoutingSource = 'my'): Promise<PitcherScoutingRatings[]> {
    if (typeof window === 'undefined') return [];

    const allKeys = await this.getAllKeys(source);
    if (allKeys.length === 0) return [];

    // Sort by date descending
    allKeys.sort((a, b) => b.date.localeCompare(a.date));

    if (USE_INDEXEDDB) {
      try {
        const data = await indexedDBService.getScoutingRatings(allKeys[0].date, source);
        if (data) return data;
      } catch (err) {
        console.error('Error fetching from IndexedDB:', err);
      }
    }

    // Fallback to localStorage
    try {
        const raw = localStorage.getItem(allKeys[0].key);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch {
        return [];
    }
  }

  /**
   * Get the latest scouting ratings for a given year and source.
   * Scans all stored keys to find the latest date in that year.
   */
  async getScoutingRatings(year: number, source: ScoutingSource = 'my'): Promise<PitcherScoutingRatings[]> {
    if (typeof window === 'undefined') return [];

    const relevantKeys = await this.findKeysForYear(year, source);
    if (relevantKeys.length === 0) {
        // Fallback to legacy key: wbl_scouting_ratings_2021 (assumed 'my')
        if (source === 'my') {
             try {
                const legacy = localStorage.getItem(this.storageKeyLegacy(year));
                if (legacy) return JSON.parse(legacy);
             } catch {}
        }
        return [];
    }

    // Sort by date descending
    relevantKeys.sort((a, b) => b.date.localeCompare(a.date));

    // Try IndexedDB first
    if (USE_INDEXEDDB) {
        try {
            const data = await indexedDBService.getScoutingRatings(relevantKeys[0].date, source);
            if (data) return data;
        } catch (err) {
            console.error('Error fetching from IndexedDB:', err);
        }
    }

    // Fallback to localStorage
    const latestKey = relevantKeys[0].key;
    try {
        const raw = localStorage.getItem(latestKey);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch {
        return [];
    }
  }
  
  async hasScoutingRatings(year: number, source: ScoutingSource = 'my'): Promise<boolean> {
      if (typeof window === 'undefined') return false;
      const keys = await this.findKeysForYear(year, source);
      if (keys.length > 0) return true;
      if (source === 'my' && localStorage.getItem(this.storageKeyLegacy(year))) return true;
      return false;
  }

  /**
   * Returns a list of all available scouting data snapshots for a year
   */
  async getAvailableScoutingSnapshots(year: number, source: ScoutingSource = 'my'): Promise<{ date: string, key: string, count: number }[]> {
      if (typeof window === 'undefined') return [];
      const keys = await this.findKeysForYear(year, source);

      // If none, check legacy
      if (keys.length === 0 && source === 'my') {
          const legacyKey = this.storageKeyLegacy(year);
          const legacyRaw = localStorage.getItem(legacyKey);
          if (legacyRaw) {
              try {
                  const data = JSON.parse(legacyRaw);
                  return [{ date: `${year}-01-01`, key: legacyKey, count: data.length }];
              } catch {}
          }
      }

      // Add count info
      const results = await Promise.all(keys.map(async k => {
          let count = 0;

          // Try IndexedDB first
          if (USE_INDEXEDDB) {
              try {
                  const data = await indexedDBService.getScoutingRatings(k.date, source);
                  if (data) {
                      count = data.length;
                      return { date: k.date, key: `${k.date}_${source}`, count };
                  }
              } catch {}
          }

          // Fallback to localStorage
          try {
              const raw = localStorage.getItem(k.key);
              if (raw) count = JSON.parse(raw).length;
          } catch {}
          return { date: k.date, key: k.key, count };
      }));

      return results.sort((a, b) => b.date.localeCompare(a.date));
  }

  async clearScoutingRatings(dateOrKey: string): Promise<void> {
    if (typeof window === 'undefined') return;

    // Try deleting from IndexedDB if enabled
    if (USE_INDEXEDDB) {
        // IDB keys are like "2021-01-01_my"
        // If the key has the prefix, strip it
        let dbKey = dateOrKey;
        if (dateOrKey.startsWith(STORAGE_KEY_PREFIX)) {
            dbKey = dateOrKey.substring(STORAGE_KEY_PREFIX.length);
        }
        try {
            await indexedDBService.deleteScoutingRatings(dbKey);
        } catch (e) {
            console.error('Error deleting from IndexedDB', e);
        }
    }

    // Always try to delete from localStorage as well (legacy cleanup or if IDB disabled)
    // If it doesn't have the prefix, add it for localStorage
    let lsKey = dateOrKey;
    if (!dateOrKey.startsWith(STORAGE_KEY_PREFIX)) {
        lsKey = STORAGE_KEY_PREFIX + dateOrKey;
    }
    localStorage.removeItem(lsKey);
  }

  private storageKey(date: string, source: ScoutingSource): string {
    return `${STORAGE_KEY_PREFIX}${date}_${source}`;
  }
  
  private storageKeyLegacy(year: number): string {
      return `${STORAGE_KEY_PREFIX}${year}`;
  }

  private async getAllKeys(source: ScoutingSource): Promise<{ date: string, key: string }[]> {
      if (typeof window === 'undefined') return [];
      let results: { date: string, key: string }[] = [];

      // Get keys from IndexedDB if enabled
      if (USE_INDEXEDDB) {
          try {
              const idbKeys = await indexedDBService.getAllScoutingKeys(source);
              results.push(...idbKeys);
          } catch (err) {
              console.error('Error getting keys from IndexedDB:', err);
          }
      }

      // Also check localStorage for backward compatibility
      const prefix = STORAGE_KEY_PREFIX;

      for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key || !key.startsWith(prefix)) continue;

          const suffix = key.substring(prefix.length);
          const parts = suffix.split('_');
          const datePart = parts[0];
          const sourcePart = parts[1] || 'my';

          if (sourcePart !== source) {
              continue;
          }

          // Check if not already in results from IndexedDB
          if (!results.some(r => r.date === datePart)) {
              results.push({ date: datePart, key });
          }
      }
      return results;
  }

  private async findKeysForYear(year: number, source: ScoutingSource): Promise<{ date: string, key: string }[]> {
      const allKeys = await this.getAllKeys(source);
      return allKeys.filter(k => k.date.startsWith(year.toString()));
  }

  private getNumberFromIndex(cells: string[], index?: number): number | null {
    if (typeof index !== 'number') return null;
    return this.parseNumber(cells[index]);
  }

  private getStringFromIndex(cells: string[], index?: number): string {
    if (typeof index !== 'number') return '';
    return this.cleanCell(cells[index] ?? '');
  }

  /**
   * Parse star rating from cell value.
   * Handles formats like "4.5 Stars", "4.5", "4.5 stars", etc.
   */
  private parseStarRating(cells: string[], index?: number): number | null {
    if (typeof index !== 'number') return null;
    const raw = this.cleanCell(cells[index] ?? '');
    if (!raw) return null;

    // Strip "stars" suffix (case insensitive) and parse the number
    const stripped = raw.toLowerCase().replace(/\s*stars?\s*/gi, '').trim();
    const num = parseFloat(stripped);

    if (Number.isNaN(num)) return null;

    // Validate star rating range (0.5-5.0)
    if (num < 0.5 || num > 5.0) return null;

    return num;
  }

  private buildHeaderMap(headerCells: string[]): {
    indexMap: Partial<Record<ScoutingHeaderKey, number>>;
    pitchIndexMap: Record<string, number>;
    hasHeader: boolean;
  } {
    const normalized = headerCells.map((cell) => this.normalizeHeader(cell));
    const indexMap: Partial<Record<ScoutingHeaderKey, number>> = {};
    const pitchIndexMap: Record<string, number> = {};
    let matches = 0;

    // Identify standard keys
    (Object.keys(HEADER_ALIASES) as ScoutingHeaderKey[]).forEach((key) => {
      const aliases = HEADER_ALIASES[key];
      const idx = normalized.findIndex((header) => aliases.includes(header));
      if (idx !== -1) {
        indexMap[key] = idx;
        matches += 1;
      }
    });

    const hasRatingsHeader = ['stuff', 'control', 'hra'].some((key) =>
      normalized.includes(key)
    );
    const hasHeader = hasRatingsHeader || matches >= 2;

    // Identify potential pitch columns
    if (hasHeader) {
        const usedIndices = new Set(Object.values(indexMap));
        const ignoreHeaders = new Set([
            'team', 'pos', 'position', 'height', 'weight', 'bats', 'throws', 'leagues', 'levels', 'org',
            'velocity', 'arm', 'stamina', 'hold', 'gb', 'mov', 'movement', 'babip',
            'ovr', 'overall', 'cur', 'current', 'pot', 'potential', 'ceil', 'ceiling'
        ]);
        
        headerCells.forEach((rawHeader, idx) => {
            if (usedIndices.has(idx)) return;
            const norm = this.normalizeHeader(rawHeader);
            if (!norm) return;
            if (ignoreHeaders.has(norm)) return;
            
            // Heuristic: If it looks like a pitch name (not caught by ignore list)
            // We'll trust the caller to provide a clean file, but we can verify later if values are numeric
            pitchIndexMap[rawHeader.trim()] = idx; 
        });
    }

    return { indexMap, pitchIndexMap, hasHeader };
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
    return value.replace(/^\ufeff/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private parseNumber(value: string | undefined): number | null {
    if (!value) return null;
    const cleaned = String(value).trim();
    if (!cleaned) return null;
    const matches = cleaned.match(/-?\d+(?:\.\d+)?/g);
    if (!matches) return null;
    const nums = matches.map(Number).filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return null;
    const avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
    return avg;
  }

  private isNumber(value: number | null): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
}

export const scoutingDataService = new ScoutingDataService();
