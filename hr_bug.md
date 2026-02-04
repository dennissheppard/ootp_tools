# Home Run Projection Bug Investigation

## Executive Summary

**Original Problem:** 2021 projections showed 26-29 HR for top-3, vs historical 35-47 HR.

**What We Fixed:**
- ✓ Partial season data contamination (projections using current year stats)
- ✓ Power coefficient too conservative (was projecting 27 HR for 80 power)

**Current Status:**
- 2021 top projections: 35-37 HR ✓ (using coefficient: HR% = -3.4667 + 0.113333 × Power)
- BUT: Backcasting shows ~1% systematic bias (over-projecting elite, under-projecting weak)

**Root Cause:** True Ratings may be assigning 80 power to ~95th percentile performers, not 99th percentile. When we map 80 power → 99th percentile HR%, we over-project in backcasting.

**Decision Needed:** Prioritize backcasting accuracy (27 HR for 80 power) OR projection reasonableness (36 HR for 80 power)? See "Options Going Forward" below.

---

## The Original Problem

2021 projections were showing **26-29 HR** for the top 3 projected home run leaders, while historical top 3 averaged **35-47 HR** (2017-2020 range). This was a significant under-projection.

## Initial Hypothesis (WRONG)

We initially suspected **range compression** in the power coefficients:
- Elite power players (80 rated) under-projected
- Weak power players (20-40 rated) over-projected
- These would average out to the observed +0.252% HR% bias

## Quartile Analysis Results (UNEXPECTED)

Ran analysis splitting players by **projected power rating quartiles** (2015-2020, 500+ PA):

| Quartile | Power Range | HR% MAE | HR% RMSE | HR% Bias | Count |
|----------|-------------|---------|----------|----------|-------|
| Q1 (Elite) | 69-80 | 1.142 | **1.495** | **+0.733%** | 139 |
| Q2 (Good) | 58-69 | 0.775 | 0.959 | -0.036% | 139 |
| Q3 (Avg) | 40-58 | 0.579 | 0.776 | -0.003% | 139 |
| Q4 (Weak) | 18-39 | 0.539 | 0.823 | **+0.344%** | 139 |

**Key Finding:** We're OVER-predicting elite power on average (+0.733%), not under-predicting! But the **very high RMSE (1.495%)** for Q1 indicates massive variance - some elite players way over-predicted, others way under-predicted.

## Historical Top HR Leaders Analysis

Created script (`tools/analyze_top_hr_leaders.ts`) that reads actual batting stats from CSV files:

### Historical Top 3 HR Leaders (2015-2020)
- **2015:** 55, 54, 51 HR (avg 53.3)
- **2016:** 62, 51, 42 HR (avg 51.7)
- **2017:** 47, 46, 45 HR (avg 46.0) ← User mentioned this year
- **2018:** 40, 36, 35 HR (avg 37.0)
- **2019:** 39, 38, 37 HR (avg 38.0)
- **2020:** 40, 33, 30 HR (avg 34.3)
- **Overall Average:** **43.4 HR**

### 2021 Actual (Partial Season Data!)
- **Top 3:** 10, 10, 9 HR in ~165 PA
- **HR Rates:** 5.92%, 6.17%, 5.39%
- **Extrapolated to 650 PA:** ~38, 40, 35 HR (avg **38 HR**)
- **⚠️ CRITICAL:** Max PA in 2021 data is only **176 PA** - this is early-season data!

### 2021 Projections (User Reported)
- **Top 3 Projected:** 29, 26, 26 HR (with 698, 642, 673 PA)
- **Average:** **27 HR**
- **Gap vs Historical:** -16.4 HR (-38%)
- **Gap vs 2021 Pace:** -11 HR (-29%)

## Current Hypothesis: Partial Season Contamination

The 2021 projections might be **accidentally using 2021's partial season stats** instead of 2020 full season stats. This would explain:

1. **Lower power ratings:** If 2021 stats (where top guy hit only 10 HR) are blended in, power ratings would be artificially low
2. **Positive overall bias but low projections:** Most players over-predicted, but league leaders under-predicted because their ratings are depressed
3. **High RMSE for elite:** Variance from mixing full-season historicals with partial-season 2021 data

## Power Coefficient Context

Current coefficients (from `HitterRatingEstimatorService.ts`):
```typescript
power: { intercept: -0.5906, slope: 0.058434 }
// 80 power → 4.08% HR rate → 27 HR in 650 PA
// 50 power → 2.33% HR rate → 15 HR in 650 PA
// 20 power → 0.58% HR rate → 4 HR in 650 PA
```

These coefficients show **+0.252% aggregate bias** (slightly over-predicting), but the quartile analysis shows this masks issues at the extremes.

## Calculator Default PA Updated

Changed batter calculator default from **550 PA → 650 PA** to better represent full-time starters.

## Power Quartile Analysis Added to UI

Enhanced `BatterProjectionAnalysisService` and `ProjectionsView`:
- Added `metricsByPowerQuartile` to track HR% accuracy by projected power rating
- New table in Analysis tab: "HR% Accuracy by Projected Power Rating Quartile"
- Shows if we're systematically under/over-projecting at different power levels

## Root Cause Identified ✓

**FOUND AND FIXED:** 2021 projections were contaminated by partial 2021 season data!

### The Bug

Both projection services were including the current year's stats when calculating multi-year True Ratings:

**BatterProjectionService.ts:103** (OLD)
```typescript
const multiYearStats = await trueRatingsService.getMultiYearBattingStats(year);
// When year=2021, this fetched [2021, 2020, 2019, 2018] ❌
```

**ProjectionService.ts:127** (OLD)
```typescript
const multiYearEndYear = usedFallbackStats ? statsYear : year;
// When year=2021 with partial data, this fetched [2021, 2020, 2019] ❌
```

### The Impact

- 2021 data had only ~165 PA max (partial season)
- Top HR leaders had only 9-10 HR in that partial data
- True Ratings calculation blended this with full-season historicals
- Power ratings artificially depressed → projected 26-29 HR instead of ~43 HR

### The Fix

Changed both services to always use prior complete season:

**BatterProjectionService.ts:103** (NEW)
```typescript
const multiYearStats = await trueRatingsService.getMultiYearBattingStats(year - 1);
// When year=2021, fetches [2020, 2019, 2018, 2017] ✓
```

**ProjectionService.ts:127** (NEW)
```typescript
const multiYearEndYear = year - 1;
// When year=2021, fetches [2020, 2019, 2018] ✓
```

## Additional Findings (2026-02-04)

### Fixed: Partial Season Data Contamination ✓

Both projection services were including current year stats when projecting current year:
- This caused backcasting to "cheat" (using outcomes to predict themselves)
- This caused current projections to be mislead by small sample sizes

**Fixed by**: Always using `year - 1` for multi-year stats lookups

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

**Final coefficient** (mapped to actual percentiles, 2018-2020):
HR% = -3.4667 + 0.113333 × Power
- Calibrated to 373 qualified players (500+ PA, 2018-2020)
- **Maps power ratings directly to HR% percentiles**:
  - 80 power = 99th percentile → **36 HR** ✓
  - 70 power = 90th percentile → **29 HR** ✓
  - 50 power = 50th percentile → **14 HR** ✓
- Average error: 0.183% across all percentiles

**Key lesson learned**: Must map 80 power to 99th percentile (top elite), not to the average of Q1 quartile (69-80 power range). Previous attempts mapped 80 power to ~90th percentile, which gave only 27 HR instead of the actual 36 HR for top HR leaders.

### Fixed: Sorting Bug in Projections Table ✓

**ProjectionsView.ts:1831** - Added handling for `actualStats.` prefix so "Act HR%" and other actual stat columns can be sorted.

### New Diagnostic Tool Created

**tools/analyze_power_ratings.ts** - Calculates what power ratings would be needed to match actual HR leaders:
- Reads CSV files directly (CLI-compatible)
- Shows "needed power rating" for top HR leaders each year
- Diagnoses if issue is coefficient (need ratings > 80) or True Ratings compression (need 75-80 but not getting them)

Run with: `npx tsx tools/analyze_power_ratings.ts`

## Root Cause Diagnosis

After extensive testing and calibration, we've identified a **fundamental conflict** between backcasting accuracy and projection reasonableness:

### What We Discovered

1. **2018-2020 Actual Data** (373 qualified players, 500+ PA):
   - 99th percentile: 36 HR
   - 90th percentile: 27 HR
   - 50th percentile: 14 HR

2. **Coefficient Calibration Attempts**:
   - **Full distribution linear regression**: HR% = -1.6254 + 0.085037 × Power
     - Perfect fit to distribution (R² = 0.9782)
     - But 80 power → 34 HR (slightly under 99th percentile)
     - Backcasting showed ~1% bias (over-projecting elite, under-projecting weak)

   - **Percentile mapping**: HR% = -3.4667 + 0.113333 × Power
     - Maps 80 power directly to 99th percentile (36 HR)
     - 2021 projections look good: 35-37 HR for top players
     - But backcasting shows systematic bias:
       - Q1 (Elite, 69-80): -1.087% (over-projecting)
       - Q2 (Good, 58-69): -0.949% (over-projecting)
       - Q3 (Avg, 40-57): +0.012% (perfect)
       - Q4 (Weak, 18-39): +1.274% (under-projecting)

3. **Bias-corrected attempts**:
   - To fix backcasting bias → need flatter slope
   - Flatter slope gives 80 power → 27 HR
   - This "feels wrong" for top HR leaders

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

### The Fundamental Conflict

We cannot simultaneously achieve:
1. ✓ Backcasting accuracy (minimize bias across all power quartiles)
2. ✓ Reasonable top-end projections (35-37 HR for elite power)

Fixing one breaks the other.

## Options Going Forward

### Option A: Prioritize Backcasting Accuracy (Recommended for system integrity)

**Coefficient**: HR% = -0.349 + 0.0569 × Power
- 80 power → **27 HR**
- 70 power → **24 HR**
- 50 power → **16 HR**

**Pros:**
- Minimizes systematic bias in backcasting
- Statistically sound calibration
- Better for long-term system credibility

**Cons:**
- Top projections feel low (27 HR vs 36 HR actual top leaders)
- Doesn't match user intuition about elite power
- May systematically under-project future breakout stars

**When to choose:** If backcasting validation and statistical rigor matter most

---

### Option B: Prioritize "Feeling Right" (Recommended for user experience)

**Coefficient**: HR% = -3.4667 + 0.113333 × Power (CURRENT)
- 80 power → **36 HR**
- 70 power → **29 HR**
- 50 power → **14 HR**

**Pros:**
- 2021 projections look good (35-37 HR for top players)
- Matches actual 99th percentile (36 HR)
- "Feels right" for elite power projections

**Cons:**
- Systematic backcasting bias (~1% over-projection for elite)
- Suggests we're mis-calibrated
- May over-project in practice

**When to choose:** If projection reasonableness and user intuition matter most

---

### Option C: Hybrid Compromise

**Coefficient**: HR% = -2.0 + 0.085 × Power (example middle ground)
- 80 power → **31 HR**
- 70 power → **26 HR**
- 50 power → **15 HR**

**Pros:**
- Balances both concerns
- Reduces bias without going too flat
- Moderate projections for all levels

**Cons:**
- Doesn't fully satisfy either goal
- Still has some backcasting bias
- Still feels slightly low at top end

**When to choose:** If you want to split the difference

---

### Option D: Fix True Ratings (Recommended long-term, but complex)

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

**When to choose:** If you have time for a comprehensive fix

---

## My Recommendation

**Short-term: Use Option B (current coefficient)**
- Projections feel right for 2021 and future use
- Accept ~1% backcasting bias as a known limitation
- Document that backcasting over-projects elite power by design

**Long-term: Investigate Option D**
- True Ratings may be the real culprit
- If True Ratings properly assigned 80 power to 99th percentile performers, we wouldn't have this conflict
- Could involve adjusting regression strength, aging curves, or scouting weights

**Why not Option A:**
While statistically sound, projecting 27 HR for 80 power when actual 99th percentile hits 36 HR undermines user confidence in the system. The backcasting bias is a symptom of a deeper issue (True Ratings compression), not proof that Option A is correct.

## Tools Created

- `tools/analyze_power_ratings.ts` - Shows needed power ratings to match actual HR leaders
- `tools/calibrate_power_coefficient.ts` - Calibrates to top-3 leaders by year range
- `tools/calibrate_full_distribution.ts` - Linear regression on full 500+ PA distribution
- `tools/adjust_for_bias.ts` - Attempts to correct for quartile bias (went wrong direction)
- `tools/adjust_for_bias_corrected.ts` - Corrected bias adjustment (makes projections too low)
- `tools/calibrate_to_top_percentiles.ts` - Maps power to specific percentiles (CURRENT approach)

3. **Check PA projections:**
   - User confirmed top projected HR leaders have 632-698 PA (good, not the issue)

4. **Examine top elite variance:**
   - The 1.495% RMSE for Q1 suggests something inconsistent
   - Split Q1 into smaller bands (79-80 vs 75-78 vs 69-74) to see if very top is different
   - May need 300+ PA threshold to get enough sample size

5. **Test coefficient adjustment (if needed):**
   - If data contamination is ruled out, may need to adjust power coefficient
   - Suggested steeper slope: `HR% = -1.5 + 0.10 × Power` (would give 80 power → 6.5% → 42 HR)
   - But verify root cause first before changing calibrated coefficients

## Tools Created

- `tools/analyze_top_hr_leaders.ts` - Analyzes historical top 10 HR leaders vs projections
  - Reads directly from CSV files in `public/data/mlb_batting/`
  - Can be run with: `npx tsx tools/analyze_top_hr_leaders.ts`
  - Currently shows actuals only; would need projection export to compare

## Key Questions Still Open

1. Are 2021 stats contaminating 2021 projections?
2. Why is there such high variance (RMSE) for elite power projections?
3. Why are 2021 projections specifically low when 2015-2020 show positive bias?
4. Is the issue in rating assignment, aging curves, or coefficient application?
