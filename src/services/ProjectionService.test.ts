import { projectionService } from './ProjectionService';

describe('ProjectionService', () => {
  const mockLeagueContext = {
    fipConstant: 3.10,
    avgFip: 4.00,
    runsPerWin: 9.0
  };

  const mockRatings = { stuff: 50, control: 50, hra: 50 };

  test('should calculate higher IP for high stamina SP', () => {
    // SP (3 pitches) with High Stamina (80)
    const result = projectionService.calculateProjection(
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

    // SP Base: 100 + (80 * 1.2) = 196. Normal injury mod = 1.0.
    // Expected: ~196
    expect(result.projectedStats.ip).toBeCloseTo(196, 0);
  });

  test('should calculate lower IP for low stamina SP', () => {
    // SP (3 pitches) with Low Stamina (40)
    const result = projectionService.calculateProjection(
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

    // SP Base: 100 + (40 * 1.2) = 148.
    // Expected: ~148
    expect(result.projectedStats.ip).toBeCloseTo(148, 0);
  });

  test('should calculate lower IP for Reliever', () => {
    // RP (2 pitches) with High Stamina (80) - Likely Long Reliever
    const result = projectionService.calculateProjection(
      mockRatings,
      25,
      2, 
      0, 
      mockLeagueContext,
      80, 
      'Normal'
    );

    // RP Base: 30 + (80 * 0.6) = 78.
    // Expected: ~78
    expect(result.projectedStats.ip).toBeCloseTo(78, 0);
  });

  test('should apply injury penalties', () => {
    // SP with Normal vs Wrecked
    const normal = projectionService.calculateProjection(
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
    // Base: 100 + 60 = 160. Normal=160.

    const wrecked = projectionService.calculateProjection(
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
    // Wrecked Mod = 0.60. 160 * 0.60 = 96.

    expect(normal.projectedStats.ip).toBeGreaterThan(150);
    expect(wrecked.projectedStats.ip).toBeLessThan(100);
  });

  test('should default to RP if stamina is missing or low with minimal pitches', () => {
      // 2 pitches, no stamina provided
      const result = projectionService.calculateProjection(
        mockRatings,
        25,
        2, 
        0, 
        mockLeagueContext,
        undefined, 
        'Normal'
      );
      // Default RP logic: stamina 30. Base 30 + (30*0.6) = 48.
      expect(result.projectedStats.ip).toBeLessThan(60);
  });

  test('should handle ramp-up scenario (95 IP -> 186 IP) correctly', () => {
    // Scenario: Pitcher with good stamina (60)
    // Year 1: 95 IP (Call up)
    // Year 2: 186 IP (Full season)
    // Projection for Year 3 should be closer to 186, recognizing the "established" workload in Year 2.
    const historicalStats = [
        { year: 2024, ip: 186, gs: 30, k9: 8, bb9: 3, hr9: 1 }, // Last Year (Year 2)
        { year: 2023, ip: 95, gs: 15, k9: 8, bb9: 3, hr9: 1 }   // 2 Years Ago (Year 1)
    ];

    const result = projectionService.calculateProjection(
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

    // Expected: ~182 (was ~158 before fix)
    expect(result.projectedStats.ip).toBeGreaterThan(175); 
  });
});
