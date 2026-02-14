import {
  teamRatingsService,
  FarmData,
  FarmSystemRankings,
  FarmSystemOverview,
  RatedProspect,
  HitterFarmData,
  HitterFarmSystemOverview,
  HitterFarmSystemRankings,
  RatedHitterProspect
} from '../services/TeamRatingsService';
import { pitcherProfileModal } from './PitcherProfileModal';
import { batterProfileModal, BatterProfileData } from './BatterProfileModal';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { getPositionLabel, getFullName, isPitcher } from '../models/Player';
import { PitcherScoutingRatings } from '../models/ScoutingData';

interface FarmColumn {
  key: string;
  label: string;
  sortKey?: string;
  title?: string;
}

export class FarmRankingsView {
  private container: HTMLElement;
  private selectedYear: number = 2021;
  private viewMode: 'top-systems' | 'top-100' | 'reports' = 'top-systems';
  private showPitchers: boolean = true;
  private showHitters: boolean = true;
  private data: FarmData | null = null;
  private hitterData: HitterFarmData | null = null;
  private yearOptions = Array.from({ length: 6 }, (_, i) => 2021 - i); // 2021 down to 2016
  private top100Prospects: RatedProspect[] = [];
  private top100HitterProspects: RatedHitterProspect[] = [];
  private selectedTeam: string = 'all';
  private selectedPosition: string = 'all';

  // Sorting and Dragging state
  private systemsSortKey: string = 'totalWar';
  private systemsSortDirection: 'asc' | 'desc' = 'desc';
  private prospectsSortKey: string = 'percentile';
  private prospectsSortDirection: 'asc' | 'desc' = 'desc';

  private systemsColumns: FarmColumn[] = [
    { key: 'rank', label: '#' },
    { key: 'teamName', label: 'Organization', sortKey: 'teamName' },
    { key: 'totalWar', label: 'Farm Score', sortKey: 'totalWar' },
    { key: 'topProspectName', label: 'Top Prospect', sortKey: 'topProspectName' },
    { key: 'elite', label: 'Elite', sortKey: 'elite', title: 'Elite (Ranks 1-100)' },
    { key: 'aboveAvg', label: 'Gold', sortKey: 'aboveAvg', title: 'Gold (Ranks 101-300)' },
    { key: 'average', label: 'Silver', sortKey: 'average', title: 'Silver (Ranks 301-500)' },
    { key: 'fringe', label: 'Depth', sortKey: 'fringe', title: 'Depth (Ranks 501+)' }
  ];

  private prospectsColumns: FarmColumn[] = [
    { key: 'rank', label: '#' },
    { key: 'position', label: 'Role' },
    { key: 'name', label: 'Name', sortKey: 'name' },
    { key: 'team', label: 'Team', sortKey: 'orgId' },
    { key: 'trueFutureRating', label: 'TFR', sortKey: 'trueFutureRating' },
    { key: 'peakWar', label: 'Peak WAR', sortKey: 'peakWar' },
    { key: 'peakFip', label: 'Peak FIP', sortKey: 'peakFip' },
    { key: 'age', label: 'Age', sortKey: 'age' },
    { key: 'level', label: 'Level', sortKey: 'level' }
  ];

  private hitterProspectsColumns: FarmColumn[] = [
    { key: 'rank', label: '#' },
    { key: 'position', label: 'Pos', sortKey: 'position' },
    { key: 'name', label: 'Name', sortKey: 'name' },
    { key: 'team', label: 'Team', sortKey: 'orgId' },
    { key: 'trueFutureRating', label: 'TFR', sortKey: 'trueFutureRating' },
    { key: 'projWoba', label: 'wOBA', sortKey: 'projWoba', title: 'Projected weighted On-Base Average' },
    { key: 'projWar', label: 'WAR', sortKey: 'projWar', title: 'Projected Batting WAR' },
    { key: 'age', label: 'Age', sortKey: 'age' },
    { key: 'level', label: 'Level', sortKey: 'level' }
  ];

  private combinedProspectsColumns: FarmColumn[] = [
    { key: 'rank', label: '#', sortKey: 'originalRank' },
    { key: 'position', label: 'Pos', sortKey: 'position' },
    { key: 'name', label: 'Name', sortKey: 'name' },
    { key: 'team', label: 'Team', sortKey: 'team' },
    { key: 'trueFutureRating', label: 'TFR', sortKey: 'tfr' },
    { key: 'peakWar', label: 'Peak WAR', sortKey: 'peakWar' },
    { key: 'age', label: 'Age', sortKey: 'age' },
    { key: 'level', label: 'Level', sortKey: 'level' }
  ];

  private isDraggingColumn = false;

  private hasLoadedData = false; // Track if data has been loaded (for lazy loading)

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderLayout();

    // Defer data loading until tab is activated (lazy loading)
    this.setupLazyLoading();
  }

  private setupLazyLoading(): void {
    // Check if tab is already active when view is created
    const tabPanel = this.container.closest<HTMLElement>('.tab-panel');
    const isCurrentlyActive = tabPanel?.classList.contains('active');

    if (isCurrentlyActive) {
      // Tab is already active, load immediately
      this.loadData();
      this.hasLoadedData = true;
    } else {
      // Set up observer to detect when tab becomes active
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target.classList.contains('active')) {
              // Tab just became active - load data if not already loaded
              if (!this.hasLoadedData) {
                this.loadData();
                this.hasLoadedData = true;
              }
              // Stop observing once data is loaded
              observer.disconnect();
              break;
            }
          }
        }
      });

      if (tabPanel) {
        observer.observe(tabPanel, { attributes: true });
      }
    }
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <h2 class="view-title">Farm System Rankings</h2>
        
        <div class="true-ratings-controls">
          <div class="filter-bar">
            <label>Filters:</label>
            <div class="filter-group" role="group" aria-label="Farm filters">

              <!-- Year selector temporarily hidden - no historical scouting data available
                   Scouting reports are year-agnostic, so showing past years would incorrectly
                   apply current scouting to historical stats. Re-enable when year-by-year
                   scouting data becomes available.
              <div class="filter-dropdown" data-filter="year">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Year: <span id="selected-year-display">${this.selectedYear}</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="year-dropdown-menu">
                  ${this.yearOptions.map(year => `<div class="filter-dropdown-item ${year === this.selectedYear ? 'selected' : ''}" data-value="${year}">${year}</div>`).join('')}
                </div>
              </div>
              -->

              <button class="toggle-btn active" data-view-mode="top-systems" aria-pressed="true">Top Systems</button>
              <button class="toggle-btn" data-view-mode="top-100" aria-pressed="false">Top 100</button>
              
              <span id="prospect-type-toggles" style="display: none;">
                <span class="filter-separator"></span>
                <button class="toggle-btn active" data-prospect-type="pitchers" aria-pressed="true">Pitchers</button>
                <button class="toggle-btn active" data-prospect-type="hitters" aria-pressed="true">Hitters</button>
              </span>
              
              <div class="filter-dropdown" data-filter="team" style="display: none;">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Team: <span id="selected-team-display">All</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="team-dropdown-menu">
                  <div class="filter-dropdown-item selected" data-value="all">All</div>
                </div>
              </div>

              <div class="filter-dropdown" data-filter="position" style="display: none;">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Pos: <span id="selected-position-display">All</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="position-dropdown-menu">
                  <div class="filter-dropdown-item selected" data-value="all">All</div>
                  <div class="filter-dropdown-item" data-value="P">P</div>
                  <div class="filter-dropdown-item" data-value="C">C</div>
                  <div class="filter-dropdown-item" data-value="1B">1B</div>
                  <div class="filter-dropdown-item" data-value="2B">2B</div>
                  <div class="filter-dropdown-item" data-value="SS">SS</div>
                  <div class="filter-dropdown-item" data-value="3B">3B</div>
                  <div class="filter-dropdown-item" data-value="LF">LF</div>
                  <div class="filter-dropdown-item" data-value="CF">CF</div>
                  <div class="filter-dropdown-item" data-value="RF">RF</div>
                  <div class="filter-dropdown-item" data-value="DH">DH</div>
                </div>
              </div>

              <button class="toggle-btn" data-view-mode="reports" aria-pressed="false" style="border-right: none; border-top-right-radius: var(--border-radius); border-bottom-right-radius: var(--border-radius);">Reports</button>
              <button class="toggle-btn" id="export-tfr-btn" title="Export TFR data for automated testing" style="display: none;">Export for Testing</button>
            </div>
          </div>
        </div>

        <div id="farm-content-area" style="margin-top: 1rem;">
            ${this.renderLoadingState('Loading Farm Data...')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Dropdown toggles
    this.container.querySelectorAll('.filter-dropdown-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = btn.closest('.filter-dropdown');
        this.container.querySelectorAll('.filter-dropdown').forEach(d => {
            if (d !== dropdown) d.classList.remove('open');
        });
        dropdown?.classList.toggle('open');
      });
    });

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        if (!(e.target as HTMLElement).closest('.filter-dropdown')) {
            this.container.querySelectorAll('.filter-dropdown').forEach(d => {
                d.classList.remove('open');
            });
        }
    });

    // Year selection - disabled until historical scouting data available
    // this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(item => {
    //     item.addEventListener('click', (e) => {
    //         const value = (e.target as HTMLElement).dataset.value;
    //         if (!value) return;
    //
    //         this.selectedYear = parseInt(value, 10);
    //
    //         const displaySpan = this.container.querySelector('#selected-year-display');
    //         if (displaySpan) displaySpan.textContent = value;
    //
    //         this.container.querySelectorAll('#year-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
    //         (e.target as HTMLElement).classList.add('selected');
    //
    //         (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');
    //
    //         this.showLoadingState();
    //         this.loadData();
    //     });
    // });

    // Prospect type toggle (Pitchers / Hitters) - allows both to be active
    this.container.querySelectorAll('[data-prospect-type]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const type = (e.target as HTMLElement).dataset.prospectType as 'pitchers' | 'hitters';
            const button = e.target as HTMLElement;

            // Toggle the clicked button
            if (type === 'pitchers') {
                this.showPitchers = !this.showPitchers;
            } else {
                this.showHitters = !this.showHitters;
            }

            // Ensure at least one is selected
            if (!this.showPitchers && !this.showHitters) {
                // Re-enable the one we just turned off
                if (type === 'pitchers') {
                    this.showPitchers = true;
                } else {
                    this.showHitters = true;
                }
                return;
            }

            button.classList.toggle('active', type === 'pitchers' ? this.showPitchers : this.showHitters);
            button.setAttribute('aria-pressed', String(type === 'pitchers' ? this.showPitchers : this.showHitters));

            // Reload data for the new filter
            this.showLoadingState();
            this.loadData();
        });
    });

    this.container.querySelectorAll('[data-view-mode]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const mode = (e.target as HTMLElement).dataset.viewMode as 'top-systems' | 'top-100' | 'reports';
            if (mode === this.viewMode) return;

            this.viewMode = mode;
            this.container.querySelectorAll('[data-view-mode]').forEach(b => {
                const isActive = b === e.target;
                b.classList.toggle('active', isActive);
                b.setAttribute('aria-pressed', String(isActive));
            });

            this.renderView();
        });
    });

    // Position dropdown (static items, bind once)
    this.bindPositionDropdownListeners();

    // Export for testing button
    this.container.querySelector('#export-tfr-btn')?.addEventListener('click', () => {
        this.exportTFRForTesting();
    });

    // Secret trigger for export button
    this.container.querySelector('.view-title')?.addEventListener('dblclick', () => {
        const btn = this.container.querySelector<HTMLElement>('#export-tfr-btn');
        const reportsBtn = this.container.querySelector<HTMLElement>('[data-view-mode="reports"]');
        if (btn) {
            const isNowVisible = btn.style.display === 'none';
            btn.style.display = isNowVisible ? 'inline-block' : 'none';
            
            if (reportsBtn) {
                if (isNowVisible) {
                    // Export is visible, Reports is middle element
                    reportsBtn.style.borderRight = '';
                    reportsBtn.style.borderTopRightRadius = '';
                    reportsBtn.style.borderBottomRightRadius = '';
                } else {
                    // Export is hidden, Reports is last visible element
                    reportsBtn.style.borderRight = 'none';
                    reportsBtn.style.borderTopRightRadius = 'var(--border-radius)';
                    reportsBtn.style.borderBottomRightRadius = 'var(--border-radius)';
                }
            }
        }
    });
  }

  private showLoadingState(message: string = 'Loading...'): void {
      const content = this.container.querySelector('#farm-content-area');
      if (content) content.innerHTML = this.renderLoadingState(message);
  }

  private renderLoadingState(title: string): string {
      return `
        <div class="stats-table-container loading-skeleton">
            <h3 class="section-title">${title}</h3>
            <table class="stats-table" style="width: 100%;">
                <thead>
                    <tr>
                        <th style="width: 40px;"><span class="skeleton-line xs"></span></th>
                        <th><span class="skeleton-line sm"></span></th>
                        <th style="text-align: center;"><span class="skeleton-line xs"></span></th>
                        <th><span class="skeleton-line sm"></span></th>
                        <th style="text-align: center;"><span class="skeleton-line xs"></span></th>
                        <th style="text-align: center;"><span class="skeleton-line xs"></span></th>
                        <th style="text-align: center;"><span class="skeleton-line xs"></span></th>
                        <th style="text-align: center;"><span class="skeleton-line xs"></span></th>
                    </tr>
                </thead>
                <tbody>
                    ${Array.from({ length: 10 }, () => `
                        <tr>
                            <td><span class="skeleton-line xs"></span></td>
                            <td><span class="skeleton-line md"></span></td>
                            <td style="text-align: center;"><span class="skeleton-line xs"></span></td>
                            <td><span class="skeleton-line sm"></span></td>
                            <td style="text-align: center;"><span class="skeleton-line xs"></span></td>
                            <td style="text-align: center;"><span class="skeleton-line xs"></span></td>
                            <td style="text-align: center;"><span class="skeleton-line xs"></span></td>
                            <td style="text-align: center;"><span class="skeleton-line xs"></span></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
      `;
  }

  private updateTeamFilter(): void {
      const menu = this.container.querySelector<HTMLElement>('#team-dropdown-menu');
      if (!menu) return;

      const teams = new Set<string>();

      if (this.showPitchers && this.data) {
          this.data.prospects.forEach(p => {
              teams.add(this.getTeamName(p.orgId));
          });
      }
      if (this.showHitters && this.hitterData) {
          this.hitterData.prospects.forEach(p => {
              teams.add(this.getTeamName(p.orgId));
          });
      }

      const sortedTeams = Array.from(teams).sort();

      const items = ['all', ...sortedTeams].map(t => {
          const label = t === 'all' ? 'All' : t;
          const selectedClass = t === this.selectedTeam ? 'selected' : '';
          return `<div class="filter-dropdown-item ${selectedClass}" data-value="${t}">${label}</div>`;
      }).join('');

      menu.innerHTML = items;
      this.bindTeamDropdownListeners();
      this.bindPositionDropdownListeners();
  }

  private bindTeamDropdownListeners(): void {
      this.container.querySelectorAll('#team-dropdown-menu .filter-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
              const value = (e.target as HTMLElement).dataset.value;
              if (!value) return;

              this.selectedTeam = value;

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

              this.renderView();
          });
      });
  }

  private bindPositionDropdownListeners(): void {
      this.container.querySelectorAll('#position-dropdown-menu .filter-dropdown-item').forEach(item => {
          item.addEventListener('click', (e) => {
              const value = (e.target as HTMLElement).dataset.value;
              if (!value) return;

              this.selectedPosition = value;

              const displaySpan = this.container.querySelector('#selected-position-display');
              if (displaySpan) {
                  displaySpan.textContent = value === 'all' ? 'All' : value;
              }

              this.container.querySelectorAll('#position-dropdown-menu .filter-dropdown-item').forEach(i => i.classList.remove('selected'));
              (e.target as HTMLElement).classList.add('selected');

              (e.target as HTMLElement).closest('.filter-dropdown')?.classList.remove('open');

              this.renderView();
          });
      });
  }

  private async loadData(): Promise<void> {
    try {
        // Load data based on which toggles are active
        const shouldLoadPitchers = this.showPitchers;
        const shouldLoadHitters = this.showHitters;

        const loadPromises: Promise<void>[] = [];

        if (shouldLoadPitchers) {
            loadPromises.push(
                teamRatingsService.getFarmData(this.selectedYear).then(data => {
                    this.data = data;
                    this.top100Prospects = data.prospects.slice(0, 100);
                })
            );
        } else {
            this.data = null;
            this.top100Prospects = [];
        }

        if (shouldLoadHitters) {
            loadPromises.push(
                teamRatingsService.getHitterFarmData(this.selectedYear).then(data => {
                    this.hitterData = data;
                    this.top100HitterProspects = data.prospects.slice(0, 100);
                })
            );
        } else {
            this.hitterData = null;
            this.top100HitterProspects = [];
        }

        await Promise.all(loadPromises);
        this.updateTeamFilter();
        this.renderView();
    } catch (err) {
        console.error(err);
        const content = this.container.querySelector('#farm-content-area');
        if (content) content.innerHTML = '<p class="no-stats">Error loading farm data.</p>';
    }
  }

  private renderView(): void {
      // Check if we have data to render based on selection
      if (this.showPitchers && !this.data) return;
      if (this.showHitters && !this.hitterData) return;
      if (!this.showPitchers && !this.showHitters) {
          const content = this.container.querySelector('#farm-content-area');
          if (content) content.innerHTML = '<p class="no-stats">Select Pitchers or Hitters to view rankings.</p>';
          return;
      }

      const content = this.container.querySelector('#farm-content-area');
      if (!content) return;

      this.sortData();

      const teamFilter = this.container.querySelector<HTMLElement>('[data-filter="team"]');
      if (teamFilter) {
          teamFilter.style.display = this.viewMode === 'top-100' ? 'inline-block' : 'none';
      }

      const posFilter = this.container.querySelector<HTMLElement>('[data-filter="position"]');
      if (posFilter) {
          posFilter.style.display = this.viewMode === 'top-100' ? 'inline-block' : 'none';
      }

      // Show/Hide Prospect Type Toggles
      const prospectToggles = this.container.querySelector<HTMLElement>('#prospect-type-toggles');
      if (prospectToggles) {
          // Show in both top-systems and top-100 modes
          prospectToggles.style.display = (this.viewMode === 'top-systems' || this.viewMode === 'top-100') ? 'inline' : 'none';
      }

      // Show reports button - now supports both pitchers and hitters
      const reportsBtn = this.container.querySelector<HTMLElement>('[data-view-mode="reports"]');
      if (reportsBtn) {
          reportsBtn.style.display = '';
      }

      switch (this.viewMode) {
          case 'top-systems':
              if (this.showPitchers && this.showHitters) {
                  content.innerHTML = this.renderCombinedTopSystems();
              } else if (this.showPitchers) {
                  content.innerHTML = this.renderSingleSystem(true);
              } else {
                  content.innerHTML = this.renderSingleSystem(false);
              }
              this.bindSystemToggles(); // Explicitly bind events after rendering
              break;
          case 'top-100':
              content.innerHTML = this.renderCombinedTopProspects();
              break;
          case 'reports':
              content.innerHTML = this.renderReports();
              this.bindToggleEvents(); // Only needed for collapsible reports
              break;
      }

      this.bindPlayerNameClicks();
      this.bindSortHeaders();
      this.bindColumnDragAndDrop();
      this.bindFlipCards();
  }

  private renderSingleSystem(isPitchers: boolean): string {
      const systems = isPitchers ? this.data!.systems : this.hitterData!.systems;
      const title = isPitchers ? 'Pitching Farm Rankings' : 'Hitting Farm Rankings';
      
      // Calculate dynamic thresholds based on current dataset
      const eliteCounts = systems.map(s => s.tierCounts.elite);
      const aboveAvgCounts = systems.map(s => s.tierCounts.aboveAvg);
      const averageCounts = systems.map(s => s.tierCounts.average);

      const eliteThresh = this.getDynamicThresholds(eliteCounts);
      const aboveAvgThresh = this.getDynamicThresholds(aboveAvgCounts);
      const averageThresh = this.getDynamicThresholds(averageCounts);

      const headerRow = this.systemsColumns.map(col => {
          const isSorted = this.systemsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.systemsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'rank' ? 'width: 40px;' : (col.key === 'teamName' ? 'text-align: left;' : 'text-align: center;');
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
          const titleAttr = col.title ? `title="${col.title}"` : '';
          
          return `<th ${sortAttr} ${titleAttr} class="${activeClass}" style="${style}" draggable="true" data-col-key="${col.key}">${col.label}${sortIcon}</th>`;
      }).join('');

      const rows = systems.map((sys, idx) => {
          const systemKey = `sys-${isPitchers ? 'p' : 'h'}-${sys.teamId}`;
          const score = isPitchers ? (sys as FarmSystemOverview).totalWar : (sys as HitterFarmSystemOverview).totalScore;
          const tierCounts = sys.tierCounts;
          
          const scoreTooltip = `Farm Score = (Elite × 10) + (Gold × 5) + (Silver × 1)\n\n` +
             `Elite (${tierCounts.elite}) × 10 = ${tierCounts.elite * 10}\n` +
             `Gold (${tierCounts.aboveAvg}) × 5 = ${tierCounts.aboveAvg * 5}\n` +
             `Silver (${tierCounts.average}) × 1 = ${tierCounts.average}`;

          const cells = this.systemsColumns.map(col => {
              switch (col.key) {
                  case 'rank':
                      return `<td style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>`;
                  case 'teamName':
                      return `
                        <td style="font-weight: 600; text-align: left;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="toggle-icon" style="font-size: 0.8em; width: 12px;">▶</span>
                                ${sys.teamName}
                            </div>
                        </td>`;
                  case 'totalWar':
                       return `<td style="text-align: center;" title="${scoreTooltip}"><span class="badge ${this.getScoreClass(score)}">${score.toFixed(0)}</span></td>`;
                  case 'topProspectName':
                      return `<td style="text-align: left;">${sys.topProspectName}</td>`;
                  case 'elite':
                      return `<td style="text-align: center;">${this.renderTierCountBadge(sys.tierCounts.elite, eliteThresh)}</td>`;
                  case 'aboveAvg':
                      return `<td style="text-align: center;">${this.renderTierCountBadge(sys.tierCounts.aboveAvg, aboveAvgThresh)}</td>`;
                  case 'average':
                      return `<td style="text-align: center;">${this.renderTierCountBadge(sys.tierCounts.average, averageThresh)}</td>`;
                  case 'fringe':
                      return `<td style="text-align: center; color: var(--color-text-muted);">${sys.tierCounts.fringe}</td>`;
                  default:
                      return `<td></td>`;
              }
          }).join('');

          return `
            <tr class="system-row" data-system-key="${systemKey}" style="cursor: pointer;">
                ${cells}
            </tr>
            <tr id="details-${systemKey}" style="display: none; background-color: var(--color-surface-hover);">
                <td colspan="${this.systemsColumns.length}" style="padding: 1rem;">
                    <div style="max-height: 400px; overflow-y: auto;">
                        ${this.renderUnifiedSystemDetails(sys.teamId)} 
                    </div>
                </td>
            </tr>
          `;
      }).join('');

      return `
        <div class="stats-table-container">
            <h3 class="section-title">${title} <span class="note-text">(Score based on weighted prospect quality)</span></h3>
            <table class="stats-table" style="width: 100%;">
                <thead><tr>${headerRow}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
      `;
  }

  private sortData(): void {
    if (this.showPitchers && this.data) {
      this.sortPitcherData();
    }
    if (this.showHitters && this.hitterData) {
      this.sortHitterData();
    }
  }

  private sortPitcherData(): void {
    if (!this.data) return;

    // Sort systems
    this.data.systems.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (['elite', 'aboveAvg', 'average', 'fringe'].includes(this.systemsSortKey)) {
        aVal = (a.tierCounts as any)[this.systemsSortKey];
        bVal = (b.tierCounts as any)[this.systemsSortKey];
      } else {
        aVal = (a as any)[this.systemsSortKey];
        bVal = (b as any)[this.systemsSortKey];
      }

      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = aVal - bVal;
      } else {
        compare = String(aVal).localeCompare(String(bVal));
      }
      return this.systemsSortDirection === 'asc' ? compare : -compare;
    });

    // Sort prospects (Top 100 subset)
    this.top100Prospects.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (this.prospectsSortKey === 'team') {
        aVal = this.getTeamName(a.orgId);
        bVal = this.getTeamName(b.orgId);
      } else if (this.prospectsSortKey === 'percentile') {
        aVal = (a as any)['percentile'];
        bVal = (b as any)['percentile'];
        // Break ties with peakWar
        if (typeof aVal === 'number' && typeof bVal === 'number' && aVal === bVal) {
          const aWar = a.peakWar;
          const bWar = b.peakWar;
          const compare = aWar - bWar;
          return this.prospectsSortDirection === 'asc' ? compare : -compare;
        }
      } else {
        aVal = (a as any)[this.prospectsSortKey];
        bVal = (b as any)[this.prospectsSortKey];
      }

      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = aVal - bVal;
      } else {
        compare = String(aVal).localeCompare(String(bVal));
      }
      return this.prospectsSortDirection === 'asc' ? compare : -compare;
    });
  }

  private sortHitterData(): void {
    if (!this.hitterData) return;

    // Sort systems
    this.hitterData.systems.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (['elite', 'aboveAvg', 'average', 'fringe'].includes(this.systemsSortKey)) {
        aVal = (a.tierCounts as any)[this.systemsSortKey];
        bVal = (b.tierCounts as any)[this.systemsSortKey];
      } else {
        aVal = (a as any)[this.systemsSortKey];
        bVal = (b as any)[this.systemsSortKey];
      }

      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = aVal - bVal;
      } else {
        compare = String(aVal).localeCompare(String(bVal));
      }
      return this.systemsSortDirection === 'asc' ? compare : -compare;
    });

    // Sort prospects (Top 100 subset)
    this.top100HitterProspects.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      if (this.prospectsSortKey === 'team') {
        aVal = this.getTeamName(a.orgId);
        bVal = this.getTeamName(b.orgId);
      } else if (this.prospectsSortKey === 'percentile') {
        aVal = (a as any)['percentile'];
        bVal = (b as any)['percentile'];
        // Break ties with projWar
        if (typeof aVal === 'number' && typeof bVal === 'number' && aVal === bVal) {
          const aWar = a.projWar;
          const bWar = b.projWar;
          const compare = aWar - bWar;
          return this.prospectsSortDirection === 'asc' ? compare : -compare;
        }
      } else {
        aVal = (a as any)[this.prospectsSortKey];
        bVal = (b as any)[this.prospectsSortKey];
      }

      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = aVal - bVal;
      } else {
        compare = String(aVal).localeCompare(String(bVal));
      }
      return this.prospectsSortDirection === 'asc' ? compare : -compare;
    });
  }

  // --- COMBINED VIEWS ---
  private renderCombinedTopSystems(): string {
      // 1. Merge Data
      const pitcherSystems = this.data ? this.data.systems : [];
      const hitterSystems = this.hitterData ? this.hitterData.systems : [];
      
      const teamMap = new Map<number, {
          teamId: number;
          teamName: string;
          pitchingDetails?: FarmSystemOverview;
          hittingDetails?: HitterFarmSystemOverview;
      }>();

      // Helper to get or create
      const getOrCreate = (id: number, name: string) => {
          if (!teamMap.has(id)) {
              teamMap.set(id, { teamId: id, teamName: name });
          }
          return teamMap.get(id)!;
      };

      pitcherSystems.forEach(s => {
          const t = getOrCreate(s.teamId, s.teamName);
          t.pitchingDetails = s;
      });

      hitterSystems.forEach(s => {
          const t = getOrCreate(s.teamId, s.teamName);
          t.hittingDetails = s;
      });

      // 2. Build unified tier counts from merged prospect pool
      //    (separate pitcher/hitter tier counts can't be summed — they use independent rankings)
      const allProspects: { orgId: number; percentile: number; tfr: number }[] = [];
      if (this.data?.prospects) {
          for (const p of this.data.prospects) {
              allProspects.push({ orgId: p.orgId, percentile: p.percentile || 0, tfr: p.trueFutureRating });
          }
      }
      if (this.hitterData?.prospects) {
          for (const p of this.hitterData.prospects) {
              allProspects.push({ orgId: p.orgId, percentile: p.percentile || 0, tfr: p.trueFutureRating });
          }
      }
      // Sort by percentile desc, TFR tiebreaker (same as renderCombinedTopProspects)
      allProspects.sort((a, b) => {
          const cmp = b.percentile - a.percentile;
          if (cmp !== 0) return cmp;
          return b.tfr - a.tfr;
      });
      // Assign unified ranks and count tiers per team
      const teamTierCounts = new Map<number, { elite: number; aboveAvg: number; average: number; fringe: number }>();
      allProspects.forEach((p, idx) => {
          const rank = idx + 1;
          if (!teamTierCounts.has(p.orgId)) {
              teamTierCounts.set(p.orgId, { elite: 0, aboveAvg: 0, average: 0, fringe: 0 });
          }
          const tc = teamTierCounts.get(p.orgId)!;
          if (rank <= 100) tc.elite++;
          else if (rank <= 300) tc.aboveAvg++;
          else if (rank <= 500) tc.average++;
          else tc.fringe++;
      });

      const unifiedSystems = Array.from(teamMap.values()).map(t => {
          const tc = teamTierCounts.get(t.teamId) ?? { elite: 0, aboveAvg: 0, average: 0, fringe: 0 };
          const elite = tc.elite;
          const aboveAvg = tc.aboveAvg;
          const average = tc.average;
          const fringe = tc.fringe;

          // Farm Score from unified tier counts
          const pScore = t.pitchingDetails?.totalWar ?? 0;
          const hScore = t.hittingDetails?.totalScore ?? 0;
          const totalScore = (elite * 10) + (aboveAvg * 5) + (average * 1);

          // Determine Top Prospect
          let topProspectName = 'N/A';
          const pId = t.pitchingDetails?.topProspectId;
          const hId = t.hittingDetails?.topProspectId;
          
          if (pId && !hId) {
              topProspectName = t.pitchingDetails!.topProspectName;
          } else if (!pId && hId) {
              topProspectName = t.hittingDetails!.topProspectName;
          } else if (pId && hId) {
              const pPercentile = this.getProspectPercentile(pId, true);
              const hPercentile = this.getProspectPercentile(hId, false);
              
              // Tie goes to pitcher
              if (pPercentile >= hPercentile) {
                  topProspectName = t.pitchingDetails!.topProspectName;
              } else {
                  topProspectName = t.hittingDetails!.topProspectName;
              }
          }

          return {
              ...t,
              pScore,
              hScore,
              totalScore,
              tierCounts: { elite, aboveAvg, average, fringe },
              topProspectName
          };
      });

      // Calculate dynamic thresholds based on current dataset
      const eliteCounts = unifiedSystems.map(s => s.tierCounts.elite);
      const aboveAvgCounts = unifiedSystems.map(s => s.tierCounts.aboveAvg);
      const averageCounts = unifiedSystems.map(s => s.tierCounts.average);

      const eliteThresh = this.getDynamicThresholds(eliteCounts);
      const aboveAvgThresh = this.getDynamicThresholds(aboveAvgCounts);
      const averageThresh = this.getDynamicThresholds(averageCounts);

      // 3. Sort
      unifiedSystems.sort((a, b) => {
           let aVal: any;
           let bVal: any;

           if (['elite', 'aboveAvg', 'average', 'fringe'].includes(this.systemsSortKey)) {
             aVal = (a.tierCounts as any)[this.systemsSortKey];
             bVal = (b.tierCounts as any)[this.systemsSortKey];
           } else if (this.systemsSortKey === 'topProspectName') {
             aVal = a.topProspectName;
             bVal = b.topProspectName;
           } else if (this.systemsSortKey === 'teamName') {
             aVal = a.teamName;
             bVal = b.teamName;
           } else {
             // Default to totalScore if sorting by totalWar or unknown
             aVal = a.totalScore;
             bVal = b.totalScore;
           }

           let compare = 0;
           if (typeof aVal === 'number' && typeof bVal === 'number') {
             compare = aVal - bVal;
           } else {
             compare = String(aVal).localeCompare(String(bVal));
           }
           return this.systemsSortDirection === 'asc' ? compare : -compare;
      });

      // 4. Render Table
      // Use the same columns as Single System view
      const headerRow = this.systemsColumns.map(col => {
          const isSorted = this.systemsSortKey === col.sortKey || (col.key === 'totalWar' && this.systemsSortKey === 'totalScore');
          const sortIcon = isSorted ? (this.systemsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'rank' ? 'width: 40px;' : (col.key === 'teamName' ? 'text-align: left;' : 'text-align: center;');
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
          const titleAttr = col.title ? `title="${col.title}"` : '';
          
          return `<th ${sortAttr} ${titleAttr} class="${activeClass}" style="${style}" draggable="true" data-col-key="${col.key}">${col.label}${sortIcon}</th>`;
      }).join('');

      const rows = unifiedSystems.map((sys, idx) => {
          const systemKey = `sys-unified-${sys.teamId}`;
          const scoreTooltip = `Pitching Score: ${sys.pScore.toFixed(0)}\nHitting Score: ${sys.hScore.toFixed(0)}`;

          const cells = this.systemsColumns.map(col => {
              switch (col.key) {
                  case 'rank':
                      return `<td style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>`;
                  case 'teamName':
                      return `
                        <td style="font-weight: 600; text-align: left;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="toggle-icon" style="font-size: 0.8em; width: 12px;">▶</span>
                                ${sys.teamName}
                            </div>
                        </td>`;
                  case 'totalWar':
                       return `<td style="text-align: center;" title="${scoreTooltip}"><span class="badge ${this.getScoreClass(sys.totalScore)}">${sys.totalScore.toFixed(0)}</span></td>`;
                  case 'topProspectName':
                      return `<td style="text-align: left;">${sys.topProspectName}</td>`;
                  case 'elite':
                      return `<td style="text-align: center;">${this.renderTierCountBadge(sys.tierCounts.elite, eliteThresh)}</td>`;
                  case 'aboveAvg':
                      return `<td style="text-align: center;">${this.renderTierCountBadge(sys.tierCounts.aboveAvg, aboveAvgThresh)}</td>`;
                  case 'average':
                      return `<td style="text-align: center;">${this.renderTierCountBadge(sys.tierCounts.average, averageThresh)}</td>`;
                  case 'fringe':
                      return `<td style="text-align: center; color: var(--color-text-muted);">${sys.tierCounts.fringe}</td>`;
                  default:
                      return `<td></td>`;
              }
          }).join('');

          return `
            <tr class="system-row" data-system-key="${systemKey}" style="cursor: pointer;">
                ${cells}
            </tr>
            <tr id="details-${systemKey}" style="display: none; background-color: var(--color-surface-hover);">
                <td colspan="${this.systemsColumns.length}" style="padding: 1rem;">
                    <div style="max-height: 400px; overflow-y: auto;">
                        ${this.renderUnifiedSystemDetails(sys.teamId)}
                    </div>
                </td>
            </tr>
          `;
      }).join('');

      return `
        <div class="stats-table-container">
            <h3 class="section-title">Organizational Rankings <span class="note-text">(Pitching + Hitting)</span></h3>
            <table class="stats-table" style="width: 100%;">
                <thead><tr>${headerRow}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
      `;
  }

  private renderUnifiedSystemDetails(teamId: number): string {
      // Get top prospects from both
      const pitcherReport = this.data?.reports.find(r => r.teamId === teamId);
      const hitterReport = this.hitterData?.reports.find(r => r.teamId === teamId);
      
      const pitchers = pitcherReport ? pitcherReport.allProspects : [];
      const hitters = hitterReport ? hitterReport.allProspects : [];
      
      // Combine and sort by TFR/WAR
      const all = [
          ...pitchers.map(p => ({ ...p, type: 'P', displayPos: 'P', war: p.peakWar })),
          ...hitters.map(h => ({ ...h, type: 'H', displayPos: getPositionLabel(h.position), war: h.projWar }))
      ].sort((a, b) => b.trueFutureRating - a.trueFutureRating);
      
      if (all.length === 0) return '<p class="no-stats">No prospects found.</p>';

      const columns = [
          { key: 'name', label: 'Name' },
          { key: 'displayPos', label: 'Pos' },
          { key: 'trueFutureRating', label: 'TFR' },
          { key: 'level', label: 'Lvl' },
          { key: 'age', label: 'Age' },
          { key: 'war', label: 'Peak WAR' }
      ];

      const headerRow = columns.map(col => {
          const align = col.key === 'name' ? 'left' : 'center';
          return `<th style="text-align: ${align}; position: sticky; top: 0; background-color: var(--color-surface); z-index: 10;">${col.label}</th>`;
      }).join('');

      const rows = all.map(p => `
          <tr>
              <td style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}" title="ID: ${p.playerId}">${p.name}</button></td>
              <td style="text-align: center;">${p.displayPos}</td>
              <td style="text-align: center;">${this.renderRatingBadge(p.trueFutureRating)}</td>
              <td style="text-align: center;"><span class="level-badge level-${p.level.toLowerCase()}">${p.level}</span></td>
              <td style="text-align: center;">${p.age}</td>
              <td style="text-align: center;"><span class="badge ${this.getWarClass(p.war)}">${p.war.toFixed(1)}</span></td>
          </tr>
      `).join('');

      return `
        <table class="stats-table nested-system-table" style="width: 100%; font-size: 0.9em; border-collapse: separate; border-spacing: 0;">
            <thead><tr>${headerRow}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
      `;
  }

  private renderCombinedTopProspects(): string {
      // If only one type is selected, render just that type
      if (this.showPitchers && !this.showHitters) {
          return this.renderTopProspects();
      }
      if (this.showHitters && !this.showPitchers) {
          return this.renderHitterTopProspects();
      }

      // Both selected - combine into unified list
      interface UnifiedProspect {
          playerId: number;
          name: string;
          team: string;
          tfr: number;
          peakWar: number;
          age: number;
          positionNum: number | null; // numeric position (or null for pitchers)
          level: string;
          isPitcher: boolean;
          percentile: number;
          originalRank: number; // Rank before filtering/sorting
      }

      const combined: UnifiedProspect[] = [];

      // Add pitchers
      if (this.data?.prospects) {
          for (const p of this.data.prospects) {
              combined.push({
                  playerId: p.playerId,
                  name: p.name,
                  team: this.getTeamName(p.orgId),
                  tfr: p.trueFutureRating,
                  peakWar: p.peakWar,
                  age: p.age,
                  positionNum: null,
                  level: p.level,
                  isPitcher: true,
                  percentile: p.percentile || 0,
                  originalRank: this.data.prospects.indexOf(p) + 1,
              });
          }
      }

      // Add hitters
      if (this.hitterData?.prospects) {
          for (const p of this.hitterData.prospects) {
              combined.push({
                  playerId: p.playerId,
                  name: p.name,
                  team: this.getTeamName(p.orgId),
                  tfr: p.trueFutureRating,
                  peakWar: p.projWar,
                  age: p.age,
                  positionNum: p.position,
                  level: p.level,
                  isPitcher: false,
                  percentile: p.percentile || 0,
                  originalRank: this.hitterData.prospects.indexOf(p) + 1,
              });
          }
      }

      if (combined.length === 0) {
          return '<p class="no-stats">No prospect data available.</p>';
      }

      // Assign unified ranks by percentile desc, TFR tiebreaker
      combined.sort((a, b) => {
          const cmp = (b.percentile || 0) - (a.percentile || 0);
          if (cmp !== 0) return cmp;
          return b.tfr - a.tfr;
      });
      combined.forEach((p, idx) => { p.originalRank = idx + 1; });

      // Re-sort by user-selected column (if not the default percentile desc, list is already correct)
      const isDefaultSort = this.prospectsSortKey === 'percentile' && this.prospectsSortDirection === 'desc';
      if (!isDefaultSort) {
      combined.sort((a, b) => {
          let aVal: any;
          let bVal: any;

          // Map sort key to UnifiedProspect field
          if (this.prospectsSortKey === 'percentile' || this.prospectsSortKey === 'originalRank') {
              aVal = a.originalRank;
              bVal = b.originalRank;
          } else if (this.prospectsSortKey === 'trueFutureRating' || this.prospectsSortKey === 'tfr') {
              aVal = a.tfr;
              bVal = b.tfr;
          } else if (this.prospectsSortKey === 'peakWar') {
              aVal = a.peakWar;
              bVal = b.peakWar;
          } else if (this.prospectsSortKey === 'name') {
              aVal = a.name;
              bVal = b.name;
          } else if (this.prospectsSortKey === 'team') {
              aVal = a.team;
              bVal = b.team;
          } else if (this.prospectsSortKey === 'age') {
              aVal = a.age;
              bVal = b.age;
          } else if (this.prospectsSortKey === 'position') {
              aVal = a.isPitcher ? 'P' : getPositionLabel(a.positionNum || 0);
              bVal = b.isPitcher ? 'P' : getPositionLabel(b.positionNum || 0);
          } else {
              aVal = (a as any)[this.prospectsSortKey];
              bVal = (b as any)[this.prospectsSortKey];
          }

          let compare = 0;
          if (typeof aVal === 'number' && typeof bVal === 'number') {
              compare = aVal - bVal;
          } else {
              compare = String(aVal).localeCompare(String(bVal));
          }
          return this.prospectsSortDirection === 'asc' ? compare : -compare;
      });
      } // end if (!isDefaultSort)

      // Filter by team and position if selected
      let filtered = combined;
      if (this.selectedTeam !== 'all') {
          filtered = filtered.filter(p => p.team === this.selectedTeam);
      }
      if (this.selectedPosition !== 'all') {
          filtered = filtered.filter(p => {
              const posLabel = p.isPitcher ? 'P' : getPositionLabel(p.positionNum || 0);
              return posLabel === this.selectedPosition;
          });
      }
      filtered = filtered.slice(0, 100);

      if (filtered.length === 0) {
          return '<p class="no-stats">No prospects found for this team.</p>';
      }

      const rows = filtered.map((p, idx) => {
          const cells = this.combinedProspectsColumns.map(col => {
              switch (col.key) {
                  case 'rank':
                      const rankText = isDefaultSort
                          ? `#${p.originalRank}`
                          : `${idx + 1} <span style="font-weight: normal; font-size: 0.85em; opacity: 0.7;">(#${p.originalRank})</span>`;
                      return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${rankText}</td>`;
                  case 'name':
                      return `<td data-col-key="name" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}" title="ID: ${p.playerId}">${p.name}</button></td>`;
                  case 'team':
                      return `<td data-col-key="team" style="text-align: left;">${p.team}</td>`;
                  case 'trueFutureRating':
                      return `<td data-col-key="trueFutureRating" style="text-align: center;">${this.renderRatingBadge(p.tfr)}</td>`;
                  case 'peakWar':
                      return `<td data-col-key="peakWar" style="text-align: center;"><span class="badge ${this.getWarClass(p.peakWar)}">${p.peakWar.toFixed(1)}</span></td>`;
                  case 'age':
                      return `<td data-col-key="age" style="text-align: center;">${p.age}</td>`;
                  case 'position':
                      return `<td data-col-key="position" style="text-align: center;">${this.renderPositionBadge(p.positionNum, p.isPitcher)}</td>`;
                  case 'level':
                      return `<td data-col-key="level" style="text-align: center;"><span class="level-badge level-${p.level.toLowerCase()}">${p.level}</span></td>`;
                  default:
                      return `<td></td>`;
              }
          }).join('');
          return `<tr>${cells}</tr>`;
      }).join('');

      const headerRow = this.combinedProspectsColumns.map(col => {
          const isSorted = this.prospectsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.prospectsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'name' || col.key === 'team' ? 'text-align: left;' : 'text-align: center;';
          const width = col.key === 'rank' ? 'width: 40px;' : '';
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';

          return `<th ${sortAttr} data-col-key="${col.key}" class="${activeClass}" style="${style} ${width}" draggable="true">${col.label}${sortIcon}</th>`;
      }).join('');

      return `
          <table class="stats-table">
              <thead>
                  <tr>
                      ${headerRow}
                  </tr>
              </thead>
              <tbody>
                  ${rows}
              </tbody>
          </table>
      `;
  }

  private bindSortHeaders(): void {
    const headers = this.container.querySelectorAll<HTMLElement>('.stats-table:not(.nested-system-table) th[data-sort-key]');
    headers.forEach(header => {
      // Ensure we don't accidentally select headers from nested tables (descendants of the selected table)
      if (header.closest('.nested-system-table')) return;

      header.addEventListener('click', () => {
        if (this.isDraggingColumn) return;
        const key = header.dataset.sortKey;
        if (!key) return;

        if (this.viewMode === 'top-systems') {
          if (this.systemsSortKey === key) {
            this.systemsSortDirection = this.systemsSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            this.systemsSortKey = key;
            this.systemsSortDirection = 'desc';
          }
        } else if (this.viewMode === 'top-100') {
          if (this.prospectsSortKey === key) {
            this.prospectsSortDirection = this.prospectsSortDirection === 'asc' ? 'desc' : 'asc';
          } else {
            this.prospectsSortKey = key;
            this.prospectsSortDirection = 'desc';
          }
        }

        this.sortData();
        this.renderView();
      });
    });
  }

  private bindColumnDragAndDrop(): void {
    const headers = this.container.querySelectorAll<HTMLTableCellElement>('.stats-table th[data-col-key]');
    let draggedKey: string | null = null;

    headers.forEach(header => {
      // Ensure we don't accidentally select headers from nested tables
      if (header.closest('.nested-system-table')) return;

      header.addEventListener('dragstart', (e) => {
        draggedKey = header.dataset.colKey ?? null;
        this.isDraggingColumn = true;
        header.classList.add('dragging');
        this.applyColumnClass(draggedKey, 'dragging-col', true);
        if (draggedKey) {
          e.dataTransfer?.setData('text/plain', draggedKey);
        }
      });

      header.addEventListener('dragover', (e) => {
        if (!draggedKey) return;
        e.preventDefault();
        const targetKey = header.dataset.colKey;
        if (!targetKey || targetKey === draggedKey) {
          this.clearDropIndicators();
          return;
        }
        const rect = header.getBoundingClientRect();
        const isBefore = e.clientX < rect.left + rect.width / 2;
        this.updateDropIndicator(targetKey, isBefore ? 'before' : 'after');
      });

      header.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetKey = header.dataset.colKey;
        const position = header.dataset.dropPosition as 'before' | 'after' | undefined;
        if (!draggedKey || !targetKey || draggedKey === targetKey) {
          draggedKey = null;
          this.clearDropIndicators();
          return;
        }
        this.reorderColumns(draggedKey, targetKey, position ?? 'before');
        draggedKey = null;
        this.clearDropIndicators();
      });

      header.addEventListener('dragend', () => {
        header.classList.remove('dragging');
        this.applyColumnClass(draggedKey, 'dragging-col', false);
        draggedKey = null;
        this.clearDropIndicators();
        setTimeout(() => {
          this.isDraggingColumn = false;
        }, 0);
      });
    });
  }

  private reorderColumns(draggedKey: string, targetKey: string, position: 'before' | 'after'): void {
    let columns: FarmColumn[];
    if (this.viewMode === 'top-systems') {
      columns = this.systemsColumns; // Both pitchers and hitters share systemsColumns
    } else {
      // Top 100 view - use appropriate columns based on which player type is active
      if (this.showPitchers && this.showHitters) {
        columns = this.combinedProspectsColumns;
      } else if (this.showHitters) {
        columns = this.hitterProspectsColumns;
      } else {
        columns = this.prospectsColumns;
      }
    }
    const fromIndex = columns.findIndex(col => col.key === draggedKey);
    const toIndex = columns.findIndex(col => col.key === targetKey);
    
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = columns.splice(fromIndex, 1);
    let insertIndex = position === 'after' ? toIndex + 1 : toIndex;
    if (fromIndex < insertIndex) {
      insertIndex -= 1;
    }
    columns.splice(insertIndex, 0, moved);
    
    this.renderView();
  }

  private updateDropIndicator(targetKey: string, position: 'before' | 'after'): void {
    this.clearDropIndicators();
    const cells = this.container.querySelectorAll<HTMLElement>(`.stats-table [data-col-key="${targetKey}"]`);
    cells.forEach(cell => {
      cell.dataset.dropPosition = position;
      cell.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
    });
  }

  private clearDropIndicators(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.stats-table .drop-before, .stats-table .drop-after');
    cells.forEach(cell => {
      cell.classList.remove('drop-before', 'drop-after');
      delete cell.dataset.dropPosition;
    });
  }

  private applyColumnClass(columnKey: string | null, className: string, add: boolean): void {
    if (!columnKey) return;
    const cells = this.container.querySelectorAll<HTMLElement>(`.stats-table [data-col-key="${columnKey}"]`);
    cells.forEach(cell => cell.classList.toggle(className, add));
  }

  private bindFlipCards(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.flip-cell');
    cells.forEach(cell => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        cell.classList.toggle('is-flipped');
      });
    });
  }

  // --- TOP SYSTEMS VIEW ---




  private bindSystemToggles(): void {
      this.container.querySelectorAll('.system-row').forEach(row => {
          const systemKey = (row as HTMLElement).dataset.systemKey;
          const detailsRow = this.container.querySelector(`#details-${systemKey}`);

          // Stop propagation for the details row to prevent accidental toggling
          if (detailsRow) {
              detailsRow.addEventListener('click', (e) => e.stopPropagation());
          }

          row.addEventListener('click', (e) => {
              const target = e.target as HTMLElement;
              
              // Verify we are clicking the system row itself, not a nested row (e.g. inside details)
              if (target.closest('tr') !== row) return;

              // Prevent toggle if clicking a player link
              if (target.closest('.player-name-link')) return;

              const icon = row.querySelector('.toggle-icon');

              if (detailsRow && icon) {
                  const isHidden = (detailsRow as HTMLElement).style.display === 'none';
                  (detailsRow as HTMLElement).style.display = isHidden ? 'table-row' : 'none';
                  icon.textContent = isHidden ? '▼' : '▶';
                  row.classList.toggle('expanded', isHidden);
              }
          });
      });

      // Re-bind player name clicks for the newly rendered details
      this.bindPlayerNameClicks();

      // Bind sorting and dragging for nested tables
      this.bindNestedTableInteractions();
  }

  private bindNestedTableInteractions(): void {
    const nestedTables = this.container.querySelectorAll<HTMLTableElement>('.nested-system-table');
    nestedTables.forEach(table => {
      const headers = table.querySelectorAll<HTMLTableCellElement>('thead th[data-col-key]');
      let draggedKey: string | null = null;

      headers.forEach(header => {
        // Sorting
        header.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent click from bubbling to parent row toggle
          if (draggedKey) return; // Don't sort while dragging
          this.sortNestedTable(table, header.dataset.sortKey || '');
        });

        // Dragging
        header.addEventListener('dragstart', (e) => {
          e.stopPropagation(); // Prevent drag from bubbling
          draggedKey = header.dataset.colKey ?? null;
          header.classList.add('dragging');
          if (draggedKey) {
            e.dataTransfer?.setData('text/plain', draggedKey);
          }
        });

        header.addEventListener('dragover', (e) => {
          if (!draggedKey) return;
          e.preventDefault();
          const targetKey = header.dataset.colKey;
          if (!targetKey || targetKey === draggedKey) {
            this.clearNestedDropIndicators(table);
            return;
          }
          const rect = header.getBoundingClientRect();
          const isBefore = e.clientX < rect.left + rect.width / 2;
          this.updateNestedDropIndicator(table, targetKey, isBefore ? 'before' : 'after');
        });

        header.addEventListener('drop', (e) => {
          e.preventDefault();
          const targetKey = header.dataset.colKey;
          const position = header.dataset.dropPosition as 'before' | 'after' | undefined;
          if (!draggedKey || !targetKey || draggedKey === targetKey) {
            draggedKey = null;
            this.clearNestedDropIndicators(table);
            return;
          }
          this.reorderNestedColumns(table, draggedKey, targetKey, position ?? 'before');
          draggedKey = null;
          this.clearNestedDropIndicators(table);
        });

        header.addEventListener('dragend', () => {
          header.classList.remove('dragging');
          draggedKey = null;
          this.clearNestedDropIndicators(table);
        });
      });
    });
  }

  private sortNestedTable(table: HTMLTableElement, sortKey: string): void {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    const isAsc = !table.dataset.sortAsc || table.dataset.sortAsc === 'false';

    rows.sort((a, b) => {
      const aCell = a.querySelector(`td[data-col-key="${sortKey}"]`) || a.children[0];
      const bCell = b.querySelector(`td[data-col-key="${sortKey}"]`) || b.children[0];
      const aVal = aCell?.textContent?.trim() || '';
      const bVal = bCell?.textContent?.trim() || '';

      const aNum = parseFloat(aVal);
      const bNum = parseFloat(bVal);

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return isAsc ? aNum - bNum : bNum - aNum;
      }
      return isAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });

    rows.forEach(row => tbody.appendChild(row));
    table.dataset.sortKey = sortKey;
    table.dataset.sortAsc = String(isAsc);
  }

  private reorderNestedColumns(table: HTMLTableElement, draggedKey: string, targetKey: string, position: 'before' | 'after'): void {
    const headers = Array.from(table.querySelectorAll('thead th[data-col-key]')) as HTMLTableCellElement[];
    const fromIdx = headers.findIndex(h => h.dataset.colKey === draggedKey);
    const toIdx = headers.findIndex(h => h.dataset.colKey === targetKey);

    if (fromIdx === -1 || toIdx === -1) return;

    const rows = table.querySelectorAll('tbody tr');
    const [draggedHeader] = headers.splice(fromIdx, 1);
    let insertIdx = position === 'after' ? toIdx + 1 : toIdx;
    if (fromIdx < insertIdx) insertIdx -= 1;
    headers.splice(insertIdx, 0, draggedHeader);

    // Reorder header cells
    const thead = table.querySelector('thead tr');
    if (thead) {
      headers.forEach(h => thead.appendChild(h));
    }

    // Reorder body cells
    rows.forEach(row => {
      const cells = Array.from(row.children);
      const [draggedCell] = cells.splice(fromIdx, 1);
      cells.splice(insertIdx, 0, draggedCell as Element);
      cells.forEach(cell => row.appendChild(cell));
    });
  }

  private updateNestedDropIndicator(table: HTMLTableElement, targetKey: string, position: 'before' | 'after'): void {
    this.clearNestedDropIndicators(table);
    const header = table.querySelector(`thead th[data-col-key="${targetKey}"]`) as HTMLTableCellElement;
    if (header) {
      header.dataset.dropPosition = position;
      header.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
    }
  }

  private clearNestedDropIndicators(table: HTMLTableElement): void {
    const cells = table.querySelectorAll('th.drop-before, th.drop-after');
    cells.forEach(cell => {
      cell.classList.remove('drop-before', 'drop-after');
      delete (cell as HTMLElement).dataset.dropPosition;
    });
  }

  // --- TOP 100 PROSPECTS VIEW ---
  private renderTopProspects(): string {
      if (!this.data || this.data.prospects.length === 0) return '<p class="no-stats">No prospect data available.</p>';

      let filteredProspects = this.selectedTeam === 'all'
          ? this.top100Prospects
          : this.top100Prospects.filter(p => this.getTeamName(p.orgId) === this.selectedTeam);

      // Position filter: pitcher-only view only shows pitchers, so only filter if "P" or "all" selected
      if (this.selectedPosition !== 'all' && this.selectedPosition !== 'P') {
          filteredProspects = []; // Non-pitcher position selected but viewing pitchers only
      }

      if (filteredProspects.length === 0) return '<p class="no-stats">No top 100 prospects found for this filter.</p>';

      // Build a map of prospect ID to their percentile-based rank
      const percentileRankMap = new Map<number, number>();
      const percentileSorted = [...this.top100Prospects].sort((a, b) => {
          const compare = (b.percentile || 0) - (a.percentile || 0);
          if (compare !== 0) return compare;
          return b.peakWar - a.peakWar; // Tiebreaker
      });
      percentileSorted.forEach((p, idx) => {
          percentileRankMap.set(p.playerId, idx + 1);
      });

      const isDefaultSort = this.prospectsSortKey === 'percentile' && this.prospectsSortDirection === 'desc';

      const rows = filteredProspects.map((p, idx) => {
        const cells = this.prospectsColumns.map(col => {
            switch (col.key) {
                case 'rank':
                    const currentRank = idx + 1;
                    const percentileRank = percentileRankMap.get(p.playerId) || currentRank;

                    if (isDefaultSort) {
                        return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">#${percentileRank}</td>`;
                    } else {
                        return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${currentRank} <span style="font-weight: normal; font-size: 0.85em; opacity: 0.7;">(#${percentileRank})</span></td>`;
                    }
                case 'position':
                    return `<td data-col-key="position" style="text-align: center;">${this.renderPositionBadge(null, true)}</td>`;
                case 'name':
                    return `<td data-col-key="name" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}" title="ID: ${p.playerId}">${p.name}</button></td>`;
                case 'team':
                    return `<td data-col-key="team" style="text-align: left;">${this.getTeamName(p.orgId)}</td>`;
                case 'trueFutureRating':
                    return `<td data-col-key="trueFutureRating" style="text-align: center;">${this.renderRatingBadge(p.trueFutureRating)}</td>`;
                case 'peakWar':
                    return `<td data-col-key="peakWar" style="text-align: center;"><span class="badge ${this.getWarClass(p.peakWar)}">${p.peakWar.toFixed(1)}</span></td>`;
                case 'peakFip':
                    return `<td data-col-key="peakFip" style="text-align: center;">${p.peakFip.toFixed(2)}</td>`;
                case 'age':
                    return `<td data-col-key="age" style="text-align: center;">${p.age}</td>`;
                case 'level':
                    return `<td data-col-key="level" style="text-align: center;"><span class="level-badge level-${p.level.toLowerCase()}">${p.level}</span></td>`;
                default:
                    return `<td></td>`;
            }
        }).join('');

        return `<tr>${cells}</tr>`;
      }).join('');

      const headerRow = this.prospectsColumns.map(col => {
          const isSorted = this.prospectsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.prospectsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'name' || col.key === 'team' ? 'text-align: left;' : 'text-align: center;';
          const width = col.key === 'rank' ? 'width: 40px;' : '';
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';

          return `<th ${sortAttr} data-col-key="${col.key}" class="${activeClass}" style="${style} ${width}" draggable="true">${col.label}${sortIcon}</th>`;
      }).join('');

      return `
        <div class="stats-table-container">
            <h3 class="section-title">Top 100 Prospects <span class="note-text">(by True Future Rating)</span></h3>
            <table class="stats-table" style="width: 100%;">
                <thead>
                    <tr>
                        ${headerRow}
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
      `;
  }







  // --- HITTER TOP 100 PROSPECTS VIEW ---
  private renderHitterTopProspects(): string {
      if (!this.hitterData || this.hitterData.prospects.length === 0) return '<p class="no-stats">No hitter prospect data available.</p>';

      let filteredProspects = this.selectedTeam === 'all'
          ? this.top100HitterProspects
          : this.top100HitterProspects.filter(p => this.getTeamName(p.orgId) === this.selectedTeam);

      // Filter by position
      if (this.selectedPosition !== 'all') {
          if (this.selectedPosition === 'P') {
              filteredProspects = []; // Pitcher selected but viewing hitters only
          } else {
              filteredProspects = filteredProspects.filter(p => getPositionLabel(p.position) === this.selectedPosition);
          }
      }

      if (filteredProspects.length === 0) return '<p class="no-stats">No top 100 hitter prospects found for this filter.</p>';

      // Build a map of prospect ID to their percentile-based rank
      const percentileRankMap = new Map<number, number>();
      const percentileSorted = [...this.top100HitterProspects].sort((a, b) => {
          const compare = (b.percentile || 0) - (a.percentile || 0);
          if (compare !== 0) return compare;
          return b.projWar - a.projWar; // Tiebreaker
      });
      percentileSorted.forEach((p, idx) => {
          percentileRankMap.set(p.playerId, idx + 1);
      });

      const isDefaultSort = this.prospectsSortKey === 'percentile' && this.prospectsSortDirection === 'desc';

      const rows = filteredProspects.map((p, idx) => {
        const cells = this.hitterProspectsColumns.map(col => {
            switch (col.key) {
                case 'rank':
                    const currentRank = idx + 1;
                    const percentileRank = percentileRankMap.get(p.playerId) || currentRank;

                    if (isDefaultSort) {
                        return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">#${percentileRank}</td>`;
                    } else {
                        return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${currentRank} <span style="font-weight: normal; font-size: 0.85em; opacity: 0.7;">(#${percentileRank})</span></td>`;
                    }
                case 'name':
                    return `<td data-col-key="name" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}" title="ID: ${p.playerId}">${p.name}</button></td>`;
                case 'position':
                    return `<td data-col-key="position" style="text-align: center;">${this.renderPositionBadge(p.position)}</td>`;
                case 'team':
                    return `<td data-col-key="team" style="text-align: left;">${this.getTeamName(p.orgId)}</td>`;
                case 'trueFutureRating':
                    return `<td data-col-key="trueFutureRating" style="text-align: center;">${this.renderRatingBadge(p.trueFutureRating)}</td>`;
                case 'projWoba':
                    return `<td data-col-key="projWoba" style="text-align: center;"><span class="badge ${this.getWobaClass(p.projWoba)}">${p.projWoba.toFixed(3)}</span></td>`;
                case 'projWar':
                    return `<td data-col-key="projWar" style="text-align: center;"><span class="badge ${this.getWarClass(p.projWar)}">${p.projWar.toFixed(1)}</span></td>`;
                case 'projIso':
                    return `<td data-col-key="projIso" style="text-align: center;">${p.projIso.toFixed(3)}</td>`;
                case 'age':
                    return `<td data-col-key="age" style="text-align: center;">${p.age}</td>`;
                case 'level':
                    return `<td data-col-key="level" style="text-align: center;"><span class="level-badge level-${p.level.toLowerCase()}">${p.level}</span></td>`;
                default:
                    return `<td></td>`;
            }
        }).join('');

        return `<tr>${cells}</tr>`;
      }).join('');

      const headerRow = this.hitterProspectsColumns.map(col => {
          const isSorted = this.prospectsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.prospectsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'name' || col.key === 'team' ? 'text-align: left;' : 'text-align: center;';
          const width = col.key === 'rank' ? 'width: 40px;' : '';
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';

          return `<th ${sortAttr} data-col-key="${col.key}" class="${activeClass}" style="${style} ${width}" draggable="true">${col.label}${sortIcon}</th>`;
      }).join('');

      return `
        <div class="stats-table-container">
            <h3 class="section-title">Top 100 Hitter Prospects <span class="note-text">(by True Future Rating)</span></h3>
            <table class="stats-table" style="width: 100%;">
                <thead>
                    <tr>
                        ${headerRow}
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
      `;
  }

  // --- REPORTS VIEW (Original) ---
  private renderReports(): string {
      const hasPitcherData = this.showPitchers && this.data;
      const hasHitterData = this.showHitters && this.hitterData;

      if (!hasPitcherData && !hasHitterData) return '<p class="no-stats">No data available for reports.</p>';

      let pitcherReports = '';
      let hitterReports = '';

      // Pitcher reports
      if (hasPitcherData && this.data) {
        const rotSorted = [...this.data.reports].sort((a, b) => b.rotationScore - a.rotationScore);
        const penSorted = [...this.data.reports].sort((a, b) => b.bullpenScore - a.bullpenScore);

        pitcherReports = `
          <div class="team-ratings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; margin-bottom: 2rem;">
              <div id="farm-rotation-rankings">
                  ${this.renderFarmCollapsible({
                      title: 'Top Future Rotations',
                      note: '(Ranked by Top 5 Peak WAR)',
                      type: 'rotation',
                      teams: rotSorted
                  })}
              </div>
              <div id="farm-bullpen-rankings">
                  ${this.renderFarmCollapsible({
                      title: 'Top Future Bullpens',
                      note: '(Ranked by Top 5 Peak WAR)',
                      type: 'bullpen',
                      teams: penSorted
                  })}
              </div>
          </div>
        `;
      }

      // Hitter reports
      if (hasHitterData && this.hitterData) {
        hitterReports = this.renderHitterReports();
      }

      return pitcherReports + hitterReports;
  }

  private renderHitterReports(): string {
    if (!this.hitterData) return '';

    // Sort organizations by total score (future lineup strength)
    const lineupSorted = [...this.hitterData.reports].sort((a, b) => b.totalScore - a.totalScore);

    // Group prospects by position for position depth rankings
    const positionGroups = this.groupHittersByPosition();

    return `
      <div class="team-ratings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
          <div id="farm-lineup-rankings">
              ${this.renderHitterLineupCollapsible({
                  title: 'Top Future Lineups',
                  note: '(Ranked by Total Farm Score)',
                  teams: lineupSorted
              })}
          </div>
          <div id="farm-position-depth">
              ${this.renderPositionDepthCollapsible({
                  title: 'Position Depth Rankings',
                  note: '(Top 5 by Position)',
                  positions: positionGroups
              })}
          </div>
      </div>
    `;
  }

  private groupHittersByPosition(): Map<string, RatedHitterProspect[]> {
    if (!this.hitterData) return new Map();

    const groups = new Map<string, RatedHitterProspect[]>();
    const positionOrder = ['C', 'SS', '2B', '3B', '1B', 'CF', 'LF', 'RF', 'DH'];

    // Initialize all positions
    for (const pos of positionOrder) {
      groups.set(pos, []);
    }

    // Group all prospects by position (convert numeric position to label)
    for (const prospect of this.hitterData.prospects) {
      const pos = getPositionLabel(prospect.position) || 'DH';
      if (!groups.has(pos)) {
        groups.set(pos, []);
      }
      groups.get(pos)!.push(prospect);
    }

    // Sort each position group by TFR
    for (const [_pos, prospects] of groups) {
      prospects.sort((a, b) => b.trueFutureRating - a.trueFutureRating);
    }

    return groups;
  }

  private renderHitterLineupCollapsible(params: {
    title: string;
    note: string;
    teams: HitterFarmSystemRankings[];
  }): string {
    const previewTeams = params.teams.slice(0, 3);
    const preview = previewTeams.length
      ? previewTeams.map((team, idx) => this.renderHitterTeamPreviewRow(team, idx + 1)).join('')
      : '<p class="no-stats">No data available.</p>';

    const fullList = params.teams.length
      ? params.teams.map((team, idx) => this.renderHitterTeamRow(team, idx + 1)).join('')
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

  private renderHitterTeamPreviewRow(team: HitterFarmSystemRankings, rank: number): string {
    const scoreClass = this.getScoreClass(team.totalScore);

    return `
      <div class="team-preview-row">
        <span class="team-preview-rank">#${rank}</span>
        <span class="team-preview-name">${team.teamName}</span>
        <span class="badge ${scoreClass} team-preview-score">${team.totalScore.toFixed(1)}</span>
      </div>
    `;
  }

  private renderHitterTeamRow(team: HitterFarmSystemRankings, rank: number): string {
    const scoreClass = this.getScoreClass(team.totalScore);
    const teamKey = `${team.teamId}-lineup`;

    return `
      <div class="team-card">
          <div class="team-header" data-team-key="${teamKey}" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; margin-bottom: 0.5rem;">
              <div style="display: flex; align-items: center; gap: 1rem;">
                  <span style="font-weight: bold; color: var(--color-text-muted); width: 20px;">#${rank}</span>
                  <span style="font-weight: 600;">${team.teamName}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 1rem;">
                   <span class="badge ${scoreClass}" style="font-size: 1.1em;">${team.totalScore.toFixed(1)}</span>
                   <span class="toggle-icon">▼</span>
              </div>
          </div>
          <div class="team-details" id="details-${teamKey}" style="display: none; padding: 0.5rem; background: var(--color-surface-hover); margin-bottom: 1rem; border-radius: 4px;">
              ${this.renderHitterTeamDetailsTable(team)}
          </div>
      </div>
    `;
  }

  private renderHitterTeamDetailsTable(team: HitterFarmSystemRankings): string {
    // Show top 8 hitters (a typical lineup)
    const players = team.allProspects.slice(0, 8);

    const columns: FarmColumn[] = [
        { key: 'position', label: 'Pos' },
        { key: 'name', label: 'Name' },
        { key: 'trueFutureRating', label: 'TFR' },
        { key: 'level', label: 'Lvl' },
        { key: 'age', label: 'Age' },
        { key: 'projWoba', label: 'wOBA' },
        { key: 'projWar', label: 'WAR' }
    ];

    const headerRow = columns.map(col => `<th>${col.label}</th>`).join('');

    const rows = players.map(player => {
      const cells = columns.map(col => `<td>${this.renderHitterCell(player, col)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const emptyRow = players.length === 0
      ? `<tr><td colspan="${columns.length}" style="text-align: center; color: var(--color-text-muted)">No qualified prospects</td></tr>`
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

  private renderHitterCell(player: RatedHitterProspect, column: FarmColumn): string {
    switch (column.key) {
      case 'position':
        return getPositionLabel(player.position) || 'DH';
      case 'name':
        return `<button class="btn-link player-name-link" data-player-id="${player.playerId}" data-player-type="hitter" title="ID: ${player.playerId}">${player.name}</button>`;
      case 'trueFutureRating':
        return this.renderRatingBadge(player.trueFutureRating);
      case 'level':
        return player.level;
      case 'age':
        return player.age.toString();
      case 'projWoba':
        const wobaClass = this.getWobaClass(player.projWoba);
        return `<span class="badge ${wobaClass}" style="padding: 2px 6px; font-size: 0.85em;">${player.projWoba.toFixed(3)}</span>`;
      case 'projWar':
        const warClass = this.getWarClass(player.projWar);
        return `<span class="badge ${warClass}" style="padding: 2px 6px; font-size: 0.85em;">${player.projWar.toFixed(1)}</span>`;
      default:
        return '';
    }
  }

  private renderPositionDepthCollapsible(params: {
    title: string;
    note: string;
    positions: Map<string, RatedHitterProspect[]>;
  }): string {
    const positionOrder = ['C', 'SS', '2B', '3B', '1B', 'CF', 'LF', 'RF'];

    // Preview: show top prospect at each key position
    const previewPositions = ['C', 'SS', 'CF'];
    const preview = previewPositions.map(pos => {
      const prospects = params.positions.get(pos) || [];
      if (prospects.length === 0) return '';
      const top = prospects[0];
      return `
        <div class="team-preview-row">
          <span class="team-preview-rank">${pos}</span>
          <span class="team-preview-name">${top.name}</span>
          <span class="badge ${this.getRatingClass(top.trueFutureRating)} team-preview-score">${top.trueFutureRating.toFixed(1)}</span>
        </div>
      `;
    }).join('');

    // Full list: all positions with top 5 at each
    const fullList = positionOrder.map(pos => {
      const prospects = params.positions.get(pos) || [];
      const top5 = prospects.slice(0, 5);

      if (top5.length === 0) return '';

      const rows = top5.map((p, idx) => `
        <tr>
          <td style="width: 30px; text-align: center; color: var(--color-text-muted);">${idx + 1}</td>
          <td><button class="btn-link player-name-link" data-player-id="${p.playerId}" data-player-type="hitter" title="ID: ${p.playerId}">${p.name}</button></td>
          <td>${p.team || 'FA'}</td>
          <td>${this.renderRatingBadge(p.trueFutureRating)}</td>
          <td>${p.projWoba.toFixed(3)}</td>
        </tr>
      `).join('');

      return `
        <div style="margin-bottom: 1rem;">
          <h4 style="margin: 0.5rem 0; font-size: 0.95em; color: var(--color-text-secondary);">${pos}</h4>
          <table class="stats-table" style="width: 100%; font-size: 0.85em;">
            <thead>
              <tr><th>#</th><th>Name</th><th>Team</th><th>TFR</th><th>wOBA</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    }).join('');

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

  private getRatingClass(rating: number): string {
    if (rating >= 4.5) return 'rating-elite';
    if (rating >= 4.0) return 'rating-plus';
    if (rating >= 3.0) return 'rating-avg';
    if (rating >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  private renderFarmCollapsible(params: {
    title: string;
    note: string;
    type: 'rotation' | 'bullpen';
    teams: FarmSystemRankings[];
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

  private renderTeamPreviewRow(team: FarmSystemRankings, rank: number, type: 'rotation' | 'bullpen'): string {
      const score = type === 'rotation' ? team.rotationScore : team.bullpenScore;
      const scoreClass = this.getScoreClass(score);

      return `
        <div class="team-preview-row">
          <span class="team-preview-rank">#${rank}</span>
          <span class="team-preview-name">${team.teamName}</span>
          <span class="badge ${scoreClass} team-preview-score">${score.toFixed(1)}</span>
        </div>
      `;
  }

  private renderTeamRow(team: FarmSystemRankings, rank: number, type: 'rotation' | 'bullpen'): string {
      const score = type === 'rotation' ? team.rotationScore : team.bullpenScore;
      const scoreClass = this.getScoreClass(score);
      const teamKey = `${team.teamId}-${type}`;
      
      return `
        <div class="team-card">
            <div class="team-header" data-team-key="${teamKey}" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 4px; margin-bottom: 0.5rem;">
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <span style="font-weight: bold; color: var(--color-text-muted); width: 20px;">#${rank}</span>
                    <span style="font-weight: 600;">${team.teamName}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                     <span class="badge ${scoreClass}" style="font-size: 1.1em;">${score.toFixed(1)}</span>
                     <span class="toggle-icon">▼</span>
                </div>
            </div>
            <div class="team-details" id="details-${teamKey}" style="display: none; padding: 0.5rem; background: var(--color-surface-hover); margin-bottom: 1rem; border-radius: 4px;">
                ${this.renderTeamDetailsTable(team, type)}
            </div>
        </div>
      `;
  }

  private renderTeamDetailsTable(team: FarmSystemRankings, type: 'rotation' | 'bullpen'): string {
    const players = type === 'rotation' ? team.rotation : team.bullpen;
    
    // Columns
    const columns: FarmColumn[] = [
        { key: 'name', label: 'Name' },
        { key: 'trueFutureRating', label: 'TFR' },
        { key: 'level', label: 'Lvl' },
        { key: 'age', label: 'Age' },
        { key: 'peakFip', label: 'Peak FIP' },
        { key: 'peakWar', label: 'Peak WAR' }
    ];

    const headerRow = columns.map(col => `<th>${col.label}</th>`).join('');

    const rows = players.map(player => {
      const cells = columns.map(col => `<td>${this.renderCell(player, col)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    const emptyRow = players.length === 0
      ? `<tr><td colspan="${columns.length}" style="text-align: center; color: var(--color-text-muted)">No qualified prospects</td></tr>`
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

  private renderCell(player: RatedProspect, column: FarmColumn): string {
    switch (column.key) {
      case 'name':
        return `<button class="btn-link player-name-link" data-player-id="${player.playerId}" title="ID: ${player.playerId}">${player.name}</button>`;
      case 'trueFutureRating':
        return this.renderRatingBadge(player.trueFutureRating);
      case 'level':
        return player.level;
      case 'age':
        return player.age.toString();
      case 'peakFip':
        return player.peakFip.toFixed(2);
      case 'peakWar':
        const warClass = this.getWarClass(player.peakWar);
        return `<span class="badge ${warClass}" style="padding: 2px 6px; font-size: 0.85em;">${player.peakWar.toFixed(1)}</span>`;
      default:
        return '';
    }
  }

  private renderRatingBadge(value: number): string {
    let className = 'rating-poor';
    if (value >= 4.5) className = 'rating-elite';
    else if (value >= 4.0) className = 'rating-plus';
    else if (value >= 3.0) className = 'rating-avg';
    else if (value >= 2.0) className = 'rating-fringe';

    return `<span class="badge ${className}">${value.toFixed(1)}</span>`;
  }

  private getScoreClass(score: number): string {
      if (score >= 25) return 'rating-elite';
      if (score >= 15) return 'rating-plus';
      if (score >= 10) return 'rating-avg';
      if (score >= 5) return 'rating-fringe';
      return 'rating-poor';
  }

  private getWarClass(war: number): string {
      if (war >= 6) return 'rating-elite';
      if (war >= 4) return 'rating-plus';
      if (war >= 2) return 'rating-avg';
      if (war >= 0) return 'rating-fringe';
      return 'rating-poor';
  }

  private getWobaClass(woba: number): string {
      if (woba >= 0.400) return 'rating-elite';
      if (woba >= 0.360) return 'rating-plus';
      if (woba >= 0.320) return 'rating-avg';
      if (woba >= 0.290) return 'rating-fringe';
      return 'rating-poor';
  }

  private renderPositionBadge(position: number | null, isPitcher: boolean = false): string {
    let posLabel: string;
    let className: string;
    let title: string;

    if (isPitcher) {
      // For pitchers, just use a generic pitcher badge
      posLabel = 'P';
      className = 'pos-utility';
      title = 'Pitcher';
    } else {
      posLabel = getPositionLabel(position || 0);
      // For hitters, map position to defensive group
      switch (position as number) {
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
    }

    return `<span class="badge ${className}" title="${title}">${posLabel}</span>`;
  }



  private bindToggleEvents(): void {
      this.container.querySelectorAll('.team-header').forEach(header => {
          header.addEventListener('click', () => {
              const teamKey = (header as HTMLElement).dataset.teamKey;
              const details = this.container.querySelector(`#details-${teamKey}`);
              const icon = header.querySelector('.toggle-icon');
              
              if (details && icon) {
                  const isHidden = (details as HTMLElement).style.display === 'none';
                  (details as HTMLElement).style.display = isHidden ? 'block' : 'none';
                  icon.textContent = isHidden ? '▲' : '▼';
              }
          });
      });
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
      // 1. Fetch Player & Team Data
      const player = await playerService.getPlayerById(playerId);
      if (!player) return;

      let teamLabel = '';
      let parentLabel = '';
      if (player.teamId) {
          const team = await teamService.getTeamById(player.teamId);
          if (team) {
              teamLabel = `${team.name} ${team.nickname}`;
              if (team.parentTeamId !== 0) {
                  const parent = await teamService.getTeamById(team.parentTeamId);
                  if (parent) parentLabel = parent.nickname;
              }
          }
      }

      // Check if player is a hitter
      if (!isPitcher(player)) {
          await this.openHitterProfile(playerId, player, teamLabel, parentLabel);
          return;
      }

      // 2. Fetch Scouting Data (My & OSA) for pitchers
      const [myScoutingRatings, osaScoutingRatings] = await Promise.all([
        scoutingDataService.getLatestScoutingRatings('my'),
        scoutingDataService.getLatestScoutingRatings('osa')
      ]);

      const myScoutingLookup = this.buildScoutingLookup(myScoutingRatings);
      const osaScoutingLookup = this.buildScoutingLookup(osaScoutingRatings);

      const myScouting = this.resolveScouting(playerId, getFullName(player), myScoutingLookup);
      const osaScouting = this.resolveScouting(playerId, getFullName(player), osaScoutingLookup);

      // Get TFR Data from our View Model
      // Use the `prospect` object from `this.data` for TFR specific values
      let prospect = this.data?.prospects.find(p => p.playerId === playerId);

      // If looking at a non-prospect (e.g. from expanded list but maybe they graduated?), fallback
      // But Farm Rankings only shows prospects.

      pitcherProfileModal.show({
          playerId: player.id,
          playerName: getFullName(player),
          team: teamLabel,
          parentTeam: parentLabel,
          age: player.age,
          positionLabel: getPositionLabel(player.position),

          // True Ratings (Current) - prospects usually don't have valid ones, handled by modal
          trueRating: undefined,

          // TR = current ability from development curves (precomputed on RatedProspect)
          estimatedStuff: prospect?.developmentTR?.stuff ?? prospect?.trueRatings?.stuff,
          estimatedControl: prospect?.developmentTR?.control ?? prospect?.trueRatings?.control,
          estimatedHra: prospect?.developmentTR?.hra ?? prospect?.trueRatings?.hra,

          // Scout data (modal fetches its own, these are fallbacks)
          scoutStuff: myScouting?.stuff,
          scoutControl: myScouting?.control,
          scoutHra: myScouting?.hra,
          scoutStamina: myScouting?.stamina,
          injuryProneness: myScouting?.injuryProneness ?? osaScouting?.injuryProneness,
          scoutOvr: (myScouting as any)?.ovr,
          scoutPot: (myScouting as any)?.pot,

          // Peak projection data (precomputed from TFR pipeline)
          projK9: prospect?.projK9,
          projBb9: prospect?.projBb9,
          projHr9: prospect?.projHr9,
          projIp: prospect?.peakIp,

          // TFR
          isProspect: true,
          trueFutureRating: prospect?.trueFutureRating,
          tfrPercentile: prospect?.percentile,
          hasTfrUpside: true,
          tfrStuff: prospect?.trueRatings?.stuff,
          tfrControl: prospect?.trueRatings?.control,
          tfrHra: prospect?.trueRatings?.hra,
          tfrBySource: prospect?.tfrBySource,
      }, this.selectedYear);
  }

  private async openHitterProfile(playerId: number, player: any, teamLabel: string, parentLabel: string): Promise<void> {
      // Fetch hitter scouting data (my scout only - modal will fetch OSA separately)
      const myScoutingAll = await hitterScoutingDataService.getLatestScoutingRatings('my');
      const myScouting = myScoutingAll.find(s => s.playerId === playerId);

      // Find hitter prospect data from our loaded data
      const hitterProspect = this.hitterData?.prospects.find(p => p.playerId === playerId);

      // TR = current ability from development-curve-based estimation (precomputed)
      const devTR = hitterProspect?.developmentTR;
      const tfrR = hitterProspect?.trueRatings;
      const estimatedEye = devTR?.eye ?? tfrR?.eye;
      const estimatedAvoidK = devTR?.avoidK ?? tfrR?.avoidK;
      const estimatedPower = devTR?.power ?? tfrR?.power;
      const estimatedContact = devTR?.contact ?? tfrR?.contact;
      const estimatedGap = devTR?.gap ?? tfrR?.gap ?? hitterProspect?.scoutingRatings.gap;
      const estimatedSpeed = devTR?.speed ?? tfrR?.speed ?? hitterProspect?.scoutingRatings.speed;

      // Build batter profile data
      // Farm prospects: trueRating is undefined (no MLB stats), trueFutureRating carries TFR
      const batterData: BatterProfileData = {
          playerId: player.id,
          playerName: getFullName(player),
          team: teamLabel,
          parentTeam: parentLabel,
          age: player.age,
          position: player.position,
          positionLabel: getPositionLabel(player.position),

          // No MLB TR for farm prospects — badge logic will show TFR via trueFutureRating
          trueRating: undefined,
          percentile: undefined,

          // Estimated ratings derived from projected stats
          estimatedPower,
          estimatedEye,
          estimatedAvoidK,
          estimatedContact,
          estimatedGap,
          estimatedSpeed,

          // Scout data (my)
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
          injuryProneness: myScouting?.injuryProneness ?? hitterProspect?.injuryProneness,

          // Projected stats from TFR data
          projWoba: hitterProspect?.projWoba,
          projAvg: hitterProspect?.projAvg,
          projObp: hitterProspect?.projObp,
          projSlg: hitterProspect?.projSlg,
          projPa: hitterProspect?.projPa,
          projWar: hitterProspect?.projWar,
          projWrcPlus: hitterProspect?.wrcPlus,
          projBbPct: hitterProspect?.projBbPct,
          projKPct: hitterProspect?.projKPct,
          projHrPct: hitterProspect?.projHrPct,

          // TFR data — pure prospects always have TFR upside
          isProspect: true,
          trueFutureRating: hitterProspect?.trueFutureRating,
          tfrPercentile: hitterProspect?.percentile,
          hasTfrUpside: true,
          tfrPower: hitterProspect?.trueRatings.power,
          tfrEye: hitterProspect?.trueRatings.eye,
          tfrAvoidK: hitterProspect?.trueRatings.avoidK,
          tfrContact: hitterProspect?.trueRatings.contact,
          tfrGap: hitterProspect?.trueRatings.gap,
          tfrSpeed: hitterProspect?.trueRatings.speed,
          tfrBbPct: hitterProspect?.projBbPct,
          tfrKPct: hitterProspect?.projKPct,
          tfrHrPct: hitterProspect?.projHrPct,
          tfrAvg: hitterProspect?.projAvg,
          tfrObp: hitterProspect?.projObp,
          tfrSlg: hitterProspect?.projSlg,
          tfrBySource: hitterProspect?.tfrBySource,
      };

      await batterProfileModal.show(batterData, this.selectedYear);
  }

  private buildScoutingLookup(ratings: PitcherScoutingRatings[]): { byId: Map<number, PitcherScoutingRatings>, byName: Map<string, PitcherScoutingRatings[]> } {
    const byId = new Map<number, PitcherScoutingRatings>();
    const byName = new Map<string, PitcherScoutingRatings[]>();

    ratings.forEach((rating) => {
      if (rating.playerId > 0) {
        byId.set(rating.playerId, rating);
      }

      if (rating.playerName) {
        const normalized = this.normalizeName(rating.playerName);
        if (!normalized) return;
        const list = byName.get(normalized) ?? [];
        list.push(rating);
        byName.set(normalized, list);
      }
    });

    return { byId, byName };
  }

  private resolveScouting(playerId: number, playerName: string, lookup: { byId: Map<number, PitcherScoutingRatings>, byName: Map<string, PitcherScoutingRatings[]> }): PitcherScoutingRatings | undefined {
      const byId = lookup.byId.get(playerId);
      if (byId) return byId;
      
      const normalized = this.normalizeName(playerName);
      const byName = lookup.byName.get(normalized);
      if (byName && byName.length === 1) return byName[0];
      
      return undefined;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }

  private getTeamName(teamId: number): string {
      // Helper to find team name from systems data
      if (this.data) {
          const sys = this.data.systems.find(s => s.teamId === teamId);
          if (sys) return sys.teamName;
      }
      if (this.hitterData) {
          const sys = this.hitterData.systems.find(s => s.teamId === teamId);
          if (sys) return sys.teamName;
      }
      return 'Org';
  }

  private getProspectPercentile(playerId: number, isPitcher: boolean): number {
    if (isPitcher && this.data) {
      const p = this.data.prospects.find(p => p.playerId === playerId);
      return p?.percentile ?? 0;
    } else if (!isPitcher && this.hitterData) {
      const p = this.hitterData.prospects.find(p => p.playerId === playerId);
      return p?.percentile ?? 0;
    }
    return 0;
  }

  private getDynamicThresholds(values: number[]): { high: number; mid: number; low: number } {
    if (values.length === 0) return { high: 0, mid: 0, low: 0 };
    
    // Sort ascending
    const sorted = [...values].sort((a, b) => a - b);
    
    const getPercentileValue = (percentile: number) => {
        if (percentile <= 0) return sorted[0];
        if (percentile >= 1) return sorted[sorted.length - 1];
        
        const index = (sorted.length - 1) * percentile;
        const lower = Math.floor(index);
        const upper = Math.ceil(index);
        const weight = index - lower;
        
        if (lower === upper) return sorted[lower];
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    };

    // Thresholds:
    // High (Elite Color): Top 15% (85th percentile)
    // Mid (Good Color): Top 40% (60th percentile)
    // Low (Avg Color): Top 75% (25th percentile)
    // Below Low -> Fringe/Poor Color
    
    return {
        high: Math.ceil(getPercentileValue(0.85)), 
        mid: Math.ceil(getPercentileValue(0.60)),
        low: Math.ceil(getPercentileValue(0.25))
    };
  }

  private renderTierCountBadge(count: number, thresholds: { high: number; mid: number; low: number }): string {
      if (count === 0) return `<span class="badge" style="background-color: transparent; color: var(--color-text-muted); box-shadow: none;">0</span>`;
      
      let className = 'rating-fringe'; // Default for bottom tier
      
      if (count >= thresholds.high) className = 'rating-elite';
      else if (count >= thresholds.mid) className = 'rating-plus';
      else if (count >= thresholds.low) className = 'rating-avg';
      
      return `<span class="badge ${className}">${count}</span>`;
  }

  /**
   * Export TFR data in format needed for automated validation tests.
   * Downloads as JSON file that can be used with tfr_automated_validation.ts
   */
  private exportTFRForTesting(): void {
      if (!this.data || !this.data.prospects || this.data.prospects.length === 0) {
          alert('No prospect data to export. Load farm rankings first.');
          return;
      }

      // Map prospects to test format (NEW: includes percentile data)
      const prospects = this.data.prospects.map(p => ({
          playerId: p.playerId,
          name: p.name,
          age: p.age,
          level: p.level,
          tfr: p.trueFutureRating,
          tfrPercentile: p.percentile,
          stuffPercentile: p.stuffPercentile,
          controlPercentile: p.controlPercentile,
          hraPercentile: p.hraPercentile,
          projFip: p.peakFip,
          projK9: p.projK9,
          projBb9: p.projBb9,
          projHr9: p.projHr9,
          projWar: p.peakWar,
          projIp: p.stats.ip
      }));

      const output = {
          algorithm: 'percentile-based-v2',
          year: this.selectedYear,
          generated: new Date().toISOString(),
          totalProspects: prospects.length,
          prospects: prospects
      };

      // Create downloadable JSON file
      const dataStr = JSON.stringify(output, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement('a');
      link.href = url;
      link.download = `tfr_prospects_${this.selectedYear}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      console.log(`✅ Exported ${prospects.length} prospects for ${this.selectedYear}`);
      console.log('Save this file to: tools/reports/tfr_prospects_' + this.selectedYear + '.json');
      console.log('Then run: npx ts-node tools/research/tfr_automated_validation.ts');
  }
}