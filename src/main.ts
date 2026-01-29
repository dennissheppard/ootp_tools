import './styles.css';
import { Player } from './models';
import { PlayerController } from './controllers';
import { teamService } from './services/TeamService';
import { dateService } from './services/DateService';
import { SearchView, PlayerListView, StatsView, LoadingView, ErrorView, DraftBoardView, TrueRatingsView, FarmRankingsView, TeamRatingsView, DataManagementView, CalculatorsView, ProjectionsView, GlobalSearchBar, DevTrackerView, TradeAnalyzerView, AboutView } from './views';
import type { SendToEstimatorPayload } from './views/StatsView';

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
  private tradeAnalyzerView?: TradeAnalyzerView;
  private aboutView!: AboutView;
  private projectionsContainer!: HTMLElement;
  private teamRatingsContainer!: HTMLElement;
  private devTrackerContainer!: HTMLElement;
  private tradeAnalyzerContainer!: HTMLElement;

  private selectedYear?: number;
  private isGlobalSearchActive = false;

  constructor() {
    this.controller = new PlayerController();
    this.initializeDOM();
    this.initializeViews();
    this.setupRateLimitHandling();
    this.setupTabs();
    this.bindController();
    this.preloadPlayers();
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
        <button class="tab-button active" data-tab-target="tab-true-ratings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
          <span>True Ratings</span>
        </button>
        <button class="tab-button" data-tab-target="tab-projections">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>
          <span>Projections</span>
        </button>
        <button class="tab-button" data-tab-target="tab-farm-rankings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          <span>Farm Rankings</span>
        </button>
        <button class="tab-button" data-tab-target="tab-team-ratings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span>Team Ratings</span>
        </button>
        <button class="tab-button" data-tab-target="tab-dev-tracker">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M12 2v10l4.5 4.5"/><circle cx="12" cy="12" r="10"/></svg>
          <span>Dev Tracker</span>
        </button>
        <button class="tab-button" data-tab-target="tab-trade-analyzer">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M16 3h5v5"></path><path d="M8 21H3v-5"></path><path d="M21 3l-7.5 7.5"></path><path d="M10.5 13.5L3 21"></path></svg>
          <span>Trade Analyzer</span>
        </button>
        <button class="tab-button" data-tab-target="tab-calculators">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span>Calculators</span>
        </button>
      </nav>

      <div class="tab-panels">
        <section id="tab-search" class="tab-panel">
          <div id="error-container"></div>
          <div id="search-container"></div>
          <div id="player-list-container"></div>
          <div id="stats-container"></div>
        </section>

        <section id="tab-calculators" class="tab-panel">
          <div id="calculators-container"></div>
        </section>

        <section id="tab-draft" class="tab-panel">
          <div id="draft-board-container"></div>
        </section>

        <section id="tab-true-ratings" class="tab-panel active">
          <div id="true-ratings-container"></div>
        </section>
        
        <section id="tab-projections" class="tab-panel">
          <div id="projections-container"></div>
        </section>

        <section id="tab-farm-rankings" class="tab-panel">
          <div id="farm-rankings-container">Farm Rankings Content Here</div>
        </section>

        <section id="tab-team-ratings" class="tab-panel">
          <div id="team-ratings-container">Team Ratings Content Here</div>
        </section>

        <section id="tab-dev-tracker" class="tab-panel">
          <div id="dev-tracker-container"></div>
        </section>

        <section id="tab-trade-analyzer" class="tab-panel">
          <div id="trade-analyzer-container"></div>
        </section>

        <section id="tab-data-management" class="tab-panel">
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
    this.tradeAnalyzerContainer = tradeAnalyzerContainer;
    new DataManagementView(dataManagementContainer);
    this.loadingView = new LoadingView(loadingContainer);
    this.errorView = new ErrorView(errorContainer);
    this.rateLimitView = new ErrorView(rateLimitContainer);
    this.aboutView = new AboutView();
    this.setupAboutPageTrigger();
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

    // Double-click logo to access Data Management
    const logo = document.querySelector<HTMLImageElement>('.app-logo');
    if (logo) {
      logo.addEventListener('dblclick', () => {
        this.setActiveTab('tab-data-management');
      });
    }
  }

  private setActiveTab(tabId: string): void {
    if (this.activeTabId === tabId) return;
    this.activeTabId = tabId;

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
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
