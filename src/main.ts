import './styles.css';
import { Player } from './models';
import { PlayerController } from './controllers';
import { teamService } from './services/TeamService';
import { dateService } from './services/DateService';
import { SearchView, PlayerListView, StatsView, LoadingView, ErrorView, DraftBoardView, TrueRatingsView, FarmRankingsView, TeamRatingsView, DataManagementView, CalculatorsView, ProjectionsView } from './views';
import type { SendToEstimatorPayload } from './views/StatsView';

class App {
  private controller: PlayerController;
  private searchView!: SearchView;
  private playerListView!: PlayerListView;
  private statsView!: StatsView;
  private loadingView!: LoadingView;
  private errorView!: ErrorView;
  private activeTabId = 'tab-search';
  private calculatorsView!: CalculatorsView;
  private projectionsView?: ProjectionsView;
  private projectionsContainer!: HTMLElement;

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
        <div class="app-header-date">
          <span class="game-date-label">Game Date</span>
          <span class="game-date-value" id="game-date">Loading...</span>
        </div>
      </header>

      <nav class="tabs">
        <button class="tab-button active" data-tab-target="tab-search">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>Player Search</span>
        </button>
        <button class="tab-button" data-tab-target="tab-calculators">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          <span>Calculators</span>
        </button>
        <button class="tab-button" data-tab-target="tab-true-ratings">
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
        <button class="tab-button" data-tab-target="tab-data-management">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          <span>Data Management</span>
        </button>
      </nav>

      <div class="tab-panels">
        <section id="tab-search" class="tab-panel active">
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

        <section id="tab-true-ratings" class="tab-panel">
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

        <section id="tab-data-management" class="tab-panel">
          <div id="data-management-container"></div>
        </section>
      </div>
      <div id="loading-container"></div>
    `;
  }

  private initializeViews(): void {
    const searchContainer = document.querySelector<HTMLElement>('#search-container')!;
    const playerListContainer = document.querySelector<HTMLElement>('#player-list-container')!;
    const statsContainer = document.querySelector<HTMLElement>('#stats-container')!;
    const calculatorsContainer = document.querySelector<HTMLElement>('#calculators-container')!;
    const draftBoardContainer = document.querySelector<HTMLElement>('#draft-board-container')!;
    const trueRatingsContainer = document.querySelector<HTMLElement>('#true-ratings-container')!;
    const projectionsContainer = document.querySelector<HTMLElement>('#projections-container')!;
    const farmRankingsContainer = document.querySelector<HTMLElement>('#farm-rankings-container')!;
    const teamRatingsContainer = document.querySelector<HTMLElement>('#team-ratings-container')!;
    const dataManagementContainer = document.querySelector<HTMLElement>('#data-management-container')!;
    const loadingContainer = document.querySelector<HTMLElement>('#loading-container')!;
    const errorContainer = document.querySelector<HTMLElement>('#error-container')!;

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
    new TeamRatingsView(teamRatingsContainer);
    new DataManagementView(dataManagementContainer);
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

    if (tabId === 'tab-projections' && !this.projectionsView) {
      this.projectionsView = new ProjectionsView(this.projectionsContainer);
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
