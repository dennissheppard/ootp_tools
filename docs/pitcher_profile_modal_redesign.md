# Pitcher Profile Modal Redesign

**Date**: February 2026
**Status**: Implemented (v1 — mirrors batter modal layout)
**Based on**: Batter Profile Modal v3

---

## Overview

The pitcher profile modal mirrors the batter modal's dual radar chart layout. A 3-axis triangle for Stuff/Control/HRA replaces the 5-axis hitting pentagon, with a variable-axis arsenal radar chart and stamina half-donut gauge on the right side. Header, color system, legend, watermark, and tabs are identical to the batter modal.

## Layout Structure

```
+-----------------------------------------------------------------------+
| [          Faded team logo watermark (full modal background)         ] |
|-----------------------------------------------------------------------|
| [Name/Team/Pos/Age] | TR Emblem | OVR/POT  | Injury   | Proj WAR    |
|                      |   3.2     | $: ...   | Norm     |   3.0       |
|-----------------------------------------------------------------------|
| [Ratings]  [Career]  [Development]    <-- 3 tabs                      |
|-----------------------------------------------------------------------|
|  PITCHING RATINGS [My Scout|OSA]     ARSENAL (4)    STAMINA           |
|  +--Legend--+--Triangle--+           +--Radar---+   +--Gauge--+       |
|  | TR ●     |   Stuff    |           |  FB      |   | ◠ 62    |      |
|  | TFR ●    |  [72][K/9] |           |          |   |  STA    |      |
|  | Scout ●  |            |           | SL    CH |   +---------+      |
|  | Proj ●   | Ctrl   HRA |           |     CB   |   → IP: 185       |
|  |          | [65]  [58] |           +---------+                     |
|  |          |[BB/9][HR/9]|                                            |
|  +----------+------------+                                            |
|-----------------------------------------------------------------------|
| 2026 PROJECTION (25yo)  [Current] [Peak]                              |
| [IP] [FIP] [K/9] [BB/9] [HR/9] [WAR]                                |
+-----------------------------------------------------------------------+
```

## What Copies Directly from Batter Modal

- **Header row** — identical structure: TR Emblem | Vitals | WAR Emblem (no personality for pitchers — scouting data doesn't include it)
- **Logo watermark** — same `getTeamLogoUrl()` + CSS
- **Color system** — same 4-color palette (blue TR, emerald TFR, gray Scout, warm gold projections)
- **Legend system** — same pattern including custom "Stat Projections" item + re-injection on legend click
- **Scout source toggle** — same My Scout / OSA pattern
- **Tabs** — same 3-tab structure (Ratings, Career, Development)
- **Contract tooltip** — same hover tooltip with year-by-year breakdown
- **OVR/POT stars** — same half/full star rendering
- **Emblem arcs** — same half-donut SVG for TR and WAR
- **Flip cells** — same hover-to-reveal rating-behind-stat pattern
- **Dragging** — same drag-to-reposition behavior
- **RadarChart component** — reuses same ApexCharts wrapper

## Pitcher-Specific Design

### Position Badge

Uses `determinePitcherRole()` from `Player.ts` to show SP/SW/RP based on pitch count, stamina, and role data. Styled with `.pos-pitcher` class (blue tint).

### Pitching Ratings Triangle (Left Side)

3-axis radar chart for Stuff, Control, HRA — same position as the batter's pentagon.

**Configuration:**

| Setting | Value |
|---------|-------|
| Categories | Stuff, Control, HRA |
| Height | 300px |
| Radar Size | 120px |
| Legend | left, visible |
| OffsetX | -40 |
| Min/Max | 20/85 |

**Series (same order as batter):**
1. True Rating (blue `#3b82f6`, solid)
2. True Future Rating (emerald `#34d399`, dashed) — only if `hasTfrUpside`
3. Scout (gray `#8b949e`, solid) — "My Scout" or "OSA Scout"

**Projected Stat Badges:**

| Axis | Proj Stat | Formula |
|------|-----------|---------|
| Stuff (top) | K/9 | `(estimatedStuff + 28) / 13.5` |
| Control (lower-right) | BB/9 | `(100.4 - estimatedControl) / 19.2` |
| HRA (lower-left) | HR/9 | `(86.7 - estimatedHra) / 41.7` |

Formulas are inversions of `RatingEstimatorService` rating estimation formulas.

### Arsenal Radar Chart (Right Side)

Variable-axis radar chart showing pitch ratings — purely informational, like the batter's running triangle.

**Key characteristics:**
- **Single series only** — shows pitch ratings (blue `#1d9bf0`), no TR/TFR/Scout layering
- **Not connected to legend toggles** — independent of the main legend system
- **Variable axes** — 2-7 axes depending on pitcher's arsenal
- **No projected stat badges** — pitches don't map to projections
- Shows a pitch count badge in the section header

**Configuration:**

| Setting | Value |
|---------|-------|
| Height | 200px |
| Radar Size | 80px |
| Legend | top, hidden |
| OffsetY | 10 |
| Min/Max | 20/85 |

Pitches are sorted by rating descending. Only pitches rated 25+ are shown.

### Stamina Half-Donut Gauge

Standalone gauge using the existing `HalfDonutGauge` component, displayed below the arsenal chart.

- Shows stamina rating on 20-80 scale
- Paired with a warm gold projected IP badge
- IP estimated from stamina + injury proneness via `estimateIp()`:
  - STA 65-80 → 180-202 IP base
  - STA 50-65 → 120-180 IP base
  - STA 35-50 → 65-120 IP base
  - STA 20-35 → 40-65 IP base
  - Multiplied by injury factor (Ironman 1.05x → Wrecked 0.65x)

### Projection Table

| Column | Source |
|--------|--------|
| IP | From stamina/injury estimate |
| FIP | Computed from K/9, BB/9, HR/9 |
| K/9 | From estimated Stuff |
| BB/9 | From estimated Control |
| HR/9 | From estimated HRA |
| WAR | `(avgFip - projFip) / runsPerWin * (projIp / 200) * 10` |

Current/Peak toggle available when player has TFR upside.

### Career Stats Table

| Column | Notes |
|--------|-------|
| Year | Season year |
| Level | MLB/AAA/AA/A/R badge |
| IP | Innings pitched |
| FIP | Fielding Independent Pitching |
| K/9 | Flip cell → estimated Stuff |
| BB/9 | Flip cell → estimated Control |
| HR/9 | Flip cell → estimated HRA |
| WAR | MLB only, minor league shows — |

## CSS Architecture

All styles scoped to `.pitcher-profile-modal` — parallel structure to `.batter-profile-modal`.

**Key class differences from batter:**

| Batter Class | Pitcher Equivalent |
|-------------|-------------------|
| `.ratings-radar-col` | `.ratings-radar-col` (same) |
| `.running-radar-col` | `.arsenal-col` |
| `.running-radar-wrapper` | `.arsenal-radar-wrapper` |
| `.radar-axis-top` (5-axis) | `.pitching-axis-top` (3-axis) |
| `.radar-axis-upper-right` | `.pitching-axis-lower-right` |
| `.radar-axis-lower-left` | `.pitching-axis-lower-left` |

**New classes:**
- `.arsenal-section` — wraps the pitch radar chart
- `.stamina-section` — wraps the stamina gauge
- `.stamina-gauge-row` — flex row with gauge + IP badge
- `.stamina-ip-badge` — projected IP badge (excluded from legend hide)
- `.pitch-count-badge` — small blue count indicator in arsenal header
- `.pos-pitcher` — position badge styling for SP/SW/RP

## Files Modified

| File | Changes |
|------|---------|
| `src/views/PitcherProfileModal.ts` | New file — full pitcher profile modal with dual radar layout, header vitals, projections, career stats, development tab |
| `src/views/index.ts` | Added `export * from './PitcherProfileModal'` |
| `src/styles.css` | Added `.pitcher-profile-modal` styles block (~400 lines) at end of file |

## Integration

The modal is exported as a singleton `pitcherProfileModal` with the same API as the batter modal:

```typescript
import { pitcherProfileModal, PitcherProfileData } from '../views/PitcherProfileModal';

// Open pitcher profile
await pitcherProfileModal.show(pitcherData, selectedYear);

// Close
pitcherProfileModal.hide();
```

The `PitcherProfileData` interface accepts all the same fields the existing pitcher views already provide (estimatedStuff/Control/HRA, scout data, TFR data, projections, etc.).

## Lifecycle & Event Flow

```
show(data)
  → fetch scouting (my + osa) + contracts + league WAR ceiling (parallel)
  → render header (TR emblem, vitals, WAR emblem)
  → set logo watermark
  → fetch MLB stats (getPlayerYearlyStats) + minor league stats
  → render body: renderRatingsSection() + renderProjectionContent()
  → bindBodyEvents()
      → bindScoutSourceToggle()
      → initRadarChart() (pitching triangle)
        → addProjectionLegendItem()
      → initArsenalRadarChart() (pitch arsenal)
      → bindTabSwitching()
      → bindProjectionToggle()
      → lockTabContentHeight()

Legend click → toggle hiddenSeries → updateAxisBadgeVisibility()
  → requestAnimationFrame → re-inject addProjectionLegendItem()
Scout source toggle → re-render ratings + projection → re-init both radars
Projection toggle → re-render projection content only
Tab switch → show/hide panes; lazy-init DevelopmentChart

hide()
  → destroy RadarChart (pitching)
  → destroy ArsenalRadarChart (arsenal)
  → destroy DevelopmentChart
  → reset modal position
```
