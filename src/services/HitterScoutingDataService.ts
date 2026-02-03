import { HitterScoutingRatings } from '../models/ScoutingData';
import { indexedDBService } from './IndexedDBService';
import { ScoutingSource } from './ScoutingDataService';
import { developmentSnapshotService } from './DevelopmentSnapshotService';

type HitterScoutingHeaderKey = 'playerId' | 'playerName' | 'power' | 'eye' | 'avoidK' | 'babip' | 'gap' | 'speed' | 'injuryProneness' | 'age' | 'ovr' | 'pot';

const STORAGE_KEY_PREFIX = 'wbl_hitter_scouting_ratings_';
const USE_INDEXEDDB = true;

const HEADER_ALIASES: Record<HitterScoutingHeaderKey, string[]> = {
  playerId: ['playerid', 'player_id', 'id', 'pid'],
  playerName: ['playername', 'player_name', 'name', 'player'],
  power: ['power', 'pow', 'pwr', 'powerp', 'pwrp', 'powp'],
  eye: ['eye', 'eyep', 'discipline', 'disc'],
  avoidK: ['avoidk', 'avoid_k', 'avk', 'avoidks', 'avoidkp', 'avoidsks', 'kav', 'kavoid', 'kp'],
  babip: ['babip', 'babipp', 'bab', 'htp', 'ht', 'hittool'],
  gap: ['gap', 'gapp', 'gappower', 'gaps'],
  speed: ['speed', 'spd', 'spdp', 'run', 'running', 'steal', 'spe', 'spep'],
  injuryProneness: ['prone', 'injuryproneness', 'injury', 'inj', 'durability'],
  age: ['age'],
  ovr: ['ovr', 'overall', 'cur', 'current'],
  pot: ['pot', 'potential', 'ceil', 'ceiling']
};
// Note: CON P (Contact) is intentionally not mapped - it's a composite of avoidK + babip

class HitterScoutingDataService {
  parseScoutingCsv(csvText: string, source: ScoutingSource = 'my'): HitterScoutingRatings[] {
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

    const results: HitterScoutingRatings[] = [];

    for (const line of dataLines) {
      const cells = this.parseCsvLine(line);
      if (cells.length === 0) continue;

      if (hasHeader) {
        const power = this.getNumberFromIndex(cells, indexMap.power);
        const eye = this.getNumberFromIndex(cells, indexMap.eye);
        const avoidK = this.getNumberFromIndex(cells, indexMap.avoidK);
        const babip = this.getNumberFromIndex(cells, indexMap.babip);
        const gap = this.getNumberFromIndex(cells, indexMap.gap);
        const speed = this.getNumberFromIndex(cells, indexMap.speed);
        const injuryProneness = this.getStringFromIndex(cells, indexMap.injuryProneness);

        const rawId = this.getNumberFromIndex(cells, indexMap.playerId);
        const playerId = this.isNumber(rawId) ? Math.round(rawId) : -1;
        const playerName = this.getStringFromIndex(cells, indexMap.playerName);
        const age = this.getNumberFromIndex(cells, indexMap.age);

        // Parse star ratings (OVR/POT) - required fields
        const ovr = this.parseStarRating(cells, indexMap.ovr);
        const pot = this.parseStarRating(cells, indexMap.pot);

        // Require power, eye, avoidK, ovr, and pot
        if (!this.isNumber(power) || !this.isNumber(eye) || !this.isNumber(avoidK) ||
            !this.isNumber(ovr) || !this.isNumber(pot)) {
          continue;
        }

        results.push({
          playerId,
          playerName: playerName || undefined,
          power,
          eye,
          avoidK,
          babip: this.isNumber(babip) ? babip : 50, // Default to 50 if not provided
          gap: this.isNumber(gap) ? gap : 50,
          speed: this.isNumber(speed) ? speed : 50,
          injuryProneness: injuryProneness || undefined,
          age: this.isNumber(age) ? Math.round(age) : undefined,
          ovr,
          pot,
          source,
        });
      } else {
        // Fallback: assume positional format (id, name, power, eye, avoidK, babip, gap, speed, ovr, pot)
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

        // Require at least 5 values: power, eye, avoidK, ovr, pot (babip/gap/speed can default)
        if (numericValues.length < 5) {
          continue;
        }

        const [power, eye, avoidK, babip = 50, gap = 50, speed = 50, ovr, pot] = numericValues;

        // ovr and pot are required
        if (ovr === undefined || pot === undefined) {
          continue;
        }

        results.push({
          playerId,
          playerName,
          power,
          eye,
          avoidK,
          babip,
          gap,
          speed,
          ovr,
          pot,
          source,
        });
      }
    }

    return results;
  }

  async saveScoutingRatings(date: string, ratings: HitterScoutingRatings[], source: ScoutingSource = 'my'): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      if (USE_INDEXEDDB) {
        await indexedDBService.saveHitterScoutingRatings(date, source, ratings);
      } else {
        const key = this.storageKey(date, source);
        localStorage.setItem(key, JSON.stringify(ratings));
      }

      // Create development snapshots for tracking over time
      await developmentSnapshotService.createHitterSnapshotsFromScoutingUpload(date, ratings, source);
    } catch (e) {
      console.error('Failed to save hitter scouting ratings', e);
      throw e;
    }
  }

  async getLatestScoutingRatings(source: ScoutingSource = 'my'): Promise<HitterScoutingRatings[]> {
    if (typeof window === 'undefined') return [];

    const allKeys = await this.getAllKeys(source);
    if (allKeys.length === 0) return [];

    // Sort by date descending
    allKeys.sort((a, b) => b.date.localeCompare(a.date));

    if (USE_INDEXEDDB) {
      try {
        const data = await indexedDBService.getHitterScoutingRatings(allKeys[0].date, source);
        if (data) return data as HitterScoutingRatings[];
      } catch (err) {
        console.error('Error fetching hitter scouting from IndexedDB:', err);
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

  async getScoutingRatings(year: number, source: ScoutingSource = 'my'): Promise<HitterScoutingRatings[]> {
    if (typeof window === 'undefined') return [];

    const relevantKeys = await this.findKeysForYear(year, source);
    if (relevantKeys.length === 0) {
      return [];
    }

    // Sort by date descending
    relevantKeys.sort((a, b) => b.date.localeCompare(a.date));

    if (USE_INDEXEDDB) {
      try {
        const data = await indexedDBService.getHitterScoutingRatings(relevantKeys[0].date, source);
        if (data) return data as HitterScoutingRatings[];
      } catch (err) {
        console.error('Error fetching hitter scouting from IndexedDB:', err);
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
    return keys.length > 0;
  }

  async getAvailableScoutingSnapshots(year: number, source: ScoutingSource = 'my'): Promise<{ date: string, key: string, count: number }[]> {
    if (typeof window === 'undefined') return [];
    const keys = await this.findKeysForYear(year, source);

    const results = await Promise.all(keys.map(async k => {
      let count = 0;

      if (USE_INDEXEDDB) {
        try {
          const data = await indexedDBService.getHitterScoutingRatings(k.date, source);
          if (data) {
            count = data.length;
            return { date: k.date, key: `${k.date}_${source}`, count };
          }
        } catch {}
      }

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

    if (USE_INDEXEDDB) {
      let dbKey = dateOrKey;
      if (dateOrKey.startsWith(STORAGE_KEY_PREFIX)) {
        dbKey = dateOrKey.substring(STORAGE_KEY_PREFIX.length);
      }
      try {
        await indexedDBService.deleteHitterScoutingRatings(dbKey);
      } catch (e) {
        console.error('Error deleting hitter scouting from IndexedDB', e);
      }
    }

    let lsKey = dateOrKey;
    if (!dateOrKey.startsWith(STORAGE_KEY_PREFIX)) {
      lsKey = STORAGE_KEY_PREFIX + dateOrKey;
    }
    localStorage.removeItem(lsKey);
  }

  private storageKey(date: string, source: ScoutingSource): string {
    return `${STORAGE_KEY_PREFIX}${date}_${source}`;
  }

  private async getAllKeys(source: ScoutingSource): Promise<{ date: string, key: string }[]> {
    if (typeof window === 'undefined') return [];
    let results: { date: string, key: string }[] = [];

    if (USE_INDEXEDDB) {
      try {
        const idbKeys = await indexedDBService.getAllHitterScoutingKeys(source);
        results.push(...idbKeys);
      } catch (err) {
        console.error('Error getting hitter scouting keys from IndexedDB:', err);
      }
    }

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

  private parseStarRating(cells: string[], index?: number): number | null {
    if (typeof index !== 'number') return null;
    const raw = this.cleanCell(cells[index] ?? '');
    if (!raw) return null;

    const stripped = raw.toLowerCase().replace(/\s*stars?\s*/gi, '').trim();
    const num = parseFloat(stripped);

    if (Number.isNaN(num)) return null;
    if (num < 0.5 || num > 5.0) return null;

    return num;
  }

  private buildHeaderMap(headerCells: string[]): {
    indexMap: Partial<Record<HitterScoutingHeaderKey, number>>;
    hasHeader: boolean;
  } {
    const normalized = headerCells.map((cell) => this.normalizeHeader(cell));
    const indexMap: Partial<Record<HitterScoutingHeaderKey, number>> = {};
    let matches = 0;

    (Object.keys(HEADER_ALIASES) as HitterScoutingHeaderKey[]).forEach((key) => {
      const aliases = HEADER_ALIASES[key];
      const idx = normalized.findIndex((header) => aliases.includes(header));
      if (idx !== -1) {
        indexMap[key] = idx;
        matches += 1;
      }
    });

    const hasRatingsHeader = ['power', 'eye', 'avoidk'].some((key) =>
      normalized.includes(key)
    );
    const hasHeader = hasRatingsHeader || matches >= 2;

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

  async checkDefaultHitterOsaFile(): Promise<{ exists: boolean; count: number; error?: string }> {
    try {
      const response = await fetch('/data/default_hitter_osa_scouting.csv');

      if (!response.ok) {
        return { exists: false, count: 0, error: `File not found (${response.status})` };
      }

      const csvText = await response.text();
      const ratings = this.parseScoutingCsv(csvText, 'osa');

      return { exists: true, count: ratings.length };
    } catch (error) {
      console.error('Error checking bundled hitter OSA file:', error);
      return { exists: false, count: 0, error: String(error) };
    }
  }

  async loadDefaultHitterOsaData(gameDate: string, force: boolean = false): Promise<number> {
    try {
      if (!force) {
        const existingOsa = await this.getLatestScoutingRatings('osa');
        if (existingOsa.length > 0) {
          console.log(`Hitter OSA data already exists (${existingOsa.length} ratings), skipping load`);
          return 0;
        }
      }

      const response = await fetch('/data/default_hitter_osa_scouting.csv');
      if (!response.ok) {
        console.error(`Failed to fetch default hitter OSA data: ${response.status} ${response.statusText}`);
        throw new Error(`Failed to fetch default hitter OSA data: ${response.statusText}`);
      }

      const csvText = await response.text();
      const ratings = this.parseScoutingCsv(csvText, 'osa');

      if (ratings.length === 0) {
        console.warn('No valid hitter ratings found in default OSA CSV');
        return 0;
      }

      await this.saveScoutingRatings(gameDate, ratings, 'osa');
      console.log(`Successfully loaded ${ratings.length} default hitter OSA scouting ratings`);

      return ratings.length;
    } catch (error) {
      console.error('Failed to load default hitter OSA data:', error);
      return 0;
    }
  }
}

export const hitterScoutingDataService = new HitterScoutingDataService();
