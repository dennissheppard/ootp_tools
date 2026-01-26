import { Player, Position } from '../models/Player';

const API_BASE = '/api';
const CACHE_KEY = 'wbl_players_cache';
const CACHE_TIMESTAMP_KEY = 'wbl_players_cache_timestamp';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

export class PlayerService {
  private players: Player[] = [];
  private loading: Promise<Player[]> | null = null;

  async getAllPlayers(forceRefresh = false): Promise<Player[]> {
    // Return cached if available
    if (this.players.length > 0 && !forceRefresh) {
      return this.players;
    }

    // Check localStorage cache
    if (!forceRefresh) {
      const cached = this.loadFromCache();
      if (cached) {
        this.players = cached;
        return this.players;
      }
    }

    // Deduplicate concurrent requests
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.fetchPlayers();
    try {
      this.players = await this.loading;
      this.saveToCache(this.players);
      return this.players;
    } finally {
      this.loading = null;
    }
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
    const players = await this.getAllPlayers();
    return players.find((p) => p.id === id);
  }

  private async fetchPlayers(): Promise<Player[]> {
    const response = await fetch(`${API_BASE}/players/`);
    if (!response.ok) {
      throw new Error(`Failed to fetch players: ${response.statusText}`);
    }

    const csvText = await response.text();
    return this.parsePlayersCsv(csvText);
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

  private loadFromCache(): Player[] | null {
    try {
      const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
      if (!timestamp) return null;

      const cacheAge = Date.now() - parseInt(timestamp, 10);
      if (cacheAge > CACHE_DURATION_MS) {
        this.clearCache();
        return null;
      }

      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      return JSON.parse(cached);
    } catch {
      this.clearCache();
      return null;
    }
  }

  private saveToCache(players: Player[]): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(players));
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    } catch {
      // Cache write failed (e.g., quota exceeded), ignore
    }
  }

  private clearCache(): void {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
  }
}

// Singleton instance for convenience
export const playerService = new PlayerService();
