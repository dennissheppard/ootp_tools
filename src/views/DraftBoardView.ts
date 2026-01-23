import { PotentialStatsService } from '../services/PotentialStatsService';

type DraftMode = 'pitchers' | 'hitters';

type RatingColumn = { key: string; label: string };
type ProjectionColumn = { key: keyof ProjectionStats; label: string };

type ProjectionStats = {
  proj_ip: number;
  proj_k: number;
  proj_bb: number;
  proj_hr: number;
  proj_k9: number;
  proj_bb9: number;
  proj_hr9: number;
  proj_fip: number;
  proj_war: number;
};

type PitcherRow = {
  id: number;
  name: string;
  ratings: Record<string, string>;
  projection: ProjectionStats;
};

type HitterRow = {
  id: number;
  pos: string;
  name: string;
  age: string;
  bats: string;
  ratings: Record<string, string>;
};

type HitterHeaderKey =
  | 'pos'
  | 'name'
  | 'age'
  | 'bats'
  | 'con'
  | 'gap'
  | 'pow'
  | 'eye'
  | 'k'
  | 'c_abi'
  | 'c_frm'
  | 'c_arm'
  | 'if_rng'
  | 'if_err'
  | 'if_arm'
  | 'tdp'
  | 'of_rng'
  | 'of_err'
  | 'of_arm'
  | 'spe'
  | 'ste'
  | 'run';

type BoardState = {
  pitchers?: {
    rows: PitcherRow[];
    sortKey?: string;
    sortDirection?: 'asc' | 'desc';
  };
  hitters?: {
    rows: HitterRow[];
    sortKey?: string;
    sortDirection?: 'asc' | 'desc';
  };
};

const PITCHER_COLUMNS: RatingColumn[] = [
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
  { key: 'proj_k9', label: 'K/9' },
  { key: 'proj_bb9', label: 'BB/9' },
  { key: 'proj_hr9', label: 'HR/9' },
  { key: 'proj_fip', label: 'FIP' },
  { key: 'proj_war', label: 'WAR' },
];

const HITTER_COLUMNS: RatingColumn[] = [
  { key: 'pos', label: 'POS' },
  { key: 'age', label: 'AGE' },
  { key: 'bats', label: 'B' },
  { key: 'con', label: 'CON P' },
  { key: 'gap', label: 'GAP P' },
  { key: 'pow', label: 'POW P' },
  { key: 'eye', label: 'EYE P' },
  { key: 'k', label: 'K P' },
  { key: 'c_abi', label: 'C ABI' },
  { key: 'c_frm', label: 'C FRM' },
  { key: 'c_arm', label: 'C ARM' },
  { key: 'if_rng', label: 'IF RNG' },
  { key: 'if_err', label: 'IF ERR' },
  { key: 'if_arm', label: 'IF ARM' },
  { key: 'tdp', label: 'TDP' },
  { key: 'of_rng', label: 'OF RNG' },
  { key: 'of_err', label: 'OF ERR' },
  { key: 'of_arm', label: 'OF ARM' },
  { key: 'spe', label: 'SPE' },
  { key: 'ste', label: 'STE' },
  { key: 'run', label: 'RUN' },
];

const HITTER_HEADER_ALIASES: Record<HitterHeaderKey, string[]> = {
  pos: ['pos', 'position'],
  name: ['name', 'player'],
  age: ['age'],
  bats: ['b', 'bat', 'bats', 'hand'],
  con: ['conp', 'con', 'contact'],
  gap: ['gapp', 'gap'],
  pow: ['powp', 'pow', 'power'],
  eye: ['eyep', 'eye', 'discipline'],
  k: ['kp', 'k', 'avoidk', 'avoidks'],
  c_abi: ['cabi', 'c_abi', 'catcherability'],
  c_frm: ['cfrm', 'c_frm', 'frame', 'framing', 'catcherframing'],
  c_arm: ['carm', 'c_arm', 'catcherarm'],
  if_rng: ['ifrng', 'if_rng', 'infrange'],
  if_err: ['iferr', 'if_err', 'infielderror', 'iferror'],
  if_arm: ['ifarm', 'if_arm', 'infarm', 'infieldarm'],
  tdp: ['tdp', 'turndp', 'dp'],
  of_rng: ['ofrng', 'of_rng', 'outrange'],
  of_err: ['oferr', 'of_err', 'outerr', 'outfielderror'],
  of_arm: ['ofarm', 'of_arm', 'outarm', 'outfieldarm'],
  spe: ['spe', 'speed'],
  ste: ['ste', 'steal', 'stealing'],
  run: ['run', 'running'],
};

const HITTER_FALLBACK_INDEX: Record<HitterHeaderKey, number> = {
  pos: 0,
  name: 1,
  age: 2,
  bats: 3,
  con: 4,
  gap: 5,
  pow: 6,
  eye: 7,
  k: 8,
  c_abi: 9,
  c_frm: 10,
  c_arm: 11,
  if_rng: 12,
  if_err: 13,
  if_arm: 14,
  tdp: 15,
  of_rng: 16,
  of_err: 17,
  of_arm: 18,
  spe: 19,
  ste: 20,
  run: 21,
};
export class DraftBoardView {
  private container: HTMLElement;
  private mode: DraftMode = 'pitchers';
  private pitcherRows: PitcherRow[] = [];
  private hitterRows: HitterRow[] = [];
  private sortKey?: string;
  private sortDirection: 'asc' | 'desc' = 'asc';
  private hitterSortKey?: string;
  private hitterSortDirection: 'asc' | 'desc' = 'asc';
  private preferences: { hideUploadInfo: boolean };
  private pendingPitcherSortSave = false;
  private pendingHitterSortSave = false;
  private readonly prefKey = 'wbl-prefs';
  private readonly draftKey = 'wbl-draft-board';

  constructor(container: HTMLElement) {
    this.container = container;
    this.preferences = this.loadPreferences();
    this.loadDraftBoard();
    this.render();
    this.bindModeToggle();
    this.bindPitcherUpload();
    this.bindHitterUpload();
    this.bindPitcherInstructionToggles();
    this.bindHitterInstructionToggles();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="draft-board">
        <div class="draft-header">
          <h2>Draft Board</h2>
          <div class="toggle-group" role="tablist" aria-label="Draft type">
            <button class="toggle-btn ${this.mode === 'pitchers' ? 'active' : ''}" data-mode="pitchers" role="tab" aria-selected="${this.mode === 'pitchers'}">Pitchers</button>
            <button class="toggle-btn ${this.mode === 'hitters' ? 'active' : ''}" data-mode="hitters" role="tab" aria-selected="${this.mode === 'hitters'}">Hitters</button>
          </div>
        </div>

        <div class="draft-section ${this.mode === 'pitchers' ? '' : 'hidden'}" data-section="pitchers">
          <div class="draft-upload">
            <div class="upload-info ${this.preferences.hideUploadInfo ? 'collapsed' : ''}" id="upload-info-pitchers">
              <button type="button" class="instructions-dismiss" data-dismiss-pitcher aria-label="Hide instructions">x</button>
              <p class="draft-subtitle">Upload pitcher CSV (one row per player)</p>
              <pre class="csv-sample"><code>${this.samplePitcherCsv()}</code></pre>
            </div>
            <div class="upload-actions">
              <div class="csv-upload-area" id="pitcher-drop-zone" ${this.pitcherRows.length ? 'style="display:none;"' : ''}>
                <input type="file" id="pitcher-file-input" accept=".csv" hidden>
                <p>Drop CSV here or <button type="button" class="btn-link" id="pitcher-browse-btn">browse</button></p>
              </div>
              <div class="upload-buttons">
                <button type="button" class="btn-link show-instructions" id="show-instructions-pitchers" ${this.preferences.hideUploadInfo ? '' : 'style="display:none;"'}>
                  Show instructions
                </button>
                <span class="saved-note" id="pitcher-saved-note" ${this.pitcherRows.length ? '' : 'style="display:none;"'}>
                  Using your saved draft list from last upload.
                  <button type="button" class="btn-link" id="pitcher-clear-link">clear</button>
                </span>
              </div>
            </div>
          </div>

          <div class="draft-results" id="draft-results"></div>
        </div>

        <div class="draft-section ${this.mode === 'hitters' ? '' : 'hidden'}" data-section="hitters">
          <div class="draft-upload">
            <div class="upload-info ${this.preferences.hideUploadInfo ? 'collapsed' : ''}" id="upload-info-hitters">
              <button type="button" class="instructions-dismiss" data-dismiss-hitter aria-label="Hide instructions">x</button>
              <p class="draft-subtitle">Upload hitter CSV (one row per player)</p>
              <pre class="csv-sample"><code>${this.sampleHitterCsv()}</code></pre>
            </div>
            <div class="upload-actions">
              <div class="csv-upload-area" id="hitter-drop-zone" ${this.hitterRows.length ? 'style="display:none;"' : ''}>
                <input type="file" id="hitter-file-input" accept=".csv" hidden>
                <p>Drop CSV here or <button type="button" class="btn-link" id="hitter-browse-btn">browse</button></p>
              </div>
              <div class="upload-buttons">
                <button type="button" class="btn-link show-instructions" id="show-instructions-hitters" ${this.preferences.hideUploadInfo ? '' : 'style="display:none;"'}>
                  Show instructions
                </button>
                <span class="saved-note" id="hitter-saved-note" ${this.hitterRows.length ? '' : 'style="display:none;"'}>
                  Using your saved draft list from last upload.
                  <button type="button" class="btn-link" id="hitter-clear-link">clear</button>
                </span>
              </div>
            </div>
          </div>

          <div class="draft-results" id="hitter-results"></div>
        </div>
      </div>
    `;
    this.renderPitcherTable();
    this.renderHitterTable();
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
      btn.setAttribute('aria-selected', String(isActive));
    });

    const sections = this.container.querySelectorAll<HTMLElement>('.draft-section');
    sections.forEach((section) => {
      const matches = section.dataset.section === mode;
      section.classList.toggle('hidden', !matches);
    });
  }

  private bindPitcherUpload(): void {
    const fileInput = this.container.querySelector<HTMLInputElement>('#pitcher-file-input');
    const browseBtn = this.container.querySelector<HTMLButtonElement>('#pitcher-browse-btn');
    const dropZone = this.container.querySelector<HTMLDivElement>('#pitcher-drop-zone');
    const clearLink = this.container.querySelector<HTMLButtonElement>('#pitcher-clear-link');

    browseBtn?.addEventListener('click', () => fileInput?.click());
    clearLink?.addEventListener('click', () => {
      this.clearPitchers();
      if (fileInput) fileInput.value = '';
    });

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handlePitcherFile(file);
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
      if (file && file.name.endsWith('.csv')) {
        this.handlePitcherFile(file);
      }
    });
  }

  private bindHitterUpload(): void {
    const fileInput = this.container.querySelector<HTMLInputElement>('#hitter-file-input');
    const browseBtn = this.container.querySelector<HTMLButtonElement>('#hitter-browse-btn');
    const dropZone = this.container.querySelector<HTMLDivElement>('#hitter-drop-zone');
    const clearLink = this.container.querySelector<HTMLButtonElement>('#hitter-clear-link');

    browseBtn?.addEventListener('click', () => fileInput?.click());
    clearLink?.addEventListener('click', () => {
      this.clearHitters();
      if (fileInput) fileInput.value = '';
    });

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleHitterFile(file);
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
      if (file && file.name.endsWith('.csv')) {
        this.handleHitterFile(file);
      }
    });
  }

  private bindPitcherInstructionToggles(): void {
    const info = this.container.querySelector<HTMLDivElement>('#upload-info-pitchers');
    const dismiss = this.container.querySelector<HTMLButtonElement>('[data-dismiss-pitcher]');
    const showBtn = this.container.querySelector<HTMLButtonElement>('#show-instructions-pitchers');

    const applyVisibility = (hidden: boolean) => {
      if (info) info.classList.toggle('collapsed', hidden);
      if (showBtn) showBtn.style.display = hidden ? 'inline-block' : 'none';
      this.preferences.hideUploadInfo = hidden;
      this.savePreferences();
    };

    dismiss?.addEventListener('click', () => applyVisibility(true));
    showBtn?.addEventListener('click', () => applyVisibility(false));
  }

  private bindHitterInstructionToggles(): void {
    const info = this.container.querySelector<HTMLDivElement>('#upload-info-hitters');
    const dismiss = this.container.querySelector<HTMLButtonElement>('[data-dismiss-hitter]');
    const showBtn = this.container.querySelector<HTMLButtonElement>('#show-instructions-hitters');

    const applyVisibility = (hidden: boolean) => {
      if (info) info.classList.toggle('collapsed', hidden);
      if (showBtn) showBtn.style.display = hidden ? 'inline-block' : 'none';
      this.preferences.hideUploadInfo = hidden;
      this.savePreferences();
    };

    dismiss?.addEventListener('click', () => applyVisibility(true));
    showBtn?.addEventListener('click', () => applyVisibility(false));
  }
  private handlePitcherFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      this.parsePitcherCsv(content);
      this.saveDraftBoard();
      this.renderPitcherTable();
    };
    reader.readAsText(file);
  }

  private handleHitterFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      this.parseHitterCsv(content);
      this.saveDraftBoard();
      this.renderHitterTable();
    };
    reader.readAsText(file);
  }

  private parsePitcherCsv(content: string): void {
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      this.pitcherRows = [];
      this.sortKey = undefined;
      this.sortDirection = 'asc';
      return;
    }

    const rows: PitcherRow[] = [];
    const firstCells = this.splitCsvLine(lines[0]);
    const firstCell = this.normalizeHeader(firstCells[0] ?? '');
    const hasHeader = firstCell === 'name' || firstCell === 'player';
    const dataLines = hasHeader ? lines.slice(1) : lines;

    dataLines.forEach((line, index) => {
      const cells = this.splitCsvLine(line);
      if (cells.length === 0 || !cells[0]) return;

      const ratings: Record<string, string> = {};
      PITCHER_COLUMNS.forEach((col, colIndex) => {
        ratings[col.key] = cells[colIndex + 1] ?? '-';
      });

      rows.push({
        id: index,
        name: cells[0],
        ratings,
        projection: this.calculateProjection(ratings),
      });
    });

    this.pitcherRows = rows;
    this.sortKey = undefined;
    this.sortDirection = 'asc';
    this.pendingPitcherSortSave = false;
  }

  private parseHitterCsv(content: string): void {
    const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      this.hitterRows = [];
      this.hitterSortKey = undefined;
      this.hitterSortDirection = 'asc';
      return;
    }

    const rows: HitterRow[] = [];
    const headerCells = this.splitCsvLine(lines[0]);
    const { indexMap, hasHeader } = this.buildHitterHeaderMap(headerCells);
    const dataLines = hasHeader ? lines.slice(1) : lines;

    dataLines.forEach((line, index) => {
      const cells = this.splitCsvLine(line);
      const valueFor = (key: HitterHeaderKey): string => {
        const idx = indexMap[key];
        const fallbackIndex = HITTER_FALLBACK_INDEX[key];
        const fromCells = typeof idx === 'number' ? cells[idx] : cells[fallbackIndex];
        return fromCells ?? '-';
      };

      const name = valueFor('name');
      if (!name) return;

      const ratings: Record<string, string> = {};
      ratings.pos = valueFor('pos');
      ratings.age = valueFor('age');
      ratings.bats = valueFor('bats');
      ratings.con = valueFor('con');
      ratings.gap = valueFor('gap');
      ratings.pow = valueFor('pow');
      ratings.eye = valueFor('eye');
      ratings.k = valueFor('k');
      ratings.c_abi = valueFor('c_abi');
      ratings.c_frm = valueFor('c_frm');
      ratings.c_arm = valueFor('c_arm');
      ratings.if_rng = valueFor('if_rng');
      ratings.if_err = valueFor('if_err');
      ratings.if_arm = valueFor('if_arm');
      ratings.tdp = valueFor('tdp');
      ratings.of_rng = valueFor('of_rng');
      ratings.of_err = valueFor('of_err');
      ratings.of_arm = valueFor('of_arm');
      ratings.spe = valueFor('spe');
      ratings.ste = valueFor('ste');
      ratings.run = valueFor('run');

      rows.push({
        id: index,
        pos: ratings.pos,
        name,
        age: ratings.age,
        bats: ratings.bats,
        ratings,
      });
    });

    this.hitterRows = rows;
    this.hitterSortKey = undefined;
    this.hitterSortDirection = 'asc';
    this.pendingHitterSortSave = false;
  }
  private renderPitcherTable(): void {
    const results = this.container.querySelector<HTMLDivElement>('#draft-results');
    if (!results) return;

    if (this.pitcherRows.length === 0) {
      results.innerHTML = '<p class="no-results">Upload a CSV to see pitchers on your board.</p>';
      this.updatePitcherSavedStateUI();
      return;
    }

    const body = this.getSortedPitcherRows().map((row, index) => this.renderPitcherRows(row, index)).join('');
    const sortPrompt = this.sortKey && this.pendingPitcherSortSave
      ? `
        <div class="sort-save-banner" role="status">
          <span>Do you want to save the order of your draft board?</span>
          <div class="sort-save-actions">
            <button type="button" class="btn-link" id="pitcher-save-sort">Save order</button>
            <button type="button" class="btn-link" id="pitcher-dismiss-sort">Not now</button>
          </div>
        </div>
      `
      : '';

    results.innerHTML = `
      <div class="table-wrapper">
        ${sortPrompt}
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

    this.bindPitcherSortHeaders();
    this.bindPitcherDragAndDrop();
    this.bindPitcherSortSavePrompt();
    this.updatePitcherSavedStateUI();
  }

  private renderHitterTable(): void {
    const results = this.container.querySelector<HTMLDivElement>('#hitter-results');
    if (!results) return;

    if (this.hitterRows.length === 0) {
      results.innerHTML = '<p class="no-results">Upload a CSV to see hitters on your board.</p>';
      this.updateHitterSavedStateUI();
      return;
    }

    const body = this.getSortedHitterRows().map((row, index) => this.renderHitterRow(row, index)).join('');
    const sortPrompt = this.hitterSortKey && this.pendingHitterSortSave
      ? `
        <div class="sort-save-banner" role="status">
          <span>Do you want to save the order of your draft board?</span>
          <div class="sort-save-actions">
            <button type="button" class="btn-link" id="hitter-save-sort">Save order</button>
            <button type="button" class="btn-link" id="hitter-dismiss-sort">Not now</button>
          </div>
        </div>
      `
      : '';

    results.innerHTML = `
      <div class="table-wrapper">
        ${sortPrompt}
        <table class="stats-table draft-table draft-compact">
          <thead>
            <tr>
              <th class="rank-header" data-hitter-sort="rank">#</th>
              <th data-hitter-sort="name">Player</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;

    this.bindHitterSortHeaders();
    this.bindHitterDragAndDrop();
    this.bindHitterSortSavePrompt();
    this.updateHitterSavedStateUI();
  }
  private renderPitcherRows(row: PitcherRow, displayIndex: number): string {
    const rank = displayIndex + 1;
    const rankClass = rank <= 10 ? 'rank-badge rank-top' : 'rank-badge';

    const projection = this.ensureProjection(row);
    const ratingCells = PITCHER_COLUMNS.map((col) => {
      const value = row.ratings[col.key] ?? '-';
      const valueNum = this.parseNumericValue(value) ?? 0;
      const tier = this.getRatingTier(valueNum);
      const isActive = this.sortKey === col.key;
      return `
        <div class="cell rating-cell rating-${tier} ${isActive ? 'sort-active' : ''}">
          <button type="button" class="cell-label" data-sort-key="${col.key}">
            ${this.escape(col.label)}
          </button>
          <div class="cell-value">${this.escape(value)}</div>
        </div>
      `;
    }).join('');
    const projectionCells = [
      ['proj_ip', 0],
      ['proj_k', 0],
      ['proj_bb', 0],
      ['proj_hr', 0],
      ['proj_k9', 1],
      ['proj_bb9', 1],
      ['proj_hr9', 2],
      ['proj_fip', 2],
      ['proj_war', 1],
    ].map(([key, digits]) => {
      const value = projection[key as keyof ProjectionStats];
      const isActive = this.sortKey === key;
      return `
        <div class="cell ${isActive ? 'sort-active' : ''}">
          <button type="button" class="cell-label" data-sort-key="${key}">
            ${this.escape(this.getProjectionLabel(key as keyof ProjectionStats))}
          </button>
          <div class="cell-value">${this.formatNumber(value, digits as number)}</div>
        </div>
      `;
    }).join('');

    return `
      <tr class="draft-row rating-row" draggable="true" data-index="${displayIndex}">
        <td class="${rankClass}">${rank}.</td>
        <td class="player-cell player-name">
          <div class="cell-label" data-sort-key="name">Name</div>
          <div class="cell-value">${this.escape(row.name)}</div>
        </td>
        <td class="details-cell">
          <div class="grid rating-grid">
            ${ratingCells}
          </div>
        </td>
      </tr>
      <tr class="draft-row projection-row" draggable="true" data-index="${displayIndex}">
        <td></td>
        <td class="player-cell projection-label">
          <div class="cell-label">Projected</div>
          <div class="cell-value">Stats</div>
        </td>
        <td class="details-cell">
          <div class="grid projection-grid">
            ${projectionCells}
          </div>
        </td>
      </tr>
    `;
  }

  private renderHitterRow(row: HitterRow, displayIndex: number): string {
    const rank = displayIndex + 1;
    const rankClass = rank <= 10 ? 'rank-badge rank-top' : 'rank-badge';

    const ratingCells = HITTER_COLUMNS.map((col) => {
      const value = row.ratings[col.key] ?? '-';
      const valueNum = this.parseNumericValue(value) ?? 0;
      const tier = this.getRatingTier(valueNum);
      const isActive = this.hitterSortKey === col.key;
      return `
        <div class="cell rating-cell rating-${tier} ${isActive ? 'sort-active' : ''}">
          <button type="button" class="cell-label" data-hitter-sort="${col.key}">
            ${this.escape(col.label)}
          </button>
          <div class="cell-value">${this.escape(value)}</div>
        </div>
      `;
    }).join('');

    return `
      <tr class="draft-row rating-row" draggable="true" data-index="${displayIndex}">
        <td class="${rankClass}">${rank}.</td>
        <td class="player-cell player-name">
          <div class="cell-label" data-hitter-sort="name">Name</div>
          <div class="cell-value">${this.escape(row.name)}</div>
        </td>
        <td class="details-cell">
          <div class="grid rating-grid">
            ${ratingCells}
          </div>
        </td>
      </tr>
    `;
  }

  private bindPitcherSortHeaders(): void {
    const clickable = this.container.querySelectorAll<HTMLElement>('[data-sort-key]');
    clickable.forEach((el) => {
      el.addEventListener('click', (event) => {
        const key = el.dataset.sortKey;
        if (!key) return;
        if (this.sortKey === key) {
          this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.sortKey = key;
          this.sortDirection = 'asc';
        }
        this.pendingPitcherSortSave = true;
        this.showSortHint(event as MouseEvent);
        this.renderPitcherTable();
      });
    });
  }

  private bindHitterSortHeaders(): void {
    const clickable = this.container.querySelectorAll<HTMLElement>('[data-hitter-sort]');
    clickable.forEach((el) => {
      el.addEventListener('click', () => {
        const key = el.dataset.hitterSort;
        if (!key) return;
        if (this.hitterSortKey === key) {
          this.hitterSortDirection = this.hitterSortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          this.hitterSortKey = key;
          this.hitterSortDirection = 'asc';
        }
        this.pendingHitterSortSave = true;
        this.renderHitterTable();
      });
    });
  }
  private bindPitcherDragAndDrop(): void {
    const rows = this.container.querySelectorAll<HTMLTableRowElement>('#draft-results .draft-row');
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
        this.reorderPitchers(dragIndex, targetIndex);
        dragIndex = null;
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
      });
    });
  }

  private bindHitterDragAndDrop(): void {
    const rows = this.container.querySelectorAll<HTMLTableRowElement>('#hitter-results .draft-row');
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
        this.reorderHitters(dragIndex, targetIndex);
        dragIndex = null;
      });

      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
      });
    });
  }

  private reorderPitchers(from: number, to: number): void {
    if (from === to) return;
    const sorted = this.getSortedPitcherRows();
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    this.pitcherRows = sorted.map((row, idx) => ({ ...row, id: idx }));
    this.sortKey = undefined;
    this.pendingPitcherSortSave = false;
    this.saveDraftBoard();
    this.renderPitcherTable();
  }

  private reorderHitters(from: number, to: number): void {
    if (from === to) return;
    const sorted = this.getSortedHitterRows();
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    this.hitterRows = sorted.map((row, idx) => ({ ...row, id: idx }));
    this.hitterSortKey = undefined;
    this.pendingHitterSortSave = false;
    this.saveDraftBoard();
    this.renderHitterTable();
  }
  private getSortedPitcherRows(): PitcherRow[] {
    if (!this.sortKey || this.sortKey === 'rank') {
      return [...this.pitcherRows];
    }

    const isProjection = PROJECTION_COLUMNS.some((col) => col.key === this.sortKey);
    const isRating = PITCHER_COLUMNS.some((col) => col.key === this.sortKey);

    const sorted = [...this.pitcherRows].sort((a, b) => {
      const aVal = this.getPitcherSortValue(a, this.sortKey!, isProjection, isRating);
      const bVal = this.getPitcherSortValue(b, this.sortKey!, isProjection, isRating);
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return aVal - bVal;
      }
      return String(aVal).localeCompare(String(bVal));
    });

    if (this.sortDirection === 'desc') sorted.reverse();
    return sorted;
  }

  private getSortedHitterRows(): HitterRow[] {
    if (!this.hitterSortKey || this.hitterSortKey === 'rank') {
      return [...this.hitterRows];
    }

    const sorted = [...this.hitterRows].sort((a, b) => {
      const aVal = this.getHitterSortValue(a, this.hitterSortKey!);
      const bVal = this.getHitterSortValue(b, this.hitterSortKey!);
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return aVal - bVal;
      }
      return String(aVal).localeCompare(String(bVal));
    });

    if (this.hitterSortDirection === 'desc') sorted.reverse();
    return sorted;
  }

  private getPitcherSortValue(row: PitcherRow, key: string, isProjection: boolean, isRating: boolean): string | number {
    if (key === 'name') return row.name;
    if (key === 'rank') return row.id;
    if (isProjection) return (row.projection as Record<string, number>)[key] ?? 0;
    if (isRating) return this.parseNumericValue(row.ratings[key]) ?? 0;
    return 0;
  }

  private getHitterSortValue(row: HitterRow, key: string): string | number {
    if (key === 'name') return row.name;
    if (key === 'rank') return row.id;
    const value = row.ratings[key];
    const num = this.parseNumericValue(value);
    return num ?? value ?? '';
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
      proj_k9: this.safeNumber(stats.k9),
      proj_bb9: this.safeNumber(stats.bb9),
      proj_hr9: this.safeNumber(stats.hr9),
      proj_fip: this.safeNumber(stats.fip),
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
      proj_k9: 'K/9',
      proj_bb9: 'BB/9',
      proj_hr9: 'HR/9',
      proj_fip: 'FIP',
      proj_war: 'WAR',
    };
    return mapping[key] ?? key;
  }

  private getRatingTier(value: number): string {
    if (value >= 70) return 'elite';
    if (value >= 60) return 'plus';
    if (value >= 50) return 'avg';
    if (value >= 40) return 'fringe';
    return 'poor';
  }

  private showSortHint(event: MouseEvent): void {
    const arrow = document.createElement('div');
    arrow.className = 'sort-fade-hint';
    arrow.textContent = this.sortDirection === 'asc' ? '^' : 'v';
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
  private loadPreferences(): { hideUploadInfo: boolean } {
    if (typeof window === 'undefined') return { hideUploadInfo: false };
    try {
      const raw = localStorage.getItem(this.prefKey);
      if (!raw) return { hideUploadInfo: false };
      const parsed = JSON.parse(raw);
      return { hideUploadInfo: Boolean(parsed.hideUploadInfo) };
    } catch {
      return { hideUploadInfo: false };
    }
  }

  private savePreferences(): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(this.prefKey, JSON.stringify(this.preferences));
    } catch {
      // ignore storage errors
    }
  }

  private loadDraftBoard(): void {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(this.draftKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as BoardState;

      if (parsed.pitchers?.rows) {
        this.pitcherRows = parsed.pitchers.rows
          .map((row, idx) => this.normalizePitcherRow(row, idx))
          .filter((row): row is PitcherRow => Boolean(row?.name));
        this.sortKey = parsed.pitchers.sortKey;
        this.sortDirection = parsed.pitchers.sortDirection ?? 'asc';
      }

      if (parsed.hitters?.rows) {
        this.hitterRows = parsed.hitters.rows
          .map((row, idx) => this.normalizeHitterRow(row, idx))
          .filter((row): row is HitterRow => Boolean(row?.name));
        this.hitterSortKey = parsed.hitters.sortKey;
        this.hitterSortDirection = parsed.hitters.sortDirection ?? 'asc';
      }
    } catch {
      // ignore storage errors
    }
  }

  private saveDraftBoard(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!this.pitcherRows.length && !this.hitterRows.length) {
        localStorage.removeItem(this.draftKey);
        return;
      }
      const state: BoardState = {
        pitchers: {
          rows: this.pitcherRows,
          sortKey: this.sortKey,
          sortDirection: this.sortDirection,
        },
        hitters: {
          rows: this.hitterRows,
          sortKey: this.hitterSortKey,
          sortDirection: this.hitterSortDirection,
        },
      };
      localStorage.setItem(this.draftKey, JSON.stringify(state));
    } catch {
      // ignore storage errors
    }
  }

  private clearPitchers(): void {
    this.pitcherRows = [];
    this.sortKey = undefined;
    this.sortDirection = 'asc';
    this.pendingPitcherSortSave = false;
    this.saveDraftBoard();
    this.renderPitcherTable();
  }

  private clearHitters(): void {
    this.hitterRows = [];
    this.hitterSortKey = undefined;
    this.hitterSortDirection = 'asc';
    this.pendingHitterSortSave = false;
    this.saveDraftBoard();
    this.renderHitterTable();
  }

  private updatePitcherSavedStateUI(): void {
    const savedNote = this.container.querySelector<HTMLSpanElement>('#pitcher-saved-note');
    const hasRows = this.pitcherRows.length > 0;
    const dropZone = this.container.querySelector<HTMLDivElement>('#pitcher-drop-zone');
    const showInstructions = this.container.querySelector<HTMLButtonElement>('#show-instructions-pitchers');

    if (savedNote) savedNote.style.display = hasRows ? 'inline-flex' : 'none';
    if (dropZone) dropZone.style.display = hasRows ? 'none' : '';
    if (showInstructions) {
      showInstructions.style.display = hasRows ? 'none' : (this.preferences.hideUploadInfo ? 'inline-block' : 'none');
    }
  }

  private updateHitterSavedStateUI(): void {
    const savedNote = this.container.querySelector<HTMLSpanElement>('#hitter-saved-note');
    const hasRows = this.hitterRows.length > 0;
    const dropZone = this.container.querySelector<HTMLDivElement>('#hitter-drop-zone');
    const showInstructions = this.container.querySelector<HTMLButtonElement>('#show-instructions-hitters');

    if (savedNote) savedNote.style.display = hasRows ? 'inline-flex' : 'none';
    if (dropZone) dropZone.style.display = hasRows ? 'none' : '';
    if (showInstructions) {
      showInstructions.style.display = hasRows ? 'none' : (this.preferences.hideUploadInfo ? 'inline-block' : 'none');
    }
  }

  private normalizePitcherRow(row: any, fallbackId: number): PitcherRow | null {
    if (!row || typeof row !== 'object') return null;
    const ratings = typeof row.ratings === 'object' && row.ratings !== null ? row.ratings : {};
    const normalized: PitcherRow = {
      id: typeof row.id === 'number' ? row.id : fallbackId,
      name: typeof row.name === 'string' ? row.name : '',
      ratings,
      projection: typeof row.projection === 'object' && row.projection !== null
        ? row.projection
        : this.calculateProjection(ratings),
    };
    normalized.projection = this.ensureProjection(normalized);
    return normalized;
  }

  private normalizeHitterRow(row: any, fallbackId: number): HitterRow | null {
    if (!row || typeof row !== 'object') return null;
    const ratings = typeof row.ratings === 'object' && row.ratings !== null ? row.ratings : {};
    const normalized: HitterRow = {
      id: typeof row.id === 'number' ? row.id : fallbackId,
      pos: typeof row.pos === 'string' ? row.pos : ratings.pos ?? '',
      name: typeof row.name === 'string' ? row.name : '',
      age: typeof row.age === 'string' ? row.age : ratings.age ?? '',
      bats: typeof row.bats === 'string' ? row.bats : ratings.bats ?? '',
      ratings,
    };
    normalized.ratings.pos = normalized.pos || ratings.pos || '-';
    normalized.ratings.age = normalized.age || ratings.age || '-';
    normalized.ratings.bats = normalized.bats || ratings.bats || '-';
    return normalized;
  }

  private samplePitcherCsv(): string {
    return [
      'Name,STU P,MOV P,CON P,PBABIP P,HRR P,FBP,CHP,CBP,SLP,SIP,SPP,CTP,FOP,CCP,SCP,KCP,KNP,VT,STM',
      'Hakim Abraha,45,45,45,45,45,80,40,-,60,-,-,-,-,-,-,-,-,100+,50',
      'Brian Acorn,50,50,50,45,55,65,55,-,60,-,-,-,-,-,-,-,-,93-95,65',
      'Tomohito Akamine,55,45,35,40,50,80,55,65,80,50,-,-,-,-,-,-,-,97-99,45',
    ].join('\n');
  }

  private sampleHitterCsv(): string {
    return [
      'POS,Name,Age,B,CON P,GAP P,POW P,EYE P,K P,C ABI,C FRM,C ARM,IF RNG,IF ERR,IF ARM,TDP,OF RNG,OF ERR,OF ARM,SPE,STE,RUN',
      'RF,Tom Cowser,21,R,55,55,80,80,50,20,20,20,45,40,40,20,55,50,55,40,40,45',
      '3B,Bill Knowles,18,R,70,55,65,75,65,20,20,20,55,50,55,45,45,40,40,40,50,50',
      'SS,Ratko Moljevic,19,R,60,80,70,70,55,20,20,20,60,50,55,55,50,40,55,55,45,55',
    ].join('\n');
  }

  private splitCsvLine(line: string): string[] {
    return line.split(',').map((cell) => this.cleanCell(cell));
  }

  private cleanCell(value: string): string {
    return value.replace(/^\ufeff/, '').trim();
  }

  private normalizeHeader(value: string): string {
    return value.replace(/^\ufeff/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private buildHitterHeaderMap(headerCells: string[]): { indexMap: Partial<Record<HitterHeaderKey, number>>; hasHeader: boolean } {
    const normalized = headerCells.map((cell) => this.normalizeHeader(cell));
    const indexMap: Partial<Record<HitterHeaderKey, number>> = {};
    let matches = 0;

    const tryRegister = (key: HitterHeaderKey) => {
      const aliases = HITTER_HEADER_ALIASES[key];
      const idx = normalized.findIndex((header) => aliases.includes(header));
      if (idx !== -1) {
        indexMap[key] = idx;
        matches += 1;
      }
    };

    (Object.keys(HITTER_HEADER_ALIASES) as HitterHeaderKey[]).forEach(tryRegister);

    const hasHeader = matches >= 5;
    return { indexMap, hasHeader };
  }

  private bindPitcherSortSavePrompt(): void {
    const saveBtn = this.container.querySelector<HTMLButtonElement>('#pitcher-save-sort');
    const dismissBtn = this.container.querySelector<HTMLButtonElement>('#pitcher-dismiss-sort');

    saveBtn?.addEventListener('click', () => this.commitPitcherSortedOrder());
    dismissBtn?.addEventListener('click', () => {
      this.pendingPitcherSortSave = false;
      this.renderPitcherTable();
    });
  }

  private bindHitterSortSavePrompt(): void {
    const saveBtn = this.container.querySelector<HTMLButtonElement>('#hitter-save-sort');
    const dismissBtn = this.container.querySelector<HTMLButtonElement>('#hitter-dismiss-sort');

    saveBtn?.addEventListener('click', () => this.commitHitterSortedOrder());
    dismissBtn?.addEventListener('click', () => {
      this.pendingHitterSortSave = false;
      this.renderHitterTable();
    });
  }

  private commitPitcherSortedOrder(): void {
    const sorted = this.getSortedPitcherRows();
    this.pitcherRows = sorted.map((row, idx) => ({ ...row, id: idx }));
    this.sortKey = undefined;
    this.pendingPitcherSortSave = false;
    this.saveDraftBoard();
    this.renderPitcherTable();
  }

  private commitHitterSortedOrder(): void {
    const sorted = this.getSortedHitterRows();
    this.hitterRows = sorted.map((row, idx) => ({ ...row, id: idx }));
    this.hitterSortKey = undefined;
    this.pendingHitterSortSave = false;
    this.saveDraftBoard();
    this.renderHitterTable();
  }
}
