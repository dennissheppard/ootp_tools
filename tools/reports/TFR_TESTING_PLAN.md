# TFR Testing & Validation Plan

**Date**: January 30, 2026
**Status**: Testing Needed Before Feature Development

---

## What Our Updates Actually Affect

### ✅ Affects TFR (True Future Rating for Prospects)
The `LEVEL_ADJUSTMENTS` we updated are **ONLY** used in `TrueFutureRatingService.ts`:
- Translates minor league stats to MLB-equivalent projections
- Used to calculate projected FIP for prospects
- Ranks prospects against current MLB pitchers

### ❌ Does NOT Affect MLB Projections
The main `ProjectionService.ts` does NOT use level adjustments:
- Uses actual MLB historical stats
- Applies regression & aging curves
- Your existing Projections Analysis tab won't show changes

**Bottom Line**: We updated TFR calculations, not MLB projections. We need to validate TFR specifically.

---

## What We Need to Test

### 1. TFR Distribution
**Question**: Are we creating too many 5.0s? Too few?

**Test**: Compare TFR distribution to MLB True Rating distribution
- Elite (4.5+): Should be ~3-5% of prospects
- Above Avg (3.5-4.0): Should be ~10-15%
- Average (2.5-3.0): Should be ~30-40%
- Fringe (2.0-2.5): Should be ~20-30%
- Poor (<2.0): Should be ~10-20%

**Check**: Do your current Farm Rankings show reasonable distribution? Or do you have 50 players rated 4.5+?

### 2. Projected FIP Accuracy
**Question**: When prospects reach MLB, does their projected FIP match actual FIP?

**Test**: Historical validation (2012-2019 prospects → 2013-2024 actuals)
- Calculate TFR for 2012-2019 prospects
- Match to their MLB debuts (first 50+ IP season)
- Measure error: MAE, RMSE, Bias

**Expected Results**:
- MAE: 0.60-0.80 (projecting prospects is hard!)
- Bias: Close to 0 (not systematically over/under projecting)
- AAA prospects: More accurate than AA/A (closer to MLB)

### 3. Level Adjustment Accuracy
**Question**: Are our updated adjustments (+0.27 K/9, +0.39 HR/9 for AAA→MLB) correct?

**Test**: Compare projected vs actual rate stats
- Do AAA pitchers' K/9 change by +0.27 when they reach MLB?
- Do they allow +0.39 more HR/9?
- This is what we validated in research, but need to test in production TFR code

### 4. Age Impact Analysis
**Question**: Should we apply age-adjusted level adjustments?

**Test**: Segment validation results by age
- Young (≤22): Do they struggle MORE than projection? (research shows +0.47 K/9 not +0.27)
- Mature (26-28): Do they adapt BETTER? (research shows -0.06 K/9 not +0.27)

**If yes**: Large age differences in error suggest we should implement age-adjusted projections

### 5. TFR Tier Validation
**Question**: Does each TFR tier perform as expected?

**Test**: Success rate by TFR tier
- Elite (4.5+): Should have FIP < 3.50 in MLB
- Above Avg (3.5-4.0): Should have FIP < 4.00
- Average (2.5-3.0): Should have FIP < 4.50
- Fringe (2.0-2.5): Should have FIP < 5.00

If Elite prospects are averaging 4.50 FIP, we're over-rating them.

---

## How to Test

### Option 1: Quick Manual Check (30 minutes)

1. **Check TFR Distribution** (in Farm Rankings)
   - Go to Farm Rankings → Top 100
   - Count how many 4.5+, 3.5-4.0, etc.
   - Do the numbers feel reasonable?

2. **Spot Check Notable Prospects**
   - Find prospects who recently debuted in MLB
   - Compare their TFR projection to actual MLB FIP
   - Are we close? Consistently over/under?

3. **Check Level Logic**
   - Find an AAA prospect with good minor league stats
   - Check their "adjusted" K/9, BB/9, HR/9 in the UI
   - Do the adjustments make sense?

### Option 2: Comprehensive Validation (Need to Build)

The `tfr_validation.ts` script I created provides a framework, but **requires historical TFR data**.

**Steps to implement**:

1. **Generate Historical TFRs**
   ```typescript
   // For each year 2012-2019:
   const tfrs = await trueFutureRatingService.getProspectTrueFutureRatings(year);
   // Save to tools/reports/tfr_${year}.json
   ```

2. **Run Validation Script**
   ```bash
   npx ts-node tools/research/tfr_validation.ts
   ```

3. **Review Metrics**
   - Overall MAE/RMSE/Bias
   - Distribution of TFRs
   - Success rates by age, level, tier
   - Biggest misses (who did we get most wrong?)

### Option 3: Add TFR Analysis to UI (Best Long-term)

Create a "TFR Analysis" tab in Farm Rankings (similar to Projections Analysis):
- Shows TFR distribution
- Historical accuracy metrics
- Breakdown by age, level, tier
- List of recent prospect debuts with TFR vs actual comparison

---

## What Good Results Look Like

### TFR Distribution (Should Match MLB)
```
Elite (4.5+):      3-5% of prospects
Above Avg (3.5+):  10-15%
Average (2.5-3.0): 30-40%
Fringe (2.0-2.5):  20-30%
Poor (<2.0):       10-20%
```

### Projection Accuracy
```
MAE: 0.60-0.80 FIP (prospects are inherently uncertain)
RMSE: 0.80-1.00 FIP
Bias: -0.10 to +0.10 (close to zero)
```

### By Level (Closer to MLB = More Accurate)
```
AAA: MAE ~0.60, 40-50% reach MLB
AA:  MAE ~0.80, 15-20% reach MLB
A:   MAE ~1.00, 5-10% reach MLB
```

### By Age (If Age-Adjusted)
```
Young (≤22): MAE ~0.70, slightly under-project struggle
Mature (26-28): MAE ~0.60, more reliable
Veteran (29+): MAE ~0.65
```

### Success Rates by TFR Tier
```
Elite (4.5+):      80%+ have MLB FIP < 4.00
Above Avg (3.5+):  60%+ have MLB FIP < 4.50
Average (2.5-3.0): 40%+ have MLB FIP < 5.00
```

---

## Red Flags to Watch For

### 🚨 Too Many Elite Prospects
- If 20%+ of prospects are rated 4.5+, we're over-rating
- Should be closer to 3-5%

### 🚨 Systematic Bias
- If bias is +0.50, we're under-projecting FIP (prospects worse than expected)
- If bias is -0.50, we're over-projecting FIP (prospects better than expected)

### 🚨 Age Doesn't Matter
- If error is the same for 22yo and 28yo, we're missing age effects
- Research shows 0.53 K/9 spread by age - should show up in validation

### 🚨 Level Doesn't Matter
- If AAA and A-ball prospects have same error, something's wrong
- AAA should be much more accurate (closer to MLB)

### 🚨 Elite Prospects Fail
- If TFR 4.5+ prospects average MLB FIP of 4.50, we're way off
- Elite should be 3.50-4.00 FIP in MLB

---

## Immediate Action Items

### Before Building New Features

1. **Quick Manual Check** (30 min)
   - Review current TFR distribution in Farm Rankings
   - Spot check 5-10 recent prospect debuts
   - Verify adjustments make sense

2. **Decision Point**
   - If distribution looks reasonable and spot checks are close → Proceed with breakout detection
   - If major issues (too many 5s, way off on spot checks) → Fix TFR first

3. **Optionally: Build Historical Validation** (4-6 hours)
   - Generate TFRs for 2012-2019
   - Run validation script
   - Get comprehensive metrics

### After Initial Features

4. **Add TFR Analysis Tab** to Farm Rankings (4-6 hours)
   - Real-time distribution monitoring
   - Track accuracy as prospects debut
   - Identify calibration issues early

5. **Implement Age Adjustments** if validation shows large age effects

---

## Questions to Answer

Before we build ROY Contenders, Breakout Detection, etc., let's make sure the foundation is solid:

1. **Does current TFR distribution look reasonable?**
2. **Are we creating too many 5.0s or too few?**
3. **Do TFR projections roughly match observed MLB performance?**
4. **Should we implement age-adjusted level adjustments?**

Once we're confident in TFR accuracy, we can build features on top with confidence that the underlying projections are sound.

---

**Next Step**: Run a quick manual check on your current Farm Rankings. If it looks reasonable, proceed with breakout detection. If not, let's validate and fix TFR first.
