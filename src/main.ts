import './styles.css';
import { Player } from './models';
import { PlayerController } from './controllers';
import { teamService } from './services/TeamService';
import { dateService } from './services/DateService';
import { supabaseDataService } from './services/SupabaseDataService';
import { indexedDBService } from './services/IndexedDBService';
import { SearchView, PlayerListView, LoadingView, ErrorView, DraftBoardView, TrueRatingsView, FarmRankingsView, TeamRatingsView, DataManagementView, CalculatorsView, ProjectionsView, GlobalSearchBar, TeamPlanningView, TradeAnalyzerView, AboutView } from './views';
import { analyticsService } from './services/AnalyticsService';
import { setApiCallTracker, setSupabaseMode } from './services/ApiClient';
import { renderDataSourceBadges, SeasonDataMode, ScoutingDataMode } from './utils/dataSourceBadges';
import { scoutingDataService } from './services/ScoutingDataService';
import { hitterScoutingDataService } from './services/HitterScoutingDataService';

function getDeepLinkPlayerId(): number | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('player');
  if (!raw) return null;
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

setApiCallTracker((endpoint, bytes, status, duration_ms) =>
  analyticsService.trackApiCall(endpoint, bytes, status, duration_ms)
);

class App {
  private controller: PlayerController;
  private globalSearchBar!: GlobalSearchBar;
  private searchView!: SearchView;
  private playerListView!: PlayerListView;
  private loadingView!: LoadingView;
  private errorView!: ErrorView;
  private rateLimitView!: ErrorView;
  private activeTabId = 'tab-about';
  private trueRatingsView!: TrueRatingsView;
  private projectionsView?: ProjectionsView;
  private teamRatingsView?: TeamRatingsView;
  private teamPlanningView?: TeamPlanningView;
  private tradeAnalyzerView?: TradeAnalyzerView;
  private projectionsContainer!: HTMLElement;
  private teamRatingsContainer!: HTMLElement;
  private teamPlanningContainer!: HTMLElement;
  private tradeAnalyzerContainer!: HTMLElement;

  private selectedYear?: number;
  private isGlobalSearchActive = false;

  private readonly TAB_PREF_KEY = 'wbl-active-tab';

  constructor(isFirstTime: boolean = false) {
    this.controller = new PlayerController();

    // If first-time user, show About page as background while onboarding loads
    if (isFirstTime) {
      console.log('🎬 Showing About page for onboarding');
      this.activeTabId = 'tab-about';
    } else {
      this.restoreTabPreference();
    }

    this.initializeDOM();
    this.initializeViews();
    this.setupRateLimitHandling();
    this.setupTabs();
    this.setupHeaderBadges();
    this.bindController();
    this.preloadPlayers();

    analyticsService.trackAppOpen();

    // Trigger onboarding if first-time user
    // This must happen AFTER views are initialized so listeners are ready
    if (isFirstTime) {
      // Use setTimeout to ensure DOM is fully ready
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('wbl:first-time-onboarding'));
      }, 100);
    }

    // Handle ?player=XXXX deep links
    if (!isFirstTime) {
      this.handlePlayerDeepLink();
      // Check if bundled OSA scouting files have been updated (non-blocking).
      // Skip for Supabase users — scouting data lives in the DB, not bundled CSVs.
      if (!supabaseDataService.isConfigured) {
        this.checkBundledOsaFreshness();
      }
    }
  }

  /**
   * Silently check if bundled OSA CSVs have changed and auto-replace cached data.
   * Runs in the background — doesn't block rendering.
   */
  private async checkBundledOsaFreshness(): Promise<void> {
    try {
      const gameDate = await dateService.getCurrentDate();
      const [pitcherUpdated, hitterUpdated] = await Promise.all([
        scoutingDataService.checkAndUpdateBundledOsa(gameDate),
        hitterScoutingDataService.checkAndUpdateBundledOsa(gameDate),
      ]);
      if (pitcherUpdated || hitterUpdated) {
        console.log('🔄 Bundled OSA data updated — notifying views');
        window.dispatchEvent(new CustomEvent('scoutingDataUpdated', {
          detail: { source: 'osa', type: 'bundled-refresh' },
        }));
      }
    } catch (error) {
      console.error('Failed to check bundled OSA freshness:', error);
    }
  }

  private async handlePlayerDeepLink(): Promise<void> {
    const playerId = getDeepLinkPlayerId();
    if (!playerId) return;

    // Try fast path first (pre-computed ratings from Supabase → instant modal)
    // Opens modal on top of the current tab — no need to switch to True Ratings
    if (supabaseDataService.isConfigured) {
      const fast = await this.trueRatingsView.openPlayerDeepLinkFast(playerId);
      if (fast) return;
    }

    // Fallback: need True Ratings view for full data load + modal
    this.activeTabId = 'tab-true-ratings';
    localStorage.setItem(this.TAB_PREF_KEY, 'tab-true-ratings');
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
    const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');
    tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tabTarget === 'tab-true-ratings'));
    tabPanels.forEach(p => p.classList.toggle('active', p.id === 'tab-true-ratings'));

    this.trueRatingsView.openPlayerDeepLink(playerId);
  }

  /**
   * Initialize the app asynchronously
   */
  static async init(): Promise<App> {
    // Initialize IndexedDB FIRST before any data operations
    try {
      await indexedDBService.init();
    } catch (error) {
      console.error('❌ IndexedDB initialization failed:', error);
      // Continue anyway - will fall back to API calls
    }

    // Block StatsPlus API calls when Supabase is the data source
    if (supabaseDataService.isConfigured) {
      setSupabaseMode(true);

      // One-time cleanup: clear stale IndexedDB cache stores now replaced by Supabase.
      // Preserves user data (scouting uploads, dev snapshots, planning overrides).
      const MIGRATION_KEY = 'wbl-supabase-cache-cleared';
      if (!localStorage.getItem(MIGRATION_KEY)) {
        try {
          const cleared = await indexedDBService.clearStaleCacheStores();
          localStorage.setItem(MIGRATION_KEY, new Date().toISOString());
          if (cleared > 0) {
            console.log(`🧹 Cleared ${cleared} stale IndexedDB cache stores (now using Supabase)`);
          }
        } catch (err) {
          console.warn('Failed to clear stale IndexedDB stores:', err);
        }
      }
    }

    // Auto-detect custom scouting for Supabase users (must run before views initialize)
    // Flag is restored from localStorage in SupabaseDataService constructor;
    // we validate against IndexedDB here to warm caches and correct stale flags.
    if (supabaseDataService.isConfigured) {
      try {
        const [myScouting, myHitterScouting] = await Promise.all([
          scoutingDataService.getLatestScoutingRatings('my'),
          hitterScoutingDataService.getLatestScoutingRatings('my'),
        ]);
        const hasIdbData = myScouting.length > 0 || myHitterScouting.length > 0;
        console.log(`🔍 Custom scouting check: localStorage=${supabaseDataService.hasCustomScouting}, IndexedDB=${hasIdbData} (${myScouting.length} pitcher, ${myHitterScouting.length} hitter)`);
        if (hasIdbData || supabaseDataService.hasCustomScouting) {
          supabaseDataService.hasCustomScouting = true;
          console.log('🎯 Custom scouting detected — will recompute TR/TFR locally');
          const year = await dateService.getCurrentYear();
          const { trueRatingsService } = await import('./services/TrueRatingsService');
          await trueRatingsService.warmCachesForComputation(year);
          console.log('🔥 Caches warmed for custom scouting computation');
        }
      } catch (err) {
        console.warn('Failed to check for custom scouting:', err);
      }
    }

    // Check if this is first-time setup BEFORE creating app instance
    // This ensures we render with the correct initial tab
    const isFirstTime = await App.checkIsFirstTimeUser();

    // Create the app instance with first-time flag
    return new App(isFirstTime);
  }

  /**
   * Check if this is a first-time user.
   * With Supabase: check if DB has a current game_date (data already synced).
   * Without Supabase: check if IndexedDB has minor league data (legacy).
   */
  private static async checkIsFirstTimeUser(): Promise<boolean> {
    try {
      if (supabaseDataService.isConfigured) {
        const gameDate = await supabaseDataService.getGameDate();
        if (gameDate) return false; // DB has synced data — not first time
        return true;
      }
      const hasData = await indexedDBService.hasMinorLeagueData();
      if (!hasData) {
        console.log('🎯 First-time user detected');
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error checking for first-time user:', error);
      return false;
    }
  }

  private restoreTabPreference(): void {
    const savedTab = localStorage.getItem(this.TAB_PREF_KEY);
    if (savedTab) {      
        this.activeTabId = savedTab;      
    }
  }

  private initializeDOM(): void {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (!app) throw new Error('App container not found');
    const logoUrl = new URL('./images/logo.jpg', import.meta.url).href;

    app.innerHTML = `
      <header class="app-header">
        <div class="app-header-brand">
          <img class="app-logo" src="${logoUrl}" alt="World Baseball League logo" title="Build ${__APP_VERSION__}" />
          <div class="app-header-main">
            <h1 class="app-title">True Ratings</h1>
            <p class="app-subtitle">World Baseball League</p>
          </div>
        </div>
        <div class="app-header-search" id="global-search-container"></div>
        <div class="app-header-date">
          <span class="game-date-label">Game Date</span>
          <span class="game-date-value" id="game-date">Loading...</span>
          <div id="header-data-source-badges"></div>
        </div>
      </header>
      <div id="rate-limit-container"></div>

      <nav class="tabs">
        <button class="tab-button ${this.activeTabId === 'tab-true-ratings' ? 'active' : ''}" data-tab-target="tab-true-ratings">
          <span style="font-size:1.1rem; line-height:1;">🏆</span>
          <span>True Ratings</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-projections' ? 'active' : ''}" data-tab-target="tab-projections">
          <span style="font-size:1.1rem; line-height:1;">📈</span>
          <span>Player Projections</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-farm-rankings' ? 'active' : ''}" data-tab-target="tab-farm-rankings">
          <span style="font-size:1.1rem; line-height:1;">🌱</span>
          <span>Farm Rankings</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-team-ratings' ? 'active' : ''}" data-tab-target="tab-team-ratings">
          <span style="font-size:1.1rem; line-height:1;">👥</span>
          <span>Team Ratings</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-team-planning' ? 'active' : ''}" data-tab-target="tab-team-planning">
          <span style="font-size:1.1rem; line-height:1;">📅</span>
          <span>Team Planner</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-trade-analyzer' ? 'active' : ''}" data-tab-target="tab-trade-analyzer">
          <span style="font-size:1.1rem; line-height:1;">🔄</span>
          <span>Trade Analyzer</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-calculators' ? 'active' : ''}" data-tab-target="tab-calculators">
          <span style="font-size:1.1rem; line-height:1;">🔢</span>
          <span>Rating Calculators</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-data-management' ? 'active' : ''}" data-tab-target="tab-data-management">
          <span style="font-size:1.1rem; line-height:1;">💾</span>
          <span>Data Management</span>
        </button>
      </nav>

      <div class="tab-panels">
        <section id="tab-search" class="tab-panel ${this.activeTabId === 'tab-search' ? 'active' : ''}">
          <div id="error-container"></div>
          <div id="search-container"></div>
          <div id="player-list-container"></div>
        </section>

        <section id="tab-calculators" class="tab-panel ${this.activeTabId === 'tab-calculators' ? 'active' : ''}">
          <div id="calculators-container"></div>
        </section>

        <section id="tab-draft" class="tab-panel ${this.activeTabId === 'tab-draft' ? 'active' : ''}">
          <div id="draft-board-container"></div>
        </section>

        <section id="tab-true-ratings" class="tab-panel ${this.activeTabId === 'tab-true-ratings' ? 'active' : ''}">
          <div id="true-ratings-container"></div>
        </section>
        
        <section id="tab-projections" class="tab-panel ${this.activeTabId === 'tab-projections' ? 'active' : ''}">
          <div id="projections-container"></div>
        </section>

        <section id="tab-farm-rankings" class="tab-panel ${this.activeTabId === 'tab-farm-rankings' ? 'active' : ''}">
          <div id="farm-rankings-container">Loading...</div>
        </section>

        <section id="tab-team-ratings" class="tab-panel ${this.activeTabId === 'tab-team-ratings' ? 'active' : ''}">
          <div id="team-ratings-container">Loading...</div>
        </section>

        <section id="tab-team-planning" class="tab-panel ${this.activeTabId === 'tab-team-planning' ? 'active' : ''}">
          <div id="team-planning-container"></div>
        </section>

        <section id="tab-trade-analyzer" class="tab-panel ${this.activeTabId === 'tab-trade-analyzer' ? 'active' : ''}">
          <div id="trade-analyzer-container"></div>
        </section>

        <section id="tab-data-management" class="tab-panel ${this.activeTabId === 'tab-data-management' ? 'active' : ''}">
          <div id="data-management-container"></div>
        </section>

        <section id="tab-about" class="tab-panel ${this.activeTabId === 'tab-about' ? 'active' : ''}">
          <div id="about-container"></div>
        </section>
      </div>
      <div id="loading-container"></div>
    `;
  }

  private initializeViews(): void {
    const globalSearchContainer = document.querySelector<HTMLElement>('#global-search-container')!;
    const searchContainer = document.querySelector<HTMLElement>('#search-container')!;
    const playerListContainer = document.querySelector<HTMLElement>('#player-list-container')!;
    const calculatorsContainer = document.querySelector<HTMLElement>('#calculators-container')!;
    const draftBoardContainer = document.querySelector<HTMLElement>('#draft-board-container')!;
    const trueRatingsContainer = document.querySelector<HTMLElement>('#true-ratings-container')!;
    const projectionsContainer = document.querySelector<HTMLElement>('#projections-container')!;
    const farmRankingsContainer = document.querySelector<HTMLElement>('#farm-rankings-container')!;
    const teamRatingsContainer = document.querySelector<HTMLElement>('#team-ratings-container')!;
    const teamPlanningContainer = document.querySelector<HTMLElement>('#team-planning-container')!;
    const tradeAnalyzerContainer = document.querySelector<HTMLElement>('#trade-analyzer-container')!;
    const dataManagementContainer = document.querySelector<HTMLElement>('#data-management-container')!;
    const loadingContainer = document.querySelector<HTMLElement>('#loading-container')!;
    const errorContainer = document.querySelector<HTMLElement>('#error-container')!;
    const rateLimitContainer = document.querySelector<HTMLElement>('#rate-limit-container')!;

    // Initialize global search bar
    this.globalSearchBar = new GlobalSearchBar(globalSearchContainer, {
      onSearch: (query) => this.handleGlobalSearch(query),
      onLoading: (isLoading) => {
        if (isLoading) {
          this.loadingView.show();
        } else {
          this.loadingView.hide();
        }
      },
    });

    this.searchView = new SearchView(searchContainer, {
      onSearch: (query, year) => this.handleSearch(query, year),
      years: { start: 2000, end: 2022 },
    });

    this.playerListView = new PlayerListView(playerListContainer, {
      onPlayerSelect: (player) => this.handlePlayerSelect(player),
    });

    new CalculatorsView(calculatorsContainer);
    new DraftBoardView(draftBoardContainer);
    this.trueRatingsView = new TrueRatingsView(trueRatingsContainer);
    this.projectionsContainer = projectionsContainer;
    new FarmRankingsView(farmRankingsContainer);
    this.teamRatingsContainer = teamRatingsContainer;
    this.teamPlanningContainer = teamPlanningContainer;
    this.tradeAnalyzerContainer = tradeAnalyzerContainer;
    new DataManagementView(dataManagementContainer);
    const aboutContainer = document.querySelector<HTMLElement>('#about-container')!;
    new AboutView(aboutContainer);
    this.loadingView = new LoadingView(loadingContainer);
    this.errorView = new ErrorView(errorContainer);
    this.rateLimitView = new ErrorView(rateLimitContainer);
    // Initialize any views that are for the active tab (if they use lazy loading)
    if (this.activeTabId === 'tab-projections') {
      this.projectionsView = new ProjectionsView(this.projectionsContainer);
    }
    if (this.activeTabId === 'tab-team-ratings') {
      this.teamRatingsView = new TeamRatingsView(this.teamRatingsContainer);
    }
    if (this.activeTabId === 'tab-team-planning') {
      this.teamPlanningView = new TeamPlanningView(this.teamPlanningContainer);
    }
    if (this.activeTabId === 'tab-trade-analyzer') {
      this.tradeAnalyzerView = new TradeAnalyzerView(this.tradeAnalyzerContainer);
    }
  }

  private setupRateLimitHandling(): void {
    window.addEventListener('wbl:rate-limited', (event) => {
      const detail = (event as CustomEvent<{ waitMs: number; attempt: number; maxAttempts: number }>).detail;
      const seconds = Math.max(1, Math.round(detail.waitMs / 1000));
      const attempt = detail.attempt ?? 1;
      const maxAttempts = detail.maxAttempts ?? 1;
      const message = `StatsPlus is grouchy right now. Taking a few breaths (${seconds}s) before retrying... (${attempt}/${maxAttempts})`;
      this.rateLimitView.show(new Error(message));
    });

    window.addEventListener('wbl:rate-limit-clear', () => {
      this.rateLimitView.hide();
    });
  }

  private setupTabs(): void {
    document.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-tab-target]');
      if (!target) return;
      const tabId = target.dataset.tabTarget;
      if (!tabId) return;

      if (target.tagName === 'A') {
        event.preventDefault();
      }
      this.setActiveTab(tabId);
    });

    window.addEventListener('wbl:navigate-tab', (event) => {
      const { tabId } = (event as CustomEvent<{ tabId?: string }>).detail ?? {};
      if (tabId) {
        this.setActiveTab(tabId);
      }
    });

    // Double-tap D to toggle hidden Draft Board tab
    let lastDPress = 0;
    document.addEventListener('keydown', (e) => {
      // Ignore when typing in inputs
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
      if (e.key === 'd' || e.key === 'D') {
        const now = Date.now();
        if (now - lastDPress < 400) {
          this.setActiveTab(this.activeTabId === 'tab-draft' ? 'tab-true-ratings' : 'tab-draft');
          lastDPress = 0;
        } else {
          lastDPress = now;
        }
      }
    });

    window.addEventListener('wbl:open-trade-analyzer', async (event) => {
      const { myTeamId, targetTeamId, targetPlayerId, targetIsProspect, matchPlayerId, matchPlayerIsProspect, scrollY } =
        (event as CustomEvent<{ myTeamId: number; targetTeamId: number; targetPlayerId: number; targetIsProspect: boolean; matchPlayerId?: number; matchPlayerIsProspect: boolean; scrollY: number }>).detail;
      if (!this.tradeAnalyzerView) {
        this.tradeAnalyzerView = new TradeAnalyzerView(this.tradeAnalyzerContainer);
      }
      this.setActiveTab('tab-trade-analyzer');
      await this.tradeAnalyzerView.initWithTrade(myTeamId, targetTeamId, targetPlayerId, targetIsProspect, scrollY, matchPlayerId, matchPlayerIsProspect);
    });

    // Single-click logo → About page; double-click → analytics (localhost only)
    const logo = document.querySelector<HTMLImageElement>('.app-logo');
    if (logo) {
      logo.style.cursor = 'pointer';
      logo.addEventListener('click', () => {
        this.setActiveTab('tab-about');
      });
      logo.addEventListener('dblclick', () => {
        this.setActiveTab('tab-data-management');
        window.dispatchEvent(new CustomEvent('wbl:show-analytics'));
      });
    }
  }

  private static readonly TABS_WITHOUT_BADGES = new Set([
    'tab-calculators', 'tab-data-management', 'tab-search', 'tab-draft', 'tab-about',
  ]);

  private setupHeaderBadges(): void {
    window.addEventListener('wbl:data-source-badges-changed', (event) => {
      const { seasonMode, scoutingMode } = (event as CustomEvent<{ seasonMode: SeasonDataMode; scoutingMode: ScoutingDataMode }>).detail;
      const slot = document.getElementById('header-data-source-badges');
      if (!slot) return;
      slot.innerHTML = renderDataSourceBadges(seasonMode, scoutingMode);
      slot.style.display = '';
    });
  }

  private static readonly TAB_NAMES: Record<string, string> = {
    'tab-true-ratings': 'True Ratings',
    'tab-projections': 'Projections',
    'tab-farm-rankings': 'Farm Rankings',
    'tab-team-ratings': 'Team Ratings',
    'tab-team-planning': 'Team Planning',
    'tab-trade-analyzer': 'Trade Analyzer',
    'tab-calculators': 'Calculators',
    'tab-data-management': 'Data Management',
    'tab-search': 'Search',
    'tab-about': 'About',
  };

  private setActiveTab(tabId: string): void {
    if (this.activeTabId === tabId) return;
    this.activeTabId = tabId;
    localStorage.setItem(this.TAB_PREF_KEY, tabId);

    analyticsService.trackTabVisit(tabId, App.TAB_NAMES[tabId] ?? tabId);

    const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
    const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');

    tabButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.tabTarget === tabId);
    });

    tabPanels.forEach((panel) => {
      panel.classList.toggle('active', panel.id === tabId);
    });

    // Scroll the active tab into view in the tab strip (mobile horizontal scroll)
    document.querySelector<HTMLButtonElement>(`[data-tab-target="${tabId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    if (tabId === 'tab-true-ratings') {
      this.trueRatingsView.syncTeamSelection();
    }
    if (tabId === 'tab-projections' && !this.projectionsView) {
      this.projectionsView = new ProjectionsView(this.projectionsContainer);
    }
    if (tabId === 'tab-team-ratings' && !this.teamRatingsView) {
      this.teamRatingsView = new TeamRatingsView(this.teamRatingsContainer);
    }
    if (tabId === 'tab-team-planning' && !this.teamPlanningView) {
      this.teamPlanningView = new TeamPlanningView(this.teamPlanningContainer);
    }
    if (tabId === 'tab-trade-analyzer') {
      if (!this.tradeAnalyzerView) {
        this.tradeAnalyzerView = new TradeAnalyzerView(this.tradeAnalyzerContainer);
      } else {
        this.tradeAnalyzerView.syncTeamSelection();
      }
    }

    // Update header badges — hide for tabs that don't have badge state, request re-emit for others
    const badgeSlot = document.getElementById('header-data-source-badges');
    if (badgeSlot) {
      if (App.TABS_WITHOUT_BADGES.has(tabId)) {
        badgeSlot.style.display = 'none';
      } else {
        window.dispatchEvent(new CustomEvent('wbl:request-data-source-badges'));
      }
    }
  }

  private bindController(): void {
    this.controller.setCallbacks({
      onSearch: (result) => {
        // Check if this is a global search (no context switches, just update dropdown)
        if (this.isGlobalSearchActive) {
          this.globalSearchBar.renderResults(result.players);
          this.isGlobalSearchActive = false;
        } else {
          // Legacy tab-based search
          this.playerListView.render(result.players, result.query);
        }
      },
      onError: (error) => {
        this.errorView.show(error);
      },
      onLoading: (isLoading) => {
        if (isLoading) {
          this.loadingView.show();
        } else {
          this.loadingView.hide();
        }
        this.searchView.setLoading(isLoading);
      },
    });
  }

  private handleGlobalSearch(query: string): void {
    this.isGlobalSearchActive = true;
    this.controller.searchPlayers(query);
  }

  private handleSearch(query: string, year?: number): void {
    this.selectedYear = year;
    this.controller.searchPlayers(query);
  }

  private handlePlayerSelect(player: Player): void {
    this.controller.getPlayerStats(player.id, this.selectedYear);
  }

  private preloadPlayers(): void {
    // When Supabase is configured, skip eager preloading — data is fetched
    // on-demand from the DB. Eager preloading races with onboarding and
    // can trigger unnecessary StatsPlus API calls.
    if (!supabaseDataService.isConfigured) {
      this.controller.preloadPlayers();
      teamService.getAllTeams().catch(err => console.error('Failed to preload teams', err));
    }
    // Always fetch game date for the header display
    dateService.getCurrentDate()
      .then(date => this.updateGameDateDisplay(date))
      .catch(err => {
        console.error('Failed to fetch game date', err);
        this.updateGameDateDisplay('', true);
      });
  }


  private updateGameDateDisplay(dateStr: string, isError = false): void {
    const dateEl = document.getElementById('game-date');
    if (!dateEl) return;

    if (isError) {
      dateEl.textContent = 'Unavailable';
      dateEl.classList.add('game-date-error');
      return;
    }

    // Format the date nicely (e.g., "Jan 24, 2026")
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      const formatted = date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      dateEl.textContent = formatted;
    } catch {
      dateEl.textContent = dateStr;
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await App.init();
  } catch (err) {
    console.error('❌ Failed to initialize app:', err);
    // Still create app instance even if pre-load fails
    try {
      new App();
    } catch (fallbackErr) {
      console.error('💥 CRITICAL: Failed to create app instance:', fallbackErr);
      // Show a basic error message in the DOM
      const app = document.querySelector('#app');
      if (app) {
        app.innerHTML = `
          <div style="padding: 40px; text-align: center; font-family: sans-serif;">
            <h1 style="color: #dc2626;">Failed to Load Application</h1>
            <p style="color: #666; margin: 20px 0;">Please refresh the page or contact support.</p>
            <pre style="text-align: left; background: #f3f4f6; padding: 20px; border-radius: 8px; overflow-x: auto;">${fallbackErr}</pre>
          </div>
        `;
      }
    }
  }
});
