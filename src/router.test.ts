import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PATH_TO_TAB, TAB_TO_PATH, HIDDEN_TABS, initRouter, getRouter } from './router';

// ── Route map consistency ──────────────────────────────────────────

describe('Route maps', () => {
  it('every PATH_TO_TAB entry has a reverse in TAB_TO_PATH', () => {
    for (const [path, tabId] of Object.entries(PATH_TO_TAB)) {
      // /about is an alias for / (both map to tab-about), so skip it
      if (path === '/about') continue;
      expect(TAB_TO_PATH[tabId]).toBeDefined();
    }
  });

  it('every TAB_TO_PATH entry has a forward in PATH_TO_TAB', () => {
    for (const [tabId, path] of Object.entries(TAB_TO_PATH)) {
      expect(PATH_TO_TAB[path]).toBe(tabId);
    }
  });

  it('/ maps to tab-about', () => {
    expect(PATH_TO_TAB['/']).toBe('tab-about');
  });

  it('/about also maps to tab-about (alias)', () => {
    expect(PATH_TO_TAB['/about']).toBe('tab-about');
  });

  it('tab-about canonical path is /', () => {
    expect(TAB_TO_PATH['tab-about']).toBe('/');
  });

  it('hidden tabs are tab-draft and tab-search', () => {
    expect(HIDDEN_TABS.has('tab-draft')).toBe(true);
    expect(HIDDEN_TABS.has('tab-search')).toBe(true);
    expect(HIDDEN_TABS.has('tab-true-ratings')).toBe(false);
  });
});

// ── Router class ───────────────────────────────────────────────────

describe('Router', () => {
  let navigateCalls: Array<{ tabId: string; params: URLSearchParams; playerId?: number }>;
  let pushStateSpy: ReturnType<typeof vi.spyOn>;
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    navigateCalls = [];
    // Reset URL to root
    window.history.replaceState({}, '', '/');

    // Init router with tracking callback
    initRouter((tabId, params, playerId) => {
      navigateCalls.push({ tabId, params, playerId });
    });

    // Spy AFTER setup so we only capture test-driven calls
    pushStateSpy = vi.spyOn(window.history, 'pushState');
    replaceStateSpy = vi.spyOn(window.history, 'replaceState');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── resolveInitialTab ──

  describe('resolveInitialTab', () => {
    it('resolves / to tab-about', () => {
      window.history.replaceState({}, '', '/');
      const router = initRouter(() => {});
      expect(router.resolveInitialTab()).toEqual({ tabId: 'tab-about' });
    });

    it('resolves /true_ratings to tab-true-ratings', () => {
      window.history.replaceState({}, '', '/true_ratings');
      const router = initRouter(() => {});
      expect(router.resolveInitialTab()).toEqual({ tabId: 'tab-true-ratings' });
    });

    it('resolves /team_ratings to tab-team-ratings', () => {
      window.history.replaceState({}, '', '/team_ratings');
      const router = initRouter(() => {});
      expect(router.resolveInitialTab()).toEqual({ tabId: 'tab-team-ratings' });
    });

    it('resolves /player/12345 to player deep link', () => {
      window.history.replaceState({}, '', '/player/12345');
      const router = initRouter(() => {});
      const result = router.resolveInitialTab();
      expect(result.playerId).toBe(12345);
    });

    it('resolves legacy ?player=12345 to player deep link', () => {
      window.history.replaceState({}, '', '/?player=12345');
      const router = initRouter(() => {});
      const result = router.resolveInitialTab();
      expect(result.playerId).toBe(12345);
    });

    it('resolves unknown path to tab-about fallback', () => {
      window.history.replaceState({}, '', '/nonexistent');
      const router = initRouter(() => {});
      expect(router.resolveInitialTab()).toEqual({ tabId: 'tab-about' });
    });
  });

  // ── navigate ──

  describe('navigate', () => {
    it('pushes correct URL for known tab', () => {
      const router = getRouter();
      router.navigate('tab-true-ratings');
      expect(pushStateSpy).toHaveBeenCalledWith(
        { tabId: 'tab-true-ratings' }, '', '/true_ratings'
      );
    });

    it('includes query params in URL', () => {
      const router = getRouter();
      router.navigate('tab-team-ratings', { view: 'standings', stats: 'preseason' });
      expect(pushStateSpy).toHaveBeenCalledWith(
        { tabId: 'tab-team-ratings' }, '', '/team_ratings?view=standings&stats=preseason'
      );
    });

    it('does not push URL for hidden tabs', () => {
      const router = getRouter();
      router.navigate('tab-draft');
      expect(pushStateSpy).not.toHaveBeenCalled();
    });

    it('does not push duplicate URL', () => {
      window.history.replaceState({}, '', '/true_ratings');
      const router = getRouter();
      router.navigate('tab-true-ratings');
      expect(pushStateSpy).not.toHaveBeenCalled();
    });

    it('updates currentTabId', () => {
      const router = getRouter();
      router.navigate('tab-farm-rankings');
      expect(router.getCurrentTabId()).toBe('tab-farm-rankings');
    });
  });

  // ── replace ──

  describe('replace', () => {
    it('replaces URL without creating history entry', () => {
      const router = getRouter();
      router.replace('tab-projections', { mode: 'batters' });
      expect(replaceStateSpy).toHaveBeenCalledWith(
        { tabId: 'tab-projections' }, '', '/projections?mode=batters'
      );
      expect(pushStateSpy).not.toHaveBeenCalled();
    });

    it('does not replace URL for hidden tabs', () => {
      const router = getRouter();
      router.replace('tab-search');
      expect(replaceStateSpy).not.toHaveBeenCalled();
    });
  });

  // ── openPlayer / closePlayer ──

  describe('player modal URLs', () => {
    it('openPlayer pushes /player/:id', () => {
      const router = getRouter();
      router.openPlayer(11956);
      expect(pushStateSpy).toHaveBeenCalledWith(
        { playerId: 11956 }, '', '/player/11956'
      );
    });

    it('closePlayer restores tab URL', () => {
      const router = getRouter();
      router.navigate('tab-true-ratings');
      pushStateSpy.mockClear();
      router.openPlayer(11956);
      router.closePlayer();
      expect(replaceStateSpy).toHaveBeenCalledWith(
        { tabId: 'tab-true-ratings' }, '', '/true_ratings'
      );
    });

    it('playerUrl builds absolute URL', () => {
      const router = getRouter();
      expect(router.playerUrl(11956)).toBe(`${window.location.origin}/player/11956`);
    });
  });

  // ── handleLocation ──

  describe('handleLocation', () => {
    it('navigates to correct tab for known path', () => {
      window.history.replaceState({}, '', '/farm_rankings');
      const router = getRouter();
      router.handleLocation();
      expect(navigateCalls).toHaveLength(1);
      expect(navigateCalls[0].tabId).toBe('tab-farm-rankings');
      expect(navigateCalls[0].playerId).toBeUndefined();
    });

    it('extracts player ID from /player/:id path', () => {
      window.history.replaceState({}, '', '/player/99999');
      const router = getRouter();
      router.handleLocation();
      expect(navigateCalls).toHaveLength(1);
      expect(navigateCalls[0].playerId).toBe(99999);
    });

    it('handles legacy ?player=ID by redirecting', () => {
      window.history.replaceState({}, '', '/true_ratings?player=55555');
      const router = getRouter();
      router.handleLocation();
      expect(navigateCalls).toHaveLength(1);
      expect(navigateCalls[0].playerId).toBe(55555);
      // Should have replaced URL to /player/55555
      expect(window.location.pathname).toBe('/player/55555');
    });

    it('falls back to tab-about for unknown path', () => {
      window.history.replaceState({}, '', '/does_not_exist');
      const router = getRouter();
      router.handleLocation();
      expect(navigateCalls).toHaveLength(1);
      expect(navigateCalls[0].tabId).toBe('tab-about');
    });

    it('preserves currentTabId for player routes', () => {
      const router = getRouter();
      router.navigate('tab-team-ratings');
      pushStateSpy.mockClear();
      window.history.replaceState({}, '', '/player/123');
      router.handleLocation();
      // Should NOT change currentTabId — player opens over current tab
      expect(router.getCurrentTabId()).toBe('tab-team-ratings');
    });
  });

  // ── all routes resolve ──

  describe('all routes', () => {
    const allPaths = Object.keys(PATH_TO_TAB);

    it.each(allPaths)('path %s resolves via handleLocation', (path) => {
      window.history.replaceState({}, '', path);
      navigateCalls = [];
      getRouter().handleLocation();
      expect(navigateCalls).toHaveLength(1);
      expect(navigateCalls[0].tabId).toBe(PATH_TO_TAB[path]);
    });
  });
});
