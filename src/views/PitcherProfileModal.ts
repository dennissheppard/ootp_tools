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
import { developmentSnapshotService } from '../services/DevelopmentSnapshotService';
import { DevelopmentChart, DevelopmentMetric, renderMetricToggles, bindMetricToggleHandlers } from '../components/DevelopmentChart';
import { contractService, Contract } from '../services/ContractService';
import { RadarChart, RadarChartSeries } from '../components/RadarChart';
import { determinePitcherRole, PitcherRoleInput } from '../models/Player';
import { fipWarService } from '../services/FipWarService';
import { projectionService } from '../services/ProjectionService';
import { PitcherTfrSourceData } from '../services/TeamRatingsService';

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

  // Role
  role?: number;

  // TFR by scout source (for toggle in modal)
  tfrBySource?: { my?: PitcherTfrSourceData; osa?: PitcherTfrSourceData };
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
  private projectionYear: number = new Date().getFullYear();
  private currentData: PitcherProfileData | null = null;

  // Development tab state
  private developmentChart: DevelopmentChart | null = null;
  private activeDevMetrics: DevelopmentMetric[] = ['scoutStuff', 'scoutControl', 'scoutHra'];

  // Radar chart instances
  private radarChart: RadarChart | null = null;
  private arsenalRadarChart: RadarChart | null = null;

  // Contract data
  private contract: Contract | null = null;

  // League WAR ceiling for arc scaling
  private leagueWarMax: number = 5;

  // Projection toggle state
  private projectionMode: 'current' | 'peak' = 'current';
  private currentStats: PitcherSeasonStats[] = [];

  // ProjectionService-derived IP (populated in show())
  private projectedIp: number | null = null;

  // Track which radar series are hidden via legend toggle
  private hiddenSeries = new Set<string>();

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

    this.projectionMode = 'current';
    this.currentData = data;

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

    // Set logo watermark
    const watermark = this.overlay.querySelector<HTMLImageElement>('.modal-logo-watermark');
    if (watermark) {
      const logoUrl = this.getTeamLogoUrl(data.team);
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

    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.hide();
    };
    document.addEventListener('keydown', this.boundKeyHandler);

    try {
      // Fetch scouting data, contract data, and league WAR ceiling
      const [myScoutingAll, osaScoutingAll, allContracts, lastYearPitching] = await Promise.all([
        scoutingDataService.getLatestScoutingRatings('my'),
        scoutingDataService.getLatestScoutingRatings('osa'),
        contractService.getAllContracts(),
        trueRatingsService.getTruePitchingStats(currentYear - 1).catch(() => [])
      ]);

      this.contract = allContracts.get(data.playerId) ?? null;

      // Compute league WAR ceiling from last year's leader
      if (lastYearPitching.length > 0) {
        const maxWar = lastYearPitching.reduce((max, p) => Math.max(max, p.war ?? 0), 0);
        this.leagueWarMax = Math.max(4, maxWar);
      }

      const myScouting = myScoutingAll.find(s => s.playerId === data.playerId);
      const osaScouting = osaScoutingAll.find(s => s.playerId === data.playerId);

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

      // Fetch MLB pitching stats using getPlayerYearlyStats (pre-computes k9/bb9/hr9/fip)
      let mlbStats: PitcherSeasonStats[] = [];
      try {
        const yearlyDetails = await trueRatingsService.getPlayerYearlyStats(data.playerId, currentYear, 5);
        mlbStats = yearlyDetails.map(s => ({
          year: s.year,
          level: 'MLB',
          ip: s.ip,
          fip: s.fip,
          k9: s.k9,
          bb9: s.bb9,
          hr9: s.hr9,
          war: s.war,
          gs: s.gs,
        }));
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

      // Calculate projected IP via ProjectionService (uses full model: stamina, history, skill, age)
      this.projectedIp = null;
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

      // Render full body
      if (bodyEl) {
        bodyEl.innerHTML = this.renderBody(data, allStats);
        this.bindBodyEvents();

        requestAnimationFrame(() => {
          const emblem = this.overlay?.querySelector('.rating-emblem');
          if (emblem) emblem.classList.add('shimmer-once');
        });
      }
    } catch (error) {
      console.error('Error loading pitcher profile data:', error);
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

  private calculateProjWar(data: PitcherProfileData): number | undefined {
    if (data.projWar !== undefined) return data.projWar;
    const stats = this.computeProjectedStats(data);
    if (stats.projFip !== undefined && stats.projIp !== undefined) {
      return fipWarService.calculateWar(stats.projFip, stats.projIp);
    }
    return undefined;
  }

  // ─── Header: Vitals ──────────────────────────────────────────────────

  private renderHeaderVitals(data: PitcherProfileData): string {
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
    const salaryStr = this.formatSalary(currentSalary);
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

  // ─── Body Rendering ────────────────────────────────────────────────────

  private renderBody(data: PitcherProfileData, stats: PitcherSeasonStats[]): string {
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
          ${projectionContent}
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

    return `
      <div class="ratings-section">
        <div class="ratings-layout">
          <div class="ratings-radar-col">
            <div class="chart-section-header">
              <h4 class="chart-section-label">Pitching Ratings</h4>
              ${scoutToggleHtml}
            </div>
            <div class="radar-chart-wrapper">
              <div id="pitcher-radar-chart"></div>
              ${pitchingAxisLabelsHtml}
            </div>
          </div>
          <div class="arsenal-col">
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

    // Pitcher type and BABIP from scouting data
    const pitcherType = s?.pitcherType;
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

    return { projK9, projBb9, projHr9, projFip, projIp, projWar: data.projWar };
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
      'Ironman': 1.05, 'Durable': 1.0, 'Normal': 0.95,
      'Wary': 0.88, 'Fragile': 0.80, 'Prone': 0.72, 'Wrecked': 0.65,
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

    if (series.length === 0) return;

    this.radarChart = new RadarChart({
      containerId: 'pitcher-radar-chart',
      categories,
      series,
      height: 300,
      radarSize: 120,
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

  private addProjectionLegendItem(): void {
    const legendContainer = this.overlay?.querySelector<HTMLElement>('.ratings-radar-col .apexcharts-legend');
    if (!legendContainer) return;

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
    fbp: 'Fastball', chp: 'Changeup', spp: 'Splitter', cbp: 'Curveball',
    slp: 'Slider', sip: 'Sinker', ctp: 'Cutter', fop: 'Forkball',
    ccp: 'CircleChg', scp: 'Screwball', kcp: 'KnuckleCrv', knp: 'Knuckle',
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
      const badges = this.overlay.querySelectorAll<HTMLElement>(`.ratings-radar-col .${badgeClass}`);
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

  // ─── Projection Section ─────────────────────────────────────────────

  private renderProjectionContent(data: PitcherProfileData, stats: PitcherSeasonStats[]): string {
    const showToggle = data.hasTfrUpside === true && data.trueRating !== undefined;
    const isPeakMode = (this.projectionMode === 'peak' && showToggle) || (data.isProspect === true);

    // Select ratings source
    const useStuff = isPeakMode ? (data.tfrStuff ?? data.estimatedStuff) : data.estimatedStuff;
    const useControl = isPeakMode ? (data.tfrControl ?? data.estimatedControl) : data.estimatedControl;
    const useHra = isPeakMode ? (data.tfrHra ?? data.estimatedHra) : data.estimatedHra;

    const latestStat = isPeakMode ? undefined : stats.find(s => s.level === 'MLB');
    const age = isPeakMode ? 27 : (data.age ?? 27);

    // Calculate projected stats — prefer TFR pipeline rates directly (avoids lossy round-trip)
    let projK9: number;
    let projBb9: number;
    let projHr9: number;
    let projFip: number;

    if (isPeakMode && data.projK9 !== undefined && data.projBb9 !== undefined && data.projHr9 !== undefined) {
      // Use TFR pipeline rates directly
      projK9 = data.projK9;
      projBb9 = data.projBb9;
      projHr9 = data.projHr9;
      projFip = data.projFip ?? (((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47);
    } else if (useStuff !== undefined && useControl !== undefined && useHra !== undefined) {
      // Fallback: Invert RatingEstimatorService formulas: rating → expected stat
      projK9 = (useStuff + 28) / 13.5;
      projBb9 = (100.4 - useControl) / 19.2;
      projHr9 = (86.7 - useHra) / 41.7;
      projFip = ((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47;
    } else {
      projK9 = 7.5;
      projBb9 = 3.5;
      projHr9 = 1.2;
      projFip = ((13 * projHr9) + (3 * projBb9) - (2 * projK9)) / 9 + 3.47;
    }

    // IP: prefer caller-provided, then ProjectionService result, then fallback
    const s = this.scoutingData;
    const stamina = s?.stamina ?? data.scoutStamina;
    const injury = s?.injuryProneness ?? data.injuryProneness;
    const projIp = data.projIp ?? this.projectedIp ?? this.estimateIp(stamina ?? 50, injury);

    // WAR estimate using FipWarService (replacement FIP 5.20, runsPerWin 8.50)
    const projWar = isPeakMode
      ? fipWarService.calculateWar(projFip, projIp)
      : (data.projWar ?? fipWarService.calculateWar(projFip, projIp));

    const formatStat = (val: number, decimals: number = 2) => val.toFixed(decimals);

    // Derive counting stats from rate stats and IP
    const projK = Math.round(projK9 * projIp / 9);
    const projBb = Math.round(projBb9 * projIp / 9);
    const projHr = Math.round(projHr9 * projIp / 9);

    // Flip cells
    const stuffRating = this.clampRatingForDisplay(useStuff ?? 50);
    const controlRating = this.clampRatingForDisplay(useControl ?? 50);
    const hraRating = this.clampRatingForDisplay(useHra ?? 50);

    const ratingLabel = isPeakMode ? 'TFR' : 'Estimated';
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

    const projNote = isPeakMode
      ? '* Peak projection based on True Future Rating. Assumes full development and optimal performance.'
      : '* Projection based on True Ratings. Assumes full season health.';

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
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }

  // ─── Development Tab ────────────────────────────────────────────────

  private renderDevelopmentTab(playerId: number): string {
    return `
      <div class="development-section">
        <div class="development-header">
          <h4>Development History</h4>
          <span class="snapshot-count" id="dev-snapshot-count">Loading...</span>
        </div>
        ${renderMetricToggles(this.activeDevMetrics, 'pitcher')}
        <div class="development-chart-container" id="development-chart-${playerId}"></div>
      </div>
    `;
  }

  private async initDevelopmentChart(playerId: number): Promise<void> {
    if (this.developmentChart) {
      this.developmentChart.destroy();
      this.developmentChart = null;
    }

    const snapshots = await developmentSnapshotService.getPlayerSnapshots(playerId);
    const pitcherSnapshots = snapshots.filter(s =>
      s.playerType === 'pitcher' || s.scoutStuff !== undefined || s.scoutControl !== undefined
    );

    const countEl = this.overlay?.querySelector('#dev-snapshot-count');
    if (countEl) {
      countEl.textContent = `${pitcherSnapshots.length} snapshot${pitcherSnapshots.length !== 1 ? 's' : ''}`;
    }

    this.developmentChart = new DevelopmentChart({
      containerId: `development-chart-${playerId}`,
      snapshots: pitcherSnapshots,
      metrics: this.activeDevMetrics,
      height: 280,
    });
    this.developmentChart.render();

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

  private bindBodyEvents(): void {
    this.bindScoutSourceToggle();
    this.bindTabSwitching();
    this.bindProjectionToggle();
    this.initRadarChart(this.currentData!);
    this.initArsenalRadarChart(this.currentData!);
    this.lockTabContentHeight();
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
        if (!targetTab) return;

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

        const projSection = this.overlay?.querySelector('.projection-section');
        if (projSection && this.currentData) {
          const newHtml = this.renderProjectionContent(this.currentData, this.currentStats);
          projSection.outerHTML = newHtml;
          this.bindProjectionToggle();
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
          this.currentData.projK9 = altTfr.projK9;
          this.currentData.projBb9 = altTfr.projBb9;
          this.currentData.projHr9 = altTfr.projHr9;
          this.currentData.projFip = altTfr.projFip;
        }

        const ratingsSection = this.overlay?.querySelector('.ratings-section');
        if (ratingsSection) {
          ratingsSection.outerHTML = this.renderRatingsSection(this.currentData);
          this.bindScoutSourceToggle();
          this.initRadarChart(this.currentData);
          this.initArsenalRadarChart(this.currentData);
        }

        // Update header emblems after TFR swap
        const ratingsSlot = this.overlay?.querySelector('.rating-emblem-slot');
        if (ratingsSlot) ratingsSlot.innerHTML = this.renderRatingEmblem(this.currentData);
        const warSlot = this.overlay?.querySelector('.war-emblem-slot');
        if (warSlot) warSlot.innerHTML = this.renderWarEmblem(this.currentData);

        const projSection = this.overlay?.querySelector('.projection-section');
        if (projSection && this.currentData) {
          projSection.outerHTML = this.renderProjectionContent(this.currentData, this.currentStats);
          this.bindProjectionToggle();
        }
      });
    });
  }
}

// Export singleton instance
export const pitcherProfileModal = new PitcherProfileModal();
