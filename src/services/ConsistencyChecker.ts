/**
 * ConsistencyChecker — dev-only runtime validation that displayed projection values
 * match the precomputed cache. Catches pipeline violations where a view recomputes
 * independently instead of reading from the canonical source.
 *
 * Only active on localhost. Zero overhead in production.
 */

import { supabaseDataService } from './SupabaseDataService';

const isDevMode = typeof location !== 'undefined' &&
  (location.hostname === 'localhost' || location.hostname === '127.0.0.1');

interface Mismatch {
  playerId: number;
  playerName: string;
  field: string;
  displayed: number;
  cached: number;
  source: string;
  timestamp: number;
}

// In-memory cache of projection lookups (populated lazily)
let batterProjMap: Map<number, any> | null = null;
let pitcherProjMap: Map<number, any> | null = null;

async function getBatterProjMap(): Promise<Map<number, any>> {
  if (batterProjMap) return batterProjMap;
  const cached = await supabaseDataService.getPrecomputed('batter_projections');
  batterProjMap = new Map<number, any>();
  if (cached?.projections) {
    for (const p of cached.projections) {
      batterProjMap.set(p.playerId, p.projectedStats);
    }
  }
  return batterProjMap;
}

async function getPitcherProjMap(): Promise<Map<number, any>> {
  if (pitcherProjMap) return pitcherProjMap;
  const cached = await supabaseDataService.getPrecomputed('pitcher_projections');
  pitcherProjMap = new Map<number, any>();
  if (cached?.projections) {
    for (const p of cached.projections) {
      pitcherProjMap.set(p.playerId, p.projectedStats);
    }
  }
  return pitcherProjMap;
}

// Recent mismatches (deduped by player+field)
const recentMismatches: Mismatch[] = [];
const seenKeys = new Set<string>();

// Event listeners for UI banner
type MismatchListener = (mismatches: Mismatch[]) => void;
const listeners: MismatchListener[] = [];

function reportMismatch(m: Mismatch): void {
  const key = `${m.playerId}:${m.field}:${m.source}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  recentMismatches.push(m);

  console.error(
    `%c[CONSISTENCY] %c${m.playerName} (${m.playerId})%c — ${m.source} shows ${m.field}=${m.displayed} but expected ${m.field}=${m.cached}`,
    'color: #d97706; font-weight: bold',
    'color: #ef4444; font-weight: bold',
    'color: #d97706'
  );

  for (const fn of listeners) fn(recentMismatches);
}

const TOLERANCES: Record<string, number> = {
  war: 0.15,
  'war (formula)': 0.15, // Same as cache check — formula now includes SB runs
  pa: 5,
  ip: 5,
  hr: 3,
  sb: 3,
  fip: 0.05,
};

function isClose(field: string, displayed: number, cached: number): boolean {
  const tol = TOLERANCES[field] ?? 0.1;
  return Math.abs(displayed - cached) <= tol;
}

export const consistencyChecker = {
  /** Check a batter's displayed projection values against the cache */
  async checkBatter(
    playerId: number,
    playerName: string,
    displayed: { war?: number; pa?: number; hr?: number; sb?: number },
    source: string,
  ): Promise<void> {
    if (!isDevMode || !supabaseDataService.isConfigured) return;
    if (supabaseDataService.hasCustomScouting) return; // Cache invalid with custom scouting
    try {
      const map = await getBatterProjMap();
      const cached = map.get(playerId);
      if (!cached) return; // Player not in cache (prospect, minor leaguer)

      const now = Date.now();
      for (const [field, value] of Object.entries(displayed)) {
        if (value === undefined || value === null) continue;
        // WAR and all components now come from the same canonical cache.
        // Both cache and formula checks should pass.
        const cachedVal = cached[field];
        if (cachedVal === undefined) continue;
        if (!isClose(field, value, cachedVal)) {
          reportMismatch({ playerId, playerName, field, displayed: value, cached: cachedVal, source, timestamp: now });
        }
      }
    } catch { /* silent — checker should never break the app */ }
  },

  /** Check a pitcher's displayed projection values against the cache */
  async checkPitcher(
    playerId: number,
    playerName: string,
    displayed: { war?: number; ip?: number; fip?: number },
    source: string,
  ): Promise<void> {
    if (!isDevMode || !supabaseDataService.isConfigured) return;
    if (supabaseDataService.hasCustomScouting) return;
    try {
      const map = await getPitcherProjMap();
      const cached = map.get(playerId);
      if (!cached) return;

      const now = Date.now();
      for (const [field, value] of Object.entries(displayed)) {
        if (value === undefined || value === null) continue;
        const cachedVal = cached[field];
        if (cachedVal === undefined) continue;
        if (!isClose(field, value, cachedVal)) {
          reportMismatch({ playerId, playerName, field, displayed: value, cached: cachedVal, source, timestamp: now });
        }
      }
    } catch { /* silent */ }
  },

  /**
   * Formula-based internal consistency check (works with custom scouting too).
   * Takes the projection's OUTPUT components and independently derives WAR via
   * the raw formula, then compares against the projection's displayed WAR.
   *
   * This catches: stale PA fed to WAR calc, IP reduced but WAR not recomputed,
   * wOBA from one source but PA from another, etc.
   *
   * NOT a "true === true" test — the projection pipeline computes WAR through
   * dozens of intermediate steps; this recalculates directly from final components.
   */
  checkBatterWarFormula(
    playerId: number,
    playerName: string,
    components: {
      displayedWar: number;
      projWoba: number;
      projPa: number;
      lgWoba: number;
      wobaScale: number;
      runsPerWin: number;
      sbRuns: number;
      defRuns: number;
      posAdj: number;
    },
    source: string,
  ): void {
    if (!isDevMode) return;
    const { displayedWar, projWoba, projPa, lgWoba, wobaScale, runsPerWin, sbRuns, defRuns, posAdj } = components;
    if (projPa <= 0) return; // Can't verify zero-PA projections
    // Independent WAR calculation from raw formula
    const wRAA = ((projWoba - lgWoba) / wobaScale) * projPa;
    const replacementRuns = (projPa / 600) * 20;
    const expectedWar = Math.round(((wRAA + replacementRuns + sbRuns + defRuns + posAdj) / runsPerWin) * 10) / 10;

    if (!isClose('war', displayedWar, expectedWar)) {
      console.warn(`[CONSISTENCY DEBUG] ${playerName} (#${playerId}):`,
        `\n  displayedWar=${displayedWar}, expectedWar=${expectedWar}`,
        `\n  projWoba=${projWoba}, lgWoba=${lgWoba}, wobaScale=${wobaScale}, runsPerWin=${runsPerWin}`,
        `\n  projPa=${projPa}, sbRuns=${sbRuns}, defRuns=${defRuns}, posAdj=${posAdj}`,
        `\n  wRAA=${wRAA.toFixed(2)}, replacementRuns=${replacementRuns.toFixed(2)}`,
        `\n  source=${source}`);
      reportMismatch({
        playerId, playerName, field: 'war (formula)',
        displayed: displayedWar, cached: expectedWar,
        source: `${source} [internal]`, timestamp: Date.now(),
      });
    }
  },

  /**
   * Formula-based pitcher WAR consistency check.
   * Derives WAR from FIP + IP using the raw formula, compares against displayed.
   */
  checkPitcherWarFormula(
    playerId: number,
    playerName: string,
    components: {
      displayedWar: number;
      projFip: number;
      projIp: number;
      replacementFip?: number;
      runsPerWin?: number;
    },
    source: string,
  ): void {
    if (!isDevMode) return;
    const { displayedWar, projFip, projIp } = components;
    const replFip = components.replacementFip ?? 5.20; // Must match FipWarService.WBL_DEFAULTS
    const rpw = components.runsPerWin ?? 8.50;
    if (projIp <= 0) return;
    // Independent WAR calculation from raw formula
    const expectedWar = Math.round(((replFip - projFip) / rpw) * (projIp / 9) * 10) / 10;

    if (!isClose('war', displayedWar, expectedWar)) {
      reportMismatch({
        playerId, playerName, field: 'war (formula)',
        displayed: displayedWar, cached: expectedWar,
        source: `${source} [internal]`, timestamp: Date.now(),
      });
    }
  },

  /** Register a listener for mismatch events (used by UI banner) */
  onMismatch(fn: MismatchListener): void {
    listeners.push(fn);
  },

  /** Get all recent mismatches */
  getMismatches(): Mismatch[] {
    return recentMismatches;
  },

  /** Clear the lookup caches (call after sync-db runs or data refreshes) */
  invalidate(): void {
    batterProjMap = null;
    pitcherProjMap = null;
    recentMismatches.length = 0;
    seenKeys.clear();
    const banner = document.getElementById('consistency-banner');
    if (banner) banner.remove();
  },
};

// Self-initializing UI banner (dev only)
if (isDevMode) {
  consistencyChecker.onMismatch((mismatches) => {
    let banner = document.getElementById('consistency-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'consistency-banner';
      banner.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; z-index: 99999;
        background: #451a03; color: #fbbf24; font-size: 13px; font-family: monospace;
        padding: 6px 12px; border-bottom: 2px solid #d97706;
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      `;
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = 'background: none; border: none; color: #fbbf24; cursor: pointer; font-size: 16px; margin-left: auto;';
      closeBtn.onclick = () => banner!.remove();
      banner.appendChild(closeBtn);
      document.body.prepend(banner);
    }
    // Update content (keep close button)
    const closeBtn = banner.querySelector('button')!;
    banner.innerHTML = '';
    const latest = mismatches[mismatches.length - 1];
    const icon = document.createElement('span');
    icon.textContent = '⚠ PIPELINE MISMATCH';
    icon.style.fontWeight = 'bold';
    banner.appendChild(icon);
    const detail = document.createElement('span');
    detail.textContent = `${latest.playerName} (${latest.playerId}): ${latest.source} shows ${latest.field}=${latest.displayed} but expected ${latest.field}=${latest.cached}`;
    banner.appendChild(detail);
    if (mismatches.length > 1) {
      const count = document.createElement('span');
      count.textContent = `(${mismatches.length} total)`;
      count.style.opacity = '0.7';
      banner.appendChild(count);
    }
    banner.appendChild(closeBtn);
  });
}
