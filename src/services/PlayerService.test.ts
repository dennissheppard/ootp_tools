import { PlayerService } from './PlayerService';
import { Player, Position } from '../models/Player';

// SupabaseDataService is auto-mocked via __mocks__/SupabaseDataService.ts (jest.config moduleNameMapper)

const fixtures: Player[] = [
  { id: 1, firstName: 'Mike', lastName: 'Trout', teamId: 10, parentTeamId: 10, level: 1, position: Position.CenterField, role: 0, age: 30, retired: false },
  { id: 2, firstName: 'Shohei', lastName: 'Ohtani', teamId: 10, parentTeamId: 10, level: 1, position: Position.DesignatedHitter, role: 0, age: 28, retired: false },
  { id: 3, firstName: 'Juan', lastName: 'Soto', teamId: 20, parentTeamId: 20, level: 1, position: Position.RightField, role: 0, age: 24, retired: false },
  { id: 4, firstName: 'Bobby', lastName: 'Miller', teamId: 31, parentTeamId: 10, level: 2, position: Position.Pitcher, role: 11, age: 23, retired: false },
  { id: 5, firstName: 'Ronald', lastName: 'Acuna', teamId: 30, parentTeamId: 30, level: 1, position: Position.RightField, role: 0, age: 25, retired: false },
];

function makeService(): PlayerService {
  const svc = new PlayerService();
  (svc as any).players = [...fixtures];
  return svc;
}

describe('PlayerService', () => {
  describe('getPlayerNamesByIds', () => {
    it('returns Map<id, "First Last"> from cache', async () => {
      const svc = makeService();
      const result = await svc.getPlayerNamesByIds([1, 3]);

      expect(result.size).toBe(2);
      expect(result.get(1)).toBe('Mike Trout');
      expect(result.get(3)).toBe('Juan Soto');
    });

    it('returns empty Map for empty input', async () => {
      const svc = makeService();
      const result = await svc.getPlayerNamesByIds([]);
      expect(result.size).toBe(0);
    });

    it('skips ids not in cache', async () => {
      const svc = makeService();
      const result = await svc.getPlayerNamesByIds([1, 999]);
      expect(result.size).toBe(1);
      expect(result.has(999)).toBe(false);
    });
  });

  describe('getPlayerInfoByIds', () => {
    it('returns Map with {name, position} from cache', async () => {
      const svc = makeService();
      const result = await svc.getPlayerInfoByIds([2, 4]);

      expect(result.size).toBe(2);
      expect(result.get(2)).toEqual({ name: 'Shohei Ohtani', position: Position.DesignatedHitter });
      expect(result.get(4)).toEqual({ name: 'Bobby Miller', position: Position.Pitcher });
    });

    it('returns empty Map for empty input', async () => {
      const svc = makeService();
      const result = await svc.getPlayerInfoByIds([]);
      expect(result.size).toBe(0);
    });
  });

  describe('getPlayersByOrgId', () => {
    it('filters by teamId OR parentTeamId', async () => {
      const svc = makeService();
      const result = await svc.getPlayersByOrgId(10);

      // teamId=10: Trout, Ohtani; parentTeamId=10: Miller
      expect(result).toHaveLength(3);
      const ids = result.map(p => p.id).sort();
      expect(ids).toEqual([1, 2, 4]);
    });

    it('returns empty for non-existent org', async () => {
      const svc = makeService();
      const result = await svc.getPlayersByOrgId(999);
      expect(result).toHaveLength(0);
    });
  });

  describe('searchPlayers', () => {
    it('matches first name (case-insensitive)', async () => {
      const svc = makeService();
      const result = await svc.searchPlayers('mike');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('matches last name', async () => {
      const svc = makeService();
      const result = await svc.searchPlayers('Soto');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3);
    });

    it('matches full name', async () => {
      const svc = makeService();
      const result = await svc.searchPlayers('Shohei Ohtani');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it('matches reverse name order', async () => {
      const svc = makeService();
      const result = await svc.searchPlayers('Trout Mike');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('returns [] for empty query', async () => {
      const svc = makeService();
      const result = await svc.searchPlayers('');
      expect(result).toHaveLength(0);
    });

    it('returns [] for whitespace-only query', async () => {
      const svc = makeService();
      const result = await svc.searchPlayers('   ');
      expect(result).toHaveLength(0);
    });
  });

  describe('hasCachedPlayers', () => {
    it('true when populated', () => {
      const svc = makeService();
      expect(svc.hasCachedPlayers()).toBe(true);
    });

    it('false when empty', () => {
      const svc = new PlayerService();
      expect(svc.hasCachedPlayers()).toBe(false);
    });
  });
});
