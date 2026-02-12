/**
 * HalfDonutGauge Component
 *
 * Pure function returning an SVG HTML string for a 180-degree arc gauge.
 * Used for physicals like Speed, SB Aggression, SB Ability.
 */

interface HalfDonutGaugeConfig {
  value: number;       // 20-80 scale
  label: string;
  tooltipName?: string;
  size?: number;       // default 80
}

function getGaugeColorClass(value: number): string {
  if (value >= 70) return 'gauge-elite';
  if (value >= 60) return 'gauge-plus';
  if (value >= 45) return 'gauge-avg';
  return 'gauge-poor';
}

function getGaugeColor(value: number): string {
  if (value >= 70) return '#06b6d4';
  if (value >= 60) return '#22c55e';
  if (value >= 45) return '#fbbf24';
  return '#6b7280';
}

export function renderHalfDonutGauge(config: HalfDonutGaugeConfig): string {
  const { value, label, tooltipName, size = 80 } = config;
  const clamped = Math.max(20, Math.min(80, value));
  const displayValue = Math.round(clamped);

  // Map 20-80 to 0-1 fraction
  const fraction = (clamped - 20) / 60;

  const colorClass = getGaugeColorClass(clamped);
  const strokeColor = getGaugeColor(clamped);
  const tooltip = tooltipName ?? label;

  // SVG semicircle arc parameters
  const cx = size / 2;
  const cy = size / 2 + 4; // offset down slightly for visual balance
  const radius = (size / 2) - 8;
  const strokeWidth = size >= 100 ? 9 : 7;

  // Semicircle path (180 degrees, from left to right along the top)
  // Arc from (cx - radius, cy) to (cx + radius, cy) sweeping upward
  const pathD = `M ${cx - radius} ${cy} A ${radius} ${radius} 0 0 1 ${cx + radius} ${cy}`;

  // Semicircle circumference = pi * radius
  const halfCircumference = Math.PI * radius;
  const dashOffset = halfCircumference * (1 - fraction);

  return `
    <div class="half-donut-gauge ${colorClass}" title="${tooltip}: ${displayValue}">
      <svg width="${size}" height="${size / 2 + 12}" viewBox="0 0 ${size} ${size / 2 + 12}">
        <path class="half-donut-arc-bg"
          d="${pathD}"
          fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="${strokeWidth}"
          stroke-linecap="round" />
        <path class="half-donut-arc-fill"
          d="${pathD}"
          fill="none" stroke="${strokeColor}" stroke-width="${strokeWidth}"
          stroke-linecap="round"
          stroke-dasharray="${halfCircumference}"
          stroke-dashoffset="${dashOffset}"
          style="transition: stroke-dashoffset 0.6s ease-out;" />
      </svg>
      <span class="half-donut-value">${displayValue}</span>
      <span class="half-donut-label">${label}</span>
    </div>
  `;
}
