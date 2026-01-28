import { Player, Position, getPositionLabel } from '../models/Player';
import { trueRatingsCalculationService, getYearWeights, YearlyPitchingStats } from '../services/TrueRatingsCalculationService';
import { trueRatingsService, PlayerYearlyDetail } from '../services/TrueRatingsService';
import { PlayerRatingsCard, PlayerRatingsData, SeasonStatsRow } from './PlayerRatingsCard';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';
import { dateService } from '../services/DateService';
import { projectionService } from '../services/ProjectionService';
import { playerService } from '../services/PlayerService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { fipWarService } from '../services/FipWarService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';

export type { PlayerRatingsData as PlayerProfileData };

export class PlayerProfileModal {
  private overlay: HTMLElement | null = null;
  private modal: HTMLElement | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private positionAgeElement: HTMLElement | null = null;

  // State for interactive year selection
  private currentPlayerData: PlayerRatingsData | null = null;
  private originalPlayerData: PlayerRatingsData | null = null; // Immutable original data for toggle calculations
  private currentPlayer: any | null = null;
  private currentMlbStats: SeasonStatsRow[] = [];
  private mlbDebutYear: number | null = null;
  private leagueFipLikes: number[] = [];
  private cachedLeagueAverages: any = null; // Store league averages from table for consistent recalculation
  private cachedMlbStats: YearlyPitchingStats[] | null = null; // Store MLB stats from table for consistent recalculation

  // League configuration
  private readonly LEAGUE_START_YEAR = 2000;

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
          ${this.renderLoadingContent()}
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

  async show(data: PlayerRatingsData, selectedYear: number, context?: { leagueFipLikes?: number[]; leagueAverages?: any; mlbStats?: YearlyPitchingStats[] }): Promise<void> {
    this.ensureOverlayExists();
    if (!this.overlay) return;

    // Store context
    if (context?.leagueFipLikes) {
        this.leagueFipLikes = context.leagueFipLikes;
    }
    if (context?.leagueAverages) {
        this.cachedLeagueAverages = context.leagueAverages;
    }
    if (context?.mlbStats) {
        this.cachedMlbStats = context.mlbStats;
    }

    // Store current data for interactive year selection
    this.currentPlayerData = data;
    // Store immutable original for toggle calculations
    this.originalPlayerData = { ...data };

    // Fetch player info first for age display
    const player = await playerService.getPlayerById(data.playerId);
    this.currentPlayer = player;

    // Update header
    const titleEl = this.overlay.querySelector<HTMLElement>('.modal-title');
    const teamEl = this.overlay.querySelector<HTMLElement>('.player-team-info');
    this.positionAgeElement = this.overlay.querySelector<HTMLElement>('.player-position-age');
    const headerSlot = this.overlay.querySelector<HTMLElement>('.ratings-header-slot');
    const metadataSlot = this.overlay.querySelector<HTMLElement>('.metadata-header-slot');
    const pitchesSlot = this.overlay.querySelector<HTMLElement>('.pitches-header-slot');

    if (titleEl) titleEl.textContent = data.playerName;
    if (teamEl) {
      const teamInfo = PlayerRatingsCard.formatTeamInfo(data.team, data.parentTeam);
      teamEl.innerHTML = teamInfo;
      teamEl.style.display = teamInfo ? '' : 'none';
    }
    this.refreshPositionAgeLabel();
    if (headerSlot) {
      headerSlot.innerHTML = PlayerRatingsCard.renderRatingEmblem(data);
      // Trigger shimmer animation on rating emblem
      requestAnimationFrame(() => {
        const emblem = headerSlot.querySelector<HTMLElement>('.rating-emblem');
        const emblemFill = headerSlot.querySelector<HTMLElement>('.rating-emblem-bar-fill');
        if (emblem) emblem.classList.add('shimmer-once');
        if (emblemFill) emblemFill.classList.add('shimmer-once');
      });
    }
    if (metadataSlot) {
      metadataSlot.innerHTML = PlayerRatingsCard.renderHeaderMetadata(data);
      // Trigger shimmer animation on metadata bars
      requestAnimationFrame(() => {
        const metadataFills = metadataSlot.querySelectorAll<HTMLElement>('.header-metadata-bar-fill');
        metadataFills.forEach(fill => fill.classList.add('shimmer-once'));
      });
    }
    if (pitchesSlot) {
      pitchesSlot.innerHTML = PlayerRatingsCard.renderHeaderPitches(data);
      requestAnimationFrame(() => {
        const donutFills = pitchesSlot.querySelectorAll<SVGCircleElement>('.pitch-donut-fill');
        donutFills.forEach(fill => {
          fill.style.strokeDashoffset = 'var(--donut-circumference)';
          fill.classList.remove('animate-once');
        });
        window.setTimeout(() => {
          donutFills.forEach(fill => {
            void fill.getBoundingClientRect();
            fill.classList.add('animate-once');
          });
        }, 1000);
      });
    }

    // Show loading state
    const bodyEl = this.overlay.querySelector<HTMLElement>('.modal-body');
    if (bodyEl) {
      bodyEl.innerHTML = this.renderLoadingContent();
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
      // Try to fetch MLB stats, but handle case where player has no MLB history
      let mlbStats: PlayerYearlyDetail[] = [];
      try {
        mlbStats = await trueRatingsService.getPlayerYearlyStats(data.playerId, selectedYear, 5);
      } catch (error) {
        console.warn('No MLB stats found for player, treating as minor league only:', error);
      }
      this.currentMlbStats = mlbStats.map(s => ({ ...s, level: 'MLB' as const }));
      this.refreshPositionAgeLabel();

      // Determine MLB debut year from stats (earliest year with IP > 0)
      // Fetch more years to get accurate debut for veterans
      const currentYear = await dateService.getCurrentYear();
      let extendedStats: PlayerYearlyDetail[] = [];
      try {
        extendedStats = await trueRatingsService.getPlayerYearlyStats(data.playerId, currentYear, 30);
      } catch (error) {
        console.warn('No extended MLB stats found for player:', error);
      }
      const statsWithIp = extendedStats.filter(s => s.ip > 0);
      if (statsWithIp.length > 0) {
        this.mlbDebutYear = Math.min(...statsWithIp.map(s => s.year));
      }

      // Fetch minor league stats (within 2 years of current game date)
      let combinedStats: SeasonStatsRow[] = this.currentMlbStats;

      try {
        const currentYear = await dateService.getCurrentYear();
        const startYear = currentYear - 2;
        const endYear = currentYear;
        const minorStats = await minorLeagueStatsService.getPlayerStats(data.playerId, startYear, endYear);

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
        // Check if we should switch to TFR display for young players with limited MLB track record
        // This ensures 23yo rookies show their potential (TFR) rather than a volatile small-sample TR
        const totalIp = this.currentMlbStats.reduce((sum, s) => sum + s.ip, 0);
        const age = player?.age ?? 30;
        
        if (age < 26 && totalIp < 50 && !data.isProspect && !data.trueFutureRating) {
            try {
                // We need to calculate TFR on the fly
                // Get all minor league stats for context
                const minorStats = combinedStats.filter(s => s.level !== 'MLB').map(s => ({
                    id: data.playerId,
                    name: data.playerName,
                    year: s.year,
                    level: s.level as any,
                    ip: s.ip,
                    k: 0, // Not needed for TFR calc if we have rates, but service might need them
                    bb: 0,
                    hr: 0,
                    k9: s.k9,
                    bb9: s.bb9,
                    hr9: s.hr9
                }));

                const scouting = data.activeScoutSource === 'osa' 
                    ? { stuff: data.osaStuff, control: data.osaControl, hra: data.osaHra, ovr: data.osaOvr, pot: data.osaPot }
                    : { stuff: data.scoutStuff, control: data.scoutControl, hra: data.scoutHra, ovr: data.scoutOvr, pot: data.scoutPot };

                if (scouting.stuff !== undefined) {
                    // Need a reference MLB FIP for percentile. Use average ~4.20
                    const mlbFips = [4.20]; 
                    
                    const tfrInput = {
                        playerId: data.playerId,
                        playerName: data.playerName,
                        age: age,
                        scouting: { ...scouting, playerId: data.playerId } as any,
                        minorLeagueStats: minorStats
                    };

                    const tfrResult = trueFutureRatingService.calculateTrueFutureRatings([tfrInput], mlbFips)[0];
                    
                    if (tfrResult) {
                        data.trueFutureRating = tfrResult.trueFutureRating;
                        data.tfrPercentile = tfrResult.percentile;
                        // data.isProspect = true; // REMOVED: Keep as MLB player to show current year stats/projections
                        
                        // Re-render header to show TFR badge
                        if (headerSlot) {
                            headerSlot.innerHTML = PlayerRatingsCard.renderRatingEmblem(data);
                            const emblem = headerSlot.querySelector<HTMLElement>('.rating-emblem');
                            if (emblem) emblem.classList.add('shimmer-once');
                        }
                    }
                }
            } catch (e) {
                console.warn('Failed to calculate TFR for profile:', e);
            }
        }

        const hasMinorLeague = combinedStats.some(s => s.level && s.level !== 'MLB');
        
        // Calculate Projection
        let projectionHtml = '';

        // Readiness Check
        const currentYear = await dateService.getCurrentYear();
        const projectionTargetYear = data.projectionYear ?? (selectedYear + 1);
        let projectionBaseYear = data.projectionBaseYear ?? (projectionTargetYear - 1);

        // Handle edge case: if base year is before league started, use earliest year
        if (projectionBaseYear < this.LEAGUE_START_YEAR) {
          projectionBaseYear = this.LEAGUE_START_YEAR;
        }

        const historicalAge = projectionService.calculateAgeAtYear(player!, currentYear, projectionBaseYear);

        const hasRecentMlb = mlbStats.some(s => s.year >= projectionBaseYear - 1 && s.ip > 0);
        const isUpperMinors = combinedStats.some(s => (s.level === 'aaa' || s.level === 'aa') && s.year === projectionBaseYear);

        const ovr = data.scoutOvr ?? 20;
        const pot = data.scoutPot ?? 20;
        const starGap = pot - ovr;
        const isQualityProspect = (ovr >= 45) || (starGap <= 1.0 && pot >= 45);

        // Determine if this is a prospect (for peak projection) vs MLB-ready player (for current season)
        const isProspectProjection = data.isProspect === true || (!hasRecentMlb && data.forceProjection);

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
                    // For prospects, use scouting data (3+ pitches + stamina >= 35)
                    const recent = mlbStats[0]; // Most recent year in history
                    let isSp = recent && recent.ip > 80;

                    if (isProspectProjection && data.pitchCount && data.pitchCount >= 3 && (data.scoutStamina ?? 0) >= 35) {
                        isSp = true;
                    }

                    // For prospects, use peak age (27); for MLB players, use next season age
                    const projectionAge = isProspectProjection ? 26 : historicalAge; // Service adds 1, so 26 becomes 27

                    proj = await projectionService.calculateProjection(
                        { stuff: data.estimatedStuff, control: data.estimatedControl, hra: data.estimatedHra },
                        projectionAge,
                        data.pitchCount ?? 0,
                        isSp ? 20 : 0, // Mock GS to trigger SP logic in service
                        leagueContext,
                        data.scoutStamina,
                        data.scoutInjuryProneness,
                        mlbStats,
                        data.trueRating ?? 0,
                        data.pitchRatings
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

                // Display age: For prospects show peak age (27), for MLB show next season
                const displayAge = isProspectProjection ? 27 : historicalAge + 1;
                projectionHtml = this.renderProjection(
                  proj,
                  displayAge,
                  projectionTargetYear,
                  comparison,
                  isProspectProjection,
                  currentYear,
                  this.mlbDebutYear
                );
            }
        }

        bodyEl.innerHTML = this.renderContent(data, combinedStats, hasMinorLeague, projectionHtml);

        this.bindScoutUploadLink();
        this.bindScoutSourceToggle(data, combinedStats, hasMinorLeague, projectionHtml);
        // Trigger shimmer animation on True Ratings bars only (not scout bars)
        requestAnimationFrame(() => {
          const ratingBars = bodyEl.querySelectorAll<HTMLElement>('.bar-estimated.rating-elite, .bar-estimated.rating-plus, .bar-estimated.rating-avg, .bar-estimated.rating-fringe, .bar-estimated.rating-poor');
          ratingBars.forEach(bar => bar.classList.add('shimmer-once'));
        });
        this.bindFlipCardLocking();
        this.bindYearSelector();
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

  private renderProjectionSkeleton(): string {
    return `
      <div class="projection-section loading-skeleton">
        <h4 class="skeleton-line md"></h4>
        <div class="stats-table-container">
          <table class="stats-table skeleton-table">
            <thead>
              <tr>
                ${Array.from({ length: 11 }, () => '<th><span class="skeleton-line xs"></span></th>').join('')}
              </tr>
            </thead>
            <tbody>
              ${Array.from({ length: 2 }, () => `
                <tr>
                  ${Array.from({ length: 11 }, () => '<td><span class="skeleton-line xs"></span></td>').join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
          <div class="skeleton-line lg"></div>
        </div>
      </div>
    `;
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
          ${Array.from({ length: 3 }, () => `
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
        ${this.renderProjectionSkeleton()}
        <div class="stats-history loading-skeleton">
          <h4 class="section-label skeleton-line sm"></h4>
          <div class="table-wrapper">
            <table class="stats-table skeleton-table">
              <thead>
                <tr>
                  ${Array.from({ length: 8 }, () => '<th><span class="skeleton-line xs"></span></th>').join('')}
                </tr>
              </thead>
              <tbody>
                ${Array.from({ length: 5 }, () => `
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

  private renderProjection(
    proj: { projectedStats: any, projectedRatings: any },
    projectionAge: number,
    projectedYear: number,
    comparison?: any,
    isProspect: boolean = false,
    currentYear: number = 2021,
    mlbDebutYear: number | null = null
  ): string {
      const s = proj.projectedStats;
      const r = proj.projectedRatings;

      // Build year selector for non-prospects
      let yearDisplay = `${projectedYear}`;
      if (!isProspect && mlbDebutYear !== null) {
        const validYears: number[] = [];
        for (let y = mlbDebutYear; y <= currentYear; y++) {
          validYears.push(y);
        }

        const options = validYears
          .map(y => `<div class="year-option ${y === projectedYear ? 'selected' : ''}" data-year="${y}">${y}</div>`)
          .join('');

        yearDisplay = `<span class="projection-year-wrapper">
          <strong class="projection-year-trigger">${projectedYear}</strong>
          <div class="projection-year-dropdown">${options}</div>
        </span>`;
      }

      // Determine confidence based on IP history
      const totalIp = (this.currentMlbStats || []).reduce((sum, s) => sum + s.ip, 0);
      const isLowConfidence = !isProspect && totalIp < 50;
      
      const confidenceWarning = isLowConfidence
        ? ` <span class="confidence-warning" title="Low Confidence: Limited MLB track record (<50 IP). Projection relies heavily on scouting/ratings.">⚠️</span>`
        : '';

      const title = isProspect
        ? `Peak Year Projection <span style="font-weight: normal; opacity: 0.8;">(Age ${projectionAge})</span>`
        : `${yearDisplay} Season Projection <span style="font-weight: normal; opacity: 0.8;">(${projectionAge}yo)</span>${confidenceWarning}`;
      const note = isProspect
        ? '* Peak year projection based on True Future Rating. Assumes full development and optimal performance.'
        : '* Projection based on prior year True Ratings. Delta = Projected - Actual. Hover cells to show ratings.';

      const formatDelta = (projVal: number, actVal: number) => {
          const delta = projVal - actVal;
          const sign = delta > 0 ? '+' : '';
          if (Math.abs(delta) < 0.01) return `<span class="stat-delta">(0.00)</span>`;

          const percentDiff = projVal !== 0 ? Math.abs(delta / projVal) * 100 : 0;
          let className = 'diff-positive';
          if (percentDiff > 15) {
              className = 'diff-negative';
          } else if (percentDiff > 10) {
              className = 'diff-neutral';
          }
          return `<span class="stat-delta ${className}">(${sign}${delta.toFixed(2)})</span>`;
      };

      const k9Delta = comparison ? formatDelta(s.k9, comparison.k9) : '';
      const bb9Delta = comparison ? formatDelta(s.bb9, comparison.bb9) : '';
      const hr9Delta = comparison ? formatDelta(s.hr9, comparison.hr9) : '';
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
      const tabId = link.dataset.tabTarget ?? 'tab-data-management';
      window.dispatchEvent(new CustomEvent('wbl:navigate-tab', { detail: { tabId } }));
    });
  }

  private bindScoutSourceToggle(
    data: PlayerRatingsData,
    stats: SeasonStatsRow[],
    hasMinorLeague: boolean,
    projectionHtml: string
  ): void {
    if (!this.overlay) return;
    const toggleContainer = this.overlay.querySelector<HTMLElement>('.scout-header-toggle.custom-dropdown');
    if (!toggleContainer) return;

    const items = toggleContainer.querySelectorAll<HTMLElement>('.dropdown-item');
    items.forEach(item => {
      item.addEventListener('click', async (e) => {
        const newSource = (e.target as HTMLElement).dataset.value as 'my' | 'osa';
        if (!newSource || newSource === data.activeScoutSource) return;

        // Show loading state for modal content? Or just update.
        // Since we are doing async calculations, maybe show a spinner or opacity?
        const bodyEl = this.overlay?.querySelector<HTMLElement>('.modal-body');
        if (bodyEl) bodyEl.style.opacity = '0.5';

        try {
            // IMPORTANT: Always calculate from ORIGINAL data, not mutated data
            const baseData = this.originalPlayerData || data;

            // Update data with new active source
            const updatedData = {
              ...baseData,
              activeScoutSource: newSource
            };

            // 1. Re-calculate True Ratings for THIS player only
            const scoutRatings = newSource === 'osa'
                ? { stuff: baseData.osaStuff, control: baseData.osaControl, hra: baseData.osaHra }
                : { stuff: baseData.scoutStuff, control: baseData.scoutControl, hra: baseData.scoutHra };

            // Use cached league averages from table to ensure consistency
            // If not available, fetch them (but this should rarely happen)
            const year = baseData.year ?? await dateService.getCurrentYear();
            const leagueAverages = this.cachedLeagueAverages ?? await trueRatingsService.getLeagueAverages(year);

            // We need year weights
            const currentYear = await dateService.getCurrentYear();
            let yearWeights: number[] | undefined;
            if (year === currentYear) {
                const stage = await dateService.getSeasonStage();
                yearWeights = getYearWeights(stage);
            }

            if (scoutRatings.stuff !== undefined && this.currentMlbStats.length > 0) {
                // Use cached MLB stats from table if available (ensures exact match with table calculation)
                // Otherwise fall back to fetched stats
                const statsToUse = this.cachedMlbStats ?? this.currentMlbStats;

                // Calculate for single player (without percentile ranking)
                const trInput = {
                    playerId: baseData.playerId,
                    playerName: baseData.playerName,
                    yearlyStats: statsToUse,
                    scoutingRatings: { ...scoutRatings, playerId: baseData.playerId } as any
                };

                const trResult = trueRatingsCalculationService.calculateSinglePitcher(trInput, leagueAverages, yearWeights);
                
                if (trResult) {
                    updatedData.trueRating = trResult.trueRating;
                    updatedData.estimatedStuff = trResult.estimatedStuff;
                    updatedData.estimatedControl = trResult.estimatedControl;
                    updatedData.estimatedHra = trResult.estimatedHra;
                    updatedData.fipLike = trResult.fipLike;
                    
                    // 2. Re-rank against cached league distribution
                    if (this.leagueFipLikes.length > 0) {
                        const val = trResult.fipLike;

                        // Sort all FIPs including the player's new value
                        const allFips = [...this.leagueFipLikes, val].sort((a, b) => a - b);
                        const n = allFips.length;

                        // Count how many are worse (higher FIP)
                        const worseCount = allFips.filter(f => f > val).length;

                        // Count ties
                        const tieCount = allFips.filter(f => f === val).length;

                        // Rank calculation (lower FIP = better = lower rank number)
                        // rank = 1 + (players better than me) + (ties / 2)
                        const betterCount = n - worseCount - tieCount;
                        const rank = betterCount + 1 + (tieCount - 1) / 2;

                        // Convert rank to percentile (inverted so higher = better)
                        // percentile = (players worse than me) / total
                        const percentile = ((n - rank + 0.5) / n) * 100;
                        updatedData.percentile = Math.round(percentile * 10) / 10;
                        updatedData.trueRating = trueRatingsCalculationService.percentileToRating(updatedData.percentile);
                    }
                }
            }

            // 2. Re-calculate Projection
            // Only if not a force-projected prospect (TFR)
            let newProjectionHtml = projectionHtml;
            if (!baseData.isProspect) {
                const currentYear = await dateService.getCurrentYear();
                const projectionTargetYear = baseData.projectionYear ?? (baseData.year ? baseData.year + 1 : currentYear + 1);
                let projectionBaseYear = baseData.projectionBaseYear ?? (projectionTargetYear - 1);
                
                if (projectionBaseYear < this.LEAGUE_START_YEAR) projectionBaseYear = this.LEAGUE_START_YEAR;

                const historicalAge = projectionService.calculateAgeAtYear(this.currentPlayer!, currentYear, projectionBaseYear);
                
                const leagueStats = await leagueStatsService.getLeagueStats(projectionBaseYear);
                const leagueContext = {
                    fipConstant: leagueStats.fipConstant,
                    avgFip: leagueStats.avgFip,
                    runsPerWin: 8.5
                };

                const recent = this.currentMlbStats[0];
                let isSp = recent && recent.ip > 80;
                
                const proj = await projectionService.calculateProjection(
                    { 
                        stuff: updatedData.estimatedStuff!, 
                        control: updatedData.estimatedControl!, 
                        hra: updatedData.estimatedHra! 
                    },
                    historicalAge,
                    updatedData.pitchCount ?? 0,
                    isSp ? 20 : 0,
                    leagueContext,
                    updatedData.scoutStamina,
                    updatedData.scoutInjuryProneness,
                    this.currentMlbStats,
                    updatedData.trueRating ?? 0,
                    updatedData.pitchRatings
                );

                // Re-render projection HTML (simplified - assuming no comparison update needed for basic toggle)
                const displayAge = historicalAge + 1;
                newProjectionHtml = this.renderProjection(
                    proj,
                    displayAge,
                    projectionTargetYear,
                    undefined, // No comparison re-calc for now
                    false,
                    currentYear,
                    this.mlbDebutYear
                );
            }

            if (bodyEl) {
              bodyEl.style.opacity = '1';
              bodyEl.innerHTML = this.renderContent(updatedData, stats, hasMinorLeague, newProjectionHtml);
              
              // Re-render Header (Badge)
              const headerSlot = this.overlay?.querySelector<HTMLElement>('.ratings-header-slot');
              if (headerSlot) {
                  headerSlot.innerHTML = PlayerRatingsCard.renderRatingEmblem(updatedData);
                  const emblem = headerSlot.querySelector<HTMLElement>('.rating-emblem');
                  if (emblem) emblem.classList.add('shimmer-once');
              }

              this.bindScoutUploadLink();
              this.bindScoutSourceToggle(updatedData, stats, hasMinorLeague, newProjectionHtml);
              requestAnimationFrame(() => {
                 const ratingBars = bodyEl.querySelectorAll<HTMLElement>('.bar-estimated.rating-elite, .bar-estimated.rating-plus, .bar-estimated.rating-avg, .bar-estimated.rating-fringe, .bar-estimated.rating-poor');
                 ratingBars.forEach(bar => bar.classList.add('shimmer-once'));
              });
              this.bindFlipCardLocking();
              this.bindYearSelector();
            }
        } catch (error) {
            console.error('Error updating scout source:', error);
            if (bodyEl) bodyEl.style.opacity = '1';
        }
      });
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

  private bindYearSelector(): void {
    if (!this.overlay) return;
    const wrapper = this.overlay.querySelector<HTMLElement>('.projection-year-wrapper');
    if (!wrapper) return;

    const trigger = wrapper.querySelector<HTMLElement>('.projection-year-trigger');
    const dropdown = wrapper.querySelector<HTMLElement>('.projection-year-dropdown');
    const options = wrapper.querySelectorAll<HTMLElement>('.year-option');

    if (!trigger || !dropdown || options.length === 0) return;

    // Show dropdown on hover
    wrapper.addEventListener('mouseenter', () => {
      dropdown.classList.add('visible');
    });

    wrapper.addEventListener('mouseleave', () => {
      dropdown.classList.remove('visible');
    });

    // Handle option clicks
    options.forEach(option => {
      option.addEventListener('click', async () => {
        const newYear = parseInt(option.dataset.year || '', 10);
        if (!isNaN(newYear)) {
          dropdown.classList.remove('visible');
          await this.updateProjectionForYear(newYear);
        }
      });
    });
  }

  private async updateProjectionForYear(targetYear: number): Promise<void> {
    if (!this.currentPlayerData || !this.currentPlayer || !this.overlay) return;

    const projectionSection = this.overlay.querySelector<HTMLElement>('.projection-section');
    if (!projectionSection) return;

    // Show loading state
    projectionSection.innerHTML = this.renderProjectionSkeleton();

    try {
      const currentYear = await dateService.getCurrentYear();
      let projectionBaseYear = targetYear - 1;

      // Handle edge case: if base year is before league started, use earliest year
      if (projectionBaseYear < this.LEAGUE_START_YEAR) {
        projectionBaseYear = this.LEAGUE_START_YEAR;
      }

      const historicalAge = projectionService.calculateAgeAtYear(this.currentPlayer, currentYear, projectionBaseYear);

      // Recalculate projection
      let proj = this.currentPlayerData.projectionOverride;

      if (!proj && typeof this.currentPlayerData.estimatedStuff === 'number' &&
          typeof this.currentPlayerData.estimatedControl === 'number' &&
          typeof this.currentPlayerData.estimatedHra === 'number') {
        try {
          const leagueStats = await leagueStatsService.getLeagueStats(projectionBaseYear);
          const leagueContext = {
            fipConstant: leagueStats.fipConstant,
            avgFip: leagueStats.avgFip,
            runsPerWin: 8.5
          };

          const recent = this.currentMlbStats[0];
          let isSp = recent && recent.ip > 80;
          const projectionAge = historicalAge;

          proj = await projectionService.calculateProjection(
            {
              stuff: this.currentPlayerData.estimatedStuff,
              control: this.currentPlayerData.estimatedControl,
              hra: this.currentPlayerData.estimatedHra
            },
            projectionAge,
            this.currentPlayerData.pitchCount ?? 0,
            isSp ? 20 : 0,
            leagueContext,
            this.currentPlayerData.scoutStamina,
            this.currentPlayerData.scoutInjuryProneness,
            this.currentMlbStats,
            this.currentPlayerData.trueRating ?? 0,
            this.currentPlayerData.pitchRatings
          );
        } catch (e) {
          console.warn('Failed to calculate projection', e);
        }
      }

      if (!proj) {
        projectionSection.innerHTML = '<div class="error-message">Failed to calculate projection.</div>';
        return;
      }

      // Fetch actual stats for comparison if available
      let actualStat: SeasonStatsRow | undefined;
      if (targetYear < currentYear) {
        try {
          const targetStats = await trueRatingsService.getTruePitchingStats(targetYear);
          const playerStat = targetStats.find(s => s.player_id === this.currentPlayerData!.playerId);
          if (playerStat) {
            const ip = trueRatingsService.parseIp(playerStat.ip);
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

      const displayAge = historicalAge + 1;
      const projectionHtml = this.renderProjection(
        proj,
        displayAge,
        targetYear,
        comparison,
        false, // Not a prospect projection
        currentYear,
        this.mlbDebutYear
      );

      projectionSection.outerHTML = projectionHtml;

      // Re-bind events after rendering
      this.bindFlipCardLocking();
      this.bindYearSelector();
      this.refreshPositionAgeLabel();
    } catch (error) {
      console.error('Failed to update projection:', error);
      projectionSection.innerHTML = '<div class="error-message">Failed to update projection.</div>';
    }
  }

  private refreshPositionAgeLabel(): void {
    if (!this.positionAgeElement || !this.currentPlayerData) return;
    const positionAgeText = this.buildPositionAgeText(this.currentPlayerData, this.currentPlayer ?? null);
    this.positionAgeElement.textContent = positionAgeText;
    this.positionAgeElement.style.display = positionAgeText ? '' : 'none';
  }

  private buildPositionAgeText(data: PlayerRatingsData, player: Player | null): string {
    const parts: string[] = [];
    const positionLabel = this.getProfilePositionLabel(data, player);
    if (positionLabel) {
      parts.push(positionLabel);
    }
    const ageValue = this.getProfileAgeValue(data, player);
    if (typeof ageValue === 'number') {
      parts.push(`Age: ${ageValue}`);
    }
    return parts.join(', ');
  }

  private getProfilePositionLabel(data: PlayerRatingsData, player: Player | null): string | undefined {
    if (data.positionLabel && data.positionLabel !== 'P') {
      return data.positionLabel;
    }
    if (data.position) {
      return data.position;
    }
    const playerPositionLabel = player ? getPositionLabel(player.position) : undefined;
    if (playerPositionLabel === 'P' || data.positionLabel === 'P') {
      const pitcherRole = this.determinePitcherRoleLabel(data, player);
      return pitcherRole ?? playerPositionLabel;
    }
    return playerPositionLabel;
  }

  private getProfileAgeValue(data: PlayerRatingsData, player: Player | null): number | undefined {
    if (typeof data.age === 'number') {
      return data.age;
    }
    return player?.age;
  }

  private determinePitcherRoleLabel(data: PlayerRatingsData, player: Player | null): 'SP' | 'RP' | undefined {
    const playerRoleValue = player?.role ?? 0;
    const hasRecentMlb = this.currentMlbStats.some((stat) => stat.ip > 0);
    const usablePitches = data.pitchRatings
      ? Object.values(data.pitchRatings).filter((rating) => rating >= 25).length
      : 0;
    const stamina = data.scoutStamina ?? 0;
    const trueRating = data.trueRating ?? 0;

    const meetsProfile = usablePitches >= 3 && stamina >= 35 && (!hasRecentMlb || trueRating >= 2);
    if (meetsProfile || playerRoleValue === 11) {
      return 'SP';
    }

    const hasStarterStats = this.currentMlbStats.some((stat) => stat.gs >= 5 && stat.ip > 10);
    if (hasStarterStats) {
      return 'SP';
    }

    const isPitcher = player ? player.position === Position.Pitcher : data.position === 'SP' || data.position === 'RP';
    if (!isPitcher) {
      return undefined;
    }

    if (stamina < 35 || (data.pitchCount ?? 0) < 3) {
      return 'RP';
    }

    return undefined;
  }
}
