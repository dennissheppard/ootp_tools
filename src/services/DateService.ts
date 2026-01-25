class DateService {
  private cachedDate: string | null = null;
  private fetchPromise: Promise<string> | null = null;

  /**
   * Fetch the current game date from the API.
   * Caches the result so subsequent calls return immediately.
   */
  async getCurrentDate(): Promise<string> {
    if (this.cachedDate) {
      return this.cachedDate;
    }

    // If a fetch is already in progress, wait for it
    if (this.fetchPromise) {
      return this.fetchPromise;
    }

    this.fetchPromise = this.fetchDate();
    this.cachedDate = await this.fetchPromise;
    this.fetchPromise = null;
    return this.cachedDate;
  }

  /**
   * Get the current game year.
   * Returns the year portion of the current game date.
   * Falls back to current real-world year if API fails.
   */
  async getCurrentYear(): Promise<number> {
    try {
      const date = await this.getCurrentDate();
      return parseInt(date.split('-')[0], 10);
    } catch {
      // Fallback to current year if API fails
      return new Date().getFullYear();
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
    // Proxied to https://atl-01.statsplus.net/world/api/date/
    const response = await fetch('/api/date/');
    if (!response.ok) {
      throw new Error(`Failed to fetch date: ${response.status}`);
    }
    const text = await response.text();
    // Expecting YYYY-MM-DD format
    return text.trim();
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
   * Clear the cached date (useful for testing or forcing a refresh).
   */
  clearCache(): void {
    this.cachedDate = null;
    this.fetchPromise = null;
  }
}

export const dateService = new DateService();
