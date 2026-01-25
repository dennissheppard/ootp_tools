import { Team } from '../models/Team';

const API_BASE = '/api';
const CACHE_KEY = 'wbl_teams_cache';
const CACHE_TIMESTAMP_KEY = 'wbl_teams_cache_timestamp';
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 * 30; // 30 days (permanent-ish)

export class TeamService {
  private teams: Team[] = [];
  private loading: Promise<Team[]> | null = null;

  async getAllTeams(forceRefresh = false): Promise<Team[]> {
    // Return cached if available
    if (this.teams.length > 0 && !forceRefresh) {
      return this.teams;
    }

    // Check localStorage cache
    if (!forceRefresh) {
      const cached = this.loadFromCache();
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
      this.saveToCache(this.teams);
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
    const response = await fetch(`${API_BASE}/teams/`);
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
      return {
        id: parseInt(values[0], 10),
        name: values[1],
        nickname: values[2],
        parentTeamId: parseInt(values[3], 10),
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

  private loadFromCache(): Team[] | null {
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

  private saveToCache(teams: Team[]): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(teams));
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
export const teamService = new TeamService();
