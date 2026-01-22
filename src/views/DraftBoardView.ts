import { PotentialStatsService } from '../services/PotentialStatsService';

type DraftMode = 'pitchers' | 'hitters';

type RatingColumn = { key: string; label: string };
type ProjectionColumn = { key: keyof ProjectionStats; label: string };

type ProjectionStats = {
  proj_ip: number;
  proj_k: number;
  proj_bb: number;
  proj_hr: number;
  proj_h: number;
  proj_k9: number;
  proj_bb9: number;
  proj_hr9: number;
  proj_h9: number;
  proj_fip: number;
  proj_whip: number;
  proj_war: number;
};

const RATING_COLUMNS: RatingColumn[] = [
  { key: 'stu', label: 'STU P' },
  { key: 'mov', label: 'MOV P' },
  { key: 'con', label: 'CON P' },
  { key: 'babip', label: 'PBABIP P' },
  { key: 'hra', label: 'HRR P' },
  { key: 'fb', label: 'FBP' },
  { key: 'ch', label: 'CHP' },
  { key: 'cb', label: 'CBP' },
  { key: 'sl', label: 'SLP' },
  { key: 'si', label: 'SIP' },
  { key: 'sp', label: 'SPP' },
  { key: 'ct', label: 'CTP' },
  { key: 'fo', label: 'FOP' },
  { key: 'cc', label: 'CCP' },
  { key: 'sc', label: 'SCP' },
  { key: 'kc', label: 'KCP' },
  { key: 'kn', label: 'KNP' },
  { key: 'vt', label: 'VT' },
  { key: 'stm', label: 'STM' },
];

const PROJECTION_COLUMNS: ProjectionColumn[] = [
  { key: 'proj_ip', label: 'IP' },
  { key: 'proj_k', label: 'K' },
  { key: 'proj_bb', label: 'BB' },
  { key: 'proj_hr', label: 'HR' },
  { key: 'proj_h', label: 'H' },
  { key: 'proj_k9', label: 'K/9' },
  { key: 'proj_bb9', label: 'BB/9' },
  { key: 'proj_hr9', label: 'HR/9' },
  { key: 'proj_h9', label: 'H/9' },
  { key: 'proj_fip', label: 'FIP' },
  { key: 'proj_whip', label: 'WHIP' },
  { key: 'proj_war', label: 'WAR' },
];

type PitcherRow = {
  id: number;
  name: string;
  ratings: Record<string, string>;
  projection: ProjectionStats;
};

export class DraftBoardView {
  private container: HTMLElement;
  private mode: DraftMode = 'pitchers';
  private pitcherRows: PitcherRow[] = [];
  private sortKey?: string;
  private sortDirection: 'asc' | 'desc' = 'asc';

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.bindModeToggle();
    this.bindUpload();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="draft-board">
        <div class="draft-header">
          <h2>Draft Board</h2>
          <div class="toggle-group" role="tablist" aria-label="Draft type">
            <button class="toggle-btn active" data-mode="pitchers" role="tab" aria-selected="true">Pitchers</button>
            <button class="toggle-btn" data-mode="hitters" role="tab" aria-selected="false">Hitters</button>
          </div>
        </div>

        <div class="draft-section" data-section="pitchers">
          <div class="draft-upload">
            <div class="upload-info">
              <p class="draft-subtitle">Upload pitcher CSV (one row per player)</p>
              <pre class="csv-sample"><code>${this.sampleCsv()}</code></pre>
            </div>
            <div class="upload-actions">
              <div class="csv-upload-area" id="draft-drop-zone">
                <input type="file" id="draft-file-input" accept=".csv" hidden>
                <p>Drop CSV here or <button type="button" class="btn-link" id="draft-browse-btn">browse</button></p>
              </div>
            </div>
          </div>

          <div class="draft-results" id="draft-results"></div>
        </div>

        <div class="draft-section hidden" data-section="hitters">
          <div class="placeholder-card">
            <h3>Hitters</h3>
            <p>We will add hitter support here soon.</p>
          </div>
        </div>
      </div>
    `;
    this.renderPitcherTable();
  }

  private bindModeToggle(): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('.toggle-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode as DraftMode | undefined;
        if (mode && mode !== this.mode) {
          this.setMode(mode);
        }
      });
    });
  }

  private setMode(mode: DraftMode): void {
    this.mode = mode;
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('.toggle-btn');
    buttons.forEach((btn) => {
      const isActive = btn.dataset.mode === mode;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const sections = this.container.querySelectorAll<HTMLElement>('.draft-section');
    sections.forEach((section) => {
      const matches = section.dataset.section === mode;
      section.classList.toggle('hidden', !matches);
    });
  }

  private bindUpload(): void {
    const fileInput = this.container.querySelector<HTMLInputElement>('#draft-file-input');
    const browseBtn = this.container.querySelector<HTMLButtonElement>('#draft-browse-btn');
    const dropZone = this.container.querySelector<HTMLDivElement>('#draft-drop-zone');

    browseBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleFile(file);
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
      if (file && file.name.endsWith('.csv')) {
        this.handleFile(file);
      }
    });
  }

  private handleFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      this.parseCsv(content);
      this.renderPitcherTable();
    };
    reader.readAsText(file);
  }

  private parseCsv(content: string): void {
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      this.pitcherRows = [];
      return;
    }

    const rows: PitcherRow[] = [];
    const hasHeader = lines[0].toLowerCase().startsWith('name');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    dataLines.forEach((line, index) => {
      const cells = line.split(',').map((cell) => cell.trim());
      if (cells.length === 0 || !cells[0]) return;

      const ratings: Record<string, string> = {};
      RATING_COLUMNS.forEach((col, colIndex) => {
        ratings[col.key] = cells[colIndex + 1] ?? '-';
      });

      const name = cells[0];
      const projection = this.calculateProjection(ratings);

      rows.push({
        id: index,
        name,
        ratings,
        projection,
      });
    });

    this.pitcherRows = rows;
    this.sortKey = undefined;
    this.sortDirection = 'asc';
  }

  private renderPitcherTable(): void {
    const results = this.container.querySelector<HTMLDivElement>('#draft-results');
    if (!results) return;

    if (this.pitcherRows.length === 0) {
      results.innerHTML = '<p class="no-results">Upload a CSV to see pitchers on your board.</p>';
      return;
    }

    const body = this.getSortedRows().map((row, index) => this.renderPlayerRows(row, index)).join('');

    results.innerHTML = `
      <div class="table-wrapper">
        <table class="stats-table draft-table draft-compact">
          <thead>
            <tr>
              <th class="rank-header" data-sort-key="rank">#</th>
              <th data-sort-key="name">Player</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;

    this.bindSortHeaders();
    this.bindDragAndDrop();
  }

  private renderPlayerRows(row: PitcherRow, displayIndex: number): string {
    const rank = displayIndex + 1;
    const rankClass = rank <= 10 ? 'rank-badge rank-top' : 'rank-badge';

    const projection = this.ensureProjection(row);
    const ratingCells = RATING_COLUMNS.map((col) => `
      <div class="cell">
        <button type="button" class="cell-label" data-sort-key="${col.key}">${this.escape(col.label)}</button>
        <div class="cell-value">${this.escape(row.ratings[col.key] ?? '-')}</div>
      </div>
    `).join('');
    const projectionCells = [
      ['proj_ip', 0],
      ['proj_k', 0],
      ['proj_bb', 0],
      ['proj_hr', 0],
      ['proj_h', 0],
      ['proj_k9', 1],
      ['proj_bb9', 1],
      ['proj_hr9', 2],
      ['proj_h9', 1],
      ['proj_fip', 2],
      ['proj_whip', 2],
      ['proj_war', 1],
    ].map(([key, digits]) => {
      const value = projection[key as keyof ProjectionStats];
      return `
        <div class="cell">
          <button type="button" class="cell-label" data-sort-key="${key}">${this.escape(this.getProjectionLabel(key as keyof ProjectionStats))}</button>
          <div class="cell-value">${this.formatNumber(value, digits as number)}</div>
        </div>
      `;
    }).join('');

    return `
      <tr class="draft-row rating-row" draggable="true" data-index="${displayIndex}">
        <td class="${rankClass}">${rank}.</td>
        <td class="player-name">
          <div class="cell-label">Name</div>
          <div class="cell-value">${this.escape(row.name)}</div>
        </td>
        <td>
          <div class="grid rating-grid">
            ${ratingCells}
          </div>
        </td>
      </tr>
      <tr class="draft-row projection-row" draggable="true" data-index="${displayIndex}">
        <td></td>
        <td class="projection-label">
          <div class="cell-label">Projected</div>
          <div class="cell-value">Stats</div>
        </td>
        <td>
          <div class="grid projection-grid">
            ${projectionCells}
          </div>
        </td>
      </tr>
    `;
  }

  private bindSortHeaders(): void {
    const headers = this.container.querySelectorAll<HTMLTableCellElement>('th[data-sort-key]');
    headers.forEach((header) => {
      header.addEventListener('click', () => {
        const key = header.dataset.sortKey;
        if (!key) return;
        if (this.sortKey === key) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          this.sortDirection = 'asc';
        }
        this.renderPitcherTable();
      });
    });
  }

  private bindDragAndDrop(): void {
    const rows = this.container.querySelectorAll<HTMLTableRowElement>('.draft-row');
    let dragIndex: number | null = null;

    rows.forEach((row) => {
      row.addEventListener('dragstart', (e) => {
        dragIndex = Number(row.dataset.index);
        row.classList.add('dragging');
        e.dataTransfer?.setData('text/plain', String(dragIndex));
        e.dataTransfer?.setDragImage(row, 10, 10);
      });

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const targetIndex = Number(row.dataset.index);
        if (dragIndex === null || Number.isNaN(targetIndex)) return;
        this.reorderRows(dragIndex, targetIndex);
        dragIndex = null;
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
      });
    });
  }

  private reorderRows(from: number, to: number): void {
    if (from === to) return;
    const sorted = this.getSortedRows();
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    this.pitcherRows = sorted.map((row, idx) => ({ ...row, id: idx }));
    this.sortKey = undefined; // manual order now
    this.renderPitcherTable();
  }

  private getSortedRows(): PitcherRow[] {
    if (!this.sortKey || this.sortKey === 'rank') {
      return [...this.pitcherRows];
    }

    const isProjection = PROJECTION_COLUMNS.some((col) => col.key === this.sortKey);
    const isRating = RATING_COLUMNS.some((col) => col.key === this.sortKey);

    const sorted = [...this.pitcherRows].sort((a, b) => {
      const aVal = this.getSortValue(a, this.sortKey!, isProjection, isRating);
      const bVal = this.getSortValue(b, this.sortKey!, isProjection, isRating);
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return aVal - bVal;
      }
      return String(aVal).localeCompare(String(bVal));
    });

    if (this.sortDirection === 'desc') sorted.reverse();
    return sorted;
  }

  private getSortValue(row: PitcherRow, key: string, isProjection: boolean, isRating: boolean): string | number {
    if (key === 'name') return row.name;
    if (key === 'rank') return row.id;
    if (isProjection) {
      return (row.projection as Record<string, number>)[key] ?? 0;
    }
    if (isRating) {
      return this.parseNumericValue(row.ratings[key]) ?? 0;
    }
    return 0;
  }

  private calculateProjection(ratings: Record<string, string>): ProjectionStats {
    const ratingNumber = (value: string): number => {
      const parsed = this.parseNumericValue(value);
      if (parsed === null) return 50;
      const clamped = Math.min(Math.max(parsed, 20), 80);
      return clamped;
    };

    const inputs = {
      stuff: ratingNumber(ratings.stu),
      control: ratingNumber(ratings.con),
      hra: ratingNumber(ratings.hra),
      movement: ratingNumber(ratings.mov),
      babip: ratingNumber(ratings.babip),
    };

    const ip = 180;
    const stats = PotentialStatsService.calculatePitchingStats(inputs, ip);

    return {
      proj_ip: ip,
      proj_k: this.safeNumber(stats.k),
      proj_bb: this.safeNumber(stats.bb),
      proj_hr: this.safeNumber(stats.hr),
      proj_h: this.safeNumber(stats.ha),
      proj_k9: this.safeNumber(stats.k9),
      proj_bb9: this.safeNumber(stats.bb9),
      proj_hr9: this.safeNumber(stats.hr9),
      proj_h9: this.safeNumber(stats.h9),
      proj_fip: this.safeNumber(stats.fip),
      proj_whip: this.safeNumber(stats.whip),
      proj_war: this.safeNumber(stats.war),
    };
  }

  private parseNumericValue(value: string | undefined): number | null {
    if (!value) return null;
    if (value.trim() === '-') return null;
    const matches = value.match(/(\d+(?:\.\d+)?)/g);
    if (!matches || matches.length === 0) return null;
    const nums = matches.map(Number).filter((n) => !Number.isNaN(n));
    if (nums.length === 0) return null;
    const avg = nums.reduce((sum, n) => sum + n, 0) / nums.length;
    return avg;
  }

  private escape(value: string): string {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  private formatNumber(value: number, digits: number): string {
    if (!Number.isFinite(value)) return '-';
    return value.toFixed(digits);
  }

  private safeNumber(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return value;
  }

  private ensureProjection(row: PitcherRow): ProjectionStats {
    if (!row.projection) {
      row.projection = this.calculateProjection(row.ratings);
      return row.projection;
    }
    // Repair any missing numeric values
    const keys = Object.keys(row.projection) as Array<keyof ProjectionStats>;
    for (const key of keys) {
      const val = row.projection[key];
      row.projection[key] = Number.isFinite(val) ? val : 0;
    }
    return row.projection;
  }

  private getProjectionLabel(key: keyof ProjectionStats): string {
    const mapping: Record<keyof ProjectionStats, string> = {
      proj_ip: 'IP',
      proj_k: 'K',
      proj_bb: 'BB',
      proj_hr: 'HR',
      proj_h: 'H',
      proj_k9: 'K/9',
      proj_bb9: 'BB/9',
      proj_hr9: 'HR/9',
      proj_h9: 'H/9',
      proj_fip: 'FIP',
      proj_whip: 'WHIP',
      proj_war: 'WAR',
    };
    return mapping[key] ?? key;
  }

  private sampleCsv(): string {
    return [
      'Name,STU P,MOV P,CON P,PBABIP P,HRR P,FBP,CHP,CBP,SLP,SIP,SPP,CTP,FOP,CCP,SCP,KCP,KNP,VT,STM',
      'Hakim Abraha,45,45,45,45,45,80,40,-,60,-,-,-,-,-,-,-,-,100+,50',
      'Brian Acorn,50,50,50,45,55,65,55,-,60,-,-,-,-,-,-,-,-,93-95,65',
      'Tomohito Akamine,55,45,35,40,50,80,55,65,80,50,-,-,-,-,-,-,-,97-99,45',
    ].join('\n');
  }
}
