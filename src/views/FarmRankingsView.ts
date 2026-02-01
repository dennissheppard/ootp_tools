import { teamRatingsService, FarmData, FarmSystemRankings, FarmSystemOverview, RatedProspect } from '../services/TeamRatingsService';
import { PlayerProfileModal } from './PlayerProfileModal';
import { playerService } from '../services/PlayerService';
import { teamService } from '../services/TeamService';
import { scoutingDataService } from '../services/ScoutingDataService';
import { trueRatingsService } from '../services/TrueRatingsService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { getPositionLabel, getFullName } from '../models/Player';
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
  private data: FarmData | null = null;
  private playerProfileModal: PlayerProfileModal;
  private yearOptions = Array.from({ length: 6 }, (_, i) => 2021 - i); // 2021 down to 2016
  private top100Prospects: RatedProspect[] = [];
  private selectedTeam: string = 'all';

  // Sorting and Dragging state
  private systemsSortKey: string = 'totalWar';
  private systemsSortDirection: 'asc' | 'desc' = 'desc';
  private prospectsSortKey: string = 'trueFutureRating';
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
    { key: 'name', label: 'Name', sortKey: 'name' },
    { key: 'team', label: 'Team', sortKey: 'orgId' },
    { key: 'trueFutureRating', label: 'TFR', sortKey: 'trueFutureRating' },
    { key: 'peakWar', label: 'Peak WAR', sortKey: 'peakWar' },
    { key: 'peakFip', label: 'Peak FIP', sortKey: 'peakFip' },
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

  // Temporarily unused - was only called from year dropdown handler
  // Re-enable when historical scouting data becomes available
  // private showLoadingState(message: string = 'Loading...'): void {
  //     const content = this.container.querySelector('#farm-content-area');
  //     if (content) content.innerHTML = this.renderLoadingState(message);
  // }

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
      if (!menu || !this.data) return;

      const teams = new Set<string>();
      this.data.prospects.forEach(p => {
          teams.add(this.getTeamName(p.orgId));
      });

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
        this.data = await teamRatingsService.getFarmData(this.selectedYear);
        this.top100Prospects = this.data.prospects.slice(0, 100);
        this.updateTeamFilter();
        this.renderView();
    } catch (err) {
        console.error(err);
        const content = this.container.querySelector('#farm-content-area');
        if (content) content.innerHTML = '<p class="no-stats">Error loading farm data.</p>';
    }
  }

  private renderView(): void {
      if (!this.data) return;
      const content = this.container.querySelector('#farm-content-area');
      if (!content) return;

      this.sortData();

      const teamFilter = this.container.querySelector<HTMLElement>('[data-filter="team"]');
      if (teamFilter) {
          teamFilter.style.display = this.viewMode === 'top-100' ? 'inline-block' : 'none';
      }

      switch (this.viewMode) {
          case 'top-systems':
              content.innerHTML = this.renderTopSystems();
              break;
          case 'top-100':
              content.innerHTML = this.renderTopProspects();
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

  private bindSortHeaders(): void {
    const headers = this.container.querySelectorAll<HTMLElement>('.stats-table:not(.nested-system-table) th[data-sort-key]');
    headers.forEach(header => {
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
    const columns = this.viewMode === 'top-systems' ? this.systemsColumns : this.prospectsColumns;
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
              // Prevent toggle if clicking a player link
              if ((e.target as HTMLElement).closest('.player-name-link')) return;

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

      const rows = filteredProspects.map((p, idx) => {
        const cells = this.prospectsColumns.map(col => {
            switch (col.key) {
                case 'rank':
                    const currentRank = idx + 1;
                    if (this.selectedTeam !== 'all' && this.data) {
                        const originalRank = this.data.prospects.findIndex(orig => orig.playerId === p.playerId) + 1;
                        return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${currentRank} <span style="font-weight: normal; font-size: 0.85em; opacity: 0.7;">(#${originalRank})</span></td>`;
                    }
                    return `<td data-col-key="rank" style="font-weight: bold; color: var(--color-text-muted);">${currentRank}</td>`;
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

  // --- REPORTS VIEW (Original) ---
  private renderReports(): string {
      if (!this.data) return '';
      
      // Render layout containers manually since we're injecting into content area
      const rotSorted = [...this.data.reports].sort((a, b) => b.rotationScore - a.rotationScore);
      const penSorted = [...this.data.reports].sort((a, b) => b.bullpenScore - a.bullpenScore);

      return `
        <div class="team-ratings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
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

      // 2. Fetch Scouting Data (My & OSA)
      const [myScoutingRatings, osaScoutingRatings] = await Promise.all([
        scoutingDataService.getLatestScoutingRatings('my'),
        scoutingDataService.getLatestScoutingRatings('osa')
      ]);

      const myScoutingLookup = this.buildScoutingLookup(myScoutingRatings);
      const osaScoutingLookup = this.buildScoutingLookup(osaScoutingRatings);

      const myScouting = this.resolveScouting(playerId, getFullName(player), myScoutingLookup);
      const osaScouting = this.resolveScouting(playerId, getFullName(player), osaScoutingLookup);
      const activeScouting = myScouting || osaScouting;

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
          
          // Pitch Data (Detailed)
          pitchCount: activeScouting?.pitches ? Object.values(activeScouting.pitches).filter(v => v >= 45).length : 0,
          pitches: activeScouting?.pitches ? Object.keys(activeScouting.pitches) : [],
          pitchRatings: activeScouting?.pitches ?? {},

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
      // Helper to find team name from reports data if needed, or simple lookup
      // Since we don't have a direct Team Map here, we can infer from reports or systems
      if (this.data) {
          const sys = this.data.systems.find(s => s.teamId === teamId);
          if (sys) return sys.teamName;
          // Try to find in prospect's team ID? No, prospect stores minor league team ID usually.
          // We need parent team name.
          // RatedProspect stores teamId (which is minor league team).
          // We don't have parent name easily accessible on prospect object.
          // For now, return "Org " + teamId or generic.
          // Wait, getFarmData logic in service does look up parent.
          // We should probably add `orgName` to RatedProspect for display convenience.
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