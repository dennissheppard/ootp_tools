/**
 * RadarChart Component
 *
 * ApexCharts radar wrapper for True vs Scout rating comparisons.
 * Follows the DevelopmentChart pattern (constructor/render/destroy lifecycle).
 */

import ApexCharts from 'apexcharts';

export interface RadarChartSeries {
  name: string;
  data: number[];
  color: string;
  dashStyle?: 'solid' | 'dashed';
  fillOpacity?: number;
}

interface RadarChartConfig {
  containerId: string;
  categories: string[];
  series: RadarChartSeries[];
  height?: number;
  radarSize?: number;
  min?: number;
  max?: number;
  legendPosition?: 'left' | 'top';
  showLegend?: boolean;
  offsetX?: number;
  offsetY?: number;
  onLegendClick?: (seriesName: string, seriesIndex: number) => void;
}

export class RadarChart {
  private chart: ApexCharts | null = null;
  private containerId: string;
  private categories: string[];
  private series: RadarChartSeries[];
  private height: number;
  private radarSize: number | undefined;
  private min: number;
  private max: number;
  private legendPosition: 'left' | 'top';
  private showLegend: boolean;
  private offsetX: number;
  private offsetY: number;
  private onLegendClick?: (seriesName: string, seriesIndex: number) => void;

  constructor(config: RadarChartConfig) {
    this.containerId = config.containerId;
    this.categories = config.categories;
    this.series = config.series;
    this.height = config.height ?? 300;
    this.radarSize = config.radarSize;
    this.min = config.min ?? 20;
    this.max = config.max ?? 80;
    this.legendPosition = config.legendPosition ?? 'left';
    this.showLegend = config.showLegend ?? true;
    this.offsetX = config.offsetX ?? 0;
    this.offsetY = config.offsetY ?? -10;
    this.onLegendClick = config.onLegendClick;
  }

  render(): void {
    const container = document.getElementById(this.containerId);
    if (!container) {
      console.error(`RadarChart: Container #${this.containerId} not found`);
      return;
    }

    const options = this.buildOptions();
    this.chart = new ApexCharts(container, options);
    this.chart.render();
  }

  updateSeries(series: RadarChartSeries[]): void {
    this.series = series;
    if (this.chart) {
      const apexSeries = series.map(s => ({ name: s.name, data: s.data }));
      const colors = series.map(s => s.color);
      const dashArray = series.map(s => s.dashStyle === 'dashed' ? 4 : 0);
      const fillOpacities = series.map(s => s.fillOpacity ?? 0.15);
      this.chart.updateOptions({
        series: apexSeries,
        colors,
        stroke: { width: 2.5, dashArray },
        fill: { opacity: fillOpacities },
      });
    }
  }

  destroy(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  private buildOptions(): ApexCharts.ApexOptions {
    const apexSeries = this.series.map(s => ({ name: s.name, data: s.data }));
    const colors = this.series.map(s => s.color);
    const dashArray = this.series.map(s => s.dashStyle === 'dashed' ? 4 : 0);
    const fillOpacities = this.series.map(s => s.fillOpacity ?? 0.15);

    return {
      chart: {
        type: 'radar',
        height: this.height,
        background: 'transparent',
        foreColor: '#e7e9ea',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        toolbar: { show: false },
        animations: {
          enabled: true,
          speed: 600,
          dynamicAnimation: { enabled: true, speed: 350 },
        },
        events: this.onLegendClick ? {
          legendClick: (_chartContext: any, seriesIndex: number) => {
            const seriesName = this.series[seriesIndex]?.name ?? '';
            this.onLegendClick!(seriesName, seriesIndex);
          },
        } : {},
      },
      series: apexSeries,
      colors,
      stroke: { width: 2.5, dashArray },
      fill: { opacity: fillOpacities },
      markers: { size: 3, hover: { size: 5 } },
      xaxis: {
        categories: this.categories,
        labels: {
          show: false,
        },
      },
      yaxis: {
        min: this.min,
        max: this.max,
        tickAmount: 4,
        show: false,
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        radar: {
          size: this.radarSize,
          offsetX: this.offsetX,
          offsetY: this.offsetY,
          polygons: {
            strokeColors: '#38444d',
            connectorColors: '#38444d',
            fill: { colors: ['transparent'] },
          },
        },
      },
      legend: {
        show: this.showLegend,
        position: this.legendPosition,
        ...(this.legendPosition === 'top' ? { horizontalAlign: 'center' as const } : {}),
        labels: { colors: '#e7e9ea' },
        markers: { size: 8, strokeWidth: 0, offsetX: -4 },
        itemMargin: { horizontal: 8, vertical: 4 },
        fontSize: '11px',
        onItemClick: { toggleDataSeries: true },
      },
      tooltip: {
        theme: 'dark',
        y: {
          formatter: (val: number) => Math.round(val).toString(),
        },
      },
    };
  }
}
