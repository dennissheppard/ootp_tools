import { Team } from '../models/Team';
import { apiFetch } from './ApiClient';
import { indexedDBService } from './IndexedDBService';

const API_BASE = '/api';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 * 30; // 30 days (basically permanent)

export class TeamService {
  private teams: Team[] = [];
  private loading: Promise<Team[]> | null = null;

  async getAllTeams(forceRefresh = false): Promise<Team[]> {
    // Return cached if available
    if (this.teams.length > 0 && !forceRefresh) {
      return this.teams;
    }

    // Check IndexedDB cache
    if (!forceRefresh) {
      const cached = await this.loadFromCache();
      if (cached) {
        this.teams = cached;
        return this.teams;
      }
    }

    // Deduplicate concurrent requests
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.fetchTeams();
    try {
      this.teams = await this.loading;
      await this.saveToCache(this.teams);
      return this.teams;
    } finally {
      this.loading = null;
    }
  }

  async getTeamById(id: number): Promise<Team | undefined> {
    const teams = await this.getAllTeams();
    return teams.find((t) => t.id === id);
  }

  private async fetchTeams(): Promise<Team[]> {
    const response = await apiFetch(`${API_BASE}/teams/`);
    if (!response.ok) {
      throw new Error(`Failed to fetch teams: ${response.statusText}`);
    }

    const csvText = await response.text();
    return this.parseTeamsCsv(csvText);
  }

  private parseTeamsCsv(csv: string): Team[] {
    const lines = csv.trim().split('\n');
    // Skip header row
    const dataLines = lines.slice(1);

    return dataLines.map((line) => {
      const values = this.parseCsvLine(line);
      const leagueId = parseInt(values[4], 10);
      return {
        id: parseInt(values[0], 10),
        name: values[1],
        nickname: values[2],
        parentTeamId: parseInt(values[3], 10),
        leagueId: isNaN(leagueId) ? undefined : leagueId,
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

  private async loadFromCache(): Promise<Team[] | null> {
    try {
      const cached = await indexedDBService.getTeams();
      if (!cached) return null;

      const cacheAge = Date.now() - cached.fetchedAt;
      if (cacheAge > CACHE_DURATION_MS) {
        console.log(`⏰ Teams cache stale (${Math.round(cacheAge / 1000 / 60 / 60 / 24)}d old), re-fetching...`);
        return null;
      }

      return cached.data as Team[];
    } catch (error) {
      console.error('Error loading teams from cache:', error);
      return null;
    }
  }

  private async saveToCache(teams: Team[]): Promise<void> {
    try {
      await indexedDBService.saveTeams(teams);
    } catch (error) {
      console.error('Failed to cache teams:', error);
    }
  }
}

// Singleton instance for convenience
export const teamService = new TeamService();
