/**
 * Lightweight analytics service using Supabase REST API (PostgREST).
 * Fire-and-forget — never blocks UI, silently drops events on failure.
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY from env; disables itself if missing.
 */
export class AnalyticsService {
  private supabaseUrl: string;
  private supabaseKey: string;
  /** Whether Supabase is configured at all (controls reads/dashboard) */
  private configured: boolean;
  /** Whether event tracking is active (false on localhost / excluded) */
  private trackingEnabled: boolean;
  private sessionId: string;

  constructor() {
    this.supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL ?? '';
    this.supabaseKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY ?? '';

    this.configured = Boolean(this.supabaseUrl && this.supabaseKey);

    const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    const isExcluded = localStorage.getItem('wbl-analytics-exclude') === '1';
    this.trackingEnabled = this.configured && !isLocalhost && !isExcluded;
    this.sessionId = this.getOrCreateSessionId();

    if (!this.configured) {
      console.log('📊 Analytics disabled (missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY)');
    } else if (!this.trackingEnabled) {
      const reason = isLocalhost ? 'localhost' : 'excluded via localStorage';
      console.log(`📊 Analytics tracking skipped (${reason}) — dashboard still active`);
    }
  }

  private getOrCreateSessionId(): string {
    const key = 'wbl-analytics-session-id';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(key, id);
    }
    return id;
  }

  /**
   * Core tracking method. Fire-and-forget POST to Supabase REST API.
   */
  track(eventType: string, eventData: Record<string, unknown> = {}): void {
    if (!this.trackingEnabled) return;

    const url = `${this.supabaseUrl}/rest/v1/analytics_events`;
    const body = JSON.stringify({
      session_id: this.sessionId,
      event_type: eventType,
      event_data: eventData,
    });

    try {
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Prefer': 'return=minimal',
        },
        body,
      }).catch(() => {
        // Silent failure — never block UI
      });
    } catch {
      // Silent failure
    }
  }

  // --- Convenience methods ---

  trackAppOpen(): void {
    this.track('app_open');
  }

  trackTabVisit(tabId: string, tabName: string): void {
    this.track('tab_visit', { tab_id: tabId, tab_name: tabName });
  }

  trackTeamSelected(team: string, view: string): void {
    this.track('team_selected', { team, view });
  }

  trackPlayerProfileOpened(data: {
    playerId: number;
    playerName: string;
    playerType: 'pitcher' | 'batter';
    team?: string;
    trueRating?: number;
    isProspect?: boolean;
  }): void {
    this.track('player_profile_opened', {
      player_id: data.playerId,
      player_name: data.playerName,
      player_type: data.playerType,
      team: data.team,
      true_rating: data.trueRating,
      is_prospect: data.isProspect,
    });
  }

  trackModeSwitched(mode: string, view: string): void {
    this.track('mode_switched', { mode, view });
  }

  trackYearChanged(year: number, view: string): void {
    this.track('year_changed', { year, view });
  }

  trackSearchPerformed(query: string, resultCount: number): void {
    this.track('search_performed', { query, result_count: resultCount });
  }

  // --- Query methods for dashboard ---

  /**
   * Fetch analytics events from the last N days.
   * Returns raw rows from Supabase.
   */
  async fetchEvents(days: number = 30): Promise<AnalyticsEvent[]> {
    if (!this.configured) return [];

    try {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const sinceStr = since.toISOString();

      const url = `${this.supabaseUrl}/rest/v1/analytics_events?created_at=gte.${sinceStr}&order=created_at.desc&limit=10000`;

      const response = await fetch(url, {
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
        },
      });

      if (!response.ok) return [];
      return await response.json();
    } catch {
      return [];
    }
  }

  get isEnabled(): boolean {
    return this.configured;
  }
}

export interface AnalyticsEvent {
  id: number;
  created_at: string;
  session_id: string;
  event_type: string;
  event_data: Record<string, unknown>;
}

export const analyticsService = new AnalyticsService();
