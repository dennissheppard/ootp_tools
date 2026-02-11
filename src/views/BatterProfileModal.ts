/**
 * Batter Profile Modal - Full-featured modal for viewing batter details
 * Parallels PlayerProfileModal functionality for pitchers
 */

import { getPositionLabel } from '../models/Player';
import { trueRatingsService } from '../services/TrueRatingsService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { HitterScoutingRatings } from '../models/ScoutingData';
import { minorLeagueBattingStatsService } from '../services/MinorLeagueBattingStatsService';
import { dateService } from '../services/DateService';
import { HitterRatingEstimatorService } from '../services/HitterRatingEstimatorService';
import { leagueBattingAveragesService } from '../services/LeagueBattingAveragesService';
import { developmentSnapshotService } from '../services/DevelopmentSnapshotService';
import { DevelopmentSnapshotRecord } from '../services/IndexedDBService';
import { DevelopmentChart, DevelopmentMetric, renderMetricToggles, bindMetricToggleHandlers } from '../components/DevelopmentChart';

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
}

interface BatterSeasonStats {
  year: number;
  level: string;
  pa: number;
  ab: number;
  avg: number;
  obp: number;
  slg: number;
  hr: number;
  d: number;
  t: number;
  rbi: number;
  sb: number;
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
  private hasMyScout = false;
  private hasOsaScout = false;
  private myScoutingData: HitterScoutingRatings | null = null;
  private osaScoutingData: HitterScoutingRatings | null = null;
  private projectionYear: number = new Date().getFullYear();
  private currentData: BatterProfileData | null = null;

  // Development tab state
  private developmentChart: DevelopmentChart | null = null;
  private activeDevMetrics: DevelopmentMetric[] = ['scoutPower', 'scoutEye', 'scoutAvoidK'];

  // Advanced ratings accordion state
  private advancedRatingsExpanded = false;

  // Projection toggle state (Current vs Peak)
  private projectionMode: 'current' | 'peak' = 'current';
  private currentStats: BatterSeasonStats[] = [];

  constructor() {
    this.advancedRatingsExpanded = localStorage.getItem('wbl_expanded_ratings_expanded') === 'true';
    this.ensureOverlayExists();
  }

  private ensureOverlayExists(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay batter-profile-modal';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `
      <div class="modal modal-lg modal-draggable">
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
            <div class="metadata-header-slot"></div>
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
    const metadataSlot = this.overlay.querySelector<HTMLElement>('.metadata-header-slot');

    if (titleEl) titleEl.textContent = data.playerName;
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
      // Fetch scouting data - prefer "my" over OSA
      const [myScoutingAll, osaScoutingAll] = await Promise.all([
        hitterScoutingDataService.getLatestScoutingRatings('my'),
        hitterScoutingDataService.getLatestScoutingRatings('osa')
      ]);

      const myScouting = myScoutingAll.find(s => s.playerId === data.playerId);
      const osaScouting = osaScoutingAll.find(s => s.playerId === data.playerId);

      // Store both for dropdown toggle
      this.myScoutingData = myScouting ?? null;
      this.osaScoutingData = osaScouting ?? null;
      this.hasMyScout = !!myScouting;
      this.hasOsaScout = !!osaScouting;

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
      if (metadataSlot) {
        metadataSlot.innerHTML = this.renderHeaderMetadata(data);
      }

      // Fetch batting stats history
      const currentYear = await dateService.getCurrentYear();

      // Fetch minor league batting stats
      let minorStats: BatterSeasonStats[] = [];
      try {
        const minorBattingStats = await minorLeagueBattingStatsService.getPlayerStats(
          data.playerId,
          currentYear - 5,
          currentYear
        );
        minorStats = minorBattingStats.map(s => ({
          year: s.year,
          level: s.level,
          pa: s.pa,
          ab: s.ab,
          avg: s.avg,
          obp: s.obp,
          slg: s.slg,
          hr: s.hr,
          d: s.d,
          t: s.t,
          rbi: 0,
          sb: s.sb,
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
        for (let year = currentYear; year >= currentYear - 4; year--) {
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
              ab: playerStat.ab,
              avg: playerStat.avg,
              obp: playerStat.obp,
              slg: Math.round(slg * 1000) / 1000,
              hr: playerStat.hr,
              d: playerStat.d,
              t: playerStat.t,
              rbi: playerStat.rbi,
              sb: playerStat.sb,
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

        // Trigger shimmer animation on rating bars
        requestAnimationFrame(() => {
          const estimatedBars = bodyEl.querySelectorAll<HTMLElement>('.bar-estimated');
          estimatedBars.forEach(bar => bar.classList.add('shimmer-once'));

          const scoutBars = bodyEl.querySelectorAll<HTMLElement>('.bar-scout');
          scoutBars.forEach(bar => bar.classList.add('shimmer-once'));

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

  private renderPositionBadge(data: BatterProfileData): string {
    const posLabel = data.positionLabel || (data.position ? getPositionLabel(data.position) : 'Unknown');
    const posClass = this.getPositionClass(data.position);
    return `<span class="position-badge ${posClass}">${posLabel}</span>`;
  }

  private renderLoadingContent(): string {
    return `
      <div class="player-modal-loading">
        <div class="ratings-comparison loading-skeleton">
          <div class="rating-row rating-row-header">
            <span class="rating-label"></span>
            <div class="rating-bars">
              <span class="bar-header skeleton-line sm"></span>
              <span class="bar-vs"></span>
              <span class="bar-header skeleton-line sm"></span>
              <span class="rating-diff"></span>
            </div>
          </div>
          ${Array.from({ length: 4 }, () => `
            <div class="rating-row">
              <span class="rating-label"><span class="skeleton-line xs"></span></span>
              <div class="rating-bars">
                <div class="bar-container skeleton-bar"></div>
                <span class="rating-diff"><span class="skeleton-line xs"></span></span>
                <span class="bar-vs">vs</span>
                <div class="bar-container skeleton-bar"></div>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="projection-section loading-skeleton">
          <h4 class="skeleton-line md"></h4>
          <div class="stats-table-container">
            <table class="stats-table skeleton-table">
              <thead>
                <tr>
                  ${Array.from({ length: 8 }, () => '<th><span class="skeleton-line xs"></span></th>').join('')}
                </tr>
              </thead>
              <tbody>
                <tr>
                  ${Array.from({ length: 8 }, () => '<td><span class="skeleton-line xs"></span></td>').join('')}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="stats-history loading-skeleton">
          <h4 class="section-label skeleton-line sm"></h4>
          <div class="table-wrapper">
            <table class="stats-table skeleton-table">
              <thead>
                <tr>
                  ${Array.from({ length: 10 }, () => '<th><span class="skeleton-line xs"></span></th>').join('')}
                </tr>
              </thead>
              <tbody>
                ${Array.from({ length: 5 }, () => `
                  <tr>
                    ${Array.from({ length: 10 }, () => '<td><span class="skeleton-line xs"></span></td>').join('')}
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
    const barWidth = Math.max(10, Math.min(100, (ratingValue / 5) * 100));
    const label = useTfr ? 'True Future Rating' : 'True Rating';

    // Show "Peak" indicator when player has TFR upside (TFR > TR by ≥ 0.25 stars)
    let upsideHtml = '';
    if (data.hasTfrUpside && hasTr && hasTfr && (data.trueFutureRating! - data.trueRating! >= 0.25)) {
        upsideHtml = `<div class="rating-emblem-upside" title="True Future Rating: ${data.trueFutureRating!.toFixed(1)}">
            <span class="upside-label">↗ Peak</span>
            <span class="upside-value">${data.trueFutureRating!.toFixed(1)}</span>
        </div>`;
    }

    return `
      <div class="rating-emblem ${badgeClass}">
        <div class="rating-emblem-header">
          <span class="rating-emblem-label">${label}</span>
        </div>
        <div class="rating-emblem-body">
          <div class="rating-emblem-bar">
            <div class="rating-emblem-bar-fill" style="width: ${barWidth}%"></div>
          </div>
          <div class="rating-emblem-score">${ratingValue.toFixed(1)}</div>
        </div>
        ${percentileText ? `<div class="rating-emblem-meta">${percentileText}</div>` : ''}
        ${upsideHtml}
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

  private renderHeaderMetadata(data: BatterProfileData): string {
    const s = this.scoutingData;

    // OVR/POT stars
    const ovr = s?.ovr ?? data.scoutOvr;
    const pot = s?.pot ?? data.scoutPot;
    const starsText = typeof ovr === 'number' && typeof pot === 'number'
      ? `${ovr.toFixed(1)}★ / ${pot.toFixed(1)}★`
      : '--';

    // WAR badge - use projWar if provided, otherwise calculate from blended rates or estimated ratings
    let projWar = data.projWar;
    if (projWar === undefined) {
      const age = data.age ?? 27;
      const injuryProneness = s?.injuryProneness ?? data.injuryProneness;
      const projPa = data.projPa ?? leagueBattingAveragesService.getProjectedPa(injuryProneness, age);
      let badgeObp: number | undefined;
      let badgeSlg: number | undefined;

      // Prefer blended rates (passed for MLB players) over re-deriving from True Ratings
      if (data.projAvg !== undefined && data.projObp !== undefined && data.projSlg !== undefined) {
        badgeObp = data.projObp;
        badgeSlg = data.projSlg;
      } else if (data.estimatedPower !== undefined && data.estimatedEye !== undefined &&
                 data.estimatedContact !== undefined) {
        const projBbPct = HitterRatingEstimatorService.expectedBbPct(data.estimatedEye);
        const projAvg = HitterRatingEstimatorService.expectedAvg(data.estimatedContact);
        // Compute ISO from all XBH components when Gap/Speed available
        const hrPerAb = (HitterRatingEstimatorService.expectedHrPct(data.estimatedPower) / 100) / 0.88;
        const doublesPerAb = data.estimatedGap !== undefined ? HitterRatingEstimatorService.expectedDoublesRate(data.estimatedGap) : 0.04;
        const triplesPerAb = data.estimatedSpeed !== undefined ? HitterRatingEstimatorService.expectedTriplesRate(data.estimatedSpeed) : 0.005;
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
        projWar = Math.round(((runsAboveAvg + replacementRuns) / runsPerWin) * 10) / 10;
      }
    }
    const warBadgeClass = this.getWarBadgeClass(projWar);
    const warText = typeof projWar === 'number' ? projWar.toFixed(1) : '--';
    const warLabel = data.isProspect ? 'Proj Peak WAR' : 'Proj WAR';

    // Injury donut chart
    const injury = s?.injuryProneness ?? data.injuryProneness ?? 'Normal';
    const injuryDonut = this.renderInjuryDonut(injury);

    // Speed donut chart (scout speed - 20-80 scale)
    const scoutSpeed = s?.speed ?? data.scoutSpeed ?? 50;
    const speedDonut = this.renderSpeedDonut(scoutSpeed);

    return `
      <div class="header-metadata">
        <div class="metadata-col metadata-war-col">
          <div class="war-badge ${warBadgeClass}">
            <span class="war-value">${warText}</span>
            <span class="war-label">${warLabel}</span>
          </div>
        </div>
        <div class="metadata-col metadata-stats-col">
          <div class="metadata-donuts-row">
            ${injuryDonut}
            ${speedDonut}
          </div>
          <div class="metadata-stars">${starsText}</div>
        </div>
      </div>
    `;
  }

  private renderInjuryDonut(injury: string): string {
    // Map injury proneness to a percentage (Durable/Ironman = high, Fragile/Prone = low)
    const injuryMap: Record<string, { pct: number; colorClass: string }> = {
      'Ironman': { pct: 100, colorClass: 'injury-durable' },
      'Durable': { pct: 85, colorClass: 'injury-durable' },
      'Normal': { pct: 60, colorClass: 'injury-normal' },
      'Wary': { pct: 40, colorClass: 'injury-wary' },
      'Fragile': { pct: 20, colorClass: 'injury-fragile' },
      'Prone': { pct: 10, colorClass: 'injury-prone' },
      'Wrecked': { pct: 5, colorClass: 'injury-prone' },
    };
    const info = injuryMap[injury] ?? { pct: 60, colorClass: 'injury-normal' };

    // SVG circle parameters
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (info.pct / 100) * circumference;

    return `
      <div class="header-donut" title="Injury: ${injury}">
        <svg class="stat-donut" viewBox="0 0 24 24" width="24" height="24">
          <circle class="stat-donut-bg" cx="12" cy="12" r="${radius}" />
          <circle
            class="stat-donut-fill ${info.colorClass}"
            cx="12"
            cy="12"
            r="${radius}"
            stroke-dasharray="${circumference}"
            style="--donut-offset: ${strokeDashoffset}; --donut-circumference: ${circumference};"
          />
        </svg>
        <span class="donut-label">INJ</span>
      </div>
    `;
  }

  private renderSpeedDonut(speed: number): string {
    // Speed is on 20-80 scale (same as other ratings), map to percentage
    const percentage = Math.max(0, Math.min(100, ((speed - 20) / 60) * 100));

    // Color class based on speed value (20-80 scale)
    const colorClass = speed >= 70 ? 'rating-elite' :
                       speed >= 60 ? 'rating-plus' :
                       speed >= 45 ? 'rating-avg' :
                       'rating-poor';

    // SVG circle parameters
    const radius = 10;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;

    return `
      <div class="header-donut" title="Speed: ${speed}">
        <svg class="stat-donut" viewBox="0 0 24 24" width="24" height="24">
          <circle class="stat-donut-bg" cx="12" cy="12" r="${radius}" />
          <circle
            class="stat-donut-fill ${colorClass}"
            cx="12"
            cy="12"
            r="${radius}"
            stroke-dasharray="${circumference}"
            style="--donut-offset: ${strokeDashoffset}; --donut-circumference: ${circumference};"
          />
        </svg>
        <span class="donut-label">SPD</span>
      </div>
    `;
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

  private getRatingBarClass(value: number): string {
    if (value >= 70) return 'rating-elite';
    if (value >= 60) return 'rating-plus';
    if (value >= 50) return 'rating-avg';
    if (value >= 40) return 'rating-fringe';
    return 'rating-poor';
  }

  private renderBody(data: BatterProfileData, stats: BatterSeasonStats[]): string {
    const ratingsComparison = this.renderRatingsComparison(data);
    const advancedRatings = this.renderAdvancedRatings(data);
    const projectionSection = this.renderProjection(data, stats);
    const statsSection = this.renderStatsTable(stats);

    return `
      <div class="profile-tabs">
        <button class="profile-tab active" data-tab="ratings">Ratings</button>
        <button class="profile-tab" data-tab="development">Development</button>
      </div>
      <div class="profile-tab-content">
        <div class="tab-pane active" data-pane="ratings">
          <div class="profile-body">
            ${ratingsComparison}
            ${advancedRatings}
            ${projectionSection}
            ${statsSection}
          </div>
        </div>
        <div class="tab-pane" data-pane="development">
          ${this.renderDevelopmentTab(data.playerId)}
        </div>
      </div>
    `;
  }

  private renderDevelopmentTab(playerId: number): string {
    const isProspect = this.currentData?.isProspect === true;
    const dataMode = isProspect ? 'scout' : 'true';

    // Set default active metrics based on player type
    if (!isProspect) {
      this.activeDevMetrics = ['truePower', 'trueEye', 'trueAvoidK', 'trueContact'];
    } else {
      this.activeDevMetrics = ['scoutPower', 'scoutEye', 'scoutAvoidK'];
    }

    return `
      <div class="development-section">
        <div class="development-header">
          <h4>${isProspect ? 'Development History' : 'True Rating History'}</h4>
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
      // MLB player: calculate historical True Ratings from stats
      snapshots = await trueRatingsService.calculateHistoricalBatterTR(playerId);
    } else {
      // Prospect: use scouting snapshots
      const allSnapshots = await developmentSnapshotService.getPlayerSnapshots(playerId);
      snapshots = allSnapshots.filter(s =>
        s.playerType === 'hitter' || s.scoutPower !== undefined || s.scoutEye !== undefined
      );
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
        if (enabled && !this.activeDevMetrics.includes(metric)) {
          this.activeDevMetrics.push(metric);
        } else if (!enabled) {
          this.activeDevMetrics = this.activeDevMetrics.filter(m => m !== metric);
        }
        this.developmentChart?.updateMetrics(this.activeDevMetrics);
      });
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

  private renderProjection(data: BatterProfileData, stats: BatterSeasonStats[]): string {
    // Determine if toggle should be shown: MLB player with TFR upside
    const showToggle = data.hasTfrUpside === true && data.trueRating !== undefined;

    // In peak mode, use TFR component ratings and peak age
    const isPeakMode = this.projectionMode === 'peak' && showToggle;

    // Select ratings source based on mode
    const usePower = isPeakMode ? (data.tfrPower ?? data.estimatedPower) : data.estimatedPower;
    const useEye = isPeakMode ? (data.tfrEye ?? data.estimatedEye) : data.estimatedEye;
    const useAvoidK = isPeakMode ? (data.tfrAvoidK ?? data.estimatedAvoidK) : data.estimatedAvoidK;
    const useContact = isPeakMode ? (data.tfrContact ?? data.estimatedContact) : data.estimatedContact;
    const useGap = isPeakMode ? (data.tfrGap ?? data.estimatedGap) : data.estimatedGap;
    const useSpeed = isPeakMode ? (data.tfrSpeed ?? data.estimatedSpeed) : data.estimatedSpeed;

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

    // Peak mode: use TFR blended rates directly (avoids lossy rating→rate round-trip)
    if (isPeakMode && data.tfrAvg !== undefined && data.tfrObp !== undefined && data.tfrSlg !== undefined) {
      projAvg = data.tfrAvg;
      projObp = data.tfrObp;
      projSlg = data.tfrSlg;
      projBbPct = data.tfrBbPct ?? 8.5;
      projKPct = data.tfrKPct ?? 22.0;
    }
    // Current mode: use pre-computed TR blended projections
    else if (!isPeakMode && data.projAvg !== undefined && data.projObp !== undefined && data.projSlg !== undefined) {
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
      // Compute ISO from all XBH components (HR + 2B + 3B) — not the deprecated expectedIso which ignores Gap/Speed
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

    // Prepare Flip Cards — in peak mode show TFR ratings, in current mode show estimated ratings
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
          <td>${formatStat(latestStat.slg)}</td>
          <td>${formatStat(actualOps)}</td>
          <td>${actualOpsPlus}</td>
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

    // Toggle HTML
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
        ${toggleHtml}
        <h4 class="section-label">${projectionLabel}</h4>
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

  private renderRatingsComparison(data: BatterProfileData): string {
    const s = this.scoutingData;
    const hasScout = s !== null;
    const hasAlternative = this.hasMyScout && this.hasOsaScout;

    // Check if we have any estimated ratings (performance-derived)
    const hasEstimatedRatings = data.estimatedContact !== undefined ||
                                 data.estimatedPower !== undefined ||
                                 data.estimatedEye !== undefined ||
                                 data.estimatedAvoidK !== undefined;

    // For prospects without estimated ratings, just show scout opinions
    if (hasScout && !hasEstimatedRatings) {
      let headerLabel = '';
      if (hasAlternative) {
        const activeSource = this.scoutingIsOsa ? 'osa' : 'my';
        headerLabel = `
          <div class="scout-header-toggle custom-dropdown">
            <span class="dropdown-trigger" data-player-id="${data.playerId}">${activeSource === 'my' ? 'My' : 'OSA'}</span>
            <div class="dropdown-menu">
              <div class="dropdown-item ${activeSource === 'my' ? 'active' : ''}" data-value="my">My</div>
              <div class="dropdown-item ${activeSource === 'osa' ? 'active' : ''}" data-value="osa">OSA</div>
            </div>
          </div>
          Scout Ratings`;
      } else {
        const sourceLabel = this.scoutingIsOsa ? 'OSA' : 'My Scout';
        const sourceBadgeClass = this.scoutingIsOsa ? 'osa' : 'my';
        headerLabel = `<span class="source-badge ${sourceBadgeClass}">${sourceLabel}</span> Scout Ratings`;
      }

      return `
        <div class="ratings-comparison">
          <div class="rating-row rating-row-header">
            <span class="rating-label"></span>
            <div class="rating-bars">
              <span class="bar-header">${headerLabel}</span>
            </div>
          </div>
          ${this.renderRatingBar('Contact', s.contact ?? 50)}
          ${this.renderRatingBar('Power', s.power)}
          ${this.renderRatingBar('Eye', s.eye)}
        </div>
      `;
    }

    if (!hasScout) {
      return `
        <div class="ratings-comparison">
          <div class="rating-row rating-row-header">
            <span class="rating-label"></span>
            <div class="rating-bars">
              <span class="bar-header" title="Derived from performance data and advanced metrics" style="cursor: help;">True Ratings</span>
            </div>
          </div>
          ${this.renderRatingBar('Contact', data.estimatedContact)}
          ${this.renderRatingBar('Power', data.estimatedPower)}
          ${this.renderRatingBar('Eye', data.estimatedEye)}
        </div>
      `;
    }

    // Build header with toggle (if both sources exist) or badge (if only one)
    let headerLabel = '';
    if (hasAlternative) {
      const activeSource = this.scoutingIsOsa ? 'osa' : 'my';
      headerLabel = `
        <div class="scout-header-toggle custom-dropdown">
          <span class="dropdown-trigger" data-player-id="${data.playerId}">${activeSource === 'my' ? 'My' : 'OSA'}</span>
          <div class="dropdown-menu">
            <div class="dropdown-item ${activeSource === 'my' ? 'active' : ''}" data-value="my">My</div>
            <div class="dropdown-item ${activeSource === 'osa' ? 'active' : ''}" data-value="osa">OSA</div>
          </div>
        </div>
        Scout Opinions`;
    } else {
      const sourceLabel = this.scoutingIsOsa ? 'OSA' : 'My Scout';
      const sourceBadgeClass = this.scoutingIsOsa ? 'osa' : 'my';
      headerLabel = `<span class="source-badge ${sourceBadgeClass}">${sourceLabel}</span> Scout Opinions`;
    }

    return `
      <div class="ratings-comparison">
        <div class="rating-row rating-row-header">
          <span class="rating-label"></span>
          <div class="rating-bars">
            <div class="rating-bars-left">
              <span class="bar-header" title="Normalized ratings based on percentile rank among all prospects/players" style="cursor: help;">True Ratings</span>
            </div>
            <div class="rating-bars-center">
              <span class="bar-vs"></span>
            </div>
            <div class="rating-bars-right">
              <span class="bar-header">${headerLabel}</span>
            </div>
          </div>
        </div>
        ${this.renderRatingBarComparison('Contact', data.estimatedContact, s.contact ?? 50, data.tfrContact)}
        ${this.renderRatingBarComparison('Power', data.estimatedPower, s.power, data.tfrPower)}
        ${this.renderRatingBarComparison('Eye', data.estimatedEye, s.eye, data.tfrEye)}
      </div>
    `;
  }

  private renderRatingBar(label: string, value?: number): string {
    const val = value ?? 50;
    const percentage = Math.max(0, Math.min(100, ((val - 20) / 60) * 100));
    const barClass = this.getRatingBarClass(val);
    const displayValue = Math.round(Math.max(20, Math.min(80, val)));

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-bars">
          <div class="bar-container">
            <div class="bar bar-estimated ${barClass}" style="width: ${percentage}%"></div>
            <span class="bar-value">${displayValue}</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderRatingBarComparison(label: string, trueValue?: number, scoutValue?: number, ceiling?: number): string {
    const tv = trueValue ?? 50;
    const sv = scoutValue ?? 50;
    const truePercent = Math.max(0, Math.min(100, ((tv - 20) / 60) * 100));
    const scoutPercent = Math.max(0, Math.min(100, ((sv - 20) / 60) * 100));
    const trueBarClass = this.getRatingBarClass(tv);
    const scoutBarClass = this.getRatingBarClass(sv);
    const trueDisplay = Math.round(Math.max(20, Math.min(80, tv)));
    const scoutDisplay = Math.round(Math.max(20, Math.min(80, sv)));
    // Diff uses TFR (peak) vs scout (also peak) when ceiling available, otherwise TR vs scout
    const ceilingForDiff = (ceiling !== undefined && !isNaN(ceiling)) ? Math.round(Math.max(20, Math.min(80, ceiling))) : undefined;
    const diffValue = (ceilingForDiff !== undefined && ceilingForDiff > trueDisplay) ? ceilingForDiff : trueDisplay;
    const diff = diffValue - scoutDisplay;
    const diffText = diff > 0 ? `+${diff}` : diff === 0 ? '—' : `${diff}`;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-neutral';

    // Ceiling bar (TFR component extension) — only show when ceiling > true value
    let ceilingHtml = '';
    let barInnerHtml = '';
    let barValueHtml = `<span class="bar-value">${trueDisplay}</span>`;
    if (ceiling !== undefined && !isNaN(ceiling)) {
      const ceilingClamped = Math.round(Math.max(20, Math.min(80, ceiling)));
      if (ceilingClamped > trueDisplay) {
        const ceilingClass = this.getRatingBarClass(ceilingClamped);
        const ceilingPercent = Math.max(0, Math.min(100, ((ceilingClamped - 20) / 60) * 100));
        const extensionPercent = ceilingPercent - truePercent;
        ceilingHtml = `<div class="bar bar-ceiling ${ceilingClass}" style="left: ${truePercent}%; width: ${extensionPercent}%" title="TFR Ceiling: ${ceilingClamped}"></div>`;
        barInnerHtml = `<span class="bar-value-inner">${trueDisplay}</span>`;
        barValueHtml = `<span class="bar-value">${ceilingClamped}</span>`;
      }
    }

    return `
      <div class="rating-row">
        <span class="rating-label">${label}</span>
        <div class="rating-bars">
          <div class="rating-bars-left">
            <div class="bar-container">
              <div class="bar bar-estimated ${trueBarClass}" style="width: ${truePercent}%">${barInnerHtml}</div>
              ${ceilingHtml}
              ${barValueHtml}
            </div>
          </div>
          <div class="rating-bars-center">
            <span class="rating-diff ${diffClass}">${diffText}</span>
            <span class="bar-vs">vs</span>
          </div>
          <div class="rating-bars-right">
            <div class="bar-container bar-container-rtl">
              <div class="bar bar-scout ${scoutBarClass}" style="width: ${scoutPercent}%"></div>
              <span class="bar-value">${scoutDisplay}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderAdvancedRatings(data: BatterProfileData): string {
    const s = this.scoutingData;

    // Scout values with fallbacks
    const scoutGap = s?.gap ?? data.scoutGap ?? 50;
    const scoutAvoidK = s?.avoidK ?? data.scoutAvoidK ?? 50;

    // True (estimated) values - may be undefined for prospects without stats
    const trueGap = data.estimatedGap;
    const trueAvoidK = data.estimatedAvoidK;

    // Check if we have any true ratings to show comparisons
    const hasTrue = trueGap !== undefined || trueAvoidK !== undefined;

    const expandedClass = this.advancedRatingsExpanded ? 'expanded' : '';
    const toggleIcon = this.advancedRatingsExpanded ? '▾' : '▸';

    // Decide rendering mode: comparison or scout-only
    let ratingsContent: string;
    if (hasTrue) {
      ratingsContent = `
        <div class="advanced-ratings-comparison">
          <div class="rating-row rating-row-header">
            <span class="rating-label"></span>
            <div class="rating-bars">
              <span class="bar-header">True</span>
              <span class="bar-vs"></span>
              <span class="bar-header">Scout</span>
            </div>
          </div>
          ${this.renderAdvancedRatingComparison('Gap', trueGap, scoutGap, 20, 80, this.currentData?.tfrGap)}
          ${this.renderAdvancedRatingComparison('AvoidK', trueAvoidK, scoutAvoidK, 20, 80, this.currentData?.tfrAvoidK)}
        </div>
      `;
    } else {
      ratingsContent = `
        ${this.renderAdvancedRatingBar('Gap', scoutGap, 20, 80)}
        ${this.renderAdvancedRatingBar('AvoidK', scoutAvoidK, 20, 80)}
      `;
    }

    return `
      <div class="advanced-ratings-section ${expandedClass}">
        <button class="advanced-ratings-toggle" aria-expanded="${this.advancedRatingsExpanded}">
          <span class="toggle-icon">${toggleIcon}</span>
          Expanded Ratings
        </button>
        <div class="advanced-ratings-content">
          ${ratingsContent}
        </div>
      </div>
    `;
  }

  private renderAdvancedRatingComparison(label: string, trueValue: number | undefined, scoutValue: number, min: number, max: number, ceiling?: number): string {
    const isSpeed = label === 'Speed';
    const tv = trueValue ?? scoutValue; // fallback to scout if no true value
    const sv = scoutValue;
    const truePercent = Math.max(0, Math.min(100, ((tv - min) / (max - min)) * 100));
    const scoutPercent = Math.max(0, Math.min(100, ((sv - min) / (max - min)) * 100));
    const trueBarClass = isSpeed ? this.getSpeedBarClass(tv) : this.getRatingBarClass(tv);
    const scoutBarClass = isSpeed ? this.getSpeedBarClass(sv) : this.getRatingBarClass(sv);
    const trueDisplay = Math.round(tv);
    const scoutDisplay = Math.round(sv);
    // Diff uses TFR (peak) vs scout (also peak) when ceiling available, otherwise TR vs scout
    const ceilingForDiff = (ceiling !== undefined && !isNaN(ceiling)) ? Math.round(Math.max(min, Math.min(max, ceiling))) : undefined;
    const diffValue = (ceilingForDiff !== undefined && ceilingForDiff > trueDisplay) ? ceilingForDiff : trueDisplay;
    const diff = diffValue - scoutDisplay;
    const diffText = diff > 0 ? `+${diff}` : diff === 0 ? '—' : `${diff}`;
    const diffClass = diff > 0 ? 'diff-positive' : diff < 0 ? 'diff-negative' : 'diff-neutral';

    // Ceiling bar for advanced ratings
    let ceilingHtml = '';
    let barInnerHtml = '';
    let barValueHtml = `<span class="bar-value">${trueDisplay}</span>`;
    if (ceiling !== undefined && !isNaN(ceiling)) {
      const ceilingClamped = Math.round(Math.max(min, Math.min(max, ceiling)));
      if (ceilingClamped > trueDisplay) {
        const ceilingClass = isSpeed ? this.getSpeedBarClass(ceilingClamped) : this.getRatingBarClass(ceilingClamped);
        const ceilingPercent = Math.max(0, Math.min(100, ((ceilingClamped - min) / (max - min)) * 100));
        const extensionPercent = ceilingPercent - truePercent;
        ceilingHtml = `<div class="bar bar-ceiling ${ceilingClass}" style="left: ${truePercent}%; width: ${extensionPercent}%" title="TFR Ceiling: ${ceilingClamped}"></div>`;
        barInnerHtml = `<span class="bar-value-inner">${trueDisplay}</span>`;
        barValueHtml = `<span class="bar-value">${ceilingClamped}</span>`;
      }
    }

    return `
      <div class="rating-row rating-row-advanced">
        <span class="rating-label">${label}</span>
        <div class="rating-bars">
          <div class="rating-bars-left">
            <div class="bar-container">
              <div class="bar bar-estimated ${trueBarClass}" style="width: ${truePercent}%">${barInnerHtml}</div>
              ${ceilingHtml}
              ${barValueHtml}
            </div>
          </div>
          <div class="rating-bars-center">
            <span class="rating-diff ${diffClass}">${diffText}</span>
            <span class="bar-vs">vs</span>
          </div>
          <div class="rating-bars-right">
            <div class="bar-container bar-container-rtl">
              <div class="bar bar-scout ${scoutBarClass}" style="width: ${scoutPercent}%"></div>
              <span class="bar-value">${scoutDisplay}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderAdvancedRatingBar(label: string, value: number, min: number, max: number): string {
    const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
    const barClass = label === 'Speed' ? this.getSpeedBarClass(value) : this.getRatingBarClass(value);
    const displayValue = Math.round(value);

    return `
      <div class="rating-row rating-row-advanced">
        <span class="rating-label">${label}</span>
        <div class="rating-bars">
          <div class="bar-container">
            <div class="bar bar-scout ${barClass}" style="width: ${percentage}%"></div>
            <span class="bar-value">${displayValue}</span>
          </div>
        </div>
      </div>
    `;
  }

  private getSpeedBarClass(speed: number): string {
    if (speed >= 160) return 'rating-elite';
    if (speed >= 120) return 'rating-plus';
    if (speed >= 80) return 'rating-avg';
    if (speed >= 50) return 'rating-fringe';
    return 'rating-poor';
  }

  private renderStatsTable(stats: BatterSeasonStats[]): string {
    // League averages for OPS+ calculation
    const lgObp = 0.320;
    const lgSlg = 0.400;

    if (stats.length === 0) {
      return `
        <div class="stats-history">
          <h4 class="section-label">Career Stats</h4>
          <p class="no-stats">No batting stats found for this player.</p>
        </div>
      `;
    }

    const rows = stats.slice(0, 10).map(s => {
      const levelBadge = s.level === 'MLB'
        ? '<span class="level-badge level-mlb">MLB</span>'
        : `<span class="level-badge level-${s.level.toLowerCase()}">${s.level.toUpperCase()}</span>`;
      const isMinor = s.level !== 'MLB';
      // Calculate rate stats
      const bbPct = s.pa > 0 ? (s.bb / s.pa) * 100 : 0;
      const kPct = s.pa > 0 ? (s.k / s.pa) * 100 : 0;
      const hrPct = s.pa > 0 ? (s.hr / s.pa) * 100 : 0;
      const ops = s.obp + s.slg;
      const opsPlus = Math.round(100 * ((s.obp / lgObp) + (s.slg / lgSlg) - 1));

      // Calculate offensive-only WAR (same formula as projections for apples-to-apples comparison)
      const runsPerWin = 10;
      const runsAboveAvg = ((opsPlus - 100) / 10) * (s.pa / 600) * 10;
      const replacementRuns = (s.pa / 600) * 20;
      const calcWar = Math.round(((runsAboveAvg + replacementRuns) / runsPerWin) * 10) / 10;
      const warCell = isMinor ? '<td class="stat-na">—</td>' : `<td style="text-align: center;">${calcWar.toFixed(1)}</td>`;

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
          <td style="text-align: center;">${s.slg.toFixed(3)}</td>
          <td style="text-align: center;">${ops.toFixed(3)}</td>
          <td style="text-align: center;">${opsPlus}</td>
          ${warCell}
        </tr>
      `;
    }).join('');

    return `
      <div class="stats-history">
        <h4 class="section-label">Career Stats</h4>
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
      </div>
    `;
  }

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

  private bindBodyEvents(): void {
    this.bindScoutSourceToggle();
    this.bindTabSwitching();
    this.bindAdvancedRatingsToggle();
    this.bindProjectionToggle();
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
          const newHtml = this.renderProjection(this.currentData, this.currentStats);
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

  private bindAdvancedRatingsToggle(): void {
    const advancedToggle = this.overlay?.querySelector('.advanced-ratings-toggle');
    advancedToggle?.addEventListener('click', () => {
      this.advancedRatingsExpanded = !this.advancedRatingsExpanded;
      localStorage.setItem('wbl_expanded_ratings_expanded', String(this.advancedRatingsExpanded));

      const section = this.overlay?.querySelector('.advanced-ratings-section');
      const toggleIcon = this.overlay?.querySelector('.toggle-icon');

      if (section) {
        section.classList.toggle('expanded', this.advancedRatingsExpanded);
      }
      if (toggleIcon) {
        toggleIcon.textContent = this.advancedRatingsExpanded ? '▾' : '▸';
      }
      advancedToggle.setAttribute('aria-expanded', String(this.advancedRatingsExpanded));
    });
  }

  private bindScoutSourceToggle(): void {
    if (!this.overlay) return;
    const toggleContainer = this.overlay.querySelector<HTMLElement>('.scout-header-toggle.custom-dropdown');
    if (!toggleContainer) return;

    const items = toggleContainer.querySelectorAll<HTMLElement>('.dropdown-item');
    items.forEach(item => {
      item.addEventListener('click', (e) => {
        const newSource = (e.target as HTMLElement).dataset.value as 'my' | 'osa';
        if (!newSource) return;

        const isCurrentlyOsa = this.scoutingIsOsa;
        const wantsOsa = newSource === 'osa';
        if (isCurrentlyOsa === wantsOsa) return; // No change

        // Switch scouting data source
        if (newSource === 'my' && this.myScoutingData) {
          this.scoutingData = this.myScoutingData;
          this.scoutingIsOsa = false;
        } else if (newSource === 'osa' && this.osaScoutingData) {
          this.scoutingData = this.osaScoutingData;
          this.scoutingIsOsa = true;
        }

        // Re-render the ratings comparison section
        const ratingsSection = this.overlay?.querySelector('.ratings-comparison');
        if (ratingsSection && this.currentData) {
          ratingsSection.outerHTML = this.renderRatingsComparison(this.currentData);
          this.bindScoutSourceToggle(); // Re-bind after re-render
        }
      });
    });
  }
}

// Export singleton instance
export const batterProfileModal = new BatterProfileModal();
