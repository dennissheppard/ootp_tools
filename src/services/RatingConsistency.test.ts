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
import { RatingEstimatorService } from './RatingEstimatorService';
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

const pitcherScoutingRatings: PitcherScoutingRatings = {
  playerId: 1,
  stuff: 70,
  control: 65,
  hra: 60,
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

    // Blended rates should be identical because there's only one year
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

    // Need 3 players for percentile ranking, use single-year for the one we care about
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

    // Blended rates should be identical because there's only one year
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
    // Compare pitchers within the SP tier
    const spResults = pitcherResults.filter(r => r.role === 'SP');
    if (spResults.length >= 2) {
      const sorted = [...spResults].sort((a, b) => a.fipLike - b.fipLike);
      // Lower FIP (sorted[0]) should have higher or equal percentile
      expect(sorted[0].percentile).toBeGreaterThanOrEqual(sorted[sorted.length - 1].percentile);
    }
  });

  test('hitter: higher WAR produces higher or equal percentile', () => {
    const sorted = [...hitterResults].sort((a, b) => b.war - a.war);
    // Higher WAR (sorted[0]) should have higher or equal percentile
    expect(sorted[0].percentile).toBeGreaterThanOrEqual(sorted[sorted.length - 1].percentile);
  });

  test('hitter: highest blendedHrPct has highest estimatedPower', () => {
    const byHrPct = [...hitterResults].sort((a, b) => b.blendedHrPct - a.blendedHrPct);
    const byPower = [...hitterResults].sort((a, b) => b.estimatedPower - a.estimatedPower);
    // Player with highest HR% should have highest power rating
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
// 4. Rating Estimator Round-Trip
// ============================================================================

describe('Rating Estimator Round-Trip', () => {
  // Pitcher round-trips: forward (PotentialStatsService) → inverse (RatingEstimatorService)
  // The TrueRatingsCalculationService inverse formulas use different coefficients
  // than RatingEstimatorService, so we test the RatingEstimatorService's own round-trip.

  test('pitcher: Stuff → K/9 → estimateStuff round-trips within tolerance', () => {
    for (const stuff of [30, 45, 55, 65, 75]) {
      const k9 = PotentialStatsService.calculateK9(stuff);
      const estimated = RatingEstimatorService.estimateStuff(k9, 200);
      // RatingEstimatorService uses different coefficients than PotentialStatsService inverse,
      // so we allow wider tolerance (different calibration data)
      expect(estimated.rating).toBeGreaterThanOrEqual(stuff - 10);
      expect(estimated.rating).toBeLessThanOrEqual(stuff + 10);
    }
  });

  test('pitcher: Control → BB/9 → estimateControl round-trips within tolerance', () => {
    for (const control of [30, 45, 55, 65, 75]) {
      const bb9 = PotentialStatsService.calculateBB9(control);
      const estimated = RatingEstimatorService.estimateControl(bb9, 200);
      expect(estimated.rating).toBeGreaterThanOrEqual(control - 10);
      expect(estimated.rating).toBeLessThanOrEqual(control + 10);
    }
  });

  test('pitcher: HRA → HR/9 → estimateHRA round-trips within tolerance', () => {
    for (const hra of [30, 45, 55, 65, 75]) {
      const hr9 = PotentialStatsService.calculateHR9(hra);
      const estimated = RatingEstimatorService.estimateHRA(hr9, 200);
      expect(estimated.rating).toBeGreaterThanOrEqual(hra - 10);
      expect(estimated.rating).toBeLessThanOrEqual(hra + 10);
    }
  });

  // Hitter round-trips: forward (expectedXxx) → inverse (estimateXxx)
  // These use the same regression coefficients so should round-trip exactly.

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
    // Test low segment (power <= 50)
    for (const power of [25, 35, 45, 50]) {
      const hrPct = HitterRatingEstimatorService.expectedHrPct(power);
      const estimated = HitterRatingEstimatorService.estimatePower(hrPct, 500);
      expect(estimated.rating).toBe(power);
    }
    // Test high segment (power > 50)
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
      // All fields that PitcherProfileModal overrides must be present and defined
      expect(r.trueRating).toBeDefined();
      expect(r.percentile).toBeDefined();
      expect(r.fipLike).toBeDefined();
      expect(r.estimatedStuff).toBeDefined();
      expect(r.estimatedControl).toBeDefined();
      expect(r.estimatedHra).toBeDefined();
      expect(r.blendedK9).toBeDefined();
      expect(r.blendedBb9).toBeDefined();
      expect(r.blendedHr9).toBeDefined();
      // None should be NaN
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
      // None should be NaN
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
      // FIP-like (without constant) = (13*HR9 + 3*BB9 - 2*K9) / 9
      const manualFipLike = (13 * r.blendedHr9 + 3 * r.blendedBb9 - 2 * r.blendedK9) / 9;
      // Allow small rounding difference since blended rates are rounded to 2 decimals
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
      // Recalculate wOBA from the blended rates stored on the result
      const recalculated = hitterTrueRatingsCalculationService.calculateWobaFromRates(
        r.blendedBbPct, r.blendedKPct, r.blendedHrPct, r.blendedAvg
      );
      // Should match within rounding tolerance (result stores 3 decimal places)
      expect(r.woba).toBeCloseTo(recalculated, 2);
    }
  });

  test('RatingEstimatorService.estimateAll determinism: identical stat lines produce identical ratings', () => {
    const stats = {
      pa: 600, ab: 520, h: 145, d: 30, t: 5, hr: 25, bb: 60, k: 130,
    };

    const result1 = HitterRatingEstimatorService.estimateAll(stats);
    const result2 = HitterRatingEstimatorService.estimateAll(stats);

    expect(result1.power.rating).toBe(result2.power.rating);
    expect(result1.eye.rating).toBe(result2.eye.rating);
    expect(result1.avoidK.rating).toBe(result2.avoidK.rating);
    expect(result1.contact.rating).toBe(result2.contact.rating);
    expect(result1.gap.rating).toBe(result2.gap.rating);
    expect(result1.speed.rating).toBe(result2.speed.rating);
    expect(result1.woba).toBe(result2.woba);
  });
});
