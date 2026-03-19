import { describe, it, expect } from 'vitest';
import { computeTrendForRate, applyBatterTrendAdjustment, applyPitcherTrendAdjustment } from './TrendAdjustmentService';

describe('computeTrendForRate', () => {
  it('3 years monotonically declining (higher-is-better): pulls ~40% toward recent', () => {
    const yearlyRates = [
      { year: 2019, rate: 0.549, weight: 2, sampleSize: 464 },
      { year: 2020, rate: 0.548, weight: 3, sampleSize: 698 },
      { year: 2021, rate: 0.480, weight: 5, sampleSize: 667 },
    ];
    const blended = 0.510; // weighted avg above 2021's .480
    const result = computeTrendForRate(yearlyRates, blended, true, 300);

    expect(result.trendSlope).toBeLessThan(0); // declining
    expect(result.trendConsistency).toBe(1.0); // fully monotonic
    expect(result.gap).toBeGreaterThan(0); // blended > recent
    expect(result.pullFraction).toBeCloseTo(0.65, 1); // max pull for full consistency + full sample
    expect(result.adjustedRate).toBeLessThan(blended);
    expect(result.adjustedRate).toBeGreaterThan(0.480); // pulled toward but not below recent
  });

  it('3 years monotonically improving (higher-is-better): pulls ~20% toward recent', () => {
    const yearlyRates = [
      { year: 2019, rate: 0.240, weight: 2, sampleSize: 500 },
      { year: 2020, rate: 0.260, weight: 3, sampleSize: 600 },
      { year: 2021, rate: 0.290, weight: 5, sampleSize: 650 },
    ];
    const blended = 0.270; // weighted avg below 2021's .290
    const result = computeTrendForRate(yearlyRates, blended, true, 300);

    expect(result.trendSlope).toBeGreaterThan(0); // improving
    expect(result.trendConsistency).toBe(1.0);
    expect(result.gap).toBeLessThan(0); // blended < recent
    expect(result.pullFraction).toBeCloseTo(0.25, 1); // less aggressive for improvements
    expect(result.adjustedRate).toBeGreaterThan(blended);
    expect(result.adjustedRate).toBeLessThan(0.290);
  });

  it('1 year only: no adjustment', () => {
    const yearlyRates = [
      { year: 2021, rate: 0.300, weight: 5, sampleSize: 600 },
    ];
    const result = computeTrendForRate(yearlyRates, 0.300, true, 300);
    expect(result.adjustedRate).toBe(0.300);
    expect(result.pullFraction).toBe(0);
  });

  it('mixed signal (up then down): reduced consistency reduces pull', () => {
    const yearlyRates = [
      { year: 2019, rate: 0.280, weight: 2, sampleSize: 500 },
      { year: 2020, rate: 0.310, weight: 3, sampleSize: 600 }, // up
      { year: 2021, rate: 0.270, weight: 5, sampleSize: 650 }, // down
    ];
    const blended = 0.285;
    const result = computeTrendForRate(yearlyRates, blended, true, 300);

    // One pair agrees with slope, one doesn't → consistency = 0.5
    expect(result.trendConsistency).toBe(0.5);
    // Pull should be weaker than monotonic
    expect(result.pullFraction).toBeLessThan(0.65);
  });

  it('small sample recent year: reduced pull', () => {
    const yearlyRates = [
      { year: 2019, rate: 0.300, weight: 2, sampleSize: 500 },
      { year: 2020, rate: 0.280, weight: 3, sampleSize: 600 },
      { year: 2021, rate: 0.250, weight: 5, sampleSize: 100 }, // small sample
    ];
    const blended = 0.275;
    const result = computeTrendForRate(yearlyRates, blended, true, 300);

    // sampleScale = min(1.0, 100/300) = 0.333
    // pullFraction = 0.65 * 1.0 * 0.333 = ~0.217
    expect(result.pullFraction).toBeLessThan(0.25);
    expect(result.pullFraction).toBeGreaterThan(0);
  });

  it('no change across years: no adjustment', () => {
    const yearlyRates = [
      { year: 2019, rate: 0.280, weight: 2, sampleSize: 500 },
      { year: 2020, rate: 0.280, weight: 3, sampleSize: 600 },
      { year: 2021, rate: 0.280, weight: 5, sampleSize: 650 },
    ];
    const blended = 0.280;
    const result = computeTrendForRate(yearlyRates, blended, true, 300);

    expect(result.gap).toBe(0);
    expect(result.adjustedRate).toBe(0.280);
  });

  it('lower-is-better stat (K%): declining performance means slope > 0', () => {
    const yearlyRates = [
      { year: 2019, rate: 15.0, weight: 2, sampleSize: 500 },
      { year: 2020, rate: 18.0, weight: 3, sampleSize: 600 },
      { year: 2021, rate: 22.0, weight: 5, sampleSize: 650 },
    ];
    const blended = 19.0; // below (better than) 2021's 22.0
    const result = computeTrendForRate(yearlyRates, blended, false, 300);

    expect(result.trendSlope).toBeGreaterThan(0); // K% rising = decline
    expect(result.gap).toBeLessThan(0); // blended < recent (blended looks better than reality)
    expect(result.adjustedRate).toBeGreaterThan(blended); // pulled up toward worse recent value
  });
});

describe('applyBatterTrendAdjustment', () => {
  it('declining slugger gets rates pulled toward recent year', () => {
    const yearlyStats = [
      { year: 2019, pa: 464, ab: 420, h: 147, d: 30, t: 2, hr: 17, bb: 40, k: 50 },
      { year: 2020, pa: 698, ab: 630, h: 212, d: 35, t: 1, hr: 29, bb: 60, k: 100 },
      { year: 2021, pa: 667, ab: 600, h: 174, d: 25, t: 0, hr: 25, bb: 65, k: 119 },
    ];
    const yearWeights = [5, 3, 2];
    const blended = {
      bbPct: 9.5, kPct: 16.0, hrPct: 3.8,
      avg: 0.310, doublesRate: 0.050, triplesRate: 0.003,
    };

    const result = applyBatterTrendAdjustment(yearlyStats, yearWeights, 2022, blended);

    // AVG declined (0.350 -> 0.337 -> 0.290), blended 0.310 should be pulled down
    expect(result.rates.avg).toBeLessThan(blended.avg);
    // Trace should have data for each component
    expect(result.trace.avg.trendSlope).toBeLessThan(0);
  });
});

describe('applyPitcherTrendAdjustment', () => {
  it('pitcher with declining K/9 gets rate pulled toward recent', () => {
    const yearlyStats = [
      { year: 2019, ip: 180, k9: 10.5, bb9: 2.5, hr9: 1.0 },
      { year: 2020, ip: 190, k9: 9.8, bb9: 2.8, hr9: 1.1 },
      { year: 2021, ip: 170, k9: 8.5, bb9: 3.2, hr9: 1.3 },
    ];
    const yearWeights = [5, 3, 2];
    const blended = { k9: 9.3, bb9: 2.9, hr9: 1.15 };

    const result = applyPitcherTrendAdjustment(yearlyStats, yearWeights, 2022, blended);

    // K/9 declining, blended above recent → pulled down
    expect(result.rates.k9).toBeLessThan(blended.k9);
    // BB/9 increasing (worse), blended below recent → pulled up
    expect(result.rates.bb9).toBeGreaterThan(blended.bb9);
    // HR/9 increasing (worse), blended below recent → pulled up
    expect(result.rates.hr9).toBeGreaterThan(blended.hr9);
  });
});
