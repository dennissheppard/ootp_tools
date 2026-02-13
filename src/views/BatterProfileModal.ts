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
import { leagueBattingAveragesService } from '../services/LeagueBattingAveragesService';
import { BatterTfrSourceData } from '../services/TeamRatingsService';
import { DevelopmentSnapshotRecord } from '../services/IndexedDBService';
import { DevelopmentChart, DevelopmentMetric, renderMetricToggles, bindMetricToggleHandlers, applyExclusiveMetricToggle } from '../components/DevelopmentChart';
import { contractService, Contract } from '../services/ContractService';
import { RadarChart, RadarChartSeries } from '../components/RadarChart';
import { aiScoutingService, AIScoutingPlayerData, markdownToHtml } from '../services/AIScoutingService';

// Eagerly resolve all team logo URLs via Vite glob
const _logoModules = (import.meta as Record<string, any>).glob('../images/logos/*.png', { eager: true, import: 'default' }) as Record<string, string>;
const teamLogoMap: Record<string, string> = {};
for (const [path, url] of Object.entries(_logoModules)) {
  const filename = path.split('/').pop()?.replace('.png', '')?.toLowerCase() ?? '';
  teamLogoMap[filename] = url;
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
  private currentData: BatterProfileData | null = null;

  // Development tab state
  private developmentChart: DevelopmentChart | null = null;
  private activeDevMetrics: DevelopmentMetric[] = ['scoutPower', 'scoutEye', 'scoutAvoidK'];

  // Radar chart instances
  private radarChart: RadarChart | null = null;
  private runningRadarChart: RadarChart | null = null;

  // Contract data for current player
  private contract: Contract | null = null;

  // League WAR ceiling for arc scaling
  private leagueWarMax: number = 8;

  // Projection toggle state (Current vs Peak)
  private projectionMode: 'current' | 'peak' = 'current';
  private currentStats: BatterSeasonStats[] = [];

  // Track which radar series are hidden via legend toggle
  private hiddenSeries = new Set<string>();

  // Analysis toggle state (Projections vs True Analysis)
  private viewMode: 'projections' | 'analysis' = 'analysis';
  private cachedAnalysisHtml: string = '';

  constructor() {
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

    // Reset projection toggle
    this.projectionMode = 'current';
    // Reset analysis view
    this.viewMode = 'analysis';
    this.cachedAnalysisHtml = '';

    // Store current data for re-rendering on toggle
    this.currentData = data;

    // Store projection year (next year)
    const currentYear = await dateService.getCurrentYear();
    this.projectionYear = currentYear;

    // Update header
    const titleEl = this.overlay.querySelector<HTMLElement>('.modal-title');
    const teamEl = this.overlay.querySelector<HTMLElement>('.player-team-info');
    const ageEl = this.overlay.querySelector<HTMLElement>('.player-age-info');
    const posBadgeSlot = this.overlay.querySelector<HTMLElement>('.position-badge-slot');
    const ratingsSlot = this.overlay.querySelector<HTMLElement>('.ratings-header-slot');
    const warSlot = this.overlay.querySelector<HTMLElement>('.war-header-slot');
    const vitalsSlot = this.overlay.querySelector<HTMLElement>('.header-vitals');

    if (titleEl) {
      titleEl.textContent = data.playerName;
      titleEl.title = `ID: ${data.playerId}`;
    }
    if (teamEl) {
      const teamInfo = this.formatTeamInfo(data.team, data.parentTeam);
      teamEl.innerHTML = teamInfo;
      teamEl.style.display = teamInfo ? '' : 'none';
    }
    if (posBadgeSlot) {
      posBadgeSlot.innerHTML = this.renderPositionBadge(data);
    }
    if (ageEl) {
      ageEl.textContent = data.age ? `Age: ${data.age}` : '';
    }

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

    // Show modal with loading state
    const bodyEl = this.overlay.querySelector<HTMLElement>('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = this.renderLoadingContent();
    }

    this.overlay.classList.add('visible');
    this.overlay.setAttribute('aria-hidden', 'false');

    // Bind escape key
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this.boundKeyHandler);

    // Fetch additional data
    try {
      // Fetch scouting data, contract data, and league WAR ceiling
      const [myScoutingAll, osaScoutingAll, allContracts, lastYearBatting] = await Promise.all([
        hitterScoutingDataService.getLatestScoutingRatings('my'),
        hitterScoutingDataService.getLatestScoutingRatings('osa'),
        contractService.getAllContracts(),
        trueRatingsService.getTrueBattingStats(currentYear - 1).catch(() => [])
      ]);

      this.contract = allContracts.get(data.playerId) ?? null;

      // Compute league WAR ceiling from last year's leader
      if (lastYearBatting.length > 0) {
        const maxWar = lastYearBatting.reduce((max, p) => Math.max(max, p.war ?? 0), 0);
        this.leagueWarMax = Math.max(6, maxWar);
      }

      const myScouting = myScoutingAll.find(s => s.playerId === data.playerId);
      const osaScouting = osaScoutingAll.find(s => s.playerId === data.playerId);

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

      // Now render header slots with scouting data
      if (ratingsSlot) {
        ratingsSlot.innerHTML = this.renderRatingEmblem(data);
      }
      if (warSlot) {
        warSlot.innerHTML = this.renderWarEmblem(data);
      }
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
        for (let year = currentYear2; year >= currentYear2 - 4; year--) {
          const yearStats = await trueRatingsService.getTrueBattingStats(year);
          const playerStat = yearStats.find(s => s.player_id === data.playerId);
          if (playerStat) {
            const singles = playerStat.h - playerStat.d - playerStat.t - playerStat.hr;
            const slg = playerStat.ab > 0
              ? (singles + 2 * playerStat.d + 3 * playerStat.t + 4 * playerStat.hr) / playerStat.ab
              : 0;

            mlbStats.push({
              year: year,
              level: 'MLB',
              pa: playerStat.pa,
              avg: playerStat.avg,
              obp: playerStat.obp,
              slg: Math.round(slg * 1000) / 1000,
              hr: playerStat.hr,
              d: playerStat.d,
              t: playerStat.t,
              rbi: playerStat.rbi,
              sb: playerStat.sb,
              cs: playerStat.cs,
              bb: playerStat.bb,
              k: playerStat.k,
              war: playerStat.war
            });
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

      // Render full body
      if (bodyEl) {
        bodyEl.innerHTML = this.renderBody(data, allStats);
        this.bindBodyEvents();

        // Trigger shimmer on emblem
        requestAnimationFrame(() => {
          const emblem = this.overlay?.querySelector('.rating-emblem');
          if (emblem) emblem.classList.add('shimmer-once');
        });
      }
    } catch (error) {
      console.error('Error loading batter profile data:', error);
      if (bodyEl) {
        bodyEl.innerHTML = '<p class="error">Failed to load player data.</p>';
      }
    }
  }

  hide(): void {
    if (!this.overlay) return;

    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');

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
          <div class="ratings-radar-col">
            <div class="skeleton-radar-placeholder"></div>
          </div>
          <div class="ratings-physicals-col">
            <div class="physicals-box">
              <div class="skeleton-line sm" style="margin-bottom: 0.5rem;"></div>
              <div class="physicals-gauges">
                <div class="skeleton-gauge"></div>
                <div class="skeleton-gauge"></div>
                <div class="skeleton-gauge"></div>
              </div>
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

  private calculateProjWar(data: BatterProfileData): number | undefined {
    const s = this.scoutingData;
    const sr = s?.stealingAggressiveness ?? data.scoutSR;
    const ste = s?.stealingAbility ?? data.scoutSTE;

    let projWar = data.projWar;
    if (projWar === undefined) {
      const age = data.age ?? 27;
      const injuryProneness = s?.injuryProneness ?? data.injuryProneness;
      const projPa = data.projPa ?? leagueBattingAveragesService.getProjectedPa(injuryProneness, age);
      let badgeObp: number | undefined;
      let badgeSlg: number | undefined;

      if (data.projAvg !== undefined && data.projObp !== undefined && data.projSlg !== undefined) {
        badgeObp = data.projObp;
        badgeSlg = data.projSlg;
      } else if (data.estimatedPower !== undefined && data.estimatedEye !== undefined &&
                 data.estimatedContact !== undefined) {
        const projBbPct = HitterRatingEstimatorService.expectedBbPct(data.estimatedEye);
        const projAvg = HitterRatingEstimatorService.expectedAvg(data.estimatedContact);
        const hrPerAb = (HitterRatingEstimatorService.expectedHrPct(data.estimatedPower) / 100) / 0.88;
        const gapForBadge = data.tfrGap ?? data.estimatedGap;
        const speedForBadge = data.tfrSpeed ?? data.estimatedSpeed;
        const doublesPerAb = gapForBadge !== undefined ? HitterRatingEstimatorService.expectedDoublesRate(gapForBadge) : 0.04;
        const triplesPerAb = speedForBadge !== undefined ? HitterRatingEstimatorService.expectedTriplesRate(speedForBadge) : 0.005;
        const iso = doublesPerAb + 2 * triplesPerAb + 3 * hrPerAb;
        badgeObp = Math.min(0.450, projAvg + (projBbPct / 100));
        badgeSlg = projAvg + iso;
      }

      if (badgeObp !== undefined && badgeSlg !== undefined) {
        const lgObp = 0.320;
        const lgSlg = 0.400;
        const projOpsPlus = Math.round(100 * ((badgeObp / lgObp) + (badgeSlg / lgSlg) - 1));
        const runsPerWin = 10;
        const replacementRuns = (projPa / 600) * 20;
        const runsAboveAvg = ((projOpsPlus - 100) / 10) * (projPa / 600) * 10;
        let sbRuns = 0;
        if (sr !== undefined && ste !== undefined) {
          const sbProj = HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa);
          sbRuns = sbProj.sb * 0.2 - sbProj.cs * 0.4;
        }
        projWar = Math.round(((runsAboveAvg + replacementRuns + sbRuns) / runsPerWin) * 10) / 10;
      }
    }
    return projWar;
  }

  private renderWarEmblem(data: BatterProfileData): string {
    const projWar = this.calculateProjWar(data);
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
          <div class="emblem-gauge-score">${warText}</div>
        </div>
      </div>
    `;
  }

  private renderHeaderVitals(data: BatterProfileData): string {
    const s = this.scoutingData;
    const starsHtml = this.renderOvrPotStars(data);
    const contractHtml = this.renderContractInfo();

    const injury = s?.injuryProneness ?? data.injuryProneness ?? 'Normal';
    const injuryClass = this.getInjuryBadgeClass(injury);
    const personalityHtml = this.renderPersonalityVitalsColumn();

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
          <span class="injury-badge ${injuryClass}">${injury}</span>
        </div>
      </div>
      ${personalityHtml ? `<span class="header-divider"></span>${personalityHtml}<span class="header-divider" style="visibility:hidden;"></span>` : '<span class="header-divider" style="visibility:hidden;"></span>'}
    `;
  }

  /** Renders personality traits as a vertical column, positive on top, negative below */
  private renderPersonalityVitalsColumn(): string {
    const s = this.scoutingData;
    if (!s) return '';

    const traits: Array<{ key: string; label: string; value?: 'H' | 'N' | 'L' }> = [
      { key: 'leadership', label: 'Leadership', value: s.leadership },
      { key: 'loyalty', label: 'Loyalty', value: s.loyalty },
      { key: 'adaptability', label: 'Adaptability', value: s.adaptability },
      { key: 'greed', label: 'Greedy', value: s.greed },
      { key: 'workEthic', label: 'Work Ethic', value: s.workEthic },
      { key: 'intelligence', label: 'Intelligence', value: s.intelligence },
    ];

    const positive = traits.filter(t => t.value === 'H');
    const negative = traits.filter(t => t.value === 'L');
    if (positive.length === 0 && negative.length === 0) return '';

    const renderTrait = (t: typeof traits[0]) => {
      const levelClass = t.value === 'H' ? 'trait-high' : 'trait-low';
      const arrow = t.value === 'H' ? '▲' : '▼';
      return `<span class="personality-trait ${levelClass}"><span class="trait-arrow">${arrow}</span>${t.label}</span>`;
    };

    const positiveHtml = positive.map(renderTrait).join('');
    const negativeHtml = negative.map(renderTrait).join('');

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
    const salaryStr = this.formatSalary(currentSalary);
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
    const ratingsSection = this.renderRatingsSection(data);
    const projectionContent = this.renderProjectionContent(data, stats);
    const careerContent = this.renderCareerStatsContent(stats);

    return `
      <div class="profile-tabs">
        <button class="profile-tab active" data-tab="ratings">Ratings</button>
        <button class="profile-tab" data-tab="career">Career</button>
        <button class="profile-tab" data-tab="development">Development</button>
      </div>
      <div class="profile-tab-content">
        <div class="tab-pane active" data-pane="ratings">
          ${ratingsSection}
          <div class="analysis-toggle-row">
            <div class="analysis-toggle">
              <button class="analysis-toggle-btn ${this.viewMode === 'analysis' ? 'active' : ''}" data-view="analysis">True Analysis</button>
              <button class="analysis-toggle-btn ${this.viewMode === 'projections' ? 'active' : ''}" data-view="projections">Projections</button>
            </div>
          </div>
          <div class="analysis-content-area">
            ${this.viewMode === 'projections' ? projectionContent : (this.cachedAnalysisHtml || this.renderAnalysisLoading())}
          </div>
        </div>
        <div class="tab-pane" data-pane="career">
          ${careerContent}
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

    // Compute projected stats for badges
    const projStats = this.computeProjectedStats(data);

    const hittingAxes = [
      { label: 'Contact', pos: 'top', est: data.estimatedContact, scout: s?.contact, tfr: data.tfrContact, projLabel: 'AVG', projValue: projStats.projAvg?.toFixed(3) },
      { label: 'Eye', pos: 'upper-right', est: data.estimatedEye, scout: s?.eye, tfr: data.tfrEye, projLabel: 'BB%', projValue: projStats.projBbPct !== undefined ? projStats.projBbPct.toFixed(1) + '%' : undefined },
      { label: 'Power', pos: 'lower-right', est: data.estimatedPower, scout: s?.power, tfr: data.tfrPower, projLabel: 'HR%', projValue: projStats.projHrPct !== undefined ? projStats.projHrPct.toFixed(1) + '%' : undefined },
      { label: 'Gap', pos: 'lower-left', est: data.estimatedGap, scout: s?.gap, tfr: data.tfrGap, projLabel: '2B', projValue: projStats.proj2b?.toString() },
      { label: 'AvoidK', pos: 'upper-left', est: data.estimatedAvoidK, scout: s?.avoidK, tfr: data.tfrAvoidK, projLabel: 'K%', projValue: projStats.projKPct !== undefined ? projStats.projKPct.toFixed(1) + '%' : undefined },
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

    const runningAxes = [
      { label: 'SB Ability', pos: 'top', value: ste, projLabel: 'SB%', projValue: projStats.projSbPct !== undefined ? Math.round(projStats.projSbPct) + '%' : undefined },
      { label: 'SB Freq', pos: 'lower-right', value: sr, projLabel: 'SBA', projValue: projStats.projSba?.toString() },
      { label: 'Speed', pos: 'lower-left', value: scoutSpeed, projLabel: '3B', projValue: projStats.proj3b?.toString() },
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

    return `
      <div class="ratings-section">
        <div class="ratings-layout">
          <div class="ratings-radar-col">
            <div class="chart-section-header">
              <h4 class="chart-section-label">Hitting Ratings</h4>
              ${scoutToggleHtml}
            </div>
            <div class="radar-chart-wrapper">
              <div id="batter-radar-chart"></div>
              ${hittingAxisLabelsHtml}
            </div>
          </div>
          <div class="running-radar-col">
            <h4 class="chart-section-label">Running Ratings</h4>
            <div class="radar-chart-wrapper running-radar-wrapper">
              <div id="batter-running-radar-chart"></div>
              ${runningAxisLabelsHtml}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private computeProjectedStats(data: BatterProfileData): {
    projAvg?: number; projHrPct?: number; projBbPct?: number;
    projKPct?: number; proj2b?: number; projSba?: number;
    projSbPct?: number; proj3b?: number;
  } {
    const s = this.scoutingData;
    const sr = s?.stealingAggressiveness ?? data.scoutSR ?? 50;
    const ste = s?.stealingAbility ?? data.scoutSTE ?? 50;
    const hasSrSte = (s?.stealingAggressiveness !== undefined) || (data.scoutSR !== undefined);

    let projAvg: number | undefined;
    let projHrPct: number | undefined;
    let projBbPct: number | undefined;
    let projKPct: number | undefined;
    let proj2b: number | undefined;
    let proj3b: number | undefined;
    let projSba: number | undefined;
    let projSbPct: number | undefined;

    // For prospects, prefer TFR blended rates (which update on scout toggle)
    const isProspectCtx = data.trueRating === undefined && data.trueFutureRating !== undefined;

    if (isProspectCtx && data.tfrAvg !== undefined) {
      projAvg = data.tfrAvg;
    } else if (data.projAvg !== undefined) {
      projAvg = data.projAvg;
    } else if (data.estimatedContact !== undefined) {
      projAvg = HitterRatingEstimatorService.expectedAvg(data.estimatedContact);
    }

    if (isProspectCtx && data.tfrHrPct !== undefined) {
      projHrPct = data.tfrHrPct;
    } else if (data.projHrPct !== undefined) {
      projHrPct = data.projHrPct;
    } else if (data.estimatedPower !== undefined) {
      projHrPct = HitterRatingEstimatorService.expectedHrPct(data.estimatedPower);
    }

    if (isProspectCtx && data.tfrBbPct !== undefined) {
      projBbPct = data.tfrBbPct;
    } else if (data.projBbPct !== undefined) {
      projBbPct = data.projBbPct;
    } else if (data.estimatedEye !== undefined) {
      projBbPct = HitterRatingEstimatorService.expectedBbPct(data.estimatedEye);
    }

    if (isProspectCtx && data.tfrKPct !== undefined) {
      projKPct = data.tfrKPct;
    } else if (data.projKPct !== undefined) {
      projKPct = data.projKPct;
    } else if (data.estimatedAvoidK !== undefined) {
      projKPct = HitterRatingEstimatorService.expectedKPct(data.estimatedAvoidK);
    }

    // Projected 2B from gap rating
    const injuryProneness = s?.injuryProneness ?? data.injuryProneness;
    const age = data.age ?? 27;
    const projPa = data.projPa ?? leagueBattingAveragesService.getProjectedPa(injuryProneness, age);
    const projAb = Math.round(projPa * 0.88);

    if (data.projDoublesRate !== undefined) {
      proj2b = Math.round(projAb * data.projDoublesRate);
    } else {
      // For prospects: use TFR gap (peak potential) for peak projection, not current TR gap
      const gapForProj = data.tfrGap ?? data.estimatedGap;
      if (gapForProj !== undefined) {
        proj2b = Math.round(projAb * HitterRatingEstimatorService.expectedDoublesRate(gapForProj));
      }
    }

    // Projected 3B from speed rating
    if (data.projTriplesRate !== undefined) {
      proj3b = Math.round(projAb * data.projTriplesRate);
    } else {
      const speedForProj = data.tfrSpeed ?? data.estimatedSpeed;
      if (speedForProj !== undefined) {
        proj3b = Math.round(projAb * HitterRatingEstimatorService.expectedTriplesRate(speedForProj));
      }
    }

    // Running stats from SR/STE
    if (hasSrSte) {
      const sbProj = HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa);
      const totalSba = (data.projSb ?? sbProj.sb) + (data.projCs ?? sbProj.cs);
      projSba = totalSba;
      projSbPct = totalSba > 0 ? ((data.projSb ?? sbProj.sb) / totalSba) * 100 : undefined;
    }

    return { projAvg, projHrPct, projBbPct, projKPct, proj2b, projSba, projSbPct, proj3b };
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

    // If no series at all, don't render
    if (series.length === 0) return;

    this.radarChart = new RadarChart({
      containerId: 'batter-radar-chart',
      categories,
      series,
      height: 300,
      radarSize: 130,
      min: 20,
      max: 85,
      legendPosition: 'left',
      offsetX: -40,
      onLegendClick: (seriesName) => {
        if (this.hiddenSeries.has(seriesName)) {
          this.hiddenSeries.delete(seriesName);
        } else {
          this.hiddenSeries.add(seriesName);
        }
        this.updateAxisBadgeVisibility();
        // ApexCharts re-renders legend DOM on toggle, so re-inject custom item
        requestAnimationFrame(() => this.addProjectionLegendItem());
      },
    });
    this.radarChart.render();

    // Defer series toggles until ApexCharts has fully initialized its DOM
    const seriesNames = new Set(series.map(s => s.name));
    const seriesToHide = [...this.hiddenSeries].filter(n => n !== 'Stat Projections' && seriesNames.has(n));
    if (seriesToHide.length > 0 || this.hiddenSeries.size > 0) {
      requestAnimationFrame(() => {
        for (const name of seriesToHide) {
          this.radarChart?.toggleSeries(name);
        }
        // Re-inject custom legend item after ApexCharts legend DOM settles
        requestAnimationFrame(() => {
          this.addProjectionLegendItem();
          this.updateAxisBadgeVisibility();
        });
      });
    } else {
      this.addProjectionLegendItem();
    }
  }

  /** Inject a custom "Stat Projections" toggle into the hitting chart legend */
  private addProjectionLegendItem(): void {
    const legendContainer = this.overlay?.querySelector<HTMLElement>('.ratings-radar-col .apexcharts-legend');
    if (!legendContainer) return;

    // Remove existing custom item if present (re-injection after ApexCharts re-render)
    legendContainer.querySelector('.custom-legend-proj')?.remove();

    const isHidden = this.hiddenSeries.has('Stat Projections');

    const item = document.createElement('div');
    item.className = 'apexcharts-legend-series custom-legend-proj';
    if (isHidden) item.classList.add('apexcharts-inactive-legend');
    item.setAttribute('rel', 'custom-proj');
    item.style.display = 'flex';
    item.style.alignItems = 'center';
    item.style.cursor = 'pointer';

    item.innerHTML = `
      <span class="apexcharts-legend-marker" style="background: #d4a574; height: 16px; width: 16px; border-radius: 50%; display: inline-block; margin-right: 4px;"></span>
      <span class="apexcharts-legend-text" style="color: #e7e9ea; font-size: 11px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">Stat Projections</span>
    `;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.hiddenSeries.has('Stat Projections')) {
        this.hiddenSeries.delete('Stat Projections');
        item.classList.remove('apexcharts-inactive-legend');
      } else {
        this.hiddenSeries.add('Stat Projections');
        item.classList.add('apexcharts-inactive-legend');
      }
      this.updateAxisBadgeVisibility();
    });

    legendContainer.appendChild(item);
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
      containerId: 'batter-running-radar-chart',
      categories,
      series,
      height: 240,
      radarSize: 104,
      min: 20,
      max: 85,
      legendPosition: 'top',
      showLegend: false,
      offsetY: 20,
    });
    this.runningRadarChart.render();
  }

  private renderProjectionContent(data: BatterProfileData, stats: BatterSeasonStats[]): string {
    // Determine if toggle should be shown: MLB player with TFR upside
    const showToggle = data.hasTfrUpside === true && data.trueRating !== undefined;

    // In peak mode, use TFR component ratings and peak age
    const isPeakMode = this.projectionMode === 'peak' && showToggle;

    // Select ratings source based on mode
    // Pure prospects (no MLB TR) always show peak projection — use TFR ratings
    const isProspectPeak = data.trueRating === undefined && data.trueFutureRating !== undefined;
    const usePower = (isPeakMode || isProspectPeak) ? (data.tfrPower ?? data.estimatedPower) : data.estimatedPower;
    const useEye = (isPeakMode || isProspectPeak) ? (data.tfrEye ?? data.estimatedEye) : data.estimatedEye;
    const useAvoidK = (isPeakMode || isProspectPeak) ? (data.tfrAvoidK ?? data.estimatedAvoidK) : data.estimatedAvoidK;
    const useContact = (isPeakMode || isProspectPeak) ? (data.tfrContact ?? data.estimatedContact) : data.estimatedContact;
    const useGap = (isPeakMode || isProspectPeak) ? (data.tfrGap ?? data.estimatedGap) : data.estimatedGap;
    const useSpeed = (isPeakMode || isProspectPeak) ? (data.tfrSpeed ?? data.estimatedSpeed) : data.estimatedSpeed;

    // Get most recent year stats for comparison (only in current mode)
    const latestStat = isPeakMode ? undefined : stats.find(s => s.level === 'MLB');
    const age = isPeakMode ? 27 : (data.age ?? 27);

    // League averages for OPS+ calculation
    const lgObp = 0.320;
    const lgSlg = 0.400;

    // Calculate projected stats from ratings
    let projAvg: number;
    let projObp: number;
    let projSlg: number;
    let projBbPct: number;
    let projKPct: number;

    // Peak mode (or prospect peak): use TFR blended rates directly
    if ((isPeakMode || isProspectPeak) && data.tfrAvg !== undefined && data.tfrObp !== undefined && data.tfrSlg !== undefined) {
      projAvg = data.tfrAvg;
      projObp = data.tfrObp;
      projSlg = data.tfrSlg;
      projBbPct = data.tfrBbPct ?? 8.5;
      projKPct = data.tfrKPct ?? 22.0;
    }
    // Current mode: use pre-computed TR blended projections
    else if (!isPeakMode && !isProspectPeak && data.projAvg !== undefined && data.projObp !== undefined && data.projSlg !== undefined) {
      projAvg = data.projAvg;
      projObp = data.projObp;
      projSlg = data.projSlg;
      projBbPct = data.projBbPct ?? 8.5;
      projKPct = data.projKPct ?? 22.0;
    }
    // Fallback: derive from component ratings
    else if (usePower !== undefined && useEye !== undefined &&
             useAvoidK !== undefined && useContact !== undefined) {
      projBbPct = data.projBbPct ?? HitterRatingEstimatorService.expectedBbPct(useEye);
      projKPct = data.projKPct ?? HitterRatingEstimatorService.expectedKPct(useAvoidK);
      projAvg = HitterRatingEstimatorService.expectedAvg(useContact);
      projObp = Math.min(0.450, projAvg + (projBbPct / 100));
      const hrPerAb = (HitterRatingEstimatorService.expectedHrPct(usePower) / 100) / 0.88;
      const doublesPerAb = useGap !== undefined ? HitterRatingEstimatorService.expectedDoublesRate(useGap) : 0.04;
      const triplesPerAb = useSpeed !== undefined ? HitterRatingEstimatorService.expectedTriplesRate(useSpeed) : 0.005;
      const iso = doublesPerAb + 2 * triplesPerAb + 3 * hrPerAb;
      projSlg = projAvg + iso;
    }
    else {
      projAvg = 0.260;
      projObp = 0.330;
      projSlg = 0.420;
      projBbPct = 8.5;
      projKPct = 22.0;
    }

    // Calculate projected PA based on age and injury proneness
    const injuryProneness = this.scoutingData?.injuryProneness ?? data.injuryProneness;
    const projPa = isPeakMode
      ? (data.tfrPa ?? leagueBattingAveragesService.getProjectedPa(injuryProneness, 27))
      : (data.projPa ?? leagueBattingAveragesService.getProjectedPa(injuryProneness, age));

    // Calculate projected HR from HR%
    let projHr: number;
    if (isPeakMode && data.tfrHrPct !== undefined) {
      projHr = Math.round(projPa * (data.tfrHrPct / 100));
    } else if (!isPeakMode && data.projHr !== undefined) {
      projHr = data.projHr;
    } else if (!isPeakMode && data.projHrPct !== undefined) {
      projHr = Math.round(projPa * (data.projHrPct / 100));
    } else if (usePower !== undefined) {
      const derivedHrPct = HitterRatingEstimatorService.expectedHrPct(usePower);
      projHr = Math.round(projPa * (derivedHrPct / 100));
    } else {
      projHr = Math.round((projSlg - projAvg) * 100);
    }

    // Calculate projected 2B and 3B from doubles/triples rates
    const abPerPa = 0.88;
    const projAb = Math.round(projPa * abPerPa);
    let proj2b: number;
    let proj3b: number;
    if (!isPeakMode && data.projDoublesRate !== undefined) {
      proj2b = Math.round(projAb * data.projDoublesRate);
    } else if (useGap !== undefined) {
      proj2b = Math.round(projAb * HitterRatingEstimatorService.expectedDoublesRate(useGap));
    } else {
      proj2b = Math.round(projAb * 0.04);
    }
    if (!isPeakMode && data.projTriplesRate !== undefined) {
      proj3b = Math.round(projAb * data.projTriplesRate);
    } else if (useSpeed !== undefined) {
      proj3b = Math.round(projAb * HitterRatingEstimatorService.expectedTriplesRate(useSpeed));
    } else {
      proj3b = Math.round(projAb * 0.005);
    }

    // Calculate projected SB from SR/STE ratings
    const sr = this.scoutingData?.stealingAggressiveness ?? data.scoutSR ?? 50;
    const ste = this.scoutingData?.stealingAbility ?? data.scoutSTE ?? 50;
    const hasSrSte = (this.scoutingData?.stealingAggressiveness !== undefined) || (data.scoutSR !== undefined);
    let projSb: number;
    if (data.projSb !== undefined) {
      projSb = data.projSb;
    } else if (hasSrSte) {
      const sbProj = HitterRatingEstimatorService.projectStolenBases(sr, ste, projPa);
      projSb = sbProj.sb;
    } else {
      projSb = 0;
    }

    // Calculate OPS and OPS+
    const projOps = projObp + projSlg;
    const projOpsPlus = Math.round(100 * ((projObp / lgObp) + (projSlg / lgSlg) - 1));

    // Calculate WAR from OPS+ (rough approximation)
    const runsPerWin = 10;
    const replacementRuns = (projPa / 600) * 20;
    const runsAboveAvg = ((projOpsPlus - 100) / 10) * (projPa / 600) * 10;
    const calculatedWar = (runsAboveAvg + replacementRuns) / runsPerWin;
    const projWar = isPeakMode ? Math.round(calculatedWar * 10) / 10 : (data.projWar ?? Math.round(calculatedWar * 10) / 10);

    const formatStat = (val: number, decimals: number = 3) => val.toFixed(decimals);
    const formatPct = (val: number) => val.toFixed(1) + '%';

    // Calculate derived HR% for display
    const projHrPct = projPa > 0 ? (projHr / projPa) * 100 : 0;

    // Prepare Flip Cards
    const contactRating = this.clampRatingForDisplay(useContact ?? 50);
    const eyeRating = this.clampRatingForDisplay(useEye ?? 50);
    const powerRating = this.clampRatingForDisplay(usePower ?? 50);
    const gapRating = this.clampRatingForDisplay(useGap ?? 50);
    const speedRating = this.clampRatingForDisplay(useSpeed ?? 50);

    const ratingLabel = isPeakMode ? 'TFR' : 'Estimated';
    const avgFlip = this.renderFlipCell(formatStat(projAvg), contactRating.toString(), `${ratingLabel} Contact`);
    const bbPctFlip = this.renderFlipCell(formatPct(projBbPct), eyeRating.toString(), `${ratingLabel} Eye`);
    const kPctDisplay = formatPct(projKPct);
    const hrPctFlip = this.renderFlipCell(formatPct(projHrPct), powerRating.toString(), `${ratingLabel} Power`);
    const doublesFlip = this.renderFlipCell(proj2b.toString(), gapRating.toString(), `${ratingLabel} Gap`);
    const triplesFlip = this.renderFlipCell(proj3b.toString(), speedRating.toString(), `${ratingLabel} Speed`);

    // Show comparison to actual if we have stats (not in peak mode)
    let comparisonRow = '';
    if (latestStat) {
      const actualBbPct = latestStat.pa > 0 ? (latestStat.bb / latestStat.pa) * 100 : 0;
      const actualKPct = latestStat.pa > 0 ? (latestStat.k / latestStat.pa) * 100 : 0;
      const actualHrPct = latestStat.pa > 0 ? (latestStat.hr / latestStat.pa) * 100 : 0;
      const actualOps = latestStat.obp + latestStat.slg;
      const actualOpsPlus = Math.round(100 * ((latestStat.obp / lgObp) + (latestStat.slg / lgSlg) - 1));

      const actualRunsAboveAvg = ((actualOpsPlus - 100) / 10) * (latestStat.pa / 600) * 10;
      const actualReplacementRuns = (latestStat.pa / 600) * 20;
      const actualWar = Math.round(((actualRunsAboveAvg + actualReplacementRuns) / runsPerWin) * 10) / 10;

      comparisonRow = `
        <tr class="actual-row">
          <td>Actual</td>
          <td>${latestStat.pa}</td>
          <td>${formatStat(latestStat.avg)}</td>
          <td>${formatStat(latestStat.obp)}</td>
          <td>${formatPct(actualBbPct)}</td>
          <td>${formatPct(actualKPct)}</td>
          <td>${formatPct(actualHrPct)}</td>
          <td>${latestStat.hr}</td>
          <td>${latestStat.d ?? '—'}</td>
          <td>${latestStat.t ?? '—'}</td>
          <td>${latestStat.sb}</td>
          <td>${formatStat(latestStat.slg)}</td>
          <td>${formatStat(actualOps)}</td>
          <td>${actualOpsPlus}</td>
          <td>${typeof latestStat.war === 'number' ? formatStat(latestStat.war, 1) : formatStat(actualWar, 1)}</td>
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

    const projNote = isPeakMode
      ? '* Peak projection based on True Future Rating. Assumes full development and optimal performance.'
      : '* Projection based on True Ratings. Assumes full season health, and EVERYTHING going right for this guy.';

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
                <th style="width: 80px;"></th>
                <th style="width: 50px;">PA</th>
                <th style="width: 60px;">AVG</th>
                <th style="width: 60px;">OBP</th>
                <th style="width: 60px;">BB%</th>
                <th style="width: 60px;">K%</th>
                <th style="width: 60px;">HR%</th>
                <th style="width: 50px;">HR</th>
                <th style="width: 50px;">2B</th>
                <th style="width: 50px;">3B</th>
                <th style="width: 50px;">SB</th>
                <th style="width: 60px;">SLG</th>
                <th style="width: 60px;">OPS</th>
                <th style="width: 50px;">OPS+</th>
                <th style="width: 50px;">WAR</th>
              </tr>
            </thead>
            <tbody>
              <tr class="projection-row">
                <td><strong>Proj</strong></td>
                <td>${projPa}</td>
                <td>${avgFlip}</td>
                <td>${formatStat(projObp)}</td>
                <td>${bbPctFlip}</td>
                <td>${kPctDisplay}</td>
                <td>${hrPctFlip}</td>
                <td>${projHr}</td>
                <td>${doublesFlip}</td>
                <td>${triplesFlip}</td>
                <td>${hasSrSte ? projSb : '—'}</td>
                <td>${formatStat(projSlg)}</td>
                <td>${formatStat(projOps)}</td>
                <td><strong>${projOpsPlus}</strong></td>
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
    // League averages for OPS+ calculation
    const lgObp = 0.320;
    const lgSlg = 0.400;

    if (stats.length === 0) {
      return `<p class="no-stats">No batting stats found for this player.</p>`;
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
              <th style="width: 45px; text-align: center;">Year</th>
              <th style="width: 45px; text-align: center;">Level</th>
              <th style="width: 50px; text-align: center;">PA</th>
              <th style="width: 60px; text-align: center;">AVG</th>
              <th style="width: 60px; text-align: center;">OBP</th>
              <th style="width: 60px; text-align: center;">BB%</th>
              <th style="width: 60px; text-align: center;">K%</th>
              <th style="width: 60px; text-align: center;">HR%</th>
              <th style="width: 50px; text-align: center;">HR</th>
              <th style="width: 40px; text-align: center;">SB</th>
              <th style="width: 40px; text-align: center;">CS</th>
              <th style="width: 60px; text-align: center;">SLG</th>
              <th style="width: 60px; text-align: center;">OPS</th>
              <th style="width: 50px; text-align: center;">OPS+</th>
              <th style="width: 50px; text-align: center;">WAR</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── Development Tab ──────────────────────────────────────────────────

  private renderDevelopmentTab(playerId: number): string {
    const isProspect = this.currentData?.isProspect === true;
    const dataMode: 'true' | 'tfr' = isProspect ? 'tfr' : 'true';

    // Set default active metrics based on player type
    if (isProspect) {
      this.activeDevMetrics = ['truePower', 'trueEye', 'trueAvoidK'];
    } else {
      this.activeDevMetrics = ['truePower', 'trueEye', 'trueAvoidK'];
    }

    const title = isProspect ? 'TFR Development History' : 'True Rating History';

    return `
      <div class="development-section">
        <div class="development-header">
          <h4>${title}</h4>
          <span class="snapshot-count" id="dev-snapshot-count">Loading...</span>
        </div>
        ${renderMetricToggles(this.activeDevMetrics, 'hitter', dataMode)}
        <div class="development-chart-container" id="development-chart-${playerId}"></div>
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
      containerId: `development-chart-${playerId}`,
      snapshots,
      metrics: this.activeDevMetrics,
      height: 280,
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
      const badges = this.overlay.querySelectorAll<HTMLElement>(`.ratings-radar-col .${badgeClass}`);
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

  // ─── Event Binding ────────────────────────────────────────────────────

  private bindBodyEvents(): void {
    this.bindScoutSourceToggle();
    this.bindTabSwitching();
    this.bindProjectionToggle();
    this.bindAnalysisToggle();
    this.initRadarChart(this.currentData!);
    this.initRunningRadarChart(this.currentData!);
    this.lockTabContentHeight();

    // Auto-fetch analysis if it's the default view
    if (this.viewMode === 'analysis' && !this.cachedAnalysisHtml) {
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
        if (!targetTab) return;

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

        // Re-render just the projection section
        const projSection = this.overlay?.querySelector('.projection-section');
        if (projSection && this.currentData) {
          const newHtml = this.renderProjectionContent(this.currentData, this.currentStats);
          projSection.outerHTML = newHtml;
          // Re-bind toggle and flip card events on the new section
          this.bindProjectionToggle();
          // Re-bind flip cards in projection
          const flipCells = this.overlay?.querySelectorAll<HTMLElement>('.projection-section .flip-cell');
          flipCells?.forEach(cell => {
            cell.addEventListener('click', (e) => {
              e.stopPropagation();
              cell.classList.toggle('is-flipped');
            });
          });
        }
      });
    });
  }

  private renderAnalysisLoading(): string {
    return `
      <div class="analysis-loading">
        <span class="analysis-loading-text">Reviewing Player Data...</span>
      </div>
    `;
  }

  private renderAnalysisBlurb(text: string): string {
    return `<div class="analysis-blurb">${markdownToHtml(text)}</div>`;
  }

  private buildAIScoutingData(): AIScoutingPlayerData | null {
    const data = this.currentData;
    if (!data) return null;

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
      scoutOvr: data.scoutOvr,
      scoutPot: data.scoutPot,
      trueRating: data.trueRating,
      trueFutureRating: data.trueFutureRating,
      estimatedPower: data.estimatedPower,
      estimatedEye: data.estimatedEye,
      estimatedAvoidK: data.estimatedAvoidK,
      estimatedContact: data.estimatedContact,
      projAvg: data.projAvg,
      projObp: data.projObp,
      projSlg: data.projSlg,
      projHr: data.projHr,
      projSb: data.projSb,
      projPa: data.projPa,
      projWar: data.projWar,
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
    return {
      contractSalary: currentSalary === 0 ? 'Minimum League Contract' : this.formatSalary(currentSalary),
      contractYears: `Year ${c.currentYear + 1} of ${c.years}`,
      contractClauses: clauses.length > 0 ? clauses.join(', ') : undefined,
    };
  }

  private async fetchAndRenderAnalysis(): Promise<void> {
    const contentArea = this.overlay?.querySelector('.analysis-content-area');
    if (!contentArea || !this.currentData) return;

    try {
      const aiData = this.buildAIScoutingData();
      if (aiData) {
        const blurb = await aiScoutingService.getAnalysis(this.currentData.playerId, 'hitter', aiData);
        this.cachedAnalysisHtml = this.renderAnalysisBlurb(blurb);
        if (this.viewMode === 'analysis') {
          contentArea.innerHTML = this.cachedAnalysisHtml;
        }
      }
    } catch (err) {
      console.error('Failed to generate analysis:', err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      if (this.viewMode === 'analysis') {
        contentArea.innerHTML = `<div class="analysis-blurb"><p class="analysis-error">Failed to generate analysis: ${errorMsg}</p></div>`;
      }
    }
  }

  private bindAnalysisToggle(): void {
    if (!this.overlay || !this.currentData) return;
    const buttons = this.overlay.querySelectorAll<HTMLButtonElement>('.analysis-toggle-btn');
    if (buttons.length === 0) return;

    buttons.forEach(btn => {
      btn.addEventListener('click', async () => {
        const newView = btn.dataset.view as 'projections' | 'analysis';
        if (!newView || newView === this.viewMode) return;

        this.viewMode = newView;

        // Update button active states
        buttons.forEach(b => b.classList.toggle('active', b.dataset.view === newView));

        const contentArea = this.overlay?.querySelector('.analysis-content-area');
        if (!contentArea || !this.currentData) return;

        if (newView === 'projections') {
          // Swap back to projection table
          contentArea.innerHTML = this.renderProjectionContent(this.currentData, this.currentStats);
          this.bindProjectionToggle();
          // Re-bind flip cards in projection
          const flipCells = contentArea.querySelectorAll<HTMLElement>('.flip-cell');
          flipCells?.forEach(cell => {
            cell.addEventListener('click', (e) => {
              e.stopPropagation();
              cell.classList.toggle('is-flipped');
            });
          });
        } else {
          // Show analysis
          if (this.cachedAnalysisHtml) {
            contentArea.innerHTML = this.cachedAnalysisHtml;
          } else {
            // Show loading
            contentArea.innerHTML = this.renderAnalysisLoading();

            try {
              const aiData = this.buildAIScoutingData();
              if (aiData) {
                const blurb = await aiScoutingService.getAnalysis(this.currentData.playerId, 'hitter', aiData);
                this.cachedAnalysisHtml = this.renderAnalysisBlurb(blurb);
                // Only update if still on analysis view
                if (this.viewMode === 'analysis') {
                  contentArea.innerHTML = this.cachedAnalysisHtml;
                }
              }
            } catch (err) {
              console.error('Failed to generate analysis:', err);
              const errorMsg = err instanceof Error ? err.message : 'Unknown error';
              contentArea.innerHTML = `<div class="analysis-blurb"><p class="analysis-error">Failed to generate analysis: ${errorMsg}</p></div>`;
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
        }

        // Re-render the ratings section (radar + running chart)
        const ratingsSection = this.overlay?.querySelector('.ratings-section');
        if (ratingsSection) {
          ratingsSection.outerHTML = this.renderRatingsSection(this.currentData);
          this.bindScoutSourceToggle(); // Re-bind after re-render
          this.initRadarChart(this.currentData); // Re-init radar with new scout data
          this.initRunningRadarChart(this.currentData); // Re-init running radar
        }

        // Update header emblems after TFR swap
        const ratingsSlot = this.overlay?.querySelector('.rating-emblem-slot');
        if (ratingsSlot) ratingsSlot.innerHTML = this.renderRatingEmblem(this.currentData);
        const warSlot = this.overlay?.querySelector('.war-emblem-slot');
        if (warSlot) warSlot.innerHTML = this.renderWarEmblem(this.currentData);

        // Invalidate cached analysis since scout data changed
        this.cachedAnalysisHtml = '';

        // Re-render the projection section below (only if in projections view)
        if (this.viewMode === 'projections') {
          const projSection = this.overlay?.querySelector('.projection-section');
          if (projSection && this.currentData) {
            projSection.outerHTML = this.renderProjectionContent(this.currentData, this.currentStats);
            this.bindProjectionToggle();
          }
        }
      });
    });
  }
}

// Export singleton instance
export const batterProfileModal = new BatterProfileModal();
