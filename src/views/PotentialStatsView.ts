import {
  PotentialStatsService,
  PitcherRatings,
  PotentialPitchingStats,
} from '../services/PotentialStatsService';

type ResultRow = { name: string } & PotentialPitchingStats & PitcherRatings;

export class PotentialStatsView {
  private container: HTMLElement;
  private results: ResultRow[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="potential-stats-section">
        <h2 class="section-title">WBL Potential Stats Calculator</h2>
        <p class="section-subtitle">Enter pitcher ratings to calculate projected WBL stats</p>

        <div class="potential-stats-content">
          <!-- Manual Entry Form -->
          <div class="rating-form-container">
            <h3 class="form-title">Enter Ratings (20-80 scale)</h3>
            <form id="rating-form" class="rating-form">
              <div class="rating-inputs">
                <div class="rating-field">
                  <label for="rating-stuff">Stuff</label>
                  <input type="number" id="rating-stuff" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-control">Control</label>
                  <input type="number" id="rating-control" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-hra">HRA</label>
                  <input type="number" id="rating-hra" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-movement">Movement</label>
                  <input type="number" id="rating-movement" min="20" max="80" value="50" required>
                </div>
                <div class="rating-field">
                  <label for="rating-babip">BABIP</label>
                  <input type="number" id="rating-babip" min="20" max="80" value="50" required>
                </div>
              </div>
              <div class="form-actions">
                <input type="text" id="rating-name" placeholder="Player name (optional)" class="name-input">
                <div class="ip-input-wrapper">
                  <label for="rating-ip">IP:</label>
                  <input type="number" id="rating-ip" min="10" max="250" value="180" class="ip-input">
                </div>
                <button type="submit" class="btn btn-primary">Calculate & Add</button>
              </div>
            </form>
          </div>

          <!-- CSV Upload -->
          <div class="csv-upload-container">
            <h3 class="form-title">Or Upload CSV</h3>
            <p class="csv-format">Format: name, stuff, control, hra, movement, babip [, ip]</p>
            <div class="csv-upload-area" id="csv-drop-zone">
              <input type="file" id="csv-file-input" accept=".csv" hidden>
              <p>Drop CSV file here or <button type="button" class="btn-link" id="csv-browse-btn">browse</button></p>
            </div>
            <div class="formula-note">
              <strong>WBL-Calibrated Formulas:</strong><br>
              K/9: R²=0.22 (diminishing returns at high Stuff)<br>
              BB/9: R²=0.43 (strongest predictor)<br>
              HR/9: R²=0.20 | H/9: R²=0.06 (high variance)
            </div>
          </div>
        </div>

        <!-- Results Table -->
        <div class="results-container" id="results-container">
          <div class="results-header">
            <h3 class="form-title">Projected WBL Stats</h3>
            <button type="button" class="btn btn-secondary" id="clear-results-btn" style="display: none;">Clear All</button>
          </div>
          <div id="results-table-wrapper"></div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    const form = this.container.querySelector<HTMLFormElement>('#rating-form');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleManualEntry();
    });

    const fileInput = this.container.querySelector<HTMLInputElement>('#csv-file-input');
    const browseBtn = this.container.querySelector<HTMLButtonElement>('#csv-browse-btn');
    const dropZone = this.container.querySelector<HTMLDivElement>('#csv-drop-zone');

    browseBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleCSVFile(file);
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
        this.handleCSVFile(file);
      }
    });

    const clearBtn = this.container.querySelector<HTMLButtonElement>('#clear-results-btn');
    clearBtn?.addEventListener('click', () => {
      this.results = [];
      this.renderResults();
    });
  }

  private handleManualEntry(): void {
    const getValue = (id: string): number => {
      const input = this.container.querySelector<HTMLInputElement>(`#${id}`);
      return Number(input?.value) || 50;
    };

    const nameInput = this.container.querySelector<HTMLInputElement>('#rating-name');
    const name = nameInput?.value.trim() || `Pitcher ${this.results.length + 1}`;

    const ratings: PitcherRatings = {
      stuff: getValue('rating-stuff'),
      control: getValue('rating-control'),
      hra: getValue('rating-hra'),
      movement: getValue('rating-movement'),
      babip: getValue('rating-babip'),
    };

    const ip = getValue('rating-ip');

    const errors = PotentialStatsService.validateRatings(ratings);
    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    const stats = PotentialStatsService.calculatePitchingStats(ratings, ip);

    this.results.push({
      name,
      ...ratings,
      ...stats,
    });

    if (nameInput) nameInput.value = '';

    this.renderResults();
  }

  private handleCSVFile(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        const pitchers = PotentialStatsService.parseCSV(content);
        if (pitchers.length === 0) {
          alert('No valid data found in CSV');
          return;
        }

        const newResults = PotentialStatsService.calculateBulkStats(pitchers);
        this.results.push(...newResults);
        this.renderResults();
      } catch (err) {
        alert('Error parsing CSV file');
        console.error(err);
      }
    };
    reader.readAsText(file);
  }

  private renderResults(): void {
    const wrapper = this.container.querySelector<HTMLDivElement>('#results-table-wrapper');
    const clearBtn = this.container.querySelector<HTMLButtonElement>('#clear-results-btn');

    if (!wrapper) return;

    if (this.results.length === 0) {
      wrapper.innerHTML = '<p class="no-results">No results yet. Enter ratings above to see WBL projections.</p>';
      if (clearBtn) clearBtn.style.display = 'none';
      return;
    }

    if (clearBtn) clearBtn.style.display = 'block';

    const rows = this.results.map((r, index) => `
      <tr>
        <td class="name-cell">
          ${this.escapeHtml(r.name)}
          <button type="button" class="btn-remove" data-index="${index}" title="Remove">x</button>
        </td>
        <td>${r.stuff}</td>
        <td>${r.control}</td>
        <td>${r.hra}</td>
        <td>${r.movement}</td>
        <td>${r.babip}</td>
        <td class="divider"></td>
        <td>${r.ip.toFixed(0)}</td>
        <td>${r.k}</td>
        <td>${r.bb}</td>
        <td>${r.hr}</td>
        <td>${r.ha}</td>
        <td class="divider"></td>
        <td>${r.k9.toFixed(1)}</td>
        <td>${r.bb9.toFixed(1)}</td>
        <td>${r.hr9.toFixed(2)}</td>
        <td>${r.h9.toFixed(1)}</td>
        <td class="divider"></td>
        <td>${r.fip.toFixed(2)}</td>
        <td>${r.whip.toFixed(2)}</td>
        <td class="${r.war >= 0 ? 'war-positive' : 'war-negative'}">${r.war.toFixed(1)}</td>
      </tr>
    `).join('');

    wrapper.innerHTML = `
      <div class="table-wrapper">
        <table class="stats-table potential-stats-table">
          <thead>
            <tr>
              <th class="name-col">Name</th>
              <th title="Stuff">STF</th>
              <th title="Control">CON</th>
              <th title="HR Avoidance">HRA</th>
              <th title="Movement">MOV</th>
              <th title="BABIP">BAB</th>
              <th class="divider"></th>
              <th>IP</th>
              <th>K</th>
              <th>BB</th>
              <th>HR</th>
              <th>H</th>
              <th class="divider"></th>
              <th>K/9</th>
              <th>BB/9</th>
              <th>HR/9</th>
              <th>H/9</th>
              <th class="divider"></th>
              <th>FIP</th>
              <th>WHIP</th>
              <th>WAR</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;

    wrapper.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = Number((e.target as HTMLElement).dataset.index);
        this.results.splice(index, 1);
        this.renderResults();
      });
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  clear(): void {
    this.results = [];
    this.renderResults();
  }
}
