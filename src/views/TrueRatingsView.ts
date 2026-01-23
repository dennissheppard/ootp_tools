import { PitcherScoutingRatings } from '../models/ScoutingData';
import { scoutingDataService } from '../services/ScoutingDataService';
import { trueRatingsCalculationService } from '../services/TrueRatingsCalculationService';
import { TruePlayerStats, TruePlayerBattingStats, trueRatingsService } from '../services/TrueRatingsService';

type StatsMode = 'pitchers' | 'batters';
type RatingsViewMode = 'raw' | 'true';

interface DerivedPitchingFields {
  ipOuts: number;
  kPer9: number;
  bbPer9: number;
  hraPer9: number;
}

interface TrueRatingFields {
  trueRating?: number;
  percentile?: number;
  fipLike?: number;
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;
  scoutOverall?: number;
  estimatedOverall?: number;
  scoutDiff?: number;
}

type PitcherRow = TruePlayerStats & DerivedPitchingFields & TrueRatingFields;
type BatterRow = TruePlayerBattingStats;
type TableRow = PitcherRow | BatterRow;

interface PitcherColumn {
  key: keyof PitcherRow | string;
  label: string;
  sortKey?: keyof PitcherRow | string;
  accessor?: (row: PitcherRow) => any;
}

interface ScoutingMatchSummary {
  totalPitchers: number;
  matchedPitchers: number;
  missingPitchers: number;
  missingPitchersList: MissingPitcher[];
}

interface ScoutingLookup {
  byId: Map<number, PitcherScoutingRatings>;
  byName: Map<string, PitcherScoutingRatings[]>;
}

interface MissingPitcher {
  playerId: number;
  playerName: string;
}

const RAW_PITCHER_COLUMNS: PitcherColumn[] = [
  { key: 'playerName', label: 'Name' },
  { key: 'ip', label: 'IP', sortKey: 'ipOuts' },
  { key: 'k', label: 'K' },
  { key: 'bb', label: 'BB' },
  { key: 'hra', label: 'HR' },
  { key: 'r', label: 'R' },
  { key: 'er', label: 'ER' },
  { key: 'war', label: 'WAR' },
  { key: 'ra9war', label: 'Ra9WAR' },
  { key: 'wpa', label: 'WPA' },
  { key: 'kPer9', label: 'K/9' },
  { key: 'bbPer9', label: 'BB/9' },
  { key: 'hraPer9', label: 'HR/9' },
];

export class TrueRatingsView {
  private container: HTMLElement;
  private stats: TableRow[] = [];
  private currentPage = 1;
  private itemsPerPage = 50;
  private selectedYear = 2020;
  private yearOptions = Array.from({ length: 22 }, (_, i) => 2021 - i); // 2021 down to 2000
  private sortKey: string | null = 'ra9war';
  private sortDirection: 'asc' | 'desc' = 'desc';
  private mode: StatsMode = 'pitchers';
  private ratingsView: RatingsViewMode = 'raw';
  private showEstimatedRatings = false;
  private readonly prefKey = 'wbl-prefs';
  private preferences: Record<string, unknown> = {};
  private pitcherColumns: PitcherColumn[] = [];
  private isDraggingColumn = false;
  private scoutingRatings: PitcherScoutingRatings[] = [];
  private rawPitcherStats: PitcherRow[] = [];
  private missingPitchers: MissingPitcher[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.preferences = this.loadPreferences();
    this.showEstimatedRatings = Boolean(this.preferences.trueRatingsShowEstimates);
    this.updatePitcherColumns();
    this.renderLayout();
    this.loadScoutingRatingsForYear();
    this.fetchAndRenderStats();
  }

  private renderLayout(): void {
    this.container.innerHTML = `
      <div class="true-ratings-content">
        <div class="draft-header">
            <h2 class="view-title">True Player Ratings</h2>
            <div class="toggle-group" role="tablist" aria-label="Stats type">
                <button class="toggle-btn active" data-mode="pitchers" role="tab" aria-selected="true">Pitchers</button>
                <button class="toggle-btn" data-mode="batters" role="tab" aria-selected="false">Batters</button>
            </div>
        </div>
        <div class="true-ratings-controls">
          <div class="form-field">
            <label for="true-ratings-year">Year:</label>
            <select id="true-ratings-year">
              ${this.yearOptions.map(year => `<option value="${year}" ${year === this.selectedYear ? 'selected' : ''}>${year}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="items-per-page">Per Page:</label>
            <select id="items-per-page">
              <option value="10">10</option>
              <option value="50" selected>50</option>
              <option value="200">200</option>
              <option value="all">All</option>
            </select>
          </div>
          <div class="form-field" id="ratings-view-toggle">
            <label>View:</label>
            <div class="toggle-group" role="tablist" aria-label="Ratings view">
              <button class="toggle-btn ${this.ratingsView === 'raw' ? 'active' : ''}" data-ratings-view="raw" role="tab" aria-selected="${this.ratingsView === 'raw'}">Raw Stats</button>
              <button class="toggle-btn ${this.ratingsView === 'true' ? 'active' : ''}" data-ratings-view="true" role="tab" aria-selected="${this.ratingsView === 'true'}">True Ratings</button>
            </div>
          </div>
          <div class="form-field" id="estimated-ratings-toggle">
            <label class="hide-pitches-toggle">
              <input type="checkbox" id="toggle-estimated-ratings" ${this.showEstimatedRatings ? 'checked' : ''}>
              Show estimated ratings
            </label>
          </div>
        </div>
        <details class="scouting-upload" id="scouting-upload">
          <summary class="form-title" id="scouting-upload-label">Upload Scouting Data</summary>
          <div class="csv-upload-container">
            <p class="csv-format">Format: player_id, name, stuff, control, hra [, age]</p>
            <div class="csv-upload-area" id="scouting-drop-zone">
              <input type="file" id="scouting-file-input" accept=".csv" hidden>
              <p>Drop CSV file here or <button type="button" class="btn-link" id="scouting-browse-btn">browse</button></p>
            </div>
            <div class="upload-actions">
              <span class="saved-note" id="scouting-upload-status">No scouting data loaded for this year.</span>
              <button type="button" class="btn-link" id="scouting-clear-btn">Clear scouting data</button>
            </div>
          </div>
        </details>
        <div id="true-ratings-table-container"></div>
        <div class="pagination-controls">
          <button id="prev-page" disabled>Previous</button>
          <span id="page-info"></span>
          <button id="next-page" disabled>Next</button>
        </div>
      </div>
      <div class="modal-overlay" id="scouting-missing-modal" aria-hidden="true">
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Missing scouting data</h3>
            <button type="button" class="modal-close" id="scouting-missing-close" aria-label="Close">x</button>
          </div>
          <div class="modal-body" id="scouting-missing-body"></div>
        </div>
      </div>
    `;

    this.bindEventListeners();
  }

  private bindEventListeners(): void {
    this.container.querySelector('#true-ratings-year')?.addEventListener('change', (e) => {
      this.selectedYear = parseInt((e.target as HTMLSelectElement).value, 10);
      this.currentPage = 1;
      this.loadScoutingRatingsForYear();
      this.fetchAndRenderStats();
    });

    this.container.querySelector('#items-per-page')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.itemsPerPage = value === 'all' ? this.stats.length : parseInt(value, 10);
      this.currentPage = 1;
      this.renderStats();
    });

    this.container.querySelector('#prev-page')?.addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.renderStats();
      }
    });

    this.container.querySelector('#next-page')?.addEventListener('click', () => {
      const totalPages = this.itemsPerPage === this.stats.length ? 1 : Math.ceil(this.stats.length / this.itemsPerPage);
      if (this.currentPage < totalPages) {
        this.currentPage++;
        this.renderStats();
      }
    });

    this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode as StatsMode | undefined;
        if (!newMode || this.mode === newMode) return;
        this.mode = newMode;
        this.sortKey = this.mode === 'pitchers' ? 'ra9war' : 'war';
        this.sortDirection = 'desc';
        this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.updateRatingsControlsVisibility();
        this.updateScoutingUploadVisibility();
        this.fetchAndRenderStats();
      });
    });

    this.bindRatingsViewToggle();
    this.bindEstimatedRatingsToggle();
    this.bindScoutingUpload();
    this.bindMissingModal();
    this.updateRatingsControlsVisibility();
  }

  private bindRatingsViewToggle(): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('[data-ratings-view]');
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        const view = button.dataset.ratingsView as RatingsViewMode | undefined;
        if (!view || this.ratingsView === view) return;
        this.ratingsView = view;
        this.sortKey = view === 'true' ? 'trueRating' : 'ra9war';
        this.sortDirection = 'desc';
        buttons.forEach(btn => {
          const isActive = btn.dataset.ratingsView === view;
          btn.classList.toggle('active', isActive);
          btn.setAttribute('aria-selected', String(isActive));
        });
        this.updatePitcherColumns();
        this.updateRatingsControlsVisibility();
        this.fetchAndRenderStats();
      });
    });
  }

  private bindEstimatedRatingsToggle(): void {
    const toggle = this.container.querySelector<HTMLInputElement>('#toggle-estimated-ratings');
    toggle?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.showEstimatedRatings = checked;
      this.updatePreferences({ trueRatingsShowEstimates: checked });
      this.updatePitcherColumns();
      this.renderStats();
    });
  }

  private updateRatingsControlsVisibility(): void {
    const viewToggle = this.container.querySelector<HTMLElement>('#ratings-view-toggle');
    const estimatedToggle = this.container.querySelector<HTMLElement>('#estimated-ratings-toggle');
    if (viewToggle) viewToggle.style.display = this.mode === 'pitchers' ? '' : 'none';
    if (estimatedToggle) {
      const showEstimated = this.mode === 'pitchers' && this.ratingsView === 'true';
      estimatedToggle.style.display = showEstimated ? '' : 'none';
    }
  }

  private async fetchAndRenderStats(): Promise<void> {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    const isTrueRatingsView = this.mode === 'pitchers' && this.ratingsView === 'true';
    tableContainer.innerHTML = `<div class="loading-message">${isTrueRatingsView ? 'Calculating true ratings...' : 'Loading stats...'}</div>`;
    
    try {
      if (this.mode === 'pitchers') {
        const pitchingStats = await trueRatingsService.getTruePitchingStats(this.selectedYear);
        this.rawPitcherStats = this.withDerivedPitchingFields(pitchingStats);
        if (isTrueRatingsView) {
          this.stats = await this.buildTrueRatingsStats(this.rawPitcherStats);
        } else {
          this.stats = this.rawPitcherStats;
        }
      } else {
        this.stats = await trueRatingsService.getTrueBattingStats(this.selectedYear);
      }
      
      if (this.stats.length > 0 && this.itemsPerPage > this.stats.length) {
          this.itemsPerPage = this.stats.length;
      }
      this.updatePitcherColumns();
      this.sortStats();
      this.updateScoutingStatus();
      this.renderStats();
    } catch (error) {
      tableContainer.innerHTML = `<div class="error-message">Failed to load stats. ${error}</div>`;
    }
  }

  private renderStats(): void {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    if (this.stats.length === 0) {
      tableContainer.innerHTML = `<p class="no-stats">No ${this.mode} stats found for this year.</p>`;
      this.updatePaginationControls(0);
      return;
    }

    const paginatedStats = this.getPaginatedStats();
    tableContainer.innerHTML = this.renderTable(paginatedStats);
    this.updatePaginationControls(this.stats.length);
    this.bindSortHeaders();
    this.bindScrollButtons();
    this.bindPitcherColumnDragAndDrop();
  }

  private updatePitcherColumns(): void {
    const columns = this.getPitcherColumnsForView();
    this.pitcherColumns = this.applyPitcherColumnOrder(columns);
  }

  private getPitcherColumnsForView(): PitcherColumn[] {
    if (this.mode !== 'pitchers') {
      return [...RAW_PITCHER_COLUMNS];
    }

    if (this.ratingsView !== 'true') {
      return [...RAW_PITCHER_COLUMNS];
    }

    const [nameColumn, ...rest] = RAW_PITCHER_COLUMNS;
    const trueRatingColumns = this.getTrueRatingColumns();
    const estimatedColumns = this.showEstimatedRatings ? this.getEstimatedRatingColumns() : [];
    const scoutingColumns = this.scoutingRatings.length > 0 ? this.getScoutingComparisonColumns() : [];

    return [nameColumn, ...trueRatingColumns, ...scoutingColumns, ...estimatedColumns, ...rest];
  }

  private getPaginatedStats(): TableRow[] {
      if (this.itemsPerPage === this.stats.length) {
          return this.stats;
      }
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = this.currentPage * this.itemsPerPage;
    return this.stats.slice(startIndex, endIndex);
  }

  private withDerivedPitchingFields(pitchingStats: TruePlayerStats[]): PitcherRow[] {
    return pitchingStats.map(stat => {
      const outs = this.parseIpToOuts(stat.ip);
      const innings = outs / 3;
      return {
        ...stat,
        ipOuts: outs,
        kPer9: this.calculatePer9(stat.k, innings),
        bbPer9: this.calculatePer9(stat.bb, innings),
        hraPer9: this.calculatePer9(stat.hra, innings),
      };
    });
  }

  private async buildTrueRatingsStats(pitchers: PitcherRow[]): Promise<PitcherRow[]> {
    const [multiYearStats, leagueAverages] = await Promise.all([
      trueRatingsService.getMultiYearPitchingStats(this.selectedYear, 3),
      trueRatingsService.getLeagueAverages(this.selectedYear),
    ]);

    const scoutingLookup = this.buildScoutingLookup(this.scoutingRatings);
    const scoutingMatchMap = new Map<number, PitcherScoutingRatings>();

    const inputs = pitchers.map((pitcher) => {
      const scouting = this.resolveScoutingRating(pitcher, scoutingLookup);
      if (scouting) {
        scoutingMatchMap.set(pitcher.player_id, scouting);
      }
      return {
        playerId: pitcher.player_id,
        playerName: pitcher.playerName,
        yearlyStats: multiYearStats.get(pitcher.player_id) ?? [],
        scoutingRatings: scouting,
      };
    });

    const results = trueRatingsCalculationService.calculateTrueRatings(inputs, leagueAverages);
    const resultMap = new Map(results.map(result => [result.playerId, result]));

    return pitchers.map((pitcher) => {
      const result = resultMap.get(pitcher.player_id);
      if (!result) return pitcher;
      const scouting = scoutingMatchMap.get(pitcher.player_id);
      const estimatedOverall = this.averageRating(result.estimatedStuff, result.estimatedControl, result.estimatedHra);
      const scoutOverall = scouting ? this.averageRating(scouting.stuff, scouting.control, scouting.hra) : undefined;
      const scoutDiff =
        scoutOverall !== undefined ? Math.round(scoutOverall - estimatedOverall) : undefined;

      return {
        ...pitcher,
        trueRating: result.trueRating,
        percentile: result.percentile,
        fipLike: result.fipLike,
        estimatedStuff: result.estimatedStuff,
        estimatedControl: result.estimatedControl,
        estimatedHra: result.estimatedHra,
        estimatedOverall,
        scoutOverall,
        scoutDiff,
      };
    });
  }

  private buildScoutingLookup(ratings: PitcherScoutingRatings[]): ScoutingLookup {
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

  private resolveScoutingRating(pitcher: PitcherRow, lookup: ScoutingLookup): PitcherScoutingRatings | undefined {
    const byId = lookup.byId.get(pitcher.player_id);
    if (byId) return byId;

    const normalized = this.normalizeName(pitcher.playerName);
    const matches = lookup.byName.get(normalized);
    if (!matches || matches.length !== 1) return undefined;
    return matches[0];
  }

  private averageRating(stuff: number, control: number, hra: number): number {
    return Math.round((stuff + control + hra) / 3);
  }

  private parseIpToOuts(ip: string | number): number {
    const [fullInnings = '0', partialOuts = '0'] = String(ip).split('.');
    const inningsValue = parseInt(fullInnings, 10);
    const partialValue = parseInt(partialOuts, 10);

    if (Number.isNaN(inningsValue) || Number.isNaN(partialValue)) {
      return 0;
    }

    return (inningsValue * 3) + partialValue;
  }

  private calculatePer9(count: number, innings: number): number {
    if (!Number.isFinite(count) || innings <= 0) return 0;
    return (count / innings) * 9;
  }

  private applyPitcherColumnOrder(columns: PitcherColumn[]): PitcherColumn[] {
    const rawOrder = this.preferences.trueRatingsPitcherColumns;
    if (!Array.isArray(rawOrder) || rawOrder.length === 0) {
      return [...columns];
    }

    const ordered: PitcherColumn[] = [];
    const lookup = new Map(columns.map(column => [String(column.key), column]));

    for (const key of rawOrder) {
      if (typeof key !== 'string') continue;
      const column = lookup.get(key);
      if (column) {
        ordered.push(column);
        lookup.delete(key);
      }
    }

    ordered.push(...lookup.values());
    return ordered;
  }

  private updatePreferences(partial: Record<string, unknown>): void {
    if (typeof window === 'undefined') return;
    const current = this.loadPreferences();
    const merged = { ...current, ...partial };
    this.preferences = merged;
    try {
      localStorage.setItem(this.prefKey, JSON.stringify(merged));
    } catch {
      // ignore storage errors
    }
  }

  private loadPreferences(): Record<string, unknown> {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem(this.prefKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  private renderTable(stats: TableRow[]): string {
    if (stats.length === 0) return '';
    if (this.mode === 'pitchers') {
      return this.renderPitcherTable(stats as PitcherRow[]);
    }
    return this.renderBattersTable(stats as BatterRow[]);
  }

  private renderPitcherTable(stats: PitcherRow[]): string {
    const headerRow = this.pitcherColumns.map(column => {
      const sortKey = column.sortKey ?? column.key;
      const activeClass = this.sortKey === sortKey ? 'sort-active' : '';
      return `<th data-sort-key="${sortKey}" data-col-key="${column.key}" class="${activeClass}" draggable="true">${column.label}</th>`;
    }).join('');

    const rows = stats.map(player => {
      const cells = this.pitcherColumns.map(column => {
        const rawValue = column.accessor ? column.accessor(player) : (player as any)[column.key];
        const displayValue = this.formatValue(rawValue, String(column.key));
        return `<td data-col-key="${column.key}">${displayValue}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="table-wrapper-outer">
        <button class="scroll-btn scroll-btn-left" aria-label="Scroll left"></button>
        <div class="table-wrapper">
          <table class="stats-table true-ratings-table">
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
        <button class="scroll-btn scroll-btn-right" aria-label="Scroll right"></button>
      </div>
    `;
  }

  private renderBattersTable(stats: BatterRow[]): string {
    const batterExcludedKeys = ['ci', 'd', 'game_id', 'id', 'league_id', 'level_id', 'pitches_seen', 'position', 'sf', 'sh', 'split_id', 'stint', 't'];
    const excludedKeys = ['id', 'player_id', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id', 'year', ...batterExcludedKeys];
    let headers = Object.keys(stats[0]).filter(key => !excludedKeys.includes(key));
    
    headers = headers.filter(h => h !== 'playerName');
    headers.unshift('playerName');

    const headerRow = headers.map(header => {
      const activeClass = this.sortKey === header ? 'sort-active' : '';
      return `<th data-sort-key="${header}" class="${activeClass}">${this.formatHeader(header)}</th>`;
    }).join('');
    
    const rows = stats.map(s => {
      const cells = headers.map(header => {
        const value: any = (s as any)[header];
        return `<td>${this.formatValue(value, header)}</td>`;
      }).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="table-wrapper-outer">
        <button class="scroll-btn scroll-btn-left" aria-label="Scroll left"></button>
        <div class="table-wrapper">
          <table class="stats-table true-ratings-table">
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
        <button class="scroll-btn scroll-btn-right" aria-label="Scroll right"></button>
      </div>
    `;
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
            const canScrollRight = scrollLeft < scrollWidth - clientWidth -1;
            
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

  private bindSortHeaders(): void {
    const headers = this.container.querySelectorAll<HTMLElement>('[data-sort-key]');
    headers.forEach(header => {
      header.addEventListener('click', (e) => {
        if (this.isDraggingColumn) return;
        const key = header.dataset.sortKey;
        if (!key) return;

        if (this.sortKey === key) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          this.sortDirection = 'desc';
        }
        this.showSortHint(e as MouseEvent);
        this.sortStats();
        this.renderStats();
      });
    });
  }

  private bindPitcherColumnDragAndDrop(): void {
    if (this.mode !== 'pitchers') return;
    const headers = this.container.querySelectorAll<HTMLTableCellElement>('.true-ratings-table th[data-col-key]');
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
        e.dataTransfer?.setDragImage(header, 10, 10);
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
        this.reorderPitcherColumns(draggedKey, targetKey, position ?? 'before');
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

  private reorderPitcherColumns(draggedKey: string, targetKey: string, position: 'before' | 'after'): void {
    const fromIndex = this.pitcherColumns.findIndex(column => String(column.key) === draggedKey);
    const toIndex = this.pitcherColumns.findIndex(column => String(column.key) === targetKey);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

    const nextColumns = [...this.pitcherColumns];
    const [moved] = nextColumns.splice(fromIndex, 1);
    let insertIndex = position === 'after' ? toIndex + 1 : toIndex;
    if (fromIndex < insertIndex) {
      insertIndex -= 1;
    }
    nextColumns.splice(insertIndex, 0, moved);
    this.pitcherColumns = nextColumns;
    this.updatePreferences({ trueRatingsPitcherColumns: nextColumns.map(column => String(column.key)) });
    this.renderStats();
  }

  private updateDropIndicator(targetKey: string, position: 'before' | 'after'): void {
    this.clearDropIndicators();
    const cells = this.container.querySelectorAll<HTMLElement>(`.true-ratings-table [data-col-key="${targetKey}"]`);
    cells.forEach(cell => {
      cell.dataset.dropPosition = position;
      cell.classList.add(position === 'before' ? 'drop-before' : 'drop-after');
    });
  }

  private clearDropIndicators(): void {
    const cells = this.container.querySelectorAll<HTMLElement>('.true-ratings-table .drop-before, .true-ratings-table .drop-after');
    cells.forEach(cell => {
      cell.classList.remove('drop-before', 'drop-after');
      delete cell.dataset.dropPosition;
    });
  }

  private applyColumnClass(columnKey: string | null, className: string, add: boolean): void {
    if (!columnKey) return;
    const cells = this.container.querySelectorAll<HTMLElement>(`.true-ratings-table [data-col-key="${columnKey}"]`);
    cells.forEach(cell => cell.classList.toggle(className, add));
  }

  private sortStats(): void {
    if (!this.sortKey) return;
    const key = this.sortKey;

    this.stats.sort((a, b) => {
      const aVal = (a as any)[key];
      const bVal = (b as any)[key];
      
      let compare = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        compare = (aVal ?? 0) - (bVal ?? 0);
      } else {
        const aString = aVal !== undefined && aVal !== null ? String(aVal) : '';
        const bString = bVal !== undefined && bVal !== null ? String(bVal) : '';
        compare = aString.localeCompare(bString);
      }

      return this.sortDirection === 'asc' ? compare : -compare;
    });
  }
  
  private formatValue(value: any, key: string): string {
    if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        return value.toString();
      }
      const threeDecimalKeys = ['avg', 'obp'];
      return threeDecimalKeys.includes(key.toLowerCase()) ? value.toFixed(3) : value.toFixed(2);
    }

    return value ?? '';
  }

  private formatHeader(header: string): string {
    return header
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .replace(/_id/g, '')
      .replace(/^ip$/, 'IP')
      .replace(/^ha$/, 'H')
      .replace(/^er$/, 'ER')
      .replace(/^k$/, 'K')
      .replace(/^hr$/, 'HR')
      .replace(/^war$/, 'WAR')
      .replace(/^bb$/, 'BB')
      .replace(/^obp$/, 'OBP')
      .replace(/^avg$/, 'AVG')
      .replace(/^\w/, c => c.toUpperCase())
      .trim();
  }

  private getTrueRatingColumns(): PitcherColumn[] {
    return [
      {
        key: 'trueRating',
        label: 'TR',
        sortKey: 'trueRating',
        accessor: (row) => this.renderTrueRatingBadge(row.trueRating),
      },
      {
        key: 'percentile',
        label: '%',
        sortKey: 'percentile',
        accessor: (row) => (typeof row.percentile === 'number' ? row.percentile.toFixed(1) : ''),
      },
      { key: 'fipLike', label: 'FIP*' },
    ];
  }

  private getEstimatedRatingColumns(): PitcherColumn[] {
    return [
      { key: 'estimatedStuff', label: 'Est STF' },
      { key: 'estimatedControl', label: 'Est CON' },
      { key: 'estimatedHra', label: 'Est HRA' },
    ];
  }

  private getScoutingComparisonColumns(): PitcherColumn[] {
    return [
      {
        key: 'scoutDiff',
        label: 'Scout Δ',
        sortKey: 'scoutDiff',
        accessor: (row) => this.renderScoutComparison(row),
      },
    ];
  }

  private renderTrueRatingBadge(value?: number): string {
    if (typeof value !== 'number') return '';
    const className = this.getTrueRatingClass(value);
    return `<span class="badge ${className}">${value.toFixed(1)}</span>`;
  }

  private getTrueRatingClass(value: number): string {
    if (value >= 4.5) return 'rating-elite';
    if (value >= 4.0) return 'rating-plus';
    if (value >= 3.0) return 'rating-avg';
    if (value >= 2.0) return 'rating-fringe';
    return 'rating-poor';
  }

  private renderScoutComparison(row: PitcherRow): string {
    if (typeof row.estimatedOverall !== 'number' || typeof row.scoutOverall !== 'number') {
      return '';
    }
    const diff = row.scoutDiff ?? 0;
    const diffText = diff > 0 ? `+${diff}` : `${diff}`;
    const className = diff > 0 ? 'war-positive' : diff < 0 ? 'war-negative' : '';
    const detail = `${row.estimatedOverall}/${row.scoutOverall} (${diffText})`;
    const title = `Est ${row.estimatedOverall}, Scout ${row.scoutOverall}`;
    return `<span class="${className}" title="${title}">${detail}</span>`;
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

  private updatePaginationControls(totalItems: number): void {
    const totalPages = this.itemsPerPage === totalItems ? 1 : Math.ceil(totalItems / this.itemsPerPage);
    const pageInfo = this.container.querySelector<HTMLElement>('#page-info')!;
    const prevButton = this.container.querySelector<HTMLButtonElement>('#prev-page')!;
    const nextButton = this.container.querySelector<HTMLButtonElement>('#next-page')!;

    if (totalPages <= 1) {
        pageInfo.textContent = '';
        prevButton.disabled = true;
        nextButton.disabled = true;
        return;
    }
    
    pageInfo.textContent = `Page ${this.currentPage} of ${totalPages}`;
    prevButton.disabled = this.currentPage === 1;
    nextButton.disabled = this.currentPage === totalPages;
  }

  private bindScoutingUpload(): void {
    const fileInput = this.container.querySelector<HTMLInputElement>('#scouting-file-input');
    const browseBtn = this.container.querySelector<HTMLButtonElement>('#scouting-browse-btn');
    const dropZone = this.container.querySelector<HTMLDivElement>('#scouting-drop-zone');
    const clearBtn = this.container.querySelector<HTMLButtonElement>('#scouting-clear-btn');

    browseBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleScoutingFile(file);
      (e.target as HTMLInputElement).value = '';
    });

    dropZone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });

    dropZone?.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });

    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer?.files[0];
      if (file && file.name.toLowerCase().endsWith('.csv')) {
        this.handleScoutingFile(file);
      }
    });

    clearBtn?.addEventListener('click', () => {
      scoutingDataService.clearScoutingRatings(this.selectedYear);
      this.scoutingRatings = [];
      this.refreshAfterScoutingChange();
    });

    this.updateScoutingUploadVisibility();
  }

  private bindMissingModal(): void {
    const overlay = this.container.querySelector<HTMLElement>('#scouting-missing-modal');
    const closeBtn = this.container.querySelector<HTMLButtonElement>('#scouting-missing-close');
    if (!overlay) return;

    closeBtn?.addEventListener('click', () => this.hideMissingModal());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.hideMissingModal();
      }
    });
  }

  private handleScoutingFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const ratings = scoutingDataService.parseScoutingCsv(content);
        if (ratings.length === 0) {
          alert('No valid scouting data found in CSV');
          return;
        }
        this.scoutingRatings = ratings;
        scoutingDataService.saveScoutingRatings(this.selectedYear, ratings);
        this.refreshAfterScoutingChange();
      } catch (err) {
        alert('Error parsing scouting CSV file');
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  private loadScoutingRatingsForYear(): void {
    this.scoutingRatings = scoutingDataService.getScoutingRatings(this.selectedYear);
    this.updateScoutingUploadLabel();
    this.updatePitcherColumns();
    this.updateScoutingStatus();
  }

  private updateScoutingUploadVisibility(): void {
    const section = this.container.querySelector<HTMLElement>('#scouting-upload');
    if (!section) return;
    section.style.display = this.mode === 'pitchers' ? '' : 'none';
  }

  private updateScoutingUploadLabel(): void {
    const label = this.container.querySelector<HTMLElement>('#scouting-upload-label');
    if (!label) return;
    label.textContent = this.scoutingRatings.length > 0 ? 'Manage Scouting Data' : 'Upload Scouting Data';
  }

  private updateScoutingStatus(): void {
    const status = this.container.querySelector<HTMLElement>('#scouting-upload-status');
    if (!status) return;

    const total = this.scoutingRatings.length;
    if (total === 0) {
      status.textContent = 'No scouting data loaded for this year.';
      return;
    }

    if (this.mode !== 'pitchers') {
      status.textContent = `Loaded ${total} players. Switch to pitchers to match.`;
      return;
    }

    if (this.stats.length === 0) {
      status.textContent = `Loaded ${total} players. Waiting for pitcher stats to match.`;
      return;
    }

    const summary = this.matchScoutingToPitchers(this.scoutingRatings, this.stats as PitcherRow[]);
    this.missingPitchers = summary.missingPitchersList;
    const missingCount = summary.missingPitchers;
    const missingLabel = missingCount > 0
      ? `<button type="button" class="btn-link" id="missing-scouting-link">${missingCount}</button>`
      : `${missingCount}`;
    status.innerHTML = `Loaded ${total} scouting rows. Matched ${summary.matchedPitchers}/${summary.totalPitchers} MLB pitchers; missing ${missingLabel}.`;
    if (missingCount > 0) {
      const link = status.querySelector<HTMLButtonElement>('#missing-scouting-link');
      link?.addEventListener('click', () => this.showMissingModal());
    }
  }

  private refreshAfterScoutingChange(): void {
    this.updateScoutingUploadLabel();
    this.updatePitcherColumns();
    if (this.mode === 'pitchers' && this.ratingsView === 'true') {
      this.fetchAndRenderStats();
      return;
    }
    this.updateScoutingStatus();
    this.renderStats();
  }

  private showMissingModal(): void {
    const overlay = this.container.querySelector<HTMLElement>('#scouting-missing-modal');
    const body = this.container.querySelector<HTMLElement>('#scouting-missing-body');
    if (!overlay || !body) return;

    if (this.missingPitchers.length === 0) {
      body.innerHTML = '<p class="no-results">No missing pitchers.</p>';
    } else {
      const rows = this.missingPitchers.map((pitcher) => `
        <tr>
          <td>${pitcher.playerId}</td>
          <td>${this.escapeHtml(pitcher.playerName)}</td>
        </tr>
      `).join('');

      body.innerHTML = `
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `;
    }

    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
  }

  private hideMissingModal(): void {
    const overlay = this.container.querySelector<HTMLElement>('#scouting-missing-modal');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.setAttribute('aria-hidden', 'true');
  }

  private matchScoutingToPitchers(
    scoutingRatings: PitcherScoutingRatings[],
    pitchers: PitcherRow[]
  ): ScoutingMatchSummary {
    const lookup = this.buildScoutingLookup(scoutingRatings);
    let matchedPitchers = 0;
    const missingPitchersList: MissingPitcher[] = [];

    pitchers.forEach((pitcher) => {
      const scouting = this.resolveScoutingRating(pitcher, lookup);
      if (scouting) {
        matchedPitchers += 1;
      } else {
        missingPitchersList.push({ playerId: pitcher.player_id, playerName: pitcher.playerName });
      }
    });

    const totalPitchers = pitchers.length;
    return {
      totalPitchers,
      matchedPitchers,
      missingPitchers: Math.max(0, totalPitchers - matchedPitchers),
      missingPitchersList,
    };
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }
}
