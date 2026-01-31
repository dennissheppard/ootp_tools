# TFR Calibration - Iteration 2 Fixes

**Date**: January 30, 2026
**Status**: Fixes Applied - Awaiting Validation

---

## Issues from First Iteration

### 1. Over-Correction: Peak WAR Destroyed ❌
**Problem**: Top prospect Peak WAR only 1.9 (should be 4-6)
**Root Cause**: Used regressed FIP for Peak WAR calculation
- Regressed FIP accounts for bust risk: 3.50 → 4.87
- Peak WAR from 4.87 FIP = 0.5 WAR (terrible!)
- **But Peak WAR should show ceiling, not likelihood**

**Fix**: Separate peak projection from ranking adjustment
- Peak WAR uses original projection (their ceiling if they reach it)
- Regression only affects ranking/percentile (accounts for uncertainty)

### 2. Young Players Crushed ❌
**Problem**: Only 2 below-AA prospects in top 100
**Root Cause**: Confidence factors too harsh
- 19yo A-ball: 0.50 × 0.50 × 0.70 = 0.175 confidence (17.5%)
- Regression: 0.175 × 3.50 + 0.825 × 5.20 = 4.91 FIP (destroyed)

**Fix**: Softer confidence factors + square root smoothing
- Age 20: 0.50 → **0.75**
- A-ball: 0.50 → **0.75**
- Floor: 20% → **50%**
- Square root: confidence 0.25 → 0.50 effective weight

### 3. Still Compressed Distribution ❌
**Problem**: Five 5.0s, then 4.5, then all 4.0
**Root Cause**: Regressing toward replacement (5.20 FIP) too harsh

**Fix**: Regress toward average prospect (4.50 FIP)
- Replacement level = "useless player"
- Average prospect = "typical outcome for prospects"
- More reasonable target

### 4. Player Card Mismatch ❌❌❌ CRITICAL
**Problem**: Farm Rankings table vs Player Profile Modal showing different numbers
- Table: Park Peak FIP 2.84, Peak WAR 4.9
- Modal: Park Peak FIP 2.77, Peak WAR 2.2, IP 62

**Root Causes**:
1. **Different data sources**: Table uses TFR directly, modal recalculates
2. **Different SP/RP threshold**: Modal stamina ≥35, Table stamina ≥30
3. **Different projection method**: Modal uses `projectionService`, not TFR

**Fix**: Pass TFR data as `projectionOverride` to modal
- Modal now uses pre-calculated TFR projections
- No recalculation = consistent numbers
- Same SP/RP logic (stamina ≥30, pitches ≥3)

---

## Technical Changes

### 1. TrueFutureRatingService.ts

#### Separated Peak from Ranking
```typescript
// Before: Overwrote projFip with regressed value
const regressedFip = applyConfidenceRegression(result.projFip, confidence);
return { ...result, projFip: regressedFip };

// After: Keep both
const rankingFip = applyConfidenceRegression(result.projFip, confidence);
return {
  result,              // Contains original projFip for Peak WAR
  rankingFip           // Used only for percentile ranking
};
```

#### Softer Confidence Factors
| Factor | Before | After | Example Impact |
|--------|--------|-------|----------------|
| Age 20 | 0.50 | 0.75 | Less penalty for youth |
| Age 22 | 0.65 | 0.85 | Less penalty for youth |
| AA | 0.70 | 0.85 | Lower levels more viable |
| A-ball | 0.50 | 0.75 | Lower levels more viable |
| Rookie | 0.30 | 0.65 | Lower levels viable |
| <50 IP | 0.50 | 0.75 | Small samples less penalized |
| Scout gap >2.0 | 0.60 | 0.80 | Performance concerns softer |
| Floor | 20% | 50% | No one destroyed completely |

#### Changed Regression Target
```typescript
// Before: Regress toward replacement level
const replacementFip = 5.20;

// After: Regress toward average prospect outcome
const averageProspectFip = 4.50;
```

#### Square Root Smoothing
```typescript
// Before: Linear confidence
return confidence * projFip + (1 - confidence) * replacementFip;

// After: Square root smoothing (softer curve)
const softConfidence = Math.sqrt(confidence);
return softConfidence * projFip + (1 - softConfidence) * averageProspectFip;
```

**Effect**:
- confidence=1.0 (sqrt=1.0): No regression
- confidence=0.5 (sqrt=0.71): 71% peak, 29% average = ~3.85 for 3.50 peak
- confidence=0.25 (sqrt=0.50): 50/50 mix = ~4.00 for 3.50 peak

### 2. FarmRankingsView.ts

#### Pass TFR Data to Modal
```typescript
// Build projection override using TFR data
let projectionOverride = undefined;
if (prospect) {
    const projectedIp = prospect.scoutingRatings.stamina >= 30
        && prospect.scoutingRatings.pitches >= 3 ? 180 : 65;

    projectionOverride = {
        projectedStats: {
            k9: prospect.potentialRatings.stuff,
            bb9: prospect.potentialRatings.control,
            hr9: prospect.potentialRatings.hra,
            fip: prospect.peakFip,      // Use TFR's peak FIP
            war: prospect.peakWar,      // Use TFR's peak WAR
            ip: projectedIp             // Consistent IP projection
        },
        projectedRatings: {
            stuff: prospect.scoutingRatings.stuff,
            control: prospect.scoutingRatings.control,
            hra: prospect.scoutingRatings.hra
        }
    };
}

this.playerProfileModal.show({
    // ... other data
    projectionOverride: projectionOverride, // Modal uses this instead of recalculating
});
```

---

## Expected Results (After Iteration 2)

### TFR Distribution
- 5.0 (Elite): **5-10 players** (up from 5, was 0 after iteration 1)
- 4.5 (Elite): **15-25 players** (down from all in top 24)
- 4.0 (Above Avg): **20-30 players** (not everyone anymore)
- 3.0-4.0 (Average): **30-40 players** (NEW - was 0)
- 2.5-3.0 (Fringe): **15-25 players** (NEW - was 0)
- <2.5 (Poor): **5-15 players** (NEW - was 0)

### Peak WAR Range
- Top prospect: **4-6 WAR** (up from 1.9)
- Elite (4.5+): **3-5 WAR** (up from 1.2-1.9)
- Good (4.0): **2-3 WAR**
- Average (3.0): **1-2 WAR**
- Fringe (2.5): **0.5-1.5 WAR**

### Peak FIP Range
- Top prospect: **2.80-3.20** (elite ceiling)
- Elite (4.5+): **3.20-3.60**
- Good (4.0): **3.60-4.00**
- Average (3.0): **4.00-4.50**
- #100 prospect: **4.50-4.80** (reasonable for 100th best)

### Level Distribution
- AAA: **30-40%** of top 100 (most proven)
- AA: **30-40%** of top 100 (good balance)
- A-ball: **15-25%** of top 100 (high ceiling prospects)
- Rookie: **5-10%** of top 100 (elite raw talent only)

### Player Card Consistency
- **Table and Modal show SAME numbers**
- Park: FIP 2.84, WAR 4.9, IP 180 (both table and card)
- No more discrepancies between views

---

## What Each Fix Addresses

### Peak WAR Too Low → Separated Projections
**Before**: Peak WAR = regressed projection (accounts for bust risk)
**After**: Peak WAR = peak projection (shows ceiling if they make it)
**Result**: Top prospects show 4-6 WAR peaks (proper star ceiling)

### Young Players Crushed → Softer Factors + Square Root
**Before**: 19yo A-ball prospect = 17.5% confidence → destroyed
**After**: 19yo A-ball prospect = 50% confidence (floor) → viable but uncertain
**Result**: Young high-ceiling prospects rank lower but show elite Peak WAR

### Compressed Distribution → Changed Regression Target
**Before**: Regress toward replacement (5.20 FIP)
**After**: Regress toward average prospect (4.50 FIP)
**Result**: More spread in rankings, not everyone 4.0+

### Player Card Mismatch → Pass TFR Data
**Before**: Modal recalculates projections differently
**After**: Modal uses TFR's pre-calculated projections
**Result**: Consistent numbers everywhere

---

## How It Works Now

### Example: 20yo A-Ball Stud
**Scouting**: 55/65/60 (stuff/control/hra) → Projects 3.40 FIP peak
**Stats**: Limited sample, 70 IP, stats align with scouts

**Confidence Calculation**:
- Age 20: 0.75
- A-ball: 0.75
- Sample <100 IP: 0.85
- Scout-stat agree: 1.00
- **Combined: 0.75 × 0.75 × 0.85 × 1.00 = 0.48**
- **With square root: sqrt(0.48) = 0.69**

**Regression**:
- Ranking FIP: 0.69 × 3.40 + 0.31 × 4.50 = **3.74 FIP**
- Ranks in top 40-50 (uncertain but promising)

**Peak Projection** (un-regressed):
- Peak FIP: **3.40** (his ceiling)
- Peak WAR: **~4.5** (star upside if he makes it)

**Result**: Lower rank (uncertainty) but high upside (Peak WAR)

### Example: 24yo AAA Proven Prospect
**Scouting**: 60/55/55 → Projects 3.50 FIP peak
**Stats**: 200 IP, stats match scouts exactly

**Confidence Calculation**:
- Age 24: 0.92
- AAA: 0.95
- Sample 200+ IP: 1.00
- Scout-stat agree: 1.00
- **Combined: 0.92 × 0.95 × 1.00 × 1.00 = 0.87**
- **With square root: sqrt(0.87) = 0.93**

**Regression**:
- Ranking FIP: 0.93 × 3.50 + 0.07 × 4.50 = **3.57 FIP**
- Ranks in top 10-15 (proven and ready)

**Peak Projection**:
- Peak FIP: **3.50**
- Peak WAR: **~4.0**

**Result**: High rank (certain) and high upside (Peak WAR)

### Example: 23yo AA with Bad Stats
**Scouting**: 55/70/60 → Projects 3.60 FIP peak
**Stats**: 150 IP, FIP 6.00 (way worse than scouts expect)

**Confidence Calculation**:
- Age 23: 0.85
- AA: 0.85
- Sample 100-200 IP: 0.92
- **Scout-stat gap 2.4: 0.80**
- **Combined: 0.85 × 0.85 × 0.92 × 0.80 = 0.53**
- **With square root: sqrt(0.53) = 0.73**

**Regression**:
- Ranking FIP: 0.73 × 3.60 + 0.27 × 4.50 = **3.84 FIP**
- Ranks in top 50-70 (concern about development)

**Peak Projection**:
- Peak FIP: **3.60** (if scouts are right)
- Peak WAR: **~3.5**

**Result**: Moderate rank (concerns) but decent upside (if he figures it out)

---

## Validation Checklist

### Distribution (Top 100)
- [ ] Elite (4.5+): 5-10 players (~5-10%)
- [ ] Above Avg (4.0-4.5): 20-30 players (~20-30%)
- [ ] Average (3.0-4.0): 35-45 players (~35-45%)
- [ ] Fringe (<3.0): 15-25 players (~15-25%)

### Peak WAR Range
- [ ] Top prospect: 4-6 WAR
- [ ] Elite tier (4.5+): 3-5 WAR
- [ ] Good tier (4.0): 2-3 WAR
- [ ] 100th prospect: 0.5-1.5 WAR

### Level Diversity
- [ ] AAA: 30-40% of top 100
- [ ] AA: 30-40% of top 100
- [ ] A-ball: 15-25% of top 100
- [ ] Rookie: 5-10% of top 100

### Data Consistency
- [ ] Farm Rankings table matches Player Profile Modal
- [ ] All prospects show same FIP, WAR, IP in both views
- [ ] No discrepancies between data sources

### Spot Checks
- [ ] Bong-hwan Park: Same numbers in table and modal
- [ ] Young A-ball prospects: Show in top 100 with high Peak WAR
- [ ] Proven AAA prospects: Rank highest
- [ ] Willie Gonzalez types: Low rank but reasonable Peak WAR (if scouts right)

---

**Status**: Iteration 2 fixes applied. Build successful. Ready for testing.
