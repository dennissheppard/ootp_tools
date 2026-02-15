# TFR Ceiling Fix — February 2026

## Problem
Batter prospect TFR was maxing out at 4.0 stars (97th percentile). The best batting
prospects couldn't reach 4.5 or 5.0 TFR. Three root causes were identified and fixed.

## Root Cause 1: MiLB Stats Blended Into TFR (Conceptual Error)
TFR is a **ceiling/peak** projection ("if everything goes right"). Scout POTENTIAL
ratings define the ceiling. But the TFR pipeline was blending MiLB stats into
projections — AvoidK used 40-65% scouting, Power used 75-85% scouting.

This meant a prospect with 80 power potential who was only hitting 2% HR in AA
had their *ceiling* dragged down — but the ceiling hasn't changed, the player just
hasn't developed yet. MiLB performance belongs in **TR** (development curves),
not **TFR** (ceiling projection).

**Fix:** Set all component scouting weights to 100% in both
`HitterTrueFutureRatingService.calculateComponentBlend()` and
`TrueFutureRatingService.calculateComponentBlend()`.

## Root Cause 2: Comparing Projections to Actual Outcomes (Apples-to-Oranges)
The old code ranked prospect WAR among other prospects (best always got 5.0).
The new code (uncommitted on `age-column-fix` branch) compared projected WAR/600
against actual MLB peak-age WAR/600 (ages 25-29, 300+ PA, 2015-2020).

Problem: projections are **expected values** (compressed toward mean), while actual
outcomes include **variance** (hot streaks, extreme seasons). The MLB distribution
goes up to 10.5 WAR/600, but projections from scout ratings max at ~7-8 WAR/600.
The regression coefficients produce mean outcomes, not peak outcomes.

**Fix:** Added `CEILING_BOOST_FACTOR` (currently 0.35 for batters, 0.30 for pitchers)
that scales up projections proportionally to how far above average each component is:
```
ceilingValue = meanValue + (meanValue - avgAtRating50) * CEILING_BOOST_FACTOR
```
At rating 50 (average): no boost. At rating 80 (elite): significant boost.
This models "if everything goes right" more literally.

Also widened rate clamps for ceiling projections:
- Batter: AVG max .350→.380, HR% max 8→10%, BB% max 20→22%
- Pitcher: K/9 max 11→13, BB/9 min 0.85→0.50, HR/9 min 0.20→0.15

## Root Cause 3: Hardcoded League Averages in MLB Distribution
The MLB WAR distribution used hardcoded `lgWoba=0.315, wobaScale=1.15, runsPerWin=10`
while prospect WAR used game-specific `leagueBattingAverages`. Fixed by passing
`leagueBattingAverages` through to `buildMLBHitterPercentileDistribution()`.
(Turned out the game values matched defaults, so no actual impact for this user.)

## Current State (Batter TFR — Good)
With 35% ceiling boost, batter distribution looks healthy:
- ~8 prospects at 5.0 TFR
- 4.0 starts at ~#19
- 3.5 at ~#39-100
- MLB WAR/600 distribution: p50=2.1, p90=5.3, p97=6.7, p99=7.6, max=10.5

## Current State (Pitcher TFR — FIXED)
Pitcher TFR inflation had two root causes, both resolved:

### Root Cause A: Prospect-vs-Prospect Ranking (Architecture Bug)
The pitcher pipeline ranked prospects among each other by component, then mapped
those percentile ranks to MLB distributions. The ceiling boost is a linear transform
that preserves rank order, so it had **zero effect** on TFR regardless of value.
This also created a "combining unicorn" problem — the #1 prospect in K/9 got the
best MLB K/9, the #1 in BB/9 got the best MLB BB/9, and the #1 in HR/9 got the
best MLB HR/9 simultaneously, even though no real pitcher achieves all three.

**Fix:** Changed to direct MLB distribution comparison (same approach batters use).
Each prospect's boosted rate value is compared directly against the MLB peak-age
distribution to find its percentile.

### Root Cause B: Ceiling Boost Factor Too Small
The 0.35 factor was calibrated for batters. Pitcher scouting coefficients have
~2.5x smaller slopes (K/9: 0.074 vs K%: 0.200), so the same factor produces
~2.5x less effect. After testing, settled on `CEILING_BOOST = 0.30` for pitchers.

### Combined Top 100 Sort
Changed from percentile-based sort to peak WAR sort for the combined prospect
list, since pitcher and batter percentiles come from different distributions.

## Files Modified
- `src/services/HitterTrueFutureRatingService.ts` — 100% scouting, ceiling boost,
  wider clamps, league avg passthrough, diagnostic logging
- `src/services/TrueFutureRatingService.ts` — 100% scouting, ceiling boost,
  wider clamps, FIP distribution comparison
- Both files have diagnostic `console.log` statements (📊 prefix) that should
  be removed once tuning is complete

## Key Constants
- `CEILING_BOOST_FACTOR = 0.35` in HitterTrueFutureRatingService.ts (~line 217)
- `CEILING_BOOST = 0.30` in TrueFutureRatingService.ts (inside calculateComponentBlend)
- `PERCENTILE_TO_RATING` thresholds unchanged (99→5.0, 97→4.5, 93→4.0, etc.)

## Open Issue: MLB Pitcher Projection WAR Under-Shooting
Current MLB pitcher projections for 2021 top out at high-4s WAR, but 2018-2020
actual top WARs were in the low 6s (~1.5 WAR gap). Likely caused by conservative
ensemble weighting, IP historical blending, or disabled WAR multiplier.
See `docs/pitcher-projection-investigation.md` for full investigation plan.

## Branch
All work is on `age-column-fix` branch, uncommitted.
