# Batter Profile Modal Redesign

**Date**: February 2026
**Status**: Implemented (v3 — color system, legend toggle, logo watermark)
**Next**: Pitcher profile modal (same pattern, different axes)

---

## Overview

The batter profile modal uses a dual radar chart layout: a 5-axis pentagon for hitting ratings and a 3-axis triangle for running ratings, with projected stat badges radiating from each axis. Header vitals (OVR/POT, Contract, Injury, Personality) sit between the True Rating and Projected WAR emblems with subtle dividers. A faded team logo watermark covers the modal background. Ratings and projections are combined in a single tab.

## Layout Structure

```
+-----------------------------------------------------------------------+
| [          Faded team logo watermark (full modal background)         ] |
|-----------------------------------------------------------------------|
| [Name/Team/Pos/Age] | TR Emblem | OVR/POT  | Personality | Proj WAR  |
|                      |   3.5     | $: ...   | ▲ Leader    |   4.0     |
|                      |           | Inj: Norm| ▼ Greedy    |           |
|-----------------------------------------------------------------------|
| [Ratings]  [Career]  [Development]    <-- 3 tabs                      |
|-----------------------------------------------------------------------|
|  HITTING RATINGS  [My Scout|OSA]  RUNNING RATINGS                     |
|  +--Legend--+--Pentagon--+        +----Triangle----+                   |
|  | TR ●     |  Contact   |        |   SB Ability   |                  |
|  | TFR ●    | [75][.285] |        |   [65][24]     |                  |
|  | Scout ●  |            |        |                |                  |
|  | Proj ●   | Gap  Power |        | Speed  SB Freq |                  |
|  |          |            |        | [55]    [70]   |                  |
|  |          | AvoidK Eye |        | [3B 4] [SB%78] |                  |
|  +----------+------------+        +----------------+                  |
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

### Team Logo Watermark

A large, faded team logo is rendered as a full-modal background watermark behind all content.

**Implementation:**
- Logos stored in `src/images/logos/` as PNG files, named `City_Mascot.png` (e.g., `Toronto_Huskies.png`)
- Loaded at module init via `import.meta.glob('../images/logos/*.png', { eager: true, import: 'default' })` to build a filename→URL lookup map
- `getTeamLogoUrl(teamName)` resolves team name to URL — tries exact match first (e.g., "Toronto Huskies" → `toronto_huskies`), then nickname suffix match (e.g., "Huskies" → finds `toronto_huskies`)
- `<img class="modal-logo-watermark">` placed as first child of `.modal.modal-lg`, positioned absolutely centered

**CSS:**
```css
.modal-logo-watermark {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  height: 720px;
  opacity: 0.009;
  pointer-events: none;
  object-fit: contain;
  filter: blur(2px);
  z-index: 0;
}
```

The `.modal-lg` container needs `position: relative; overflow: hidden;` to anchor and clip the watermark.

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
  onLegendClick?: (seriesName: string, seriesIndex: number) => void;
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
- `onLegendClick` callback — fires on legend item click, used by parent to track hidden series and toggle badge visibility

**Two instances in batter modal:**

| Chart | Categories | Height | Radar Size | Legend | OffsetX | OffsetY |
|-------|-----------|--------|-----------|--------|---------|---------|
| Hitting | Contact, Eye, Power, Gap, AvoidK | 300 | 130 | left, visible | -40 | -10 |
| Running | SB Ability, SB Freq, Speed | 240 | 104 | top, hidden | 0 | 20 |

### 2. Projected Stat Badges

Stacked badges showing a projected stat value on top with a muted label below, positioned near each radar axis. Styled with a warm gold tint to match the "Stat Projections" legend color.

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
| Hitting | Eye (upper-right) | BB% | `projBbPct` or `expectedBbPct(estimatedEye)` |
| Hitting | Power (lower-right) | HR% | `projHrPct` or `expectedHrPct(estimatedPower)` |
| Hitting | Gap (lower-left) | 2B | `projDoublesRate * projAb` or from `estimatedGap` |
| Hitting | AvoidK (upper-left) | K% | `projKPct` or `expectedKPct(estimatedAvoidK)` |
| Running | SB Ability (top) | SB% | `projSb / (projSb + projCs) * 100` |
| Running | SB Freq (lower-right) | SBA | `projSb + projCs` |
| Running | Speed (lower-left) | 3B | `projTriplesRate * projAb` or from `estimatedSpeed` |

Computed by `computeProjectedStats(data)` helper method.

## Color System

Colors are intentionally chosen to convey the nature of each data source:

| Series | Color | Hex | Rationale |
|--------|-------|-----|-----------|
| True Rating | Blue | `#3b82f6` | Confident, authoritative — established data-driven fact |
| True Future Rating | Emerald | `#34d399` | Growth, upside — a bright future |
| Scout | Muted Gray | `#8b949e` | Supporting data, external opinion — not the star |
| Stat Projections | Warm Gold | `#d4a574` | The forecast, the valuable output |

**Badge CSS classes and their colors:**

| Badge Class | Background | Text | Border |
|-------------|-----------|------|--------|
| `.radar-badge-true` | `rgba(59, 130, 246, 0.25)` | `#3b82f6` | `rgba(59, 130, 246, 0.4)` |
| `.radar-badge-tfr` | `rgba(52, 211, 153, 0.2)` | `#34d399` | `rgba(52, 211, 153, 0.35)` |
| `.radar-badge-scout` | `rgba(139, 148, 158, 0.2)` | `#8b949e` | `rgba(139, 148, 158, 0.3)` |
| `.radar-proj-badge` | `rgba(212, 165, 116, 0.10)` | `rgba(212, 165, 116, 0.85)` | `rgba(212, 165, 116, 0.18)` |

## Legend System

### Standard Legend Items (ApexCharts)

True Rating, True Future Rating, and Scout are real ApexCharts series. Clicking them toggles the radar polygon via ApexCharts' built-in `toggleDataSeries`, and the `onLegendClick` callback tracks hidden series in `hiddenSeries: Set<string>` to toggle corresponding axis badges.

### Custom "Stat Projections" Legend Item

Injected into the ApexCharts `.apexcharts-legend` container after chart render via `addProjectionLegendItem()`.

**Key implementation details:**
- Creates a `div.apexcharts-legend-series.custom-legend-proj` with inline-styled marker (16px warm gold circle) and text matching ApexCharts legend styling
- Click handler toggles `'Stat Projections'` in `hiddenSeries`, adds/removes `apexcharts-inactive-legend` class
- Uses `e.stopPropagation()` to prevent ApexCharts from processing the click
- **Must be re-injected after each real legend click** — ApexCharts re-renders the legend DOM on series toggle, destroying the custom element. The `onLegendClick` callback calls `requestAnimationFrame(() => this.addProjectionLegendItem())` to re-inject
- `addProjectionLegendItem()` removes any existing `.custom-legend-proj` before appending (prevents duplicates) and preserves hidden state from `hiddenSeries`

### Badge Visibility (`updateAxisBadgeVisibility`)

Called after any legend toggle. Maps series names to badge CSS classes:

| Hidden Series Name | Badge Class Affected | Scope |
|--------------------|---------------------|-------|
| `'True Rating'` | `.radar-badge-true` | `.ratings-radar-col` only |
| `'True Future Rating'` | `.radar-badge-tfr` | `.ratings-radar-col` only |
| `'My Scout'` or `'OSA Scout'` | `.radar-badge-scout` | `.ratings-radar-col` only |
| `'Stat Projections'` | `.radar-proj-badge` | All (both hitting and running charts) |

### Axis Badge Order

Badges render in order: **True Rating → True Future Rating → Scout** (left to right). TFR only appears when `hasTfrUpside` is true.

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
    <span class="radar-axis-badge radar-badge-tfr">70</span>
    <span class="radar-axis-badge radar-badge-scout">65</span>
  </div>
  <span class="radar-proj-badge ...">...</span>
</div>
```

**Hitting chart axis CSS** (left legend shifts polygon center to ~58%):
- Contact: `top: -10%; left: 59%`
- Eye (upper-right): `top: 28%; right: 10%`
- Power (lower-right): `bottom: 0%; right: 18%`
- Gap (lower-left): `bottom: 0%; left: 38%`
- AvoidK (upper-left): `top: 27%; left: 29%`

**Running chart axis CSS** (no legend, polygon centered, `offsetY: 20` pushes down):
- SB Ability: `top: -15%; left: 50%`
- SB Freq: `bottom: 8%; right: 3%`
- Speed: `bottom: 12%; left: 1%`

### Radar Series Order

1. **True Rating** (blue `#3b82f6`, solid) — always first
2. **True Future Rating** (emerald `#34d399`, dashed, `fillOpacity: 0.05`) — only if `hasTfrUpside`
3. **Scout** (gray `#8b949e`, solid) — labeled "My Scout" or "OSA Scout"

Running chart has a single series: True Rating (blue `#3b82f6`) values for SB Ability, SB Freq, Speed.

### Scout Source Toggle

A My Scout / OSA toggle appears in the "Hitting Ratings" chart header when both scout sources exist. Switching re-renders the entire ratings section (both radar charts) and the projection section, and resets `hiddenSeries`.

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

## Lifecycle & Event Flow

```
show(data)
  → fetch scouting + contracts + league WAR ceiling (parallel)
  → render header (TR emblem, vitals with dividers, WAR emblem)
  → set logo watermark (getTeamLogoUrl → img.src)
  → render body: renderRatingsSection() + renderProjectionContent()
  → bindBodyEvents()
      → bindScoutSourceToggle()
      → initRadarChart() (hitting pentagon)
        → addProjectionLegendItem()
      → initRunningRadarChart() (running triangle)
      → bindTabSwitching()
      → bindProjectionToggle()
      → lockTabContentHeight()

Legend click (real series) → toggle hiddenSeries → updateAxisBadgeVisibility()
  → requestAnimationFrame → re-inject addProjectionLegendItem()
Legend click (Stat Projections) → toggle hiddenSeries → updateAxisBadgeVisibility()
Scout source toggle → re-render ratings + projection sections → re-init both radars
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
| `src/components/RadarChart.ts` | Radar wrapper with `legendPosition`, `showLegend`, `offsetX`, `offsetY`, `onLegendClick` config |
| `src/views/BatterProfileModal.ts` | Dual radar layout, header vitals with dividers, combined ratings+projections tab, projected stat badges, `computeProjectedStats()` helper, custom legend toggle for Stat Projections, logo watermark via `import.meta.glob` |
| `src/styles.css` | Header vitals/dividers, running radar column, chart section labels, proj badges (warm gold), axis positions, projection header row, custom legend item, logo watermark |
| `src/images/logos/*.png` | Team logos (City.png and City_Mascot.png naming convention) |

## What Was Removed (from v1)

- `renderPhysicalsBox()` — half-donut gauges for Speed, SB Aggr, SB Abil (replaced by running radar chart)
- `renderPersonalityBadgesInline()` — replaced by `renderPersonalityVitalsColumn()` in header
- `renderHalfDonutGauge` import — no longer needed
- Separate "Projections" tab — merged into Ratings tab
- `.metadata-header-slot` — replaced by `.header-vitals`
- `.physicals-box`, `.physicals-gauges-row`, `.half-donut-*` CSS — replaced by running radar styles

## Key CSS Classes Reference

### Modal
- `.modal-lg` — `position: relative; overflow: hidden` (anchors watermark)
- `.modal-logo-watermark` — absolutely centered, 720px tall, ~1% opacity, blurred, grayscale

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
- `.running-radar-col` — flex: 0 0 280px, margin-left: -120px (running chart)
- `.radar-chart-wrapper` — position: relative (anchor for axis labels)
- `.chart-section-label` — uppercase muted label above each chart
- `.chart-section-header` — flex row with chart label + scout source toggle

### Radar Axis Labels
- `.radar-axis-label` — positioned absolutely, flex column
- `.radar-axis-name` — category text
- `.radar-axis-badges` — flex row of value badges
- `.radar-axis-badge` — individual badge (tiny pill)
- `.radar-badge-true` / `.radar-badge-tfr` / `.radar-badge-scout` — color variants
- `.radar-axis-top` / `.radar-axis-upper-right` / etc. — hitting chart positions
- `.running-axis-top` / `.running-axis-lower-right` / `.running-axis-lower-left` — running chart positions

### Legend
- `.custom-legend-proj` — injected "Stat Projections" legend item
- `.custom-legend-proj.apexcharts-inactive-legend` — dimmed state when toggled off

### Projected Stat Badges
- `.radar-proj-badge` — stacked badge container (flex column, warm gold tint)
- `.proj-value` — stat number (0.8rem, bold, warm gold)
- `.proj-label` — stat label below (0.6rem, uppercase, muted gold)

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

## Pitcher Modal Adaptation Checklist

When building the pitcher version:

1. **RadarChart** — change categories to pitcher axes (e.g., `['Stuff', 'Movement', 'Control']`). For 3 axes, use triangle positions like the running chart
2. **Projected Stat Badges** — map to pitcher stats (ERA, K/9, BB/9, etc.)
3. **Rating Emblem** — reuse as-is (same TR/TFR scale)
4. **Running Chart** — may not apply to pitchers; replace with stamina/hold chart or omit
5. **Stats Tables** — pitcher stats (W, L, ERA, FIP, K/9, BB/9, HR/9, IP, WAR)
6. **Contract/Personality/Injury** — identical, reuse the header vitals pattern directly
7. **Color system** — use the same palette: blue TR, emerald TFR, gray Scout, warm gold projections
8. **Legend toggle** — reuse `addProjectionLegendItem()` pattern with re-injection on legend click
9. **Logo watermark** — reuse the same `import.meta.glob` map and `getTeamLogoUrl()` resolver; place `<img class="modal-logo-watermark">` as first child of the modal container
10. **Scout source toggle** — reuse My Scout / OSA pattern in chart header
11. **CSS** — most classes scoped to `.batter-profile-modal`; create `.pitcher-profile-modal` equivalents or share via a common parent class
