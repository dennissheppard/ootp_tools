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
import { teamRatingsService } from '../services/TeamRatingsService';
import { apiFetch } from '../services/ApiClient';
import { teamService } from '../services/TeamService';
import { getTeamLogoUrl } from '../utils/teamLogos';
import type { PitcherScoutingRatings } from '../models/ScoutingData';
import type { HitterScoutingRatings } from '../models/ScoutingData';

const INJURY_MAP: Record<string, string> = {
  IRN: 'Iron Man', DUR: 'Durable', NOR: 'Normal', FRG: 'Fragile', WRK: 'Wrecked',
};

export class DataManagementView {
  private container: HTMLElement;
  private messageModal: MessageModal;
  private currentGameDate: string = '';
  private hasLoadedData = false;
  private teamAbbrMap = new Map<string, string>(); // nickname → abbr
  private selectedTeamNickname = '';
  private selectedTeamAbbr = '';

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
        <p class="section-subtitle">Stats and OSA scouting are synced automatically. Use this page to load your team's private scouting.</p>

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
          <div class="csv-upload-container">
            <h3 class="form-title">Team Scouting</h3>
            <p style="font-size: 0.85em; color: var(--color-text-muted); margin-bottom: 1rem;">
              Load your team's private scouting ratings. These are stored locally in your browser only.
            </p>

            <div class="rating-inputs" style="grid-template-columns: 1fr 1fr; margin-bottom: 1rem;">
              <div class="rating-field">
                <label>Team</label>
                <div class="filter-dropdown" id="scout-team-dropdown" style="width: 100%;">
                  <button class="filter-dropdown-btn" style="width: 100%; text-align: left;" aria-haspopup="true" aria-expanded="false">
                    <span id="scout-team-display">Select your team...</span> ▾
                  </button>
                  <div class="filter-dropdown-menu" id="scout-team-menu" style="max-height: 300px; overflow-y: auto;"></div>
                </div>
              </div>
              <div class="rating-field">
                <label for="scout-passphrase">Passphrase</label>
                <input type="text" id="scout-passphrase" placeholder="Enter team passphrase" autocomplete="off" data-lpignore="true" data-form-type="other" style="width: 100%; padding: 0.4rem 0.5rem; background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-border); border-radius: 4px; -webkit-text-security: disc;">
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center;">
              <p style="font-size: 0.78em; color: var(--color-text-muted); margin: 0; max-width: 70%;">
                Your passphrase is not stored. Scouting ratings are saved locally in your browser and never uploaded to any server.
              </p>
              <button id="fetch-scouting-btn" class="btn btn-primary" disabled>Fetch Scouting</button>
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
    this.loadTeamDropdown();
  }

  private bindEvents(): void {
    const passphrase = this.container.querySelector<HTMLInputElement>('#scout-passphrase');
    const fetchBtn = this.container.querySelector<HTMLButtonElement>('#fetch-scouting-btn');

    passphrase?.addEventListener('input', () => this.updateFetchEnabled());
    fetchBtn?.addEventListener('click', () => this.handleFetchTeamScouting());

    // Team dropdown open/close
    const dropdownBtn = this.container.querySelector('#scout-team-dropdown .filter-dropdown-btn');
    dropdownBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = this.container.querySelector('#scout-team-dropdown');
      dropdown?.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('#scout-team-dropdown')) {
        this.container.querySelector('#scout-team-dropdown')?.classList.remove('open');
      }
    });

    // Migration button
    const migrateBtn = this.container.querySelector<HTMLButtonElement>('#migrate-btn');
    migrateBtn?.addEventListener('click', () => this.handleMigration());
  }

  private updateFetchEnabled(): void {
    const fetchBtn = this.container.querySelector<HTMLButtonElement>('#fetch-scouting-btn');
    const passphrase = this.container.querySelector<HTMLInputElement>('#scout-passphrase');
    if (fetchBtn) {
      fetchBtn.disabled = !this.selectedTeamAbbr || !passphrase?.value;
    }
  }

  private async loadTeamDropdown(): Promise<void> {
    const menu = this.container.querySelector<HTMLElement>('#scout-team-menu');
    if (!menu) return;
    try {
      // Load from both sources: teamService for proper filtering, WBL API for abbreviations
      const [allTeams, apiRes] = await Promise.all([
        teamService.getAllTeams(),
        apiFetch('/api/teams?level=wbl').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      // Build nickname → abbr map from WBL API
      if (apiRes?.teams) {
        for (const t of Object.values(apiRes.teams) as { abbr: string; nickname: string }[]) {
          this.teamAbbrMap.set(t.nickname, t.abbr);
        }
      }

      // Filter to real MLB orgs (teams with minor league affiliates, excludes All-Star teams)
      const orgsWithAffiliates = new Set<number>();
      for (const t of allTeams) {
        if (t.parentTeamId > 0) orgsWithAffiliates.add(t.parentTeamId);
      }
      const mainTeams = allTeams
        .filter(t => t.parentTeamId === 0 && orgsWithAffiliates.has(t.id))
        .sort((a, b) => a.nickname.localeCompare(b.nickname));

      menu.innerHTML = mainTeams.map(t => {
        const logoUrl = getTeamLogoUrl(t.nickname);
        const logoHtml = logoUrl ? `<img class="team-dropdown-logo" src="${logoUrl}" alt="">` : '';
        return `<div class="filter-dropdown-item" data-nickname="${t.nickname}" data-abbr="${this.teamAbbrMap.get(t.nickname) ?? ''}">${logoHtml}${t.nickname}</div>`;
      }).join('');

      // Bind click handlers
      menu.querySelectorAll('.filter-dropdown-item').forEach(item => {
        item.addEventListener('click', () => {
          const el = item as HTMLElement;
          this.selectedTeamNickname = el.dataset.nickname ?? '';
          this.selectedTeamAbbr = el.dataset.abbr ?? '';

          // Update display
          const display = this.container.querySelector<HTMLElement>('#scout-team-display');
          if (display) {
            const logoUrl = getTeamLogoUrl(this.selectedTeamNickname);
            const logoHtml = logoUrl ? `<img class="team-btn-logo" src="${logoUrl}" alt="">` : '';
            display.innerHTML = `${logoHtml}${this.selectedTeamNickname}`;
          }

          // Update selected state
          menu.querySelectorAll('.filter-dropdown-item').forEach(i => i.classList.remove('selected'));
          el.classList.add('selected');

          // Close dropdown
          this.container.querySelector('#scout-team-dropdown')?.classList.remove('open');
          this.updateFetchEnabled();
        });
      });
    } catch {
      // Silently fail — dropdown stays empty
    }
  }

  private async handleFetchTeamScouting(): Promise<void> {
    const passphraseInput = this.container.querySelector<HTMLInputElement>('#scout-passphrase');
    const fetchBtn = this.container.querySelector<HTMLButtonElement>('#fetch-scouting-btn');
    const teamAbbr = this.selectedTeamAbbr;
    const passphrase = passphraseInput?.value;
    if (!teamAbbr || !passphrase) return;

    if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = 'Fetch Scouting'; }
    this.showScoutingOverlay();
    this.updateScoutingOverlay('Fetching scouting data...', 'Connecting to WBL API');

    try {
      const gameDate = this.currentGameDate || await dateService.getCurrentDate();

      // Paginate: API caps at 2000 per request
      const PAGE_SIZE = 2000;
      let allRatings: any[] = [];
      let offset = 0;
      let total = Infinity;

      while (offset < total) {
        const url = `/api/scout?tid=${encodeURIComponent(teamAbbr)}&passphrase=${encodeURIComponent(passphrase)}&limit=${PAGE_SIZE}&offset=${offset}`;
        const res = await apiFetch(url);
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(body || `HTTP ${res.status}`);
        }
        const data = await res.json();
        const pageRatings = data.ratings as any[];
        if (!pageRatings || pageRatings.length === 0) break;

        allRatings = allRatings.concat(pageRatings);
        total = data.total ?? pageRatings.length;
        offset += pageRatings.length;

        this.updateScoutingOverlay('Fetching scouting data...', `${allRatings.length} of ${total} records`);

        if (pageRatings.length < PAGE_SIZE) break; // Last page
      }

      const ratings = allRatings;
      if (ratings.length === 0) {
        this.dismissScoutingOverlay();
        this.messageModal.show('No Results', 'No scouting ratings returned. Check your team and passphrase.');
        return;
      }

      this.updateScoutingOverlay('Processing ratings...', `${ratings.length} records fetched`);

      const pitcherRatings: PitcherScoutingRatings[] = [];
      const hitterRatings: HitterScoutingRatings[] = [];

      for (const r of ratings) {
        const injury = r.injury_proneness ? (INJURY_MAP[String(r.injury_proneness).toUpperCase()] ?? String(r.injury_proneness)) : undefined;
        if (r.is_pitcher) {
          const pitches: Record<string, number> = {};
          if (r.pitching?.pitches) {
            for (const [k, v] of Object.entries(r.pitching.pitches)) {
              const val = parseInt(String(v), 10);
              if (val > 0) pitches[k] = val;
            }
          }
          pitcherRatings.push({
            playerId: parseInt(r.player_id, 10),
            playerName: r.player_name || undefined,
            stuff: parseInt(r.pitching?.stuff, 10) || 20,
            control: parseInt(r.pitching?.control, 10) || 20,
            hra: parseInt(r.pitching?.hra, 10) || 20,
            stamina: r.pitching?.stamina ? parseInt(r.pitching.stamina, 10) : undefined,
            injuryProneness: injury,
            ovr: r.overall ? parseFloat(r.overall) : undefined,
            pot: r.potential ? parseFloat(r.potential) : undefined,
            pitches: Object.keys(pitches).length > 0 ? pitches : undefined,
            babip: r.pitching?.pbabip ? String(r.pitching.pbabip) : undefined,
          });
        } else {
          hitterRatings.push({
            playerId: parseInt(r.player_id, 10),
            playerName: r.player_name || undefined,
            power: parseInt(r.batting?.power, 10) || 20,
            eye: parseInt(r.batting?.eye, 10) || 20,
            avoidK: parseInt(r.batting?.avoidKs, 10) || 20,
            contact: parseInt(r.batting?.contact, 10) || 20,
            gap: parseInt(r.batting?.gap, 10) || 20,
            speed: parseInt(r.batting?.speed, 10) || 20,
            stealingAggressiveness: r.batting?.sbAgg ? parseInt(r.batting.sbAgg, 10) : undefined,
            stealingAbility: r.batting?.steal ? parseInt(r.batting.steal, 10) : undefined,
            injuryProneness: injury,
            ovr: parseFloat(r.overall) || 2.5,
            pot: parseFloat(r.potential) || 2.5,
            fielding: r.fielding || undefined,
          });
        }
      }

      // Save to IndexedDB via existing scouting services
      this.updateScoutingOverlay('Saving to browser...', `${pitcherRatings.length} pitchers, ${hitterRatings.length} hitters`);
      if (pitcherRatings.length > 0) {
        await scoutingDataService.saveScoutingRatings(gameDate, pitcherRatings, 'my');
      }
      if (hitterRatings.length > 0) {
        await hitterScoutingDataService.saveScoutingRatings(gameDate, hitterRatings, 'my');
      }

      // Clear passphrase from UI
      if (passphraseInput) passphraseInput.value = '';

      let resultMessage: string;

      // Recalculate if Supabase user
      if (supabaseDataService.isConfigured) {
        supabaseDataService.hasCustomScouting = true;
        trueRatingsService.clearCaches();
        teamRatingsService.clearTfrCaches();

        this.updateScoutingOverlay('Recalculating ratings...', 'This may take a moment');

        try {
          const year = await dateService.getCurrentYear();
          await trueRatingsService.warmCachesForComputation(year);
          const [hitterTr, pitcherTr] = await Promise.all([
            trueRatingsService.getHitterTrueRatings(year),
            trueRatingsService.getPitcherTrueRatings(year),
            teamRatingsService.getUnifiedHitterTfrData(year),
            teamRatingsService.getFarmData(year),
          ]);
          resultMessage = `Loaded ${pitcherRatings.length} pitcher and ${hitterRatings.length} hitter ratings.\nRecalculated: ${hitterTr.size} hitter TRs, ${pitcherTr.size} pitcher TRs.`;
        } catch (err) {
          console.error('Failed to recalculate ratings:', err);
          resultMessage = `Loaded ${pitcherRatings.length} pitcher and ${hitterRatings.length} hitter ratings.\nRating recalculation failed — try refreshing.`;
        }
      } else {
        resultMessage = `Loaded ${pitcherRatings.length} pitcher and ${hitterRatings.length} hitter ratings from ${this.selectedTeamNickname || teamAbbr}.`;
      }

      this.dismissScoutingOverlay();
      this.messageModal.show('Scouting Loaded', resultMessage);

      window.dispatchEvent(new CustomEvent('scoutingDataUpdated', { detail: { source: 'my' } }));
      this.refreshExistingDataList();
    } catch (err) {
      console.error('Team scouting fetch failed:', err);
      this.dismissScoutingOverlay();
      this.messageModal.show('Fetch Failed', `Could not load scouting data. Check your passphrase and try again.\n\n${err}`);
    } finally {
      if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = 'Fetch Scouting'; }
    }
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
  private scoutingOverlay?: HTMLElement;
  private scoutingClickBlocker?: (e: MouseEvent) => void;

  private showScoutingOverlay(): void {
    const overlay = document.createElement('div');
    overlay.id = 'scouting-fullscreen-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      z-index: 1200;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    `;
    overlay.innerHTML = `
      <div style="
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 2rem 2.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.25rem;
        box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        min-width: 320px;
        max-width: 90vw;
        text-align: center;
      ">
        <div class="scouting-spinner" style="
          width: 40px; height: 40px;
          border: 3px solid var(--color-border);
          border-top-color: var(--color-primary);
          border-radius: 50%;
          animation: scouting-spin 0.8s linear infinite;
        "></div>
        <div id="scouting-overlay-status" style="font-size: 0.95rem; color: var(--color-text); font-weight: 500;"></div>
        <div id="scouting-overlay-detail" style="font-size: 0.82rem; color: var(--color-text-muted);"></div>
      </div>
      <style>
        @keyframes scouting-spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
    document.body.appendChild(overlay);
    this.scoutingOverlay = overlay;

    const clickBlocker = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', clickBlocker, true);
    this.scoutingClickBlocker = clickBlocker;
  }

  private updateScoutingOverlay(status: string, detail?: string): void {
    if (!this.scoutingOverlay) return;
    const statusEl = this.scoutingOverlay.querySelector<HTMLElement>('#scouting-overlay-status');
    const detailEl = this.scoutingOverlay.querySelector<HTMLElement>('#scouting-overlay-detail');
    if (statusEl) statusEl.textContent = status;
    if (detailEl) detailEl.textContent = detail ?? '';
  }

  private dismissScoutingOverlay(): void {
    if (this.scoutingClickBlocker) {
      document.removeEventListener('click', this.scoutingClickBlocker, true);
      this.scoutingClickBlocker = undefined;
    }
    if (this.scoutingOverlay) {
      this.scoutingOverlay.remove();
      this.scoutingOverlay = undefined;
    }
  }



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