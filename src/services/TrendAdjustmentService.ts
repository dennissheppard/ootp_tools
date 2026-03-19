/**
 * TrendAdjustmentService
 *
 * Adjusts blended rates based on multi-year trend direction.
 * Runs AFTER multi-year blending + regression + scouting blend,
 * but BEFORE wOBA/FIP calculation and aging.
 *
 * Problem solved: A weighted average of declining years (.549, .548, .480)
 * can land ABOVE the most recent year because older elite years pull it up.
 * The trend adjustment detects this and pulls the blended rate toward
 * the most recent year's actual value.
 *
 * Asymmetric: trusts declines more than improvements (breakouts are noisier).
 */

// ============================================================================
// Types
// ============================================================================

export interface TrendResult {
  adjustedRate: number;
  trendSlope: number;        // rate-units per year (negative = declining for "higher is better" stats)
  trendConsistency: number;  // 0-1, how monotonic the trend is
  pullFraction: number;      // how much of the gap we pulled (0-1)
  gap: number;               // blendedRate - mostRecentRate (positive = blended inflated)
}

export interface BatterTrendTrace {
  bbPct: TrendResult;
  kPct: TrendResult;
  hrPct: TrendResult;
  avg: TrendResult;
  doublesRate: TrendResult;
  triplesRate: TrendResult;
}

export interface PitcherTrendTrace {
  k9: TrendResult;
  bb9: TrendResult;
  hr9: TrendResult;
}

interface YearRate {
  year: number;
  rate: number;
  weight: number;
  sampleSize: number;
}

// ============================================================================
// Configuration
// ============================================================================

/** Maximum pull toward recent year for consistent declines */
const DECLINE_PULL_MAX = 0.65;

/** Maximum pull toward recent year for consistent improvements */
const IMPROVE_PULL_MAX = 0.25;

/** Minimum recent-year sample size for full pull strength */
const MIN_BATTER_PA = 300;
const MIN_PITCHER_IP = 80;

// ============================================================================
// Core algorithm
// ============================================================================

/**
 * Compute trend adjustment for a single rate stat.
 *
 * @param yearlyRates Per-year rate values with weights and sample sizes
 * @param blendedRate The current blended rate (after regression + scouting)
 * @param higherIsBetter True for stats where higher = better (AVG, BB%, HR%, K/9)
 *                       False for stats where lower = better (K%, BB/9, HR/9)
 * @param minSampleSize Minimum recent-year sample for full pull strength
 */
export function computeTrendForRate(
  yearlyRates: YearRate[],
  blendedRate: number,
  higherIsBetter: boolean,
  minSampleSize: number,
): TrendResult {
  const noAdj: TrendResult = {
    adjustedRate: blendedRate,
    trendSlope: 0,
    trendConsistency: 0,
    pullFraction: 0,
    gap: 0,
  };

  // Need 2+ years to detect a trend
  if (yearlyRates.length < 2) return noAdj;

  // Sort by year ascending (oldest first)
  const sorted = [...yearlyRates].sort((a, b) => a.year - b.year);

  // Most recent year
  const recent = sorted[sorted.length - 1];

  // 1. Weighted linear regression: rate vs year
  //    Weight = yearWeight * sampleSize (more recent + larger samples dominate)
  let sumW = 0, sumWX = 0, sumWY = 0, sumWXX = 0, sumWXY = 0;
  for (const pt of sorted) {
    const w = pt.weight * pt.sampleSize;
    sumW += w;
    sumWX += w * pt.year;
    sumWY += w * pt.rate;
    sumWXX += w * pt.year * pt.year;
    sumWXY += w * pt.year * pt.rate;
  }

  const denom = sumW * sumWXX - sumWX * sumWX;
  if (Math.abs(denom) < 1e-10) return noAdj;

  const slope = (sumW * sumWXY - sumWX * sumWY) / denom;

  // 2. Trend consistency: what fraction of consecutive year-pairs agree with slope direction?
  let agreeing = 0;
  const totalPairs = sorted.length - 1;
  for (let i = 0; i < totalPairs; i++) {
    const delta = sorted[i + 1].rate - sorted[i].rate;
    if ((slope >= 0 && delta >= 0) || (slope < 0 && delta < 0)) {
      agreeing++;
    }
  }
  const consistency = totalPairs > 0 ? agreeing / totalPairs : 0;

  // 3. Gap between blended rate and most recent year
  const gap = blendedRate - recent.rate;

  // 4. Determine if this is a decline or improvement
  // "Decline" means the player is getting worse:
  //   - For higherIsBetter stats (AVG, HR%): slope < 0 and gap > 0 (blended above recent)
  //   - For lowerIsBetter stats (K%): slope > 0 and gap < 0 (blended below recent, i.e. better than actual)
  const isDeclining = higherIsBetter
    ? (slope < 0 && gap > 0)   // rate falling, blended inflated above recent
    : (slope > 0 && gap < 0);  // rate rising (getting worse), blended deflated below recent

  const isImproving = higherIsBetter
    ? (slope > 0 && gap < 0)   // rate rising, blended suppressed below recent
    : (slope < 0 && gap > 0);  // rate falling (getting better), blended inflated above recent

  if (!isDeclining && !isImproving) return noAdj;

  // 5. Pull fraction: scale by consistency and sample size
  const maxPull = isDeclining ? DECLINE_PULL_MAX : IMPROVE_PULL_MAX;
  const sampleScale = Math.min(1.0, recent.sampleSize / minSampleSize);
  const pullFraction = maxPull * consistency * sampleScale;

  // 6. Apply: move blended rate toward recent year's value
  const adjustedRate = blendedRate - pullFraction * gap;

  return {
    adjustedRate,
    trendSlope: Math.round(slope * 10000) / 10000,
    trendConsistency: Math.round(consistency * 100) / 100,
    pullFraction: Math.round(pullFraction * 1000) / 1000,
    gap: Math.round(gap * 10000) / 10000,
  };
}

// ============================================================================
// Batter trend adjustment
// ============================================================================

export interface BatterBlendedRates {
  bbPct: number;
  kPct: number;
  hrPct: number;
  avg: number;
  doublesRate: number;
  triplesRate: number;
}

/**
 * Apply trend adjustment to batter blended rates.
 *
 * @param yearlyStats Raw per-year hitting stats
 * @param yearWeights Weight array (index 0 = most recent year weight)
 * @param targetYear The year being projected
 * @param blended Current blended rates (after regression + scouting)
 */
export function applyBatterTrendAdjustment(
  yearlyStats: Array<{ year: number; pa: number; ab: number; h: number; d: number; t: number; hr: number; bb: number; k: number }>,
  yearWeights: number[],
  targetYear: number | undefined,
  blended: BatterBlendedRates,
): { rates: BatterBlendedRates; trace: BatterTrendTrace } {
  // Build per-year rates for each stat
  const perYear = yearlyStats
    .filter(s => s.pa > 0)
    .map(s => {
      const weightIdx = targetYear !== undefined ? targetYear - s.year : 0;
      const weight = (weightIdx >= 0 && weightIdx < yearWeights.length) ? yearWeights[weightIdx] : 0;
      return {
        year: s.year,
        pa: s.pa,
        ab: s.ab,
        bbPct: (s.bb / s.pa) * 100,
        kPct: (s.k / s.pa) * 100,
        hrPct: (s.hr / s.pa) * 100,
        avg: s.ab > 0 ? s.h / s.ab : 0,
        doublesRate: s.ab > 0 ? s.d / s.ab : 0,
        triplesRate: s.ab > 0 ? s.t / s.ab : 0,
        weight,
      };
    })
    .filter(s => s.weight > 0);

  const toYearRates = (getter: (s: typeof perYear[0]) => number): YearRate[] =>
    perYear.map(s => ({ year: s.year, rate: getter(s), weight: s.weight, sampleSize: s.pa }));

  const bbResult = computeTrendForRate(toYearRates(s => s.bbPct), blended.bbPct, true, MIN_BATTER_PA);
  const kResult = computeTrendForRate(toYearRates(s => s.kPct), blended.kPct, false, MIN_BATTER_PA);
  const hrResult = computeTrendForRate(toYearRates(s => s.hrPct), blended.hrPct, true, MIN_BATTER_PA);
  const avgResult = computeTrendForRate(toYearRates(s => s.avg), blended.avg, true, MIN_BATTER_PA);
  const doublesResult = computeTrendForRate(toYearRates(s => s.doublesRate), blended.doublesRate, true, MIN_BATTER_PA);
  const triplesResult = computeTrendForRate(toYearRates(s => s.triplesRate), blended.triplesRate, true, MIN_BATTER_PA);

  return {
    rates: {
      bbPct: bbResult.adjustedRate,
      kPct: kResult.adjustedRate,
      hrPct: hrResult.adjustedRate,
      avg: avgResult.adjustedRate,
      doublesRate: doublesResult.adjustedRate,
      triplesRate: triplesResult.adjustedRate,
    },
    trace: {
      bbPct: bbResult,
      kPct: kResult,
      hrPct: hrResult,
      avg: avgResult,
      doublesRate: doublesResult,
      triplesRate: triplesResult,
    },
  };
}

// ============================================================================
// Pitcher trend adjustment
// ============================================================================

export interface PitcherBlendedRates {
  k9: number;
  bb9: number;
  hr9: number;
}

/**
 * Apply trend adjustment to pitcher blended rates.
 */
export function applyPitcherTrendAdjustment(
  yearlyStats: Array<{ year: number; ip: number; k9: number; bb9: number; hr9: number }>,
  yearWeights: number[],
  targetYear: number | undefined,
  blended: PitcherBlendedRates,
): { rates: PitcherBlendedRates; trace: PitcherTrendTrace } {
  const perYear = yearlyStats
    .filter(s => s.ip > 0)
    .map(s => {
      const weightIdx = targetYear !== undefined ? targetYear - s.year : 0;
      const weight = (weightIdx >= 0 && weightIdx < yearWeights.length) ? yearWeights[weightIdx] : 0;
      return { ...s, weight };
    })
    .filter(s => s.weight > 0);

  const toYearRates = (getter: (s: typeof perYear[0]) => number): YearRate[] =>
    perYear.map(s => ({ year: s.year, rate: getter(s), weight: s.weight, sampleSize: s.ip }));

  // K/9: higher is better for pitcher. BB/9 and HR/9: lower is better.
  const k9Result = computeTrendForRate(toYearRates(s => s.k9), blended.k9, true, MIN_PITCHER_IP);
  const bb9Result = computeTrendForRate(toYearRates(s => s.bb9), blended.bb9, false, MIN_PITCHER_IP);
  const hr9Result = computeTrendForRate(toYearRates(s => s.hr9), blended.hr9, false, MIN_PITCHER_IP);

  return {
    rates: {
      k9: k9Result.adjustedRate,
      bb9: bb9Result.adjustedRate,
      hr9: hr9Result.adjustedRate,
    },
    trace: {
      k9: k9Result,
      bb9: bb9Result,
      hr9: hr9Result,
    },
  };
}
