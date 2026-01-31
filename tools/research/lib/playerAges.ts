/**
 * Player Age Utility
 *
 * Loads and deduplicates player DOB data from multiple level-specific CSV files.
 * Provides utilities to calculate age at any given date.
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

interface PlayerDOB {
  playerId: number;
  dob: Date;
}

// Singleton cache for DOB data
let dobCache: Map<number, Date> | null = null;

/**
 * Load and deduplicate player DOB data from all level CSVs.
 * Returns a map of player_id -> Date of Birth
 */
export function loadPlayerDOBs(): Map<number, Date> {
  // Return cached data if already loaded
  if (dobCache) {
    return dobCache;
  }

  console.log('📅 Loading player DOB data...');

  const dobMap = new Map<number, Date>();
  const files = ['mlb_dob.csv', 'aaa_dob.csv', 'aa_dob.csv', 'a_dob.csv', 'rookie_dob.csv'];
  let totalRows = 0;
  let duplicates = 0;

  for (const file of files) {
    const filePath = path.join('public', 'data', file);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  File not found: ${file}`);
      continue;
    }

    const csv = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse<{ ID: string; DOB: string }>(csv, {
      header: true,
      skipEmptyLines: true
    });

    for (const row of parsed.data) {
      if (!row.ID || !row.DOB) continue;

      const playerId = parseInt(row.ID);
      if (isNaN(playerId)) continue;

      totalRows++;

      // Parse DOB (format: MM/DD/YYYY)
      const dobParts = row.DOB.split('/');
      if (dobParts.length !== 3) continue;

      const month = parseInt(dobParts[0]);
      const day = parseInt(dobParts[1]);
      const year = parseInt(dobParts[2]);

      if (isNaN(month) || isNaN(day) || isNaN(year)) continue;

      const dob = new Date(year, month - 1, day); // JS months are 0-indexed

      // Only store if not already present (first occurrence wins)
      if (!dobMap.has(playerId)) {
        dobMap.set(playerId, dob);
      } else {
        duplicates++;
      }
    }
  }

  console.log(`✅ Loaded ${dobMap.size} unique players (${totalRows} total rows, ${duplicates} duplicates)`);

  // Cache for future calls
  dobCache = dobMap;
  return dobMap;
}

/**
 * Calculate a player's age on a specific date.
 *
 * @param playerId - Player ID
 * @param onDate - Date to calculate age (defaults to current date)
 * @param dobMap - Optional pre-loaded DOB map (loads if not provided)
 * @returns Age in years, or undefined if player not found
 */
export function getPlayerAge(
  playerId: number,
  onDate: Date = new Date(),
  dobMap?: Map<number, Date>
): number | undefined {
  const dobs = dobMap ?? loadPlayerDOBs();
  const dob = dobs.get(playerId);

  if (!dob) return undefined;

  // Calculate age
  let age = onDate.getFullYear() - dob.getFullYear();
  const monthDiff = onDate.getMonth() - dob.getMonth();

  // Adjust if birthday hasn't occurred yet this year
  if (monthDiff < 0 || (monthDiff === 0 && onDate.getDate() < dob.getDate())) {
    age--;
  }

  return age;
}

/**
 * Calculate a player's age during a specific season (uses June 30 as standard date).
 *
 * @param playerId - Player ID
 * @param season - Season year (e.g., 2020)
 * @param dobMap - Optional pre-loaded DOB map
 * @returns Age during that season, or undefined if player not found
 */
export function getPlayerSeasonAge(
  playerId: number,
  season: number,
  dobMap?: Map<number, Date>
): number | undefined {
  // Standard baseball age cutoff: June 30 of the season
  const cutoffDate = new Date(season, 5, 30); // Month 5 = June (0-indexed)
  return getPlayerAge(playerId, cutoffDate, dobMap);
}

/**
 * Get age group label for analysis
 */
export function getAgeGroup(age: number): string {
  if (age <= 21) return '≤21 (Very Young)';
  if (age <= 23) return '22-23 (Young)';
  if (age <= 25) return '24-25 (Prime Prospect)';
  if (age <= 27) return '26-27 (Older Prospect)';
  if (age <= 29) return '28-29 (Veteran)';
  return '30+ (Old)';
}

/**
 * Get age group for statistical bucketing (broader groups)
 */
export function getAgeBucket(age: number): string {
  if (age <= 22) return 'Young (≤22)';
  if (age <= 25) return 'Prime (23-25)';
  if (age <= 28) return 'Mature (26-28)';
  return 'Veteran (29+)';
}

/**
 * Calculate average age for a group of players
 */
export function getAverageAge(
  playerIds: number[],
  season: number,
  dobMap?: Map<number, Date>
): number {
  const dobs = dobMap ?? loadPlayerDOBs();
  const ages = playerIds
    .map(pid => getPlayerSeasonAge(pid, season, dobs))
    .filter((age): age is number => age !== undefined);

  if (ages.length === 0) return 0;
  return ages.reduce((sum, age) => sum + age, 0) / ages.length;
}

/**
 * Export DOB map as JSON for debugging
 */
export function exportDOBsToJson(outputPath: string): void {
  const dobs = loadPlayerDOBs();
  const data: Record<number, string> = {};

  for (const [playerId, dob] of dobs) {
    data[playerId] = dob.toISOString().split('T')[0]; // YYYY-MM-DD format
  }

  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
  console.log(`✅ Exported ${dobs.size} DOBs to ${outputPath}`);
}
