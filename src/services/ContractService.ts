import { apiFetch } from './ApiClient';

const API_BASE = '/api';

export interface Contract {
  playerId: number;
  leagueId: number;
}

export class ContractService {
  private contracts: Map<number, Contract> = new Map();
  private loading: Promise<Map<number, Contract>> | null = null;

  async getAllContracts(forceRefresh = false): Promise<Map<number, Contract>> {
    if (this.contracts.size > 0 && !forceRefresh) {
      return this.contracts;
    }

    // Deduplicate concurrent requests
    if (this.loading) {
      return this.loading;
    }

    this.loading = this.fetchContracts();
    try {
      this.contracts = await this.loading;
      return this.contracts;
    } finally {
      this.loading = null;
    }
  }

  private async fetchContracts(): Promise<Map<number, Contract>> {
    console.log('🌐 Fetching contracts from API...');
    const response = await apiFetch(`${API_BASE}/contract/`);
    if (!response.ok) {
      throw new Error(`Failed to fetch contracts: ${response.statusText}`);
    }

    const csvText = await response.text();
    const contracts = this.parseContractsCsv(csvText);
    console.log(`✅ Fetched ${contracts.size} contracts from API`);
    return contracts;
  }

  private parseContractsCsv(csv: string): Map<number, Contract> {
    const lines = csv.trim().split('\n');
    // Skip header row
    const dataLines = lines.slice(1);
    const contractMap = new Map<number, Contract>();

    for (const line of dataLines) {
      // Simple split by comma since we only need the first few numeric fields
      // and they shouldn't contain commas or quotes
      const values = line.split(',');
      const playerId = parseInt(values[0], 10);
      const leagueId = parseInt(values[2], 10);

      if (!isNaN(playerId) && !isNaN(leagueId)) {
        contractMap.set(playerId, { playerId, leagueId });
      }
    }

    return contractMap;
  }
}

export const contractService = new ContractService();
