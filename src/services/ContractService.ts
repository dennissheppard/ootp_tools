import { apiFetch } from './ApiClient';
import { dateService } from './DateService';

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
