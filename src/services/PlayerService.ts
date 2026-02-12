import { Player, Position } from '../models/Player';
import { apiFetch } from './ApiClient';
import { indexedDBService } from './IndexedDBService';
import { dateService } from './DateService';

const API_BASE = '/api';

export class PlayerService {
  private players: Player[] = [];
  private loading: Promise<Player[]> | null = null;

  constructor() {
    console.log('🏗️ PlayerService instance created');
  }

  async getAllPlayers(forceRefresh = false): Promise<Player[]> {
    console.log(`📞 getAllPlayers called (forceRefresh=${forceRefresh}, in-memory cache=${this.players.length} players)`);

    // Return cached if available
    if (this.players.length > 0 && !forceRefresh) {
      console.log(`⚡ Returning ${this.players.length} players from in-memory cache`);
      return this.players;
    }

    // Check IndexedDB cache
    if (!forceRefresh) {
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
      await this.saveToCache(this.players);
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
      console.log('🔍 Checking IndexedDB for players cache...');
      const cached = await indexedDBService.getPlayers();
      if (!cached) {
        console.log('❌ No players cache found in IndexedDB');
        return null;
      }

      const currentGameDate = await dateService.getCurrentDate();
      if (cached.gameDate !== currentGameDate) {
        console.log(`⏰ Players cache stale (game date changed), re-fetching...`);
        return null;
      }

      console.log(`✅ Using cached players (${cached.data.length} players)`);
      return cached.data as Player[];
    } catch (error) {
      console.error('❌ Error loading players from cache:', error);
      return null;
    }
  }

  private async saveToCache(players: Player[]): Promise<void> {
    try {
      const gameDate = await dateService.getCurrentDate();
      console.log(`💾 Saving ${players.length} players to IndexedDB cache...`);
      await indexedDBService.savePlayers(players, gameDate);
      console.log('✅ Players cached successfully');
    } catch (error) {
      console.error('❌ Failed to cache players:', error);
    }
  }
}

// Singleton instance for convenience
export const playerService = new PlayerService();
