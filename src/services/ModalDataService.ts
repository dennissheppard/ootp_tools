/**
 * ModalDataService — Pure functions for modal data assembly and projection calculation.
 *
 * Extracts the branching logic from BatterProfileModal.show() and
 * PitcherProfileModal.show(), and the calculation logic from their
 * renderProjectionContent() methods, into testable pure functions.
 */

import type { BatterProfileData } from '../views/BatterProfileModal';
import type { PitcherProfileData } from '../views/PitcherProfileModal';
import type { HitterTrueRatingResult } from './HitterTrueRatingsCalculationService';
import type { TrueRatingResult } from './TrueRatingsCalculationService';
import type { RatedHitterProspect, RatedProspect } from './TeamRatingsService';
import { hasComponentUpside } from '../utils/tfrUpside';
import { HitterRatingEstimatorService } from './HitterRatingEstimatorService';

// ============================================================================
// TR Source Snapshots (for scouting toggle — swap TR-derived projection fields)
// ============================================================================

export interface BatterTrSourceData {
  trueRating?: number;
  percentile?: number;
  woba?: number;
  estimatedPower?: number;
  estimatedEye?: number;
  estimatedAvoidK?: number;
  estimatedContact?: number;
  estimatedGap?: number;
  estimatedSpeed?: number;
  projBbPct?: number;
  projKPct?: number;
  projHrPct?: number;
  projAvg?: number;
  projWoba?: number;
  projDoublesRate?: number;
  projTriplesRate?: number;
}

export interface PitcherTrSourceData {
  trueRating?: number;
  percentile?: number;
  fipLike?: number;
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;
  projK9?: number;
  projBb9?: number;
  projHr9?: number;
}

export function snapshotBatterTr(data: BatterProfileData): BatterTrSourceData {
  return {
    trueRating: data.trueRating,
    percentile: data.percentile,
    woba: data.woba,
    estimatedPower: data.estimatedPower,
    estimatedEye: data.estimatedEye,
    estimatedAvoidK: data.estimatedAvoidK,
    estimatedContact: data.estimatedContact,
    estimatedGap: data.estimatedGap,
    estimatedSpeed: data.estimatedSpeed,
    projBbPct: data.projBbPct,
    projKPct: data.projKPct,
    projHrPct: data.projHrPct,
    projAvg: data.projAvg,
    projWoba: data.projWoba,
    projDoublesRate: data.projDoublesRate,
    projTriplesRate: data.projTriplesRate,
  };
}

export function applyBatterTrSnapshot(data: BatterProfileData, snap: BatterTrSourceData): void {
  // Apply canonical TR fields — both estimated ratings and blended rates.
  // Projections use blended rates directly (per pipeline-map.html design rules).
  // Blended rates are stored at sufficient precision to surface scouting differences.
  data.trueRating = snap.trueRating;
  data.percentile = snap.percentile;
  data.woba = snap.woba;
  data.estimatedPower = snap.estimatedPower;
  data.estimatedEye = snap.estimatedEye;
  data.estimatedAvoidK = snap.estimatedAvoidK;
  data.estimatedContact = snap.estimatedContact;
  data.estimatedGap = snap.estimatedGap;
  data.estimatedSpeed = snap.estimatedSpeed;
  data.projBbPct = snap.projBbPct;
  data.projKPct = snap.projKPct;
  data.projHrPct = snap.projHrPct;
  data.projAvg = snap.projAvg;
  data.projWoba = snap.projWoba;
  data.projDoublesRate = snap.projDoublesRate;
  data.projTriplesRate = snap.projTriplesRate;
  // Clear derived fields so projection recomputes from new blended rates
  data.projObp = undefined;
  data.projSlg = undefined;
  data.projWar = undefined;
  data.projPa = undefined;
}

export function snapshotPitcherTr(data: PitcherProfileData): PitcherTrSourceData {
  return {
    trueRating: data.trueRating,
    percentile: data.percentile,
    fipLike: data.fipLike,
    estimatedStuff: data.estimatedStuff,
    estimatedControl: data.estimatedControl,
    estimatedHra: data.estimatedHra,
    projK9: data.projK9,
    projBb9: data.projBb9,
    projHr9: data.projHr9,
  };
}

export function applyPitcherTrSnapshot(data: PitcherProfileData, snap: PitcherTrSourceData): void {
  // Apply canonical TR fields — both estimated ratings and blended rates.
  // Projections use blended rates directly (per pipeline-map.html design rules).
  data.trueRating = snap.trueRating;
  data.percentile = snap.percentile;
  data.fipLike = snap.fipLike;
  data.estimatedStuff = snap.estimatedStuff;
  data.estimatedControl = snap.estimatedControl;
  data.estimatedHra = snap.estimatedHra;
  data.projK9 = snap.projK9;
  data.projBb9 = snap.projBb9;
  data.projHr9 = snap.projHr9;
  // Clear derived fields so projection recomputes from new blended rates
  data.projFip = undefined;
  data.projWar = undefined;
  data.projIp = undefined;
}

/** Build a BatterTrSourceData from a pre-computed HitterTrueRatingResult */
export function batterTrFromPrecomputed(tr: HitterTrueRatingResult): BatterTrSourceData {
  return {
    trueRating: tr.trueRating,
    percentile: tr.percentile,
    woba: tr.woba,
    estimatedPower: tr.estimatedPower,
    estimatedEye: tr.estimatedEye,
    estimatedAvoidK: tr.estimatedAvoidK,
    estimatedContact: tr.estimatedContact,
    estimatedGap: tr.estimatedGap,
    estimatedSpeed: tr.estimatedSpeed,
    projBbPct: tr.blendedBbPct,
    projKPct: tr.blendedKPct,
    projHrPct: tr.blendedHrPct,
    projAvg: tr.blendedAvg,
    projWoba: tr.woba,
    projDoublesRate: tr.blendedDoublesRate,
    projTriplesRate: tr.blendedTriplesRate,
  };
}

/** Build a PitcherTrSourceData from a pre-computed TrueRatingResult */
export function pitcherTrFromPrecomputed(tr: TrueRatingResult): PitcherTrSourceData {
  return {
    trueRating: tr.trueRating,
    percentile: tr.percentile,
    fipLike: tr.fipLike,
    estimatedStuff: tr.estimatedStuff,
    estimatedControl: tr.estimatedControl,
    estimatedHra: tr.estimatedHra,
    projK9: tr.blendedK9,
    projBb9: tr.blendedBb9,
    projHr9: tr.blendedHr9,
  };
}

// ============================================================================
// A. resolveCanonicalBatterData
// ============================================================================

/**
 * Applies canonical TR and TFR overrides to batter profile data.
 * Extracted from BatterProfileModal.show() steps 3-5.
 *
 * Mutates `data` in place (matches original inline pattern).
 */
export function resolveCanonicalBatterData(
  data: BatterProfileData,
  playerTR: HitterTrueRatingResult | undefined,
  tfrEntry: RatedHitterProspect | undefined,
): void {
  // Step 3: Override TR fields from canonical source
  if (playerTR) {
    data.trueRating = playerTR.trueRating;
    data.percentile = playerTR.percentile;
    data.woba = playerTR.woba;
    data.estimatedPower = playerTR.estimatedPower;
    data.estimatedEye = playerTR.estimatedEye;
    data.estimatedAvoidK = playerTR.estimatedAvoidK;
    data.estimatedContact = playerTR.estimatedContact;
    data.estimatedGap = playerTR.estimatedGap;
    data.estimatedSpeed = playerTR.estimatedSpeed;
    data.projBbPct = playerTR.blendedBbPct;
    data.projKPct = playerTR.blendedKPct;
    data.projHrPct = playerTR.blendedHrPct;
    data.projAvg = playerTR.blendedAvg;
    data.projWoba = playerTR.woba;
    data.projDoublesRate = playerTR.blendedDoublesRate;
    data.projTriplesRate = playerTR.blendedTriplesRate;
    data.isProspect = false;
  }

  // Step 4: Override TFR fields + prospect branching
  if (tfrEntry) {
    data.trueFutureRating = tfrEntry.trueFutureRating;
    data.tfrPercentile = tfrEntry.percentile;
    data.tfrPower = tfrEntry.trueRatings.power;
    data.tfrEye = tfrEntry.trueRatings.eye;
    data.tfrAvoidK = tfrEntry.trueRatings.avoidK;
    data.tfrContact = tfrEntry.trueRatings.contact;
    data.tfrGap = tfrEntry.trueRatings.gap;
    data.tfrSpeed = tfrEntry.trueRatings.speed;
    data.tfrBbPct = tfrEntry.projBbPct;
    data.tfrKPct = tfrEntry.projKPct;
    data.tfrHrPct = tfrEntry.projHrPct;
    data.tfrAvg = tfrEntry.projAvg;
    data.tfrObp = tfrEntry.projObp;
    data.tfrSlg = tfrEntry.projSlg;
    data.tfrPa = tfrEntry.projPa;
    data.tfrBySource = tfrEntry.tfrBySource;
    data.level = tfrEntry.level;
    data.totalMinorPa = tfrEntry.totalMinorPa;

    if (playerTR) {
      // MLB player with upside — keep TR, compute hasTfrUpside
      const currentRatings = [
        data.estimatedPower,
        data.estimatedEye,
        data.estimatedAvoidK,
        data.estimatedContact,
        data.estimatedGap,
        data.estimatedSpeed,
      ];
      const tfrRatings = [
        tfrEntry.trueRatings.power, tfrEntry.trueRatings.eye,
        tfrEntry.trueRatings.avoidK, tfrEntry.trueRatings.contact,
        tfrEntry.trueRatings.gap, tfrEntry.trueRatings.speed,
      ];
      data.hasTfrUpside = tfrEntry.trueFutureRating > playerTR.trueRating
        || hasComponentUpside(currentRatings as number[], tfrRatings);
    } else {
      // Prospect: no MLB stats
      data.hasTfrUpside = true;
      data.isProspect = true;
      const devTR = tfrEntry.developmentTR;
      data.estimatedPower = devTR?.power ?? tfrEntry.trueRatings.power;
      data.estimatedEye = devTR?.eye ?? tfrEntry.trueRatings.eye;
      data.estimatedAvoidK = devTR?.avoidK ?? tfrEntry.trueRatings.avoidK;
      data.estimatedContact = devTR?.contact ?? tfrEntry.trueRatings.contact;
      data.estimatedGap = devTR?.gap ?? tfrEntry.trueRatings.gap;
      data.estimatedSpeed = devTR?.speed ?? tfrEntry.trueRatings.speed;
      // Peak projection stats
      data.projWoba = tfrEntry.projWoba;
      data.projAvg = tfrEntry.projAvg;
      data.projBbPct = tfrEntry.projBbPct;
      data.projKPct = tfrEntry.projKPct;
      data.projHrPct = tfrEntry.projHrPct;
    }
  }

  // Note: projWar/projPa/projObp/projSlg are NOT cleared here. When the caller
  // (e.g. ProjectionsView) passes pre-computed values from computeBatterProjection
  // using the same canonical TR, clearing and recomputing just introduces rounding
  // drift. When callers don't provide these fields, computeBatterProjection computes
  // them fresh from the blended rates set above.
}

// ============================================================================
// B. resolveCanonicalPitcherData
// ============================================================================

/**
 * Applies canonical TR and TFR overrides to pitcher profile data.
 * Extracted from PitcherProfileModal.show() steps 3-5.
 *
 * Mutates `data` in place (matches original inline pattern).
 */
export function resolveCanonicalPitcherData(
  data: PitcherProfileData,
  playerTR: TrueRatingResult | undefined,
  tfrEntry: RatedProspect | undefined,
): void {
  // Step 3: Override TR fields from canonical source
  if (playerTR) {
    data.trueRating = playerTR.trueRating;
    data.percentile = playerTR.percentile;
    data.fipLike = playerTR.fipLike;
    data.estimatedStuff = playerTR.estimatedStuff;
    data.estimatedControl = playerTR.estimatedControl;
    data.estimatedHra = playerTR.estimatedHra;
    data.projK9 = playerTR.blendedK9;
    data.projBb9 = playerTR.blendedBb9;
    data.projHr9 = playerTR.blendedHr9;
    data.isProspect = false;
  }

  // Step 4: Override TFR fields + prospect branching
  if (tfrEntry) {
    data.trueFutureRating = tfrEntry.trueFutureRating;
    data.tfrPercentile = tfrEntry.percentile;
    data.tfrStuff = tfrEntry.trueRatings?.stuff;
    data.tfrControl = tfrEntry.trueRatings?.control;
    data.tfrHra = tfrEntry.trueRatings?.hra;
    data.tfrBySource = tfrEntry.tfrBySource;
    data.level = tfrEntry.level;
    data.totalMinorIp = tfrEntry.totalMinorIp;

    if (playerTR) {
      // MLB pitcher with upside — keep TR, compute hasTfrUpside
      const currentRatings = [
        data.estimatedStuff,
        data.estimatedControl,
        data.estimatedHra,
      ];
      const tfrRatings = [
        tfrEntry.trueRatings?.stuff,
        tfrEntry.trueRatings?.control,
        tfrEntry.trueRatings?.hra,
      ];
      data.hasTfrUpside = tfrEntry.trueFutureRating > playerTR.trueRating
        || hasComponentUpside(currentRatings as number[], tfrRatings as number[]);
    } else {
      // Prospect: no MLB stats
      data.hasTfrUpside = true;
      data.isProspect = true;
      const devTR = tfrEntry.developmentTR;
      data.estimatedStuff = devTR?.stuff ?? tfrEntry.trueRatings?.stuff;
      data.estimatedControl = devTR?.control ?? tfrEntry.trueRatings?.control;
      data.estimatedHra = devTR?.hra ?? tfrEntry.trueRatings?.hra;
      // Peak projection stats
      data.projK9 = tfrEntry.projK9;
      data.projBb9 = tfrEntry.projBb9;
      data.projHr9 = tfrEntry.projHr9;
      // Clear inflated MLB stats TR
      data.trueRating = undefined;
      data.percentile = undefined;
      data.fipLike = undefined;
    }
  }

  // Step 5: Force recompute of derived projections
  if (playerTR || tfrEntry) {
    data.projFip = undefined;
    data.projWar = undefined;
    if (!(data.isProspect)) {
      data.projIp = undefined;
    }
  }
}

// ============================================================================
// C. computeBatterProjection
// ============================================================================

export interface BatterProjectionResult {
  projAvg: number;
  projObp: number;
  projSlg: number;
  projBbPct: number;
  projKPct: number;
  projHrPct: number;
  projPa: number;
  projHr: number;
  proj2b: number;
  proj3b: number;
  projSb: number;
  projCs: number;
  projWoba: number;
  projWar: number;
  projSbRuns: number;
  projDefRuns: number;
  projPosAdj: number;
  projOps: number;
  projOpsPlus: number;
  age: number;
  ratingLabel: string;
  projNote: string;
  isPeakMode: boolean;
  showActualComparison: boolean;
  ratings: {
    power: number;
    eye: number;
    avoidK: number;
    contact: number;
    gap: number;
    speed: number;
  };
}

/** Dependencies injected to keep this function pure and testable */
export interface BatterProjectionDeps {
  projectionMode: 'current' | 'peak';
  projectionYear: number;
  leagueAvg: { lgObp: number; lgSlg: number; lgWoba: number; lgRpa: number; wobaScale: number; runsPerWin: number; totalPa: number; totalRuns: number; year: number } | null;
  scoutingData: { injuryProneness?: string; stealingAggressiveness?: number; stealingAbility?: number } | null;
  /** Functions from services — injected for testability */
  expectedBbPct: (eye: number) => number;
  expectedKPct: (avoidK: number) => number;
  expectedAvg: (contact: number) => number;
  expectedHrPct: (power: number) => number;
  expectedDoublesRate: (gap: number) => number;
  expectedTriplesRate: (speed: number) => number;
  getProjectedPa: (injury: string | undefined, age: number) => number;
  getProjectedPaWithHistory: (history: { year: number; pa: number }[], age: number, injury: string | undefined) => number;
  calculateOpsPlus: (obp: number, slg: number, leagueAvg: any) => number;
  computeWoba: (bbPct: number, avg: number, doublesPerAb: number, triplesPerAb: number, hrPerAb: number) => number;
  calculateBaserunningRuns: (sb: number, cs: number) => number;
  calculateBattingWar: (woba: number, pa: number, leagueAvg: any, sbRuns: number, defRuns?: number, posAdj?: number) => number;
  projectStolenBases: (sr: number, ste: number, pa: number) => { sb: number; cs: number };
  historicalSbStats?: Array<{ sb: number; cs: number; pa: number }>;
  /** Defensive runs (fielding value). Optional — 0 if not provided. */
  defRuns?: number;
  /** Positional adjustment runs. Optional — 0 if not provided. */
  posAdj?: number;
  /** Optional aging function. Adjusts blended rates for age-based decline/development (current mode only). */
  applyAgingToRates?: (
    rates: { bbPct: number; kPct: number; avg: number; hrPct: number; doublesRate: number; triplesRate: number },
    age: number,
  ) => { bbPct: number; kPct: number; avg: number; hrPct: number; doublesRate: number; triplesRate: number };
  /** Park factors (half home / half away effective factors). All default to 1.0. */
  parkFactors?: { avg: number; hr: number; d: number; t: number };
}

interface BatterSeasonStatsForProjection {
  year: number;
  level: string;
  pa: number;
  avg: number;
  obp: number;
  slg: number;
  hr: number;
  d?: number;
  t?: number;
  rbi: number;
  sb: number;
  cs: number;
  bb: number;
  k: number;
  war?: number;
}

/**
 * Compute batter projection from profile data and mode.
 * Extracted from BatterProfileModal.renderProjectionContent().
 *
 * Returns structured data (NOT HTML). The modal formats the result.
 */
export function computeBatterProjection(
  data: BatterProfileData,
  stats: BatterSeasonStatsForProjection[],
  deps: BatterProjectionDeps,
): BatterProjectionResult {
  const showToggle = data.hasTfrUpside === true && data.trueRating !== undefined;
  // Prospects with a current/peak toggle (hasTfrUpside + trueRating set by cache lookup) use the toggle.
  // Pure prospects (no trueRating) always use peak mode.
  const isPeakMode = (deps.projectionMode === 'peak' && showToggle) || (data.isProspect === true && !showToggle);

  // Select ratings source
  const usePower = isPeakMode ? (data.tfrPower ?? data.estimatedPower) : data.estimatedPower;
  const useEye = isPeakMode ? (data.tfrEye ?? data.estimatedEye) : data.estimatedEye;
  const useAvoidK = isPeakMode ? (data.tfrAvoidK ?? data.estimatedAvoidK) : data.estimatedAvoidK;
  const useContact = isPeakMode ? (data.tfrContact ?? data.estimatedContact) : data.estimatedContact;
  const useGap = isPeakMode ? (data.tfrGap ?? data.estimatedGap) : data.estimatedGap;
  const useSpeed = isPeakMode ? (data.tfrSpeed ?? data.estimatedSpeed) : data.estimatedSpeed;

  const showActualComparison = !isPeakMode;
  const age = isPeakMode ? 27 : (data.age ?? 27);
  const lgObp = deps.leagueAvg?.lgObp ?? 0.320;
  const lgSlg = deps.leagueAvg?.lgSlg ?? 0.400;

  // Calculate projected stats from ratings
  let projAvg: number;
  let projObp: number;
  let projSlg: number;
  let projBbPct: number;
  let projKPct: number;
  // Track blended rates for aging (these stay on the correct scale)
  let blendedHrPct: number | undefined;
  let blendedDoublesRate: number | undefined;
  let blendedTriplesRate: number | undefined;

  if (isPeakMode && data.tfrAvg !== undefined && data.tfrObp !== undefined && data.tfrSlg !== undefined) {
    projAvg = data.tfrAvg;
    projObp = data.tfrObp;
    projSlg = data.tfrSlg;
    projBbPct = data.tfrBbPct ?? 8.5;
    projKPct = data.tfrKPct ?? 22.0;
    blendedHrPct = data.tfrHrPct;
    blendedDoublesRate = data.projDoublesRate;
    blendedTriplesRate = data.projTriplesRate;
  } else if (!isPeakMode && data.projAvg !== undefined && data.projObp !== undefined && data.projSlg !== undefined) {
    projAvg = data.projAvg;
    projObp = data.projObp;
    projSlg = data.projSlg;
    projBbPct = data.projBbPct ?? 8.5;
    projKPct = data.projKPct ?? 22.0;
    blendedHrPct = data.projHrPct;
    blendedDoublesRate = data.projDoublesRate;
    blendedTriplesRate = data.projTriplesRate;
  } else if (usePower !== undefined && useEye !== undefined &&
             useAvoidK !== undefined && useContact !== undefined) {
    projBbPct = isPeakMode
      ? (data.tfrBbPct ?? data.projBbPct ?? deps.expectedBbPct(useEye))
      : (data.projBbPct ?? deps.expectedBbPct(useEye));
    projKPct = isPeakMode
      ? (data.tfrKPct ?? data.projKPct ?? deps.expectedKPct(useAvoidK))
      : (data.projKPct ?? deps.expectedKPct(useAvoidK));
    projAvg = isPeakMode
      ? (data.tfrAvg ?? data.projAvg ?? deps.expectedAvg(useContact))
      : (data.projAvg ?? deps.expectedAvg(useContact));
    projObp = isPeakMode
      ? (data.tfrObp ?? Math.min(0.450, projAvg + (projBbPct / 100) * (1 - projAvg)))
      : (data.projObp ?? Math.min(0.450, projAvg + (projBbPct / 100) * (1 - projAvg)));

    // Compute SLG from blended rates when available (avoids percentile→regression scale mismatch).
    // Fall back to rating-derived ISO only when blended rates aren't set.
    blendedHrPct = isPeakMode ? (data.tfrHrPct ?? data.projHrPct) : data.projHrPct;
    blendedDoublesRate = data.projDoublesRate;
    blendedTriplesRate = data.projTriplesRate;

    if (!isPeakMode && blendedHrPct !== undefined && blendedDoublesRate !== undefined && blendedTriplesRate !== undefined) {
      const hrPerAb = (blendedHrPct / 100) / 0.88;
      const iso = blendedDoublesRate + 2 * blendedTriplesRate + 3 * hrPerAb;
      projSlg = projAvg + iso;
    } else {
      // Fallback: rating-derived ISO (for prospects or when blended rates unavailable)
      const hrPerAb = (deps.expectedHrPct(usePower) / 100) / 0.88;
      const doublesPerAb = useGap !== undefined ? deps.expectedDoublesRate(useGap) : 0.04;
      const triplesPerAb = useSpeed !== undefined ? deps.expectedTriplesRate(useSpeed) : 0.005;
      const iso = doublesPerAb + 2 * triplesPerAb + 3 * hrPerAb;
      projSlg = isPeakMode
        ? (data.tfrSlg ?? projAvg + iso)
        : (projAvg + iso);
    }
  } else {
    projAvg = 0.260;
    projObp = 0.330;
    projSlg = 0.420;
    projBbPct = 8.5;
    projKPct = 22.0;
  }

  // Apply aging curve to projected rates (current mode only).
  // Converts blended rates to regression-scale ratings, applies age modifiers, converts back.
  if (!isPeakMode && deps.applyAgingToRates && blendedHrPct !== undefined
      && blendedDoublesRate !== undefined && blendedTriplesRate !== undefined) {
    const aged = deps.applyAgingToRates(
      { bbPct: projBbPct, kPct: projKPct, avg: projAvg, hrPct: blendedHrPct, doublesRate: blendedDoublesRate, triplesRate: blendedTriplesRate },
      age,
    );
    projBbPct = aged.bbPct;
    projKPct = aged.kPct;
    projAvg = aged.avg;
    blendedHrPct = aged.hrPct;
    blendedDoublesRate = aged.doublesRate;
    blendedTriplesRate = aged.triplesRate;
    projObp = Math.min(0.450, aged.avg + (aged.bbPct / 100) * (1 - aged.avg));
    const hrPerAb = (aged.hrPct / 100) / 0.88;
    const iso = aged.doublesRate + 2 * aged.triplesRate + 3 * hrPerAb;
    projSlg = aged.avg + iso;
  }

  // Apply park factors (half home / half away already baked into the effective factors)
  if (deps.parkFactors) {
    const pf = deps.parkFactors;
    projAvg *= pf.avg;
    projObp = Math.min(0.450, projAvg + (projBbPct / 100) * (1 - projAvg)); // recalc OBP from park-adjusted AVG
    if (blendedHrPct !== undefined) blendedHrPct *= pf.hr;
    if (blendedDoublesRate !== undefined) blendedDoublesRate *= pf.d;
    if (blendedTriplesRate !== undefined) blendedTriplesRate *= pf.t;
    // Recompute SLG from park-adjusted component rates
    if (blendedHrPct !== undefined && blendedDoublesRate !== undefined && blendedTriplesRate !== undefined) {
      const hrPerAb = (blendedHrPct / 100) / 0.88;
      const iso = blendedDoublesRate + 2 * blendedTriplesRate + 3 * hrPerAb;
      projSlg = projAvg + iso;
    }
  }

  // Projected PA
  const injuryProneness = deps.scoutingData?.injuryProneness ?? data.injuryProneness;
  let projPa: number;
  if (isPeakMode) {
    projPa = data.tfrPa ?? deps.getProjectedPa(injuryProneness, 27);
  } else if (data.projPa !== undefined) {
    projPa = data.projPa;
  } else {
    const mlbHistory = (stats ?? [])
      .filter(s2 => s2.level === 'MLB' && s2.year < deps.projectionYear)
      .map(s2 => ({ year: s2.year, pa: s2.pa }));
    projPa = mlbHistory.length > 0
      ? deps.getProjectedPaWithHistory(mlbHistory, age, injuryProneness)
      : deps.getProjectedPa(injuryProneness, age);
  }

  // Projected HR — use aged blendedHrPct when available (updated by aging above)
  let projHr: number;
  if (isPeakMode && data.tfrHrPct !== undefined) {
    projHr = Math.round(projPa * (data.tfrHrPct / 100));
  } else if (!isPeakMode && blendedHrPct !== undefined) {
    projHr = Math.round(projPa * (blendedHrPct / 100));
  } else if (!isPeakMode && data.projHr !== undefined) {
    projHr = data.projHr;
  } else if (usePower !== undefined) {
    const derivedHrPct = deps.expectedHrPct(usePower);
    projHr = Math.round(projPa * (derivedHrPct / 100));
  } else {
    projHr = Math.round((projSlg - projAvg) * 100);
  }

  // Projected 2B and 3B — use aged blended rates when available
  const abPerPa = 0.88;
  const projAb = Math.round(projPa * abPerPa);
  let proj2b: number;
  let proj3b: number;
  if (!isPeakMode && blendedDoublesRate !== undefined) {
    proj2b = Math.round(projAb * blendedDoublesRate);
  } else if (useGap !== undefined) {
    proj2b = Math.round(projAb * deps.expectedDoublesRate(useGap));
  } else {
    proj2b = Math.round(projAb * 0.04);
  }
  if (!isPeakMode && blendedTriplesRate !== undefined) {
    proj3b = Math.round(projAb * blendedTriplesRate);
  } else if (useSpeed !== undefined) {
    proj3b = Math.round(projAb * deps.expectedTriplesRate(useSpeed));
  } else {
    proj3b = Math.round(projAb * 0.005);
  }

  // Projected SB — compute once, reuse for display and WAR
  const sr = deps.scoutingData?.stealingAggressiveness ?? data.scoutSR ?? 50;
  const ste = deps.scoutingData?.stealingAbility ?? data.scoutSTE ?? 50;
  const hasSrSte = (deps.scoutingData?.stealingAggressiveness !== undefined) || (data.scoutSR !== undefined);
  let projSb: number;
  let projCs: number;
  if (data.projSb !== undefined) {
    projSb = data.projSb;
    projCs = data.projCs ?? Math.round(projSb * 0.25);
  } else if (hasSrSte) {
    if (deps.historicalSbStats && deps.historicalSbStats.length > 0) {
      const sbResult = HitterRatingEstimatorService.projectStolenBasesWithHistory(sr, ste, projPa, deps.historicalSbStats);
      projSb = sbResult.sb;
      projCs = sbResult.cs;
    } else {
      const sbResult = deps.projectStolenBases(sr, ste, projPa);
      projSb = sbResult.sb;
      projCs = sbResult.cs;
    }
  } else {
    projSb = 0;
    projCs = 0;
  }

  // OPS and OPS+
  const projOps = projObp + projSlg;
  const projOpsPlus = deps.leagueAvg
    ? deps.calculateOpsPlus(projObp, projSlg, deps.leagueAvg)
    : Math.round(100 * ((projObp / lgObp) + (projSlg / lgSlg) - 1));

  // WAR from wOBA
  const projHrPerAb = projPa > 0 ? projHr / (projPa * abPerPa) : 0;
  const projDoublesPerAb = projAb > 0 ? proj2b / projAb : 0.04;
  const projTriplesPerAb = projAb > 0 ? proj3b / projAb : 0.005;
  const peakWobaFromRates = deps.computeWoba(projBbPct / 100, projAvg, projDoublesPerAb, projTriplesPerAb, projHrPerAb);
  const projWoba = isPeakMode ? peakWobaFromRates : (data.projWoba ?? peakWobaFromRates);

  // SB runs for WAR — reuse the single SB/CS computation above
  const projSbRuns = (projSb > 0 || projCs > 0)
    ? deps.calculateBaserunningRuns(projSb, projCs)
    : 0;

  // Defensive value (injected from DefensiveProjectionService, default 0)
  const projDefRuns = deps.defRuns ?? 0;
  const projPosAdj = deps.posAdj ?? 0;

  let calculatedWar: number;
  if (deps.leagueAvg) {
    calculatedWar = deps.calculateBattingWar(projWoba, projPa, deps.leagueAvg, projSbRuns, projDefRuns, projPosAdj);
  } else {
    const fallbackAvg = { year: 0, lgObp: 0.320, lgSlg: 0.400, lgWoba: 0.320, lgRpa: 0.115, wobaScale: 1.15, runsPerWin: 10, totalPa: 0, totalRuns: 0 };
    calculatedWar = deps.calculateBattingWar(projWoba, projPa, fallbackAvg, projSbRuns, projDefRuns, projPosAdj);
  }
  const projWar = data.projWar ?? calculatedWar;

  const projHrPct = projPa > 0 ? (projHr / projPa) * 100 : 0;

  const ratingLabel = isPeakMode ? 'TFR' : 'Estimated';
  const projNote = isPeakMode
    ? '* Peak projection based on True Future Rating. Assumes full development and everything going right for this guy.'
    : '* Projection based on True Ratings.';

  return {
    projAvg, projObp, projSlg, projBbPct, projKPct, projHrPct,
    projPa, projHr, proj2b, proj3b, projSb, projCs,
    projWoba, projWar, projSbRuns, projDefRuns: projDefRuns, projPosAdj: projPosAdj, projOps, projOpsPlus,
    age, ratingLabel, projNote,
    isPeakMode, showActualComparison,
    ratings: {
      power: usePower ?? 50,
      eye: useEye ?? 50,
      avoidK: useAvoidK ?? 50,
      contact: useContact ?? 50,
      gap: useGap ?? 50,
      speed: useSpeed ?? 50,
    },
  };
}

// ============================================================================
// D. computePitcherProjection
// ============================================================================

export interface PitcherProjectionResult {
  projK9: number;
  projBb9: number;
  projHr9: number;
  projFip: number;
  projIp: number;
  projWar: number;
  projK: number;
  projBb: number;
  projHr: number;
  age: number;
  ratingLabel: string;
  projNote: string;
  isPeakMode: boolean;
  showActualComparison: boolean;
  ratings: {
    stuff: number;
    control: number;
    hra: number;
  };
}

export interface PitcherProjectionDeps {
  projectionMode: 'current' | 'peak';
  scoutingData: { stamina?: number; injuryProneness?: string } | null;
  projectedIp: number | undefined | null;
  estimateIp: (stamina: number, injury?: string) => number;
  calculateWar: (fip: number, ip: number) => number;
  /** Park HR factor for pitchers (effective half home / half away). Default 1.0. */
  parkHrFactor?: number;
}

interface PitcherSeasonStatsForProjection {
  year: number;
  level: string;
  ip: number;
  k9: number;
  bb9: number;
  hr9: number;
  fip?: number;
  war?: number;
}

/**
 * Compute pitcher projection from profile data and mode.
 * Extracted from PitcherProfileModal.renderProjectionContent().
 */
export function computePitcherProjection(
  data: PitcherProfileData,
  _stats: PitcherSeasonStatsForProjection[],
  deps: PitcherProjectionDeps,
): PitcherProjectionResult {
  const showToggle = data.hasTfrUpside === true && data.trueRating !== undefined;
  // Prospects with a current/peak toggle (hasTfrUpside + trueRating set by cache lookup) use the toggle.
  // Pure prospects (no trueRating) always use peak mode.
  const isPeakMode = (deps.projectionMode === 'peak' && showToggle) || (data.isProspect === true && !showToggle);

  // Select ratings source
  const useStuff = isPeakMode ? (data.tfrStuff ?? data.estimatedStuff) : data.estimatedStuff;
  const useControl = isPeakMode ? (data.tfrControl ?? data.estimatedControl) : data.estimatedControl;
  const useHra = isPeakMode ? (data.tfrHra ?? data.estimatedHra) : data.estimatedHra;

  const age = isPeakMode ? 27 : (data.age ?? 27);

  // Calculate projected rate stats
  // For MLB peak toggle, recalculate from TFR ratings — pre-computed values are current-TR-based
  const isTogglePeak = isPeakMode && !data.isProspect;
  let projK9: number | undefined = isTogglePeak ? undefined : data.projK9;
  let projBb9: number | undefined = isTogglePeak ? undefined : data.projBb9;
  let projHr9: number | undefined = isTogglePeak ? undefined : data.projHr9;

  if (projK9 === undefined && useStuff !== undefined) {
    projK9 = (useStuff + 28) / 13.5;
  }
  if (projBb9 === undefined && useControl !== undefined) {
    projBb9 = (100.4 - useControl) / 19.2;
  }
  if (projHr9 === undefined && useHra !== undefined) {
    projHr9 = (86.7 - useHra) / 41.7;
  }

  projK9 = projK9 ?? 7.5;
  projBb9 = projBb9 ?? 3.5;
  projHr9 = projHr9 ?? 1.2;

  // Apply park factor to HR rate (pitchers give up more/fewer HR in hitter/pitcher parks)
  if (deps.parkHrFactor && deps.parkHrFactor !== 1.0) {
    projHr9 *= deps.parkHrFactor;
  }

  const projFip = isTogglePeak
    ? (((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47)
    : (data.projFip ?? (((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47));

  // IP — peak mode uses precomputed TFR value when available, falls back to estimate
  const s = deps.scoutingData;
  const stamina = s?.stamina ?? data.scoutStamina;
  const injury = s?.injuryProneness ?? data.injuryProneness;
  const projIp = isTogglePeak
    ? ((data as any).peakIp ?? deps.estimateIp(stamina ?? 50, injury))
    : (data.projIp ?? deps.projectedIp ?? deps.estimateIp(stamina ?? 50, injury));

  // WAR — peak mode uses precomputed TFR value when available
  const projWar = isPeakMode
    ? ((data as any).peakWar ?? deps.calculateWar(projFip, projIp))
    : (data.projWar ?? deps.calculateWar(projFip, projIp));

  // Counting stats
  const projK = Math.round(projK9 * projIp / 9);
  const projBb = Math.round(projBb9 * projIp / 9);
  const projHr = Math.round(projHr9 * projIp / 9);

  const ratingLabel = isPeakMode ? 'TFR' : 'Estimated';
  const projNote = isPeakMode
    ? '* Peak projection based on True Future Rating. Assumes full development and peak stamina.'
    : '* Projection based on True Ratings.';

  return {
    projK9, projBb9, projHr9, projFip, projIp, projWar,
    projK, projBb, projHr,
    age, ratingLabel, projNote,
    isPeakMode,
    showActualComparison: !isPeakMode,
    ratings: {
      stuff: useStuff ?? 50,
      control: useControl ?? 50,
      hra: useHra ?? 50,
    },
  };
}
