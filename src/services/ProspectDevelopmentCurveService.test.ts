import { prospectDevelopmentCurveService, DevelopmentTR, PitcherDevelopmentTR } from './ProspectDevelopmentCurveService';
import { RatedHitterProspect, RatedProspect } from './TeamRatingsService';

// Helper to build a minimal RatedHitterProspect
function makeHitterProspect(overrides: Partial<RatedHitterProspect> = {}): RatedHitterProspect {
  return {
    playerId: 1,
    playerName: 'Test Player',
    age: 20,
    teamId: 100,
    parentOrg: 100,
    level: 'aa',
    position: 'SS',
    trueRatings: { eye: 60, avoidK: 60, power: 60, contact: 60, gap: 60, speed: 60 },
    projBbPct: 8,
    projKPct: 15,
    projHrPct: 2.5,
    projAvg: 0.270,
    projSlg: 0.430,
    projObp: 0.340,
    projPa: 600,
    projWar: 3.0,
    tfrStars: 3.5,
    overallTR: 50,
    scoutOvr: 50,
    scoutPot: 60,
    totalMinorPa: 500,
    isProspect: true,
    isFarmEligible: true,
    ...overrides,
  } as any;
}

// Helper to build a minimal RatedProspect (pitcher)
function makePitcherProspect(overrides: Partial<RatedProspect> = {}): RatedProspect {
  return {
    playerId: 2,
    playerName: 'Test Pitcher',
    age: 21,
    teamId: 100,
    level: 'aa',
    position: 'P',
    trueRatings: { stuff: 60, control: 55, hra: 50 },
    projK9: 7.0,
    projBb9: 3.0,
    projHr9: 0.9,
    tfrStars: 3.0,
    overallTR: 50,
    scoutOvr: 50,
    scoutPot: 60,
    totalMinorIp: 200,
    isProspect: true,
    ...overrides,
  } as any;
}

describe('ProspectDevelopmentCurveService', () => {
  // ============================================================
  // Hitter Tests
  // ============================================================
  describe('calculateProspectTR (hitter)', () => {
    it('young prospect (age 18) should have TR well below TFR', () => {
      const prospect = makeHitterProspect({
        age: 18,
        trueRatings: { eye: 70, avoidK: 70, power: 70, contact: 70, gap: 70, speed: 70 },
      });
      const tr = prospectDevelopmentCurveService.calculateProspectTR(prospect);

      // At age 18 the dev fraction is low, so each component should be well below 70
      for (const key of ['eye', 'avoidK', 'power', 'contact', 'gap', 'speed'] as const) {
        expect(tr[key]).toBeGreaterThanOrEqual(20);
        expect(tr[key]).toBeLessThan(70);
      }
    });

    it('near-peak prospect (age 25) should have TR close to TFR', () => {
      const prospect = makeHitterProspect({
        age: 25,
        trueRatings: { eye: 70, avoidK: 70, power: 70, contact: 70, gap: 70, speed: 70 },
      });
      const tr = prospectDevelopmentCurveService.calculateProspectTR(prospect);

      // At age 25 the dev fraction is high — TR should be closer to TFR than at age 18
      for (const key of ['eye', 'avoidK', 'power', 'contact', 'gap', 'speed'] as const) {
        expect(tr[key]).toBeGreaterThanOrEqual(45);
        expect(tr[key]).toBeLessThanOrEqual(70);
      }
      // At least some components should be well developed (>= 55)
      const highDevCount = (['eye', 'avoidK', 'power', 'contact'] as const).filter(k => tr[k] >= 55).length;
      expect(highDevCount).toBeGreaterThanOrEqual(2);
    });

    it('above-curve rawStats should boost TR', () => {
      // Prospect performing much better than curve expects at this age
      const base = makeHitterProspect({
        age: 21,
        trueRatings: { eye: 60, avoidK: 60, power: 60, contact: 60, gap: 60, speed: 60 },
        totalMinorPa: 800,
      });

      const withoutRaw = prospectDevelopmentCurveService.calculateProspectTR(base);
      const withAboveRaw = prospectDevelopmentCurveService.calculateProspectTR({
        ...base,
        rawStats: { bbPct: 15, kPct: 8, hrPct: 5, avg: 0.320 },
      } as any);

      // Above-curve stats → higher eye, avoidK, power, contact
      expect(withAboveRaw.eye).toBeGreaterThanOrEqual(withoutRaw.eye);
      expect(withAboveRaw.avoidK).toBeGreaterThanOrEqual(withoutRaw.avoidK);
      expect(withAboveRaw.power).toBeGreaterThanOrEqual(withoutRaw.power);
      expect(withAboveRaw.contact).toBeGreaterThanOrEqual(withoutRaw.contact);
    });

    it('below-curve rawStats should reduce TR', () => {
      const base = makeHitterProspect({
        age: 21,
        trueRatings: { eye: 60, avoidK: 60, power: 60, contact: 60, gap: 60, speed: 60 },
        totalMinorPa: 800,
      });

      const withoutRaw = prospectDevelopmentCurveService.calculateProspectTR(base);
      const withBelowRaw = prospectDevelopmentCurveService.calculateProspectTR({
        ...base,
        rawStats: { bbPct: 3, kPct: 28, hrPct: 0.5, avg: 0.200 },
      } as any);

      expect(withBelowRaw.eye).toBeLessThanOrEqual(withoutRaw.eye);
      expect(withBelowRaw.avoidK).toBeLessThanOrEqual(withoutRaw.avoidK);
      expect(withBelowRaw.power).toBeLessThanOrEqual(withoutRaw.power);
      expect(withBelowRaw.contact).toBeLessThanOrEqual(withoutRaw.contact);
    });

    it('MLB stats should additively push TR', () => {
      const prospect = makeHitterProspect({
        age: 22,
        trueRatings: { eye: 65, avoidK: 65, power: 65, contact: 65, gap: 65, speed: 65 },
        totalMinorPa: 600,
      });

      const withoutMlb = prospectDevelopmentCurveService.calculateProspectTR(prospect);
      const withMlb = prospectDevelopmentCurveService.calculateProspectTR(prospect, {
        bbPct: 12, kPct: 10, hrPct: 4, avg: 0.300, pa: 300,
      });

      // Good MLB stats should push at least one component higher
      const anyHigher = (
        withMlb.eye > withoutMlb.eye ||
        withMlb.avoidK > withoutMlb.avoidK ||
        withMlb.power > withoutMlb.power ||
        withMlb.contact > withoutMlb.contact
      );
      expect(anyHigher).toBe(true);
    });

    it('TR should never exceed TFR (clamping)', () => {
      // Give massively above-curve stats + high MLB stats
      const prospect = makeHitterProspect({
        age: 26,
        trueRatings: { eye: 50, avoidK: 50, power: 50, contact: 50, gap: 50, speed: 50 },
        totalMinorPa: 2000,
        rawStats: { bbPct: 20, kPct: 5, hrPct: 8, avg: 0.380 },
      } as any);

      const tr = prospectDevelopmentCurveService.calculateProspectTR(prospect, {
        bbPct: 15, kPct: 8, hrPct: 5, avg: 0.340, pa: 500,
      });

      for (const key of ['eye', 'avoidK', 'power', 'contact', 'gap', 'speed'] as const) {
        expect(tr[key]).toBeLessThanOrEqual(50);
      }
    });

    it('TR should never go below 20 (clamping)', () => {
      const prospect = makeHitterProspect({
        age: 18,
        trueRatings: { eye: 25, avoidK: 25, power: 25, contact: 25, gap: 25, speed: 25 },
        totalMinorPa: 800,
        rawStats: { bbPct: 1, kPct: 40, hrPct: 0, avg: 0.100 },
      } as any);

      const tr = prospectDevelopmentCurveService.calculateProspectTR(prospect);

      for (const key of ['eye', 'avoidK', 'power', 'contact', 'gap', 'speed'] as const) {
        expect(tr[key]).toBeGreaterThanOrEqual(20);
      }
    });

    it('gap/speed should use average devFraction (scale with age)', () => {
      const young = makeHitterProspect({
        age: 18,
        trueRatings: { eye: 60, avoidK: 60, power: 60, contact: 60, gap: 70, speed: 70 },
      });
      const old = makeHitterProspect({
        age: 25,
        trueRatings: { eye: 60, avoidK: 60, power: 60, contact: 60, gap: 70, speed: 70 },
      });

      const trYoung = prospectDevelopmentCurveService.calculateProspectTR(young);
      const trOld = prospectDevelopmentCurveService.calculateProspectTR(old);

      // Older player should have higher gap/speed (more developed)
      expect(trOld.gap).toBeGreaterThan(trYoung.gap);
      expect(trOld.speed).toBeGreaterThan(trYoung.speed);
    });

    it('should return integer ratings', () => {
      const prospect = makeHitterProspect({ age: 21 });
      const tr = prospectDevelopmentCurveService.calculateProspectTR(prospect);

      for (const key of ['eye', 'avoidK', 'power', 'contact', 'gap', 'speed'] as const) {
        expect(tr[key]).toBe(Math.round(tr[key]));
      }
    });
  });

  // ============================================================
  // Pitcher Tests
  // ============================================================
  describe('calculatePitcherProspectTR', () => {
    it('basic stuff/control/hra with age-based development', () => {
      const prospect = makePitcherProspect({
        age: 21,
        trueRatings: { stuff: 65, control: 55, hra: 50 },
      });
      const tr = prospectDevelopmentCurveService.calculatePitcherProspectTR(prospect);

      expect(tr.stuff).toBeGreaterThanOrEqual(20);
      expect(tr.stuff).toBeLessThanOrEqual(65);
      expect(tr.control).toBeGreaterThanOrEqual(20);
      expect(tr.control).toBeLessThanOrEqual(55);
      expect(tr.hra).toBeGreaterThanOrEqual(20);
      expect(tr.hra).toBeLessThanOrEqual(50);
    });

    it('older pitcher should have higher TR than younger (same TFR)', () => {
      const young = makePitcherProspect({
        age: 19,
        trueRatings: { stuff: 65, control: 55, hra: 50 },
      });
      const old = makePitcherProspect({
        age: 25,
        trueRatings: { stuff: 65, control: 55, hra: 50 },
      });

      const trYoung = prospectDevelopmentCurveService.calculatePitcherProspectTR(young);
      const trOld = prospectDevelopmentCurveService.calculatePitcherProspectTR(old);

      expect(trOld.stuff).toBeGreaterThanOrEqual(trYoung.stuff);
      expect(trOld.control).toBeGreaterThanOrEqual(trYoung.control);
    });

    it('no trueRatings → returns {50, 50, 50}', () => {
      const prospect = makePitcherProspect({ trueRatings: undefined } as any);
      const tr = prospectDevelopmentCurveService.calculatePitcherProspectTR(prospect);

      expect(tr).toEqual({ stuff: 50, control: 50, hra: 50 });
    });

    it('should return integer ratings', () => {
      const prospect = makePitcherProspect({ age: 22 });
      const tr = prospectDevelopmentCurveService.calculatePitcherProspectTR(prospect);

      expect(tr.stuff).toBe(Math.round(tr.stuff));
      expect(tr.control).toBe(Math.round(tr.control));
      expect(tr.hra).toBe(Math.round(tr.hra));
    });
  });

  // ============================================================
  // Diagnostics Tests
  // ============================================================
  describe('getComponentDiagnostics', () => {
    it('returns correct cohort label and expected fields', () => {
      const diag = prospectDevelopmentCurveService.getComponentDiagnostics(
        'eye', 65, 8.0, 21
      );

      expect(diag.cohortLabel).toBe('7-9%');
      expect(typeof diag.devFraction).toBe('number');
      expect(typeof diag.baseline).toBe('number');
      expect(typeof diag.finalTR).toBe('number');
      expect(diag.finalTR).toBeGreaterThanOrEqual(20);
      expect(diag.finalTR).toBeLessThanOrEqual(65);
    });

    it('returns N/A for unknown component', () => {
      const diag = prospectDevelopmentCurveService.getComponentDiagnostics(
        'unknown', 60, 5, 20
      );
      expect(diag.cohortLabel).toBe('N/A');
      expect(diag.finalTR).toBe(60);
    });

    it('includes rawStat deviation when provided', () => {
      const diag = prospectDevelopmentCurveService.getComponentDiagnostics(
        'eye', 65, 8.0, 21, 12.0, 500
      );

      expect(diag.deviation).toBeDefined();
      expect(diag.shrinkage).toBeDefined();
      expect(typeof diag.ratingAdjust).toBe('number');
    });

    it('includes MLB adjustment when provided', () => {
      const diag = prospectDevelopmentCurveService.getComponentDiagnostics(
        'eye', 65, 8.0, 21, undefined, undefined, false,
        { actualStat: 10, peakStat: 8, pa: 200, stabilization: 200 }
      );

      expect(diag.mlbDeviation).toBeDefined();
      expect(diag.mlbShrinkage).toBeDefined();
      expect(typeof diag.mlbRatingAdjust).toBe('number');
    });
  });

  describe('getPitcherComponentDiagnostics', () => {
    it('returns correct cohort label for stuff', () => {
      const diag = prospectDevelopmentCurveService.getPitcherComponentDiagnostics(
        'stuff', 60, 7.0, 21
      );
      expect(diag.cohortLabel).toBe('6-8');
      expect(diag.finalTR).toBeGreaterThanOrEqual(20);
      expect(diag.finalTR).toBeLessThanOrEqual(60);
    });

    it('returns N/A for unknown pitcher component', () => {
      const diag = prospectDevelopmentCurveService.getPitcherComponentDiagnostics(
        'unknown', 60, 5, 20
      );
      expect(diag.cohortLabel).toBe('N/A');
      expect(diag.finalTR).toBe(60);
    });
  });
});
