/**
 * Migrates data from localStorage to IndexedDB
 * Run this once to move all scouting and minor league data
 */

import { indexedDBService } from './IndexedDBService';
import { MinorLeagueLevel } from './MinorLeagueStatsService';

const SCOUTING_PREFIX = 'wbl_scouting_ratings_';
const STATS_PREFIX = 'wbl_minor_league_stats_';

export class StorageMigration {
  async migrateAll(): Promise<{ scouting: number; stats: number; errors: string[] }> {
    const errors: string[] = [];
    let scoutingCount = 0;
    let statsCount = 0;

    try {
      scoutingCount = await this.migrateScoutingData();
    } catch (err) {
      errors.push(`Scouting migration failed: ${err}`);
    }

    try {
      statsCount = await this.migrateStatsData();
    } catch (err) {
      errors.push(`Stats migration failed: ${err}`);
    }

    return { scouting: scoutingCount, stats: statsCount, errors };
  }

  private async migrateScoutingData(): Promise<number> {
    if (typeof window === 'undefined') return 0;

    let count = 0;
    const keys = this.findScoutingKeysInLocalStorage();

    for (const { key, date, source } of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const data = JSON.parse(raw);
        await indexedDBService.saveScoutingRatings(date, source, data);

        // Remove from localStorage after successful migration
        localStorage.removeItem(key);
        count++;
      } catch (err) {
        console.error(`Failed to migrate scouting key ${key}:`, err);
      }
    }

    return count;
  }

  private async migrateStatsData(): Promise<number> {
    if (typeof window === 'undefined') return 0;

    let count = 0;
    const keys = this.findStatsKeysInLocalStorage();

    for (const { key, year, level } of keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const data = JSON.parse(raw);
        await indexedDBService.saveStats(year, level, data);

        // Remove from localStorage after successful migration
        localStorage.removeItem(key);
        count++;
      } catch (err) {
        console.error(`Failed to migrate stats key ${key}:`, err);
      }
    }

    return count;
  }

  private findScoutingKeysInLocalStorage(): { key: string; date: string; source: string }[] {
    const results: { key: string; date: string; source: string }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(SCOUTING_PREFIX)) continue;

      const suffix = key.substring(SCOUTING_PREFIX.length);

      // Try new format: YYYY-MM-DD_source
      const parts = suffix.split('_');
      if (parts.length >= 2) {
        const date = parts[0];
        const source = parts[1] || 'my';
        results.push({ key, date, source });
      } else {
        // Legacy format: just year (assume 'my' source, use YYYY-01-01 as date)
        const year = suffix;
        if (/^\d{4}$/.test(year)) {
          results.push({ key, date: `${year}-01-01`, source: 'my' });
        }
      }
    }

    return results;
  }

  private findStatsKeysInLocalStorage(): { key: string; year: number; level: string }[] {
    const results: { key: string; year: number; level: string }[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STATS_PREFIX)) continue;

      const suffix = key.substring(STATS_PREFIX.length);
      const parts = suffix.split('_');

      if (parts.length >= 2) {
        const year = parseInt(parts[0], 10);
        const level = parts[1];
        if (!isNaN(year) && this.isValidLevel(level)) {
          results.push({ key, year, level });
        }
      }
    }

    return results;
  }

  private isValidLevel(level: string): level is MinorLeagueLevel {
    return ['aaa', 'aa', 'a', 'r'].includes(level);
  }

  /**
   * Check if migration is needed (any data in localStorage)
   */
  needsMigration(): boolean {
    if (typeof window === 'undefined') return false;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(SCOUTING_PREFIX) || key.startsWith(STATS_PREFIX))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get storage usage estimate
   */
  getLocalStorageUsage(): { total: number; scouting: number; stats: number; other: number } {
    if (typeof window === 'undefined') {
      return { total: 0, scouting: 0, stats: 0, other: 0 };
    }

    let total = 0;
    let scouting = 0;
    let stats = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const value = localStorage.getItem(key);
      if (!value) continue;

      const size = new Blob([value]).size;
      total += size;

      if (key.startsWith(SCOUTING_PREFIX)) {
        scouting += size;
      } else if (key.startsWith(STATS_PREFIX)) {
        stats += size;
      }
    }

    return {
      total,
      scouting,
      stats,
      other: total - scouting - stats
    };
  }
}

export const storageMigration = new StorageMigration();
