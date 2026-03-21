import { minorLeagueStatsService, MinorLeagueLevel } from '../services/MinorLeagueStatsService';
import { minorLeagueBattingStatsService } from '../services/MinorLeagueBattingStatsService';
import { scoutingDataService, ScoutingSource } from '../services/ScoutingDataService';
import { hitterScoutingDataService } from '../services/HitterScoutingDataService';
import { dateService } from '../services/DateService';
import { trueRatingsService, LEAGUE_START_YEAR } from '../services/TrueRatingsService';
import { MessageModal } from './MessageModal';
import { storageMigration } from '../services/StorageMigration';
import { AnalyticsDashboardView } from './AnalyticsDashboardView';
import { syncOrchestrator } from '../services/SyncOrchestrator';
import { supabaseDataService } from '../services/SupabaseDataService';

export class DataManagementView {
  private container: HTMLElement;
  private messageModal: MessageModal;
  private currentGameDate: string = '';
  private hasLoadedData = false;
  // Team scouting login moved to ScoutingLoginModal (header badge)

  constructor(container: HTMLElement) {
    this.container = container;
    this.messageModal = new MessageModal();
    this.render();
    this.fetchGameDate();
    this.setupOnboardingListener();
    this.setupAnalyticsToggle();
    this.setupLazyLoading();
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

  private setupLazyLoading(): void {
    const tabPanel = this.container.closest<HTMLElement>('.tab-panel');
    const isCurrentlyActive = tabPanel?.classList.contains('active');

    if (isCurrentlyActive) {
      this.lazyInit();
    } else if (tabPanel) {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            const target = mutation.target as HTMLElement;
            if (target.classList.contains('active') && !this.hasLoadedData) {
              observer.disconnect();
              this.lazyInit();
              break;
            }
          }
        }
      });
      observer.observe(tabPanel, { attributes: true, attributeFilter: ['class'] });
    }
  }

  private lazyInit(): void {
    if (this.hasLoadedData) return;
    this.hasLoadedData = true;

    this.refreshExistingDataList();

    // Mount analytics dashboard
    const dashboardContainer = this.container.querySelector<HTMLElement>('#analytics-dashboard-container');
    if (dashboardContainer) {
      new AnalyticsDashboardView(dashboardContainer);
    }
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
        <p class="section-subtitle">Stats and OSA scouting are synced automatically. Load your team's scouting via the badge in the header.</p>

        <div id="migration-banner" style="display: none; background: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107; padding: 1rem; margin-bottom: 1rem; border-radius: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <strong>Storage Migration Available</strong>
              <p style="margin: 0.5rem 0 0 0; opacity: 0.9;">Your data is stored in localStorage which has limited space. Migrate to IndexedDB for unlimited storage.</p>
            </div>
            <button id="migrate-btn" class="btn btn-primary">Migrate Now</button>
          </div>
        </div>

        <div class="potential-stats-content" style="grid-template-columns: 1fr;">
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
  }

  private bindEvents(): void {
    // Migration button
    const migrateBtn = this.container.querySelector<HTMLButtonElement>('#migrate-btn');
    migrateBtn?.addEventListener('click', () => this.handleMigration());
  }

  // Team scouting login form moved to ScoutingLoginModal (launched from header badge).

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

    try {
      // Supabase configured → DB is pre-populated by CLI tool (tools/sync-db.ts)
      if (supabaseDataService.isConfigured) {
        const syncResult = await syncOrchestrator.checkDataReady();
        if (syncResult.source === 'db') {
          console.log('⚡ Supabase has data, skipping onboarding');
          this.dismissOnboardingOverlay();
          return;
        }
        // DB not ready yet (CLI hasn't run) — show error
        console.warn('⚠️ Supabase configured but no data found. Run: npx tsx tools/sync-db.ts');
      }

      // Legacy (non-Supabase) onboarding — loads from API + bundled CSVs into IndexedDB
      const gameDate = await dateService.getCurrentDate();
      const currentYear = await dateService.getCurrentYear();
      await this.legacyOnboarding(gameDate, currentYear);
    } catch (error) {
      console.error('Onboarding fetch error:', error);
      this.showOnboardingError();
    }
  }

  /** Legacy onboarding for when Supabase is not configured — loads everything into IndexedDB */
  private async legacyOnboarding(gameDate: string, currentYear: number): Promise<void> {
    const levels: MinorLeagueLevel[] = ['aaa', 'aa', 'a', 'r'];

    const apiPromises: Promise<any>[] = [
      trueRatingsService.getTruePitchingStats(currentYear)
        .catch(err => console.warn(`⚠️ API: MLB pitching ${currentYear} failed:`, err)),
      trueRatingsService.getTrueBattingStats(currentYear)
        .catch(err => console.warn(`⚠️ API: MLB batting ${currentYear} failed:`, err)),
    ];
    for (const level of levels) {
      apiPromises.push(
        minorLeagueStatsService.getStats(currentYear, level)
          .catch(err => console.warn(`⚠️ API: MiLB ${currentYear} ${level} failed:`, err)),
        minorLeagueBattingStatsService.getStats(currentYear, level)
          .catch(err => console.warn(`⚠️ API: MiLB batting ${currentYear} ${level} failed:`, err)),
      );
    }

    const [mlbBundleResult, mlbBattingBundleResult, bundleResult, battingBundleResult] = await Promise.all([
      trueRatingsService.loadDefaultMlbData(),
      trueRatingsService.loadDefaultMlbBattingData(),
      minorLeagueStatsService.loadDefaultMinorLeagueData(),
      minorLeagueBattingStatsService.loadDefaultMinorLeagueBattingData(),
    ]);

    const totalBundled = mlbBundleResult.loaded + mlbBattingBundleResult.loaded +
                         bundleResult.loaded + battingBundleResult.loaded;
    if (totalBundled > 0) {
      console.log(`✅ Loaded ${totalBundled} historical datasets`);
    }

    const [pitcherOsaCount, hitterOsaCount] = await Promise.all([
      scoutingDataService.loadDefaultOsaData(gameDate),
      hitterScoutingDataService.loadDefaultHitterOsaData(gameDate),
    ]);
    const totalOsaCount = pitcherOsaCount + hitterOsaCount;

    await Promise.all(apiPromises);

    if (totalOsaCount > 0) {
      window.dispatchEvent(new CustomEvent('scoutingDataUpdated', { detail: { source: 'osa' } }));
    }

    this.showOnboardingComplete(totalOsaCount, totalBundled);
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
      "Loading MLB and minor league data...",
      "This might take a few minutes depending on league history",
      "We'll save this data locally so it's fast next time",
      "This only happens once, promise... for each browser you use",
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
  // Scouting overlay methods moved to ScoutingLoginModal



  private removeClickBlocker(): void {
    if (this.onboardingClickBlocker) {
      document.removeEventListener('click', this.onboardingClickBlocker, true);
      this.onboardingClickBlocker = undefined;
    }
  }

  /** Just remove the loading overlay — no modal. Used for DB-backed paths. */
  private dismissOnboardingOverlay(): void {
    if (this.onboardingMessageInterval) {
      clearInterval(this.onboardingMessageInterval);
      this.onboardingMessageInterval = undefined;
    }
    this.removeClickBlocker();
    if (this.onboardingOverlay) {
      this.onboardingOverlay.remove();
      this.onboardingOverlay = undefined;
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

}