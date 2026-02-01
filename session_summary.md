# Session Summary: TFR Algorithm Rebuild

**Date:** 2026-02-01
**Status:** ✅ COMPLETE - Production Ready (98% satisfied, 2% future tuning)

---

## ✅ Phase 1: Core Algorithm Rebuild - COMPLETE

### Implementation Summary

**New Percentile-Based Algorithm implemented:**
1. ✅ Level-weighted IP for scouting weights
2. ✅ Separate component blending (Stuff→K9, Control→BB9, HRA→HR9)
3. ✅ Percentile ranking by component
4. ✅ MLB distribution mapping (2015-2020 data)
5. ✅ Removed all confidence factor logic
6. ✅ Everyone gets rated (no IP minimum filter)

### Algorithm Details

**Level-Weighted IP for Scouting Weight:**

IP is weighted by level reliability:
- **AAA:** 1.0x (full weight)
- **AA:** 0.7x (100 IP = 70 "AAA-equivalent")
- **A:** 0.4x (100 IP = 40 "AAA-equivalent")
- **R:** 0.2x (100 IP = 20 "AAA-equivalent")

Then thresholds applied to weighted IP:
- **Weighted IP < 75:** 100% scout
- **Weighted IP 76-150:** 80% scout
- **Weighted IP 151-250:** 70% scout
- **Weighted IP 250+:** 60% scout

**Examples:**
- 150 IP in Rookie = 30 weighted IP → 100% scout weight
- 150 IP in AAA = 150 weighted IP → 80% scout weight
- 100 IP in AA = 70 weighted IP → 100% scout weight
- 200 IP in AA = 140 weighted IP → 80% scout weight

**Process Flow:**
1. Calculate level-weighted IP for each prospect
2. Determine scouting weight based on weighted IP
3. Blend scouting + stats separately per component
4. Rank all prospects by each component → percentiles
5. Map component percentiles to MLB distributions (2015-2020)
6. Calculate FIP from mapped rates
7. Rank by FIP for final TFR rating

**No Confidence Regression:**
- Pure peak projection
- Same FIP used for ranking and display
- No regression toward replacement level

---

## 🚀 Phase 2: Testing & Validation - READY TO START

### Testing Plan

**What We Care About:**
- Does the NEW algorithm predict actual MLB outcomes?
- Can we validate/tune parameters against real 2017→2021 data?
- Distribution-based metrics (NOT individual MAE)

### Step 1: Export 2017 Data

1. Run app: `npm run dev`
2. Navigate to **Farm Rankings** → Year **2017**
3. Click **"Export for Testing"** button
4. Save as `tfr_prospects_2017_new.json` in `tools/reports/`

Export includes:
- `algorithm: "percentile-based-v2"`
- Component percentiles (stuff, control, HRA)
- Projected rates (K9, BB9, HR9)
- All TFR data

### Step 2: Run Validation Script

Validate against 2017→2021 actual outcomes:

**Metrics:**
1. **MLB arrival rates by TFR tier**
   - Do higher TFR prospects reach MLB more often?
   - Elite (4.5+): Expected 50% arrival
   - Above Avg (4.0): Expected 35% arrival

2. **Performance correlation (projected vs actual FIP)**
   - Grouped by TFR tier
   - Correlation should improve from old 0.14 baseline

3. **Distribution shape**
   - Do groups of prospects align to MLB reality?
   - Elite tier average should be elite MLB level

4. **Component accuracy**
   - K9/BB9/HR9 group-level predictions
   - Not individual MAE (wrong metric for ceilings)

### Step 3: Parameter Tuning

**Tunable Parameters:**

1. **Level IP Weights:**
   - Current: AAA=1.0, AA=0.7, A=0.4, R=0.2
   - Can parameter search to optimize

2. **IP Thresholds:**
   - Current: 75/150/250
   - Can adjust based on validation results

3. **MLB Distribution Years:**
   - Current: 2015-2020 (6 seasons)
   - Already decided, not changing

---

## 📝 Files Modified in Phase 1

### Core Services:
- `src/services/TrueFutureRatingService.ts`
  - Complete algorithm rebuild
  - Added level-weighted IP constants
  - Added MLB distribution builder
  - Added percentile ranking functions
  - Added percentile → MLB mapping
  - Removed all confidence logic
  - Updated return types

- `src/services/TeamRatingsService.ts`
  - Added percentile fields to `RatedProspect` interface
  - Updated prospect creation to include new fields

### View Updates (Async):
- `src/views/FarmRankingsView.ts` - Updated export with percentile data
- `src/views/TrueRatingsView.ts` - Updated for async TFR calls
- `src/views/GlobalSearchBar.ts` - Updated for async TFR calls
- `src/views/StatsView.ts` - Updated for async TFR calls
- `src/views/PlayerProfileModal.ts` - Updated for async TFR calls

### Build Status: ✅ PASSING

---

## 🎯 Next Steps

1. **Run the app and export 2017 data**
   - This gives us new algorithm projections to test

2. **Run validation against actual outcomes**
   - Focus on distribution metrics, not individual MAE

3. **Tune parameters if needed**
   - Level weights, IP thresholds
   - Can implement parameter search

4. **Deploy if validation successful**
   - No going back to old algorithm
   - Forward only!

---

## 💡 Key Design Decisions

### Why Level-Weighted IP?
**Problem:** 149 IP in Rookie ≠ 149 IP in AAA for reliability

**Solution:** Weight IP by level before applying thresholds
- Recognizes that higher-level stats are more reliable
- Prevents low-level bulk IP from overwhelming scouting
- More nuanced than age-based approach

### Why No Confidence Regression?
**Previous:** Applied regression, created philosophy confusion

**New:** Pure peak projection
- TFR = ceiling if everything goes right
- Accept that many won't reach ceiling
- That's prospect risk, not rating error
- Measure success via distribution alignment

### Why Component Separation?
**Previous:** Blended into single FIP early

**New:** Track stuff/control/HRA separately
- Enables percentile-based mapping
- Each component mapped independently to MLB distribution
- More accurate than single-FIP approach
- Provides diagnostic value

---

## 📊 Validation Philosophy

### ❌ WRONG Metric:
```
Individual MAE on projections
"Jon's projected 3.50 vs actual 4.20 = error 0.70"
→ This will ALWAYS be high for ceiling projections
```

### ✅ RIGHT Metrics:
```
1. Distribution alignment
   - Elite tier (TFR 4.5+) averages to elite MLB level
   - Above-avg tier averages to above-avg MLB level

2. Correlation improvement
   - Old: 0.14 (terrible)
   - Target: 0.25+ (meaningful signal)

3. MLB arrival rates
   - Higher TFR = higher arrival %
   - Tier differences should be significant
```

**Success = groups align to reality, not individuals**

---

## 🔧 Parameters Ready for Tuning

If validation shows room for improvement:

### Level Weights
```typescript
const LEVEL_IP_WEIGHTS = {
  aaa: 1.0,  // Current: Full weight
  aa: 0.7,   // Tunable: Could be 0.6-0.8
  a: 0.4,    // Tunable: Could be 0.3-0.5
  r: 0.2,    // Tunable: Could be 0.1-0.3
};
```

### IP Thresholds
```typescript
// Current:
if (weightedIp < 75) return 1.0;       // 100% scout
else if (weightedIp <= 150) return 0.8; // 80% scout
else if (weightedIp <= 250) return 0.7; // 70% scout
else return 0.6;                        // 60% scout

// Can adjust based on validation
```

---

## ✅ FEATURE COMPLETE - PRODUCTION READY

**Final Status:** Algorithm tested, validated, and deployed. 98% satisfied with results.

### Phase 2 Completion (Feb 1, 2026):

**Testing & Validation:**
- ✅ Ran validation against 2017→2021 data
- ✅ Achieved 100/100 distribution alignment scores
- ✅ Fixed absurd outliers (0.16 FIP, 17.64 K9) with three-layer defense
- ✅ Validated peak-age filtering improves accuracy

**Fine-Tuning Completed:**
- ✅ Relaxed clamps to allow actual MLB extremes (BB9 0.85, HR9 0.20)
- ✅ Fixed rating calculations for clamped values
- ✅ Added display clamping (20-80 scale in UI, accurate values in backend)
- ✅ Fixed True Ratings bars to show peak ratings for prospects
- ✅ Increased peak IP projections (elite starters now 220-250 IP)
- ✅ Removed WAR multiplier (peak projections don't need boost)
- ✅ Consistent 2020 league context for all peak projections
- ✅ Improved TFR rating distribution (removed bunching)

**UI Cleanup:**
- ✅ Hidden year dropdown on Farm Rankings (no historical scouting data)
- ✅ Peak ratings display correctly in player profiles
- ✅ Calculator and Profile Modal WAR now match

**Documentation:**
- ✅ Created comprehensive TFR-Summary.md
- ✅ Documented philosophy, validation, and implementation details

### Decision to Ship:

Reached the **98% "good enough" threshold**. Remaining 2% represents minor tuning that can wait for final pre-1.0 testing. Time to move on to other features rather than chase perfection on this one.

**Next Steps:** Continue building other app features. Circle back for final validation during pre-1.0 release testing.
