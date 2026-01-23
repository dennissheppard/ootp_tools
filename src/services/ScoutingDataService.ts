import { PitcherScoutingRatings } from '../models/ScoutingData';

type ScoutingHeaderKey = 'playerId' | 'playerName' | 'stuff' | 'control' | 'hra' | 'age';

const STORAGE_KEY_PREFIX = 'wbl_scouting_ratings_';

const HEADER_ALIASES: Record<ScoutingHeaderKey, string[]> = {
  playerId: ['playerid', 'player_id', 'id', 'pid'],
  playerName: ['playername', 'player_name', 'name', 'player'],
  stuff: ['stuff', 'stu', 'stf'],
  control: ['control', 'con', 'ctl'],
  hra: ['hra', 'hr', 'hrr', 'hravoid', 'hravoidance'],
  age: ['age'],
};

class ScoutingDataService {
  parseScoutingCsv(csvText: string): PitcherScoutingRatings[] {
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

        results.push({
          playerId,
          playerName: playerName || undefined,
          stuff,
          control,
          hra,
          age: this.isNumber(age) ? Math.round(age) : undefined,
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
        });
      }
    }

    return results;
  }

  saveScoutingRatings(year: number, ratings: PitcherScoutingRatings[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey(year), JSON.stringify(ratings));
    } catch {
      // ignore storage errors
    }
  }

  getScoutingRatings(year: number): PitcherScoutingRatings[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(this.storageKey(year));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as PitcherScoutingRatings[]) : [];
    } catch {
      return [];
    }
  }

  clearScoutingRatings(year: number): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(this.storageKey(year));
  }

  private storageKey(year: number): string {
    return `${STORAGE_KEY_PREFIX}${year}`;
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
    indexMap: Partial<Record<ScoutingHeaderKey, number>>;
    hasHeader: boolean;
  } {
    const normalized = headerCells.map((cell) => this.normalizeHeader(cell));
    const indexMap: Partial<Record<ScoutingHeaderKey, number>> = {};
    let matches = 0;

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
}

export const scoutingDataService = new ScoutingDataService();
