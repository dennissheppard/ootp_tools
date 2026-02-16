/**
 * StandingsService — loads actual historical standings from CSV files.
 * Used by Standings mode to show projected vs actual W-L for backtesting.
 *
 * CSVs are bundled at build time via Vite's import.meta.glob with ?raw.
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

// Vite bundles these at build time — no runtime fetch needed
const standingsModules = import.meta.glob('/data/*_standings.csv', { query: '?raw', eager: true }) as Record<string, { default: string }>;

class StandingsService {
  private cache = new Map<number, ActualStanding[] | null>();

  /**
   * Load actual standings for a given year.
   * Returns null if no standings file exists for that year.
   */
  getStandings(year: number): ActualStanding[] | null {
    if (this.cache.has(year)) {
      return this.cache.get(year)!;
    }

    const key = `/data/${year}_standings.csv`;
    const mod = standingsModules[key];
    if (!mod) {
      this.cache.set(year, null);
      return null;
    }

    const standings = this.parseCsv(mod.default);
    this.cache.set(year, standings);
    return standings;
  }

  /**
   * Get a lookup map keyed by team nickname.
   */
  getStandingsMap(year: number): Map<string, ActualStanding> | null {
    const standings = this.getStandings(year);
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
