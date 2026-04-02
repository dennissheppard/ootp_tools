/**
 * Pitcher Profile Modal - Full-featured modal for viewing pitcher details
 * Mirrors BatterProfileModal layout: radar charts, header vitals, projections
 */

import { PitcherScoutingRatings } from '../models/ScoutingData';
import { scoutingDataService } from '../services/ScoutingDataService';
import { trueRatingsService } from '../services/TrueRatingsService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { dateService } from '../services/DateService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { DevelopmentSnapshotRecord } from '../services/IndexedDBService';
import { DevelopmentChart, DevelopmentMetric, renderMetricToggles, bindMetricToggleHandlers, applyExclusiveMetricToggle } from '../components/DevelopmentChart';
import { contractService, Contract } from '../services/ContractService';
import { RadarChart, RadarChartSeries } from '../components/RadarChart';
import { determinePitcherRole, PitcherRoleInput } from '../models/Player';
import { fipWarService } from '../services/FipWarService';
import { projectionService } from '../services/ProjectionService';
import { PitcherTfrSourceData, teamRatingsService } from '../services/TeamRatingsService';
import { aiScoutingService, AIScoutingPlayerData, markdownToHtml } from '../services/AIScoutingService';
import { resolveCanonicalPitcherData, computePitcherProjection, PitcherTrSourceData, snapshotPitcherTr, applyPitcherTrSnapshot, pitcherTrFromPrecomputed } from '../services/ModalDataService';
import { computePitcherTags, renderTagsHtml, TagContext } from '../utils/playerTags';
import { getParkCharacterLabel, computePitcherParkHrFactor } from '../services/ParkFactorService';
import { analyticsService } from '../services/AnalyticsService';
import { getRouter } from '../router';
import { playerService } from '../services/PlayerService';
import { supabaseDataService } from '../services/SupabaseDataService';
// consistencyChecker no longer needed — display-only path reads from cache, nothing to verify

/** Format injury days as a human-readable duration (e.g. "3 weeks", "5 months") */
function formatInjuryDuration(days: number): string {
  if (days <= 3) return 'day-to-day';
  if (days <= 13) return `${days} days`;
  if (days <= 6 * 7) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

// Eagerly resolve all team logo URLs via Vite glob
const _logoModules = (import.meta as Record<string, any>).glob('../images/logos/*.png', { eager: true, import: 'default' }) as Record<string, string>;
const teamLogoMap: Record<string, string> = {};
for (const [path, url] of Object.entries(_logoModules)) {
  const filename = path.split('/').pop()?.replace('.png', '')?.toLowerCase() ?? '';
  teamLogoMap[filename] = url;
}

export interface PitcherProfileData {
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
  fipLike?: number;

  // Estimated ratings (from stats)
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;

  // Scouting data
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
  scoutStamina?: number;
  scoutOvr?: number;
  scoutPot?: number;
  injuryProneness?: string;
  retired?: boolean;

  // Pitch ratings from scouting (pitch name → 20-80 rating)
  pitchRatings?: Record<string, number>;

  // Projected stats (for next season)
  projWar?: number;
  projIp?: number;
  projFip?: number;
  projK9?: number;
  projBb9?: number;
  projHr9?: number;

  // TFR for prospects
  isProspect?: boolean;
  trueFutureRating?: number;
  tfrPercentile?: number;

  // TFR ceiling data
  hasTfrUpside?: boolean;
  tfrStuff?: number;
  tfrControl?: number;
  tfrHra?: number;

  // Peak projection (from precomputed TFR cache)
  peakIp?: number;
  peakWar?: number;
  peakFip?: number;
  peakK9?: number;
  peakBb9?: number;
  peakHr9?: number;

  // Role
  role?: number;

  // TFR by scout source (for toggle in modal)
  tfrBySource?: { my?: PitcherTfrSourceData; osa?: PitcherTfrSourceData };

  // TR by scout source (for toggle in modal — swaps blended rates + projections)
  trBySource?: { my?: PitcherTrSourceData; osa?: PitcherTrSourceData };

  // Park factor for HR (effective half home / half away)
  parkHrFactor?: number;

  // Raw park factors for indicator display
  rawParkFactors?: { team_id: number; park_name: string; avg: number; avg_l: number; avg_r: number; hr: number; hr_l: number; hr_r: number; d: number; t: number };

  // Prospect metadata (for tags)
  level?: string;
  totalMinorIp?: number;
}

interface PitcherSeasonStats {
  year: number;
  level: string;
  ip: number;
  fip: number;
  k9: number;
  bb9: number;
  hr9: number;
  war: number;
  gs: number;
}

export class PitcherProfileModal {
  private overlay: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };

  private scoutingData: PitcherScoutingRatings | null = null;
  private scoutingIsOsa = false;
  private myScoutingData: PitcherScoutingRatings | null = null;
  private osaScoutingData: PitcherScoutingRatings | null = null;
  // Snapshot of initial projection data per scouting source (for draftee toggle restoration)
  private drafteeInitialProj: { stuff: number; control: number; hra: number; k9?: number; bb9?: number; hr9?: number; fip?: number; war?: number; ip?: number } | null = null;
  private drafteeInitialSource: 'my' | 'osa' | null = null;
  private projectionYear: number = new Date().getFullYear();
  private currentData: PitcherProfileData | null = null;

  // Development tab state
  private developmentChart: DevelopmentChart | null = null;
  private activeDevMetrics: DevelopmentMetric[] = ['scoutStuff', 'scoutControl', 'scoutHra'];
  private devMode: 'ratings' | 'stats' = 'ratings';
  private cachedRatingSnapshots: DevelopmentSnapshotRecord[] | null = null;
  private cachedStatSnapshots: DevelopmentSnapshotRecord[] | null = null;
  private savedRatingMetrics: DevelopmentMetric[] | null = null;
  private savedStatMetrics: DevelopmentMetric[] | null = null;

  // Radar chart instances
  private radarChart: RadarChart | null = null;
  private arsenalRadarChart: RadarChart | null = null;

  // Contract data
  private contract: Contract | null = null;

  // League WAR ceiling for arc scaling
  private leagueWarMax: number = 5;

  // Tag context (cross-player data for Expensive/Bargain/Blocked tags)
  private leagueDollarPerWar: number[] | undefined;
  private blockingPlayer: string | undefined;
  private blockingRating: number | undefined;
  private blockingYears: number | undefined;
  private top100Rank: number | undefined;

  // Sorted league distributions (ascending) for percentile calculation
  private leagueFipDistribution: number[] = [];
  private spFipDistribution: number[] = [];
  private rpFipDistribution: number[] = [];
  // Component distributions by role (sorted ascending)
  private spK9Distribution: number[] = [];
  private rpK9Distribution: number[] = [];
  private spBb9Distribution: number[] = [];
  private rpBb9Distribution: number[] = [];
  private spHr9Distribution: number[] = [];
  private rpHr9Distribution: number[] = [];

  // Projection toggle state
  private projectionMode: 'current' | 'peak' = 'current';
  private currentStats: PitcherSeasonStats[] = [];

  // ProjectionService-derived IP (populated in show())
  private projectedIp: number | null = null;
  // Cached projection from renderProjectionContent (used by career stats row for consistency)
  private _cachedProj: { projK9: number; projBb9: number; projHr9: number; projFip: number; projIp: number; projWar: number } | null = null;
  private injuryDaysRemaining: number = 0;
  private _draftLabel: string | null = null;

  // Track which radar series are hidden via legend toggle
  private hiddenSeries = new Set<string>();

  // Analysis toggle state (Projections vs Career Stats vs True Analysis)
  private viewMode: 'projections' | 'career' | 'analysis' = 'projections';
  private cachedAnalysisHtml: string = '';

  // Guard against async race conditions when re-opened quickly
  private showGeneration = 0;

  constructor() {
    this.ensureOverlayExists();
  }

  private ensureOverlayExists(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay pitcher-profile-modal';
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

    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide());
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
      this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
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

  async show(data: PitcherProfileData, _selectedYear: number): Promise<void> {
    this.ensureOverlayExists();
    if (!this.overlay) return;

    analyticsService.trackPlayerProfileOpened({
      playerId: data.playerId,
      playerName: data.playerName,
      playerType: 'pitcher',
      team: data.team,
      trueRating: data.trueRating,
      isProspect: data.isProspect,
    });

    // Clean up any existing charts from a previous show() (e.g. re-opened without hide())
    if (this.radarChart) { this.radarChart.destroy(); this.radarChart = null; }
    if (this.arsenalRadarChart) { this.arsenalRadarChart.destroy(); this.arsenalRadarChart = null; }
    if (this.developmentChart) { this.developmentChart.destroy(); this.developmentChart = null; }

    // Increment generation to guard against async race conditions
    const generation = ++this.showGeneration;

    // Default to peak for prospects (they have TFR upside), current for MLB players
    this.projectionMode = (data.isProspect || data.hasTfrUpside) ? 'peak' : 'current';
    this._cachedProj = null;
    this._draftLabel = null;
    this.injuryDaysRemaining = 0;
    this.viewMode = 'projections';
    this.cachedAnalysisHtml = '';
    // Reset cached development snapshots from previous player
    this.cachedRatingSnapshots = null;
    this.cachedStatSnapshots = null;
    this.savedRatingMetrics = null;
    this.savedStatMetrics = null;
    this.hiddenSeries.clear();
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

    // Set logo watermark
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

    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this.boundKeyHandler);

    // === Async data loading (modal is already visible with loading skeleton) ===

    const currentYear = await dateService.getCurrentYear();
    if (generation !== this.showGeneration) return; // Stale call
    this.projectionYear = await dateService.getProjectionTargetYear();

    // === Canonical data override — ensures consistency regardless of caller ===
    let playerTR: import('../services/TrueRatingsCalculationService').TrueRatingResult | undefined;
    let tfrEntry: import('../services/TeamRatingsService').RatedProspect | undefined;
    let osaPrecomputedTR: import('../services/TrueRatingsCalculationService').TrueRatingResult | undefined;

    if (supabaseDataService.isConfigured && !supabaseDataService.hasCustomScouting) {
      // Fast path: single-player rating lookup (1 query instead of bulk fetches)
      // Skip when custom scouting is active — need locally computed TR/TFR instead
      try {
        const rows = await supabaseDataService.getPlayerRating(data.playerId);
        if (generation !== this.showGeneration) return;
        for (const row of rows) {
          if (row.rating_type === 'pitcher_tr') playerTR = row.data;
          else if (row.rating_type === 'pitcher_tfr') tfrEntry = row.data;
        }
      } catch { /* ratings not available */ }
    } else {
      // 1. Fetch canonical TR — always attempt, even for callers who tag the player
      // as a prospect. Players with limited MLB innings (e.g. call-ups) may have a
      // TR entry and should show Current/Peak toggle, not prospect-only peak.
      {
        const canonicalTR = await trueRatingsService.getPitcherTrueRatings(currentYear);
        if (generation !== this.showGeneration) return;
        playerTR = canonicalTR.get(data.playerId);
      }

      // 2. Always fetch canonical TFR (for pitching prospects)
      try {
        const farmData = await teamRatingsService.getUnifiedPitcherTfrData(currentYear);
        if (generation !== this.showGeneration) return;
        tfrEntry = farmData.prospects.find(p => p.playerId === data.playerId);
      } catch { /* TFR data not available */ }

      // 3. Also fetch pre-computed OSA TR for scouting toggle (non-prospects only)
      if (supabaseDataService.isConfigured && supabaseDataService.hasCustomScouting && !data.isProspect) {
        try {
          const rows = await supabaseDataService.getPlayerRating(data.playerId);
          if (generation !== this.showGeneration) return;
          for (const row of rows) {
            if (row.rating_type === 'pitcher_tr') osaPrecomputedTR = row.data;
          }
        } catch { /* OSA pre-computed not available */ }
      }
    }

    this.top100Rank = (tfrEntry?.percentileRank !== undefined && tfrEntry.percentileRank <= 100 && tfrEntry.isFarmEligible)
      ? tfrEntry.percentileRank : undefined;

    // 3-5. Apply canonical data overrides (TR, TFR, prospect detection, derived projections)
    resolveCanonicalPitcherData(data, playerTR, tfrEntry);

    // Populate peak projection from precomputed TFR (canonical peak answer)
    if (tfrEntry) {
      data.peakIp = (tfrEntry as any).peakIp ?? (tfrEntry as any).projIp;
      data.peakWar = (tfrEntry as any).peakWar;
      data.peakFip = (tfrEntry as any).peakFip ?? (tfrEntry as any).projFip;
      data.peakK9 = (tfrEntry as any).projK9;
      data.peakBb9 = (tfrEntry as any).projBb9;
      data.peakHr9 = (tfrEntry as any).projHr9;
    }

    // Build trBySource so scouting toggle can swap projections
    if (supabaseDataService.hasCustomScouting && !data.isProspect) {
      const customSnapshot = snapshotPitcherTr(data);
      const osaSnapshot = osaPrecomputedTR ? pitcherTrFromPrecomputed(osaPrecomputedTR) : undefined;
      data.trBySource = {};
      if (customSnapshot) data.trBySource.my = customSnapshot;
      if (osaSnapshot) data.trBySource.osa = osaSnapshot;
    }

    try {
      // Fetch scouting + contract + league context in parallel
      const [myScouting, osaScouting, playerContract, leagueCtx, parkFactorsData] = await Promise.all([
        scoutingDataService.getScoutingForPlayer(data.playerId, 'my'),
        scoutingDataService.getScoutingForPlayer(data.playerId, 'osa'),
        contractService.getContractForPlayer(data.playerId),
        supabaseDataService.isConfigured ? supabaseDataService.getPrecomputed('league_context') : Promise.resolve(null),
        supabaseDataService.isConfigured ? supabaseDataService.getPrecomputed('park_factors') : Promise.resolve(null),
      ]);
      if (generation !== this.showGeneration) return; // Stale call

      // Load player data for park factors + injury
      {
        const player = await playerService.getPlayerById(data.playerId);
        this.injuryDaysRemaining = player?.injuryDaysRemaining ?? 0;
        if (parkFactorsData && data.parkHrFactor === undefined && player) {
          const parentTeamId = player.parentTeamId || player.teamId;
          const teamPf = parkFactorsData[parentTeamId];
          if (teamPf) {
            const { computePitcherParkHrFactor, ensureParkName } = await import('../services/ParkFactorService');
            data.parkHrFactor = computePitcherParkHrFactor(teamPf);
            data.rawParkFactors = teamPf;
            await ensureParkName(teamPf);
          }
        }
      }

      this.contract = playerContract ?? null;

      // Tag context
      this.blockingPlayer = undefined;
      this.blockingRating = undefined;
      this.blockingYears = undefined;

      // League context: WAR ceiling + FIP distribution + $/WAR distribution
      this.leagueWarMax = leagueCtx?.pitcherWarMax ?? 6;
      this.leagueFipDistribution = leagueCtx?.fipDistribution ?? [];
      this.spFipDistribution = leagueCtx?.spFipDistribution ?? [];
      this.rpFipDistribution = leagueCtx?.rpFipDistribution ?? [];
      this.leagueDollarPerWar = leagueCtx?.dollarPerWar?.length > 0 ? leagueCtx.dollarPerWar : undefined;

      // Build K/9, BB/9, HR/9 distributions from pitcher projections (same pool as ProjectionsView)
      try {
        const allProj = await projectionService.getProjections(currentYear);
        const spK9: number[] = [], rpK9: number[] = [];
        const spBb9: number[] = [], rpBb9: number[] = [];
        const spHr9: number[] = [], rpHr9: number[] = [];
        for (const p of allProj) {
          const arr = p.isSp ? [spK9, spBb9, spHr9] : [rpK9, rpBb9, rpHr9];
          arr[0].push(p.projectedStats.k9);
          arr[1].push(p.projectedStats.bb9);
          arr[2].push(p.projectedStats.hr9);
        }
        this.spK9Distribution = spK9.sort((a, b) => a - b);
        this.rpK9Distribution = rpK9.sort((a, b) => a - b);
        this.spBb9Distribution = spBb9.sort((a, b) => a - b);
        this.rpBb9Distribution = rpBb9.sort((a, b) => a - b);
        this.spHr9Distribution = spHr9.sort((a, b) => a - b);
        this.rpHr9Distribution = rpHr9.sort((a, b) => a - b);
      } catch { /* projections not available */ }

      this.myScoutingData = myScouting ?? null;
      this.osaScoutingData = osaScouting ?? null;

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

      // Snapshot initial projection for draftee toggle restoration
      if (data.isProspect) {
        this.drafteeInitialSource = this.scoutingIsOsa ? 'osa' : 'my';
        this.drafteeInitialProj = {
          stuff: data.estimatedStuff ?? 50,
          control: data.estimatedControl ?? 50,
          hra: data.estimatedHra ?? 50,
          k9: data.projK9,
          bb9: data.projBb9,
          hr9: data.projHr9,
          fip: data.projFip,
          war: data.projWar,
          ip: data.projIp,
        };
      } else {
        this.drafteeInitialProj = null;
        this.drafteeInitialSource = null;
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

      // Render header slots with scouting data
      if (ratingsSlot) ratingsSlot.innerHTML = this.renderRatingEmblem(data);
      if (warSlot) warSlot.innerHTML = this.renderWarEmblem(data);
      if (vitalsSlot) vitalsSlot.innerHTML = this.renderHeaderVitals(data);
      if (ageEl) ageEl.textContent = data.age ? `Age: ${data.age}` : '';

      // Fetch pitching stats history
      let minorStats: PitcherSeasonStats[] = [];
      try {
        const minorPitchingStats = await minorLeagueStatsService.getPlayerStats(
          data.playerId,
          currentYear - 5,
          currentYear
        );
        minorStats = minorPitchingStats.map(s => {
          const fip = ((13 * s.hr9) + (3 * s.bb9) - (2 * s.k9)) / 9 + 3.47;
          return {
            year: s.year,
            level: s.level,
            ip: s.ip,
            fip: Math.round(fip * 100) / 100,
            k9: s.k9,
            bb9: s.bb9,
            hr9: s.hr9,
            war: 0,
            gs: 0,
          };
        });
      } catch (e) {
        console.warn('No minor league pitching stats found');
      }

      // Fetch MLB pitching stats
      let mlbStats: PitcherSeasonStats[] = [];
      try {
        if (supabaseDataService.isConfigured) {
          // Single query for this player's MLB pitching across all years
          const rows = await supabaseDataService.query<any>(
            'pitching_stats',
            `select=*&player_id=eq.${data.playerId}&league_id=eq.200&split_id=eq.1&year=gte.${currentYear - 4}&year=lte.${currentYear}&order=year.desc`
          );
          // Dedup by year (keep row with most IP — the season total)
          const dedupByYear = new Map<number, any>();
          for (const r of rows) {
            const existing = dedupByYear.get(r.year);
            const rIp = typeof r.ip === 'string' ? parseFloat(r.ip) : (r.ip || 0);
            const eIp = existing ? (typeof existing.ip === 'string' ? parseFloat(existing.ip) : (existing.ip || 0)) : -1;
            if (!existing || rIp > eIp) dedupByYear.set(r.year, r);
          }
          const byYear = new Map<number, { ipOuts: number; er: number; k: number; bb: number; hr: number; war: number; gs: number }>();
          for (const r of dedupByYear.values()) {
            const ip = typeof r.ip === 'string' ? parseFloat(r.ip) : (r.ip || 0);
            const whole = Math.floor(ip);
            const frac = Math.round((ip - whole) * 10);
            const outs = whole * 3 + frac;
            if (!byYear.has(r.year)) byYear.set(r.year, { ipOuts: 0, er: 0, k: 0, bb: 0, hr: 0, war: 0, gs: 0 });
            const e = byYear.get(r.year)!;
            e.ipOuts += outs; e.er += r.er ?? 0; e.k += r.k ?? 0;
            e.bb += r.bb ?? 0; e.hr += r.hra ?? r.hr ?? 0; e.war += r.war ?? 0; e.gs += r.gs ?? 0;
          }
          for (const [year, t] of byYear) {
            const ip = t.ipOuts / 3;
            if (ip > 0) {
              const k9 = (t.k / ip) * 9, bb9 = (t.bb / ip) * 9, hr9 = (t.hr / ip) * 9;
              mlbStats.push({
                year, level: 'MLB', ip,
                fip: ((13 * hr9) + (3 * bb9) - (2 * k9)) / 9 + 3.47,
                k9, bb9, hr9, war: t.war, gs: t.gs,
              });
            }
          }
          mlbStats.sort((a, b) => b.year - a.year);
        } else {
          const yearlyDetails = await trueRatingsService.getPlayerYearlyStats(data.playerId, currentYear, 5);
          mlbStats = yearlyDetails.map(s => ({
            year: s.year, level: 'MLB', ip: s.ip, fip: s.fip,
            k9: s.k9, bb9: s.bb9, hr9: s.hr9, war: s.war, gs: s.gs,
          }));
        }
      } catch (e) {
        console.warn('No MLB pitching stats found');
      }

      // Combine and sort
      const allStats = [...mlbStats, ...minorStats].sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        const levelOrder: Record<string, number> = { 'MLB': 0, 'aaa': 1, 'aa': 2, 'a': 3, 'r': 4 };
        return (levelOrder[a.level] ?? 5) - (levelOrder[b.level] ?? 5);
      });

      this.currentStats = allStats;

      // Projected stats: read from precomputed cache (canonical, injury/park adjusted)
      // Includes promotion-ready prospects who now get current-year projections
      this.projectedIp = null;
      if (data.projIp === undefined
          && supabaseDataService.isConfigured && !supabaseDataService.hasCustomScouting) {
        try {
          const cachedCtx = await projectionService.getProjectionsWithContext(currentYear);
          if (generation !== this.showGeneration) return;
          const cachedProj = cachedCtx?.projections?.find((p: any) => p.playerId === data.playerId);
          if (cachedProj) {
            data.projIp = cachedProj.projectedStats.ip;
            data.projWar = cachedProj.projectedStats.war;
            data.projK9 = cachedProj.projectedStats.k9;
            data.projBb9 = cachedProj.projectedStats.bb9;
            data.projHr9 = cachedProj.projectedStats.hr9;
            data.projFip = cachedProj.projectedStats.fip;
            this.projectedIp = cachedProj.projectedStats.ip;
            // Prospect with current-year projection: enable current/peak toggle
            if (data.isProspect) {
              data.hasTfrUpside = true;
              // trueRating must be set for the toggle to appear (showToggle check)
              if (data.trueRating === undefined) data.trueRating = cachedProj.currentTrueRating ?? cachedProj.projectedTrueRating ?? 1.0;
            }
          }
        } catch { /* cache not available */ }
      }
      // Fallback: compute if not in cache (prospects, custom scouting, historical year)
      if (data.projIp === undefined) {
        try {
          const s = this.scoutingData;
          const currentRatings = {
            stuff: data.estimatedStuff ?? s?.stuff ?? 50,
            control: data.estimatedControl ?? s?.control ?? 50,
            hra: data.estimatedHra ?? s?.hra ?? 50,
          };
          const historicalStats = mlbStats
            .filter(st => st.level === 'MLB')
            .map(st => ({ year: st.year, ip: st.ip, k9: st.k9, bb9: st.bb9, hr9: st.hr9, gs: st.gs }));
          const latestMlb = historicalStats[0];
          const projResult = await projectionService.calculateProjection(
            currentRatings,
            data.age ?? 27,
            s?.pitches ? Object.values(s.pitches).filter(r => r >= 25).length : 0,
            latestMlb?.gs ?? 0,
            { fipConstant: 3.47, avgFip: 4.20, runsPerWin: 8.50 },
            s?.stamina ?? data.scoutStamina,
            s?.injuryProneness ?? data.injuryProneness,
            historicalStats.length > 0 ? historicalStats : undefined,
            data.trueRating ?? 0,
            s?.pitches ?? data.pitchRatings,
          );
          this.projectedIp = projResult.projectedStats.ip;
        } catch (e) {
          console.warn('ProjectionService IP calculation failed, will use fallback', e);
        }
      }

      // Re-render WAR emblem now that projectedIp is computed from the projection service
      // (the initial render at the header pass ran before stats/IP were loaded)
      if (warSlot) {
        warSlot.innerHTML = this.renderWarEmblem(data);
      }

      // Render full body (populates _cachedProj from Projections tab)
      if (bodyEl) {
        bodyEl.innerHTML = this.renderBody(data, allStats);
        this.bindBodyEvents();

        // Re-render WAR badge with cached projection values (ensures consistency with Projections tab)
        if (warSlot && this._cachedProj) {
          warSlot.innerHTML = this.renderWarEmblem(data);
        }

        requestAnimationFrame(() => {
          const emblem = this.overlay?.querySelector('.rating-emblem');
          if (emblem) emblem.classList.add('shimmer-once');
        });
      }
    } catch (error) {
      console.error('Error loading pitcher profile data:', error);
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

    if (this.radarChart) {
      this.radarChart.destroy();
      this.radarChart = null;
    }
    if (this.arsenalRadarChart) {
      this.arsenalRadarChart.destroy();
      this.arsenalRadarChart = null;
    }
    if (this.developmentChart) {
      this.developmentChart.destroy();
      this.developmentChart = null;
    }
  }

  // ─── Shared Helpers ────────────────────────────────────────────────────

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

  private getTeamLogoUrl(teamName?: string): string | null {
    if (!teamName) return null;
    const normalized = teamName.replace(/\s+/g, '_').toLowerCase();
    if (teamLogoMap[normalized]) return teamLogoMap[normalized];
    for (const [filename, url] of Object.entries(teamLogoMap)) {
      if (filename.endsWith('_' + normalized)) return url;
    }
    return null;
  }

  private renderPositionBadge(data: PitcherProfileData): string {
    const s = this.scoutingData;
    const pitchRatings = s?.pitches ?? data.pitchRatings;
    const stamina = s?.stamina ?? data.scoutStamina;

    const roleInput: PitcherRoleInput = {
      pitchRatings,
      stamina,
      ootpRole: data.role,
    };
    const role = determinePitcherRole(roleInput);
    return `<span class="position-badge pos-pitcher">${role}</span>`;
  }

  private renderLoadingContent(): string {
    return `
      <div class="player-modal-loading">
        <div class="ratings-layout loading-skeleton">
          <div class="ratings-radar-col">
            <div class="skeleton-radar-placeholder"></div>
          </div>
          <div class="arsenal-col">
            <div class="skeleton-radar-placeholder" style="height: 180px;"></div>
          </div>
        </div>
        <div class="stats-section loading-skeleton" style="margin-top: 1rem;">
          <div class="stats-table-scroll">
            <table class="stats-table skeleton-table">
              <thead>
                <tr>
                  ${Array.from({ length: 7 }, () => '<th><span class="skeleton-line xs"></span></th>').join('')}
                </tr>
              </thead>
              <tbody>
                ${Array.from({ length: 3 }, () => `
                  <tr>
                    ${Array.from({ length: 7 }, () => '<td><span class="skeleton-line xs"></span></td>').join('')}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  // ─── Header: Rating Emblem ──────────────────────────────────────────

  private renderRatingEmblem(data: PitcherProfileData): string {
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

    const emblemSize = 100;
    const cx = emblemSize / 2;
    const cy = emblemSize / 2 + 2;
    const radius = (emblemSize / 2) - 8;
    const sw = 8;
    const fraction = Math.max(0, Math.min(1, ratingValue / 5));
    const arcPath = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;
    const halfCirc = Math.PI * radius;
    const dashOff = halfCirc * (1 - fraction);

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

  // ─── Header: WAR Emblem ─────────────────────────────────────────────

  private renderWarEmblem(data: PitcherProfileData): string {
    const projWar = this.calculateProjWar(data);
    const warText = typeof projWar === 'number' ? projWar.toFixed(1) : '--';
    const warLabel = data.isProspect ? 'Proj Peak WAR' : 'Proj WAR';
    const badgeClass = this.getWarBadgeClass(projWar);

    if (typeof projWar !== 'number') {
      return `<div class="war-emblem war-none"><div class="war-emblem-header"><span class="war-emblem-label">${warLabel}</span></div><div class="emblem-gauge-score">--</div></div>`;
    }

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
          <div class="emblem-gauge-score">${warText}</div>
        </div>
      </div>
    `;
  }

  private renderParkButton(data: PitcherProfileData): string {
    if (!data.rawParkFactors) return '';
    const pf = data.rawParkFactors;
    const { label, class: pfClass } = getParkCharacterLabel(pf);
    const effHr = data.parkHrFactor ?? computePitcherParkHrFactor(pf);

    // Effective park factors for batters faced (75% RHB / 25% LHB, half home / half away)
    const avgFactor = (pf.avg_r * 0.75 + pf.avg_l * 0.25 + 1.0) / 2.0;
    const dFactor = (pf.d + 1.0) / 2.0;
    const tFactor = (pf.t + 1.0) / 2.0;

    // Use cached projection or data for park-adjusted stats
    const proj = this._cachedProj;
    const parkHr9 = proj?.projHr9 ?? data.projHr9;
    const parkFip = proj?.projFip ?? data.projFip;
    const parkWar = proj?.projWar ?? data.projWar;

    if (parkHr9 === undefined && parkFip === undefined) {
      return `
        <button class="modal-action-btn park-action-btn ${pfClass}" data-action="park" data-team-id="${pf.team_id}">
          <span style="font-size:14px;">&#127967;</span>
        </button>
      `;
    }

    // Back out park effect to get neutral stats
    const neutHr9 = parkHr9 !== undefined ? parkHr9 / effHr : undefined;
    // FIP: delta from HR/9 change = 13 * deltaHR9 / 9
    const neutFip = (parkFip !== undefined && parkHr9 !== undefined && neutHr9 !== undefined)
      ? parkFip - 13 * (parkHr9 - neutHr9) / 9 : undefined;

    // ERA estimate: FIP + park effect on hits/XBH (beyond what FIP captures)
    // Extra-base hits and BABIP affect runs allowed but not FIP
    // Rough model: each 1% AVG boost ≈ +0.025 ERA, 1% 2B ≈ +0.010, 1% 3B ≈ +0.004
    const eraAdj = (avgFactor - 1) * 2.5 + (dFactor - 1) * 1.0 + (tFactor - 1) * 0.4;
    const parkEra = parkFip !== undefined ? parkFip + 0.15 + eraAdj : undefined; // FIP + 0.15 baseline gap
    const neutEra = neutFip !== undefined ? neutFip + 0.15 : undefined;

    // WAR: WAR goes up when FIP goes down. deltaWAR ≈ -(deltaFIP) * IP / (9 * runsPerWin)
    const ip = proj?.projIp ?? data.projIp ?? 150;
    const correctedNeutWar = (parkWar !== undefined && parkFip !== undefined && neutFip !== undefined)
      ? parkWar + (parkFip - neutFip) * ip / (9 * 9.5) : undefined;

    const fmt2 = (v: number) => v.toFixed(2);
    const fmt1 = (v: number) => v.toFixed(1);
    // For pitchers: lower is better, so color green when park value < neutral
    const clsPitcher = (park: number, neut: number) => {
      const diff = park - neut;
      if (Math.abs(diff) < 0.005) return 'pf-neutral';
      return diff < 0 ? 'pf-hitter-friendly' : 'pf-pitcher-friendly'; // lower = good for pitcher = green
    };
    // WAR: higher is better
    const clsWar = (park: number, neut: number) => {
      const diff = park - neut;
      if (Math.abs(diff) < 0.05) return 'pf-neutral';
      return diff > 0 ? 'pf-hitter-friendly' : 'pf-pitcher-friendly';
    };

    let rows = `<table style="border-collapse:collapse; width:100%; font-size:0.7rem; font-variant-numeric:tabular-nums;">
      <tr style="color:var(--color-text-muted);"><td></td><td>Neutral</td><td>${pf.park_name}</td></tr>`;
    if (parkHr9 !== undefined && neutHr9 !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">HR/9</td><td>${fmt2(neutHr9)}</td><td class="${clsPitcher(parkHr9, neutHr9)}">${fmt2(parkHr9)}</td></tr>`;
    }
    if (parkFip !== undefined && neutFip !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">FIP</td><td>${fmt2(neutFip)}</td><td class="${clsPitcher(parkFip, neutFip)}">${fmt2(parkFip)}</td></tr>`;
    }
    if (parkEra !== undefined && neutEra !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">Est ERA</td><td>${fmt2(neutEra)}</td><td class="${clsPitcher(parkEra, neutEra)}">${fmt2(parkEra)}</td></tr>`;
    }
    if (parkWar !== undefined && correctedNeutWar !== undefined) {
      rows += `<tr><td style="color:var(--color-text-muted);">WAR</td><td>${fmt1(correctedNeutWar)}</td><td class="${clsWar(parkWar, correctedNeutWar)}">${fmt1(parkWar)}</td></tr>`;
    }
    rows += '</table>';

    return `
      <button class="modal-action-btn park-action-btn ${pfClass}" data-action="park" data-team-id="${pf.team_id}">
        <span style="font-size:14px;">&#127967;</span>
        <div class="park-factor-tooltip">
          <div class="park-factor-tooltip-header">${pf.park_name} · <span class="${pfClass}">${label}</span></div>
          <div class="park-factor-tooltip-sep"></div>
          ${rows}
          ${Math.abs(eraAdj) >= 0.01 ? `<div style="font-size:0.6rem; color:var(--color-text-muted); margin-top:3px;">Est ERA incl. park BABIP/XBH effect</div>` : ''}
        </div>
      </button>
    `;
  }

  private calculateProjWar(data: PitcherProfileData): number | undefined {
    // Display-only: use cached projection, no computation
    return this._cachedProj?.projWar ?? data.projWar;
  }

  private getFipBadgeClass(fip?: number): string {
    if (fip === undefined) return 'fip-none';
    if (fip <= 2.75) return 'fip-elite';
    if (fip <= 3.25) return 'fip-great';
    if (fip <= 3.75) return 'fip-above-avg';
    if (fip <= 4.25) return 'fip-avg';
    if (fip <= 4.75) return 'fip-below-avg';
    return 'fip-poor';
  }

  // ─── Header: Vitals ──────────────────────────────────────────────────

  private renderHeaderVitals(data: PitcherProfileData): string {
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
    if (!s) {
      console.log('[PitcherProfile] No scouting data for personality traits');
      return '';
    }

    console.log('[PitcherProfile] Personality trait data:', {
      playerId: s.playerId,
      leadership: s.leadership,
      loyalty: s.loyalty,
      adaptability: s.adaptability,
      greed: s.greed,
      workEthic: s.workEthic,
      intelligence: s.intelligence,
    });

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

  private renderOvrPotStars(data: PitcherProfileData): string {
    const s = this.scoutingData;
    const ovr = s?.ovr ?? data.scoutOvr;
    const pot = s?.pot ?? data.scoutPot;

    if (typeof ovr !== 'number' || typeof pot !== 'number') return '';

    const totalStars = pot;
    const filledStars = ovr;

    let html = '<span class="ovr-pot-stars" title="OVR ' + ovr.toFixed(1) + ' / POT ' + pot.toFixed(1) + '">';
    const maxWholeStars = Math.ceil(totalStars);
    for (let i = 1; i <= maxWholeStars; i++) {
      const remaining = filledStars - (i - 1);
      const potRemaining = totalStars - (i - 1);
      if (remaining >= 1) {
        html += '<svg class="star-icon star-filled" viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
      } else if (remaining >= 0.5) {
        html += `<svg class="star-icon star-half" viewBox="0 0 24 24" width="14" height="14">
          <defs><clipPath id="star-half-clip-p-${i}"><rect x="0" y="0" width="12" height="24"/></clipPath></defs>
          <path class="star-empty-path" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
          <path class="star-filled-path" d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" clip-path="url(#star-half-clip-p-${i})"/>
        </svg>`;
      } else if (potRemaining >= 0.5) {
        html += '<svg class="star-icon star-empty" viewBox="0 0 24 24" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
      }
    }
    html += '</span>';
    return html;
  }

  private renderContractInfo(): string {
    if (!this.contract || this.contract.years === 0) return '—';
    const c = this.contract;
    const salaries = c.salaries ?? [];
    const currentSalary = salaries[c.currentYear] ?? salaries[0] ?? 0;

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

  private formatSalary(salary: number): string {
    if (salary >= 1_000_000) {
      const millions = salary / 1_000_000;
      return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1)}M`;
    }
    if (salary >= 1_000) return `$${Math.round(salary / 1_000)}K`;
    return `$${salary}`;
  }

  /** Get the FIP distribution matching the player's tier (SP or RP), falling back to all pitchers */
  private getFipDistributionForPlayer(data: PitcherProfileData): number[] {
    const s = this.scoutingData;
    const role = determinePitcherRole({
      pitchRatings: s?.pitches ?? data.pitchRatings,
      stamina: s?.stamina ?? data.scoutStamina,
      ootpRole: data.role,
    });
    if (role === 'SP' || role === 'SW') {
      return this.spFipDistribution.length > 0 ? this.spFipDistribution : this.leagueFipDistribution;
    }
    return this.rpFipDistribution.length > 0 ? this.rpFipDistribution : this.leagueFipDistribution;
  }

  private renderStatBox(label: string, value: string, percentile: number | undefined, cssClass: string): string {
    const barHtml = percentile !== undefined
      ? `<div class="stat-box-bar-track"><div class="stat-box-bar-fill" style="width:${percentile}%"></div></div>`
      : '';
    return `
      <div class="stat-box ${cssClass}">
        <span class="stat-box-label">${label}</span>
        <span class="stat-box-value">${value}</span>
        ${barHtml}
      </div>
    `;
  }

  /** Compute percentile from a sorted distribution. lowerIsBetter inverts the ranking. */
  private computeDistPercentile(value: number | undefined, dist: number[], lowerIsBetter = false): number | undefined {
    if (value === undefined || dist.length === 0) return undefined;
    const rank = dist.filter(v => lowerIsBetter ? v > value : v < value).length;
    return Math.min(99, Math.max(1, Math.round((rank / dist.length) * 100)));
  }

  private computeFipPercentile(fip: number | undefined, dist: number[]): number | undefined {
    if (typeof fip !== 'number' || dist.length === 0) return undefined;
    let betterThanCount = 0;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] >= fip) { betterThanCount = dist.length - i; break; }
    }
    return Math.round((betterThanCount / dist.length) * 100);
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

  private getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  private getWarBadgeClass(war?: number): string {
    if (war === undefined) return 'war-none';
    if (war >= 6.0) return 'war-elite';
    if (war >= 4.0) return 'war-allstar';
    if (war >= 2.0) return 'war-starter';
    if (war >= 1.0) return 'war-bench';
    return 'war-replacement';
  }

  private getInjuryBadgeClass(injury: string): string {
    const classMap: Record<string, string> = {
      'Ironman': 'injury-durable', 'Durable': 'injury-durable',
      'Normal': 'injury-normal', 'Wary': 'injury-wary',
      'Fragile': 'injury-fragile', 'Prone': 'injury-prone', 'Wrecked': 'injury-prone',
    };
    return classMap[injury] ?? 'injury-normal';
  }

  private renderInjuryStatus(): string {
    const days = this.injuryDaysRemaining;
    if (days <= 0) return '';
    const duration = formatInjuryDuration(days);
    const SEASON_DAYS = 180;
    const pct = Math.min(Math.round((days / SEASON_DAYS) * 100), 100);
    const tipText = `−${pct}% IP &amp; WAR`;
    return ` <span class="injury-active-badge" data-tip="${tipText}">🏥 out ${duration}</span>`;
  }

  // ─── Body Rendering ────────────────────────────────────────────────────

  private renderBody(data: PitcherProfileData, stats: PitcherSeasonStats[]): string {
    const isRetired = data.retired === true;
    if (isRetired) this.viewMode = 'career';
    // Render projections FIRST — populates _cachedProj used by ratings stat boxes and career stats
    const projectionContent = this.renderProjectionContent(data, stats);
    const ratingsSection = this.renderRatingsSection(data);
    const careerContent = this.renderCareerStatsContent(stats);

    // Compute player tags
    const currentSalary = this.contract ? contractService.getCurrentSalary(this.contract) : 0;
    const projStats = this.computeProjectedStats(data);
    let fipPercentile: number | undefined;
    const tagFipDist = this.getFipDistributionForPlayer(data);
    if (typeof projStats.projFip === 'number' && tagFipDist.length > 0) {
      let betterThanCount = 0;
      for (let i = 0; i < tagFipDist.length; i++) {
        if (tagFipDist[i] >= projStats.projFip) { betterThanCount = tagFipDist.length - i; break; }
      }
      fipPercentile = Math.round((betterThanCount / tagFipDist.length) * 100);
    }
    const tagCtx: TagContext = {
      currentSalary,
      leagueDollarPerWar: this.leagueDollarPerWar,
      blockingPlayer: this.blockingPlayer,
      blockingRating: this.blockingRating,
      blockingYears: this.blockingYears,
      fipPercentile,
      top100Rank: this.top100Rank,
    };
    const tagsHtml = renderTagsHtml(computePitcherTags(data, tagCtx));

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

  // ─── Ratings Section: Pitching Radar + Arsenal + Stamina ────────────

  private renderRatingsSection(data: PitcherProfileData): string {
    const s = this.scoutingData;
    const hasEstimated = data.estimatedStuff !== undefined ||
                         data.estimatedControl !== undefined ||
                         data.estimatedHra !== undefined;
    const hasTfrCeiling = data.hasTfrUpside && data.tfrStuff !== undefined;

    // Compute projected stats for badges
    const projStats = this.computeProjectedStats(data);

    const pitchingAxes = [
      { label: 'Stuff', pos: 'top', est: data.estimatedStuff, scout: s?.stuff, tfr: data.tfrStuff, projLabel: 'K/9', projValue: projStats.projK9?.toFixed(1) },
      { label: 'Control', pos: 'lower-right', est: data.estimatedControl, scout: s?.control, tfr: data.tfrControl, projLabel: 'BB/9', projValue: projStats.projBb9?.toFixed(1) },
      { label: 'HRA', pos: 'lower-left', est: data.estimatedHra, scout: s?.hra, tfr: data.tfrHra, projLabel: 'HR/9', projValue: projStats.projHr9?.toFixed(1) },
    ];

    const pitchingAxisLabelsHtml = pitchingAxes.map(a => {
      let badges = '';
      const hasTr = hasEstimated && a.est !== undefined;
      const hasTfr = hasTfrCeiling && a.tfr !== undefined;
      const hasScout = s && a.scout !== undefined;
      if (hasTr) badges += `<span class="radar-axis-badge radar-badge-true">${Math.round(a.est!)}</span>`;
      if (hasTfr) badges += `<span class="radar-axis-badge radar-badge-tfr">${Math.round(a.tfr!)}</span>`;
      if (hasScout) badges += `<span class="radar-axis-badge radar-badge-scout">${Math.round(a.scout!)}</span>`;
      const projBadge = a.projValue !== undefined ? `<span class="radar-proj-badge radar-proj-${a.pos}"><span class="proj-value">${a.projValue}</span><span class="proj-label">${a.projLabel}</span></span>` : '';
      return `<div class="radar-axis-label pitching-axis-${a.pos}">
        <span class="radar-axis-name">${a.label}</span>
        <div class="radar-axis-badges">${badges}</div>
        ${projBadge}
      </div>`;
    }).join('');

    // Scout source toggle
    const showScoutToggle = this.myScoutingData !== null && this.osaScoutingData !== null;
    const scoutToggleHtml = showScoutToggle ? `
      <div class="toggle-group scout-source-toggle">
        <button class="toggle-btn scout-toggle-btn ${!this.scoutingIsOsa ? 'active' : ''}" data-value="my">My Scout</button>
        <button class="toggle-btn scout-toggle-btn ${this.scoutingIsOsa ? 'active' : ''}" data-value="osa">OSA</button>
      </div>
    ` : '';

    // Arsenal + Stamina column
    const arsenalHtml = this.renderArsenalColumn(data);

    // Projected stat boxes — use cached projection (from Projections tab) for consistency
    const cp = this._cachedProj;
    const boxFip = cp?.projFip ?? projStats.projFip;
    const boxK9 = cp?.projK9 ?? projStats.projK9;
    const boxBb9 = cp?.projBb9 ?? projStats.projBb9;
    const boxHr9 = cp?.projHr9 ?? projStats.projHr9;
    const peakPrefix = data.isProspect ? 'Peak ' : 'Proj ';
    const fipBadgeClass = this.getFipBadgeClass(boxFip);

    // Compute percentiles from real league distributions (same method as ProjectionsView)
    const s2 = this.scoutingData;
    const role = determinePitcherRole({ pitchRatings: s2?.pitches ?? data.pitchRatings, stamina: s2?.stamina ?? data.scoutStamina, ootpRole: data.role });
    const isSp = role === 'SP' || role === 'SW';
    const fipDist = this.getFipDistributionForPlayer(data);
    const fipPctl = this.computeFipPercentile(boxFip, fipDist);
    const k9Pctl = this.computeDistPercentile(boxK9, isSp ? this.spK9Distribution : this.rpK9Distribution);
    const bb9Pctl = this.computeDistPercentile(boxBb9, isSp ? this.spBb9Distribution : this.rpBb9Distribution, true);
    const hr9Pctl = this.computeDistPercentile(boxHr9, isSp ? this.spHr9Distribution : this.rpHr9Distribution, true);

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
          <div class="ratings-left-col">
            <div class="ratings-panel ratings-panel-pitching">
              <div class="ratings-panel-header"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="1.5"/></svg>Pitching</div>
              <div class="radar-chart-wrapper">
                <div id="pitcher-radar-chart"></div>
                ${pitchingAxisLabelsHtml}
              </div>
            </div>
            <div class="pitching-stat-boxes">
              ${this.renderStatBox(`${peakPrefix}FIP`, typeof boxFip === 'number' ? boxFip.toFixed(2) : '--', fipPctl, fipBadgeClass)}
              ${this.renderStatBox(`${peakPrefix}K/9`, boxK9?.toFixed(1) ?? '--', k9Pctl, 'stat-box-k9')}
              ${this.renderStatBox(`${peakPrefix}BB/9`, boxBb9?.toFixed(1) ?? '--', bb9Pctl, 'stat-box-bb9')}
              ${this.renderStatBox(`${peakPrefix}HR/9`, boxHr9?.toFixed(1) ?? '--', hr9Pctl, 'stat-box-hr9')}
            </div>
          </div>
          <div class="ratings-panel ratings-panel-arsenal">
            <div class="ratings-panel-header"><svg viewBox="0 0 24 24"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>Peripherals</div>
            ${arsenalHtml}
          </div>
        </div>
      </div>
    `;
  }

  private renderArsenalColumn(data: PitcherProfileData): string {
    const s = this.scoutingData;
    const pitchRatings = s?.pitches ?? data.pitchRatings;
    const stamina = s?.stamina ?? data.scoutStamina;
    const hasScoutingData = s !== null || data.scoutStamina !== undefined || (data.pitchRatings && Object.keys(data.pitchRatings).length > 0);

    // Pitch arsenal
    let arsenalChartHtml = '';
    if (pitchRatings && Object.keys(pitchRatings).length > 0) {
      const pitchEntries = Object.entries(pitchRatings)
        .filter(([, rating]) => rating >= 25)
        .sort((a, b) => b[1] - a[1]);
      const pitchCount = pitchEntries.length;

      if (pitchCount <= 2) {
        arsenalChartHtml = `
          <div class="arsenal-section">
            <h4 class="chart-section-label">Arsenal <span class="pitch-count-badge">${pitchCount}</span></h4>
            ${this.renderArsenalBars(pitchEntries)}
          </div>
        `;
      } else {
        arsenalChartHtml = `
          <div class="arsenal-section">
            <h4 class="chart-section-label">Arsenal <span class="pitch-count-badge">${pitchCount}</span></h4>
            <div class="radar-chart-wrapper arsenal-radar-wrapper">
              <div id="pitcher-arsenal-radar-chart"></div>
            </div>
          </div>
        `;
      }
    } else if (!hasScoutingData) {
      arsenalChartHtml = `
        <div class="arsenal-section">
          <h4 class="chart-section-label">Arsenal</h4>
          <div class="radar-chart-placeholder">
            <p class="placeholder-label">No scouting data</p>
          </div>
        </div>
      `;
    }

    // Usage section (replaces stamina gauge)
    const usageHtml = this.renderUsageSection(data, stamina);

    return `
      ${usageHtml}
      ${arsenalChartHtml}
    `;
  }

  private renderArsenalBars(pitchEntries: [string, number][]): string {
    const bars = pitchEntries.map(([name, rating]) => {
      const label = this.normalizePitchName(name);
      const widthPct = Math.max(0, Math.min(100, ((rating - 20) / 60) * 100));
      return `
        <div class="arsenal-bar-item">
          <span class="arsenal-bar-label">${label}</span>
          <div class="arsenal-bar-track">
            <div class="arsenal-bar-fill" style="width: ${widthPct}%"></div>
          </div>
          <span class="arsenal-bar-value">${rating}</span>
        </div>
      `;
    }).join('');

    return `<div class="arsenal-bars">${bars}</div>`;
  }

  private renderUsageSection(data: PitcherProfileData, stamina?: number): string {
    const s = this.scoutingData;
    const pitchRatings = s?.pitches ?? data.pitchRatings;

    // Determine projected role with closer detection
    const roleInput: PitcherRoleInput = {
      pitchRatings,
      stamina,
      ootpRole: data.role,
    };
    const baseRole = determinePitcherRole(roleInput);
    let projRoleDisplay: string = baseRole;

    if (baseRole === 'RP') {
      const hasEliteStuff = (data.estimatedStuff !== undefined && data.estimatedStuff >= 65)
                         || (data.tfrStuff !== undefined && data.tfrStuff >= 65);
      if (hasEliteStuff) {
        projRoleDisplay = 'RP/CL';
      }
    }

    // Stamina bar
    let staminaBarHtml = '';
    if (stamina !== undefined) {
      const staminaWidthPct = Math.max(0, Math.min(100, ((stamina - 20) / 60) * 100));
      const staminaColor = stamina >= 70 ? '#06b6d4' : stamina >= 60 ? '#22c55e' : stamina >= 45 ? '#fbbf24' : '#6b7280';
      staminaBarHtml = `
        <div class="usage-row">
          <span class="usage-row-label">Stam:</span>
          <div class="usage-bar-track">
            <div class="usage-bar-fill" style="width: ${staminaWidthPct}%; background: ${staminaColor};">
              <span class="usage-bar-value">${stamina}</span>
            </div>
          </div>
        </div>
      `;
    }

    // Proj IP
    const projStats = this.computeProjectedStats(data);
    const projIpValue = projStats.projIp !== undefined ? `${Math.round(projStats.projIp)}` : '--';

    // Pitcher type (GB/FB tendency) and BABIP from scouting data
    const VALID_PITCHER_TYPES = new Set(['Ex FB', 'FB', 'Neu', 'GB', 'Ex GB']);
    const rawType = s?.pitcherType;
    const pitcherType = rawType && VALID_PITCHER_TYPES.has(rawType) ? rawType : undefined;
    const babip = s?.babip;

    return `
      <div class="usage-section">
        <span class="usage-section-label">Usage</span>
        ${staminaBarHtml}
        <div class="usage-badges">
          <div class="usage-badge">
            <span class="usage-badge-value">${projRoleDisplay}</span>
            <span class="usage-badge-label">Proj Role</span>
          </div>
          <div class="usage-badge usage-badge-proj">
            <span class="usage-badge-value">${projIpValue}</span>
            <span class="usage-badge-label">Proj IP</span>
          </div>
          ${pitcherType ? `<div class="usage-badge">
            <span class="usage-badge-value">${pitcherType}</span>
            <span class="usage-badge-label">Type</span>
          </div>` : ''}
          ${babip ? `<div class="usage-badge usage-badge-scout">
            <span class="usage-badge-value">${babip}</span>
            <span class="usage-badge-label">BABIP</span>
          </div>` : ''}
        </div>
      </div>
    `;
  }

  private computeProjectedStats(data: PitcherProfileData): {
    projK9?: number; projBb9?: number; projHr9?: number;
    projFip?: number; projIp?: number; projWar?: number;
  } {
    // Display-only: prefer cached projection from renderProjectionContent
    if (this._cachedProj) return this._cachedProj;

    // Fallback to data fields (all from precomputed cache)
    let projK9 = data.projK9;
    let projBb9 = data.projBb9;
    let projHr9 = data.projHr9;

    // Derive from ratings by inverting the RatingEstimatorService formulas:
    // Stuff: rating = -28 + 13.5 * k9  →  k9 = (rating + 28) / 13.5
    // Control: rating = 100.4 - 19.2 * bb9  →  bb9 = (100.4 - rating) / 19.2
    // HRA: rating = 86.7 - 41.7 * hr9  →  hr9 = (86.7 - rating) / 41.7
    // For prospects, use TFR (peak potential) instead of estimated (current TR)
    const isProspectCtx = data.isProspect === true;
    const stuffRating = (isProspectCtx && data.tfrStuff !== undefined) ? data.tfrStuff : data.estimatedStuff;
    const controlRating = (isProspectCtx && data.tfrControl !== undefined) ? data.tfrControl : data.estimatedControl;
    const hraRating = (isProspectCtx && data.tfrHra !== undefined) ? data.tfrHra : data.estimatedHra;
    if (projK9 === undefined && stuffRating !== undefined) {
      projK9 = (stuffRating + 28) / 13.5;
    }
    if (projBb9 === undefined && controlRating !== undefined) {
      projBb9 = (100.4 - controlRating) / 19.2;
    }
    if (projHr9 === undefined && hraRating !== undefined) {
      projHr9 = (86.7 - hraRating) / 41.7;
    }

    // FIP from component stats
    let projFip: number | undefined = data.projFip;
    if (projFip === undefined && projK9 !== undefined && projBb9 !== undefined && projHr9 !== undefined) {
      projFip = ((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47;
    }

    // IP: prefer caller-provided, then ProjectionService result, then fallback
    let projIp = data.projIp ?? this.projectedIp ?? undefined;
    if (projIp === undefined || projIp === null) {
      const s = this.scoutingData;
      const stamina = s?.stamina ?? data.scoutStamina;
      const injury = s?.injuryProneness ?? data.injuryProneness;
      if (stamina !== undefined) {
        projIp = this.estimateIp(stamina, injury);
      }
    }

    // WAR: use cached value if available, else compute from FIP + IP
    let projWar = data.projWar;
    if (projWar === undefined && projFip !== undefined && projIp !== undefined) {
      projWar = fipWarService.calculateWar(projFip, projIp);
    }

    return { projK9, projBb9, projHr9, projFip, projIp, projWar };
  }

  /** Estimate projected IP from stamina and injury proneness */
  private estimateIp(stamina: number, injury?: string): number {
    // Base IP from stamina: 40 → ~70 IP, 50 → ~130 IP, 60 → ~175 IP, 70 → ~200 IP
    let baseIp: number;
    if (stamina >= 65) {
      baseIp = 180 + (stamina - 65) * 1.5; // 180-202 for 65-80
    } else if (stamina >= 50) {
      baseIp = 120 + (stamina - 50) * 4; // 120-180 for 50-65
    } else if (stamina >= 35) {
      baseIp = 65 + (stamina - 35) * 3.67; // 65-120 for 35-50
    } else {
      baseIp = 40 + (stamina - 20) * 1.67; // 40-65 for 20-35
    }

    // Injury discount
    const injuryMultiplier: Record<string, number> = {
      'Iron Man': 1.15, 'Durable': 1.10, 'Normal': 1.0,
      'Wary': 0.95, 'Fragile': 0.90, 'Prone': 0.80, 'Wrecked': 0.75,
    };
    const mult = injuryMultiplier[injury ?? 'Normal'] ?? 0.95;
    return Math.round(baseIp * mult);
  }

  // ─── Radar Chart Init ────────────────────────────────────────────────

  private initRadarChart(data: PitcherProfileData): void {
    if (this.radarChart) {
      this.radarChart.destroy();
      this.radarChart = null;
    }

    const s = this.scoutingData;
    const categories = ['Stuff', 'Control', 'HRA'];
    const series: RadarChartSeries[] = [];

    const hasEstimated = data.estimatedStuff !== undefined ||
                         data.estimatedControl !== undefined ||
                         data.estimatedHra !== undefined;

    if (hasEstimated) {
      series.push({
        name: 'True Rating',
        data: [
          data.estimatedStuff ?? 50,
          data.estimatedControl ?? 50,
          data.estimatedHra ?? 50,
        ],
        color: '#3b82f6',
      });
    }

    if (data.hasTfrUpside && data.tfrStuff !== undefined) {
      series.push({
        name: 'True Future Rating',
        data: [
          data.tfrStuff ?? 50,
          data.tfrControl ?? 50,
          data.tfrHra ?? 50,
        ],
        color: '#34d399',
        dashStyle: 'dashed',
        fillOpacity: 0.05,
      });
    }

    if (s) {
      series.push({
        name: this.scoutingIsOsa ? 'OSA Scout' : 'My Scout',
        data: [s.stuff ?? 50, s.control ?? 50, s.hra ?? 50],
        color: '#8b949e',
      });
    }

    // Filter out hidden series
    const visibleSeries = series.filter(s2 => !this.hiddenSeries.has(s2.name));

    // If no visible series, render with transparent placeholder to keep the grid visible
    const chartSeries = visibleSeries.length > 0 ? visibleSeries : [{
      name: '_empty',
      data: categories.map(() => 20),
      color: 'transparent',
    }];

    this.radarChart = new RadarChart({
      containerId: 'pitcher-radar-chart',
      categories,
      series: chartSeries,
      height: 260,
      radarSize: 105,
      min: 20,
      max: 85,
      showLegend: false,
      offsetX: 0,
      onLegendClick: () => {},
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

  private initArsenalRadarChart(data: PitcherProfileData): void {
    if (this.arsenalRadarChart) {
      this.arsenalRadarChart.destroy();
      this.arsenalRadarChart = null;
    }

    // Skip if the radar chart container doesn't exist (bars rendered instead for ≤2 pitches)
    if (!this.overlay?.querySelector('#pitcher-arsenal-radar-chart')) return;

    const s = this.scoutingData;
    const pitchRatings = s?.pitches ?? data.pitchRatings;
    if (!pitchRatings || Object.keys(pitchRatings).length === 0) return;

    // Sort pitches by rating descending for consistent layout
    const pitchEntries = Object.entries(pitchRatings)
      .filter(([, rating]) => rating >= 25)
      .sort((a, b) => b[1] - a[1]);

    if (pitchEntries.length === 0) return;

    const categories = pitchEntries.map(([name]) => this.normalizePitchName(name));
    const values = pitchEntries.map(([, rating]) => rating);

    const series: RadarChartSeries[] = [{
      name: 'Pitch Rating',
      data: values,
      color: '#1d9bf0',
    }];

    this.arsenalRadarChart = new RadarChart({
      containerId: 'pitcher-arsenal-radar-chart',
      categories,
      series,
      height: 240,
      radarSize: 80,
      min: 20,
      max: 85,
      legendPosition: 'top',
      showLegend: false,
      showXaxisLabels: true,
      offsetY: -5,
    });
    this.arsenalRadarChart.render();
  }

  private static readonly PITCH_NAME_MAP: Record<string, string> = {
    // Suffixed keys (from sync-db / CSV)
    fbp: 'Fastball', chp: 'Changeup', spp: 'Splitter', cbp: 'Curveball',
    slp: 'Slider', sip: 'Sinker', ctp: 'Cutter', fop: 'Forkball',
    ccp: 'Circle Change', scp: 'Screwball', kcp: 'Knuckle Curve', knp: 'Knuckleball',
    // Raw API keys (no suffix)
    fb: 'Fastball', ch: 'Changeup', sp: 'Splitter', cb: 'Curveball',
    sl: 'Slider', si: 'Sinker', ct: 'Cutter', fo: 'Forkball',
    cc: 'Circle Change', sc: 'Screwball', kc: 'Knuckle Curve', kn: 'Knuckleball',
  };

  private normalizePitchName(raw: string): string {
    const key = raw.trim().toLowerCase();
    return PitcherProfileModal.PITCH_NAME_MAP[key]
      ?? PitcherProfileModal.PITCH_NAME_MAP[key.replace(/[^a-z]/g, '')]
      ?? (raw.endsWith('p') || raw.endsWith('P') ? raw.slice(0, -1) : raw);
  }

  private updateAxisBadgeVisibility(): void {
    if (!this.overlay) return;

    const badgeMap: Record<string, string> = {
      'True Rating': 'radar-badge-true',
      'True Future Rating': 'radar-badge-tfr',
    };
    const scoutSeriesName = this.scoutingIsOsa ? 'OSA Scout' : 'My Scout';
    badgeMap[scoutSeriesName] = 'radar-badge-scout';

    for (const [seriesName, badgeClass] of Object.entries(badgeMap)) {
      const isHidden = this.hiddenSeries.has(seriesName);
      const badges = this.overlay.querySelectorAll<HTMLElement>(`.ratings-section .${badgeClass}`);
      badges.forEach(badge => {
        badge.style.display = isHidden ? 'none' : '';
      });
    }

    const projHidden = this.hiddenSeries.has('Stat Projections');
    const projBadges = this.overlay.querySelectorAll<HTMLElement>('.radar-proj-badge');
    projBadges.forEach(badge => {
      // Don't hide the stamina IP badge
      if (badge.classList.contains('stamina-ip-badge')) return;
      badge.style.display = projHidden ? 'none' : '';
    });
  }

  /** Wire up the inline legend dots as series toggles */
  private bindLegendToggle(): void {
    const items = this.overlay?.querySelectorAll<HTMLElement>('.legend-item[data-series]');
    if (!items) return;

    // Apply initial state
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
        if (series !== 'Stat Projections' && this.currentData) {
          this.initRadarChart(this.currentData);
        }
        this.updateAxisBadgeVisibility();
      });
    });
  }

  // ─── Projection Section ─────────────────────────────────────────────

  private renderProjectionContent(data: PitcherProfileData, stats: PitcherSeasonStats[]): string {
    const showToggle = data.hasTfrUpside === true && (data.trueRating !== undefined || data.isProspect === true);
    const isPeakMode = showToggle ? this.projectionMode === 'peak' : (data.isProspect === true);

    let projK9: number, projBb9: number, projHr9: number, projFip: number, projIp: number, projWar: number;
    let age: number, ratingLabel: string, projNote: string, showActualComparison: boolean;
    let ratings: { stuff: number; control: number; hra: number };

    // Display-only path: read from precomputed cache. No computation.
    // Only fall through to computation for custom scouting.
    if (!supabaseDataService.hasCustomScouting) {
      if (isPeakMode) {
        // Peak: from TFR cache (peakK9/peakBb9/peakHr9/peakFip/peakIp/peakWar)
        projK9 = data.peakK9 ?? data.projK9 ?? 7.5;
        projBb9 = data.peakBb9 ?? data.projBb9 ?? 3.5;
        projHr9 = data.peakHr9 ?? data.projHr9 ?? 1.2;
        projFip = data.peakFip ?? data.projFip ?? 4.0;
        projIp = data.peakIp ?? data.projIp ?? 180;
        projWar = data.peakWar ?? data.projWar ?? 0;
        age = 27;
        ratingLabel = 'TFR';
        projNote = '* Peak projection based on True Future Rating. Assumes full development and peak stamina.';
        showActualComparison = false;
        ratings = {
          stuff: data.tfrStuff ?? data.estimatedStuff ?? 50,
          control: data.tfrControl ?? data.estimatedControl ?? 50,
          hra: data.tfrHra ?? data.estimatedHra ?? 50,
        };
      } else {
        // Current: from pitcher_projections cache (projK9/projBb9/projHr9/projFip/projIp/projWar)
        projK9 = data.projK9 ?? 7.5;
        projBb9 = data.projBb9 ?? 3.5;
        projHr9 = data.projHr9 ?? 1.2;
        projFip = data.projFip ?? 4.0;
        projIp = data.projIp ?? this.projectedIp ?? 180;
        projWar = data.projWar ?? 0;
        age = data.age ?? 27;
        ratingLabel = 'Estimated';
        projNote = '* Projection based on True Ratings.';
        showActualComparison = true;
        ratings = {
          stuff: data.estimatedStuff ?? 50,
          control: data.estimatedControl ?? 50,
          hra: data.estimatedHra ?? 50,
        };
      }
    } else {
      // Custom scouting path: computation required
      const proj = computePitcherProjection(data, stats, {
        projectionMode: this.projectionMode,
        scoutingData: this.scoutingData ? {
          stamina: this.scoutingData.stamina,
          injuryProneness: this.scoutingData.injuryProneness,
        } : null,
        projectedIp: this.projectedIp,
        estimateIp: (stamina, injury) => this.estimateIp(stamina, injury),
        calculateWar: (fip, ip) => fipWarService.calculateWar(fip, ip),
        parkHrFactor: data.parkHrFactor,
      });
      ({ projK9, projBb9, projHr9, projFip, projIp, projWar, age, ratingLabel, projNote, showActualComparison, ratings } = proj);
    }

    // Counting stats from rates
    const projK = Math.round(projK9 * projIp / 9);
    const projBb = Math.round(projBb9 * projIp / 9);
    const projHr = Math.round(projHr9 * projIp / 9);

    // Cache for career stats row consistency
    this._cachedProj = { projK9, projBb9, projHr9, projFip, projIp, projWar };
    const latestStat = showActualComparison ? stats.find(s => s.level === 'MLB' && s.year === this.projectionYear) : undefined;

    const formatStat = (val: number, decimals: number = 2) => val.toFixed(decimals);

    // Flip cells
    const stuffRating = this.clampRatingForDisplay(ratings.stuff);
    const controlRating = this.clampRatingForDisplay(ratings.control);
    const hraRating = this.clampRatingForDisplay(ratings.hra);

    const k9Flip = this.renderFlipCell(formatStat(projK9), stuffRating.toString(), `${ratingLabel} Stuff`);
    const bb9Flip = this.renderFlipCell(formatStat(projBb9), controlRating.toString(), `${ratingLabel} Control`);
    const hr9Flip = this.renderFlipCell(formatStat(projHr9), hraRating.toString(), `${ratingLabel} HRA`);

    // Comparison row
    let comparisonRow = '';
    if (latestStat) {
      const actualK = Math.round(latestStat.k9 * latestStat.ip / 9);
      const actualBb = Math.round(latestStat.bb9 * latestStat.ip / 9);
      const actualHr = Math.round(latestStat.hr9 * latestStat.ip / 9);
      comparisonRow = `
        <tr class="actual-row">
          <td>Actual</td>
          <td>${Math.round(latestStat.ip)}</td>
          <td>${formatStat(latestStat.fip)}</td>
          <td>${actualK}</td>
          <td>${actualBb}</td>
          <td>${actualHr}</td>
          <td>${formatStat(latestStat.k9)}</td>
          <td>${formatStat(latestStat.bb9)}</td>
          <td>${formatStat(latestStat.hr9)}</td>
          <td>${formatStat(latestStat.war, 1)}</td>
        </tr>
      `;
    }

    // Labels
    const isProspect = data.isProspect === true;
    let projectionLabel: string;
    if (isPeakMode) {
      projectionLabel = 'Peak Projection <span class="projection-age">(27yo)</span>';
    } else if (isProspect) {
      projectionLabel = 'Peak Projection <span class="projection-age">(27yo)</span>';
    } else {
      projectionLabel = `${this.projectionYear} Projection <span class="projection-age">(${age}yo)</span>`;
    }

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
                <th style="width: 55px;"></th>
                <th style="width: 40px;">IP</th>
                <th style="width: 50px;">FIP</th>
                <th style="width: 30px;">K</th>
                <th style="width: 30px;">BB</th>
                <th style="width: 30px;">HR</th>
                <th style="width: 50px;">K/9</th>
                <th style="width: 50px;">BB/9</th>
                <th style="width: 50px;">HR/9</th>
                <th style="width: 42px;">WAR</th>
              </tr>
            </thead>
            <tbody>
              <tr class="projection-row">
                <td><strong>Proj</strong></td>
                <td>${Math.round(projIp)}</td>
                <td><strong>${formatStat(projFip)}</strong></td>
                <td>${projK}</td>
                <td>${projBb}</td>
                <td>${projHr}</td>
                <td>${k9Flip}</td>
                <td>${bb9Flip}</td>
                <td>${hr9Flip}</td>
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

  // ─── Career Stats ──────────────────────────────────────────────────

  private renderCareerStatsContent(stats: PitcherSeasonStats[]): string {
    if (stats.length === 0) {
      return `<p class="no-stats">No pitching stats found for this player.</p>`;
    }

    // Build projection row from cached projection (same values as Projections tab)
    const ps = this._cachedProj;
    let projRow = '';
    if (ps) {
      const projK = Math.round(ps.projK9 * ps.projIp / 9);
      const projBb = Math.round(ps.projBb9 * ps.projIp / 9);
      const projHr = Math.round(ps.projHr9 * ps.projIp / 9);
      projRow = `
        <tr class="projection-row">
          <td style="text-align: center; font-weight: 600;" title="True Projection">TP</td>
          <td style="text-align: center;"><span class="level-badge level-mlb" style="opacity: 0.7;">PROJ</span></td>
          <td style="text-align: center;">${Math.round(ps.projIp)}</td>
          <td style="text-align: center;">${ps.projFip.toFixed(2)}</td>
          <td style="text-align: center;">${projK}</td>
          <td style="text-align: center;">${projBb}</td>
          <td style="text-align: center;">${projHr}</td>
          <td style="text-align: center;">${ps.projK9.toFixed(2)}</td>
          <td style="text-align: center;">${ps.projBb9.toFixed(2)}</td>
          <td style="text-align: center;">${ps.projHr9.toFixed(2)}</td>
          <td style="text-align: center;">${ps.projWar.toFixed(1)}</td>
        </tr>
      `;
    }

    const rows = stats.slice(0, 10).map(s => {
      const levelBadge = s.level === 'MLB'
        ? '<span class="level-badge level-mlb">MLB</span>'
        : `<span class="level-badge level-${s.level.toLowerCase()}">${s.level.toUpperCase()}</span>`;
      const isMinor = s.level !== 'MLB';
      const warCell = isMinor ? '<td class="stat-na">—</td>' : `<td style="text-align: center;">${s.war.toFixed(1)}</td>`;

      // Counting stats derived from rate stats
      const k = Math.round(s.k9 * s.ip / 9);
      const bb = Math.round(s.bb9 * s.ip / 9);
      const hr = Math.round(s.hr9 * s.ip / 9);

      const estStuff = RatingEstimatorService.estimateStuff(s.k9, s.ip).rating;
      const estControl = RatingEstimatorService.estimateControl(s.bb9, s.ip).rating;
      const estHra = RatingEstimatorService.estimateHRA(s.hr9, s.ip).rating;

      const k9Flip = this.renderFlipCell(s.k9.toFixed(2), this.clampRatingForDisplay(estStuff).toString(), `Estimated Stuff (${s.year})`);
      const bb9Flip = this.renderFlipCell(s.bb9.toFixed(2), this.clampRatingForDisplay(estControl).toString(), `Estimated Control (${s.year})`);
      const hr9Flip = this.renderFlipCell(s.hr9.toFixed(2), this.clampRatingForDisplay(estHra).toString(), `Estimated HRA (${s.year})`);

      return `
        <tr>
          <td style="text-align: center;">${s.year}</td>
          <td style="text-align: center;">${levelBadge}</td>
          <td style="text-align: center;">${Math.round(s.ip)}</td>
          <td style="text-align: center;">${s.fip.toFixed(2)}</td>
          <td style="text-align: center;">${k}</td>
          <td style="text-align: center;">${bb}</td>
          <td style="text-align: center;">${hr}</td>
          <td style="text-align: center;">${k9Flip}</td>
          <td style="text-align: center;">${bb9Flip}</td>
          <td style="text-align: center;">${hr9Flip}</td>
          ${warCell}
        </tr>
      `;
    }).join('');

    return `
      <div class="stats-table-scroll">
        <table class="profile-stats-table" style="table-layout: fixed;">
          <thead>
            <tr>
              <th style="width: 45px; text-align: center;">Year</th>
              <th style="width: 45px; text-align: center;">Level</th>
              <th style="width: 40px; text-align: center;">IP</th>
              <th style="width: 50px; text-align: center;">FIP</th>
              <th style="width: 30px; text-align: center;">K</th>
              <th style="width: 30px; text-align: center;">BB</th>
              <th style="width: 30px; text-align: center;">HR</th>
              <th style="width: 50px; text-align: center;">K/9</th>
              <th style="width: 50px; text-align: center;">BB/9</th>
              <th style="width: 50px; text-align: center;">HR/9</th>
              <th style="width: 42px; text-align: center;">WAR</th>
            </tr>
          </thead>
          <tbody>
            ${projRow}${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── Development Tab ────────────────────────────────────────────────

  private renderDevelopmentTab(playerId: number): string {
    const isProspect = this.currentData?.isProspect === true;
    const dataMode: 'true' | 'tfr' = isProspect ? 'tfr' : 'true';

    // Reset dev mode on new player
    this.devMode = 'ratings';
    this.cachedRatingSnapshots = null;
    this.cachedStatSnapshots = null;
    this.savedRatingMetrics = null;
    this.savedStatMetrics = null;

    this.activeDevMetrics = ['trueStuff', 'trueControl', 'trueHra'];

    const title = isProspect ? 'TFR Development History' : 'True Rating History';

    // MLB pitchers get Ratings/Stats toggle
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
          ${renderMetricToggles(this.activeDevMetrics, 'pitcher', dataMode)}
        </div>
        <div class="development-chart-container" id="development-chart-${playerId}"></div>
      </div>
    `;
  }

  private async initDevelopmentChart(playerId: number): Promise<void> {
    if (this.developmentChart) {
      this.developmentChart.destroy();
      this.developmentChart = null;
    }

    const isProspect = this.currentData?.isProspect === true;
    let snapshots: DevelopmentSnapshotRecord[];

    if (!isProspect) {
      // MLB pitcher: calculate historical True Ratings from stats
      snapshots = await trueRatingsService.calculateHistoricalPitcherTR(playerId);
      this.cachedRatingSnapshots = snapshots;
    } else {
      // Prospect pitcher: calculate historical TFR from scouting snapshots
      snapshots = await trueRatingsService.calculateHistoricalPitcherTFR(playerId);
    }

    const countEl = this.overlay?.querySelector('#dev-snapshot-count');
    if (countEl) {
      const label = isProspect ? 'snapshot' : 'season';
      countEl.textContent = `${snapshots.length} ${label}${snapshots.length !== 1 ? 's' : ''}`;
    }

    this.developmentChart = new DevelopmentChart({
      containerId: `development-chart-${playerId}`,
      snapshots,
      metrics: this.activeDevMetrics,
      height: 280,
      yearOnly: !isProspect,
    });
    this.developmentChart.render();

    const container = this.overlay?.querySelector('.development-section');
    if (container) {
      bindMetricToggleHandlers(container as HTMLElement, (metric, enabled) => {
        this.activeDevMetrics = applyExclusiveMetricToggle(
          container as HTMLElement, this.activeDevMetrics, metric, enabled
        );
        this.developmentChart?.updateMetrics(this.activeDevMetrics);
      });
    }

    // Bind dev mode toggle (Ratings/Stats) for MLB pitchers
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
            this.cachedStatSnapshots = await trueRatingsService.getHistoricalPitcherStats(playerId);
          }
          this.activeDevMetrics = this.savedStatMetrics || ['statBb9', 'statK9'];
          this.rerenderDevChart(this.cachedStatSnapshots, 'stats', 'pitcher', playerId);
        } else {
          if (!this.cachedRatingSnapshots) {
            this.cachedRatingSnapshots = await trueRatingsService.calculateHistoricalPitcherTR(playerId);
          }
          this.activeDevMetrics = this.savedRatingMetrics || ['trueStuff', 'trueControl', 'trueHra'];
          this.rerenderDevChart(this.cachedRatingSnapshots, 'true', 'pitcher', playerId);
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
      containerId: `development-chart-${playerId}`,
      snapshots,
      metrics: this.activeDevMetrics,
      height: 280,
      yearOnly: true,
    });
    this.developmentChart.render();
  }

  // ─── Shared Utilities ────────────────────────────────────────────────

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

  // ─── Event Binding ──────────────────────────────────────────────────

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
    this.initArsenalRadarChart(this.currentData!);
    this.bindLegendToggle();
    this.lockTabContentHeight();

    // Auto-fetch analysis if it's the default view (skip for retired players)
    if (this.viewMode === 'analysis' && !this.cachedAnalysisHtml && !this.currentData?.retired) {
      this.fetchAndRenderAnalysis();
    }
  }

  private lockTabContentHeight(): void {
    const container = this.overlay?.querySelector<HTMLElement>('.profile-tab-content');
    const panes = this.overlay?.querySelectorAll<HTMLElement>('.tab-pane');
    if (!container || !panes || panes.length === 0) return;

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

    panes.forEach((pane, i) => {
      pane.style.display = originalDisplay[i];
      pane.style.visibility = '';
      pane.style.position = '';
      pane.style.width = '';
    });

    if (maxHeight > 0) container.style.minHeight = `${maxHeight}px`;
  }

  private bindTabSwitching(): void {
    const tabs = this.overlay?.querySelectorAll<HTMLButtonElement>('.profile-tab');
    tabs?.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        if (!targetTab || tab.disabled) return;

        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const panes = this.overlay?.querySelectorAll<HTMLElement>('.tab-pane');
        panes?.forEach(pane => {
          if (pane.dataset.pane === targetTab) {
            pane.classList.add('active');
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

        // Re-render projection section (updates _lastProjection for badges/emblems)
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

        // Re-render ratings section (stat boxes + radar badges read from updated _lastProjection)
        const ratingsSection = this.overlay?.querySelector('.ratings-section');
        if (ratingsSection) {
          ratingsSection.outerHTML = this.renderRatingsSection(this.currentData);
          this.bindLegendToggle();
          this.initRadarChart(this.currentData);
          this.initArsenalRadarChart(this.currentData);
        }

        // Re-render WAR badge
        const warSlot = this.overlay?.querySelector('.war-header-slot');
        if (warSlot) warSlot.innerHTML = this.renderWarEmblem(this.currentData);
      });
    });
  }

  private async fetchAndRenderAnalysis(): Promise<void> {
    const analysisPane = this.overlay?.querySelector('.analysis-pane');
    if (!analysisPane || !this.currentData) return;

    try {
      const aiData = this.buildAIScoutingData();
      if (aiData) {
        const blurb = await aiScoutingService.getAnalysis(this.currentData.playerId, 'pitcher', aiData);
        this.cachedAnalysisHtml = this.renderAnalysisBlurb(blurb);
        analysisPane.innerHTML = this.cachedAnalysisHtml;
      }
    } catch (err) {
      console.error('Failed to generate analysis:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      analysisPane.innerHTML = `<div class="analysis-blurb"><p class="analysis-error">Failed to generate analysis: ${errorMsg}</p></div>`;
    }
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

    // Determine projected role using same logic as Team Ratings
    const s = this.scoutingData;
    const pitchRatings = s?.pitches ?? data.pitchRatings;
    const stamina = s?.stamina ?? data.scoutStamina;
    const roleInput: PitcherRoleInput = { pitchRatings, stamina, ootpRole: data.role };
    const projectedRole = determinePitcherRole(roleInput);

    // Build pitch arsenal string (e.g. "Fastball 65, Slider 55, Changeup 45")
    let pitchArsenal: string | undefined;
    if (pitchRatings) {
      const entries = Object.entries(pitchRatings)
        .filter(([, rating]) => rating >= 25)
        .sort(([, a], [, b]) => b - a);
      if (entries.length > 0) {
        pitchArsenal = entries.map(([name, rating]) => `${name} ${rating}`).join(', ');
      }
    }

    return {
      playerName: data.playerName,
      age: data.age,
      position: data.positionLabel,
      team: data.team,
      parentOrg: data.parentTeam || data.team,
      injuryProneness: this.scoutingData?.injuryProneness ?? data.injuryProneness,
      scoutStuff: this.scoutingData?.stuff ?? data.scoutStuff,
      scoutControl: this.scoutingData?.control ?? data.scoutControl,
      scoutHra: this.scoutingData?.hra ?? data.scoutHra,
      scoutStamina: this.scoutingData?.stamina ?? data.scoutStamina,
      scoutOvr: data.scoutOvr,
      scoutPot: data.scoutPot,
      trueRating: data.trueRating,
      trueFutureRating: data.trueFutureRating,
      estimatedStuff: data.estimatedStuff,
      estimatedControl: data.estimatedControl,
      estimatedHra: data.estimatedHra,
      // Use cached projections (display-only)
      ...(() => {
        const stats = this.computeProjectedStats(data);
        return {
          projFip: stats.projFip,
          projK9: stats.projK9,
          projBb9: stats.projBb9,
          projHr9: stats.projHr9,
          projWar: stats.projWar,
          projIp: stats.projIp,
        };
      })(),
      projectedRole,
      pitchArsenal,
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
                const blurb = await aiScoutingService.getAnalysis(this.currentData.playerId, 'pitcher', aiData);
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
          this.currentData.tfrStuff = altTfr.stuff;
          this.currentData.tfrControl = altTfr.control;
          this.currentData.tfrHra = altTfr.hra;
          this.currentData.trueFutureRating = altTfr.trueFutureRating;
          this.currentData.tfrPercentile = altTfr.tfrPercentile;
          // For prospects, projK9/projBb9/projHr9 come from TFR (no TR blend exists)
          if (this.currentData.isProspect) {
            this.currentData.projK9 = altTfr.projK9;
            this.currentData.projBb9 = altTfr.projBb9;
            this.currentData.projHr9 = altTfr.projHr9;
            this.currentData.projFip = altTfr.projFip;
            this.currentData.projWar = altTfr.projWar;
            this.currentData.projIp = altTfr.projIp;
            this.currentData.peakK9 = altTfr.projK9;
            this.currentData.peakBb9 = altTfr.projBb9;
            this.currentData.peakHr9 = altTfr.projHr9;
            this.currentData.peakFip = altTfr.projFip;
            this.currentData.peakWar = altTfr.projWar;
            this.currentData.peakIp = altTfr.projIp;
          }
        } else if (this.currentData.isProspect && this.drafteeInitialProj) {
          // Draftee without precomputed tfrBySource
          // If toggling back to initial source, restore exact original values
          // Restore initial snapshot (display-only, no computation)
          if (this.drafteeInitialSource === sourceKey) {
            const snap = this.drafteeInitialProj;
            this.currentData.estimatedStuff = snap.stuff;
            this.currentData.estimatedControl = snap.control;
            this.currentData.estimatedHra = snap.hra;
            this.currentData.projK9 = snap.k9;
            this.currentData.projBb9 = snap.bb9;
            this.currentData.projHr9 = snap.hr9;
            this.currentData.projFip = snap.fip;
            this.currentData.projWar = snap.war;
          }
        }

        // Swap TR/projection fields from trBySource (blended rates change with scouting)
        const altTr = this.currentData.trBySource?.[sourceKey];
        if (altTr) {
          applyPitcherTrSnapshot(this.currentData, altTr);
        }

        // Re-render projection section FIRST — updates _lastProjection for badges/emblems
        const projSection = this.overlay?.querySelector('.projection-section');
        if (projSection && this.currentData) {
          projSection.outerHTML = this.renderProjectionContent(this.currentData, this.currentStats);
          this.bindProjectionToggle();
        }

        // Re-render ratings section — reads _lastProjection for radar badges
        const ratingsSection = this.overlay?.querySelector('.ratings-section');
        if (ratingsSection) {
          ratingsSection.outerHTML = this.renderRatingsSection(this.currentData);
          this.bindScoutSourceToggle();
          this.bindLegendToggle();
          this.initRadarChart(this.currentData);
          this.initArsenalRadarChart(this.currentData);
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
export const pitcherProfileModal = new PitcherProfileModal();
