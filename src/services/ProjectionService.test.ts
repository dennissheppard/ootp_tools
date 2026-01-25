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
      'Normal' // injury
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
      'Normal'
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
      'Normal'
    );
    // Base: 100 + 60 = 160. Normal=160.

    const wrecked = projectionService.calculateProjection(
      mockRatings,
      25,
      3, 
      0, 
      mockLeagueContext,
      50, 
      'Wrecked'
    );
    // Wrecked Mod = 0.40. 160 * 0.40 = 64.

    expect(normal.projectedStats.ip).toBeGreaterThan(150);
    expect(wrecked.projectedStats.ip).toBeLessThan(70);
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
});
