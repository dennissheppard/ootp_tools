/**
 * Rating Consistency Test Suite
 *
 * Verifies that core calculation services produce consistent, deterministic results.
 * Catches the root cause of TR/TFR/projection discrepancies at the service layer
 * before they manifest as different values across views.
 */

import {
  trueRatingsCalculationService,
  TrueRatingInput,
  TrueRatingResult,
  YearlyPitchingStats,
  PitcherScoutingRatings,
} from './TrueRatingsCalculationService';
import {
  hitterTrueRatingsCalculationService,
  HitterTrueRatingInput,
  HitterTrueRatingResult,
  YearlyHittingStats,
} from './HitterTrueRatingsCalculationService';
import { HitterScoutingRatings } from '../models/ScoutingData';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';
import { PotentialStatsService } from './PotentialStatsService';

// ============================================================================
// Mock Data Fixtures
// ============================================================================

/** Ace SP: elite K/9, low BB/9, low HR/9, 200+ IP */
const acePitcherStats: YearlyPitchingStats[] = [
  { year: 2024, ip: 210, k9: 10.5, bb9: 2.0, hr9: 0.7, gs: 33 },
  { year: 2023, ip: 195, k9: 10.2, bb9: 2.2, hr9: 0.8, gs: 31 },
  { year: 2022, ip: 180, k9: 9.8, bb9: 2.4, hr9: 0.9, gs: 29 },
];

/** Average SP: league-average rates, 170 IP */
const avgPitcherStats: YearlyPitchingStats[] = [
  { year: 2024, ip: 175, k9: 7.5, bb9: 3.2, hr9: 1.1, gs: 30 },
  { year: 2023, ip: 165, k9: 7.2, bb9: 3.0, hr9: 1.0, gs: 28 },
];

/** Reliever: high K/9, moderate walks, low IP */
const relieverStats: YearlyPitchingStats[] = [
  { year: 2024, ip: 65, k9: 11.0, bb9: 3.5, hr9: 0.9, gs: 0 },
  { year: 2023, ip: 60, k9: 10.5, bb9: 3.8, hr9: 1.0, gs: 0 },
];

const acePitcherInput: TrueRatingInput = {
  playerId: 1,
  playerName: 'Ace Pitcher',
  yearlyStats: acePitcherStats,
  role: 'SP',
};

const avgPitcherInput: TrueRatingInput = {
  playerId: 2,
  playerName: 'Average Pitcher',
  yearlyStats: avgPitcherStats,
  role: 'SP',
};

const relieverInput: TrueRatingInput = {
  playerId: 3,
  playerName: 'Setup Man',
  yearlyStats: relieverStats,
  role: 'RP',
};

/** Elite slugger: high HR, high BB, moderate K */
const eliteHitterStats: YearlyHittingStats[] = [
  { year: 2024, pa: 650, ab: 550, h: 165, d: 35, t: 2, hr: 42, bb: 85, k: 140, sb: 5, cs: 2 },
  { year: 2023, pa: 620, ab: 530, h: 155, d: 30, t: 1, hr: 38, bb: 78, k: 135, sb: 3, cs: 1 },
];

/** Average hitter: league-average production */
const avgHitterStats: YearlyHittingStats[] = [
  { year: 2024, pa: 600, ab: 520, h: 135, d: 28, t: 4, hr: 18, bb: 55, k: 120, sb: 8, cs: 4 },
  { year: 2023, pa: 580, ab: 505, h: 130, d: 25, t: 3, hr: 15, bb: 50, k: 115, sb: 10, cs: 5 },
];

/** Speed/contact specialist: high AVG, low HR, high SB */
const speedHitterStats: YearlyHittingStats[] = [
  { year: 2024, pa: 620, ab: 570, h: 180, d: 32, t: 10, hr: 5, bb: 35, k: 70, sb: 40, cs: 10 },
  { year: 2023, pa: 600, ab: 550, h: 172, d: 30, t: 8, hr: 4, bb: 32, k: 65, sb: 35, cs: 8 },
];

const eliteHitterInput: HitterTrueRatingInput = {
  playerId: 101,
  playerName: 'Elite Slugger',
  yearlyStats: eliteHitterStats,
};

const avgHitterInput: HitterTrueRatingInput = {
  playerId: 102,
  playerName: 'Average Joe',
  yearlyStats: avgHitterStats,
};

const speedHitterInput: HitterTrueRatingInput = {
  playerId: 103,
  playerName: 'Speed Demon',
  yearlyStats: speedHitterStats,
};

const VALID_TRUE_RATINGS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

// ============================================================================
// 1. Pitcher TR Determinism
// ============================================================================

describe('Pitcher TR Determinism', () => {
  test('same inputs called twice produce bitwise-identical outputs', () => {
    const inputs = [acePitcherInput, avgPitcherInput, relieverInput];
    const result1 = trueRatingsCalculationService.calculateTrueRatings(inputs);
    const result2 = trueRatingsCalculationService.calculateTrueRatings(inputs);

    expect(result1).toEqual(result2);
  });

  test('single-year stats produce same blended rates regardless of yearWeights', () => {
    const singleYearInput: TrueRatingInput = {
      playerId: 10,
      playerName: 'One Year',
      yearlyStats: [acePitcherStats[0]],
      role: 'SP',
    };

    const result1 = trueRatingsCalculationService.calculateTrueRatings(
      [singleYearInput], undefined, [5, 3, 2]
    );
    const result2 = trueRatingsCalculationService.calculateTrueRatings(
      [singleYearInput], undefined, [10, 0, 0]
    );

    expect(result1[0].blendedK9).toBe(result2[0].blendedK9);
    expect(result1[0].blendedBb9).toBe(result2[0].blendedBb9);
    expect(result1[0].blendedHr9).toBe(result2[0].blendedHr9);
  });

  test('inputs are not mutated by calculation', () => {
    const inputs: TrueRatingInput[] = [
      { ...acePitcherInput, yearlyStats: acePitcherStats.map(s => ({ ...s })) },
    ];
    const inputSnapshot = JSON.parse(JSON.stringify(inputs));

    trueRatingsCalculationService.calculateTrueRatings(inputs);

    expect(inputs[0].yearlyStats).toEqual(inputSnapshot[0].yearlyStats);
    expect(inputs[0].playerId).toBe(inputSnapshot[0].playerId);
    expect(inputs[0].playerName).toBe(inputSnapshot[0].playerName);
  });
});

// ============================================================================
// 2. Batter TR Determinism
// ============================================================================

describe('Batter TR Determinism', () => {
  test('same inputs called twice produce identical outputs', () => {
    const inputs = [eliteHitterInput, avgHitterInput, speedHitterInput];
    const result1 = hitterTrueRatingsCalculationService.calculateTrueRatings(inputs);
    const result2 = hitterTrueRatingsCalculationService.calculateTrueRatings(inputs);

    expect(result1).toEqual(result2);
  });

  test('single-year stats produce same blended rates regardless of yearWeights', () => {
    const singleYearInput: HitterTrueRatingInput = {
      playerId: 110,
      playerName: 'One Year Hitter',
      yearlyStats: [eliteHitterStats[0]],
    };

    const inputs1 = [singleYearInput, avgHitterInput, speedHitterInput];
    const inputs2 = [
      { ...singleYearInput },
      avgHitterInput,
      speedHitterInput,
    ];

    const result1 = hitterTrueRatingsCalculationService.calculateTrueRatings(
      inputs1, undefined, [5, 3, 2]
    );
    const result2 = hitterTrueRatingsCalculationService.calculateTrueRatings(
      inputs2, undefined, [10, 0, 0]
    );

    const r1 = result1.find(r => r.playerId === 110)!;
    const r2 = result2.find(r => r.playerId === 110)!;

    expect(r1.blendedBbPct).toBe(r2.blendedBbPct);
    expect(r1.blendedKPct).toBe(r2.blendedKPct);
    expect(r1.blendedHrPct).toBe(r2.blendedHrPct);
    expect(r1.blendedAvg).toBe(r2.blendedAvg);
  });

  test('inputs are not mutated by calculation', () => {
    const inputs: HitterTrueRatingInput[] = [
      { ...eliteHitterInput, yearlyStats: eliteHitterStats.map(s => ({ ...s })) },
      { ...avgHitterInput, yearlyStats: avgHitterStats.map(s => ({ ...s })) },
      { ...speedHitterInput, yearlyStats: speedHitterStats.map(s => ({ ...s })) },
    ];
    const inputSnapshot = JSON.parse(JSON.stringify(inputs));

    hitterTrueRatingsCalculationService.calculateTrueRatings(inputs);

    expect(inputs).toEqual(inputSnapshot);
  });
});

// ============================================================================
// 3. Cross-Service Consistency
// ============================================================================

describe('Cross-Service Consistency', () => {
  let pitcherResults: TrueRatingResult[];
  let hitterResults: HitterTrueRatingResult[];

  beforeAll(() => {
    pitcherResults = trueRatingsCalculationService.calculateTrueRatings([
      acePitcherInput, avgPitcherInput, relieverInput,
    ]);
    hitterResults = hitterTrueRatingsCalculationService.calculateTrueRatings([
      eliteHitterInput, avgHitterInput, speedHitterInput,
    ]);
  });

  test('pitcher: lower FIP produces higher or equal percentile (within same role tier)', () => {
    const spResults = pitcherResults.filter(r => r.role === 'SP');
    if (spResults.length >= 2) {
      const sorted = [...spResults].sort((a, b) => a.fipLike - b.fipLike);
      expect(sorted[0].percentile).toBeGreaterThanOrEqual(sorted[sorted.length - 1].percentile);
    }
  });

  test('hitter: higher WAR produces higher or equal percentile', () => {
    const sorted = [...hitterResults].sort((a, b) => b.war - a.war);
    expect(sorted[0].percentile).toBeGreaterThanOrEqual(sorted[sorted.length - 1].percentile);
  });

  test('hitter: highest blendedHrPct has highest estimatedPower', () => {
    const byHrPct = [...hitterResults].sort((a, b) => b.blendedHrPct - a.blendedHrPct);
    const byPower = [...hitterResults].sort((a, b) => b.estimatedPower - a.estimatedPower);
    expect(byHrPct[0].playerId).toBe(byPower[0].playerId);
  });

  test('trueRating values are always in the valid set', () => {
    for (const r of pitcherResults) {
      expect(VALID_TRUE_RATINGS).toContain(r.trueRating);
    }
    for (const r of hitterResults) {
      expect(VALID_TRUE_RATINGS).toContain(r.trueRating);
    }
  });

  test('percentiles are always in [0, 100]', () => {
    for (const r of pitcherResults) {
      expect(r.percentile).toBeGreaterThanOrEqual(0);
      expect(r.percentile).toBeLessThanOrEqual(100);
    }
    for (const r of hitterResults) {
      expect(r.percentile).toBeGreaterThanOrEqual(0);
      expect(r.percentile).toBeLessThanOrEqual(100);
    }
  });
});

// ============================================================================
// 4. Rating Estimator Round-Trip (hitter only — pitcher covered in RatingEstimatorService.test.ts)
// ============================================================================

describe('Rating Estimator Round-Trip', () => {
  test('hitter: Eye → BB% → estimateEye round-trips exactly', () => {
    for (const eye of [25, 40, 50, 60, 75]) {
      const bbPct = HitterRatingEstimatorService.expectedBbPct(eye);
      const estimated = HitterRatingEstimatorService.estimateEye(bbPct, 500);
      expect(estimated.rating).toBe(eye);
    }
  });

  test('hitter: AvoidK → K% → estimateAvoidK round-trips exactly', () => {
    for (const avoidK of [25, 40, 50, 60, 75]) {
      const kPct = HitterRatingEstimatorService.expectedKPct(avoidK);
      const estimated = HitterRatingEstimatorService.estimateAvoidK(kPct, 500);
      expect(estimated.rating).toBe(avoidK);
    }
  });

  test('hitter: Power → HR% → estimatePower round-trips exactly (both segments)', () => {
    for (const power of [25, 35, 45, 50]) {
      const hrPct = HitterRatingEstimatorService.expectedHrPct(power);
      const estimated = HitterRatingEstimatorService.estimatePower(hrPct, 500);
      expect(estimated.rating).toBe(power);
    }
    for (const power of [55, 65, 75]) {
      const hrPct = HitterRatingEstimatorService.expectedHrPct(power);
      const estimated = HitterRatingEstimatorService.estimatePower(hrPct, 500);
      expect(estimated.rating).toBe(power);
    }
  });

  test('hitter: Contact → AVG → estimateContact round-trips exactly', () => {
    for (const contact of [25, 40, 50, 60, 75]) {
      const avg = HitterRatingEstimatorService.expectedAvg(contact);
      const estimated = HitterRatingEstimatorService.estimateContact(avg, 500);
      expect(estimated.rating).toBe(contact);
    }
  });

  test('hitter: Gap → doublesRate → estimateGap round-trips exactly', () => {
    for (const gap of [25, 40, 50, 60, 75]) {
      const doublesRate = HitterRatingEstimatorService.expectedDoublesRate(gap);
      const estimated = HitterRatingEstimatorService.estimateGap(doublesRate, 500);
      expect(estimated.rating).toBe(gap);
    }
  });
});

// ============================================================================
// 5. Data Contract Tests
// ============================================================================

describe('Data Contract Tests', () => {
  let pitcherResults: TrueRatingResult[];
  let hitterResults: HitterTrueRatingResult[];

  beforeAll(() => {
    pitcherResults = trueRatingsCalculationService.calculateTrueRatings([
      acePitcherInput, avgPitcherInput, relieverInput,
    ]);
    hitterResults = hitterTrueRatingsCalculationService.calculateTrueRatings([
      eliteHitterInput, avgHitterInput, speedHitterInput,
    ]);
  });

  test('pitcher TrueRatingResult contains all fields PitcherProfileModal needs', () => {
    for (const r of pitcherResults) {
      expect(r.trueRating).toBeDefined();
      expect(r.percentile).toBeDefined();
      expect(r.fipLike).toBeDefined();
      expect(r.estimatedStuff).toBeDefined();
      expect(r.estimatedControl).toBeDefined();
      expect(r.estimatedHra).toBeDefined();
      expect(r.blendedK9).toBeDefined();
      expect(r.blendedBb9).toBeDefined();
      expect(r.blendedHr9).toBeDefined();
      expect(Number.isNaN(r.trueRating)).toBe(false);
      expect(Number.isNaN(r.percentile)).toBe(false);
      expect(Number.isNaN(r.fipLike)).toBe(false);
      expect(Number.isNaN(r.estimatedStuff)).toBe(false);
      expect(Number.isNaN(r.estimatedControl)).toBe(false);
      expect(Number.isNaN(r.estimatedHra)).toBe(false);
    }
  });

  test('batter HitterTrueRatingResult contains all fields BatterProfileModal needs', () => {
    for (const r of hitterResults) {
      expect(r.trueRating).toBeDefined();
      expect(r.percentile).toBeDefined();
      expect(r.woba).toBeDefined();
      expect(r.war).toBeDefined();
      expect(r.estimatedPower).toBeDefined();
      expect(r.estimatedEye).toBeDefined();
      expect(r.estimatedAvoidK).toBeDefined();
      expect(r.estimatedContact).toBeDefined();
      expect(r.estimatedGap).toBeDefined();
      expect(r.estimatedSpeed).toBeDefined();
      expect(r.blendedBbPct).toBeDefined();
      expect(r.blendedKPct).toBeDefined();
      expect(r.blendedHrPct).toBeDefined();
      expect(r.blendedAvg).toBeDefined();
      expect(Number.isNaN(r.trueRating)).toBe(false);
      expect(Number.isNaN(r.woba)).toBe(false);
      expect(Number.isNaN(r.war)).toBe(false);
      expect(Number.isNaN(r.estimatedPower)).toBe(false);
    }
  });

  test('pitcher blended rates are in realistic baseball ranges', () => {
    for (const r of pitcherResults) {
      expect(r.blendedK9).toBeGreaterThanOrEqual(2);
      expect(r.blendedK9).toBeLessThanOrEqual(15);
      expect(r.blendedBb9).toBeGreaterThanOrEqual(0.5);
      expect(r.blendedBb9).toBeLessThanOrEqual(8);
      expect(r.blendedHr9).toBeGreaterThanOrEqual(0.1);
      expect(r.blendedHr9).toBeLessThanOrEqual(3);
    }
  });

  test('batter blended rates are in realistic ranges', () => {
    for (const r of hitterResults) {
      expect(r.blendedBbPct).toBeGreaterThanOrEqual(2);
      expect(r.blendedBbPct).toBeLessThanOrEqual(25);
      expect(r.blendedKPct).toBeGreaterThanOrEqual(5);
      expect(r.blendedKPct).toBeLessThanOrEqual(40);
      expect(r.blendedHrPct).toBeGreaterThanOrEqual(0);
      expect(r.blendedHrPct).toBeLessThanOrEqual(10);
      expect(r.blendedAvg).toBeGreaterThanOrEqual(0.150);
      expect(r.blendedAvg).toBeLessThanOrEqual(0.400);
    }
  });

  test('wOBA is in realistic range (.200-.500) for all hitters', () => {
    for (const r of hitterResults) {
      expect(r.woba).toBeGreaterThanOrEqual(0.200);
      expect(r.woba).toBeLessThanOrEqual(0.500);
    }
  });

  test('WAR per 600 PA is in realistic range (-3 to 10) for all hitters', () => {
    for (const r of hitterResults) {
      expect(r.war).toBeGreaterThanOrEqual(-3);
      expect(r.war).toBeLessThanOrEqual(10);
    }
  });
});

// ============================================================================
// 6. Projection Formula Consistency
// ============================================================================

describe('Projection Formula Consistency', () => {
  test('FIP from blended rates matches manual formula', () => {
    const results = trueRatingsCalculationService.calculateTrueRatings([
      acePitcherInput, avgPitcherInput, relieverInput,
    ]);

    for (const r of results) {
      const manualFipLike = (13 * r.blendedHr9 + 3 * r.blendedBb9 - 2 * r.blendedK9) / 9;
      expect(r.fipLike).toBeCloseTo(manualFipLike, 1);
    }
  });

  test('pitcher FIP from blended rates falls in realistic range (2.0-7.0)', () => {
    const results = trueRatingsCalculationService.calculateTrueRatings([
      acePitcherInput, avgPitcherInput, relieverInput,
    ]);

    for (const r of results) {
      const fullFip = r.fipLike + 3.47;
      expect(fullFip).toBeGreaterThanOrEqual(2.0);
      expect(fullFip).toBeLessThanOrEqual(7.0);
    }
  });

  test('hitter wOBA from component rates is consistent across recalculation', () => {
    const results = hitterTrueRatingsCalculationService.calculateTrueRatings([
      eliteHitterInput, avgHitterInput, speedHitterInput,
    ]);

    for (const r of results) {
      const recalculated = hitterTrueRatingsCalculationService.calculateWobaFromRates(
        r.blendedBbPct, r.blendedKPct, r.blendedHrPct, r.blendedAvg
      );
      expect(r.woba).toBeCloseTo(recalculated, 2);
    }
  });
});

// ============================================================================
// 7. Percentile-to-Rating Consistency Across Services
// ============================================================================

import { trueFutureRatingService } from './TrueFutureRatingService';
import { hitterTrueFutureRatingService } from './HitterTrueFutureRatingService';

describe('Percentile-to-Rating Consistency', () => {
  const CANONICAL_THRESHOLDS: Array<{ percentile: number; expectedRating: number }> = [
    { percentile: 99.0, expectedRating: 5.0 },
    { percentile: 97.0, expectedRating: 4.5 },
    { percentile: 93.0, expectedRating: 4.0 },
    { percentile: 75.0, expectedRating: 3.5 },
    { percentile: 60.0, expectedRating: 3.0 },
    { percentile: 35.0, expectedRating: 2.5 },
    { percentile: 20.0, expectedRating: 2.0 },
    { percentile: 10.0, expectedRating: 1.5 },
    { percentile: 5.0, expectedRating: 1.0 },
    { percentile: 0.0, expectedRating: 0.5 },
  ];

  test('pitcher TFR service uses canonical percentile-to-rating thresholds', () => {
    for (const { percentile, expectedRating } of CANONICAL_THRESHOLDS) {
      expect(trueFutureRatingService.percentileToRating(percentile)).toBe(expectedRating);
    }
  });

  test('hitter TFR service uses canonical percentile-to-rating thresholds', () => {
    for (const { percentile, expectedRating } of CANONICAL_THRESHOLDS) {
      expect(hitterTrueFutureRatingService.percentileToRating(percentile)).toBe(expectedRating);
    }
  });

  test('percentile just below threshold drops to lower rating tier', () => {
    // These boundary cases caught the original bug: the Trade Analyzer used
    // different thresholds (e.g., 84.1 for 4.0 instead of canonical 93.0)
    expect(trueFutureRatingService.percentileToRating(92.9)).toBe(3.5);
    expect(trueFutureRatingService.percentileToRating(96.9)).toBe(4.0);
    expect(trueFutureRatingService.percentileToRating(98.9)).toBe(4.5);
    expect(trueFutureRatingService.percentileToRating(74.9)).toBe(3.0);
    expect(trueFutureRatingService.percentileToRating(59.9)).toBe(2.5);
  });
});

// ============================================================================
// 8. Pitcher Profile Stat Path Consistency
// ============================================================================

describe('Pitcher Profile Stat Path Consistency', () => {
  test('inline inversion formulas track canonical PotentialStatsService formulas', () => {
    for (const rating of [30, 40, 50, 60, 70]) {
      const canonicalK9 = PotentialStatsService.calculateK9(rating);
      const inlineK9 = (rating + 28) / 13.5;
      expect(Math.abs(inlineK9 - canonicalK9)).toBeLessThan(0.15);

      const canonicalBb9 = PotentialStatsService.calculateBB9(rating);
      const inlineBb9 = (100.4 - rating) / 19.2;
      expect(Math.abs(inlineBb9 - canonicalBb9)).toBeLessThan(0.15);

      const canonicalHr9 = PotentialStatsService.calculateHR9(rating);
      const inlineHr9 = (86.7 - rating) / 41.7;
      expect(Math.abs(inlineHr9 - canonicalHr9)).toBeLessThan(0.15);
    }
  });

  test('rating inversion loses precision vs blended rates for real TR results', () => {
    const results = trueRatingsCalculationService.calculateTrueRatings([
      acePitcherInput, avgPitcherInput, relieverInput,
    ]);

    for (const r of results) {
      const fipBlended = ((13 * r.blendedHr9) + (3 * r.blendedBb9) - (2 * r.blendedK9)) / 9 + 3.47;
      const k9Inv = (r.estimatedStuff + 28) / 13.5;
      const bb9Inv = (100.4 - r.estimatedControl) / 19.2;
      const hr9Inv = (86.7 - r.estimatedHra) / 41.7;
      const fipInverted = ((13 * hr9Inv) + (3 * bb9Inv) - (2 * k9Inv)) / 9 + 3.47;

      expect(Math.abs(fipBlended - fipInverted)).toBeLessThan(1.5);
    }
  });

  test('blended rates survive round-trip through estimated ratings for mid-range pitchers', () => {
    const midRangeInput: TrueRatingInput = {
      playerId: 99,
      playerName: 'Mid Range SP',
      yearlyStats: avgPitcherStats,
      role: 'SP',
    };
    const results = trueRatingsCalculationService.calculateTrueRatings([
      midRangeInput, acePitcherInput, relieverInput,
    ]);
    const r = results.find(x => x.playerId === 99)!;

    const k9Inv = (r.estimatedStuff + 28) / 13.5;
    const bb9Inv = (100.4 - r.estimatedControl) / 19.2;
    const hr9Inv = (86.7 - r.estimatedHra) / 41.7;

    expect(Math.abs(k9Inv - r.blendedK9)).toBeLessThan(0.5);
    expect(Math.abs(bb9Inv - r.blendedBb9)).toBeLessThan(0.5);
    expect(Math.abs(hr9Inv - r.blendedHr9)).toBeLessThan(0.5);

    const fipBlended = ((13 * r.blendedHr9) + (3 * r.blendedBb9) - (2 * r.blendedK9)) / 9 + 3.47;
    const fipInverted = ((13 * hr9Inv) + (3 * bb9Inv) - (2 * k9Inv)) / 9 + 3.47;
    expect(Math.abs(fipBlended - fipInverted)).toBeLessThan(0.30);
  });
});

// ============================================================================
// 9. Pool Sensitivity (prevents independent recalculation bugs)
// ============================================================================

describe('Pool Sensitivity', () => {
  test('pitcher: same player gets different TR when pool composition changes', () => {
    const pool1 = trueRatingsCalculationService.calculateTrueRatings([
      acePitcherInput, avgPitcherInput, relieverInput,
    ]);

    const weakPitcher: TrueRatingInput = {
      playerId: 10,
      playerName: 'Weak Pitcher',
      yearlyStats: [{ year: 2024, ip: 80, k9: 5.0, bb9: 5.0, hr9: 1.8, gs: 10 }],
      role: 'SP',
    };
    const pool2 = trueRatingsCalculationService.calculateTrueRatings([
      acePitcherInput, avgPitcherInput, relieverInput, weakPitcher,
    ]);

    // Blended rates are pool-independent
    const avgPool1 = pool1.find(r => r.playerId === 2)!;
    const avgPool2 = pool2.find(r => r.playerId === 2)!;
    expect(avgPool1.blendedK9).toBe(avgPool2.blendedK9);
    expect(avgPool1.fipLike).toBe(avgPool2.fipLike);

    // But percentiles shift — this is WHY all callers must use the same canonical pool
    expect(avgPool1.percentile).not.toBe(avgPool2.percentile);
  });

  test('batter: same player gets different percentile-based ratings when pool changes', () => {
    const pool1 = hitterTrueRatingsCalculationService.calculateTrueRatings([
      eliteHitterInput, avgHitterInput, speedHitterInput,
    ]);

    const weakBatter: HitterTrueRatingInput = {
      playerId: 110,
      playerName: 'Weak Batter',
      yearlyStats: [{ year: 2024, pa: 400, ab: 360, h: 72, d: 10, t: 1, hr: 5, bb: 25, k: 120, sb: 2, cs: 3 }],
    };
    const pool2 = hitterTrueRatingsCalculationService.calculateTrueRatings([
      eliteHitterInput, avgHitterInput, speedHitterInput, weakBatter,
    ]);

    // Blended rates are pool-independent
    const avgPool1 = pool1.find(r => r.playerId === 102)!;
    const avgPool2 = pool2.find(r => r.playerId === 102)!;
    expect(avgPool1.blendedAvg).toBe(avgPool2.blendedAvg);
    expect(avgPool1.woba).toBe(avgPool2.woba);

    // But percentiles shift
    expect(avgPool1.percentile).not.toBe(avgPool2.percentile);
  });
});

// ============================================================================
// 10. TFR Display Logic (hasComponentUpside)
// ============================================================================

import { hasComponentUpside } from '../utils/tfrUpside';

describe('TFR Display Logic', () => {
  test('no upside when gap is below threshold', () => {
    expect(hasComponentUpside([50, 60, 45, 55], [50, 60, 45, 55])).toBe(false); // equal
    expect(hasComponentUpside([50, 60, 45, 55], [48, 58, 43, 53])).toBe(false); // TFR below TR
    expect(hasComponentUpside([50, 60, 45, 55], [54, 60, 45, 55])).toBe(false); // +4, below default threshold of 5
  });

  test('upside detected when any TFR component exceeds TR by >= threshold', () => {
    expect(hasComponentUpside([50, 60, 45, 55], [55, 60, 45, 55])).toBe(true); // +5 = threshold
    expect(hasComponentUpside([50, 60], [57, 60], 8)).toBe(false);  // +7 < custom threshold 8
    expect(hasComponentUpside([50, 60], [58, 60], 8)).toBe(true);   // +8 = custom threshold 8
  });

  test('handles edge cases: undefined components, empty arrays, variable lengths', () => {
    expect(hasComponentUpside([50, undefined, 45], [55, 70, undefined])).toBe(true);  // 55-50=5
    expect(hasComponentUpside([50, undefined, 45], [52, 70, undefined])).toBe(false); // 52-50=2
    expect(hasComponentUpside([], [])).toBe(false);
    // Pitcher 3-component arrays
    expect(hasComponentUpside([50, 60, 45], [55, 60, 45])).toBe(true);
    expect(hasComponentUpside([50, 60, 45], [54, 63, 48])).toBe(false);
  });
});

// ============================================================================
// 11. Scouting Blend — Development Ratio Scaling
// ============================================================================

describe('Scouting Blend — development ratio scaling', () => {
  /** 2-PA player: essentially no statistical signal */
  const sparseStats: YearlyHittingStats[] = [
    { year: 2024, pa: 2, ab: 2, h: 0, d: 0, t: 0, hr: 0, bb: 0, k: 1, sb: 0, cs: 0 },
  ];

  /**
   * 400-PA player: enough experience for meaningful scouting influence.
   * With 400 PA, the experience factor is 400/500=0.8 (no gap) or 400/1200=0.33 (with gap),
   * so scouting targets meaningfully deviate from league average.
   */
  const moderateStats: YearlyHittingStats[] = [
    { year: 2024, pa: 400, ab: 360, h: 90, d: 18, t: 2, hr: 8, bb: 30, k: 90, sb: 3, cs: 1 },
  ];

  /** Above-average scout profile — ceiling clearly above league average */
  const highCeilingScout: HitterScoutingRatings = {
    playerId: 300,
    power: 60, eye: 60, avoidK: 70, contact: 75, gap: 55, speed: 50,
    ovr: 4.0, pot: 4.0, // placeholder — overridden per test
  };

  const sparseBase: HitterTrueRatingInput = {
    playerId: 300, playerName: 'Sparse Batter', yearlyStats: sparseStats,
  };

  const moderateBase: HitterTrueRatingInput = {
    playerId: 300, playerName: 'Moderate Batter', yearlyStats: moderateStats,
  };

  test('no scouting: blendedAvg stays near league average for sparse stats', () => {
    const result = hitterTrueRatingsCalculationService.calculateSingleHitter(sparseBase);
    expect(result.blendedAvg).toBeGreaterThanOrEqual(0.200);
    expect(result.blendedAvg).toBeLessThanOrEqual(0.300);
  });

  test('fully developed (OVR=POT) with enough PA: scouting pulls toward above-avg ceiling', () => {
    const result = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...moderateBase,
      scoutingRatings: { ...highCeilingScout, ovr: 4.0, pot: 4.0 },
    });
    const noScout = hitterTrueRatingsCalculationService.calculateSingleHitter(moderateBase);
    expect(result.blendedAvg).toBeGreaterThan(noScout.blendedAvg);
    expect(result.blendedBbPct).toBeGreaterThan(noScout.blendedBbPct);
    expect(result.blendedKPct).toBeLessThan(noScout.blendedKPct);
  });

  test('with enough PA: devRatio=0.5 (2★/4★) blendedAvg between no-scouting and fully-developed', () => {
    const noScout = hitterTrueRatingsCalculationService.calculateSingleHitter(moderateBase);
    const halfDev = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...moderateBase,
      scoutingRatings: { ...highCeilingScout, ovr: 2.0, pot: 4.0 },
    });
    const fullDev = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...moderateBase,
      scoutingRatings: { ...highCeilingScout, ovr: 4.0, pot: 4.0 },
    });

    expect(halfDev.blendedAvg).toBeGreaterThan(noScout.blendedAvg);
    expect(halfDev.blendedAvg).toBeLessThan(fullDev.blendedAvg);
  });

  test('sparse PA (2 PA): scouting barely influences result regardless of star rating', () => {
    const noScout = hitterTrueRatingsCalculationService.calculateSingleHitter(sparseBase);
    const withScout = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...sparseBase,
      scoutingRatings: { ...highCeilingScout, ovr: 4.0, pot: 4.0 },
    });
    expect(Math.abs(withScout.blendedAvg - noScout.blendedAvg)).toBeLessThanOrEqual(0.005);
  });

  test('devRatio monotonically increases blendedAvg for above-average ceiling scouts', () => {
    const make = (ovr: number) => hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...sparseBase,
      scoutingRatings: { ...highCeilingScout, ovr, pot: 4.0 },
    });
    expect(make(1.0).blendedAvg).toBeLessThan(make(2.0).blendedAvg);
    expect(make(2.0).blendedAvg).toBeLessThan(make(4.0).blendedAvg);
  });

  test('devRatio capped at 1.0: OVR > POT produces same result as OVR = POT', () => {
    const atCeiling = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...sparseBase,
      scoutingRatings: { ...highCeilingScout, ovr: 4.0, pot: 4.0 },
    });
    const overCeiling = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...sparseBase,
      scoutingRatings: { ...highCeilingScout, ovr: 5.0, pot: 4.0 },
    });
    expect(atCeiling.blendedAvg).toBe(overCeiling.blendedAvg);
    expect(atCeiling.blendedBbPct).toBe(overCeiling.blendedBbPct);
    expect(atCeiling.blendedKPct).toBe(overCeiling.blendedKPct);
  });

  test('below-average ceiling: higher devRatio pulls blend target further below league avg', () => {
    const lowCeilingScout: HitterScoutingRatings = {
      playerId: 300,
      power: 35, eye: 35, avoidK: 35, contact: 35, gap: 35, speed: 35,
      ovr: 2.0, pot: 4.0,
    };
    const halfDev = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...sparseBase,
      scoutingRatings: { ...lowCeilingScout, ovr: 2.0, pot: 4.0 },
    });
    const fullDev = hitterTrueRatingsCalculationService.calculateSingleHitter({
      ...sparseBase,
      scoutingRatings: { ...lowCeilingScout, ovr: 4.0, pot: 4.0 },
    });
    expect(fullDev.blendedAvg).toBeLessThan(halfDev.blendedAvg);
  });

  test('blendWithScouting: at threshold PA, blend is exactly 50/50', () => {
    const target = 0.310;
    const regressed = 0.260;
    const blended = hitterTrueRatingsCalculationService.blendWithScouting(
      regressed, target, 350, 350,
    );
    expect(blended).toBeCloseTo((regressed + target) / 2, 4);
  });
});
