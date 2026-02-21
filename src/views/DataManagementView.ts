import { minorLeagueStatsService, MinorLeagueLevel } from '../services/MinorLeagueStatsService';
import { minorLeagueBattingStatsService } from '../services/MinorLeagueBattingStatsService';
import { scoutingDataService, ScoutingSource, PITCH_TYPE_ALIASES } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { dateService } from '../services/DateService';
import { trueRatingsService, LEAGUE_START_YEAR } from '../services/TrueRatingsService';
import { MessageModal } from './MessageModal';
import { storageMigration } from '../services/StorageMigration';
import { AnalyticsDashboardView } from './AnalyticsDashboardView';

type ScoutingPlayerType = 'pitcher' | 'hitter';

export class DataManagementView {
  private container: HTMLElement;
  private selectedFiles: File[] = [];
  private messageModal: MessageModal;
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
    this.setupAnalyticsToggle();
  }

  private setupOnboardingListener(): void {
    window.addEventListener('wbl:first-time-onboarding', () => {
      this.startOnboarding();
    });
  }

  private setupAnalyticsToggle(): void {
    if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    window.addEventListener('wbl:show-analytics', () => {
      const el = this.container.querySelector<HTMLElement>('#analytics-dashboard-container');
      if (el) {
        const isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'block' : 'none';
      }
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
        <div id="analytics-dashboard-container" style="display: none;"></div>

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

        
        
        <div class="potential-stats-content" style="grid-template-columns: 1fr;">
          <details class="csv-field-reference" style="margin-top: 0.5rem;">
            <summary style="cursor: pointer; user-select: none; font-size: 1.9rem; color: var(--color-text); font-weight: bolder; padding: 0.5rem 0;">CSV Field Reference</summary>
            <div style="margin-top: 0.75rem;">
              <p style="font-size: 0.82em; color: var(--color-text-muted); margin-bottom: 0.75rem;">All recognized columns for scouting CSVs. Required columns marked with <span style="color: var(--color-error); font-weight: 600;">✱</span> — upload will be rejected if these headers are missing. Columns not listed below are ignored.</p>

              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
                <div>
                  <h4 style="font-size: 0.85em; margin-bottom: 0.5rem; color: var(--color-text);">Pitcher Scouting</h4>
                  <table class="stats-table" style="width: 100%; font-size: 0.8em;">
                    <thead><tr><th style="text-align: left;">Column</th><th style="text-align: left;">Description</th><th style="width: 1.5rem;"></th></tr></thead>
                    <tbody>
                      <tr><td>ID</td><td>Player ID</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>STU P</td><td>Stuff (20-80)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>CON P</td><td>Control (20-80)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>HRR P</td><td>HR Avoidance (20-80)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>OVR</td><td>Overall star rating</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>POT</td><td>Potential star rating</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>Prone</td><td>Injury proneness</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td style="white-space: nowrap;">FBP, CHP, SLP…</td><td>Pitch type ratings (at least 1)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>Name</td><td>Player name</td><td></td></tr>
                      <tr><td>STM</td><td>Stamina</td><td></td></tr>
                      <tr><td>DOB</td><td>Date of birth</td><td></td></tr>
                      <tr><td>Lev</td><td>Level (MLB, AAA, AA…)</td><td></td></tr>
                      <tr><td>HSC</td><td>HS/College status</td><td></td></tr>
                      <tr><td>PBABIP P</td><td>BABIP rating</td><td></td></tr>
                      <tr><td>G/F</td><td>Groundball/flyball type</td><td></td></tr>
                      <tr><td>LEA</td><td>Leadership</td><td></td></tr>
                      <tr><td>LOY</td><td>Loyalty</td><td></td></tr>
                      <tr><td>AD</td><td>Adaptability</td><td></td></tr>
                      <tr><td>FIN</td><td>Greed</td><td></td></tr>
                      <tr><td>WE</td><td>Work Ethic</td><td></td></tr>
                      <tr><td>INT</td><td>Intelligence</td><td></td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 style="font-size: 0.85em; margin-bottom: 0.5rem; color: var(--color-text);">Hitter Scouting</h4>
                  <table class="stats-table" style="width: 100%; font-size: 0.8em;">
                    <thead><tr><th style="text-align: left;">Column</th><th style="text-align: left;">Description</th><th style="width: 1.5rem;"></th></tr></thead>
                    <tbody>
                      <tr><td>ID</td><td>Player ID</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>POS</td><td>Position (LF, SS, C…)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>POW P</td><td>Power (20-80)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>EYE P</td><td>Eye / Discipline (20-80)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>K P</td><td>Avoid K (20-80)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>CON P</td><td>Contact (20-80)</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>OVR</td><td>Overall star rating</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>POT</td><td>Potential star rating</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>Prone</td><td>Injury proneness</td><td style="color: var(--color-error); font-weight: 600;">✱</td></tr>
                      <tr><td>Name</td><td>Player name</td><td></td></tr>
                      <tr><td>GAP P</td><td>Gap Power (20-80)</td><td></td></tr>
                      <tr><td>SPE</td><td>Speed (20-80)</td><td></td></tr>
                      <tr><td>SR</td><td>Stealing aggressiveness</td><td></td></tr>
                      <tr><td>STE</td><td>Stealing ability</td><td></td></tr>
                      <tr><td>DOB</td><td>Date of birth</td><td></td></tr>
                      <tr><td>Lev</td><td>Level (MLB, AAA, AA…)</td><td></td></tr>
                      <tr><td>HSC</td><td>HS/College status</td><td></td></tr>
                      <tr><td>LEA</td><td>Leadership</td><td></td></tr>
                      <tr><td>LOY</td><td>Loyalty</td><td></td></tr>
                      <tr><td>AD</td><td>Adaptability</td><td></td></tr>
                      <tr><td>FIN</td><td>Greed</td><td></td></tr>
                      <tr><td>WE</td><td>Work Ethic</td><td></td></tr>
                      <tr><td>INT</td><td>Intelligence</td><td></td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </details>
        
        <div class="csv-upload-container">
            <h3 class="form-title">Upload Scouting Data</h3>

            <!-- Scouting Inputs -->
            <div id="scouting-inputs" class="rating-inputs" style="grid-template-columns: 1fr 1fr 1fr; margin-bottom: 1.5rem;">
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
                <p class="csv-format" id="format-hint">Format: player_id, name, stuff, control, hra [, age, pitch_ratings...]</p>
                <p class="csv-format" id="naming-hint">For bulk upload, use: <code>pitcher_scouting_[source]_YYYY-MM-DD.csv</code> (e.g. pitcher_scouting_my_2024-03-15.csv)</p>
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
    this.checkMigrationNeeded();
    this.checkDefaultOsaStatus();

    // Mount analytics dashboard
    const dashboardContainer = this.container.querySelector<HTMLElement>('#analytics-dashboard-container');
    if (dashboardContainer) {
      new AnalyticsDashboardView(dashboardContainer);
    }
  }

  private bindEvents(): void {
    const fileInput = this.container.querySelector<HTMLInputElement>('#file-input');
    const browseBtn = this.container.querySelector<HTMLButtonElement>('#browse-btn');
    const dropZone = this.container.querySelector<HTMLDivElement>('#drop-zone');
    const uploadBtn = this.container.querySelector<HTMLButtonElement>('#upload-btn');
    const clearFileBtn = this.container.querySelector<HTMLButtonElement>('#clear-file');

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
            this.updateFormatHints();
        });
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
  }

  private updateFormatHints(): void {
      const formatHint = this.container.querySelector<HTMLElement>('#format-hint');
      const namingHint = this.container.querySelector<HTMLElement>('#naming-hint');

      if (this.selectedScoutingPlayerType === 'pitcher') {
          if (formatHint) formatHint.textContent = 'Format: player_id, name, stuff, control, hra [, age, pitch_ratings...]';
          if (namingHint) namingHint.innerHTML = 'For bulk upload, use: <code>pitcher_scouting_[source]_YYYY-MM-DD.csv</code> (e.g. pitcher_scouting_my_2024-03-15.csv)';
      } else {
          if (formatHint) formatHint.textContent = 'Format: player_id, name, power, eye, avoidK [, babip, gap, speed, age]';
          if (namingHint) namingHint.innerHTML = 'For bulk upload, use: <code>hitter_scouting_[source]_YYYY-MM-DD.csv</code> (e.g. hitter_scouting_osa_2024-03-15.csv)';
      }
  }

  private async handleFileSelection(files: FileList): Promise<void> {
    this.selectedFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.csv'));

    // Check for filename/toggle mismatches
    if (this.selectedFiles.length === 1) {
      await this.checkScoutingFileMismatch();
    }

    this.updateFileDisplay();

    const uploadBtn = this.container.querySelector<HTMLButtonElement>('#upload-btn');
    if (uploadBtn) uploadBtn.disabled = this.selectedFiles.length === 0;
  }

  private async checkScoutingFileMismatch(): Promise<void> {
    // Combine all file names for checking
    const names = this.selectedFiles.map(f => f.name.toLowerCase());
    const combined = names.join(' ');

    const hitterKeywords = /hitter|batter|batting|hitting/;
    const pitcherKeywords = /pitcher|pitching/;
    const osaKeywords = /[\b_]osa[\b_.]|[\b_]osa$/;
    const myKeywords = /[\b_]my[\b_.]|[\b_]my$/;

    // Check player type mismatch
    if (this.selectedScoutingPlayerType === 'pitcher' && hitterKeywords.test(combined)) {
      const choice = await this.messageModal.confirm(
        'File Name Mismatch',
        `The selected file${this.selectedFiles.length > 1 ? 's appear' : ' appears'} to contain <strong>batting/hitter</strong> data based on the filename, but you have <strong>Pitchers</strong> selected.\n\nHow would you like to proceed?`,
        ['Switch to Hitters', 'Keep as Pitchers']
      );
      if (choice === 'Switch to Hitters') {
        this.selectedScoutingPlayerType = 'hitter';
        this.container.querySelectorAll<HTMLButtonElement>('[data-player-type]').forEach(b => {
          b.classList.toggle('active', b.dataset.playerType === 'hitter');
        });
        this.updateFormatHints();
      }
    } else if (this.selectedScoutingPlayerType === 'hitter' && pitcherKeywords.test(combined)) {
      const choice = await this.messageModal.confirm(
        'File Name Mismatch',
        `The selected file${this.selectedFiles.length > 1 ? 's appear' : ' appears'} to contain <strong>pitching</strong> data based on the filename, but you have <strong>Hitters</strong> selected.\n\nHow would you like to proceed?`,
        ['Switch to Pitchers', 'Keep as Hitters']
      );
      if (choice === 'Switch to Pitchers') {
        this.selectedScoutingPlayerType = 'pitcher';
        this.container.querySelectorAll<HTMLButtonElement>('[data-player-type]').forEach(b => {
          b.classList.toggle('active', b.dataset.playerType === 'pitcher');
        });
        this.updateFormatHints();
      }
    }

    // Check source mismatch
    if (this.selectedScoutingSource === 'my' && osaKeywords.test(combined)) {
      const choice = await this.messageModal.confirm(
        'Scout Source Mismatch',
        `The selected file${this.selectedFiles.length > 1 ? 's appear' : ' appears'} to contain <strong>OSA</strong> scouting data based on the filename, but you have <strong>My Scout</strong> selected.\n\nHow would you like to proceed?`,
        ['Switch to OSA', 'Keep as My Scout']
      );
      if (choice === 'Switch to OSA') {
        this.selectedScoutingSource = 'osa';
        this.container.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => {
          b.classList.toggle('active', b.dataset.source === 'osa');
        });
      }
    } else if (this.selectedScoutingSource === 'osa' && myKeywords.test(combined)) {
      const choice = await this.messageModal.confirm(
        'Scout Source Mismatch',
        `The selected file${this.selectedFiles.length > 1 ? 's appear' : ' appears'} to contain <strong>My Scout</strong> data based on the filename, but you have <strong>OSA</strong> selected.\n\nHow would you like to proceed?`,
        ['Switch to My Scout', 'Keep as OSA']
      );
      if (choice === 'Switch to My Scout') {
        this.selectedScoutingSource = 'my';
        this.container.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => {
          b.classList.toggle('active', b.dataset.source === 'my');
        });
      }
    }
  }

  /**
   * Detect date, source, and player type from scouting filename.
   * Accepts flexible naming like:
   * - pitcher_scouting_my_2024-03-15.csv  (canonical pitcher format)
   * - hitter_scouting_osa_2024-03-15.csv  (canonical hitter format)
   * - pitchers_scouting_my_2024_03_15.csv (plural, underscored date)
   * - hitters_scouting_osa_2024_03_15.csv (plural, underscored date)
   * - scouting_my_2024-01-15.csv          (legacy pitcher format, still accepted)
   * - my_2024-01-15.csv                   (minimal, date detected)
   * - Any file with YYYY-MM-DD or YYYY_MM_DD pattern
   */
  private detectScoutingFileInfo(filename: string): { date?: string, source?: ScoutingSource, playerType?: ScoutingPlayerType } {
    const name = filename.toLowerCase();
    let date: string | undefined;
    let source: ScoutingSource | undefined;
    let playerType: ScoutingPlayerType | undefined;

    // Detect player type from filename
    if (/(?:^|[_\-])(?:hitter|hitters|batting|hitting)(?:[_\-.]|$)/.test(name)) {
      playerType = 'hitter';
    } else if (/(?:^|[_\-])(?:pitcher|pitchers|pitching)(?:[_\-.]|$)/.test(name)) {
      playerType = 'pitcher';
    }

    // Try to detect source from filename
    if (name.includes('_my_') || name.includes('_my.') || name.startsWith('my_') || name.includes('my_scout')) {
      source = 'my';
    } else if (name.includes('_osa_') || name.includes('_osa.') || name.startsWith('osa_') || name.includes('osa_scout')) {
      source = 'osa';
    }

    // Try to detect date (YYYY-MM-DD or YYYY_MM_DD format)
    const dateMatch = name.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
    if (dateMatch) {
      // Normalize to YYYY-MM-DD format (zero-pad month/day)
      date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
    }

    return { date, source, playerType };
  }

  /**
   * Validate that a CSV file's headers match what we expect for the current upload type.
   * Returns an error string if invalid, or null if OK.
   */
  private validateCsvHeaders(content: string, filename: string): string | null {
    const firstLine = content.split(/\r?\n/).find(l => l.trim().length > 0);
    if (!firstLine) return 'File is empty.';

    // Normalize headers the same way the services do: lowercase, strip all non-alphanumeric
    const normalize = (s: string) => s.replace(/^\ufeff/, '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const rawHeaders = firstLine.split(',').map(h => h.replace(/['"]/g, '').trim());
    const headers = rawHeaders.map(normalize);

    // If all cells are numeric, there's no header row — the parsers handle positional formats, so skip validation
    const allNumeric = headers.every(h => /^\d+(\.\d+)?$/.test(h));
    if (allNumeric) return null;

    // Helper: check if any alias matches a normalized header
    const findHeader = (aliases: string[]) => headers.some(h => aliases.includes(h));

    // Determine effective player type
    const scoutInfo = this.detectScoutingFileInfo(filename);
    const playerType = scoutInfo.playerType || this.selectedScoutingPlayerType;

    // Columns required for BOTH pitcher and hitter scouting
    const sharedAliases: Record<string, string[]> = {
      'player ID':  ['playerid', 'player_id', 'id', 'pid'],
      'OVR':        ['ovr', 'overall', 'cur', 'current'],
      'POT':        ['pot', 'potential', 'ceil', 'ceiling'],
      'prone':      ['prone', 'injury', 'injuryproneness', 'inj', 'durability'],
    };

    // Pitcher-specific required columns
    const pitcherAliases: Record<string, string[]> = {
      stuff:   ['stuff', 'stu', 'stf', 'stup', 'stfp', 'stuffp'],
      control: ['control', 'con', 'ctl', 'conp', 'controlp'],
      hra:     ['hra', 'hr', 'hrr', 'hravoid', 'hravoidance', 'hrrp', 'hrp'],
    };

    // Hitter-specific required columns
    const hitterAliases: Record<string, string[]> = {
      position: ['pos', 'position'],
      power:    ['power', 'pow', 'pwr', 'powerp', 'pwrp', 'powp'],
      eye:      ['eye', 'eyep', 'discipline', 'disc'],
      contact:  ['contact', 'con', 'conp', 'cnt', 'contactp'],
      avoidK:   ['avoidk', 'avoid_k', 'avk', 'avoidks', 'avoidkp', 'avoidsks', 'kav', 'kavoid', 'kp'],
    };

    // Check shared columns first
    const missingShared = Object.entries(sharedAliases)
      .filter(([, aliases]) => !findHeader(aliases))
      .map(([name]) => name);

    // Check type-specific columns
    if (playerType === 'pitcher') {
      const missingPitcher = Object.entries(pitcherAliases)
        .filter(([, aliases]) => !findHeader(aliases))
        .map(([name]) => name);

      // Cross-type check: does this look like hitter data?
      const hasHitterCols = ['power', 'eye', 'avoidK'].filter(key => findHeader(hitterAliases[key]));
      if (hasHitterCols.length >= 2 && missingPitcher.length > 0) {
        return `Headers look like hitter scouting data (found: ${hasHitterCols.join(', ')}), but uploading as Pitchers. Switch the Player Type toggle to Hitters?`;
      }

      // Check for at least one pitch type column using the canonical allowlist
      const hasPitches = headers.some(h => PITCH_TYPE_ALIASES.has(h));

      const allMissing = [...missingPitcher, ...missingShared];
      if (!hasPitches) allMissing.push('pitch types (e.g. Fastball, Slider)');

      if (allMissing.length > 0) {
        return `Missing required pitcher scouting columns: ${allMissing.join(', ')}.`;
      }
    } else {
      const missingHitter = Object.entries(hitterAliases)
        .filter(([, aliases]) => !findHeader(aliases))
        .map(([name]) => name);

      // Cross-type check: does this look like pitcher data?
      const hasPitcherCols = ['stuff', 'control', 'hra'].filter(key => findHeader(pitcherAliases[key]));
      if (hasPitcherCols.length >= 2 && missingHitter.length > 0) {
        return `Headers look like pitcher scouting data (found: ${hasPitcherCols.join(', ')}), but uploading as Hitters. Switch the Player Type toggle to Pitchers?`;
      }

      const allMissing = [...missingHitter, ...missingShared];
      if (allMissing.length > 0) {
        return `Missing required hitter scouting columns: ${allMissing.join(', ')}.`;
      }
    }

    return null;
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
                const scoutInfo = this.detectScoutingFileInfo(f.name);
                const displaySource = scoutInfo.source || this.selectedScoutingSource;
                const displayType = scoutInfo.playerType || this.selectedScoutingPlayerType;
                const displayDate = scoutInfo.date
                    ? `<span style="color: var(--color-success)">${scoutInfo.date}</span>`
                    : `<span style="opacity:0.5">${this.currentGameDate || 'Current'}</span>`;
                const typeLabel = displayType === 'hitter' ? 'Hitter' : 'Pitcher';
                const details = `${typeLabel} <span style="color: var(--color-primary)">${displaySource.toUpperCase()}</span> ${displayDate}`;

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

            // Validate headers before parsing
            const headerError = this.validateCsvHeaders(content, file.name);
            if (headerError) {
                failCount++;
                errors.push(`${file.name}: ${headerError}`);
                continue;
            }

            // Detect date, source, and player type from filename
            const scoutInfo = this.detectScoutingFileInfo(file.name);
            const saveSource = scoutInfo.source || this.selectedScoutingSource;
            const saveDate = scoutInfo.date || this.currentGameDate || new Date().toISOString().split('T')[0];

            // For multi-file bulk uploads, validate naming when no date detected
            if (this.selectedFiles.length > 1 && !scoutInfo.date) {
                failCount++;
                const typePrefix = this.selectedScoutingPlayerType === 'hitter' ? 'hitter' : 'pitcher';
                errors.push(`${file.name}: Could not detect date from filename. For bulk upload, name files like ${typePrefix}_scouting_${this.selectedScoutingSource}_YYYY-MM-DD.csv`);
                continue;
            }

            // Determine player type from filename or UI selection
            const playerType = scoutInfo.playerType || this.selectedScoutingPlayerType;

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
    if (successCount > 0) {
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

      const foundData: {type: 'Scout' | 'HitterScout', source: 'my' | 'osa', yearOrDate: string, details: string, count: number, id: string, isLatest?: boolean}[] = [];

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
                      source: source as 'my' | 'osa',
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
                      source: source as 'my' | 'osa',
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
          let latestBadge = '';
          if (d.isLatest) {
              latestBadge = `<span class="badge" style="background: rgba(0, 186, 124, 0.2); color: #00ba7c; margin-left: 0.5rem; font-size: 0.7em;">LATEST</span>`;
          }

          const badgeClass = d.source === 'osa' ? 'badge-active' : 'badge-retired';
          const badgeLabel = d.source === 'osa' ? 'OSA' : 'My Scout';

          return `
            <tr>
                <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
                <td>${d.yearOrDate}</td>
                <td>${d.details} ${latestBadge}</td>
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
                  // Handle Hitter Scouting: ID format "hitter_YYYY-MM-DD_source"
                  if (type === 'HitterScout' || id.startsWith('hitter_')) {
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

      // Fire current-year API calls first — they're slow (network latency)
      // and can run in parallel with the fast local CSV loading
      console.log(`📥 Fetching current year (${currentYear}) from API...`);
      const apiPromises: Promise<any>[] = [
        trueRatingsService.getTruePitchingStats(currentYear)
          .then(() => console.log(`✅ API: MLB pitching ${currentYear}`))
          .catch(err => console.warn(`⚠️ API: MLB pitching ${currentYear} failed:`, err)),
        trueRatingsService.getTrueBattingStats(currentYear)
          .then(() => console.log(`✅ API: MLB batting ${currentYear}`))
          .catch(err => console.warn(`⚠️ API: MLB batting ${currentYear} failed:`, err)),
      ];
      for (const level of levels) {
        apiPromises.push(
          minorLeagueStatsService.getStats(currentYear, level)
            .then(() => console.log(`✅ API: MiLB pitching ${currentYear} ${level}`))
            .catch(err => console.warn(`⚠️ API: MiLB pitching ${currentYear} ${level} failed:`, err))
        );
        apiPromises.push(
          minorLeagueBattingStatsService.getStats(currentYear, level)
            .then(() => console.log(`✅ API: MiLB batting ${currentYear} ${level}`))
            .catch(err => console.warn(`⚠️ API: MiLB batting ${currentYear} ${level} failed:`, err))
        );
      }

      // While API calls are in flight, load bundled CSV data (fast, local files)
      console.log(`📦 Loading bundled historical data (${startYear}-${currentYear - 1})...`);
      const [mlbBundleResult, mlbBattingBundleResult, bundleResult, battingBundleResult, gameDate] = await Promise.all([
        trueRatingsService.loadDefaultMlbData(),
        trueRatingsService.loadDefaultMlbBattingData(),
        minorLeagueStatsService.loadDefaultMinorLeagueData(),
        minorLeagueBattingStatsService.loadDefaultMinorLeagueBattingData(),
        dateService.getCurrentDate(),
      ]);
      console.log(`✅ Loaded ${mlbBundleResult.loaded} MLB pitching + ${mlbBattingBundleResult.loaded} MLB batting + ${bundleResult.loaded} MiLB pitching + ${battingBundleResult.loaded} MiLB batting bundled datasets`);

      // Load default OSA scouting data (pitchers and hitters)
      console.log('📋 Loading default OSA scouting data...');
      const [pitcherOsaCount, hitterOsaCount] = await Promise.all([
        scoutingDataService.loadDefaultOsaData(gameDate),
        hitterScoutingDataService.loadDefaultHitterOsaData(gameDate)
      ]);
      const totalOsaCount = pitcherOsaCount + hitterOsaCount;
      if (totalOsaCount > 0) {
        console.log(`✅ Loaded ${pitcherOsaCount} pitcher + ${hitterOsaCount} hitter OSA scouting ratings`);
      }

      // Wait for all current-year API calls to finish
      await Promise.all(apiPromises);
      console.log(`✅ Current year API data loaded`);

      // Notify other views that scouting data is now available
      if (totalOsaCount > 0) {
        window.dispatchEvent(new CustomEvent('scoutingDataUpdated', { detail: { source: 'osa' } }));
      }

      // All done - show onboarding explanation
      this.showOnboardingComplete(totalOsaCount, mlbBundleResult.loaded + bundleResult.loaded + battingBundleResult.loaded);
    } catch (error) {
      console.error('Onboarding fetch error:', error);
      this.showOnboardingError();
    }
  }

  private showOnboardingLoader(): void {
    // Transparent pass-through overlay — About page stays fully visible and interactive.
    // The spinner pill floats at the top of the content area.
    const overlay = document.createElement('div');
    overlay.id = 'onboarding-fullscreen-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      z-index: 999;
      background: transparent;
      pointer-events: none;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 130px;
    `;
    overlay.innerHTML = `
      <div style="
        background: var(--color-surface);
        border: 1px solid var(--color-primary);
        border-radius: 2rem;
        padding: 0.55rem 1.4rem;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        box-shadow: 0 4px 24px rgba(0,0,0,0.5);
        pointer-events: auto;
        max-width: 90vw;
      ">
        <span style="font-size: 1.5em; animation: wbl-onboarding-spin 2s linear infinite; display: inline-block; flex-shrink: 0;">⚾</span>
        <span id="onboarding-message" style="font-size: 0.9rem; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>
      </div>
      <style>
        @keyframes wbl-onboarding-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes wbl-onboarding-fade {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        .wbl-message-fade { animation: wbl-onboarding-fade 4s ease-in-out; }
      </style>
    `;

    document.body.appendChild(overlay);
    this.onboardingOverlay = overlay;

    // Block all clicks (navigation, tabs, buttons) until onboarding completes.
    // Scroll is unaffected — it uses wheel/touch events, not click.
    const clickBlocker = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', clickBlocker, true);
    this.onboardingClickBlocker = clickBlocker;

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
    const messageEl = (this.onboardingOverlay ?? this.container).querySelector<HTMLElement>('#onboarding-message');

    if (!messageEl) return;

    const showMessage = () => {
      if (index >= messages.length) {
        index = 0; // Loop back
      }

      messageEl.textContent = messages[index];
      messageEl.classList.add('wbl-message-fade');

      setTimeout(() => {
        messageEl.classList.remove('wbl-message-fade');
      }, 4000);

      index++;
    };

    showMessage(); // Show first message immediately
    this.onboardingMessageInterval = window.setInterval(showMessage, 4000);
  }

  private onboardingMessageInterval?: number;
  private onboardingOverlay?: HTMLElement;
  private onboardingClickBlocker?: (e: MouseEvent) => void;



  private removeClickBlocker(): void {
    if (this.onboardingClickBlocker) {
      document.removeEventListener('click', this.onboardingClickBlocker, true);
      this.onboardingClickBlocker = undefined;
    }
  }

  private async showOnboardingComplete(osaCount: number = 0, totalLoaded: number = 0): Promise<void> {
    if (this.onboardingMessageInterval) {
      clearInterval(this.onboardingMessageInterval);
      this.onboardingMessageInterval = undefined;
    }
    this.removeClickBlocker();

    // Remove the fullscreen loading overlay to reveal the About page behind it
    if (this.onboardingOverlay) {
      this.onboardingOverlay.remove();
      this.onboardingOverlay = undefined;
    }

    const currentYear = await dateService.getCurrentYear();
    const yearCount = currentYear - LEAGUE_START_YEAR + 1;

    const osaLine = osaCount > 0
      ? `<strong>${osaCount.toLocaleString()} OSA scouting ratings</strong> are pre-loaded and ready to use.`
      : 'OSA scouting data can be imported via <em>Data Management</em> once available.';

    const modal = document.createElement('div');
    modal.className = 'modal-overlay visible';
    modal.style.zIndex = '1100';
    modal.innerHTML = `
      <div class="modal" style="width: min(580px, 92vw);">
        <div class="modal-header">
          <h3 class="modal-title">✅ Setup Complete ⚾ Welcome to True Ratings!</h3>
        </div>
        <div class="modal-body" style="padding: 1.5rem; line-height: 1.75;">
          <p style="margin: 0 0 0.9rem;">
            <strong>${yearCount} years of data loaded</strong> (${LEAGUE_START_YEAR}–${currentYear}):
            MLB and minor league stats are now cached locally for instant access${totalLoaded > 0 ? ` (${totalLoaded} datasets)` : ''}.
          </p>
          <p style="margin: 0 0 0.9rem;">${osaLine}</p>
          <p style="margin: 0 0 0.9rem;">
            <strong>Have your own scouting reports?</strong> Head to <em>Data Management</em> any time
            to upload pitcher or hitter scouting CSVs. The app works great with just OSA data!
            Custom scouting is optional but will improve the TR/TFR blend.
          </p>
          <p style="margin: 0; padding: 0.75rem 1rem; background: rgba(0,186,124,0.1); border-left: 3px solid var(--color-primary); border-radius: 4px; font-size: 0.88rem;">
            💡 Scroll down the About page to see how True Ratings, TFR, and projections work,
            then click any section card to jump straight in.
          </p>
        </div>
        <div class="modal-footer" style="padding: 1rem 1.5rem; border-top: 1px solid var(--color-border); text-align: right;">
          <button id="onboarding-welcome-done" class="btn btn-primary" style="padding: 0.55rem 1.5rem; font-size: 1rem;">
            Let's go! ⚾
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#onboarding-welcome-done')?.addEventListener('click', () => {
      modal.remove();
    });
  }

  private showOnboardingError(): void {
    if (this.onboardingMessageInterval) {
      clearInterval(this.onboardingMessageInterval);
      this.onboardingMessageInterval = undefined;
    }
    this.removeClickBlocker();

    if (this.onboardingOverlay) {
      this.onboardingOverlay.remove();
      this.onboardingOverlay = undefined;
    }

    this.messageModal.show('Setup Error', 'We couldn\'t load some data during setup. Please refresh the page to try again.');
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

}