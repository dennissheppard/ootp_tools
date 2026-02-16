import { teamRatingsService, TeamRatingResult, RatedPlayer, TeamPowerRanking } from '../services/TeamRatingsService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { dateService } from '../services/DateService';
import { pitcherProfileModal } from './PitcherProfileModal';
import type { PlayerProfileData } from './PlayerRatingsCard';
import { BatterProfileModal, BatterProfileData } from './BatterProfileModal';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';

interface TeamColumn {
  key: 'name' | 'trueRating' | 'ip' | 'k9' | 'bb9' | 'hr9' | 'eraOrWar' | 'war';
  label: string;
  sortKey?: string;
}

interface PlayerRowContext {
  player: any; // Can be RatedPlayer or RatedBatter
  seasonYear?: number;
  teamKey: string;
  type: 'rotation' | 'bullpen' | 'lineup' | 'bench';
}

export class TeamRatingsView {
  private container: HTMLElement;
  private selectedYear: number = 2020;
  private isAllTime: boolean = false;
  private viewMode: 'projected' | 'power-rankings' = 'power-rankings';
  private results: TeamRatingResult[] = [];
  private powerRankings: TeamPowerRanking[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000
  private currentGameYear: number | null = null;
  private batterProfileModal: BatterProfileModal;
  private playerRowLookup: Map<string, PlayerRowContext> = new Map();
  private teamResultLookup: Map<string, TeamRatingResult> = new Map();
  private isDraggingColumn = false;
  private teamColumnOrder: Record<'rotation' | 'bullpen', string[]> = { rotation: [], bullpen: [] };
  private teamSortState: Map<string, { key: string; direction: 'asc' | 'desc' }> = new Map();
  private projectionsSortKey: string = 'total';
  private projectionsSortDirection: 'asc' | 'desc' = 'desc';
  private projectionsColumns: Array<{ key: string; label: string; sortKey?: string; title?: string }> = [
    { key: 'rank', label: '#' },
    { key: 'teamName', label: 'Team' },
    { key: 'total', label: 'Total', sortKey: 'total', title: 'Weighted Total: 40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench' },
    { key: 'rotation', label: 'Rotation', sortKey: 'rotation' },
    { key: 'lineup', label: 'Lineup', sortKey: 'lineup' },
    { key: 'bullpen', label: 'Bullpen', sortKey: 'bullpen' },
    { key: 'bench', label: 'Bench', sortKey: 'bench' }
  ];
  private powerRankingsSortKey: string = 'teamRating';
  private powerRankingsSortDirection: 'asc' | 'desc' = 'desc';
  private powerRankingsColumns: Array<{ key: string; label: string; sortKey?: string; title?: string }> = [
    { key: 'rank', label: '#' },
    { key: 'teamName', label: 'Team' },
    { key: 'teamRating', label: 'Team Rating', sortKey: 'teamRating', title: 'Weighted composite: 40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench' },
    { key: 'rotation', label: 'Rotation', sortKey: 'rotation', title: 'Average True Rating of top 5 starting pitchers' },
    { key: 'lineup', label: 'Lineup', sortKey: 'lineup', title: 'Average True Rating of 9 lineup positions (best player per position)' },
    { key: 'bullpen', label: 'Bullpen', sortKey: 'bullpen', title: 'Average True Rating of top 8 relievers' },
    { key: 'bench', label: 'Bench', sortKey: 'bench', title: 'Average True Rating of remaining bench batters' }
  ];

  constructor(container: HTMLElement) {
    this.container = container;
    this.batterProfileModal = new BatterProfileModal();
    this.init();
  }

  private async init(): Promise<void> {
    // Load current game year first so we can default to it
    await this.loadCurrentGameYear();
    if (this.currentGameYear !== null) {
      this.selectedYear = this.currentGameYear;
    }
    this.renderLayout();
    this.loadData();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Team Ratings</h2>

        <div class="true-ratings-controls">
          <div class="filter-bar">
            <label>Filters:</label>
            <div class="filter-group" role="group" aria-label="Team ratings filters">
              <!-- Year Dropdown -->
              <div class="filter-dropdown" data-filter="year">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Year: <span id="selected-year-display">${this.isAllTime ? 'All-Time' : this.selectedYear}</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="year-dropdown-menu">
                  <div class="filter-dropdown-item ${this.isAllTime ? 'selected' : ''}"
                       data-value="all-time">All-Time</div>
                  <div style="border-top: 1px solid var(--color-border, #333); margin: 2px 0;"></div>
                  ${this.yearOptions.map(year => `
                    <div class="filter-dropdown-item ${!this.isAllTime && year === this.selectedYear ? 'selected' : ''}"
                         data-value="${year}">${year}</div>
                  `).join('')}
                </div>
              </div>

              <!-- Mode Toggle Buttons -->
              <button class="toggle-btn ${this.viewMode === 'power-rankings' ? 'active' : ''}"
                      data-view-mode="power-rankings"
                      aria-pressed="${this.viewMode === 'power-rankings'}">
                Power Rankings
              </button>
              <button class="toggle-btn ${this.viewMode === 'projected' ? 'active' : ''}"
                      data-view-mode="projected"
                      aria-pressed="${this.viewMode === 'projected'}">
                Projections
              </button>
            </div>
          </div>
        </div>

        <div class="team-ratings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 1rem;">
            <div id="rotation-rankings">
                ${this.renderTableLoadingState()}
            </div>
            <div id="bullpen-rankings">
            </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Year dropdown toggle (open/close)
    this.container.querySelectorAll('.filter-dropdown-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.filter-dropdown');

        // Close other dropdowns
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
          if (d !== dropdown) {
            d.classList.remove('open');
          }
        });

        // Toggle this dropdown
        dropdown?.classList.toggle('open');
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.filter-dropdown')) {
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
          d.classList.remove('open');
        });
      }
    });

    // Year dropdown item selection
    this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const value = (e.target as HTMLElement).dataset.value;
        if (!value) return;

        if (value === 'all-time') {
          this.isAllTime = true;
          // Force power-rankings mode for All-Time
          if (this.viewMode !== 'power-rankings') {
            this.viewMode = 'power-rankings';
            this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
              const b = btn as HTMLElement;
              const isActive = b.dataset.viewMode === 'power-rankings';
              b.classList.toggle('active', isActive);
              b.setAttribute('aria-pressed', String(isActive));
            });
          }
        } else {
          this.isAllTime = false;
          this.selectedYear = parseInt(value, 10);
        }

        // Update display
        const displaySpan = this.container.querySelector('#selected-year-display');
        if (displaySpan) {
          displaySpan.textContent = this.isAllTime ? 'All-Time' : String(this.selectedYear);
        }

        // Update selected state
        this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(i =>
          i.classList.remove('selected')
        );
        (e.target as HTMLElement).classList.add('selected');

        // Close dropdown
        (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

        // Reload data
        this.showLoadingState();
        this.loadData();
      });
    });

    // Mode toggle buttons
    this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = (e.target as HTMLElement).dataset.viewMode as 'projected' | 'power-rankings';
        if (mode === this.viewMode && !this.isAllTime) return;

        this.viewMode = mode;
        this.teamSortState.clear();

        // All-Time is only available in power-rankings mode — switch off if going to projections
        if (this.isAllTime && mode === 'projected') {
          this.isAllTime = false;
          if (this.currentGameYear !== null) {
            this.selectedYear = this.currentGameYear;
          }
          // Update dropdown selected state
          this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(i => {
            const val = (i as HTMLElement).dataset.value;
            i.classList.toggle('selected', val === String(this.selectedYear));
          });
        }

        // If switching to projections, force current game year
        if (this.viewMode === 'projected' && this.currentGameYear !== null) {
          this.selectedYear = this.currentGameYear;
          const displaySpan = this.container.querySelector('#selected-year-display');
          if (displaySpan) displaySpan.textContent = String(this.currentGameYear);
        }

        // Update button active states
        this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
          const b = btn as HTMLElement;
          const isActive = b.dataset.viewMode === mode;
          b.classList.toggle('active', isActive);
          b.setAttribute('aria-pressed', String(isActive));
        });

        this.showLoadingState();
        this.loadData();
      });
    });
  }

  private showLoadingState(): void {
      const rotContainer = this.container.querySelector<HTMLElement>('#rotation-rankings');
      const penContainer = this.container.querySelector('#bullpen-rankings');

      if (rotContainer) {
          // Make container span full width of grid
          rotContainer.style.gridColumn = '1 / -1';
          rotContainer.innerHTML = this.renderTableLoadingState();
      }

      if (penContainer) {
          penContainer.innerHTML = '';
      }
  }

  private renderTableLoadingState(): string {
      const title = this.isAllTime ? 'All-Time Power Rankings' : (this.viewMode === 'power-rankings' ? 'Team Power Rankings' : 'Team Projections');
      const columnCount = this.viewMode === 'power-rankings'
          ? this.powerRankingsColumns.length
          : this.projectionsColumns.length;
      const loadingNote = this.isAllTime
          ? '<span class="note-text" id="all-time-progress">Loading all historical seasons...</span>'
          : '<span class="note-text">Loading...</span>';

      return `
        <div class="stats-table-container loading-skeleton">
          <h3 class="section-title">${title} ${loadingNote}</h3>
          <table class="stats-table" style="width: 100%;">
            <thead>
              <tr>
                ${Array.from({ length: columnCount }, () => '<th><span class="skeleton-line md"></span></th>').join('')}
              </tr>
            </thead>
            <tbody>
              ${Array.from({ length: 5 }, () => `
                <tr>
                  ${Array.from({ length: columnCount }, () => '<td><span class="skeleton-line sm"></span></td>').join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
  }

  private async loadData(): Promise<void> {
    try {
        if (this.isAllTime) {
            // All-Time mode: load power rankings for every year with progress
            this.viewMode = 'power-rankings';
            this.powerRankings = await teamRatingsService.getAllTimePowerRankings(
              2000,
              undefined,
              (completed, total) => {
                const progressEl = this.container.querySelector('#all-time-progress');
                if (progressEl) {
                  progressEl.textContent = `Loading year ${completed} of ${total}...`;
                }
              }
            );
            this.results = [];
        } else if (this.viewMode === 'power-rankings') {
            this.powerRankings = await teamRatingsService.getPowerRankings(this.selectedYear);
            this.results = [];
        } else if (this.viewMode === 'projected') {
            console.log('Fetching projections...', teamRatingsService);
            if (typeof teamRatingsService.getProjectedTeamRatings !== 'function') {
                console.error('getProjectedTeamRatings is missing on teamRatingsService!', teamRatingsService);
                throw new Error('Service method missing. Please refresh the page.');
            }
            this.results = await teamRatingsService.getProjectedTeamRatings(this.selectedYear);
            this.powerRankings = [];
        }

        // Check for no data
        if (this.viewMode === 'power-rankings' && this.powerRankings.length === 0) {
            await this.renderNoData();
            return;
        }
        if (this.viewMode === 'projected' && this.results.length === 0) {
            await this.renderNoData();
            return;
        }

        this.renderLists();
    } catch (err) {
        console.error(err);
        await this.renderNoData(err);
    }
  }

  private renderLists(): void {
      const rotContainer = this.container.querySelector('#rotation-rankings');
      const penContainer = this.container.querySelector('#bullpen-rankings');

      if (!rotContainer || !penContainer) return;

      // Power Rankings mode - always table view
      if (this.viewMode === 'power-rankings') {
        this.renderPowerRankingsTable(rotContainer, penContainer);
        this.bindPlayerNameClicks();
        return;
      }

      // Projections mode - render component-based collapsibles
      if (this.viewMode === 'projected') {
        this.renderProjectionsTable(rotContainer, penContainer);
        this.bindPlayerNameClicks();
        return;
      }
  }

  private renderProjectionsTable(rotContainer: Element, penContainer: Element): void {
      // Sort results based on current sort state
      this.sortProjectionsData();

      // Build player lookup for modal access
      this.playerRowLookup = new Map();
      this.teamResultLookup = new Map();
      this.results.forEach(team => {
        const teamKey = this.buildTeamKey(team);
        this.teamResultLookup.set(teamKey, team);
        team.rotation.forEach(p => this.playerRowLookup.set(
          this.buildPlayerKey(teamKey, 'rotation', p.playerId),
          { player: p, seasonYear: team.seasonYear, teamKey, type: 'rotation' }
        ));
        team.bullpen.forEach(p => this.playerRowLookup.set(
          this.buildPlayerKey(teamKey, 'bullpen', p.playerId),
          { player: p, seasonYear: team.seasonYear, teamKey, type: 'bullpen' }
        ));
        team.lineup?.forEach(p => this.playerRowLookup.set(
          this.buildPlayerKey(teamKey, 'lineup', p.playerId),
          { player: p, seasonYear: team.seasonYear, teamKey, type: 'lineup' }
        ));
        team.bench?.forEach(p => this.playerRowLookup.set(
          this.buildPlayerKey(teamKey, 'bench', p.playerId),
          { player: p, seasonYear: team.seasonYear, teamKey, type: 'bench' }
        ));
      });

      // Render column headers
      const headerRow = this.projectionsColumns.map(col => {
          const isSorted = this.projectionsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.projectionsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'rank' ? 'width: 40px;' : (col.key === 'teamName' ? 'text-align: left;' : 'text-align: center;');
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
          const titleAttr = col.title ? `title="${col.title}"` : '';

          return `<th ${sortAttr} ${titleAttr} class="${activeClass}" style="${style}" draggable="${col.sortKey ? 'true' : 'false'}" data-col-key="${col.key}">${col.label}${sortIcon}</th>`;
      }).join('');

      // Render team rows
      const rows = this.results.map((team, idx) => {
          const teamKey = this.buildTeamKey(team);
          const totalWar = this.calculateProjectionsTotalWar(team);

          const cells = this.projectionsColumns.map(col => {
              switch (col.key) {
                  case 'rank':
                      return `<td style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>`;
                  case 'teamName':
                      return `
                        <td style="font-weight: 600; text-align: left;" data-col-key="${col.key}">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="toggle-icon" style="font-size: 0.8em; width: 12px;">▶</span>
                                ${team.teamName}
                            </div>
                        </td>`;
                  case 'total':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getWarClass(totalWar, 'rotation')}" style="font-weight: 600;">${totalWar.toFixed(1)}</span></td>`;
                  case 'rotation':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getWarClass(team.rotationWar, 'rotation')}">${team.rotationWar.toFixed(1)}</span></td>`;
                  case 'lineup':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getWarClass(team.lineupWar ?? 0, 'rotation')}">${(team.lineupWar ?? 0).toFixed(1)}</span></td>`;
                  case 'bullpen':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getWarClass(team.bullpenWar, 'bullpen')}">${team.bullpenWar.toFixed(1)}</span></td>`;
                  case 'bench':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getWarClass(team.benchWar ?? 0, 'bullpen')}">${(team.benchWar ?? 0).toFixed(1)}</span></td>`;
                  default:
                      return `<td data-col-key="${col.key}"></td>`;
              }
          }).join('');

          return `
            <tr class="team-row" data-team-key="${teamKey}" style="cursor: pointer;">
                ${cells}
            </tr>
            <tr id="details-${teamKey}" style="display: none; background-color: var(--color-surface-hover);">
                <td colspan="${this.projectionsColumns.length}" style="padding: 1rem;">
                    ${this.renderProjectionsDetails(team)}
                </td>
            </tr>
          `;
      }).join('');

      // Render full table spanning both grid columns
      const tableHtml = `
        <div class="stats-table-container">
            <h3 class="section-title">Team Projections <span class="note-text">(Ranked by ${this.getProjectionsSortLabel()})</span></h3>
            <table class="stats-table projections-table" style="width: 100%;">
                <thead><tr>${headerRow}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
      `;

      // Make container span full width of grid
      (rotContainer as HTMLElement).style.gridColumn = '1 / -1';
      rotContainer.innerHTML = tableHtml;
      penContainer.innerHTML = '';

      // Bind events specific to projections table
      this.bindProjectionsTableEvents();
  }

  private calculateProjectionsTotalWar(team: TeamRatingResult): number {
      // Same weighting as Power Rankings: 40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench
      return (team.rotationWar * 0.40) +
             ((team.lineupWar ?? 0) * 0.40) +
             (team.bullpenWar * 0.15) +
             ((team.benchWar ?? 0) * 0.05);
  }

  private sortProjectionsData(): void {
      this.results.sort((a, b) => {
          let aVal: number;
          let bVal: number;

          switch (this.projectionsSortKey) {
              case 'total':
                  aVal = this.calculateProjectionsTotalWar(a);
                  bVal = this.calculateProjectionsTotalWar(b);
                  break;
              case 'rotation':
                  aVal = a.rotationWar;
                  bVal = b.rotationWar;
                  break;
              case 'lineup':
                  aVal = a.lineupWar ?? 0;
                  bVal = b.lineupWar ?? 0;
                  break;
              case 'bullpen':
                  aVal = a.bullpenWar;
                  bVal = b.bullpenWar;
                  break;
              case 'bench':
                  aVal = a.benchWar ?? 0;
                  bVal = b.benchWar ?? 0;
                  break;
              default:
                  return 0;
          }

          const compare = aVal - bVal;
          return this.projectionsSortDirection === 'asc' ? compare : -compare;
      });
  }

  private getProjectionsSortLabel(): string {
      const labels: Record<string, string> = {
          total: 'Total WAR',
          rotation: 'Rotation WAR',
          lineup: 'Lineup WAR',
          bullpen: 'Bullpen WAR',
          bench: 'Bench WAR'
      };
      return labels[this.projectionsSortKey] || 'WAR';
  }

  private renderProjectionsDetails(team: TeamRatingResult): string {
      const rotationTop5 = team.rotation.slice(0, 5);
      const bullpenTop8 = team.bullpen.slice(0, 8);
      const lineup = team.lineup ? team.lineup : [];
      const benchTop5 = team.bench ? team.bench.slice(0, 5) : [];

      return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
            <div>
                <h4 class="section-title" style="margin-bottom: 0.5rem;">Rotation <span class="note-text">(Top 5, Avg TR: ${this.calculateAvgTR(team.rotation)})</span></h4>
                ${this.renderProjectionsPitcherList(rotationTop5, team, 'rotation')}
            </div>
            <div>
                <h4 class="section-title" style="margin-bottom: 0.5rem;">Bullpen <span class="note-text">(Top 8, Avg TR: ${this.calculateAvgTR(team.bullpen)})</span></h4>
                ${this.renderProjectionsPitcherList(bullpenTop8, team, 'bullpen')}
            </div>
            <div>
                <h4 class="section-title" style="margin-bottom: 0.5rem;">Lineup <span class="note-text">(Avg TR: ${this.calculateAvgBatterTR(team.lineup || [])})</span></h4>
                ${lineup.length > 0 ? this.renderProjectionsBatterList(lineup, team, 'lineup') : '<p class="no-stats">No lineup data available</p>'}
            </div>
            <div>
                <h4 class="section-title" style="margin-bottom: 0.5rem;">Bench <span class="note-text">(Top 5${team.bench ? `, Avg TR: ${this.calculateAvgBatterTR(team.bench)}` : ''})</span></h4>
                ${benchTop5.length > 0 ? this.renderProjectionsBatterList(benchTop5, team, 'bench') : '<p class="no-stats">No bench data available</p>'}
            </div>
        </div>
      `;
  }

  private calculateAvgTR(players: any[]): string {
      if (players.length === 0) return 'N/A';
      const sum = players.reduce((acc, p) => acc + (p.trueRating || 0), 0);
      return (sum / players.length).toFixed(2);
  }

  private calculateAvgBatterTR(batters: any[]): string {
      if (batters.length === 0) return 'N/A';
      const sum = batters.reduce((acc, b) => acc + (b.trueRating || 0), 0);
      return (sum / batters.length).toFixed(2);
  }

  private renderProjectionsPitcherList(players: RatedPlayer[], team: TeamRatingResult, type: 'rotation' | 'bullpen'): string {
      if (players.length === 0) {
          return '<p class="no-stats">No players</p>';
      }

      const teamKey = this.buildTeamKey(team);

      const rows = players.map((player, idx) => {
          return `
            <tr>
                <td style="color: var(--color-text-muted); width: 30px;">${idx + 1}</td>
                <td style="text-align: left;"><button class="btn-link player-name-link" data-player-key="${this.buildPlayerKey(teamKey, type, player.playerId)}" data-player-id="${player.playerId}" title="ID: ${player.playerId}">${player.name}</button></td>
                <td style="text-align: center;"><span class="badge ${this.getRatingClass(player.trueRating)}">${player.trueRating.toFixed(1)}</span></td>
                <td style="text-align: center;">${player.stats.ip.toFixed(1)}</td>
                <td style="text-align: center;">${(player.stats.war ?? 0).toFixed(1)}</td>
            </tr>
          `;
      }).join('');

      return `
        <table class="stats-table" style="width: 100%; font-size: 0.9em;">
            <thead>
                <tr>
                    <th>#</th>
                    <th style="text-align: left;">Name</th>
                    <th style="text-align: center;">TR</th>
                    <th style="text-align: center;">IP</th>
                    <th style="text-align: center;">WAR</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
      `;
  }

  private renderProjectionsBatterList(batters: any[], team: TeamRatingResult, type: 'lineup' | 'bench'): string {
      if (batters.length === 0) {
          return '<p class="no-stats">No batters</p>';
      }

      const teamKey = this.buildTeamKey(team);

      const rows = batters.map((batter: any, idx: number) => {
          return `
            <tr>
                <td style="color: var(--color-text-muted); width: 30px;">${idx + 1}</td>
                <td style="text-align: left;"><button class="btn-link player-name-link" data-player-key="${this.buildPlayerKey(teamKey, type as any, batter.playerId)}" data-player-id="${batter.playerId}" title="ID: ${batter.playerId}">${batter.name}</button></td>
                <td style="text-align: center;">${batter.positionLabel || '-'}</td>
                <td style="text-align: center;"><span class="badge ${this.getRatingClass(batter.trueRating)}">${batter.trueRating.toFixed(1)}</span></td>
                <td style="text-align: center;">${batter.stats?.pa ?? '-'}</td>
                <td style="text-align: center;">${batter.stats?.war ? batter.stats.war.toFixed(1) : '-'}</td>
            </tr>
          `;
      }).join('');

      return `
        <table class="stats-table" style="width: 100%; font-size: 0.9em;">
            <thead>
                <tr>
                    <th>#</th>
                    <th style="text-align: left;">Name</th>
                    <th style="text-align: center;">Pos</th>
                    <th style="text-align: center;">TR</th>
                    <th style="text-align: center;">PA</th>
                    <th style="text-align: center;">WAR</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
      `;
  }


  private bindProjectionsTableEvents(): void {
      // Bind row toggle events
      this.container.querySelectorAll('.team-row').forEach(row => {
          row.addEventListener('click', (e) => {
              // Don't toggle if clicking on a player name link
              if ((e.target as HTMLElement).closest('.player-name-link')) return;

              const teamKey = (row as HTMLElement).dataset.teamKey;
              const detailsRow = this.container.querySelector(`#details-${teamKey}`) as HTMLElement;
              const icon = row.querySelector('.toggle-icon');

              if (detailsRow && icon) {
                  const isHidden = detailsRow.style.display === 'none';
                  detailsRow.style.display = isHidden ? 'table-row' : 'none';
                  icon.textContent = isHidden ? '▼' : '▶';
              }
          });
      });

      // Bind sort headers
      this.container.querySelectorAll('.projections-table th[data-sort-key]').forEach(header => {
          header.addEventListener('click', () => {
              if (this.isDraggingColumn) return;

              const key = (header as HTMLElement).dataset.sortKey;
              if (!key) return;

              if (this.projectionsSortKey === key) {
                  this.projectionsSortDirection = this.projectionsSortDirection === 'asc' ? 'desc' : 'asc';
              } else {
                  this.projectionsSortKey = key;
                  this.projectionsSortDirection = 'desc';
              }

              this.renderLists();
          });
      });

      // Bind column drag and drop
      this.bindProjectionsColumnDragAndDrop();
  }

  private bindProjectionsColumnDragAndDrop(): void {
      const headers = this.container.querySelectorAll<HTMLTableCellElement>('.projections-table th[data-col-key]');
      let draggedKey: string | null = null;

      headers.forEach(header => {
          header.addEventListener('dragstart', (e) => {
              draggedKey = header.dataset.colKey ?? null;
              // Don't allow dragging rank or teamName columns
              if (draggedKey === 'rank' || draggedKey === 'teamName') {
                  e.preventDefault();
                  return;
              }
              this.isDraggingColumn = true;
              header.classList.add('dragging');
              this.applyProjectionsColumnClass(draggedKey!, 'dragging-col', true);
              e.dataTransfer?.setData('text/plain', draggedKey!);
          });

          header.addEventListener('dragover', (e) => {
              if (!draggedKey) return;
              const targetKey = header.dataset.colKey;
              // Don't allow dropping on rank or teamName
              if (targetKey === 'rank' || targetKey === 'teamName') return;
              if (!targetKey || targetKey === draggedKey) {
                  this.clearProjectionsDropIndicators();
                  return;
              }
              e.preventDefault();
              const rect = header.getBoundingClientRect();
              const isBefore = e.clientX < rect.left + rect.width / 2;
              this.updateProjectionsDropIndicator(targetKey, isBefore ? 'before' : 'after');
          });

          header.addEventListener('drop', (e) => {
              e.preventDefault();
              if (!draggedKey) return;
              const targetKey = header.dataset.colKey;
              const position = header.dataset.dropPosition as 'before' | 'after' | undefined;
              if (!targetKey || draggedKey === targetKey) {
                  draggedKey = null;
                  this.clearProjectionsDropIndicators();
                  return;
              }
              this.reorderProjectionsColumns(draggedKey, targetKey, position ?? 'before');
              draggedKey = null;
              this.clearProjectionsDropIndicators();
          });

          header.addEventListener('dragend', () => {
              if (draggedKey) {
                  this.applyProjectionsColumnClass(draggedKey, 'dragging-col', false);
              }
              header.classList.remove('dragging');
              draggedKey = null;
              this.clearProjectionsDropIndicators();
              setTimeout(() => {
                  this.isDraggingColumn = false;
              }, 0);
          });
      });
  }

  private reorderProjectionsColumns(draggedKey: string, targetKey: string, position: 'before' | 'after'): void {
      const currentOrder = [...this.projectionsColumns];
      const fromIndex = currentOrder.findIndex(col => col.key === draggedKey);
      const toIndex = currentOrder.findIndex(col => col.key === targetKey);

      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const [moved] = currentOrder.splice(fromIndex, 1);
      let insertIndex = position === 'after' ? toIndex + 1 : toIndex;
      if (fromIndex < insertIndex) {
          insertIndex -= 1;
      }
      currentOrder.splice(insertIndex, 0, moved);
      this.projectionsColumns = currentOrder;
      this.renderLists();
  }

  private updateProjectionsDropIndicator(targetKey: string, position: 'before' | 'after'): void {
      this.clearProjectionsDropIndicators();
      const cells = this.container.querySelectorAll<HTMLElement>('.projections-table [data-col-key="' + targetKey + '"]');
      cells.forEach(cell => {
          cell.dataset.dropPosition = position;
          cell.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
      });
  }

  private clearProjectionsDropIndicators(): void {
      const cells = this.container.querySelectorAll<HTMLElement>('.projections-table .drop-before, .projections-table .drop-after');
      cells.forEach(cell => {
          cell.classList.remove('drop-before', 'drop-after');
          delete cell.dataset.dropPosition;
      });
  }

  private applyProjectionsColumnClass(columnKey: string, className: string, add: boolean): void {
      const cells = this.container.querySelectorAll<HTMLElement>('.projections-table [data-col-key="' + columnKey + '"]');
      cells.forEach(cell => cell.classList.toggle(className, add));
  }

    private renderPowerRankingsTable(rotContainer: Element, penContainer: Element): void {
      // Sort power rankings based on current sort state
      this.sortPowerRankingsData();

      // Render column headers
      const headerRow = this.powerRankingsColumns.map(col => {
          const isSorted = this.powerRankingsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.powerRankingsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'rank' ? 'width: 40px;' : (col.key === 'teamName' ? 'text-align: left;' : 'text-align: center;');
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
          const titleAttr = col.title ? `title="${col.title}"` : '';

          return `<th ${sortAttr} ${titleAttr} class="${activeClass}" style="${style}" draggable="${col.sortKey ? 'true' : 'false'}" data-col-key="${col.key}">${col.label}${sortIcon}</th>`;
      }).join('');

      // Render team rows
      const rows = this.powerRankings.map((team, idx) => {
          const teamKey = this.isAllTime ? `pr-${team.teamId}-${team.seasonYear}` : `pr-${team.teamId}`;
          const displayName = this.isAllTime ? `${team.teamName} <span style="color: var(--color-text-muted); font-weight: 400;">(${team.seasonYear})</span>` : team.teamName;

          const cells = this.powerRankingsColumns.map(col => {
              switch (col.key) {
                  case 'rank':
                      return `<td style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>`;
                  case 'teamName':
                      return `
                        <td style="font-weight: 600; text-align: left;" data-col-key="${col.key}">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="toggle-icon" style="font-size: 0.8em; width: 12px;">▶</span>
                                ${displayName}
                            </div>
                        </td>`;
                  case 'teamRating': {
                      const trTip = `Rot ${team.rotationRating.toFixed(2)}×40% + Lin ${team.lineupRating.toFixed(2)}×40% + Pen ${team.bullpenRating.toFixed(2)}×15% + Ben ${team.benchRating.toFixed(2)}×5% = ${team.teamRating.toFixed(2)}`;
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getRatingClass(team.teamRating)}" style="font-weight: 600;" title="${trTip}">${team.teamRating.toFixed(2)}</span></td>`;
                  }
                  case 'rotation':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getRatingClass(team.rotationRating)}" title="Avg TR of ${team.rotation.length} SP">${team.rotationRating.toFixed(2)}</span></td>`;
                  case 'lineup':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getRatingClass(team.lineupRating)}" title="Avg TR of ${team.lineup.length} position players">${team.lineupRating.toFixed(2)}</span></td>`;
                  case 'bullpen':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getRatingClass(team.bullpenRating)}" title="Avg TR of ${team.bullpen.length} RP">${team.bullpenRating.toFixed(2)}</span></td>`;
                  case 'bench':
                      return `<td style="text-align: center;" data-col-key="${col.key}"><span class="badge ${this.getRatingClass(team.benchRating)}" title="Avg TR of ${team.bench.length} bench batters">${team.benchRating.toFixed(2)}</span></td>`;
                  default:
                      return `<td data-col-key="${col.key}"></td>`;
              }
          }).join('');

          return `
            <tr class="team-row" data-team-key="${teamKey}" style="cursor: pointer;">
                ${cells}
            </tr>
            <tr id="details-${teamKey}" style="display: none; background-color: var(--color-surface-hover);">
                <td colspan="${this.powerRankingsColumns.length}" style="padding: 1rem;">
                    ${this.renderPowerRankingDetails(team)}
                </td>
            </tr>
          `;
      }).join('');

      // Render full table spanning both grid columns
      const tableTitle = this.isAllTime ? 'All-Time Power Rankings' : 'Team Power Rankings';
      const tableDesc = this.isAllTime
          ? `Best teams across all seasons (${this.powerRankings.length} team-seasons). Scores are the average TR of each roster group. Team Rating is a weighted composite: 40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench.`
          : 'Scores are the average TR of each roster group. Team Rating is a weighted composite: 40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench. Hover over badges for details.';
      const tableHtml = `
        <div class="stats-table-container">
            <h3 class="section-title">${tableTitle} <span class="note-text">(Ranked by ${this.getPowerRankingsSortLabel()})</span></h3>
            <p class="note-text" style="margin: 0.25rem 0 0.75rem 0; line-height: 1.4;">
              ${tableDesc}
            </p>
            <table class="stats-table power-rankings-table" style="width: 100%;">
                <thead><tr>${headerRow}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
      `;

      // Make container span full width of grid
      (rotContainer as HTMLElement).style.gridColumn = '1 / -1';
      rotContainer.innerHTML = tableHtml;
      penContainer.innerHTML = '';

      // Bind events specific to power rankings table
      this.bindPowerRankingsTableEvents();
  }

  private sortPowerRankingsData(): void {
      this.powerRankings.sort((a, b) => {
          let aVal: number;
          let bVal: number;

          switch (this.powerRankingsSortKey) {
              case 'teamRating':
                  aVal = a.teamRating;
                  bVal = b.teamRating;
                  break;
              case 'rotation':
                  aVal = a.rotationRating;
                  bVal = b.rotationRating;
                  break;
              case 'lineup':
                  aVal = a.lineupRating;
                  bVal = b.lineupRating;
                  break;
              case 'bullpen':
                  aVal = a.bullpenRating;
                  bVal = b.bullpenRating;
                  break;
              case 'bench':
                  aVal = a.benchRating;
                  bVal = b.benchRating;
                  break;
              default:
                  return 0;
          }

          const compare = aVal - bVal;
          return this.powerRankingsSortDirection === 'asc' ? compare : -compare;
      });
  }

  private getPowerRankingsSortLabel(): string {
      const labels: Record<string, string> = {
          teamRating: 'Team Rating',
          rotation: 'Rotation Rating',
          lineup: 'Lineup Rating',
          bullpen: 'Bullpen Rating',
          bench: 'Bench Rating'
      };
      return labels[this.powerRankingsSortKey] || 'Team Rating';
  }

  private bindPowerRankingsTableEvents(): void {
      // Bind row toggle events
      this.container.querySelectorAll('.team-row').forEach(row => {
          row.addEventListener('click', (e) => {
              // Don't toggle if clicking on a player name link
              if ((e.target as HTMLElement).closest('.player-name-link')) return;

              const teamKey = (row as HTMLElement).dataset.teamKey;
              const detailsRow = this.container.querySelector(`#details-${teamKey}`) as HTMLElement;
              const icon = row.querySelector('.toggle-icon');

              if (detailsRow && icon) {
                  const isHidden = detailsRow.style.display === 'none';
                  detailsRow.style.display = isHidden ? 'table-row' : 'none';
                  icon.textContent = isHidden ? '▼' : '▶';
              }
          });
      });

      // Bind sort headers
      this.container.querySelectorAll('.power-rankings-table th[data-sort-key]').forEach(header => {
          header.addEventListener('click', () => {
              if (this.isDraggingColumn) return;

              const key = (header as HTMLElement).dataset.sortKey;
              if (!key) return;

              if (this.powerRankingsSortKey === key) {
                  this.powerRankingsSortDirection = this.powerRankingsSortDirection === 'asc' ? 'desc' : 'asc';
              } else {
                  this.powerRankingsSortKey = key;
                  this.powerRankingsSortDirection = 'desc';
              }

              this.renderLists();
          });
      });

      // Bind column drag and drop
      this.bindPowerRankingsColumnDragAndDrop();
  }

  private bindPowerRankingsColumnDragAndDrop(): void {
      const headers = this.container.querySelectorAll<HTMLTableCellElement>('.power-rankings-table th[data-col-key]');
      let draggedKey: string | null = null;

      headers.forEach(header => {
          header.addEventListener('dragstart', (e) => {
              draggedKey = header.dataset.colKey ?? null;
              // Don't allow dragging rank or teamName columns
              if (draggedKey === 'rank' || draggedKey === 'teamName') {
                  e.preventDefault();
                  return;
              }
              this.isDraggingColumn = true;
              header.classList.add('dragging');
              this.applyPowerRankingsColumnClass(draggedKey!, 'dragging-col', true);
              e.dataTransfer?.setData('text/plain', draggedKey!);
          });

          header.addEventListener('dragover', (e) => {
              if (!draggedKey) return;
              const targetKey = header.dataset.colKey;
              // Don't allow dropping on rank or teamName
              if (targetKey === 'rank' || targetKey === 'teamName') return;
              if (!targetKey || targetKey === draggedKey) {
                  this.clearPowerRankingsDropIndicators();
                  return;
              }
              e.preventDefault();
              const rect = header.getBoundingClientRect();
              const isBefore = e.clientX < rect.left + rect.width / 2;
              this.updatePowerRankingsDropIndicator(targetKey, isBefore ? 'before' : 'after');
          });

          header.addEventListener('drop', (e) => {
              e.preventDefault();
              if (!draggedKey) return;
              const targetKey = header.dataset.colKey;
              const position = header.dataset.dropPosition as 'before' | 'after' | undefined;
              if (!targetKey || draggedKey === targetKey) {
                  draggedKey = null;
                  this.clearPowerRankingsDropIndicators();
                  return;
              }
              this.reorderPowerRankingsColumns(draggedKey, targetKey, position ?? 'before');
              draggedKey = null;
              this.clearPowerRankingsDropIndicators();
          });

          header.addEventListener('dragend', () => {
              if (draggedKey) {
                  this.applyPowerRankingsColumnClass(draggedKey, 'dragging-col', false);
              }
              header.classList.remove('dragging');
              draggedKey = null;
              this.clearPowerRankingsDropIndicators();
              setTimeout(() => {
                  this.isDraggingColumn = false;
              }, 0);
          });
      });
  }

  private reorderPowerRankingsColumns(draggedKey: string, targetKey: string, position: 'before' | 'after'): void {
      const currentOrder = [...this.powerRankingsColumns];
      const fromIndex = currentOrder.findIndex(col => col.key === draggedKey);
      const toIndex = currentOrder.findIndex(col => col.key === targetKey);

      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      const [moved] = currentOrder.splice(fromIndex, 1);
      let insertIndex = position === 'after' ? toIndex + 1 : toIndex;
      if (fromIndex < insertIndex) {
          insertIndex -= 1;
      }
      currentOrder.splice(insertIndex, 0, moved);
      this.powerRankingsColumns = currentOrder;
      this.renderLists();
  }

  private updatePowerRankingsDropIndicator(targetKey: string, position: 'before' | 'after'): void {
      this.clearPowerRankingsDropIndicators();
      const cells = this.container.querySelectorAll<HTMLElement>('.power-rankings-table [data-col-key="' + targetKey + '"]');
      cells.forEach(cell => {
          cell.dataset.dropPosition = position;
          cell.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
      });
  }

  private clearPowerRankingsDropIndicators(): void {
      const cells = this.container.querySelectorAll<HTMLElement>('.power-rankings-table .drop-before, .power-rankings-table .drop-after');
      cells.forEach(cell => {
          cell.classList.remove('drop-before', 'drop-after');
          delete cell.dataset.dropPosition;
      });
  }

  private applyPowerRankingsColumnClass(columnKey: string, className: string, add: boolean): void {
      const cells = this.container.querySelectorAll<HTMLElement>('.power-rankings-table [data-col-key="' + columnKey + '"]');
      cells.forEach(cell => cell.classList.toggle(className, add));
  }

  private renderPowerRankingDetails(team: TeamPowerRanking): string {
      return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
          ${this.renderPowerRankingSection('Rotation', team.rotation, team.rotationRating, 'pitcher')}
          ${this.renderPowerRankingSection('Bullpen', team.bullpen, team.bullpenRating, 'pitcher')}
          ${this.renderPowerRankingSection('Lineup', team.lineup, team.lineupRating, 'batter')}
          ${this.renderPowerRankingSection('Bench', team.bench, team.benchRating, 'batter')}
        </div>
      `;
  }

  private renderPowerRankingSection(
    title: string,
    players: any[],
    avgRating: number,
    type: 'pitcher' | 'batter'
  ): string {
      if (players.length === 0) {
        return `
          <div>
            <h4 class="section-title">${title} <span class="note-text">(No players)</span></h4>
            <p class="no-stats">No players found</p>
          </div>
        `;
      }

      const playerRows = players.map((player, idx) => {
        if (type === 'pitcher') {
          const fipStr = player.stats?.fip != null ? player.stats.fip.toFixed(2) : '?';
          const warTip = player.stats?.war != null ? `WAR = ((5.20 − ${fipStr} FIP) / 8.50) × (${player.stats.ip.toFixed(0)} IP / 9)` : '';
          return `
            <tr>
              <td>${idx + 1}</td>
              <td style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${player.playerId}" title="ID: ${player.playerId}">${player.name}</button></td>
              <td>${player.role}</td>
              <td><span class="badge ${this.getRatingClass(player.trueRating)}" title="50% scouting + 50% stats, confidence-weighted by IP">${player.trueRating.toFixed(2)}</span></td>
              <td title="Stuff: K/9-based (20–80)">${player.trueStuff}</td>
              <td title="Control: BB/9-based (20–80)">${player.trueControl}</td>
              <td title="HR Avoidance: HR/9-based (20–80)">${player.trueHra}</td>
              <td>${player.stats?.ip?.toFixed(1) ?? '-'}</td>
              <td${warTip ? ` title="${warTip}"` : ''}>${player.stats?.war?.toFixed(1) ?? '-'}</td>
            </tr>
          `;
        } else {
          const warTip = player.stats?.war != null ? `WAR from wOBA-based wRAA + baserunning, per ${player.stats.pa} PA` : '';
          return `
            <tr>
              <td>${idx + 1}</td>
              <td style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${player.playerId}" title="ID: ${player.playerId}">${player.name}</button></td>
              <td>${player.positionLabel}</td>
              <td><span class="badge ${this.getRatingClass(player.trueRating)}" title="50% scouting + 50% stats, confidence-weighted by PA">${player.trueRating.toFixed(2)}</span></td>
              <td title="Power: HR%-based (20–80)">${player.estimatedPower}</td>
              <td title="Eye: BB%-based (20–80)">${player.estimatedEye}</td>
              <td title="Contact: AVG-based (20–80)">${player.estimatedContact}</td>
              <td>${player.stats?.pa ?? '-'}</td>
              <td${warTip ? ` title="${warTip}"` : ''}>${player.stats?.war?.toFixed(1) ?? '-'}</td>
            </tr>
          `;
        }
      }).join('');

      const headers = type === 'pitcher'
        ? '<th>#</th><th style="text-align: left;">Name</th><th>Role</th><th title="True Rating: scouting + stats blend (0.5–5.0)">TR</th><th title="Stuff rating (20–80): strikeout ability from K/9">Stuff</th><th title="Control rating (20–80): walk prevention from BB/9">Ctrl</th><th title="HR Avoidance rating (20–80): HR prevention from HR/9">HRA</th><th title="Innings Pitched this season">IP</th><th title="Wins Above Replacement this season">WAR</th>'
        : '<th>#</th><th style="text-align: left;">Name</th><th>Pos</th><th title="True Rating: scouting + stats blend (0.5–5.0)">TR</th><th title="Power rating (20–80): HR ability from HR%">Pow</th><th title="Eye rating (20–80): plate discipline from BB%">Eye</th><th title="Contact rating (20–80): batting average ability">Con</th><th title="Plate Appearances this season">PA</th><th title="Wins Above Replacement this season">WAR</th>';

      return `
        <div>
          <h4 class="section-title">${title} <span class="note-text">(Avg TR: ${avgRating.toFixed(2)})</span></h4>
          <table class="stats-table" style="width: 100%; font-size: 0.85em; margin-top: 0.5rem;">
            <thead>
              <tr>${headers}</tr>
            </thead>
            <tbody>
              ${playerRows}
            </tbody>
          </table>
        </div>
      `;
  }

  private getRatingClass(rating: number): string {
      if (rating >= 4.5) return 'rating-elite';
      if (rating >= 4.0) return 'rating-plus';
      if (rating >= 3.0) return 'rating-avg';
      if (rating >= 2.0) return 'rating-fringe';
      return 'rating-poor';
  }


  private renderRatingBadge(player: RatedPlayer): string {
    if (typeof player.trueRating !== 'number') {
        console.warn('Missing trueRating for player:', player);
        return '<span class="badge rating-poor">N/A</span>';
    }
    const value = player.trueRating;
    let className = 'rating-poor';
    if (value >= 4.5) className = 'rating-elite';
    else if (value >= 4.0) className = 'rating-plus';
    else if (value >= 3.0) className = 'rating-avg';
    else if (value >= 2.0) className = 'rating-fringe';

    const title = `True Stuff: ${player.trueStuff}, True Control: ${player.trueControl}, True HRA: ${player.trueHra}`;

    return `<span class="badge ${className}" title="${title}" style="cursor: help;">${value.toFixed(1)}</span>`;
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

  private getWarClass(war: number, type: 'rotation' | 'bullpen'): string {
    if (type === 'rotation') {
        if (war >= 20) return 'rating-elite';
        if (war >= 15) return 'rating-plus';
        if (war >= 10) return 'rating-avg';
        if (war >= 5) return 'rating-fringe';
        return 'rating-poor';
    } else {
        if (war >= 5) return 'rating-elite';
        if (war >= 3) return 'rating-plus';
        if (war >= 1) return 'rating-avg';
        if (war >= 0) return 'rating-fringe';
        return 'rating-poor';
    }
  }

  private buildTeamKey(team: TeamRatingResult): string {
    const yearToken = team.seasonYear ?? 'current';
    return `${team.teamId}-${yearToken}`;
  }

  private buildPlayerKey(teamKey: string, type: 'rotation' | 'bullpen' | 'lineup' | 'bench', playerId: number): string {
    return `${teamKey}-${type}-${playerId}`;
  }

  private renderTeamDetailsTable(team: TeamRatingResult, type: 'rotation' | 'bullpen'): string {
    const players = type === 'rotation' ? team.rotation : team.bullpen;
    const top5 = players.slice(0, 5);
    const columns = this.getTeamColumns(type);
    const teamKey = this.buildTeamKey(team);
    const sortState = this.getTeamSortState(type, teamKey);
    const sortedPlayers = this.sortTeamPlayers(top5, sortState);

    const headerRow = columns.map(column => {
      const sortKey = column.sortKey ?? column.key;
      const activeClass = sortState && sortState.key === sortKey ? 'sort-active' : '';
      return `<th data-sort-key="${sortKey}" data-col-key="${column.key}" class="${activeClass}" draggable="true">${column.label}</th>`;
    }).join('');

    const rows = sortedPlayers.map(player => {
      const cells = columns.map(column => {
        return `<td data-col-key="${column.key}">${this.renderTeamCell(player, column, { teamKey, type, seasonYear: team.seasonYear })}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const emptyRow = players.length === 0
      ? `<tr><td colspan="${columns.length}" style="text-align: center; color: var(--color-text-muted)">No qualified pitchers</td></tr>`
      : '';

    return `
      <table class="stats-table team-ratings-table" style="width: 100%; font-size: 0.9em;">
        <thead>
          <tr>${headerRow}</tr>
        </thead>
        <tbody>
          ${rows}
          ${emptyRow}
        </tbody>
      </table>
    `;
  }

  private renderTeamCell(
    player: RatedPlayer,
    column: TeamColumn,
    context: { teamKey: string; type: 'rotation' | 'bullpen'; seasonYear?: number }
  ): string {
    switch (column.key) {
      case 'name':
        return `<button class="btn-link player-name-link" data-player-key="${this.buildPlayerKey(context.teamKey, context.type, player.playerId)}" data-player-id="${player.playerId}" title="ID: ${player.playerId}">${player.name}</button>`;
      case 'trueRating':
        return this.renderRatingBadge(player);
      case 'ip':
        return player.stats.ip.toFixed(1);
      case 'k9': {
        const estStuff = RatingEstimatorService.estimateStuff(player.stats.k9, player.stats.ip).rating;
        return this.renderFlipCell(player.stats.k9.toFixed(2), estStuff.toString(), 'Est Stuff Rating');
      }
      case 'bb9': {
        const estControl = RatingEstimatorService.estimateControl(player.stats.bb9, player.stats.ip).rating;
        return this.renderFlipCell(player.stats.bb9.toFixed(2), estControl.toString(), 'Est Control Rating');
      }
      case 'hr9': {
        const estHra = RatingEstimatorService.estimateHRA(player.stats.hr9, player.stats.ip).rating;
        return this.renderFlipCell(player.stats.hr9.toFixed(2), estHra.toString(), 'Est HRA Rating');
      }
      case 'eraOrWar':
        return player.stats.era.toFixed(2);
      case 'war':
        return (player.stats.war?.toFixed(1) ?? '0.0');
      default:
        return '';
    }
  }

  private getTeamColumns(type: 'rotation' | 'bullpen'): TeamColumn[] {
    const baseColumns: TeamColumn[] = this.viewMode === 'projected'
      ? [
          { key: 'name', label: 'Name', sortKey: 'name' },
          { key: 'trueRating', label: 'TR', sortKey: 'trueRating' },
          { key: 'ip', label: 'IP', sortKey: 'ip' },
          { key: 'war', label: 'WAR', sortKey: 'war' },
          { key: 'k9', label: 'K/9', sortKey: 'k9' },
          { key: 'bb9', label: 'BB/9', sortKey: 'bb9' },
          { key: 'hr9', label: 'HR/9', sortKey: 'hr9' },
        ]
      : [
          { key: 'name', label: 'Name', sortKey: 'name' },
          { key: 'trueRating', label: 'TR', sortKey: 'trueRating' },
          { key: 'ip', label: 'IP', sortKey: 'ip' },
          { key: 'war', label: 'WAR', sortKey: 'war' },
          { key: 'k9', label: 'K/9', sortKey: 'k9' },
          { key: 'bb9', label: 'BB/9', sortKey: 'bb9' },
          { key: 'hr9', label: 'HR/9', sortKey: 'hr9' },
          { key: 'eraOrWar', label: 'ERA', sortKey: 'era' },
        ];

    return this.applyTeamColumnOrder(baseColumns, type);
  }

  private applyTeamColumnOrder(columns: TeamColumn[], type: 'rotation' | 'bullpen'): TeamColumn[] {
    const order = this.teamColumnOrder[type];
    if (!order || order.length === 0) return columns;
    const columnMap = new Map(columns.map(column => [column.key, column]));
    const ordered: TeamColumn[] = [];

    order.forEach(key => {
      const column = columnMap.get(key as TeamColumn['key']);
      if (column) ordered.push(column);
    });

    columns.forEach(column => {
      if (!order.includes(column.key)) ordered.push(column);
    });

    return ordered;
  }

  private getTeamSortState(type: 'rotation' | 'bullpen', teamKey: string): { key: string; direction: 'asc' | 'desc' } | null {
    return this.teamSortState.get(`${type}-${teamKey}`) ?? null;
  }

  private sortTeamPlayers(players: RatedPlayer[], sortState: { key: string; direction: 'asc' | 'desc' } | null): RatedPlayer[] {
    if (!sortState) return players;
    const { key, direction } = sortState;
    const sorted = [...players].sort((a, b) => {
      const aVal = this.getTeamSortValue(a, key);
      const bVal = this.getTeamSortValue(b, key);
      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = (aVal ?? 0) - (bVal ?? 0);
      } else {
        const aString = aVal !== undefined && aVal !== null ? String(aVal) : '';
        const bString = bVal !== undefined && bVal !== null ? String(bVal) : '';
        compare = aString.localeCompare(bString);
      }
      return direction === 'asc' ? compare : -compare;
    });
    return sorted;
  }

  private getTeamSortValue(player: RatedPlayer, key: string): number | string {
    switch (key) {
      case 'name':
        return player.name;
      case 'trueRating':
        return player.trueRating ?? 0;
      case 'ip':
        return player.stats.ip;
      case 'k9':
        return player.stats.k9;
      case 'bb9':
        return player.stats.bb9;
      case 'hr9':
        return player.stats.hr9;
      case 'era':
        return player.stats.era;
      case 'war':
        return player.stats.war ?? 0;
      default:
        return '';
    }
  }


  private bindFlipCardLocking(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.flip-cell');
    cells.forEach((cell) => {
      // Remove old listener to avoid duplicates if re-rendering?
      // renderLists completely replaces innerHTML, so no dupes.
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

  private bindPlayerNameClicks(): void {
    const links = this.container.querySelectorAll<HTMLButtonElement>('.player-name-link');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerKey = link.dataset.playerKey;
        if (playerKey) {
          this.openPlayerProfile(playerKey);
          return;
        }
        // Handle power rankings mode - playerId directly
        const playerId = parseInt(link.dataset.playerId ?? '', 10);
        if (!playerId) return;

        if (this.viewMode === 'power-rankings') {
          // In All-Time mode, find the teamKey from the nearest team row to disambiguate
          const detailsRow = link.closest('tr[id^="details-"]');
          const teamRowKey = detailsRow ? (detailsRow as HTMLElement).id.replace('details-', '') : undefined;
          this.openPowerRankingPlayerProfile(playerId, teamRowKey);
          return;
        }

        // Fallback for other modes
        const fallbackKey = Array.from(this.playerRowLookup.keys())
          .find(key => key.endsWith(`-${playerId}`));
        if (fallbackKey) {
          this.openPlayerProfile(fallbackKey);
        }
      });
    });
  }

  private bindTeamTableSortHeaders(root: ParentNode = this.container): void {
    const headers = root.querySelectorAll<HTMLElement>('.team-details th[data-sort-key]');
    headers.forEach(header => {
      header.addEventListener('click', (e) => {
        if (this.isDraggingColumn) return;
        const key = header.dataset.sortKey;
        if (!key) return;
        const details = header.closest<HTMLElement>('.team-details');
        if (!details) return;
        const teamKey = details.dataset.teamKey;
        const type = details.dataset.type as 'rotation' | 'bullpen' | undefined;
        if (!teamKey || !type) return;

        const stateKey = `${type}-${teamKey}`;
        const current = this.teamSortState.get(stateKey);
        if (current?.key === key) {
          current.direction = current.direction === 'asc' ? 'desc' : 'asc';
          this.teamSortState.set(stateKey, current);
        } else {
          this.teamSortState.set(stateKey, { key, direction: 'desc' });
        }
        this.showSortHint(e as MouseEvent);
        this.updateTeamDetailsTable(teamKey, type);
      });
    });
  }

  private bindTeamColumnDragAndDrop(root: ParentNode = this.container): void {
    const headers = root.querySelectorAll<HTMLTableCellElement>('.team-details th[data-col-key]');
    let draggedKey: string | null = null;
    let draggedType: 'rotation' | 'bullpen' | null = null;

    headers.forEach(header => {
      header.addEventListener('dragstart', (e) => {
        const details = header.closest<HTMLElement>('.team-details');
        draggedType = (details?.dataset.type as 'rotation' | 'bullpen' | undefined) ?? null;
        draggedKey = header.dataset.colKey ?? null;
        this.isDraggingColumn = true;
        header.classList.add('dragging');
        if (draggedKey && draggedType) {
          this.applyTeamColumnClass(draggedType, draggedKey, 'dragging-col', true);
          e.dataTransfer?.setData('text/plain', draggedKey);
        }
        e.dataTransfer?.setDragImage(header, 10, 10);
      });

      header.addEventListener('dragover', (e) => {
        if (!draggedKey || !draggedType) return;
        const details = header.closest<HTMLElement>('.team-details');
        const targetType = details?.dataset.type as 'rotation' | 'bullpen' | undefined;
        if (!targetType || targetType !== draggedType) return;
        e.preventDefault();
        const targetKey = header.dataset.colKey;
        if (!targetKey || targetKey === draggedKey) {
          this.clearTeamDropIndicators(draggedType);
          return;
        }
        const rect = header.getBoundingClientRect();
        const isBefore = e.clientX < rect.left + rect.width / 2;
        this.updateTeamDropIndicator(draggedType, targetKey, isBefore ? 'before' : 'after');
      });

      header.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggedKey || !draggedType) return;
        const targetKey = header.dataset.colKey;
        const position = header.dataset.dropPosition as 'before' | 'after' | undefined;
        if (!targetKey || draggedKey === targetKey) {
          draggedKey = null;
          this.clearTeamDropIndicators(draggedType);
          return;
        }
        this.reorderTeamColumns(draggedType, draggedKey, targetKey, position ?? 'before');
        draggedKey = null;
        this.clearTeamDropIndicators(draggedType);
      });

      header.addEventListener('dragend', () => {
        if (draggedKey && draggedType) {
          this.applyTeamColumnClass(draggedType, draggedKey, 'dragging-col', false);
        }
        header.classList.remove('dragging');
        draggedKey = null;
        draggedType = null;
        this.clearAllTeamDropIndicators();
        setTimeout(() => {
          this.isDraggingColumn = false;
        }, 0);
      });
    });
  }

  private reorderTeamColumns(type: 'rotation' | 'bullpen', draggedKey: string, targetKey: string, position: 'before' | 'after'): void {
    const baseColumns = this.getTeamColumns(type);
    const currentOrder = this.teamColumnOrder[type]?.length ? [...this.teamColumnOrder[type]] : baseColumns.map(col => col.key);
    const fromIndex = currentOrder.indexOf(draggedKey);
    const toIndex = currentOrder.indexOf(targetKey);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const nextOrder = [...currentOrder];
    const [moved] = nextOrder.splice(fromIndex, 1);
    let insertIndex = position === 'after' ? toIndex + 1 : toIndex;
    if (fromIndex < insertIndex) {
      insertIndex -= 1;
    }
    nextOrder.splice(insertIndex, 0, moved);
    this.teamColumnOrder[type] = nextOrder;
    this.updateTeamTables(type);
  }

  private updateTeamTables(type: 'rotation' | 'bullpen'): void {
    const detailsList = this.container.querySelectorAll<HTMLElement>(`.team-details[data-type="${type}"]`);
    detailsList.forEach(details => {
      const teamKey = details.dataset.teamKey;
      const team = teamKey ? this.teamResultLookup.get(teamKey) : undefined;
      if (!team) return;
      details.innerHTML = this.renderTeamDetailsTable(team, type);
      this.bindTeamTableSortHeaders(details);
      this.bindTeamColumnDragAndDrop(details);
    });
    this.bindFlipCardLocking();
    this.bindPlayerNameClicks();
  }

  private updateTeamDetailsTable(teamKey: string, type: 'rotation' | 'bullpen'): void {
    const team = this.teamResultLookup.get(teamKey);
    if (!team) return;
    const details = this.container.querySelector<HTMLElement>(`.team-details[data-team-key="${teamKey}"][data-type="${type}"]`);
    if (!details) return;
    details.innerHTML = this.renderTeamDetailsTable(team, type);
    this.bindTeamTableSortHeaders(details);
    this.bindTeamColumnDragAndDrop(details);
    this.bindFlipCardLocking();
    this.bindPlayerNameClicks();
  }

  private updateTeamDropIndicator(type: 'rotation' | 'bullpen', targetKey: string, position: 'before' | 'after'): void {
    this.clearTeamDropIndicators(type);
    const cells = this.container.querySelectorAll<HTMLElement>(`.team-details[data-type="${type}"] [data-col-key="${targetKey}"]`);
    cells.forEach(cell => {
      cell.dataset.dropPosition = position;
      cell.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
    });
  }

  private clearTeamDropIndicators(type: 'rotation' | 'bullpen'): void {
    const cells = this.container.querySelectorAll<HTMLElement>(`.team-details[data-type="${type}"] .drop-before, .team-details[data-type="${type}"] .drop-after`);
    cells.forEach(cell => {
      cell.classList.remove('drop-before', 'drop-after');
      delete cell.dataset.dropPosition;
    });
  }

  private clearAllTeamDropIndicators(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.team-details .drop-before, .team-details .drop-after');
    cells.forEach(cell => {
      cell.classList.remove('drop-before', 'drop-after');
      delete cell.dataset.dropPosition;
    });
  }

  private applyTeamColumnClass(type: 'rotation' | 'bullpen', columnKey: string, className: string, add: boolean): void {
    const cells = this.container.querySelectorAll<HTMLElement>(`.team-details[data-type="${type}"] [data-col-key="${columnKey}"]`);
    cells.forEach(cell => cell.classList.toggle(className, add));
  }

  private showSortHint(event: MouseEvent): void {
    const arrow = document.createElement('div');
    arrow.className = 'sort-fade-hint';
    const details = (event.target as HTMLElement).closest<HTMLElement>('.team-details');
    const teamKey = details?.dataset.teamKey;
    const type = details?.dataset.type as 'rotation' | 'bullpen' | undefined;
    let direction: 'asc' | 'desc' = 'desc';
    if (teamKey && type) {
      const state = this.teamSortState.get(`${type}-${teamKey}`);
      if (state) direction = state.direction;
    }
    arrow.textContent = direction === 'asc' ? '▲' : '▼';
    const offset = 16;
    arrow.style.left = `${event.clientX + offset}px`;
    arrow.style.top = `${event.clientY - offset}px`;
    document.body.appendChild(arrow);

    requestAnimationFrame(() => {
      arrow.classList.add('visible');
    });

    setTimeout(() => {
      arrow.classList.add('fade');
      arrow.addEventListener('transitionend', () => arrow.remove(), { once: true });
      setTimeout(() => arrow.remove(), 800);
    }, 900);
  }

  private async openPowerRankingPlayerProfile(playerId: number, teamKey?: string): Promise<void> {
    // Find player in power rankings data
    let playerData: any = null;
    let isPitcher = false;
    let playerSeasonYear: number | undefined;

    for (const team of this.powerRankings) {
      // In All-Time mode, match by teamKey to find the right year's team
      if (teamKey) {
        const expectedKey = this.isAllTime ? `pr-${team.teamId}-${team.seasonYear}` : `pr-${team.teamId}`;
        if (expectedKey !== teamKey) continue;
      }
      // Check rotation and bullpen
      playerData = team.rotation.find(p => p.playerId === playerId);
      if (playerData) {
        isPitcher = true;
        playerSeasonYear = team.seasonYear;
        break;
      }
      playerData = team.bullpen.find(p => p.playerId === playerId);
      if (playerData) {
        isPitcher = true;
        playerSeasonYear = team.seasonYear;
        break;
      }
      // Check lineup and bench
      playerData = team.lineup.find(p => p.playerId === playerId);
      if (playerData) { playerSeasonYear = team.seasonYear; break; }
      playerData = team.bench.find(p => p.playerId === playerId);
      if (playerData) { playerSeasonYear = team.seasonYear; break; }
    }

    if (!playerData) {
      console.warn('Player not found in power rankings:', playerId);
      return;
    }

    // Fetch full player info
    const player = await playerService.getPlayerById(playerId);
    if (!player) return;

    const team = await teamService.getTeamById(player.teamId);
    const teamLabel = team ? `${team.name} ${team.nickname}` : '';
    let parentLabel = '';
    if (team && team.parentTeamId !== 0) {
      const parent = await teamService.getTeamById(team.parentTeamId);
      if (parent) parentLabel = parent.nickname;
    }

    if (isPitcher) {
      // Get scouting from both sources
      const [myRatings, osaRatings] = await Promise.all([
        scoutingDataService.getLatestScoutingRatings('my'),
        scoutingDataService.getLatestScoutingRatings('osa')
      ]);
      const myScouting = myRatings.find(s => s.playerId === playerId);
      const osaScouting = osaRatings.find(s => s.playerId === playerId);
      const scouting = myScouting || osaScouting;

      const pitchRatings = scouting?.pitches ?? {};
      const pitches = Object.keys(pitchRatings);

      const profileData: PlayerProfileData = {
        playerId,
        playerName: playerData.name,
        team: teamLabel,
        parentTeam: parentLabel,
        age: player.age,
        position: playerData.role,
        positionLabel: playerData.role,
        trueRating: playerData.trueRating,
        estimatedStuff: playerData.trueStuff,
        estimatedControl: playerData.trueControl,
        estimatedHra: playerData.trueHra,
        scoutStuff: myScouting?.stuff,
        scoutControl: myScouting?.control,
        scoutHra: myScouting?.hra,
        scoutStamina: myScouting?.stamina,
        scoutInjuryProneness: myScouting?.injuryProneness,
        scoutOvr: myScouting?.ovr,
        scoutPot: myScouting?.pot,
        osaStuff: osaScouting?.stuff,
        osaControl: osaScouting?.control,
        osaHra: osaScouting?.hra,
        osaStamina: osaScouting?.stamina,
        osaInjuryProneness: osaScouting?.injuryProneness,
        osaOvr: osaScouting?.ovr,
        osaPot: osaScouting?.pot,
        activeScoutSource: myScouting ? 'my' : 'osa',
        hasMyScout: !!myScouting,
        hasOsaScout: !!osaScouting,
        pitchCount: pitches.length,
        pitches,
        pitchRatings,
        isProspect: false,
        year: playerSeasonYear ?? this.selectedYear,
        showYearLabel: !!playerSeasonYear
      };

      await pitcherProfileModal.show(profileData as any, playerSeasonYear ?? this.selectedYear);
    } else {
      // Batter
      const [myScoutingRatings, osaScoutingRatings] = await Promise.all([
        hitterScoutingDataService.getLatestScoutingRatings('my'),
        hitterScoutingDataService.getLatestScoutingRatings('osa')
      ]);
      const myScouting = myScoutingRatings.find(s => s.playerId === playerId);
      const osaScouting = osaScoutingRatings.find(s => s.playerId === playerId);

      const profileData: BatterProfileData = {
        playerId,
        playerName: playerData.name,
        team: teamLabel,
        parentTeam: parentLabel,
        age: player.age,
        position: playerData.position,
        positionLabel: playerData.positionLabel,
        trueRating: playerData.trueRating,
        estimatedPower: playerData.estimatedPower,
        estimatedEye: playerData.estimatedEye,
        estimatedAvoidK: playerData.estimatedAvoidK,
        estimatedContact: playerData.estimatedContact,
        estimatedGap: playerData.estimatedGap,
        estimatedSpeed: playerData.estimatedSpeed,
        scoutPower: myScouting?.power,
        scoutEye: myScouting?.eye,
        scoutAvoidK: myScouting?.avoidK,
        scoutContact: myScouting?.contact,
        scoutGap: myScouting?.gap,
        scoutSpeed: myScouting?.speed,
        scoutSR: myScouting?.stealingAggressiveness,
        scoutSTE: myScouting?.stealingAbility,
        scoutOvr: myScouting?.ovr,
        scoutPot: myScouting?.pot,
        injuryProneness: myScouting?.injuryProneness || osaScouting?.injuryProneness,
        pa: playerData.stats?.pa,
        avg: playerData.stats?.avg,
        obp: playerData.stats?.obp,
        slg: playerData.stats?.slg,
        hr: playerData.stats?.hr,
        war: playerData.stats?.war,
        woba: playerData.woba,
        percentile: playerData.percentile,
        isProspect: false,
        projWar: playerData.projWar ?? playerData.stats?.war,
        projBbPct: playerData.blendedBbPct,
        projKPct: playerData.blendedKPct,
        projHrPct: playerData.blendedHrPct,
        projAvg: playerData.blendedAvg,
        projDoublesRate: playerData.blendedDoublesRate,
        projTriplesRate: playerData.blendedTriplesRate,
        projWoba: playerData.woba,
      };

      await this.batterProfileModal.show(profileData, playerSeasonYear ?? this.selectedYear);
    }
  }

  private async openPlayerProfile(playerKey: string): Promise<void> {
    const entry = this.playerRowLookup.get(playerKey);
    if (!entry) return;
    const row = entry.player;
    const seasonYear = entry.seasonYear ?? this.selectedYear;

    // Fetch full player info for team labels
    const player = await playerService.getPlayerById(row.playerId);
    let teamLabel = '';
    let parentLabel = '';

    if (player) {
      const team = await teamService.getTeamById(player.teamId);
      if (team) {
        teamLabel = `${team.name} ${team.nickname}`;
        if (team.parentTeamId !== 0) {
          const parent = await teamService.getTeamById(team.parentTeamId);
          if (parent) {
            parentLabel = parent.nickname;
          }
        }
      }
    }

    // Determine if it's a batter or pitcher
    const isBatter = entry.type === 'lineup' || entry.type === 'bench' || (player && player.position !== 1);

    if (isBatter) {
      // Get batter scouting from both sources
      const [myScoutingRatings, osaScoutingRatings] = await Promise.all([
        hitterScoutingDataService.getLatestScoutingRatings('my'),
        hitterScoutingDataService.getLatestScoutingRatings('osa')
      ]);
      const myScouting = myScoutingRatings.find(s => s.playerId === row.playerId);
      const osaScouting = osaScoutingRatings.find(s => s.playerId === row.playerId);

      const profileData: BatterProfileData = {
        playerId: row.playerId,
        playerName: row.name,
        team: teamLabel,
        parentTeam: parentLabel,
        age: player?.age,
        position: row.position ?? player?.position,
        positionLabel: row.positionLabel,
        trueRating: row.trueRating,
        estimatedPower: row.estimatedPower,
        estimatedEye: row.estimatedEye,
        estimatedAvoidK: row.estimatedAvoidK,
        estimatedContact: row.estimatedContact,
        estimatedGap: row.estimatedGap,
        estimatedSpeed: row.estimatedSpeed,
        scoutPower: myScouting?.power,
        scoutEye: myScouting?.eye,
        scoutAvoidK: myScouting?.avoidK,
        scoutContact: myScouting?.contact,
        scoutGap: myScouting?.gap,
        scoutSpeed: myScouting?.speed,
        scoutSR: myScouting?.stealingAggressiveness,
        scoutSTE: myScouting?.stealingAbility,
        scoutOvr: myScouting?.ovr,
        scoutPot: myScouting?.pot,
        injuryProneness: myScouting?.injuryProneness || osaScouting?.injuryProneness,
        pa: row.stats?.pa,
        avg: row.stats?.avg,
        obp: row.stats?.obp,
        slg: row.stats?.slg,
        hr: row.stats?.hr,
        war: row.stats?.war,
        woba: row.woba,
        percentile: row.percentile,
        isProspect: false,
        projWar: row.projWar ?? row.stats?.war,
        projBbPct: row.blendedBbPct,
        projKPct: row.blendedKPct,
        projHrPct: row.blendedHrPct,
        projAvg: row.blendedAvg ?? (this.viewMode === 'projected' ? row.stats?.avg : undefined),
        projDoublesRate: row.blendedDoublesRate,
        projTriplesRate: row.blendedTriplesRate,
        projWoba: row.woba,
        projObp: this.viewMode === 'projected' ? row.stats?.obp : undefined,
        projSlg: this.viewMode === 'projected' ? row.stats?.slg : undefined,
        projPa: this.viewMode === 'projected' ? row.stats?.pa : undefined,
        projHr: this.viewMode === 'projected' ? row.stats?.hr : undefined,
      };

      await this.batterProfileModal.show(profileData, seasonYear);
      return;
    }

    // Otherwise handle as Pitcher
    // Get scouting from both sources
    const [myRatings, osaRatings] = await Promise.all([
      scoutingDataService.getLatestScoutingRatings('my'),
      scoutingDataService.getLatestScoutingRatings('osa')
    ]);
    const myScouting = myRatings.find(s => s.playerId === row.playerId);
    const osaScouting = osaRatings.find(s => s.playerId === row.playerId);
    const scouting = myScouting || osaScouting;

    // Extract pitch names and ratings if available
    const pitches = scouting?.pitches ? Object.keys(scouting.pitches) : [];
    const pitchRatings = scouting?.pitches ?? {};
    const usablePitchCount = (row as any).pitchCount; // Already calculated in TeamRatingsService

    // Determine if we should show the year label (only for historical data)
    const currentYear = this.currentGameYear ?? await dateService.getCurrentYear();
    const isHistorical = seasonYear < currentYear - 1;

    const profileData: PlayerProfileData = {
      playerId: row.playerId,
      playerName: row.name,
      team: teamLabel,
      parentTeam: parentLabel,
      age: player?.age,
      position: (row as any).isSp ? 'SP' : 'RP',
      positionLabel: (row as any).isSp ? 'SP' : 'RP',
      trueRating: row.trueRating,
      estimatedStuff: (row as any).trueStuff,
      estimatedControl: (row as any).trueControl,
      estimatedHra: (row as any).trueHra,

      // My Scout data
      scoutStuff: myScouting?.stuff,
      scoutControl: myScouting?.control,
      scoutHra: myScouting?.hra,
      scoutStamina: myScouting?.stamina,
      scoutInjuryProneness: myScouting?.injuryProneness,
      scoutOvr: myScouting?.ovr,
      scoutPot: myScouting?.pot,

      // OSA data
      osaStuff: osaScouting?.stuff,
      osaControl: osaScouting?.control,
      osaHra: osaScouting?.hra,
      osaStamina: osaScouting?.stamina,
      osaInjuryProneness: osaScouting?.injuryProneness,
      osaOvr: osaScouting?.ovr,
      osaPot: osaScouting?.pot,

      // Toggle state
      activeScoutSource: myScouting ? 'my' : 'osa',
      hasMyScout: !!myScouting,
      hasOsaScout: !!osaScouting,

      pitchCount: usablePitchCount,
      pitches,
      pitchRatings,
      isProspect: false,
      year: seasonYear,
      showYearLabel: isHistorical,
      projectionYear: seasonYear,
      projectionBaseYear: Math.max(2000, seasonYear - 1),
      forceProjection: this.viewMode === 'projected',
      // Pass projection data directly so the modal doesn't recalculate
      projIp: this.viewMode === 'projected' ? row.stats.ip : undefined,
      projWar: this.viewMode === 'projected' ? (row.stats.war ?? undefined) : undefined,
      projK9: this.viewMode === 'projected' ? row.stats.k9 : undefined,
      projBb9: this.viewMode === 'projected' ? row.stats.bb9 : undefined,
      projHr9: this.viewMode === 'projected' ? row.stats.hr9 : undefined,
      projFip: this.viewMode === 'projected' ? row.stats.fip : undefined,

      projectionOverride: this.viewMode === 'projected'
        ? {
            projectedStats: {
              ip: row.stats.ip,
              k9: row.stats.k9,
              bb9: row.stats.bb9,
              hr9: row.stats.hr9,
              fip: row.stats.fip,
              war: row.stats.war ?? 0
            },
            projectedRatings: {
              stuff: (row as any).trueStuff,
              control: (row as any).trueControl,
              hra: (row as any).trueHra
            }
          }
        : undefined
    };

    await pitcherProfileModal.show(profileData as any, seasonYear);
  }

  private async loadCurrentGameYear(): Promise<void> {
      try {
          this.currentGameYear = await dateService.getCurrentYear();
      } catch {
          this.currentGameYear = null;
      }
  }

  private async renderNoData(_error?: unknown): Promise<void> {
      if (this.currentGameYear === null) {
          await this.loadCurrentGameYear();
      }
      const year = this.selectedYear;
      const isCurrentOrFuture = this.currentGameYear !== null && year >= this.currentGameYear;
      const baseMessage = this.isAllTime
          ? 'No historical data found. Make sure stats data has been loaded for at least one season.'
          : isCurrentOrFuture
          ? `No ${year} data yet. Try a previous year or check back once the season starts. For now, check out the team projections!`
          : `No data found for ${year}.`;

      const message = this.viewMode === 'projected'
          ? `Unable to load projections for ${year}.`
          : baseMessage;

      const rotContainer = this.container.querySelector('#rotation-rankings');
      const penContainer = this.container.querySelector('#bullpen-rankings');
      if (rotContainer) {
          rotContainer.innerHTML = `
            <h3 class="section-title">Top Rotations</h3>
            <p class="no-stats">${message}</p>
          `;
      }
      if (penContainer) {
          penContainer.innerHTML = `
            <h3 class="section-title">Top Bullpens</h3>
            <p class="no-stats">${message}</p>
          `;
      }

      const improvements = this.container.querySelector<HTMLElement>('#projected-improvements');
      if (improvements) {
          improvements.style.display = 'none';
          improvements.innerHTML = '';
      }
  }
}
