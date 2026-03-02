import { Player, Position } from '../models/Player';
import { apiFetch } from './ApiClient';
import { indexedDBService } from './IndexedDBService';
import { dateService } from './DateService';
import { supabaseDataService } from './SupabaseDataService';

const API_BASE = '/api';

export class PlayerService {
  private players: Player[] = [];
  private loading: Promise<Player[]> | null = null;

  async getAllPlayers(forceRefresh = false): Promise<Player[]> {
    // Return cached if available
    if (this.players.length > 0 && !forceRefresh) {
      return this.players;
    }
    // Check IndexedDB cache (skip when Supabase is configured — query on-demand instead)
    if (!forceRefresh && !supabaseDataService.isConfigured) {
      const cached = await this.loadFromCache();
      if (cached) {
        this.players = cached;
        console.log(`📦 Loaded ${this.players.length} players into in-memory cache`);
        return this.players;
      }
    }

    // Deduplicate concurrent requests
    if (this.loading) {
      console.log('⏳ Already loading players, waiting for existing request...');
      return this.loading;
    }

    this.loading = this.fetchPlayers();
    try {
      this.players = await this.loading;
      if (!supabaseDataService.isConfigured) {
        await this.saveToCache(this.players);
      }
      return this.players;
    } finally {
      this.loading = null;
    }
  }

  hasCachedPlayers(): boolean {
    return this.players.length > 0;
  }

  async getPlayerNamesByIds(ids: number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();

    // If already cached, use cache
    if (this.players.length > 0) {
      const map = new Map<number, string>();
      const idSet = new Set(ids);
      for (const p of this.players) {
        if (idSet.has(p.id)) map.set(p.id, `${p.firstName} ${p.lastName}`);
      }
      return map;
    }

    // Targeted Supabase query by IDs
    if (supabaseDataService.isConfigured) {
      try {
        const idList = ids.join(',');
        const rows = await supabaseDataService.query<any>('players', `select=id,first_name,last_name&id=in.(${idList})`);
        const map = new Map<number, string>();
        for (const r of rows) {
          map.set(r.id, `${r.first_name} ${r.last_name}`);
        }
        return map;
      } catch { /* fall through */ }
    }

    // Fallback: load all
    const players = await this.getAllPlayers();
    const map = new Map<number, string>();
    const idSet = new Set(ids);
    for (const p of players) {
      if (idSet.has(p.id)) map.set(p.id, `${p.firstName} ${p.lastName}`);
    }
    return map;
  }

  async getPlayerInfoByIds(ids: number[]): Promise<Map<number, { name: string; position: number }>> {
    if (ids.length === 0) return new Map();

    if (this.players.length > 0) {
      const map = new Map<number, { name: string; position: number }>();
      const idSet = new Set(ids);
      for (const p of this.players) {
        if (idSet.has(p.id)) map.set(p.id, { name: `${p.firstName} ${p.lastName}`, position: p.position });
      }
      return map;
    }

    if (supabaseDataService.isConfigured) {
      try {
        const idList = ids.join(',');
        const rows = await supabaseDataService.query<any>('players', `select=id,first_name,last_name,position&id=in.(${idList})`);
        const map = new Map<number, { name: string; position: number }>();
        for (const r of rows) {
          map.set(r.id, { name: `${r.first_name} ${r.last_name}`, position: r.position ?? 0 });
        }
        return map;
      } catch { /* fall through */ }
    }

    const players = await this.getAllPlayers();
    const map = new Map<number, { name: string; position: number }>();
    const idSet = new Set(ids);
    for (const p of players) {
      if (idSet.has(p.id)) map.set(p.id, { name: `${p.firstName} ${p.lastName}`, position: p.position });
    }
    return map;
  }

  async getPlayersByIds(ids: number[]): Promise<Player[]> {
    if (ids.length === 0) return [];

    // If full cache exists, use it
    if (this.players.length > 0) {
      const idSet = new Set(ids);
      return this.players.filter(p => idSet.has(p.id));
    }

    // Supabase: targeted query by IDs
    if (supabaseDataService.isConfigured) {
      try {
        const idList = ids.join(',');
        const rows = await supabaseDataService.query<any>('players',
          `select=*&first_name=not.is.null&id=in.(${idList})`);
        if (rows.length > 0) {
          return rows.map((r: any) => ({
            id: r.id,
            firstName: r.first_name,
            lastName: r.last_name,
            teamId: r.team_id,
            parentTeamId: r.parent_team_id,
            level: typeof r.level === 'string' ? parseInt(r.level, 10) : r.level,
            position: r.position as Position,
            role: r.role,
            age: r.age,
            retired: r.retired ?? false,
          }));
        }
      } catch { /* fall through */ }
    }

    // Fallback: load all and filter
    const all = await this.getAllPlayers();
    const idSet = new Set(ids);
    return all.filter(p => idSet.has(p.id));
  }

  async getPlayersByOrgId(orgTeamId: number): Promise<Player[]> {
    // If full cache exists, just filter it
    if (this.players.length > 0) {
      return this.players.filter(p => p.teamId === orgTeamId || p.parentTeamId === orgTeamId);
    }

    // Supabase: targeted query — 1 request for ~40 players
    if (supabaseDataService.isConfigured) {
      try {
        const rows = await supabaseDataService.query<any>('players',
          `select=*&first_name=not.is.null&or=(team_id.eq.${orgTeamId},parent_team_id.eq.${orgTeamId})`);
        if (rows.length > 0) {
          return rows.map((r: any) => ({
            id: r.id,
            firstName: r.first_name,
            lastName: r.last_name,
            teamId: r.team_id,
            parentTeamId: r.parent_team_id,
            level: typeof r.level === 'string' ? parseInt(r.level, 10) : r.level,
            position: r.position as Position,
            role: r.role,
            age: r.age,
            retired: r.retired ?? false,
          }));
        }
      } catch { /* fall through */ }
    }

    // Fallback: load all and filter
    const all = await this.getAllPlayers();
    return all.filter(p => p.teamId === orgTeamId || p.parentTeamId === orgTeamId);
  }

  async searchPlayers(query: string): Promise<Player[]> {
    const players = await this.getAllPlayers();
    const normalizedQuery = query.toLowerCase().trim();

    if (!normalizedQuery) {
      return [];
    }

    return players.filter((player) => {
      const fullName = `${player.firstName} ${player.lastName}`.toLowerCase();
      const reverseName = `${player.lastName} ${player.firstName}`.toLowerCase();
      return (
        fullName.includes(normalizedQuery) ||
        reverseName.includes(normalizedQuery) ||
        player.firstName.toLowerCase().includes(normalizedQuery) ||
        player.lastName.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  async getPlayerById(id: number): Promise<Player | undefined> {
    // If players are already cached, use the cache
    if (this.players && this.players.length > 0) {
      return this.players.find((p) => p.id === id);
    }

    // Supabase: query single player instead of fetching all 15k+
    if (supabaseDataService.isConfigured) {
      try {
        const rows = await supabaseDataService.query<any>('players', `select=*&id=eq.${id}`);
        if (rows.length > 0) {
          const r = rows[0];
          return {
            id: r.id,
            firstName: r.first_name,
            lastName: r.last_name,
            teamId: r.team_id,
            parentTeamId: r.parent_team_id,
            level: typeof r.level === 'string' ? parseInt(r.level, 10) : r.level,
            position: r.position as Position,
            role: r.role,
            age: r.age,
            retired: r.retired ?? false,
          };
        }
      } catch {
        // Fall through to bulk fetch
      }
    }

    // Fallback: load all players and find
    const players = await this.getAllPlayers();
    return players.find((p) => p.id === id);
  }

  /** Lightweight batch age lookup — single Supabase query for select=id,age */
  async getPlayerAges(playerIds: number[]): Promise<Map<number, number>> {
    if (playerIds.length === 0) return new Map();

    // If full cache exists, use it
    if (this.players.length > 0) {
      const map = new Map<number, number>();
      const idSet = new Set(playerIds);
      for (const p of this.players) {
        if (idSet.has(p.id)) map.set(p.id, p.age);
      }
      return map;
    }

    // Supabase: targeted lightweight query
    if (supabaseDataService.isConfigured) {
      try {
        const idList = playerIds.join(',');
        const rows = await supabaseDataService.query<{ id: number; age: number }>(
          'players', `select=id,age&id=in.(${idList})`);
        const map = new Map<number, number>();
        for (const r of rows) map.set(r.id, typeof r.age === 'string' ? parseInt(r.age, 10) : r.age);
        return map;
      } catch { /* fall through */ }
    }

    return new Map();
  }

  private async fetchPlayers(): Promise<Player[]> {
    // Try Supabase first
    if (supabaseDataService.isConfigured) {
      try {
        const rows = await supabaseDataService.getPlayers();
        if (rows.length > 0) {
          // Players loaded from Supabase
          return rows.map((r: any) => ({
            id: r.id,
            firstName: r.first_name,
            lastName: r.last_name,
            teamId: r.team_id,
            parentTeamId: r.parent_team_id,
            level: typeof r.level === 'string' ? parseInt(r.level, 10) : r.level,
            position: r.position as Position,
            role: r.role,
            age: r.age,
            retired: r.retired ?? false,
          }));
        } else {
          console.warn('⚠️ Supabase returned 0 players. Run: npx tsx tools/sync-db.ts');
        }
      } catch (err) {
        console.warn('⚠️ Supabase player fetch failed, falling back to API:', err);
      }

      // Supabase is configured but returned no data — don't fall through to API
      console.warn('⚠️ Supabase returned no player data and API fallback is disabled');
      return [];
    }

    console.log('🌐 Fetching players from API...');
    const response = await apiFetch(`${API_BASE}/players/`);
    if (!response.ok) {
      throw new Error(`Failed to fetch players: ${response.statusText}`);
    }

    const csvText = await response.text();
    const players = this.parsePlayersCsv(csvText);
    console.log(`✅ Fetched ${players.length} players from API`);

    return players;
  }

  private parsePlayersCsv(csv: string): Player[] {
    const lines = csv.trim().split('\n');
    // Skip header row
    const dataLines = lines.slice(1);

    return dataLines.map((line) => {
      const values = this.parseCsvLine(line);
      return {
        id: parseInt(values[0], 10),
        firstName: values[1],
        lastName: values[2],
        teamId: parseInt(values[3], 10),
        parentTeamId: parseInt(values[4], 10),
        level: parseInt(values[5], 10),
        position: parseInt(values[6], 10) as Position,
        role: parseInt(values[7], 10),
        age: parseInt(values[8], 10),
        retired: values[9]?.trim() === '1',
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

  private async loadFromCache(): Promise<Player[] | null> {
    try {
      const cached = await indexedDBService.getPlayers();
      if (!cached) return null;

      const currentGameDate = await dateService.getCurrentDate();
      if (cached.gameDate !== currentGameDate) return null;

      return cached.data as Player[];
    } catch {
      return null;
    }
  }

  private async saveToCache(players: Player[]): Promise<void> {
    try {
      const gameDate = await dateService.getCurrentDate();
      await indexedDBService.savePlayers(players, gameDate);
    } catch {
      // cache save failed — non-fatal
    }
  }
}

// Singleton instance for convenience
export const playerService = new PlayerService();
