/**
 * Archetype integration tests for ModalDataService.
 *
 * Tests the pure functions extracted from modal data assembly and projection
 * calculation against canonical archetype scenarios.
 */

import {
  resolveCanonicalBatterData,
  resolveCanonicalPitcherData,
  computeBatterProjection,
  computePitcherProjection,
  BatterProjectionDeps,
  PitcherProjectionDeps,
  applyBatterTrSnapshot,
  applyPitcherTrSnapshot,
  snapshotBatterTr,
  snapshotPitcherTr,
  batterTrFromPrecomputed,
  pitcherTrFromPrecomputed,
  BatterTrSourceData,
  PitcherTrSourceData,
} from './ModalDataService';
import { BatterProfileData } from '../views/BatterProfileModal';
import { PitcherProfileData } from '../views/PitcherProfileModal';
import { HitterTrueRatingResult } from './HitterTrueRatingsCalculationService';
import { RatedHitterProspect, RatedProspect } from './TeamRatingsService';
import { TrueRatingResult } from './TrueRatingsCalculationService';

// ============================================================================
// Test Helpers
// ============================================================================

function makeBatterData(overrides: Partial<BatterProfileData> = {}): BatterProfileData {
  return {
    playerId: 1000,
    playerName: 'Test Batter',
    age: 25,
    ...overrides,
  };
}

function makePitcherData(overrides: Partial<PitcherProfileData> = {}): PitcherProfileData {
  return {
    playerId: 2000,
    playerName: 'Test Pitcher',
    age: 25,
    ...overrides,
  };
}

function makeHitterTR(overrides: Partial<HitterTrueRatingResult> = {}): HitterTrueRatingResult {
  return {
    playerId: 1000,
    playerName: 'Test Batter',
    blendedBbPct: 8.5,
    blendedKPct: 20.0,
    blendedHrPct: 3.0,
    blendedIso: 0.170,
    blendedAvg: 0.270,
    blendedDoublesRate: 0.04,
    blendedTriplesRate: 0.005,
    estimatedPower: 55,
    estimatedEye: 50,
    estimatedAvoidK: 52,
    estimatedContact: 48,
    estimatedGap: 50,
    estimatedSpeed: 45,
    woba: 0.330,
    war: 3.0,
    percentile: 60,
    trueRating: 3.0,
    totalPa: 500,
    ...overrides,
  };
}

function makeTfrEntry(overrides: Partial<RatedHitterProspect> = {}): RatedHitterProspect {
  return {
    playerId: 1000,
    name: 'Test Prospect',
    trueFutureRating: 4.0,
    age: 20,
    level: 'AA',
    teamId: 1,
    team: 'Test Team',
    orgId: 1,
    parentOrg: 'Test Org',
    projWoba: 0.360,
    percentile: 85,
    projBbPct: 10.0,
    projKPct: 18.0,
    projHrPct: 3.5,
    projIso: 0.190,
    projAvg: 0.285,
    projObp: 0.370,
    projSlg: 0.475,
    projOps: 0.845,
    projPa: 620,
    wrcPlus: 130,
    projWar: 4.5,
    totalMinorPa: 800,
    scoutingRatings: { power: 60, eye: 55, avoidK: 50, contact: 55, gap: 50, speed: 55, ovr: 45, pot: 60 },
    trueRatings: { power: 62, eye: 58, avoidK: 54, contact: 57, gap: 52, speed: 53 },
    position: 6,
    isFarmEligible: true,
    developmentTR: { eye: 45, avoidK: 42, power: 48, contact: 44, gap: 40, speed: 42 },
    ...overrides,
  } as RatedHitterProspect;
}

function makePitcherTR(overrides: Partial<TrueRatingResult> = {}): TrueRatingResult {
  return {
    playerId: 2000,
    playerName: 'Test Pitcher',
    blendedK9: 8.5,
    blendedBb9: 2.8,
    blendedHr9: 1.0,
    estimatedStuff: 58,
    estimatedControl: 55,
    estimatedHra: 52,
    fipLike: 3.60,
    percentile: 65,
    trueRating: 3.5,
    totalIp: 180,
    ...overrides,
  };
}

function makePitcherTfrEntry(overrides: Partial<RatedProspect> = {}): RatedProspect {
  return {
    playerId: 2000,
    name: 'Test Pitcher Prospect',
    trueFutureRating: 4.0,
    age: 19,
    level: 'A',
    teamId: 1,
    team: 'Test Team',
    orgId: 1,
    parentOrg: 'Test Org',
    percentile: 80,
    projK9: 9.5,
    projBb9: 2.5,
    projHr9: 0.9,
    projWoba: 0,
    projFip: 3.20,
    projIp: 180,
    projWar: 4.0,
    totalMinorIp: 200,
    scoutingRatings: { stuff: 65, control: 55, hra: 50, stamina: 55, ovr: 45, pot: 60 },
    trueRatings: { stuff: 63, control: 56, hra: 54 },
    position: 1,
    isFarmEligible: true,
    developmentTR: { stuff: 50, control: 44, hra: 48 },
  } as RatedProspect;
}

function makeBatterDeps(overrides: Partial<BatterProjectionDeps> = {}): BatterProjectionDeps {
  return {
    projectionMode: 'current',
    projectionYear: 2025,
    leagueAvg: { year: 2024, lgObp: 0.320, lgSlg: 0.400, lgWoba: 0.320, lgRpa: 0.115, wobaScale: 1.15, runsPerWin: 10, totalPa: 100000, totalRuns: 11500 },
    scoutingData: null,
    expectedBbPct: (eye: number) => 3.0 + (eye - 20) * 0.13,
    expectedKPct: (avoidK: number) => 35.0 - (avoidK - 20) * 0.23,
    expectedAvg: (contact: number) => 0.200 + (contact - 20) * 0.002,
    expectedHrPct: (power: number) => 0.5 + (power - 20) * 0.06,
    expectedDoublesRate: () => 0.04,
    expectedTriplesRate: () => 0.005,
    getProjectedPa: () => 600,
    getProjectedPaWithHistory: () => 600,
    calculateOpsPlus: (obp: number, slg: number) => Math.round(100 * ((obp / 0.320) + (slg / 0.400) - 1)),
    computeWoba: (bbRate: number, avg: number, _d: number, _t: number, hrPerAb: number) =>
      0.69 * bbRate + 0.89 * avg * 0.7 + 2.10 * hrPerAb * 0.12 + 0.320 * 0.18,
    calculateBaserunningRuns: () => 0,
    calculateBattingWar: (_w: number, pa: number) => (pa / 600) * 2.5,
    projectStolenBases: () => ({ sb: 5, cs: 2 }),
    ...overrides,
  };
}

function makePitcherDeps(overrides: Partial<PitcherProjectionDeps> = {}): PitcherProjectionDeps {
  return {
    projectionMode: 'current',
    scoutingData: null,
    projectedIp: undefined,
    estimateIp: () => 180,
    calculateWar: (fip: number, ip: number) => ((5.20 - fip) / 8.50) * (ip / 9) * 9,
    ...overrides,
  };
}

// ============================================================================
// Tests: resolveCanonicalBatterData
// ============================================================================

describe('resolveCanonicalBatterData', () => {
  it('farm-eligible prospect with playerTR: MLB player with upside, keeps TR', () => {
    const data = makeBatterData({ trueRating: 2.0, percentile: 40, woba: 0.280 });
    const playerTR = makeHitterTR();
    const tfrEntry = makeTfrEntry({ isFarmEligible: true });

    resolveCanonicalBatterData(data, playerTR, tfrEntry);

    // playerTR exists → MLB player path (keeps TR, computes hasTfrUpside)
    expect(data.isProspect).toBe(false);
    expect(data.hasTfrUpside).toBe(true); // TFR 4.0 > TR 3.0
    // TR kept from canonical source
    expect(data.trueRating).toBe(3.0);
    expect(data.percentile).toBe(60);
    expect(data.woba).toBe(0.330);
    // Uses TR ratings, not devTR
    expect(data.estimatedPower).toBe(55);
    expect(data.estimatedEye).toBe(50);
    // TFR fields set
    expect(data.trueFutureRating).toBe(4.0);
    expect(data.tfrPower).toBe(62);
    // PA cleared for recomputation
    expect(data.projPa).toBeUndefined();
    // WAR cleared for recomputation
    expect(data.projWar).toBeUndefined();
  });

  it('young MLB regular with upside (not farm-eligible): keeps MLB TR, sets hasTfrUpside', () => {
    const data = makeBatterData();
    const playerTR = makeHitterTR({ trueRating: 3.0 });
    const tfrEntry = makeTfrEntry({
      isFarmEligible: false,
      trueFutureRating: 4.0, // > 3.0 TR
    });

    resolveCanonicalBatterData(data, playerTR, tfrEntry);

    expect(data.isProspect).toBe(false); // Set by playerTR step, NOT overridden
    expect(data.hasTfrUpside).toBe(true); // TFR > TR
    expect(data.trueRating).toBe(3.0); // Preserved from TR
    expect(data.percentile).toBe(60);
    // Uses TR ratings, not devTR
    expect(data.estimatedPower).toBe(55);
    expect(data.estimatedEye).toBe(50);
    // TFR fields set
    expect(data.tfrPower).toBe(62);
    expect(data.tfrEye).toBe(58);
    // PA cleared for recomputation
    expect(data.projPa).toBeUndefined();
  });

  it('no TFR entry: only applies TR override', () => {
    const data = makeBatterData();
    const playerTR = makeHitterTR();

    resolveCanonicalBatterData(data, playerTR, undefined);

    expect(data.trueRating).toBe(3.0);
    expect(data.isProspect).toBe(false);
    expect(data.estimatedPower).toBe(55);
    expect(data.projBbPct).toBe(8.5);
    // No TFR fields
    expect(data.trueFutureRating).toBeUndefined();
    expect(data.tfrPower).toBeUndefined();
    expect(data.hasTfrUpside).toBeUndefined();
  });

  it('no TR and no TFR: data unchanged', () => {
    const data = makeBatterData({ trueRating: 2.5, estimatedPower: 40 });
    resolveCanonicalBatterData(data, undefined, undefined);
    expect(data.trueRating).toBe(2.5);
    expect(data.estimatedPower).toBe(40);
  });

  it('prospect with no MLB stats and no playerTR: prospect path only', () => {
    const data = makeBatterData();
    const tfrEntry = makeTfrEntry({ isFarmEligible: true });

    resolveCanonicalBatterData(data, undefined, tfrEntry);

    expect(data.isProspect).toBe(true);
    expect(data.hasTfrUpside).toBe(true);
    // No playerTR → trueRating never set by step 3, stays as caller value
    expect(data.trueRating).toBeUndefined();
    expect(data.estimatedPower).toBe(48); // devTR
    expect(data.projPa).toBeUndefined(); // cleared for recomputation
  });
});

// ============================================================================
// Tests: computeBatterProjection
// ============================================================================

describe('computeBatterProjection', () => {
  it('prospect: always peak mode, TFR rates, age 27, ~640 PA', () => {
    const data = makeBatterData({
      isProspect: true,
      trueFutureRating: 4.0,
      trueRating: undefined,
      tfrAvg: 0.285,
      tfrObp: 0.370,
      tfrSlg: 0.475,
      tfrBbPct: 10.0,
      tfrKPct: 18.0,
      tfrHrPct: 3.5,
      tfrPa: 640,
      tfrPower: 62,
      tfrEye: 58,
      tfrAvoidK: 54,
      tfrContact: 57,
      tfrGap: 52,
      tfrSpeed: 53,
      estimatedPower: 48,
      estimatedEye: 45,
    });
    const deps = makeBatterDeps();
    const result = computeBatterProjection(data, [], deps);

    expect(result.isPeakMode).toBe(true);
    expect(result.age).toBe(27);
    expect(result.projAvg).toBe(0.285);
    expect(result.projObp).toBe(0.370);
    expect(result.projSlg).toBe(0.475);
    expect(result.projPa).toBe(640);
    expect(result.projBbPct).toBe(10.0);
    expect(result.projKPct).toBe(18.0);
    expect(result.ratingLabel).toBe('TFR');
    expect(result.ratings.power).toBe(62); // Uses TFR, not estimated
    expect(result.showActualComparison).toBe(false);
  });

  it('MLB player current mode: TR rates, actual age, comparison row', () => {
    const data = makeBatterData({
      age: 28,
      trueRating: 3.0,
      isProspect: false,
      hasTfrUpside: true,
      projAvg: 0.270,
      projObp: 0.340,
      projSlg: 0.440,
      projBbPct: 8.5,
      projKPct: 20.0,
      projHrPct: 3.0,
      projPa: 580,
      projHr: 17,
      estimatedPower: 55,
      estimatedEye: 50,
      estimatedAvoidK: 52,
      estimatedContact: 48,
      estimatedGap: 50,
      estimatedSpeed: 45,
    });
    const deps = makeBatterDeps({ projectionMode: 'current' });
    const result = computeBatterProjection(data, [], deps);

    expect(result.isPeakMode).toBe(false);
    expect(result.age).toBe(28);
    expect(result.projAvg).toBe(0.270);
    expect(result.projPa).toBe(580);
    expect(result.projHr).toBe(17);
    expect(result.ratingLabel).toBe('Estimated');
    expect(result.ratings.power).toBe(55); // Uses estimated, not TFR
    expect(result.showActualComparison).toBe(true);
  });

  it('MLB player peak mode: TFR rates, age 27, no comparison', () => {
    const data = makeBatterData({
      age: 28,
      trueRating: 3.0,
      isProspect: false,
      hasTfrUpside: true,
      tfrAvg: 0.290,
      tfrObp: 0.375,
      tfrSlg: 0.500,
      tfrBbPct: 11.0,
      tfrKPct: 16.0,
      tfrHrPct: 4.0,
      tfrPa: 650,
      tfrPower: 65,
      tfrEye: 60,
      tfrAvoidK: 56,
      tfrContact: 60,
      tfrGap: 55,
      tfrSpeed: 50,
      estimatedPower: 55,
      estimatedEye: 50,
    });
    const deps = makeBatterDeps({ projectionMode: 'peak' });
    const result = computeBatterProjection(data, [], deps);

    expect(result.isPeakMode).toBe(true);
    expect(result.age).toBe(27);
    expect(result.projAvg).toBe(0.290);
    expect(result.projPa).toBe(650);
    expect(result.ratingLabel).toBe('TFR');
    expect(result.ratings.power).toBe(65); // Uses TFR
    expect(result.showActualComparison).toBe(false);
  });

  it('SLG uses blended rates instead of rating-derived ISO', () => {
    // Player with blended rates set but no pre-set projSlg/projObp
    const data = makeBatterData({
      age: 29,
      trueRating: 3.5,
      isProspect: false,
      projAvg: 0.280,
      projBbPct: 9.0,
      projKPct: 18.0,
      projHrPct: 3.5,
      projDoublesRate: 0.045,
      projTriplesRate: 0.004,
      // projObp and projSlg intentionally NOT set — must be computed from blended rates
      estimatedPower: 70,
      estimatedEye: 60,
      estimatedAvoidK: 55,
      estimatedContact: 60,
      estimatedGap: 65,
      estimatedSpeed: 40,
    });
    const deps = makeBatterDeps();
    const result = computeBatterProjection(data, [], deps);

    // SLG should be AVG + ISO from blended rates, NOT from rating-derived formulas.
    // ISO = doublesRate + 2*triplesRate + 3*(hrPct/100/0.88)
    //     = 0.045 + 2*0.004 + 3*(3.5/100/0.88) = 0.045 + 0.008 + 0.11932 = 0.17232
    // SLG = 0.280 + 0.172 = 0.452
    expect(result.projSlg).toBeCloseTo(0.452, 2);
    // Should NOT be using expectedDoublesRate(gap=65) or expectedHrPct(power=70)
  });

  it('aging reduces projection for older player (age 37)', () => {
    const data = makeBatterData({
      age: 37,
      trueRating: 4.5,
      isProspect: false,
      projAvg: 0.300,
      projBbPct: 10.0,
      projKPct: 16.0,
      projHrPct: 4.0,
      projDoublesRate: 0.050,
      projTriplesRate: 0.005,
      estimatedPower: 70,
      estimatedEye: 65,
      estimatedAvoidK: 50,
      estimatedContact: 70,
      estimatedGap: 60,
      estimatedSpeed: 40,
    });

    // Without aging
    const depsNoAging = makeBatterDeps();
    const noAging = computeBatterProjection(data, [], depsNoAging);

    // With aging (age 37 = bracket 36-38: power -2.5, eye -1.5, avoidK -2.5, contact -2.0)
    const depsWithAging = makeBatterDeps({
      applyAgingToRates: (rates, age) => {
        // Simulate aging: reduce all rates moderately
        if (age >= 36) {
          return {
            bbPct: rates.bbPct - 0.2,
            kPct: rates.kPct + 0.5,
            avg: rates.avg - 0.008,
            hrPct: rates.hrPct - 0.2,
            doublesRate: rates.doublesRate,
            triplesRate: rates.triplesRate,
          };
        }
        return rates;
      },
    });
    const withAging = computeBatterProjection(data, [], depsWithAging);

    // Aging should reduce all offensive stats
    expect(withAging.projAvg).toBeLessThan(noAging.projAvg);
    expect(withAging.projSlg).toBeLessThan(noAging.projSlg);
    expect(withAging.projObp).toBeLessThan(noAging.projObp);
    expect(withAging.projHr).toBeLessThanOrEqual(noAging.projHr);
  });

  it('aging does NOT apply in peak mode', () => {
    const data = makeBatterData({
      age: 37,
      trueRating: 4.0,
      isProspect: false,
      hasTfrUpside: true,
      tfrAvg: 0.290,
      tfrObp: 0.370,
      tfrSlg: 0.490,
      tfrBbPct: 10.0,
      tfrKPct: 17.0,
      tfrHrPct: 3.5,
      tfrPa: 640,
      tfrPower: 65,
      tfrEye: 60,
      tfrAvoidK: 55,
      tfrContact: 60,
      tfrGap: 55,
      tfrSpeed: 50,
      estimatedPower: 55,
    });

    const agingCalledWith: number[] = [];
    const deps = makeBatterDeps({
      projectionMode: 'peak',
      applyAgingToRates: (rates, age) => {
        agingCalledWith.push(age);
        return rates;
      },
    });
    const result = computeBatterProjection(data, [], deps);

    // Peak mode should use age 27, not call aging
    expect(result.isPeakMode).toBe(true);
    expect(result.age).toBe(27);
    expect(agingCalledWith).toHaveLength(0);
    expect(result.projAvg).toBe(0.290);
    expect(result.projSlg).toBe(0.490);
  });
});

// ============================================================================
// Tests: Core projection formula correctness
// ============================================================================

describe('projection formula correctness', () => {
  it('OBP = AVG + BB% × (1 - AVG), not AVG + BB%', () => {
    // High-AVG, high-walk player where the old formula diverged most
    const data = makeBatterData({
      age: 29,
      trueRating: 4.0,
      isProspect: false,
      projAvg: 0.300,
      projBbPct: 12.0,
      projKPct: 15.0,
      projHrPct: 4.0,
      projDoublesRate: 0.045,
      projTriplesRate: 0.004,
      estimatedPower: 65, estimatedEye: 65, estimatedAvoidK: 55,
      estimatedContact: 65, estimatedGap: 55, estimatedSpeed: 45,
    });
    const deps = makeBatterDeps();
    const result = computeBatterProjection(data, [], deps);

    // Correct: 0.300 + 0.12 * (1 - 0.300) = 0.300 + 0.084 = 0.384
    // Wrong (old): 0.300 + 0.12 = 0.420
    expect(result.projObp).toBeCloseTo(0.384, 2);
    expect(result.projObp).toBeLessThan(0.400); // would fail with old formula
  });

  it('OBP formula works for low-AVG player too', () => {
    const data = makeBatterData({
      age: 27, trueRating: 2.0, isProspect: false,
      projAvg: 0.220, projBbPct: 6.0, projKPct: 28.0,
      projHrPct: 2.0, projDoublesRate: 0.03, projTriplesRate: 0.003,
      estimatedPower: 40, estimatedEye: 35, estimatedAvoidK: 30,
      estimatedContact: 35, estimatedGap: 40, estimatedSpeed: 45,
    });
    const result = computeBatterProjection(data, [], makeBatterDeps());

    // 0.220 + 0.06 * (1 - 0.220) = 0.220 + 0.0468 = 0.2668
    expect(result.projObp).toBeCloseTo(0.267, 2);
  });

  it('SLG = AVG + ISO from blended rates (doublesRate + 2*triplesRate + 3*hrPerAb)', () => {
    const data = makeBatterData({
      age: 28, trueRating: 3.5, isProspect: false,
      projAvg: 0.270, projBbPct: 8.0, projKPct: 20.0,
      projHrPct: 3.0, projDoublesRate: 0.040, projTriplesRate: 0.005,
      estimatedPower: 55, estimatedEye: 50, estimatedAvoidK: 50,
      estimatedContact: 50, estimatedGap: 50, estimatedSpeed: 50,
    });
    const result = computeBatterProjection(data, [], makeBatterDeps());

    // hrPerAb = (3.0/100) / 0.88 = 0.03409
    // iso = 0.040 + 2*0.005 + 3*0.03409 = 0.040 + 0.010 + 0.10227 = 0.15227
    // SLG = 0.270 + 0.152 = 0.422
    expect(result.projSlg).toBeCloseTo(0.422, 2);
  });

  it('OPS = OBP + SLG', () => {
    const data = makeBatterData({
      age: 28, trueRating: 3.0, isProspect: false,
      projAvg: 0.260, projBbPct: 8.5, projKPct: 20.0,
      projHrPct: 2.5, projDoublesRate: 0.038, projTriplesRate: 0.004,
      estimatedPower: 50, estimatedEye: 50, estimatedAvoidK: 50,
      estimatedContact: 50, estimatedGap: 48, estimatedSpeed: 45,
    });
    const result = computeBatterProjection(data, [], makeBatterDeps());

    expect(result.projOps).toBeCloseTo(result.projObp + result.projSlg, 3);
  });

  it('HR count = PA × HR%', () => {
    const data = makeBatterData({
      age: 28, trueRating: 3.5, isProspect: false,
      projAvg: 0.270, projBbPct: 8.0, projKPct: 18.0,
      projHrPct: 4.0, projDoublesRate: 0.040, projTriplesRate: 0.005,
      projPa: 600,
      estimatedPower: 60, estimatedEye: 50, estimatedAvoidK: 55,
      estimatedContact: 55, estimatedGap: 50, estimatedSpeed: 45,
    });
    const result = computeBatterProjection(data, [], makeBatterDeps());

    // HR = round(600 * 4.0/100) = 24
    expect(result.projHr).toBe(24);
    expect(result.projPa).toBe(600);
  });

  it('2B count = AB × doublesRate, 3B count = AB × triplesRate', () => {
    const data = makeBatterData({
      age: 28, trueRating: 3.0, isProspect: false,
      projAvg: 0.260, projBbPct: 8.0, projKPct: 20.0,
      projHrPct: 2.5, projDoublesRate: 0.045, projTriplesRate: 0.006,
      projPa: 600,
      estimatedPower: 50, estimatedEye: 50, estimatedAvoidK: 50,
      estimatedContact: 50, estimatedGap: 52, estimatedSpeed: 48,
    });
    const result = computeBatterProjection(data, [], makeBatterDeps());

    const projAb = Math.round(600 * 0.88);
    expect(result.proj2b).toBe(Math.round(projAb * 0.045));
    expect(result.proj3b).toBe(Math.round(projAb * 0.006));
  });
});

// ============================================================================
// Tests: resolveCanonicalPitcherData
// ============================================================================

describe('resolveCanonicalPitcherData', () => {
  it('elite pitcher prospect (17yo, no MLB): isProspect=true, uses devTR, isPeakMode would be true', () => {
    const data = makePitcherData({ age: 17 });
    const tfrEntry = makePitcherTfrEntry({ age: 17 });

    resolveCanonicalPitcherData(data, undefined, tfrEntry);

    expect(data.isProspect).toBe(true);
    expect(data.hasTfrUpside).toBe(true);
    expect(data.trueRating).toBeUndefined();
    expect(data.percentile).toBeUndefined();
    expect(data.fipLike).toBeUndefined();
    // Uses devTR
    expect(data.estimatedStuff).toBe(50);
    expect(data.estimatedControl).toBe(44);
    expect(data.estimatedHra).toBe(48);
    // TFR fields set
    expect(data.trueFutureRating).toBe(4.0);
    expect(data.tfrStuff).toBe(63);
    // Peak projection from TFR pipeline
    expect(data.projK9).toBe(9.5);
    expect(data.projBb9).toBe(2.5);
    // Derived projections cleared
    expect(data.projFip).toBeUndefined();
    expect(data.projWar).toBeUndefined();
  });

  it('veteran pitcher (no TFR entry): no toggle, standard path', () => {
    const data = makePitcherData({ age: 32 });
    const playerTR = makePitcherTR();

    resolveCanonicalPitcherData(data, playerTR, undefined);

    expect(data.isProspect).toBe(false);
    expect(data.trueRating).toBe(3.5);
    expect(data.estimatedStuff).toBe(58);
    expect(data.projK9).toBe(8.5);
    expect(data.hasTfrUpside).toBeUndefined();
    expect(data.trueFutureRating).toBeUndefined();
    // Derived cleared
    expect(data.projFip).toBeUndefined();
    expect(data.projWar).toBeUndefined();
    expect(data.projIp).toBeUndefined(); // Cleared for non-prospect
  });

  it('MLB pitcher with both TR and TFR (young pitcher with upside): keeps TR, computes hasTfrUpside', () => {
    const data = makePitcherData({ age: 23 });
    const playerTR = makePitcherTR({ trueRating: 2.5, estimatedStuff: 50, estimatedControl: 45, estimatedHra: 48 });
    const tfrEntry = makePitcherTfrEntry({
      trueFutureRating: 4.0, // > 2.5 TR
      trueRatings: { stuff: 63, control: 56, hra: 54 },
    });

    resolveCanonicalPitcherData(data, playerTR, tfrEntry);

    // MLB player path: keeps TR, NOT treated as prospect
    expect(data.isProspect).toBe(false);
    expect(data.hasTfrUpside).toBe(true); // TFR 4.0 > TR 2.5
    // TR preserved from canonical source
    expect(data.trueRating).toBe(2.5);
    expect(data.percentile).toBe(65);
    expect(data.fipLike).toBe(3.60);
    // Uses TR ratings (from step 3), not devTR
    expect(data.estimatedStuff).toBe(50);
    expect(data.estimatedControl).toBe(45);
    expect(data.estimatedHra).toBe(48);
    // TFR fields still set
    expect(data.trueFutureRating).toBe(4.0);
    expect(data.tfrStuff).toBe(63);
    // Rate stats from TR (step 3), not overridden by prospect path
    expect(data.projK9).toBe(8.5);
    // Derived cleared for recomputation
    expect(data.projFip).toBeUndefined();
    expect(data.projWar).toBeUndefined();
    expect(data.projIp).toBeUndefined(); // Non-prospect → cleared
  });
});

// ============================================================================
// Tests: computePitcherProjection
// ============================================================================

describe('computePitcherProjection', () => {
  it('prospect: always peak mode, TFR rates, age 27', () => {
    const data = makePitcherData({
      isProspect: true,
      trueRating: undefined,
      tfrStuff: 63,
      tfrControl: 56,
      tfrHra: 54,
      estimatedStuff: 50,
      estimatedControl: 44,
      projK9: 9.5,
      projBb9: 2.5,
      projHr9: 0.9,
      projIp: 180,
    });
    const deps = makePitcherDeps();
    const result = computePitcherProjection(data, [], deps);

    expect(result.isPeakMode).toBe(true);
    expect(result.age).toBe(27);
    expect(result.projK9).toBe(9.5);
    expect(result.projBb9).toBe(2.5);
    expect(result.projHr9).toBe(0.9);
    expect(result.projIp).toBe(180);
    expect(result.ratingLabel).toBe('TFR');
    expect(result.ratings.stuff).toBe(63); // TFR, not estimated
    expect(result.showActualComparison).toBe(false);
    // WAR should be positive for these good stats
    expect(result.projWar).toBeGreaterThan(0);
  });

  it('MLB pitcher current mode: estimated ratings, actual age', () => {
    const data = makePitcherData({
      age: 30,
      trueRating: 3.5,
      isProspect: false,
      hasTfrUpside: false,
      estimatedStuff: 58,
      estimatedControl: 55,
      estimatedHra: 52,
      projK9: 8.5,
      projBb9: 2.8,
      projHr9: 1.0,
      projFip: 3.60,
      projWar: 3.5,
    });
    const deps = makePitcherDeps({ projectionMode: 'current', projectedIp: 190 });
    const result = computePitcherProjection(data, [], deps);

    expect(result.isPeakMode).toBe(false);
    expect(result.age).toBe(30);
    expect(result.projK9).toBe(8.5);
    expect(result.projIp).toBe(190);
    expect(result.projFip).toBe(3.60);
    expect(result.projWar).toBe(3.5); // Uses canonical value
    expect(result.ratingLabel).toBe('Estimated');
    expect(result.ratings.stuff).toBe(58);
    expect(result.showActualComparison).toBe(true);
  });

  it('MLB pitcher peak toggle: recalculates from TFR ratings, ignores pre-computed', () => {
    const data = makePitcherData({
      age: 24,
      trueRating: 2.5,
      isProspect: false,
      hasTfrUpside: true,
      estimatedStuff: 45,
      estimatedControl: 42,
      estimatedHra: 44,
      tfrStuff: 65,
      tfrControl: 60,
      tfrHra: 58,
      // Pre-computed values based on current TR — should be ignored in peak mode
      projK9: 5.41,
      projBb9: 3.04,
      projHr9: 1.02,
      projFip: 4.50,
      projIp: 150,
      projWar: 1.0,
    });
    const deps = makePitcherDeps({ projectionMode: 'peak' });
    const result = computePitcherProjection(data, [], deps);

    expect(result.isPeakMode).toBe(true);
    expect(result.age).toBe(27);
    // K/9 = (65 + 28) / 13.5 ≈ 6.89
    expect(result.projK9).toBeCloseTo(6.89, 1);
    // BB/9 = (100.4 - 60) / 19.2 ≈ 2.10
    expect(result.projBb9).toBeCloseTo(2.10, 1);
    // HR/9 = (86.7 - 58) / 41.7 ≈ 0.69
    expect(result.projHr9).toBeCloseTo(0.69, 1);
    // FIP and WAR should be recalculated, not the pre-computed values
    expect(result.projFip).not.toBeCloseTo(4.50, 1);
    expect(result.projWar).not.toBeCloseTo(1.0, 0);
    expect(result.projWar).toBeGreaterThan(1.0);
    expect(result.ratingLabel).toBe('TFR');
    expect(result.ratings.stuff).toBe(65);
    expect(result.ratings.control).toBe(60);
    expect(result.ratings.hra).toBe(58);
  });

  it('pitcher with no rate stats: falls back to rating inversion', () => {
    const data = makePitcherData({
      isProspect: false,
      trueRating: 2.5,
      estimatedStuff: 50,
      estimatedControl: 45,
      estimatedHra: 40,
      projK9: undefined,
      projBb9: undefined,
      projHr9: undefined,
    });
    const deps = makePitcherDeps({ projectedIp: 170 });
    const result = computePitcherProjection(data, [], deps);

    // K/9 = (50 + 28) / 13.5 ≈ 5.78
    expect(result.projK9).toBeCloseTo(5.78, 1);
    // BB/9 = (100.4 - 45) / 19.2 ≈ 2.89
    expect(result.projBb9).toBeCloseTo(2.89, 1);
    // HR/9 = (86.7 - 40) / 41.7 ≈ 1.12
    expect(result.projHr9).toBeCloseTo(1.12, 1);
  });
});

// ============================================================================
// Tests: Scouting Toggle — TR Snapshot Swap
// ============================================================================

describe('scouting toggle: batter TR snapshot swap', () => {
  // Scenario: Dermot Timney-like player — 103 PA rookie, custom scout has
  // contact 80 potential, OSA has 70. With increased blended rate precision
  // (4 decimals for avg, 2 for pct), the TR blends produce different stored
  // values that the projection can use directly.

  const customTR = makeHitterTR({
    estimatedContact: 60,
    estimatedEye: 52,
    estimatedAvoidK: 48,
    estimatedPower: 50,
    estimatedGap: 55,
    estimatedSpeed: 45,
    blendedAvg: 0.2724,     // 4-decimal precision (was .272 at 3)
    blendedBbPct: 9.12,     // 2-decimal precision (was 9.1 at 1)
    blendedKPct: 22.45,
    blendedHrPct: 2.53,
    blendedDoublesRate: 0.038,
    blendedTriplesRate: 0.004,
    woba: 0.310,
    trueRating: 2.5,
    percentile: 40,
  });

  const osaTR = makeHitterTR({
    estimatedContact: 57,
    estimatedEye: 47,
    estimatedAvoidK: 46,
    estimatedPower: 48,
    estimatedGap: 45,
    estimatedSpeed: 43,
    blendedAvg: 0.2625,     // different at 4 decimals
    blendedBbPct: 8.54,     // different at 2 decimals
    blendedKPct: 23.18,
    blendedHrPct: 2.31,
    blendedDoublesRate: 0.038,
    blendedTriplesRate: 0.004,
    woba: 0.300,
    trueRating: 2.0,
    percentile: 35,
  });

  it('snapshotBatterTr captures blended rates from data', () => {
    const data = makeBatterData();
    resolveCanonicalBatterData(data, customTR, undefined);
    const snap = snapshotBatterTr(data);

    expect(snap.estimatedContact).toBe(60);
    expect(snap.projAvg).toBe(0.2724);
    expect(snap.projBbPct).toBe(9.12);
  });

  it('batterTrFromPrecomputed builds snapshot from raw TR result', () => {
    const snap = batterTrFromPrecomputed(osaTR);

    expect(snap.estimatedContact).toBe(57);
    expect(snap.projAvg).toBe(0.2625);
    expect(snap.projBbPct).toBe(8.54);
  });

  it('applyBatterTrSnapshot sets blended rates and clears derived fields', () => {
    const data = makeBatterData({
      projAvg: 0.270,
      projBbPct: 9.0,
      projObp: 0.340,
      projSlg: 0.440,
      projWar: 3.0,
      projPa: 580,
    });
    const snap: BatterTrSourceData = {
      trueRating: 2.5,
      percentile: 40,
      woba: 0.310,
      estimatedContact: 60,
      estimatedEye: 52,
      estimatedAvoidK: 48,
      estimatedPower: 50,
      estimatedGap: 55,
      estimatedSpeed: 45,
      projAvg: 0.2724,
      projBbPct: 9.12,
    };

    applyBatterTrSnapshot(data, snap);

    // Estimated ratings applied
    expect(data.estimatedContact).toBe(60);
    // Blended rates SET from snapshot
    expect(data.projAvg).toBe(0.2724);
    expect(data.projBbPct).toBe(9.12);
    // Derived fields CLEARED for recomputation
    expect(data.projObp).toBeUndefined();
    expect(data.projSlg).toBeUndefined();
    expect(data.projWar).toBeUndefined();
    expect(data.projPa).toBeUndefined();
  });

  it('projections differ after toggle using canonical blended rates', () => {
    const data = makeBatterData({ age: 23, isProspect: false });
    resolveCanonicalBatterData(data, customTR, undefined);

    const deps = makeBatterDeps({ projectionMode: 'current' });

    // Simulate toggle to OSA
    const osaSnap = batterTrFromPrecomputed(osaTR);
    applyBatterTrSnapshot(data, osaSnap);
    const afterOsa = computeBatterProjection(data, [], deps);

    // Simulate toggle back to custom
    const customSnap = batterTrFromPrecomputed(customTR);
    applyBatterTrSnapshot(data, customSnap);
    const afterCustom = computeBatterProjection(data, [], deps);

    // Blended rates differ → projections differ
    // Custom blendedAvg .2724 vs OSA blendedAvg .2625
    expect(afterCustom.projAvg).not.toBe(afterOsa.projAvg);
    expect(afterCustom.projBbPct).not.toBe(afterOsa.projBbPct);

    // Verify they use the canonical blended rates
    expect(afterCustom.projBbPct).toBe(9.12);
    expect(afterOsa.projBbPct).toBe(8.54);
  });

  it('initial render uses canonical blended rates from TR', () => {
    const data = makeBatterData({ age: 28, isProspect: false });
    resolveCanonicalBatterData(data, customTR, undefined);

    // projAvg set from blendedAvg at full precision
    expect(data.projAvg).toBe(0.2724);
    expect(data.projBbPct).toBe(9.12);
  });
});

describe('scouting toggle: pitcher TR snapshot swap', () => {
  const customPitcherTR = makePitcherTR({
    estimatedStuff: 58,
    estimatedControl: 52,
    estimatedHra: 50,
    blendedK9: 8.523,    // 3-decimal precision (was 8.52 at 2)
    blendedBb9: 2.812,
    blendedHr9: 1.023,
    trueRating: 3.0,
    percentile: 55,
    fipLike: 3.70,
  });

  const osaPitcherTR = makePitcherTR({
    estimatedStuff: 54,
    estimatedControl: 48,
    estimatedHra: 46,
    blendedK9: 8.187,    // different at 3 decimals
    blendedBb9: 3.015,
    blendedHr9: 1.108,
    trueRating: 2.5,
    percentile: 45,
    fipLike: 4.00,
  });

  it('pitcher projections differ after toggle using canonical blended rates', () => {
    const data = makePitcherData({ age: 24, isProspect: false });
    resolveCanonicalPitcherData(data, customPitcherTR, undefined);

    const deps = makePitcherDeps({ projectionMode: 'current', projectedIp: 180 });

    // Initial: uses canonical blended rates
    const before = computePitcherProjection(data, [], deps);
    expect(before.projK9).toBe(8.523);

    // Toggle to OSA
    const osaSnap = pitcherTrFromPrecomputed(osaPitcherTR);
    applyPitcherTrSnapshot(data, osaSnap);
    const afterOsa = computePitcherProjection(data, [], deps);

    // Toggle back to custom
    const customSnap = pitcherTrFromPrecomputed(customPitcherTR);
    applyPitcherTrSnapshot(data, customSnap);
    const afterCustom = computePitcherProjection(data, [], deps);

    // Blended rates differ → projections differ
    expect(afterCustom.projK9).toBe(8.523);
    expect(afterOsa.projK9).toBe(8.187);
    expect(afterCustom.projK9).not.toBe(afterOsa.projK9);

    expect(afterCustom.projBb9).not.toBe(afterOsa.projBb9);
    expect(afterCustom.projFip).not.toBe(afterOsa.projFip);
    expect(afterCustom.projWar).not.toBe(afterOsa.projWar);
  });

  it('applyPitcherTrSnapshot sets blended rates and clears derived fields', () => {
    const data = makePitcherData({
      projK9: 8.5,
      projBb9: 2.8,
      projHr9: 1.0,
      projFip: 3.70,
      projWar: 3.5,
      projIp: 180,
    });

    const snap: PitcherTrSourceData = {
      trueRating: 2.5,
      percentile: 45,
      fipLike: 4.00,
      estimatedStuff: 54,
      estimatedControl: 48,
      estimatedHra: 46,
      projK9: 8.187,
      projBb9: 3.015,
      projHr9: 1.108,
    };

    applyPitcherTrSnapshot(data, snap);

    // Ratings applied
    expect(data.estimatedStuff).toBe(54);
    expect(data.estimatedControl).toBe(48);
    // Blended rates SET from snapshot
    expect(data.projK9).toBe(8.187);
    expect(data.projBb9).toBe(3.015);
    expect(data.projHr9).toBe(1.108);
    // Derived fields CLEARED for recomputation
    expect(data.projFip).toBeUndefined();
    expect(data.projWar).toBeUndefined();
    expect(data.projIp).toBeUndefined();
  });
});
