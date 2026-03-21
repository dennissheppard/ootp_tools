/**
 * Lightweight URL router for the SPA.
 * Maps URL paths to internal tab IDs and manages History API state.
 * Sub-tab state is encoded as query params, not path segments.
 */

// Path → tab ID mapping (exported for testing)
export const PATH_TO_TAB: Record<string, string> = {
  '/':                'tab-about',
  '/true_ratings':    'tab-true-ratings',
  '/projections':     'tab-projections',
  '/farm_rankings':   'tab-farm-rankings',
  '/team_ratings':    'tab-team-ratings',
  '/team_planner':    'tab-team-planning',
  '/trade_analyzer':  'tab-trade-analyzer',
  '/calculators':     'tab-calculators',
  '/data_management': 'tab-data-management',
  '/about':           'tab-about',
  '/parks':           'tab-parks',
};

// Tab ID → path (reverse mapping, canonical paths only; exported for testing)
export const TAB_TO_PATH: Record<string, string> = {
  'tab-about':           '/',
  'tab-true-ratings':    '/true_ratings',
  'tab-projections':     '/projections',
  'tab-farm-rankings':   '/farm_rankings',
  'tab-team-ratings':    '/team_ratings',
  'tab-team-planning':   '/team_planner',
  'tab-trade-analyzer':  '/trade_analyzer',
  'tab-calculators':     '/calculators',
  'tab-data-management': '/data_management',
  'tab-parks':           '/parks',
};

// Tabs that should NOT push URLs (hidden/secret tabs)
export const HIDDEN_TABS = new Set(['tab-draft', 'tab-search']);

export type NavigateCallback = (tabId: string, params: URLSearchParams, playerId?: number) => void;

class Router {
  private currentTabId = 'tab-about';
  private onNavigate: NavigateCallback;
  private suppressPopstate = false;

  constructor(onNavigate: NavigateCallback) {
    this.onNavigate = onNavigate;
    window.addEventListener('popstate', () => {
      if (this.suppressPopstate) { this.suppressPopstate = false; return; }
      this.handleLocation();
    });
  }

  /** Parse current URL and invoke the navigation callback. */
  handleLocation(): void {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    // Legacy ?player=ID redirect → /player/ID
    const legacyPlayer = params.get('player');
    if (legacyPlayer) {
      const id = parseInt(legacyPlayer, 10);
      if (Number.isFinite(id) && id > 0) {
        history.replaceState({}, '', `/player/${id}`);
        this.onNavigate(this.currentTabId, new URLSearchParams(), id);
        return;
      }
    }

    // /player/:id pattern
    const playerMatch = path.match(/^\/player\/(\d+)$/);
    if (playerMatch) {
      const playerId = parseInt(playerMatch[1], 10);
      this.onNavigate(this.currentTabId, params, playerId);
      return;
    }

    // Exact route match
    const tabId = PATH_TO_TAB[path];
    if (tabId) {
      this.currentTabId = tabId;
      this.onNavigate(tabId, params);
      return;
    }

    // Fallback → landing page
    this.currentTabId = 'tab-about';
    this.onNavigate('tab-about', params);
  }

  /** Push a new URL when the user switches tabs. */
  navigate(tabId: string, queryParams?: Record<string, string>): void {
    if (HIDDEN_TABS.has(tabId)) return;
    this.currentTabId = tabId;
    const newUrl = this.buildUrl(tabId, queryParams);
    if (newUrl !== window.location.pathname + window.location.search) {
      history.pushState({ tabId }, '', newUrl);
    }
  }

  /** Replace the current URL for sub-state changes (no new history entry). */
  replace(tabId: string, queryParams?: Record<string, string>): void {
    if (HIDDEN_TABS.has(tabId)) return;
    this.currentTabId = tabId;
    const newUrl = this.buildUrl(tabId, queryParams);
    history.replaceState({ tabId }, '', newUrl);
  }

  /** Push /player/:id URL for modal open. */
  openPlayer(playerId: number): void {
    history.pushState({ playerId }, '', `/player/${playerId}`);
  }

  /** Restore the tab URL when a modal is closed. */
  closePlayer(): void {
    const newUrl = this.buildUrl(this.currentTabId);
    history.replaceState({ tabId: this.currentTabId }, '', newUrl);
  }

  /** Build a shareable player URL. */
  playerUrl(playerId: number): string {
    return `${window.location.origin}/player/${playerId}`;
  }

  getCurrentTabId(): string { return this.currentTabId; }

  /** Resolve the initial tab from the URL without triggering navigation. */
  resolveInitialTab(): { tabId: string; playerId?: number } {
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    // Legacy ?player=ID
    const legacyPlayer = params.get('player');
    if (legacyPlayer) {
      const id = parseInt(legacyPlayer, 10);
      if (Number.isFinite(id) && id > 0) return { tabId: this.currentTabId, playerId: id };
    }

    // /player/:id
    const playerMatch = path.match(/^\/player\/(\d+)$/);
    if (playerMatch) return { tabId: this.currentTabId, playerId: parseInt(playerMatch[1], 10) };

    // Exact route
    const tabId = PATH_TO_TAB[path];
    if (tabId) { this.currentTabId = tabId; return { tabId }; }

    // Fallback: check localStorage for returning users hitting bare domain
    return { tabId: 'tab-about' };
  }

  private buildUrl(tabId: string, queryParams?: Record<string, string>): string {
    const basePath = TAB_TO_PATH[tabId] ?? '/';
    if (!queryParams || Object.keys(queryParams).length === 0) return basePath;
    return basePath + '?' + new URLSearchParams(queryParams).toString();
  }
}

// Singleton
let instance: Router | null = null;

export function initRouter(onNavigate: NavigateCallback): Router {
  instance = new Router(onNavigate);
  return instance;
}

export function getRouter(): Router {
  if (!instance) throw new Error('Router not initialized');
  return instance;
}
