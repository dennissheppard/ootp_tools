# Top 100 Prospect Ranking — Calibration Analysis & Plan

## Background / Context

This document captures a multi-session investigation into why the combined Top 100 prospect list
(Farm Rankings view, "Top 100" mode with both Pitchers + Hitters enabled) shows a disproportionate
pitcher/hitter split, and what the correct path forward is.

---

## How the Combined Top 100 Is Built

`FarmRankingsView.ts` — `renderCombinedProspectsTable()`:

1. Pitchers come from `TeamRatingsService.getFarmData()` → `this.data.prospects`
2. Hitters come from `TeamRatingsService.getHitterFarmData()` → `this.hitterData.prospects`
3. All are merged into a single `UnifiedProspect[]` array
4. Sorted and ranked — **current sort: TFR desc, then within-pool `percentile` desc as tiebreaker**
5. Top 100 of that merged list displayed

Key fields per unified prospect:
- `tfr` — TFR star rating (0.5–5.0, discrete 0.5 steps)
- `peakWar` — pitcher's `peakWar`; hitter's `projWar`
- `percentile` — **within-pool percentile vs MLB distribution** (NOT prospect-vs-prospect rank)

---

## Two Separate Problems (Don't Conflate Them)

### Problem 1 — TFR tier clumping (ADDRESSED, maybe needs refinement)

Within each TFR tier (e.g. all 5.0★ players), a secondary sort is needed to interleave
pitchers and batters. We tried WAR → caused all pitchers to sink within tier because batter
WAR skews higher. Then switched to `percentile` → caused all pitchers to float to top of
tier because of Problem 2 below.

**Current state:** sort by TFR desc, then `percentile` desc. Imperfect but reasonable.

### Problem 2 — Percentile saturation (ROOT CAUSE, not yet fixed)

This is the core calibration issue. The `percentile` field means different things for pitchers
vs hitters:

| | Pitchers | Hitters |
|-|-|-|
| Metric | Projected FIP | Projected WAR/600 PA |
| Compared against | MLB FIP distribution (2015–2020, ages 25–29, 50+ IP) | MLB WAR distribution (2015–2020, ages 25–29, 300+ PA) |
| Ceiling boost | 0.30 | 0.35 |
| Saturation symptom | Top ~10 pitchers all 100th percentile | Top hitter only 99th percentile |

**Why pitchers saturate at 100th:** The 0.30 ceiling boost pushes projected FIP below the
historical minimum FIP in the MLB dataset. When `projFip < min(mlbDist.fipValues)`,
`findValuePercentileInDistribution` returns 100.0. Multiple pitchers with good scouting can
all fall below that floor simultaneously.

**Why hitters don't reach 100th:** The 0.35 boost pushes projected WAR up, but the top of
the MLB WAR distribution (multiple players with 8+ WAR seasons) provides a real ceiling
that top hitter prospects don't consistently exceed. So the best hitter projections land at
~99th, not 100th.

**Why this matters for the combined list:** With TFR as primary sort and percentile as
tiebreaker, all 100th-percentile pitchers float above all 99th-percentile hitters within
the same TFR tier → top 10+ players are all pitchers.

---

## What Was Done (Feb 2026)

### Findings from diagnostic logging

WBL MLB FIP distribution (508 pitchers, ages 25-29, 2015-2020):
- min=2.53, p5=3.31, p25=3.89, p50=4.37, p75=4.75, p97=5.72, max=7.01
- The distribution is right-skewed with very few seasons below 3.0 (≤5 pitchers with FIP ≤ 2.85)

Top prospect FIPs at the time: 2.16, 2.49, 2.61, 2.61, 2.69 (top 5)
- Two pitchers (Ruben Calle 80/75/80, Bong-hwan Park 65/75/80) below the 2.53 distribution min → 100th percentile

### Step 1 — Fixed projHr9 clamp floor

Changed `Math.max(0.15, ...)` → `Math.max(0.20, ...)` in `calculateTrueFutureRatings()`.
The MLB distribution filter uses `hr9 >= 0.2`, so allowing 0.15 caused automatic 100th-percentile HRA for any prospect with HRA ≥ 75.

### Step 2 — Reduced pitcher ceiling boost

`CEILING_BOOST` 0.30 → **0.27**. Targets Park (65/75/80): projFIP moves from 2.49 to ~2.53,
just inside the distribution. Note: Calle (80/75/80) projects below 2.53 even at B=0 — raw
scouting alone exceeds the distribution for this profile.

### Step 3 — projFIP floor

Added `effectiveFip = Math.max(fipDistMin, result.projFip)` before the percentile lookup.
Caps any out-of-bounds pitcher at ~99.8th percentile instead of literally 100th. Necessary
for profiles like Calle that no boost reduction can fix.

### Step 4 — Expanded MLB distribution age range

Changed pitcher and hitter distribution age filters from 25-29 to **25-32**. WBL pitchers
and hitters age gracefully; extending the range adds more elite seasons to the dataset
(~700+ vs ~500 pitcher-seasons), reducing top-end sparsity. Same years (2015-2020).

### Remaining open issue

The WBL FIP distribution is inherently sparse at the elite end — even with 25-32, pitchers
with strong multi-tool profiles (80 stuff + 80 HRA) legitimately land at 99th+ percentile
because very few real WBL peak-age pitchers achieve FIP < 3.0. This means pitcher prospects
still cluster near the top of the combined list. Accepted for now. Options deferred to post-1.0:
- Within-pool normalized rank as cross-pool tiebreaker
- Position-adjusted WAR (requires defensive rating validation)

---

## What Was Decided and Why

### Position-adjusted WAR — deferred to post-1.0

Traditional WAR uses positional run adjustments (SS +7 runs, 1B -12 runs, etc.) plus a
separate defensive component. For prospects this creates two problems:

1. You'd be applying a positional label bonus without any defensive quality data — a
   poor-defending SS who will clearly move to 3B gets the same SS premium as a great
   defender.
2. OOTP defensive ratings have no current/potential split and likely change silently over
   time (unconfirmed but suspected). Building on that data requires empirical validation
   first (does range at 19 predict range at 27?).

Professional publications (BA, BP, FanGraphs) handle this through projection judgment —
scouts project the player to their most likely long-term position and grade from there.
That's not automatable without position-projection logic we don't have.

**Decision:** Defer fielding entirely to post-1.0. Ship the combined list with the ceiling
boost calibration fix as the improvement. Add a note in the UI that positional value is not
yet incorporated in rankings.

### Reliever ranking — WAR already handles this correctly

A 5.0 TFR closer projects maybe 2.0–2.5 peak WAR (penalty from low IP). A 4.0 TFR starter
projects 4.0+ WAR. Pro rankings heavily discount relievers — this matches what WAR produces
naturally. No special reliever treatment needed.

### Combined sort — current state

Primary: TFR desc. Tiebreaker: percentile desc.

This is reasonable as a stated philosophy ("ranked by ceiling tier, tiebroken by
within-pool peer quality") but depends on Problem 2 being fixed — if pitchers still
saturate at 100th, percentile is not a legitimate tiebreaker.

Once ceiling boosts are calibrated (Problem 2 fixed), this sort should produce clean,
naturally interleaved results.

---

## Relevant Files

| File | What changed |
|-|-|
| `src/services/TrueFutureRatingService.ts` | `CEILING_BOOST` 0.30→0.27; projHr9 clamp 0.15→0.20; projFIP floor at dist min; age filter 25-29→25-32; distribution cache |
| `src/services/HitterTrueFutureRatingService.ts` | Age filter 25-29→25-32; distribution cache |
| `src/views/FarmRankingsView.ts` | No changes needed |
