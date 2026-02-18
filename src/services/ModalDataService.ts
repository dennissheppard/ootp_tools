/**
 * ModalDataService — Pure functions for modal data assembly and projection calculation.
 *
 * Extracts the branching logic from BatterProfileModal.show() and
 * PitcherProfileModal.show(), and the calculation logic from their
 * renderProjectionContent() methods, into testable pure functions.
 */

import { BatterProfileData } from '../views/BatterProfileModal';
import { PitcherProfileData } from '../views/PitcherProfileModal';
import { HitterTrueRatingResult } from './HitterTrueRatingsCalculationService';
import { TrueRatingResult } from './TrueRatingsCalculationService';
import { RatedHitterProspect, RatedProspect } from './TeamRatingsService';
import { hasComponentUpside } from '../utils/tfrUpside';

// ============================================================================
// A. resolveCanonicalBatterData
// ============================================================================

/**
 * Applies canonical TR and TFR overrides to batter profile data.
 * Extracted from BatterProfileModal.show() steps 3-5.
 *
 * Returns a patch object to be merged onto the data.
 */
export function resolveCanonicalBatterData(
  data: BatterProfileData,
  playerTR: HitterTrueRatingResult | undefined,
  tfrEntry: RatedHitterProspect | undefined,
): Partial<BatterProfileData> {
  const patch: Partial<BatterProfileData> = {};

  // Step 3: Override TR fields from canonical source
  if (playerTR) {
    patch.trueRating = playerTR.trueRating;
    patch.percentile = playerTR.percentile;
    patch.woba = playerTR.woba;
    patch.estimatedPower = playerTR.estimatedPower;
    patch.estimatedEye = playerTR.estimatedEye;
    patch.estimatedAvoidK = playerTR.estimatedAvoidK;
    patch.estimatedContact = playerTR.estimatedContact;
    patch.estimatedGap = playerTR.estimatedGap;
    patch.estimatedSpeed = playerTR.estimatedSpeed;
    patch.projBbPct = playerTR.blendedBbPct;
    patch.projKPct = playerTR.blendedKPct;
    patch.projHrPct = playerTR.blendedHrPct;
    patch.projAvg = playerTR.blendedAvg;
    patch.projWoba = playerTR.woba;
    patch.projDoublesRate = playerTR.blendedDoublesRate;
    patch.projTriplesRate = playerTR.blendedTriplesRate;
    patch.isProspect = false;
  }

  // Step 4: Override TFR fields + farm-eligible branching
  if (tfrEntry) {
    patch.trueFutureRating = tfrEntry.trueFutureRating;
    patch.tfrPercentile = tfrEntry.percentile;
    patch.tfrPower = tfrEntry.trueRatings.power;
    patch.tfrEye = tfrEntry.trueRatings.eye;
    patch.tfrAvoidK = tfrEntry.trueRatings.avoidK;
    patch.tfrContact = tfrEntry.trueRatings.contact;
    patch.tfrGap = tfrEntry.trueRatings.gap;
    patch.tfrSpeed = tfrEntry.trueRatings.speed;
    patch.tfrBbPct = tfrEntry.projBbPct;
    patch.tfrKPct = tfrEntry.projKPct;
    patch.tfrHrPct = tfrEntry.projHrPct;
    patch.tfrAvg = tfrEntry.projAvg;
    patch.tfrObp = tfrEntry.projObp;
    patch.tfrSlg = tfrEntry.projSlg;
    patch.tfrPa = tfrEntry.projPa;
    patch.tfrBySource = tfrEntry.tfrBySource;

    if (playerTR && !tfrEntry.isFarmEligible) {
      // Young MLB regular with upside
      const currentRatings = [
        patch.estimatedPower ?? data.estimatedPower,
        patch.estimatedEye ?? data.estimatedEye,
        patch.estimatedAvoidK ?? data.estimatedAvoidK,
        patch.estimatedContact ?? data.estimatedContact,
        patch.estimatedGap ?? data.estimatedGap,
        patch.estimatedSpeed ?? data.estimatedSpeed,
      ];
      const tfrRatings = [
        tfrEntry.trueRatings.power, tfrEntry.trueRatings.eye,
        tfrEntry.trueRatings.avoidK, tfrEntry.trueRatings.contact,
        tfrEntry.trueRatings.gap, tfrEntry.trueRatings.speed,
      ];
      patch.hasTfrUpside = tfrEntry.trueFutureRating > playerTR.trueRating
        || hasComponentUpside(currentRatings as number[], tfrRatings);
    } else {
      // Prospect: farm-eligible or no MLB stats
      patch.hasTfrUpside = true;
      patch.isProspect = true;
      const devTR = tfrEntry.developmentTR;
      patch.estimatedPower = devTR?.power ?? tfrEntry.trueRatings.power;
      patch.estimatedEye = devTR?.eye ?? tfrEntry.trueRatings.eye;
      patch.estimatedAvoidK = devTR?.avoidK ?? tfrEntry.trueRatings.avoidK;
      patch.estimatedContact = devTR?.contact ?? tfrEntry.trueRatings.contact;
      patch.estimatedGap = devTR?.gap ?? tfrEntry.trueRatings.gap;
      patch.estimatedSpeed = devTR?.speed ?? tfrEntry.trueRatings.speed;
      // Peak projection stats
      patch.projWoba = tfrEntry.projWoba;
      patch.projAvg = tfrEntry.projAvg;
      patch.projBbPct = tfrEntry.projBbPct;
      patch.projKPct = tfrEntry.projKPct;
      patch.projHrPct = tfrEntry.projHrPct;
      // Clear inflated MLB stats TR
      patch.trueRating = undefined;
      patch.percentile = undefined;
      patch.woba = undefined;
    }
  }

  // Step 5: Force recompute of WAR/PA
  if (playerTR || tfrEntry) {
    patch.projWar = undefined;
    if (patch.isProspect ?? data.isProspect) {
      patch.projPa = patch.tfrPa ?? data.tfrPa;
    } else {
      patch.projPa = undefined;
    }
  }

  return patch;
}

// ============================================================================
// B. resolveCanonicalPitcherData
// ============================================================================

/**
 * Applies canonical TR and TFR overrides to pitcher profile data.
 * Extracted from PitcherProfileModal.show() steps 3-5.
 */
export function resolveCanonicalPitcherData(
  data: PitcherProfileData,
  playerTR: TrueRatingResult | undefined,
  tfrEntry: RatedProspect | undefined,
): Partial<PitcherProfileData> {
  const patch: Partial<PitcherProfileData> = {};

  // Step 3: Override TR fields from canonical source
  if (playerTR) {
    patch.trueRating = playerTR.trueRating;
    patch.percentile = playerTR.percentile;
    patch.fipLike = playerTR.fipLike;
    patch.estimatedStuff = playerTR.estimatedStuff;
    patch.estimatedControl = playerTR.estimatedControl;
    patch.estimatedHra = playerTR.estimatedHra;
    patch.projK9 = playerTR.blendedK9;
    patch.projBb9 = playerTR.blendedBb9;
    patch.projHr9 = playerTR.blendedHr9;
    patch.isProspect = false;
  }

  // Step 4: Override TFR fields from canonical source
  if (tfrEntry) {
    patch.trueFutureRating = tfrEntry.trueFutureRating;
    patch.tfrPercentile = tfrEntry.percentile;
    patch.tfrStuff = tfrEntry.trueRatings?.stuff;
    patch.tfrControl = tfrEntry.trueRatings?.control;
    patch.tfrHra = tfrEntry.trueRatings?.hra;
    patch.tfrBySource = tfrEntry.tfrBySource;

    // Auto-prospect detection: if tfrEntry exists, player is a prospect
    patch.hasTfrUpside = true;
    patch.isProspect = true;
    const devTR = tfrEntry.developmentTR;
    patch.estimatedStuff = devTR?.stuff ?? tfrEntry.trueRatings?.stuff;
    patch.estimatedControl = devTR?.control ?? tfrEntry.trueRatings?.control;
    patch.estimatedHra = devTR?.hra ?? tfrEntry.trueRatings?.hra;
    // Peak projection stats
    patch.projK9 = tfrEntry.projK9;
    patch.projBb9 = tfrEntry.projBb9;
    patch.projHr9 = tfrEntry.projHr9;
    // Clear inflated MLB stats TR
    patch.trueRating = undefined;
    patch.percentile = undefined;
    patch.fipLike = undefined;
  }

  // Step 5: Force recompute of derived projections
  if (playerTR || tfrEntry) {
    patch.projFip = undefined;
    patch.projWar = undefined;
    if (!(patch.isProspect ?? data.isProspect)) {
      patch.projIp = undefined;
    }
  }

  return patch;
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
  projWoba: number;
  projWar: number;
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
  calculateBattingWar: (woba: number, pa: number, leagueAvg: any, sbRuns: number) => number;
  projectStolenBases: (sr: number, ste: number, pa: number) => { sb: number; cs: number };
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
  const isPeakMode = (deps.projectionMode === 'peak' && showToggle) || (data.isProspect === true);

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

  if (isPeakMode && data.tfrAvg !== undefined && data.tfrObp !== undefined && data.tfrSlg !== undefined) {
    projAvg = data.tfrAvg;
    projObp = data.tfrObp;
    projSlg = data.tfrSlg;
    projBbPct = data.tfrBbPct ?? 8.5;
    projKPct = data.tfrKPct ?? 22.0;
  } else if (!isPeakMode && data.projAvg !== undefined && data.projObp !== undefined && data.projSlg !== undefined) {
    projAvg = data.projAvg;
    projObp = data.projObp;
    projSlg = data.projSlg;
    projBbPct = data.projBbPct ?? 8.5;
    projKPct = data.projKPct ?? 22.0;
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
      ? (data.tfrObp ?? Math.min(0.450, projAvg + (projBbPct / 100)))
      : Math.min(0.450, projAvg + (projBbPct / 100));
    const hrPerAb = (deps.expectedHrPct(usePower) / 100) / 0.88;
    const doublesPerAb = useGap !== undefined ? deps.expectedDoublesRate(useGap) : 0.04;
    const triplesPerAb = useSpeed !== undefined ? deps.expectedTriplesRate(useSpeed) : 0.005;
    const iso = doublesPerAb + 2 * triplesPerAb + 3 * hrPerAb;
    projSlg = isPeakMode
      ? (data.tfrSlg ?? projAvg + iso)
      : (projAvg + iso);
  } else {
    projAvg = 0.260;
    projObp = 0.330;
    projSlg = 0.420;
    projBbPct = 8.5;
    projKPct = 22.0;
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

  // Projected HR
  let projHr: number;
  if (isPeakMode && data.tfrHrPct !== undefined) {
    projHr = Math.round(projPa * (data.tfrHrPct / 100));
  } else if (!isPeakMode && data.projHr !== undefined) {
    projHr = data.projHr;
  } else if (!isPeakMode && data.projHrPct !== undefined) {
    projHr = Math.round(projPa * (data.projHrPct / 100));
  } else if (usePower !== undefined) {
    const derivedHrPct = deps.expectedHrPct(usePower);
    projHr = Math.round(projPa * (derivedHrPct / 100));
  } else {
    projHr = Math.round((projSlg - projAvg) * 100);
  }

  // Projected 2B and 3B
  const abPerPa = 0.88;
  const projAb = Math.round(projPa * abPerPa);
  let proj2b: number;
  let proj3b: number;
  if (!isPeakMode && data.projDoublesRate !== undefined) {
    proj2b = Math.round(projAb * data.projDoublesRate);
  } else if (useGap !== undefined) {
    proj2b = Math.round(projAb * deps.expectedDoublesRate(useGap));
  } else {
    proj2b = Math.round(projAb * 0.04);
  }
  if (!isPeakMode && data.projTriplesRate !== undefined) {
    proj3b = Math.round(projAb * data.projTriplesRate);
  } else if (useSpeed !== undefined) {
    proj3b = Math.round(projAb * deps.expectedTriplesRate(useSpeed));
  } else {
    proj3b = Math.round(projAb * 0.005);
  }

  // Projected SB
  const sr = deps.scoutingData?.stealingAggressiveness ?? data.scoutSR ?? 50;
  const ste = deps.scoutingData?.stealingAbility ?? data.scoutSTE ?? 50;
  const hasSrSte = (deps.scoutingData?.stealingAggressiveness !== undefined) || (data.scoutSR !== undefined);
  let projSb: number;
  if (data.projSb !== undefined) {
    projSb = data.projSb;
  } else if (hasSrSte) {
    projSb = deps.projectStolenBases(sr, ste, projPa).sb;
  } else {
    projSb = 0;
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

  // SB runs for WAR
  let projSbRuns = 0;
  if (hasSrSte) {
    const sbProjForWar = deps.projectStolenBases(sr, ste, projPa);
    projSbRuns = deps.calculateBaserunningRuns(sbProjForWar.sb, sbProjForWar.cs);
  } else if (data.projSb !== undefined) {
    const projCsForWar = data.projCs ?? Math.round(projSb * 0.25);
    projSbRuns = deps.calculateBaserunningRuns(projSb, projCsForWar);
  }

  let calculatedWar: number;
  if (deps.leagueAvg) {
    calculatedWar = deps.calculateBattingWar(projWoba, projPa, deps.leagueAvg, projSbRuns);
  } else {
    const fallbackAvg = { year: 0, lgObp: 0.320, lgSlg: 0.400, lgWoba: 0.320, lgRpa: 0.115, wobaScale: 1.15, runsPerWin: 10, totalPa: 0, totalRuns: 0 };
    calculatedWar = deps.calculateBattingWar(projWoba, projPa, fallbackAvg, projSbRuns);
  }
  const projWar = isPeakMode ? calculatedWar : (data.projWar ?? calculatedWar);

  const projHrPct = projPa > 0 ? (projHr / projPa) * 100 : 0;

  const ratingLabel = isPeakMode ? 'TFR' : 'Estimated';
  const projNote = isPeakMode
    ? '* Peak projection based on True Future Rating. Assumes full development and everything going right for this guy.'
    : '* Projection based on True Ratings.';

  return {
    projAvg, projObp, projSlg, projBbPct, projKPct, projHrPct,
    projPa, projHr, proj2b, proj3b, projSb,
    projWoba, projWar, projOps, projOpsPlus,
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
  const isPeakMode = (deps.projectionMode === 'peak' && showToggle) || (data.isProspect === true);

  // Select ratings source
  const useStuff = isPeakMode ? (data.tfrStuff ?? data.estimatedStuff) : data.estimatedStuff;
  const useControl = isPeakMode ? (data.tfrControl ?? data.estimatedControl) : data.estimatedControl;
  const useHra = isPeakMode ? (data.tfrHra ?? data.estimatedHra) : data.estimatedHra;

  const age = isPeakMode ? 27 : (data.age ?? 27);

  // Calculate projected rate stats
  let projK9: number | undefined = data.projK9;
  let projBb9: number | undefined = data.projBb9;
  let projHr9: number | undefined = data.projHr9;

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

  const projFip = data.projFip ?? (((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47);

  // IP
  const s = deps.scoutingData;
  const stamina = s?.stamina ?? data.scoutStamina;
  const injury = s?.injuryProneness ?? data.injuryProneness;
  const projIp = data.projIp ?? deps.projectedIp ?? deps.estimateIp(stamina ?? 50, injury);

  // WAR
  const projWar = isPeakMode
    ? deps.calculateWar(projFip, projIp)
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
