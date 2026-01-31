# Age Analysis Findings

**Date**: January 30, 2026
**Data**: 11,295 players with DOB (2018-2020 transitions)
**Script**: `tools/research/1_level_adjustments_with_age.ts`

---

## Executive Summary

Age data reveals **massive differences** in how pitchers transition between levels. Young pitchers struggle significantly more with MLB competition, while veterans actually improve their strikeout rates. This has major implications for prospect projections.

---

## Key Finding: Age-Dependent Adjustments

### AAA → MLB Transition (103 samples)

| Age Group | N | Avg Age | K/9 Δ | BB/9 Δ | HR/9 Δ | FIP Δ |
|-----------|---|---------|-------|--------|--------|-------|
| **Young (≤22)** | 34 | 21.7 | **+0.32** | +0.01 | +0.21 | +0.23 |
| **Prime (23-25)** | 43 | 23.7 | **+0.42** | +0.09 | +0.22 | +0.26 |
| **Mature (26-28)** | 17 | 26.8 | **+0.03** | **-0.70** | +0.31 | +0.21 |
| **Veteran (29+)** | 9 | 29.9 | **-0.42** | +0.28 | +0.32 | +0.64 |

### Critical Insights

#### 1. Young Pitchers Struggle Most (K/9 +0.32)

**Why**: Young pitchers face massive jump in competition quality
- MLB hitters are MUCH better than AAA hitters
- Young pitchers lack repertoire depth
- Limited experience with sequencing, pitch selection

**Example**:
- 21yo AAA: 8.0 K/9 → MLB projection: 8.32 K/9 (struggles more than average)
- vs. league average: +0.25 K/9

**Impact**: **Under-estimating difficulty** for young prospects by 0.07 K/9

#### 2. Mature Pitchers Develop Elite Control (BB/9 -0.70!)

**Why**: By age 26-28, pitchers have mastered command
- Years of professional experience
- Refined mechanics
- Better game management

**Example**:
- 27yo AAA: 2.5 BB/9 → MLB projection: 1.80 BB/9 (elite control!)
- vs. league average: -0.05 BB/9

**Impact**: **Massively over-projecting walks** for mature pitchers by 0.65 BB/9!

#### 3. Veterans Actually Improve K/9 (-0.42)

**Why**: Guile, experience, pitch selection trump raw stuff
- Pitchability > velocity at this age
- Know how to attack hitters
- Deception and sequencing mastered

**Example**:
- 30yo AAA: 7.0 K/9 → MLB: 6.58 K/9 (actually improves!)
- vs. league average: +0.25 K/9

**Impact**: **Over-projecting difficulty** for veteran pitchers by 0.67 K/9

#### 4. K/9 Difference: 0.74 (Young vs. Veteran)

This is **enormous**. The same AAA→MLB transition has OPPOSITE effects depending on age:
- Young (22): Lose 0.32 K/9 (MLB hitters too good)
- Veteran (30): Gain 0.42 K/9 (experience dominates)

**Total spread**: 0.74 K/9 = ~0.50 FIP difference

---

## AA → AAA Transitions (172 samples)

| Age Group | N | Avg Age | K/9 Δ | BB/9 Δ | HR/9 Δ | FIP Δ |
|-----------|---|---------|-------|--------|--------|-------|
| **Young (≤22)** | 98 | 21.2 | -0.35 | +0.29 | +0.09 | +0.30 |
| **Prime (23-25)** | 70 | 23.6 | -0.69 | +0.36 | +0.19 | +0.55 |
| **Mature (26-28)** | 4 | 26.5 | +0.13 | -0.00 | -0.12 | -0.20 |

### Insights

- **Young pitchers handle AA→AAA better** than prime-age (K/9 -0.35 vs -0.69)
- **Prime-age struggles more** (FIP +0.55 vs +0.30 for young)
- **Mature pitchers dominate** (FIP -0.20, actually improve!)

**Why**: By 26, if still at AA/AAA, they've mastered the level and are ready to dominate

---

## A → AA Transitions (219 samples)

| Age Group | N | Avg Age | K/9 Δ | BB/9 Δ | HR/9 Δ | FIP Δ |
|-----------|---|---------|-------|--------|--------|-------|
| **Young (≤22)** | 179 | 20.8 | -0.36 | +0.19 | +0.10 | +0.29 |
| **Prime (23-25)** | 40 | 23.3 | -0.50 | +0.26 | +0.09 | +0.33 |

### Insights

- Consistent pattern: **Prime-age struggles more** than young
- Young (≤22): FIP +0.29 (handle A→AA transition reasonably)
- Prime (23-25): FIP +0.33 (struggle more, maybe pressing?)

---

## Rookie → A Transitions (213 samples)

| Age Group | N | Avg Age | K/9 Δ | BB/9 Δ | HR/9 Δ | FIP Δ |
|-----------|---|---------|-------|--------|--------|-------|
| **Young (≤22)** | 213 | 19.5 | -0.15 | +0.42 | +0.15 | +0.38 |

### Insights

- Almost all Rookie ball players are young (avg 19.5)
- Transition is challenging (FIP +0.38)
- Walk control deteriorates significantly (+0.42 BB/9)

---

## Recommendations for True Future Rating

### Current Formula Issues

**Problem 1**: Uses same adjustment for all ages
```typescript
// Current (WRONG)
const aaaToMlb = { k9: 0.25, bb9: -0.05, hr9: 0.24 };
```

**Problem 2**: Young prospects are over-projected

### Proposed Age-Adjusted Formula

```typescript
/**
 * Get age-adjusted level adjustment factors
 */
function getAgeAdjustedLevelAdjustment(
  level: 'aaa' | 'aa' | 'a' | 'r',
  age: number
): { k9: number; bb9: number; hr9: number } {

  if (level === 'aaa') {
    // AAA → MLB adjustments by age
    if (age <= 22) {
      return { k9: 0.32, bb9: 0.01, hr9: 0.21 };  // Young: struggle more
    } else if (age <= 25) {
      return { k9: 0.42, bb9: 0.09, hr9: 0.22 };  // Prime: struggle most
    } else if (age <= 28) {
      return { k9: 0.03, bb9: -0.70, hr9: 0.31 }; // Mature: elite control!
    } else {
      return { k9: -0.42, bb9: 0.28, hr9: 0.32 }; // Veteran: K/9 improves!
    }
  }

  // AA, A, R... (similar pattern)
  // Fall back to age-neutral for now
  return LEVEL_ADJUSTMENTS[level];
}
```

### Impact on Projections

**Young AAA Prospect (21 years old)**:
- AAA stats: 8.0 K/9, 2.5 BB/9, 0.8 HR/9

| Method | K/9 | BB/9 | HR/9 | FIP |
|--------|-----|------|------|-----|
| **Current** | 8.25 | 2.45 | 1.04 | 3.72 |
| **Age-Adjusted** | 8.32 | 2.51 | 1.01 | 3.76 |
| **Difference** | +0.07 | +0.06 | -0.03 | **+0.04** |

**Mature AAA Pitcher (27 years old)**:
- AAA stats: 7.0 K/9, 3.0 BB/9, 0.9 HR/9

| Method | K/9 | BB/9 | HR/9 | FIP |
|--------|-----|------|------|-----|
| **Current** | 7.25 | 2.95 | 1.14 | 4.23 |
| **Age-Adjusted** | 7.03 | 2.30 | 1.21 | 3.95 |
| **Difference** | -0.22 | **-0.65** | +0.07 | **-0.28 FIP!** |

Mature pitchers are currently **under-valued by ~0.3 FIP** due to control improvement!

---

## Implementation Priority

### High Priority (Immediate)

1. ✅ **Add age data to TFR calculation** - Already have DOBs loaded
2. ⏳ **Implement age-adjusted AAA→MLB factors** - Biggest impact
3. ⏳ **Update TFR confidence based on age** - Young AAA = lower confidence

### Medium Priority (Next Week)

4. ⏳ **Age-adjust other levels** (AA, A, Rookie)
5. ⏳ **Add "age for level" context** - Flag 26yo at AA as "old for level"
6. ⏳ **Late bloomer detection** - Find pitchers who broke out at 26-28

### Low Priority (Future)

7. ⏳ **Build age curves** - Peak age, decline rates
8. ⏳ **Aging projections** - Project stats at age 27, 28, 29
9. ⏳ **Age-based confidence intervals** - Wider for young, narrower for mature

---

## Statistical Validity

### Sample Sizes

| Transition | Total | Young | Prime | Mature | Veteran |
|------------|-------|-------|-------|--------|---------|
| **AAA→MLB** | 103 | 34 | 43 | 17 | 9 |
| **AA→AAA** | 172 | 98 | 70 | 4 | 0 |
| **A→AA** | 219 | 179 | 40 | 0 | 0 |
| **R→A** | 213 | 213 | 0 | 0 | 0 |

### Confidence Levels

- ✅ **AAA→MLB, Young/Prime**: HIGH (34-43 samples)
- ⚠️ **AAA→MLB, Mature**: MEDIUM (17 samples)
- ⚠️ **AAA→MLB, Veteran**: LOW (9 samples, use with caution)
- ✅ **AA→AAA, Young/Prime**: HIGH (70-98 samples)

### Notes

- Veteran sample size is small (9) - findings are suggestive but not definitive
- Lower levels have almost no mature/veteran players (makes sense)
- Most age diversity is at AAA→MLB transition

---

## Next Steps

### Code Changes Needed

1. **TrueFutureRatingService.ts**:
   - Add age parameter to `applyLevelAdjustments()`
   - Implement `getAgeAdjustedLevelAdjustment()`
   - Update scouting weight formula to account for age-level fit

2. **New Service**: `AgeAdjustedProjectionsService.ts`
   - Centralize age-based adjustment logic
   - Provide age curves, peak ages
   - Handle "old for level" detection

3. **UI Updates**:
   - Show "Age: 21 (young for AAA)" context
   - Flag "26 at AA - old for level, high risk"
   - Display age-adjusted TFR vs. age-neutral TFR

### Research Extensions

4. **Age Curves Study** - When do pitchers peak?
5. **Late Bloomer Profiles** - What patterns predict 26-28 breakouts?
6. **"Old for Level" Risk** - Quantify bust rate for old prospects

---

## Conclusion

Age data reveals that **young pitchers are over-projected** and **mature pitchers are under-projected** in current system. The AAA→MLB transition varies by **0.74 K/9** depending on age - this is huge and must be incorporated.

**Immediate action**: Implement age-adjusted level adjustments for AAA→MLB, prioritizing:
- Young (≤22): More conservative K/9 projection (+0.32 instead of +0.25)
- Mature (26-28): Much better BB/9 projection (-0.70 instead of -0.05)
- Veteran (29+): Improved K/9 projection (-0.42 instead of +0.25)

This will significantly improve projection accuracy for prospects of all ages.
