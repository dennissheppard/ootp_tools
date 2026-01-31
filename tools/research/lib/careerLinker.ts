import { loadMlbData, loadMinorData, loadAllLevels, getLevelCode, PitcherStats } from './dataLoader';

export interface SeasonStats {
  year: number;
  level_id: number;
  levelName: string;
  stats: PitcherStats;
}

export interface CareerArc {
  player_id: number;
  seasons: SeasonStats[];
  mlbSeasons: number;
  minorSeasons: number;
  highestLevel: number; // 1 = MLB (highest)
  lowestLevel: number; // 6 = Rookie (lowest)
  firstYear: number;
  lastYear: number;
  peakMLBSeason?: SeasonStats;
  mlbDebut?: number;
}

export interface Transition {
  player_id: number;
  yearFrom: number;
  yearTo: number;
  levelFrom: number;
  levelTo: number;
  statsFrom: PitcherStats;
  statsTo: PitcherStats;
  age?: number;
}

/**
 * Builds complete career profiles for all pitchers across specified years
 */
export function buildCareerProfiles(startYear: number, endYear: number): Map<number, CareerArc> {
  const careers = new Map<number, CareerArc>();

  console.log(`📚 Building career profiles (${startYear}-${endYear})...`);

  for (let year = startYear; year <= endYear; year++) {
    const allLevels = loadAllLevels(year);

    for (const [level_id, players] of allLevels) {
      for (const player of players) {
        if (!careers.has(player.player_id)) {
          careers.set(player.player_id, {
            player_id: player.player_id,
            seasons: [],
            mlbSeasons: 0,
            minorSeasons: 0,
            highestLevel: level_id,
            lowestLevel: level_id,
            firstYear: year,
            lastYear: year
          });
        }

        const career = careers.get(player.player_id)!;

        career.seasons.push({
          year,
          level_id,
          levelName: getLevelName(level_id),
          stats: player
        });

        if (level_id === 1) {
          career.mlbSeasons++;
          if (!career.mlbDebut) {
            career.mlbDebut = year;
          }
        } else {
          career.minorSeasons++;
        }

        if (level_id < career.highestLevel) career.highestLevel = level_id;
        if (level_id > career.lowestLevel) career.lowestLevel = level_id;
        if (year > career.lastYear) career.lastYear = year;
      }
    }
  }

  // Find peak MLB season for each player
  for (const career of careers.values()) {
    const mlbSeasons = career.seasons.filter(s => s.level_id === 1 && s.stats.ip >= 100);
    if (mlbSeasons.length > 0) {
      // Peak = lowest FIP with at least 100 IP
      career.peakMLBSeason = mlbSeasons.sort((a, b) => a.stats.fip - b.stats.fip)[0];
    }
  }

  console.log(`✅ Built ${careers.size} career profiles`);
  return careers;
}

/**
 * Finds pitchers who played at one level, then the next level in consecutive years
 */
export function findConsecutiveTransitions(
  fromLevel: number,
  toLevel: number,
  startYear: number,
  endYear: number,
  minIP: number = 30
): Transition[] {
  const transitions: Transition[] = [];

  console.log(`🔍 Finding ${getLevelName(fromLevel)} → ${getLevelName(toLevel)} transitions (${startYear}-${endYear})...`);

  for (let year = startYear; year < endYear; year++) {
    const fromData = fromLevel === 1
      ? loadMlbData(year)
      : loadMinorData(year, getLevelCode(fromLevel));

    const toData = toLevel === 1
      ? loadMlbData(year + 1)
      : loadMinorData(year + 1, getLevelCode(toLevel));

    // Find players who appear in both datasets with minimum IP
    for (const playerFrom of fromData) {
      if (playerFrom.ip < minIP) continue;

      const playerTo = toData.find(p => p.player_id === playerFrom.player_id && p.ip >= minIP);

      if (playerTo) {
        transitions.push({
          player_id: playerFrom.player_id,
          yearFrom: year,
          yearTo: year + 1,
          levelFrom: fromLevel,
          levelTo: toLevel,
          statsFrom: playerFrom,
          statsTo: playerTo
        });
      }
    }
  }

  console.log(`✅ Found ${transitions.length} transitions`);
  return transitions;
}

/**
 * Finds all transitions for a specific player across their career
 */
export function getPlayerTransitions(career: CareerArc): Transition[] {
  const transitions: Transition[] = [];

  for (let i = 1; i < career.seasons.length; i++) {
    const prev = career.seasons[i - 1];
    const curr = career.seasons[i];

    // Only track promotions (to higher levels) or lateral moves
    if (curr.level_id <= prev.level_id && curr.year === prev.year + 1) {
      transitions.push({
        player_id: career.player_id,
        yearFrom: prev.year,
        yearTo: curr.year,
        levelFrom: prev.level_id,
        levelTo: curr.level_id,
        statsFrom: prev.stats,
        statsTo: curr.stats
      });
    }
  }

  return transitions;
}

/**
 * Filters careers based on criteria
 */
export function filterCareers(
  careers: Map<number, CareerArc>,
  criteria: {
    mlbSeasons?: number; // Minimum MLB seasons
    minorSeasons?: number; // Minimum minor league seasons
    reachedMLB?: boolean; // Must have reached MLB
    yearRange?: [number, number]; // Career overlaps with year range
  }
): CareerArc[] {
  const filtered: CareerArc[] = [];

  for (const career of careers.values()) {
    if (criteria.mlbSeasons !== undefined && career.mlbSeasons < criteria.mlbSeasons) continue;
    if (criteria.minorSeasons !== undefined && career.minorSeasons < criteria.minorSeasons) continue;
    if (criteria.reachedMLB !== undefined && criteria.reachedMLB && career.highestLevel !== 1) continue;
    if (criteria.yearRange) {
      const [start, end] = criteria.yearRange;
      if (career.lastYear < start || career.firstYear > end) continue;
    }

    filtered.push(career);
  }

  return filtered;
}

/**
 * Categorizes players by their career outcome
 */
export function categorizeCareerOutcome(career: CareerArc): string {
  if (career.highestLevel === 1) {
    if (career.mlbSeasons >= 5) return 'MLB Regular';
    if (career.mlbSeasons >= 2) return 'MLB Fringe';
    return 'Cup of Coffee';
  }

  if (career.highestLevel === 2) return 'AAAA Player';
  if (career.highestLevel === 3) return 'AA Prospect';
  if (career.highestLevel === 4) return 'A-Ball';
  return 'Rookie League';
}

/**
 * Identifies "AAAA" players (dominated AAA but failed in MLB)
 */
export function findAAAAPlayers(
  careers: Map<number, CareerArc>,
  aaaFIPThreshold: number = 3.5,
  mlbFIPThreshold: number = 4.5,
  minAAASeasons: number = 2,
  minMLBIP: number = 100
): CareerArc[] {
  const aaaaPlayers: CareerArc[] = [];

  for (const career of careers.values()) {
    // Must have reached MLB
    if (career.highestLevel !== 1) continue;

    // Check AAA dominance
    const aaaSeasons = career.seasons.filter(s => s.level_id === 2 && s.stats.ip >= 50);
    if (aaaSeasons.length < minAAASeasons) continue;

    const avgAAAFip = aaaSeasons.reduce((sum, s) => sum + s.stats.fip, 0) / aaaSeasons.length;
    if (avgAAAFip > aaaFIPThreshold) continue;

    // Check MLB failure
    const mlbSeasons = career.seasons.filter(s => s.level_id === 1);
    const totalMLBIP = mlbSeasons.reduce((sum, s) => sum + s.stats.ip, 0);
    if (totalMLBIP < minMLBIP) continue;

    const avgMLBFip = mlbSeasons.reduce((sum, s) => sum + s.stats.fip * s.stats.ip, 0) / totalMLBIP;
    if (avgMLBFip < mlbFIPThreshold) continue;

    aaaaPlayers.push(career);
  }

  return aaaaPlayers;
}

/**
 * Identifies late bloomers (poor minors, good MLB)
 */
export function findLateBloomers(
  careers: Map<number, CareerArc>,
  minorFIPThreshold: number = 4.5,
  mlbFIPThreshold: number = 4.0,
  minMLBSeasons: number = 3
): CareerArc[] {
  const lateBloomers: CareerArc[] = [];

  for (const career of careers.values()) {
    // Must have succeeded in MLB
    if (career.mlbSeasons < minMLBSeasons) continue;

    const mlbSeasons = career.seasons.filter(s => s.level_id === 1 && s.stats.ip >= 100);
    if (mlbSeasons.length === 0) continue;

    const avgMLBFip = mlbSeasons.reduce((sum, s) => sum + s.stats.fip, 0) / mlbSeasons.length;
    if (avgMLBFip > mlbFIPThreshold) continue;

    // Check for poor minor league performance
    const minorSeasons = career.seasons.filter(s => s.level_id > 1 && s.stats.ip >= 50);
    if (minorSeasons.length === 0) continue;

    const avgMinorFip = minorSeasons.reduce((sum, s) => sum + s.stats.fip, 0) / minorSeasons.length;
    if (avgMinorFip < minorFIPThreshold) continue;

    lateBloomers.push(career);
  }

  return lateBloomers;
}

function getLevelName(level_id: number): string {
  switch (level_id) {
    case 1: return 'MLB';
    case 2: return 'AAA';
    case 3: return 'AA';
    case 4: return 'A';
    case 6: return 'Rookie';
    default: return 'Unknown';
  }
}
