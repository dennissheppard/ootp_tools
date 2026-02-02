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
  estimatedBabip?: number;

  // Scouting data
  scoutPower?: number;
  scoutEye?: number;
  scoutAvoidK?: number;
  scoutBabip?: number;
  scoutGap?: number;
  scoutSpeed?: number;
  scoutOvr?: number;
  scoutPot?: number;
  injuryProneness?: string;

  // Raw stats
  pa?: number;
  avg?: number;
  obp?: number;
  slg?: number;
  hr?: number;
  rbi?: number;
  sb?: number;
  war?: number;

  // TFR for prospects
  isProspect?: boolean;
  trueFutureRating?: number;
  tfrPercentile?: number;
}

interface BatterSeasonStats {
  year: number;
  level: string;
  pa: number;
  avg: number;
  obp: number;
  slg: number;
  hr: number;
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
        <div class="modal-header">
          <div class="profile-header">
            <div class="profile-title-group">
              <h3 class="modal-title"></h3>
              <div class="player-team-info"></div>
              <div class="player-position-age"></div>
            </div>
            <div class="ratings-header-slot"></div>
            <div class="metadata-header-slot"></div>
          </div>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="loading-spinner">Loading...</div>
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

    // Update header
    const titleEl = this.overlay.querySelector<HTMLElement>('.modal-title');
    const teamEl = this.overlay.querySelector<HTMLElement>('.player-team-info');
    const posAgeEl = this.overlay.querySelector<HTMLElement>('.player-position-age');
    const ratingsSlot = this.overlay.querySelector<HTMLElement>('.ratings-header-slot');
    const metadataSlot = this.overlay.querySelector<HTMLElement>('.metadata-header-slot');

    if (titleEl) titleEl.textContent = data.playerName;
    if (teamEl) {
      const teamInfo = this.formatTeamInfo(data.team, data.parentTeam);
      teamEl.innerHTML = teamInfo;
      teamEl.style.display = teamInfo ? '' : 'none';
    }
    if (posAgeEl) {
      posAgeEl.innerHTML = this.renderPositionAge(data);
    }
    if (ratingsSlot) {
      ratingsSlot.innerHTML = this.renderRatingEmblem(data);
    }
    if (metadataSlot) {
      metadataSlot.innerHTML = this.renderHeaderMetadata(data);
    }

    // Show modal with loading state
    const bodyEl = this.overlay.querySelector<HTMLElement>('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="loading-spinner">Loading stats...</div>';
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
      // Fetch scouting data
      const [myScoutingAll, osaScoutingAll] = await Promise.all([
        hitterScoutingDataService.getLatestScoutingRatings('my'),
        hitterScoutingDataService.getLatestScoutingRatings('osa')
      ]);

      this.scoutingData = myScoutingAll.find(s => s.playerId === data.playerId)
        || osaScoutingAll.find(s => s.playerId === data.playerId)
        || null;

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
          avg: s.avg,
          obp: s.obp,
          slg: s.slg,
          hr: s.hr,
          rbi: 0, // Not available in minor league stats
          sb: s.sb,
          bb: s.bb,
          k: s.k,
          war: 0
        }));
      } catch (e) {
        console.warn('No minor league batting stats found');
      }

      // Fetch MLB batting stats (from yearly cache)
      let mlbStats: BatterSeasonStats[] = [];
      try {
        for (let year = currentYear; year >= currentYear - 4; year--) {
          const yearStats = await trueRatingsService.getTrueBattingStats(year);
          const playerStat = yearStats.find(s => s.player_id === data.playerId);
          if (playerStat) {
            // Calculate SLG from raw data: (1B + 2*2B + 3*3B + 4*HR) / AB
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

      // Render full body
      if (bodyEl) {
        bodyEl.innerHTML = this.renderBody(data, allStats);
        this.bindBodyEvents();
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

    // Reset position
    if (this.modal) {
      this.modal.classList.remove('dragging');
      this.modal.style.left = '';
      this.modal.style.top = '';
    }
  }

  private formatTeamInfo(team?: string, parentTeam?: string): string {
    if (!team) return '';
    if (parentTeam) {
      return `<span class="team-name">${team}</span> <span class="parent-team">(${parentTeam})</span>`;
    }
    return `<span class="team-name">${team}</span>`;
  }

  private renderPositionAge(data: BatterProfileData): string {
    const posLabel = data.positionLabel || (data.position ? getPositionLabel(data.position) : 'Unknown');
    const posClass = this.getPositionClass(data.position);
    const age = data.age ?? 'N/A';

    return `
      <span class="position-badge ${posClass}">${posLabel}</span>
      <span class="age-label">Age ${age}</span>
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
    const isProspect = data.isProspect === true;
    const useTfr = isProspect && typeof data.trueFutureRating === 'number';
    const ratingValue = useTfr ? data.trueFutureRating : data.trueRating;

    if (typeof ratingValue !== 'number') {
      return '<div class="rating-emblem rating-none"><span class="rating-value">--</span></div>';
    }

    const badgeClass = this.getTrueRatingClass(ratingValue);
    const indicator = useTfr
      ? '<span class="badge-indicator-tfr" title="True Future Rating">F</span>'
      : '';
    const percentile = useTfr ? data.tfrPercentile : data.percentile;
    const percentileText = typeof percentile === 'number' ? `${percentile.toFixed(0)}th %ile` : '';

    // Calculate emblem bar width (0.5 to 5.0 scale → 0% to 100%)
    const barWidth = Math.max(0, Math.min(100, ((ratingValue - 0.5) / 4.5) * 100));

    return `
      <div class="rating-emblem ${badgeClass}" title="${useTfr ? 'True Future Rating' : 'True Rating'}">
        <div class="rating-emblem-inner">
          <span class="rating-value">${ratingValue.toFixed(1)}${indicator}</span>
          <span class="rating-label">${useTfr ? 'TFR' : 'TR'}</span>
        </div>
        <div class="rating-emblem-bar">
          <div class="rating-emblem-bar-fill" style="width: ${barWidth}%"></div>
        </div>
        ${percentileText ? `<span class="rating-percentile">${percentileText}</span>` : ''}
      </div>
    `;
  }

  private renderHeaderMetadata(data: BatterProfileData): string {
    const ratings = [
      { label: 'Power', value: data.estimatedPower, scout: this.scoutingData?.power },
      { label: 'Eye', value: data.estimatedEye, scout: this.scoutingData?.eye },
      { label: 'AvoidK', value: data.estimatedAvoidK, scout: this.scoutingData?.avoidK },
      { label: 'Hitting', value: data.estimatedBabip, scout: this.scoutingData?.babip },
    ];

    const bars = ratings.map(r => {
      const value = r.value ?? r.scout ?? 50;
      const percentage = Math.max(0, Math.min(100, ((value - 20) / 60) * 100));
      const displayValue = Math.round(Math.max(20, Math.min(80, value)));
      const barClass = this.getRatingBarClass(value);

      return `
        <div class="header-metadata-item">
          <span class="header-metadata-label">${r.label}</span>
          <div class="header-metadata-bar">
            <div class="header-metadata-bar-fill ${barClass}" style="width: ${percentage}%"></div>
          </div>
          <span class="header-metadata-value">${displayValue}</span>
        </div>
      `;
    }).join('');

    return `<div class="header-metadata-grid">${bars}</div>`;
  }

  private getRatingBarClass(value: number): string {
    if (value >= 70) return 'rating-elite';
    if (value >= 60) return 'rating-plus';
    if (value >= 50) return 'rating-avg';
    if (value >= 40) return 'rating-fringe';
    return 'rating-poor';
  }

  private getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  private renderBody(data: BatterProfileData, stats: BatterSeasonStats[]): string {
    const scoutingSection = this.renderScoutingSection();
    const statsSection = this.renderStatsTable(stats);
    const summarySection = this.renderSummaryStats(data);

    return `
      <div class="profile-body-grid">
        <div class="profile-main-column">
          ${summarySection}
          ${statsSection}
        </div>
        <div class="profile-side-column">
          ${scoutingSection}
        </div>
      </div>
    `;
  }

  private renderSummaryStats(data: BatterProfileData): string {
    const woba = typeof data.woba === 'number' ? data.woba.toFixed(3) : '--';
    const avg = typeof data.avg === 'number' ? data.avg.toFixed(3) : '--';
    const obp = typeof data.obp === 'number' ? data.obp.toFixed(3) : '--';
    const slg = typeof data.slg === 'number' ? (data.slg).toFixed(3) : '--';
    const war = typeof data.war === 'number' ? data.war.toFixed(1) : '--';

    return `
      <div class="summary-stats-section">
        <h4 class="section-title">Current Season</h4>
        <div class="summary-stats-grid">
          <div class="summary-stat">
            <span class="stat-value">${avg}</span>
            <span class="stat-label">AVG</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value">${obp}</span>
            <span class="stat-label">OBP</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value">${slg}</span>
            <span class="stat-label">SLG</span>
          </div>
          <div class="summary-stat highlight">
            <span class="stat-value">${woba}</span>
            <span class="stat-label">wOBA</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value">${data.hr ?? '--'}</span>
            <span class="stat-label">HR</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value">${data.rbi ?? '--'}</span>
            <span class="stat-label">RBI</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value">${data.sb ?? '--'}</span>
            <span class="stat-label">SB</span>
          </div>
          <div class="summary-stat">
            <span class="stat-value">${war}</span>
            <span class="stat-label">WAR</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderScoutingSection(): string {
    if (!this.scoutingData) {
      return `
        <div class="scouting-section">
          <h4 class="section-title">Scouting Report</h4>
          <p class="no-data">No scouting data available</p>
        </div>
      `;
    }

    const s = this.scoutingData;
    const ratings = [
      { label: 'Power', value: s.power, key: 'power' },
      { label: 'Eye', value: s.eye, key: 'eye' },
      { label: 'Avoid K', value: s.avoidK, key: 'avoidK' },
      { label: 'Hitting', value: s.babip ?? 50, key: 'babip' },
      { label: 'Gap', value: s.gap ?? 50, key: 'gap' },
      { label: 'Speed', value: s.speed ?? 50, key: 'speed' },
    ];

    const ratingBars = ratings.map(r => {
      const value = r.value ?? 50;
      const percentage = Math.max(0, Math.min(100, ((value - 20) / 60) * 100));
      const barClass = this.getRatingBarClass(value);

      return `
        <div class="scouting-rating-row">
          <span class="scouting-label">${r.label}</span>
          <div class="scouting-bar">
            <div class="scouting-bar-fill ${barClass}" style="width: ${percentage}%"></div>
          </div>
          <span class="scouting-value">${Math.round(value)}</span>
        </div>
      `;
    }).join('');

    const ovrPot = `
      <div class="scouting-stars">
        <div class="star-rating">
          <span class="star-label">OVR</span>
          <span class="star-value">${this.renderStars(s.ovr)}</span>
        </div>
        <div class="star-rating">
          <span class="star-label">POT</span>
          <span class="star-value">${this.renderStars(s.pot)}</span>
        </div>
      </div>
    `;

    const injury = s.injuryProneness
      ? `<div class="injury-status"><span class="injury-label">Durability:</span> <span class="injury-value">${s.injuryProneness}</span></div>`
      : '';

    return `
      <div class="scouting-section">
        <h4 class="section-title">Scouting Report</h4>
        ${ovrPot}
        <div class="scouting-ratings">
          ${ratingBars}
        </div>
        ${injury}
      </div>
    `;
  }

  private renderStars(value?: number): string {
    if (typeof value !== 'number') return '--';
    const fullStars = Math.floor(value);
    const hasHalf = value % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

    return '★'.repeat(fullStars) + (hasHalf ? '½' : '') + '☆'.repeat(emptyStars);
  }

  private renderStatsTable(stats: BatterSeasonStats[]): string {
    if (stats.length === 0) {
      return `
        <div class="stats-history-section">
          <h4 class="section-title">Career Stats</h4>
          <p class="no-data">No stats history available</p>
        </div>
      `;
    }

    const rows = stats.slice(0, 10).map(s => {
      const levelBadge = s.level === 'MLB'
        ? '<span class="level-badge level-mlb">MLB</span>'
        : `<span class="level-badge level-${s.level.toLowerCase()}">${s.level.toUpperCase()}</span>`;

      return `
        <tr>
          <td>${s.year}</td>
          <td>${levelBadge}</td>
          <td>${s.pa}</td>
          <td>${s.avg.toFixed(3)}</td>
          <td>${s.obp.toFixed(3)}</td>
          <td>${s.slg.toFixed(3)}</td>
          <td>${s.hr}</td>
          <td>${s.rbi}</td>
          <td>${s.sb}</td>
          <td>${s.bb}</td>
          <td>${s.k}</td>
          <td>${s.level === 'MLB' && typeof s.war === 'number' ? s.war.toFixed(1) : '--'}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="stats-history-section">
        <h4 class="section-title">Career Stats</h4>
        <div class="stats-table-wrapper">
          <table class="stats-table profile-stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>Level</th>
                <th>PA</th>
                <th>AVG</th>
                <th>OBP</th>
                <th>SLG</th>
                <th>HR</th>
                <th>RBI</th>
                <th>SB</th>
                <th>BB</th>
                <th>K</th>
                <th>WAR</th>
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

  private bindBodyEvents(): void {
    // Future: Add toggle events, chart interactions, etc.
  }
}

// Export singleton instance
export const batterProfileModal = new BatterProfileModal();
