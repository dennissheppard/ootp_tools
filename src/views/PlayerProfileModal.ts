import { trueRatingsService } from '../services/TrueRatingsService';
import { PlayerRatingsCard, PlayerRatingsData, SeasonStatsRow } from './PlayerRatingsCard';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { dateService } from '../services/DateService';
import { projectionService } from '../services/ProjectionService';
import { playerService } from '../services/PlayerService';
import { leagueStatsService } from '../services/LeagueStatsService';

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
              <div class="player-team-info"></div>
            </div>
            <div class="ratings-header-slot"></div>
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

    // Update header
    const titleEl = this.overlay.querySelector<HTMLElement>('.modal-title');
    const teamEl = this.overlay.querySelector<HTMLElement>('.player-team-info');
    const headerSlot = this.overlay.querySelector<HTMLElement>('.ratings-header-slot');

    if (titleEl) titleEl.textContent = data.playerName;
    if (teamEl) {
      const teamInfo = PlayerRatingsCard.formatTeamInfo(data.team, data.parentTeam);
      teamEl.innerHTML = teamInfo;
      teamEl.style.display = teamInfo ? '' : 'none';
    }
    if (headerSlot) {
      headerSlot.innerHTML = PlayerRatingsCard.renderRatingEmblem(data);
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
      const mlbStats = await trueRatingsService.getPlayerYearlyStats(data.playerId, selectedYear, 5);

      // Fetch minor league stats (within 2 years of current game date)
      let combinedStats: SeasonStatsRow[] = mlbStats.map(s => ({ ...s, level: 'MLB' as const }));

      try {
        const currentYear = await dateService.getCurrentYear();
        const startYear = currentYear - 2;
        const endYear = currentYear;
        const minorStats = minorLeagueStatsService.getPlayerStats(data.playerId, startYear, endYear);

        // Convert minor league stats to SeasonStatsRow format
        const minorStatsConverted: SeasonStatsRow[] = minorStats.map(s => ({
          year: s.year,
          level: s.level,
          ip: s.ip,
          era: 0,
          k9: s.k9,
          bb9: s.bb9,
          hr9: s.hr9,
          war: 0,
          gs: 0
        }));

        // Merge and sort
        const levelOrder = { 'MLB': 0, 'aaa': 1, 'aa': 2, 'a': 3, 'r': 4 };
        combinedStats = [...combinedStats, ...minorStatsConverted]
          .sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return (levelOrder[a.level || 'MLB'] || 0) - (levelOrder[b.level || 'MLB'] || 0);
          });
      } catch (error) {
        console.warn('Could not fetch minor league stats:', error);
        // Continue with MLB stats only
      }

      if (bodyEl) {
        const hasMinorLeague = combinedStats.some(s => s.level && s.level !== 'MLB');
        
        // Calculate Projection
        let projectionHtml = '';
        
        // Readiness Check
        const hasRecentMlb = mlbStats.some(s => s.year >= selectedYear - 1 && s.ip > 0);
        // Check for Upper Minors presence in the selected year (or current year context)
        const isUpperMinors = combinedStats.some(s => (s.level === 'aaa' || s.level === 'aa') && s.year === selectedYear);
        
        const ovr = data.scoutOvr ?? 20;
        const pot = data.scoutPot ?? 20;
        const starGap = pot - ovr;
        const isQualityProspect = (ovr >= 45) || (starGap <= 1.0 && pot >= 45);
        
        let showProjection = hasRecentMlb;
        if (!showProjection && isUpperMinors && (isQualityProspect || (data.trueRating ?? 0) >= 2.0)) {
             showProjection = true;
        }
        if (ovr >= 50) showProjection = true;

        if (showProjection) {
            try {
                const player = await playerService.getPlayerById(data.playerId);
                if (player && typeof data.estimatedStuff === 'number' && typeof data.estimatedControl === 'number' && typeof data.estimatedHra === 'number') {
                    const leagueStats = await leagueStatsService.getLeagueStats(selectedYear);
                    const leagueContext = {
                        fipConstant: leagueStats.fipConstant,
                        avgFip: leagueStats.avgFip,
                        runsPerWin: 8.5
                    };
                    
                    // Estimate role from recent stats (IP > 80 implies starter/long reliever)
                    const recent = mlbStats[0]; // Most recent year
                    const isSp = recent && recent.ip > 80;
                    
                    const proj = projectionService.calculateProjection(
                        { stuff: data.estimatedStuff, control: data.estimatedControl, hra: data.estimatedHra },
                        player.age,
                        0, // Pitch count unknown
                        isSp ? 20 : 0, // Mock GS to trigger SP logic in service
                        leagueContext,
                        data.scoutStamina,
                        data.scoutInjuryProneness,
                        mlbStats
                    );
                    
                    projectionHtml = this.renderProjection(proj, player.age + 1);
                }
            } catch (e) {
                console.warn('Failed to calculate projection', e);
            }
        }

        bodyEl.innerHTML = this.renderContent(data, combinedStats, hasMinorLeague, projectionHtml);
        this.bindScoutUploadLink();
        this.bindFlipCardLocking();
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

  private renderContent(data: PlayerRatingsData, stats: SeasonStatsRow[], showLevel: boolean, projectionHtml: string = ''): string {
    const hasScout = PlayerRatingsCard.hasScoutingData(data);
    return `
      ${PlayerRatingsCard.renderRatingsComparison(data, hasScout)}
      ${projectionHtml}
      ${PlayerRatingsCard.renderSeasonStatsTable(stats, { showLevel })}
    `;
  }

  private renderProjection(proj: { projectedStats: any, projectedRatings: any }, nextAge: number): string {
      const s = proj.projectedStats;
      const r = proj.projectedRatings;
      return `
        <div class="projection-section" style="margin-top: 1.5rem; border-top: 1px solid var(--color-border); padding-top: 1rem;">
            <h4 style="margin-bottom: 0.5rem; color: var(--color-text-muted); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em;">${nextAge}yo Season Projection</h4>
            <div class="stats-table-container">
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th>Age</th>
                            <th>IP</th>
                            <th>K/9</th>
                            <th>BB/9</th>
                            <th>HR/9</th>
                            <th>FIP</th>
                            <th>WAR</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="background-color: rgba(var(--color-primary-rgb), 0.1);">
                            <td>${nextAge}</td>
                            <td>${s.ip}</td>
                            <td>${s.k9.toFixed(2)} <span class="stat-sub">(${Math.round(r.stuff)})</span></td>
                            <td>${s.bb9.toFixed(2)} <span class="stat-sub">(${Math.round(r.control)})</span></td>
                            <td>${s.hr9.toFixed(2)} <span class="stat-sub">(${Math.round(r.hra)})</span></td>
                            <td style="font-weight: bold;">${s.fip.toFixed(2)}</td>
                            <td>${s.war.toFixed(1)}</td>
                        </tr>
                    </tbody>
                </table>
                <div style="font-size: 0.8em; color: var(--color-text-muted); margin-top: 0.5rem;">
                    * Based on current True Ratings and standard aging curves. Parentheses show Projected True Ratings.
                </div>
            </div>
        </div>
      `;
  }

  private bindScoutUploadLink(): void {
    if (!this.overlay) return;
    const link = this.overlay.querySelector<HTMLAnchorElement>('.scout-upload-link');
    if (!link) return;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      const dataMgmtTab = document.querySelector<HTMLElement>('[data-tab-target="tab-data-management"]');
      if (dataMgmtTab) {
        dataMgmtTab.click();
      }
    });
  }

  private bindFlipCardLocking(): void {
    if (!this.overlay) return;
    const cells = this.overlay.querySelectorAll<HTMLElement>('.flip-cell');
    cells.forEach((cell) => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        cell.classList.toggle('is-flipped');
      });
    });
  }
}
