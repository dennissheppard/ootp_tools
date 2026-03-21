/**
 * Batter Profile Modal - Full-featured modal for viewing batter details
 * Batter profile modal with ratings, projections, and development tracking
 */

import { getPositionLabel } from '../models/Player';
import { trueRatingsService } from '../services/TrueRatingsService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { HitterScoutingRatings } from '../models/ScoutingData';
import { minorLeagueBattingStatsService } from '../services/MinorLeagueBattingStatsService';
import { dateService } from '../services/DateService';
import { HitterRatingEstimatorService } from '../services/HitterRatingEstimatorService';
import { hitterAgingService } from '../services/HitterAgingService';
import { leagueBattingAveragesService, LeagueBattingAverages } from '../services/LeagueBattingAveragesService';
import { BatterTfrSourceData, teamRatingsService } from '../services/TeamRatingsService';
import { DevelopmentSnapshotRecord } from '../services/IndexedDBService';
import { DevelopmentChart, DevelopmentMetric, renderMetricToggles, bindMetricToggleHandlers, applyExclusiveMetricToggle } from '../components/DevelopmentChart';
import { contractService, Contract } from '../services/ContractService';
import { RadarChart, RadarChartSeries } from '../components/RadarChart';
import { aiScoutingService, AIScoutingPlayerData, markdownToHtml } from '../services/AIScoutingService';
import { resolveCanonicalBatterData, computeBatterProjection, BatterTrSourceData, snapshotBatterTr, applyBatterTrSnapshot, batterTrFromPrecomputed } from '../services/ModalDataService';
import { supabaseDataService } from '../services/SupabaseDataService';
import { computeBatterTags, renderTagsHtml, TagContext } from '../utils/playerTags';
import { getParkCharacterLabel, ParkFactorRow } from '../services/ParkFactorService';
import { analyticsService } from '../services/AnalyticsService';
import { playerService } from '../services/PlayerService';
import { batterProjectionService } from '../services/BatterProjectionService';
import { consistencyChecker } from '../services/ConsistencyChecker';
import { getRouter } from '../router';

// Eagerly resolve all team logo URLs via Vite glob
const _logoModules = (import.meta as Record<string, any>).glob('../images/logos/*.png', { eager: true, import: 'default' }) as Record<string, string>;
const teamLogoMap: Record<string, string> = {};
for (const [path, url] of Object.entries(_logoModules)) {
  const filename = path.split('/').pop()?.replace('.png', '')?.toLowerCase() ?? '';
  teamLogoMap[filename] = url;
}

/** Format injury days as a human-readable duration (e.g. "3 weeks", "5 months") */
function formatInjuryDuration(days: number): string {
  if (days <= 3) return 'day-to-day';
  if (days <= 13) return `${days} days`;
  if (days <= 6 * 7) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

export interface BatterProfileData {
  playerId: number;
  playerName: string;
  team?: string;
  parentTeam?: string;
  age?: number;
  position?: number;
  positionLabel?: string;

  // True Ratings
  trueRating?: number;
  percentile?: number;
  woba?: number;

  // Estimated ratings (from stats)
  estimatedPower?: number;
  estimatedEye?: number;
  estimatedAvoidK?: number;
  estimatedContact?: number;
  estimatedGap?: number;
  estimatedSpeed?: number;

  // Scouting data
  scoutPower?: number;
  scoutEye?: number;
  scoutAvoidK?: number;
  scoutContact?: number;
  scoutGap?: number;
  scoutSpeed?: number;
  scoutOvr?: number;
  scoutPot?: number;
  scoutSR?: number;
  scoutSTE?: number;
  injuryProneness?: string;
  retired?: boolean;

  // Raw stats (historical)
  pa?: number;
  avg?: number;
  obp?: number;
  slg?: number;
  hr?: number;
  rbi?: number;
  sb?: number;
  war?: number;

  // Projected stats (for next season)
  projWoba?: number;
  projAvg?: number;
  projObp?: number;
  projSlg?: number;
  projPa?: number;
  projHr?: number;
  projRbi?: number;
  projWar?: number;
  projWrcPlus?: number;
  projBbPct?: number;
  projKPct?: number;
  projHrPct?: number;
  projDoublesRate?: number;  // per AB
  projTriplesRate?: number;  // per AB
  projSb?: number;
  projCs?: number;

  // Defensive value (precomputed by DefensiveProjectionService)
  defRuns?: number;
  posAdj?: number;

  // Park factors (effective half home / half away)
  parkFactors?: { avg: number; hr: number; d: number; t: number };
  rawParkFactors?: ParkFactorRow;

  // TFR for prospects
  isProspect?: boolean;
  trueFutureRating?: number;
  tfrPercentile?: number;

  // TFR ceiling data (for ceiling bars when both TR and TFR exist)
  hasTfrUpside?: boolean;    // TFR > TR
  tfrPower?: number;         // TFR component (20-80)
  tfrEye?: number;
  tfrAvoidK?: number;
  tfrContact?: number;
  tfrGap?: number;
  tfrSpeed?: number;

  // TFR blended rates (for peak projection — avoids lossy rating→rate round-trip)
  tfrBbPct?: number;
  tfrKPct?: number;
  tfrHrPct?: number;
  tfrAvg?: number;
  tfrObp?: number;
  tfrSlg?: number;
  tfrPa?: number;

  // TFR by scout source (for toggle in modal)
  tfrBySource?: { my?: BatterTfrSourceData; osa?: BatterTfrSourceData };

  // TR by scout source (for toggle in modal — swaps blended rates + projections)
  trBySource?: { my?: BatterTrSourceData; osa?: BatterTrSourceData };

  // Prospect metadata (for tags)
  level?: string;
  totalMinorPa?: number;
}

interface BatterSeasonStats {
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

export class BatterProfileModal {
  private static nextInstanceId = 0;
  private instanceId: number;

  private overlay: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };

  private scoutingData: HitterScoutingRatings | null = null;
  private scoutingIsOsa = false;
  private myScoutingData: HitterScoutingRatings | null = null;
  private osaScoutingData: HitterScoutingRatings | null = null;
  private projectionYear: number = new Date().getFullYear();
  private _draftLabel: string | null = null;
  private currentData: BatterProfileData | null = null;

  // Development tab state
  private developmentChart: DevelopmentChart | null = null;
  private activeDevMetrics: DevelopmentMetric[] = ['scoutPower', 'scoutEye', 'scoutAvoidK'];
  private devMode: 'ratings' | 'stats' = 'ratings';
  private cachedRatingSnapshots: DevelopmentSnapshotRecord[] | null = null;
  private cachedStatSnapshots: DevelopmentSnapshotRecord[] | null = null;
  private savedRatingMetrics: DevelopmentMetric[] | null = null;
  private savedStatMetrics: DevelopmentMetric[] | null = null;

  // Radar chart instances
  private radarChart: RadarChart | null = null;
  private runningRadarChart: RadarChart | null = null;
  private fieldingRadarChart: RadarChart | null = null;
  private fieldingScouting: any = null;
  private myFieldingScouting: any = null;
  private osaFieldingScouting: any = null;
  private fieldingTab: 'catcher' | 'infield' | 'outfield' = 'catcher';

  // Contract data for current player
  private contract: Contract | null = null;

  // League WAR ceiling for arc scaling
  private leagueWarMax: number = 8;

  // Tag context (cross-player data for Expensive/Bargain/Blocked tags)
  private leagueDollarPerWar: number[] | undefined;
  private blockingPlayer: string | undefined;
  private blockingRating: number | undefined;
  private blockingYears: number | undefined;
  private top100Rank: number | undefined;


  // Dynamic league averages (loaded per year)
  private leagueAvg: LeagueBattingAverages | null = null;

  // Projection toggle state (Current vs Peak)
  private projectionMode: 'current' | 'peak' = 'current';
  private currentStats: BatterSeasonStats[] = [];
  private _lastProjectionWar: number | undefined;
  private _lastProjection: any | undefined;
  private injuryDaysRemaining: number = 0;

  // Track which radar series are hidden via legend toggle
  private hiddenSeries = new Set<string>();

  // Analysis toggle state (Projections vs True Analysis)
  private viewMode: 'projections' | 'career' | 'analysis' = 'projections';
  private cachedAnalysisHtml: string = '';

  // Guard against async race conditions when re-opened quickly
  private showGeneration = 0;

  constructor() {
    this.instanceId = BatterProfileModal.nextInstanceId++;
    this.ensureOverlayExists();
  }

  private ensureOverlayExists(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay batter-profile-modal';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `
      <div class="modal modal-lg modal-draggable">
        <img class="modal-logo-watermark" aria-hidden="true" />
        <div class="modal-header">
          <div class="profile-header">
            <div class="profile-title-group">
              <div class="title-row">
                <h3 class="modal-title"></h3>
              </div>
              <div class="team-position-row">
                <span class="position-badge-slot"></span>
                <span class="player-team-info"></span>
              </div>
              <div class="player-age-info"></div>
            </div>
            <div class="ratings-header-slot"></div>
            <div class="header-vitals"></div>
            <div class="war-header-slot"></div>
          </div>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          ${this.renderLoadingContent()}
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.modal = this.overlay.querySelector('.modal');

    // Close button
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide());

    // Click outside to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay && !this.isDragging) {
        this.hide();
      }
    });

    // Top 100 tag — close modal and navigate to Farm Rankings > Top 100 with team filter cleared
    this.overlay.addEventListener('click', (e) => {
      const tag = (e.target as HTMLElement).closest<HTMLElement>('[data-tag-id="top-100"]');
      if (!tag) return;
      this.hide();
      document.querySelector<HTMLElement>('[data-tab-target="tab-farm-rankings"]')?.click();
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('wbl:farm-show-top100'));
      }, 0);
    });

    this.setupDragging();
  }

  private setupDragging(): void {
    const header = this.overlay?.querySelector<HTMLElement>('.modal-header');
    if (!header || !this.modal) return;

    header.style.cursor = 'grab';

    header.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.modal-close')) return;

      this.isDragging = true;
      header.style.cursor = 'grabbing';

      const rect = this.modal!.getBoundingClientRect();
      this.dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      this.modal!.classList.add('dragging');
      this.modal!.style.left = `${rect.left}px`;
      this.modal!.style.top = `${rect.top}px`;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging || !this.modal) return;

      const x = e.clientX - this.dragOffset.x;
      const y = e.clientY - this.dragOffset.y;

      const maxX = window.innerWidth - this.modal.offsetWidth;
      const maxY = window.innerHeight - this.modal.offsetHeight;

      this.modal.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      this.modal.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
    });

    document.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        const header = this.overlay?.querySelector<HTMLElement>('.modal-header');
        if (header) header.style.cursor = 'grab';
      }
    });
  }

  async show(data: BatterProfileData, _selectedYear: number): Promise<void> {
    this.ensureOverlayExists();
    if (!this.overlay) return;

    analyticsService.trackPlayerProfileOpened({
      playerId: data.playerId,
      playerName: data.playerName,
      playerType: 'batter',
      team: data.team,
      trueRating: data.trueRating,
      isProspect: data.isProspect,
    });

    // Clean up any existing charts from a previous show() (e.g. re-opened without hide())
    if (this.radarChart) { this.radarChart.destroy(); this.radarChart = null; }
    if (this.runningRadarChart) { this.runningRadarChart.destroy(); this.runningRadarChart = null; }
    if (this.fieldingRadarChart) { this.fieldingRadarChart.destroy(); this.fieldingRadarChart = null; }
    if (this.developmentChart) { this.developmentChart.destroy(); this.developmentChart = null; }

    // Increment generation to guard against async race conditions
    const generation = ++this.showGeneration;

    // Reset projection toggle
    this.projectionMode = 'current';
    this._lastProjectionWar = undefined;
    this._lastProjection = undefined;
    this._draftLabel = null;
    this.injuryDaysRemaining = 0;
    // Reset analysis view — default to projections (AI fetched on demand)
    this.viewMode = 'projections';
    this.cachedAnalysisHtml = '';
    // Reset cached development snapshots from previous player
    this.cachedRatingSnapshots = null;
    this.cachedStatSnapshots = null;
    this.savedRatingMetrics = null;
    this.savedStatMetrics = null;
    this.hiddenSeries.clear();

    // Store current data for re-rendering on toggle
    this.currentData = data;

    // === Show modal shell immediately with what we have ===
    const titleEl = this.overlay.querySelector<HTMLElement>('.modal-title');
    const teamEl = this.overlay.querySelector<HTMLElement>('.player-team-info');
    const ageEl = this.overlay.querySelector<HTMLElement>('.player-age-info');
    const posBadgeSlot = this.overlay.querySelector<HTMLElement>('.position-badge-slot');
    const ratingsSlot = this.overlay.querySelector<HTMLElement>('.ratings-header-slot');
    const warSlot = this.overlay.querySelector<HTMLElement>('.war-header-slot');
    const vitalsSlot = this.overlay.querySelector<HTMLElement>('.header-vitals');

    if (titleEl) {
      const link = document.createElement('a');
      link.href = `https://worldbaseballleague.org/#/player/${data.playerId}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = data.playerName;
      link.title = `View on WBL.org (ID: ${data.playerId})`;
      titleEl.textContent = '';
      titleEl.appendChild(link);
    }
    if (teamEl) {
      const teamInfo = this.formatTeamInfo(data.team, data.parentTeam);
      teamEl.innerHTML = teamInfo;
      teamEl.style.display = teamInfo ? '' : 'none';
    }
    if (posBadgeSlot) posBadgeSlot.innerHTML = this.renderPositionBadge(data);
    if (ageEl) ageEl.textContent = data.age ? `Age: ${data.age}` : '';
    // Clear slots that depend on canonical data — will be filled after async
    if (ratingsSlot) ratingsSlot.innerHTML = '';
    if (warSlot) warSlot.innerHTML = '';
    if (vitalsSlot) vitalsSlot.innerHTML = '';

    // Set header logo watermark
    const watermark = this.overlay.querySelector<HTMLImageElement>('.modal-logo-watermark');
    if (watermark) {
      const logoUrl = this.getTeamLogoUrl(data.team) ?? this.getTeamLogoUrl(data.parentTeam);
      if (logoUrl) {
        watermark.src = logoUrl;
        watermark.style.display = '';
      } else {
        watermark.style.display = 'none';
      }
    }

    const bodyEl = this.overlay.querySelector<HTMLElement>('.modal-body');
    if (bodyEl) bodyEl.innerHTML = this.renderLoadingContent();

    this.overlay.classList.add('visible');
    this.overlay.setAttribute('aria-hidden', 'false');

    // Push /player/:id URL
    getRouter().openPlayer(data.playerId);

    // Bind escape key
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this.boundKeyHandler);

    // === Async data loading (modal is already visible with loading skeleton) ===

    // Store projection year (next year during offseason)
    const currentYear = await dateService.getCurrentYear();
    if (generation !== this.showGeneration) return; // Stale call
    this.projectionYear = await dateService.getProjectionTargetYear();

    // Load dynamic league averages (prior year as baseline for projections)
    this.leagueAvg = await leagueBattingAveragesService.getLeagueAverages(currentYear - 1);

    // === Canonical data override — ensures consistency regardless of caller ===
    let playerTR: import('../services/HitterTrueRatingsCalculationService').HitterTrueRatingResult | undefined;
    let tfrEntry: import('../services/TeamRatingsService').RatedHitterProspect | undefined;
    let osaPrecomputedTR: import('../services/HitterTrueRatingsCalculationService').HitterTrueRatingResult | undefined;

    if (supabaseDataService.isConfigured && !supabaseDataService.hasCustomScouting) {
      // Fast path: single-player rating lookup (1 query instead of bulk fetches)
      // Skip when custom scouting is active — need locally computed TR/TFR instead
      try {
        const rows = await supabaseDataService.getPlayerRating(data.playerId);
        if (generation !== this.showGeneration) return;
        for (const row of rows) {
          if (row.rating_type === 'hitter_tr') playerTR = row.data;
          else if (row.rating_type === 'hitter_tfr') tfrEntry = row.data;
        }
      } catch { /* ratings not available */ }
    } else {
      // 1. Fetch canonical TR — always attempt, even for callers who tag the player
      // as a prospect. Players with limited MLB PAs (e.g. late-season call-ups) may
      // have a TR entry and should show Current/Peak toggle, not prospect-only peak.
      {
        const canonicalTR = await trueRatingsService.getHitterTrueRatings(currentYear);
        if (generation !== this.showGeneration) return;
        playerTR = canonicalTR.get(data.playerId);
      }

      // 2. Always fetch canonical TFR (for players with upside)
      try {
        const unifiedData = await teamRatingsService.getUnifiedHitterTfrData(currentYear);
        if (generation !== this.showGeneration) return;
        tfrEntry = unifiedData.prospects.find(p => p.playerId === data.playerId);
      } catch { /* TFR data not available */ }

      // 3. Also fetch pre-computed OSA TR for scouting toggle (non-prospects only)
      if (supabaseDataService.isConfigured && supabaseDataService.hasCustomScouting && !data.isProspect) {
        try {
          const rows = await supabaseDataService.getPlayerRating(data.playerId);
          if (generation !== this.showGeneration) return;
          for (const row of rows) {
            if (row.rating_type === 'hitter_tr') osaPrecomputedTR = row.data;
          }
        } catch { /* OSA pre-computed not available — toggle just won't update projections */ }
      }
    }

    this.top100Rank = (tfrEntry?.percentileRank !== undefined && tfrEntry.percentileRank <= 100 && tfrEntry.isFarmEligible)
      ? tfrEntry.percentileRank : undefined;

    // 3-5. Apply canonical data overrides (TR, TFR, prospect detection, derived projections)
    resolveCanonicalBatterData(data, playerTR, tfrEntry);

    // Load defensive value and park factors from precomputed lookups
    if (supabaseDataService.isConfigured) {
      try {
        const [defLookup, parkFactorsData] = await Promise.all([
          data.defRuns === undefined ? supabaseDataService.getPrecomputed('defensive_lookup') : Promise.resolve(null),
          data.parkFactors === undefined ? supabaseDataService.getPrecomputed('park_factors') : Promise.resolve(null),
        ]);
        if (generation !== this.showGeneration) return;
        if (defLookup) {
          const entry = defLookup[data.playerId];
          if (entry) {
            data.defRuns = entry[0];
            data.posAdj = entry[1];
          }
        }
        const allPlayers = await playerService.getAllPlayers();
        const player = allPlayers.find(p => p.id === data.playerId);
        // Active injury days for projection adjustment
        this.injuryDaysRemaining = player?.injuryDaysRemaining ?? 0;
        if (parkFactorsData && player) {
          const { computeEffectiveParkFactors, ensureParkName } = await import('../services/ParkFactorService');
          const parentTeamId = player.parentTeamId || player.teamId;
          const teamPf = parkFactorsData[parentTeamId];
          if (teamPf) {
            data.parkFactors = computeEffectiveParkFactors(teamPf, player.bats ?? 'R');
            data.rawParkFactors = teamPf;
            await ensureParkName(teamPf);
          }
        }
      } catch { /* lookups not available */ }
    }

    // Overlay precomputed projection (injury/park adjusted).
    // The precomputed cache is the canonical source — includes promotion-ready prospects.
    if (supabaseDataService.isConfigured && !supabaseDataService.hasCustomScouting) {
      try {
        const cachedCtx = await batterProjectionService.getProjectionsWithContext(currentYear);
        if (generation !== this.showGeneration) return;
        const cachedProj = cachedCtx?.projections?.find((p: any) => p.playerId === data.playerId);
        if (cachedProj) {
          data.projPa = cachedProj.projectedStats.pa;
          data.projWar = cachedProj.projectedStats.war;
          data.projHr = cachedProj.projectedStats.hr;
          data.projSb = cachedProj.projectedStats.sb;
          // Prospect with current-year projection: enable current/peak toggle
          if (data.isProspect) {
            data.hasTfrUpside = true;
            if (data.trueRating === undefined) data.trueRating = (cachedProj as any).currentTrueRating ?? 1.0;
          }
        } else if (!data.isProspect) {
          // Non-prospect not in cache (e.g. called up mid-season) — clear so modal recomputes
          data.projPa = undefined;
          data.projWar = undefined;
        }
      } catch {
        if (!data.isProspect) {
          data.projPa = undefined;
          data.projWar = undefined;
        }
      }
    } else if (!data.isProspect) {
      // Custom scouting or non-Supabase — clear so modal recomputes from canonical TR
      data.projPa = undefined;
      data.projWar = undefined;
    }

    // Build trBySource so scouting toggle can swap projections
    if (supabaseDataService.hasCustomScouting && !data.isProspect) {
      const customSnapshot = snapshotBatterTr(data);
      const osaSnapshot = osaPrecomputedTR ? batterTrFromPrecomputed(osaPrecomputedTR) : undefined;
      data.trBySource = {};
      if (customSnapshot) data.trBySource.my = customSnapshot;
      if (osaSnapshot) data.trBySource.osa = osaSnapshot;
    }

    // Fetch additional data
    try {
      // Fetch scouting + contract + league context in parallel
      const [myScouting, osaScouting, playerContract, leagueCtx, rawFielding] = await Promise.all([
        hitterScoutingDataService.getScoutingForPlayer(data.playerId, 'my'),
        hitterScoutingDataService.getScoutingForPlayer(data.playerId, 'osa'),
        contractService.getContractForPlayer(data.playerId),
        supabaseDataService.isConfigured ? supabaseDataService.getPrecomputed('league_context') : Promise.resolve(null),
        supabaseDataService.isConfigured ? supabaseDataService.getFieldingScoutingForPlayer(data.playerId) : Promise.resolve(null),
      ]);
      // Fielding: prefer scouting-source fielding, fall back to Supabase raw_data
      this.myFieldingScouting = myScouting?.fielding ?? null;
      this.osaFieldingScouting = osaScouting?.fielding ?? rawFielding;
      this.fieldingScouting = (myScouting?.fielding) ? myScouting.fielding : (osaScouting?.fielding ?? rawFielding);
      console.log(`[BatterModal] Player ${data.playerId}: myScouting=${myScouting ? `found (power=${myScouting.power})` : 'NOT FOUND'}, osaScouting=${osaScouting ? `found (power=${osaScouting.power})` : 'NOT FOUND'}`);
      if (generation !== this.showGeneration) return; // Stale call

      this.contract = playerContract ?? null;

      // Default fielding tab based on primary position
      const pos = data.position ?? 0;
      if (pos === 2) this.fieldingTab = 'catcher';
      else if (pos >= 7 && pos <= 9) this.fieldingTab = 'outfield';
      else this.fieldingTab = 'infield';

      // Tag context
      this.blockingPlayer = undefined;
      this.blockingRating = undefined;
      this.blockingYears = undefined;

      // League context: WAR ceiling + $/WAR distribution
      this.leagueWarMax = leagueCtx?.batterWarMax ?? 8;
      this.leagueDollarPerWar = leagueCtx?.dollarPerWar?.length > 0 ? leagueCtx.dollarPerWar : undefined;

      // Store both for dropdown toggle
      this.myScoutingData = myScouting ?? null;
      this.osaScoutingData = osaScouting ?? null;
      // Default to 'my' if available, otherwise OSA
      if (myScouting) {
        this.scoutingData = myScouting;
        this.scoutingIsOsa = false;
      } else if (osaScouting) {
        this.scoutingData = osaScouting;
        this.scoutingIsOsa = true;
      } else {
        this.scoutingData = null;
        this.scoutingIsOsa = false;
      }

      // Resolve draft-eligible / HS-College label for Free Agents
      if (data.team === 'Free Agent') {
        try {
          const player = await playerService.getPlayerById(data.playerId);
          if (player?.draftEligible) {
            const year = this.projectionYear ?? new Date().getFullYear();
            this._draftLabel = `Draft Eligible (${year})`;
          } else if (player?.hsc) {
            this._draftLabel = player.hsc;
          }
          if (this._draftLabel && teamEl) {
            teamEl.innerHTML = this.formatTeamInfo(data.team, data.parentTeam);
          }
        } catch { /* player lookup failed */ }
      }

      // Now render header slots with scouting data
      if (ratingsSlot) {
        ratingsSlot.innerHTML = this.renderRatingEmblem(data);
      }
      // Skip WAR badge here — it will be rendered after the body sets _lastProjectionWar
      if (vitalsSlot) {
        vitalsSlot.innerHTML = this.renderHeaderVitals(data);
      }
      if (ageEl) {
        ageEl.textContent = data.age ? `Age: ${data.age}` : '';
      }

      // Fetch batting stats history
      const currentYear2 = await dateService.getCurrentYear();

      // Fetch minor league batting stats
      let minorStats: BatterSeasonStats[] = [];
      try {
        const minorBattingStats = await minorLeagueBattingStatsService.getPlayerStats(
          data.playerId,
          currentYear2 - 5,
          currentYear2
        );
        minorStats = minorBattingStats.map(s => ({
          year: s.year,
          level: s.level,
          pa: s.pa,
          avg: s.avg,
          obp: s.obp,
          slg: s.slg,
          hr: s.hr,
          d: s.d,
          t: s.t,
          rbi: 0,
          sb: s.sb,
          cs: s.cs,
          bb: s.bb,
          k: s.k,
          war: 0
        }));
      } catch (e) {
        console.warn('No minor league batting stats found');
      }

      // Fetch MLB batting stats
      let mlbStats: BatterSeasonStats[] = [];
      try {
        if (supabaseDataService.isConfigured) {
          // Single query for this player's MLB batting across all years
          const rows = await supabaseDataService.query<any>(
            'batting_stats',
            `select=*&player_id=eq.${data.playerId}&league_id=eq.200&split_id=eq.1&year=gte.${currentYear2 - 4}&year=lte.${currentYear2}&order=year.desc`
          );
          // Dedup by year (keep row with most PA — the season total)
          const byYear = new Map<number, any>();
          for (const r of rows) {
            const existing = byYear.get(r.year);
            if (!existing || (r.pa ?? 0) > (existing.pa ?? 0)) byYear.set(r.year, r);
          }
          for (const r of byYear.values()) {
            const ab = r.ab ?? 0, h = r.h ?? 0, d = r.d ?? 0, t = r.t ?? 0, hr = r.hr ?? 0;
            const singles = h - d - t - hr;
            const slg = ab > 0 ? (singles + 2 * d + 3 * t + 4 * hr) / ab : 0;
            const pa = r.pa ?? 0, bb = r.bb ?? 0;
            mlbStats.push({
              year: r.year, level: 'MLB', pa,
              avg: ab > 0 ? h / ab : 0,
              obp: pa > 0 ? (h + bb + (r.hp ?? 0)) / (ab + bb + (r.sf ?? 0) + (r.hp ?? 0)) : 0,
              slg: Math.round(slg * 1000) / 1000,
              hr, d, t, rbi: r.rbi ?? 0,
              sb: r.sb ?? 0, cs: r.cs ?? 0, bb, k: r.k ?? 0,
              war: r.war ?? 0,
            });
          }
        } else {
          for (let year = currentYear2; year >= currentYear2 - 4; year--) {
            const yearStats = await trueRatingsService.getTrueBattingStats(year);
            const playerStat = yearStats.find(s => s.player_id === data.playerId);
            if (playerStat) {
              const singles = playerStat.h - playerStat.d - playerStat.t - playerStat.hr;
              const slg = playerStat.ab > 0
                ? (singles + 2 * playerStat.d + 3 * playerStat.t + 4 * playerStat.hr) / playerStat.ab
                : 0;

              mlbStats.push({
                year: year, level: 'MLB', pa: playerStat.pa,
                avg: playerStat.avg, obp: playerStat.obp,
                slg: Math.round(slg * 1000) / 1000,
                hr: playerStat.hr, d: playerStat.d, t: playerStat.t,
                rbi: playerStat.rbi, sb: playerStat.sb, cs: playerStat.cs,
                bb: playerStat.bb, k: playerStat.k, war: playerStat.war,
              });
            }
          }
        }
      } catch (e) {
        console.warn('No MLB batting stats found');
      }

      // Combine and sort
      const allStats = [...mlbStats, ...minorStats].sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        const levelOrder: Record<string, number> = { 'MLB': 0, 'aaa': 1, 'aa': 2, 'a': 3, 'r': 4 };
        return (levelOrder[a.level] ?? 5) - (levelOrder[b.level] ?? 5);
      });

      // Store stats for projection re-rendering
      this.currentStats = allStats;

      // Compute history-aware projected PA when we have MLB stats but no pre-calculated value.
      // For non-prospects, the canonical override above clears projPa so it's always recomputed
      // here from the player's actual MLB history (consistent regardless of caller).
      // Exclude projection target year to avoid partial-season contamination.
      // Use projectionYear (not currentYear) so offseason projections include the just-completed season.
      if (data.projPa === undefined && mlbStats.length > 0) {
        const historicalPaData = mlbStats
          .filter(s => s.year < this.projectionYear)
          .map(s => ({ year: s.year, pa: s.pa }));
        const injProne = this.scoutingData?.injuryProneness ?? data.injuryProneness;
        data.projPa = leagueBattingAveragesService.getProjectedPaWithHistory(
          historicalPaData, data.age, injProne
        );
      }

      // Render full body first (sets _lastProjectionWar for badge consistency)
      if (bodyEl) {
        bodyEl.innerHTML = this.renderBody(data, allStats);
        this.bindBodyEvents();

        // Trigger shimmer on emblem
        requestAnimationFrame(() => {
          const emblem = this.overlay?.querySelector('.rating-emblem');
          if (emblem) emblem.classList.add('shimmer-once');
        });
      }

      // Re-render WAR emblem after body (uses _lastProjectionWar set by renderProjectionContent)
      if (warSlot) {
        warSlot.innerHTML = this.renderWarEmblem(data);
      }
    } catch (error) {
      console.error('Error loading batter profile data:', error);
      console.error('Player:', data.playerId, data.playerName, 'isProspect:', data.isProspect, 'TR:', data.trueRating, 'TFR:', data.trueFutureRating);
      if (bodyEl) {
        const msg = error instanceof Error ? error.message : String(error);
        bodyEl.innerHTML = `<p class="error">Failed to load player data: ${msg}</p>`;
      }
    }
  }

  hide(): void {
    if (!this.overlay) return;

    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');

    // Restore tab URL (replaces /player/:id or ?player= with the current tab path)
    getRouter().closePlayer();

    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }

    if (this.modal) {
      this.modal.classList.remove('dragging');
      this.modal.style.left = '';
      this.modal.style.top = '';
    }

    // Clean up radar charts
    if (this.radarChart) {
      this.radarChart.destroy();
      this.radarChart = null;
    }
    if (this.runningRadarChart) {
      this.runningRadarChart.destroy();
      this.runningRadarChart = null;
    }

    // Clean up development chart
    if (this.developmentChart) {
      this.developmentChart.destroy();
      this.developmentChart = null;
    }
  }

  private formatTeamInfo(team?: string, parentTeam?: string): string {
    if (!team) return '';
    // Draft-eligible / HS-College prospects: update label after player lookup
    if (team === 'Free Agent' && this._draftLabel) {
      return `<span class="team-name">${this._draftLabel}</span>`;
    }
    if (parentTeam) {
      return `<span class="team-name">${team}</span> <span class="parent-team">(${parentTeam})</span>`;
    }
    return `<span class="team-name">${team}</span>`;
  }

  /** Resolve a team name to its logo URL, trying full name then nickname match */
  private getTeamLogoUrl(teamName?: string): string | null {
    if (!teamName) return null;
    const normalized = teamName.replace(/\s+/g, '_').toLowerCase();
    // Exact match: "Toronto Huskies" → "toronto_huskies"
    if (teamLogoMap[normalized]) return teamLogoMap[normalized];
    // Nickname match: "Huskies" → find file ending with "_huskies"
    for (const [filename, url] of Object.entries(teamLogoMap)) {
      if (filename.endsWith('_' + normalized)) return url;
    }
    return null;
  }

  private renderPositionBadge(data: BatterProfileData): string {
    const posLabel = data.positionLabel || (data.position ? getPositionLabel(data.position) : 'Unknown');
    const posClass = this.getPositionClass(data.position);
    return `<span class="position-badge ${posClass}">${posLabel}</span>`;
  }

  private renderLoadingContent(): string {
    return `
      <div class="player-modal-loading">
        <div class="ratings-layout loading-skeleton">
          <div class="ratings-panel ratings-panel-hitting">
            <div class="skeleton-radar-placeholder"></div>
          </div>
          <div class="ratings-sidebar">
            <div class="ratings-panel ratings-panel-running" style="min-height: 140px;">
              <div class="skeleton-radar-placeholder" style="height: 120px;"></div>
            </div>
            <div class="ratings-panel ratings-panel-fielding" style="min-height: 140px;">
              <div class="skeleton-radar-placeholder" style="height: 120px;"></div>
            </div>
          </div>
        </div>
        <div class="stats-section loading-skeleton" style="margin-top: 1rem;">
          <div class="stats-tabs">
            <div class="skeleton-line sm"></div>
            <div class="skeleton-line sm"></div>
          </div>
          <div class="stats-table-scroll">
            <table class="stats-table skeleton-table">
              <thead>
                <tr>
                  ${Array.from({ length: 8 }, () => '<th><span class="skeleton-line xs"></span></th>').join('')}
                </tr>
              </thead>
              <tbody>
                ${Array.from({ length: 3 }, () => `
                  <tr>
                    ${Array.from({ length: 8 }, () => '<td><span class="skeleton-line xs"></span></td>').join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  private getPositionClass(position?: number): string {
    switch (position) {
      case 2: return 'pos-catcher';
      case 6: case 4: return 'pos-middle-infield';
      case 8: return 'pos-center-field';
      case 3: case 5: return 'pos-corner';
      case 7: case 9: return 'pos-corner-outfield';
      case 10: return 'pos-dh';
      default: return 'pos-utility';
    }
  }

  private renderRatingEmblem(data: BatterProfileData): string {
    // Unified: has TR → show TR; no TR but has TFR → show TFR (pure prospect)
    const hasTr = typeof data.trueRating === 'number';
    const hasTfr = typeof data.trueFutureRating === 'number';
    const useTfr = !hasTr && hasTfr;
    const ratingValue = useTfr ? data.trueFutureRating : data.trueRating;

    if (typeof ratingValue !== 'number') {
      return '<div class="rating-emblem rating-none"><span class="rating-emblem-score">--</span></div>';
    }

    const badgeClass = this.getTrueRatingClass(ratingValue);
    const percentile = useTfr ? data.tfrPercentile : data.percentile;
    const percentileText = typeof percentile === 'number' ? `${this.formatPercentile(percentile)} Percentile` : '';
    const label = useTfr ? 'True Future Rating' : 'True Rating';

    // Half-donut arc for the TR emblem (0-5 scale)
    const emblemSize = 100;
    const cx = emblemSize / 2;
    const cy = emblemSize / 2 + 2;
    const radius = (emblemSize / 2) - 8;
    const sw = 8;
    const fraction = Math.max(0, Math.min(1, ratingValue / 5));
    const arcPath = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
    const halfCirc = Math.PI * radius;
    const dashOff = halfCirc * (1 - fraction);

    // Show "Peak" indicator when player has TFR upside (TFR > TR by >= 0.25 stars)
    let upsideHtml = '';
    if (data.hasTfrUpside && hasTr && hasTfr && (data.trueFutureRating! - data.trueRating! >= 0.25)) {
        upsideHtml = `<span class="emblem-gauge-upside" title="True Future Rating: ${data.trueFutureRating!.toFixed(1)}">↗ ${data.trueFutureRating!.toFixed(1)}</span>`;
    }

    return `
      <div class="rating-emblem ${badgeClass}">
        <div class="rating-emblem-header">
          <span class="rating-emblem-label">${label}</span>
          ${upsideHtml}
        </div>
        <div class="emblem-gauge-wrap">
          <svg class="emblem-gauge-svg" width="${emblemSize}" height="${emblemSize / 2 + 8}" viewBox="0 0 ${emblemSize} ${emblemSize / 2 + 8}">
            <path d="${arcPath}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="${sw}" stroke-linecap="round" />
            <path d="${arcPath}" fill="none" stroke="var(--rating-color)" stroke-width="${sw}" stroke-linecap="round"
              stroke-dasharray="${halfCirc}" stroke-dashoffset="${dashOff}"
              style="transition: stroke-dashoffset 0.6s ease-out;" />
          </svg>
          <div class="emblem-gauge-score">${ratingValue.toFixed(1)}</div>
        </div>
        ${percentileText ? `<div class="rating-emblem-meta">${percentileText}</div>` : ''}
      </div>
    `;
  }

  private formatPercentile(p: number): string {
    const rounded = Math.round(p);
    const suffix = rounded === 11 || rounded === 12 || rounded === 13 ? 'th'
      : rounded % 10 === 1 ? 'st'
      : rounded % 10 === 2 ? 'nd'
      : rounded % 10 === 3 ? 'rd'
      : 'th';
    return `${rounded}${suffix}`;
  }

  /**
   * Compute wOBA from component rates.
   * All rates are per-PA (bbRate) or per-AB (avg, doublesRate, triplesRate, hrRate).
   */
  private computeWoba(bbRate: number, avg: number, doublesRate: number, triplesRate: number, hrRate: number): number {
    const abRate = 1 - bbRate; // approximate AB/PA
    const singlesPerAb = Math.max(0, avg - doublesRate - triplesRate - hrRate);
    return 0.69 * bbRate +
      abRate * (0.89 * singlesPerAb + 1.27 * doublesRate + 1.62 * triplesRate + 2.10 * hrRate);
  }

  private calculateProjWar(data: BatterProfileData): number | undefined {
    const s = this.scoutingData;
    const sr = s?.stealingAggressiveness ?? data.scoutSR;
    const ste = s?.stealingAbility ?? data.scoutSTE;

    let projWar = data.projWar;
    if (projWar === undefined) {
      const age = data.age ?? 27;
      const injuryProneness = s?.injuryProneness ?? data.injuryProneness;
      let projPa: number;
      if (data.projPa !== undefined) {
        projPa = data.projPa;
      } else {
        const mlbHistory = (this.currentStats ?? [])
          .filter(s2 => s2.level === 'MLB' && s2.year < this.projectionYear)
          .map(s2 => ({ year: s2.year, pa: s2.pa }));
        projPa = mlbHistory.length > 0
          ? leagueBattingAveragesService.getProjectedPaWithHistory(mlbHistory, age, injuryProneness)
          : leagueBattingAveragesService.getProjectedPa(injuryProneness, age);
      }

      // Compute wOBA for WAR calculation
      let woba: number | undefined;
      if (data.projWoba !== undefined) {
        woba = data.projWoba;
      } else if (data.projAvg !== undefined && data.projBbPct !== undefined && data.projHrPct !== undefined) {
        const bbRate = data.projBbPct / 100;
        const hrPerAb = (data.projHrPct / 100) / 0.88;
        const doublesPerAb = data.projDoublesRate ?? 0.04;
        const triplesPerAb = data.projTriplesRate ?? 0.005;
        woba = this.computeWoba(bbRate, data.projAvg, doublesPerAb, triplesPerAb, hrPerAb);
      } else if (data.estimatedPower !== undefined && data.estimatedEye !== undefined &&
                 data.estimatedContact !== undefined) {
        const projBbPct = HitterRatingEstimatorService.expectedBbPct(data.estimatedEye);
        const projAvg = HitterRatingEstimatorService.expectedAvg(data.estimatedContact);
        const hrPerAb = (HitterRatingEstimatorService.expectedHrPct(data.estimatedPower) / 100) / 0.88;
        const gapForBadge = data.tfrGap ?? data.estimatedGap;
        const speedForBadge = data.tfrSpeed ?? data.estimatedSpeed;
        const doublesPerAb = gapForBadge !== undefined ? HitterRatingEstimatorService.expectedDoublesRate(gapForBadge) : 0.04;
        const triplesPerAb = speedForBadge !== undefined ? HitterRatingEstimatorService.expectedTriplesRate(speedForBadge) : 0.005;
        woba = this.computeWoba(projBbPct / 100, projAvg, doublesPerAb, triplesPerAb, hrPerAb);
      }

      if (woba !== undefined) {
        let sbRuns = 0;
        if (sr !== undefined && ste !== undefined) {
          // Use historical blending when available (same as projection stat line)
          const histSbStats = (this.currentStats ?? [])
            .filter(s2 => s2.level === 'MLB' && s2.pa >= 50)
            .sort((a, b) => b.year - a.year)
            .map(s2 => ({ sb: s2.sb, cs: s2.cs, pa: s2.pa }));
          const sbProj = histSbStats.length > 0
            ? HitterRatingEstimatorService.projectStolenBasesWithHistory(sr, ste, projPa, histSbStats)
            : HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa);
          sbRuns = leagueBattingAveragesService.calculateBaserunningRuns(sbProj.sb, sbProj.cs);
        }
        if (this.leagueAvg) {
          projWar = leagueBattingAveragesService.calculateBattingWar(woba, projPa, this.leagueAvg, sbRuns);
        } else {
          // Fallback with hardcoded constants
          const fallbackAvg: LeagueBattingAverages = { year: 0, lgObp: 0.320, lgSlg: 0.400, lgWoba: 0.320, lgRpa: 0.115, wobaScale: 1.15, runsPerWin: 10, totalPa: 0, totalRuns: 0 };
          projWar = leagueBattingAveragesService.calculateBattingWar(woba, projPa, fallbackAvg, sbRuns);
        }
      }
    }
    return projWar;
  }

  private renderWarEmblem(data: BatterProfileData): string {
    // Use projection line WAR when available for consistency; fall back to independent calc
    const projWar = this._lastProjectionWar ?? this.calculateProjWar(data);
    const warText = typeof projWar === 'number' ? projWar.toFixed(1) : '--';
    const warLabel = data.isProspect ? 'Proj Peak WAR' : 'Proj WAR';
    const badgeClass = this.getWarBadgeClass(projWar);

    if (typeof projWar !== 'number') {
      return `<div class="war-emblem war-none"><div class="war-emblem-header"><span class="war-emblem-label">${warLabel}</span></div><div class="emblem-gauge-score">--</div></div>`;
    }

    // Half-donut arc scaled to league leader WAR
    const emblemSize = 100;
    const cx = emblemSize / 2;
    const cy = emblemSize / 2 + 2;
    const radius = (emblemSize / 2) - 8;
    const sw = 8;
    const fraction = Math.max(0, Math.min(1, projWar / this.leagueWarMax));
    const arcPath = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
    const halfCirc = Math.PI * radius;
    const dashOff = halfCirc * (1 - fraction);

    return `
      <div class="war-emblem ${badgeClass}">
        <div class="war-emblem-header">
          <span class="war-emblem-label">${warLabel}</span>
        </div>
        <div class="emblem-gauge-wrap">
          <svg class="emblem-gauge-svg" width="${emblemSize}" height="${emblemSize / 2 + 8}" viewBox="0 0 ${emblemSize} ${emblemSize / 2 + 8}">
            <path d="${arcPath}" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="${sw}" stroke-linecap="round" />
            <path d="${arcPath}" fill="none" stroke="var(--war-color)" stroke-width="${sw}" stroke-linecap="round"
              stroke-dasharray="${halfCirc}" stroke-dashoffset="${dashOff}"
              style="transition: stroke-dashoffset 0.6s ease-out;" />
          </svg>
          <div class="emblem-gauge-score${this.injuryDaysRemaining >= 18 ? ' injury-adjusted' : ''}">${warText}</div>
        </div>
      </div>
    `;
  }

  private renderParkButton(data: BatterProfileData): string {
    if (!data.rawParkFactors) return '';
    const pf = data.rawParkFactors;
    const eff = data.parkFactors;
    const { label, class: pfClass } = getParkCharacterLabel(pf);
    if (!eff) return '';

    // Current projected stats are already park-adjusted; back out to get neutral
    const projWar = this._lastProjectionWar ?? data.projWar;
    const parkAvg = data.projAvg;
    const parkHr = data.projHr;
    const parkWoba = data.projWoba;
    const parkWar = projWar;

    // If no projections yet, show just the park name
    if (parkAvg === undefined && parkHr === undefined) {
      return `
        <button class="modal-action-btn park-action-btn ${pfClass}" data-action="park" data-team-id="${pf.team_id}">
          <span style="font-size:14px;">&#127967;</span>
        </button>
      `;
    }

    const neutAvg = parkAvg !== undefined ? parkAvg / eff.avg : undefined;
    const neutHr = parkHr !== undefined ? Math.round(parkHr / eff.hr) : undefined;
    const combinedFactor = eff.hr * 0.35 + eff.avg * 0.30 + eff.d * 0.20 + eff.t * 0.05 + 1.0 * 0.10;
    const neutWoba = parkWoba !== undefined ? parkWoba / combinedFactor : undefined;
    const offPortion = parkWar !== undefined ? Math.max(0, parkWar * 0.7) : undefined;
    const neutWar = (parkWar !== undefined && offPortion !== undefined)
      ? parkWar - offPortion + offPortion / combinedFactor : undefined;

    const fmtAvg = (v: number) => v.toFixed(3);
    const fmtWoba = (v: number) => v.toFixed(3);
    const fmtWar = (v: number) => v.toFixed(1);

    const clsDelta = (park: number, neut: number, higherIsBetter: boolean) => {
      const diff = park - neut;
      if (Math.abs(diff) < 0.001) return 'pf-neutral';
      return (diff > 0) === higherIsBetter ? 'pf-hitter-friendly' : 'pf-pitcher-friendly';
    };

    let rows = `<table style="border-collapse:collapse; width:100%; font-size:0.7rem; font-variant-numeric:tabular-nums;">
      <tr style="color:var(--color-text-muted);"><td></td><td>Neutral</td><td>${pf.park_name}</td></tr>`;
    if (parkAvg !== undefined && neutAvg !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">AVG</td><td>${fmtAvg(neutAvg)}</td><td class="${clsDelta(parkAvg, neutAvg, true)}">${fmtAvg(parkAvg)}</td></tr>`;
    }
    if (parkHr !== undefined && neutHr !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">HR</td><td>${neutHr}</td><td class="${clsDelta(parkHr, neutHr, true)}">${parkHr}</td></tr>`;
    }
    if (parkWoba !== undefined && neutWoba !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">wOBA</td><td>${fmtWoba(neutWoba)}</td><td class="${clsDelta(parkWoba, neutWoba, true)}">${fmtWoba(parkWoba)}</td></tr>`;
    }
    if (parkWar !== undefined && neutWar !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">WAR</td><td>${fmtWar(neutWar)}</td><td class="${clsDelta(parkWar, neutWar, true)}">${fmtWar(parkWar)}</td></tr>`;
    }
    rows += '</table>';

    return `
      <button class="modal-action-btn park-action-btn ${pfClass}" data-action="park" data-team-id="${pf.team_id}">
        <span style="font-size:14px;">&#127967;</span>
        <div class="park-factor-tooltip">
          <div class="park-factor-tooltip-header">${pf.park_name} · <span class="${pfClass}">${label}</span></div>
          <div class="park-factor-tooltip-sep"></div>
          ${rows}
        </div>
      </button>
    `;
  }

  private renderHeaderVitals(data: BatterProfileData): string {
    const s = this.scoutingData;
    const starsHtml = this.renderOvrPotStars(data);
    const contractHtml = this.renderContractInfo();

    const injury = s?.injuryProneness ?? data.injuryProneness ?? 'Normal';
    const injuryClass = this.getInjuryBadgeClass(injury);
    const injuryStatusHtml = this.renderInjuryStatus();
    const personalityHtml = this.renderPersonalityVitalsColumn();

    // Tags are rendered in renderBody(), not here

    return `
      <span class="header-divider" style="visibility:hidden;"></span>
      <div class="vitals-col">
        ${starsHtml ? `<div class="metadata-info-row">
          <span class="info-label">OVR/POT:</span>
          ${starsHtml}
        </div>` : ''}
        <div class="metadata-info-row">
          <span class="info-label">$$$:</span>
          <span class="contract-info">${contractHtml}</span>
        </div>
        <div class="metadata-info-row">
          <span class="info-label">Injury:</span>
          <span class="injury-badge ${injuryClass}">${injury}</span>${injuryStatusHtml}
        </div>
      </div>
      ${personalityHtml ? `<span class="header-divider"></span>${personalityHtml}<span class="header-divider" style="visibility:hidden;"></span>` : '<span class="header-divider" style="visibility:hidden;"></span>'}
    `;
  }

  /** Renders personality traits as a vertical column, positive on top, negative below */
  private renderPersonalityVitalsColumn(): string {
    const s = this.scoutingData;
    if (!s) return '';

    const traits: Array<{ key: string; label: string; value?: 'H' | 'N' | 'L'; inverted?: boolean }> = [
      { key: 'leadership', label: 'Leadership', value: s.leadership },
      { key: 'loyalty', label: 'Loyalty', value: s.loyalty },
      { key: 'adaptability', label: 'Adaptability', value: s.adaptability },
      { key: 'greed', label: s.greed === 'L' ? 'Low Greed' : 'Greedy', value: s.greed, inverted: true },
      { key: 'workEthic', label: 'Work Ethic', value: s.workEthic },
      { key: 'intelligence', label: 'Intelligence', value: s.intelligence },
    ];

    const positive = traits.filter(t => t.inverted ? t.value === 'L' : t.value === 'H');
    const negative = traits.filter(t => t.inverted ? t.value === 'H' : t.value === 'L');
    if (positive.length === 0 && negative.length === 0) return '';

    const renderTrait = (t: typeof traits[0], isPositive: boolean) => {
      const levelClass = isPositive ? 'trait-high' : 'trait-low';
      const arrow = isPositive ? '▲' : '▼';
      return `<span class="personality-trait ${levelClass}"><span class="trait-arrow">${arrow}</span>${t.label}</span>`;
    };

    const positiveHtml = positive.map(t => renderTrait(t, true)).join('');
    const negativeHtml = negative.map(t => renderTrait(t, false)).join('');

    return `
      <div class="vitals-col vitals-personality">
        <span class="info-label">Personality:</span>
        ${positiveHtml ? `<div class="personality-traits-group">${positiveHtml}</div>` : ''}
        ${negativeHtml ? `<div class="personality-traits-group">${negativeHtml}</div>` : ''}
      </div>
    `;
  }

  private getInjuryBadgeClass(injury: string): string {
    const classMap: Record<string, string> = {
      'Ironman': 'injury-durable',
      'Durable': 'injury-durable',
      'Normal': 'injury-normal',
      'Wary': 'injury-wary',
      'Fragile': 'injury-fragile',
      'Prone': 'injury-prone',
      'Wrecked': 'injury-prone',
    };
    return classMap[injury] ?? 'injury-normal';
  }

  private renderInjuryStatus(): string {
    const days = this.injuryDaysRemaining;
    if (days <= 0) return '';
    const duration = formatInjuryDuration(days);
    const SEASON_DAYS = 180;
    const pct = Math.min(Math.round((days / SEASON_DAYS) * 100), 100);
    const tipText = `−${pct}% PA &amp; WAR`;
    return ` <span class="injury-active-badge" data-tip="${tipText}">🏥 out ${duration}</span>`;
  }

  private formatSalary(salary: number): string {
    if (salary >= 1_000_000) {
      const millions = salary / 1_000_000;
      return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
    }
    if (salary >= 1_000) {
      return `$${Math.round(salary / 1_000)}K`;
    }
    return `$${salary}`;
  }

  private renderContractInfo(): string {
    if (!this.contract || this.contract.years === 0) return '—';
    const c = this.contract;
    const salaries = c.salaries ?? [];
    const currentSalary = salaries[c.currentYear] ?? salaries[0] ?? 0;

    // Build tooltip content
    const tooltipLines: string[] = [];
    for (let i = 0; i < c.years; i++) {
      const sal = salaries[i] ?? 0;
      const marker = i === c.currentYear ? '→ ' : '  ';
      tooltipLines.push(`<div class="contract-tooltip-row${i === c.currentYear ? ' current' : ''}">${marker}Yr ${i + 1}: ${this.formatSalary(sal)}</div>`);
    }

    const clauses: string[] = [];
    if (c.noTrade) clauses.push('No Trade');
    if (c.lastYearTeamOption) clauses.push('Team Option (final yr)');
    if (c.lastYearPlayerOption) clauses.push('Player Option (final yr)');
    if (c.lastYearVestingOption) clauses.push('Vesting Option (final yr)');
    if (clauses.length) {
      tooltipLines.push(`<div class="contract-tooltip-clauses">${clauses.join(' · ')}</div>`);
    }

    const tooltipHtml = `<div class="contract-tooltip">${tooltipLines.join('')}</div>`;

    if (currentSalary === 0) {
      return `<span class="contract-info-hover"><span class="contract-mlc">MLC</span>${tooltipHtml}</span>`;
    }

    // League minimum: exactly $228K
    if (currentSalary === 228_000) {
      return `<span class="contract-info-hover"><span class="contract-mlc">League Min</span>${tooltipHtml}</span>`;
    }

    const salaryStr = this.formatSalary(currentSalary);

    // Arbitration: 1-year contract above league minimum
    if (c.years === 1) {
      return `<span class="contract-info-hover">${salaryStr} <span class="contract-arb">(Arb)</span>${tooltipHtml}</span>`;
    }

    // Real contract: multi-year deal
    const yearStr = `Yr ${c.currentYear + 1} of ${c.years}`;
    return `<span class="contract-info-hover">${salaryStr} · ${yearStr}${tooltipHtml}</span>`;
  }

  private renderOvrPotStars(data: BatterProfileData): string {
    const s = this.scoutingData;
    const ovr = s?.ovr ?? data.scoutOvr;
    const pot = s?.pot ?? data.scoutPot;

    if (typeof ovr !== 'number' || typeof pot !== 'number') return '';

    const totalStars = pot;  // POT determines total number of stars shown
    const filledStars = ovr; // OVR determines how many are filled

    let html = '<span class="ovr-pot-stars" title="OVR ' + ovr.toFixed(1) + ' / POT ' + pot.toFixed(1) + '">';

    // Render each star position (up to totalStars, in 0.5 increments)
    const maxWholeStars = Math.ceil(totalStars);
    for (let i = 1; i <= maxWholeStars; i++) {
      const remaining = filledStars - (i - 1);
      const potRemaining = totalStars - (i - 1);

      if (remaining >= 1) {
        html += '<svg class="star-icon star-filled" viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
      } else if (remaining >= 0.5) {
        html += `<svg class="star-icon star-half" viewBox="0 0 24 24" width="14" height="14">
          <defs><clipPath id="star-half-clip-${i}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>
          <path class="star-empty-path" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          <path class="star-filled-path" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" clip-path="url(#star-half-clip-${i})"/>
        </svg>`;
      } else if (potRemaining >= 0.5) {
        html += '<svg class="star-icon star-empty" viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
      }
    }

    html += '</span>';
    return html;
  }

  private getWarBadgeClass(war?: number): string {
    if (war === undefined) return 'war-none';
    if (war >= 6.0) return 'war-elite';
    if (war >= 4.0) return 'war-allstar';
    if (war >= 2.0) return 'war-starter';
    if (war >= 1.0) return 'war-bench';
    return 'war-replacement';
  }

  private getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  // ─── Body Rendering ───────────────────────────────────────────────────

  private renderBody(data: BatterProfileData, stats: BatterSeasonStats[]): string {
    const isRetired = data.retired === true;
    if (isRetired) this.viewMode = 'career';
    // Compute projection FIRST so ratings section can use cached values (PA, HR, 2B, etc.)
    const projectionContent = this.renderProjectionContent(data, stats);
    const ratingsSection = this.renderRatingsSection(data);
    const careerContent = this.renderCareerStatsContent(stats);

    // Compute player tags
    const currentSalary = this.contract ? contractService.getCurrentSalary(this.contract) : 0;
    const tagCtx: TagContext = {
      currentSalary,
      leagueDollarPerWar: this.leagueDollarPerWar,
      blockingPlayer: this.blockingPlayer,
      blockingRating: this.blockingRating,
      blockingYears: this.blockingYears,
      top100Rank: this.top100Rank,
    };
    const tagsHtml = renderTagsHtml(computeBatterTags(data, tagCtx));

    return `
      <div class="profile-tabs">
        <button class="profile-tab active" data-tab="ratings">Ratings and Projections</button>
        <button class="profile-tab" data-tab="development">Development</button>
        <div class="profile-tab-actions">
          ${tagsHtml}
          <div class="modal-action-buttons">
            ${this.renderParkButton(data)}
            <button class="modal-action-btn" data-action="share" title="Copy link to clipboard">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>
            <button class="modal-action-btn" data-action="trade" title="Add to Trade Analyzer">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="profile-tab-content">
        <div class="tab-pane active" data-pane="ratings">
          ${ratingsSection}
          <div class="analysis-toggle-row">
            <div class="analysis-toggle">
              <button class="analysis-toggle-btn ${this.viewMode === 'projections' ? 'active' : ''}" data-view="projections">Projections</button>
              <button class="analysis-toggle-btn ${this.viewMode === 'career' ? 'active' : ''}" data-view="career">Career Stats</button>
              <button class="analysis-toggle-btn ${this.viewMode === 'analysis' ? 'active' : ''}" data-view="analysis">True Analysis</button>
            </div>
          </div>
          <div class="analysis-content-area">
            <div class="analysis-pane" style="${this.viewMode === 'analysis' ? '' : 'display:none'}">
              ${this.cachedAnalysisHtml || this.renderAnalysisLoading()}
            </div>
            <div class="projections-pane" style="${this.viewMode === 'projections' ? '' : 'display:none'}">
              ${projectionContent}
            </div>
            <div class="career-pane" style="${this.viewMode === 'career' ? '' : 'display:none'}">
              ${careerContent}
            </div>
          </div>
        </div>
        <div class="tab-pane" data-pane="development">
          ${this.renderDevelopmentTab(data.playerId)}
        </div>
      </div>
    `;
  }

  // ─── Ratings Section: Radar + Physicals ───────────────────────────────

  private renderRatingsSection(data: BatterProfileData): string {
    // Build axis badge data for hitting chart
    const s = this.scoutingData;
    const hasEstimated = data.estimatedContact !== undefined ||
                         data.estimatedPower !== undefined ||
                         data.estimatedEye !== undefined ||
                         data.estimatedAvoidK !== undefined ||
                         data.estimatedGap !== undefined;
    const hasTfrCeiling = data.hasTfrUpside && data.tfrContact !== undefined;

    // Use cached projection values from renderProjectionContent (computed first in renderBody)
    const p = this._lastProjection;
    const projPa = p?.projPa;
    const projAvg = p?.projAvg;
    const projBbPct = p?.projBbPct;
    const projKPct = p?.projKPct;
    const projHr = p?.projHr;
    const proj2b = p?.proj2b;

    const hittingAxes = [
      { label: 'Contact', pos: 'top', est: data.estimatedContact, scout: s?.contact, tfr: data.tfrContact, projLabel: 'AVG', projValue: projAvg?.toFixed(3) },
      { label: 'Eye', pos: 'upper-right', est: data.estimatedEye, scout: s?.eye, tfr: data.tfrEye, projLabel: 'BB', projValue: projBbPct !== undefined && projPa ? Math.round(projPa * projBbPct / 100).toString() : undefined },
      { label: 'Power', pos: 'lower-right', est: data.estimatedPower, scout: s?.power, tfr: data.tfrPower, projLabel: 'HR', projValue: projHr?.toString() },
      { label: 'Gap', pos: 'lower-left', est: data.estimatedGap ?? s?.gap, scout: data.estimatedGap !== undefined ? s?.gap : undefined, tfr: data.tfrGap, projLabel: '2B', projValue: proj2b?.toString() },
      { label: 'AvoidK', pos: 'upper-left', est: data.estimatedAvoidK, scout: s?.avoidK, tfr: data.tfrAvoidK, projLabel: 'K', projValue: projKPct !== undefined && projPa ? Math.round(projPa * projKPct / 100).toString() : undefined },
    ];

    const hittingAxisLabelsHtml = hittingAxes.map(a => {
      let badges = '';
      const hasTr = hasEstimated && a.est !== undefined;
      const hasTfr = hasTfrCeiling && a.tfr !== undefined;
      const hasScout = s && a.scout !== undefined;
      if (hasTr) badges += `<span class="radar-axis-badge radar-badge-true">${Math.round(a.est!)}</span>`;
      if (hasTfr) badges += `<span class="radar-axis-badge radar-badge-tfr">${Math.round(a.tfr!)}</span>`;
      if (hasScout) badges += `<span class="radar-axis-badge radar-badge-scout">${Math.round(a.scout!)}</span>`;
      const projBadge = a.projValue !== undefined ? `<span class="radar-proj-badge radar-proj-${a.pos}"><span class="proj-value">${a.projValue}</span><span class="proj-label">${a.projLabel}</span></span>` : '';
      return `<div class="radar-axis-label radar-axis-${a.pos}">
        <span class="radar-axis-name">${a.label}</span>
        <div class="radar-axis-badges">${badges}</div>
        ${projBadge}
      </div>`;
    }).join('');

    // Build axis badge data for running chart
    const sr = s?.stealingAggressiveness ?? data.scoutSR;
    const ste = s?.stealingAbility ?? data.scoutSTE;
    const scoutSpeed = s?.speed ?? data.scoutSpeed;
    const hasRunningData = sr !== undefined || ste !== undefined || scoutSpeed !== undefined;

    const projSb = p?.projSb;
    const projCs = p?.projCs ?? 0;
    const proj3b = p?.proj3b;
    const projSbPct = projSb !== undefined && (projSb + projCs) > 0 ? Math.round((projSb / (projSb + projCs)) * 100) : undefined;
    const projSba = projSb !== undefined ? projSb + projCs : undefined;

    const runningAxes = [
      { label: 'SB Ability', pos: 'top', value: ste, projLabel: 'SB%', projValue: projSbPct !== undefined ? projSbPct + '%' : undefined },
      { label: 'SB Freq', pos: 'lower-right', value: sr, projLabel: 'SBA', projValue: projSba?.toString() },
      { label: 'Speed', pos: 'lower-left', value: scoutSpeed, projLabel: '3B', projValue: proj3b?.toString() },
    ];

    const runningAxisLabelsHtml = runningAxes.map(a => {
      let badges = '';
      if (a.value !== undefined) badges += `<span class="radar-axis-badge radar-badge-true">${Math.round(a.value)}</span>`;
      const projBadge = a.projValue !== undefined ? `<span class="radar-proj-badge radar-proj-${a.pos}"><span class="proj-value">${a.projValue}</span><span class="proj-label">${a.projLabel}</span></span>` : '';
      return `<div class="radar-axis-label running-axis-${a.pos}">
        <span class="radar-axis-name">${a.label}</span>
        <div class="radar-axis-badges">${badges}</div>
        ${projBadge}
      </div>`;
    }).join('');

    // Scout source toggle (only if both sources exist)
    const showScoutToggle = this.myScoutingData !== null && this.osaScoutingData !== null;
    const scoutToggleHtml = showScoutToggle ? `
      <div class="toggle-group scout-source-toggle">
        <button class="toggle-btn scout-toggle-btn ${!this.scoutingIsOsa ? 'active' : ''}" data-value="my">My Scout</button>
        <button class="toggle-btn scout-toggle-btn ${this.scoutingIsOsa ? 'active' : ''}" data-value="osa">OSA</button>
      </div>
    ` : '';

    // Fielding chart tabs + position bars
    const f = this.fieldingScouting;
    const hasFielding = f !== null;
    const fieldingTabHtml = hasFielding ? `
      <div class="toggle-group fielding-tab-toggle">
        <button class="toggle-btn fielding-tab-btn ${this.fieldingTab === 'catcher' ? 'active' : ''}" data-tab="catcher">C</button>
        <button class="toggle-btn fielding-tab-btn ${this.fieldingTab === 'infield' ? 'active' : ''}" data-tab="infield">IF</button>
        <button class="toggle-btn fielding-tab-btn ${this.fieldingTab === 'outfield' ? 'active' : ''}" data-tab="outfield">OF</button>
      </div>
    ` : '';

    // Position bars — only positions with non-zero ratings
    const positionNames: Record<string, string> = { pos2: 'C', pos3: '1B', pos4: '2B', pos5: '3B', pos6: 'SS', pos7: 'LF', pos8: 'CF', pos9: 'RF' };
    let positionBarsHtml = '';
    if (hasFielding) {
      const bars: string[] = [];
      for (const [key, label] of Object.entries(positionNames)) {
        const val = parseInt(f[key], 10) || 0;
        if (val > 0) {
          const pct = Math.round(((val - 20) / 60) * 100);
          bars.push(`<div class="pos-rating-row"><span class="pos-label">${label}</span><div class="pos-bar-track"><div class="pos-bar-fill" style="width:${pct}%"></div></div><span class="pos-value">${val}</span></div>`);
        }
      }
      if (bars.length > 0) {
        positionBarsHtml = `<div class="position-ratings-bars"><div class="chart-section-sublabel">Positions</div>${bars.join('')}</div>`;
      }
    }

    return `
      <div class="ratings-section">
        <div class="ratings-top-bar">
          ${scoutToggleHtml}
          <div class="legend-inline">
            <span class="legend-item" data-series="True Rating"><span class="legend-dot legend-dot-true"></span><span class="legend-text">True Rating</span></span>
            ${hasTfrCeiling ? '<span class="legend-item" data-series="True Future Rating"><span class="legend-dot legend-dot-tfr"></span><span class="legend-text">True Future Rating</span></span>' : ''}
            ${s ? `<span class="legend-item" data-series="scout"><span class="legend-dot legend-dot-scout"></span><span class="legend-text">${this.scoutingIsOsa ? 'OSA' : 'My Scout'}</span></span>` : ''}
            <span class="legend-item" data-series="Stat Projections"><span class="legend-dot legend-dot-proj"></span><span class="legend-text">Stat Projections</span></span>
          </div>
        </div>
        <div class="ratings-layout">
          <div class="ratings-panel ratings-panel-hitting">
            <div class="ratings-panel-header"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5"/></svg>Hitting</div>
            <div class="radar-chart-wrapper">
              <div id="batter-radar-chart-${this.instanceId}"></div>
              ${hittingAxisLabelsHtml}
            </div>
          </div>
          <div class="ratings-sidebar">
            <div class="ratings-panel ratings-panel-running">
              <div class="ratings-panel-header"><svg viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>Running</div>
              ${hasRunningData ? `
              <div class="radar-chart-wrapper running-radar-wrapper">
                <div id="batter-running-radar-chart-${this.instanceId}"></div>
                ${runningAxisLabelsHtml}
              </div>
              ` : `
              <div class="radar-chart-placeholder running-radar-wrapper">
                <div class="placeholder-axes">
                  <span>SB Abil</span>
                  <span>SB Freq</span>
                  <span>Speed</span>
                </div>
                <p class="placeholder-label">No scouting data</p>
              </div>
              `}
            </div>
            ${hasFielding ? `
            <div class="ratings-panel ratings-panel-fielding">
              <div class="ratings-panel-header"><svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="none" stroke="currentColor" stroke-width="2"/></svg>Fielding</div>
              <div class="fielding-content-row">
                ${fieldingTabHtml}
                <div class="fielding-chart-col">
                  <div class="radar-chart-wrapper fielding-radar-wrapper">
                    <div id="batter-fielding-radar-chart-${this.instanceId}"></div>
                    <div class="fielding-axis-labels"></div>
                  </div>
                </div>
                <div class="position-bars-col">
                  ${positionBarsHtml}
                </div>
              </div>
            </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }

  private initRadarChart(data: BatterProfileData): void {
    // Destroy existing
    if (this.radarChart) {
      this.radarChart.destroy();
      this.radarChart = null;
    }

    const s = this.scoutingData;
    const categories = ['Contact', 'Eye', 'Power', 'Gap', 'AvoidK'];
    const series: RadarChartSeries[] = [];

    // Check if we have estimated (True) ratings
    const hasEstimated = data.estimatedContact !== undefined ||
                         data.estimatedPower !== undefined ||
                         data.estimatedEye !== undefined ||
                         data.estimatedAvoidK !== undefined ||
                         data.estimatedGap !== undefined;

    // True Ratings series (blue) — first
    if (hasEstimated) {
      series.push({
        name: 'True Rating',
        data: [
          data.estimatedContact ?? 50,
          data.estimatedEye ?? 50,
          data.estimatedPower ?? 50,
          data.estimatedGap ?? 50,
          data.estimatedAvoidK ?? 50,
        ],
        color: '#3b82f6',
      });
    }

    // True Future Rating series (pink, dashed) — second
    if (data.hasTfrUpside && data.tfrContact !== undefined) {
      series.push({
        name: 'True Future Rating',
        data: [
          data.tfrContact ?? 50,
          data.tfrEye ?? 50,
          data.tfrPower ?? 50,
          data.tfrGap ?? 50,
          data.tfrAvoidK ?? 50,
        ],
        color: '#34d399',
        dashStyle: 'dashed',
        fillOpacity: 0.05,
      });
    }

    // Scout series (amber) — third
    if (s) {
      series.push({
        name: this.scoutingIsOsa ? 'OSA Scout' : 'My Scout',
        data: [
          s.contact ?? 50,
          s.eye ?? 50,
          s.power ?? 50,
          s.gap ?? 50,
          s.avoidK ?? 50,
        ],
        color: '#8b949e',
      });
    }

    // Filter out hidden series
    const visibleSeries = series.filter(s2 => !this.hiddenSeries.has(s2.name));

    // If no visible series, render with transparent placeholder to keep the grid visible
    const chartSeries = visibleSeries.length > 0 ? visibleSeries : [{
      name: '_empty',
      data: categories.map(() => 20), // min value
      color: 'transparent',
    }];

    this.radarChart = new RadarChart({
      containerId: `batter-radar-chart-${this.instanceId}`,
      categories,
      series: chartSeries,
      height: 280,
      radarSize: 125,
      min: 20,
      max: 85,
      showLegend: false,
      offsetX: -20,
      onLegendClick: () => {
        // Legend toggling handled by inline legend bar (bindLegendToggle)
      },
      onUpdated: () => {},
    });
    this.radarChart.render();

    // Apply badge visibility for any previously hidden series
    if (this.hiddenSeries.size > 0) {
      requestAnimationFrame(() => {
        this.updateAxisBadgeVisibility();
      });
    }
  }

  private initRunningRadarChart(data: BatterProfileData): void {
    // Destroy existing
    if (this.runningRadarChart) {
      this.runningRadarChart.destroy();
      this.runningRadarChart = null;
    }

    const s = this.scoutingData;
    const sr = s?.stealingAggressiveness ?? data.scoutSR;
    const ste = s?.stealingAbility ?? data.scoutSTE;
    const speed = s?.speed ?? data.scoutSpeed;

    // Need at least one value
    if (sr === undefined && ste === undefined && speed === undefined) return;

    const categories = ['SB Abil', 'SB Aggr', 'Speed'];
    const series: RadarChartSeries[] = [{
      name: 'True Rating',
      data: [ste ?? 50, sr ?? 50, speed ?? 50],
      color: '#1d9bf0',
    }];

    this.runningRadarChart = new RadarChart({
      containerId: `batter-running-radar-chart-${this.instanceId}`,
      categories,
      series,
      height: 150,
      radarSize: 60,
      min: 20,
      max: 85,
      legendPosition: 'top',
      showLegend: false,
      offsetX: 0,
      offsetY: 0,
    });
    this.runningRadarChart.render();
  }

  private initFieldingRadarChart(): void {
    if (this.fieldingRadarChart) {
      this.fieldingRadarChart.destroy();
      this.fieldingRadarChart = null;
    }

    const f = this.fieldingScouting;
    if (!f) return;

    let categories: string[];
    let dataVals: number[];

    switch (this.fieldingTab) {
      case 'catcher':
        categories = ['Blocking', 'Framing', 'Arm'];
        dataVals = [parseInt(f.cBlock, 10) || 50, parseInt(f.cFrm, 10) || 50, parseInt(f.cArm, 10) || 50];
        break;
      case 'outfield':
        categories = ['OF Range', 'OF Arm', 'OF Error'];
        dataVals = [parseInt(f.ofRange, 10) || 50, parseInt(f.ofArm, 10) || 50, parseInt(f.ofErr, 10) || 50];
        break;
      case 'infield':
      default:
        categories = ['IF Range', 'IF Arm', 'IF Error', 'Turn DP'];
        dataVals = [parseInt(f.ifRange, 10) || 50, parseInt(f.ifArm, 10) || 50, parseInt(f.ifErr, 10) || 50, parseInt(f.ifDP, 10) || 50];
        break;
    }

    // Render axis labels with values
    const labelContainer = this.overlay?.querySelector('.fielding-axis-labels');
    if (labelContainer) {
      // Position labels around the chart based on axis count
      const isQuad = categories.length === 4;
      const positions = isQuad ? ['top', 'right', 'bottom', 'left'] : ['top', 'lower-right', 'lower-left'];
      labelContainer.innerHTML = categories.map((cat, i) => `
        <div class="fielding-axis-label fielding-axis-${positions[i]}">
          <span class="radar-axis-name">${cat}</span>
          <span class="radar-axis-badge radar-badge-fielding">${dataVals[i]}</span>
        </div>
      `).join('');
    }

    const series: RadarChartSeries[] = [{
      name: 'Fielding',
      data: dataVals,
      color: '#22c55e',
    }];

    this.fieldingRadarChart = new RadarChart({
      containerId: `batter-fielding-radar-chart-${this.instanceId}`,
      categories,
      series,
      height: 148,
      radarSize: 58,
      min: 20,
      max: 85,
      legendPosition: 'top',
      showLegend: false,
      offsetX: 0,
      offsetY: 0,
    });
    this.fieldingRadarChart.render();
  }

  private renderProjectionContent(data: BatterProfileData, stats: BatterSeasonStats[]): string {
    // Compute projection via pure function
    const proj = computeBatterProjection(data, stats, {
      projectionMode: this.projectionMode,
      projectionYear: this.projectionYear,
      leagueAvg: this.leagueAvg,
      scoutingData: this.scoutingData ? {
        injuryProneness: this.scoutingData.injuryProneness,
        stealingAggressiveness: this.scoutingData.stealingAggressiveness,
        stealingAbility: this.scoutingData.stealingAbility,
      } : null,
      expectedBbPct: (eye) => HitterRatingEstimatorService.expectedBbPct(eye),
      expectedKPct: (avoidK) => HitterRatingEstimatorService.expectedKPct(avoidK),
      expectedAvg: (contact) => HitterRatingEstimatorService.expectedAvg(contact),
      expectedHrPct: (power) => HitterRatingEstimatorService.expectedHrPct(power),
      expectedDoublesRate: (gap) => HitterRatingEstimatorService.expectedDoublesRate(gap),
      expectedTriplesRate: (speed) => HitterRatingEstimatorService.expectedTriplesRate(speed),
      getProjectedPa: (injury, age) => leagueBattingAveragesService.getProjectedPa(injury, age),
      getProjectedPaWithHistory: (history, age, injury) => leagueBattingAveragesService.getProjectedPaWithHistory(history, age, injury),
      calculateOpsPlus: (obp, slg, lg) => leagueBattingAveragesService.calculateOpsPlus(obp, slg, lg),
      computeWoba: (bbRate, avg, d, t, hr) => this.computeWoba(bbRate, avg, d, t, hr),
      calculateBaserunningRuns: (sb, cs) => leagueBattingAveragesService.calculateBaserunningRuns(sb, cs),
      defRuns: data.defRuns ?? 0,
      posAdj: data.posAdj ?? 0,
      parkFactors: data.parkFactors,
      calculateBattingWar: (woba, pa, lg, sbRuns, defR, posA) => leagueBattingAveragesService.calculateBattingWar(woba, pa, lg, sbRuns, defR, posA),
      projectStolenBases: (sr, ste, pa) => HitterRatingEstimatorService.projectStolenBases(sr, ste, pa),
      historicalSbStats: stats
        .filter(s => s.level === 'MLB' && s.pa >= 50)
        .sort((a, b) => b.year - a.year)
        .map(s => ({ sb: s.sb, cs: s.cs, pa: s.pa })),
      applyAgingToRates: (rates, a) => HitterRatingEstimatorService.applyAgingToBlendedRates(rates, hitterAgingService.getAgingModifiers(a)),
    });

    // Note: injury/park adjustments are already baked into the precomputed cache values
    // (data.projPa/projWar set from cache in show()). No manual adjustment needed here.

    // Destructure for template compatibility
    const { projAvg, projObp, projSlg, projBbPct, projKPct, projHrPct,
            projPa, projHr, proj2b, proj3b, projSb, projWar,
            projDefRuns, projPosAdj,
            projOps, projOpsPlus, age, ratingLabel, projNote,
            isPeakMode, showActualComparison, ratings } = proj;

    // Store for WAR badge, chart legend, and chart badge consistency
    this._lastProjectionWar = projWar;
    this._lastProjection = proj;

    // Dev-only: verify displayed values match precomputed cache
    if (!isPeakMode) {
      consistencyChecker.checkBatter(data.playerId, data.playerName,
        { war: projWar, pa: projPa, hr: projHr, sb: projSb }, 'BatterProfileModal');
      // Formula check: independently derive WAR from components
      if (this.leagueAvg && projPa > 0) {
        consistencyChecker.checkBatterWarFormula(data.playerId, data.playerName, {
          displayedWar: projWar,
          projWoba: proj.projWoba,
          projPa: projPa,
          lgWoba: this.leagueAvg.lgWoba,
          wobaScale: this.leagueAvg.wobaScale,
          runsPerWin: this.leagueAvg.runsPerWin,
          sbRuns: proj.projSbRuns,
          defRuns: projDefRuns,
          posAdj: projPosAdj,
        }, 'BatterProfileModal');
      }
    }

    const showToggle = data.hasTfrUpside === true && data.trueRating !== undefined;
    const latestStat = showActualComparison ? stats.find(s => s.level === 'MLB' && s.year === this.projectionYear) : undefined;
    const lgObp = this.leagueAvg?.lgObp ?? 0.320;
    const lgSlg = this.leagueAvg?.lgSlg ?? 0.400;
    const hasSrSte = (this.scoutingData?.stealingAggressiveness !== undefined) || (data.scoutSR !== undefined);

    const formatStat = (val: number, decimals: number = 3) => val.toFixed(decimals);
    const formatPct = (val: number) => val.toFixed(1) + '%';

    // Prepare Flip Cards
    const contactRating = this.clampRatingForDisplay(ratings.contact);
    const eyeRating = this.clampRatingForDisplay(ratings.eye);
    const avoidKRating = this.clampRatingForDisplay(ratings.avoidK);
    const powerRating = this.clampRatingForDisplay(ratings.power);
    const gapRating = this.clampRatingForDisplay(ratings.gap);
    const speedRating = this.clampRatingForDisplay(ratings.speed);

    const avgFlip = this.renderFlipCell(formatStat(projAvg), contactRating.toString(), `${ratingLabel} Contact`);
    const bbPctFlip = this.renderFlipCell(formatPct(projBbPct), eyeRating.toString(), `${ratingLabel} Eye`);
    const kPctFlip = this.renderFlipCell(formatPct(projKPct), avoidKRating.toString(), `${ratingLabel} Avoid K`);
    const hrPctFlip = this.renderFlipCell(formatPct(projHrPct), powerRating.toString(), `${ratingLabel} Power`);
    const doublesFlip = this.renderFlipCell(proj2b.toString(), gapRating.toString(), `${ratingLabel} Gap`);
    const triplesFlip = this.renderFlipCell(proj3b.toString(), speedRating.toString(), `${ratingLabel} Speed`);

    const steRating = this.scoutingData?.stealingAbility ?? data.scoutSTE;
    const sbFlip = hasSrSte && projSb !== undefined && steRating !== undefined
      ? this.renderFlipCell(projSb.toString(), this.clampRatingForDisplay(steRating).toString(), `${ratingLabel} SB Ability`)
      : hasSrSte ? projSb?.toString() ?? '—' : '—';

    // Show comparison to actual if we have stats (not in peak mode)
    let comparisonRow = '';
    if (latestStat) {
      const actualBbPct = latestStat.pa > 0 ? (latestStat.bb / latestStat.pa) * 100 : 0;
      const actualKPct = latestStat.pa > 0 ? (latestStat.k / latestStat.pa) * 100 : 0;
      const actualHrPct = latestStat.pa > 0 ? (latestStat.hr / latestStat.pa) * 100 : 0;
      const actualOps = latestStat.obp + latestStat.slg;
      const actualOpsPlus = this.leagueAvg
        ? leagueBattingAveragesService.calculateOpsPlus(latestStat.obp, latestStat.slg, this.leagueAvg)
        : Math.round(100 * ((latestStat.obp / lgObp) + (latestStat.slg / lgSlg) - 1));

      // Compute actual wOBA from counting stats
      const actualAb = latestStat.pa * 0.88;
      const actualH = latestStat.avg * actualAb;
      const actualSingles = Math.max(0, actualH - (latestStat.d ?? 0) - (latestStat.t ?? 0) - latestStat.hr);
      const actualWoba = latestStat.pa > 0
        ? (0.69 * latestStat.bb + 0.89 * actualSingles + 1.27 * (latestStat.d ?? 0) + 1.62 * (latestStat.t ?? 0) + 2.10 * latestStat.hr) / latestStat.pa
        : 0.320;
      const actualSbRuns = leagueBattingAveragesService.calculateBaserunningRuns(latestStat.sb, latestStat.cs);
      let actualWar: number;
      if (this.leagueAvg) {
        actualWar = leagueBattingAveragesService.calculateBattingWar(actualWoba, latestStat.pa, this.leagueAvg, actualSbRuns);
      } else {
        const fallbackAvg: LeagueBattingAverages = { year: 0, lgObp: 0.320, lgSlg: 0.400, lgWoba: 0.320, lgRpa: 0.115, wobaScale: 1.15, runsPerWin: 10, totalPa: 0, totalRuns: 0 };
        actualWar = leagueBattingAveragesService.calculateBattingWar(actualWoba, latestStat.pa, fallbackAvg, actualSbRuns);
      }

      comparisonRow = `
        <tr class="actual-row">
          <td>Actual</td>
          <td>${latestStat.pa}</td>
          <td>${formatStat(latestStat.avg)}</td>
          <td>${formatStat(latestStat.obp)}</td>
          <td>${formatPct(actualBbPct)}</td>
          <td>${formatPct(actualKPct)}</td>
          <td>${formatPct(actualHrPct)}</td>
          <td>${latestStat.bb}</td>
          <td>${latestStat.k}</td>
          <td>${latestStat.hr}</td>
          <td>${latestStat.d ?? '—'}</td>
          <td>${latestStat.t ?? '—'}</td>
          <td>${latestStat.sb}</td>
          <td>${formatStat(latestStat.slg)}</td>
          <td>${formatStat(actualOps)}</td>
          <td>${actualOpsPlus}</td>
          <td>—</td>
          <td>${formatStat(actualWar, 1)}</td>
        </tr>
      `;
    }

    // Projection label
    const isProspect = data.isProspect === true;
    let projectionLabel: string;
    if (isPeakMode) {
      projectionLabel = 'Peak Projection <span class="projection-age">(27yo)</span>';
    } else if (isProspect) {
      projectionLabel = 'Peak Projection <span class="projection-age">(27yo)</span>';
    } else {
      projectionLabel = `${this.projectionYear} Projection <span class="projection-age">(${age}yo)</span>`;
    }

    // Toggle HTML (Current/Peak inside Projected pane)
    const toggleHtml = showToggle ? `
      <div class="projection-toggle">
        <button class="projection-toggle-btn ${this.projectionMode === 'current' ? 'active' : ''}" data-mode="current">Current</button>
        <button class="projection-toggle-btn ${this.projectionMode === 'peak' ? 'active' : ''}" data-mode="peak">Peak</button>
      </div>
    ` : '';

    return `
      <div class="projection-section">
        <div class="projection-header-row">
          <h4 class="section-label">${projectionLabel}</h4>
          ${toggleHtml}
        </div>
        <div class="stats-table-scroll">
          <table class="profile-stats-table projection-table" style="table-layout: fixed;">
            <thead>
              <tr>
                <th style="width: 68px;"></th>
                <th style="width: 42px;">PA</th>
                <th style="width: 52px;">AVG</th>
                <th style="width: 52px;">OBP</th>
                <th style="width: 50px;">BB%</th>
                <th style="width: 50px;">K%</th>
                <th style="width: 50px;">HR%</th>
                <th style="width: 38px;">BB</th>
                <th style="width: 38px;">K</th>
                <th style="width: 38px;">HR</th>
                <th style="width: 38px;">2B</th>
                <th style="width: 38px;">3B</th>
                <th style="width: 38px;">SB</th>
                <th style="width: 52px;">SLG</th>
                <th style="width: 52px;">OPS</th>
                <th style="width: 44px;">OPS+</th>
                <th style="width: 44px;">Def</th>
                <th style="width: 44px;">WAR</th>
              </tr>
            </thead>
            <tbody>
              <tr class="projection-row">
                <td><strong>Proj</strong></td>
                <td>${projPa}</td>
                <td>${avgFlip}</td>
                <td>${formatStat(projObp)}</td>
                <td>${bbPctFlip}</td>
                <td>${kPctFlip}</td>
                <td>${hrPctFlip}</td>
                <td>${Math.round(projPa * projBbPct / 100)}</td>
                <td>${Math.round(projPa * projKPct / 100)}</td>
                <td>${projHr}</td>
                <td>${doublesFlip}</td>
                <td>${triplesFlip}</td>
                <td>${sbFlip}</td>
                <td>${formatStat(projSlg)}</td>
                <td>${formatStat(projOps)}</td>
                <td><strong>${projOpsPlus}</strong></td>
                <td title="Fielding: ${(projDefRuns ?? 0) >= 0 ? '+' : ''}${(projDefRuns ?? 0).toFixed(1)}, Pos: ${(projPosAdj ?? 0) >= 0 ? '+' : ''}${(projPosAdj ?? 0).toFixed(1)}">${((projDefRuns ?? 0) + (projPosAdj ?? 0)) >= 0 ? '+' : ''}${((projDefRuns ?? 0) + (projPosAdj ?? 0)).toFixed(1)}</td>
                <td><strong>${formatStat(projWar, 1)}</strong></td>
              </tr>
              ${comparisonRow}
            </tbody>
          </table>
        </div>
        <p class="projection-note">${projNote}</p>
      </div>
    `;
  }

  private renderCareerStatsContent(stats: BatterSeasonStats[]): string {
    // League averages for OPS+ calculation (dynamic with fallback)
    const lgObp = this.leagueAvg?.lgObp ?? 0.320;
    const lgSlg = this.leagueAvg?.lgSlg ?? 0.400;

    if (stats.length === 0) {
      return `<p class="no-stats">No batting stats found for this player.</p>`;
    }

    // Build projection row from cached projection (rendered before career stats)
    const p = this._lastProjection;
    let projRow = '';
    if (p && p.projPa > 0) {
      const projBb = Math.round(p.projPa * (p.projBbPct / 100));
      const projK = Math.round(p.projPa * (p.projKPct / 100));
      const projCs = p.projCs ?? Math.round((p.projSb ?? 0) * 0.25);
      projRow = `
        <tr class="projection-row">
          <td style="text-align: center; font-weight: 600;" title="True Projection">TP</td>
          <td style="text-align: center;"><span class="level-badge level-mlb" style="opacity: 0.7;">PROJ</span></td>
          <td style="text-align: center;">${p.projPa}</td>
          <td style="text-align: center;">${p.projAvg.toFixed(3)}</td>
          <td style="text-align: center;">${p.projObp.toFixed(3)}</td>
          <td style="text-align: center;">${p.projBbPct.toFixed(1)}%</td>
          <td style="text-align: center;">${p.projKPct.toFixed(1)}%</td>
          <td style="text-align: center;">${p.projHrPct.toFixed(1)}%</td>
          <td style="text-align: center;">${projBb}</td>
          <td style="text-align: center;">${projK}</td>
          <td style="text-align: center;">${p.projHr}</td>
          <td style="text-align: center;">${p.projSb ?? 0}</td>
          <td style="text-align: center;">${projCs}</td>
          <td style="text-align: center;">${p.projSlg.toFixed(3)}</td>
          <td style="text-align: center;">${p.projOps.toFixed(3)}</td>
          <td style="text-align: center;">${p.projOpsPlus}</td>
          <td style="text-align: center;">${p.projWar.toFixed(1)}</td>
        </tr>
      `;
    }

    const rows = stats.slice(0, 10).map(s => {
      const levelBadge = s.level === 'MLB'
        ? '<span class="level-badge level-mlb">MLB</span>'
        : `<span class="level-badge level-${s.level.toLowerCase()}">${s.level.toUpperCase()}</span>`;
      const isMinor = s.level !== 'MLB';
      const warCell = isMinor ? '<td class="stat-na">—</td>' : `<td style="text-align: center;">${(s.war ?? 0).toFixed(1)}</td>`;

      // Calculate rate stats
      const bbPct = s.pa > 0 ? (s.bb / s.pa) * 100 : 0;
      const kPct = s.pa > 0 ? (s.k / s.pa) * 100 : 0;
      const hrPct = s.pa > 0 ? (s.hr / s.pa) * 100 : 0;
      const ops = s.obp + s.slg;
      const opsPlus = Math.round(100 * ((s.obp / lgObp) + (s.slg / lgSlg) - 1));

      // Estimate ratings
      const estContact = HitterRatingEstimatorService.estimateContact(s.avg, s.pa).rating;
      const estEye = HitterRatingEstimatorService.estimateEye(bbPct, s.pa).rating;
      const estPower = HitterRatingEstimatorService.estimatePower(hrPct, s.pa).rating;

      // Flip cells
      const avgFlip = this.renderFlipCell(s.avg.toFixed(3), this.clampRatingForDisplay(estContact).toString(), `Estimated Contact (${s.year})`);
      const bbPctFlip = this.renderFlipCell(bbPct.toFixed(1) + '%', this.clampRatingForDisplay(estEye).toString(), `Estimated Eye (${s.year})`);
      const kPctDisplay = kPct.toFixed(1) + '%';
      const hrPctFlip = this.renderFlipCell(hrPct.toFixed(1) + '%', this.clampRatingForDisplay(estPower).toString(), `Estimated Power (${s.year})`);

      return `
        <tr>
          <td style="text-align: center;">${s.year}</td>
          <td style="text-align: center;">${levelBadge}</td>
          <td style="text-align: center;">${s.pa}</td>
          <td style="text-align: center;">${avgFlip}</td>
          <td style="text-align: center;">${s.obp.toFixed(3)}</td>
          <td style="text-align: center;">${bbPctFlip}</td>
          <td style="text-align: center;">${kPctDisplay}</td>
          <td style="text-align: center;">${hrPctFlip}</td>
          <td style="text-align: center;">${s.bb}</td>
          <td style="text-align: center;">${s.k}</td>
          <td style="text-align: center;">${s.hr}</td>
          <td style="text-align: center;">${s.sb}</td>
          <td style="text-align: center;">${s.cs}</td>
          <td style="text-align: center;">${s.slg.toFixed(3)}</td>
          <td style="text-align: center;">${ops.toFixed(3)}</td>
          <td style="text-align: center;">${opsPlus}</td>
          ${warCell}
        </tr>
      `;
    }).join('');

    return `
      <div class="stats-table-scroll">
        <table class="profile-stats-table" style="table-layout: fixed;">
          <thead>
            <tr>
              <th style="width: 43px; text-align: center;">Year</th>
              <th style="width: 43px; text-align: center;">Level</th>
              <th style="width: 48px; text-align: center;">PA</th>
              <th style="width: 58px; text-align: center;">AVG</th>
              <th style="width: 58px; text-align: center;">OBP</th>
              <th style="width: 58px; text-align: center;">BB%</th>
              <th style="width: 58px; text-align: center;">K%</th>
              <th style="width: 58px; text-align: center;">HR%</th>
              <th style="width: 48px; text-align: center;">BB</th>
              <th style="width: 48px; text-align: center;">K</th>
              <th style="width: 48px; text-align: center;">HR</th>
              <th style="width: 38px; text-align: center;">SB</th>
              <th style="width: 38px; text-align: center;">CS</th>
              <th style="width: 58px; text-align: center;">SLG</th>
              <th style="width: 58px; text-align: center;">OPS</th>
              <th style="width: 48px; text-align: center;">OPS+</th>
              <th style="width: 48px; text-align: center;">WAR</th>
            </tr>
          </thead>
          <tbody>
            ${projRow}${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── Development Tab ──────────────────────────────────────────────────

  private renderDevelopmentTab(playerId: number): string {
    const isProspect = this.currentData?.isProspect === true;
    const dataMode: 'true' | 'tfr' = isProspect ? 'tfr' : 'true';

    // Reset dev mode on new player
    this.devMode = 'ratings';
    this.cachedRatingSnapshots = null;
    this.cachedStatSnapshots = null;
    this.savedRatingMetrics = null;
    this.savedStatMetrics = null;

    // Set default active metrics based on player type
    this.activeDevMetrics = ['truePower', 'trueEye', 'trueAvoidK'];

    const title = isProspect ? 'TFR Development History' : 'True Rating History';

    // MLB batters get Ratings/Stats toggle
    const devModeToggle = !isProspect ? `
      <div class="dev-mode-toggle">
        <button class="dev-mode-btn active" data-dev-mode="ratings">Ratings</button>
        <button class="dev-mode-btn" data-dev-mode="stats">Stats</button>
      </div>
    ` : '';

    return `
      <div class="development-section">
        <div class="development-header">
          <h4>${title}</h4>
          ${devModeToggle}
          <span class="snapshot-count" id="dev-snapshot-count">Loading...</span>
        </div>
        <div class="development-toggles-container">
          ${renderMetricToggles(this.activeDevMetrics, 'hitter', dataMode)}
        </div>
        <div class="development-chart-container" id="development-chart-${this.instanceId}-${playerId}"></div>
      </div>
    `;
  }

  private async initDevelopmentChart(playerId: number): Promise<void> {
    // Clean up existing chart
    if (this.developmentChart) {
      this.developmentChart.destroy();
      this.developmentChart = null;
    }

    const isProspect = this.currentData?.isProspect === true;
    let snapshots: DevelopmentSnapshotRecord[];

    if (!isProspect) {
      // MLB batter: calculate historical True Ratings from stats
      snapshots = await trueRatingsService.calculateHistoricalBatterTR(playerId);
      this.cachedRatingSnapshots = snapshots;
    } else {
      // Prospect batter: calculate historical TFR from scouting snapshots
      snapshots = await trueRatingsService.calculateHistoricalHitterTFR(playerId);
    }

    // Update snapshot count
    const countEl = this.overlay?.querySelector('#dev-snapshot-count');
    if (countEl) {
      const label = isProspect ? 'snapshot' : 'season';
      countEl.textContent = `${snapshots.length} ${label}${snapshots.length !== 1 ? 's' : ''}`;
    }

    // Create and render chart
    this.developmentChart = new DevelopmentChart({
      containerId: `development-chart-${this.instanceId}-${playerId}`,
      snapshots,
      metrics: this.activeDevMetrics,
      height: 280,
      yearOnly: !isProspect,
    });
    this.developmentChart.render();

    // Bind metric toggle handlers
    const container = this.overlay?.querySelector('.development-section');
    if (container) {
      bindMetricToggleHandlers(container as HTMLElement, (metric, enabled) => {
        this.activeDevMetrics = applyExclusiveMetricToggle(
          container as HTMLElement, this.activeDevMetrics, metric, enabled
        );
        this.developmentChart?.updateMetrics(this.activeDevMetrics);
      });
    }

    // Bind dev mode toggle (Ratings/Stats) for MLB batters
    if (!isProspect) {
      this.bindDevModeToggle(playerId);
    }
  }

  private bindDevModeToggle(playerId: number): void {
    const buttons = this.overlay?.querySelectorAll<HTMLButtonElement>('.dev-mode-btn');
    if (!buttons || buttons.length === 0) return;

    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const newMode = btn.dataset.devMode as 'ratings' | 'stats';
        if (newMode === this.devMode) return;

        this.devMode = newMode;
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Save current mode's metrics before switching
        if (this.devMode === 'ratings') {
          this.savedRatingMetrics = this.activeDevMetrics;
        } else {
          this.savedStatMetrics = this.activeDevMetrics;
        }

        if (newMode === 'stats') {
          if (!this.cachedStatSnapshots) {
            this.cachedStatSnapshots = await trueRatingsService.getHistoricalBatterStats(playerId);
          }
          this.activeDevMetrics = this.savedStatMetrics || ['statHrPct', 'statBbPct', 'statKPct'];
          this.rerenderDevChart(this.cachedStatSnapshots, 'stats', 'hitter', playerId);
        } else {
          if (!this.cachedRatingSnapshots) {
            this.cachedRatingSnapshots = await trueRatingsService.calculateHistoricalBatterTR(playerId);
          }
          this.activeDevMetrics = this.savedRatingMetrics || ['truePower', 'trueEye', 'trueAvoidK'];
          this.rerenderDevChart(this.cachedRatingSnapshots, 'true', 'hitter', playerId);
        }
      });
    });
  }

  private rerenderDevChart(
    snapshots: DevelopmentSnapshotRecord[],
    dataMode: 'true' | 'tfr' | 'stats',
    playerType: 'pitcher' | 'hitter',
    playerId: number
  ): void {
    // Update toggles HTML
    const togglesContainer = this.overlay?.querySelector('.development-toggles-container');
    if (togglesContainer) {
      togglesContainer.innerHTML = renderMetricToggles(this.activeDevMetrics, playerType, dataMode);
      bindMetricToggleHandlers(togglesContainer as HTMLElement, (metric, enabled) => {
        this.activeDevMetrics = applyExclusiveMetricToggle(
          togglesContainer as HTMLElement, this.activeDevMetrics, metric, enabled
        );
        this.developmentChart?.updateMetrics(this.activeDevMetrics);
      });
    }

    // Update snapshot count
    const countEl = this.overlay?.querySelector('#dev-snapshot-count');
    if (countEl) {
      countEl.textContent = `${snapshots.length} season${snapshots.length !== 1 ? 's' : ''}`;
    }

    // Destroy and recreate chart with new data
    if (this.developmentChart) {
      this.developmentChart.destroy();
      this.developmentChart = null;
    }
    this.developmentChart = new DevelopmentChart({
      containerId: `development-chart-${this.instanceId}-${playerId}`,
      snapshots,
      metrics: this.activeDevMetrics,
      height: 280,
      yearOnly: true,
    });
    this.developmentChart.render();
  }

  // ─── Shared Utilities ─────────────────────────────────────────────────

  private renderFlipCell(front: string, back: string, title: string): string {
    return `
      <div class="flip-cell" style="margin: 0 auto; width: 100%;">
        <div class="flip-cell-inner">
          <div class="flip-cell-front" style="justify-content: center;">${front}</div>
          <div class="flip-cell-back">
            ${back}
            <span class="flip-tooltip">${title}</span>
          </div>
        </div>
      </div>
    `;
  }

  private clampRatingForDisplay(rating: number): number {
    return Math.max(20, Math.min(80, Math.round(rating)));
  }

  /** Toggle visibility of rating number badges based on which legend series are hidden */
  private updateAxisBadgeVisibility(): void {
    if (!this.overlay) return;

    const badgeMap: Record<string, string> = {
      'True Rating': 'radar-badge-true',
      'True Future Rating': 'radar-badge-tfr',
    };
    // Add only the active scout series name — both map to the same badge class,
    // so including both causes the non-hidden entry to overwrite the hidden one
    const scoutSeriesName = this.scoutingIsOsa ? 'OSA Scout' : 'My Scout';
    badgeMap[scoutSeriesName] = 'radar-badge-scout';

    for (const [seriesName, badgeClass] of Object.entries(badgeMap)) {
      const isHidden = this.hiddenSeries.has(seriesName);
      const badges = this.overlay.querySelectorAll<HTMLElement>(`.ratings-section .${badgeClass}`);
      badges.forEach(badge => {
        badge.style.display = isHidden ? 'none' : '';
      });
    }

    // Projection badges (both hitting and running charts)
    const projHidden = this.hiddenSeries.has('Stat Projections');
    const projBadges = this.overlay.querySelectorAll<HTMLElement>('.radar-proj-badge');
    projBadges.forEach(badge => {
      badge.style.display = projHidden ? 'none' : '';
    });
  }

  /** Wire up the inline legend dots as series toggles */
  private bindLegendToggle(): void {
    const items = this.overlay?.querySelectorAll<HTMLElement>('.legend-item[data-series]');
    if (!items) return;

    // Apply initial state (e.g. if hiddenSeries carried over from previous show)
    items.forEach(item => {
      const series = item.dataset.series!;
      const resolvedName = series === 'scout'
        ? (this.scoutingIsOsa ? 'OSA Scout' : 'My Scout')
        : series;
      if (this.hiddenSeries.has(resolvedName)) {
        item.classList.add('legend-inactive');
      }
    });

    items.forEach(item => {
      item.addEventListener('click', () => {
        const series = item.dataset.series!;
        // "scout" resolves to the active scout source name
        const resolvedName = series === 'scout'
          ? (this.scoutingIsOsa ? 'OSA Scout' : 'My Scout')
          : series;

        if (this.hiddenSeries.has(resolvedName)) {
          this.hiddenSeries.delete(resolvedName);
          item.classList.remove('legend-inactive');
        } else {
          this.hiddenSeries.add(resolvedName);
          item.classList.add('legend-inactive');
        }

        // Re-render chart from scratch with only visible series
        // (ApexCharts hideSeries/showSeries/toggleSeries are unreliable)
        if (series !== 'Stat Projections' && this.currentData) {
          this.initRadarChart(this.currentData);
        }
        this.updateAxisBadgeVisibility();
      });
    });
  }

  // ─── Event Binding ────────────────────────────────────────────────────

  private bindActionButtons(): void {
    const shareBtn = this.overlay?.querySelector<HTMLButtonElement>('.modal-action-btn[data-action="share"]');
    const tradeBtn = this.overlay?.querySelector<HTMLButtonElement>('.modal-action-btn[data-action="trade"]');
    const parkBtn = this.overlay?.querySelector<HTMLButtonElement>('.modal-action-btn[data-action="park"]');

    parkBtn?.addEventListener('click', () => {
      const teamId = parkBtn.dataset.teamId;
      if (teamId) {
        this.hide();
        window.dispatchEvent(new CustomEvent('wbl:open-parks', { detail: { teamId: parseInt(teamId, 10) } }));
      }
    });

    shareBtn?.addEventListener('click', () => {
      if (!this.currentData) return;
      const shareUrl = getRouter().playerUrl(this.currentData.playerId);
      navigator.clipboard.writeText(shareUrl).then(() => {
        shareBtn.classList.add('action-success');
        shareBtn.title = 'Copied!';
        setTimeout(() => {
          shareBtn.classList.remove('action-success');
          shareBtn.title = 'Copy link to clipboard';
        }, 1500);
      });
    });

    tradeBtn?.addEventListener('click', async () => {
      if (!this.currentData) return;
      const player = await playerService.getPlayerById(this.currentData.playerId);
      const playerTeamId = player?.teamId ?? 0;
      const savedTeamId = parseInt(localStorage.getItem('wbl-selected-team') ?? '0', 10);
      const isProspect = this.currentData.isProspect === true;
      const playerId = this.currentData.playerId;
      this.hide();
      if (savedTeamId > 0 && savedTeamId !== playerTeamId) {
        // Different saved team: my team on side 1, player on side 2
        window.dispatchEvent(new CustomEvent('wbl:open-trade-analyzer', {
          detail: { myTeamId: savedTeamId, targetTeamId: playerTeamId, targetPlayerId: playerId, targetIsProspect: isProspect },
        }));
      } else {
        // Same team or no saved team: player's team on side 1, player on side 1
        window.dispatchEvent(new CustomEvent('wbl:open-trade-analyzer', {
          detail: { myTeamId: playerTeamId, targetTeamId: 0, targetPlayerId: playerId, targetIsProspect: isProspect },
        }));
      }
    });
  }

  private bindBodyEvents(): void {
    this.bindScoutSourceToggle();
    this.bindTabSwitching();
    this.bindProjectionToggle();
    this.bindAnalysisToggle();
    this.bindActionButtons();
    // Bind flip cards in pre-rendered projection content
    const flipCells = this.overlay?.querySelectorAll<HTMLElement>('.projection-section .flip-cell');
    flipCells?.forEach(cell => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        cell.classList.toggle('is-flipped');
      });
    });
    this.initRadarChart(this.currentData!);
    this.initRunningRadarChart(this.currentData!);
    this.initFieldingRadarChart();
    this.bindFieldingTabEvents();
    this.bindLegendToggle();
    this.lockTabContentHeight();

    // Auto-fetch analysis if it's the default view (skip for retired players)
    if (this.viewMode === 'analysis' && !this.cachedAnalysisHtml && !this.currentData?.retired) {
      this.fetchAndRenderAnalysis();
    }
  }

  /** Measure all tab panes and set min-height to the tallest, preventing layout shift on tab switch */
  private lockTabContentHeight(): void {
    const container = this.overlay?.querySelector<HTMLElement>('.profile-tab-content');
    const panes = this.overlay?.querySelectorAll<HTMLElement>('.tab-pane');
    if (!container || !panes || panes.length === 0) return;

    // Temporarily show all panes to measure them
    const originalDisplay: string[] = [];
    panes.forEach((pane, i) => {
      originalDisplay[i] = pane.style.display;
      pane.style.display = 'block';
      pane.style.visibility = 'hidden';
      pane.style.position = 'absolute';
      pane.style.width = '100%';
    });

    let maxHeight = 0;
    panes.forEach(pane => {
      maxHeight = Math.max(maxHeight, pane.scrollHeight);
    });

    // Restore original state
    panes.forEach((pane, i) => {
      pane.style.display = originalDisplay[i];
      pane.style.visibility = '';
      pane.style.position = '';
      pane.style.width = '';
    });

    if (maxHeight > 0) {
      container.style.minHeight = `${maxHeight}px`;
    }
  }

  private bindTabSwitching(): void {
    const tabs = this.overlay?.querySelectorAll<HTMLButtonElement>('.profile-tab');
    tabs?.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        if (!targetTab || tab.disabled) return;

        // Update tab buttons
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update tab panes
        const panes = this.overlay?.querySelectorAll<HTMLElement>('.tab-pane');
        panes?.forEach(pane => {
          if (pane.dataset.pane === targetTab) {
            pane.classList.add('active');
            // Initialize development chart when switching to that tab
            if (targetTab === 'development' && this.currentData) {
              this.initDevelopmentChart(this.currentData.playerId);
            }
          } else {
            pane.classList.remove('active');
          }
        });
      });
    });
  }

  private bindProjectionToggle(): void {
    if (!this.overlay || !this.currentData) return;
    const buttons = this.overlay.querySelectorAll<HTMLButtonElement>('.projection-toggle-btn');
    if (buttons.length === 0) return;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode as 'current' | 'peak';
        if (!newMode || newMode === this.projectionMode) return;

        this.projectionMode = newMode;

        if (!this.currentData) return;

        // Re-render projection section (updates _lastProjection and _lastProjectionWar)
        const projSection = this.overlay?.querySelector('.projection-section');
        if (projSection) {
          projSection.outerHTML = this.renderProjectionContent(this.currentData, this.currentStats);
          this.bindProjectionToggle();
          const flipCells = this.overlay?.querySelectorAll<HTMLElement>('.projection-section .flip-cell');
          flipCells?.forEach(cell => {
            cell.addEventListener('click', (e) => {
              e.stopPropagation();
              cell.classList.toggle('is-flipped');
            });
          });
        }

        // Re-render ratings section (radar badges read from updated _lastProjection)
        const ratingsSection = this.overlay?.querySelector('.ratings-section');
        if (ratingsSection) {
          ratingsSection.outerHTML = this.renderRatingsSection(this.currentData);
          this.bindLegendToggle();
          this.initRadarChart(this.currentData);
          this.initRunningRadarChart(this.currentData);
          this.initFieldingRadarChart();
          this.bindFieldingTabEvents();
        }

        // Re-render WAR badge
        const warSlot = this.overlay?.querySelector('.war-header-slot');
        if (warSlot) warSlot.innerHTML = this.renderWarEmblem(this.currentData);
      });
    });
  }

  private renderAnalysisLoading(): string {
    return `
      <div class="analysis-loading">
        <span class="analysis-loading-text">Scouting Player...</span>
      </div>
    `;
  }

  private renderAnalysisBlurb(text: string): string {
    return `<div class="analysis-blurb">${markdownToHtml(text)}</div>`;
  }

  private buildAIScoutingData(): AIScoutingPlayerData | null {
    const data = this.currentData;
    if (!data) return null;

    // Compute projections from canonical blended rates so the AI prompt
    // is consistent regardless of which view opened the modal.
    const projWar = this.calculateProjWar(data);
    const projPa = data.projPa;
    let projHr = data.projHr;
    let projSb = data.projSb;
    let projObp = data.projObp;
    let projSlg = data.projSlg;

    // Derive missing projections from canonical blended rates
    if (projHr === undefined && data.projHrPct !== undefined && projPa !== undefined) {
      projHr = Math.round(projPa * (data.projHrPct / 100));
    }
    if (projSb === undefined) {
      const s = this.scoutingData;
      const sr = s?.stealingAggressiveness ?? data.scoutSR;
      const ste = s?.stealingAbility ?? data.scoutSTE;
      if (sr !== undefined && ste !== undefined && projPa !== undefined) {
        projSb = Math.round(HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa).sb);
      }
    }
    if (projObp === undefined && data.projAvg !== undefined && data.projBbPct !== undefined) {
      projObp = Math.min(0.450, data.projAvg + (data.projBbPct / 100) * (1 - data.projAvg));
    }
    if (projSlg === undefined && data.projAvg !== undefined && data.projHrPct !== undefined) {
      const hrPerAb = (data.projHrPct / 100) / 0.88;
      const doublesPerAb = data.projDoublesRate ?? 0.04;
      const triplesPerAb = data.projTriplesRate ?? 0.005;
      const iso = hrPerAb * 3 + doublesPerAb + triplesPerAb * 2;
      projSlg = data.projAvg + iso;
    }

    return {
      playerName: data.playerName,
      age: data.age,
      position: data.positionLabel,
      positionNum: data.position,
      team: data.team,
      parentOrg: data.parentTeam || data.team,
      injuryProneness: this.scoutingData?.injuryProneness ?? data.injuryProneness,
      scoutPower: this.scoutingData?.power ?? data.scoutPower,
      scoutEye: this.scoutingData?.eye ?? data.scoutEye,
      scoutAvoidK: this.scoutingData?.avoidK ?? data.scoutAvoidK,
      scoutContact: this.scoutingData?.contact ?? data.scoutContact,
      scoutGap: this.scoutingData?.gap ?? data.scoutGap,
      scoutSpeed: this.scoutingData?.speed ?? data.scoutSpeed,
      scoutStealAbility: this.scoutingData?.stealingAbility,
      scoutStealAggression: this.scoutingData?.stealingAggressiveness,
      scoutOvr: data.scoutOvr,
      scoutPot: data.scoutPot,
      trueRating: data.trueRating,
      trueFutureRating: data.trueFutureRating,
      estimatedPower: data.estimatedPower,
      estimatedEye: data.estimatedEye,
      estimatedAvoidK: data.estimatedAvoidK,
      estimatedContact: data.estimatedContact,
      projAvg: data.projAvg,
      projObp,
      projSlg,
      projHr,
      projSb,
      projPa,
      projWar,
      projBbPct: data.projBbPct,
      projKPct: data.projKPct,
      // Personality
      leadership: this.scoutingData?.leadership,
      loyalty: this.scoutingData?.loyalty,
      adaptability: this.scoutingData?.adaptability,
      greed: this.scoutingData?.greed,
      workEthic: this.scoutingData?.workEthic,
      intelligence: this.scoutingData?.intelligence,
      // Contract
      ...this.buildContractContext(),
    };
  }

  private buildContractContext(): Pick<AIScoutingPlayerData, 'contractSalary' | 'contractYears' | 'contractClauses'> {
    if (!this.contract || this.contract.years === 0) return {};
    const c = this.contract;
    const currentSalary = c.salaries[c.currentYear] ?? 0;
    const clauses: string[] = [];
    if (c.noTrade) clauses.push('No Trade Clause');
    if (c.lastYearTeamOption) clauses.push('Team Option (final year)');
    if (c.lastYearPlayerOption) clauses.push('Player Option (final year)');
    if (c.lastYearVestingOption) clauses.push('Vesting Option (final year)');
    let contractSalary: string;
    let contractYears: string;
    if (currentSalary === 0 || currentSalary === 228_000) {
      contractSalary = 'League Minimum';
      contractYears = 'Pre-arbitration';
    } else if (c.years === 1) {
      contractSalary = this.formatSalary(currentSalary);
      contractYears = 'Arbitration';
    } else {
      contractSalary = this.formatSalary(currentSalary);
      contractYears = `Year ${c.currentYear + 1} of ${c.years}`;
    }
    return {
      contractSalary,
      contractYears,
      contractClauses: clauses.length > 0 ? clauses.join(', ') : undefined,
    };
  }

  private async fetchAndRenderAnalysis(): Promise<void> {
    const analysisPane = this.overlay?.querySelector('.analysis-pane');
    if (!analysisPane || !this.currentData) return;

    try {
      const aiData = this.buildAIScoutingData();
      if (aiData) {
        const blurb = await aiScoutingService.getAnalysis(this.currentData.playerId, 'hitter', aiData);
        this.cachedAnalysisHtml = this.renderAnalysisBlurb(blurb);
        analysisPane.innerHTML = this.cachedAnalysisHtml;
      }
    } catch (err) {
      console.error('Failed to generate analysis:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      analysisPane.innerHTML = `<div class="analysis-blurb"><p class="analysis-error">Failed to generate analysis: ${errorMsg}</p></div>`;
    }
  }

  private bindAnalysisToggle(): void {
    if (!this.overlay || !this.currentData) return;
    const buttons = this.overlay.querySelectorAll<HTMLButtonElement>('.analysis-toggle-btn');
    if (buttons.length === 0) return;

    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const newView = btn.dataset.view as 'projections' | 'career' | 'analysis';
        if (!newView || newView === this.viewMode) return;

        this.viewMode = newView;

        // Update button active states
        buttons.forEach(b => b.classList.toggle('active', b.dataset.view === newView));

        const analysisPane = this.overlay?.querySelector<HTMLElement>('.analysis-pane');
        const projectionsPane = this.overlay?.querySelector<HTMLElement>('.projections-pane');
        const careerPane = this.overlay?.querySelector<HTMLElement>('.career-pane');
        if (!analysisPane || !projectionsPane || !this.currentData) return;

        // Hide all panes, then show the selected one
        analysisPane.style.display = 'none';
        projectionsPane.style.display = 'none';
        if (careerPane) careerPane.style.display = 'none';

        if (newView === 'projections') {
          projectionsPane.style.display = '';
        } else if (newView === 'career') {
          if (careerPane) careerPane.style.display = '';
        } else {
          analysisPane.style.display = '';

          // Fetch analysis if not cached
          if (!this.cachedAnalysisHtml) {
            analysisPane.innerHTML = this.renderAnalysisLoading();

            try {
              const aiData = this.buildAIScoutingData();
              if (aiData) {
                const blurb = await aiScoutingService.getAnalysis(this.currentData.playerId, 'hitter', aiData);
                this.cachedAnalysisHtml = this.renderAnalysisBlurb(blurb);
                analysisPane.innerHTML = this.cachedAnalysisHtml;
              }
            } catch (err) {
              console.error('Failed to generate analysis:', err);
              const errorMsg = err instanceof Error ? err.message : 'Unknown error';
              analysisPane.innerHTML = `<div class="analysis-blurb"><p class="analysis-error">Failed to generate analysis: ${errorMsg}</p></div>`;
            }
          }
        }
      });
    });
  }

  private bindFieldingTabEvents(): void {
    if (!this.overlay) return;
    const buttons = this.overlay.querySelectorAll<HTMLButtonElement>('.fielding-tab-toggle .fielding-tab-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as 'catcher' | 'infield' | 'outfield';
        if (!tab || tab === this.fieldingTab) return;
        this.fieldingTab = tab;
        // Update active state
        buttons.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        // Re-init fielding chart
        this.initFieldingRadarChart();
      });
    });
  }

  private bindScoutSourceToggle(): void {
    if (!this.overlay) return;
    const buttons = this.overlay.querySelectorAll<HTMLButtonElement>('.scout-source-toggle .scout-toggle-btn');
    if (buttons.length === 0) return;

    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        const newSource = btn.dataset.value as 'my' | 'osa';
        if (!newSource) return;

        const wantsOsa = newSource === 'osa';
        if (this.scoutingIsOsa === wantsOsa) return;

        // Switch scouting data source
        if (newSource === 'my' && this.myScoutingData) {
          this.scoutingData = this.myScoutingData;
          this.scoutingIsOsa = false;
        } else if (newSource === 'osa' && this.osaScoutingData) {
          this.scoutingData = this.osaScoutingData;
          this.scoutingIsOsa = true;
        }

        if (!this.currentData) return;

        // Swap TFR fields from tfrBySource when toggling scout source
        const sourceKey = wantsOsa ? 'osa' : 'my';
        const altTfr = this.currentData.tfrBySource?.[sourceKey];
        if (altTfr) {
          this.currentData.tfrPower = altTfr.power;
          this.currentData.tfrEye = altTfr.eye;
          this.currentData.tfrAvoidK = altTfr.avoidK;
          this.currentData.tfrContact = altTfr.contact;
          this.currentData.tfrGap = altTfr.gap;
          this.currentData.tfrSpeed = altTfr.speed;
          this.currentData.trueFutureRating = altTfr.trueFutureRating;
          this.currentData.tfrPercentile = altTfr.tfrPercentile;
          this.currentData.tfrBbPct = altTfr.projBbPct;
          this.currentData.tfrKPct = altTfr.projKPct;
          this.currentData.tfrHrPct = altTfr.projHrPct;
          this.currentData.tfrAvg = altTfr.projAvg;
          this.currentData.tfrObp = altTfr.projObp;
          this.currentData.tfrSlg = altTfr.projSlg;
        } else if (this.currentData.isProspect && this.scoutingData) {
          // Draftee without precomputed tfrBySource — recompute from active scouting
          const s = this.scoutingData;
          const power = s.power ?? 50;
          const eye = s.eye ?? 50;
          const avoidK = s.avoidK ?? 50;
          const contact = s.contact ?? 50;
          const gap = s.gap ?? 50;
          const speed = s.speed ?? 50;

          const bbPct = HitterRatingEstimatorService.expectedBbPct(eye);
          const kPct = HitterRatingEstimatorService.expectedKPct(avoidK);
          const hrPct = HitterRatingEstimatorService.expectedHrPct(power);
          const avg = HitterRatingEstimatorService.expectedAvg(contact);
          const doublesRate = HitterRatingEstimatorService.expectedDoublesRate(gap);
          const triplesRate = HitterRatingEstimatorService.expectedTriplesRate(speed);
          const obp = Math.min(0.450, avg + (bbPct / 100) * (1 - avg));
          const hrPerAb = (hrPct / 100) / 0.88;
          const iso = doublesRate + 2 * triplesRate + 3 * hrPerAb;
          const slg = avg + iso;

          this.currentData.estimatedPower = power;
          this.currentData.estimatedEye = eye;
          this.currentData.estimatedAvoidK = avoidK;
          this.currentData.estimatedContact = contact;
          this.currentData.estimatedGap = gap;
          this.currentData.estimatedSpeed = speed;
          this.currentData.tfrPower = power;
          this.currentData.tfrEye = eye;
          this.currentData.tfrAvoidK = avoidK;
          this.currentData.tfrContact = contact;
          this.currentData.tfrGap = gap;
          this.currentData.tfrSpeed = speed;
          this.currentData.tfrBbPct = bbPct;
          this.currentData.tfrKPct = kPct;
          this.currentData.tfrHrPct = hrPct;
          this.currentData.tfrAvg = avg;
          this.currentData.tfrObp = obp;
          this.currentData.tfrSlg = slg;
          this.currentData.projBbPct = bbPct;
          this.currentData.projKPct = kPct;
          this.currentData.projHrPct = hrPct;
          this.currentData.projAvg = avg;
          this.currentData.projObp = obp;
          this.currentData.projSlg = slg;
          this.currentData.projDoublesRate = doublesRate;
          this.currentData.projTriplesRate = triplesRate;
          // Clear pre-set values so computeBatterProjection recalculates
          this.currentData.projWar = undefined;
          this.currentData.projPa = undefined;
          this.currentData.projWoba = undefined;
          // Update TFR star rating from scouting potential
          if (s.pot !== undefined) {
            this.currentData.trueFutureRating = s.pot;
          }
        }

        // Swap TR/projection fields from trBySource (blended rates change with scouting)
        const altTr = this.currentData.trBySource?.[sourceKey];
        if (altTr) {
          applyBatterTrSnapshot(this.currentData, altTr);
        }

        // Swap fielding scouting source
        const altFielding = wantsOsa ? this.osaFieldingScouting : this.myFieldingScouting;
        if (altFielding) {
          this.fieldingScouting = altFielding;
        }

        // Re-render projection section FIRST — this updates _lastProjection and
        // _lastProjectionWar, which the ratings section badges and WAR emblem read.
        const projSection = this.overlay?.querySelector('.projection-section');
        if (projSection && this.currentData) {
          projSection.outerHTML = this.renderProjectionContent(this.currentData, this.currentStats);
          this.bindProjectionToggle();
        }

        // Re-render the ratings section (radar + running chart) — uses _lastProjection for badges
        const ratingsSection = this.overlay?.querySelector('.ratings-section');
        if (ratingsSection) {
          ratingsSection.outerHTML = this.renderRatingsSection(this.currentData);
          this.bindScoutSourceToggle(); // Re-bind after re-render
          this.bindLegendToggle(); // Re-bind legend toggles after re-render
          this.initRadarChart(this.currentData); // Re-init radar with new scout data
          this.initRunningRadarChart(this.currentData); // Re-init running radar
          this.initFieldingRadarChart();
          this.bindFieldingTabEvents();
        }

        // Update header emblems after projection recompute
        const ratingsSlot = this.overlay?.querySelector('.rating-emblem-slot');
        if (ratingsSlot) ratingsSlot.innerHTML = this.renderRatingEmblem(this.currentData);
        const warSlot = this.overlay?.querySelector('.war-header-slot');
        if (warSlot) warSlot.innerHTML = this.renderWarEmblem(this.currentData);

        // Invalidate cached analysis since scout data changed
        this.cachedAnalysisHtml = '';
        const analysisPane = this.overlay?.querySelector<HTMLElement>('.analysis-pane');
        if (analysisPane) {
          analysisPane.innerHTML = this.renderAnalysisLoading();
          if (this.viewMode === 'analysis') {
            this.fetchAndRenderAnalysis();
          }
        }
      });
    });
  }
}

// Export singleton instance
export const batterProfileModal = new BatterProfileModal();
