# Pitcher TFR Changes Summary

## Session Date: 2026-02-05

## Context

Brought pitcher TFR to parity with batter TFR changes (documented in `batting_tfr_changes.md`). The batter changes added a "True Ratings" system that normalizes prospect ratings using percentile ranking. Pitchers had the percentiles calculated but were not converting them to the normalized 20-80 scale.

## Solution: True Ratings System for Pitchers

**Concept:** True Ratings are percentile-normalized across all prospects:
- Formula: `trueRating = 20 + (percentile / 100) × 60`
- 0th percentile → 20 rating
- 50th percentile → 50 rating
- 100th percentile → 80 rating

**Example:**
```
Scout Stuff: 65    True Stuff: 48  (-17)
→ "Scout says 65, but that's only 47th percentile among all prospects"

Scout Control: 70   True Control: 74  (+4)
→ "Scout says 70, and that's actually 90th percentile - legitimately elite"
```

**Projections are SEPARATE:**
- `projK9`, `projBb9`, `projHr9` still use MLB distribution mapping (for realistic stat projections)
- True Ratings are for comparison to scouting (percentile-normalized)

## Files Changed

### 1. `src/services/TrueFutureRatingService.ts`

**Interface additions to `TrueFutureRatingResult`:**
```typescript
/** True ratings - normalized from percentiles (20-80 scale) */
trueStuff: number;
trueControl: number;
trueHra: number;
```

**Calculation added in `calculateTrueFutureRatings()`:**
```typescript
// Calculate true ratings from percentiles: rating = 20 + (percentile / 100) * 60
// This normalizes across all prospects - 50th percentile = 50 rating
const trueStuff = Math.round(20 + (result.stuffPercentile / 100) * 60);
const trueControl = Math.round(20 + (result.controlPercentile / 100) * 60);
const trueHra = Math.round(20 + (result.hraPercentile / 100) * 60);
```

### 2. `src/services/TeamRatingsService.ts`

**Interface additions to `RatedProspect`:**
```typescript
/** True ratings - normalized from percentiles across all prospects (20-80 scale) */
trueRatings: {
    stuff: number;
    control: number;
    hra: number;
};
```

**Population in farm data function:**
```typescript
trueRatings: {
    stuff: tfr.trueStuff,
    control: tfr.trueControl,
    hra: tfr.trueHra,
},
```

### 3. `src/views/FarmRankingsView.ts`

**Changed from hacky formula-based estimation to using True Ratings:**
```typescript
// BEFORE (hacky formulas):
estimatedStuff: prospect ? Math.round((prospect.potentialRatings.stuff - 2.07) / 0.074) : undefined,
estimatedControl: prospect ? Math.round((5.22 - prospect.potentialRatings.control) / 0.052) : undefined,
estimatedHra: prospect ? Math.round((2.08 - prospect.potentialRatings.hra) / 0.024) : undefined,

// AFTER (proper True Ratings):
estimatedStuff: prospect?.trueRatings.stuff,
estimatedControl: prospect?.trueRatings.control,
estimatedHra: prospect?.trueRatings.hra,
```

## Architecture Summary

### TFR Flow for Pitcher Prospects

```
1. Scouting Ratings (Stuff: 65, Control: 55, HRA: 50)
         ↓
2. Convert to expected rates (Stuff 65 → 8.5 K/9)
         ↓
3. Blend with MiLB stats (weighted by level & IP)
   - Scouting weight varies by level-weighted IP
   - < 75 weighted IP: 100% scout
   - 76-150 weighted IP: 80% scout
   - 151-250 weighted IP: 70% scout
   - 250+ weighted IP: 60% scout
         ↓
4. Rank all prospects by each blended component → percentiles
         ↓
   ┌─────────────────────────────────────────────────────────────┐
   │                    TWO OUTPUTS                               │
   ├─────────────────────────────────────────────────────────────┤
   │ FOR TRUE RATINGS (comparison to scout):                      │
   │   trueRating = 20 + (percentile / 100) × 60                 │
   │   Shows: "Your 65 Stuff is actually 47th percentile = 48"   │
   ├─────────────────────────────────────────────────────────────┤
   │ FOR PROJECTIONS (peak stats):                                │
   │   Map percentile → MLB distribution → projected rate        │
   │   Shows: "47th percentile stuff → 7.8 K/9"                  │
   └─────────────────────────────────────────────────────────────┘
```

### Comparison: Batter vs Pitcher True Ratings

| Feature | Batters | Pitchers |
|---------|---------|----------|
| Percentiles calculated | ✅ eyePercentile, avoidKPercentile, powerPercentile, contactPercentile | ✅ stuffPercentile, controlPercentile, hraPercentile |
| True Ratings (20-80 normalized) | ✅ trueEye, trueAvoidK, truePower, trueContact | ✅ trueStuff, trueControl, trueHra |
| `trueRatings` in prospect interface | ✅ RatedHitterProspect | ✅ RatedProspect |
| UI displays True vs Scout comparison | ✅ | ✅ |

## Bug Fix: percentileRank Ordering

**Problem:** Farm scores were all 0 and tier buckets were empty because `percentileRank` was being used in the tierCounts calculation BEFORE it was assigned.

**Root Cause:** The code flow was:
1. Loop through orgGroups → calculate tierCounts using `p.percentileRank`
2. Sort prospects and assign `percentileRank`

Since `percentileRank` was undefined during step 1, all prospects got `rank = 9999` and fell into "fringe" bucket.

**Fix:** Moved the sorting and percentileRank assignment BEFORE the orgGroups loop that calculates tierCounts.

## Testing Notes

- TypeScript compiles without errors
- The existing TFR calculation flow is preserved - only added new fields
- Projections should be unchanged (still use MLB distribution mapping)
- Modal now shows True Ratings vs Scout Opinions with meaningful differences
- Farm scores and tier buckets now calculate correctly
