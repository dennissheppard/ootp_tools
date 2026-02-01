# Peak TFR Implementation Plan

## Philosophy
**TFR = True Future Rating = Peak/Ceiling Projection**

"If this prospect develops as expected and reaches age 27 healthy, what will they be?"

- No confidence penalties
- No regression
- Pure ceiling projection
- Accept that many won't reach ceiling (that's prospect risk, not rating error)

---

## Algorithm Overview

### Step 1: Filter Prospects (75 IP Minimum)
```typescript
// Only rate prospects with meaningful sample size
const qualified = prospects.filter(p => p.totalMinorIp >= 75);
```

**Why 75 IP:**
- MLB relievers (~60 IP) are hard to project
- Minor leaguers with less data are pure noise
- Focuses on prospects with track record

### Step 2: Blend Scouting + Stats (Separately for Each Component)

**For STUFF (→ K/9):**
```typescript
scoutK9 = convertScoutingToK9(scouting.stuff);
minorK9 = weightedAverage(minorLeague.k9, adjustedForLevel);
stuffValue = (scoutK9 * scoutWeight) + (minorK9 * (1 - scoutWeight));
```

**For CONTROL (→ BB/9):**
```typescript
scoutBB9 = convertScoutingToBB9(scouting.control);
minorBB9 = weightedAverage(minorLeague.bb9, adjustedForLevel);
controlValue = (scoutBB9 * scoutWeight) + (minorBB9 * (1 - scoutWeight));
```

**For HRA (→ HR/9):**
```typescript
scoutHR9 = convertScoutingToHR9(scouting.hra);
minorHR9 = weightedAverage(minorLeague.hr9, adjustedForLevel);
hraValue = (scoutHR9 * scoutWeight) + (minorHR9 * (1 - scoutWeight));
```

**Scouting Weight (simplified - no confidence penalty):**
- Age <23: 0.70 (trust scouts - less developed)
- Age 23-25: 0.50 (balanced)
- Age 26+: 0.30 (trust stats - near ceiling)

### Step 3: Rank Each Component

```typescript
// Sort all prospects by stuffValue
const stuffSorted = [...prospects].sort((a, b) => b.stuffValue - a.stuffValue);

// Assign percentiles
for (let i = 0; i < stuffSorted.length; i++) {
  stuffSorted[i].stuffPercentile = ((stuffSorted.length - i - 1) / (stuffSorted.length - 1)) * 100;
}

// Repeat for control and HRA
```

### Step 4: Build MLB Percentile Distributions

```typescript
// Load MLB pitchers from 2015-2017 (all ages for full distribution)
const mlbPitchers = loadMLBStats([2015, 2016, 2017]);

// Calculate percentiles (0, 10, 20, ... 100)
const mlbDistribution = {
  percentiles: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  k9Values: [/* actual MLB K/9 at each percentile */],
  bb9Values: [/* actual MLB BB/9 at each percentile */],
  hr9Values: [/* actual MLB HR/9 at each percentile */]
};
```

### Step 5: Map Percentiles to MLB Rates

```typescript
// For each prospect:
projK9 = interpolate(stuffPercentile, mlbDistribution.k9Values);
projBB9 = interpolate(100 - controlPercentile, mlbDistribution.bb9Values); // Inverted
projHR9 = interpolate(100 - hraPercentile, mlbDistribution.hr9Values); // Inverted
```

**Key:** Higher percentile = better. So for BB/9 and HR/9 (where lower is better), we invert.

### Step 6: Calculate Peak FIP & Rating

```typescript
peakFIP = ((13 * projHR9 + 3 * projBB9 - 2 * projK9) / 9) + 3.47;

// Convert to 0.5-5.0 star rating
// Compare peak FIP to MLB distribution
const percentile = getFIPPercentile(peakFIP, mlbDistribution);

if (percentile >= 98) tfr = 5.0; // Elite
else if (percentile >= 95) tfr = 4.5; // Star
else if (percentile >= 85) tfr = 4.0; // Above Average
else if (percentile >= 70) tfr = 3.5; // Average
else if (percentile >= 50) tfr = 3.0; // Fringe
// etc.
```

---

## Key Changes from Current System

### REMOVED:
- ❌ Confidence factor regression
- ❌ Age-based confidence penalties
- ❌ Level-based confidence penalties
- ❌ IP-based confidence penalties
- ❌ Regression toward replacement level
- ❌ "Ranking FIP" vs "projected FIP" split

### ADDED:
- ✅ 75 IP minimum requirement
- ✅ Separate stuff/control/HRA tracking
- ✅ Direct percentile-based mapping
- ✅ Simplified scouting weight (just by age)
- ✅ Clear "this is a ceiling projection" philosophy

### KEPT:
- ✅ Scouting + minor league stat blending
- ✅ Level adjustments (for converting AAA K9 → MLB equivalent)
- ✅ Age-based scouting weight
- ✅ Percentile-based rating assignment

---

## Level Adjustments (Simplified)

Since we're mapping to percentiles, level adjustments become less critical (they just affect the blended value before ranking).

Keep the reduced adjustments:
```typescript
const LEVEL_ADJUSTMENTS = {
  aaa: { k9: 0.10, bb9: 0.00, hr9: 0.20 },
  aa:  { k9: 0.02, bb9: 0.18, hr9: 0.22 },
  a:   { k9: -0.08, bb9: 0.22, hr9: 0.27 },
  r:   { k9: -0.12, bb9: 0.36, hr9: 0.30 }
};
```

---

## Example Walkthrough

**Prospect: Mike Verhappen, Age 23**

**Step 1: Blend Components**
- Scouting: Stuff 75, Control 70, HRA 65
- Minor: 174 IP, K9 8.5, BB9 2.8, HR9 0.9
- Scouting weight (age 23): 0.70

Stuff blend:
- Scout: 75 → ~8.0 K9
- Minor (adj): 8.5 → 8.6 K9 (AAA adjustment +0.10)
- Blended: (8.0 * 0.70) + (8.6 * 0.30) = 8.18 K9

Control blend:
- Scout: 70 → ~2.5 BB9
- Minor (adj): 2.8 → 2.8 BB9
- Blended: (2.5 * 0.70) + (2.8 * 0.30) = 2.59 BB9

HRA blend:
- Scout: 65 → ~1.0 HR9
- Minor (adj): 0.9 → 1.1 HR9 (AAA adjustment +0.20)
- Blended: (1.0 * 0.70) + (1.1 * 0.30) = 1.03 HR9

**Step 2: Rank Among Prospects**
- Stuff value 8.18 → 85th percentile
- Control value 2.59 → 75th percentile
- HRA value 1.03 → 80th percentile

**Step 3: Map to MLB Distributions**
- 85th percentile K9 in MLB = 8.8 K9
- 75th percentile BB9 in MLB (inverted) = 2.4 BB9
- 80th percentile HR9 in MLB (inverted) = 0.9 HR9

**Step 4: Calculate Peak FIP**
- FIP = ((13 * 0.9 + 3 * 2.4 - 2 * 8.8) / 9) + 3.47
- FIP = 3.55

**Step 5: Assign TFR**
- 3.55 FIP → ~85th percentile → **4.0 Stars** (Above Average)

---

## Expected Results

**Distribution (511 prospects, 75 IP filter):**
- Elite (5.0): ~10 prospects (top 2%)
- Star (4.5): ~15 prospects (top 5%)
- Above Avg (4.0): ~50 prospects (top 15%)
- Average (3.5): ~100 prospects (top 30%)

**Validation metrics:**
- Correlation: 0.20-0.35 (better than current 0.14)
- MAE: 1.0-1.3 (acceptable for ceiling projections)
- Elite arrival rate: 40-60% (up from 33%)

**Key insight:**
- MAE will be higher (projections optimistic) - that's expected!
- Correlation more important than MAE for ceiling projections
- Success = higher-rated prospects reach MLB more often

---

## Implementation Steps

1. **Modify TrueFutureRatingService.ts:**
   - Add 75 IP minimum filter
   - Separate blending for stuff/control/HRA
   - Build MLB percentile distributions
   - Map percentiles to rates
   - Remove confidence regression

2. **Update interfaces:**
   ```typescript
   interface TrueFutureRatingResult {
     // ... existing fields
     stuffPercentile: number;
     controlPercentile: number;
     hraPercentile: number;
     projK9: number;
     projBB9: number;
     projHR9: number;
     // Remove: confidence, rankingFip
   }
   ```

3. **Test on 2017 data:**
   - Export new TFRs
   - Run validation
   - Compare to current system

4. **If better:**
   - Deploy to production
   - Update documentation
   - Remove old confidence logic

---

## Rollback Plan

Keep current TrueFutureRatingService.ts as TrueFutureRatingService_old.ts

If new system performs worse:
- Revert to old system
- Analyze what went wrong
- Iterate

---

## Questions to Answer

Before implementing, confirm:

1. ✅ 75 IP minimum acceptable? (filters ~200 prospects)
2. ✅ Peak/ceiling projection philosophy correct?
3. ✅ Okay with higher MAE if correlation improves?
4. ✅ Age-based scouting weight simplified (70/50/30)?

---

Ready to implement?
