import { PitchingStats, BattingStats } from '../models/Stats';
import { apiFetch } from './ApiClient';
import { indexedDBService } from './IndexedDBService';
import { dateService } from './DateService';
import { supabaseDataService } from './SupabaseDataService';

const API_BASE = '/api';

export class StatsService {
  async getPitchingStats(playerId: number, year?: number): Promise<PitchingStats[]> {
    // Supabase-first path
    if (supabaseDataService.isConfigured) {
      try {
        let params = `select=*&player_id=eq.${playerId}&split_id=eq.1&order=year`;
        if (year) params += `&year=eq.${year}`;
        const rows = await supabaseDataService.query<any>('pitching_stats', params);
        return rows.map((r: any) => {
          const ip = typeof r.ip === 'string' ? parseFloat(r.ip) : (r.ip || 0);
          const er = r.er ?? 0;
          const ha = r.ha ?? 0;
          const bb = r.bb ?? 0;
          const k = r.k ?? 0;
          return {
            id: r.id ?? 0,
            playerId: r.player_id,
            year: r.year,
            teamId: r.team_id ?? 0,
            leagueId: r.league_id,
            levelId: r.level_id ?? 0,
            splitId: r.split_id,
            ip, w: r.w ?? 0, l: r.l ?? 0,
            era: ip > 0 ? (er / ip) * 9 : 0,
            g: r.g ?? 0, gs: r.gs ?? 0, sv: r.s ?? 0,
            bf: r.bf ?? 0, ab: r.ab ?? 0, ha, er, r: r.r ?? 0, bb, k,
            hr: r.hra ?? 0,
            whip: ip > 0 ? (bb + ha) / ip : 0,
            k9: ip > 0 ? (k / ip) * 9 : 0,
            bb9: ip > 0 ? (bb / ip) * 9 : 0,
            war: parseFloat(r.war) || 0,
            cg: r.cg ?? 0, sho: r.sho ?? 0, hld: r.hld ?? 0,
            bs: r.bs ?? 0, qs: r.qs ?? 0,
          } as PitchingStats;
        });
      } catch (err) {
        console.warn('Supabase pitching stats fetch failed:', err);
        return [];
      }
    }

    // Check cache first
    try {
      const cached = await indexedDBService.getMlbPlayerPitchingStats(playerId, year);
      if (cached) {
        const currentYear = await dateService.getCurrentYear();
        const isCurrentYear = year === currentYear || (!year && cached.data.some((s: PitchingStats) => s.year === currentYear));
        const currentGameDate = await dateService.getCurrentDate();

        // Use cache if:
        // - It's historical data (not current year), OR
        // - It's current year data and game date matches (game hasn't advanced)
        if (!isCurrentYear || cached.gameDate === currentGameDate) {
          console.log(`💾 Loaded player ${playerId}${year ? ` (${year})` : ''} pitching stats from cache`);
          return cached.data as PitchingStats[];
        } else {
          console.log(`⏰ Cache stale for player ${playerId} (game date changed), re-fetching...`);
        }
      }
    } catch (err) {
      console.warn('Error checking cache for player pitching stats:', err);
    }

    // Fetch from API
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

    const stats = this.parsePitchingStatsCsv(csvText);

    // Save to cache (only if non-empty to avoid caching errors)
    if (stats.length > 0) {
      try {
        const gameDate = await dateService.getCurrentDate();
        await indexedDBService.saveMlbPlayerPitchingStats(playerId, stats, year, gameDate);
        console.log(`💾 Cached player ${playerId}${year ? ` (${year})` : ''} pitching stats (${stats.length} records)`);
      } catch (err) {
        console.error('Failed to cache player pitching stats:', err);
      }
    }

    return stats;
  }

  async getBattingStats(playerId: number, year?: number): Promise<BattingStats[]> {
    // Supabase-first path
    if (supabaseDataService.isConfigured) {
      try {
        let params = `select=*&player_id=eq.${playerId}&split_id=eq.1&order=year`;
        if (year) params += `&year=eq.${year}`;
        const rows = await supabaseDataService.query<any>('batting_stats', params);
        return rows.map((r: any) => {
          const ab = r.ab ?? 0;
          const h = r.h ?? 0;
          const bb = r.bb ?? 0;
          const hp = r.hp ?? 0;
          const sf = r.sf ?? 0;
          const d = r.d ?? 0;
          const t = r.t ?? 0;
          const hr = r.hr ?? 0;
          const avg = ab > 0 ? h / ab : 0;
          const obpDenom = ab + bb + hp + sf;
          const obp = obpDenom > 0 ? (h + bb + hp) / obpDenom : 0;
          const tb = h + d + (2 * t) + (3 * hr);
          const slg = ab > 0 ? tb / ab : 0;
          return {
            id: r.id ?? 0,
            playerId: r.player_id,
            year: r.year,
            teamId: r.team_id ?? 0,
            leagueId: r.league_id,
            levelId: r.level_id ?? 0,
            splitId: r.split_id,
            g: r.g ?? 0, ab, pa: r.pa ?? 0, h, d, t, hr,
            r: r.r ?? 0, rbi: r.rbi ?? 0, bb, k: r.k ?? 0,
            sb: r.sb ?? 0, cs: r.cs ?? 0,
            avg, obp, slg, ops: obp + slg,
            war: parseFloat(r.war) || 0,
            ibb: r.ibb ?? 0, hp, sh: r.sh ?? 0, sf, gdp: r.gdp ?? 0,
          } as BattingStats;
        });
      } catch (err) {
        console.warn('Supabase batting stats fetch failed:', err);
        return [];
      }
    }

    // Check cache first
    try {
      const cached = await indexedDBService.getMlbPlayerBattingStats(playerId, year);
      if (cached) {
        const currentYear = await dateService.getCurrentYear();
        const isCurrentYear = year === currentYear || (!year && cached.data.some((s: BattingStats) => s.year === currentYear));
        const currentGameDate = await dateService.getCurrentDate();

        if (!isCurrentYear || cached.gameDate === currentGameDate) {
          console.log(`💾 Loaded player ${playerId}${year ? ` (${year})` : ''} batting stats from cache`);
          return cached.data as BattingStats[];
        } else {
          console.log(`⏰ Cache stale for player ${playerId} batting stats (game date changed), re-fetching...`);
        }
      }
    } catch (err) {
      console.warn('Error checking cache for player batting stats:', err);
    }

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

    const stats = this.parseBattingStatsCsv(csvText);

    // Save to cache
    if (stats.length > 0) {
      try {
        const gameDate = await dateService.getCurrentDate();
        await indexedDBService.saveMlbPlayerBattingStats(playerId, stats, year, gameDate);
        console.log(`💾 Cached player ${playerId}${year ? ` (${year})` : ''} batting stats (${stats.length} records)`);
      } catch (err) {
        console.error('Failed to cache player batting stats:', err);
      }
    }

    return stats;
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
