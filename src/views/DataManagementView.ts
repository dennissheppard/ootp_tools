import { minorLeagueStatsService, MinorLeagueLevel } from '../services/MinorLeagueStatsService';
import { scoutingDataService, ScoutingSource } from '../services/ScoutingDataService';
import { dateService } from '../services/DateService';
import { MessageModal } from './MessageModal';
import { storageMigration } from '../services/StorageMigration';

type DataMode = 'stats' | 'scouting';

export class DataManagementView {
  private container: HTMLElement;
  private selectedYear: number = 2021; 
  private selectedLevel: MinorLeagueLevel = 'aaa';
  private selectedFiles: File[] = [];
  private messageModal: MessageModal;
  private currentMode: DataMode = 'stats';
  private selectedScoutingSource: ScoutingSource = 'my';
  private currentGameDate: string = '';

  constructor(container: HTMLElement) {
    this.container = container;
    this.messageModal = new MessageModal();
    this.render();
    this.refreshExistingDataList();
    this.fetchGameDate();
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
            <div id="scouting-inputs" class="rating-inputs" style="display: none; grid-template-columns: 1fr 1fr; margin-bottom: 1.5rem;">
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
          if (formatHint) formatHint.textContent = 'Format: player_id, name, stuff, control, hra [, age, pitch_ratings...]';
          if (namingHint) namingHint.textContent = 'Naming convention: Any CSV file.';
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
                    details = `<span style="color: var(--color-primary)">${this.selectedScoutingSource.toUpperCase()}</span> Report (${this.currentGameDate || 'Current'})`;
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
                await minorLeagueStatsService.saveStats(year, level, stats);
                successCount++;
            } else {
                const ratings = scoutingDataService.parseScoutingCsv(content, this.selectedScoutingSource);
                if (ratings.length === 0) {
                    failCount++;
                    errors.push(`${file.name}: No valid scouting data found.`);
                    continue;
                }
                
                // Use current game date if available, otherwise default to today
                const saveDate = this.currentGameDate || new Date().toISOString().split('T')[0];
                await scoutingDataService.saveScoutingRatings(saveDate, ratings, this.selectedScoutingSource);
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

      const foundData: {type: 'Stats' | 'Scout', yearOrDate: string, details: string, count: number, id: string, isLatest?: boolean}[] = [];
      const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];
      
      // Check Stats range 2000-2030
      for (let y = 2000; y <= 2030; y++) {
          for (const l of levels) {
              if (await minorLeagueStatsService.hasStats(y, l)) {
                  const stats = await minorLeagueStatsService.getStats(y, l);
                  foundData.push({ type: 'Stats', yearOrDate: y.toString(), details: l.toUpperCase(), count: stats.length, id: `stats_${y}_${l}` });
              }
          }
      }
      
      // Check Scouting Snapshots
      // Iterate year range 2000-2030 to find scouting data
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
                      details: source === 'my' ? 'My Scout' : 'OSA',
                      count: snap.count,
                      id: snap.key, // Use the full storage key as ID
                      isLatest: index === 0 // Assuming getAvailableScoutingSnapshots sorts desc
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
          let latestBadge = '';
          if (d.type === 'Scout' && d.isLatest) {
              latestBadge = `<span class="badge" style="background: rgba(0, 186, 124, 0.2); color: #00ba7c; margin-left: 0.5rem; font-size: 0.7em;">LATEST</span>`;
          }
          
          return `
            <tr>
                <td><span class="badge ${d.type === 'Stats' ? 'badge-position' : 'badge-retired'}">${d.type}</span></td>
                <td>${d.yearOrDate}</td>
                <td>${d.details} ${latestBadge}</td>
                <td>${d.count} records</td>
                <td style="text-align: right;">
                    <button class="btn-link delete-btn" data-id="${d.id}" style="color: var(--color-error);">Delete</button>
                </td>
            </tr>
          `;
      }).join('');

      tbody.querySelectorAll('.delete-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
              const el = e.target as HTMLElement;
              const id = el.dataset.id;
              if (!id) return;

              if (confirm(`Are you sure you want to delete this data?`)) {
                  // Handle Stats: ID format "stats_2021_aaa"
                  if (id.startsWith('stats_')) {
                      const parts = id.split('_');
                      if (parts.length >= 3) {
                          const year = parseInt(parts[1], 10);
                          const level = parts[2] as MinorLeagueLevel;
                          await minorLeagueStatsService.clearStats(year, level);
                      }
                  } 
                  // Handle Scouting: ID format "wbl_scouting_ratings_..." (LS) or "YYYY-MM-DD_source" (IDB)
                  else {
                      // Assume anything else is scouting data since we only list Stats and Scout types
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
}