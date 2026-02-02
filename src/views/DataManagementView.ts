import { minorLeagueStatsService, MinorLeagueLevel } from '../services/MinorLeagueStatsService';
import { minorLeagueBattingStatsService } from '../services/MinorLeagueBattingStatsService';
import { scoutingDataService, ScoutingSource } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { dateService } from '../services/DateService';
import { indexedDBService } from '../services/IndexedDBService';
import { trueRatingsService, LEAGUE_START_YEAR } from '../services/TrueRatingsService';
import { MessageModal } from './MessageModal';
import { storageMigration } from '../services/StorageMigration';

type DataMode = 'stats' | 'scouting';
type ScoutingPlayerType = 'pitcher' | 'hitter';

export class DataManagementView {
  private container: HTMLElement;
  private selectedYear: number = 2021;
  private selectedLevel: MinorLeagueLevel = 'aaa';
  private selectedFiles: File[] = [];
  private messageModal: MessageModal;
  private currentMode: DataMode = 'stats';
  private selectedScoutingSource: ScoutingSource = 'my';
  private selectedScoutingPlayerType: ScoutingPlayerType = 'pitcher';
  private currentGameDate: string = '';

  constructor(container: HTMLElement) {
    this.container = container;
    this.messageModal = new MessageModal();
    this.render();
    this.refreshExistingDataList();
    this.fetchGameDate();
    this.setupOnboardingListener();
  }

  private setupOnboardingListener(): void {
    window.addEventListener('wbl:first-time-onboarding', () => {
      this.startOnboarding();
    });
  }

  private async fetchGameDate(): Promise<void> {
      this.currentGameDate = await dateService.getCurrentDate();
      const dateDisplay = this.container.querySelector<HTMLInputElement>('#scout-date-display');
      if (dateDisplay) {
          dateDisplay.value = this.currentGameDate;
      }
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="potential-stats-section">
        <h2 class="section-title">Data Management</h2>
        <p class="section-subtitle">Manage historical statistics and scouting reports (MLB stats are always current and fetched from the S+ API)</p>

        <div id="migration-banner" style="display: none; background: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107; padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>Storage Migration Available</strong>
              <p style="margin: 0.5rem 0 0 0; opacity: 0.9;">Your data is stored in localStorage which has limited space. Migrate to IndexedDB for unlimited storage.</p>
            </div>
            <button id="migrate-btn" class="btn btn-primary">Migrate Now</button>
          </div>
        </div>

        <div id="default-osa-banner" style="display: none; background: rgba(0, 186, 124, 0.1); border-left: 3px solid var(--color-primary); padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <div style="flex: 1;">
              <strong id="default-osa-title">Default OSA Scouting Data</strong>
              <p id="default-osa-message" style="margin: 0.5rem 0 0 0; opacity: 0.9;">Loading...</p>
            </div>
            <button id="load-default-osa-btn" class="btn btn-primary" style="display: none;">Load Default Data</button>
          </div>
        </div>

        <div id="default-minors-banner" style="display: none; background: rgba(0, 186, 124, 0.1); border-left: 3px solid var(--color-primary); padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <div style="flex: 1;">
              <strong id="default-minors-title">Bundled Minor League Data</strong>
              <p id="default-minors-message" style="margin: 0.5rem 0 0 0; opacity: 0.9;">Loading...</p>
            </div>
            <button id="load-default-minors-btn" class="btn btn-primary" style="display: none;">Load Bundled Data</button>
          </div>
        </div>

        <div class="draft-header" style="margin-bottom: 1.5rem;">
            <div class="toggle-group" role="tablist" aria-label="Data type">
                <button class="toggle-btn active" data-mode="stats" role="tab" aria-selected="true">Minor League Stats</button>
                <button class="toggle-btn" data-mode="scouting" role="tab" aria-selected="false">Scouting Reports</button>
            </div>
        </div>

        <div class="potential-stats-content" style="grid-template-columns: 1fr;">
          <div class="csv-upload-container">
            <h3 class="form-title">Upload Data</h3>
            
            <!-- Stats Inputs -->
            <div id="stats-inputs" class="rating-inputs" style="grid-template-columns: 1fr 1fr; margin-bottom: 1.5rem;">
                <div class="rating-field">
                    <label for="upload-year">Default Year</label>
                    <input type="number" id="upload-year" min="2000" max="2030" value="${this.selectedYear}">
                </div>
                <div class="rating-field">
                    <label for="upload-level">Default Level</label>
                    <select id="upload-level" style="padding: 0.5rem; border: 1px solid var(--color-border); border-radius: 4px; background-color: var(--color-surface); color: var(--color-text); width: 100%;">
                        <option value="aaa">AAA</option>
                        <option value="aa">AA</option>
                        <option value="a">A</option>
                        <option value="r">R</option>
                    </select>
                </div>
            </div>

            <!-- Scouting Inputs -->
            <div id="scouting-inputs" class="rating-inputs" style="display: none; grid-template-columns: 1fr 1fr 1fr; margin-bottom: 1.5rem;">
                <div class="rating-field">
                    <label for="scout-player-type">Player Type</label>
                    <div class="toggle-group" style="justify-self: start;">
                        <button class="toggle-btn active" data-player-type="pitcher">Pitchers</button>
                        <button class="toggle-btn" data-player-type="hitter">Hitters</button>
                    </div>
                </div>
                <div class="rating-field">
                    <label for="scout-source">Source</label>
                     <div class="toggle-group" style="justify-self: start;">
                        <button class="toggle-btn active" data-source="my">My Scout</button>
                        <button class="toggle-btn" data-source="osa">OSA</button>
                    </div>
                </div>
                 <div class="rating-field">
                    <label for="scout-date-display">Game Date</label>
                    <input type="text" id="scout-date-display" value="Loading..." readonly style="background-color: var(--color-surface-hover); color: var(--color-text-muted);">
                </div>
            </div>

            <div class="csv-upload-area" id="drop-zone">
              <input type="file" id="file-input" accept=".csv" multiple hidden>
              <div id="upload-prompt">
                <p>Drop one or more CSV files here or <button type="button" class="btn-link" id="browse-btn">browse</button></p>
                <p class="csv-format" id="format-hint">Format: ID,Name,IP,HR,BB,K,HR/9,BB/9,K/9</p>
                <p class="csv-format" id="naming-hint">Naming convention: <code>[level]_stats_[year].csv</code> (e.g. aaa_stats_2020.csv)</p>
              </div>
              <div id="file-display" style="display: none;">
                <div id="file-list" style="margin-bottom: 1rem; max-height: 200px; overflow-y: auto;"></div>
                <button type="button" class="btn-link" id="clear-file">Clear All</button>
              </div>
            </div>
            
            <div style="margin-top: 1rem; text-align: right;">
                 <button id="upload-btn" class="btn btn-primary" disabled>Save Data</button>
            </div>
          </div>

          <div class="results-container">
            <h3 class="form-title">Existing Data</h3>
            <div class="table-wrapper">
                <table class="stats-table" style="width: 100%; text-align: left;">
                    <thead>
                        <tr>
                            <th style="text-align: left;">Type</th>
                            <th style="text-align: left;">Date/Year</th>
                            <th style="text-align: left;">Details</th>
                            <th style="text-align: left;">Count</th>
                            <th style="text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="existing-data-list">
                        <tr><td colspan="5" style="text-align: center; color: var(--color-text-muted);">No data found.</td></tr>
                    </tbody>
                </table>
            </div>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
    this.updateModeUI();
    this.checkMigrationNeeded();
    this.checkDefaultOsaStatus();
    this.checkDefaultMinorsStatus();
  }

  private bindEvents(): void {
    const yearInput = this.container.querySelector<HTMLInputElement>('#upload-year');
    const levelSelect = this.container.querySelector<HTMLSelectElement>('#upload-level');
    const fileInput = this.container.querySelector<HTMLInputElement>('#file-input');
    const browseBtn = this.container.querySelector<HTMLButtonElement>('#browse-btn');
    const dropZone = this.container.querySelector<HTMLDivElement>('#drop-zone');
    const uploadBtn = this.container.querySelector<HTMLButtonElement>('#upload-btn');
    const clearFileBtn = this.container.querySelector<HTMLButtonElement>('#clear-file');
    
    // Mode Toggles
    this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            this.currentMode = btn.dataset.mode as DataMode;
            this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.selectedFiles = [];
            this.updateFileDisplay();
            this.updateModeUI();
        });
    });

    // Source Toggles
    this.container.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(btn => {
        btn.addEventListener('click', () => {
            this.selectedScoutingSource = btn.dataset.source as ScoutingSource;
            this.container.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Player Type Toggles (for scouting)
    this.container.querySelectorAll<HTMLButtonElement>('[data-player-type]').forEach(btn => {
        btn.addEventListener('click', () => {
            this.selectedScoutingPlayerType = btn.dataset.playerType as ScoutingPlayerType;
            this.container.querySelectorAll<HTMLButtonElement>('[data-player-type]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            this.updateModeUI();
        });
    });

    yearInput?.addEventListener('change', (e) => {
      this.selectedYear = Number((e.target as HTMLInputElement).value);
    });

    levelSelect?.addEventListener('change', (e) => {
        this.selectedLevel = (e.target as HTMLSelectElement).value as MinorLeagueLevel;
    });

    browseBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) this.handleFileSelection(files);
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
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.handleFileSelection(files);
      }
    });

    clearFileBtn?.addEventListener('click', () => {
        this.selectedFiles = [];
        this.updateFileDisplay();
        if (fileInput) fileInput.value = '';
        if (uploadBtn) uploadBtn.disabled = true;
    });

    uploadBtn?.addEventListener('click', () => this.handleUpload());

    // Migration button
    const migrateBtn = this.container.querySelector<HTMLButtonElement>('#migrate-btn');
    migrateBtn?.addEventListener('click', () => this.handleMigration());

    // Load default OSA button
    const loadDefaultOsaBtn = this.container.querySelector<HTMLButtonElement>('#load-default-osa-btn');
    loadDefaultOsaBtn?.addEventListener('click', () => this.handleLoadDefaultOsa());

    // Load default minors button
    const loadDefaultMinorsBtn = this.container.querySelector<HTMLButtonElement>('#load-default-minors-btn');
    loadDefaultMinorsBtn?.addEventListener('click', () => this.handleLoadDefaultMinors());
  }

  private updateModeUI(): void {
      const statsInputs = this.container.querySelector<HTMLElement>('#stats-inputs');
      const scoutingInputs = this.container.querySelector<HTMLElement>('#scouting-inputs');
      const formatHint = this.container.querySelector<HTMLElement>('#format-hint');
      const namingHint = this.container.querySelector<HTMLElement>('#naming-hint');

      if (this.currentMode === 'stats') {
          if (statsInputs) statsInputs.style.display = 'grid';
          if (scoutingInputs) scoutingInputs.style.display = 'none';
          if (formatHint) formatHint.textContent = 'Format: ID,Name,IP,HR,BB,K,HR/9,BB/9,K/9';
          if (namingHint) namingHint.innerHTML = 'Naming convention: <code>[level]_stats_[year].csv</code> (e.g. aaa_stats_2020.csv)';
      } else {
          if (statsInputs) statsInputs.style.display = 'none';
          if (scoutingInputs) scoutingInputs.style.display = 'grid';
          if (this.selectedScoutingPlayerType === 'pitcher') {
              if (formatHint) formatHint.textContent = 'Format: player_id, name, stuff, control, hra [, age, pitch_ratings...]';
              if (namingHint) namingHint.innerHTML = 'For bulk historical upload, use: <code>scouting_[source]_YYYY-MM-DD.csv</code> (e.g. scouting_my_2024-03-15.csv)';
          } else {
              if (formatHint) formatHint.textContent = 'Format: player_id, name, power, eye, avoidK [, babip, gap, speed, age]';
              if (namingHint) namingHint.innerHTML = 'For bulk historical upload, use: <code>hitter_scouting_[source]_YYYY-MM-DD.csv</code>';
          }
      }
  }

  private handleFileSelection(files: FileList): void {
    this.selectedFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.csv'));
    
    // Auto-detect year/level only for stats mode
    if (this.currentMode === 'stats' && this.selectedFiles.length === 1) {
        const file = this.selectedFiles[0];
        const { year, level } = this.detectFileInfo(file.name);
        if (year) {
             this.selectedYear = year;
             const inputs = this.container.querySelectorAll<HTMLInputElement>('input[type="number"]');
             inputs.forEach(i => i.value = year.toString());
        }
        if (level) {
            this.selectedLevel = level;
            const levelSelect = this.container.querySelector<HTMLSelectElement>('#upload-level');
            if (levelSelect) levelSelect.value = level;
        }
    }

    this.updateFileDisplay();
    
    const uploadBtn = this.container.querySelector<HTMLButtonElement>('#upload-btn');
    if (uploadBtn) uploadBtn.disabled = this.selectedFiles.length === 0;
  }

  private detectFileInfo(filename: string): { year?: number, level?: MinorLeagueLevel } {
    const name = filename.toLowerCase();
    let level: MinorLeagueLevel | undefined;
    let year: number | undefined;

    if (name.startsWith('aaa_') || name.includes('aaa')) level = 'aaa';
    else if (name.startsWith('aa_') || name.includes('aa')) level = 'aa';
    else if (name.startsWith('a_') || name.includes('high_a') || name.includes('low_a')) level = 'a';
    else if (name.startsWith('r_') || name.includes('rookie')) level = 'r';

    if (!level) {
        if (name.includes('_a_') || name.startsWith('a_')) level = 'a';
    }

    const yearMatch = name.match(/20\d{2}/);
    if (yearMatch) {
        year = parseInt(yearMatch[0], 10);
    }

    return { year, level };
  }

  /**
   * Detect date and optionally source from scouting filename.
   * Supports patterns like:
   * - scouting_my_2024-01-15.csv
   * - scouting_my_2024_01_15.csv (underscores also work)
   * - scouting_2024-01-15_my.csv
   * - 2024-01-15_scouting.csv
   * - my_2024-01-15.csv
   * - Any file with YYYY-MM-DD or YYYY_MM_DD pattern
   */
  private detectScoutingFileInfo(filename: string): { date?: string, source?: ScoutingSource } {
    const name = filename.toLowerCase();
    let date: string | undefined;
    let source: ScoutingSource | undefined;

    // Try to detect source from filename
    if (name.includes('_my_') || name.includes('_my.') || name.startsWith('my_') || name.includes('my_scout')) {
      source = 'my';
    } else if (name.includes('_osa_') || name.includes('_osa.') || name.startsWith('osa_') || name.includes('osa_scout')) {
      source = 'osa';
    }

    // Try to detect date (YYYY-MM-DD or YYYY_MM_DD format)
    const dateMatch = name.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
    if (dateMatch) {
      // Normalize to YYYY-MM-DD format
      date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    }

    return { date, source };
  }

  private updateFileDisplay(): void {
    const prompt = this.container.querySelector<HTMLElement>('#upload-prompt');
    const display = this.container.querySelector<HTMLElement>('#file-display');
    const fileList = this.container.querySelector<HTMLElement>('#file-list');

    if (this.selectedFiles.length > 0) {
        if (prompt) prompt.style.display = 'none';
        if (display) display.style.display = 'block';
        
        if (fileList) {
            fileList.innerHTML = this.selectedFiles.map(f => {
                let details = '';
                if (this.currentMode === 'stats') {
                    const info = this.detectFileInfo(f.name);
                    const yearStr = info.year ? info.year : `<span style="opacity:0.5">Using ${this.selectedYear}</span>`;
                    const levelStr = info.level ? info.level.toUpperCase() : `<span style="opacity:0.5">Using ${this.selectedLevel.toUpperCase()}</span>`;
                    details = `${levelStr} ${yearStr}`;
                } else {
                    const scoutInfo = this.detectScoutingFileInfo(f.name);
                    const displaySource = scoutInfo.source || this.selectedScoutingSource;
                    const displayDate = scoutInfo.date
                        ? `<span style="color: var(--color-success)">${scoutInfo.date}</span>`
                        : `<span style="opacity:0.5">${this.currentGameDate || 'Current'}</span>`;
                    details = `<span style="color: var(--color-primary)">${displaySource.toUpperCase()}</span> ${displayDate}`;
                }

                return `<div style="display:flex; justify-content:space-between; padding: 0.25rem 0; border-bottom: 1px solid rgba(255,255,255,0.1)">
                    <span>${f.name}</span>
                    <span style="font-size: 0.85em; color: var(--color-text-muted);">${details}</span>
                </div>`;
            }).join('');
        }
    } else {
        if (prompt) prompt.style.display = 'block';
        if (display) display.style.display = 'none';
        if (fileList) fileList.innerHTML = '';
    }
  }

  private async handleUpload(): Promise<void> {
    if (this.selectedFiles.length === 0) return;

    const uploadBtn = this.container.querySelector<HTMLButtonElement>('#upload-btn');
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Processing...';
    }

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    for (const file of this.selectedFiles) {
        try {
            const content = await this.readFile(file);
            
            if (this.currentMode === 'stats') {
                const stats = minorLeagueStatsService.parseCsv(content);
                if (stats.length === 0) {
                    failCount++;
                    errors.push(`${file.name}: No valid stats found.`);
                    continue;
                }
                const info = this.detectFileInfo(file.name);
                const year = info.year || this.selectedYear;
                const level = info.level || this.selectedLevel;
                await minorLeagueStatsService.saveStats(year, level, stats, 'csv');
                successCount++;
            } else {
                // Detect date and source from filename for historical uploads
                const scoutInfo = this.detectScoutingFileInfo(file.name);
                const saveSource = scoutInfo.source || this.selectedScoutingSource;
                const saveDate = scoutInfo.date || this.currentGameDate || new Date().toISOString().split('T')[0];

                // Determine player type from filename or UI selection
                const isHitterFile = file.name.toLowerCase().includes('hitter');
                const playerType = isHitterFile ? 'hitter' : this.selectedScoutingPlayerType;

                if (playerType === 'hitter') {
                    const ratings = hitterScoutingDataService.parseScoutingCsv(content, saveSource);
                    if (ratings.length === 0) {
                        failCount++;
                        errors.push(`${file.name}: No valid hitter scouting data found.`);
                        continue;
                    }
                    await hitterScoutingDataService.saveScoutingRatings(saveDate, ratings, saveSource);
                } else {
                    const ratings = scoutingDataService.parseScoutingCsv(content, saveSource);
                    if (ratings.length === 0) {
                        failCount++;
                        errors.push(`${file.name}: No valid scouting data found.`);
                        continue;
                    }
                    await scoutingDataService.saveScoutingRatings(saveDate, ratings, saveSource);
                }
                successCount++;
            }

        } catch (err) {
            failCount++;
            errors.push(`${file.name}: Parse error.`);
            console.error(err);
        }
    }
    
    // Reset
    this.selectedFiles = [];
    this.updateFileDisplay();
    const fileInput = this.container.querySelector<HTMLInputElement>('#file-input');
    if (fileInput) fileInput.value = '';
    
    if (uploadBtn) {
        uploadBtn.textContent = 'Save Data';
    }

    // Update list
    this.refreshExistingDataList();

    // Emit event to notify other views that scouting data was updated
    if (this.currentMode === 'scouting' && successCount > 0) {
      window.dispatchEvent(new CustomEvent('scoutingDataUpdated', {
        detail: { source: this.selectedScoutingSource }
      }));
    }

    let msg = `Process complete.\nSaved: ${successCount} files.\nFailed: ${failCount} files.`;
    if (errors.length > 0) {
        msg += '\n\nErrors:\n' + errors.join('\n');
    }
    this.messageModal.show('Upload Results', msg);
  }

  private readFile(file: File): Promise<string> {
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsText(file);
      });
  }

  private async refreshExistingDataList(): Promise<void> {
      const tbody = this.container.querySelector<HTMLElement>('#existing-data-list');
      if (!tbody) return;

      const foundData: {type: 'Stats' | 'Scout' | 'HitterScout', yearOrDate: string, details: string, count: number, id: string, isLatest?: boolean, source?: 'api' | 'csv'}[] = [];
      const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];

      // Try to get stats metadata from IndexedDB
      const allMetadata = await indexedDBService.getAllStatsMetadata();

      if (allMetadata.length > 0) {
          // Use metadata if available (v2 database)
          for (const meta of allMetadata) {
              foundData.push({
                  type: 'Stats',
                  yearOrDate: meta.year.toString(),
                  details: meta.level.toUpperCase(),
                  count: meta.recordCount,
                  id: `stats_${meta.year}_${meta.level}`,
                  source: meta.source
              });
          }
      } else {
          // Fallback to old method if metadata not available (v1 database)
          for (let y = 2000; y <= 2030; y++) {
              for (const l of levels) {
                  if (await minorLeagueStatsService.hasStats(y, l)) {
                      const stats = await minorLeagueStatsService.getStats(y, l);
                      foundData.push({
                          type: 'Stats',
                          yearOrDate: y.toString(),
                          details: l.toUpperCase(),
                          count: stats.length,
                          id: `stats_${y}_${l}`
                      });
                  }
              }
          }
      }

      // Check Pitcher Scouting Snapshots
      let totalScoutingSnapshots = 0;
      for (let y = 2000; y <= 2030; y++) {
          for (const source of ['my', 'osa']) {
              const snapshots = await scoutingDataService.getAvailableScoutingSnapshots(y, source as ScoutingSource);
              if (snapshots.length > 0) {
                  totalScoutingSnapshots += snapshots.length;
              }
              snapshots.forEach((snap, index) => {
                  foundData.push({
                      type: 'Scout',
                      yearOrDate: snap.date,
                      details: `Pitcher ${source === 'my' ? 'My' : 'OSA'}`,
                      count: snap.count,
                      id: snap.key,
                      isLatest: index === 0
                  });
              });
          }
      }

      // Check Hitter Scouting Snapshots
      for (let y = 2000; y <= 2030; y++) {
          for (const source of ['my', 'osa']) {
              const snapshots = await hitterScoutingDataService.getAvailableScoutingSnapshots(y, source as ScoutingSource);
              snapshots.forEach((snap, index) => {
                  foundData.push({
                      type: 'HitterScout',
                      yearOrDate: snap.date,
                      details: `Hitter ${source === 'my' ? 'My' : 'OSA'}`,
                      count: snap.count,
                      id: `hitter_${snap.key}`,
                      isLatest: index === 0
                  });
              });
          }
      }

      // Sort by Date desc
      foundData.sort((a, b) => b.yearOrDate.localeCompare(a.yearOrDate));

      if (foundData.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--color-text-muted); padding: 1rem;">No data found.</td></tr>';
          return;
      }

      tbody.innerHTML = foundData.map(d => {
          let sourceBadge = '';
          if (d.type === 'Stats' && d.source) {
              sourceBadge = d.source === 'api'
                  ? '<span class="badge" style="background: rgba(0, 186, 124, 0.2); color: #00ba7c; margin-left: 0.5rem; font-size: 0.7em;">API</span>'
                  : '<span class="badge" style="background: rgba(255, 165, 0, 0.2); color: #ffa500; margin-left: 0.5rem; font-size: 0.7em;">CSV</span>';
          }

          let latestBadge = '';
          if ((d.type === 'Scout' || d.type === 'HitterScout') && d.isLatest) {
              latestBadge = `<span class="badge" style="background: rgba(0, 186, 124, 0.2); color: #00ba7c; margin-left: 0.5rem; font-size: 0.7em;">LATEST</span>`;
          }

          const badgeClass = d.type === 'Stats' ? 'badge-position' : d.type === 'HitterScout' ? 'badge-active' : 'badge-retired';
          const displayType = d.type === 'HitterScout' ? 'Scout' : d.type;

          return `
            <tr>
                <td><span class="badge ${badgeClass}">${displayType}</span></td>
                <td>${d.yearOrDate}</td>
                <td>${d.details} ${sourceBadge}${latestBadge}</td>
                <td>${d.count} records</td>
                <td style="text-align: right;">
                    <button class="btn-link delete-btn" data-id="${d.id}" data-type="${d.type}" style="color: var(--color-error);">Delete</button>
                </td>
            </tr>
          `;
      }).join('');

      tbody.querySelectorAll('.delete-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
              const el = e.target as HTMLElement;
              const id = el.dataset.id;
              const type = el.dataset.type;
              if (!id) return;

              if (confirm(`Are you sure you want to delete this data?`)) {
                  // Handle Stats: ID format "stats_2021_aaa"
                  if (id.startsWith('stats_')) {
                      const parts = id.split('_');
                      if (parts.length >= 3) {
                          const year = parseInt(parts[1], 10);
                          const level = parts[2] as MinorLeagueLevel;
                          await minorLeagueStatsService.clearStats(year, level);
                          await indexedDBService.deleteStatsMetadata(year, level);
                      }
                  }
                  // Handle Hitter Scouting: ID format "hitter_YYYY-MM-DD_source"
                  else if (type === 'HitterScout' || id.startsWith('hitter_')) {
                      const hitterKey = id.replace(/^hitter_/, '');
                      await hitterScoutingDataService.clearScoutingRatings(hitterKey);
                  }
                  // Handle Pitcher Scouting: ID format "YYYY-MM-DD_source"
                  else {
                      await scoutingDataService.clearScoutingRatings(id);
                  }

                  await this.refreshExistingDataList();
              }
          });
      });
  }

  private checkMigrationNeeded(): void {
    const banner = this.container.querySelector<HTMLElement>('#migration-banner');
    if (!banner) return;

    if (storageMigration.needsMigration()) {
      banner.style.display = 'block';

      // Show usage stats
      // Optional: Log storage usage for debugging
      // const usage = storageMigration.getLocalStorageUsage();
      // const totalMB = (usage.total / 1024 / 1024).toFixed(2);
      // console.log(`localStorage usage: ${totalMB} MB`);
    }
  }

  private async handleMigration(): Promise<void> {
    const migrateBtn = this.container.querySelector<HTMLButtonElement>('#migrate-btn');
    if (!migrateBtn) return;

    if (!confirm('This will migrate all your data from localStorage to IndexedDB. This process cannot be undone. Continue?')) {
      return;
    }

    migrateBtn.disabled = true;
    migrateBtn.textContent = 'Migrating...';

    try {
      const result = await storageMigration.migrateAll();

      let message = `Migration complete!\n\nScouting datasets migrated: ${result.scouting}\nStats datasets migrated: ${result.stats}`;

      if (result.errors.length > 0) {
        message += '\n\nErrors:\n' + result.errors.join('\n');
      }

      this.messageModal.show('Migration Complete', message);

      // Hide banner and refresh list
      const banner = this.container.querySelector<HTMLElement>('#migration-banner');
      if (banner) banner.style.display = 'none';

      await this.refreshExistingDataList();
    } catch (error) {
      this.messageModal.show('Migration Failed', `An error occurred: ${error}`);
      console.error('Migration error:', error);
    } finally {
      migrateBtn.disabled = false;
      migrateBtn.textContent = 'Migrate Now';
    }
  }

  private async startOnboarding(): Promise<void> {
    console.log('🎬 Starting first-time onboarding');

    // Show onboarding UI
    this.showOnboardingLoader();

    // Auto-fetch MLB and minor league data from league start to current year
    try {
      const currentYear = await dateService.getCurrentYear();
      const startYear = LEAGUE_START_YEAR;
      const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];

      const yearCount = currentYear - startYear + 1;

      console.log(`📊 Loading ${yearCount} years from bundles (${startYear}-${currentYear})`);

      // Helper to add delay between API calls
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Load bundled MLB data (fast - no API calls)
      console.log('📦 Loading bundled MLB data...');
      const mlbBundleResult = await trueRatingsService.loadDefaultMlbData();
      console.log(`✅ Loaded ${mlbBundleResult.loaded} bundled MLB datasets`);
      if (mlbBundleResult.errors.length > 0) {
        console.warn(`⚠️ ${mlbBundleResult.errors.length} MLB files failed to load:`, mlbBundleResult.errors);
      }

      // Fetch current year from API if not in bundle (2022+)
      if (currentYear > 2021) {
        console.log(`📥 Fetching current MLB year (${currentYear}) from API...`);
        await trueRatingsService.getTruePitchingStats(currentYear);
      }

      // Load bundled minor league pitching stats (fast - no API calls)
      console.log('📦 Loading bundled minor league pitching data...');
      const bundleResult = await minorLeagueStatsService.loadDefaultMinorLeagueData();
      console.log(`✅ Loaded ${bundleResult.loaded} bundled pitching datasets`);
      if (bundleResult.errors.length > 0) {
        console.warn(`⚠️ ${bundleResult.errors.length} pitching files failed to load:`, bundleResult.errors);
      }

      // Load bundled minor league batting stats (fast - no API calls)
      console.log('📦 Loading bundled minor league batting data...');
      const battingBundleResult = await minorLeagueBattingStatsService.loadDefaultMinorLeagueBattingData();
      console.log(`✅ Loaded ${battingBundleResult.loaded} bundled batting datasets`);
      if (battingBundleResult.errors.length > 0) {
        console.warn(`⚠️ ${battingBundleResult.errors.length} batting files failed to load:`, battingBundleResult.errors);
      }

      // Fetch current year from API if not in bundle (2025+)
      if (currentYear > 2024) {
        console.log(`📥 Fetching current year (${currentYear}) pitching from API...`);
        for (const level of levels) {
          await minorLeagueStatsService.getStats(currentYear, level);
          await delay(250);
        }
        console.log(`📥 Fetching current year (${currentYear}) batting from API...`);
        for (const level of levels) {
          await minorLeagueBattingStatsService.getStats(currentYear, level);
          await delay(250);
        }
      }

      // Load default OSA scouting data (pitchers and hitters)
      console.log('📋 Loading default OSA scouting data...');
      const gameDate = await dateService.getCurrentDate();
      const [pitcherOsaCount, hitterOsaCount] = await Promise.all([
        scoutingDataService.loadDefaultOsaData(gameDate),
        hitterScoutingDataService.loadDefaultHitterOsaData(gameDate)
      ]);
      const totalOsaCount = pitcherOsaCount + hitterOsaCount;
      if (totalOsaCount > 0) {
        console.log(`✅ Loaded ${pitcherOsaCount} pitcher + ${hitterOsaCount} hitter OSA scouting ratings`);
      }

      // All done - show onboarding explanation
      this.showOnboardingComplete(totalOsaCount, mlbBundleResult.loaded + bundleResult.loaded + battingBundleResult.loaded);
    } catch (error) {
      console.error('Onboarding fetch error:', error);
      this.showOnboardingError();
    }
  }

  private showOnboardingLoader(): void {
    const onboardingHtml = `
      <div id="onboarding-container" style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 400px; gap: 2rem;">
        <div class="baseball-spinner">⚾</div>
        <div id="onboarding-message" style="text-align: center; font-size: 1.1em; color: var(--color-text); max-width: 500px;"></div>
        <div id="onboarding-progress" style="font-size: 0.9em; color: var(--color-text-muted);"></div>
      </div>

      <style>
        .baseball-spinner {
          font-size: 4em;
          animation: spin 2s linear infinite;
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes fadeInOut {
          0%, 100% { opacity: 0; }
          50% { opacity: 1; }
        }

        .message-fade {
          animation: fadeInOut 4s ease-in-out;
        }
      </style>
    `;

    this.container.innerHTML = onboardingHtml;
    this.rotateOnboardingMessages();
  }

  private rotateOnboardingMessages(): void {
    const messages = [
      "Loading MLB and minor league data from StatsPlus...",
      "This might take a few minutes depending on league history",
      "We'll save this data so we don't anger Dave",
      "This only happens once, promise... for each browser you use 😅",
      "Almost there, hang tight..."
    ];

    let index = 0;
    const messageEl = this.container.querySelector('#onboarding-message');

    if (!messageEl) return;

    const showMessage = () => {
      if (index >= messages.length) {
        index = 0; // Loop back
      }

      messageEl.textContent = messages[index];
      messageEl.classList.add('message-fade');

      setTimeout(() => {
        messageEl.classList.remove('message-fade');
      }, 4000);

      index++;
    };

    showMessage(); // Show first message immediately
    this.onboardingMessageInterval = window.setInterval(showMessage, 4000);
  }

  private onboardingMessageInterval?: number;



  private async showOnboardingComplete(osaCount: number = 0, totalLoaded: number = 0): Promise<void> {
    if (this.onboardingMessageInterval) {
      clearInterval(this.onboardingMessageInterval);
    }

    const currentYear = await dateService.getCurrentYear();
    const yearCount = currentYear - LEAGUE_START_YEAR + 1;

    const completeHtml = `
      <div class="potential-stats-section">
        <h2 class="section-title">Welcome to True Ratings!</h2>
        <div style="max-width: 700px; margin: 0 auto; padding: 2rem;">
          <div style="background: rgba(0, 186, 124, 0.1); border-left: 3px solid var(--color-primary); padding: 1.5rem; margin-bottom: 2rem; border-radius: 4px;">
            <h3 style="margin-top: 0; color: var(--color-primary);">✅ Setup Complete!</h3>
            <p>We've loaded ${yearCount} years (${LEAGUE_START_YEAR}-${currentYear}) of MLB and minor league stats from bundled files${totalLoaded > 0 ? ` (${totalLoaded} datasets)` : ''}. This data is now cached locally for instant access.</p>
          </div>

          <h3>About Scouting Data</h3>
          <p>True Ratings works best with scouting reports. Here's what you need to know:</p>

          <ul style="line-height: 1.8; margin: 1rem 0;">
            <li><strong>OSA ratings are included by default</strong> - ${osaCount > 0 ? `We've loaded ${osaCount.toLocaleString()} OSA ratings!` : 'Ready to import when available'}</li>
            <li><strong>Upload your personal scout ratings</strong> (optional) - If you have custom scouting reports, upload them below</li>
            <li><strong>The app works without custom scouting data</strong> - We'll use OSA ratings as a fallback</li>
            <li><strong>Toggle between "My Scout" and "OSA"</strong> to compare different rating sources</li>
            <li><strong>Keep OSA data current</strong> - Upload updated CSV files as your league progresses</li>
          </ul>

          <p style="margin-top: 2rem; padding: 1rem; background: rgba(0,0,0,0.05); border-radius: 4px; font-size: 0.95em;">
            💡 <strong>Pro tip:</strong> The toggle below defaults to "My Scout" - this will show your custom ratings when available, and fall back to OSA when not.
          </p>

          <button id="onboarding-done-btn" class="btn btn-primary" style="margin-top: 2rem;">
            Got it, let's go!
          </button>
        </div>
      </div>
    `;

    this.container.innerHTML = completeHtml;

    const doneBtn = this.container.querySelector('#onboarding-done-btn');
    if (doneBtn) {
      doneBtn.addEventListener('click', () => {
        // Set mode state BEFORE rendering so initial state is correct
        this.currentMode = 'scouting';
        this.selectedScoutingSource = 'my';

        this.render();
        this.refreshExistingDataList();
        this.fetchGameDate();

        // Update toggle buttons to match state
        this.container.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.mode === this.currentMode);
        });

        // Update scout source toggles
        this.container.querySelectorAll<HTMLButtonElement>('[data-scouting-source]').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.scoutingSource === this.selectedScoutingSource);
        });

        this.updateModeUI();
      });
    }
  }

  private showOnboardingError(): void {
    if (this.onboardingMessageInterval) {
      clearInterval(this.onboardingMessageInterval);
    }

    this.container.innerHTML = `
      <div style="text-align: center; padding: 2rem;">
        <h2 style="color: var(--color-error);">Oops! Something went wrong</h2>
        <p>We couldn't load the minor league data. Please try refreshing the page.</p>
        <button class="btn btn-primary" onclick="location.reload()">Refresh Page</button>
      </div>
    `;
  }

  private async checkDefaultOsaStatus(): Promise<void> {
    const banner = this.container.querySelector<HTMLElement>('#default-osa-banner');
    const title = this.container.querySelector<HTMLElement>('#default-osa-title');
    const message = this.container.querySelector<HTMLElement>('#default-osa-message');
    const button = this.container.querySelector<HTMLButtonElement>('#load-default-osa-btn');

    if (!banner || !message || !button) return;

    try {
      // Check if bundled file exists
      const fileStatus = await scoutingDataService.checkDefaultOsaFile();

      // Check if OSA data is already loaded
      const existingOsa = await scoutingDataService.getLatestScoutingRatings('osa');

      if (!fileStatus.exists) {
        // File doesn't exist - show info message
        banner.style.display = 'block';
        banner.style.background = 'rgba(255, 193, 7, 0.1)';
        banner.style.borderLeftColor = '#ffc107';
        if (title) title.textContent = 'Default OSA Data Not Found';
        message.innerHTML = `No bundled OSA scouting file found. Add <code>public/data/default_osa_scouting.csv</code> to include default OSA ratings.`;
        button.style.display = 'none';
      } else if (fileStatus.count === 0) {
        // File exists but is empty
        banner.style.display = 'block';
        banner.style.background = 'rgba(255, 193, 7, 0.1)';
        banner.style.borderLeftColor = '#ffc107';
        if (title) title.textContent = 'Default OSA Data Empty';
        message.textContent = `Bundled OSA file exists but contains no ratings. Add data to public/data/default_osa_scouting.csv.`;
        button.style.display = 'none';
      } else if (existingOsa.length === 0) {
        // File exists with data, but not loaded yet
        banner.style.display = 'block';
        banner.style.background = 'rgba(0, 186, 124, 0.1)';
        banner.style.borderLeftColor = 'var(--color-primary)';
        if (title) title.textContent = 'Default OSA Data Available';
        message.textContent = `Found bundled OSA file with ${fileStatus.count.toLocaleString()} ratings. Click to load.`;
        button.style.display = 'block';
        button.disabled = false;
      } else {
        // File exists and data is already loaded
        banner.style.display = 'block';
        banner.style.background = 'rgba(0, 186, 124, 0.1)';
        banner.style.borderLeftColor = 'var(--color-primary)';
        if (title) title.textContent = 'OSA Data Loaded';
        message.innerHTML = `✅ OSA scouting data loaded (${existingOsa.length.toLocaleString()} ratings). Bundled file has ${fileStatus.count.toLocaleString()} ratings.`;
        if (existingOsa.length !== fileStatus.count) {
          message.innerHTML += ` <button id="reload-default-osa-btn" class="btn-link" style="margin-left: 0.5rem;">Update from bundled file</button>`;
          // Bind the inline reload button
          setTimeout(() => {
            const reloadBtn = this.container.querySelector('#reload-default-osa-btn');
            reloadBtn?.addEventListener('click', () => this.handleLoadDefaultOsa(true));
          }, 0);
        }
        button.style.display = 'none';
      }
    } catch (error) {
      console.error('Error checking default OSA status:', error);
      banner.style.display = 'none';
    }
  }

  private async handleLoadDefaultOsa(force: boolean = false): Promise<void> {
    const button = this.container.querySelector<HTMLButtonElement>('#load-default-osa-btn');
    const message = this.container.querySelector<HTMLElement>('#default-osa-message');

    if (button) {
      button.disabled = true;
      button.textContent = 'Loading...';
    }

    if (message) {
      message.textContent = 'Loading default OSA data...';
    }

    try {
      const gameDate = await dateService.getCurrentDate();
      const [pitcherCount, hitterCount] = await Promise.all([
        scoutingDataService.loadDefaultOsaData(gameDate, force),
        hitterScoutingDataService.loadDefaultHitterOsaData(gameDate, force)
      ]);
      const totalCount = pitcherCount + hitterCount;

      if (totalCount > 0) {
        const details = [];
        if (pitcherCount > 0) details.push(`${pitcherCount.toLocaleString()} pitchers`);
        if (hitterCount > 0) details.push(`${hitterCount.toLocaleString()} hitters`);

        this.messageModal.show(
          'Success',
          `Loaded ${details.join(' + ')} OSA scouting ratings from bundled files.`
        );

        // Refresh the data list and status
        await this.refreshExistingDataList();
        await this.checkDefaultOsaStatus();

        // Emit event to notify other views
        window.dispatchEvent(new CustomEvent('scoutingDataUpdated', {
          detail: { source: 'osa' }
        }));
      } else {
        this.messageModal.show(
          'No Data Loaded',
          'The bundled OSA files exist but contain no valid ratings, or OSA data is already loaded.'
        );
      }
    } catch (error) {
      console.error('Error loading default OSA:', error);
      this.messageModal.show('Error', `Failed to load default OSA data: ${error}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Load Default Data';
      }
    }
  }

  private async checkDefaultMinorsStatus(): Promise<void> {
    const banner = this.container.querySelector<HTMLElement>('#default-minors-banner');
    const message = this.container.querySelector<HTMLElement>('#default-minors-message');
    const button = this.container.querySelector<HTMLButtonElement>('#load-default-minors-btn');

    if (!banner || !message || !button) return;

    try {
      // Check how many datasets are already loaded
      const metadata = await indexedDBService.getAllStatsMetadata();
      const loadedCount = metadata.length;

      // Calculate expected datasets (LEAGUE_START_YEAR to current year × 4 levels)
      const currentYear = await dateService.getCurrentYear();
      const yearCount = currentYear - LEAGUE_START_YEAR + 1;
      const expectedCount = yearCount * 4;

      if (loadedCount === 0) {
        // No data loaded yet
        banner.style.display = 'block';
        message.textContent = `Found bundled minor league data. Click to load ~88+ datasets.`;
        button.style.display = 'block';
        button.disabled = false;
      } else if (loadedCount < expectedCount) {
        // Partially loaded
        banner.style.display = 'block';
        message.innerHTML = `⚠️ Partial data loaded (${loadedCount}/${expectedCount} datasets). <button id="reload-minors-btn" class="btn-link">Load from bundle</button>`;
        button.style.display = 'none';

        // Bind the inline reload button
        setTimeout(() => {
          const reloadBtn = this.container.querySelector('#reload-minors-btn');
          reloadBtn?.addEventListener('click', () => this.handleLoadDefaultMinors());
        }, 0);
      } else {
        // Fully loaded
        banner.style.display = 'block';
        message.textContent = `✅ Minor league data loaded (${loadedCount} datasets)`;
        button.style.display = 'none';
      }
    } catch (error) {
      console.error('Error checking default minors status:', error);
      banner.style.display = 'none';
    }
  }

  private async handleLoadDefaultMinors(): Promise<void> {
    const button = this.container.querySelector<HTMLButtonElement>('#load-default-minors-btn');
    const message = this.container.querySelector<HTMLElement>('#default-minors-message');

    if (button) {
      button.disabled = true;
      button.textContent = 'Loading...';
    }

    if (message) {
      message.textContent = 'Loading bundled minor league data...';
    }

    try {
      const result = await minorLeagueStatsService.loadDefaultMinorLeagueData();

      let resultMessage = `Loaded ${result.loaded} datasets from bundled files.`;
      if (result.errors.length > 0) {
        resultMessage += `\n\n${result.errors.length} files failed to load.`;
      }

      this.messageModal.show('Success', resultMessage);

      // Refresh the data list and status
      await this.refreshExistingDataList();
      await this.checkDefaultMinorsStatus();

    } catch (error) {
      console.error('Error loading default minors:', error);
      this.messageModal.show('Error', `Failed to load bundled minor league data: ${error}`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Load Bundled Data';
      }
    }
  }
}