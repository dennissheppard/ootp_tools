import { batterProjectionService } from './BatterProjectionService';
import { supabaseDataService } from './SupabaseDataService';

jest.mock('./DateService', () => ({
  dateService: {
    getCurrentYear: jest.fn().mockResolvedValue(2021),
  },
}));

describe('BatterProjectionService', () => {
  describe('precomputed fast-path', () => {
    const mockCachedData = {
      projections: [{ playerId: 1, name: 'Test Batter', projectedStats: { war: 5.0, pa: 600, woba: 0.350, avg: 0.280 } }],
      statsYear: 2021,
      usedFallbackStats: false,
      scoutingMetadata: { fromMyScout: 0, fromOSA: 100 },
    };

    afterEach(() => {
      (supabaseDataService as any).isConfigured = false;
      (supabaseDataService as any).hasCustomScouting = false;
      (supabaseDataService.getPrecomputed as jest.Mock).mockReset();
    });

    test('should return precomputed projections when Supabase is configured and no custom scouting', async () => {
      (supabaseDataService as any).isConfigured = true;
      (supabaseDataService as any).hasCustomScouting = false;
      (supabaseDataService.getPrecomputed as jest.Mock).mockResolvedValue(mockCachedData);

      const result = await batterProjectionService.getProjectionsWithContext(2021);

      expect(supabaseDataService.getPrecomputed).toHaveBeenCalledWith('batter_projections');
      expect(result).toBe(mockCachedData);
      expect(result.projections).toHaveLength(1);
      expect(result.projections[0].name).toBe('Test Batter');
    });

    test('should fall through to live computation when hasCustomScouting is true', async () => {
      (supabaseDataService as any).isConfigured = true;
      (supabaseDataService as any).hasCustomScouting = true;

      try {
        await batterProjectionService.getProjectionsWithContext(2021);
      } catch {
        // Expected - dependent services not mocked
      }

      expect(supabaseDataService.getPrecomputed).not.toHaveBeenCalledWith('batter_projections');
    });

    test('should fall through when Supabase returns null (no cached data)', async () => {
      (supabaseDataService as any).isConfigured = true;
      (supabaseDataService as any).hasCustomScouting = false;
      (supabaseDataService.getPrecomputed as jest.Mock).mockResolvedValue(null);

      try {
        await batterProjectionService.getProjectionsWithContext(2021);
      } catch {
        // Expected - dependent services not mocked
      }

      expect(supabaseDataService.getPrecomputed).toHaveBeenCalledWith('batter_projections');
    });
  });
});
