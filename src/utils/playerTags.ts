/**
 * Player Tags — contextual badges for the profile modal.
 *
 * Pure functions that compute tags from already-resolved profile data.
 * Tags explain WHY a player's numbers look the way they do:
 * overperforming, expensive, blocked, etc.
 */

import type { BatterProfileData } from '../views/BatterProfileModal';
import type { PitcherProfileData } from '../views/PitcherProfileModal';

// ============================================================================
// Types
// ============================================================================

export interface PlayerTag {
  id: string;
  label: string;
  color: 'green' | 'amber' | 'red' | 'blue';
  tooltip: string;
}

/** Cross-player context needed for value and blocking tags */
export interface TagContext {
  currentSalary: number;
  /** Sorted ascending $/WAR for all qualified MLB players (salary >= $3M, WAR > 0.5) */
  leagueDollarPerWar?: number[];
  /** Blocking incumbent info (for prospects) */
  blockingPlayer?: string;
  blockingRating?: number;
  blockingYears?: number;
  /** FIP percentile (0-100, higher = better pitcher). Pitcher-only. */
  fipPercentile?: number;
  /** 1-based rank in the league-wide top 100 prospect list (undefined if not top 100) */
  top100Rank?: number;
}

// ============================================================================
// Public API
// ============================================================================

export function computeBatterTags(data: BatterProfileData, ctx: TagContext): PlayerTag[] {
  const tags: PlayerTag[] = [];

  const devRatio = computeDevRatio(data.scoutOvr, data.scoutPot);

  // Top 100 Prospect
  if (ctx.top100Rank !== undefined) {
    tags.push({
      id: 'top-100', label: `Top 100 (#${ctx.top100Rank})`, color: 'blue',
      tooltip: `Ranked #${ctx.top100Rank} among all league prospects by True Future Rating`,
    });
  }

  // Overperformer: overall TR star rating exceeds TFR
  if (isOverperformer(data.trueRating, data.trueFutureRating)) {
    tags.push({
      id: 'overperformer', label: 'Overperformer', color: 'amber',
      tooltip: 'True ratings exceed future ratings \u2014 playing above expected ability',
    });
  }

  // Underperformer: nearly developed but TR well below TFR
  if (isUnderperformer(devRatio, data.trueRating, data.trueFutureRating)) {
    tags.push({
      id: 'underperformer', label: 'Underperformer', color: 'amber',
      tooltip: 'Has the tools but isn\u2019t putting it together',
    });
  }

  // Expensive / Bargain
  const valueTag = computeValueTag(ctx.currentSalary, data.projWar, ctx.leagueDollarPerWar);
  if (valueTag === 'expensive') {
    tags.push({
      id: 'expensive', label: 'Expensive', color: 'amber',
      tooltip: 'Poor value relative to production',
    });
  } else if (valueTag === 'bargain') {
    tags.push({
      id: 'bargain', label: 'Bargain', color: 'green',
      tooltip: 'Strong value relative to production',
    });
  }

  // Ready for Promotion (batters: 300 PA threshold)
  if (isReadyForPromotion(data.isProspect, devRatio, data.totalMinorPa, 300)) {
    tags.push({
      id: 'ready-for-promotion', label: 'Ready for Promotion', color: 'green',
      tooltip: 'Development indicators suggest MLB readiness',
    });
  }

  // Blocked
  if (isBlocked(data.isProspect, data.trueFutureRating, ctx)) {
    tags.push({
      id: 'blocked', label: 'Blocked', color: 'red',
      tooltip: `Blocked by ${ctx.blockingPlayer ?? 'incumbent'} (${ctx.blockingRating?.toFixed(1)}\u2605, ${ctx.blockingYears}yr)`,
    });
  }

  // Workhorse (batter: projPa >= 650)
  if (data.projPa !== undefined && data.projPa >= 650) {
    tags.push({
      id: 'workhorse', label: 'Workhorse', color: 'green',
      tooltip: 'Projected for a full-time workload',
    });
  }

  // Three-Outcomes: low avg, high K%, high BB%, high HR%
  if (data.projAvg !== undefined && data.projKPct !== undefined &&
      data.projBbPct !== undefined && data.projHrPct !== undefined &&
      data.projAvg < 0.250 && data.projKPct > 16 && data.projBbPct > 9 && data.projHrPct > 3.7) {
    tags.push({
      id: 'three-outcomes', label: '3-Outcomes', color: 'amber',
      tooltip: `Walk, strikeout, or homer \u2014 .${Math.round(data.projAvg * 1000)} AVG, ${data.projKPct.toFixed(1)}% K, ${data.projBbPct.toFixed(1)}% BB, ${data.projHrPct.toFixed(1)}% HR`,
    });
  }

  // Gap Hitter: true gap power without raw power
  const gap = data.estimatedGap;
  const power = data.estimatedPower;
  const speed = data.estimatedSpeed;
  if (gap !== undefined && gap >= 65 && power !== undefined && power <= 40) {
    tags.push({
      id: 'gap-hitter', label: 'Gap Hitter', color: 'green',
      tooltip: `Gap ${Math.round(gap)} with Power ${Math.round(power)} \u2014 drives the ball into the gaps without over-the-fence power`,
    });
  }

  // Triples Machine: high gap and speed
  if (gap !== undefined && gap >= 70 && speed !== undefined && speed >= 60) {
    tags.push({
      id: 'triples-machine', label: 'Triples Machine', color: 'green',
      tooltip: `Gap ${Math.round(gap)} + Speed ${Math.round(speed)} \u2014 legs out extra bases`,
    });
  }

  return tags;
}

export function computePitcherTags(data: PitcherProfileData, ctx: TagContext): PlayerTag[] {
  const tags: PlayerTag[] = [];

  const devRatio = computeDevRatio(data.scoutOvr, data.scoutPot);

  // Top 100 Prospect
  if (ctx.top100Rank !== undefined) {
    tags.push({
      id: 'top-100', label: `Top 100 (#${ctx.top100Rank})`, color: 'blue',
      tooltip: `Ranked #${ctx.top100Rank} among all league prospects by True Future Rating`,
    });
  }

  // Overperformer: overall TR star rating exceeds TFR
  if (isOverperformer(data.trueRating, data.trueFutureRating)) {
    tags.push({
      id: 'overperformer', label: 'Overperformer', color: 'amber',
      tooltip: 'True ratings exceed future ratings \u2014 playing above expected ability',
    });
  }

  // Underperformer
  if (isUnderperformer(devRatio, data.trueRating, data.trueFutureRating)) {
    tags.push({
      id: 'underperformer', label: 'Underperformer', color: 'amber',
      tooltip: 'Has the tools but isn\u2019t putting it together',
    });
  }

  // Expensive / Bargain
  const valueTag = computeValueTag(ctx.currentSalary, data.projWar, ctx.leagueDollarPerWar);
  if (valueTag === 'expensive') {
    tags.push({
      id: 'expensive', label: 'Expensive', color: 'amber',
      tooltip: 'Poor value relative to production',
    });
  } else if (valueTag === 'bargain') {
    tags.push({
      id: 'bargain', label: 'Bargain', color: 'green',
      tooltip: 'Strong value relative to production',
    });
  }

  // Ready for Promotion (pitchers: 100 IP threshold)
  if (isReadyForPromotion(data.isProspect, devRatio, data.totalMinorIp, 100)) {
    tags.push({
      id: 'ready-for-promotion', label: 'Ready for Promotion', color: 'green',
      tooltip: 'Development indicators suggest MLB readiness',
    });
  }

  // Blocked
  if (isBlocked(data.isProspect, data.trueFutureRating, ctx)) {
    tags.push({
      id: 'blocked', label: 'Blocked', color: 'red',
      tooltip: `Blocked by ${ctx.blockingPlayer ?? 'incumbent'} (${ctx.blockingRating?.toFixed(1)}\u2605, ${ctx.blockingYears}yr)`,
    });
  }

  // Workload tags (mutually exclusive: Workhorse > Full-Time Starter > Innings Eater)
  const ip = data.projIp;
  const fipPct = ctx.fipPercentile;
  if (ip !== undefined && ip >= 230 && (data.injuryProneness === 'Durable' || data.injuryProneness === 'Iron Man')) {
    tags.push({
      id: 'workhorse', label: 'Workhorse', color: 'green',
      tooltip: `${Math.round(ip)} projected IP with durable frame \u2014 true workhorse starter`,
    });
  } else if (ip !== undefined && ip >= 180 && fipPct !== undefined && fipPct >= 40) {
    tags.push({
      id: 'full-time-starter', label: 'Full-Time Starter', color: 'green',
      tooltip: `${Math.round(ip)} projected IP, FIP at ${fipPct}th percentile`,
    });
  } else if (ip !== undefined && ip >= 180 && fipPct !== undefined && fipPct >= 30 && fipPct < 60) {
    tags.push({
      id: 'innings-eater', label: 'Innings Eater', color: 'amber',
      tooltip: `${Math.round(ip)} projected IP but mediocre FIP (${fipPct}th percentile)`,
    });
  }

  return tags;
}

/**
 * Render tags as HTML pill badges. Returns empty string if no tags.
 */
export function renderTagsHtml(tags: PlayerTag[]): string {
  if (tags.length === 0) return '';
  const pills = tags.map(t =>
    `<span class="player-tag tag-${t.color}" title="${t.tooltip}">${t.label}</span>`
  ).join('');
  return `<div class="player-tags-row">${pills}</div>`;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function computeDevRatio(ovr?: number, pot?: number): number | undefined {
  if (ovr === undefined || pot === undefined || pot <= 0) return undefined;
  return Math.min(1.0, ovr / pot);
}

/**
 * Overperformer: MLB player whose overall TR star rating exceeds TFR.
 * Individual components may vary — a player can overperform overall
 * while still having one weak component below their TFR ceiling.
 */
function isOverperformer(
  tr: number | undefined,
  tfr: number | undefined,
): boolean {
  if (tr === undefined || tfr === undefined) return false;
  return tr > tfr;
}

/**
 * Underperformer: nearly developed player (devRatio >= 0.8) whose TR is
 * significantly below TFR, indicating they have the tools but aren't producing.
 */
function isUnderperformer(
  devRatio: number | undefined,
  tr: number | undefined,
  tfr: number | undefined,
): boolean {
  if (devRatio === undefined || devRatio < 0.8) return false;
  if (tr === undefined || tfr === undefined) return false;
  return tfr - tr >= 0.5;
}

/**
 * Value tag based on $/WAR percentile within the league.
 * Requires salary >= $3M and WAR > 0.5 to qualify.
 */
function computeValueTag(
  salary: number,
  war: number | undefined,
  distribution: number[] | undefined,
): 'expensive' | 'bargain' | null {
  if (salary < 3_000_000 || war === undefined || war <= 0.5 || !distribution || distribution.length === 0) {
    return null;
  }
  const dollarPerWar = salary / war;
  const n = distribution.length;
  const oneThird = Math.floor(n / 3);

  // distribution is sorted ascending (best value first)
  // Top 1/3 (lowest $/WAR) = bargain, bottom 1/3 (highest $/WAR) = expensive
  if (dollarPerWar <= distribution[oneThird]) return 'bargain';
  if (dollarPerWar >= distribution[n - 1 - oneThird]) return 'expensive';
  return null;
}

/**
 * Ready for Promotion: prospect with devRatio >= 0.5 and enough minor league experience.
 */
function isReadyForPromotion(
  isProspect: boolean | undefined,
  devRatio: number | undefined,
  totalMinorExperience: number | undefined,
  experienceThreshold: number,
): boolean {
  if (!isProspect) return false;
  if (devRatio === undefined || devRatio < 0.5) return false;
  if (totalMinorExperience === undefined || totalMinorExperience < experienceThreshold) return false;
  return true;
}

/**
 * Blocked: prospect with TFR >= 3.0 whose position has a strong incumbent
 * with a long contract.
 */
function isBlocked(
  isProspect: boolean | undefined,
  tfr: number | undefined,
  ctx: TagContext,
): boolean {
  if (!isProspect) return false;
  if (tfr === undefined || tfr < 3.0) return false;
  if (ctx.blockingRating === undefined || ctx.blockingRating < 3.5) return false;
  if (ctx.blockingYears === undefined || ctx.blockingYears < 3) return false;
  return true;
}
