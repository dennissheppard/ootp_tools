/**
 * ProspectDevelopmentCurveService
 *
 * Derives current True Rating (TR) for hitter prospects using data-driven
 * development curves from historical cohort analysis (245 MLB players,
 * 2012+ debuts, 600+ PA with MiLB history).
 *
 * For each component (Eye, AvoidK, Power, Contact), players are grouped by
 * their peak MLB stat into cohorts. The PA-weighted average MiLB stat at
 * each age defines an expected development curve. A prospect's TR is derived
 * from where they fall on this curve — baseline from age/cohort, adjusted
 * by actual MiLB performance (Bayesian shrinkage weighted by PA).
 *
 * Gap/Speed have no MiLB stats — they use the average development fraction
 * from the other four components.
 */

import { RatedHitterProspect, RatedProspect } from './TeamRatingsService';

// ============================================================================
// Curve Constants (from tools/research/explore_development_all_components.ts)
// ============================================================================

interface CohortCurve {
  label: string;
  /** Min value for cohort selection (inclusive) */
  cohortMin: number;
  /** Max value for cohort selection (exclusive) */
  cohortMax: number;
  /** PA-weighted mean MiLB stat at each age */
  points: Record<number, number>;
  /** Sample count at each age */
  counts: Record<number, number>;
  /** SD of MiLB/peak ratio (for calibrating adjustment weight) */
  sdOfRatio: number;
}

/**
 * Development curves by component.
 * Each component has cohorts defined by peak MLB stat ranges.
 * Points are PA-weighted mean MiLB stats at ages 18-26.
 */
const DEVELOPMENT_CURVES: Record<string, CohortCurve[]> = {
  // Eye (BB%) — MiLB BB% by age for each peak BB% cohort
  eye: [
    {
      label: '3-5%', cohortMin: 3, cohortMax: 5,
      points: { 18: 6.7, 19: 7.3, 20: 7.5, 21: 7.6, 22: 7.0, 23: 7.2, 24: 7.5, 25: 6.2, 26: 6.4 },
      counts: { 18: 31, 19: 48, 20: 51, 21: 52, 22: 45, 23: 29, 24: 15, 25: 12, 26: 9 },
      sdOfRatio: 0.56,
    },
    {
      label: '5-7%', cohortMin: 5, cohortMax: 7,
      points: { 18: 7.6, 19: 7.9, 20: 8.4, 21: 8.9, 22: 8.9, 23: 9.3, 24: 9.1, 25: 9.6, 26: 8.1 },
      counts: { 18: 42, 19: 72, 20: 94, 21: 98, 22: 89, 23: 59, 24: 49, 25: 20, 26: 15 },
      sdOfRatio: 0.47,
    },
    {
      label: '7-9%', cohortMin: 7, cohortMax: 9,
      points: { 18: 7.3, 19: 8.0, 20: 8.7, 21: 9.8, 22: 10.1, 23: 10.9, 24: 11.9, 25: 10.5, 26: 11.4 },
      counts: { 18: 25, 19: 48, 20: 58, 21: 71, 22: 62, 23: 43, 24: 20, 25: 10, 26: 18 },
      sdOfRatio: 0.40,
    },
    {
      label: '9-11%', cohortMin: 9, cohortMax: 11,
      points: { 19: 9.0, 20: 11.7, 21: 12.6, 22: 13.1, 23: 14.3, 24: 13.1, 25: 13.5, 26: 14.2 },
      counts: { 19: 7, 20: 9, 21: 20, 22: 17, 23: 12, 24: 7, 25: 6, 26: 4 },
      sdOfRatio: 0.40,
    },
    {
      label: '11%+', cohortMin: 11, cohortMax: 25,
      points: { 18: 9.4, 19: 10.1, 20: 10.4, 21: 14.1, 22: 11.5, 23: 14.3, 24: 12.5 },
      counts: { 18: 3, 19: 5, 20: 5, 21: 5, 22: 5, 23: 7, 24: 4 },
      sdOfRatio: 0.20,
    },
  ],

  // AvoidK (K%) — MiLB K% by age (lower is better for the player)
  avoidK: [
    {
      label: '8-12%', cohortMin: 8, cohortMax: 12,
      points: { 18: 13.6, 19: 14.5, 20: 14.0, 21: 11.8, 22: 11.8, 23: 10.0, 24: 9.1, 25: 7.1, 26: 8.9 },
      counts: { 18: 17, 19: 34, 20: 39, 21: 45, 22: 38, 23: 25, 24: 16, 25: 5, 26: 8 },
      sdOfRatio: 0.30,
    },
    {
      label: '12-16%', cohortMin: 12, cohortMax: 16,
      points: { 18: 14.3, 19: 14.0, 20: 13.9, 21: 13.1, 22: 12.6, 23: 12.1, 24: 11.6, 25: 12.3, 26: 12.9 },
      counts: { 18: 49, 19: 78, 20: 96, 21: 116, 22: 102, 23: 61, 24: 38, 25: 26, 26: 17 },
      sdOfRatio: 0.23,
    },
    {
      label: '16-20%', cohortMin: 16, cohortMax: 20,
      points: { 18: 15.4, 19: 14.9, 20: 14.6, 21: 14.7, 22: 15.2, 23: 15.6, 24: 14.2, 25: 14.3, 26: 13.1 },
      counts: { 18: 23, 19: 44, 20: 54, 21: 56, 22: 47, 23: 46, 24: 28, 25: 13, 26: 11 },
      sdOfRatio: 0.17,
    },
    {
      label: '20-25%', cohortMin: 20, cohortMax: 25,
      points: { 18: 19.6, 19: 18.1, 20: 17.0, 21: 16.9, 22: 17.7, 23: 18.6, 24: 17.8, 25: 18.1, 26: 19.0 },
      counts: { 18: 15, 19: 24, 20: 28, 21: 32, 22: 35, 23: 20, 24: 15, 25: 7, 26: 11 },
      sdOfRatio: 0.15,
    },
  ],

  // Power (HR%) — MiLB HR% by age
  power: [
    {
      label: '0-1.5%', cohortMin: 0, cohortMax: 1.5,
      points: { 18: 1.77, 19: 1.75, 20: 1.85, 21: 1.73, 22: 1.74, 23: 1.65, 24: 1.64, 25: 1.81, 26: 1.68 },
      counts: { 18: 25, 19: 54, 20: 62, 21: 73, 22: 60, 23: 51, 24: 33, 25: 20, 26: 22 },
      sdOfRatio: 1.10,
    },
    {
      label: '1.5-3%', cohortMin: 1.5, cohortMax: 3,
      points: { 18: 1.95, 19: 2.21, 20: 2.41, 21: 2.51, 22: 2.46, 23: 2.68, 24: 2.84, 25: 2.51, 26: 2.88 },
      counts: { 18: 63, 19: 100, 20: 124, 21: 143, 22: 128, 23: 84, 24: 53, 25: 26, 26: 24 },
      sdOfRatio: 0.56,
    },
    {
      label: '3-4.5%', cohortMin: 3, cohortMax: 4.5,
      points: { 18: 2.72, 19: 2.67, 20: 3.18, 21: 3.73, 22: 3.73, 23: 3.76, 24: 3.65, 25: 3.87, 26: 5.80 },
      counts: { 18: 19, 19: 33, 20: 38, 21: 37, 22: 36, 23: 20, 24: 9, 25: 5, 26: 4 },
      sdOfRatio: 0.40,
    },
  ],

  // Contact (AVG) — MiLB AVG by age
  contact: [
    {
      label: '.200-.240', cohortMin: 0.200, cohortMax: 0.240,
      points: { 18: 0.250, 19: 0.246, 20: 0.264, 21: 0.265, 22: 0.260, 23: 0.254, 24: 0.257, 25: 0.242, 26: 0.247 },
      counts: { 18: 8, 19: 20, 20: 26, 21: 28, 22: 37, 23: 31, 24: 25, 25: 14, 26: 13 },
      sdOfRatio: 0.14,
    },
    {
      label: '.240-.270', cohortMin: 0.240, cohortMax: 0.270,
      points: { 18: 0.257, 19: 0.260, 20: 0.271, 21: 0.280, 22: 0.277, 23: 0.275, 24: 0.274, 25: 0.261, 26: 0.252 },
      counts: { 18: 51, 19: 71, 20: 85, 21: 97, 22: 90, 23: 60, 24: 38, 25: 22, 26: 21 },
      sdOfRatio: 0.13,
    },
    {
      label: '.270-.300', cohortMin: 0.270, cohortMax: 0.300,
      points: { 18: 0.243, 19: 0.266, 20: 0.277, 21: 0.280, 22: 0.282, 23: 0.286, 24: 0.296, 25: 0.275, 26: 0.283 },
      counts: { 18: 29, 19: 62, 20: 69, 21: 96, 22: 81, 23: 53, 24: 29, 25: 12, 26: 14 },
      sdOfRatio: 0.13,
    },
    {
      label: '.300-.330', cohortMin: 0.300, cohortMax: 0.330,
      points: { 18: 0.271, 19: 0.269, 20: 0.285, 21: 0.293, 22: 0.290, 23: 0.302, 24: 0.293, 25: 0.297 },
      counts: { 18: 17, 19: 36, 20: 47, 21: 37, 22: 23, 23: 14, 24: 7, 25: 3 },
      sdOfRatio: 0.12,
    },
  ],
};

// ============================================================================
// Pitcher Curve Constants (from tools/research/explore_pitcher_development.ts)
// ============================================================================

/**
 * Pitcher development curves by component.
 * Each component has cohorts defined by peak MLB stat ranges.
 * Points are IP-weighted mean MiLB stats at ages 18-26.
 *
 * 135 careers (2012+ debuts, 300+ MLB IP, MiLB history).
 */
const PITCHER_DEVELOPMENT_CURVES: Record<string, CohortCurve[]> = {
  // Stuff (K/9) — higher is better
  stuff: [
    {
      label: '4-6', cohortMin: 4, cohortMax: 6,
      points: { 18: 5.09, 19: 5.33, 20: 5.47, 21: 5.54, 22: 5.24, 23: 5.32, 24: 5.11, 25: 5.21, 26: 5.45 },
      counts: { 18: 17, 19: 41, 20: 46, 21: 51, 22: 43, 23: 23, 24: 12, 25: 7, 26: 7 },
      sdOfRatio: 0.18,
    },
    {
      label: '6-8', cohortMin: 6, cohortMax: 8,
      points: { 18: 5.64, 19: 5.45, 20: 5.76, 21: 5.90, 22: 6.03, 23: 6.35, 24: 6.37, 25: 6.65, 26: 6.68 },
      counts: { 18: 40, 19: 67, 20: 70, 21: 82, 22: 55, 23: 29, 24: 21, 25: 15, 26: 8 },
      sdOfRatio: 0.19,
    },
    {
      label: '8-10', cohortMin: 8, cohortMax: 10,
      // Only 3 players — extrapolate from 6-8 pattern scaled up
      points: { 18: 6.50, 19: 6.80, 20: 7.20, 21: 7.60, 22: 7.90, 23: 8.20, 24: 8.50, 25: 8.80, 26: 9.00 },
      counts: { 18: 3, 19: 3, 20: 3, 21: 3, 22: 3, 23: 3, 24: 3, 25: 3, 26: 3 },
      sdOfRatio: 0.19,
    },
  ],

  // Control (BB/9) — lower is better
  control: [
    {
      label: '1.5-2.5', cohortMin: 1.5, cohortMax: 2.5,
      points: { 18: 3.23, 19: 3.12, 20: 2.71, 21: 2.42, 22: 2.26, 23: 1.99, 24: 1.77, 25: 1.77 },
      counts: { 18: 34, 19: 61, 20: 64, 21: 68, 22: 55, 23: 29, 24: 12, 25: 5 },
      sdOfRatio: 0.46,
    },
    {
      label: '2.5-3.5', cohortMin: 2.5, cohortMax: 3.5,
      points: { 18: 3.41, 19: 3.26, 20: 3.03, 21: 2.70, 22: 2.95, 23: 2.90, 24: 3.34, 25: 3.49, 26: 3.79 },
      counts: { 18: 23, 19: 44, 20: 50, 21: 57, 22: 39, 23: 18, 24: 16, 25: 13, 26: 10 },
      sdOfRatio: 0.32,
    },
    {
      label: '3.5-4.5', cohortMin: 3.5, cohortMax: 4.5,
      points: { 19: 3.63, 20: 3.93, 21: 2.76, 22: 2.99, 23: 3.12, 24: 3.51, 25: 2.44, 26: 4.26 },
      counts: { 19: 4, 20: 4, 21: 4, 22: 5, 23: 5, 24: 4, 25: 3, 26: 3 },
      sdOfRatio: 0.36,
    },
  ],

  // HRA (HR/9) — lower is better
  hra: [
    {
      label: '0.5-0.8', cohortMin: 0.5, cohortMax: 0.8,
      points: { 18: 0.67, 19: 0.67, 20: 0.67, 21: 0.52, 22: 0.58, 23: 0.54, 24: 0.42, 25: 0.36 },
      counts: { 18: 29, 19: 57, 20: 61, 21: 57, 22: 35, 23: 18, 24: 11, 25: 6 },
      sdOfRatio: 0.45,
    },
    {
      label: '0.8-1.1', cohortMin: 0.8, cohortMax: 1.1,
      points: { 18: 0.85, 19: 0.75, 20: 0.66, 21: 0.61, 22: 0.61, 23: 0.57, 24: 0.62, 25: 0.60, 26: 0.67 },
      counts: { 18: 19, 19: 33, 20: 35, 21: 47, 22: 39, 23: 20, 24: 9, 25: 8, 26: 7 },
      sdOfRatio: 0.34,
    },
    {
      label: '1.1-1.5', cohortMin: 1.1, cohortMax: 1.5,
      points: { 18: 0.55, 19: 0.71, 20: 0.79, 21: 0.53, 22: 0.69, 23: 0.53, 24: 0.61, 25: 0.65 },
      counts: { 18: 4, 19: 12, 20: 15, 21: 19, 22: 16, 23: 10, 24: 10, 25: 6 },
      sdOfRatio: 0.27,
    },
  ],
};

/**
 * Stabilization IP thresholds for pitcher individual adjustment shrinkage.
 * Stuff stabilizes fastest (K/9 is highly reliable); HRA needs most IP.
 */
const PITCHER_STABILIZATION_IP: Record<string, number> = {
  stuff: 100,
  control: 150,
  hra: 200,
};

// ============================================================================
// Batter Constants
// ============================================================================

/**
 * Stabilization PA thresholds for individual adjustment shrinkage.
 * Higher = more PA needed before we trust the individual's stats.
 */
const STABILIZATION_PA: Record<string, number> = {
  eye: 600,
  avoidK: 200,
  power: 400,
  contact: 400,
};

/**
 * Rating points adjustment per 100% deviation from expected curve value.
 */
const SENSITIVITY_POINTS = 8;

// ============================================================================
// Service
// ============================================================================

export interface DevelopmentTR {
  eye: number;
  avoidK: number;
  power: number;
  contact: number;
  gap: number;
  speed: number;
}

export interface PitcherDevelopmentTR {
  stuff: number;
  control: number;
  hra: number;
}

class ProspectDevelopmentCurveService {

  /**
   * Select the matching cohort for a projected peak stat value.
   * Falls back to nearest cohort if value is outside all ranges.
   */
  private selectCohort(curves: CohortCurve[], peakStat: number): CohortCurve {
    // Exact match
    for (const c of curves) {
      if (peakStat >= c.cohortMin && peakStat < c.cohortMax) return c;
    }
    // Outside range — use nearest
    if (peakStat < curves[0].cohortMin) return curves[0];
    return curves[curves.length - 1];
  }

  /**
   * Interpolate the expected MiLB stat at a given age from the curve points.
   * Uses linear interpolation between the two nearest age points.
   */
  private interpolateCurve(curve: CohortCurve, age: number): number | undefined {
    const ages = Object.keys(curve.points).map(Number).sort((a, b) => a - b);
    if (ages.length === 0) return undefined;

    // Clamp to curve range
    if (age <= ages[0]) return curve.points[ages[0]];
    if (age >= ages[ages.length - 1]) return curve.points[ages[ages.length - 1]];

    // Find bracketing ages
    for (let i = 0; i < ages.length - 1; i++) {
      if (age >= ages[i] && age <= ages[i + 1]) {
        const t = (age - ages[i]) / (ages[i + 1] - ages[i]);
        return curve.points[ages[i]] + t * (curve.points[ages[i + 1]] - curve.points[ages[i]]);
      }
    }
    return curve.points[ages[ages.length - 1]];
  }

  /**
   * Calculate development fraction: how far along the curve this age is.
   * 0 = youngest age on curve, 1 = oldest age on curve.
   */
  private developmentFraction(curve: CohortCurve, age: number): number {
    const ages = Object.keys(curve.points).map(Number).sort((a, b) => a - b);
    if (ages.length < 2) return 0.5;

    const minAge = ages[0];
    const maxAge = ages[ages.length - 1];
    if (maxAge === minAge) return 0.5;

    const valAtMin = curve.points[minAge];
    const valAtMax = curve.points[maxAge];
    const valAtAge = this.interpolateCurve(curve, age);
    if (valAtAge === undefined) return 0.5;

    // Development fraction based on where the curve value sits between min and max age values
    if (Math.abs(valAtMax - valAtMin) < 0.001) return 0.5;
    const frac = (valAtAge - valAtMin) / (valAtMax - valAtMin);
    return Math.max(0, Math.min(1, frac));
  }

  /**
   * Calculate TR for a single component using development curves.
   *
   * @param component - Component key (e.g. 'eye', 'avoidK', 'stuff', 'control')
   * @param tfrRating - The TFR rating (20-80 scale) for this component
   * @param peakStat - Projected peak stat (e.g., projBbPct for eye, projK9 for stuff)
   * @param age - Prospect's current age
   * @param rawStat - Actual raw MiLB stat (optional, for individual adjustment)
   * @param totalSample - Total MiLB PA or IP (for shrinkage calculation)
   * @param lowerIsBetter - True for AvoidK/Control/HRA (lower = better)
   * @param curveSet - Which curve set to use (default: DEVELOPMENT_CURVES for batters)
   * @param stabilizationMap - Which stabilization thresholds to use
   */
  private calculateComponentTR(
    component: string,
    tfrRating: number,
    peakStat: number,
    age: number,
    rawStat?: number,
    totalSample?: number,
    lowerIsBetter = false,
    curveSet: Record<string, CohortCurve[]> = DEVELOPMENT_CURVES,
    stabilizationMap: Record<string, number> = STABILIZATION_PA,
  ): number {
    const curves = curveSet[component];
    if (!curves) return tfrRating;

    const cohort = this.selectCohort(curves, peakStat);
    const devFraction = this.developmentFraction(cohort, age);

    // For lower-is-better stats, curves trend downward as players develop.
    // The value-based development fraction gives a negative result, so use
    // age-based fraction directly.
    let effectiveDevFraction = devFraction;
    if (lowerIsBetter) {
      const ages = Object.keys(cohort.points).map(Number).sort((a, b) => a - b);
      const minAge = ages[0];
      const maxAge = ages[ages.length - 1];
      effectiveDevFraction = Math.max(0, Math.min(1, (age - minAge) / (maxAge - minAge)));
    }

    // Baseline TR from development fraction
    const baseline = 20 + (tfrRating - 20) * effectiveDevFraction;

    // Individual adjustment (if raw stats available)
    let ratingAdjust = 0;
    if (rawStat !== undefined && totalSample !== undefined && totalSample > 0) {
      const expectedRaw = this.interpolateCurve(cohort, age);
      if (expectedRaw !== undefined && expectedRaw > 0) {
        let deviation = (rawStat - expectedRaw) / expectedRaw;

        // For lower-is-better, lower actual than expected = positive (better)
        if (lowerIsBetter) deviation = -deviation;

        const stabilization = stabilizationMap[component] ?? 400;
        const shrinkage = totalSample / (totalSample + stabilization);
        ratingAdjust = deviation * shrinkage * SENSITIVITY_POINTS;
      }
    }

    // Clamp to [20, tfrRating]
    return Math.round(Math.max(20, Math.min(tfrRating, baseline + ratingAdjust)));
  }

  /**
   * Calculate development-curve-based TR for all six components.
   */
  calculateProspectTR(prospect: RatedHitterProspect): DevelopmentTR {
    const tfrR = prospect.trueRatings;
    const age = prospect.age;
    const rawStats = prospect.rawStats;
    const totalMinorPa = prospect.totalMinorPa;

    // Stats-based components: use curves with individual adjustment
    const eyeTR = this.calculateComponentTR(
      'eye', tfrR.eye, prospect.projBbPct, age,
      rawStats?.bbPct, totalMinorPa, false
    );
    const avoidKTR = this.calculateComponentTR(
      'avoidK', tfrR.avoidK, prospect.projKPct, age,
      rawStats?.kPct, totalMinorPa, true
    );
    const powerTR = this.calculateComponentTR(
      'power', tfrR.power, prospect.projHrPct, age,
      rawStats?.hrPct, totalMinorPa, false
    );
    const contactTR = this.calculateComponentTR(
      'contact', tfrR.contact, prospect.projAvg, age,
      rawStats?.avg, totalMinorPa, false
    );

    // Gap/Speed: no MiLB stats — use average devFraction from the four stats-based components
    const avgDevFraction = this.calculateAverageDevFraction(prospect);
    const gapTR = Math.round(Math.max(20, Math.min(tfrR.gap, 20 + (tfrR.gap - 20) * avgDevFraction)));
    const speedTR = Math.round(Math.max(20, Math.min(tfrR.speed, 20 + (tfrR.speed - 20) * avgDevFraction)));

    return { eye: eyeTR, avoidK: avoidKTR, power: powerTR, contact: contactTR, gap: gapTR, speed: speedTR };
  }

  /**
   * Calculate average development fraction across the four stats-based components.
   * Used for Gap/Speed which have no MiLB stat equivalent.
   */
  private calculateAverageDevFraction(prospect: RatedHitterProspect): number {
    const age = prospect.age;
    const components: { key: string; peakStat: number; lowerIsBetter: boolean }[] = [
      { key: 'eye', peakStat: prospect.projBbPct, lowerIsBetter: false },
      { key: 'avoidK', peakStat: prospect.projKPct, lowerIsBetter: true },
      { key: 'power', peakStat: prospect.projHrPct, lowerIsBetter: false },
      { key: 'contact', peakStat: prospect.projAvg, lowerIsBetter: false },
    ];

    let totalFrac = 0;
    let count = 0;
    for (const comp of components) {
      const curves = DEVELOPMENT_CURVES[comp.key];
      if (!curves) continue;
      const cohort = this.selectCohort(curves, comp.peakStat);

      let frac: number;
      if (comp.lowerIsBetter) {
        const ages = Object.keys(cohort.points).map(Number).sort((a, b) => a - b);
        const minAge = ages[0];
        const maxAge = ages[ages.length - 1];
        frac = Math.max(0, Math.min(1, (age - minAge) / (maxAge - minAge)));
      } else {
        frac = this.developmentFraction(cohort, age);
      }
      totalFrac += frac;
      count++;
    }
    return count > 0 ? totalFrac / count : 0.5;
  }

  /**
   * Get curve diagnostics for trace-rating tool.
   */
  getComponentDiagnostics(
    component: string,
    tfrRating: number,
    peakStat: number,
    age: number,
    rawStat?: number,
    totalMinorPa?: number,
    lowerIsBetter = false,
  ): {
    cohortLabel: string;
    expectedRaw: number | undefined;
    devFraction: number;
    baseline: number;
    deviation: number | undefined;
    shrinkage: number | undefined;
    ratingAdjust: number;
    finalTR: number;
  } {
    const curves = DEVELOPMENT_CURVES[component];
    if (!curves) {
      return {
        cohortLabel: 'N/A', expectedRaw: undefined, devFraction: 0.5,
        baseline: tfrRating, deviation: undefined, shrinkage: undefined,
        ratingAdjust: 0, finalTR: tfrRating,
      };
    }

    const cohort = this.selectCohort(curves, peakStat);
    let effectiveDevFraction: number;
    if (lowerIsBetter) {
      const ages = Object.keys(cohort.points).map(Number).sort((a, b) => a - b);
      const minAge = ages[0];
      const maxAge = ages[ages.length - 1];
      effectiveDevFraction = Math.max(0, Math.min(1, (age - minAge) / (maxAge - minAge)));
    } else {
      effectiveDevFraction = this.developmentFraction(cohort, age);
    }

    const baseline = 20 + (tfrRating - 20) * effectiveDevFraction;
    const expectedRaw = this.interpolateCurve(cohort, age);

    let deviation: number | undefined;
    let shrinkage: number | undefined;
    let ratingAdjust = 0;

    if (rawStat !== undefined && totalMinorPa !== undefined && totalMinorPa > 0 && expectedRaw !== undefined && expectedRaw > 0) {
      deviation = (rawStat - expectedRaw) / expectedRaw;
      if (lowerIsBetter) deviation = -deviation;
      const stabilization = STABILIZATION_PA[component] ?? 400;
      shrinkage = totalMinorPa / (totalMinorPa + stabilization);
      ratingAdjust = deviation * shrinkage * SENSITIVITY_POINTS;
    }

    const finalTR = Math.round(Math.max(20, Math.min(tfrRating, baseline + ratingAdjust)));

    return {
      cohortLabel: cohort.label,
      expectedRaw,
      devFraction: effectiveDevFraction,
      baseline: Math.round(baseline),
      deviation,
      shrinkage,
      ratingAdjust: Math.round(ratingAdjust * 10) / 10,
      finalTR,
    };
  }

  // ==========================================================================
  // Pitcher Development Curves
  // ==========================================================================

  /**
   * Calculate development-curve-based TR for pitcher prospect components.
   *
   * Uses the same algorithm as batter curves but with pitcher-specific
   * cohort data (135 MLB pitchers, 2012+ debuts, 300+ IP).
   *
   * Components:
   * - Stuff (K/9): higher is better
   * - Control (BB/9): lower is better
   * - HRA (HR/9): lower is better
   */
  calculatePitcherProspectTR(prospect: RatedProspect): PitcherDevelopmentTR {
    const tfrR = prospect.trueRatings;
    if (!tfrR) {
      return {
        stuff: 50,
        control: 50,
        hra: 50,
      };
    }

    const age = prospect.age;
    const rawStats = prospect.rawStats;
    const totalMinorIp = prospect.totalMinorIp;

    const stuffTR = this.calculateComponentTR(
      'stuff', tfrR.stuff, prospect.projK9 ?? 0, age,
      rawStats?.k9, totalMinorIp, false,
      PITCHER_DEVELOPMENT_CURVES, PITCHER_STABILIZATION_IP
    );
    const controlTR = this.calculateComponentTR(
      'control', tfrR.control, prospect.projBb9 ?? 0, age,
      rawStats?.bb9, totalMinorIp, true,
      PITCHER_DEVELOPMENT_CURVES, PITCHER_STABILIZATION_IP
    );
    const hraTR = this.calculateComponentTR(
      'hra', tfrR.hra, prospect.projHr9 ?? 0, age,
      rawStats?.hr9, totalMinorIp, true,
      PITCHER_DEVELOPMENT_CURVES, PITCHER_STABILIZATION_IP
    );

    return { stuff: stuffTR, control: controlTR, hra: hraTR };
  }

  /**
   * Get pitcher curve diagnostics for trace-rating tool.
   */
  getPitcherComponentDiagnostics(
    component: string,
    tfrRating: number,
    peakStat: number,
    age: number,
    rawStat?: number,
    totalMinorIp?: number,
    lowerIsBetter = false,
  ): {
    cohortLabel: string;
    expectedRaw: number | undefined;
    devFraction: number;
    baseline: number;
    deviation: number | undefined;
    shrinkage: number | undefined;
    ratingAdjust: number;
    finalTR: number;
  } {
    const curves = PITCHER_DEVELOPMENT_CURVES[component];
    if (!curves) {
      return {
        cohortLabel: 'N/A', expectedRaw: undefined, devFraction: 0.5,
        baseline: tfrRating, deviation: undefined, shrinkage: undefined,
        ratingAdjust: 0, finalTR: tfrRating,
      };
    }

    const cohort = this.selectCohort(curves, peakStat);
    let effectiveDevFraction: number;
    if (lowerIsBetter) {
      const ages = Object.keys(cohort.points).map(Number).sort((a, b) => a - b);
      const minAge = ages[0];
      const maxAge = ages[ages.length - 1];
      effectiveDevFraction = Math.max(0, Math.min(1, (age - minAge) / (maxAge - minAge)));
    } else {
      effectiveDevFraction = this.developmentFraction(cohort, age);
    }

    const baseline = 20 + (tfrRating - 20) * effectiveDevFraction;
    const expectedRaw = this.interpolateCurve(cohort, age);

    let deviation: number | undefined;
    let shrinkage: number | undefined;
    let ratingAdjust = 0;

    if (rawStat !== undefined && totalMinorIp !== undefined && totalMinorIp > 0 && expectedRaw !== undefined && expectedRaw > 0) {
      deviation = (rawStat - expectedRaw) / expectedRaw;
      if (lowerIsBetter) deviation = -deviation;
      const stabilization = PITCHER_STABILIZATION_IP[component] ?? 200;
      shrinkage = totalMinorIp / (totalMinorIp + stabilization);
      ratingAdjust = deviation * shrinkage * SENSITIVITY_POINTS;
    }

    const finalTR = Math.round(Math.max(20, Math.min(tfrRating, baseline + ratingAdjust)));

    return {
      cohortLabel: cohort.label,
      expectedRaw,
      devFraction: effectiveDevFraction,
      baseline: Math.round(baseline),
      deviation,
      shrinkage,
      ratingAdjust: Math.round(ratingAdjust * 10) / 10,
      finalTR,
    };
  }
}

export const prospectDevelopmentCurveService = new ProspectDevelopmentCurveService();
