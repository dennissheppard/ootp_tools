import { PlayerYearlyDetail, trueRatingsService } from '../services/TrueRatingsService';
import { PlayerRatingsCard, PlayerRatingsData } from './PlayerRatingsCard';

export type { PlayerRatingsData as PlayerProfileData };

export class PlayerProfileModal {
  private overlay: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };

  constructor() {
    this.ensureOverlayExists();
  }

  private ensureOverlayExists(): void {
    if (this.overlay) return;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay player-profile-modal';
    this.overlay.setAttribute('aria-hidden', 'true');
    this.overlay.innerHTML = `
      <div class="modal modal-lg modal-draggable">
        <div class="modal-header">
          <div class="profile-header">
            <div class="profile-title-group">
              <h3 class="modal-title"></h3>
              <span class="percentile-label"></span>
            </div>
            <span class="badge"></span>
          </div>
          <button class="modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="loading-message">Loading player stats...</div>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
    this.modal = this.overlay.querySelector('.modal');

    // Close button
    this.overlay.querySelector('.modal-close')?.addEventListener('click', () => this.hide());

    // Click outside to close (only if not dragging)
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay && !this.isDragging) {
        this.hide();
      }
    });

    // Drag functionality
    this.setupDragging();
  }

  private setupDragging(): void {
    const header = this.overlay?.querySelector<HTMLElement>('.modal-header');
    if (!header || !this.modal) return;

    header.style.cursor = 'grab';

    header.addEventListener('mousedown', (e) => {
      // Don't drag if clicking the close button
      if ((e.target as HTMLElement).closest('.modal-close')) return;

      this.isDragging = true;
      header.style.cursor = 'grabbing';

      const rect = this.modal!.getBoundingClientRect();
      this.dragOffset = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      // Switch to absolute positioning for dragging
      this.modal!.classList.add('dragging');
      this.modal!.style.left = `${rect.left}px`;
      this.modal!.style.top = `${rect.top}px`;

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging || !this.modal) return;

      const x = e.clientX - this.dragOffset.x;
      const y = e.clientY - this.dragOffset.y;

      // Keep modal within viewport bounds
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

  async show(data: PlayerRatingsData, selectedYear: number): Promise<void> {
    this.ensureOverlayExists();
    if (!this.overlay) return;

    const hasScout = PlayerRatingsCard.hasScoutingData(data);

    // Update header
    const titleEl = this.overlay.querySelector<HTMLElement>('.modal-title');
    const percentileEl = this.overlay.querySelector<HTMLElement>('.percentile-label');
    const badgeEl = this.overlay.querySelector<HTMLElement>('.profile-header .badge');

    if (titleEl) titleEl.textContent = data.playerName;
    if (percentileEl) {
      percentileEl.textContent = typeof data.percentile === 'number'
        ? `${PlayerRatingsCard.formatPercentile(data.percentile)} percentile`
        : '';
    }
    if (badgeEl) {
      if (typeof data.trueRating === 'number') {
        const indicator = hasScout ? '' : '<span class="badge-indicator" title="Stats only">○</span>';
        badgeEl.innerHTML = `${data.trueRating.toFixed(1)}${indicator}`;
        badgeEl.className = `badge ${PlayerRatingsCard.getTrueRatingClass(data.trueRating)}`;
        badgeEl.title = hasScout ? 'True Rating (with scouting)' : 'True Rating (stats only)';
        badgeEl.style.display = '';
      } else {
        badgeEl.style.display = 'none';
      }
    }

    // Show loading state
    const bodyEl = this.overlay.querySelector<HTMLElement>('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = '<div class="loading-message">Loading player stats...</div>';
    }

    // Show modal
    this.overlay.classList.add('visible');
    this.overlay.setAttribute('aria-hidden', 'false');

    // Bind escape key
    this.boundKeyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.hide();
      }
    };
    document.addEventListener('keydown', this.boundKeyHandler);

    // Fetch stats and render
    try {
      const stats = await trueRatingsService.getPlayerYearlyStats(data.playerId, selectedYear, 5);
      if (bodyEl) {
        bodyEl.innerHTML = this.renderContent(data, stats, selectedYear);
      }
    } catch (error) {
      if (bodyEl) {
        bodyEl.innerHTML = `<div class="error-message">Failed to load stats.</div>`;
      }
    }
  }

  hide(): void {
    if (!this.overlay) return;

    this.overlay.classList.remove('visible');
    this.overlay.setAttribute('aria-hidden', 'true');

    // Reset drag state and position for next open
    if (this.modal) {
      this.modal.classList.remove('dragging');
      this.modal.style.left = '';
      this.modal.style.top = '';
    }
    this.isDragging = false;

    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
  }

  private renderContent(data: PlayerRatingsData, stats: PlayerYearlyDetail[], year: number): string {
    const hasScout = PlayerRatingsCard.hasScoutingData(data);
    return `
      ${PlayerRatingsCard.renderRatingsComparison(data, hasScout, year)}
      ${this.renderStatsTable(stats)}
    `;
  }

  private renderStatsTable(stats: PlayerYearlyDetail[]): string {
    if (stats.length === 0) {
      return `
        <div class="stats-history">
          <h4 class="section-label">Season Stats</h4>
          <p class="no-stats">No pitching stats found for this player.</p>
        </div>
      `;
    }

    const rows = stats.map(s => `
      <tr>
        <td>${s.year}</td>
        <td>${s.ip.toFixed(1)}</td>
        <td>${s.era.toFixed(2)}</td>
        <td>${s.k9.toFixed(2)}</td>
        <td>${s.bb9.toFixed(2)}</td>
        <td>${s.hr9.toFixed(2)}</td>
        <td>${s.war.toFixed(1)}</td>
      </tr>
    `).join('');

    return `
      <div class="stats-history">
        <h4 class="section-label">Season Stats</h4>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>IP</th>
                <th>ERA</th>
                <th>K/9</th>
                <th>BB/9</th>
                <th>HR/9</th>
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
}
