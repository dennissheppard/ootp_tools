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
