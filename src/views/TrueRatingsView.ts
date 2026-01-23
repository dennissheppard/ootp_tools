import { PitcherScoutingRatings } from '../models/ScoutingData';
import { scoutingDataService } from '../services/ScoutingDataService';
import { TruePlayerStats, TruePlayerBattingStats, trueRatingsService } from '../services/TrueRatingsService';

type StatsMode = 'pitchers' | 'batters';

interface DerivedPitchingFields {
  ipOuts: number;
  kPer9: number;
  bbPer9: number;
  hraPer9: number;
}

type PitcherRow = TruePlayerStats & DerivedPitchingFields;
type BatterRow = TruePlayerBattingStats;
type TableRow = PitcherRow | BatterRow;

interface PitcherColumn {
  key: keyof PitcherRow | string;
  label: string;
  sortKey?: keyof PitcherRow | string;
  accessor?: (row: PitcherRow) => any;
}

interface ScoutingMatchSummary {
  total: number;
  matched: number;
  missing: number;
}

const DEFAULT_PITCHER_COLUMNS: PitcherColumn[] = [
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
  private readonly prefKey = 'wbl-prefs';
  private preferences: Record<string, unknown> = {};
  private pitcherColumns: PitcherColumn[] = [];
  private isDraggingColumn = false;
  private scoutingRatings: PitcherScoutingRatings[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.preferences = this.loadPreferences();
    this.pitcherColumns = this.applyPitcherColumnOrder(DEFAULT_PITCHER_COLUMNS);
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
        </div>
        <details class="scouting-upload" id="scouting-upload">
          <summary class="form-title">Upload Scouting Data</summary>
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

    this.container.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newMode = btn.dataset.mode as StatsMode;
        if (this.mode !== newMode) {
          this.mode = newMode;
          this.sortKey = this.mode === 'pitchers' ? 'ra9war' : 'war';
          this.sortDirection = 'desc';
          this.container.querySelectorAll<HTMLButtonElement>('.toggle-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.updateScoutingUploadVisibility();
          this.fetchAndRenderStats();
        }
      });
    });

    this.bindScoutingUpload();
  }

  private async fetchAndRenderStats(): Promise<void> {
    const tableContainer = this.container.querySelector<HTMLElement>('#true-ratings-table-container')!;
    tableContainer.innerHTML = '<div class="loading-message">Loading stats...</div>';
    
    try {
      if (this.mode === 'pitchers') {
        const pitchingStats = await trueRatingsService.getTruePitchingStats(this.selectedYear);
        this.stats = this.withDerivedPitchingFields(pitchingStats);
      } else {
        this.stats = await trueRatingsService.getTrueBattingStats(this.selectedYear);
      }
      
      if (this.stats.length > 0 && this.itemsPerPage > this.stats.length) {
          this.itemsPerPage = this.stats.length;
      }
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
      this.updateScoutingStatus();
    });

    this.updateScoutingUploadVisibility();
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
        this.updateScoutingStatus();
      } catch (err) {
        alert('Error parsing scouting CSV file');
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  private loadScoutingRatingsForYear(): void {
    this.scoutingRatings = scoutingDataService.getScoutingRatings(this.selectedYear);
    this.updateScoutingStatus();
  }

  private updateScoutingUploadVisibility(): void {
    const section = this.container.querySelector<HTMLElement>('#scouting-upload');
    if (!section) return;
    section.style.display = this.mode === 'pitchers' ? '' : 'none';
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
    status.textContent = `Loaded ${summary.total} players. Matched ${summary.matched}, missing ${summary.missing}.`;
  }

  private matchScoutingToPitchers(
    scoutingRatings: PitcherScoutingRatings[],
    pitchers: PitcherRow[]
  ): ScoutingMatchSummary {
    const byId = new Map<number, PitcherRow>();
    const byName = new Map<string, PitcherRow[]>();

    pitchers.forEach((pitcher) => {
      byId.set(pitcher.player_id, pitcher);
      const normalizedName = this.normalizeName(pitcher.playerName);
      if (!normalizedName) return;
      const list = byName.get(normalizedName) ?? [];
      list.push(pitcher);
      byName.set(normalizedName, list);
    });

    let matched = 0;
    let missing = 0;

    scoutingRatings.forEach((rating) => {
      if (rating.playerId > 0 && byId.has(rating.playerId)) {
        matched += 1;
        return;
      }

      if (rating.playerName) {
        const normalized = this.normalizeName(rating.playerName);
        const candidates = byName.get(normalized);
        if (candidates && candidates.length === 1) {
          matched += 1;
          return;
        }
      }

      missing += 1;
    });

    return {
      total: scoutingRatings.length,
      matched,
      missing,
    };
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter((token) => token && !suffixes.has(token));
    return tokens.join('');
  }
}
