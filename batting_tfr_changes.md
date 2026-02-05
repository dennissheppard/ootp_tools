# Batter TFR Changes Summary

## Session Date: 2026-02-05

## Problems Identified & Fixed

### Problem 1: Power Rating Showing 21 for 80-Power Prospect

**Symptom:** An 18-year-old prospect with 80 scouting Power and only rookie ball stats (567 PA, 10 HR) was showing a "True Power Rating" of 21 and peak HR projection of 2.

**Root Cause:** In `FarmRankingsView.ts`, the code was passing `projIso` (ISO like 0.20) to `estimatePower()` which expects `hrPct` (like 5.0%):

```typescript
// BROKEN - passing ISO to a function expecting HR%
const estimatedPower = hitterProspect?.projIso
    ? HitterRatingEstimatorService.estimatePower(hitterProspect.projIso, projPa).rating
    : undefined;
```

When `projIso = 0.20` was interpreted as `0.20% HR rate`, the formula produced a rating of ~20.

**Fix:**
- Added `projHrPct` to `RatedHitterProspect` interface
- Populated it from TFR results
- This was later superseded by the True Ratings system (see Problem 2)

### Problem 2: Eye/AvoidK Ratings Disagreeing with Scout for Low-PA Prospects

**Symptom:** An 18-year-old with 146 PA in Rookie ball, Scout Eye 45 / AvoidK 70, was showing True Ratings of 53 / 54.

**Root Cause:** The code was:
1. Taking blended component values (which for low PA are ~100% scouting)
2. Ranking among prospects → percentile
3. Mapping percentile to **MLB distribution** → projected rate
4. Re-estimating a rating from that MLB rate

This circular flow introduced distortion. A 45 Eye scout might rank at 30th percentile among prospects, map to 40th percentile of MLB BB%, and then re-estimate to 53.

**User's Insight:** The real value of TFR is to normalize ratings across all prospects - if Scout A rates everyone around 45 and Scout B rates everyone around 58, a "60" means different things. TFR should smooth this out by showing where a prospect actually ranks.

### Solution: True Ratings System

**Concept:** True Ratings are now percentile-normalized across all prospects:
- Formula: `trueRating = 20 + (percentile / 100) × 60`
- 0th percentile → 20 rating
- 50th percentile → 50 rating
- 100th percentile → 80 rating

**Example:**
```
Scout Power: 60    True Power: 41  (-19)
→ "Scout says 60, but that's only 35th percentile among all prospects"

Scout AvoidK: 70   True AvoidK: 72  (+2)
→ "Scout says 70, and that's actually 87th percentile - legitimately elite"
```

**Projections are SEPARATE:**
- `projHrPct`, `projBbPct`, etc. still use MLB distribution mapping (for realistic stat projections)
- True Ratings are for comparison to scouting (percentile-normalized)

## Files Changed

### 1. `src/services/HitterTrueFutureRatingService.ts`

**Interface additions to `HitterTrueFutureRatingResult`:**
```typescript
/** True ratings - normalized from percentiles (20-80 scale) */
trueEye: number;
trueAvoidK: number;
truePower: number;
trueContact: number;
```

**Calculation added in `calculateTrueFutureRatings()`:**
```typescript
// Calculate true ratings from percentiles: rating = 20 + (percentile / 100) * 60
// This normalizes across all prospects - 50th percentile = 50 rating
const trueEye = Math.round(20 + (result.eyePercentile / 100) * 60);
const trueAvoidK = Math.round(20 + (result.avoidKPercentile / 100) * 60);
const truePower = Math.round(20 + (result.powerPercentile / 100) * 60);
const trueContact = Math.round(20 + (result.contactPercentile / 100) * 60);
```

### 2. `src/services/TeamRatingsService.ts`

**Interface additions to `RatedHitterProspect`:**
```typescript
/** True ratings - normalized from percentiles across all prospects (20-80 scale) */
trueRatings: {
    power: number;
    eye: number;
    avoidK: number;
    contact: number;
};
```

Also added `projHrPct: number` to the interface for proper HR% tracking.

**Population in `getHitterFarmData()`:**
```typescript
trueRatings: {
    power: tfr.truePower,
    eye: tfr.trueEye,
    avoidK: tfr.trueAvoidK,
    contact: tfr.trueContact,
},
```

### 3. `src/views/FarmRankingsView.ts`

**Changed from broken re-estimation to using True Ratings:**
```typescript
// Use True Ratings - these are normalized from percentile rankings across all prospects
// They answer: "Where does this prospect rank among all prospects?" (20-80 scale)
// Scout might say 60 Power, but if that's only 35th percentile among prospects, True Power = 41
const estimatedPower = hitterProspect?.trueRatings.power;
const estimatedEye = hitterProspect?.trueRatings.eye;
const estimatedAvoidK = hitterProspect?.trueRatings.avoidK;
const estimatedContact = hitterProspect?.trueRatings.contact;
```

Also added `projHrPct` to the data passed to the modal for proper HR projections.

### 4. `src/views/BatterProfileModal.ts`

**Interface addition to `BatterProfileData`:**
```typescript
projHrPct?: number;
```

**Updated HR projection logic to use `projHrPct` directly:**
```typescript
} else if (data.projHrPct !== undefined) {
  // Use projected HR% directly (most accurate for prospects)
  projHr = Math.round(projPa * (data.projHrPct / 100));
}
```

**Updated tooltip:**
```typescript
title="Normalized ratings based on percentile rank among all prospects/players"
```

**Added fallback for prospects without estimated ratings** (shows scout-only view).

## Architecture Summary

### TFR Flow for Prospects

```
1. Scouting Ratings (Eye: 45, Power: 80, etc.)
         ↓
2. Convert to expected rates (Eye 45 → 6.79% BB)
         ↓
3. Blend with MiLB stats (weighted by level & PA)
   - Eye: 100% scout always (MiLB BB% is noise, r=0.05)
   - Contact: 100% scout always (MiLB AVG is noise, r=0.18)
   - AvoidK: 40-100% scout based on PA (MiLB K% is predictive, r=0.68)
   - Power: 75-100% scout based on PA (MiLB HR% moderately predictive, r=0.44)
         ↓
4. Rank all prospects by each blended component → percentiles
         ↓
   ┌─────────────────────────────────────────────────────────────┐
   │                    TWO OUTPUTS                               │
   ├─────────────────────────────────────────────────────────────┤
   │ FOR TRUE RATINGS (comparison to scout):                      │
   │   trueRating = 20 + (percentile / 100) × 60                 │
   │   Shows: "Your 60 Power is actually 35th percentile = 41"   │
   ├─────────────────────────────────────────────────────────────┤
   │ FOR PROJECTIONS (peak stats):                                │
   │   Map percentile → MLB distribution → projected rate        │
   │   Shows: "35th percentile power → 2.1% HR rate → 14 HR"     │
   └─────────────────────────────────────────────────────────────┘
```

### Level Weights for Weighted PA
- AAA: 1.0× (full weight)
- AA: 0.7×
- A: 0.4×
- R: 0.2× (567 PA in rookie = 113 weighted PA)

### Scouting Weight Thresholds (for Power)
- < 150 weighted PA: 100% scout
- 150-300 weighted PA: 85% scout
- 300-500 weighted PA: 80% scout
- 500+ weighted PA: 75% scout

## Potential Future Iterations

1. **Display percentile directly:** Could show "45 (30th %ile)" instead of just the normalized rating
2. **Confidence indicators:** Show how much the True Rating differs from scout and why
3. **Component-specific normalization:** Different components might need different scaling
4. **Historical tracking:** Track how True Ratings change as prospect gains experience
5. **Separate pools:** Might want to rank pitching prospects separately from hitting prospects

## Testing Notes

- TypeScript compiles without errors
- The existing TFR calculation flow is preserved - only added new fields
- Projections should be unchanged (still use MLB distribution mapping)
- Modal now shows True Ratings vs Scout Opinions with meaningful differences
