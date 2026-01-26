import { trueRatingsService } from '../services/TrueRatingsService';
import { PlayerRatingsCard, PlayerRatingsData, SeasonStatsRow } from './PlayerRatingsCard';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { dateService } from '../services/DateService';
import { projectionService } from '../services/ProjectionService';
import { playerService } from '../services/PlayerService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { fipWarService } from '../services/FipWarService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';

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
              <div class="player-position-age"></div>
            </div>
            <div class="ratings-header-slot"></div>
            <div class="metadata-header-slot"></div>
            <div class="pitches-header-slot"></div>
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

    // Fetch player info first for age display
    const player = await playerService.getPlayerById(data.playerId);

    // Update header
    const titleEl = this.overlay.querySelector<HTMLElement>('.modal-title');
    const teamEl = this.overlay.querySelector<HTMLElement>('.player-team-info');
    const positionAgeEl = this.overlay.querySelector<HTMLElement>('.player-position-age');
    const headerSlot = this.overlay.querySelector<HTMLElement>('.ratings-header-slot');
    const metadataSlot = this.overlay.querySelector<HTMLElement>('.metadata-header-slot');
    const pitchesSlot = this.overlay.querySelector<HTMLElement>('.pitches-header-slot');

    if (titleEl) titleEl.textContent = data.playerName;
    if (teamEl) {
      const teamInfo = PlayerRatingsCard.formatTeamInfo(data.team, data.parentTeam);
      teamEl.innerHTML = teamInfo;
      teamEl.style.display = teamInfo ? '' : 'none';
    }
    if (positionAgeEl) {
      const posAgeInfo = PlayerRatingsCard.formatPositionAge(data.position, player?.age);
      positionAgeEl.textContent = posAgeInfo;
      positionAgeEl.style.display = posAgeInfo ? '' : 'none';
    }
    if (headerSlot) {
      headerSlot.innerHTML = PlayerRatingsCard.renderRatingEmblem(data);
    }
    if (metadataSlot) {
      metadataSlot.innerHTML = PlayerRatingsCard.renderHeaderMetadata(data);
    }
    if (pitchesSlot) {
      pitchesSlot.innerHTML = PlayerRatingsCard.renderHeaderPitches(data);
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
        const currentYear = await dateService.getCurrentYear();
        const projectionTargetYear = data.projectionYear ?? (selectedYear + 1);
        const projectionBaseYear = data.projectionBaseYear ?? (projectionTargetYear - 1);
        const historicalAge = projectionService.calculateAgeAtYear(player!, currentYear, projectionBaseYear);
        
        const hasRecentMlb = mlbStats.some(s => s.year >= projectionBaseYear - 1 && s.ip > 0);
        const isUpperMinors = combinedStats.some(s => (s.level === 'aaa' || s.level === 'aa') && s.year === projectionBaseYear);
        
        const ovr = data.scoutOvr ?? 20;
        const pot = data.scoutPot ?? 20;
        const starGap = pot - ovr;
        const isQualityProspect = (ovr >= 45) || (starGap <= 1.0 && pot >= 45);
        
        let showProjection = hasRecentMlb;
        if (!showProjection && isUpperMinors && (isQualityProspect || (data.trueRating ?? 0) >= 2.0)) {
             showProjection = true;
        }
        if (ovr >= 50) showProjection = true;
        if (data.forceProjection) showProjection = true;

        if (showProjection) {
            let proj = data.projectionOverride;

            if (!proj && typeof data.estimatedStuff === 'number' && typeof data.estimatedControl === 'number' && typeof data.estimatedHra === 'number') {
                try {
                    const leagueStats = await leagueStatsService.getLeagueStats(projectionBaseYear);
                    const leagueContext = {
                        fipConstant: leagueStats.fipConstant,
                        avgFip: leagueStats.avgFip,
                        runsPerWin: 8.5
                    };

                    // Estimate role from recent stats (IP > 80 implies starter/long reliever)
                    const recent = mlbStats[0]; // Most recent year in history
                    const isSp = recent && recent.ip > 80;

                    proj = projectionService.calculateProjection(
                        { stuff: data.estimatedStuff, control: data.estimatedControl, hra: data.estimatedHra },
                        historicalAge,
                        0, // Pitch count unknown
                        isSp ? 20 : 0, // Mock GS to trigger SP logic in service
                        leagueContext,
                        data.scoutStamina,
                        data.scoutInjuryProneness,
                        mlbStats
                    );
                } catch (e) {
                    console.warn('Failed to calculate projection', e);
                }
            }

            if (proj) {
                // Backcasting: Find actual stats for the projection target year
                const targetYear = projectionTargetYear;
                let actualStat: SeasonStatsRow | undefined;
                
                // mlbStats only contains [selectedYear, ..., selectedYear-4]
                // We need to fetch targetYear separately if it exists
                if (targetYear < currentYear) {
                    try {
                        const targetStats = await trueRatingsService.getTruePitchingStats(targetYear);
                        const playerStat = targetStats.find(s => s.player_id === data.playerId);
                        if (playerStat) {
                            const ip = trueRatingsService.parseIp(playerStat.ip);
                            // Convert to SeasonStatsRow format
                            actualStat = {
                                year: targetYear,
                                ip,
                                era: ip > 0 ? (playerStat.er / ip) * 9 : 0,
                                k9: ip > 0 ? (playerStat.k / ip) * 9 : 0,
                                bb9: ip > 0 ? (playerStat.bb / ip) * 9 : 0,
                                hr9: ip > 0 ? (playerStat.hra / ip) * 9 : 0,
                                war: playerStat.war,
                                gs: playerStat.gs
                            };
                        }
                    } catch {
                        // ignore if target year stats don't exist
                    }
                }

                let comparison: any = undefined;

                if (actualStat && actualStat.ip >= 10) {
                    const targetLeague = await leagueStatsService.getLeagueStats(targetYear);
                    const k9 = actualStat.k9;
                    const bb9 = actualStat.bb9;
                    const hr9 = actualStat.hr9;
                    const actFip = fipWarService.calculateFip({ k9, bb9, hr9, ip: actualStat.ip }, targetLeague.fipConstant);
                    const diff = actFip - proj.projectedStats.fip;
                    
                    let grade = 'F';
                    const absDiff = Math.abs(diff);
                    if (absDiff < 0.50) grade = 'A';
                    else if (absDiff < 1.00) grade = 'B';
                    else if (absDiff < 1.50) grade = 'C';
                    else if (absDiff < 2.00) grade = 'D';

                    comparison = {
                        fip: actFip,
                        war: actualStat.war,
                        ip: actualStat.ip,
                        k9: actualStat.k9,
                        bb9: actualStat.bb9,
                        hr9: actualStat.hr9,
                        diff,
                        grade
                    };
                }

                projectionHtml = this.renderProjection(proj, historicalAge + 1, projectionTargetYear, comparison);
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
      ${PlayerRatingsCard.renderSeasonStatsTable(stats, { showLevel, hasScouting: hasScout })}
    `;
  }

  private renderProjection(proj: { projectedStats: any, projectedRatings: any }, projectionAge: number, projectedYear: number, comparison?: any): string {
      const s = proj.projectedStats;
      const r = proj.projectedRatings;
      const title = `${projectedYear} Season Projection <span style="font-weight: normal; opacity: 0.8;">(${projectionAge}yo)</span>`;
      const note = '* Projection based on prior year True Ratings. Delta = Actual - Projected. Hover cells to show ratings.';

      const formatDelta = (projVal: number, actVal: number, invert: boolean = false) => {
          const delta = actVal - projVal;
          const sign = delta > 0 ? '+' : '';
          const isGood = invert ? delta < 0 : delta > 0;
          const className = isGood ? 'diff-positive' : 'diff-negative';
          if (Math.abs(delta) < 0.01) return `<span class="stat-delta">(0.00)</span>`;
          return `<span class="stat-delta ${className}">(${sign}${delta.toFixed(2)})</span>`;
      };

      const k9Delta = comparison ? formatDelta(s.k9, comparison.k9) : '';
      const bb9Delta = comparison ? formatDelta(s.bb9, comparison.bb9, true) : '';
      const hr9Delta = comparison ? formatDelta(s.hr9, comparison.hr9, true) : '';
      const ipDelta = comparison ? formatDelta(s.ip, comparison.ip) : '';

      const k9ProjFlip = this.renderFlipCell(s.k9.toFixed(2), Math.round(r.stuff).toString(), 'Projected True Stuff');
      const bb9ProjFlip = this.renderFlipCell(s.bb9.toFixed(2), Math.round(r.control).toString(), 'Projected True Control');
      const hr9ProjFlip = this.renderFlipCell(s.hr9.toFixed(2), Math.round(r.hra).toString(), 'Projected True HRA');

      let comparisonHtml = '';
      if (comparison) {
          const gradeClass = comparison.grade === 'A' ? 'rating-elite' : comparison.grade === 'B' ? 'rating-plus' : comparison.grade === 'C' ? 'rating-avg' : comparison.grade === 'D' ? 'rating-fringe' : 'rating-poor';
          const diffText = comparison.diff > 0 ? `+${comparison.diff.toFixed(2)}` : comparison.diff.toFixed(2);
          
          const actStuff = RatingEstimatorService.estimateStuff(comparison.k9, comparison.ip).rating;
          const actControl = RatingEstimatorService.estimateControl(comparison.bb9, comparison.ip).rating;
          const actHra = RatingEstimatorService.estimateHRA(comparison.hr9, comparison.ip).rating;

          const k9ActFlip = this.renderFlipCell(comparison.k9.toFixed(2), actStuff.toString(), 'Estimated Stuff (Snapshot)');
          const bb9ActFlip = this.renderFlipCell(comparison.bb9.toFixed(2), actControl.toString(), 'Estimated Control (Snapshot)');
          const hr9ActFlip = this.renderFlipCell(comparison.hr9.toFixed(2), actHra.toString(), 'Estimated HRA (Snapshot)');

          comparisonHtml = `
            <tr style="border-top: 1px solid var(--color-border);">
                <td style="font-weight: bold; color: var(--color-text-muted); padding: 0.625rem 0.15rem;">Actual (${projectedYear})</td>
                <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${comparison.ip.toFixed(0)}</td>
                <td style="padding: 0.625rem 0.15rem; width: 55px;"></td>
                <td style="font-weight: bold; text-align: center; padding: 0.625rem 0.15rem; width: 60px;">${comparison.fip.toFixed(2)}</td>
                <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${k9ActFlip}</td>
                <td style="padding: 0.625rem 0.15rem; width: 55px;"></td>
                <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${bb9ActFlip}</td>
                <td style="padding: 0.625rem 0.15rem; width: 55px;"></td>
                <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${hr9ActFlip}</td>
                <td style="padding: 0.625rem 0.15rem; width: 55px;"></td>
                <td style="text-align: center; padding: 0.625rem 0.15rem; width: 50px;">${comparison.war.toFixed(1)}</td>
            </tr>
            <tr>
                <td colspan="3" style="text-align: right; color: var(--color-text-muted); font-size: 0.85em; padding-right: 1rem;">Projection Accuracy:</td>
                <td style="font-weight: bold; text-align: center; padding: 0.625rem 0.15rem;">${diffText} <span style="font-size: 0.8em; font-weight: normal; color: var(--color-text-muted);">(&Delta;FIP)</span></td>
                <td colspan="6"></td>
                <td style="text-align: center; padding: 0.625rem 0.15rem;"><span class="badge ${gradeClass}" style="min-width: 24px;">${comparison.grade}</span></td>
            </tr>
          `;
      }

      return `
        <div class="projection-section" style="margin-top: 1.5rem; border-top: 1px solid var(--color-border); padding-top: 1rem;">
            <h4 style="margin-bottom: 0.5rem; color: var(--color-text-muted); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em;">${title}</h4>
            <div class="stats-table-container">
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 0.625rem 0.15rem;"></th>
                            <th colspan="2" style="text-align: center; padding: 0.625rem 0.15rem;">IP</th>
                            <th style="text-align: center; padding: 0.625rem 0.15rem;">FIP</th>
                            <th colspan="2" style="text-align: center; padding: 0.625rem 0.15rem;">K/9</th>
                            <th colspan="2" style="text-align: center; padding: 0.625rem 0.15rem;">BB/9</th>
                            <th colspan="2" style="text-align: center; padding: 0.625rem 0.15rem;">HR/9</th>
                            <th style="text-align: center; padding: 0.625rem 0.15rem;">WAR</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr style="background-color: rgba(var(--color-primary-rgb), 0.1);">
                            <td style="font-weight: bold; color: var(--color-primary); padding: 0.625rem 0.15rem; width: 100px;">Proj</td>
                            <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${s.ip.toFixed(0)}</td>
                            <td style="text-align: left; padding: 0.625rem 0.15rem; font-size: 0.85em; width: 55px;">${ipDelta}</td>
                            <td style="font-weight: bold; text-align: center; padding: 0.625rem 0.15rem; width: 60px;">${s.fip.toFixed(2)}</td>
                            <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${k9ProjFlip}</td>
                            <td style="text-align: left; padding: 0.625rem 0.15rem; font-size: 0.85em; width: 55px;">${k9Delta}</td>
                            <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${bb9ProjFlip}</td>
                            <td style="text-align: left; padding: 0.625rem 0.15rem; font-size: 0.85em; width: 55px;">${bb9Delta}</td>
                            <td style="text-align: right; padding: 0.625rem 0.15rem; width: 45px;">${hr9ProjFlip}</td>
                            <td style="text-align: left; padding: 0.625rem 0.15rem; font-size: 0.85em; width: 55px;">${hr9Delta}</td>
                            <td style="text-align: center; padding: 0.625rem 0.15rem; width: 50px;">${s.war.toFixed(1)}</td>
                        </tr>
                        ${comparisonHtml}
                    </tbody>
                </table>
                <div style="font-size: 0.8em; color: var(--color-text-muted); margin-top: 0.5rem;">
                    ${note}
                </div>
            </div>
        </div>
      `;
  }

  private renderFlipCell(front: string, back: string, title: string): string {
    return `
      <div class="flip-cell">
        <div class="flip-cell-inner">
          <div class="flip-cell-front">${front}</div>
          <div class="flip-cell-back">
            ${back}
            <span class="flip-tooltip">${title}</span>
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
