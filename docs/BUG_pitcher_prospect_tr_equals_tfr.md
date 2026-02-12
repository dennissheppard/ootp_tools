# BUG: Pitcher Prospect True Ratings = True Future Ratings (no gap)

**Date**: February 2026
**Severity**: High — fundamental gap in pitcher prospect evaluation
**Status**: Needs investigation

---

## Problem

For pitcher prospects, the True Rating (TR) and True Future Rating (TFR) values are identical on the radar chart — the blue TR triangle and green TFR triangle overlap perfectly. This means there's no visible gap between current ability and peak potential.

For **batter** prospects this works correctly: TR and TFR show different values, and the gap between them on the pentagon is a core feature of the radar chart overlay.

## Expected Behavior

Pitcher prospects should have **distinct** TR and TFR values, just like batters:
- **TR** = current ability level (lower for young prospects)
- **TFR** = projected peak ability (higher ceiling)
- The **gap** between them represents development upside

## Where the Bug Likely Lives

### Data flow for pitcher prospects (TrueRatingsView → PitcherProfileModal)

In `src/views/TrueRatingsView.ts`, method `openPitcherProfile()` (~line 3240):

```typescript
// For prospects, these get set to the SAME values:
let prospectEstimatedStuff = row.estimatedStuff;    // ← ends up as TR
// ...
tfrStuff: row.isProspect ? prospectEstimatedStuff : undefined,  // ← TFR = same value
```

Both `estimatedStuff` (used for TR) and `tfrStuff` (used for TFR) are set from `prospectEstimatedStuff`, which comes from `prospect.trueRatings.stuff` in the farm data. There's no separate "current TR" calculation for pitcher prospects.

### Compare with batter prospects

Look at how `src/services/TeamRatingsService.ts` computes `HitterFarmData` vs `FarmData` (pitcher farm data). For batters, there may be separate current vs. peak rating calculations that pitchers are missing.

### Key files to investigate

1. **`src/services/TeamRatingsService.ts`** — `getFarmData()` (pitcher) vs `getHitterFarmData()` (batter). Compare how `trueRatings` and `potentialRatings` are computed for each. Are pitcher prospects missing a "current ability" calculation?

2. **`src/services/TrueFutureRatingService.ts`** — `getProspectTrueFutureRatings()`. For pitchers, does this produce both current and peak ratings, or just peak?

3. **`src/views/TrueRatingsView.ts`** — `openPitcherProfile()` vs `openBatterProfile()`. Compare how each builds `estimatedX` (for TR series) and `tfrX` (for TFR series). The batter path likely has different source data for each.

4. **`src/views/FarmRankingsView.ts`** — Same pattern: `openPitcherProfile()` passes the same `trueRatings` for both estimated and TFR fields.

### What "True Ratings" means for prospects

For MLB players, True Ratings are derived from stats (K/9 → Stuff, BB/9 → Control, HR/9 → HRA). Prospects don't have MLB stats, so their "True Ratings" are derived from scouting data via percentile normalization across all prospects (via `TrueFutureRatingService`).

The question: **Does the pitcher TFR pipeline produce both a "current ability" rating and a "peak potential" rating?** The batter pipeline appears to, but the pitcher pipeline may only produce one set of ratings that gets used for both TR and TFR.

## Fix Direction

The fix is NOT in the modal rendering — it correctly shows whatever TR and TFR values it receives. The fix is upstream in how the data is computed and passed. Either:

1. The TFR service needs to produce distinct current vs. peak ratings for pitcher prospects (like it does for batters)
2. Or the views need to use different source fields for TR vs TFR when building the profile data
