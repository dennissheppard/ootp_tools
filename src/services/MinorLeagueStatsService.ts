import { MinorLeagueStats, MinorLeagueStatsWithLevel, MinorLeagueLevel } from '../models/Stats';

export type { MinorLeagueLevel };

const STORAGE_KEY_PREFIX = 'wbl_minor_stats_';

type StatsHeaderKey = 'id' | 'name' | 'ip' | 'hr' | 'bb' | 'k' | 'hr9' | 'bb9' | 'k9';

const HEADER_ALIASES: Record<StatsHeaderKey, string[]> = {
  id: ['id', 'playerid', 'pid'],
  name: ['name', 'playername', 'player'],
  ip: ['ip', 'innings'],
  hr: ['hr', 'homeruns'],
  bb: ['bb', 'walks'],
  k: ['k', 'so', 'strikeouts'],
  hr9: ['hr/9', 'hr9', 'homeruns/9'],
  bb9: ['bb/9', 'bb9', 'walks/9'],
  k9: ['k/9', 'k9', 'strikeouts/9'],
};

class MinorLeagueStatsService {
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
        const name = this.getStringFromIndex(cells, indexMap.name);
        const ip = this.getNumberFromIndex(cells, indexMap.ip);
        const hr = this.getNumberFromIndex(cells, indexMap.hr);
        const bb = this.getNumberFromIndex(cells, indexMap.bb);
        const k = this.getNumberFromIndex(cells, indexMap.k);
        const hr9 = this.getNumberFromIndex(cells, indexMap.hr9);
        const bb9 = this.getNumberFromIndex(cells, indexMap.bb9);
        const k9 = this.getNumberFromIndex(cells, indexMap.k9);

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

  saveStats(year: number, level: MinorLeagueLevel, stats: MinorLeagueStats[]): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey(year, level), JSON.stringify(stats));
    } catch (e) {
      console.error('Failed to save stats', e);
    }
  }

  getStats(year: number, level: MinorLeagueLevel): MinorLeagueStats[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(this.storageKey(year, level));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as MinorLeagueStats[]) : [];
    } catch {
      return [];
    }
  }

  hasStats(year: number, level: MinorLeagueLevel): boolean {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem(this.storageKey(year, level));
  }
  
  clearStats(year: number, level: MinorLeagueLevel): void {
      if (typeof window === 'undefined') return;
      localStorage.removeItem(this.storageKey(year, level));
  }

  /**
   * Get all minor league stats for a specific player across all levels within a year range.
   * Returns stats with level information attached.
   */
  getPlayerStats(
    playerId: number,
    startYear: number,
    endYear: number
  ): MinorLeagueStatsWithLevel[] {
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
    const results: MinorLeagueStatsWithLevel[] = [];

    for (let year = startYear; year <= endYear; year++) {
      for (const level of levels) {
        const stats = this.getStats(year, level);
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

    // Sort by year descending
    return results.sort((a, b) => b.year - a.year);
  }

  /**
   * Get all stored year/level combinations that have data.
   */
  getAvailableDataSets(): Array<{ year: number; level: MinorLeagueLevel }> {
    if (typeof window === 'undefined') return [];
    const results: Array<{ year: number; level: MinorLeagueLevel }> = [];
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];

    // Check years from 2000 to current year + 5
    const maxYear = new Date().getFullYear() + 5;
    for (let year = 2000; year <= maxYear; year++) {
      for (const level of levels) {
        if (this.hasStats(year, level)) {
          results.push({ year, level });
        }
      }
    }

    return results;
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
      const idx = normalized.findIndex((header) => aliases.includes(header));
      if (idx !== -1) {
        indexMap[key] = idx;
        matches += 1;
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
