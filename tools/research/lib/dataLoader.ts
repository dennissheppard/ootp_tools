import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';

export interface PitcherStats {
  player_id: number;
  year: number;
  team_id: number;
  league_id: number;
  level_id: number;
  ip: number;
  k: number;
  bb: number;
  hra: number;
  er: number;
  ha: number;
  bf: number;
  g: number;
  gs: number;
  w: number;
  l: number;
  // Calculated stats
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
  era: number;
}

export function loadMlbData(year: number): PitcherStats[] {
  const filePath = path.join('public', 'data', 'mlb', `${year}.csv`);
  return loadCsvData(filePath, year);
}

export function loadMinorData(year: number, level: 'aaa' | 'aa' | 'a' | 'r'): PitcherStats[] {
  const filePath = path.join('public', 'data', 'minors', `${year}_${level}.csv`);
  return loadCsvData(filePath, year);
}

function loadCsvData(filePath: string, year: number): PitcherStats[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return [];
  }

  const csv = fs.readFileSync(filePath, 'utf-8');
  const parsed = Papa.parse<any>(csv, { header: true, skipEmptyLines: true });

  return parsed.data
    .filter(row => {
      const ip = parseFloat(row.ip);
      return row.ip && !isNaN(ip) && ip >= 20; // Min 20 IP to filter out position players
    })
    .map(row => {
      const ip = parseFloat(row.ip);
      const k = parseInt(row.k) || 0;
      const bb = parseInt(row.bb) || 0;
      const hra = parseInt(row.hra) || 0;
      const er = parseInt(row.er) || 0;
      const ha = parseInt(row.ha) || 0;
      const bf = parseInt(row.bf) || 0;

      const k9 = (k / ip) * 9;
      const bb9 = (bb / ip) * 9;
      const hr9 = (hra / ip) * 9;
      const era = (er / ip) * 9;

      // FIP formula: ((13 * HR) + (3 * BB) - (2 * K)) / IP + FIP_constant
      // Using 3.2 as a rough constant for now
      const fip = ((13 * hra + 3 * bb - 2 * k) / ip) + 3.2;

      return {
        player_id: parseInt(row.player_id),
        year,
        team_id: parseInt(row.team_id),
        league_id: parseInt(row.league_id),
        level_id: parseInt(row.level_id),
        ip,
        k,
        bb,
        hra,
        er,
        ha,
        bf,
        g: parseInt(row.g) || 0,
        gs: parseInt(row.gs) || 0,
        w: parseInt(row.w) || 0,
        l: parseInt(row.l) || 0,
        k9,
        bb9,
        hr9,
        fip,
        era
      };
    });
}

export function loadAllLevels(year: number): Map<number, PitcherStats[]> {
  // Returns map: level_id -> stats
  const data = new Map<number, PitcherStats[]>();

  data.set(1, loadMlbData(year));
  data.set(2, loadMinorData(year, 'aaa'));
  data.set(3, loadMinorData(year, 'aa'));
  data.set(4, loadMinorData(year, 'a'));
  data.set(6, loadMinorData(year, 'r'));

  return data;
}

export function getLevelCode(level_id: number): 'aaa' | 'aa' | 'a' | 'r' {
  switch (level_id) {
    case 2: return 'aaa';
    case 3: return 'aa';
    case 4: return 'a';
    case 6: return 'r';
    default: throw new Error(`Invalid level_id: ${level_id}`);
  }
}

export function getLevelName(level_id: number): string {
  switch (level_id) {
    case 1: return 'MLB';
    case 2: return 'AAA';
    case 3: return 'AA';
    case 4: return 'A';
    case 6: return 'Rookie';
    default: return 'Unknown';
  }
}

// Utility functions
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = mean(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}
