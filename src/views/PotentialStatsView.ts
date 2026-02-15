import {
  PotentialStatsService,
  PitcherRatings,
  PotentialPitchingStats,
  LeagueContext,
} from '../services/PotentialStatsService';
import { leagueStatsService } from '../services/LeagueStatsService';
import { HitterRatingEstimatorService } from '../services/HitterRatingEstimatorService';

type PlayerType = 'batters' | 'pitchers';

interface BatterRatings {
  contact: number;
  power: number;
  eye: number;
}

interface PotentialBattingStats {
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  avg: number;
  obp: number;
  slg: number;
  ops: number;
  woba: number;
  bbPct: number;
  hrPct: number;
}

type PitcherResultRow = { name: string } & PotentialPitchingStats & PitcherRatings;
type BatterResultRow = { name: string } & PotentialBattingStats & BatterRatings;
type ResultRow = PitcherResultRow | BatterResultRow;

// Available years for league stats (most recent first)
const AVAILABLE_YEARS = [2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011, 2010];

export class PotentialStatsView {
  private container: HTMLElement;
  private playerType: PlayerType;
  private results: ResultRow[] = [];
  private leagueContext: LeagueContext | undefined;
  private selectedYear: number = 2020;
  private leagueEra: number | undefined;
  private hasLoadedLeagueStats = false; // Track if stats have been loaded

  constructor(container: HTMLElement, playerType: PlayerType = 'pitchers') {
    this.container = container;
    this.playerType = playerType;
    this.render();
    // Defer league stats loading until first user interaction
    // This prevents loading data during app initialization
  }

  setPlayerType(playerType: PlayerType): void {
    if (this.playerType === playerType) return;
    this.playerType = playerType;
    this.results = []; // Clear results when switching player type
    this.render();
  }

  private async ensureLeagueStatsLoaded(): Promise<void> {
    if (!this.hasLoadedLeagueStats) {
      await this.loadLeagueStats();
    }
  }

  private async loadLeagueStats(): Promise<void> {
    try {
      const stats = await leagueStatsService.getLeagueStats(this.selectedYear);
      this.hasLoadedLeagueStats = true;
      this.leagueContext = {
        fipConstant: stats.fipConstant,
        avgFip: stats.avgFip,
      };
      this.leagueEra = stats.era;
      this.updateLeagueInfo();
      // Recalculate existing results with new league context
      if (this.results.length > 0) {
        this.recalculateResults();
      }
    } catch (e) {
      console.warn('Could not load league stats, using defaults', e);
    }
  }

  private recalculateResults(): void {
    // Recalculate all results with the new league context (only applies to pitchers)
    if (this.playerType !== 'pitchers') return;

    this.results = (this.results as PitcherResultRow[]).map(r => {
      const ratings: PitcherRatings = {
        stuff: r.stuff,
        control: r.control,
        hra: r.hra,
        movement: r.movement,
        babip: r.babip,
      };
      const stats = PotentialStatsService.calculatePitchingStats(ratings, r.ip, this.leagueContext);
      return { name: r.name, ...ratings, ...stats };
    });
    this.renderResults();
  }

  private updateLeagueInfo(): void {
    const infoEl = this.container.querySelector<HTMLElement>('#league-info');
    if (infoEl && this.leagueEra !== undefined && this.leagueContext) {
      infoEl.innerHTML = `Using ${this.selectedYear} league data (ERA: ${this.leagueEra.toFixed(2)}, FIP constant: ${this.leagueContext.fipConstant.toFixed(2)})`;
    }
  }

  private calculateBatterStats(ratings: BatterRatings, pa: number): PotentialBattingStats {
    // Get expected rate stats from ratings using HitterRatingEstimatorService
    const bbPct = HitterRatingEstimatorService.expectedBbPct(ratings.eye);
    const hrPct = HitterRatingEstimatorService.expectedHrPct(ratings.power);
    const avg = HitterRatingEstimatorService.expectedAvg(ratings.contact);

    // Calculate counting stats from rates
    const bb = Math.round((bbPct / 100) * pa);
    const hr = Math.max(0, Math.round((hrPct / 100) * pa)); // HR% can be negative for low power

    // AB = PA - BB - HBP - SF - SH (we'll approximate as PA - BB for simplicity)
    const ab = pa - bb;
    const h = Math.round(avg * ab);

    // Estimate doubles and triples (simplified - could use Gap/Speed if available)
    // Rough approximation: 20% of non-HR hits are doubles, 2% are triples
    const nonHrHits = Math.max(0, h - hr);
    const d = Math.round(nonHrHits * 0.20);
    const t = Math.round(nonHrHits * 0.02);
    const singles = Math.max(0, h - d - t - hr);

    // Calculate slashline stats
    const obp = ab > 0 ? (h + bb) / pa : 0;
    const totalBases = singles + (d * 2) + (t * 3) + (hr * 4);
    const slg = ab > 0 ? totalBases / ab : 0;
    const ops = obp + slg;

    // Calculate wOBA (weighted on-base average)
    // wOBA = (0.69×BB + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR) / PA
    const woba = pa > 0 ? (
      0.69 * bb +
      0.89 * singles +
      1.27 * d +
      1.62 * t +
      2.10 * hr
    ) / pa : 0;

    return {
      pa,
      ab,
      h,
      d,
      t,
      hr,
      bb,
      avg,
      obp,
      slg,
      ops,
      woba,
      bbPct,
      hrPct: Math.max(0, hrPct), // Display as 0 if negative
    };
  }

  private renderRatingInputs(): string {
    if (this.playerType === 'pitchers') {
      return `
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
      `;
    } else {
      return `
        <div class="rating-field">
          <label for="rating-contact">Contact</label>
          <input type="number" id="rating-contact" min="20" max="80" value="50" required>
        </div>
        <div class="rating-field">
          <label for="rating-power">Power</label>
          <input type="number" id="rating-power" min="20" max="80" value="50" required>
        </div>
        <div class="rating-field">
          <label for="rating-eye">Eye</label>
          <input type="number" id="rating-eye" min="20" max="80" value="50" required>
        </div>
      `;
    }
  }

  private getCSVFormat(): string {
    return this.playerType === 'pitchers'
      ? 'Format: name, stuff, control, hra [, ip]'
      : 'Format: name, contact, power, eye [, pa]';
  }

  private renderFormulas(): string {
    if (this.playerType === 'pitchers') {
      return `
        <div class="formula-note">
          <strong>WBL "Three True Outcomes":</strong><br>
          K/9 = 2.10 + 0.074 × Stuff<br>
          BB/9 = 5.30 - 0.052 × Control<br>
          HR/9 = 2.18 - 0.024 × HRA (WBL = 0.64× neutral)
        </div>
      `;
    } else {
      return `
        <div class="formula-note">
          <strong>Batter Rating Formulas:</strong><br>
          BB% = 1.62 + 0.115 × Eye<br>
          HR% = -0.59 + 0.058 × Power<br>
          AVG = 0.035 + 0.0039 × Contact<br>
          <em style="font-size: 0.9em; color: var(--color-text-muted);">Note: Coefficients calibrated from OOTP engine data</em>
        </div>
      `;
    }
  }

  private render(): void {
    const isPitcher = this.playerType === 'pitchers';
    const title = isPitcher ? 'WBL Potential Stats Calculator' : 'WBL Batter Stats Calculator';
    const subtitle = isPitcher
      ? 'Enter pitcher ratings to calculate projected WBL stats'
      : 'Enter batter ratings to calculate projected WBL stats';

    this.container.innerHTML = `
      <div class="potential-stats-section">
        <h2 class="section-title">${title}</h2>
        <p class="section-subtitle">${subtitle}</p>

        <div class="potential-stats-content">
          <!-- Manual Entry Form -->
          <div class="rating-form-container">
            <h3 class="form-title">Enter Ratings (20-80 scale)</h3>
            <form id="rating-form" class="rating-form">
              <div class="rating-inputs">
                ${this.renderRatingInputs()}
            </div>
            <div class="form-actions">
              <input type="text" id="rating-name" placeholder="Player name (optional)" class="name-input">
              <div class="ip-input-wrapper">
                <label for="rating-volume">${isPitcher ? 'IP:' : 'PA:'}</label>
                  <input type="number" id="rating-volume" min="10" max="${isPitcher ? '250' : '700'}" value="${isPitcher ? '180' : '650'}" class="ip-input">
                </div>
                <button type="submit" class="btn btn-primary">Calculate & Add</button>
              </div>
            </form>
          </div>

          <!-- CSV Upload -->
          <div class="csv-upload-container">
            <h3 class="form-title">Or Upload CSV</h3>
            <p class="csv-format">${this.getCSVFormat()}</p>
            <div class="csv-upload-area" id="csv-drop-zone">
              <input type="file" id="csv-file-input" accept=".csv" hidden>
              <p>Drop CSV file here or <button type="button" class="btn-link" id="csv-browse-btn">browse</button></p>
            </div>
            ${this.renderFormulas()}
          </div>
        </div>

        <!-- Results Table -->
        <div class="results-container" id="results-container">
          <div class="results-header">
            <h3 class="form-title">Projected WBL Stats</h3>
            <button type="button" class="btn btn-secondary" id="clear-results-btn" style="display: none;">Clear All</button>
          </div>
          ${isPitcher ? `
          <div class="league-context-info">
            <p id="league-info" class="league-info-text">League data will load when you calculate stats</p>
            <div class="year-selector">
              <label for="league-year">FIP/WAR based on:</label>
              <select id="league-year">
                ${AVAILABLE_YEARS.map(y => `<option value="${y}" ${y === this.selectedYear ? 'selected' : ''}>${y}</option>`).join('')}
              </select>
            </div>
          </div>
          ` : ''}
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

    const yearSelect = this.container.querySelector<HTMLSelectElement>('#league-year');
    yearSelect?.addEventListener('change', (e) => {
      this.selectedYear = Number((e.target as HTMLSelectElement).value);
      this.loadLeagueStats();
    });
  }

  private async handleManualEntry(): Promise<void> {
    // Ensure league stats are loaded before calculating
    await this.ensureLeagueStatsLoaded();

    const getValue = (id: string): number => {
      const input = this.container.querySelector<HTMLInputElement>(`#${id}`);
      return Number(input?.value) || 50;
    };

    const nameInput = this.container.querySelector<HTMLInputElement>('#rating-name');

    if (this.playerType === 'pitchers') {
      const name = nameInput?.value.trim() || `Pitcher ${this.results.length + 1}`;

      const defaultSecondary = 50;
      const ratings: PitcherRatings = {
        stuff: getValue('rating-stuff'),
        control: getValue('rating-control'),
        hra: getValue('rating-hra'),
        movement: defaultSecondary,
        babip: defaultSecondary,
      };

      const ip = getValue('rating-volume');

      const errors = PotentialStatsService.validateRatings(ratings);
      if (errors.length > 0) {
        alert(errors.join('\n'));
        return;
      }

      const stats = PotentialStatsService.calculatePitchingStats(ratings, ip, this.leagueContext);

      this.results.push({
        name,
        ...ratings,
        ...stats,
      });
    } else {
      // Batter calculations
      const name = nameInput?.value.trim() || `Batter ${this.results.length + 1}`;

      const ratings: BatterRatings = {
        contact: getValue('rating-contact'),
        power: getValue('rating-power'),
        eye: getValue('rating-eye'),
      };

      const pa = getValue('rating-volume');

      // Validate ratings
      const allRatingsValid = Object.values(ratings).every(r => r >= 20 && r <= 80);
      if (!allRatingsValid) {
        alert('All ratings must be between 20 and 80');
        return;
      }

      const stats = this.calculateBatterStats(ratings, pa);

      this.results.push({
        name,
        ...ratings,
        ...stats,
      } as BatterResultRow);
    }

    if (nameInput) nameInput.value = '';

    this.renderResults();
  }

  private handleCSVFile(file: File): void {
    const reader = new FileReader();
    reader.onload = async (e) => {
      // Ensure league stats are loaded before calculating
      await this.ensureLeagueStatsLoaded();

      const content = e.target?.result as string;
      try {
        const pitchers = PotentialStatsService.parseCSV(content);
        if (pitchers.length === 0) {
          alert('No valid data found in CSV');
          return;
        }

        const newResults = PotentialStatsService.calculateBulkStats(pitchers, this.leagueContext);
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

    if (this.playerType === 'pitchers') {
      this.renderPitcherResults(wrapper);
    } else {
      this.renderBatterResults(wrapper);
    }
  }

  private renderPitcherResults(wrapper: HTMLDivElement): void {
    const rows = (this.results as PitcherResultRow[]).map((r, index) => `
      <tr>
        <td class="name-cell">
          ${this.escapeHtml(r.name)}
          <button type="button" class="btn-remove" data-index="${index}" title="Remove">x</button>
        </td>
        <td>${r.stuff}</td>
        <td>${r.control}</td>
        <td>${r.hra}</td>
        <td class="divider"></td>
        <td>${r.ip.toFixed(0)}</td>
        <td>${r.k}</td>
        <td>${r.bb}</td>
        <td>${r.hr}</td>
        <td class="divider"></td>
        <td>${r.k9.toFixed(1)}</td>
        <td>${r.bb9.toFixed(1)}</td>
        <td>${r.hr9.toFixed(2)}</td>
        <td class="divider"></td>
        <td>${r.fip.toFixed(2)}</td>
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
              <th class="divider"></th>
              <th>IP</th>
              <th>K</th>
              <th>BB</th>
              <th>HR</th>
              <th class="divider"></th>
              <th>K/9</th>
              <th>BB/9</th>
              <th>HR/9</th>
              <th class="divider"></th>
              <th>FIP</th>
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

  private renderBatterResults(wrapper: HTMLDivElement): void {
    const rows = (this.results as BatterResultRow[]).map((r, index) => `
      <tr>
        <td class="name-cell">
          ${this.escapeHtml(r.name)}
          <button type="button" class="btn-remove" data-index="${index}" title="Remove">x</button>
        </td>
        <td>${r.contact}</td>
        <td>${r.power}</td>
        <td>${r.eye}</td>
        <td class="divider"></td>
        <td>${r.pa}</td>
        <td>${r.h}</td>
        <td>${r.bb}</td>
        <td>${r.hr}</td>
        <td class="divider"></td>
        <td>${r.avg.toFixed(3)}</td>
        <td>${r.obp.toFixed(3)}</td>
        <td>${r.slg.toFixed(3)}</td>
        <td>${r.ops.toFixed(3)}</td>
        <td class="divider"></td>
        <td>${r.woba.toFixed(3)}</td>
        <td>${r.bbPct.toFixed(1)}%</td>
      </tr>
    `).join('');

    wrapper.innerHTML = `
      <div class="table-wrapper">
        <table class="stats-table potential-stats-table">
          <thead>
            <tr>
              <th class="name-col">Name</th>
              <th title="Contact">CON</th>
              <th title="Power">PWR</th>
              <th title="Eye">EYE</th>
              <th class="divider"></th>
              <th>PA</th>
              <th>H</th>
              <th>BB</th>
              <th>HR</th>
              <th class="divider"></th>
              <th>AVG</th>
              <th>OBP</th>
              <th>SLG</th>
              <th>OPS</th>
              <th class="divider"></th>
              <th>wOBA</th>
              <th>BB%</th>
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
