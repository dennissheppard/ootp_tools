import { apiFetch } from './ApiClient';
import { dateService } from './DateService';
import { supabaseDataService } from './SupabaseDataService';

const API_BASE = '/api';
const CACHE_KEY = 'wbl_contracts_cache';

export interface Contract {
  playerId: number;
  teamId: number;
  leagueId: number;
  isMajor: boolean;
  seasonYear: number;
  years: number;
  currentYear: number;
  salaries: number[];
  noTrade: boolean;
  lastYearTeamOption: boolean;
  lastYearPlayerOption: boolean;
  lastYearVestingOption: boolean;
}

interface CacheEnvelope {
  data: Array<[number, Contract]>;
  fetchedAt: number;
  gameDate?: string;
}

export class ContractService {
  private contracts: Map<number, Contract> = new Map();
  private loading: Promise<Map<number, Contract>> | null = null;

  async getAllContracts(forceRefresh = false): Promise<Map<number, Contract>> {
    if (this.contracts.size > 0 && !forceRefresh) {
      return this.contracts;
    }
    console.trace('📦 getAllContracts — bulk load triggered');

    // Try localStorage cache first
    if (!forceRefresh) {
      const cached = await this.loadFromCache();
      if (cached) {
        this.contracts = cached;
        return this.contracts;
      }
    }

    // Deduplicate concurrent requests
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.fetchContracts();
    try {
      this.contracts = await this.loading;
      await this.saveToCache(this.contracts);
      return this.contracts;
    } finally {
      this.loading = null;
    }
  }

  async getContractForPlayer(playerId: number): Promise<Contract | undefined> {
    // If already cached, use cache
    if (this.contracts.size > 0) {
      return this.contracts.get(playerId);
    }

    // Supabase: query single player's contract instead of fetching all
    if (supabaseDataService.isConfigured) {
      try {
        const rows = await supabaseDataService.query<any>('contracts', `select=*&player_id=eq.${playerId}`);
        if (rows.length > 0) {
          const r = rows[0];
          return {
            playerId: r.player_id,
            teamId: r.team_id ?? 0,
            leagueId: r.league_id ?? 0,
            isMajor: r.is_major ?? false,
            seasonYear: r.season_year ?? 0,
            years: r.years ?? 0,
            currentYear: r.current_year ?? 0,
            salaries: r.salaries ?? [],
            noTrade: r.no_trade ?? false,
            lastYearTeamOption: r.last_year_team_option ?? false,
            lastYearPlayerOption: r.last_year_player_option ?? false,
            lastYearVestingOption: r.last_year_vesting_option ?? false,
          };
        }
        return undefined;
      } catch {
        // Fall through to bulk fetch
      }
    }

    // Fallback: load all and find
    const all = await this.getAllContracts();
    return all.get(playerId);
  }

  async getContractsByPlayerIds(playerIds: number[]): Promise<Map<number, Contract>> {
    if (playerIds.length === 0) return new Map();

    // If full cache exists, filter it
    if (this.contracts.size > 0) {
      const result = new Map<number, Contract>();
      const idSet = new Set(playerIds);
      for (const [pid, c] of this.contracts) {
        if (idSet.has(pid)) result.set(pid, c);
      }
      return result;
    }

    // Supabase: targeted query
    if (supabaseDataService.isConfigured) {
      try {
        const idList = playerIds.join(',');
        const rows = await supabaseDataService.query<any>('contracts', `select=*&player_id=in.(${idList})`);
        const result = new Map<number, Contract>();
        for (const r of rows) {
          result.set(r.player_id, {
            playerId: r.player_id,
            teamId: r.team_id,
            leagueId: r.league_id,
            isMajor: r.is_major,
            seasonYear: r.season_year,
            years: r.years,
            currentYear: r.current_year,
            salaries: Array.isArray(r.salaries) ? r.salaries : [],
            noTrade: r.no_trade,
            lastYearTeamOption: r.last_year_team_option,
            lastYearPlayerOption: r.last_year_player_option,
            lastYearVestingOption: r.last_year_vesting_option,
          });
        }
        return result;
      } catch { /* fall through */ }
    }

    // Fallback: load all and filter
    const all = await this.getAllContracts();
    const result = new Map<number, Contract>();
    const idSet = new Set(playerIds);
    for (const [pid, c] of all) {
      if (idSet.has(pid)) result.set(pid, c);
    }
    return result;
  }

  hasCachedContracts(): boolean {
    return this.contracts.size > 0;
  }

  getYearsRemaining(contract: Contract): number {
    return contract.years - contract.currentYear;
  }

  getFaYear(contract: Contract, gameYear: number): number {
    return gameYear + this.getYearsRemaining(contract);
  }

  getCurrentSalary(contract: Contract): number {
    return contract.salaries[contract.currentYear] ?? 0;
  }

  getSalaryForYear(contract: Contract, yearOffset: number): number {
    return contract.salaries[contract.currentYear + yearOffset] ?? 0;
  }

  isLastContractYear(contract: Contract): boolean {
    return contract.currentYear === contract.years - 1;
  }

  getContractsByTeam(teamId: number): Contract[] {
    const result: Contract[] = [];
    for (const contract of this.contracts.values()) {
      if (contract.teamId === teamId) {
        result.push(contract);
      }
    }
    return result;
  }

  private async loadFromCache(): Promise<Map<number, Contract> | null> {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;

      const envelope: CacheEnvelope = JSON.parse(raw);
      const currentGameDate = await dateService.getCurrentDate();
      if (envelope.gameDate !== currentGameDate) {
        localStorage.removeItem(CACHE_KEY);
        return null;
      }

      console.log('Loaded contracts from localStorage cache');
      return new Map(envelope.data);
    } catch {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
  }

  private async saveToCache(contracts: Map<number, Contract>): Promise<void> {
    try {
      const gameDate = await dateService.getCurrentDate();
      const envelope: CacheEnvelope = {
        data: Array.from(contracts.entries()),
        fetchedAt: Date.now(),
        gameDate,
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(envelope));
    } catch {
      // localStorage full or unavailable — ignore
    }
  }

  private async fetchContracts(): Promise<Map<number, Contract>> {
    // Try Supabase first
    if (supabaseDataService.isConfigured) {
      try {
        const rows = await supabaseDataService.getContracts();
        if (rows.length > 0) {
          // Contracts loaded from Supabase
          const contractMap = new Map<number, Contract>();
          for (const r of rows) {
            contractMap.set(r.player_id, {
              playerId: r.player_id,
              teamId: r.team_id,
              leagueId: r.league_id,
              isMajor: r.is_major,
              seasonYear: r.season_year,
              years: r.years,
              currentYear: r.current_year,
              salaries: Array.isArray(r.salaries) ? r.salaries : [],
              noTrade: r.no_trade,
              lastYearTeamOption: r.last_year_team_option,
              lastYearPlayerOption: r.last_year_player_option,
              lastYearVestingOption: r.last_year_vesting_option,
            });
          }
          return contractMap;
        }
      } catch (err) {
        console.warn('⚠️ Supabase contract fetch failed, falling back to API:', err);
      }

      // Supabase is configured but returned no data — don't fall through to API
      console.warn('⚠️ Supabase returned no contract data and API fallback is disabled');
      return new Map();
    }

    console.log('Fetching contracts from API...');
    const response = await apiFetch(`${API_BASE}/contract/`);
    if (!response.ok) {
      throw new Error(`Failed to fetch contracts: ${response.statusText}`);
    }

    const csvText = await response.text();
    const contracts = this.parseContractsCsv(csvText);
    console.log(`Fetched ${contracts.size} contracts from API`);

    return contracts;
  }

  // CSV columns (40 total):
  // 0: player_id, 1: team_id, 2: league_id, 3: is_major, 4: no_trade,
  // 5: last_year_team_option, 6: last_year_player_option, 7: last_year_vesting_option,
  // 8-10: next_last_year_*_option, 11: contract_team_id, 12: contract_league_id,
  // 13: season_year, 14-28: salary0-salary14, 29: years, 30: current_year,
  // 31-39: bonus/buyout fields
  private parseContractsCsv(csv: string): Map<number, Contract> {
    const lines = csv.trim().split('\n');
    const dataLines = lines.slice(1);
    const contractMap = new Map<number, Contract>();

    for (const line of dataLines) {
      const v = line.split(',');
      const playerId = parseInt(v[0], 10);
      if (isNaN(playerId)) continue;

      const salaries: number[] = [];
      for (let i = 14; i <= 28; i++) {
        salaries.push(parseInt(v[i], 10) || 0);
      }

      contractMap.set(playerId, {
        playerId,
        teamId: parseInt(v[1], 10) || 0,
        leagueId: parseInt(v[2], 10) || 0,
        isMajor: v[3] === '1' || v[3]?.toLowerCase() === 'true',
        seasonYear: parseInt(v[13], 10) || 0,
        years: parseInt(v[29], 10) || 0,
        currentYear: parseInt(v[30], 10) || 0,
        salaries,
        noTrade: v[4] === '1' || v[4]?.toLowerCase() === 'true',
        lastYearTeamOption: v[5] === '1' || v[5]?.toLowerCase() === 'true',
        lastYearPlayerOption: v[6] === '1' || v[6]?.toLowerCase() === 'true',
        lastYearVestingOption: v[7] === '1' || v[7]?.toLowerCase() === 'true',
      });
    }

    return contractMap;
  }
}

export const contractService = new ContractService();
