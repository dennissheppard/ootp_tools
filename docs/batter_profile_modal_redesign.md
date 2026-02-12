# Batter Profile Modal Redesign

**Date**: February 2026
**Status**: Implemented (v2 — dual radar layout)
**Next**: Pitcher profile modal (same pattern, different axes)

---

## Overview

The batter profile modal uses a dual radar chart layout: a 5-axis pentagon for hitting ratings and a 3-axis triangle for running ratings, with projected stat badges radiating from each axis. Header vitals (OVR/POT, Contract, Injury, Personality) sit between the True Rating and Projected WAR emblems with subtle dividers. Ratings and projections are combined in a single tab.

## Layout Structure

```
+-----------------------------------------------------------------------+
| [Name/Team/Pos/Age] | TR Emblem | OVR/POT  | Personality | Proj WAR  |
|                      |   3.5     | $: ...   | ▲ Leader    |   4.0     |
|                      |           | Inj: Norm| ▼ Greedy    |           |
|-----------------------------------------------------------------------|
| [Ratings]  [Career]  [Development]    <-- 3 tabs                      |
|-----------------------------------------------------------------------|
|  HITTING RATINGS                RUNNING RATINGS                       |
|  +--Legend--+--Pentagon--+      +----Triangle----+                    |
|  | TR ●     |  Contact   |      |   SB Aggr      |                    |
|  | TFR ●    | [75][.285] |      |   [65][24]     |                    |
|  | Scout ●  |            |      |                |                    |
|  |          | Gap  Power |      | Speed  SB Abil |                    |
|  |          |            |      | [55]    [70]   |                    |
|  |          | AvoidK Eye |      | [3B 4] [SB%78] |                    |
|  +----------+------------+      +----------------+                    |
|-----------------------------------------------------------------------|
| 2021 PROJECTION (23yo)  [Current] [Peak]                              |
| [full-width stats table with flip cells]                              |
| * Projection note...                                                  |
+-----------------------------------------------------------------------+
```

### Header Layout

The header is a single non-wrapping flex row with dividers:

```
[Title Group] | [TR Emblem] | [Vitals Col] | [Personality Col] | [WAR Emblem]
```

- **TR Emblem**: 100px half-donut arc with score, percentile, and optional TFR upside indicator
- **Vitals Col**: OVR/POT stars, Contract (hover tooltip), Injury badge with label
- **Personality Col**: "Personality:" label with positive traits (green) and negative traits (red) grouped
- **WAR Emblem**: 100px half-donut arc scaled to league leader WAR
- **Dividers**: `<span class="header-divider">` — 1px vertical lines, `rgba(255,255,255,0.1)`

## Shared Components

### 1. RadarChart (`src/components/RadarChart.ts`)

ApexCharts radar wrapper with constructor/render/updateSeries/destroy lifecycle.

**Config:**
```typescript
interface RadarChartConfig {
  containerId: string;
  categories: string[];
  series: RadarChartSeries[];
  height?: number;         // default 300
  radarSize?: number;      // polygon radius in px
  min?: number;            // default 20
  max?: number;            // default 80
  legendPosition?: 'left' | 'top';  // default 'left'
  showLegend?: boolean;    // default true
  offsetX?: number;        // default 0 — shift polygon horizontally
  offsetY?: number;        // default -10 — shift polygon vertically
}

interface RadarChartSeries {
  name: string;
  data: number[];
  color: string;
  dashStyle?: 'solid' | 'dashed';
  fillOpacity?: number;    // default 0.15
}
```

**Key design decisions:**
- `xaxis.labels.show: false` — native labels hidden; custom positioned HTML overlays used instead for color-coded badges and projected stat badges
- `yaxis.show: false` — tick labels removed for cleaner look
- `max: 85` (not 80) — prevents markers at value=80 from sitting on the outer edge where hover/tooltip doesn't trigger
- `dataLabels.enabled: false` — data labels collide on 5-axis radar; badges replace them
- `offsetX` / `offsetY` — shift the polygon center (hitting chart uses `offsetX: -40` to counteract rightward shift from left legend)

**Two instances in batter modal:**

| Chart | Categories | Height | Radar Size | Legend | OffsetX | OffsetY |
|-------|-----------|--------|-----------|--------|---------|---------|
| Hitting | Contact, Power, Eye, AvoidK, Gap | 300 | 130 | left, visible | -40 | -10 |
| Running | SB Aggr, SB Abil, Speed | 240 | 104 | top, hidden | 0 | 20 |

### 2. Projected Stat Badges

Stacked badges showing a projected stat value on top with a muted label below, positioned near each radar axis.

**HTML structure:**
```html
<span class="radar-proj-badge radar-proj-top">
  <span class="proj-value">.285</span>
  <span class="proj-label">AVG</span>
</span>
```

**Badge mapping:**

| Chart | Axis | Proj Stat | Source |
|-------|------|-----------|--------|
| Hitting | Contact (top) | AVG | `projAvg` or `expectedAvg(estimatedContact)` |
| Hitting | Power (upper-right) | HR% | `projHrPct` or `expectedHrPct(estimatedPower)` |
| Hitting | Eye (lower-right) | BB% | `projBbPct` or `expectedBbPct(estimatedEye)` |
| Hitting | AvoidK (lower-left) | K% | `projKPct` or `expectedKPct(estimatedAvoidK)` |
| Hitting | Gap (upper-left) | 2B | `projDoublesRate * projAb` or from `estimatedGap` |
| Running | SB Aggr (top) | SBA | `projSb + projCs` |
| Running | SB Abil (lower-right) | SB% | `projSb / (projSb + projCs) * 100` |
| Running | Speed (lower-left) | 3B | `projTriplesRate * projAb` or from `estimatedSpeed` |

Computed by `computeProjectedStats(data)` helper method.

## Batter-Specific Implementation

### Rating Emblems (TR and WAR)

Both use 100px half-donut arcs in the header. Shrunk from the original 120px to fit the single-row header.

**TR Emblem** — fraction = `ratingValue / 5` (0-5 scale), `strokeWidth: 8`, `radius: 42`
**WAR Emblem** — fraction = `projWar / leagueWarMax` (scaled to league leader), same arc params

Uses CSS custom properties: `--rating-color` for TR tiers, `--war-color` for WAR tiers.

### Radar Axis Labels with Color-Coded Badges

Custom HTML overlays positioned around each radar chart.

**HTML structure per axis:**
```html
<div class="radar-axis-label radar-axis-top">
  <span class="radar-axis-name">Contact</span>
  <div class="radar-axis-badges">
    <span class="radar-axis-badge radar-badge-true">75</span>
    <span class="radar-axis-badge radar-badge-scout">65</span>
    <span class="radar-axis-badge radar-badge-tfr">70</span>
  </div>
  <span class="radar-proj-badge ...">...</span>
</div>
```

**Badge colors (match radar series):**
| Series | Color | Badge Class |
|--------|-------|-------------|
| True Rating | `#1d9bf0` (blue) | `radar-badge-true` |
| True Future Rating | `#f472b6` (pink) | `radar-badge-tfr` |
| Scout | `#f59e0b` (amber) | `radar-badge-scout` |

**Hitting chart axis CSS** (left legend shifts polygon center to ~58%):
- Contact: `top: -10%; left: 59%`
- Power: `top: 28%; right: 10%`
- Eye: `bottom: 0%; right: 18%`
- AvoidK: `bottom: 0%; left: 38%`
- Gap: `top: 27%; left: 29%`

**Running chart axis CSS** (no legend, polygon centered, `offsetY: 20` pushes down):
- SB Aggr: `top: -15%; left: 50%`
- SB Abil: `bottom: 8%; right: 3%`
- Speed: `bottom: 12%; left: 1%`

### Radar Series Order

1. **True Rating** (blue, solid) — always first
2. **True Future Rating** (pink, dashed, `fillOpacity: 0.05`) — only if `hasTfrUpside`
3. **Scout** (amber, solid) — labeled "My Scout" or "OSA Scout"

Running chart has a single series: True Rating values for SR, STE, Speed.

### Combined Ratings + Projections Tab

The Ratings tab contains both the radar charts and the projection table below them.

**Projection header row** (flex, inline):
```
2021 PROJECTION (23yo)  [Current] [Peak]
```

The Current/Peak toggle only appears for players with TFR upside. Switching modes re-renders the projection table with TFR-based rates for Peak mode.

`margin-top: 1.25rem` on `.projection-section` provides spacing between the bottom axis labels and the projection header.

### Tabs

Three tabs: **Ratings**, **Career**, **Development**.

- Ratings: dual radar charts + projection table (with optional Current/Peak toggle)
- Career: historical stats table with flip cells
- Development: lazy-loaded DevelopmentChart with metric toggles

### Contract Tooltip

Hovering the contract info shows a positioned tooltip:
- Each contract year with salary, current year marked with `→` and bold
- Clause flags at bottom: No Trade, Team/Player/Vesting Options
- `$0` salary displays as styled "MLC" badge

### Scout Source Toggle

Currently hidden from UI (removed from `renderRatingsSection`). The underlying `bindScoutSourceToggle()` logic remains intact — it queries DOM for `.scout-header-toggle` and early-returns if not found. Can be re-enabled by adding the toggle HTML back.

## Lifecycle & Event Flow

```
show(data)
  → fetch scouting + contracts + league WAR ceiling (parallel)
  → render header (TR emblem, vitals with dividers, WAR emblem)
  → render body: renderRatingsSection() + renderProjectionContent()
  → bindBodyEvents()
      → initRadarChart() (hitting pentagon)
      → initRunningRadarChart() (running triangle)
      → bindTabSwitching()
      → bindProjectionToggle()
      → bindScoutSourceToggle() (no-op if toggle hidden)
      → lockTabContentHeight()

Projection toggle → re-render projection content only
Tab switch (Ratings/Career/Dev) → show/hide panes; lazy-init DevelopmentChart

hide()
  → destroy RadarChart (hitting)
  → destroy RunningRadarChart (running)
  → destroy DevelopmentChart
  → remove event listeners
  → reset modal position
```

## Files Modified

| File | Changes |
|------|---------|
| `src/components/RadarChart.ts` | Radar wrapper with `legendPosition`, `showLegend`, `offsetX`, `offsetY` config |
| `src/views/BatterProfileModal.ts` | Dual radar layout, header vitals with dividers, combined ratings+projections tab, projected stat badges, `computeProjectedStats()` helper |
| `src/styles.css` | Header vitals/dividers, running radar column, chart section labels, proj badges, axis positions, projection header row |

## What Was Removed (from v1)

- `renderPhysicalsBox()` — half-donut gauges for Speed, SB Aggr, SB Abil (replaced by running radar chart)
- `renderPersonalityBadgesInline()` — replaced by `renderPersonalityVitalsColumn()` in header
- `renderHalfDonutGauge` import — no longer needed
- `hasMyScout` / `hasOsaScout` class fields — scout toggle hidden
- Separate "Projections" tab — merged into Ratings tab
- `.metadata-header-slot` — replaced by `.header-vitals`
- `.physicals-box`, `.physicals-gauges-row`, `.half-donut-*` CSS — replaced by running radar styles

## Key CSS Classes Reference

### Header
- `.header-vitals` — flex container between TR and WAR emblems
- `.vitals-col` — stacked column (OVR/POT, Contract, Injury)
- `.vitals-personality` — personality traits column
- `.personality-traits-group` — flex-wrapped trait badges (positive/negative)
- `.header-divider` — 1px vertical separator line

### Layout
- `.ratings-section` — outer wrapper
- `.ratings-layout` — flex container (hitting radar + running radar)
- `.ratings-radar-col` — flex: 1 1 auto (hitting chart)
- `.running-radar-col` — flex: 0 0 280px, margin-left: -40px (running chart)
- `.radar-chart-wrapper` — position: relative (anchor for axis labels)
- `.chart-section-label` — uppercase muted label above each chart

### Radar Axis Labels
- `.radar-axis-label` — positioned absolutely, flex column
- `.radar-axis-name` — category text
- `.radar-axis-badges` — flex row of value badges
- `.radar-axis-badge` — individual badge (tiny pill)
- `.radar-badge-true` / `.radar-badge-scout` / `.radar-badge-tfr` — color variants
- `.radar-axis-top` / `.radar-axis-upper-right` / etc. — hitting chart positions
- `.running-axis-top` / `.running-axis-lower-right` / `.running-axis-lower-left` — running chart positions

### Projected Stat Badges
- `.radar-proj-badge` — stacked badge container (flex column)
- `.proj-value` — stat number (0.6rem, bold, bright)
- `.proj-label` — stat label below (0.45rem, uppercase, muted)

### Projection Section
- `.projection-section` — wrapper with `margin-top: 1.25rem`
- `.projection-header-row` — flex row with label + toggle inline
- `.projection-toggle` — Current/Peak button group
- `.projection-toggle-btn` / `.projection-toggle-btn.active`

### Emblem
- `.emblem-gauge-wrap` — half-donut arc wrapper
- `.emblem-gauge-score` — large centered score text
- `.emblem-gauge-svg` — the SVG element (100px wide)
- `.emblem-gauge-upside` — TFR upside indicator pill

### Contract
- `.contract-info-hover` — hover trigger wrapper
- `.contract-tooltip` — positioned tooltip with arrow
- `.contract-tooltip-row` / `.contract-tooltip-row.current` — year rows
- `.contract-tooltip-clauses` — clause flags

## Color Palette

| Usage | Color | Hex |
|-------|-------|-----|
| True Rating | Blue | `#1d9bf0` |
| True Future Rating | Pink | `#f472b6` |
| Scout | Amber | `#f59e0b` |
| Proj Badge Value | Light | `rgba(255,255,255,0.8)` |
| Proj Badge Label | Muted | `rgba(255,255,255,0.45)` |
| Proj Badge BG | Subtle | `rgba(255,255,255,0.08)` |
| Header Divider | Subtle | `rgba(255,255,255,0.1)` |

## Pitcher Modal Adaptation Checklist

When building the pitcher version:

1. **RadarChart** — change categories to pitcher axes (e.g., `['Stuff', 'Movement', 'Control']`). For 3 axes, use triangle positions like the running chart
2. **Projected Stat Badges** — map to pitcher stats (ERA, K/9, BB/9, etc.)
3. **Rating Emblem** — reuse as-is (same TR/TFR scale)
4. **Running Chart** — may not apply to pitchers; replace with stamina/hold chart or omit
5. **Stats Tables** — pitcher stats (W, L, ERA, FIP, K/9, BB/9, HR/9, IP, WAR)
6. **Contract/Personality/Injury** — identical, reuse the header vitals pattern directly
7. **CSS** — most classes scoped to `.batter-profile-modal`; create `.pitcher-profile-modal` equivalents or share via a common parent class
