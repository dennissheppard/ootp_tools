# TFR/TR Unification Plan

## Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Unified TFR Availability | **COMPLETED** | Gate check, unified data method, simplified badge logic |
| Phase 2: Component Ceiling Bars | **COMPLETED** | Translucent TFR extension bars on all rating components |
| Phase 3: Projection Toggle | **COMPLETED** | Current/Peak toggle on projection tables |
| Phase 4: Cleanup | **COMPLETED** | Dead code removed, isProspect audited |

---

## Problem Statement

The transition from TFR (True Future Rating) to TR (True Rating) is currently fragmented:
- **Pitchers**: `hasRecentMlb` = any IP in last 2 seasons
- **Batters in search**: PA >= 50 current year
- **Batters in farm rankings**: career AB <= 130
- **Badge display**: starGap < 0.5 (scouting-based)

These are all proxies for the same question — "is this player's projected ceiling still above their current performance?" — but they give inconsistent answers across views. A player can appear as a prospect in one view and an established MLB player in another.

## Unified Model

### Core Rule

**Show TFR alongside TR for any player where TFR > TR. Once TFR <= TR, TFR disappears entirely.**

No more proxy thresholds. The actual ratings comparison is the single source of truth for whether a player has "unrealized upside."

### TFR Calculation Gate

Not every player needs a TFR calculated. Gate check:
- **Age < 26**, OR
- **Star gap (POT - OVR) >= 0.5**

If a player fails this gate, we skip TFR calculation entirely. If a 28-year-old with a 0.3 star gap would theoretically have TFR > TR, we accept that miss — that's a late bloomer / missed projection.

### What `isProspect` Still Controls

`isProspect` remains but is narrowed to **list eligibility contexts only**:
- Farm Rankings (Top 100, team prospect lists)
- Prospect-specific filters/views
- Development tab mode (scout snapshots vs TR history chart)
- Projection pipeline decisions (peak vs current-year model)

`isProspect` does **NOT** control:
- Whether TFR is shown on modal/badge/bar charts (that's `hasTfrUpside`)
- Whether Peak badge appears (that's `hasTfrUpside && TFR - TR >= 0.25`)

### Player Lifecycle

```
Stage 1: Pure scouting (draftee / international FA)
  - No stats at all
  - TFR from 100% scouting ratings
  - No TR (undefined)
  - Show: TFR only

Stage 2: Minor league blend
  - Has minor league stats
  - TFR from scouting + minors blend (component-weighted)
  - No TR (undefined) — or minimal if brief MLB cameo
  - Show: TFR only (or TFR + nascent TR if TR exists)

Stage 3: Emerging MLB player (TFR > TR)
  - Has MLB stats, TR is calculable but still climbing
  - TFR likely > TR (projected ceiling above current performance)
  - Show: BOTH — TR as primary, TFR as ceiling/upside
  - Peak projection available alongside current-year projection

Stage 4: Fully realized (TFR <= TR)
  - Player has met or exceeded projected ceiling
  - TFR disappears from all displays
  - Show: TR only
  - No peak projection (not needed)
```

---

## Phase 1+2: Unified TFR + Ceiling Bars (COMPLETED)

### Changes Made

**`src/services/TeamRatingsService.ts`**
- New `getUnifiedHitterTfrData(year)` method with expanded gate check (`age < 26 OR starGap >= 0.5`)
- Replaces old `careerAb <= 130 && parentTeamId != 0` filter
- Returns all TFR-eligible players with `isFarmEligible` flag on each
- `getHitterFarmData()` refactored as wrapper that filters to `isFarmEligible` only
- Farm Rankings reports/systems built from farm-eligible subset only

**`src/views/PlayerRatingsCard.ts`**
- Added `hasTfrUpside`, `tfrStuff`, `tfrControl`, `tfrHra` to `PlayerRatingsData`
- Removed `starGap` from interface (dead after badge simplification)
- Badge logic simplified to: `hasTr` → show TR; `!hasTr && hasTfr` → show TFR
- Removed: `isFullyDeveloped`, `starGap` checks, DEBUG console.log
- `renderRatingBar()` accepts optional `ceiling` param → renders `.bar-ceiling` extension
- Peak badge uses `data.hasTfrUpside && TFR - TR >= 0.25`

**`src/views/BatterProfileModal.ts`**
- Added `hasTfrUpside`, `tfrPower/Eye/AvoidK/Contact/Gap/Speed` to `BatterProfileData`
- `renderRatingEmblem()` uses `!hasTr && hasTfr` (not `isProspect`)
- Peak indicator when `hasTfrUpside && hasTr && hasTfr && TFR - TR >= 0.25`
- `renderRatingBarComparison()` and `renderAdvancedRatingComparison()` accept `ceiling` param

**`src/views/TrueRatingsView.ts`**
- `buildBatterProspectRows()` uses `getUnifiedHitterTfrData()`, caches full pool
- `openBatterProfile()` looks up unified data for TFR ceiling on both prospects and MLB players
- Prospects get `trueRating: undefined` (badge logic shows TFR via `trueFutureRating`)
- MLB players get `hasTfrUpside` + TFR component ratings when TFR > TR
- Pitcher prospects get `tfrStuff/tfrControl/tfrHra` from farm data

**`src/views/FarmRankingsView.ts`**
- `openHitterProfile()` sets `trueRating: undefined`, `hasTfrUpside: true`, all TFR component fields
- Pitcher modal gets `tfrStuff/tfrControl/tfrHra` + `hasTfrUpside: true`

**`src/views/GlobalSearchBar.ts`**
- Uses `getUnifiedHitterTfrData()` for both prospects and MLB batters
- Prospects get `trueRating: undefined`; TFR ceiling fields passed through
- Removed dead `starGap` passthrough to pitcher modal

**`src/views/PlayerProfileModal.ts`**
- Young pitcher TFR bootstrap: removed dead `data.starGap` assignment
- Now sets `hasTfrUpside`, `tfrStuff/tfrControl/tfrHra` after on-the-fly TFR calc

**`src/styles.css`**
- `.bar-ceiling` class: absolute positioned, 35% opacity, dashed left border
- Color variants (rating-elite through rating-poor) for both global and batter-profile-modal scopes

---

## Phase 3: Projection Toggle (COMPLETED)

**Goal**: Show both current-year and peak projections for players with TFR > TR.

### Who Gets the Toggle

Only players where `data.hasTfrUpside === true && data.trueRating !== undefined` — i.e., has both TR and TFR, and TFR > TR. Pure prospects already show peak-only. Fully realized players show current-only.

### Changes Made

**`src/views/BatterProfileModal.ts`**
- Added `projectionMode: 'current' | 'peak'` state (resets to `'current'` on `show()`)
- Added `currentStats` property to enable re-rendering projection section on toggle
- `renderProjection()` modified:
  - Determines `showToggle` from `data.hasTfrUpside && data.trueRating !== undefined`
  - In peak mode: uses TFR component ratings (`tfrPower/Eye/AvoidK/Contact/Gap/Speed`), age 27, peak PA, no "Actual" comparison row
  - In current mode: existing behavior unchanged
  - Flip cells show "TFR" or "Estimated" label depending on mode
  - Renders `<div class="projection-toggle">` with Current/Peak buttons when `showToggle`
- Added `bindProjectionToggle()`: click → update `projectionMode` → re-render projection section via `outerHTML` swap → re-bind toggle + flip card events

**`src/views/PlayerProfileModal.ts`**
- Added `projectionMode`, `currentProjectionHtml`, `peakProjectionHtml` state (all reset on `show()`)
- Peak projection pre-computed in `show()` after current projection:
  - Calls `projectionService.calculateProjection()` with TFR ratings (`tfrStuff/tfrControl/tfrHra`), age 26 (service adds 1 → 27), year 2020 league context for consistent FIP baseline
  - Stored as pre-rendered HTML string for instant toggling (pitcher projections are async)
- `renderProjection()` accepts `showToggle` param → renders toggle buttons, suppresses year selector when toggle shown
- Added `bindProjectionToggle()`: swaps pre-computed HTML strings on click, re-binds events

**`src/styles.css`**
- Added `.projection-toggle` (inline-flex container with border) and `.projection-toggle-btn` (active state uses `--color-primary`)

### Ceiling Bar Value Labels (Revised Feb 2026)

Rating bars with TFR upside show two separate values:
- **TR value**: shown inside the colored TR bar portion (`.bar-value-inner` child of `.bar-estimated`)
- **TFR value**: shown at the end of the bar container (standard `.bar-value` at `right: 8px`)
- **Diff column**: compares TFR vs Scout (both are peak projections), not current TR vs Scout

This applies to:
- `BatterProfileModal.renderRatingBarComparison()` (main: Contact, Power, Eye)
- `BatterProfileModal.renderAdvancedRatingComparison()` (expanded: Gap, AvoidK)
- `PlayerRatingsCard.renderRatingBar()` (TrueRatings table view for pitchers)

CSS: `.bar-value-inner` positioned inside `.bar-estimated` (which has `position: relative`), `.bar-estimated` must have `position: relative` in both generic and batter-modal scoped CSS

---

## Phase 4: Cleanup (COMPLETED)

### What Was Done

- **Removed from badge logic**: `isFullyDeveloped`, `starGap` checks, DEBUG logging
- **Removed from PlayerRatingsData**: `starGap` field (dead after badge simplification)
- **Removed from callers**: `starGap` passthrough in GlobalSearchBar, StatsView, TrueRatingsView pitcher path
- **Fixed TradeAnalyzerView**: Updated to use `trueRating: undefined` for prospects + TFR ceiling fields
- **Fixed PlayerProfileModal**: Removed dead `data.starGap` set, added `hasTfrUpside` + TFR ceiling fields

### What Was Audited and Kept

- **`isProspect`**: All remaining usages are legitimate list eligibility or data-flow control:
  - TrueRatingsView: table filtering (MLB vs prospect rows), sorting, CSS classes, prospect badge
  - BatterProfileModal/PlayerProfileModal: Development tab mode, WAR label, projection pipeline
  - ProjectionsView: projection filtering
  - FarmRankingsView/TeamRatingsView/DevTrackerView: hardcoded true/false for view type
  - ProjectionService: projection pipeline decisions
- **`hasRecentMlb`**: All usages in ProjectionService and PlayerProfileModal are projection pipeline decisions (IP projections, SP/RP role, projection mode), not display logic. Kept.
- **`starGap` (local vars)**: Still used in PlayerProfileModal and ProjectionService for `isQualityProspect` calculations. These are projection pipeline decisions, not display. Kept.

---

## Data Flow (Post-Unification)

```
Player opens modal
  │
  ├─ Calculate TR (if has MLB stats)
  │
  ├─ Gate check: age < 26 OR starGap >= 0.5?
  │   ├─ YES → Calculate TFR (via getUnifiedHitterTfrData / on-the-fly)
  │   │   ├─ TFR > TR? → hasTfrUpside = true
  │   │   │   ├─ Badge: show TR star + "Peak" with TFR value
  │   │   │   ├─ Bars: TR solid (value inside) + TFR ceiling extension (value at end), diff = TFR vs Scout
  │   │   │   └─ Projections: Current/Peak toggle (peak uses TFR blended rates directly)
  │   │   └─ TFR <= TR? → hasTfrUpside = false
  │   │       ├─ Badge: show TR star only
  │   │       ├─ Bars: TR solid only
  │   │       └─ Projections: current only
  │   └─ NO → Skip TFR entirely
  │       ├─ Badge: show TR star only
  │       ├─ Bars: TR solid only
  │       └─ Projections: current only
  │
  └─ No MLB stats? (TR undefined)
      ├─ Has scouting? → TFR only
      │   ├─ Badge: show TFR star
      │   ├─ Bars: TFR component values (these ARE the ceiling)
      │   └─ Projections: peak only
      └─ No scouting? → Error state
```

## Open Questions

1. **Projections page visibility**: There's a separate bug where a called-up rookie leading ROY voting doesn't appear on the Projections page. This should be investigated independently — likely a filtering issue where `isProspect` excludes him from a view he should be on. -
USER ANSWER: Let's wait on this until after this plan is completed and then see about the bug.

2. **TFR calculation cost**: Currently TFR is only calculated for farm-eligible players. Expanding to all gate-eligible players means more computation. Need to verify performance is acceptable, especially if recalculating on modal open. May want to cache broadly in TeamRatingsService.
USER ANSWER: Caching is always preferred, but calculations have never shown more than ms of delay. Any delay has been loading things from the s+ API or into IndexedDB (*out* of indexeddb, i'm not sure on performance)

3. **Historical TFR**: The new Development tab shows historical TR (just implemented). Should it also show historical TFR trajectory for players with upside? Probably not — we don't have historical scouting data, so historical TFR can't be calculated. Current-year TFR vs historical TR is the best we can do.
USER ANSWER: Correct, we don't have scouting data, so can't do that, but it might be something we implement in the future when/if we make this whole app league agnostic, and/or we have historical scouting data for this league

---

## Post-Completion Fixes (Feb 2026)

### Bar Display Overhaul
- **Old**: Single `30 → 55` arrow label at bar end
- **New**: TR value inside the colored bar; TFR value at the container's right edge (like scouting bars)
- **Diff column**: Now compares TFR vs Scout (both peak projections) instead of current TR vs Scout
- Removed: `.bar-value-ceiling` CSS class, `has-ceiling` overflow hack
- Added: `.bar-value-inner` (child of `.bar-estimated`), `.bar-estimated { position: relative }`

### Peak Projection: Use TFR Blended Rates Directly
- **Problem**: Peak projection converted TFR 20-80 ratings back to rates via regression formulas (`expectedBbPct(eye)`, `expectedAvg(contact)`, etc.). This was lossy — the TFR ratings come from percentile ranking, not the same formulas. Result: Power 29 (current) with 1.6% HR could show Power 35 (TFR) with only 1.2% HR.
- **Fix**: Added `tfrBbPct`, `tfrKPct`, `tfrHrPct`, `tfrAvg`, `tfrObp`, `tfrSlg`, `tfrPa` fields to `BatterProfileData`. These are the actual blended rates from the TFR pipeline — the same rates that determine the TFR star rating.
- Peak projection now uses these rates directly instead of reverse-engineering from 20-80 ratings.
- Also uses empirical PA (from `tfrPa`, e.g. 640 for Normal) instead of old `getProjectedPa()` (which returned 600).
- **Files**: `BatterProfileModal.ts` (interface + renderProjection), `TrueRatingsView.ts` (openBatterProfile), `GlobalSearchBar.ts`

### ISO Calculation Fix
- **Problem**: `expectedIso(power)` was deprecated and only used HR for ISO, ignoring Gap/Speed entirely. A doubles machine with Gap=78 would get ISO=.086 instead of correct ~.140.
- **Fix**: ISO now computed from all XBH components: `ISO = doublesRate + 2*triplesRate + 3*hrPerAb`. This is used in the fallback projection path (when pre-computed rates aren't available) and the badge WAR calculation.
- The peak projection path now bypasses this entirely by using `tfrSlg` directly from the pipeline.

4. **Component ceiling when no TR exists**: For pure prospects (no MLB stats), the bar chart shows scouting values. There's no TR to compare against, so no "ceiling" extension. The scouting values ARE the projection. This is fine — ceiling bars only make sense when both TR and TFR exist.
USER ANSWER: I think in this case we *only* show the ceiling? I guess whatever we currently do, as I think that is already kind of the current ceiling, and we can revisit that after.
