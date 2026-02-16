import { projectionService, ProjectedPlayer } from '../services/ProjectionService';
import { batterProjectionService, ProjectedBatter } from '../services/BatterProjectionService';
import { dateService } from '../services/DateService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { pitcherProfileModal } from './PitcherProfileModal';
import type { PlayerProfileData } from './PlayerRatingsCard';
import { trueRatingsService } from '../services/TrueRatingsService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { leagueBattingAveragesService } from '../services/LeagueBattingAveragesService';
import { fipWarService } from '../services/FipWarService';
import { RatingEstimatorService } from '../services/RatingEstimatorService';
import { projectionAnalysisService, AggregateAnalysisReport } from '../services/ProjectionAnalysisService';
import { batterProjectionAnalysisService, BatterAggregateAnalysisReport } from '../services/BatterProjectionAnalysisService';

interface ProjectedPlayerWithActuals extends ProjectedPlayer {
  actualStats?: {
    fip: number;
    war: number;
    ip: number;
    diff: number;
    grade: string;
  };
}

interface ProjectedBatterWithActuals extends ProjectedBatter {
  actualStats?: {
    woba: number;
    avg: number;
    obp: number;
    slg: number;
    wrcPlus: number;
    war: number;
    pa: number;
    hr: number;
    hrPct: number;
    bbPct: number;
    kPct: number;
    wobaDiff: number;
    warDiff: number;
    grade: string;
  };
}

interface ColumnConfig {
  key: keyof ProjectedPlayerWithActuals | string;
  label: string;
  sortKey?: string;
  accessor?: (row: ProjectedPlayerWithActuals) => any;
}

interface BatterColumnConfig {
  key: string;
  label: string;
  sortKey?: string;
  accessor?: (row: ProjectedBatterWithActuals) => any;
}

export class ProjectionsView {
  private container: HTMLElement;
  private stats: ProjectedPlayerWithActuals[] = [];
  private allStats: ProjectedPlayerWithActuals[] = [];
  private currentPage = 1;
  private itemsPerPage = 50;
  private itemsPerPageSelection: '10' | '50' | '200' | 'all' = '50';
  private selectedYear = 2020;
  private selectedTeam = 'all';
  private selectedPosition = 'all-pitchers';
  private mode: 'pitchers' | 'batters' = 'pitchers';
  private teamOptions: string[] = [];
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i);
  private isOffseason = false;
  private statsYearUsed: number | null = null;
  private usedFallbackStats = false;
  private scoutingMetadata?: { fromMyScout: number; fromOSA: number };
  private viewMode: 'projections' | 'backcasting' | 'analysis' = 'projections';
  private sortKey: string = 'projectedStats.fip';
  private sortDirection: 'asc' | 'desc' = 'asc';
  private columns: ColumnConfig[] = [];
  private isDraggingColumn = false;
  private prefKey = 'wbl-projections-prefs';
  private batterPrefKey = 'wbl-batter-projections-prefs';
  private playerRowLookup: Map<number, ProjectedPlayerWithActuals> = new Map();
  private hasActualStats = false;
  private teamLookup: Map<number, any> = new Map();
  private analysisReport: AggregateAnalysisReport | null = null;
  private batterAnalysisReport: BatterAggregateAnalysisReport | null = null;
  private analysisStartYear = 2015; // Default to recent 5-6 years
  private analysisEndYear = 2020;
  private analysisMinIp = 20; // Default minimum IP filter
  private analysisMaxIp = 999; // Default maximum IP filter (effectively unlimited)
  private analysisUseIpFilter = true; // Default to filtering enabled
  private analysisPlayerType: 'pitchers' | 'batters' = 'pitchers'; // Toggle between pitcher/batter analysis
  private analysisMinPa = 200; // Default minimum PA filter for batters
  private analysisMaxPa = 999; // Default maximum PA filter for batters
  private analysisUsePaFilter = true; // Default to filtering enabled for batters

  // Batter-specific properties
  private batterStats: ProjectedBatterWithActuals[] = [];
  private allBatterStats: ProjectedBatterWithActuals[] = [];
  private batterColumns: BatterColumnConfig[] = [];
  private batterRowLookup: Map<number, ProjectedBatterWithActuals> = new Map();
  private hasBatterActualStats = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.initColumns();
    this.renderLayout();
    this.initializeFromGameDate();
  }

  private initColumns(): void {
    const defaults: ColumnConfig[] = [
        { key: 'position', label: 'Pos', sortKey: 'position', accessor: p => this.renderPositionLabel(p) },
        { key: 'name', label: 'Name', accessor: p => this.renderPlayerName(p) },
        { key: 'teamName', label: 'Team' },
        { key: 'age', label: 'Age', accessor: p => this.renderAge(p) },
        { key: 'currentTrueRating', label: 'Current TR', sortKey: 'currentTrueRating', accessor: p => this.renderRatingBadge(p) },
        { key: 'projK9', label: 'Proj K/9', sortKey: 'projectedStats.k9', accessor: p => {
            const estStuff = RatingEstimatorService.estimateStuff(p.projectedStats.k9, p.projectedStats.ip).rating;
            return this.renderFlipCell(p.projectedStats.k9.toFixed(2), estStuff.toString(), 'Est Stuff Rating');
        }},
        { key: 'projBB9', label: 'Proj BB/9', sortKey: 'projectedStats.bb9', accessor: p => {
            const estControl = RatingEstimatorService.estimateControl(p.projectedStats.bb9, p.projectedStats.ip).rating;
            return this.renderFlipCell(p.projectedStats.bb9.toFixed(2), estControl.toString(), 'Est Control Rating');
        }},
        { key: 'projHR9', label: 'Proj HR/9', sortKey: 'projectedStats.hr9', accessor: p => {
            const estHra = RatingEstimatorService.estimateHRA(p.projectedStats.hr9, p.projectedStats.ip).rating;
            return this.renderFlipCell(p.projectedStats.hr9.toFixed(2), estHra.toString(), 'Est HRA Rating');
        }},
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

    // Initialize batter columns with interspersed actuals when in backcasting mode
    const batterDefaults: BatterColumnConfig[] = [
      { key: 'position', label: 'Pos', sortKey: 'position', accessor: b => this.renderBatterPositionBadge(b.position) },
      { key: 'name', label: 'Name', accessor: b => this.renderBatterName(b) },
      { key: 'teamName', label: 'Team' },
      { key: 'age', label: 'Age' },
      { key: 'currentTrueRating', label: 'TR', sortKey: 'currentTrueRating', accessor: b => this.renderBatterRatingBadge(b.currentTrueRating) },
      { key: 'projWoba', label: 'Proj wOBA', sortKey: 'projectedStats.woba', accessor: b => b.projectedStats.woba.toFixed(3) },
    ];

    // Intersperse actual stats if we have them
    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actWoba', label: 'Act wOBA', sortKey: 'actualStats.woba', accessor: b => b.actualStats ? b.actualStats.woba.toFixed(3) : '' },
        { key: 'wobaDiff', label: 'wOBA Diff', sortKey: 'actualStats.wobaDiff', accessor: b => b.actualStats ? (b.actualStats.wobaDiff > 0 ? `+${b.actualStats.wobaDiff.toFixed(3)}` : b.actualStats.wobaDiff.toFixed(3)) : '' }
      );
    }

    batterDefaults.push(
      { key: 'projWAR', label: 'Proj WAR', sortKey: 'projectedStats.war', accessor: b => b.projectedStats.war.toFixed(1) }
    );

    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actWAR', label: 'Act WAR', sortKey: 'actualStats.war', accessor: b => b.actualStats ? b.actualStats.war.toFixed(1) : '' },
        { key: 'warDiff', label: 'WAR Diff', sortKey: 'actualStats.warDiff', accessor: b => b.actualStats ? (b.actualStats.warDiff > 0 ? `+${b.actualStats.warDiff.toFixed(1)}` : b.actualStats.warDiff.toFixed(1)) : '' }
      );
    }

    batterDefaults.push(
      { key: 'projWrcPlus', label: 'Proj wRC+', sortKey: 'projectedStats.wrcPlus', accessor: b => b.projectedStats.wrcPlus.toString() }
    );

    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actWrcPlus', label: 'Act wRC+', sortKey: 'actualStats.wrcPlus', accessor: b => b.actualStats ? b.actualStats.wrcPlus.toString() : '' }
      );
    }

    batterDefaults.push(
      { key: 'projAvg', label: 'Proj AVG', sortKey: 'projectedStats.avg', accessor: b => {
        const avg = b.projectedStats.avg.toFixed(3);
        const estContact = b.estimatedRatings.contact;
        return this.renderFlipCell(avg, estContact.toString(), 'Est Contact Rating');
      }}
    );

    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actAvg', label: 'Act AVG', sortKey: 'actualStats.avg', accessor: b => b.actualStats ? b.actualStats.avg.toFixed(3) : '' }
      );
    }

    batterDefaults.push(
      { key: 'projHrPct', label: 'Proj HR%', sortKey: 'projectedStats.hrPct', accessor: b => {
        const hrPct = b.projectedStats.hrPct?.toFixed(1) ?? 'N/A';
        const estPower = b.estimatedRatings.power;
        return this.renderFlipCell(hrPct, estPower.toString(), 'Est Power Rating');
      }},
      { key: 'projHr', label: 'Proj HR', sortKey: 'projectedStats.hr', accessor: b => b.projectedStats.hr.toString() },
      { key: 'projSb', label: 'Proj SB', sortKey: 'projectedStats.sb', accessor: b => b.projectedStats.sb.toString() }
    );

    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actHrPct', label: 'Act HR%', sortKey: 'actualStats.hrPct', accessor: b => b.actualStats ? b.actualStats.hrPct.toFixed(1) : '' },
        { key: 'actHr', label: 'Act HR', sortKey: 'actualStats.hr', accessor: b => b.actualStats ? b.actualStats.hr.toString() : '' }
      );
    }

    batterDefaults.push(
      { key: 'bbPct', label: 'Proj BB%', sortKey: 'projectedStats.bbPct', accessor: b => {
        const bbPct = b.projectedStats.bbPct?.toFixed(1) ?? 'N/A';
        const estEye = b.estimatedRatings.eye;
        return this.renderFlipCell(bbPct, estEye.toString(), 'Est Eye (Plate Discipline) Rating');
      }}
    );

    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actBbPct', label: 'Act BB%', sortKey: 'actualStats.bbPct', accessor: b => b.actualStats ? b.actualStats.bbPct.toFixed(1) : '' }
      );
    }

    batterDefaults.push(
      { key: 'kPct', label: 'Proj K%', sortKey: 'projectedStats.kPct', accessor: b => {
        return b.projectedStats.kPct?.toFixed(1) ?? 'N/A';
      }}
    );

    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actKPct', label: 'Act K%', sortKey: 'actualStats.kPct', accessor: b => b.actualStats ? b.actualStats.kPct.toFixed(1) : '' }
      );
    }

    batterDefaults.push(
      { key: 'projObp', label: 'Proj OBP', sortKey: 'projectedStats.obp', accessor: b => b.projectedStats.obp.toFixed(3) },
      { key: 'projSlg', label: 'Proj SLG', sortKey: 'projectedStats.slg', accessor: b => b.projectedStats.slg.toFixed(3) },
      { key: 'projPa', label: 'Proj PA', sortKey: 'projectedStats.pa', accessor: b => b.projectedStats.pa.toString() }
    );

    if (this.hasBatterActualStats) {
      batterDefaults.push(
        { key: 'actObp', label: 'Act OBP', sortKey: 'actualStats.obp', accessor: b => b.actualStats ? b.actualStats.obp.toFixed(3) : '' },
        { key: 'actSlg', label: 'Act SLG', sortKey: 'actualStats.slg', accessor: b => b.actualStats ? b.actualStats.slg.toFixed(3) : '' },
        { key: 'actPa', label: 'Act PA', sortKey: 'actualStats.pa', accessor: b => b.actualStats ? b.actualStats.pa.toString() : '' },
        { key: 'grade', label: 'Grade', sortKey: 'actualStats.grade', accessor: b => this.renderBatterGrade(b) }
      );
    }

    this.batterColumns = this.loadBatterColumnPrefs(batterDefaults);
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Stat Projections</h2>
        <p class="section-subtitle" id="projections-subtitle"></p>
        
        <div class="true-ratings-controls">
          <div class="filter-bar" id="projections-filter-bar">
            <label>Filters:</label>
            <div class="filter-group" role="group" aria-label="Projection filters">
              <div class="filter-dropdown" data-filter="team">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Team: <span id="selected-team-display">All</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="team-dropdown-menu">
                  <div class="filter-dropdown-item selected" data-value="all">All</div>
                </div>
              </div>
              <div class="filter-dropdown position-filter" data-filter="position">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Position: <span id="selected-position-display">${this.getPositionDisplayName(this.selectedPosition)}</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="position-dropdown-menu">
                  ${this.renderPositionDropdownItems()}
                </div>
              </div>
              <div class="filter-dropdown" data-filter="year" id="proj-year-field" style="display: none;">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Year: <span id="selected-year-display">${this.selectedYear}</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="year-dropdown-menu"></div>
              </div>
              <button class="toggle-btn ${this.viewMode === 'projections' ? 'active' : ''}" data-proj-mode="projections" aria-pressed="${this.viewMode === 'projections'}">Projections</button>
              <button class="toggle-btn ${this.viewMode === 'backcasting' ? 'active' : ''}" data-proj-mode="backcasting" aria-pressed="${this.viewMode === 'backcasting'}">Backcasting</button>
              <button class="toggle-btn ${this.viewMode === 'analysis' ? 'active' : ''}" data-proj-mode="analysis" aria-pressed="${this.viewMode === 'analysis'}">Analysis</button>
            </div>
          </div>
        </div>

        <div class="scout-upload-notice" id="proj-scouting-notice" style="display: none; margin-bottom: 1rem;"></div>

        <div id="projections-table-container">
            ${this.renderTableLoadingState()}
        </div>
        
        <div class="pagination-controls">
          <button id="prev-page" disabled>Previous</button>
          <div id="page-info" class="page-info">
            <span class="page-label">Page</span>
            <select id="page-jump-select" class="page-current-select" aria-label="Page"></select>
            <span class="page-total" id="page-total"></span>
          </div>
          <button id="next-page" disabled>Next</button>
          <div class="items-per-page">
            <label for="items-per-page">Show:</label>
            <select id="items-per-page">
              <option value="10" ${this.itemsPerPageSelection === '10' ? 'selected' : ''}>10 per page</option>
              <option value="50" ${this.itemsPerPageSelection === '50' ? 'selected' : ''}>50 per page</option>
              <option value="200" ${this.itemsPerPageSelection === '200' ? 'selected' : ''}>200 per page</option>
              <option value="all" ${this.itemsPerPageSelection === 'all' ? 'selected' : ''}>All</option>
            </select>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
      // Handle filter dropdown button clicks
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

      // Handle Team dropdown item clicks
      this.bindTeamDropdownListeners();

      // Handle Position dropdown item clicks
      this.bindPositionDropdownListeners();

      // Year listener will be bound in updateModeControls when items are rendered

      this.container.querySelector('#items-per-page')?.addEventListener('change', (e) => {
          const value = (e.target as HTMLSelectElement).value as '10' | '50' | '200' | 'all';
          this.itemsPerPageSelection = value;
          const currentStatsLength = this.mode === 'batters' ? this.batterStats.length : this.stats.length;
          this.itemsPerPage = value === 'all' ? currentStatsLength : parseInt(value, 10);
          this.currentPage = 1;
          if (this.mode === 'batters') {
              this.renderBatterTable();
          } else {
              this.renderTable();
          }
      });

      this.container.querySelector('#page-jump-select')?.addEventListener('change', (e) => {
          const nextPage = parseInt((e.target as HTMLSelectElement).value, 10);
          if (!Number.isNaN(nextPage) && nextPage !== this.currentPage) {
              this.currentPage = nextPage;
              if (this.mode === 'batters') {
                  this.renderBatterTable();
              } else {
                  this.renderTable();
              }
          }
      });

      this.container.querySelector('#prev-page')?.addEventListener('click', () => {
          if (this.currentPage > 1) {
              this.currentPage--;
              if (this.mode === 'batters') {
                  this.renderBatterTable();
              } else {
                  this.renderTable();
              }
          }
      });

      this.container.querySelector('#next-page')?.addEventListener('click', () => {
          const currentStatsLength = this.mode === 'batters' ? this.batterStats.length : this.stats.length;
          const totalPages = Math.ceil(currentStatsLength / this.itemsPerPage);
          if (this.currentPage < totalPages) {
              this.currentPage++;
              if (this.mode === 'batters') {
                  this.renderBatterTable();
              } else {
                  this.renderTable();
              }
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
                  this.showLoadingState();
                  this.fetchData();
              }
          });
      });
  }

  private showLoadingState(): void {
      const container = this.container.querySelector('#projections-table-container');
      if (container) container.innerHTML = this.renderTableLoadingState();
  }

  private renderTableLoadingState(): string {
      const columnCount = Math.max(this.columns.length, 6);
      const rowCount = 10;
      const headerCells = this.renderSkeletonCells('th', columnCount);
      const bodyRows = this.renderSkeletonRows(columnCount, rowCount);

      return `
        <div class="table-wrapper-outer loading-skeleton">
            <button class="scroll-btn scroll-btn-left" aria-hidden="true" tabindex="-1" disabled></button>
            <div class="table-wrapper">
                <table class="stats-table true-ratings-table skeleton-table">
                    <thead><tr>${headerCells}</tr></thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>
            <button class="scroll-btn scroll-btn-right" aria-hidden="true" tabindex="-1" disabled></button>
        </div>
      `;
  }

  private renderSkeletonCells(tag: 'th' | 'td', count: number): string {
      return Array.from({ length: count }, () => `<${tag}><span class="skeleton-line xs"></span></${tag}>`).join('');
  }

  private renderSkeletonRows(columnCount: number, rowCount: number): string {
      const cells = this.renderSkeletonCells('td', columnCount);
      return Array.from({ length: rowCount }, () => `<tr>${cells}</tr>`).join('');
  }

  private async fetchData(): Promise<void> {
      const container = this.container.querySelector('#projections-table-container');
      if (container) container.innerHTML = this.renderTableLoadingState();

      try {
          const currentYear = await dateService.getCurrentYear();
          const targetYear = this.viewMode === 'backcasting' ? this.selectedYear : currentYear;
          const statsBaseYear = targetYear - 1;

          // Handle batter projections separately
          if (this.mode === 'batters') {
              await this.fetchBatterData(statsBaseYear);
              return;
          }

          // Use previous year as base for projections
          const context = await projectionService.getProjectionsWithContext(statsBaseYear, { forceRosterRefresh: false });
          let allPlayers = context.projections;
          this.statsYearUsed = context.statsYear;
          this.usedFallbackStats = context.usedFallbackStats;
          this.scoutingMetadata = context.scoutingMetadata;

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

  private async fetchBatterData(statsBaseYear: number): Promise<void> {
      const container = this.container.querySelector('#projections-table-container');

      try {
          const currentYear = await dateService.getCurrentYear();
          const targetYear = this.viewMode === 'backcasting' ? this.selectedYear : currentYear;

          const context = await batterProjectionService.getProjectionsWithContext(statsBaseYear);
          let combinedBatters: ProjectedBatterWithActuals[] = [...context.projections];
          this.statsYearUsed = context.statsYear;
          this.usedFallbackStats = context.usedFallbackStats;
          this.scoutingMetadata = context.scoutingMetadata;

          // Backcasting: If target year (selectedYear) has happened, compare projections to actuals
          if (targetYear < currentYear) {
              try {
                  const [actuals, leagueAvg] = await Promise.all([
                      trueRatingsService.getTrueBattingStats(targetYear),
                      leagueBattingAveragesService.getLeagueAverages(targetYear)
                  ]);

                  const actualsMap = new Map(actuals.map(a => [a.player_id, a]));

                  combinedBatters.forEach(b => {
                      const act = actualsMap.get(b.playerId);
                      if (act && act.pa >= 50) {  // Only grade if they had meaningful PAs
                          // Calculate actual rate stats
                          const actualAvg = act.avg;
                          const actualObp = act.obp;
                          const actualSlg = (act.h + act.d + 2*act.t + 3*act.hr) / act.ab;
                          const actualBbPct = (act.bb / act.pa) * 100;
                          const actualKPct = (act.k / act.pa) * 100;
                          const actualHrPct = (act.hr / act.pa) * 100;

                          // Calculate actual wOBA
                          const singles = act.h - act.d - act.t - act.hr;
                          const actualWoba = (
                              0.69 * act.bb +
                              0.89 * singles +
                              1.27 * act.d +
                              1.62 * act.t +
                              2.10 * act.hr
                          ) / (act.ab + act.bb + act.hp + act.sf);

                          // Calculate wRC+ and WAR (simplified)
                          const lgWoba = leagueAvg?.lgWoba ?? 0.320;
                          const wobaScale = 1.15;
                          const lgRpa = leagueAvg?.lgRpa ?? 0.12;
                          const wRaaPerPa = (actualWoba - lgWoba) / wobaScale;
                          const actualWrcPlus = Math.round(((wRaaPerPa + lgRpa) / lgRpa) * 100);

                          // Calculate actual WAR
                          const wRAA = wRaaPerPa * act.pa;
                          const replacementRuns = (act.pa / 600) * 20;
                          const actualWar = (wRAA + replacementRuns) / 10;

                          // Calculate differences
                          const wobaDiff = actualWoba - b.projectedStats.woba;
                          const warDiff = actualWar - b.projectedStats.war;

                          // Grade based on wOBA accuracy
                          let grade = 'F';
                          const absDiff = Math.abs(wobaDiff);
                          if (absDiff < 0.020) grade = 'A';       // Within .020 wOBA
                          else if (absDiff < 0.040) grade = 'B';  // Within .040 wOBA
                          else if (absDiff < 0.060) grade = 'C';  // Within .060 wOBA
                          else if (absDiff < 0.080) grade = 'D';  // Within .080 wOBA

                          b.actualStats = {
                              woba: actualWoba,
                              avg: actualAvg,
                              obp: actualObp,
                              slg: actualSlg,
                              wrcPlus: actualWrcPlus,
                              war: actualWar,
                              pa: act.pa,
                              hr: act.hr,
                              hrPct: actualHrPct,
                              bbPct: actualBbPct,
                              kPct: actualKPct,
                              wobaDiff,
                              warDiff,
                              grade
                          };
                      }
                  });
              } catch (e) {
                  console.warn('Batter backcasting data unavailable', e);
              }
          }

          this.allBatterStats = combinedBatters;

          // Check if we have actual stats
          this.hasBatterActualStats = this.allBatterStats.some(b => b.actualStats !== undefined);

          // Rebuild columns based on whether we have actual stats
          this.initColumns();

          // Populate team filter
          const allTeams = await teamService.getAllTeams();
          this.teamLookup = new Map(allTeams.map(t => [t.id, t]));

          const mlbTeamNames = new Set<string>();
          for (const batter of this.allBatterStats) {
              const parentOrgName = this.getParentOrgName(batter.teamId);
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
          if (container) container.innerHTML = `<div class="error-message">Error loading batter projections: ${err}</div>`;
      }
  }

  private renderAnalysisLanding(): void {
      const container = this.container.querySelector('#projections-table-container');
      const subtitle = this.container.querySelector<HTMLElement>('#projections-subtitle');
      if (subtitle) subtitle.textContent = 'Aggregate analysis of projection accuracy across all years.';

      // Hide pagination controls in analysis mode
      this.updatePagination(0);

      if (!container) return;

      // Generate year options (2000-2020)
      const yearOptions = Array.from({ length: 21 }, (_, i) => 2000 + i).reverse();

      const isPitchers = this.analysisPlayerType === 'pitchers';

      container.innerHTML = `
        <div class="analysis-landing" style="text-align: center; padding: 40px;">
            <h3>Projection Accuracy Analysis</h3>
            <p style="max-width: 600px; margin: 0 auto 20px; color: var(--color-text-secondary);">
                This report will iterate through the selected year range, run the projection algorithm for each year based on prior data,
                and compare it against the actual results.
            </p>

            <!-- Player Type Toggle -->
            <div class="view-toggle-container" style="margin-bottom: 20px;">
                <div class="view-toggle">
                    <button class="toggle-btn ${isPitchers ? 'active' : ''}" data-analysis-type="pitchers" aria-pressed="${isPitchers}">Pitchers</button>
                    <button class="toggle-btn ${!isPitchers ? 'active' : ''}" data-analysis-type="batters" aria-pressed="${!isPitchers}">Batters</button>
                </div>
            </div>

            <div style="display: flex; gap: 20px; justify-content: center; align-items: center; margin-bottom: 20px;">
                <div class="form-field">
                    <label for="analysis-start-year">Start Year:</label>
                    <select id="analysis-start-year">
                        ${yearOptions.map(y => `<option value="${y}" ${y === this.analysisStartYear ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>
                </div>
                <div class="form-field">
                    <label for="analysis-end-year">End Year:</label>
                    <select id="analysis-end-year">
                        ${yearOptions.map(y => `<option value="${y}" ${y === this.analysisEndYear ? 'selected' : ''}>${y}</option>`).join('')}
                    </select>
                </div>
            </div>

            <!-- Pitcher IP Filter -->
            <div id="pitcher-filter-section" style="display: ${isPitchers ? 'block' : 'none'};">
                <div style="display: flex; gap: 15px; justify-content: center; align-items: center; margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="analysis-use-ip-filter" ${this.analysisUseIpFilter ? 'checked' : ''}>
                        <span>Filter IP range:</span>
                    </label>
                    <input
                        type="number"
                        id="analysis-min-ip"
                        min="0"
                        max="300"
                        value="${this.analysisMinIp}"
                        style="width: 60px; padding: 4px 8px; text-align: center;"
                        ${!this.analysisUseIpFilter ? 'disabled' : ''}
                        placeholder="Min"
                    >
                    <span>to</span>
                    <input
                        type="number"
                        id="analysis-max-ip"
                        min="0"
                        max="300"
                        value="${this.analysisMaxIp}"
                        style="width: 60px; padding: 4px 8px; text-align: center;"
                        ${!this.analysisUseIpFilter ? 'disabled' : ''}
                        placeholder="Max"
                    >
                    <span>IP</span>
                </div>
                <p style="margin-bottom: 10px; color: var(--color-text-secondary); font-size: 0.85em; text-align: center;">
                    Examples: 75-999 (established pitchers), 20-75 (small samples/relievers), 0-999 (all pitchers)
                </p>
            </div>

            <!-- Batter PA Filter -->
            <div id="batter-filter-section" style="display: ${!isPitchers ? 'block' : 'none'};">
                <div style="display: flex; gap: 15px; justify-content: center; align-items: center; margin-bottom: 20px;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                        <input type="checkbox" id="analysis-use-pa-filter" ${this.analysisUsePaFilter ? 'checked' : ''}>
                        <span>Filter PA range:</span>
                    </label>
                    <input
                        type="number"
                        id="analysis-min-pa"
                        min="0"
                        max="700"
                        value="${this.analysisMinPa}"
                        style="width: 60px; padding: 4px 8px; text-align: center;"
                        ${!this.analysisUsePaFilter ? 'disabled' : ''}
                        placeholder="Min"
                    >
                    <span>to</span>
                    <input
                        type="number"
                        id="analysis-max-pa"
                        min="0"
                        max="700"
                        value="${this.analysisMaxPa}"
                        style="width: 60px; padding: 4px 8px; text-align: center;"
                        ${!this.analysisUsePaFilter ? 'disabled' : ''}
                        placeholder="Max"
                    >
                    <span>PA</span>
                </div>
                <p style="margin-bottom: 10px; color: var(--color-text-secondary); font-size: 0.85em; text-align: center;">
                    Examples: 400-999 (regulars), 200-400 (part-time), 100-999 (all qualified batters)
                </p>
            </div>

            <p style="margin-bottom: 20px; color: var(--color-text-secondary); font-size: 0.9em;">
                <strong>Recommended:</strong> Use recent 5-6 years (2015-2020) for most accurate results.<br>
                OOTP version changes may affect older data.
            </p>

            <button id="run-analysis-btn" class="btn btn-primary">Run Analysis Report</button>
            <div id="analysis-progress" style="margin-top: 20px; display: none;">
                <div class="loading-message loading-skeleton">
                    <span class="skeleton-line md"></span>
                    <span class="loading-text">Analyzing Year <span id="analysis-year-indicator">...</span></span>
                </div>
            </div>
        </div>
      `;

      // Add event listeners for player type toggle
      container.querySelectorAll('[data-analysis-type]').forEach(btn => {
          btn.addEventListener('click', () => {
              const type = (btn as HTMLElement).dataset.analysisType as 'pitchers' | 'batters';
              if (type && type !== this.analysisPlayerType) {
                  this.analysisPlayerType = type;
                  this.renderAnalysisLanding(); // Re-render to update UI
              }
          });
      });

      // Add event listeners for year selectors
      container.querySelector('#analysis-start-year')?.addEventListener('change', (e) => {
          this.analysisStartYear = parseInt((e.target as HTMLSelectElement).value);
      });
      container.querySelector('#analysis-end-year')?.addEventListener('change', (e) => {
          this.analysisEndYear = parseInt((e.target as HTMLSelectElement).value);
      });

      // Add event listeners for IP filter (pitchers)
      const ipFilterCheckbox = container.querySelector<HTMLInputElement>('#analysis-use-ip-filter');
      const ipFilterMinInput = container.querySelector<HTMLInputElement>('#analysis-min-ip');
      const ipFilterMaxInput = container.querySelector<HTMLInputElement>('#analysis-max-ip');

      ipFilterCheckbox?.addEventListener('change', (e) => {
          this.analysisUseIpFilter = (e.target as HTMLInputElement).checked;
          if (ipFilterMinInput) ipFilterMinInput.disabled = !this.analysisUseIpFilter;
          if (ipFilterMaxInput) ipFilterMaxInput.disabled = !this.analysisUseIpFilter;
      });

      ipFilterMinInput?.addEventListener('change', (e) => {
          const value = parseInt((e.target as HTMLInputElement).value);
          if (!isNaN(value) && value >= 0) {
              this.analysisMinIp = value;
          }
      });

      ipFilterMaxInput?.addEventListener('change', (e) => {
          const value = parseInt((e.target as HTMLInputElement).value);
          if (!isNaN(value) && value >= 0) {
              this.analysisMaxIp = value;
          }
      });

      // Add event listeners for PA filter (batters)
      const paFilterCheckbox = container.querySelector<HTMLInputElement>('#analysis-use-pa-filter');
      const paFilterMinInput = container.querySelector<HTMLInputElement>('#analysis-min-pa');
      const paFilterMaxInput = container.querySelector<HTMLInputElement>('#analysis-max-pa');

      paFilterCheckbox?.addEventListener('change', (e) => {
          this.analysisUsePaFilter = (e.target as HTMLInputElement).checked;
          if (paFilterMinInput) paFilterMinInput.disabled = !this.analysisUsePaFilter;
          if (paFilterMaxInput) paFilterMaxInput.disabled = !this.analysisUsePaFilter;
      });

      paFilterMinInput?.addEventListener('change', (e) => {
          const value = parseInt((e.target as HTMLInputElement).value);
          if (!isNaN(value) && value >= 0) {
              this.analysisMinPa = value;
          }
      });

      paFilterMaxInput?.addEventListener('change', (e) => {
          const value = parseInt((e.target as HTMLInputElement).value);
          if (!isNaN(value) && value >= 0) {
              this.analysisMaxPa = value;
          }
      });

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
          const maxEndYear = currentYear - 1; // Can only analyze up to last completed season

          // Validate year range
          if (this.analysisStartYear > this.analysisEndYear) {
              throw new Error('Start year must be before end year');
          }
          if (this.analysisEndYear > maxEndYear) {
              throw new Error(`End year cannot exceed ${maxEndYear} (last completed season)`);
          }

          if (this.analysisPlayerType === 'batters') {
              // Run batter analysis
              const minPa = this.analysisUsePaFilter ? this.analysisMinPa : 0;
              const maxPa = this.analysisUsePaFilter ? this.analysisMaxPa : 999;

              this.batterAnalysisReport = await batterProjectionAnalysisService.runAnalysis(
                  this.analysisStartYear,
                  this.analysisEndYear,
                  (year) => {
                      if (indicator) indicator.textContent = year.toString();
                  },
                  minPa,
                  maxPa
              );

              this.renderBatterAnalysisResults();
          } else {
              // Run pitcher analysis
              const minIp = this.analysisUseIpFilter ? this.analysisMinIp : 0;
              const maxIp = this.analysisUseIpFilter ? this.analysisMaxIp : 999;

              this.analysisReport = await projectionAnalysisService.runAnalysis(
                  this.analysisStartYear,
                  this.analysisEndYear,
                  (year) => {
                      if (indicator) indicator.textContent = year.toString();
                  },
                  minIp,
                  maxIp
              );

              this.renderAnalysisResults();
          }
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

      // Hide pagination controls in analysis mode
      this.updatePagination(0);

      const { overallMetrics, years, metricsByTeam, metricsByAge, metricsByRole, metricsByQuartile, top10Comparison } = this.analysisReport;

      const getBiasClass = (bias: number) => {
          if (Math.abs(bias) < 0.10) return 'text-success'; 
          if (Math.abs(bias) < 0.25) return 'text-warning'; 
          return 'text-danger'; 
      };

      const getMaeClass = (mae: number) => {
          if (mae < 0.60) return 'text-success';
          if (mae < 0.70) return 'text-warning';
          return 'text-danger';
      };

      const renderMetricsCard = (m: any) => `
          <div class="metric-box">
              <span class="metric-label">MAE</span>
              <span class="metric-value ${getMaeClass(m.mae)}">${m.mae.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">RMSE</span>
              <span class="metric-value">${m.rmse.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">Bias</span>
              <span class="metric-value ${getBiasClass(m.bias)}">${m.bias > 0 ? '+' : ''}${m.bias.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">N</span>
              <span class="metric-value">${m.count}</span>
          </div>
      `;

      // Helper to render a full stat row
      const renderStatRow = (label: string, metrics: any) => `
          <tr>
              <td><strong>${label}</strong></td>
              <td class="${getMaeClass(metrics.mae)}">${metrics.mae.toFixed(3)}</td>
              <td>${metrics.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(metrics.bias)}">${metrics.bias > 0 ? '+' : ''}${metrics.bias.toFixed(3)}</td>
              <td>${metrics.count}</td>
          </tr>
      `;

      // Year Table (FIP only for brevity)
      const yearRows = years.map(y => `
          <tr>
              <td>${y.year}</td>
              <td class="${getMaeClass(y.metrics.fip.mae)}">${y.metrics.fip.mae.toFixed(3)}</td>
              <td>${y.metrics.fip.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(y.metrics.fip.bias)}">${y.metrics.fip.bias > 0 ? '+' : ''}${y.metrics.fip.bias.toFixed(3)}</td>
              <td>${y.metrics.fip.count}</td>
          </tr>
      `).join('');

      // Team Table (FIP only)
      const sortedTeams = Array.from(metricsByTeam.entries()).sort((a, b) => a[1].fip.mae - b[1].fip.mae);
      const teamRows = sortedTeams.map(([team, m]) => `
          <tr>
              <td>${team}</td>
              <td class="${getMaeClass(m.fip.mae)}">${m.fip.mae.toFixed(3)}</td>
              <td>${m.fip.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.fip.bias)}">${m.fip.bias > 0 ? '+' : ''}${m.fip.bias.toFixed(3)}</td>
              <td>${m.fip.count}</td>
          </tr>
      `).join('');

      // Age Table (FIP only)
      const sortedAges = Array.from(metricsByAge.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const ageRows = sortedAges.map(([age, m]) => `
          <tr>
              <td>${age}</td>
              <td class="${getMaeClass(m.fip.mae)}">${m.fip.mae.toFixed(3)}</td>
              <td>${m.fip.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.fip.bias)}">${m.fip.bias > 0 ? '+' : ''}${m.fip.bias.toFixed(3)}</td>
              <td>${m.fip.count}</td>
          </tr>
      `).join('');

      // Role Table (FIP only) - SP vs RP vs Swingman
      const roleOrder = ['SP', 'Swingman', 'RP']; // Custom sort order
      const sortedRoles = Array.from(metricsByRole.entries()).sort((a, b) => {
          const aIndex = roleOrder.indexOf(a[0]);
          const bIndex = roleOrder.indexOf(b[0]);
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
      const roleRows = sortedRoles.map(([role, m]) => `
          <tr>
              <td>${role}</td>
              <td class="${getMaeClass(m.fip.mae)}">${m.fip.mae.toFixed(3)}</td>
              <td>${m.fip.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.fip.bias)}">${m.fip.bias > 0 ? '+' : ''}${m.fip.bias.toFixed(3)}</td>
              <td>${m.fip.count}</td>
          </tr>
      `).join('');

      // Quartile Table (FIP only) - Grouped by actual FIP performance
      const quartileOrder = ['Q1 (Elite)', 'Q2 (Good)', 'Q3 (Average)', 'Q4 (Below Avg)'];
      const sortedQuartiles = Array.from(metricsByQuartile.entries()).sort((a, b) => {
          const aPrefix = a[0].split(' ')[0]; // Extract "Q1", "Q2", etc.
          const bPrefix = b[0].split(' ')[0];
          const aIndex = quartileOrder.findIndex(q => q.startsWith(aPrefix));
          const bIndex = quartileOrder.findIndex(q => q.startsWith(bPrefix));
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
      const quartileRows = sortedQuartiles.map(([quartile, m]) => `
          <tr>
              <td>${quartile}</td>
              <td class="${getMaeClass(m.fip.mae)}">${m.fip.mae.toFixed(3)}</td>
              <td>${m.fip.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.fip.bias)}">${m.fip.bias > 0 ? '+' : ''}${m.fip.bias.toFixed(3)}</td>
              <td>${m.fip.count}</td>
          </tr>
      `).join('');

      // Stat Breakdown Table
      const statRows = [
          renderStatRow('FIP', overallMetrics.fip),
          renderStatRow('K/9', overallMetrics.k9),
          renderStatRow('BB/9', overallMetrics.bb9),
          renderStatRow('HR/9', overallMetrics.hr9),
      ].join('');

      // Top 10 WAR Comparison Table
      const top10Rows = top10Comparison.map((t, idx) => {
          const warErrorClass = Math.abs(t.error) > 1.0 ? 'text-danger' : (Math.abs(t.error) > 0.5 ? 'text-warning' : 'text-success');
          return `
              <tr>
                  <td>${idx + 1}</td>
                  <td>${t.playerName}</td>
                  <td>${t.projectedWar.toFixed(1)}</td>
                  <td>${t.actualWar.toFixed(1)}</td>
                  <td class="${warErrorClass}">${t.error >= 0 ? '+' : ''}${t.error.toFixed(1)}</td>
                  <td>${t.projectedFip.toFixed(2)}</td>
                  <td>${t.actualFip.toFixed(2)}</td>
                  <td>${t.projectedIp.toFixed(0)}</td>
                  <td>${t.actualIp.toFixed(0)}</td>
              </tr>
          `;
      }).join('');

      // Calculate top 10 summary stats
      const top10WarErrors = top10Comparison.map(t => t.error);
      const top10MeanError = top10WarErrors.reduce((sum, e) => sum + e, 0) / top10WarErrors.length;
      const top10MaeWar = top10WarErrors.reduce((sum, e) => sum + Math.abs(e), 0) / top10WarErrors.length;
      const avgProjWar = top10Comparison.reduce((sum, t) => sum + t.projectedWar, 0) / top10Comparison.length;
      const avgActualWar = top10Comparison.reduce((sum, t) => sum + t.actualWar, 0) / top10Comparison.length;

      // Top Outliers Table
      const allDetails = years.flatMap(y => y.details.map(d => ({ ...d, year: y.year })));
      const outliers = allDetails
          .sort((a, b) => Math.abs(b.diff.fip) - Math.abs(a.diff.fip))
          .slice(0, 20);

      const outlierRows = outliers.map(d => `
          <tr>
              <td>${d.year}</td>
              <td>${this.renderPlayerName({ ...d, playerId: d.playerId, name: d.name } as any, d.year)}</td>
              <td>${d.teamName}</td>
              <td>${d.age}</td>
              <td>${d.projected.fip.toFixed(2)}</td>
              <td>${d.actual.fip.toFixed(2)}</td>
              <td class="${Math.abs(d.diff.fip) > 1.0 ? 'text-danger' : 'text-warning'}">${d.diff.fip > 0 ? '+' : ''}${d.diff.fip.toFixed(2)}</td>
              <td>${d.ip.toFixed(1)}</td>
          </tr>
      `).join('');

      container.innerHTML = `
          <div class="analysis-results">
              <div class="analysis-summary">
                  <h4>Overall Performance (FIP)</h4>
                  <p style="color: var(--color-text-secondary); font-size: 0.9em; margin-bottom: 10px;">
                      Analysis Period: ${this.analysisStartYear}-${this.analysisEndYear} (${years.length} years)
                      ${this.analysisUseIpFilter ? `<br>IP Range: ${this.analysisMinIp}-${this.analysisMaxIp === 999 ? '∞' : this.analysisMaxIp} innings` : ''}
                  </p>
                  <div class="metrics-grid">
                      ${renderMetricsCard(overallMetrics.fip)}
                  </div>
              </div>

              <div class="analysis-split" style="grid-template-columns: 1fr;">
                  <div class="analysis-section">
                      <h4>Component Breakdown</h4>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Stat</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${statRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-split" style="grid-template-columns: 1fr; margin-top: 20px;">
                  <div class="analysis-section">
                      <h4>Accuracy by Role (FIP)</h4>
                      <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">
                          SP = Starters (GS ≥ 10), Swingman = Long relievers (GS < 10, IP ≥ 60), RP = Relievers (GS < 10, IP < 60)
                      </p>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Role</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${roleRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-split" style="grid-template-columns: 1fr; margin-top: 20px;">
                  <div class="analysis-section">
                      <h4>Accuracy by Performance Quartile (FIP)</h4>
                      <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">
                          Pitchers grouped by their actual FIP performance. Helps identify if projections systematically under/over-estimate elite or poor performers.
                      </p>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Quartile</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${quartileRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-section" style="margin-top: 20px;">
                  <h4>Top 10 WAR Leaders: Projected vs Actual</h4>
                  <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">
                      Compares the actual top 10 WAR leaders to their projections. This helps identify if we're systematically under/over-projecting elite pitcher performance.
                      <br><strong>Summary:</strong> Avg Projected WAR = ${avgProjWar.toFixed(2)}, Avg Actual WAR = ${avgActualWar.toFixed(2)}, Mean Error = ${top10MeanError >= 0 ? '+' : ''}${top10MeanError.toFixed(2)}, MAE = ${top10MaeWar.toFixed(2)}
                  </p>
                  <div class="table-wrapper" style="max-height: 500px; overflow-y: auto;">
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Rank</th>
                                  <th>Player</th>
                                  <th>Proj WAR</th>
                                  <th>Act WAR</th>
                                  <th>Error</th>
                                  <th>Proj FIP</th>
                                  <th>Act FIP</th>
                                  <th>Proj IP</th>
                                  <th>Act IP</th>
                              </tr>
                          </thead>
                          <tbody>${top10Rows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-section" style="margin-top: 20px;">
                  <h4>Top Outliers (Biggest Misses)</h4>
                  <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">These are the specific player seasons where the projection missed by the widest margin. Useful for identifying injuries (low IP) or breakouts.</p>
                  <div class="table-wrapper" style="max-height: 400px; overflow-y: auto;">
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Year</th>
                                  <th>Player</th>
                                  <th>Team</th>
                                  <th>Age</th>
                                  <th>Proj FIP</th>
                                  <th>Act FIP</th>
                                  <th>Diff</th>
                                  <th>Act IP</th>
                              </tr>
                          </thead>
                          <tbody>${outlierRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-split" style="margin-top: 20px;">
                  <div class="analysis-section">
                      <h4>Accuracy by Age</h4>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Age Group</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${ageRows}</tbody>
                      </table>
                  </div>

                  <div class="analysis-section">
                      <h4>Accuracy by Year (FIP)</h4>
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
              </div>
              
              <div class="analysis-section" style="margin-top: 20px;">
                  <h4>Accuracy by Team (FIP)</h4>
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
      `;

      this.bindPlayerNameClicks();
  }

  private renderBatterAnalysisResults(): void {
      if (!this.batterAnalysisReport) return;
      const container = this.container.querySelector('#projections-table-container');
      if (!container) return;

      // Hide pagination controls in analysis mode
      this.updatePagination(0);

      const { overallMetrics, years, metricsByTeam, metricsByAge, metricsByPosition, metricsByQuartile } = this.batterAnalysisReport;

      const getBiasClass = (bias: number) => {
          if (Math.abs(bias) < 0.005) return 'text-success';
          if (Math.abs(bias) < 0.015) return 'text-warning';
          return 'text-danger';
      };

      const getMaeClass = (mae: number) => {
          if (mae < 0.025) return 'text-success';
          if (mae < 0.035) return 'text-warning';
          return 'text-danger';
      };

      const renderMetricsCard = (m: any) => `
          <div class="metric-box">
              <span class="metric-label">MAE</span>
              <span class="metric-value ${getMaeClass(m.mae)}">${m.mae.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">RMSE</span>
              <span class="metric-value">${m.rmse.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">Bias</span>
              <span class="metric-value ${getBiasClass(m.bias)}">${m.bias > 0 ? '+' : ''}${m.bias.toFixed(3)}</span>
          </div>
          <div class="metric-box">
              <span class="metric-label">N</span>
              <span class="metric-value">${m.count}</span>
          </div>
      `;

      // Helper to render a full stat row
      const renderStatRow = (label: string, metrics: any) => `
          <tr>
              <td><strong>${label}</strong></td>
              <td class="${getMaeClass(metrics.mae)}">${metrics.mae.toFixed(3)}</td>
              <td>${metrics.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(metrics.bias)}">${metrics.bias > 0 ? '+' : ''}${metrics.bias.toFixed(3)}</td>
              <td>${metrics.count}</td>
          </tr>
      `;

      // Year Table (wOBA)
      const yearRows = years.map(y => `
          <tr>
              <td>${y.year}</td>
              <td class="${getMaeClass(y.metrics.woba.mae)}">${y.metrics.woba.mae.toFixed(3)}</td>
              <td>${y.metrics.woba.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(y.metrics.woba.bias)}">${y.metrics.woba.bias > 0 ? '+' : ''}${y.metrics.woba.bias.toFixed(3)}</td>
              <td>${y.metrics.woba.count}</td>
          </tr>
      `).join('');

      // Team Table (wOBA)
      const sortedTeams = Array.from(metricsByTeam.entries()).sort((a, b) => a[1].woba.mae - b[1].woba.mae);
      const teamRows = sortedTeams.map(([team, m]) => `
          <tr>
              <td>${team}</td>
              <td class="${getMaeClass(m.woba.mae)}">${m.woba.mae.toFixed(3)}</td>
              <td>${m.woba.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.woba.bias)}">${m.woba.bias > 0 ? '+' : ''}${m.woba.bias.toFixed(3)}</td>
              <td>${m.woba.count}</td>
          </tr>
      `).join('');

      // Age Table (wOBA)
      const ageOrder = ['< 24', '24-26', '27-29', '30-33', '34+'];
      const sortedAges = Array.from(metricsByAge.entries()).sort((a, b) => {
          const aIdx = ageOrder.indexOf(a[0]);
          const bIdx = ageOrder.indexOf(b[0]);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      });
      const ageRows = sortedAges.map(([age, m]) => `
          <tr>
              <td>${age}</td>
              <td class="${getMaeClass(m.woba.mae)}">${m.woba.mae.toFixed(3)}</td>
              <td>${m.woba.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.woba.bias)}">${m.woba.bias > 0 ? '+' : ''}${m.woba.bias.toFixed(3)}</td>
              <td>${m.woba.count}</td>
          </tr>
      `).join('');

      // Position Table (wOBA) - C, IF, OF, DH
      const posOrder = ['C', '1B', 'IF', 'OF', 'DH'];
      const sortedPositions = Array.from(metricsByPosition.entries()).sort((a, b) => {
          const aIdx = posOrder.indexOf(a[0]);
          const bIdx = posOrder.indexOf(b[0]);
          return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      });
      const positionRows = sortedPositions.map(([pos, m]) => `
          <tr>
              <td>${pos}</td>
              <td class="${getMaeClass(m.woba.mae)}">${m.woba.mae.toFixed(3)}</td>
              <td>${m.woba.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.woba.bias)}">${m.woba.bias > 0 ? '+' : ''}${m.woba.bias.toFixed(3)}</td>
              <td>${m.woba.count}</td>
          </tr>
      `).join('');

      // Quartile Table (wOBA)
      const quartileOrder = ['Q1 (Elite)', 'Q2 (Good)', 'Q3 (Average)', 'Q4 (Below Avg)'];
      const sortedQuartiles = Array.from(metricsByQuartile.entries()).sort((a, b) => {
          const aPrefix = a[0].split(' ')[0];
          const bPrefix = b[0].split(' ')[0];
          const aIndex = quartileOrder.findIndex(q => q.startsWith(aPrefix));
          const bIndex = quartileOrder.findIndex(q => q.startsWith(bPrefix));
          return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      });
      const quartileRows = sortedQuartiles.map(([quartile, m]) => `
          <tr>
              <td>${quartile}</td>
              <td class="${getMaeClass(m.woba.mae)}">${m.woba.mae.toFixed(3)}</td>
              <td>${m.woba.rmse.toFixed(3)}</td>
              <td class="${getBiasClass(m.woba.bias)}">${m.woba.bias > 0 ? '+' : ''}${m.woba.bias.toFixed(3)}</td>
              <td>${m.woba.count}</td>
          </tr>
      `).join('');

      // Stat Breakdown Table
      const statRows = [
          renderStatRow('wOBA', overallMetrics.woba),
          renderStatRow('AVG', overallMetrics.avg),
          renderStatRow('BB%', overallMetrics.bbPct),
          renderStatRow('K%', overallMetrics.kPct),
          renderStatRow('HR%', overallMetrics.hrPct),
      ].join('');

      // Top Outliers Table (biggest wOBA misses)
      const allDetails = years.flatMap(y => y.details.map(d => ({ ...d, year: y.year })));
      const outliers = allDetails
          .sort((a, b) => Math.abs(b.diff.woba) - Math.abs(a.diff.woba))
          .slice(0, 20);

      const outlierRows = outliers.map(d => `
          <tr>
              <td>${d.year}</td>
              <td>${d.name}</td>
              <td>${d.teamName}</td>
              <td>${d.age}</td>
              <td>${d.position}</td>
              <td>${d.projected.woba.toFixed(3)}</td>
              <td>${d.actual.woba.toFixed(3)}</td>
              <td class="${Math.abs(d.diff.woba) > 0.040 ? 'text-danger' : 'text-warning'}">${d.diff.woba > 0 ? '+' : ''}${d.diff.woba.toFixed(3)}</td>
              <td>${d.pa}</td>
          </tr>
      `).join('');

      container.innerHTML = `
          <div class="analysis-results">
              <div class="analysis-summary">
                  <h4>Overall Performance (wOBA)</h4>
                  <p style="color: var(--color-text-secondary); font-size: 0.9em; margin-bottom: 10px;">
                      Analysis Period: ${this.analysisStartYear}-${this.analysisEndYear} (${years.length} years)
                      ${this.analysisUsePaFilter ? `<br>PA Range: ${this.analysisMinPa}-${this.analysisMaxPa === 999 ? '∞' : this.analysisMaxPa} plate appearances` : ''}
                  </p>
                  <div class="metrics-grid">
                      ${renderMetricsCard(overallMetrics.woba)}
                  </div>
              </div>

              <div class="analysis-split" style="grid-template-columns: 1fr;">
                  <div class="analysis-section">
                      <h4>Component Breakdown</h4>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Stat</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${statRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-split" style="grid-template-columns: 1fr; margin-top: 20px;">
                  <div class="analysis-section">
                      <h4>Accuracy by Position (wOBA)</h4>
                      <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">
                          C = Catcher, 1B = First Base, IF = Infielders (2B/3B/SS), OF = Outfielders (LF/CF/RF), DH = Designated Hitter
                      </p>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Position</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${positionRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-split" style="grid-template-columns: 1fr; margin-top: 20px;">
                  <div class="analysis-section">
                      <h4>Accuracy by Performance Quartile (wOBA)</h4>
                      <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">
                          Batters grouped by their actual wOBA performance. Helps identify if projections systematically under/over-estimate elite or poor performers.
                      </p>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Quartile</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${quartileRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-split" style="grid-template-columns: 1fr; margin-top: 20px;">
                  <div class="analysis-section">
                      <h4>HR% Accuracy by Projected Power Rating Quartile</h4>
                      <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">
                          Batters grouped by their projected power rating. Helps diagnose range compression: are we under-predicting elite power (negative bias in Q1) and over-predicting weak power (positive bias in Q4)?
                      </p>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Quartile</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${this.renderPowerQuartileRows(this.batterAnalysisReport)}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-section" style="margin-top: 20px;">
                  <h4>Top Outliers (Biggest Misses)</h4>
                  <p class="section-subtitle" style="margin-bottom: 10px; font-size: 0.9em;">These are the specific player seasons where the projection missed by the widest margin. Useful for identifying injuries or breakouts.</p>
                  <div class="table-wrapper" style="max-height: 400px; overflow-y: auto;">
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Year</th>
                                  <th>Player</th>
                                  <th>Team</th>
                                  <th>Age</th>
                                  <th>Pos</th>
                                  <th>Proj wOBA</th>
                                  <th>Act wOBA</th>
                                  <th>Diff</th>
                                  <th>PA</th>
                              </tr>
                          </thead>
                          <tbody>${outlierRows}</tbody>
                      </table>
                  </div>
              </div>

              <div class="analysis-split" style="margin-top: 20px;">
                  <div class="analysis-section">
                      <h4>Accuracy by Age</h4>
                      <table class="stats-table">
                          <thead>
                              <tr>
                                  <th>Age Group</th>
                                  <th>MAE</th>
                                  <th>RMSE</th>
                                  <th>Bias</th>
                                  <th>Count</th>
                              </tr>
                          </thead>
                          <tbody>${ageRows}</tbody>
                      </table>
                  </div>

                  <div class="analysis-section">
                      <h4>Accuracy by Year (wOBA)</h4>
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
              </div>

              <div class="analysis-section" style="margin-top: 20px;">
                  <h4>Accuracy by Team (wOBA)</h4>
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
      `;
  }

  private bindTeamDropdownListeners(): void {
      this.container.querySelectorAll('#team-dropdown-menu .filter-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
              const value = (e.target as HTMLElement).dataset.value;
              if (!value) return;

              this.selectedTeam = value;
              this.currentPage = 1;

              // Update display text
              const displaySpan = this.container.querySelector('#selected-team-display');
              if (displaySpan) {
                  displaySpan.textContent = value === 'all' ? 'All' : value;
              }

              // Update selected state
              this.container.querySelectorAll('#team-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
              (e.target as HTMLElement).classList.add('selected');

              // Close dropdown
              (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

              this.filterAndRender();
          });
      });
  }

  private bindPositionDropdownListeners(): void {
      this.container.querySelectorAll('#position-dropdown-menu .filter-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
              const value = (e.target as HTMLElement).dataset.value;
              if (!value) return;

              this.selectedPosition = value;
              this.currentPage = 1;

              // Determine mode based on position selection
              const pitcherPositions = ['all-pitchers', 'SP', 'RP'];
              const batterPositions = ['all-batters', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

              const previousMode = this.mode;
              if (pitcherPositions.includes(value)) {
                this.mode = 'pitchers';
              } else if (batterPositions.includes(value)) {
                this.mode = 'batters';
              }

              // Update sort key when switching modes
              if (previousMode !== this.mode) {
                  if (this.mode === 'batters') {
                      this.sortKey = 'projectedStats.war';
                      this.sortDirection = 'desc';
                  } else {
                      this.sortKey = 'projectedStats.fip';
                      this.sortDirection = 'asc';
                  }
              }

              // Update display text
              const displaySpan = this.container.querySelector('#selected-position-display');
              if (displaySpan) {
                  displaySpan.textContent = this.getPositionDisplayName(value);
              }

              // Update selected state
              this.container.querySelectorAll('#position-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
              (e.target as HTMLElement).classList.add('selected');

              // Close dropdown
              (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

              // If mode changed, need to fetch new data
              if (previousMode !== this.mode) {
                  this.showLoadingState();
                  this.fetchData();
              } else {
                  this.filterAndRender();
              }
          });
      });
  }

  private getPositionDisplayName(position: string): string {
    if (position === 'all-pitchers') return 'All Pitchers';
    if (position === 'all-batters') return 'All Batters';
    return position;
  }

  private renderPositionDropdownItems(): string {
    const positions = [
      { value: 'all-pitchers', label: 'All Pitchers' },
      { value: 'SP', label: 'SP' },
      { value: 'RP', label: 'RP' },
      { value: 'all-batters', label: 'All Batters' },
      { value: 'C', label: 'C' },
      { value: '1B', label: '1B' },
      { value: '2B', label: '2B' },
      { value: '3B', label: '3B' },
      { value: 'SS', label: 'SS' },
      { value: 'LF', label: 'LF' },
      { value: 'CF', label: 'CF' },
      { value: 'RF', label: 'RF' },
      { value: 'DH', label: 'DH' },
    ];

    return positions.map(p =>
      `<div class="filter-dropdown-item ${this.selectedPosition === p.value ? 'selected' : ''}" data-value="${p.value}">${p.label}</div>`
    ).join('');
  }

  private bindYearDropdownListeners(): void {
      this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
              const value = (e.target as HTMLElement).dataset.value;
              if (!value) return;

              this.selectedYear = parseInt(value, 10);
              this.currentPage = 1;

              // Update display text
              const displaySpan = this.container.querySelector('#selected-year-display');
              if (displaySpan) {
                  displaySpan.textContent = value;
              }

              // Update selected state
              this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
              (e.target as HTMLElement).classList.add('selected');

              // Close dropdown
              (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

              this.showLoadingState();
              this.fetchData();
          });
      });
  }

  private updateTeamFilter(): void {
      const menu = this.container.querySelector<HTMLElement>('#team-dropdown-menu');
      if (!menu) return;
      
      const items = ['all', ...this.teamOptions].map(t => {
          const label = t === 'all' ? 'All' : t;
          const selectedClass = t === this.selectedTeam ? 'selected' : '';
          return `<div class="filter-dropdown-item ${selectedClass}" data-value="${t}">${label}</div>`;
      }).join('');
      
      menu.innerHTML = items;
      
      // Update display text
      const displaySpan = this.container.querySelector('#selected-team-display');
      if (displaySpan) {
          displaySpan.textContent = this.selectedTeam === 'all' ? 'All' : this.selectedTeam;
      }
      
      this.bindTeamDropdownListeners();
  }

  private filterAndRender(): void {
      if (this.mode === 'batters') {
          this.filterAndRenderBatters();
          return;
      }

      let filtered = [...this.allStats];

      if (this.selectedTeam !== 'all') {
          filtered = filtered.filter(p => this.getParentOrgName(p.teamId) === this.selectedTeam);
      }

      // Filter by position
      if (this.selectedPosition !== 'all-pitchers') {
          filtered = filtered.filter(p => {
              if (this.selectedPosition === 'SP') return p.isSp;
              if (this.selectedPosition === 'RP') return !p.isSp;
              return true;
          });
      }

      this.stats = filtered;
      this.sortStats();
      if (this.itemsPerPageSelection === 'all') {
          this.itemsPerPage = Math.max(this.stats.length, 1);
      }
      this.renderTable();
  }

  private filterAndRenderBatters(): void {
      let filtered = [...this.allBatterStats];

      if (this.selectedTeam !== 'all') {
          filtered = filtered.filter(b => this.getParentOrgName(b.teamId) === this.selectedTeam);
      }

      // Filter by position if specific position selected
      if (this.selectedPosition !== 'all-batters') {
          const posMap: Record<string, number[]> = {
              'C': [2], '1B': [3], '2B': [4], '3B': [5], 'SS': [6],
              'LF': [7], 'CF': [8], 'RF': [9], 'DH': [10],
              'IF': [3, 4, 5, 6], 'OF': [7, 8, 9],
          };
          const allowed = posMap[this.selectedPosition];
          if (allowed) {
              filtered = filtered.filter(b => allowed.includes(b.position));
          }
      }

      this.batterStats = filtered;
      this.sortBatterStats();
      if (this.itemsPerPageSelection === 'all') {
          this.itemsPerPage = Math.max(this.batterStats.length, 1);
      }
      this.renderBatterTable();
  }

  private sortBatterStats(): void {
      if (!this.sortKey) return;

      this.batterStats.sort((a, b) => {
          let valA: any, valB: any;

          if (this.sortKey.startsWith('projectedStats.')) {
              const key = this.sortKey.replace('projectedStats.', '') as keyof ProjectedBatter['projectedStats'];
              valA = a.projectedStats[key];
              valB = b.projectedStats[key];
          } else if (this.sortKey.startsWith('actualStats.')) {
              const key = this.sortKey.replace('actualStats.', '');
              valA = a.actualStats?.[key as keyof typeof a.actualStats];
              valB = b.actualStats?.[key as keyof typeof b.actualStats];
          } else {
              valA = (a as any)[this.sortKey];
              valB = (b as any)[this.sortKey];
          }

          if (valA == null) valA = this.sortDirection === 'asc' ? Infinity : -Infinity;
          if (valB == null) valB = this.sortDirection === 'asc' ? Infinity : -Infinity;

          if (valA < valB) return this.sortDirection === 'asc' ? -1 : 1;
          if (valA > valB) return this.sortDirection === 'asc' ? 1 : -1;
          return 0;
      });
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
              const columnKey = String(col.key);

              // Add percentile bars for Proj FIP and Proj WAR
              if (columnKey === 'projFIP' || columnKey === 'projWAR') {
                const statValue = columnKey === 'projFIP' ? p.projectedStats.fip : p.projectedStats.war;
                const percentile = this.calculatePercentile(statValue, columnKey, p.isSp);
                const barHtml = this.renderPercentileBar(val, percentile, columnKey, p.isSp);
                return `<td data-col-key="${columnKey}">${barHtml}</td>`;
              }

              return `<td data-col-key="${columnKey}">${val ?? ''}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
      }).join('');

      container.innerHTML = `
        <div class="table-wrapper-outer">
            <button class="scroll-btn scroll-btn-left" aria-label="Scroll left"></button>
            <div class="table-wrapper">
                <table class="stats-table true-ratings-table">
                    <thead><tr>${headerHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            <button class="scroll-btn scroll-btn-right" aria-label="Scroll right"></button>
        </div>
      `;

      this.updatePagination(this.stats.length);
      this.bindTableEvents();
  }

  private renderBatterTable(): void {
      const container = this.container.querySelector('#projections-table-container');
      if (!container) return;

      if (this.batterStats.length === 0) {
          container.innerHTML = '<p class="no-stats">No batter projections found.</p>';
          this.updatePagination(0);
          return;
      }

      const start = (this.currentPage - 1) * this.itemsPerPage;
      const end = start + this.itemsPerPage;
      const pageData = this.batterStats.slice(start, end);

      // Populate lookup for modal access
      this.batterRowLookup = new Map(pageData.map(b => [b.playerId, b]));

      const headerHtml = this.batterColumns.map(col => {
          const sortKey = String(col.sortKey ?? col.key);
          const isActive = this.sortKey === sortKey;
          return `<th data-key="${col.key}" data-sort="${sortKey}" class="${isActive ? 'sort-active' : ''}" draggable="true">${col.label}</th>`;
      }).join('');

      const rowsHtml = pageData.map(b => {
          const cells = this.batterColumns.map(col => {
              const val = col.accessor ? col.accessor(b) : (b as any)[col.key];
              const columnKey = String(col.key);

              // Add percentile bars for key batter stats
              if (columnKey === 'projWoba' || columnKey === 'projWrcPlus' || columnKey === 'projWAR') {
                  const statValue = columnKey === 'projWoba' ? b.projectedStats.woba
                      : columnKey === 'projWrcPlus' ? b.projectedStats.wrcPlus
                      : b.projectedStats.war;
                  const percentile = this.calculateBatterPercentile(statValue, columnKey);
                  const barHtml = this.renderBatterPercentileBar(val, percentile, columnKey);
                  return `<td data-col-key="${columnKey}">${barHtml}</td>`;
              }

              return `<td data-col-key="${columnKey}">${val ?? ''}</td>`;
          }).join('');
          return `<tr>${cells}</tr>`;
      }).join('');

      container.innerHTML = `
        <div class="table-wrapper-outer">
            <button class="scroll-btn scroll-btn-left" aria-label="Scroll left"></button>
            <div class="table-wrapper">
                <table class="stats-table true-ratings-table">
                    <thead><tr>${headerHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            </div>
            <button class="scroll-btn scroll-btn-right" aria-label="Scroll right"></button>
        </div>
      `;

      this.updatePagination(this.batterStats.length);
      this.bindBatterTableEvents();
  }

  private bindBatterTableEvents(): void {
      // Scroll buttons
      this.bindScrollButtons();

      // Player Names
      this.bindBatterNameClicks();

      // Flip cards (rating on hover)
      this.bindFlipCardLocking();

      // Percentile bar animations
      this.triggerBarAnimations();

      // Sorting
      this.container.querySelectorAll('th[data-sort]').forEach(th => {
          th.addEventListener('click', () => {
              if (this.isDraggingColumn) return;
              const key = (th as HTMLElement).dataset.sort;
              if (!key) return;

              if (this.sortKey === key) {
                  this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
              } else {
                  this.sortKey = key;
                  // WAR and wRC+ higher is better, so default to desc
                  this.sortDirection = key.includes('war') || key.includes('wrc') || key.includes('woba') ? 'desc' : 'asc';
              }
              this.sortBatterStats();
              this.renderBatterTable();
          });
      });

      // Drag and Drop for column reordering
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

              // Visual indicator
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
                  this.reorderBatterColumns(draggedKey, targetKey);
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

  private bindBatterNameClicks(): void {
      this.container.querySelectorAll<HTMLButtonElement>('.player-name-link').forEach(btn => {
          btn.addEventListener('click', async () => {
              const playerId = parseInt(btn.dataset.playerId || '0');
              if (!playerId) return;

              const batter = this.batterRowLookup.get(playerId);
              if (!batter) return;

              // Show batter modal
              const currentYear = await dateService.getCurrentYear();
              const BatterProfileModule = await import('./BatterProfileModal');

              const batterData = {
                  playerId: batter.playerId,
                  playerName: batter.name,
                  team: batter.teamName,
                  age: batter.age,
                  position: batter.position,
                  positionLabel: batter.positionLabel,
                  trueRating: batter.currentTrueRating,
                  percentile: batter.percentile,
                  woba: batter.projectedStats.woba,
                  estimatedPower: batter.estimatedRatings.power,
                  estimatedEye: batter.estimatedRatings.eye,
                  estimatedAvoidK: batter.estimatedRatings.avoidK,
                  estimatedContact: batter.estimatedRatings.contact,
                  scoutPower: batter.scoutingRatings?.power,
                  scoutEye: batter.scoutingRatings?.eye,
                  scoutAvoidK: batter.scoutingRatings?.avoidK,
                  scoutContact: batter.scoutingRatings?.contact,
                  // Projected stats from BatterProjectionService
                  projWoba: batter.projectedStats.woba,
                  projAvg: batter.projectedStats.avg,
                  projObp: batter.projectedStats.obp,
                  projSlg: batter.projectedStats.slg,
                  projBbPct: batter.projectedStats.bbPct,
                  projKPct: batter.projectedStats.kPct,
                  projHrPct: batter.projectedStats.hrPct,
                  projPa: batter.projectedStats.pa,
                  projHr: batter.projectedStats.hr,
                  projRbi: batter.projectedStats.rbi,
                  projSb: batter.projectedStats.sb,
                  projWar: batter.projectedStats.war,
                  projWrcPlus: batter.projectedStats.wrcPlus,
              };

              const batterModal = new BatterProfileModule.BatterProfileModal();
              batterModal.show(batterData, currentYear);
          });
      });
  }

  private calculateBatterPercentile(value: number, statType: string): number {
      if (this.allBatterStats.length === 0) return 50;

      const values = this.allBatterStats.map(b => {
          if (statType === 'projWoba') return b.projectedStats.woba;
          if (statType === 'projWrcPlus') return b.projectedStats.wrcPlus;
          return b.projectedStats.war;
      }).filter(v => v != null && !isNaN(v));

      if (values.length === 0) return 50;

      // Higher is better for all batter stats
      const sorted = [...values].sort((a, b) => a - b);
      const rank = sorted.filter(v => v < value).length;
      return Math.round((rank / values.length) * 100);
  }

  private renderBatterPercentileBar(displayValue: string, percentile: number, statType: string): string {
      let barClass = 'percentile-poor';
      if (percentile >= 80) barClass = 'percentile-elite';
      else if (percentile >= 60) barClass = 'percentile-plus';
      else if (percentile >= 40) barClass = 'percentile-avg';
      else if (percentile >= 20) barClass = 'percentile-fringe';

      const statLabel = statType === 'projWoba' ? 'wOBA'
          : statType === 'projWrcPlus' ? 'wRC+'
          : 'WAR';
      const tooltip = `${percentile}th percentile (${statLabel})`;

      return `
        <div class="rating-with-bar">
          <span class="rating-value">${displayValue}</span>
          <div class="rating-bar">
            <div class="rating-bar-fill percentile-bar ${barClass}" style="--bar-width: ${percentile}%"></div>
          </div>
          <div class="stat-tooltip">${tooltip}</div>
        </div>
      `;
  }

  private renderBatterName(b: ProjectedBatter): string {
      return `<button class="btn-link player-name-link" data-player-id="${b.playerId}" title="ID: ${b.playerId}">${b.name}</button>`;
  }

  private renderBatterRatingBadge(rating: number): string {
      let className = 'badge-below-avg';
      if (rating >= 4.5) className = 'badge-elite';
      else if (rating >= 4.0) className = 'badge-plus';
      else if (rating >= 3.5) className = 'badge-above-avg';
      else if (rating >= 3.0) className = 'badge-avg';
      else if (rating >= 2.5) className = 'badge-below-avg';
      else className = 'badge-poor';

      return `<span class="badge ${className}">${rating.toFixed(1)}</span>`;
  }

  private bindScrollButtons(): void {
      const wrapper = this.container.querySelector<HTMLElement>('.table-wrapper-outer');
      if (!wrapper) return;

      const tableWrapper = wrapper.querySelector<HTMLElement>('.table-wrapper');
      const scrollLeftBtn = wrapper.querySelector<HTMLButtonElement>('.scroll-btn-left');
      const scrollRightBtn = wrapper.querySelector<HTMLButtonElement>('.scroll-btn-right');

      if (!tableWrapper || !scrollLeftBtn || !scrollRightBtn) return;

      const handleScroll = () => {
          const { scrollLeft, scrollWidth, clientWidth } = tableWrapper;
          const canScrollLeft = scrollLeft > 0;
          const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1;

          scrollLeftBtn.classList.toggle('visible', canScrollLeft);
          scrollRightBtn.classList.toggle('visible', canScrollRight);
      };

      wrapper.addEventListener('mouseenter', handleScroll);
      wrapper.addEventListener('mouseleave', () => {
          scrollLeftBtn.classList.remove('visible');
          scrollRightBtn.classList.remove('visible');
      });
      tableWrapper.addEventListener('scroll', handleScroll);

      scrollLeftBtn.addEventListener('click', () => {
          tableWrapper.scrollBy({ left: -200, behavior: 'smooth' });
      });

      scrollRightBtn.addEventListener('click', () => {
          tableWrapper.scrollBy({ left: 200, behavior: 'smooth' });
      });

      handleScroll();
  }

  private bindTableEvents(): void {
      // Scroll buttons
      this.bindScrollButtons();

      // Player Names
      this.bindPlayerNameClicks();

      // Flip cards (rating on hover)
      this.bindFlipCardLocking();

      // Percentile bar animations
      this.triggerBarAnimations();

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

  private reorderBatterColumns(fromKey: string, toKey: string): void {
      const fromIdx = this.batterColumns.findIndex(c => c.key === fromKey);
      const toIdx = this.batterColumns.findIndex(c => c.key === toKey);

      if (fromIdx > -1 && toIdx > -1) {
          const item = this.batterColumns.splice(fromIdx, 1)[0];
          this.batterColumns.splice(toIdx, 0, item);
          this.saveBatterColumnPrefs();
          this.renderBatterTable();
      }
  }

  private renderPositionLabel(player: ProjectedPlayerWithActuals): string {
    return this.renderPitcherPositionBadge(player.isSp);
  }

  private renderPitcherPositionBadge(isSp: boolean): string {
    const posLabel = isSp ? 'SP' : 'RP';
    const className = 'pos-utility';
    const title = isSp ? 'Starting Pitcher' : 'Relief Pitcher';
    return `<span class="badge ${className}" title="${title}">${posLabel}</span>`;
  }

  private renderBatterPositionBadge(positionNum: number): string {
    const posLabel = this.getPositionLabel(positionNum);
    let className: string;
    let title: string;

    // Map position to defensive group (same as FarmRankingsView)
    switch (positionNum) {
      case 2: // C
        className = 'pos-catcher';
        title = 'Catcher - Premium defensive position';
        break;
      case 6: // SS
        className = 'pos-middle-infield';
        title = 'Shortstop - Premium defensive position';
        break;
      case 4: // 2B
        className = 'pos-middle-infield';
        title = 'Second Base - Premium defensive position';
        break;
      case 8: // CF
        className = 'pos-center-field';
        title = 'Center Field - Premium outfield position';
        break;
      case 5: // 3B
        className = 'pos-corner';
        title = 'Third Base - Corner infield position';
        break;
      case 3: // 1B
        className = 'pos-corner';
        title = 'First Base - Corner infield position';
        break;
      case 7: // LF
      case 9: // RF
        className = 'pos-corner-outfield';
        title = `${posLabel} - Corner outfield position`;
        break;
      case 10: // DH
        className = 'pos-dh';
        title = 'Designated Hitter - Offense only';
        break;
      default:
        className = 'pos-utility';
        title = posLabel;
    }

    return `<span class="badge ${className}" title="${title}">${posLabel}</span>`;
  }

  private getPositionLabel(positionNum: number): string {
    const positions: { [key: number]: string } = {
      1: 'P',
      2: 'C',
      3: '1B',
      4: '2B',
      5: '3B',
      6: 'SS',
      7: 'LF',
      8: 'CF',
      9: 'RF',
      10: 'DH',
    };
    return positions[positionNum] || 'Unknown';
  }

  private renderPlayerName(player: ProjectedPlayer, year?: number): string {
    const yearAttr = year ? ` data-year="${year}"` : '';
    return `<button class="btn-link player-name-link" data-player-id="${player.playerId}"${yearAttr} title="ID: ${player.playerId}">${player.name}</button>`;
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

  private calculatePercentile(value: number, statType: string, isSp: boolean): number {
    // Filter all stats by role (SP or RP)
    const roleStats = this.allStats.filter(p => p.isSp === isSp);

    if (roleStats.length === 0) return 50; // Default to 50th percentile if no data

    // Get the array of values for this stat
    const values = roleStats.map(p =>
      statType === 'projFIP' ? p.projectedStats.fip : p.projectedStats.war
    ).filter(v => v != null && !isNaN(v));

    if (values.length === 0) return 50;

    // For FIP, lower is better, so we reverse the percentile calculation
    // For WAR, higher is better
    const isBetterLower = statType === 'projFIP';

    const sorted = [...values].sort((a, b) => a - b);
    const rank = sorted.filter(v => isBetterLower ? v > value : v < value).length;
    const percentile = (rank / values.length) * 100;

    return Math.round(percentile);
  }

  private renderPercentileBar(displayValue: string, percentile: number, statType: string, isSp: boolean): string {
    // Determine bar type based on percentile ranges
    let barClass = 'percentile-poor';
    if (percentile >= 80) barClass = 'percentile-elite';
    else if (percentile >= 60) barClass = 'percentile-plus';
    else if (percentile >= 40) barClass = 'percentile-avg';
    else if (percentile >= 20) barClass = 'percentile-fringe';

    const roleLabel = isSp ? 'SP' : 'RP';
    const statLabel = statType === 'projFIP' ? 'FIP' : 'WAR';
    const tooltip = `${percentile}th percentile among ${roleLabel} (${statLabel})`;

    return `
      <div class="rating-with-bar">
        <span class="rating-value">${displayValue}</span>
        <div class="rating-bar">
          <div class="rating-bar-fill percentile-bar ${barClass}" style="--bar-width: ${percentile}%"></div>
        </div>
        <div class="stat-tooltip">${tooltip}</div>
      </div>
    `;
  }

  private triggerBarAnimations(): void {
    requestAnimationFrame(() => {
      const barFills = this.container.querySelectorAll<HTMLElement>('.percentile-bar');
      barFills.forEach(bar => {
        bar.style.width = '0%';
        bar.classList.remove('animate-fill');
      });
      window.setTimeout(() => {
        barFills.forEach(bar => {
          void bar.getBoundingClientRect();
          bar.classList.add('animate-fill');
        });
      }, 1000);
    });

    this.bindBarHoverAnimations();
  }

  private bindBarHoverAnimations(): void {
    const ratingCells = this.container.querySelectorAll<HTMLElement>(
      'td[data-col-key="projFIP"], td[data-col-key="projWAR"]'
    );

    ratingCells.forEach(cell => {
      cell.addEventListener('mouseenter', () => {
        const barFill = cell.querySelector<HTMLElement>('.percentile-bar');
        if (!barFill) return;

        barFill.style.width = '0%';
        barFill.classList.remove('animate-fill');

        requestAnimationFrame(() => {
          void barFill.getBoundingClientRect();
          barFill.classList.add('animate-fill');
        });
      });
    });
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

  private renderBatterGrade(batter: ProjectedBatterWithActuals): string {
      if (!batter.actualStats) return '<span class="grade-na" title="No actual stats found">—</span>';

      const grade = batter.actualStats.grade;
      let className = 'grade-poor'; // Default/F
      if (grade === 'A') className = 'grade-elite';
      else if (grade === 'B') className = 'grade-plus';
      else if (grade === 'C') className = 'grade-avg';
      else if (grade === 'D') className = 'grade-fringe';

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
        const year = link.dataset.year ? parseInt(link.dataset.year, 10) : undefined;
        this.openPlayerProfile(playerId, year);
      });
    });
  }

  private async openPlayerProfile(playerId: number, explicitYear?: number): Promise<void> {
    let row: ProjectedPlayerWithActuals | undefined;
    let projectionYear = explicitYear ?? this.selectedYear;
    let projectionBaseYear = explicitYear ? explicitYear - 1 : (this.statsYearUsed ?? this.selectedYear - 1);
    
    // If we have an explicit year, we should prioritize finding the data for THAT year
    if (explicitYear && this.analysisReport) {
      for (const yearResult of this.analysisReport.years) {
        if (yearResult.year === explicitYear) {
          const detail = yearResult.details.find(d => d.playerId === playerId);
          if (detail) {
            row = {
              playerId: detail.playerId,
              name: detail.name,
              teamId: 0,
              age: detail.age,
              currentTrueRating: (detail as any).trueRating || 0,
              currentPercentile: (detail as any).percentile || 0,
              projectedStats: {
                ...detail.projected,
                war: 0,
                ip: detail.ip
              },
              projectedRatings: (detail as any).projectedRatings || {
                stuff: 0,
                control: 0,
                hra: 0
              },
              isProspect: false,
              actualStats: {
                fip: detail.actual.fip,
                war: 0,
                ip: detail.ip,
                diff: detail.diff.fip,
                grade: Math.abs(detail.diff.fip) < 0.5 ? 'A' : (Math.abs(detail.diff.fip) < 1.0 ? 'B' : 'C')
              }
            } as ProjectedPlayerWithActuals;
            break;
          }
        }
      }
    }

    // Standard lookup if not found yet
    if (!row) {
      row = this.playerRowLookup.get(playerId);
    }
    
    // Fallback: Check allStats if not on current page
    if (!row) {
      row = this.allStats.find(p => p.playerId === playerId);
    }

    // Fallback 2: Check analysis results if we are in analysis mode but didn't have an explicit year or it wasn't found
    if (!row && this.analysisReport) {
      // Look for the player in the analysis details
      for (const yearResult of this.analysisReport.years) {
        const detail = yearResult.details.find(d => d.playerId === playerId);
        if (detail) {
          projectionYear = yearResult.year;
          projectionBaseYear = yearResult.year - 1;
          
          // Construct a skeleton row from analysis data
          row = {
            playerId: detail.playerId,
            name: detail.name,
            teamId: 0, // Will be fetched from playerService below
            age: detail.age,
            isSp: detail.gs > (detail.ip / 5), // Heuristic
            currentTrueRating: (detail as any).trueRating || 0,
            currentPercentile: (detail as any).percentile || 0,
            projectedStats: {
              ...detail.projected,
              war: 0,
              ip: detail.ip
            },
            projectedRatings: (detail as any).projectedRatings || {
              stuff: 0,
              control: 0,
              hra: 0
            },
            isProspect: false,
            actualStats: {
              fip: detail.actual.fip,
              war: 0,
              ip: detail.ip,
              diff: detail.diff.fip,
              grade: Math.abs(detail.diff.fip) < 0.5 ? 'A' : (Math.abs(detail.diff.fip) < 1.0 ? 'B' : 'C')
            }
          } as ProjectedPlayerWithActuals;
          break;
        }
      }
    }

    if (!row) return;

    // Ensure ratings are estimated if they are 0 (common for historical analysis outliers)
    if (row.projectedRatings.stuff === 0 && row.projectedRatings.control === 0 && row.projectedRatings.hra === 0) {
      const estimated = RatingEstimatorService.estimateAll(row.projectedStats);
      row.projectedRatings = {
        stuff: estimated.stuff.rating,
        control: estimated.control.rating,
        hra: estimated.hra.rating
      };
    }

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

    // Get scouting (ONLY for current context, not historical analysis)
    const currentYear = await dateService.getCurrentYear();
    let myScouting: any = undefined;
    let osaScouting: any = undefined;

    if (projectionYear >= currentYear) {
      const [myRatings, osaRatings] = await Promise.all([
        scoutingDataService.getLatestScoutingRatings('my'),
        scoutingDataService.getLatestScoutingRatings('osa')
      ]);
      myScouting = myRatings.find(s => s.playerId === playerId);
      osaScouting = osaRatings.find(s => s.playerId === playerId);
    }

    // Determine if we should show the year label (only for historical data)
    const isHistorical = projectionBaseYear < currentYear - 1;

    const profileData: PlayerProfileData = {
      playerId: row.playerId,
      playerName: row.name,
      team: teamLabel,
      parentTeam: parentLabel,
      age: player?.age,
      position: row.isSp ? 'SP' : 'RP',
      positionLabel: row.isSp ? 'SP' : 'RP',
      trueRating: row.currentTrueRating,
      percentile: row.currentPercentile,
      fipLike: row.fipLike,
      estimatedStuff: row.projectedRatings.stuff,
      estimatedControl: row.projectedRatings.control,
      estimatedHra: row.projectedRatings.hra,

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

      // My Scout pitch data
      myPitches: myScouting?.pitches ? Object.keys(myScouting.pitches) : undefined,
      myPitchRatings: myScouting?.pitches,

      // OSA pitch data
      osaPitches: osaScouting?.pitches ? Object.keys(osaScouting.pitches) : undefined,
      osaPitchRatings: osaScouting?.pitches,

      isProspect: row.isProspect,
      year: projectionYear,
      projectionYear: projectionYear,
      projectionBaseYear: projectionBaseYear,
      showYearLabel: isHistorical || projectionYear !== this.selectedYear,

      // Pass projection data directly so the modal doesn't recalculate
      projIp: row.projectedStats.ip,
      projWar: row.projectedStats.war,
      projK9: row.projectedStats.k9,
      projBb9: row.projectedStats.bb9,
      projHr9: row.projectedStats.hr9,
      projFip: row.projectedStats.fip,

      projectionOverride: {
        projectedStats: row.projectedStats,
        projectedRatings: row.projectedRatings
      }
    };

    await pitcherProfileModal.show(profileData as any, projectionYear);
  }

  private updatePagination(total: number): void {
      const pageInfo = this.container.querySelector<HTMLElement>('#page-info')!;
      const pageTotal = this.container.querySelector<HTMLElement>('#page-total');
      const pageJumpSelect = this.container.querySelector<HTMLSelectElement>('#page-jump-select');
      const prev = this.container.querySelector<HTMLButtonElement>('#prev-page')!;
      const next = this.container.querySelector<HTMLButtonElement>('#next-page')!;
      const paginationContainer = this.container.querySelector<HTMLElement>('.pagination-controls');

      const totalPages = this.itemsPerPage === total ? 1 : Math.ceil(total / this.itemsPerPage);

      // Always show pagination controls (they contain the items-per-page selector)
      // But hide them in analysis mode
      if (paginationContainer) {
          paginationContainer.style.display = this.viewMode === 'analysis' ? 'none' : 'flex';
      }

      if (totalPages <= 1) {
          if (pageInfo) pageInfo.style.display = 'none';
          if (prev) prev.disabled = true;
          if (next) next.disabled = true;
          return;
      }

      if (pageInfo) pageInfo.style.display = '';
      if (pageTotal) {
          pageTotal.textContent = `of ${totalPages}`;
      }

      if (pageJumpSelect) {
          if (pageJumpSelect.options.length !== totalPages) {
              pageJumpSelect.innerHTML = Array.from({ length: totalPages }, (_, index) => {
                  const page = index + 1;
                  return `<option value="${page}">${page}</option>`;
              }).join('');
          }
          pageJumpSelect.value = String(this.currentPage);
      }

      if (prev) prev.disabled = this.currentPage === 1;
      if (next) next.disabled = this.currentPage === totalPages;
  }

  private loadColumnPrefs(defaults: ColumnConfig[]): ColumnConfig[] {
      try {
          const saved = localStorage.getItem(this.prefKey);
          if (saved) {
              let keys = JSON.parse(saved) as string[];
              
              // Migration: Ensure 'position' is included if it was added recently
              if (!keys.includes('position')) {
                  keys.unshift('position');
              }

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

  private loadBatterColumnPrefs(defaults: BatterColumnConfig[]): BatterColumnConfig[] {
      try {
          const saved = localStorage.getItem(this.batterPrefKey);
          if (saved) {
              const keys = JSON.parse(saved) as string[];

              // Migration: Ensure 'position' is included if it was added recently
              if (!keys.includes('position')) {
                  keys.unshift('position');
              }

              // Reconstruct order based on keys, filtering out any that no longer exist
              const ordered: BatterColumnConfig[] = [];
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

  private saveBatterColumnPrefs(): void {
      try {
          const keys = this.batterColumns.map(c => c.key);
          localStorage.setItem(this.batterPrefKey, JSON.stringify(keys));
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
    const yearField = this.container.querySelector<HTMLElement>('#proj-year-field');
    const teamDropdown = this.container.querySelector<HTMLElement>('[data-filter="team"]');
    const positionDropdown = this.container.querySelector<HTMLElement>('[data-filter="position"]');
    
    const isAnalysis = this.viewMode === 'analysis';
    
    // Hide filters in analysis mode
    if (isAnalysis) {
        if (yearField) yearField.style.display = 'none';
        if (teamDropdown) teamDropdown.style.display = 'none';
        if (positionDropdown) positionDropdown.style.display = 'none';
    } else {
        if (teamDropdown) teamDropdown.style.display = '';
        if (positionDropdown) positionDropdown.style.display = '';
        
        const showYear = this.viewMode === 'backcasting';
        if (yearField) {
            yearField.style.display = showYear ? '' : 'none';
        }

        if (showYear) {
            const actualCurrentYear = this.yearOptions.length > 0 ? this.yearOptions[0] : this.selectedYear;
            const backcastYears = this.yearOptions.filter(y => y < actualCurrentYear);
            const nextSelected = backcastYears.includes(this.selectedYear)
                ? this.selectedYear
                : (backcastYears[0] ?? this.selectedYear - 1);

            const menu = this.container.querySelector('#year-dropdown-menu');
            if (menu) {
                menu.innerHTML = backcastYears
                    .map(year => `<div class="filter-dropdown-item ${year === nextSelected ? 'selected' : ''}" data-value="${year}">${year}</div>`)
                    .join('');
                
                const displaySpan = this.container.querySelector('#selected-year-display');
                if (displaySpan) {
                    displaySpan.textContent = String(nextSelected);
                }
                
                this.selectedYear = nextSelected;
                this.bindYearDropdownListeners();
            }
        }
    }

    this.container.querySelectorAll<HTMLButtonElement>('[data-proj-mode]').forEach(btn => {
      const mode = btn.dataset.projMode as 'projections' | 'backcasting' | 'analysis' | undefined;
      const isActive = mode === this.viewMode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }



  private updateScoutingBanner(): void {
    const notice = this.container.querySelector<HTMLElement>('#proj-scouting-notice');
    if (!notice) return;

    // Only show banner in Projections mode (current/future context)
    if (this.viewMode !== 'projections') {
      notice.style.display = 'none';
      return;
    }

    if (this.scoutingMetadata) {
      const { fromMyScout, fromOSA } = this.scoutingMetadata;
      const hasMyScoutData = fromMyScout > 0;

      if (!hasMyScoutData && fromOSA > 0) {
        // Using OSA fallback
        notice.innerHTML = `
          <span class="banner-icon">ℹ️</span>
          Using OSA scouting data (${fromOSA} players).
          <button class="btn-link" data-tab-target="tab-data-management" type="button">Upload your scout reports</button> for custom scouting.
        `;
        notice.style.display = 'block';
        notice.className = 'info-banner osa-fallback';
      } else if (hasMyScoutData && fromOSA > 0) {
        // Using both sources
        notice.innerHTML = `
          <span class="banner-icon">📊</span>
          ${fromMyScout} players from My Scout, ${fromOSA} from OSA.
        `;
        notice.style.display = 'block';
        notice.className = 'info-banner mixed-sources';
      } else if (!hasMyScoutData && fromOSA === 0) {
        // No scouting at all
        notice.innerHTML = `
          No scouting data found. <button class="btn-link" data-tab-target="tab-data-management" type="button">Manage Data</button>
        `;
        notice.style.display = 'block';
        notice.className = 'scout-upload-notice';
      } else {
        // Only My Scout (clean state) or hidden
        notice.style.display = 'none';
      }
    } else {
      notice.style.display = 'none';
    }
  }
  private updateSubtitle(): void {
    const subtitle = this.container.querySelector<HTMLElement>('#projections-subtitle');
    if (!subtitle) return;

    const targetYear = this.viewMode === 'backcasting' ? this.selectedYear : (this.yearOptions[0] ?? this.selectedYear);
    const baseYear = this.statsYearUsed ?? (targetYear - 1);
    
    if (this.isOffseason) {
      subtitle.innerHTML = `Projections for the <strong>${targetYear}</strong> season based on ${baseYear} True Ratings`;
    } else {
      const fallbackNote = this.usedFallbackStats && baseYear !== (targetYear - 1)
        ? ` <span class="note-text">No ${targetYear - 1} stats yet&mdash;using ${baseYear} data.</span>`
        : '';
      subtitle.innerHTML = `Projections for the <strong>${targetYear}</strong> season based on ${baseYear} True Ratings ${fallbackNote}`;
    }
    
    this.updateScoutingBanner();
  }

  private renderPowerQuartileRows(report: any): string {
    if (!report || !report.metricsByPowerQuartile) {
      return '<tr><td colspan="5">No power quartile data available</td></tr>';
    }

    const getBiasClass = (bias: number) => {
      if (bias > 0.5) return 'text-danger';
      if (bias < -0.5) return 'text-success';
      return '';
    };

    const getMaeClass = (mae: number) => {
      if (mae > 1.5) return 'text-danger';
      if (mae < 0.7) return 'text-success';
      return '';
    };

    // Sort quartiles in order: Q1, Q2, Q3, Q4
    const quartileOrder = ['Q1 (Elite Power)', 'Q2 (Good Power)', 'Q3 (Avg Power)', 'Q4 (Weak Power)'];
    const sortedQuartiles = Array.from(report.metricsByPowerQuartile.entries()).sort((a: any, b: any) => {
      const aPrefix = a[0].split(' ')[0];
      const bPrefix = b[0].split(' ')[0];
      const aIndex = quartileOrder.findIndex(q => q.startsWith(aPrefix));
      const bIndex = quartileOrder.findIndex(q => q.startsWith(bPrefix));
      return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
    }) as Array<[string, any]>;

    return sortedQuartiles.map(([quartile, m]) => `
      <tr>
        <td>${quartile}</td>
        <td class="${getMaeClass(m.hrPct.mae)}">${m.hrPct.mae.toFixed(3)}</td>
        <td>${m.hrPct.rmse.toFixed(3)}</td>
        <td class="${getBiasClass(m.hrPct.bias)}">${m.hrPct.bias > 0 ? '+' : ''}${m.hrPct.bias.toFixed(3)}</td>
        <td>${m.hrPct.count}</td>
      </tr>
    `).join('');
  }
}
