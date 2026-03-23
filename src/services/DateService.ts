import { apiFetch } from './ApiClient';

/** @deprecated Use getSeasonProgress() instead — kept for backward compat */
export type SeasonStage = 'early' | 'q1_done' | 'q2_done' | 'q3_done' | 'complete';

/** Season runs roughly Apr 1 – Oct 1 (183 days) */
const SEASON_START_MONTH = 4;
const SEASON_START_DAY = 1;
const SEASON_DAYS = 183;

const DATE_CACHE_KEY = 'wbl-game-date-cache-v2'; // v2: includes season field
const DATE_CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

class DateService {
  private cachedDate: string | null = null;
  private cachedSeason: number | null = null;
  private fetchPromise: Promise<string> | null = null;

  /**
   * Fetch the current game date from the API.
   * Caches in memory for the session lifetime and in localStorage for 60 minutes
   * across page reloads, so the API is hit at most once per hour.
   */
  async getCurrentDate(): Promise<string> {
    // In-memory hit (fastest path)
    if (this.cachedDate) return this.cachedDate;

    // localStorage hit — still fresh?
    try {
      const stored = localStorage.getItem(DATE_CACHE_KEY);
      if (stored) {
        const { date, ts, season } = JSON.parse(stored) as { date: string; ts: number; season?: number };
        if (typeof date === 'string' && Date.now() - ts < DATE_CACHE_TTL_MS) {
          this.cachedDate = date;
          if (season) this.cachedSeason = season;
          return date;
        }
      }
    } catch { /* ignore parse/access errors */ }

    // Deduplicate concurrent in-flight requests
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = this.fetchDate();
    const date = await this.fetchPromise;
    this.cachedDate = date;
    this.fetchPromise = null;

    // Persist with a timestamp so the TTL survives reloads
    try {
      localStorage.setItem(DATE_CACHE_KEY, JSON.stringify({ date, ts: Date.now(), season: this.cachedSeason }));
    } catch { /* storage quota or private-mode — fine, in-memory cache still works */ }

    return date;
  }

  /**
   * Get the current season year.
   * Uses the `season` field from the WBL API (e.g. "2021") rather than the
   * calendar year from the game date (which may be 2022 during offseason).
   * Falls back to the date's year if season wasn't returned.
   */
  async getCurrentYear(): Promise<number> {
    try {
      // Ensure the API has been called so cachedSeason is populated
      const date = await this.getCurrentDate();
      let season = this.cachedSeason ?? parseInt(date.split('-')[0], 10);
      // API season may lag on opening day (date is Apr 2022 but API still says season 2021).
      // If the date's calendar year exceeds the season and it's April+, the new season has started.
      const calendarYear = parseInt(date.split('-')[0], 10);
      const month = parseInt(date.split('-')[1], 10);
      if (calendarYear > season && month >= 4) {
        season = calendarYear;
      }
      return season;
    } catch {
      return new Date().getFullYear();
    }
  }

  /**
   * Get the current stage of the baseball season based on the game date.
   * Season runs Apr 1 - Oct 1, with quarterly thresholds:
   * - early: Apr 1 - May 14 (Q1 in progress)
   * - q1_done: May 15 - Jun 30
   * - q2_done: Jul 1 - Aug 14
   * - q3_done: Aug 15 - Sep 30
   * - complete: Oct 1+
   */
  async getSeasonStage(): Promise<SeasonStage> {
    try {
      const date = await this.getCurrentDate();
      const [, monthStr, dayStr] = date.split('-');
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);

      // Oct 1+ = season complete
      if (month >= 10) return 'complete';
      // Aug 15 - Sep 30 = Q3 done
      if (month > 8 || (month === 8 && day >= 15)) return 'q3_done';
      // Jul 1 - Aug 14 = Q2 done
      if (month >= 7) return 'q2_done';
      // May 15 - Jun 30 = Q1 done
      if (month > 5 || (month === 5 && day >= 15)) return 'q1_done';
      // Apr 1 - May 14 = early season (Q1 in progress)
      return 'early';
    } catch {
      // Fallback to early season if API fails
      return 'early';
    }
  }

  /**
   * Get a continuous 0–1 progress value for how far along the season is.
   * 0.0 = Opening Day (Apr 1), 1.0 = season complete (Oct 1+).
   * Pre-season dates return 0; post-season dates return 1.
   */
  async getSeasonProgress(): Promise<number> {
    try {
      const date = await this.getCurrentDate();
      const [yearStr, monthStr, dayStr] = date.split('-');
      const year = parseInt(yearStr, 10);
      const month = parseInt(monthStr, 10);
      const day = parseInt(dayStr, 10);

      // Offseason (Nov-Mar): the previous season is complete → progress = 1.0.
      // The game date rolls to the next calendar year in Jan (e.g. 2022-01-25
      // for the 2021 season), so "before April" means the completed season's
      // data should get full weight, not zero.
      if (month < SEASON_START_MONTH) return 1.0;

      // Days elapsed since Apr 1 of the game year
      const seasonStart = new Date(year, SEASON_START_MONTH - 1, SEASON_START_DAY);
      const current = new Date(year, month - 1, day);
      const elapsed = (current.getTime() - seasonStart.getTime()) / (1000 * 60 * 60 * 24);

      return Math.max(0, Math.min(1, elapsed / SEASON_DAYS));
    } catch {
      return 0;
    }
  }

  /**
   * Check if a given year is within N years of the current game date.
   */
  async isWithinYears(year: number, withinYears: number): Promise<boolean> {
    const currentYear = await this.getCurrentYear();
    return Math.abs(currentYear - year) <= withinYears;
  }

  private async fetchDate(): Promise<string> {
    // Proxied to https://worldbaseballleague.org/api/date
    const response = await apiFetch('/api/date');
    if (!response.ok) {
      throw new Error(`Failed to fetch date: ${response.status}`);
    }
    const data = await response.json();
    // WBL returns { in_game_date: { date: "2022-01-06" }, season: "2021", ... }
    const date = data.in_game_date.date;
    if (data.season) {
      let season = parseInt(data.season, 10);
      // API season may lag on opening day (date is Apr 2022 but season still says 2021).
      // If the date's calendar year exceeds the reported season, use the calendar year.
      const calendarYear = parseInt(date.split('-')[0], 10);
      if (calendarYear > season) {
        const month = parseInt(date.split('-')[1], 10);
        if (month >= 4) season = calendarYear; // Apr+ means the new season has started
      }
      this.cachedSeason = season;
    }
    return date;
  }

  /**
   * Get the current date, falling back to today's date if the API fails.
   * Used internally when we need a date but don't care if it's the real game date.
   */
  async getCurrentDateWithFallback(): Promise<string> {
    try {
      return await this.getCurrentDate();
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  }

  /**
   * Get the month from the current game date (1-12).
   */
  async getGameMonth(): Promise<number> {
    const date = await this.getCurrentDate();
    return parseInt(date.split('-')[1], 10);
  }

  /**
   * Whether the game is in the offseason (Nov–Mar).
   * Nov-Dec: game year hasn't rolled yet (e.g. 2021-11-xx).
   * Jan-Mar: OOTP rolled to next calendar year (e.g. 2022-01-xx).
   */
  async isOffseason(): Promise<boolean> {
    const month = await this.getGameMonth();
    return month >= 11 || month <= 3;
  }

  /**
   * The year that projections should target.
   * Offseason (Nov-Mar): target next season (currentYear + 1).
   * In-season (Apr-Oct): target is currentYear.
   */
  async getProjectionTargetYear(): Promise<number> {
    const [currentYear, isOff] = await Promise.all([
      this.getCurrentYear(),
      this.isOffseason()
    ]);
    return isOff ? currentYear + 1 : currentYear;
  }

  /**
   * Clear the cached date (useful for testing or forcing a refresh).
   */
  clearCache(): void {
    this.cachedDate = null;
    this.cachedSeason = null;
    this.fetchPromise = null;
    try { localStorage.removeItem(DATE_CACHE_KEY); } catch { /* ignore */ }
  }
}

export const dateService = new DateService();
