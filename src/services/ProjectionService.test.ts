import { projectionService } from './ProjectionService';
import { supabaseDataService } from './SupabaseDataService';

jest.mock('./DateService', () => ({
  dateService: {
    getCurrentYear: jest.fn().mockResolvedValue(2021),
  },
}));

describe('ProjectionService', () => {
  const mockLeagueContext = {
    fipConstant: 3.10,
    avgFip: 4.00,
    runsPerWin: 9.0
  };

  const mockRatings = { stuff: 50, control: 50, hra: 50 };

  test('should calculate higher IP for high stamina SP', async () => {
    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      3,
      0,
      mockLeagueContext,
      80,
      'Normal',
      undefined,
      3.0
    );

    expect(result.projectedStats.ip).toBeGreaterThan(200);
  });

  test('should calculate lower IP for low stamina SP', async () => {
    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      3,
      0,
      mockLeagueContext,
      40,
      'Normal',
      undefined,
      3.0
    );

    expect(result.projectedStats.ip).toBeGreaterThan(100);
    expect(result.projectedStats.ip).toBeLessThan(170);
  });

  test('should calculate lower IP for Reliever', async () => {
    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      2,
      0,
      mockLeagueContext,
      80,
      'Normal'
    );

    expect(result.projectedStats.ip).toBeCloseTo(78, 0);
  });

  test('should apply injury penalties', async () => {
    const normal = await projectionService.calculateProjection(
      mockRatings,
      25,
      3,
      0,
      mockLeagueContext,
      50,
      'Normal',
      undefined,
      3.0
    );

    const wrecked = await projectionService.calculateProjection(
      mockRatings,
      25,
      3,
      0,
      mockLeagueContext,
      50,
      'Wrecked',
      undefined,
      3.0
    );

    expect(normal.projectedStats.ip).toBeGreaterThan(wrecked.projectedStats.ip);
    expect(wrecked.projectedStats.ip).toBeLessThan(normal.projectedStats.ip * 0.85);
  });

  test('should default to RP if stamina is missing or low with minimal pitches', async () => {
    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      2,
      0,
      mockLeagueContext,
      undefined,
      'Normal'
    );
    expect(result.projectedStats.ip).toBeLessThan(60);
  });

  test('should handle ramp-up scenario (95 IP -> 186 IP) correctly', async () => {
    const historicalStats = [
        { year: 2024, ip: 186, gs: 30, k9: 8, bb9: 3, hr9: 1 },
        { year: 2023, ip: 95, gs: 15, k9: 8, bb9: 3, hr9: 1 }
    ];

    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      3,
      30,
      mockLeagueContext,
      60,
      'Normal',
      historicalStats,
      3.0
    );

    expect(result.projectedStats.ip).toBeGreaterThan(170);
  });

  test('should populate projection trace when provided', async () => {
    const trace: import('./ProjectionService').ProjectionCalculationTrace = {};
    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      3,
      0,
      mockLeagueContext,
      60,
      'Normal',
      undefined,
      3.0,
      undefined,
      trace
    );

    expect(trace.projectedRatings).toBeDefined();
    expect(trace.ipPipeline?.output?.ip).toBe(result.projectedStats.ip);
    expect(trace.output?.projectedStats.ip).toBe(result.projectedStats.ip);
  });

  describe('precomputed fast-path', () => {
    const mockCachedData = {
      projections: [{ playerId: 1, name: 'Test Player', projectedStats: { fip: 3.50, war: 4.0, ip: 180, k9: 9.0, bb9: 3.0, hr9: 1.0 } }],
      statsYear: 2021,
      usedFallbackStats: false,
      totalCurrentIp: 5000,
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

      const result = await projectionService.getProjectionsWithContext(2021);

      expect(supabaseDataService.getPrecomputed).toHaveBeenCalledWith('pitcher_projections');
      expect(result).toBe(mockCachedData);
      expect(result.projections).toHaveLength(1);
      expect(result.projections[0].name).toBe('Test Player');
    });

    test('should fall through to live computation when hasCustomScouting is true', async () => {
      (supabaseDataService as any).isConfigured = true;
      (supabaseDataService as any).hasCustomScouting = true;

      try {
        await projectionService.getProjectionsWithContext(2021);
      } catch {
        // Expected - dependent services not mocked
      }

      expect(supabaseDataService.getPrecomputed).not.toHaveBeenCalledWith('pitcher_projections');
    });
  });
});
