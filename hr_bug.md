# Home Run Projection Bug Investigation

## Executive Summary

**Original Problem:** 2021 projections showed 26-29 HR for top-3, vs historical 35-47 HR.

**What We Fixed:**
- ✓ Power coefficient too conservative (was projecting 27 HR for 80 power)
- ✓ Low power players projected to 0 HR (now uses piecewise coefficient)
- ✓ Removed double-regression for HR% in True Ratings (2026-02-04)
- ✓ Flattened elite power coefficient to fix over-prediction (2026-02-04)

**Current Status: RESOLVED**
- Backcasting Q1 (Elite Power) bias: +0.043% (essentially perfect)
- Overall HR% bias: +0.150% (excellent)
- Low power players project 2+ HR instead of 0

**Current Coefficient (Piecewise Linear):**
```
Power 20-50: HR% = -1.034 + 0.0637 × Power
Power 50-80: HR% = -2.75 + 0.098 × Power
```

| Power | HR% | HR in 650 PA | Notes |
|-------|-----|--------------|-------|
| 20 | 0.24% | 2 HR | 1st percentile |
| 50 | 2.15% | 14 HR | 50th percentile |
| 80 | 5.09% | 33 HR | Elite performers |

**Key Learning:** The backcasting bias convention is `actual - projected`, so negative bias means OVER-predicting (not under-predicting). The original coefficient (0.1123 slope) was too steep, causing over-prediction for elite power.



---

## The Original Problem

2021 projections were showing **26-29 HR** for the top 3 projected home run leaders, while historical top 3 averaged **35-47 HR** (2017-2020 range). This was a significant under-projection.


## Historical Top HR Leaders Analysis

Created script (`tools/analyze_top_hr_leaders.ts`) that reads actual batting stats from CSV files:

### Historical Top 3 HR Leaders (2015-2020)
- **2015:** 55, 54, 51 HR (avg 53.3)
- **2016:** 62, 51, 42 HR (avg 51.7)
- **2017:** 47, 46, 45 HR (avg 46.0) 
- **2018:** 40, 36, 35 HR (avg 37.0)
- **2019:** 39, 38, 37 HR (avg 38.0)
- **2020:** 40, 33, 30 HR (avg 34.3)
- **Overall Average:** **43.4 HR**

### 2021 Actual (Partial Season Data!)
- **Top 3:** 10, 10, 9 HR in ~165 PA
- **HR Rates:** 5.92%, 6.17%, 5.39%
- **Extrapolated to 650 PA:** ~38, 40, 35 HR (avg **38 HR**)
- **⚠️ CRITICAL:** Max PA in 2021 data is only **176 PA** - this is early-season data!


## Power Coefficient Context

Current coefficients (from `HitterRatingEstimatorService.ts`):
```typescript
power: { intercept: -0.5906, slope: 0.058434 }
// 80 power → 4.08% HR rate → 27 HR in 650 PA
// 50 power → 2.33% HR rate → 15 HR in 650 PA
// 20 power → 0.58% HR rate → 4 HR in 650 PA
```

These coefficients show **+0.252% aggregate bias** (slightly over-predicting), but the quartile analysis shows this masks issues at the extremes.




## Additional Findings (2026-02-04)


### Root Cause: Power Coefficient Too Conservative ✓

Ran diagnostic analysis showing the power coefficient was **way too conservative**:
- Average needed power rating to match top-3 HR leaders: **118.1** (max possible is 80!)
- All 21 top-3 player-seasons (2015-2020) needed ratings above 80
- Current coefficient gave 80 power → 27 HR, reality was ~43 HR

Analysis also revealed **HR rates declined after 2017**:
- 2015-2017: Higher HR environment
- 2018-2020: Stabilized at lower levels
- Need to calibrate to recent years (2018-2020), not full range

### Fixed: Updated Power Coefficient ✓

**Old coefficient**: HR% = -0.5906 + 0.058434 × Power
- 80 power → 4.08% → 27 HR in 650 PA ❌
- Severely under-projected elite power

**Proposed Final coefficient** (mapped to actual percentiles, 2018-2020):
HR% = -3.4667 + 0.113333 × Power
- Calibrated to 373 qualified players (500+ PA, 2018-2020)
- **Maps power ratings directly to HR% percentiles**:
  - 80 power = 99th percentile → **36 HR** ✓
  - 70 power = 90th percentile → **29 HR** ✓
  - 50 power = 50th percentile → **14 HR** ✓
- Average error: 0.183% across all percentiles

**Key lesson learned**: Must map 80 power to 99th percentile (top elite), not to the average of Q1 quartile (69-80 power range). Previous attempts mapped 80 power to ~90th percentile, which gave only 27 HR instead of the actual 36 HR for top HR leaders.

### New Diagnostic Tool Created

**tools/analyze_power_ratings.ts** - Calculates what power ratings would be needed to match actual HR leaders:
- Reads CSV files directly (CLI-compatible)
- Shows "needed power rating" for top HR leaders each year
- Diagnoses if issue is coefficient (need ratings > 80) or True Ratings compression (need 75-80 but not getting them)

Run with: `npx tsx tools/analyze_power_ratings.ts`



### The Core Problem

**Mismatch between True Ratings and actual performance percentiles:**

- We assume: 80 power = 99th percentile performer
- But True Ratings might give: 80 power to ~95th percentile performers
- Result: When we map 80 power → 99th percentile HR%, we over-project in backcasting

**Why this happens:**
- True Ratings uses regression to mean (adds conservatism)
- Aging curves may be overly aggressive for elite players
- Scouting data blending may compress the top end
- The percentile-fitting in the UI is cosmetic (happens AFTER projection calculation)


### Option: Fix True Ratings (Recommended long-term, but complex)

Investigate why True Ratings might be compressing elite power:
1. Check regression-to-mean strength
2. Review aging curve aggressiveness for elite players
3. Examine scouting data blending weights
4. Consider separate treatment for proven elite vs emerging elite

**Pros:**
- Addresses root cause
- Would fix both backcasting and projections
- Most thorough solution

**Cons:**
- Requires deep True Ratings refactor
- Time-intensive investigation
- May have unintended consequences



---


## Tools Created

- `tools/analyze_power_ratings.ts` - Shows needed power ratings to match actual HR leaders
- `tools/calibrate_power_coefficient.ts` - Calibrates to top-3 leaders by year range
- `tools/calibrate_full_distribution.ts` - Linear regression on full 500+ PA distribution
- `tools/adjust_for_bias.ts` - Attempts to correct for quartile bias (went wrong direction)
- `tools/adjust_for_bias_corrected.ts` - Corrected bias adjustment (makes projections too low)
- `tools/calibrate_to_top_percentiles.ts` - Maps power to specific percentiles (CURRENT approach)


1. **Test coefficient adjustment (if needed):**
   - If data contamination is ruled out, may need to adjust power coefficient
   - Suggested steeper slope: `HR% = -1.5 + 0.10 × Power` (would give 80 power → 6.5% → 42 HR)
   - But verify root cause first before changing calibrated coefficients

## Tools Created

- `tools/analyze_top_hr_leaders.ts` - Analyzes historical top 10 HR leaders vs projections
  - Reads directly from CSV files in `public/data/mlb_batting/`
  - Can be run with: `npx tsx tools/analyze_top_hr_leaders.ts`
  - Currently shows actuals only; would need projection export to compare

## Key Questions Still Open

1. Why is there such high variance (RMSE) for elite power projections?
2. Why are 2021 projections specifically low when 2015-2020 show positive bias?
3. Is the issue in rating assignment, aging curves, or coefficient application?
