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
import { PlayerProfileModal } from './PlayerProfileModal';
import { batterProfileModal, BatterProfileData } from './BatterProfileModal';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { trueRatingsService } from '../services/TrueRatingsService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { getPositionLabel, getFullName, isPitcher } from '../models/Player';
import { HitterRatingEstimatorService } from '../services/HitterRatingEstimatorService';
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
  private playerProfileModal: PlayerProfileModal;
  private yearOptions = Array.from({ length: 6 }, (_, i) => 2021 - i); // 2021 down to 2016
  private top100Prospects: RatedProspect[] = [];
  private top100HitterProspects: RatedHitterProspect[] = [];
  private selectedTeam: string = 'all';

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
    { key: 'elite', label: 'Elite', sortKey: 'elite', title: 'Elite (4.5+ TFR)' },
    { key: 'aboveAvg', label: 'Good', sortKey: 'aboveAvg', title: 'Above Average (3.5-4.0 TFR)' },
    { key: 'average', label: 'Avg', sortKey: 'average', title: 'Average (2.5-3.0 TFR)' },
    { key: 'fringe', label: 'Depth', sortKey: 'fringe', title: 'Fringe (< 2.5 TFR)' }
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
    { key: 'wrcPlus', label: 'wRC+', sortKey: 'wrcPlus', title: 'Weighted Runs Created Plus (100 = league average)' },
    { key: 'projWar', label: 'WAR', sortKey: 'projWar', title: 'Projected Batting WAR' },
    { key: 'projWoba', label: 'wOBA', sortKey: 'projWoba', title: 'Projected weighted On-Base Average' },
    { key: 'age', label: 'Age', sortKey: 'age' },
    { key: 'level', label: 'Level', sortKey: 'level' }
  ];

  private combinedProspectsColumns: FarmColumn[] = [
    { key: 'rank', label: '#' },
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
    this.playerProfileModal = new PlayerProfileModal();
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

              <button class="toggle-btn active" data-prospect-type="pitchers" aria-pressed="true">Pitchers</button>
              <button class="toggle-btn active" data-prospect-type="hitters" aria-pressed="true">Hitters</button>
              <span class="filter-separator"></span>

              <button class="toggle-btn active" data-view-mode="top-systems" aria-pressed="true">Top Systems</button>
              <button class="toggle-btn" data-view-mode="top-100" aria-pressed="false">Top 100</button>
              
              <div class="filter-dropdown" data-filter="team" style="display: none;">
                <button class="filter-dropdown-btn" aria-haspopup="true" aria-expanded="false">
                  Team: <span id="selected-team-display">All</span> ▾
                </button>
                <div class="filter-dropdown-menu" id="team-dropdown-menu">
                  <div class="filter-dropdown-item selected" data-value="all">All</div>
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

  private async loadData(): Promise<void> {
    try {
        // Load data based on which toggles are active
        const loadPromises: Promise<void>[] = [];

        if (this.showPitchers) {
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

        if (this.showHitters) {
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
      const hasPitcherData = this.showPitchers && this.data !== null;
      const hasHitterData = this.showHitters && this.hitterData !== null;
      if (!hasPitcherData && !hasHitterData) return;

      const content = this.container.querySelector('#farm-content-area');
      if (!content) return;

      this.sortData();

      const teamFilter = this.container.querySelector<HTMLElement>('[data-filter="team"]');
      if (teamFilter) {
          teamFilter.style.display = this.viewMode === 'top-100' ? 'inline-block' : 'none';
      }

      // Show reports button - now supports both pitchers and hitters
      const reportsBtn = this.container.querySelector<HTMLElement>('[data-view-mode="reports"]');
      if (reportsBtn) {
          reportsBtn.style.display = '';
      }

      switch (this.viewMode) {
          case 'top-systems':
              content.innerHTML = this.renderCombinedTopSystems();
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
      const sections: string[] = [];

      if (this.showPitchers && this.data && this.data.systems.length > 0) {
          sections.push(this.renderTopSystems());
      }
      if (this.showHitters && this.hitterData && this.hitterData.systems.length > 0) {
          sections.push(this.renderHitterTopSystems());
      }

      if (sections.length === 0) {
          return '<p class="no-stats">No system data available.</p>';
      }

      return sections.join('');
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

      // Sort by selected column or default to percentile
      combined.sort((a, b) => {
          let aVal: any;
          let bVal: any;

          // Map sort key to UnifiedProspect field
          if (this.prospectsSortKey === 'percentile') {
              aVal = a.percentile;
              bVal = b.percentile;
              // Break ties with peakWar
              if (aVal === bVal) {
                  const aWar = a.peakWar;
                  const bWar = b.peakWar;
                  const compare = aWar - bWar;
                  return this.prospectsSortDirection === 'asc' ? compare : -compare;
              }
          } else if (this.prospectsSortKey === 'trueFutureRating') {
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

      // Filter by team if selected
      const filtered = this.selectedTeam === 'all'
          ? combined.slice(0, 100)
          : combined.filter(p => p.team === this.selectedTeam).slice(0, 100);

      if (filtered.length === 0) {
          return '<p class="no-stats">No prospects found for this team.</p>';
      }

      const isDefaultSort = this.prospectsSortKey === 'percentile' && this.prospectsSortDirection === 'desc';
      const rows = filtered.map((p, idx) => {
          const cells = this.combinedProspectsColumns.map(col => {
              switch (col.key) {
                  case 'rank':
                      const rankText = isDefaultSort
                          ? `#${p.originalRank}`
                          : `${idx + 1} <span style="font-weight: normal; font-size: 0.85em; opacity: 0.7;">(#${p.originalRank})</span>`;
                      return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${rankText}</td>`;
                  case 'name':
                      return `<td data-col-key="name" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}">${p.name}</button></td>`;
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
  private renderTopSystems(): string {
      if (!this.data || this.data.systems.length === 0) return '<p class="no-stats">No system data available.</p>';

      const rows = this.data.systems.map((sys, idx) => {
        // Find corresponding report data for full prospect list
        const report = this.data?.reports.find(r => r.teamId === sys.teamId);
        const allProspects = report ? report.allProspects : [];
        const systemKey = `sys-${sys.teamId}`;

        const cells = this.systemsColumns.map(col => {
            switch (col.key) {
                case 'rank':
                    return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>`;
                case 'teamName':
                    return `
                        <td data-col-key="teamName" style="font-weight: 600; text-align: left;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="toggle-icon" style="font-size: 0.8em; width: 12px;">▶</span>
                                ${sys.teamName}
                            </div>
                        </td>`;
                case 'totalWar':
                    return `<td data-col-key="totalWar" style="text-align: center; padding-right: 100px;">${this.renderFarmScoreFlip(sys)}</td>`;
                case 'topProspectName':
                    return `<td data-col-key="topProspectName" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${sys.topProspectId}">${sys.topProspectName}</button></td>`;
                case 'elite':
                    return `<td data-col-key="elite" style="text-align: center;">${sys.tierCounts.elite > 0 ? `<span class="badge rating-elite">${sys.tierCounts.elite}</span>` : '-'}</td>`;
                case 'aboveAvg':
                    return `<td data-col-key="aboveAvg" style="text-align: center;">${sys.tierCounts.aboveAvg > 0 ? `<span class="badge rating-plus">${sys.tierCounts.aboveAvg}</span>` : '-'}</td>`;
                case 'average':
                    return `<td data-col-key="average" style="text-align: center;">${sys.tierCounts.average > 0 ? `<span class="badge rating-avg">${sys.tierCounts.average}</span>` : '-'}</td>`;
                case 'fringe':
                    return `<td data-col-key="fringe" style="text-align: center;">${sys.tierCounts.fringe > 0 ? `<span class="badge rating-fringe">${sys.tierCounts.fringe}</span>` : '-'}</td>`;
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
                    ${this.renderSystemDetails(allProspects)}
                </div>
            </td>
        </tr>
      `}).join('');

      // Add a script/handler call to bind these new toggles
      setTimeout(() => this.bindSystemToggles(), 0);

      const headerRow = this.systemsColumns.map(col => {
          const isSorted = this.systemsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.systemsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'teamName' || col.key === 'topProspectName' ? 'text-align: left;' : 'text-align: center;';
          let width = '';
          let padding = '';
          if (col.key === 'rank') width = 'width: 40px;';
          else if (col.key === 'teamName') width = 'width: 18%;';
          else if (col.key === 'totalWar') {width = 'width: 12%;', padding = 'padding-right: 100px;'};
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
          const titleAttr = col.title ? `title="${col.title}"` : '';

          return `<th ${sortAttr} ${titleAttr} data-col-key="${col.key}" class="${activeClass}" style="${style} ${width} ${padding}" draggable="true">${col.label}${sortIcon}</th>`;
      }).join('');

      return `
        <div class="stats-table-container">
            <h3 class="section-title">Organizational Rankings <span class="note-text">(by True Farm Rating)</span></h3>
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

  private renderSystemDetails(prospects: RatedProspect[]): string {
    if (prospects.length === 0) return '<p class="no-stats">No prospects found.</p>';

    const columns: FarmColumn[] = [
        { key: 'name', label: 'Name', sortKey: 'name' },
        { key: 'trueFutureRating', label: 'TFR', sortKey: 'trueFutureRating' },
        { key: 'level', label: 'Lvl', sortKey: 'level' },
        { key: 'age', label: 'Age', sortKey: 'age' },
        { key: 'peakFip', label: 'Peak FIP', sortKey: 'peakFip' },
        { key: 'peakWar', label: 'Peak WAR', sortKey: 'peakWar' }
    ];

    const headerRow = columns.map(col => {
      const style = col.key === 'name' ? 'text-align: left;' : 'text-align: center;';
      return `<th data-col-key="${col.key}" data-sort-key="${col.sortKey}" style="${style} position: sticky; top: 0; background-color: var(--color-surface); z-index: 10; box-shadow: inset 0 -1px 0 var(--color-border);" draggable="true">${col.label}</th>`;
    }).join('');

    const rows = prospects.map(player => {
      const cells = columns.map(col => {
        const style = col.key === 'name' ? 'style="text-align: left;"' : '';
        return `<td ${style} data-col-key="${col.key}">${this.renderCell(player, col)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <table class="stats-table team-ratings-table nested-system-table" style="width: 100%; font-size: 0.9em; border-collapse: separate; border-spacing: 0;">
        <thead>
          <tr>${headerRow}</tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  }

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

      const filteredProspects = this.selectedTeam === 'all'
          ? this.top100Prospects
          : this.top100Prospects.filter(p => this.getTeamName(p.orgId) === this.selectedTeam);

      if (filteredProspects.length === 0) return '<p class="no-stats">No top 100 prospects found for this team.</p>';

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
                    return `<td data-col-key="name" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}">${p.name}</button></td>`;
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

  // --- HITTER TOP SYSTEMS VIEW ---
  private renderHitterTopSystems(): string {
      if (!this.hitterData || this.hitterData.systems.length === 0) return '<p class="no-stats">No hitter system data available.</p>';

      const rows = this.hitterData.systems.map((sys, idx) => {
        const report = this.hitterData?.reports.find(r => r.teamId === sys.teamId);
        const allProspects = report ? report.allProspects : [];
        const systemKey = `sys-hitter-${sys.teamId}`;

        const cells = this.systemsColumns.map(col => {
            switch (col.key) {
                case 'rank':
                    return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>`;
                case 'teamName':
                    return `
                        <td data-col-key="teamName" style="font-weight: 600; text-align: left;">
                            <div style="display: flex; align-items: center; gap: 0.5rem;">
                                <span class="toggle-icon" style="font-size: 0.8em; width: 12px;">▶</span>
                                ${sys.teamName}
                            </div>
                        </td>`;
                case 'totalWar':
                    return `<td data-col-key="totalWar" style="text-align: center; padding-right: 100px;">${this.renderHitterFarmScoreFlip(sys)}</td>`;
                case 'topProspectName':
                    return `<td data-col-key="topProspectName" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${sys.topProspectId}">${sys.topProspectName}</button></td>`;
                case 'elite':
                    return `<td data-col-key="elite" style="text-align: center;">${sys.tierCounts.elite > 0 ? `<span class="badge rating-elite">${sys.tierCounts.elite}</span>` : '-'}</td>`;
                case 'aboveAvg':
                    return `<td data-col-key="aboveAvg" style="text-align: center;">${sys.tierCounts.aboveAvg > 0 ? `<span class="badge rating-plus">${sys.tierCounts.aboveAvg}</span>` : '-'}</td>`;
                case 'average':
                    return `<td data-col-key="average" style="text-align: center;">${sys.tierCounts.average > 0 ? `<span class="badge rating-avg">${sys.tierCounts.average}</span>` : '-'}</td>`;
                case 'fringe':
                    return `<td data-col-key="fringe" style="text-align: center;">${sys.tierCounts.fringe > 0 ? `<span class="badge rating-fringe">${sys.tierCounts.fringe}</span>` : '-'}</td>`;
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
                    ${this.renderHitterSystemDetails(allProspects)}
                </div>
            </td>
        </tr>
      `}).join('');

      setTimeout(() => this.bindSystemToggles(), 0);

      const headerRow = this.systemsColumns.map(col => {
          const isSorted = this.systemsSortKey === col.sortKey;
          const sortIcon = isSorted ? (this.systemsSortDirection === 'asc' ? ' ▴' : ' ▾') : '';
          const activeClass = isSorted ? 'sort-active' : '';
          const style = col.key === 'teamName' || col.key === 'topProspectName' ? 'text-align: left;' : 'text-align: center;';
          let width = '';
          let padding = '';
          if (col.key === 'rank') width = 'width: 40px;';
          else if (col.key === 'teamName') width = 'width: 18%;';
          else if (col.key === 'totalWar') {width = 'width: 12%;', padding = 'padding-right: 100px;'};
          const sortAttr = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
          const titleAttr = col.title ? `title="${col.title}"` : '';

          return `<th ${sortAttr} ${titleAttr} data-col-key="${col.key}" class="${activeClass}" style="${style} ${width} ${padding}" draggable="true">${col.label}${sortIcon}</th>`;
      }).join('');

      return `
        <div class="stats-table-container">
            <h3 class="section-title">Hitter Farm Rankings <span class="note-text">(by True Farm Rating)</span></h3>
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

  private renderHitterFarmScoreFlip(sys: HitterFarmSystemOverview): string {
      return `
        <div class="flip-cell" style="width: auto; height: auto; min-width: 50px;">
            <div class="flip-cell-inner">
                <div class="flip-cell-front">
                    <span class="badge ${this.getScoreClass(sys.totalScore)}">${sys.totalScore}</span>
                </div>
                <div class="flip-cell-back" style="background-color: var(--color-surface); padding: 2px 4px; border-radius: 4px; box-shadow: 0 0 4px rgba(0,0,0,0.5); left: 50%; translate: -50%;">
                    <span class="badge rating-avg">${sys.prospectCount} prospects</span>
                </div>
            </div>
        </div>
      `;
  }

  private renderHitterSystemDetails(prospects: RatedHitterProspect[]): string {
      if (prospects.length === 0) return '<p class="no-stats">No hitter prospects.</p>';

      const rows = prospects.map((p, idx) => `
        <tr>
            <td style="font-weight: bold; color: var(--color-text-muted);">${idx + 1}</td>
            <td style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}">${p.name}</button></td>
            <td style="text-align: center;">${getPositionLabel(p.position)}</td>
            <td style="text-align: center;">${this.renderRatingBadge(p.trueFutureRating)}</td>
            <td style="text-align: center;"><span class="badge ${this.getWrcPlusClass(p.wrcPlus)}">${Math.round(p.wrcPlus)}</span></td>
            <td style="text-align: center;"><span class="badge ${this.getWarClass(p.projWar)}">${p.projWar.toFixed(1)}</span></td>
            <td style="text-align: center;">${p.projWoba.toFixed(3)}</td>
            <td style="text-align: center;">${p.age}</td>
            <td style="text-align: center;"><span class="level-badge level-${p.level.toLowerCase()}">${p.level}</span></td>
        </tr>
      `).join('');

      return `
        <table class="stats-table nested-system-table" style="width: 100%;">
            <thead>
                <tr>
                    <th style="width: 30px;">#</th>
                    <th style="text-align: left;">Name</th>
                    <th style="text-align: center;">Pos</th>
                    <th style="text-align: center;">TFR</th>
                    <th style="text-align: center;" title="Weighted Runs Created Plus (100 = league average)">wRC+</th>
                    <th style="text-align: center;" title="Projected Batting WAR">WAR</th>
                    <th style="text-align: center;" title="Projected weighted On-Base Average">wOBA</th>
                    <th style="text-align: center;">Age</th>
                    <th style="text-align: center;">Level</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
      `;
  }

  // --- HITTER TOP 100 PROSPECTS VIEW ---
  private renderHitterTopProspects(): string {
      if (!this.hitterData || this.hitterData.prospects.length === 0) return '<p class="no-stats">No hitter prospect data available.</p>';

      const filteredProspects = this.selectedTeam === 'all'
          ? this.top100HitterProspects
          : this.top100HitterProspects.filter(p => this.getTeamName(p.orgId) === this.selectedTeam);

      if (filteredProspects.length === 0) return '<p class="no-stats">No top 100 hitter prospects found for this team.</p>';

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
                    return `<td data-col-key="name" style="text-align: left;"><button class="btn-link player-name-link" data-player-id="${p.playerId}">${p.name}</button></td>`;
                case 'position':
                    return `<td data-col-key="position" style="text-align: center;">${this.renderPositionBadge(p.position)}</td>`;
                case 'team':
                    return `<td data-col-key="team" style="text-align: left;">${this.getTeamName(p.orgId)}</td>`;
                case 'trueFutureRating':
                    return `<td data-col-key="trueFutureRating" style="text-align: center;">${this.renderRatingBadge(p.trueFutureRating)}</td>`;
                case 'wrcPlus':
                    return `<td data-col-key="wrcPlus" style="text-align: center;"><span class="badge ${this.getWrcPlusClass(p.wrcPlus)}">${Math.round(p.wrcPlus)}</span></td>`;
                case 'projWar':
                    return `<td data-col-key="projWar" style="text-align: center;"><span class="badge ${this.getWarClass(p.projWar)}">${p.projWar.toFixed(1)}</span></td>`;
                case 'projWoba':
                    return `<td data-col-key="projWoba" style="text-align: center;">${p.projWoba.toFixed(3)}</td>`;
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

    // Group all prospects by position
    for (const prospect of this.hitterData.prospects) {
      const pos = String(prospect.position || 'DH');
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
        { key: 'wrcPlus', label: 'wRC+' },
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
        return String(player.position || 'DH');
      case 'name':
        return `<button class="btn-link player-name-link" data-player-id="${player.playerId}" data-player-type="hitter">${player.name}</button>`;
      case 'trueFutureRating':
        return this.renderRatingBadge(player.trueFutureRating);
      case 'level':
        return player.level;
      case 'age':
        return player.age.toString();
      case 'wrcPlus':
        const wrcClass = this.getWrcPlusClass(player.wrcPlus);
        return `<span class="badge ${wrcClass}" style="padding: 2px 6px; font-size: 0.85em;">${player.wrcPlus}</span>`;
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
          <td><button class="btn-link player-name-link" data-player-id="${p.playerId}" data-player-type="hitter">${p.name}</button></td>
          <td>${p.team || 'FA'}</td>
          <td>${this.renderRatingBadge(p.trueFutureRating)}</td>
          <td>${p.wrcPlus}</td>
        </tr>
      `).join('');

      return `
        <div style="margin-bottom: 1rem;">
          <h4 style="margin: 0.5rem 0; font-size: 0.95em; color: var(--color-text-secondary);">${pos}</h4>
          <table class="stats-table" style="width: 100%; font-size: 0.85em;">
            <thead>
              <tr><th>#</th><th>Name</th><th>Team</th><th>TFR</th><th>wRC+</th></tr>
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
        return `<button class="btn-link player-name-link" data-player-id="${player.playerId}">${player.name}</button>`;
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

  private getWrcPlusClass(wrcPlus: number): string {
      if (wrcPlus >= 140) return 'rating-elite';
      if (wrcPlus >= 120) return 'rating-plus';
      if (wrcPlus >= 100) return 'rating-avg';
      if (wrcPlus >= 80) return 'rating-fringe';
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

  private renderFarmScoreFlip(sys: FarmSystemOverview): string {
      const front = `<span class="badge ${this.getWarClass(sys.totalWar)}">${sys.totalWar.toFixed(1)}</span>`;

      // Build breakdown text
      const { elite, aboveAvg, average, fringe } = sys.tierCounts;
      const eliteScore = elite * 10;
      const goodScore = aboveAvg * 5;
      const avgScore = average * 1;

      let depthScore = 0;
      if (fringe >= 25) depthScore = 5;
      else if (fringe >= 15) depthScore = 4;
      else if (fringe >= 10) depthScore = 2;

      // Format breakdown as single line with all components in parentheses
      const parts = [];

      if (elite > 0) parts.push(`${elite}E (${eliteScore}pts)`);
      if (aboveAvg > 0) parts.push(`${aboveAvg}G (${goodScore}pts)`);
      if (average > 0) parts.push(`${average}A (${avgScore}pts)`);
      parts.push(`Depth: ${fringe} (${depthScore}pts)`);

      const formula = parts.join(' ');

      const back = `
        <div style="font-size: 0.75rem; line-height: 1.2; text-align: center; padding: 2px; white-space: nowrap;">
          ${formula || '-'}
        </div>
      `;

      return `
          <div class="flip-cell" style="width: auto; height: auto; min-width: 50px;">
            <div class="flip-cell-inner">
              <div class="flip-cell-front">${front}</div>
              <div class="flip-cell-back" style="background-color: var(--color-surface); padding: 2px 4px; min-width: 90px; border-radius: 4px; box-shadow: 0 0 4px rgba(0,0,0,0.5); left: 50%; translate: -50%;">
                ${back}
              </div>
            </div>
          </div>
      `;
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

      // 3. Fetch MLB Context & Stats
      // Use cached/service data if possible to avoid heavy re-calc
      // For now, we'll fetch what's needed for the modal to function correctly
      const [leagueAverages, multiYearStats] = await Promise.all([
          trueRatingsService.getLeagueAverages(this.selectedYear),
          trueRatingsService.getMultiYearPitchingStats(this.selectedYear)
      ]);

      // Calculate MLB FIP-likes for percentile context
      // We need to fetch MLB stats first
      let leagueFipLikes: number[] = [];
      try {
          const mlbStats = await trueRatingsService.getTruePitchingStats(this.selectedYear);
          const mlbInputs = mlbStats.map(s => ({
              playerId: s.player_id,
              playerName: s.playerName,
              yearlyStats: multiYearStats.get(s.player_id) ?? []
          }));
          const mlbTrueRatings = trueRatingsCalculationService.calculateTrueRatings(mlbInputs, leagueAverages);
          leagueFipLikes = mlbTrueRatings.map(tr => tr.fipLike);
      } catch (e) {
          console.warn('Could not load MLB context for percentiles', e);
      }

      const playerMlbStats = multiYearStats.get(playerId) ?? [];

      // 4. Get TFR Data from our View Model
      // Use the `prospect` object from `this.data` for TFR specific values
      let prospect = this.data?.prospects.find(p => p.playerId === playerId);

      // If looking at a non-prospect (e.g. from expanded list but maybe they graduated?), fallback
      // But Farm Rankings only shows prospects.

      // Pass TFR peak projections to modal (so they match the table)
      let projectionOverride = undefined;
      if (prospect) {
          projectionOverride = {
              projectedStats: {
                  k9: prospect.potentialRatings.stuff,
                  bb9: prospect.potentialRatings.control,
                  hr9: prospect.potentialRatings.hra,
                  fip: prospect.peakFip,
                  war: prospect.peakWar,
                  ip: prospect.peakIp ?? 0 // Now uses realistic IP based on stamina/injury
              },
              projectedRatings: {
                  stuff: prospect.scoutingRatings.stuff,
                  control: prospect.scoutingRatings.control,
                  hra: prospect.scoutingRatings.hra
              }
          };
      }

      this.playerProfileModal.show({
          playerId: player.id,
          playerName: getFullName(player),
          team: teamLabel,
          parentTeam: parentLabel,
          age: player.age,
          positionLabel: getPositionLabel(player.position),

          // True Ratings (Current) - prospects usually don't have valid ones, handled by modal
          trueRating: undefined,

          // Estimated Ratings (from TFR if available) - Convert stats to ratings
          estimatedStuff: prospect ? Math.round((prospect.potentialRatings.stuff - 2.07) / 0.074) : undefined,
          estimatedControl: prospect ? Math.round((5.22 - prospect.potentialRatings.control) / 0.052) : undefined,
          estimatedHra: prospect ? Math.round((2.08 - prospect.potentialRatings.hra) / 0.024) : undefined,

          // Pass TFR peak projection to modal (prevents recalculation)
          projectionOverride: projectionOverride,
          
          // My Scout
          scoutStuff: myScouting?.stuff,
          scoutControl: myScouting?.control,
          scoutHra: myScouting?.hra,
          scoutStamina: myScouting?.stamina,
          scoutInjuryProneness: myScouting?.injuryProneness,
          scoutOvr: (myScouting as any)?.ovr,
          scoutPot: (myScouting as any)?.pot,

          // OSA Scout
          osaStuff: osaScouting?.stuff,
          osaControl: osaScouting?.control,
          osaHra: osaScouting?.hra,
          osaStamina: osaScouting?.stamina,
          osaInjuryProneness: osaScouting?.injuryProneness,
          osaOvr: (osaScouting as any)?.ovr,
          osaPot: (osaScouting as any)?.pot,

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

          // TFR
          isProspect: true,
          trueFutureRating: prospect?.trueFutureRating,
          tfrPercentile: undefined, // TFR Service calculates this but doesn't store it on RatedProspect?
          // Actually RatedProspect interface doesn't have percentile. 
          // We can calculate it here or let modal handle it if we passed leagueFipLikes? 
          // No, TFR percentile is relative to *MLB* FIPs.
          // TFR Service returns `percentile` in `TrueFutureRatingResult`.
          // `RatedProspect` is a transformation of that. 
          // We can try to recover it or re-calc. 
          // For now let's leave undefined, modal might hide it or we rely on 'trueFutureRating' display.
          
          year: this.selectedYear,
          showYearLabel: true,
          forceProjection: true,
      }, this.selectedYear, {
          leagueFipLikes,
          leagueAverages,
          mlbStats: playerMlbStats
      });
  }

  private async openHitterProfile(playerId: number, player: any, teamLabel: string, parentLabel: string): Promise<void> {
      // Fetch hitter scouting data (my scout only - modal will fetch OSA separately)
      const myScoutingAll = await hitterScoutingDataService.getLatestScoutingRatings('my');
      const myScouting = myScoutingAll.find(s => s.playerId === playerId);

      // Find hitter prospect data from our loaded data
      const hitterProspect = this.hitterData?.prospects.find(p => p.playerId === playerId);

      // Estimate "True Ratings" from projected stats (what the projection system expects)
      // These are derived from the projected stats, not the raw scouting ratings
      const projPa = hitterProspect?.projPa ?? 500;
      const estimatedPower = hitterProspect?.projIso
          ? HitterRatingEstimatorService.estimatePower(hitterProspect.projIso, projPa).rating
          : undefined;
      const estimatedEye = hitterProspect?.projBbPct
          ? HitterRatingEstimatorService.estimateEye(hitterProspect.projBbPct, projPa).rating
          : undefined;
      const estimatedAvoidK = hitterProspect?.projKPct
          ? HitterRatingEstimatorService.estimateAvoidK(hitterProspect.projKPct, projPa).rating
          : undefined;
      // For Contact, estimate from AVG (Contact → AVG has r=0.97)
      const estimatedContact = hitterProspect?.projAvg
          ? HitterRatingEstimatorService.estimateContact(hitterProspect.projAvg, projPa).rating
          : undefined;

      // Build batter profile data
      const batterData: BatterProfileData = {
          playerId: player.id,
          playerName: getFullName(player),
          team: teamLabel,
          parentTeam: parentLabel,
          age: player.age,
          position: player.position,
          positionLabel: getPositionLabel(player.position),

          // True Future Rating from prospect data
          trueRating: hitterProspect?.trueFutureRating,
          percentile: hitterProspect?.percentile,

          // Estimated ratings derived from projected stats
          estimatedPower,
          estimatedEye,
          estimatedAvoidK,
          estimatedContact,

          // Scout data (my)
          scoutPower: myScouting?.power,
          scoutEye: myScouting?.eye,
          scoutAvoidK: myScouting?.avoidK,
          scoutContact: myScouting?.contact,
          scoutGap: myScouting?.gap,
          scoutSpeed: myScouting?.speed,
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

          // Mark as prospect for peak projection display
          isProspect: true,
          trueFutureRating: hitterProspect?.trueFutureRating,
          tfrPercentile: hitterProspect?.percentile,
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