import './styles.css';
import { Player } from './models';
import { PlayerController } from './controllers';
import { SearchView, PlayerListView, StatsView, LoadingView, ErrorView, PotentialStatsView, DraftBoardView, TrueRatingsView, RatingEstimatorView } from './views';

class App {
  private controller: PlayerController;
  private searchView!: SearchView;
  private playerListView!: PlayerListView;
  private statsView!: StatsView;
  private loadingView!: LoadingView;
  private errorView!: ErrorView;
  private activeTabId = 'tab-search';

  private selectedYear?: number;

  constructor() {
    this.controller = new PlayerController();
    this.initializeDOM();
    this.initializeViews();
    this.setupTabs();
    this.bindController();
    this.preloadPlayers();
  }

  private initializeDOM(): void {
    const app = document.querySelector<HTMLDivElement>('#app');
    if (!app) throw new Error('App container not found');

    app.innerHTML = `
      <header class="app-header">
        <h1 class="app-title">WBL Stats</h1>
        <p class="app-subtitle">World Baseball League Player Statistics</p>
      </header>

      <nav class="tabs">
        <button class="tab-button active" data-tab-target="tab-search">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Player Search</span>
        </button>
        <button class="tab-button" data-tab-target="tab-potential">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span>Stat Calculator</span>
        </button>
        <button class="tab-button" data-tab-target="tab-estimator">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M21.25 12a9.25 9.25 0 1 1-18.5 0 9.25 9.25 0 0 1 18.5 0Z"/><path d="M6 12h12"/></svg>
            <span>Rating Estimator</span>
        </button>
        <button class="tab-button" data-tab-target="tab-draft">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
          <span>Draft Board</span>
        </button>
        <button class="tab-button" data-tab-target="tab-true-ratings">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg>
          <span>True Ratings</span>
        </button>
      </nav>

      <div class="tab-panels">
        <section id="tab-search" class="tab-panel active">
          <div id="error-container"></div>
          <div id="search-container"></div>
          <div id="player-list-container"></div>
          <div id="stats-container"></div>
        </section>

        <section id="tab-potential" class="tab-panel">
          <div id="potential-stats-container"></div>
        </section>

        <section id="tab-estimator" class="tab-panel">
          <div id="rating-estimator-container"></div>
        </section>

        <section id="tab-draft" class="tab-panel">
          <div id="draft-board-container"></div>
        </section>

        <section id="tab-true-ratings" class="tab-panel">
          <div id="true-ratings-container"></div>
        </section>
      </div>
      <div id="loading-container"></div>
    `;
  }

  private initializeViews(): void {
    const searchContainer = document.querySelector<HTMLElement>('#search-container')!;
    const playerListContainer = document.querySelector<HTMLElement>('#player-list-container')!;
    const statsContainer = document.querySelector<HTMLElement>('#stats-container')!;
    const potentialStatsContainer = document.querySelector<HTMLElement>('#potential-stats-container')!;
    const ratingEstimatorContainer = document.querySelector<HTMLElement>('#rating-estimator-container')!;
    const draftBoardContainer = document.querySelector<HTMLElement>('#draft-board-container')!;
    const trueRatingsContainer = document.querySelector<HTMLElement>('#true-ratings-container')!;
    const loadingContainer = document.querySelector<HTMLElement>('#loading-container')!;
    const errorContainer = document.querySelector<HTMLElement>('#error-container')!;

    this.searchView = new SearchView(searchContainer, {
      onSearch: (query, year) => this.handleSearch(query, year),
      years: { start: 2000, end: 2022 },
    });

    this.playerListView = new PlayerListView(playerListContainer, {
      onPlayerSelect: (player) => this.handlePlayerSelect(player),
    });

    this.statsView = new StatsView(statsContainer);
    new PotentialStatsView(potentialStatsContainer);
    new RatingEstimatorView(ratingEstimatorContainer);
    new DraftBoardView(draftBoardContainer);
    new TrueRatingsView(trueRatingsContainer);
    this.loadingView = new LoadingView(loadingContainer);
    this.errorView = new ErrorView(errorContainer);
  }

  private setupTabs(): void {
    const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-target]');
    tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.dataset.tabTarget;
        if (target) {
          this.setActiveTab(target);
        }
      });
    });
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

    if (tabId === 'tab-search') {
      this.searchView.focus();
    }
  }

  private bindController(): void {
    this.controller.setCallbacks({
      onSearch: (result) => {
        this.playerListView.render(result.players, result.query);
        // Clear stats when new search is performed
        this.statsView.clear();
      },
      onStats: (result) => {
        this.statsView.render(
          result.player,
          result.pitchingStats,
          result.battingStats,
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

  private handleSearch(query: string, year?: number): void {
    this.selectedYear = year;
    this.controller.searchPlayers(query);
  }

  private handlePlayerSelect(player: Player): void {
    this.controller.getPlayerStats(player.id, this.selectedYear);
  }

  private preloadPlayers(): void {
    // Preload player list in background for faster searches
    this.controller.preloadPlayers();
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
