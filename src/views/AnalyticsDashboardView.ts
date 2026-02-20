import ApexCharts from 'apexcharts';
import { analyticsService, AnalyticsEvent } from '../services/AnalyticsService';

export class AnalyticsDashboardView {
  private container: HTMLElement;
  private dailyChart: ApexCharts | null = null;
  private tabChart: ApexCharts | null = null;
  private teamChart: ApexCharts | null = null;
  private apiCallsChart: ApexCharts | null = null;
  private apiPeriod: 'day' | 'week' | 'month' = 'day';
  private cachedApiEvents: AnalyticsEvent[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.render();
    this.loadData();
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="analytics-dashboard">
        <h3 class="form-title">Usage Analytics</h3>
        <div id="analytics-loading" style="text-align: center; padding: 1rem; color: var(--color-text-muted);">
          Loading analytics data...
        </div>
        <div id="analytics-content" style="display: none;">
          <div class="analytics-cards" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
            <div class="analytics-card">
              <div class="analytics-card-value" id="stat-sessions">-</div>
              <div class="analytics-card-label">Sessions (7d)</div>
            </div>
            <div class="analytics-card">
              <div class="analytics-card-value" id="stat-events">-</div>
              <div class="analytics-card-label">Events (7d)</div>
            </div>
            <div class="analytics-card">
              <div class="analytics-card-value" id="stat-top-tab">-</div>
              <div class="analytics-card-label">Top Tab (7d)</div>
            </div>
            <div class="analytics-card">
              <div class="analytics-card-value" id="stat-top-player">-</div>
              <div class="analytics-card-label">Most Viewed Player (7d)</div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-bottom: 1.5rem;">
            <div>
              <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9em; color: var(--color-text-muted);">Daily Visits (30d)</h4>
              <div id="chart-daily-visits" style="min-height: 220px;"></div>
            </div>
            <div>
              <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9em; color: var(--color-text-muted);">Tab Popularity (7d)</h4>
              <div id="chart-tab-popularity" style="min-height: 220px;"></div>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
            <div>
              <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9em; color: var(--color-text-muted);">Most Viewed Players (7d)</h4>
              <div id="analytics-top-players" style="max-height: 300px; overflow-y: auto;"></div>
            </div>
            <div>
              <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9em; color: var(--color-text-muted);">Most Filtered Teams (7d)</h4>
              <div id="chart-team-popularity" style="min-height: 220px;"></div>
            </div>
          </div>

          <!-- StatsPlus API Usage Section -->
          <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid rgba(255,255,255,0.1);">
            <h3 class="form-title" style="margin-bottom: 1rem;">StatsPlus API Usage</h3>
            <div class="analytics-cards" id="api-summary-cards" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin-bottom: 1.5rem;">
              <div class="analytics-card">
                <div class="analytics-card-value" id="api-stat-calls">-</div>
                <div class="analytics-card-label">Total Calls (30d)</div>
              </div>
              <div class="analytics-card">
                <div class="analytics-card-value" id="api-stat-bandwidth">-</div>
                <div class="analytics-card-label">Bandwidth (30d)</div>
              </div>
              <div class="analytics-card">
                <div class="analytics-card-value" id="api-stat-avg-duration">-</div>
                <div class="analytics-card-label">Avg Response (30d)</div>
              </div>
              <div class="analytics-card">
                <div class="analytics-card-value" id="api-stat-errors">-</div>
                <div class="analytics-card-label">Errors / Rate Limits (30d)</div>
              </div>
            </div>
            <div style="margin-bottom: 1.5rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
                <h4 style="margin: 0; font-size: 0.9em; color: var(--color-text-muted);">Calls &amp; Bandwidth Over Time</h4>
                <div class="toggle-group" style="display: flex; gap: 4px;">
                  <button class="toggle-btn api-period-btn active" data-period="day">Day</button>
                  <button class="toggle-btn api-period-btn" data-period="week">Week</button>
                  <button class="toggle-btn api-period-btn" data-period="month">Month</button>
                </div>
              </div>
              <div id="chart-api-calls" style="min-height: 240px;"></div>
            </div>
            <div>
              <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9em; color: var(--color-text-muted);">Endpoints (30d)</h4>
              <div id="api-endpoint-table" style="max-height: 300px; overflow-y: auto;"></div>
            </div>
          </div>
        </div>
        <div id="analytics-disabled" style="display: none; text-align: center; padding: 1rem; color: var(--color-text-muted);">
          Analytics is disabled. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in your environment to enable.
        </div>
      </div>

      <style>
        .analytics-dashboard {
          margin-bottom: 2rem;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        .analytics-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 1rem;
          text-align: center;
        }
        .analytics-card-value {
          font-size: 1.5em;
          font-weight: 700;
          color: var(--color-primary);
        }
        .analytics-card-label {
          font-size: 0.8em;
          color: var(--color-text-muted);
          margin-top: 0.25rem;
        }
      </style>
    `;
  }

  private async loadData(): Promise<void> {
    const loadingEl = this.container.querySelector('#analytics-loading');
    const contentEl = this.container.querySelector('#analytics-content');
    const disabledEl = this.container.querySelector('#analytics-disabled');

    if (!analyticsService.isEnabled) {
      if (loadingEl) (loadingEl as HTMLElement).style.display = 'none';
      if (disabledEl) (disabledEl as HTMLElement).style.display = 'block';
      return;
    }

    // Fetch 90 days to support monthly API usage view
    const events = await analyticsService.fetchEvents(90);

    // Container may have been detached during the await (e.g. onboarding replaced the DOM)
    if (!this.container.isConnected) return;

    if (loadingEl) (loadingEl as HTMLElement).style.display = 'none';
    if (contentEl) (contentEl as HTMLElement).style.display = 'block';

    if (events.length === 0) {
      if (contentEl) (contentEl as HTMLElement).innerHTML = '<p style="text-align:center; color: var(--color-text-muted); padding: 1rem;">No analytics data yet. Events will appear here as users interact with the app.</p>';
      return;
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const recent = events.filter(e => new Date(e.created_at) >= sevenDaysAgo);
    const last30 = events.filter(e => new Date(e.created_at) >= thirtyDaysAgo);

    this.renderSummaryCards(recent);
    this.renderDailyVisitsChart(last30);
    this.renderTabPopularityChart(recent);
    this.renderTopPlayers(recent);
    this.renderTeamPopularityChart(recent);

    // API usage section
    this.cachedApiEvents = events.filter(e => e.event_type === 'api_call');
    this.renderApiUsageSection(this.cachedApiEvents);
  }

  private renderSummaryCards(events: AnalyticsEvent[]): void {
    // Unique sessions
    const sessions = new Set(events.map(e => e.session_id)).size;
    const sessionsEl = this.container.querySelector('#stat-sessions');
    if (sessionsEl) sessionsEl.textContent = String(sessions);

    // Total events
    const eventsEl = this.container.querySelector('#stat-events');
    if (eventsEl) eventsEl.textContent = String(events.length);

    // Most popular tab
    const tabCounts = new Map<string, number>();
    for (const e of events) {
      if (e.event_type === 'tab_visit') {
        const name = (e.event_data.tab_name as string) ?? 'Unknown';
        tabCounts.set(name, (tabCounts.get(name) ?? 0) + 1);
      }
    }
    let topTab = '-';
    let topTabCount = 0;
    for (const [name, count] of tabCounts) {
      if (count > topTabCount) {
        topTab = name;
        topTabCount = count;
      }
    }
    const topTabEl = this.container.querySelector('#stat-top-tab');
    if (topTabEl) topTabEl.textContent = topTab;

    // Most viewed player
    const playerCounts = new Map<string, number>();
    for (const e of events) {
      if (e.event_type === 'player_profile_opened') {
        const name = (e.event_data.player_name as string) ?? 'Unknown';
        playerCounts.set(name, (playerCounts.get(name) ?? 0) + 1);
      }
    }
    let topPlayer = '-';
    let topPlayerCount = 0;
    for (const [name, count] of playerCounts) {
      if (count > topPlayerCount) {
        topPlayer = name;
        topPlayerCount = count;
      }
    }
    const topPlayerEl = this.container.querySelector('#stat-top-player');
    if (topPlayerEl) topPlayerEl.textContent = topPlayer;
  }

  private renderDailyVisitsChart(events: AnalyticsEvent[]): void {
    // Count app_open events per day for last 30 days
    const dayCounts = new Map<string, number>();
    const now = new Date();

    // Pre-fill last 30 days with 0
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      dayCounts.set(key, 0);
    }

    for (const e of events) {
      if (e.event_type === 'app_open') {
        const day = e.created_at.split('T')[0];
        if (dayCounts.has(day)) {
          dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
        }
      }
    }

    const categories = Array.from(dayCounts.keys());
    const data = Array.from(dayCounts.values());

    const el = this.container.querySelector('#chart-daily-visits');
    if (!el) return;

    this.dailyChart?.destroy();
    this.dailyChart = new ApexCharts(el, {
      chart: {
        type: 'area',
        height: 220,
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      series: [{ name: 'App Opens', data }],
      xaxis: {
        categories,
        labels: {
          show: true,
          rotate: -45,
          style: { colors: '#888', fontSize: '10px' },
          formatter: (val: string) => {
            if (!val) return '';
            const parts = val.split('-');
            return `${parts[1]}/${parts[2]}`;
          },
        },
        tickAmount: 10,
      },
      yaxis: {
        labels: { style: { colors: '#888' } },
        min: 0,
        forceNiceScale: true,
      },
      colors: ['#00ba7c'],
      stroke: { curve: 'smooth', width: 2 },
      fill: {
        type: 'gradient',
        gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05 },
      },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(255,255,255,0.1)' },
      theme: { mode: 'dark' },
      tooltip: { theme: 'dark' },
    });
    this.dailyChart.render();
  }

  private renderTabPopularityChart(events: AnalyticsEvent[]): void {
    const tabCounts = new Map<string, number>();
    for (const e of events) {
      if (e.event_type === 'tab_visit') {
        const name = (e.event_data.tab_name as string) ?? 'Unknown';
        tabCounts.set(name, (tabCounts.get(name) ?? 0) + 1);
      }
    }

    // Sort descending by count
    const sorted = Array.from(tabCounts.entries()).sort((a, b) => b[1] - a[1]);
    const categories = sorted.map(([name]) => name);
    const data = sorted.map(([, count]) => count);

    const el = this.container.querySelector('#chart-tab-popularity');
    if (!el) return;

    this.tabChart?.destroy();
    this.tabChart = new ApexCharts(el, {
      chart: {
        type: 'bar',
        height: 220,
        background: 'transparent',
        toolbar: { show: false },
      },
      series: [{ name: 'Visits', data }],
      plotOptions: {
        bar: { horizontal: true, borderRadius: 4 },
      },
      xaxis: {
        categories,
        labels: { style: { colors: '#888' } },
      },
      yaxis: {
        labels: { style: { colors: '#888', fontSize: '11px' } },
      },
      colors: ['#1d9bf0'],
      dataLabels: { enabled: true, style: { fontSize: '11px' } },
      grid: { borderColor: 'rgba(255,255,255,0.1)' },
      theme: { mode: 'dark' },
      tooltip: { theme: 'dark' },
    });
    this.tabChart.render();
  }

  private renderTopPlayers(events: AnalyticsEvent[]): void {
    const playerCounts = new Map<string, { count: number; type: string }>();
    for (const e of events) {
      if (e.event_type === 'player_profile_opened') {
        const name = (e.event_data.player_name as string) ?? 'Unknown';
        const type = (e.event_data.player_type as string) ?? '';
        const existing = playerCounts.get(name);
        playerCounts.set(name, {
          count: (existing?.count ?? 0) + 1,
          type: existing?.type ?? type,
        });
      }
    }

    const sorted = Array.from(playerCounts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20);

    const el = this.container.querySelector('#analytics-top-players');
    if (!el) return;

    if (sorted.length === 0) {
      el.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: 1rem;">No player views yet.</p>';
      return;
    }

    el.innerHTML = `
      <table class="stats-table" style="width: 100%; text-align: left; font-size: 0.85em;">
        <thead>
          <tr>
            <th style="text-align: left;">#</th>
            <th style="text-align: left;">Player</th>
            <th style="text-align: left;">Type</th>
            <th style="text-align: right;">Views</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(([name, { count, type }], i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${this.escapeHtml(name)}</td>
              <td><span class="badge ${type === 'pitcher' ? 'badge-active' : 'badge-retired'}">${type === 'pitcher' ? 'P' : 'B'}</span></td>
              <td style="text-align: right;">${count}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  private renderTeamPopularityChart(events: AnalyticsEvent[]): void {
    const teamCounts = new Map<string, number>();
    for (const e of events) {
      if (e.event_type === 'team_selected') {
        const team = (e.event_data.team as string) ?? 'Unknown';
        if (team === 'all') continue; // Skip "All Teams" filter
        teamCounts.set(team, (teamCounts.get(team) ?? 0) + 1);
      }
    }

    const sorted = Array.from(teamCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    const categories = sorted.map(([name]) => name);
    const data = sorted.map(([, count]) => count);

    const el = this.container.querySelector('#chart-team-popularity');
    if (!el) return;

    if (sorted.length === 0) {
      el.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: 1rem;">No team filters yet.</p>';
      return;
    }

    this.teamChart?.destroy();
    this.teamChart = new ApexCharts(el, {
      chart: {
        type: 'bar',
        height: 220,
        background: 'transparent',
        toolbar: { show: false },
      },
      series: [{ name: 'Filters', data }],
      plotOptions: {
        bar: { horizontal: true, borderRadius: 4 },
      },
      xaxis: {
        categories,
        labels: { style: { colors: '#888' } },
      },
      yaxis: {
        labels: { style: { colors: '#888', fontSize: '11px' } },
      },
      colors: ['#f97316'],
      dataLabels: { enabled: true, style: { fontSize: '11px' } },
      grid: { borderColor: 'rgba(255,255,255,0.1)' },
      theme: { mode: 'dark' },
      tooltip: { theme: 'dark' },
    });
    this.teamChart.render();
  }

  private renderApiUsageSection(apiEvents: AnalyticsEvent[]): void {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recent30 = apiEvents.filter(e => new Date(e.created_at) >= thirtyDaysAgo);

    // Summary cards
    const totalCalls = recent30.length;
    const bytesArr = recent30.map(e => e.event_data.bytes as number | undefined).filter((b): b is number => typeof b === 'number' && b > 0);
    const totalBytes = bytesArr.reduce((a, b) => a + b, 0);
    const durArr = recent30.map(e => e.event_data.duration_ms as number | undefined).filter((d): d is number => typeof d === 'number');
    const avgDuration = durArr.length > 0 ? Math.round(durArr.reduce((a, b) => a + b, 0) / durArr.length) : undefined;
    const errorCount = recent30.filter(e => {
      const s = e.event_data.status as number | undefined;
      return s !== undefined && (s >= 400 || s === 429);
    }).length;

    const callsEl = this.container.querySelector('#api-stat-calls');
    const bwEl = this.container.querySelector('#api-stat-bandwidth');
    const durEl = this.container.querySelector('#api-stat-avg-duration');
    const errEl = this.container.querySelector('#api-stat-errors');
    if (callsEl) callsEl.textContent = totalCalls.toLocaleString();
    if (bwEl) bwEl.textContent = bytesArr.length > 0 ? this.formatBytes(totalBytes) : '—';
    if (durEl) durEl.textContent = avgDuration !== undefined ? `${avgDuration} ms` : '—';
    if (errEl) errEl.textContent = errorCount > 0 ? errorCount.toLocaleString() : '0';

    // Bind period toggle buttons
    const periodBtns = this.container.querySelectorAll<HTMLElement>('.api-period-btn');
    periodBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        periodBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.apiPeriod = btn.dataset.period as 'day' | 'week' | 'month';
        this.renderApiCallsChart(this.cachedApiEvents, this.apiPeriod);
      });
    });

    this.renderApiCallsChart(apiEvents, this.apiPeriod);
    this.renderEndpointTable(recent30);
  }

  private renderApiCallsChart(apiEvents: AnalyticsEvent[], period: 'day' | 'week' | 'month'): void {
    const el = this.container.querySelector('#chart-api-calls');
    if (!el) return;

    // Determine lookback and bucket key function
    let bucketCount: number;
    let labelFn: (key: string) => string;
    let keyFn: (date: Date) => string;

    if (period === 'day') {
      bucketCount = 30;
      keyFn = (d) => d.toISOString().split('T')[0];
      labelFn = (k) => { const p = k.split('-'); return `${p[1]}/${p[2]}`; };
    } else if (period === 'week') {
      bucketCount = 12;
      // ISO week key: YYYY-Www
      keyFn = (d) => {
        const jan4 = new Date(d.getFullYear(), 0, 4);
        const week = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
        return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
      };
      labelFn = (k) => k.replace('-W', ' W');
    } else {
      bucketCount = 6;
      keyFn = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      labelFn = (k) => { const p = k.split('-'); return `${p[0]}/${p[1]}`; };
    }

    // Build buckets going back bucketCount periods
    const now = new Date();
    const callBuckets = new Map<string, number>();
    const byteBuckets = new Map<string, number>();

    for (let i = bucketCount - 1; i >= 0; i--) {
      let d: Date;
      if (period === 'day') {
        d = new Date(now.getTime() - i * 86400000);
      } else if (period === 'week') {
        d = new Date(now.getTime() - i * 7 * 86400000);
      } else {
        d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      }
      const key = keyFn(d);
      callBuckets.set(key, 0);
      byteBuckets.set(key, 0);
    }

    for (const e of apiEvents) {
      const key = keyFn(new Date(e.created_at));
      if (!callBuckets.has(key)) continue;
      callBuckets.set(key, (callBuckets.get(key) ?? 0) + 1);
      const bytes = e.event_data.bytes as number | undefined;
      if (typeof bytes === 'number' && bytes > 0) {
        byteBuckets.set(key, (byteBuckets.get(key) ?? 0) + bytes);
      }
    }

    const categories = Array.from(callBuckets.keys());
    const callData = categories.map(k => callBuckets.get(k) ?? 0);
    const byteData = categories.map(k => byteBuckets.get(k) ?? 0);
    const labels = categories.map(labelFn);

    const hasBandwidth = byteData.some(b => b > 0);

    this.apiCallsChart?.destroy();
    this.apiCallsChart = new ApexCharts(el, {
      chart: {
        type: 'line',
        height: 240,
        background: 'transparent',
        toolbar: { show: false },
        zoom: { enabled: false },
      },
      series: [
        { name: 'API Calls', data: callData },
        ...(hasBandwidth ? [{ name: 'Bandwidth (KB)', data: byteData.map(b => Math.round(b / 1024)) }] : []),
      ],
      xaxis: {
        categories: labels,
        labels: { rotate: -45, style: { colors: '#888', fontSize: '10px' } },
        tickAmount: Math.min(categories.length, 10),
      },
      yaxis: hasBandwidth ? [
        { title: { text: 'Calls', style: { color: '#a78bfa' } }, labels: { style: { colors: '#888' } }, min: 0, forceNiceScale: true },
        { opposite: true, title: { text: 'KB', style: { color: '#34d399' } }, labels: { style: { colors: '#888' } }, min: 0, forceNiceScale: true },
      ] : [
        { labels: { style: { colors: '#888' } }, min: 0, forceNiceScale: true },
      ],
      colors: ['#a78bfa', '#34d399'],
      stroke: { curve: 'smooth', width: 2 },
      markers: { size: 3 },
      dataLabels: { enabled: false },
      grid: { borderColor: 'rgba(255,255,255,0.1)' },
      legend: { labels: { colors: '#ccc' } },
      theme: { mode: 'dark' },
      tooltip: {
        theme: 'dark',
        y: hasBandwidth ? [
          { formatter: (v: number) => `${v} calls` },
          { formatter: (v: number) => `${v} KB` },
        ] : [{ formatter: (v: number) => `${v} calls` }],
      },
    });
    this.apiCallsChart.render();
  }

  private renderEndpointTable(apiEvents: AnalyticsEvent[]): void {
    const el = this.container.querySelector('#api-endpoint-table');
    if (!el) return;

    const endpointMap = new Map<string, { calls: number; bytes: number; hasBandwidth: boolean; durations: number[] }>();
    for (const e of apiEvents) {
      const ep = (e.event_data.endpoint as string) ?? '/unknown';
      const existing = endpointMap.get(ep) ?? { calls: 0, bytes: 0, hasBandwidth: false, durations: [] };
      existing.calls += 1;
      const bytes = e.event_data.bytes as number | undefined;
      if (typeof bytes === 'number' && bytes > 0) { existing.bytes += bytes; existing.hasBandwidth = true; }
      const dur = e.event_data.duration_ms as number | undefined;
      if (typeof dur === 'number') existing.durations.push(dur);
      endpointMap.set(ep, existing);
    }

    const sorted = Array.from(endpointMap.entries()).sort((a, b) => b[1].calls - a[1].calls);

    if (sorted.length === 0) {
      el.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: 1rem;">No API calls tracked yet. Will populate as users load data.</p>';
      return;
    }

    const hasBandwidthAny = sorted.some(([, v]) => v.hasBandwidth);
    el.innerHTML = `
      <table class="stats-table" style="width: 100%; text-align: left; font-size: 0.85em;">
        <thead>
          <tr>
            <th style="text-align: left;">Endpoint</th>
            <th style="text-align: right;">Calls</th>
            ${hasBandwidthAny ? '<th style="text-align: right;">Total BW</th>' : ''}
            <th style="text-align: right;">Avg Duration</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(([ep, { calls, bytes, hasBandwidth, durations }]) => {
            const avgDur = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : undefined;
            return `
              <tr>
                <td style="font-family: monospace; font-size: 0.8em;">${this.escapeHtml(ep)}</td>
                <td style="text-align: right;">${calls.toLocaleString()}</td>
                ${hasBandwidthAny ? `<td style="text-align: right;">${hasBandwidth ? this.formatBytes(bytes) : '—'}</td>` : ''}
                <td style="text-align: right;">${avgDur !== undefined ? `${avgDur} ms` : '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  destroy(): void {
    this.dailyChart?.destroy();
    this.tabChart?.destroy();
    this.teamChart?.destroy();
    this.apiCallsChart?.destroy();
  }
}
