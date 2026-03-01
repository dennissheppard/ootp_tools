/**
 * StandingsService — loads actual historical standings from CSV files.
 * Used by Standings mode to show projected vs actual W-L for backtesting.
 *
 * CSVs are lazy-loaded on demand via Vite's import.meta.glob.
 * Team names in CSVs must match the team nicknames used in the app.
 */

export interface ActualStanding {
  rank: number;
  teamName: string;
  wins: number;
  losses: number;
  batterWar: number;
  pitcherWar: number;
  totalWar: number;
}

// Lazy loaders — each CSV is only fetched when getStandings(year) is first called
const standingsModules = import.meta.glob('/data/*_standings.csv', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

class StandingsService {
  private cache = new Map<number, ActualStanding[] | null>();

  /**
   * Load actual standings for a given year.
   * Returns null if no standings file exists for that year.
   */
  async getStandings(year: number): Promise<ActualStanding[] | null> {
    if (this.cache.has(year)) {
      return this.cache.get(year)!;
    }

    const key = `/data/${year}_standings.csv`;
    const loader = standingsModules[key];
    if (!loader) {
      this.cache.set(year, null);
      return null;
    }

    const csv = await loader();
    const standings = this.parseCsv(csv);
    this.cache.set(year, standings);
    return standings;
  }

  /**
   * Get a lookup map keyed by team nickname.
   */
  async getStandingsMap(year: number): Promise<Map<string, ActualStanding> | null> {
    const standings = await this.getStandings(year);
    if (!standings) return null;

    const map = new Map<string, ActualStanding>();
    for (const s of standings) {
      map.set(s.teamName, s);
    }
    return map;
  }

  private parseCsv(text: string): ActualStanding[] {
    const lines = text.trim().split('\n');
    // Skip header: #,Team,W,L,BatterWAR,PitcherWAR,TotalWAR,Wins -WAR
    return lines.slice(1).map(line => {
      const parts = line.split(',');
      return {
        rank: parseInt(parts[0], 10),
        teamName: parts[1].trim(),
        wins: parseInt(parts[2], 10),
        losses: parseInt(parts[3], 10),
        batterWar: parseFloat(parts[4]),
        pitcherWar: parseFloat(parts[5]),
        totalWar: parseFloat(parts[6]),
      };
    });
  }
}

export const standingsService = new StandingsService();
