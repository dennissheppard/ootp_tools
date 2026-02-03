/**
 * DevelopmentChart Component
 *
 * ApexCharts-based visualization for player development tracking.
 * Shows scouting ratings (stuff, control, HRA, OVR, POT) over time.
 */

import ApexCharts from 'apexcharts';
import { DevelopmentSnapshotRecord } from '../services/IndexedDBService';

// Pitcher metrics
export type PitcherDevelopmentMetric = 'scoutStuff' | 'scoutControl' | 'scoutHra';
// Hitter metrics
export type HitterDevelopmentMetric = 'scoutPower' | 'scoutEye' | 'scoutAvoidK' | 'scoutBabip' | 'scoutGap' | 'scoutSpeed';
// Common metrics
export type CommonDevelopmentMetric = 'scoutOvr' | 'scoutPot';
// Combined type
export type DevelopmentMetric = PitcherDevelopmentMetric | HitterDevelopmentMetric | CommonDevelopmentMetric;

interface DevelopmentChartConfig {
  containerId: string;
  snapshots: DevelopmentSnapshotRecord[];
  metrics?: DevelopmentMetric[];
  height?: number;
  playerType?: 'pitcher' | 'hitter'; // Used for metric toggles
}

// Metric display configuration
const METRIC_CONFIG: Record<DevelopmentMetric, { name: string; color: string; scale: 'scouting' | 'stars' | 'speed' }> = {
  // Pitcher metrics
  scoutStuff: { name: 'Stuff', color: '#1d9bf0', scale: 'scouting' },
  scoutControl: { name: 'Control', color: '#00ba7c', scale: 'scouting' },
  scoutHra: { name: 'HR Avoid', color: '#f97316', scale: 'scouting' },
  // Hitter metrics
  scoutPower: { name: 'Power', color: '#ef4444', scale: 'scouting' },
  scoutEye: { name: 'Eye', color: '#3b82f6', scale: 'scouting' },
  scoutAvoidK: { name: 'Avoid K', color: '#22c55e', scale: 'scouting' },
  scoutBabip: { name: 'BABIP', color: '#f59e0b', scale: 'scouting' },
  scoutGap: { name: 'Gap', color: '#8b5cf6', scale: 'scouting' },
  scoutSpeed: { name: 'Speed', color: '#06b6d4', scale: 'speed' },
  // Common metrics
  scoutOvr: { name: 'OVR Stars', color: '#ffc107', scale: 'stars' },
  scoutPot: { name: 'POT Stars', color: '#a855f7', scale: 'stars' },
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

  private buildChartOptions(): ApexCharts.ApexOptions {
    const series = this.buildSeries();
    const colors = this.metrics.map(m => METRIC_CONFIG[m].color);

    // Determine if we're showing stars (0.5-5) or scouting (2-8 after /10)
    const hasStars = this.metrics.some(m => METRIC_CONFIG[m].scale === 'stars');
    const hasScouting = this.metrics.some(m => METRIC_CONFIG[m].scale === 'scouting');
    const hasSpeed = this.metrics.some(m => METRIC_CONFIG[m].scale === 'speed');

    // Y-axis config based on what we're showing
    // Speed is normalized to 2-8 range, so it works with scouting
    let yMin = 0;
    let yMax = 8;
    if (hasStars && !hasScouting && !hasSpeed) {
      yMin = 0;
      yMax = 5;
    } else if ((hasScouting || hasSpeed) && !hasStars) {
      yMin = 2;
      yMax = 8;
    }

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
      yaxis: {
        min: yMin,
        max: yMax,
        tickAmount: 6,
        labels: {
          style: {
            colors: '#8b98a5',
            fontSize: '11px',
          },
          formatter: (val) => {
            if (hasStars && !hasScouting) {
              return val.toFixed(1);
            }
            // Show as 20-80 scale labels
            return Math.round(val * 10).toString();
          },
        },
      },
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
        <p>Upload scouting data over time to track development trends.</p>
        <p class="development-empty-hint">At least 2 snapshots needed for visualization.</p>
      </div>
    `;
  }
}

/**
 * Helper function to render metric toggle checkboxes
 * @param activeMetrics - Currently active metrics
 * @param playerType - 'pitcher' or 'hitter' to show appropriate metrics
 */
export function renderMetricToggles(
  activeMetrics: DevelopmentMetric[],
  playerType: 'pitcher' | 'hitter' = 'pitcher'
): string {
  const pitcherMetrics: DevelopmentMetric[] = ['scoutStuff', 'scoutControl', 'scoutHra', 'scoutOvr', 'scoutPot'];
  const hitterMetrics: DevelopmentMetric[] = ['scoutPower', 'scoutEye', 'scoutAvoidK', 'scoutBabip', 'scoutOvr', 'scoutPot'];

  const allMetrics = playerType === 'hitter' ? hitterMetrics : pitcherMetrics;

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
