# TFR Calibration Fixes (2017 Validation)
**Date:** January 31, 2026
**Based on:** 2017→2021 validation results

## Summary of Issues Found

### ❌ Critical Problems
1. **Level adjustments too aggressive** - Expected changes 2-3x larger than actual
2. **Age penalty inverted** - Older prospects (25-30+) getting elite ratings
3. **Scouting weight too high for old players** - 30-year-olds weighted heavily toward scout projections
4. **Zero correlation** - TFR had 0.068 correlation with actual MLB FIP
5. **Elite prospects failed** - 3 elite prospects (4.0+), 0 reached MLB

### 🔍 Root Cause
- **30-year-old got top rating (4.5 TFR)** - Jon Valenzuela stayed in AAA entire period
- **Most top-20 were ages 23-30** - System favored older players with more IP
- **Old prospects have more IP** → higher stats weight → appear more certain → ranked higher

---

## Fix #1: Reduce Level Adjustments (~50%)

**Problem:** AAA→MLB adjustments were based on OOTP 25+26 research but didn't hold up in 2017 validation.

**Validation Results (54 AAA→MLB transitions):**
```
         Expected  →  Actual  →  New Value
K/9:     +0.27     →  +0.01   →  +0.10  (63% reduction)
BB/9:    -0.06     →  +0.02   →  0.00   (flat, no change)
HR/9:    +0.39     →  +0.26   →  +0.20  (49% reduction)
```

**Changes:**
```typescript
// OLD
aaa: { k9: 0.27, bb9: -0.06, hr9: 0.39 }
aa:  { k9: 0.11, bb9: 0.29, hr9: 0.42 }
a:   { k9: -0.08, bb9: 0.37, hr9: 0.51 }
r:   { k9: -0.16, bb9: 0.64, hr9: 0.57 }

// NEW (50-65% reduction)
aaa: { k9: 0.10, bb9: 0.00, hr9: 0.20 }
aa:  { k9: 0.02, bb9: 0.18, hr9: 0.22 }
a:   { k9: -0.08, bb9: 0.22, hr9: 0.27 }
r:   { k9: -0.12, bb9: 0.36, hr9: 0.30 }
```

**File:** `src/services/TrueFutureRatingService.ts:94-109`

---

## Fix #2: Add Age Penalty

**Problem:** Older prospects (25-30+) were getting high confidence factors, causing them to rank higher than young prospects with real upside.

**Old Logic:**
- Age ≤20: 0.84 confidence
- Age 21-22: 0.95 confidence
- Age 23-24: 0.92 confidence
- Age 25-26: 0.97 confidence
- **Age 27+: 1.00 confidence** ← PROBLEM!

**New Logic (Peak development window: 21-24):**
```typescript
Age ≤19:   0.75  (very young, uncertain)
Age 20:    0.84  (still developing)
Age 21-22: 0.95  (good development window)
Age 23-24: 1.00  (PEAK - best prospects)
Age 25-26: 0.85  (past peak, limited upside)
Age 27-28: 0.65  (old for prospect, ceiling reached)
Age 29-30: 0.45  (very old, minimal upside)
Age 31+:   0.25  (organizational filler, not a prospect)
```

**Impact:**
- 30-year-old Jon Valenzuela (was 4.5 TFR) → confidence drops from 1.0 to 0.25
- 28-year-old prospects → confidence drops from 1.0 to 0.65
- 23-24 year-olds now get HIGHEST confidence (was 0.92, now 1.0)

**File:** `src/services/TrueFutureRatingService.ts:344-371`

---

## Fix #3: Reduce Scouting Weight for Older Players

**Problem:** Scouting weight calculation assumed older players' stats were more reliable, but still trusted scouts at 0.40-0.50 weight. For prospects, older players ARE their stats - scouts projecting "potential" for a 30-year-old is meaningless.

**Old Logic:**
- Age 30+: 0.40 scouting weight
- Age 27-29: 0.50 scouting weight
- Age <27: 0.65 base + bonuses (up to 0.95)

**New Logic (trust track record for old players):**
```typescript
Age 30+:   0.20  (almost entirely trust stats)
Age 27-29: 0.30  (mostly trust stats)
Age 25-26: 0.40  (trust stats more than scouts)
Age 23-24: 0.60  (balanced - peak development)
Age <23:   0.70  (trust scouts more - less developed)

// Bonuses only for age <25
+ Gap bonus: up to +0.12 (reduced from +0.15)
+ IP bonus: up to +0.12 (reduced from +0.15)
Max weight: 0.90 (reduced from 0.95)
```

**Impact:**
- 30-year-old: 0.40 → 0.20 (50% reduction in scout trust)
- 27-year-old: 0.50 → 0.30 (40% reduction)
- 25-year-old: 0.65+ → 0.40 (no bonuses)
- 23-year-old: 0.65+ → 0.60-0.84 (bonuses still apply)

**File:** `src/services/TrueFutureRatingService.ts:146-172`

---

## Expected Impact

### Distribution Changes
**Before (2017 export):**
- Elite (4.5+): 1 prospect (30-year-old)
- Star (4.0-4.4): 2 prospects (25-26 years old)
- Above Avg (3.5-3.9): 46 prospects
- Average (3.0-3.4): 102 prospects

**After (predicted):**
- Elite (4.5+): 5-10 prospects (ages 21-24)
- Star (4.0-4.4): 15-25 prospects (ages 22-26)
- Above Avg (3.5-3.9): 40-60 prospects (ages 20-27)
- **30-year-olds**: Should rank 3.0 or lower

### Performance Metrics
**Target improvements:**
- ✅ Elite prospects MLB arrival: 0% → 30-50%
- ✅ Correlation (TFR vs MLB FIP): 0.068 → 0.20-0.40
- ✅ Level adjustment MAE: All within targets (<1.0, <0.5, <0.4)
- ✅ Top-10 TFR: Ages 21-25 (not 25-30)

---

## Testing Instructions

### 1. Rebuild App
```bash
npm run build
```

### 2. Re-Export 2017 Prospects
1. Open app: `http://localhost:5173`
2. Go to Farm Rankings
3. Select year: **2017**
4. Click "Export for Testing"
5. Save as: `tools/reports/tfr_prospects_2017_v2.json`

### 3. Run Validation
```bash
# Rename old export for comparison
mv tools/reports/tfr_prospects_2017.json tools/reports/tfr_prospects_2017_v1_old.json

# Rename new export to active filename
mv tools/reports/tfr_prospects_2017_v2.json tools/reports/tfr_prospects_2017.json

# Run validation
npx ts-node tools/research/tfr_2017_validation.ts
```

### 4. Compare Results

**Key metrics to check:**

1. **Top 10 Prospects - Age Distribution**
   ```bash
   # Should see ages 21-25, not 25-30
   node -e "const d=require('./tools/reports/tfr_prospects_2017.json'); d.prospects.sort((a,b)=>b.tfr-a.tfr).slice(0,10).forEach((p,i)=>console.log(i+1 + '. ' + p.name + ' - Age: ' + p.age + ', TFR: ' + p.tfr))"
   ```

2. **Level Adjustment MAE**
   - K/9: Should be <1.0 (was 1.22)
   - BB/9: Should be <0.5 (was 1.15)
   - HR/9: Should be <0.4 (was 0.45)

3. **Elite Prospect MLB Arrival**
   - Was: 0% (0 of 3)
   - Target: 30-50%

4. **Correlation**
   - Was: 0.068
   - Target: >0.20 (ideally >0.40)

---

## Rollback Instructions

If results are worse, revert changes:

```bash
git checkout src/services/TrueFutureRatingService.ts
npm run build
```

Then analyze which specific fix caused issues and iterate.

---

## Next Steps

### If Validation Improves
1. Test on 2018, 2019 data for robustness
2. Document final parameters in README
3. Update session_summary.md
4. Ship as production calibration

### If Still Issues
1. **Correlation still low (<0.20):**
   - Check 2017 scouting data quality
   - May need to reduce scouting weight further
   - Consider if blending formula is fundamentally flawed

2. **Level adjustments still off:**
   - Reduce further (try 25% of original values)
   - May need to abandon additive adjustments entirely

3. **Elite prospects still failing:**
   - Check if percentile thresholds are wrong
   - May need to lower 5.0 from 98th → 95th percentile

---

## Files Modified

1. `src/services/TrueFutureRatingService.ts`
   - Lines 71-109: Level adjustments (reduced ~50%)
   - Lines 146-172: Scouting weight (reduced for age 25+)
   - Lines 344-371: Confidence factor (added age penalty)

## Backup

Original file backed up at: `src/services/TrueFutureRatingService.ts.backup_2026-01-31`

---

**Summary:** Three targeted fixes addressing the root causes found in 2017 validation. Age is now heavily penalized (30-year-olds can't be elite), level adjustments are more conservative, and stats are trusted more for older players.
