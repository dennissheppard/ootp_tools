import { projectionService, ProjectedPlayer } from '../services/ProjectionService';
import { dateService } from '../services/DateService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { PlayerProfileModal, PlayerProfileData } from './PlayerProfileModal';
import { trueRatingsService } from '../services/TrueRatingsService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { fipWarService } from '../services/FipWarService';
import { projectionAnalysisService, AggregateAnalysisReport } from '../services/ProjectionAnalysisService';

interface ProjectedPlayerWithActuals extends ProjectedPlayer {
  actualStats?: {
    fip: number;
    war: number;
    ip: number;
    diff: number;
    grade: string;
  };
}

interface ColumnConfig {
  key: keyof ProjectedPlayerWithActuals | string;
  label: string;
  sortKey?: string;
  accessor?: (row: ProjectedPlayerWithActuals) => any;
}

export class ProjectionsView {
  private container: HTMLElement;
  private stats: ProjectedPlayerWithActuals[] = [];
  private allStats: ProjectedPlayerWithActuals[] = [];
  private currentPage = 1;
  private itemsPerPage = 50;
  private selectedYear = 2020;
  private selectedTeam = 'all';
  private teamOptions: string[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i);
  private isOffseason = false;
  private statsYearUsed: number | null = null;
  private usedFallbackStats = false;
  private viewMode: 'projections' | 'backcasting' | 'analysis' = 'projections';
  private sortKey: string = 'projectedStats.fip';
  private sortDirection: 'asc' | 'desc' = 'asc';
  private columns: ColumnConfig[] = [];
  private isDraggingColumn = false;
  private prefKey = 'wbl-projections-prefs';
  private playerProfileModal: PlayerProfileModal;
  private playerRowLookup: Map<number, ProjectedPlayerWithActuals> = new Map();
  private hasActualStats = false;
  private teamLookup: Map<number, any> = new Map();
  private analysisReport: AggregateAnalysisReport | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.playerProfileModal = new PlayerProfileModal();
    this.initColumns();
    this.renderLayout();
    this.initializeFromGameDate();
  }

  private initColumns(): void {
    const defaults: ColumnConfig[] = [
        { key: 'name', label: 'Name', accessor: p => this.renderPlayerName(p) },
        { key: 'teamName', label: 'Team' },
        { key: 'age', label: 'Age', accessor: p => this.renderAge(p) },
        { key: 'currentTrueRating', label: 'Current TR', sortKey: 'currentTrueRating', accessor: p => this.renderRatingBadge(p) },
        { key: 'projK9', label: 'Proj K/9', sortKey: 'projectedStats.k9', accessor: p => p.projectedStats.k9.toFixed(2) },
        { key: 'projBB9', label: 'Proj BB/9', sortKey: 'projectedStats.bb9', accessor: p => p.projectedStats.bb9.toFixed(2) },
        { key: 'projHR9', label: 'Proj HR/9', sortKey: 'projectedStats.hr9', accessor: p => p.projectedStats.hr9.toFixed(2) },
        { key: 'projFIP', label: 'Proj FIP', sortKey: 'projectedStats.fip', accessor: p => p.projectedStats.fip.toFixed(2) },
        { key: 'projWAR', label: 'Proj WAR', sortKey: 'projectedStats.war', accessor: p => p.projectedStats.war.toFixed(1) },
        { key: 'projIP', label: 'Proj IP', sortKey: 'projectedStats.ip', accessor: p => p.projectedStats.ip }
    ];

    // Only add backcasting columns if we have actual stats for the selected year
    if (this.hasActualStats) {
        defaults.push(
            { key: 'actFIP', label: 'Act FIP', sortKey: 'actualStats.fip', accessor: p => p.actualStats ? p.actualStats.fip.toFixed(2) : '' },
            { key: 'diff', label: 'Diff', sortKey: 'actualStats.diff', accessor: p => p.actualStats ? (p.actualStats.diff > 0 ? `+${p.actualStats.diff.toFixed(2)}` : p.actualStats.diff.toFixed(2)) : '' },
            { key: 'grade', label: 'Grade', sortKey: 'actualStats.diff', accessor: p => this.renderGrade(p) }
        );
    }

    this.columns = this.loadColumnPrefs(defaults);
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Stat Projections</h2>
        <p class="section-subtitle" id="projections-subtitle"></p>
        
        <div class="true-ratings-controls">
          <div class="form-field">
            <label for="proj-year">Projection Year:</label>
            <select id="proj-year" style="display: none;"></select>
          </div>
          <div class="form-field">
            <label for="proj-team">Team:</label>
            <select id="proj-team">
              <option value="all">All</option>
            </select>
          </div>
          <div class="form-field">
            <label>View:</label>
            <div class="toggle-group" role="group" aria-label="Projection view mode">
              <button class="toggle-btn ${this.viewMode === 'projections' ? 'active' : ''}" data-proj-mode="projections" aria-pressed="${this.viewMode === 'projections'}">Projections</button>
              <button class="toggle-btn ${this.viewMode === 'backcasting' ? 'active' : ''}" data-proj-mode="backcasting" aria-pressed="${this.viewMode === 'backcasting'}">Backcasting</button>
              <button class="toggle-btn ${this.viewMode === 'analysis' ? 'active' : ''}" data-proj-mode="analysis" aria-pressed="${this.viewMode === 'analysis'}">Analysis</button>
            </div>
          </div>
        </div>

        <div id="projections-table-container">
            <div class="loading-message">Loading projections...</div>
        </div>
        
        <div class="pagination-controls">
          <button id="prev-page" disabled>Previous</button>
          <span id="page-info"></span>
          <button id="next-page" disabled>Next</button>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
      this.container.querySelector('#proj-year')?.addEventListener('change', (e) => {
          this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
          this.fetchData();
      });

      this.container.querySelector('#proj-team')?.addEventListener('change', (e) => {
          this.selectedTeam = (e.target as HTMLSelectElement).value;
          this.currentPage = 1;
          this.filterAndRender();
      });

      this.container.querySelector('#prev-page')?.addEventListener('click', () => {
          if (this.currentPage > 1) {
              this.currentPage--;
              this.renderTable();
          }
      });

      this.container.querySelector('#next-page')?.addEventListener('click', () => {
          const totalPages = Math.ceil(this.stats.length / this.itemsPerPage);
          if (this.currentPage < totalPages) {
              this.currentPage++;
              this.renderTable();
          }
      });

      this.container.querySelectorAll<HTMLButtonElement>('[data-proj-mode]').forEach(button => {
          button.addEventListener('click', () => {
              const mode = button.dataset.projMode as 'projections' | 'backcasting' | 'analysis' | undefined;
              if (!mode || mode === this.viewMode) return;
              this.viewMode = mode;
              this.updateModeControls();
              
              if (this.viewMode === 'analysis') {
                  this.renderAnalysisLanding();
              } else {
                  this.fetchData();
              }
          });
      });
  }

  private async fetchData(): Promise<void> {
      const container = this.container.querySelector('#projections-table-container');
      if (container) container.innerHTML = '<div class="loading-message">Calculating projections...</div>';

      try {
          const currentYear = await dateService.getCurrentYear();
          const targetYear = this.viewMode === 'backcasting' ? this.selectedYear : currentYear;
          const statsBaseYear = targetYear - 1;

          // Use previous year as base for projections
          const context = await projectionService.getProjectionsWithContext(statsBaseYear, { forceRosterRefresh: true });
          let allPlayers = context.projections;
          this.statsYearUsed = context.statsYear;
          this.usedFallbackStats = context.usedFallbackStats;

          // Don't include prospects - they get peak year projections when viewed individually
          let combinedPlayers: ProjectedPlayerWithActuals[] = [...allPlayers];

          // Backcasting: If target year (selectedYear) has happened, compare projections to actuals
          if (targetYear < currentYear) {
              try {
                  const [actuals, targetLeague] = await Promise.all([
                      trueRatingsService.getTruePitchingStats(targetYear),
                      leagueStatsService.getLeagueStats(targetYear)
                  ]);
                  
                  const actualsMap = new Map(actuals.map(a => [a.player_id, a]));
                  
                  combinedPlayers.forEach(p => {
                      const act = actualsMap.get(p.playerId);
                      if (act) {
                          const ip = trueRatingsService.parseIp(act.ip);
                          // Only grade if they pitched enough to matter (e.g. 10 IP)
                          if (ip >= 10) {
                              const k9 = ip > 0 ? (act.k / ip) * 9 : 0;
                              const bb9 = ip > 0 ? (act.bb / ip) * 9 : 0;
                              const hr9 = ip > 0 ? (act.hra / ip) * 9 : 0;
                              
                              const fip = fipWarService.calculateFip({ k9, bb9, hr9, ip }, targetLeague.fipConstant);
                              const diff = fip - p.projectedStats.fip;
                              
                              // Grade Logic
                              let grade = 'F';
                              const absDiff = Math.abs(diff);
                              if (absDiff < 0.50) grade = 'A';
                              else if (absDiff < 1.00) grade = 'B';
                              else if (absDiff < 1.50) grade = 'C';
                              else if (absDiff < 2.00) grade = 'D';
                              
                              p.actualStats = {
                                  fip,
                                  war: act.war,
                                  ip,
                                  diff,
                                  grade
                              };
                          }
                      }
                  });
              } catch (e) {
                  console.warn('Backcasting data unavailable', e);
              }
          }

          this.allStats = combinedPlayers;

          // Check if we have actual stats (for conditional column display)
          this.hasActualStats = this.allStats.some(p => p.actualStats !== undefined);

          // Rebuild columns based on whether we have actual stats
          this.initColumns();

          // Populate team filter - only include MLB teams (parent_team_id === 0)
          const allTeams = await teamService.getAllTeams();
          this.teamLookup = new Map(allTeams.map(t => [t.id, t]));

          // Build set of MLB parent org names
          const mlbTeamNames = new Set<string>();

          for (const player of this.allStats) {
            const parentOrgName = this.getParentOrgName(player.teamId);
            if (parentOrgName && parentOrgName !== 'FA') {
              mlbTeamNames.add(parentOrgName);
            }
          }

          this.teamOptions = Array.from(mlbTeamNames).sort();
          this.updateTeamFilter();

          this.updateSubtitle();
          this.filterAndRender();
      } catch (err) {
          console.error(err);
          if (container) container.innerHTML = `<div class="error-message">Error: ${err}</div>`;
      }
  }

  private renderAnalysisLanding(): void {
      const container = this.container.querySelector('#projections-table-container');
      const subtitle = this.container.querySelector<HTMLElement>('#projections-subtitle');
      if (subtitle) subtitle.textContent = 'Aggregate analysis of projection accuracy across all years.';
      
      if (!container) return;

      container.innerHTML = `
        <div class="analysis-landing" style="text-align: center; padding: 40px;">
            <h3>Projection Accuracy Analysis</h3>
            <p style="max-width: 600px; margin: 0 auto 20px; color: var(--color-text-secondary);">
                This report will iterate through all available historical years, run the projection algorithm for each year based on prior data, 
                and compare it against the actual results. This process may take a few moments.
            </p>
            <button id="run-analysis-btn" class="btn btn-primary">Run Analysis Report</button>
            <div id="analysis-progress" style="margin-top: 20px; display: none;">
                <div class="loading-message">Analyzing Year <span id="analysis-year-indicator">...</span></div>
            </div>
        </div>
      `;

      container.querySelector('#run-analysis-btn')?.addEventListener('click', () => this.runAnalysis());
  }

  private async runAnalysis(): Promise<void> {
      const btn = this.container.querySelector<HTMLButtonElement>('#run-analysis-btn');
      const progress = this.container.querySelector<HTMLElement>('#analysis-progress');
      const indicator = this.container.querySelector<HTMLElement>('#analysis-year-indicator');
      
      if (btn) btn.disabled = true;
      if (progress) progress.style.display = 'block';

      try {
          const currentYear = await dateService.getCurrentYear();
          // Analyze from 2000 up to last completed season (currentYear - 1)
          // If we are in 2026, we can analyze up to 2025 actuals.
          // Wait, backcasting logic: to analyze 2025, we project from 2024 and compare to 2025 actuals.
          // So endYear should be currentYear - 1.
          
          this.analysisReport = await projectionAnalysisService.runAnalysis(2000, currentYear - 1, (year) => {
              if (indicator) indicator.textContent = year.toString();
          });

          this.renderAnalysisResults();
      } catch (err) {
          console.error(err);
          if (progress) progress.innerHTML = `<div class="error-message">Analysis failed: ${err}</div>`;
          if (btn) btn.disabled = false;
      }
  }

  private renderAnalysisResults(): void {
      if (!this.analysisReport) return;
      const container = this.container.querySelector('#projections-table-container');
      if (!container) return;

      const { overallMetrics, years, metricsByTeam } = this.analysisReport;

      const renderMetrics = (m: any) => `
          <div class="metric-box">
              <span class="metric-label">MAE</span>
              <span class="metric-value">${m.mae.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">RMSE</span>
              <span class="metric-value">${m.rmse.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">Bias</span>
              <span class="metric-value ${m.bias > 0 ? 'text-success' : 'text-danger'}">${m.bias > 0 ? '+' : ''}${m.bias.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">N</span>
              <span class="metric-value">${m.count}</span>
          </div>
      `;

      // Year Table
      const yearRows = years.map(y => `
          <tr>
              <td>${y.year}</td>
              <td>${y.metrics.mae.toFixed(3)}</td>
              <td>${y.metrics.rmse.toFixed(3)}</td>
              <td class="${y.metrics.bias > 0 ? 'text-success' : 'text-danger'}">${y.metrics.bias > 0 ? '+' : ''}${y.metrics.bias.toFixed(3)}</td>
              <td>${y.metrics.count}</td>
          </tr>
      `).join('');

      // Team Table
      const sortedTeams = Array.from(metricsByTeam.entries()).sort((a, b) => a[1].mae - b[1].mae);
      const teamRows = sortedTeams.map(([team, m]) => `
          <tr>
              <td>${team}</td>
              <td>${m.mae.toFixed(3)}</td>
              <td>${m.rmse.toFixed(3)}</td>
              <td class="${m.bias > 0 ? 'text-success' : 'text-danger'}">${m.bias > 0 ? '+' : ''}${m.bias.toFixed(3)}</td>
              <td>${m.count}</td>
          </tr>
      `).join('');

      container.innerHTML = `
          <div class="analysis-results">
              <div class="analysis-summary">
                  <h4>Overall Accuracy (FIP)</h4>
                  <div class="metrics-grid">
                      ${renderMetrics(overallMetrics)}
                  </div>
              </div>

              <div class="analysis-split">
                  <div class="analysis-section">
                      <h4>Accuracy by Year</h4>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Year</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${yearRows}</tbody>
                      </table>
                  </div>

                  <div class="analysis-section">
                      <h4>Accuracy by Team</h4>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Team</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${teamRows}</tbody>
                      </table>
                  </div>
              </div>
          </div>
      `;
  }

  private updateTeamFilter(): void {
      const select = this.container.querySelector<HTMLSelectElement>('#proj-team');
      if (!select) return;
      select.innerHTML = '<option value="all">All</option>' + 
          this.teamOptions.map(t => `<option value="${t}">${t}</option>`).join('');
      select.value = this.selectedTeam;
  }

  private filterAndRender(): void {
      if (this.selectedTeam === 'all') {
          this.stats = [...this.allStats];
      } else {
          // Filter by parent org name (resolves minor league teams to their MLB parent)
          this.stats = this.allStats.filter(p => this.getParentOrgName(p.teamId) === this.selectedTeam);
      }
      this.sortStats();
      this.renderTable();
  }

  /**
   * Get the parent org (MLB team) name for a team ID.
   * If the team is a minor league team, returns the parent team's nickname.
   * If the team is already an MLB team, returns its nickname.
   */
  private getParentOrgName(teamId: number): string | null {
    const team = this.teamLookup.get(teamId);
    if (!team) return null;

    // If this is a minor league team, get the parent org
    if (team.parentTeamId !== 0) {
      const parentTeam = this.teamLookup.get(team.parentTeamId);
      return parentTeam?.nickname ?? null;
    }

    // This is already an MLB team
    return team.nickname ?? null;
  }

  private sortStats(): void {
      const key = this.sortKey;
      const getVal = (obj: any, path: string) => path.split('.').reduce((o, k) => (o || {})[k], obj);

      this.stats.sort((a, b) => {
          let valA = getVal(a, key);
          let valB = getVal(b, key);

          if (typeof valA === 'string') valA = valA.toLowerCase();
          if (typeof valB === 'string') valB = valB.toLowerCase();

          if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
          if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
          return 0;
      });
  }

  private renderTable(): void {
      const container = this.container.querySelector('#projections-table-container');
      if (!container) return;

      if (this.stats.length === 0) {
          container.innerHTML = '<p class="no-stats">No projections found.</p>';
          this.updatePagination(0);
          return;
      }

      const start = (this.currentPage - 1) * this.itemsPerPage;
      const end = start + this.itemsPerPage;
      const pageData = this.stats.slice(start, end);

      // Populate lookup for modal access
      this.playerRowLookup = new Map(pageData.map(p => [p.playerId, p]));

      const headerHtml = this.columns.map(col => {
          const sortKey = String(col.sortKey ?? col.key);
          const isActive = this.sortKey === sortKey;
          return `<th data-key="${col.key}" data-sort="${sortKey}" class="${isActive ? 'sort-active' : ''}" draggable="true">${col.label}</th>`;
      }).join('');

      const rowsHtml = pageData.map(p => {
          const cells = this.columns.map(col => {
              const val = col.accessor ? col.accessor(p) : (p as any)[col.key];
              return `<td>${val ?? ''}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
      }).join('');

      container.innerHTML = `
        <div class="table-wrapper-outer">
            <div class="table-wrapper">
                <table class="stats-table true-ratings-table">
                    <thead><tr>${headerHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
        </div>
      `;

      this.updatePagination(this.stats.length);
      this.bindTableEvents();
  }

  private bindTableEvents(): void {
      // Player Names
      this.bindPlayerNameClicks();

      // Sorting
      this.container.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', (e) => {
              if (this.isDraggingColumn) return;
              const key = (th as HTMLElement).dataset.sort;
              if (!key) return;
              
              if (this.sortKey === key) {
                  this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
              } else {
                  this.sortKey = key;
                  this.sortDirection = 'asc'; // Default to asc for FIP usually, but let's stick to simple
                  // Actually FIP lower is better. Default asc is correct for "best".
              }
              this.showSortHint(e as MouseEvent);
              this.sortStats();
              this.renderTable();
          });
      });

      // Drag and Drop
      const headers = this.container.querySelectorAll<HTMLTableCellElement>('th[draggable="true"]');
      let draggedKey: string | null = null;

      headers.forEach(header => {
          header.addEventListener('dragstart', (e) => {
              draggedKey = header.dataset.key || null;
              this.isDraggingColumn = true;
              header.classList.add('dragging');
              if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', draggedKey || '');
              }
          });

          header.addEventListener('dragover', (e) => {
              e.preventDefault();
              if (!draggedKey) return;
              const targetKey = header.dataset.key;
              if (targetKey === draggedKey) return;
              
              // Visual indicator logic (simplified)
              header.style.borderLeft = '2px solid var(--color-primary)';
          });

          header.addEventListener('dragleave', () => {
              header.style.borderLeft = '';
          });

          header.addEventListener('drop', (e) => {
              e.preventDefault();
              header.style.borderLeft = '';
              const targetKey = header.dataset.key;
              
              if (draggedKey && targetKey && draggedKey !== targetKey) {
                  this.reorderColumns(draggedKey, targetKey);
              }
              draggedKey = null;
          });

          header.addEventListener('dragend', () => {
              header.classList.remove('dragging');
              this.isDraggingColumn = false;
              headers.forEach(h => h.style.borderLeft = '');
          });
      });
  }

  private reorderColumns(fromKey: string, toKey: string): void {
      const fromIdx = this.columns.findIndex(c => c.key === fromKey);
      const toIdx = this.columns.findIndex(c => c.key === toKey);
      
      if (fromIdx > -1 && toIdx > -1) {
          const item = this.columns.splice(fromIdx, 1)[0];
          this.columns.splice(toIdx, 0, item);
          this.saveColumnPrefs();
          this.renderTable();
      }
  }

  private renderPlayerName(player: ProjectedPlayer): string {
    return `<button class="btn-link player-name-link" data-player-id="${player.playerId}">${player.name}</button>`;
  }

  private renderRatingBadge(player: ProjectedPlayer): string {
    const value = player.currentTrueRating;
    let className = 'rating-poor';
    if (value >= 4.5) className = 'rating-elite';
    else if (value >= 4.0) className = 'rating-plus';
    else if (value >= 3.0) className = 'rating-avg';
    else if (value >= 2.0) className = 'rating-fringe';

    return `<span class="badge ${className}" title="Current True Rating">${value.toFixed(1)}</span>`;
  }

  private renderGrade(player: ProjectedPlayerWithActuals): string {
      if (!player.actualStats) return '<span class="grade-na" title="No actual stats found">—</span>';
      
      const grade = player.actualStats.grade;
      let className = 'grade-poor'; // Default/F
      if (grade === 'A') className = 'grade-elite';
      else if (grade === 'B') className = 'grade-plus';
      else if (grade === 'C') className = 'grade-avg';
      else if (grade === 'D') className = 'grade-fringe';
      
      // Use existing rating classes for colors (Elite=Blue/Green, Plus=Green, Avg=Yellow, Fringe=Orange, Poor=Red)
      return `<span class="badge ${className}" style="min-width: 24px;">${grade}</span>`;
  }

  private renderAge(player: ProjectedPlayer): string {
    return player.age.toString();
  }

  private bindPlayerNameClicks(): void {
    const links = this.container.querySelectorAll<HTMLButtonElement>('.player-name-link');
    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = parseInt(link.dataset.playerId ?? '', 10);
        if (!playerId) return;
        this.openPlayerProfile(playerId);
      });
    });
  }

  private async openPlayerProfile(playerId: number): Promise<void> {
    const row = this.playerRowLookup.get(playerId);
    if (!row) return;

    // Fetch full player info for team labels
    const player = await playerService.getPlayerById(playerId);
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

    // Get scouting
    const scoutingRatings = scoutingDataService.getLatestScoutingRatings('my');
    const scouting = scoutingRatings.find(s => s.playerId === playerId);

    // Extract pitch names and ratings if available
    const pitches = scouting?.pitches ? Object.keys(scouting.pitches) : [];
    const pitchRatings = scouting?.pitches ?? {};
    const usablePitchCount = scouting?.pitches ? Object.values(scouting.pitches).filter(rating => rating >= 45).length : 0;

    // Determine if we should show the year label (only for historical data)
    // The year shown is the base year for the projection (statsYearUsed or selectedYear - 1)
    const baseYear = this.statsYearUsed ?? this.selectedYear - 1;
    const currentYear = await dateService.getCurrentYear();
    const isHistorical = baseYear < currentYear - 1;

    const profileData: PlayerProfileData = {
      playerId: row.playerId,
      playerName: row.name,
      team: teamLabel,
      parentTeam: parentLabel,
      position: row.isSp ? 'SP' : 'RP',
      trueRating: row.currentTrueRating,
      percentile: row.currentPercentile,
      estimatedStuff: row.projectedRatings.stuff,
      estimatedControl: row.projectedRatings.control,
      estimatedHra: row.projectedRatings.hra,
      scoutStuff: scouting?.stuff,
      scoutControl: scouting?.control,
      scoutHra: scouting?.hra,
      scoutStamina: scouting?.stamina,
      scoutInjuryProneness: scouting?.injuryProneness,
      scoutOvr: scouting?.ovr,
      scoutPot: scouting?.pot,
      pitchCount: usablePitchCount,
      pitches,
      pitchRatings,
      isProspect: row.isProspect,
      year: this.selectedYear,
      projectionYear: this.selectedYear,
      projectionBaseYear: this.statsYearUsed ?? this.selectedYear - 1,
      showYearLabel: isHistorical
    };

    await this.playerProfileModal.show(profileData, this.statsYearUsed ?? this.selectedYear - 1);
  }

  private updatePagination(total: number): void {
      const info = this.container.querySelector('#page-info');
      const prev = this.container.querySelector<HTMLButtonElement>('#prev-page');
      const next = this.container.querySelector<HTMLButtonElement>('#next-page');
      
      if (info) {
          const totalPages = Math.ceil(total / this.itemsPerPage);
          info.textContent = total > 0 ? `Page ${this.currentPage} of ${totalPages}` : '';
      }
      
      if (prev) prev.disabled = this.currentPage <= 1;
      if (next) next.disabled = this.currentPage >= Math.ceil(total / this.itemsPerPage);
  }

  private loadColumnPrefs(defaults: ColumnConfig[]): ColumnConfig[] {
      try {
          const saved = localStorage.getItem(this.prefKey);
          if (saved) {
              const keys = JSON.parse(saved) as string[];
              // Reconstruct order based on keys, filtering out any that no longer exist
              const ordered: ColumnConfig[] = [];
              keys.forEach(k => {
                  const found = defaults.find(c => c.key === k);
                  if (found) ordered.push(found);
              });
              // Add any new columns that weren't in prefs
              defaults.forEach(d => {
                  if (!ordered.find(o => o.key === d.key)) ordered.push(d);
              });
              return ordered;
          }
      } catch {}
      return defaults;
  }

  private saveColumnPrefs(): void {
      try {
          const keys = this.columns.map(c => c.key);
          localStorage.setItem(this.prefKey, JSON.stringify(keys));
      } catch {}
  }

  private showSortHint(event: MouseEvent): void {
    const arrow = document.createElement('div');
    arrow.className = 'sort-fade-hint';
    arrow.textContent = this.sortDirection === 'asc' ? '⬆️' : '⬇️';
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

  private async initializeFromGameDate(): Promise<void> {
    const dateStr = await dateService.getCurrentDateWithFallback();
    const parsed = this.parseGameDate(dateStr);

    if (parsed) {
      const { year, month } = parsed;
      this.selectedYear = year;
      // Offseason if Oct-Dec or Jan-Mar
      this.isOffseason = month >= 10 || month < 4;

      this.updateYearOptions(this.selectedYear);
      this.updateModeControls();
    }

    this.updateSubtitle();
    this.fetchData();
  }

  private parseGameDate(dateStr: string): { year: number; month: number } | null {
    const [yearStr, monthStr] = dateStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return null;
    }
    return { year, month };
  }

  private updateYearOptions(currentYear: number): void {
    const endYear = Math.max(2021, currentYear);
    const startYear = 2000;
    this.yearOptions = Array.from({ length: endYear - startYear + 1 }, (_, i) => endYear - i);
  }

  private updateModeControls(): void {
    const select = this.container.querySelector<HTMLSelectElement>('#proj-year');
    const teamSelect = this.container.querySelector<HTMLSelectElement>('#proj-team')?.parentElement;
    
    if (!select) return;

    const isAnalysis = this.viewMode === 'analysis';
    
    // Hide filters in analysis mode
    if (isAnalysis) {
        select.parentElement!.style.display = 'none';
        if (teamSelect) teamSelect.style.display = 'none';
    } else {
        if (teamSelect) teamSelect.style.display = '';
        
        const showYear = this.viewMode === 'backcasting';
        select.style.display = showYear ? '' : 'none';
        select.parentElement!.style.display = ''; // Ensure parent wrapper is visible

        if (showYear) {
            const actualCurrentYear = this.yearOptions.length > 0 ? this.yearOptions[0] : this.selectedYear;
            const backcastYears = this.yearOptions.filter(y => y < actualCurrentYear);
            const nextSelected = backcastYears.includes(this.selectedYear)
                ? this.selectedYear
                : (backcastYears[0] ?? this.selectedYear - 1);

            select.innerHTML = backcastYears
                .map(year => `<option value="${year}" ${year === nextSelected ? 'selected' : ''}>${year}</option>`)
                .join('');
            select.value = String(nextSelected);
            this.selectedYear = nextSelected;
        }
    }

    this.container.querySelectorAll<HTMLButtonElement>('[data-proj-mode]').forEach(btn => {
      const mode = btn.dataset.projMode as 'projections' | 'backcasting' | 'analysis' | undefined;
      const isActive = mode === this.viewMode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }



  private updateSubtitle(): void {
    const subtitle = this.container.querySelector<HTMLElement>('#projections-subtitle');
    if (!subtitle) return;

    const targetYear = this.viewMode === 'backcasting' ? this.selectedYear : (this.yearOptions[0] ?? this.selectedYear);
    const baseYear = this.statsYearUsed ?? (targetYear - 1);
    
    if (this.isOffseason) {
      subtitle.innerHTML = `Projections for the <strong>${targetYear}</strong> season based on ${baseYear} True Ratings and standard aging curves.`;
    } else {
      const fallbackNote = this.usedFallbackStats && baseYear !== (targetYear - 1)
        ? ` <span class="note-text">No ${targetYear - 1} stats yet&mdash;using ${baseYear} data.</span>`
        : '';
      subtitle.innerHTML = `Projections for the <strong>${targetYear}</strong> season based on ${baseYear} True Ratings and standard aging curves.${fallbackNote}`;
    }
  }
}
