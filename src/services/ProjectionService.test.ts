import { projectionService } from './ProjectionService';

describe('ProjectionService', () => {
  const mockLeagueContext = {
    fipConstant: 3.10,
    avgFip: 4.00,
    runsPerWin: 9.0
  };

  const mockRatings = { stuff: 50, control: 50, hra: 50 };

  test('should calculate higher IP for high stamina SP', async () => {
    // SP (3 pitches) with High Stamina (80)
    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      3, // pitchCount
      0, // gs
      mockLeagueContext,
      80, // stamina
      'Normal', // injury
      undefined,
      3.0
    );

    // Fallback formula: 10 + (80 * 3.0) = 250, clamped [100, 280]
    // No historical data → injury mod applies (Normal = 1.0)
    expect(result.projectedStats.ip).toBeGreaterThan(200);
  });

  test('should calculate lower IP for low stamina SP', async () => {
    // SP (3 pitches) with Low Stamina (40)
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

    // Fallback formula: 10 + (40 * 3.0) = 130, clamped to 130
    expect(result.projectedStats.ip).toBeGreaterThan(100);
    expect(result.projectedStats.ip).toBeLessThan(170);
  });

  test('should calculate lower IP for Reliever', async () => {
    // RP (2 pitches) with High Stamina (80) - Likely Long Reliever
    const result = await projectionService.calculateProjection(
      mockRatings,
      25,
      2,
      0,
      mockLeagueContext,
      80,
      'Normal'
    );

    // RP formula: 30 + (80 * 0.6) = 78
    expect(result.projectedStats.ip).toBeCloseTo(78, 0);
  });

  test('should apply injury penalties', async () => {
    // SP with Normal vs Wrecked (no historical stats → injury mod applies)
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

    // Normal should be significantly more IP than Wrecked
    // Wrecked mod = 0.75 (no historical data path)
    expect(normal.projectedStats.ip).toBeGreaterThan(wrecked.projectedStats.ip);
    expect(wrecked.projectedStats.ip).toBeLessThan(normal.projectedStats.ip * 0.85);
  });

  test('should default to RP if stamina is missing or low with minimal pitches', async () => {
      // 2 pitches, no stamina provided
      const result = await projectionService.calculateProjection(
        mockRatings,
        25,
        2,
        0,
        mockLeagueContext,
        undefined,
        'Normal'
      );
      // Default RP: stamina defaults to 30. 30 + (30*0.6) = 48
      expect(result.projectedStats.ip).toBeLessThan(60);
  });

  test('should handle ramp-up scenario (95 IP -> 186 IP) correctly', async () => {
    // Year 1: 95 IP (Call up), Year 2: 186 IP (Full season)
    // Breakout detection: 186 > 120 && 186 > 95*1.5=142.5 → weightedIp = 186
    // Projection should be close to the established 186 IP workload
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

    // Should project close to proven 186 IP workload (blend of model + history)
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
});
