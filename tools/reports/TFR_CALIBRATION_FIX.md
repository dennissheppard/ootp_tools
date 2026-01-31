# TFR Calibration Fix - January 30, 2026

## The Problem

**Observed Distribution** (Top 100 Prospects):
- 5.0 (Elite): 6 players (6%)
- 4.5 (Elite): 33 players (33%)
- 4.0 (Above Avg): 61 players (61%)
- Below 4.0: 0 players (0%)

**Expected Distribution** (should match MLB):
- Elite (4.5+): 3-5%
- Above Avg (4.0-4.5): 10-15%
- Average (3.0-4.0): 30-40%
- Fringe/Poor: Rest

**Issue**: 100% of top prospects rated 4.0+, meaning we think EVERY top prospect will be an above-average MLB pitcher. That's massively inflated.

---

## Root Cause Analysis

### The Fundamental Issue: Comparing Peak to Current

**What TFR Measures**: Peak ability (3-5 years out)
- Based heavily on scouting ratings (which measure peak potential)
- Example: Scout rates 75 control = "will have 75 control at his best"

**What We Compare To**: Current MLB performance
- Percentile ranks prospect peak vs today's MLB pitchers (mix of peaks, primes, declines)
- Problem: Prospect's peak 3.50 FIP looks elite compared to today's average

**The Missing Factor**: Bust rate / Probability of reaching peak
- Not every prospect reaches their scouted peak
- If 100 prospects have "elite potential," maybe only 5-10 actually become elite
- We weren't accounting for development risk/uncertainty

---

## Case Study: Willie Gonzalez (Player 13587)

**Scouting**: 50/75/65 (stuff/control/hra) - Peak potential ratings
**Minor League Performance**: FIP ~6.00 at AA, 5.84 at AAA (200+ IP)
**MLB Debut**: FIP 26.00 (1 IP, disaster)

**Before Fix**:
- TFR: 2.0 (25th percentile)
- Projected Peak FIP: 3.89
- Logic: Scout thinks peak is ~3.50, stats show ~6.00, blend to 3.89
- Problem: Stats show he's NOT developing toward that peak, but we still project optimistically

**After Fix**:
- Confidence factors applied:
  - Age 23: 0.80 (normal uncertainty)
  - Level AAA: 0.90 (close to MLB)
  - Sample 200 IP: 0.85 (proven)
  - Scout-stat gap 2.50: 0.60 (huge disagreement)
  - **Combined confidence: 0.80 × 0.90 × 0.85 × 0.60 = 0.37 (37%)**
- Regression: 0.37 × 3.89 + 0.63 × 5.20 = **4.71 FIP**
- Result: More realistic projection that accounts for bust risk

---

## The Fix: Confidence-Based Regression

### Step 1: Calculate Confidence Factor

Confidence represents "probability prospect reaches their scouted peak." Based on:

#### Age Factor
- ≤20 years: 0.50 (very young, huge development uncertainty)
- 21-22 years: 0.65 (young, significant uncertainty)
- 23-24 years: 0.80 (normal uncertainty)
- 25-26 years: 0.90 (more proven)
- 27+ years: 1.00 (likely developed, less bust risk)

#### Level Factor
- AAA: 0.90 (close to MLB, proven against good competition)
- AA: 0.70 (two levels away)
- A-ball: 0.50 (three levels away)
- Rookie: 0.30 (four levels away, huge uncertainty)

#### Sample Size Factor
- <50 IP: 0.50 (tiny sample, anything can happen)
- 50-100 IP: 0.70 (half season)
- 100-200 IP: 0.85 (full season)
- 200+ IP: 1.00 (proven over time)

#### Scout-Stat Agreement Factor
- Gap > 2.0 FIP: 0.60 (massive disagreement - red flag)
- Gap 1.5-2.0: 0.75 (large disagreement)
- Gap 1.0-1.5: 0.90 (moderate disagreement)
- Gap < 1.0: 1.00 (scout and performance align)

**Combined Confidence** = Age × Level × Sample × Agreement

### Step 2: Regress Toward Replacement Level

Replacement Level = League Average + 1.00 = ~5.20 FIP

**Regression Formula**:
```
Regressed FIP = (Confidence × Peak FIP) + ((1 - Confidence) × Replacement FIP)
```

**Examples**:

High confidence prospect (AAA, 200 IP, stats match scouts):
- Confidence: 0.80 × 0.90 × 1.00 × 1.00 = 0.72
- Peak projection: 3.50 FIP
- Regressed: 0.72 × 3.50 + 0.28 × 5.20 = **3.98 FIP**

Low confidence prospect (A-ball, 50 IP, stats way worse than scouts):
- Confidence: 0.65 × 0.50 × 0.50 × 0.60 = 0.10
- Peak projection: 3.50 FIP
- Regressed: 0.10 × 3.50 + 0.90 × 5.20 = **5.03 FIP**

---

## Expected Impact

### Distribution Should Normalize

**Before** (everyone optimistic):
- Elite (4.5+): 39 players
- Above Avg (4.0+): 61 players
- Below 4.0: 0 players

**After** (realistic with bust risk):
- Elite (4.5+): 5-8 players (only the most proven, like 24yo AAA studs)
- Above Avg (4.0-4.5): 10-15 players
- Average (3.0-4.0): 35-45 players
- Fringe (2.5-3.0): 25-35 players
- Poor (<2.5): 10-20 players

### Who Gets Hit Hardest by Regression?

**Most Regressed** (low confidence):
- Very young (≤20) at low levels (Rookie/A)
- Small samples (<50 IP)
- Stats way worse than scouts expect (Willie Gonzalez types)
- Result: Projected FIP moves from 3.50 → 4.80+

**Least Regressed** (high confidence):
- Older prospects (25-26) at AAA
- Large samples (200+ IP)
- Stats match or exceed scout expectations
- Result: Projected FIP stays close to peak (3.50 → 3.80)

---

## Why This Makes Sense

### TFR Still Measures Peak

We're not changing what TFR represents - it's still "peak ability." But we're now being realistic about:

1. **Not everyone reaches their peak** - Injuries, plateaus, mental game, etc.
2. **Uncertainty varies** - 24yo AAA stud is more certain than 19yo A-ball prospect
3. **Performance matters** - If stats are terrible despite good scouting, development is questionable

### Scout Ratings Still Matter

Scouting still drives the projection (high scouting weight). But now:
- **High confidence cases** (proven, AAA, stats align): Scout peak is likely → little regression
- **Low confidence cases** (young, low level, stats diverge): Scout peak is aspirational → heavy regression

### Stats Serve as Reality Check

Stats don't tell us peak directly, but they tell us:
- **Is the player developing toward that peak?** (Stats improving = on track)
- **Do scouts have it right?** (Stats align with scouts = high confidence)
- **Is there red flag risk?** (Stats way worse = development concerns)

---

## Validation Checklist

After this fix is deployed, check:

### 1. Distribution (Top 100 Prospects)
- [ ] Elite (4.5+): 5-8 players (~5-8%)
- [ ] Above Avg (4.0+): 15-25 players (~15-25%)
- [ ] Average (3.0-4.0): 35-50 players (~35-50%)
- [ ] Fringe/Poor: Rest

### 2. Spot Checks
- [ ] Willie Gonzalez type (bad stats, OK scouts): Should be 1.5-2.0 TFR, not 2.0+
- [ ] Elite AAA prospect (great stats, great scouts): Should be 4.5+
- [ ] Young A-ball prospect (OK stats, great scouts): Should be 2.5-3.5, not 4.0+

### 3. Logic Checks
- [ ] 19yo Rookie ball: Should have heavy regression (low confidence)
- [ ] 25yo AAA with 200 IP: Should have light regression (high confidence)
- [ ] Stats align with scouts: Should project close to peak
- [ ] Stats way worse than scouts: Should regress significantly

### 4. Farm Rankings
- [ ] Organizations with proven AAA depth should rank higher
- [ ] Organizations with young, raw, low-level prospects should rank lower
- [ ] Makes sense for draft boards (high picks = high ceiling, but uncertain)

---

## Side Issues Found

### Issue 1: Year Dropdown on Top 100 Prospects
- Changing to 2016 shows players drafted in 2020
- Year filter doesn't seem to work correctly
- Need to investigate what that dropdown is supposed to do

### Issue 2: MLB Players in Top 100?
- Should prospects with MLB stats still show in Top 100?
- Current behavior: No MLB players in list
- Recommendation: Keep them for 1-2 years after debut (e.g., rookies still interesting)

---

## Implementation Details

**File**: `src/services/TrueFutureRatingService.ts`

**New Methods**:
1. `calculateConfidenceFactor()` - Calculates confidence in prospect reaching peak
2. `applyConfidenceRegression()` - Regresses projection toward replacement level

**Modified Method**:
- `calculateTrueFutureRatings()` - Now applies confidence regression before percentile ranking

**No Breaking Changes**: API surface remains the same, just more realistic projections.

---

## Next Steps

1. **Build & Test** - Verify code compiles and runs
2. **Check Distribution** - Re-run TFR, check if top 100 now shows ~5-8 elite instead of 39
3. **Spot Check Cases** - Validate Willie Gonzalez and a few others
4. **User Validation** - Does farm rankings "feel" more realistic?
5. **If Still Off** - Adjust confidence factors (may need tuning)

---

**Status**: Fix implemented, awaiting testing and validation
