import './styles.css';
import { Player } from './models';
import { PlayerController } from './controllers';
import { teamService } from './services/TeamService';
import { dateService } from './services/DateService';
import { indexedDBService } from './services/IndexedDBService';
import { SearchView, PlayerListView, StatsView, LoadingView, ErrorView, DraftBoardView, TrueRatingsView, FarmRankingsView, TeamRatingsView, DataManagementView, CalculatorsView, ProjectionsView, GlobalSearchBar, DevTrackerView, TeamPlanningView, TradeAnalyzerView, AboutView } from './views';
import type { SendToEstimatorPayload } from './views/StatsView';
import { analyticsService } from './services/AnalyticsService';

class App {
  private controller: PlayerController;
  private globalSearchBar!: GlobalSearchBar;
  private searchView!: SearchView;
  private playerListView!: PlayerListView;
  private statsView!: StatsView;
  private loadingView!: LoadingView;
  private errorView!: ErrorView;
  private rateLimitView!: ErrorView;
  private activeTabId = 'tab-true-ratings';
  private calculatorsView!: CalculatorsView;
  private projectionsView?: ProjectionsView;
  private teamRatingsView?: TeamRatingsView;
  private devTrackerView?: DevTrackerView;
  private teamPlanningView?: TeamPlanningView;
  private tradeAnalyzerView?: TradeAnalyzerView;
  private aboutView!: AboutView;
  private projectionsContainer!: HTMLElement;
  private teamRatingsContainer!: HTMLElement;
  private devTrackerContainer!: HTMLElement;
  private teamPlanningContainer!: HTMLElement;
  private tradeAnalyzerContainer!: HTMLElement;

  private selectedYear?: number;
  private isGlobalSearchActive = false;

  private readonly TAB_PREF_KEY = 'wbl-active-tab';

  constructor(isFirstTime: boolean = false) {
    this.controller = new PlayerController();

    // If first-time user, navigate to Data Management, otherwise restore tab preference
    if (isFirstTime) {
      console.log('🎬 Navigating to Data Management for onboarding');
      this.activeTabId = 'tab-data-management';
    } else {
      this.restoreTabPreference();
    }

    this.initializeDOM();
    this.initializeViews();
    this.setupRateLimitHandling();
    this.setupTabs();
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

    // Check if this is first-time setup BEFORE creating app instance
    // This ensures we render with the correct initial tab
    const isFirstTime = await App.checkIsFirstTimeUser();

    // Create the app instance with first-time flag
    return new App(isFirstTime);
  }

  /**
   * Check if this is a first-time user (no data in IndexedDB)
   */
  private static async checkIsFirstTimeUser(): Promise<boolean> {
    try {
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
          <img class="app-logo" src="${logoUrl}" alt="World Baseball League logo" />
          <div class="app-header-main">
            <h1 class="app-title">True Ratings</h1>
            <p class="app-subtitle">World Baseball League</p>
          </div>
        </div>
        <div class="app-header-search" id="global-search-container"></div>
        <div class="app-header-date">
          <span class="game-date-label">Game Date</span>
          <span class="game-date-value" id="game-date">Loading...</span>
        </div>
      </header>
      <div id="rate-limit-container"></div>

      <nav class="tabs">
        <button class="tab-button ${this.activeTabId === 'tab-true-ratings' ? 'active' : ''}" data-tab-target="tab-true-ratings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
          <span>True Ratings</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-projections' ? 'active' : ''}" data-tab-target="tab-projections">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
          <span>Player Projections</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-farm-rankings' ? 'active' : ''}" data-tab-target="tab-farm-rankings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          <span>Farm Rankings</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-team-ratings' ? 'active' : ''}" data-tab-target="tab-team-ratings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span>Team Ratings</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-team-planning' ? 'active' : ''}" data-tab-target="tab-team-planning">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Team Planning</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-trade-analyzer' ? 'active' : ''}" data-tab-target="tab-trade-analyzer">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M16 3h5v5"></path><path d="M8 21H3v-5"></path><path d="M21 3l-7.5 7.5"></path><path d="M10.5 13.5L3 21"></path></svg>
          <span>Trade Analyzer</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-calculators' ? 'active' : ''}" data-tab-target="tab-calculators">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span>Rating Calculators</span>
        </button>
        <button class="tab-button ${this.activeTabId === 'tab-data-management' ? 'active' : ''}" data-tab-target="tab-data-management">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <span>Data Management</span>
        </button>
      </nav>

      <div class="tab-panels">
        <section id="tab-search" class="tab-panel ${this.activeTabId === 'tab-search' ? 'active' : ''}">
          <div id="error-container"></div>
          <div id="search-container"></div>
          <div id="player-list-container"></div>
          <div id="stats-container"></div>
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
          <div id="farm-rankings-container">Farm Rankings Content Here</div>
        </section>

        <section id="tab-team-ratings" class="tab-panel ${this.activeTabId === 'tab-team-ratings' ? 'active' : ''}">
          <div id="team-ratings-container">Team Ratings Content Here</div>
        </section>

        <section id="tab-team-planning" class="tab-panel ${this.activeTabId === 'tab-team-planning' ? 'active' : ''}">
          <div id="team-planning-container"></div>
        </section>

        <section id="tab-dev-tracker" class="tab-panel" style="display:none;">
          <div id="dev-tracker-container"></div>
        </section>

        <section id="tab-trade-analyzer" class="tab-panel ${this.activeTabId === 'tab-trade-analyzer' ? 'active' : ''}">
          <div id="trade-analyzer-container"></div>
        </section>

        <section id="tab-data-management" class="tab-panel ${this.activeTabId === 'tab-data-management' ? 'active' : ''}">
          <div id="data-management-container"></div>
        </section>
      </div>
      <div id="loading-container"></div>
    `;
  }

  private initializeViews(): void {
    const globalSearchContainer = document.querySelector<HTMLElement>('#global-search-container')!;
    const searchContainer = document.querySelector<HTMLElement>('#search-container')!;
    const playerListContainer = document.querySelector<HTMLElement>('#player-list-container')!;
    const statsContainer = document.querySelector<HTMLElement>('#stats-container')!;
    const calculatorsContainer = document.querySelector<HTMLElement>('#calculators-container')!;
    const draftBoardContainer = document.querySelector<HTMLElement>('#draft-board-container')!;
    const trueRatingsContainer = document.querySelector<HTMLElement>('#true-ratings-container')!;
    const projectionsContainer = document.querySelector<HTMLElement>('#projections-container')!;
    const farmRankingsContainer = document.querySelector<HTMLElement>('#farm-rankings-container')!;
    const teamRatingsContainer = document.querySelector<HTMLElement>('#team-ratings-container')!;
    const devTrackerContainer = document.querySelector<HTMLElement>('#dev-tracker-container')!;
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

    this.statsView = new StatsView(statsContainer, {
      onSendToEstimator: (payload) => this.handleSendToEstimator(payload),
    });
    this.calculatorsView = new CalculatorsView(calculatorsContainer);
    new DraftBoardView(draftBoardContainer);
    new TrueRatingsView(trueRatingsContainer);
    this.projectionsContainer = projectionsContainer;
    new FarmRankingsView(farmRankingsContainer);
    this.teamRatingsContainer = teamRatingsContainer;
    this.devTrackerContainer = devTrackerContainer;
    this.teamPlanningContainer = teamPlanningContainer;
    this.tradeAnalyzerContainer = tradeAnalyzerContainer;
    new DataManagementView(dataManagementContainer);
    this.loadingView = new LoadingView(loadingContainer);
    this.errorView = new ErrorView(errorContainer);
    this.rateLimitView = new ErrorView(rateLimitContainer);
    this.aboutView = new AboutView();
    this.setupAboutPageTrigger();

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
    if (this.activeTabId === 'tab-dev-tracker') {
      this.devTrackerView = new DevTrackerView(this.devTrackerContainer);
    }
    if (this.activeTabId === 'tab-trade-analyzer') {
      this.tradeAnalyzerView = new TradeAnalyzerView(this.tradeAnalyzerContainer);
    }
  }

  private setupAboutPageTrigger(): void {
    const gameDateElement = document.querySelector<HTMLElement>('#game-date');
    if (gameDateElement) {
      gameDateElement.addEventListener('dblclick', () => {
        this.aboutView.show();
      });
      gameDateElement.style.cursor = 'pointer';
      gameDateElement.title = 'Double-click to view About page';
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

    // Double-click logo to toggle analytics dashboard
    const logo = document.querySelector<HTMLImageElement>('.app-logo');
    if (logo) {
      logo.addEventListener('dblclick', () => {
        this.setActiveTab('tab-data-management');
        window.dispatchEvent(new CustomEvent('wbl:show-analytics'));
      });
    }
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
    'tab-dev-tracker': 'Dev Tracker',
    'tab-search': 'Search',
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

    if (tabId === 'tab-projections' && !this.projectionsView) {
      this.projectionsView = new ProjectionsView(this.projectionsContainer);
    }
    if (tabId === 'tab-team-ratings' && !this.teamRatingsView) {
      this.teamRatingsView = new TeamRatingsView(this.teamRatingsContainer);
    }
    if (tabId === 'tab-team-planning' && !this.teamPlanningView) {
      this.teamPlanningView = new TeamPlanningView(this.teamPlanningContainer);
    }
    if (tabId === 'tab-dev-tracker' && !this.devTrackerView) {
      this.devTrackerView = new DevTrackerView(this.devTrackerContainer);
    }
    if (tabId === 'tab-trade-analyzer' && !this.tradeAnalyzerView) {
      this.tradeAnalyzerView = new TradeAnalyzerView(this.tradeAnalyzerContainer);
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
          // Clear stats when new search is performed
          this.statsView.clear();
        }
      },
      onStats: (result) => {
        this.statsView.render(
          result.player,
          result.pitchingStats,
          result.battingStats,
          result.minorLeagueStats,
          result.year
        );
        // Clear player list after selection
        this.playerListView.clear();
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

  private async handleSendToEstimator(payload: SendToEstimatorPayload): Promise<void> {
    this.setActiveTab('tab-calculators');
    await this.calculatorsView.prefillEstimator({
      ip: payload.ip,
      k9: payload.k9,
      bb9: payload.bb9,
      hr9: payload.hr9,
      year: payload.year,
    });
  }

  private preloadPlayers(): void {
    // Preload player list in background for faster searches
    this.controller.preloadPlayers();
    // Preload team data
    teamService.getAllTeams().catch(err => console.error('Failed to preload teams', err));
    // Preload current game date and display it
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
