import './styles.css';
import { Player } from './models';
import { PlayerController } from './controllers';
import { teamService } from './services/TeamService';
import { dateService } from './services/DateService';
import { supabaseDataService } from './services/SupabaseDataService';
import { indexedDBService } from './services/IndexedDBService';
// Core views loaded eagerly (needed for initial render + shell)
import { SearchView } from './views/SearchView';
import { PlayerListView } from './views/PlayerListView';
import { LoadingView } from './views/LoadingView';
import { ErrorView } from './views/ErrorView';
import { GlobalSearchBar } from './views/GlobalSearchBar';
import { TrueRatingsView } from './views/TrueRatingsView';
// Heavy views loaded lazily via dynamic import() in switchTabDom/initializeViews
import type { ProjectionsView } from './views/ProjectionsView';
import type { TeamRatingsView } from './views/TeamRatingsView';
import type { TeamPlanningView } from './views/TeamPlanningView';
import type { TradeAnalyzerView } from './views/TradeAnalyzerView';
import type { ParksView } from './views/ParksView';

import { analyticsService } from './services/AnalyticsService';
import { setApiCallTracker, setSupabaseMode } from './services/ApiClient';
import { renderDataSourceBadges, SeasonDataMode, ScoutingDataMode } from './utils/dataSourceBadges';
import { scoutingDataService } from './services/ScoutingDataService';
import { hitterScoutingDataService } from './services/HitterScoutingDataService';
import { initRouter, getRouter } from './router';
import { batterProfileModal } from './views/BatterProfileModal';
import { pitcherProfileModal } from './views/PitcherProfileModal';
import { scoutingLoginModal } from './views/ScoutingLoginModal';
import { updateSnapshotBanner, setSnapshotModeWithBanner } from './utils/snapshotBanner';

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
  private parksView?: ParksView;
  private projectionsContainer!: HTMLElement;
  private teamRatingsContainer!: HTMLElement;
  private teamPlanningContainer!: HTMLElement;
  private tradeAnalyzerContainer!: HTMLElement;
  private parksContainer!: HTMLElement;

  private selectedYear?: number;
  private isGlobalSearchActive = false;
  private pendingPlayerId?: number;
  private lazyContainers!: Record<string, HTMLElement>;
  private lazyViewsInitialized = new Set<string>();

  private readonly TAB_PREF_KEY = 'wbl-active-tab';

  constructor(isFirstTime: boolean = false) {
    this.controller = new PlayerController();

    // Initialize router — URL is the source of truth for initial tab
    initRouter((tabId, params, playerId) => this.onRouterNavigate(tabId, params, playerId));

    if (isFirstTime) {
      console.log('🎬 Showing About page for onboarding');
      this.activeTabId = 'tab-about';
    } else {
      // Resolve initial tab from URL, falling back to localStorage
      const initial = getRouter().resolveInitialTab();
      this.activeTabId = initial.tabId === 'tab-about'
        ? (localStorage.getItem(this.TAB_PREF_KEY) ?? 'tab-about')
        : initial.tabId;
      this.pendingPlayerId = initial.playerId;
    }

    this.initializeDOM();
    this.initializeViews();
    this.setupRateLimitHandling();
    this.setupTabs();
    this.setupHeaderBadges();
    this.bindController();
    this.preloadPlayers();

    analyticsService.trackAppOpen();

    // Restore snapshot mode from localStorage (e.g., "Opening Day" toggle)
    try {
      const savedSnapshot = localStorage.getItem('wbl-snapshot-mode');
      if (savedSnapshot) {
        supabaseDataService.setSnapshotMode(savedSnapshot);
        updateSnapshotBanner();
      }
    } catch { /* ignore */ }

    if (isFirstTime) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('wbl:first-time-onboarding'));
      }, 100);
    }

    if (!isFirstTime) {
      // Open player modal if URL was /player/:id or ?player=ID
      if (this.pendingPlayerId) {
        this.handlePlayerDeepLink(this.pendingPlayerId);
      }
      // Set the initial URL only if user arrived at bare domain with a localStorage-restored tab
      // (don't overwrite URL params from direct navigation like /farm_rankings?view=top-100)
      if (window.location.pathname === '/' && !window.location.search) {
        getRouter().navigate(this.activeTabId);
      }

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

  private async handlePlayerDeepLink(playerId: number): Promise<void> {
    // Try fast path first (pre-computed ratings from Supabase → instant modal)
    // Opens modal on top of the current tab — no need to switch to True Ratings
    if (supabaseDataService.isConfigured) {
      const fast = await this.trueRatingsView.openPlayerDeepLinkFast(playerId);
      if (fast) return;
    }

    // Fallback: need True Ratings view for full data load + modal
    this.switchTabDom('tab-true-ratings');
    this.trueRatingsView.openPlayerDeepLink(playerId);
  }

  /** Router popstate/navigation callback — called when URL changes via back/forward. */
  private onRouterNavigate(tabId: string, params: URLSearchParams, playerId?: number): void {
    if (playerId) {
      this.handlePlayerDeepLink(playerId);
      return;
    }
    // Close any open modals when navigating back from /player/:id
    batterProfileModal.hide();
    pitcherProfileModal.hide();
    this.switchTabDom(tabId);
    this.applyViewParams(tabId, params);
  }

  /** Forward URL query params to the active view's applyUrlParams if it supports it. */
  private applyViewParams(tabId: string, params: URLSearchParams): void {
    if (params.toString() === '') return;
    if (tabId === 'tab-team-ratings' && this.teamRatingsView) {
      this.teamRatingsView.applyUrlParams(params);
    }
    if (tabId === 'tab-parks' && this.parksView) {
      const teamId = params.get('team');
      if (teamId) this.parksView.selectTeam(parseInt(teamId, 10));
    }
  }

  /** Switch tab DOM without pushing a URL (used by router callback and deep links). */
  private switchTabDom(tabId: string): void {
    if (this.activeTabId === tabId) return;
    this.activeTabId = tabId;
    localStorage.setItem(this.TAB_PREF_KEY, tabId);

    const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
    const tabPanels = document.querySelectorAll<HTMLElement>('.tab-panel');
    tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tabTarget === tabId));
    tabPanels.forEach(p => p.classList.toggle('active', p.id === tabId));

    // Lazy init views on tab activation
    if (tabId === 'tab-true-ratings') this.trueRatingsView.syncTeamSelection();
    if (tabId === 'tab-trade-analyzer' && this.tradeAnalyzerView) this.tradeAnalyzerView.syncTeamSelection();
    this.ensureViewLoaded(tabId);

    const badgeSlot = document.getElementById('header-data-source-badges');
    if (badgeSlot) {
      if (App.TABS_WITHOUT_BADGES.has(tabId)) badgeSlot.style.display = 'none';
      else window.dispatchEvent(new CustomEvent('wbl:request-data-source-badges'));
    }
  }

  /** Dynamically import and initialize a view if not already loaded. */
  private async ensureViewLoaded(tabId: string): Promise<void> {
    if (this.lazyViewsInitialized.has(tabId)) return;
    this.lazyViewsInitialized.add(tabId);

    switch (tabId) {
      case 'tab-projections':
        if (!this.projectionsView) {
          const { ProjectionsView } = await import('./views/ProjectionsView');
          this.projectionsView = new ProjectionsView(this.projectionsContainer);
        }
        break;
      case 'tab-team-ratings':
        if (!this.teamRatingsView) {
          const { TeamRatingsView } = await import('./views/TeamRatingsView');
          this.teamRatingsView = new TeamRatingsView(this.teamRatingsContainer);
        }
        break;
      case 'tab-team-planning':
        if (!this.teamPlanningView) {
          const { TeamPlanningView } = await import('./views/TeamPlanningView');
          this.teamPlanningView = new TeamPlanningView(this.teamPlanningContainer);
        }
        break;
      case 'tab-trade-analyzer':
        if (!this.tradeAnalyzerView) {
          const { TradeAnalyzerView } = await import('./views/TradeAnalyzerView');
          this.tradeAnalyzerView = new TradeAnalyzerView(this.tradeAnalyzerContainer);
        }
        break;
      case 'tab-parks':
        if (!this.parksView) {
          const { ParksView } = await import('./views/ParksView');
          this.parksView = new ParksView(this.parksContainer);
        }
        break;
      case 'tab-calculators':
        if (this.lazyContainers.calculators) {
          const { CalculatorsView } = await import('./views/CalculatorsView');
          new CalculatorsView(this.lazyContainers.calculators);
        }
        break;
      case 'tab-draft':
        if (this.lazyContainers.draftBoard) {
          const { DraftBoardView } = await import('./views/DraftBoardView');
          new DraftBoardView(this.lazyContainers.draftBoard);
        }
        break;
      case 'tab-farm-rankings':
        if (this.lazyContainers.farmRankings) {
          const { FarmRankingsView } = await import('./views/FarmRankingsView');
          new FarmRankingsView(this.lazyContainers.farmRankings);
        }
        break;
      case 'tab-data-management':
        if (this.lazyContainers.dataManagement) {
          const { DataManagementView } = await import('./views/DataManagementView');
          new DataManagementView(this.lazyContainers.dataManagement);
        }
        break;
      case 'tab-about':
        if (this.lazyContainers.about) {
          const { AboutView } = await import('./views/AboutView');
          new AboutView(this.lazyContainers.about);
        }
        break;
    }
  }

  /** Initialize secondary views after first paint to keep initial load fast. */
  private initDeferredViews(): void {
    // Pre-warm views the user is likely to visit (but not the active one — already loaded)
    // Draft board is hidden (double-tap D) — don't pre-warm it, it triggers heavy data loads
    const deferredTabs = ['tab-farm-rankings', 'tab-about'];
    for (const tabId of deferredTabs) {
      if (tabId !== this.activeTabId) {
        this.ensureViewLoaded(tabId);
      }
    }
  }

  /**
   * Initialize the app asynchronously
   */
  /** App data version — bump this to force a full cache/DB bust for all users. */
  private static readonly APP_DATA_VERSION = '2.0';

  static async init(): Promise<App> {
    // Full cache bust: if stored version doesn't match, wipe IndexedDB + wbl-* localStorage
    const DATA_VERSION_KEY = 'wbl-data-version';
    const storedVersion = localStorage.getItem(DATA_VERSION_KEY);
    if (storedVersion !== App.APP_DATA_VERSION) {
      console.log(`🔄 Data version mismatch (${storedVersion} → ${App.APP_DATA_VERSION}) — clearing all cached data`);
      // Delete IndexedDB entirely
      try {
        indexedDB.deleteDatabase('wbl_stats_db');
      } catch { /* ignore */ }
      // Clear all wbl-* localStorage keys (preserves non-app keys)
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('wbl-')) keysToRemove.push(key);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      // Set new version so this only runs once
      localStorage.setItem(DATA_VERSION_KEY, App.APP_DATA_VERSION);
      console.log(`✅ Cache bust complete — cleared ${keysToRemove.length} localStorage keys + IndexedDB`);
    }

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

    // Check if this is first-time user — fast path uses localStorage flag to skip Supabase query
    const isFirstTime = await App.checkIsFirstTimeUser();

    // Create the app instance FIRST so the shell renders immediately (LCP)
    const app = new App(isFirstTime);

    // Then do heavy async work in the background (custom scouting detection + cache warming)
    // The hasCustomScouting flag is already restored from localStorage by SupabaseDataService
    // constructor, so views render correctly. This just validates and warms caches.
    if (supabaseDataService.isConfigured) {
      App.warmCustomScoutingCaches().catch(err =>
        console.warn('Failed to check for custom scouting:', err)
      );
    }

    return app;
  }

  /** Validate custom scouting flag against IndexedDB and warm TR caches. Runs after first paint. */
  private static async warmCustomScoutingCaches(): Promise<void> {
    const [myScouting, myHitterScouting] = await Promise.all([
      scoutingDataService.getLatestScoutingRatings('my'),
      hitterScoutingDataService.getLatestScoutingRatings('my'),
    ]);
    const hasIdbData = myScouting.length > 0 || myHitterScouting.length > 0;
    console.log(`🔍 Custom scouting check: localStorage=${supabaseDataService.hasCustomScouting}, IndexedDB=${hasIdbData} (${myScouting.length} pitcher, ${myHitterScouting.length} hitter)`);
    if (hasIdbData || supabaseDataService.hasCustomScouting) {
      supabaseDataService.hasCustomScouting = true;
      // Merge custom fielding ratings into position ratings cache
      if (myHitterScouting.length > 0) {
        supabaseDataService.mergeCustomPositionRatings(myHitterScouting);
      }
      console.log('🎯 Custom scouting detected — will recompute TR/TFR locally');
      const year = await dateService.getCurrentYear();
      const { trueRatingsService } = await import('./services/TrueRatingsService');
      await trueRatingsService.warmCachesForComputation(year);
      console.log('🔥 Caches warmed for custom scouting computation');
    }
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

  // Tab preference now resolved from URL via router.resolveInitialTab(),
  // falling back to localStorage for bare-domain visits.

  private initializeDOM(): void {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (!app) throw new Error('App container not found');
    const logoUrl = new URL('./images/logo-120.jpg', import.meta.url).href;

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
          <div class="header-badges-row">
            <div id="header-data-source-badges"></div>
            <div id="scouting-login-badge"></div>
          </div>
          <span class="game-date-inline"><span class="game-date-label">Game Date</span> <span class="game-date-value" id="game-date">Loading...</span></span>
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
        <button class="tab-button ${this.activeTabId === 'tab-parks' ? 'active' : ''}" data-tab-target="tab-parks">
          <span style="font-size:1.1rem; line-height:1;">🏟️</span>
          <span>Parks</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-calculators' ? 'active' : ''}" data-tab-target="tab-calculators">
          <span style="font-size:1.1rem; line-height:1;">🔢</span>
          <span>Rating Calculators</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-data-management' ? 'active' : ''}" data-tab-target="tab-data-management" style="display:none;">
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

        <section id="tab-parks" class="tab-panel ${this.activeTabId === 'tab-parks' ? 'active' : ''}">
          <div id="parks-container"></div>
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
    const parksContainer = document.querySelector<HTMLElement>('#parks-container')!;
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

    this.trueRatingsView = new TrueRatingsView(trueRatingsContainer);
    this.projectionsContainer = projectionsContainer;
    this.teamRatingsContainer = teamRatingsContainer;
    this.teamPlanningContainer = teamPlanningContainer;
    this.tradeAnalyzerContainer = tradeAnalyzerContainer;
    this.parksContainer = parksContainer;
    this.loadingView = new LoadingView(loadingContainer);
    this.errorView = new ErrorView(errorContainer);
    this.rateLimitView = new ErrorView(rateLimitContainer);

    // Lazy-load non-essential views: defer to after first paint or on tab activation
    // Store containers for views that initialize on-demand in switchTabDom()
    this.lazyContainers = {
      calculators: calculatorsContainer,
      draftBoard: draftBoardContainer,
      farmRankings: farmRankingsContainer,
      dataManagement: dataManagementContainer,
      about: document.querySelector<HTMLElement>('#about-container')!,
    };

    // Initialize the active tab's view immediately (if it needs lazy loading)
    // Then apply any URL query params (e.g. /parks?team=1 on fresh load)
    this.ensureViewLoaded(this.activeTabId).then(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.toString()) this.applyViewParams(this.activeTabId, params);
    });

    // Defer non-active secondary views until after first paint
    requestIdleCallback(() => this.initDeferredViews(), { timeout: 3000 });
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
      await this.ensureViewLoaded('tab-trade-analyzer');
      this.setActiveTab('tab-trade-analyzer');
      await this.tradeAnalyzerView!.initWithTrade(myTeamId, targetTeamId, targetPlayerId, targetIsProspect, scrollY, matchPlayerId, matchPlayerIsProspect);
    });

    window.addEventListener('wbl:open-parks', (event) => {
      const { teamId } = (event as CustomEvent<{ teamId: number }>).detail;
      this.setActiveTab('tab-parks');
      getRouter().replace('tab-parks', { team: String(teamId) });
      if (this.parksView) {
        this.parksView.selectTeam(teamId);
      }
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

  private _hasSnapshots = false;
  private _currentSeasonMode: SeasonDataMode = 'preseason-model';
  private _currentScoutingMode: ScoutingDataMode = 'none';

  private setupHeaderBadges(): void {
    // Check for available snapshots
    supabaseDataService.getAvailableSnapshots().then(snaps => {
      this._hasSnapshots = (snaps?.length ?? 0) > 0;
    }).catch(() => {});

    window.addEventListener('wbl:data-source-badges-changed', (event) => {
      const { seasonMode, scoutingMode } = (event as CustomEvent<{ seasonMode: SeasonDataMode; scoutingMode: ScoutingDataMode }>).detail;
      this._currentSeasonMode = seasonMode;
      this._currentScoutingMode = scoutingMode;
      this.renderHeaderBadge();
    });

    // Handle click on the season data chip to toggle snapshot mode
    document.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement).closest('[data-action="toggle-snapshot"]');
      if (!target) return;
      const snapshotMode = supabaseDataService.getSnapshotMode();
      if (snapshotMode) {
        setSnapshotModeWithBanner(null);
      } else {
        supabaseDataService.getAvailableSnapshots().then(snaps => {
          if (snaps && snaps.length > 0) {
            setSnapshotModeWithBanner(snaps[0].id);
          }
        });
      }
    });

    // Re-render badge when snapshot mode changes
    window.addEventListener('wbl:snapshot-mode-changed', () => {
      this.renderHeaderBadge();
    });

    // Scouting login badge
    this.renderScoutingBadge();
    window.addEventListener('wbl:scouting-login-changed', () => this.renderScoutingBadge());
    window.addEventListener('scoutingDataUpdated', () => this.renderScoutingBadge());
  }

  private renderHeaderBadge(): void {
    const slot = document.getElementById('header-data-source-badges');
    if (!slot) return;
    // Override season mode when snapshot is active
    const effectiveMode: SeasonDataMode = supabaseDataService.getSnapshotMode()
      ? 'opening-day-snapshot'
      : this._currentSeasonMode;
    slot.innerHTML = renderDataSourceBadges(effectiveMode, this._currentScoutingMode, this._hasSnapshots);
    slot.style.display = '';
  }

  private renderScoutingBadge(): void {
    const slot = document.getElementById('scouting-login-badge');
    if (!slot) return;
    const isLoggedIn = supabaseDataService.hasCustomScouting;
    if (isLoggedIn) {
      slot.innerHTML = `<span class="data-source-chip data-chip-scout-active" id="scouting-badge-btn" role="button" tabindex="0" title="Using your team's scouting data. Click to re-fetch." style="cursor:pointer;">Scouting: My Scout</span>`;
    } else {
      slot.innerHTML = `<span class="data-source-chip data-chip-scout-osa" id="scouting-badge-btn" role="button" tabindex="0" title="Click to load your team's private scouting" style="cursor:pointer;">Scouting: OSA (login)</span>`;
    }
    slot.querySelector('#scouting-badge-btn')?.addEventListener('click', () => scoutingLoginModal.show());
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
    'tab-parks': 'Parks',
    'tab-search': 'Search',
    'tab-about': 'About',
  };

  private setActiveTab(tabId: string): void {
    if (this.activeTabId === tabId) return;

    analyticsService.trackTabVisit(tabId, App.TAB_NAMES[tabId] ?? tabId);

    // Update DOM and internal state
    this.switchTabDom(tabId);

    // Push URL
    getRouter().navigate(tabId);

    // Scroll the active tab into view in the tab strip (mobile horizontal scroll)
    document.querySelector<HTMLButtonElement>(`[data-tab-target="${tabId}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
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
