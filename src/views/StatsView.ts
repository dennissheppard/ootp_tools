import { Player, getFullName, getPositionLabel, isPitcher } from '../models/Player';
import { PitchingStats, BattingStats, MinorLeagueStatsWithLevel } from '../models/Stats';
import { trueRatingsService } from '../services/TrueRatingsService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { dateService } from '../services/DateService';
import { PlayerRatingsCard, PlayerRatingsData, SeasonStatsRow } from './PlayerRatingsCard';
import { projectionService } from '../services/ProjectionService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { trueFutureRatingService } from '../services/TrueFutureRatingService';
import { minorLeagueStatsService } from '../services/MinorLeagueStatsService';

export interface SendToEstimatorPayload {
  k9: number;
  bb9: number;
  hr9: number;
  ip: number;
  year: number;
  playerName: string;
}

interface StatsViewOptions {
  onSendToEstimator?: (payload: SendToEstimatorPayload) => void;
}

export class StatsView {
  private container: HTMLElement;
  private onSendToEstimator?: (payload: SendToEstimatorPayload) => void;
  private selectedPitchingIndex: number | null = null;

  constructor(container: HTMLElement, options?: StatsViewOptions) {
    this.container = container;
    this.onSendToEstimator = options?.onSendToEstimator;
  }

  async render(
    player: Player,
    pitchingStats: PitchingStats[],
    battingStats: BattingStats[],
    minorLeagueStats: MinorLeagueStatsWithLevel[],
    year?: number
  ): Promise<void> {
    this.selectedPitchingIndex = null;
    const playerName = getFullName(player);

    const yearDisplay = year ? ` (${year})` : ' (All Years)';
    const posLabel = getPositionLabel(player.position);

    // Fetch team info
    const team = await teamService.getTeamById(player.teamId);
    let teamLabel = '';
    let parentLabel = '';
    
    if (team) {
      teamLabel = `${team.name} ${team.nickname}`;
      if (team.parentTeamId !== 0) {
        const parent = await teamService.getTeamById(team.parentTeamId);
        if (parent) {
          parentLabel = parent.nickname;
        }
      }
    }

    // Filter to only show split_id === 1 (total stats) for clarity
    const mainPitching = pitchingStats.filter((s) => s.splitId === 1);
    const mainBatting = battingStats.filter((s) => s.splitId === 1);

    const showSendToEstimator = Boolean(this.onSendToEstimator && isPitcher(player) && mainPitching.length > 0);

    // Determine year for ratings lookup
    // If a specific year was requested, use that; otherwise use the most recent year from stats
    // If no stats, default to 2020 (current league year context)
    const ratingsYear = year
      ?? (mainPitching.length > 0 ? Math.max(...mainPitching.map(s => s.year)) : 2020);

    // Get True Rating data for pitchers
    let ratingsData: PlayerRatingsData | null = null;
    if (isPitcher(player)) {
      ratingsData = await this.fetchPlayerRatings(player.id, playerName, ratingsYear);
      if (ratingsData) {
        ratingsData.team = teamLabel;
        ratingsData.parentTeam = parentLabel;
      }
    }

    // Fetch MLB yearly stats and merge with minor league stats
    const mlbYearlyStats = isPitcher(player)
      ? await trueRatingsService.getPlayerYearlyStats(player.id, ratingsYear, 5)
      : [];

    // Convert MLB stats to SeasonStatsRow with level
    const mlbStatsWithLevel: SeasonStatsRow[] = mlbYearlyStats.map(s => ({ ...s, level: 'MLB' as const }));

    // Convert minor league stats to SeasonStatsRow format
    const minorStatsConverted: SeasonStatsRow[] = minorLeagueStats.map(s => {
      // Calculate FIP: ((13*HR9) + (3*BB9) - (2*K9)) / 9 + constant
      const fip = ((13 * s.hr9) + (3 * s.bb9) - (2 * s.k9)) / 9 + 3.47;

      return {
        year: s.year,
        level: s.level,
        ip: s.ip,
        fip: Math.round(fip * 100) / 100,
        k9: s.k9,
        bb9: s.bb9,
        hr9: s.hr9,
        war: 0, // Not available for minor league stats
        gs: 0
      };
    });

    // Merge and sort by year descending, then by level (MLB first within same year)
    const levelOrder = { 'MLB': 0, 'aaa': 1, 'aa': 2, 'a': 3, 'r': 4 };
    const yearlyPitchingStats: SeasonStatsRow[] = [...mlbStatsWithLevel, ...minorStatsConverted]
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return (levelOrder[a.level || 'MLB'] || 0) - (levelOrder[b.level || 'MLB'] || 0);
      });

    const hasScouting = ratingsData ? PlayerRatingsCard.hasScoutingData(ratingsData) : false;
    const hasMinorLeagueStats = minorStatsConverted.length > 0;

    // Calculate Projection
    let projectionHtml = '';
    if (isPitcher(player) && ratingsData) {
        try {
            if (typeof ratingsData.estimatedStuff === 'number' && typeof ratingsData.estimatedControl === 'number' && typeof ratingsData.estimatedHra === 'number') {
                const leagueStats = await leagueStatsService.getLeagueStats(ratingsYear);
                const leagueContext = {
                    fipConstant: leagueStats.fipConstant,
                    avgFip: leagueStats.avgFip,
                    runsPerWin: 8.5
                };
                
                // Estimate role
                const recent = mlbYearlyStats[0];
                const isSp = recent && recent.ip > 80;
                
                const currentYear = await dateService.getCurrentYear();
                const historicalAge = projectionService.calculateAgeAtYear(player, currentYear, ratingsYear);

                const proj = await projectionService.calculateProjection(
                    { stuff: ratingsData.estimatedStuff, control: ratingsData.estimatedControl, hra: ratingsData.estimatedHra },
                    historicalAge,
                    0, // pitch count
                    isSp ? 20 : 0, // Mock GS
                    leagueContext,
                    ratingsData.scoutStamina,
                    ratingsData.scoutInjuryProneness,
                    mlbYearlyStats,
                    ratingsData.trueRating ?? 0,
                    ratingsData.pitchRatings
                );

                projectionHtml = this.renderProjection(proj, historicalAge + 1);
            }
        } catch (e) {
            console.warn('Projection error', e);
        }
    }

    const sendAction = showSendToEstimator
      ? `
        <div class="stats-actions">
          <button class="btn btn-secondary send-to-estimator" disabled>Send to Ratings Estimator</button>
        </div>
      `
      : '';
    const helpText = isPitcher(player) && yearlyPitchingStats.length > 0
      ? `
        <div class="ratings-help-text">
          <p>* <strong>Estimated Ratings</strong> (visible when hovering over K/9, BB/9, HR/9) are snapshots based solely on that single stat. <strong>True Ratings</strong> use sophisticated multi-year analysis and regression.</p>
        </div>
      `
      : '';
    const pitchingTable = isPitcher(player)
      ? `${helpText}${sendAction}${projectionHtml}${PlayerRatingsCard.renderSeasonStatsTable(yearlyPitchingStats, { selectable: showSendToEstimator, hasScouting, showLevel: hasMinorLeagueStats })}`
      : '';
    const battingTable = mainBatting.length > 0
      ? this.renderBattingTable(mainBatting)
      : '';

    const ratingEmblem = ratingsData
      ? PlayerRatingsCard.renderRatingEmblem(ratingsData)
      : '';
    const ratingsCard = ratingsData
      ? PlayerRatingsCard.renderInline(ratingsData, { includeHeader: false })
      : '';

    const noStats = !pitchingTable && !battingTable;
    const noStatsMessage = noStats
      ? `<p class="no-stats">No stats found for this player${yearDisplay}.</p>`
      : '';
      
    const teamDisplay = teamLabel 
        ? `<div class="player-team-display">${teamLabel}${parentLabel ? ` <span class="player-parent-org">(${parentLabel})</span>` : ''}</div>` 
        : '';

    this.container.innerHTML = `
      <div class="stats-container">
        <div class="profile-header profile-header-page">
          <div class="profile-title-group">
            <h2 class="player-title">${this.escapeHtml(playerName)}</h2>
            <span class="player-badges">
              <span class="badge badge-position">${posLabel}</span>
              <span class="badge badge-age">Age ${player.age}</span>
              ${player.retired ? '<span class="badge badge-retired">Retired</span>' : ''}
            </span>
            ${teamDisplay}
            <span class="stats-period-label">Stats${yearDisplay}</span>
          </div>
          <div class="profile-header-right">
            ${ratingEmblem}
          </div>
        </div>
        ${ratingsCard}
        ${noStatsMessage}
        ${isPitcher(player) ? pitchingTable + battingTable : battingTable + pitchingTable}
      </div>
    `;

    if (showSendToEstimator && yearlyPitchingStats.length > 0) {
      this.bindPitchingSelection(yearlyPitchingStats, playerName);
    }

    this.bindScoutUploadLink();
    this.bindFlipCardLocking();
  }

  private renderProjection(proj: { projectedStats: any, projectedRatings: any }, projectionAge: number, isProspect: boolean = false): string {
      const s = proj.projectedStats;
      const r = proj.projectedRatings;
      const title = isProspect ? `Peak Year Projection (Age ${projectionAge})` : `${projectionAge}yo Season Projection`;
      const note = isProspect
          ? '* Peak year projection based on True Future Rating. Assumes full development and optimal performance. Everything would need to go perfect for this to happen.'
          : '* Based on current True Ratings and standard aging curves. Parentheses show Projected True Ratings.';

      return `
        <div class="projection-section" style="margin-top: 1.5rem; border-top: 1px solid var(--color-border); padding-top: 1rem;">
            <h4 style="margin-bottom: 0.5rem; color: var(--color-text-muted); font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em;">${title}</h4>
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
                            <td>${projectionAge}</td>
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
                    ${note}
                </div>
            </div>
        </div>
      `;
  }

  private async fetchPlayerRatings(playerId: number, playerName: string, year: number): Promise<PlayerRatingsData | null> {
    try {
      // Fetch both 'my' and OSA scout data for UI display toggle
      const [myScoutingRatings, osaScoutingRatings] = await Promise.all([
        scoutingDataService.getLatestScoutingRatings('my'),
        scoutingDataService.getLatestScoutingRatings('osa')
      ]);

      const myScoutingLookup = this.buildScoutingLookup(myScoutingRatings);
      const osaScoutingLookup = this.buildScoutingLookup(osaScoutingRatings);

      const myScoutMatch = this.resolveScoutingFromLookup(playerId, playerName, myScoutingLookup);
      const osaScoutMatch = this.resolveScoutingFromLookup(playerId, playerName, osaScoutingLookup);

      // For calculations, use fallback lookup (my > osa)
      const scoutingLookup = myScoutingRatings.length > 0 ? myScoutingLookup : osaScoutingLookup;
      const scoutMatch = myScoutMatch || osaScoutMatch;

      // Try to get True Rating from cached data
      const allPitchers = await trueRatingsService.getTruePitchingStats(year);
      const playerStats = allPitchers.find(p => p.player_id === playerId);

      let playerResult: any = null;
      let isProspect = false;
      let tfrData: any = null;

      // Only calculate True Ratings if we have stats and enough IP
      if (playerStats) {
        const ip = trueRatingsService.parseIp(playerStats.ip);
        if (ip >= 10) {
          // Get multi-year stats and league averages for True Rating calculation
          const [multiYearStats, leagueAverages] = await Promise.all([
            trueRatingsService.getMultiYearPitchingStats(year, 3),
            trueRatingsService.getLeagueAverages(year),
          ]);

          // Calculate True Rating with all pitchers for percentile ranking
          // Include scouting data for ALL pitchers to match TrueRatingsView calculation
          const allInputs = allPitchers
            .map(p => {
              const scouting = this.resolveScoutingFromLookup(p.player_id, p.playerName, scoutingLookup);
              return {
                playerId: p.player_id,
                playerName: p.playerName,
                yearlyStats: multiYearStats.get(p.player_id) ?? [],
                scoutingRatings: scouting ? {
                  playerId: p.player_id,
                  playerName: p.playerName,
                  stuff: scouting.stuff,
                  control: scouting.control,
                  hra: scouting.hra,
                } : undefined,
              };
            });

          const results = trueRatingsCalculationService.calculateTrueRatings(allInputs, leagueAverages);
          playerResult = results.find(r => r.playerId === playerId);
        }
      }

      // If no MLB True Rating and we have scouting data, calculate TFR (prospect)
      if (!playerResult && scoutMatch) {
        try {
          // Get player's age
          const player = await playerService.getPlayerById(playerId);
          const age = player?.age ?? 22;

          // Get minor league stats
          const minorStats = await minorLeagueStatsService.getPlayerStats(playerId, year - 2, year);

          // Calculate TFR for this prospect
          const tfrInput = {
            playerId,
            playerName,
            age,
            scouting: {
              playerId,
              playerName,
              stuff: scoutMatch.stuff,
              control: scoutMatch.control,
              hra: scoutMatch.hra,
              ovr: (scoutMatch as any).ovr,
              pot: (scoutMatch as any).pot,
            },
            minorLeagueStats: minorStats,
          };

          const [tfrResult] = await trueFutureRatingService.calculateTrueFutureRatings([tfrInput]);

          if (tfrResult) {
            isProspect = true;
            tfrData = tfrResult;

            // Set estimated ratings from TFR projections
            playerResult = {
              estimatedStuff: Math.round((tfrResult.projK9 - 2.10) / 0.074),
              estimatedControl: Math.round((5.30 - tfrResult.projBb9) / 0.052),
              estimatedHra: Math.round((2.18 - tfrResult.projHr9) / 0.024),
            };
          }
        } catch (error) {
          console.warn('Error calculating TFR:', error);
        }
      }

      // If we have neither calculated ratings nor scout opinions, return null
      if (!playerResult && !scoutMatch) return null;

      return {
        playerId,
        playerName,
        trueRating: playerResult?.trueRating,
        percentile: playerResult?.percentile,
        estimatedStuff: playerResult?.estimatedStuff,
        estimatedControl: playerResult?.estimatedControl,
        estimatedHra: playerResult?.estimatedHra,

        // My Scout data
        scoutStuff: myScoutMatch?.stuff,
        scoutControl: myScoutMatch?.control,
        scoutHra: myScoutMatch?.hra,
        scoutStamina: myScoutMatch?.stamina,
        scoutInjuryProneness: myScoutMatch?.injuryProneness,
        scoutOvr: (myScoutMatch as any)?.ovr,
        scoutPot: (myScoutMatch as any)?.pot,

        // OSA data
        osaStuff: osaScoutMatch?.stuff,
        osaControl: osaScoutMatch?.control,
        osaHra: osaScoutMatch?.hra,
        osaStamina: osaScoutMatch?.stamina,
        osaInjuryProneness: osaScoutMatch?.injuryProneness,
        osaOvr: (osaScoutMatch as any)?.ovr,
        osaPot: (osaScoutMatch as any)?.pot,

        // Toggle state
        activeScoutSource: myScoutMatch ? 'my' : 'osa',
        hasMyScout: !!myScoutMatch,
        hasOsaScout: !!osaScoutMatch,

        isProspect,
        trueFutureRating: tfrData?.trueFutureRating,
        tfrPercentile: tfrData?.percentile,
      };
    } catch (error) {
      console.error('Error fetching player ratings:', error);
      return null;
    }
  }

  private buildScoutingLookup(
    scoutingData: Array<{ playerId: number; playerName?: string; stuff: number; control: number; hra: number }>
  ): { byId: Map<number, typeof scoutingData[0]>; byName: Map<string, typeof scoutingData[0][]> } {
    const byId = new Map<number, typeof scoutingData[0]>();
    const byName = new Map<string, typeof scoutingData[0][]>();

    for (const rating of scoutingData) {
      if (rating.playerId > 0) {
        byId.set(rating.playerId, rating);
      }
      if (rating.playerName) {
        const normalized = this.normalizeName(rating.playerName);
        if (normalized) {
          const list = byName.get(normalized) ?? [];
          list.push(rating);
          byName.set(normalized, list);
        }
      }
    }

    return { byId, byName };
  }

  private resolveScoutingFromLookup(
    playerId: number,
    playerName: string,
    lookup: { byId: Map<number, any>; byName: Map<string, any[]> }
  ): { stuff: number; control: number; hra: number; stamina?: number; injuryProneness?: string } | null {
    // Try by ID first
    const byId = lookup.byId.get(playerId);
    if (byId) {
      return { 
        stuff: byId.stuff, 
        control: byId.control, 
        hra: byId.hra,
        stamina: byId.stamina,
        injuryProneness: byId.injuryProneness
      };
    }

    // Fall back to name matching
    const normalized = this.normalizeName(playerName);
    const matches = lookup.byName.get(normalized);
    if (matches && matches.length === 1) {
      const match = matches[0];
      return { 
        stuff: match.stuff, 
        control: match.control, 
        hra: match.hra,
        stamina: match.stamina,
        injuryProneness: match.injuryProneness
      };
    }

    return null;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(token => token && !suffixes.has(token));
    return tokens.join('');
  }

  private bindScoutUploadLink(): void {
    const link = this.container.querySelector<HTMLAnchorElement>('.scout-upload-link');
    if (!link) return;

    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = link.dataset.tabTarget ?? 'tab-data-management';
      window.dispatchEvent(new CustomEvent('wbl:navigate-tab', { detail: { tabId } }));
    });
  }

  private renderBattingTable(stats: BattingStats[]): string {
    if (stats.length === 0) return '';

    const rows = stats.map((s) => `
      <tr>
        <td>${s.year}</td>
        <td>${s.g}</td>
        <td>${s.pa}</td>
        <td>${s.ab}</td>
        <td>${s.h}</td>
        <td>${s.d}</td>
        <td>${s.t}</td>
        <td>${s.hr}</td>
        <td>${s.r}</td>
        <td>${s.rbi}</td>
        <td>${s.bb}</td>
        <td>${s.k}</td>
        <td>${s.sb}</td>
        <td>${this.formatAvg(s.avg)}</td>
        <td>${this.formatAvg(s.obp)}</td>
        <td>${this.formatAvg(s.slg)}</td>
        <td>${this.formatAvg(s.ops)}</td>
        <td>${this.formatDecimal(s.war, 1)}</td>
      </tr>
    `).join('');

    return `
      <div class="stats-section">
        <h4 class="section-label">Batting Statistics</h4>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>G</th>
                <th>PA</th>
                <th>AB</th>
                <th>H</th>
                <th>2B</th>
                <th>3B</th>
                <th>HR</th>
                <th>R</th>
                <th>RBI</th>
                <th>BB</th>
                <th>K</th>
                <th>SB</th>
                <th>AVG</th>
                <th>OBP</th>
                <th>SLG</th>
                <th>OPS</th>
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

  clear(): void {
    this.container.innerHTML = '';
  }

  private formatDecimal(value: number, decimals: number): string {
    return value.toFixed(decimals);
  }

  private formatAvg(value: number): string {
    if (value >= 1) {
      return value.toFixed(3);
    }
    return value.toFixed(3).replace(/^0/, '');
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private bindPitchingSelection(stats: Array<{ year: number; ip: number; k9: number; bb9: number; hr9: number }>, playerName: string): void {
    const rows = Array.from(this.container.querySelectorAll<HTMLTableRowElement>('.pitching-row'));
    const sendBtn = this.container.querySelector<HTMLButtonElement>('.send-to-estimator');

    if (!rows.length || !sendBtn || !this.onSendToEstimator) return;

    rows.forEach((row, idx) => {
      row.addEventListener('click', () => {
        this.selectedPitchingIndex = idx;
        rows.forEach((r) => r.classList.remove('stats-row-selected'));
        row.classList.add('stats-row-selected');
        sendBtn.disabled = false;
      });
    });

    sendBtn.addEventListener('click', () => {
      if (this.selectedPitchingIndex === null) return;
      const stat = stats[this.selectedPitchingIndex];
      if (!stat) return;

      this.onSendToEstimator?.({
        k9: stat.k9,
        bb9: stat.bb9,
        hr9: stat.hr9,
        ip: stat.ip,
        year: stat.year,
        playerName: playerName,
      });
    });
  }

  private bindFlipCardLocking(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.flip-cell');
    cells.forEach((cell) => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        cell.classList.toggle('is-flipped');
      });
    });

    this.bindFlipTooltipPositioning();
  }

  private bindFlipTooltipPositioning(): void {
    const flipCells = this.container.querySelectorAll<HTMLElement>('.flip-cell');

    flipCells.forEach((cell) => {
      cell.addEventListener('mouseenter', () => {
        // Check if this cell is in the first tbody row
        const row = cell.closest('tr');
        if (!row) return;

        const tbody = row.closest('tbody');
        if (!tbody) return;

        const firstRow = tbody.querySelector('tr');
        if (row === firstRow) {
          cell.classList.add('tooltip-below');
        } else {
          cell.classList.remove('tooltip-below');
        }
      });

      cell.addEventListener('mouseleave', () => {
        cell.classList.remove('tooltip-below');
      });
    });
  }
}
