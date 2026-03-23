import { projectionService, classifyPitcherRole } from './ProjectionService';
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

  // ──────────────────────────────────────────────
  // classifyPitcherRole — canonical SP/RP classifier
  // ──────────────────────────────────────────────
  describe('classifyPitcherRole', () => {
    // Dave Spuller scenario: long-time starter moved to bullpen in most recent year.
    // Historical stats MUST be newest-first so the classifier sees the RP year first.
    const spullerHistory = [
      { ip: 85, gs: 0 },    // 2021 — reliever year
      { ip: 177, gs: 32 },  // 2020 — starter
      { ip: 198, gs: 34 },  // 2019 — starter
      { ip: 216, gs: 34 },  // 2018 — starter
    ];

    test('pitcher with 0 GS in most recent season classified as RP despite starter history', () => {
      const result = classifyPitcherRole({
        pitches: { FB: 80, SI: 75, SP: 70, CB: 65, CH: 70 },
        stamina: 30,
        ootpRole: 12, // RP
        historicalStats: spullerHistory,
      });
      expect(result.isSp).toBe(false);
    });

    test('pitcher with GS >= 5 in most recent season classified as SP', () => {
      const result = classifyPitcherRole({
        pitches: { FB: 80, SI: 75, SP: 70, CB: 65, CH: 70 },
        stamina: 30,
        historicalStats: [
          { ip: 177, gs: 32 },  // 2021 — starter
          { ip: 85, gs: 0 },    // 2020 — reliever year
        ],
      });
      expect(result.isSp).toBe(true);
      expect(result.roleReason).toBe('historical-gs');
    });

    test('scouting profile: 3+ pitches >= 25 AND stamina >= 35 → SP', () => {
      const result = classifyPitcherRole({
        pitches: { FB: 70, SL: 55, CH: 45 },
        stamina: 40,
      });
      expect(result.isSp).toBe(true);
      expect(result.roleReason).toBe('scouting-profile');
    });

    test('scouting profile: stamina 30 (below 35) → not SP by profile', () => {
      const result = classifyPitcherRole({
        pitches: { FB: 70, SL: 55, CH: 45 },
        stamina: 30,
      });
      // Falls to default RP (no OOTP role, no GS data)
      expect(result.isSp).toBe(false);
    });

    test('scouting profile: only 2 usable pitches → not SP by profile', () => {
      const result = classifyPitcherRole({
        pitches: { FB: 70, SL: 55, CH: 20 },
        stamina: 50,
      });
      expect(result.isSp).toBe(false);
    });

    test('OOTP role 11 (SP) overrides low stamina/pitches', () => {
      const result = classifyPitcherRole({
        pitches: { FB: 70 },
        stamina: 25,
        ootpRole: 11,
      });
      expect(result.isSp).toBe(true);
      expect(result.roleReason).toBe('ootp-role');
    });

    test('OOTP role 12 (RP) does not force SP', () => {
      const result = classifyPitcherRole({
        ootpRole: 12,
      });
      expect(result.isSp).toBe(false);
    });

    test('currentGS >= 5 → SP', () => {
      const result = classifyPitcherRole({ currentGS: 10 });
      expect(result.isSp).toBe(true);
      expect(result.roleReason).toBe('current-stats-gs');
    });

    test('no data at all → RP', () => {
      const result = classifyPitcherRole({});
      expect(result.isSp).toBe(false);
      expect(result.roleReason).toBe('default-rp');
    });

    test('established player with TR < 2.0 not classified SP by scouting profile alone', () => {
      const result = classifyPitcherRole({
        pitches: { FB: 70, SL: 55, CH: 45 },
        stamina: 40,
        hasRecentMlb: true,
        trueRating: 1.5,
      });
      // Scouting profile rejected (TR too low for established player), falls through
      expect(result.isSp).toBe(false);
    });

    // Key regression test: the multi-year window must include the most recent
    // completed season. If current season is 2021 and it's offseason heading into
    // 2022, the stats window must include 2021, 2020, 2019 — not just 2020, 2019, 2018.
    // This is the window alignment bug that caused Spuller's SP misclassification.
    test('stats window must include most recent completed season for role classification', () => {
      // Simulates the WRONG window (missing 2021, the RP year)
      const wrongWindow = [
        { ip: 177, gs: 32 },  // 2020
        { ip: 198, gs: 34 },  // 2019
        { ip: 216, gs: 34 },  // 2018
      ];
      const wrongResult = classifyPitcherRole({
        stamina: 30,
        ootpRole: 12,
        historicalStats: wrongWindow,
      });
      // Without 2021, historical-gs finds 2020 (32 GS) → incorrectly SP
      expect(wrongResult.isSp).toBe(true);
      expect(wrongResult.roleReason).toBe('historical-gs');

      // Simulates the CORRECT window (includes 2021)
      const correctWindow = [
        { ip: 85, gs: 0 },    // 2021 — most recent, reliever
        { ip: 177, gs: 32 },  // 2020
        { ip: 198, gs: 34 },  // 2019
        { ip: 216, gs: 34 },  // 2018
      ];
      const correctResult = classifyPitcherRole({
        stamina: 30,
        ootpRole: 12,
        historicalStats: correctWindow,
      });
      // With 2021 included, historical-gs finds 2021 first (0 GS) → correctly RP
      expect(correctResult.isSp).toBe(false);
    });
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
