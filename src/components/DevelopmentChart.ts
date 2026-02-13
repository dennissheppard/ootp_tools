/**
 * DevelopmentChart Component
 *
 * ApexCharts-based visualization for player development tracking.
 * Shows scouting ratings (stuff, control, HRA, OVR, POT) over time.
 */

import ApexCharts from 'apexcharts';
import { DevelopmentSnapshotRecord } from '../services/IndexedDBService';

// Pitcher scouting metrics
export type PitcherDevelopmentMetric = 'scoutStuff' | 'scoutControl' | 'scoutHra';
// Hitter scouting metrics
export type HitterDevelopmentMetric = 'scoutPower' | 'scoutEye' | 'scoutAvoidK' | 'scoutBabip' | 'scoutGap' | 'scoutSpeed';
// Common scouting metrics
export type CommonDevelopmentMetric = 'scoutOvr' | 'scoutPot';
// Pitcher True Rating metrics (calculated from stats)
export type PitcherTrueMetric = 'trueStuff' | 'trueControl' | 'trueHra';
// Hitter True Rating metrics (calculated from stats)
export type HitterTrueMetric = 'truePower' | 'trueEye' | 'trueAvoidK' | 'trueContact' | 'trueGap' | 'trueSpeed';
// True Rating star metric (common)
export type TrueRatingMetric = 'trueRating';
// True Future Rating star metric
export type TrueFutureRatingMetric = 'trueFutureRating';
// Combined type
export type DevelopmentMetric = PitcherDevelopmentMetric | HitterDevelopmentMetric | CommonDevelopmentMetric
  | PitcherTrueMetric | HitterTrueMetric | TrueRatingMetric | TrueFutureRatingMetric;

interface DevelopmentChartConfig {
  containerId: string;
  snapshots: DevelopmentSnapshotRecord[];
  metrics?: DevelopmentMetric[];
  height?: number;
  playerType?: 'pitcher' | 'hitter'; // Used for metric toggles
}

// Metric display configuration
const METRIC_CONFIG: Record<DevelopmentMetric, { name: string; color: string; scale: 'scouting' | 'stars' | 'speed' }> = {
  // Pitcher scouting metrics
  scoutStuff: { name: 'Stuff', color: '#1d9bf0', scale: 'scouting' },
  scoutControl: { name: 'Control', color: '#00ba7c', scale: 'scouting' },
  scoutHra: { name: 'HR Avoid', color: '#f97316', scale: 'scouting' },
  // Hitter scouting metrics
  scoutPower: { name: 'Power', color: '#ef4444', scale: 'scouting' },
  scoutEye: { name: 'Eye', color: '#3b82f6', scale: 'scouting' },
  scoutAvoidK: { name: 'Avoid K', color: '#22c55e', scale: 'scouting' },
  scoutBabip: { name: 'BABIP', color: '#f59e0b', scale: 'scouting' },
  scoutGap: { name: 'Gap', color: '#8b5cf6', scale: 'scouting' },
  scoutSpeed: { name: 'Speed', color: '#06b6d4', scale: 'scouting' },  // Speed now uses 20-80 scale like other ratings
  // Common scouting metrics
  scoutOvr: { name: 'OVR Stars', color: '#ffc107', scale: 'stars' },
  scoutPot: { name: 'POT Stars', color: '#a855f7', scale: 'stars' },
  // Pitcher True Rating metrics (calculated from stats, 20-80 scale)
  trueStuff: { name: 'True Stuff', color: '#1d9bf0', scale: 'scouting' },
  trueControl: { name: 'True Control', color: '#00ba7c', scale: 'scouting' },
  trueHra: { name: 'True HR Avoid', color: '#f97316', scale: 'scouting' },
  // Hitter True Rating metrics (calculated from stats, 20-80 scale)
  truePower: { name: 'True Power', color: '#ef4444', scale: 'scouting' },
  trueEye: { name: 'True Eye', color: '#3b82f6', scale: 'scouting' },
  trueAvoidK: { name: 'True Avoid K', color: '#22c55e', scale: 'scouting' },
  trueContact: { name: 'True Contact', color: '#f59e0b', scale: 'scouting' },
  trueGap: { name: 'True Gap', color: '#8b5cf6', scale: 'scouting' },
  trueSpeed: { name: 'True Speed', color: '#06b6d4', scale: 'scouting' },
  // True Rating star metric
  trueRating: { name: 'True Rating', color: '#ffc107', scale: 'stars' },
  // True Future Rating star metric
  trueFutureRating: { name: 'TFR Stars', color: '#4caf50', scale: 'stars' },
};

export class DevelopmentChart {
  private chart: ApexCharts | null = null;
  private containerId: string;
  private snapshots: DevelopmentSnapshotRecord[];
  private metrics: DevelopmentMetric[];
  private height: number;

  constructor(config: DevelopmentChartConfig) {
    this.containerId = config.containerId;
    this.snapshots = config.snapshots;
    this.metrics = config.metrics || ['scoutStuff', 'scoutControl', 'scoutHra'];
    this.height = config.height || 300;
  }

  /**
   * Render the chart into the container
   */
  render(): void {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`DevelopmentChart: Container #${this.containerId} not found`);
      return;
    }

    if (this.snapshots.length < 2) {
      container.innerHTML = this.renderEmptyState();
      return;
    }

    const options = this.buildChartOptions();
    this.chart = new ApexCharts(container, options);
    this.chart.render();
  }

  /**
   * Update chart with new snapshots
   */
  update(snapshots: DevelopmentSnapshotRecord[]): void {
    this.snapshots = snapshots;

    if (this.chart && snapshots.length >= 2) {
      const series = this.buildSeries();
      this.chart.updateSeries(series);
    } else if (snapshots.length < 2) {
      this.destroy();
      const container = document.getElementById(this.containerId);
      if (container) {
        container.innerHTML = this.renderEmptyState();
      }
    }
  }

  /**
   * Update which metrics are displayed
   */
  updateMetrics(metrics: DevelopmentMetric[]): void {
    this.metrics = metrics;
    if (this.chart && this.snapshots.length >= 2) {
      const series = this.buildSeries();
      const colors = metrics.map(m => METRIC_CONFIG[m].color);
      this.chart.updateOptions({
        series,
        colors,
        yaxis: this.buildYAxisOptions(),
      });
    }
  }

  /**
   * Destroy the chart instance
   */
  destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  private buildSeries(): ApexAxisChartSeries {
    return this.metrics.map(metric => {
      const config = METRIC_CONFIG[metric];
      const data = this.snapshots
        .filter(s => s[metric] !== undefined)
        .map(s => {
          const rawValue = s[metric] as number;
          let y: number;
          if (config.scale === 'stars') {
            y = rawValue;  // Stars are 0.5-5.0
          } else if (config.scale === 'speed') {
            // Speed is 20-200, normalize to 2-8 range for visual alignment
            y = ((rawValue - 20) / 180) * 6 + 2;
          } else {
            y = rawValue / 10; // Convert 20-80 to 2-8 for visual alignment
          }
          return { x: new Date(s.date).getTime(), y };
        });

      return {
        name: config.name,
        data,
      };
    });
  }

  private buildYAxisOptions(): ApexYAxis {
    const hasStars = this.metrics.some(m => METRIC_CONFIG[m].scale === 'stars');
    const hasScouting = this.metrics.some(m => METRIC_CONFIG[m].scale === 'scouting');
    const hasSpeed = this.metrics.some(m => METRIC_CONFIG[m].scale === 'speed');

    let yMin = 0;
    let yMax = 8;
    let tickAmount = 6;
    const starsOnly = hasStars && !hasScouting && !hasSpeed;
    if (starsOnly) {
      yMin = 0;
      yMax = 5;
      tickAmount = 5; // 0, 1, 2, 3, 4, 5
    } else if ((hasScouting || hasSpeed) && !hasStars) {
      yMin = 2;
      yMax = 8;
    }

    return {
      min: yMin,
      max: yMax,
      tickAmount,
      labels: {
        style: {
          colors: '#8b98a5',
          fontSize: '11px',
        },
        formatter: (val: number) => {
          if (hasStars && !hasScouting) {
            return val.toFixed(1);
          }
          return Math.round(val * 10).toString();
        },
      },
    };
  }

  private buildChartOptions(): ApexCharts.ApexOptions {
    const series = this.buildSeries();
    const colors = this.metrics.map(m => METRIC_CONFIG[m].color);

    return {
      chart: {
        type: 'line',
        height: this.height,
        background: 'transparent',
        foreColor: '#e7e9ea',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        toolbar: {
          show: false,
        },
        animations: {
          enabled: true,
          speed: 600,
          dynamicAnimation: {
            enabled: true,
            speed: 350,
          },
        },
        zoom: {
          enabled: false,
        },
      },
      series,
      colors,
      stroke: {
        curve: 'smooth',
        width: 3,
      },
      markers: {
        size: 5,
        hover: {
          size: 7,
        },
      },
      grid: {
        borderColor: '#38444d',
        strokeDashArray: 4,
        xaxis: {
          lines: { show: false },
        },
        yaxis: {
          lines: { show: true },
        },
        padding: {
          top: 0,
          right: 10,
          bottom: 0,
          left: 10,
        },
      },
      tooltip: {
        theme: 'dark',
        x: {
          format: 'MMM dd, yyyy',
        },
        y: {
          formatter: (val, opts) => {
            const metric = this.metrics[opts.seriesIndex];
            const config = METRIC_CONFIG[metric];
            if (config.scale === 'stars') {
              return `${val.toFixed(1)} stars`;
            }
            if (config.scale === 'speed') {
              // Convert back from normalized to 20-200 scale
              const speedVal = Math.round((val - 2) / 6 * 180 + 20);
              return `${speedVal}`;
            }
            // Convert back from /10 to actual 20-80 scale
            return `${Math.round(val * 10)}`;
          },
        },
        marker: {
          show: true,
        },
      },
      xaxis: {
        type: 'datetime',
        labels: {
          style: {
            colors: '#8b98a5',
            fontSize: '11px',
          },
          datetimeFormatter: {
            year: 'yyyy',
            month: "MMM 'yy",
            day: 'MMM dd',
          },
        },
        axisBorder: {
          show: false,
        },
        axisTicks: {
          show: false,
        },
      },
      yaxis: this.buildYAxisOptions(),
      legend: {
        show: true,
        position: 'top',
        horizontalAlign: 'left',
        labels: {
          colors: '#e7e9ea',
        },
        markers: {
          size: 8,
          strokeWidth: 0,
          offsetX: -4,
        },
        itemMargin: {
          horizontal: 12,
        },
      },
      noData: {
        text: 'No data available',
        align: 'center',
        verticalAlign: 'middle',
        style: {
          color: '#8b98a5',
          fontSize: '14px',
        },
      },
    };
  }

  private renderEmptyState(): string {
    return `
      <div class="development-empty-state">
        <div class="development-empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M3 3v18h18"/>
            <path d="M18 9l-5 5-4-4-5 5"/>
          </svg>
        </div>
        <h4>Not Enough Data</h4>
        <p>Development data will appear as more seasons or scouting snapshots become available.</p>
        <p class="development-empty-hint">At least 2 snapshots needed for visualization.</p>
      </div>
    `;
  }
}

/**
 * Helper function to render metric toggle checkboxes
 * @param activeMetrics - Currently active metrics
 * @param playerType - 'pitcher' or 'hitter' to show appropriate metrics
 * @param dataMode - 'scout' for scouting metrics, 'true' for calculated True Rating metrics
 */
export function renderMetricToggles(
  activeMetrics: DevelopmentMetric[],
  playerType: 'pitcher' | 'hitter' = 'pitcher',
  dataMode: 'scout' | 'true' | 'tfr' = 'scout'
): string {
  const pitcherScoutMetrics: DevelopmentMetric[] = ['scoutStuff', 'scoutControl', 'scoutHra', 'scoutOvr', 'scoutPot'];
  const hitterScoutMetrics: DevelopmentMetric[] = ['scoutPower', 'scoutEye', 'scoutAvoidK', 'scoutBabip', 'scoutOvr', 'scoutPot'];
  const pitcherTrueMetrics: DevelopmentMetric[] = ['trueStuff', 'trueControl', 'trueHra', 'trueRating'];
  const hitterTrueMetrics: DevelopmentMetric[] = ['truePower', 'trueEye', 'trueAvoidK', 'trueContact', 'trueGap', 'trueSpeed', 'trueRating'];
  const pitcherTfrMetrics: DevelopmentMetric[] = ['trueStuff', 'trueControl', 'trueHra', 'trueFutureRating'];
  const hitterTfrMetrics: DevelopmentMetric[] = ['truePower', 'trueEye', 'trueAvoidK', 'trueContact', 'trueGap', 'trueSpeed', 'trueFutureRating'];

  let allMetrics: DevelopmentMetric[];
  if (dataMode === 'true') {
    allMetrics = playerType === 'hitter' ? hitterTrueMetrics : pitcherTrueMetrics;
  } else if (dataMode === 'tfr') {
    allMetrics = playerType === 'hitter' ? hitterTfrMetrics : pitcherTfrMetrics;
  } else {
    allMetrics = playerType === 'hitter' ? hitterScoutMetrics : pitcherScoutMetrics;
  }

  return `
    <div class="development-metric-toggles">
      ${allMetrics.map(metric => {
        const config = METRIC_CONFIG[metric];
        const checked = activeMetrics.includes(metric) ? 'checked' : '';
        return `
          <label class="development-metric-toggle">
            <input type="checkbox" data-metric="${metric}" ${checked}>
            <span class="toggle-indicator" style="background-color: ${config.color}"></span>
            <span class="toggle-label">${config.name}</span>
          </label>
        `;
      }).join('')}
    </div>
  `;
}

/** Star-scale metrics that are mutually exclusive with component (20-80) metrics */
const STAR_METRICS: Set<string> = new Set(['trueRating', 'trueFutureRating', 'scoutOvr', 'scoutPot']);

/**
 * Handle exclusive toggle between star metrics and component metrics.
 * When a star metric is enabled, all component metrics are unchecked.
 * When a component metric is enabled, all star metrics are unchecked.
 *
 * @returns The new active metrics array after applying exclusivity rules
 */
export function applyExclusiveMetricToggle(
  container: HTMLElement,
  activeMetrics: DevelopmentMetric[],
  metric: DevelopmentMetric,
  enabled: boolean
): DevelopmentMetric[] {
  let newMetrics = [...activeMetrics];
  const isStarToggle = STAR_METRICS.has(metric);

  if (enabled) {
    if (isStarToggle) {
      // Enabling a star metric: uncheck and remove all component metrics
      const toRemove = newMetrics.filter(m => !STAR_METRICS.has(m));
      newMetrics = newMetrics.filter(m => STAR_METRICS.has(m));
      for (const removed of toRemove) {
        const cb = container.querySelector<HTMLInputElement>(`input[data-metric="${removed}"]`);
        if (cb) cb.checked = false;
      }
    } else {
      // Enabling a component metric: uncheck and remove all star metrics
      const toRemove = newMetrics.filter(m => STAR_METRICS.has(m));
      newMetrics = newMetrics.filter(m => !STAR_METRICS.has(m));
      for (const removed of toRemove) {
        const cb = container.querySelector<HTMLInputElement>(`input[data-metric="${removed}"]`);
        if (cb) cb.checked = false;
      }
    }
    if (!newMetrics.includes(metric)) {
      newMetrics.push(metric);
    }
  } else {
    newMetrics = newMetrics.filter(m => m !== metric);
  }

  return newMetrics;
}

/**
 * Bind toggle event handlers
 */
export function bindMetricToggleHandlers(
  container: HTMLElement,
  onToggle: (metric: DevelopmentMetric, enabled: boolean) => void
): void {
  const checkboxes = container.querySelectorAll<HTMLInputElement>('.development-metric-toggle input[type="checkbox"]');
  checkboxes.forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      const metric = checkbox.dataset.metric as DevelopmentMetric;
      onToggle(metric, checkbox.checked);
    });
  });
}
