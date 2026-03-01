import { ContractService, Contract } from './ContractService';

// SupabaseDataService is auto-mocked via __mocks__/SupabaseDataService.ts (jest.config moduleNameMapper)

function makeContract(overrides: Partial<Contract> = {}): Contract {
  return {
    playerId: 1,
    teamId: 10,
    leagueId: 200,
    isMajor: true,
    seasonYear: 2021,
    years: 5,
    currentYear: 2,
    salaries: [5000, 6000, 7000, 8000, 9000],
    noTrade: false,
    lastYearTeamOption: false,
    lastYearPlayerOption: false,
    lastYearVestingOption: false,
    ...overrides,
  };
}

function makeService(contracts: [number, Contract][]): ContractService {
  const svc = new ContractService();
  (svc as any).contracts = new Map(contracts);
  return svc;
}

const fixtures: [number, Contract][] = [
  [1, makeContract({ playerId: 1, teamId: 10, years: 5, currentYear: 2, salaries: [5000, 6000, 7000, 8000, 9000] })],
  [2, makeContract({ playerId: 2, teamId: 10, years: 3, currentYear: 2, salaries: [4000, 5000, 6000] })],
  [3, makeContract({ playerId: 3, teamId: 20, years: 6, currentYear: 0, salaries: [10000, 11000, 12000, 13000, 14000, 15000] })],
];

describe('ContractService', () => {
  describe('getYearsRemaining', () => {
    it('calculates years - currentYear', () => {
      const svc = makeService(fixtures);
      expect(svc.getYearsRemaining(fixtures[0][1])).toBe(3); // 5 - 2
      expect(svc.getYearsRemaining(fixtures[2][1])).toBe(6); // 6 - 0
    });
  });

  describe('getFaYear', () => {
    it('calculates gameYear + yearsRemaining', () => {
      const svc = makeService(fixtures);
      expect(svc.getFaYear(fixtures[0][1], 2021)).toBe(2024); // 2021 + 3
    });
  });

  describe('getCurrentSalary', () => {
    it('returns salaries[currentYear]', () => {
      const svc = makeService(fixtures);
      expect(svc.getCurrentSalary(fixtures[0][1])).toBe(7000); // salaries[2]
      expect(svc.getCurrentSalary(fixtures[2][1])).toBe(10000); // salaries[0]
    });
  });

  describe('getSalaryForYear', () => {
    it('returns salary at currentYear + offset', () => {
      const svc = makeService(fixtures);
      const c = fixtures[0][1]; // currentYear=2
      expect(svc.getSalaryForYear(c, 0)).toBe(7000); // salaries[2]
      expect(svc.getSalaryForYear(c, 1)).toBe(8000); // salaries[3]
      expect(svc.getSalaryForYear(c, 2)).toBe(9000); // salaries[4]
    });

    it('returns 0 for out-of-bounds offset', () => {
      const svc = makeService(fixtures);
      const c = fixtures[0][1];
      expect(svc.getSalaryForYear(c, 10)).toBe(0);
      expect(svc.getSalaryForYear(c, -5)).toBe(0);
    });
  });

  describe('isLastContractYear', () => {
    it('true when currentYear === years - 1', () => {
      const svc = makeService(fixtures);
      expect(svc.isLastContractYear(fixtures[1][1])).toBe(true); // currentYear=2, years=3
    });

    it('false otherwise', () => {
      const svc = makeService(fixtures);
      expect(svc.isLastContractYear(fixtures[0][1])).toBe(false); // currentYear=2, years=5
    });
  });

  describe('getContractsByTeam', () => {
    it('filters by teamId', () => {
      const svc = makeService(fixtures);
      const team10 = svc.getContractsByTeam(10);
      expect(team10).toHaveLength(2);
      expect(team10.map(c => c.playerId).sort()).toEqual([1, 2]);
    });

    it('returns empty for unknown team', () => {
      const svc = makeService(fixtures);
      expect(svc.getContractsByTeam(999)).toHaveLength(0);
    });
  });

  describe('getContractsByPlayerIds', () => {
    it('filters subset from cache', async () => {
      const svc = makeService(fixtures);
      const result = await svc.getContractsByPlayerIds([1, 3]);

      expect(result.size).toBe(2);
      expect(result.get(1)?.playerId).toBe(1);
      expect(result.get(3)?.playerId).toBe(3);
    });

    it('returns empty Map for empty input', async () => {
      const svc = makeService(fixtures);
      const result = await svc.getContractsByPlayerIds([]);
      expect(result.size).toBe(0);
    });

    it('skips ids not in cache', async () => {
      const svc = makeService(fixtures);
      const result = await svc.getContractsByPlayerIds([1, 999]);
      expect(result.size).toBe(1);
      expect(result.has(999)).toBe(false);
    });
  });

  describe('hasCachedContracts', () => {
    it('true when populated', () => {
      const svc = makeService(fixtures);
      expect(svc.hasCachedContracts()).toBe(true);
    });

    it('false when empty', () => {
      const svc = makeService([]);
      expect(svc.hasCachedContracts()).toBe(false);
    });
  });
});
