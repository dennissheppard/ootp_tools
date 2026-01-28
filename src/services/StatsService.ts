import { PitchingStats, BattingStats } from '../models/Stats';
import { apiFetch } from './ApiClient';

const API_BASE = '/api';

export class StatsService {
  async getPitchingStats(playerId: number, year?: number): Promise<PitchingStats[]> {
    let url = `${API_BASE}/playerpitchstatsv2/?pid=${playerId}`;
    if (year) {
      url += `&year=${year}`;
    }

    const response = await apiFetch(url);
    if (response.status === 204 || response.status === 404 || response.status === 500) {
      return [];
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch pitching stats: ${response.statusText}`);
    }

    const csvText = await response.text();
    if (!csvText.trim()) {
      return [];
    }

    return this.parsePitchingStatsCsv(csvText);
  }

  async getBattingStats(playerId: number, year?: number): Promise<BattingStats[]> {
    let url = `${API_BASE}/playerbatstatsv2/?pid=${playerId}`;
    if (year) {
      url += `&year=${year}`;
    }

    const response = await apiFetch(url);
    if (response.status === 204 || response.status === 404 || response.status === 500) {
      return [];
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch batting stats: ${response.statusText}`);
    }

    const csvText = await response.text();
    if (!csvText.trim()) {
      return [];
    }

    return this.parseBattingStatsCsv(csvText);
  }

  private parsePitchingStatsCsv(csv: string): PitchingStats[] {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = this.parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);

    return dataLines.map((line) => {
      const values = this.parseCsvLine(line);
      const row = this.zipToObject(headers, values);

      const ip = parseFloat(row['ip']) || 0;
      const er = parseInt(row['er'], 10) || 0;
      const ha = parseInt(row['ha'], 10) || 0;
      const bb = parseInt(row['bb'], 10) || 0;
      const k = parseInt(row['k'], 10) || 0;

      // Calculate ERA: (ER / IP) * 9
      const era = ip > 0 ? (er / ip) * 9 : 0;
      // Calculate WHIP: (BB + H) / IP
      const whip = ip > 0 ? (bb + ha) / ip : 0;
      // Calculate K/9: (K / IP) * 9
      const k9 = ip > 0 ? (k / ip) * 9 : 0;
      // Calculate BB/9: (BB / IP) * 9
      const bb9 = ip > 0 ? (bb / ip) * 9 : 0;

      return {
        id: parseInt(row['id'], 10),
        playerId: parseInt(row['player_id'], 10),
        year: parseInt(row['year'], 10),
        teamId: parseInt(row['team_id'], 10),
        leagueId: parseInt(row['league_id'], 10),
        levelId: parseInt(row['level_id'], 10),
        splitId: parseInt(row['split_id'], 10),
        ip,
        w: parseInt(row['w'], 10) || 0,
        l: parseInt(row['l'], 10) || 0,
        era,
        g: parseInt(row['g'], 10) || 0,
        gs: parseInt(row['gs'], 10) || 0,
        sv: parseInt(row['s'], 10) || 0,
        bf: parseInt(row['bf'], 10) || 0,
        ab: parseInt(row['ab'], 10) || 0,
        ha,
        er,
        r: parseInt(row['r'], 10) || 0,
        bb,
        k,
        hr: parseInt(row['hra'], 10) || 0,
        whip,
        k9,
        bb9,
        war: parseFloat(row['war']) || 0,
        cg: parseInt(row['cg'], 10) || 0,
        sho: parseInt(row['sho'], 10) || 0,
        hld: parseInt(row['hld'], 10) || 0,
        bs: parseInt(row['bs'], 10) || 0,
        qs: parseInt(row['qs'], 10) || 0,
      };
    });
  }

  private parseBattingStatsCsv(csv: string): BattingStats[] {
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = this.parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);

    return dataLines.map((line) => {
      const values = this.parseCsvLine(line);
      const row = this.zipToObject(headers, values);

      const ab = parseInt(row['ab'], 10) || 0;
      const h = parseInt(row['h'], 10) || 0;
      const bb = parseInt(row['bb'], 10) || 0;
      const hp = parseInt(row['hp'], 10) || 0;
      const sf = parseInt(row['sf'], 10) || 0;
      const d = parseInt(row['d'], 10) || 0;
      const t = parseInt(row['t'], 10) || 0;
      const hr = parseInt(row['hr'], 10) || 0;
      const pa = parseInt(row['pa'], 10) || 0;

      // Calculate AVG: H / AB
      const avg = ab > 0 ? h / ab : 0;
      // Calculate OBP: (H + BB + HBP) / (AB + BB + HBP + SF)
      const obpDenom = ab + bb + hp + sf;
      const obp = obpDenom > 0 ? (h + bb + hp) / obpDenom : 0;
      // Calculate SLG: Total Bases / AB
      const tb = h + d + (2 * t) + (3 * hr);
      const slg = ab > 0 ? tb / ab : 0;
      // Calculate OPS: OBP + SLG
      const ops = obp + slg;

      return {
        id: parseInt(row['id'], 10),
        playerId: parseInt(row['player_id'], 10),
        year: parseInt(row['year'], 10),
        teamId: parseInt(row['team_id'], 10),
        leagueId: parseInt(row['league_id'], 10),
        levelId: parseInt(row['level_id'], 10),
        splitId: parseInt(row['split_id'], 10),
        g: parseInt(row['g'], 10) || 0,
        ab,
        pa,
        h,
        d,
        t,
        hr,
        r: parseInt(row['r'], 10) || 0,
        rbi: parseInt(row['rbi'], 10) || 0,
        bb,
        k: parseInt(row['k'], 10) || 0,
        sb: parseInt(row['sb'], 10) || 0,
        cs: parseInt(row['cs'], 10) || 0,
        avg,
        obp,
        slg,
        ops,
        war: parseFloat(row['war']) || 0,
        ibb: parseInt(row['ibb'], 10) || 0,
        hp,
        sh: parseInt(row['sh'], 10) || 0,
        sf,
        gdp: parseInt(row['gdp'], 10) || 0,
      };
    });
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
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);

    return values;
  }

  private zipToObject(keys: string[], values: string[]): Record<string, string> {
    const obj: Record<string, string> = {};
    keys.forEach((key, index) => {
      obj[key] = values[index] ?? '';
    });
    return obj;
  }
}

// Singleton instance for convenience
export const statsService = new StatsService();
