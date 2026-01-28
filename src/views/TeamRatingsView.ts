import { teamRatingsService, TeamRatingResult, RatedPlayer } from '../services/TeamRatingsService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { dateService } from '../services/DateService';
import { PlayerProfileModal, PlayerProfileData } from './PlayerProfileModal';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { scoutingDataService } from '../services/ScoutingDataService';

interface TeamColumn {
  key: 'name' | 'trueRating' | 'ip' | 'k9' | 'bb9' | 'hr9' | 'eraOrWar' | 'war';
  label: string;
  sortKey?: string;
}

interface PlayerRowContext {
  player: RatedPlayer;
  seasonYear?: number;
  teamKey: string;
  type: 'rotation' | 'bullpen';
}

interface ImprovementRow {
  teamId: number;
  teamName: string;
  previous: number;
  projected: number;
  delta: number;
}

export class TeamRatingsView {
  private container: HTMLElement;
  private selectedYear: number = 2020;
  private viewMode: 'projected' | 'all-time' | 'year' = 'year';
  private results: TeamRatingResult[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000
  private currentGameYear: number | null = null;
  private playerProfileModal: PlayerProfileModal;
  private playerRowLookup: Map<string, PlayerRowContext> = new Map();
  private teamResultLookup: Map<string, TeamRatingResult> = new Map();
  private isDraggingColumn = false;
  private teamColumnOrder: Record<'rotation' | 'bullpen', string[]> = { rotation: [], bullpen: [] };
  private teamSortState: Map<string, { key: string; direction: 'asc' | 'desc' }> = new Map();
  private lastSelectedYear = this.selectedYear;
  private allTimeResults: TeamRatingResult[] | null = null;
  private projectedBaselineResults: TeamRatingResult[] | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.playerProfileModal = new PlayerProfileModal();
    this.renderLayout();
    this.loadCurrentGameYear();
    this.loadData();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Team Ratings</h2>
        
        <div class="true-ratings-controls">          
          <div class="form-field">
            <label>View:</label>
            <div class="toggle-group" role="group" aria-label="View mode">
              <button class="toggle-btn" data-view-mode="projected" aria-pressed="false">Projections</button>
              <button class="toggle-btn" data-view-mode="all-time" aria-pressed="false">All Time</button>
              <button class="toggle-btn active" data-view-mode="year" aria-pressed="true">By Year</button>
            </div>
          </div>
          <div class="form-field" id="year-selector-field">
            <label for="team-ratings-year">Year:</label>
            <select id="team-ratings-year">
              ${this.yearOptions.map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="view-notice" style="display: none; margin-bottom: 1rem; padding: 0.5rem; background: rgba(var(--color-primary-rgb), 0.1); border-radius: 4px; border: 1px solid rgba(var(--color-primary-rgb), 0.2);">
            <strong>Projections:</strong> Showing projected ratings for the <em>upcoming</em> season (${this.selectedYear + 1}) based on historical data and wizardry. These will not update throughout the year. Use 'By Year' to show current team ratings.
        </div>

        <div class="team-ratings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-top: 1rem;">
            <div id="rotation-rankings">
                ${this.renderTeamLoadingState('Top Rotations')}
            </div>
            <div id="bullpen-rankings">
                ${this.renderTeamLoadingState('Top Bullpens')}
            </div>
        </div>

        <div id="projected-improvements" class="projected-improvements" style="display: none;"></div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.container.querySelector('#team-ratings-year')?.addEventListener('change', (e) => {
      this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
      this.lastSelectedYear = this.selectedYear;
      this.updateViewNotice();
      this.showLoadingState();
      this.loadData();
    });

    this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = (e.target as HTMLElement).dataset.viewMode as 'projected' | 'all-time' | 'year';
            if (mode === this.viewMode) return;
            
            this.viewMode = mode;
            this.teamSortState.clear();
            
            // If switching to projections, force latest year (2020)
            if (this.viewMode === 'projected') {
                this.selectedYear = 2020;
                const yearSelect = this.container.querySelector<HTMLSelectElement>('#team-ratings-year');
                if (yearSelect) yearSelect.value = '2020';
            }

            if (this.viewMode === 'year') {
                this.selectedYear = this.lastSelectedYear;
                const yearSelect = this.container.querySelector<HTMLSelectElement>('#team-ratings-year');
                if (yearSelect) yearSelect.value = String(this.selectedYear);
            }

            this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
                const b = btn as HTMLElement;
                const isActive = b.dataset.viewMode === mode;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-pressed', String(isActive));
            });
            
            this.updateViewNotice();
            this.showLoadingState();
            this.loadData();
        });
    });
  }

  private showLoadingState(): void {
      const rotContainer = this.container.querySelector('#rotation-rankings');
      const penContainer = this.container.querySelector('#bullpen-rankings');
      const improvements = this.container.querySelector<HTMLElement>('#projected-improvements');

      if (rotContainer) {
          rotContainer.innerHTML = this.renderTeamLoadingState('Top Rotations');
      }

      if (penContainer) {
          penContainer.innerHTML = this.renderTeamLoadingState('Top Bullpens');
      }

      if (improvements) {
          if (this.viewMode === 'projected') {
              improvements.style.display = 'block';
              improvements.innerHTML = this.renderImprovementsLoadingState();
          } else {
              improvements.style.display = 'none';
              improvements.innerHTML = '';
          }
      }
  }

  private renderTeamLoadingState(title: string): string {
      const note = this.getTeamSectionNote();
      return `
        <div class="team-collapsible loading-skeleton">
          <div class="team-collapsible-summary">
            <div>
              <h3 class="section-title">${title} <span class="note-text">${note}</span></h3>
              <div class="team-preview-list">
                ${this.renderTeamPreviewSkeletonRows(3)}
              </div>
            </div>
            <span class="team-collapsible-label"><span class="skeleton-line sm"></span></span>
          </div>
        </div>
      `;
  }

  private renderTeamPreviewSkeletonRows(count: number): string {
      return Array.from({ length: count }, () => `
        <div class="team-preview-row">
          <span class="team-preview-rank"><span class="skeleton-line xs"></span></span>
          <span class="team-preview-name"><span class="skeleton-line md"></span></span>
          <span class="team-preview-score"><span class="skeleton-line sm"></span></span>
        </div>
      `).join('');
  }

  private renderImprovementsLoadingState(): string {
      const note = `(WAR vs ${this.selectedYear})`;
      return `
        <h3 class="section-title">Projected Most Improved <span class="note-text">${note}</span></h3>
        <div class="projected-improvements-grid">
          <div class="improvement-card loading-skeleton">
            <h4 class="section-title">Rotations</h4>
            ${this.renderImprovementSkeletonRows(5)}
          </div>
          <div class="improvement-card loading-skeleton">
            <h4 class="section-title">Bullpens</h4>
            ${this.renderImprovementSkeletonRows(5)}
          </div>
        </div>
      `;
  }

  private renderImprovementSkeletonRows(count: number): string {
      return Array.from({ length: count }, () => `
        <div class="improvement-row">
          <span class="improvement-rank"><span class="skeleton-line xs"></span></span>
          <span class="improvement-team"><span class="skeleton-line md"></span></span>
          <span class="improvement-badge-group"><span class="skeleton-line sm"></span></span>
          <span class="improvement-badge-group"><span class="skeleton-line sm"></span></span>
          <span class="improvement-badge-group"><span class="skeleton-line sm"></span></span>
        </div>
      `).join('');
  }

  private getTeamSectionNote(): string {
      return this.viewMode === 'all-time'
        ? '(All-time top 10, ranked by WAR)'
        : '(Ranked by WAR)';
  }

  private updateViewNotice(): void {
      const notice = this.container.querySelector<HTMLElement>('#view-notice');
      const yearField = this.container.querySelector<HTMLElement>('#year-selector-field');
      
      if (notice) {
          if (this.viewMode === 'projected') {
              notice.style.display = 'block';
              notice.innerHTML = `<strong>Projections:</strong> Showing projected ratings for the <em>upcoming</em> season (${this.selectedYear + 1}) based on historical data and wizardry. These will not update throughout the year. Use 'By Year' to show current team ratings.`;
          } else if (this.viewMode === 'all-time') {
              notice.style.display = 'block';
              notice.innerHTML = `<strong>All Time:</strong> Top 10 rotations and bullpens across all years, ranked by WAR for that season.`;
          } else {
              notice.style.display = 'none';
          }
      }
      
      if (yearField) {
          yearField.style.display = this.viewMode === 'year' ? 'block' : 'none';
      }
  }

  private async loadData(): Promise<void> {
    try {
        if (this.viewMode === 'year') {
            this.results = await teamRatingsService.getTeamRatings(this.selectedYear);
            this.projectedBaselineResults = null;
        } else if (this.viewMode === 'all-time') {
            if (this.allTimeResults) {
                this.results = this.allTimeResults;
            } else {
                this.results = await teamRatingsService.getAllTimeTeamRatings(this.yearOptions);
                this.allTimeResults = this.results;
            }
            this.projectedBaselineResults = null;
        } else {
            console.log('Fetching projections...', teamRatingsService);
            if (typeof teamRatingsService.getProjectedTeamRatings !== 'function') {
                console.error('getProjectedTeamRatings is missing on teamRatingsService!', teamRatingsService);
                throw new Error('Service method missing. Please refresh the page.');
            }
            this.results = await teamRatingsService.getProjectedTeamRatings(this.selectedYear);
            try {
                this.projectedBaselineResults = await teamRatingsService.getTeamRatings(this.selectedYear);
            } catch (baselineError) {
                console.warn('Failed to load baseline team ratings for improvements.', baselineError);
                this.projectedBaselineResults = null;
            }
        }
        if (this.results.length === 0) {
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
      });

      // Render Rotation List
      const rotSorted = [...this.results].sort((a, b) => b.rotationWar - a.rotationWar);
      const rotDisplay = this.viewMode === 'all-time' ? rotSorted.slice(0, 10) : rotSorted;
      rotContainer.innerHTML = this.renderTeamCollapsible({
        title: 'Top Rotations',
        note: this.viewMode === 'all-time' ? '(All-time top 10, ranked by WAR)' : '(Ranked by WAR)',
        type: 'rotation',
        teams: rotDisplay
      });

      // Render Bullpen List
      const penSorted = [...this.results].sort((a, b) => b.bullpenWar - a.bullpenWar);
      const penDisplay = this.viewMode === 'all-time' ? penSorted.slice(0, 10) : penSorted;
      penContainer.innerHTML = this.renderTeamCollapsible({
        title: 'Top Bullpens',
        note: this.viewMode === 'all-time' ? '(All-time top 10, ranked by WAR)' : '(Ranked by WAR)',
        type: 'bullpen',
        teams: penDisplay
      });

      this.bindToggleEvents();
      this.bindFlipCardLocking();
      this.bindPlayerNameClicks();
      this.bindTeamTableSortHeaders();
      this.bindTeamColumnDragAndDrop();
      this.renderProjectedImprovements();
  }

  private renderProjectedImprovements(): void {
      const container = this.container.querySelector<HTMLElement>('#projected-improvements');
      if (!container) return;

      if (this.viewMode !== 'projected') {
          container.style.display = 'none';
          container.innerHTML = '';
          return;
      }

      container.style.display = 'block';

      const baseline = this.projectedBaselineResults;
      if (!baseline || baseline.length === 0) {
          container.innerHTML = `
            <div class="improvement-card">
              <h3 class="section-title">Projected Most Improved</h3>
              <p class="no-stats">Baseline year data unavailable for comparison.</p>
            </div>
          `;
          return;
      }

      const lastYear = this.selectedYear;
      const lastYearMap = new Map(baseline.map(team => [team.teamId, team]));

      const rotationRows = this.buildImprovementRows(lastYearMap, 'rotation');
      const bullpenRows = this.buildImprovementRows(lastYearMap, 'bullpen');

      container.innerHTML = `
        <h3 class="section-title">Projected Most Improved <span class="note-text">(WAR vs ${lastYear})</span></h3>
        <div class="projected-improvements-grid">
          ${this.renderImprovementCard('Rotations', rotationRows)}
          ${this.renderImprovementCard('Bullpens', bullpenRows)}
        </div>
      `;
  }

  private buildImprovementRows(
    baselineMap: Map<number, TeamRatingResult>,
    type: 'rotation' | 'bullpen'
  ): ImprovementRow[] {
      const rows = this.results
        .map(team => {
          const prev = baselineMap.get(team.teamId);
          if (!prev) return null;
          const projected = type === 'rotation' ? team.rotationWar : team.bullpenWar;
          const previous = type === 'rotation' ? prev.rotationWar : prev.bullpenWar;
          return {
            teamId: team.teamId,
            teamName: team.teamName,
            previous,
            projected,
            delta: projected - previous
          };
        })
        .filter((row): row is ImprovementRow => row !== null);

      return rows.sort((a, b) => b.delta - a.delta).slice(0, 5);
  }

  private renderImprovementCard(title: string, rows: ImprovementRow[]): string {
      if (rows.length === 0) {
          return `
            <div class="improvement-card">
              <h4 class="section-title">${title}</h4>
              <p class="no-stats">No comparison data available.</p>
            </div>
          `;
      }

      const rowsHtml = rows.map((row, index) => {
          const prevClass = this.getWarClass(row.previous, title === 'Rotations' ? 'rotation' : 'bullpen');
          const projClass = this.getWarClass(row.projected, title === 'Rotations' ? 'rotation' : 'bullpen');
          const deltaClass = this.getWarDeltaClass(row.delta);
          const deltaLabel = row.delta >= 0 ? 'Improvement' : 'Decline';
          return `
            <div class="improvement-row">
              <span class="improvement-rank">#${index + 1}</span>
              <span class="improvement-team">${row.teamName}</span>
              <span class="improvement-badge-group">
                <span class="improvement-label">Last year</span>
                <span class="badge ${prevClass}">${this.formatWar(row.previous)}</span>
              </span>
              <span class="improvement-badge-group">
                <span class="improvement-label">Projected</span>
                <span class="badge ${projClass}">${this.formatWar(row.projected)}</span>
              </span>
              <span class="improvement-badge-group">
                <span class="improvement-label">${deltaLabel}</span>
                <span class="badge ${deltaClass} improvement-delta">${this.formatWarDelta(row.delta)}</span>
              </span>
            </div>
          `;
      }).join('');

      return `
        <details class="team-collapsible improvement-collapsible">
          <summary class="team-collapsible-summary">
            <div>
              <h4 class="section-title">${title}</h4>
              <div class="team-preview-list">
                ${rows.slice(0, 3).map((row, index) => this.renderImprovementPreviewRow(row, index + 1)).join('')}
              </div>
            </div>
            <span class="team-collapsible-label">
              <span class="team-collapsible-icon team-collapsible-icon-open">−</span>
              <span class="team-collapsible-icon team-collapsible-icon-closed">+</span>
              <span class="team-collapsible-text team-collapsible-text-open">Collapse list</span>
              <span class="team-collapsible-text team-collapsible-text-closed">View full list</span>
            </span>
          </summary>
          <div class="improvement-list">
            ${rowsHtml}
          </div>
        </details>
      `;
  }

  private renderImprovementPreviewRow(row: ImprovementRow, rank: number): string {
      const deltaClass = this.getWarDeltaClass(row.delta);
      const deltaLabel = row.delta >= 0 ? 'Improvement' : 'Decline';

      return `
        <div class="team-preview-row">
          <span class="team-preview-rank">#${rank}</span>
          <span class="team-preview-name">${row.teamName}</span>
          <span class="badge ${deltaClass} team-preview-score">${deltaLabel}: ${this.formatWarDelta(row.delta)}</span>
        </div>
      `;
  }

  private renderTeamCollapsible(params: {
    title: string;
    note: string;
    type: 'rotation' | 'bullpen';
    teams: TeamRatingResult[];
  }): string {
    const previewTeams = params.teams.slice(0, 3);
    const preview = previewTeams.length
      ? previewTeams.map((team, idx) => this.renderTeamPreviewRow(team, idx + 1, params.type)).join('')
      : '<p class="no-stats">No data available.</p>';

    const fullList = params.teams.length
      ? params.teams.map((team, idx) => this.renderTeamRow(team, idx + 1, params.type)).join('')
      : '<p class="no-stats">No data available.</p>';

    return `
      <details class="team-collapsible">
        <summary class="team-collapsible-summary">
          <div>
            <h3 class="section-title">${params.title} <span class="note-text">${params.note}</span></h3>
            <div class="team-preview-list">
              ${preview}
            </div>
          </div>
          <span class="team-collapsible-label">
            <span class="team-collapsible-icon team-collapsible-icon-open">−</span>
            <span class="team-collapsible-icon team-collapsible-icon-closed">+</span>
            <span class="team-collapsible-text team-collapsible-text-open">Collapse list</span>
            <span class="team-collapsible-text team-collapsible-text-closed">View full list</span>
          </span>
        </summary>
        <div class="team-list">
          ${fullList}
        </div>
      </details>
    `;
  }

  private renderTeamPreviewRow(team: TeamRatingResult, rank: number, type: 'rotation' | 'bullpen'): string {
      const war = type === 'rotation' ? team.rotationWar : team.bullpenWar;
      const scoreClass = this.getWarClass(war, type);
      const yearLabel = this.viewMode === 'all-time' && team.seasonYear
        ? ` <span class="note-text">(${team.seasonYear})</span>`
        : '';

      return `
        <div class="team-preview-row">
          <span class="team-preview-rank">#${rank}</span>
          <span class="team-preview-name">${team.teamName}${yearLabel}</span>
          <span class="badge ${scoreClass} team-preview-score">${this.formatWar(war)}</span>
        </div>
      `;
  }

  private renderTeamRow(team: TeamRatingResult, rank: number, type: 'rotation' | 'bullpen'): string {
      const war = type === 'rotation' ? team.rotationWar : team.bullpenWar;
      const runsAllowed = type === 'rotation' ? team.rotationRunsAllowed : team.bullpenRunsAllowed;
      const leagueAvgRuns = type === 'rotation' ? team.rotationLeagueAvgRuns : team.bullpenLeagueAvgRuns;
      
      const scoreClass = this.getWarClass(war, type);
      const badgeTitle = `Total WAR: ${war.toFixed(1)} (Runs Allowed: ${this.formatRunsValue(runsAllowed)} vs Avg ${this.formatRunsValue(leagueAvgRuns)})`;
      const yearLabel = this.viewMode === 'all-time' && team.seasonYear
        ? ` <span class="note-text">(${team.seasonYear})</span>`
        : '';
      const teamKey = this.buildTeamKey(team);
      
      return `
        <div class="team-card">
            <div class="team-header" data-team-key="${teamKey}" data-type="${type}" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span style="font-weight: bold; color: var(--color-text-muted); width: 20px;">#${rank}</span>
                    <span style="font-weight: 600;">${team.teamName}${yearLabel}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                     <span class="badge ${scoreClass}" style="font-size: 1.1em;" title="${badgeTitle}">${this.formatWar(war)}</span>
                     <span class="toggle-icon">▼</span>
                </div>
            </div>
            <div class="team-details" id="details-${type}-${teamKey}" data-team-key="${teamKey}" data-type="${type}" style="display: none; padding: 0.5rem; background: var(--color-surface-hover); margin-bottom: 1rem; border-radius: 4px;">
                ${this.renderTeamDetailsTable(team, type)}
            </div>
        </div>
      `;
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

  private getWarDeltaClass(delta: number): string {
      if (delta > 0) return 'rating-plus';
      if (delta < 0) return 'rating-poor';
      return 'rating-fringe';
  }

  private formatWar(value: number): string {
    return value.toFixed(1);
  }

  private formatWarDelta(value: number): string {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)}`;
  }

  private formatRunsValue(value: number): string {
    return Math.round(value).toString();
  }

  private buildTeamKey(team: TeamRatingResult): string {
    const yearToken = team.seasonYear ?? 'current';
    return `${team.teamId}-${yearToken}`;
  }

  private buildPlayerKey(teamKey: string, type: 'rotation' | 'bullpen', playerId: number): string {
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
        return `<button class="btn-link player-name-link" data-player-key="${this.buildPlayerKey(context.teamKey, context.type, player.playerId)}" data-player-id="${player.playerId}">${player.name}</button>`;
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

  private bindToggleEvents(): void {
      this.container.querySelectorAll('.team-header').forEach(header => {
          header.addEventListener('click', () => {
              const teamKey = (header as HTMLElement).dataset.teamKey;
              const type = (header as HTMLElement).dataset.type;
              const details = this.container.querySelector(`#details-${type}-${teamKey}`);
              const icon = header.querySelector('.toggle-icon');
              
              if (details && icon) {
                  const isHidden = (details as HTMLElement).style.display === 'none';
                  (details as HTMLElement).style.display = isHidden ? 'block' : 'none';
                  icon.textContent = isHidden ? '▲' : '▼';
                  
                  // Re-bind flip events if becoming visible (though checking querySelector inside might be safer globally)
                  // But flip events are bound on renderLists, so they should persist.
              }
          });
      });
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
        const playerId = parseInt(link.dataset.playerId ?? '', 10);
        if (!playerId) return;
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
    const usablePitchCount = row.pitchCount; // Already calculated in TeamRatingsService

    // Determine if we should show the year label (only for historical data)
    const currentYear = this.currentGameYear ?? await dateService.getCurrentYear();
    const isHistorical = seasonYear < currentYear - 1;

    const profileData: PlayerProfileData = {
      playerId: row.playerId,
      playerName: row.name,
      team: teamLabel,
      parentTeam: parentLabel,
      position: row.isSp ? 'SP' : 'RP',
      trueRating: row.trueRating,
      estimatedStuff: row.trueStuff,
      estimatedControl: row.trueControl,
      estimatedHra: row.trueHra,

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
      showYearLabel: isHistorical || this.viewMode === 'all-time',
      projectionYear: seasonYear,
      projectionBaseYear: Math.max(2000, seasonYear - 1),
      forceProjection: this.viewMode === 'projected',
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
              stuff: row.trueStuff,
              control: row.trueControl,
              hra: row.trueHra
            }
          }
        : undefined
    };

    await this.playerProfileModal.show(profileData, seasonYear);
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
      const baseMessage = isCurrentOrFuture
          ? `No ${year} data yet. Try a previous year or check back once the season starts. For now, check out the team projections!`
          : `No data found for ${year}.`;

      const message = this.viewMode === 'projected'
          ? `Unable to load projections for ${year}.`
          : this.viewMode === 'all-time'
            ? 'No all-time team ratings available.'
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
