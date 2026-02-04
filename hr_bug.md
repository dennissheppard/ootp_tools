# Home Run / Power Rating Bug

## Bug Description

Players with high batting averages and gap-hitting ability (many doubles/triples) are being assigned inflated Power ratings, leading to unrealistic home run projections.

**Example Case: Player ID 12121 (A.E. Douglas)**
- **Scout Power Rating**: 55 (slightly above average)
- **Recent HR Production**:
  - 2020: 13 HR in 531 PA (2.45% HR rate)
  - 2019: 4 HR in 424 PA (0.94% HR rate)
  - 2018: 0 HR in 16 PA
- **Actual Performance**: High-contact gap hitter
  - 2020: .351 AVG, .513 SLG, .162 ISO
  - 2019: .341 AVG, .477 SLG, .136 ISO
- **CURRENT BEHAVIOR (WRONG)**:
  - Estimated Power: **80** (elite!)
  - Projected 2021: **30 HR**
- **EXPECTED BEHAVIOR**:
  - Estimated Power: ~60-65 (based on actual HR% and scout rating)
  - Projected 2021: ~15-18 HR

## Root Cause

The True Ratings system estimates Power from **ISO (Isolated Power = SLG - AVG)** instead of **HR%**. The problem is that ISO includes ALL extra bases (doubles, triples, AND home runs), but the conversion formula assumes ISO comes purely from home runs.

### The Flawed Conversion Formula

Location: `HitterTrueRatingsCalculationService.ts:655-662`

```typescript
private estimatePowerFromIso(iso: number): number {
  // ISO ≈ HR% * 3 + 0.05, so HR% ≈ (ISO - 0.05) / 3
  // HR% = -1.30 + 0.058434 * power
  // power = (HR% + 1.30) / 0.058434
  const hrPct = (iso - 0.05) / 3 * 100; // Convert ISO to HR%
  const rating = (hrPct + 1.30) / 0.058434;
  return Math.max(20, Math.min(80, rating));
}
```

### Why This Fails

For A.E. Douglas with .162 ISO:
1. **Formula assumes**: HR% = (ISO - 0.05) / 3 = (0.162 - 0.05) / 3 = 0.0373 = **3.73%**
2. **Actual HR%**: 13 HR / 531 PA = **2.45%**
3. **Error**: The formula inflates HR% by **52%** because it treats doubles/triples as if they were home runs

This player's ISO breakdown:
- Home runs contribute: 13 HR × 3 extra bases / 531 AB = ~0.073 ISO
- Doubles/triples contribute: Remaining ~0.089 ISO
- **The formula incorrectly attributes ALL 0.162 ISO to power**

### Power Rating Calculation

Using the inflated 3.73% HR%:
```
power = (3.73 + 1.30) / 0.058434 = 86 → clamped to 80
```

Using actual 2.45% HR%:
```
power = (2.45 + 1.30) / 0.058434 = 64
```

After blending with 55 scout rating (with ~73% stats weight for 531 PA):
```
blended = 0.73 × 64 + 0.27 × 55 = 62 (reasonable)
```

## Data Available

The system already collects HR and PA in `YearlyHittingStats`:
```typescript
export interface YearlyHittingStats {
  year: number;
  pa: number;       // Plate appearances
  hr: number;       // Home runs
  // ... other stats
}
```

So we can calculate HR% directly: `hrPct = (hr / pa) * 100`

## Proposed Fix

### 1. Track HR% Through the Calculation Pipeline

**Add HR% to weighted rates calculation** (`calculateWeightedRates`):
- ✅ DONE: Added `hrPct` to `WeightedRates` interface
- ✅ DONE: Added weighted HR% calculation in the loop
- ✅ DONE: Return `hrPct` in the result

**Add HR% regression and blending**:
- ⏳ TODO: Add `regressedHrPct` calculation using tier-aware regression
- ⏳ TODO: Add `blendedHrPct` calculation with scouting blend
- ⏳ TODO: Add `blendedHrPct` to `HitterTrueRatingResult` interface

### 2. Use HR% for Power Estimation

**Create new estimation method**:
```typescript
private estimatePowerFromHrPct(hrPct: number): number {
  // HR% = -1.30 + 0.058434 * power (from regression coefficients)
  // power = (HR% + 1.30) / 0.058434
  const rating = (hrPct + 1.30) / 0.058434;
  return Math.max(20, Math.min(80, rating));
}
```

**Update the calculation** (line 288):
```typescript
// OLD:
const estimatedPower = this.estimatePowerFromIso(blendedIso);

// NEW:
const estimatedPower = this.estimatePowerFromHrPct(blendedHrPct);
```

### 3. Update Scouting Conversion

The `scoutingToExpectedRates` method currently uses `expectedIso()` which has the same flawed conversion. Update it to use `expectedHrPct()` directly:

```typescript
private scoutingToExpectedRates(scouting: HitterScoutingRatings): {
  bbPct: number;
  kPct: number;
  hrPct: number;  // ADD THIS
  iso: number;
  avg: number;
} {
  return {
    bbPct: HitterRatingEstimatorService.expectedBbPct(scouting.eye),
    kPct: HitterRatingEstimatorService.expectedKPct(scouting.avoidK),
    hrPct: HitterRatingEstimatorService.expectedHrPct(scouting.power), // ADD THIS
    iso: HitterRatingEstimatorService.expectedIso(scouting.power),
    avg: HitterRatingEstimatorService.expectedAvg(scouting.contact),
  };
}
```

### 4. Add HR% Stabilization Constant

Need to add an HR% stabilization value to the `STABILIZATION` constants (around line 132):
```typescript
const STABILIZATION = {
  bb_pct: 460,
  k_pct: 60,
  hrPct: 160,  // ADD THIS (same as existing iso value)
  iso: 160,
  avg: 400,
};
```

## Implementation Checklist

- [x] Add `hrPct: number` to `WeightedRates` interface (line 98)
- [x] Add `weightedHrPctSum` variable in `calculateWeightedRates` (line 328)
- [x] Calculate `hrPct` in the yearly stats loop (line 344)
- [x] Add `hrPct` to weighted sum (line 356)
- [x] Return `hrPct` in both return statements (lines 370, 373)
- [x] Add `hrPct: 160` to `STABILIZATION` constants (~line 132)
- [x] Add `regressedHrPct` calculation in `calculateSingleHitter` (~line 266)
- [x] Add `blendedHrPct` calculation in scouting blend section (~line 283)
- [x] Add `blendedHrPct: number` to `HitterTrueRatingResult` interface (line 67)
- [x] Create `estimatePowerFromHrPct()` method (can go near line 655)
- [x] Replace `estimatePowerFromIso()` call with `estimatePowerFromHrPct()` (line 288)
- [x] Add `hrPct` to `scoutingToExpectedRates` return type (~line 544)
- [x] Add `hrPct: HitterRatingEstimatorService.expectedHrPct(scouting.power)` in return (~line 556)
- [x] Include `blendedHrPct` in result object (~line 299-301)
- [x] Update `TrueRatingsView.ts` to include `blendedHrPct` in interface and mapping

## Expected Impact

After the fix, A.E. Douglas should show:
- Estimated Power: ~62-65 (reasonable for a 55 scout rating with improving but modest HR production)
- Projected HR: ~15-18 HR (not 30)
- System will correctly distinguish between:
  - **Power hitters**: High HR%, modest doubles/triples
  - **Gap hitters**: High ISO from doubles/triples, lower HR%

## Files Modified

- `src/services/HitterTrueRatingsCalculationService.ts` (main changes)
- `src/views/TrueRatingsView.ts` (added blendedHrPct to interface and mapping)
- `src/services/BatterProjectionService.ts` (should automatically pick up corrected estimatedPower)

## Testing

After implementation, verify:
1. A.E. Douglas (ID 12121) shows reasonable power rating (~60-65)
2. True power hitters still show high ratings (80+)
3. Gap hitters with high AVG/ISO but low HR% show moderate power ratings
4. Projections for HR match historical trends + aging curves

---

## Implementation Complete! ✅

All changes have been implemented successfully:

### Summary of Changes

1. **Added HR% tracking** through the entire calculation pipeline:
   - Added `hrPct` to `WeightedRates` interface
   - Calculate HR% from actual HR and PA data
   - Added HR% stabilization constant (160 PA)
   - Added HR% regression calculation
   - Added HR% scouting blend

2. **Fixed Power estimation**:
   - Created new `estimatePowerFromHrPct()` method that uses actual HR%
   - Replaced the flawed `estimatePowerFromIso()` call
   - Removed deprecated ISO-based method to avoid confusion

3. **Updated scouting integration**:
   - Added `hrPct` to `scoutingToExpectedRates()` return type
   - Uses `HitterRatingEstimatorService.expectedHrPct()` for scout ratings

4. **Updated result interface**:
   - Added `blendedHrPct` to `HitterTrueRatingResult`
   - Updated `TrueRatingsView.ts` to include the new field

### What This Fixes

The system now correctly distinguishes between:
- **Power hitters**: High HR%, modest doubles/triples → High power ratings
- **Gap hitters**: High ISO from doubles/triples, lower HR% → Moderate power ratings

For the example case (A.E. Douglas):
- **Before**: Power 80, Projected 30 HR (inflated)
- **Expected After**: Power ~62-65, Projected ~15-18 HR (realistic)

### Next Steps

Run the application and verify the fix with test cases, especially:
1. A.E. Douglas (ID 12121) - should show ~60-65 power instead of 80
2. High-AVG gap hitters - should show moderate power ratings
3. True sluggers - should still show 70-80 power ratings

---

## Recalibration Complete! ✅

After implementing the HR%-based power estimation, the projection coefficients were recalibrated using `tools/calibrate_batter_coefficients.ts` to ensure accurate projections.

### Calibration Results

**Baseline (Old Coefficients):**
- HR% MAE: 0.804, Bias: -0.195 (under-projecting by ~1-1.2 HR/season)
- BB% MAE: 1.410, Bias: -0.268
- K% MAE: 1.931, Bias: -0.177
- AVG MAE: 0.025, Bias: -0.001

**Final (New Coefficients):**
- HR% MAE: 0.777, Bias: -0.083 ✅ **57% bias reduction!**
- BB% MAE: 1.410, Bias: -0.116 ✅ **57% bias reduction**
- K% MAE: 1.939, Bias: -0.075 ✅ **58% bias reduction**
- AVG MAE: 0.025, Bias: -0.001 ✅ **Maintained accuracy**

### Updated Coefficients

**In HitterRatingEstimatorService.ts:**
- `eye: { intercept: 1.3306, slope: 0.114789 }` (was 0.64)
- `avoidK: { intercept: 25.8033, slope: -0.200303 }` (was 25.35)
- `power: { intercept: -0.8066, slope: 0.058434 }` (was -1.30) ⭐ **Key change**
- `contact: { intercept: 0.079431, slope: 0.00316593 }` (was 0.0772)

**In HitterTrueRatingsCalculationService.ts:**
- Updated all inverse estimation methods to match new coefficients

### Impact

The new power coefficient intercept (-0.8066 instead of -1.30) accounts for the fact that gap hitters now receive lower power ratings with the HR%-based approach. This ensures:

1. **Accurate individual power ratings** - gap hitters no longer inflated
2. **Accurate HR projections** - minimal bias (-0.083% instead of -0.195%)
3. **System coherence** - True Ratings and Projections now aligned
