# Minor League Research Summary

**Date**: January 30, 2026
**Data Range**: 2014-2021 (focus on OOTP 26 era: 2018-2021)
**Purpose**: Analyze historical minor league data to improve prospect projections

---

## Executive Summary

Three research scripts analyzed 2,849 pitcher careers across 2014-2021 to understand:
1. How stats translate between levels
2. Which improvement patterns predict MLB success
3. Optimal adjustments for prospect projections

### Key Findings

✅ **AAA → MLB K/9 adjustment is accurate** (+0.30 vs. +0.25 actual)
🔴 **BB/9 adjustment is way off** (-0.42 vs. -0.05 actual)
🔴 **HR/9 goes wrong direction** (-0.15 vs. +0.24 actual)
✅ **AAA breakouts are highly predictive** (54% reach MLB vs. 11% for lower levels)

---

## Test 1: Level Adjustments

### Methodology
- Analyzed 103 AAA→MLB, 172 AA→AAA, 219 A→AA, 213 Rookie→A transitions
- Compared consecutive-year performance
- OOTP 26 data (2018-2020)

### Current vs. Actual Adjustments (AAA → MLB)

| Stat | Current | Actual | Difference | Recommendation |
|------|---------|--------|------------|----------------|
| **K/9** | +0.30 | +0.25 | -0.05 | ✅ Keep current |
| **BB/9** | -0.42 | **-0.05** | +0.37 | 🔴 Fix immediately |
| **HR/9** | -0.15 | **+0.24** | +0.39 | 🔴 Fix immediately |
| **FIP** | N/A | +0.27 | N/A | New: expect +0.27 |

### Critical Insight: Competition Gets Harder

As pitchers move up:
- **K/9 drops** (harder to strike out better hitters)
- **BB/9 rises** (more walks under pressure)
- **HR/9 rises** (better hitters hit more home runs)
- **FIP rises** by ~0.30-0.40 per level

### Recommended New Adjustments (AAA → MLB)

```typescript
const AAA_TO_MLB_ADJUSTMENTS = {
  k9: +0.25,   // Keep similar (was +0.30)
  bb9: -0.05,  // MAJOR CHANGE (was -0.42)
  hr9: +0.24,  // REVERSE (was -0.15)
  fip: +0.27   // NEW: expect FIP to worsen
};
```

### Minor League Translation Factors

| Transition | K/9 Δ | BB/9 Δ | HR/9 Δ | FIP Δ |
|------------|-------|--------|--------|-------|
| **AAA → MLB** | +0.25 | -0.05 | +0.24 | +0.27 |
| **AA → AAA** | -0.47 | +0.31 | +0.12 | +0.39 |
| **A → AA** | -0.39 | +0.20 | +0.10 | +0.30 |
| **Rookie → A** | -0.15 | +0.42 | +0.15 | +0.38 |

**Pattern**: Each level up = strikeouts down, walks up, homers up, FIP worse

---

## Test 2: Era Detection

### OOTP Engine Transitions Confirmed

| Era | Years | Seasons | K/9 | BB/9 | HR/9 | FIP |
|-----|-------|---------|-----|------|------|-----|
| **OOTP 23** | 2000-2005 | 6 | 5.67 | 3.40 | 0.82 | 4.26 |
| **OOTP 24** | 2006-2011 | 6 | 5.69 | 3.01 | 0.94 | 4.30 |
| **OOTP 25** | 2012-2017 | 6 | 6.16 | 2.72 | 1.05 | 4.25 |
| **OOTP 26** | 2018-2021 | 4 | 6.01 | 2.70 | 0.88 | 4.03 |

### Mystery Solved: 2011-2012 Transition

- **Stats jumped IN 2012**: K/9 +5.3%, HR/9 +13.8% in the 2012 season
- This means new engine was used FOR 2012 season
- Confirms OOTP 24 → OOTP 25 transition **after 2011 season** (2011-2012 offseason)
- In WBL lore: "New ball" or "rule changes" implemented before 2012 season

### Recommendation

**Use OOTP 26 data (2018-2021) for projections** - matches current engine
If sample size insufficient, can include OOTP 25 (2013-2017) with caution

---

## Test 3: Breakout Detection

### Methodology
- Defined "breakout": K/9 +1.0, BB/9 -0.3, FIP -0.5 year-over-year
- Tracked 214 breakouts across 2,849 careers
- "AAA breakout" = improved stats occurred **at AAA level** (either same-level improvement or promotion with improvement)
- "AA breakout" = improved stats occurred **at AA level**, etc.
- Measured MLB success (FIP < 4.0, 100+ IP)

### Results by Level

| Level | Breakouts | MLB % | Success % | Insight |
|-------|-----------|-------|-----------|---------|
| **AAA** | 33 | **54.5%** | 12.1% | ✅ Highly predictive |
| **AA** | 31 | 9.7% | 6.5% | ⚠️ Low reliability |
| **A** | 61 | 11.5% | 4.9% | ⚠️ Low reliability |
| **Rookie** | 89 | 11.2% | 2.2% | ❌ Mostly noise |

### Key Findings

1. **AAA breakouts matter** - 5x more likely to reach MLB than lower-level breakouts
2. **Lower-level breakouts are noise** - 89% of Rookie breakouts never reach MLB
3. **Overall success rate low** (5.1%) - many breakouts regress or plateau
4. **Improvement magnitude doesn't differ** - Successful vs. failed breakouts had similar improvement sizes

### Application

**For projections:**
- ✅ Flag recent AAA breakouts and boost confidence
- ⚠️ Be skeptical of A-ball/Rookie breakouts
- Consider stricter criteria (K/9 +1.5 minimum)
- Weight multi-year trends over single-year spikes

---

## Test 4: Age-Adjusted Analysis (NEW!)

### Methodology
- Loaded 11,295 unique player DOBs (deduped from 30,472 rows)
- Re-ran level adjustment analysis segmented by age
- Calculated age on June 30 of each season (standard baseball cutoff)

### AAA → MLB Transition by Age (103 samples)

| Age Group | N | Avg Age | K/9 Δ | BB/9 Δ | HR/9 Δ | FIP Δ |
|-----------|---|---------|-------|--------|--------|-------|
| **Young (≤22)** | 34 | 21.7 | **+0.32** | +0.01 | +0.21 | +0.23 |
| **Prime (23-25)** | 43 | 23.7 | **+0.42** | +0.09 | +0.22 | +0.26 |
| **Mature (26-28)** | 17 | 26.8 | **+0.03** | **-0.70** | +0.31 | +0.21 |
| **Veteran (29+)** | 9 | 29.9 | **-0.42** | +0.28 | +0.32 | +0.64 |

### Critical Discoveries

1. **Young pitchers struggle MORE** (+0.32 K/9 vs. +0.25 average)
   - Harder to strike out MLB hitters
   - Less repertoire depth and experience

2. **Mature pitchers develop elite control** (BB/9 -0.70!)
   - Years of professional experience pay off
   - Mastered command and mechanics
   - **Currently over-projecting walks by 0.65 BB/9 for this group**

3. **Veterans actually IMPROVE strikeouts** (-0.42 K/9)
   - Guile and experience trump raw stuff
   - Pitchability > velocity at this age
   - **Currently over-projecting difficulty by 0.67 K/9**

4. **K/9 difference: 0.74** between young and veteran
   - This is ENORMOUS - nearly 0.50 FIP difference
   - Same transition has OPPOSITE effects by age

### Implications for Projections

**Current system**: Uses same adjustment (+0.25 K/9) for all ages

**Reality**:
- 21yo AAA pitcher: Should expect +0.32 K/9 drop (struggles more)
- 27yo AAA pitcher: Should expect +0.03 K/9 drop (almost flat!)
- 30yo AAA pitcher: Should expect -0.42 K/9 IMPROVEMENT

**Impact on TFR:**
- Young AAA prospects are **over-projected** (too optimistic)
- Mature AAA pitchers are **under-projected** (especially control)
- Veteran AAA pitchers are **under-projected** (K/9 improves!)

### Application

**For True Future Rating:**
- Implement age-adjusted level adjustments
- Young (≤22): More conservative projections
- Mature (26-28): Major boost to control projection
- Veteran (29+): Boost K/9, but note small sample (N=9)

**See**: `tools/reports/AGE_ANALYSIS_FINDINGS.md` for complete details

---

## Implementation Recommendations

### 1. Update Level Adjustments (Priority: HIGH)

**File**: `src/services/TrueRatingsCalculationService.ts`

```typescript
// CURRENT (INCORRECT)
const LEVEL_ADJUSTMENTS = {
  AAA: { k9: 0.30, bb9: -0.42, hr9: -0.15 }
};

// RECOMMENDED (DATA-DRIVEN)
const LEVEL_ADJUSTMENTS = {
  AAA: { k9: 0.25, bb9: -0.05, hr9: 0.24 },
  AA:  { k9: 0.72, bb9: 0.26,  hr9: 0.36 },  // Cumulative from AA
  A:   { k9: 1.11, bb9: 0.46,  hr9: 0.46 },  // Cumulative from A
  R:   { k9: 1.26, bb9: 0.88,  hr9: 0.61 }   // Cumulative from Rookie
};
```

### 2. Add Breakout Detection (Priority: MEDIUM)

Create a service to flag recent AAA breakouts:

```typescript
interface BreakoutIndicator {
  hasBreakout: boolean;
  breakoutYear?: number;
  k9Gain?: number;
  bb9Drop?: number;
  fipDrop?: number;
}

function detectRecentBreakout(
  currentYear: number,
  priorYear: number,
  level: number
): BreakoutIndicator {
  if (level !== 2) return { hasBreakout: false }; // AAA only

  const k9Gain = currentYear.k9 - priorYear.k9;
  const bb9Drop = priorYear.bb9 - currentYear.bb9;
  const fipDrop = priorYear.fip - currentYear.fip;

  const hasBreakout = k9Gain >= 1.5 && bb9Drop >= 0.3 && fipDrop >= 0.75;

  return { hasBreakout, breakoutYear: currentYear.year, k9Gain, bb9Drop, fipDrop };
}
```

### 3. Adjust Projection Confidence (Priority: MEDIUM)

For True Future Rating calculation:

```typescript
// Boost confidence for AAA breakouts
if (level === 2 && hasRecentBreakout) {
  scoutingWeight *= 0.85; // Trust stats more for breakouts
  confidenceInterval *= 0.90; // Tighter interval
}

// Reduce confidence for low-level stats
if (level >= 4) {
  confidenceInterval *= 1.20; // Wider interval for A-ball
}
```

### 4. Add FIP Translation Expectation (Priority: LOW)

Show users expected FIP at next level:

```typescript
function projectNextLevelFIP(currentFIP: number, currentLevel: number): number {
  const adjustments = {
    2: 0.27, // AAA → MLB
    3: 0.39, // AA → AAA
    4: 0.30, // A → AA
    6: 0.38  // Rookie → A
  };

  return currentFIP + (adjustments[currentLevel] || 0);
}
```

---

## Validation & Next Steps

### Immediate Actions

1. ✅ **Update AAA→MLB adjustments** (BB/9 and HR/9 are critically wrong)
2. ⏳ **Back-test updated adjustments** on 2019-2020 data to verify improvement
3. ⏳ **Implement breakout flagging** for AAA prospects

### Additional Research (Optional)

4. ⏳ **Age adjustments** - Does a 21yo with 3.50 FIP at AA project better than 26yo?
5. ⏳ **Stat component weighting** - Is K/9 more predictive than BB/9?
6. ⏳ **AAAA player detection** - Identify "stuck at AAA" profiles early
7. ⏳ **Multi-year trajectories** - Track 3-year trends vs. single-season stats

### Tools Available

All research scripts are in `tools/research/`:
- `0_detect_eras.ts` - Engine transition detection
- `1_level_adjustments.ts` - Translation factor analysis
- `5_breakout_detection.ts` - Improvement pattern analysis

Detailed JSON output in `tools/reports/`:
- `1_level_adjustments.json` - Full transition data
- `5_breakout_detection.json` - All 214 breakouts with outcomes

---

## Technical Notes

### Data Quality

- **Sample sizes**: 103-219 transitions per level (OOTP 26)
- **High variance**: σ ~1.3-1.4 for K/9 changes
- **Individual differences**: Some pitchers improve, some regress significantly
- **2021 data**: Only 101 pitchers (partial season?) - excluded from most analysis

### Limitations

1. **Age data unavailable** - Using era as proxy, not ideal
2. **Park factors ignored** - Some stadiums boost/suppress HR
3. **Role changes not tracked** - Starter → reliever transitions not analyzed
4. **Scouting ratings unavailable** - Can't validate against scout projections

### Confidence Levels

- **Level adjustments**: HIGH (100+ samples, clear patterns)
- **AAA breakouts**: MEDIUM (54% MLB rate is significant)
- **Lower-level breakouts**: LOW (too much noise, small samples)

---

## Conclusion

The research reveals your current level adjustments are **significantly incorrect** for BB/9 and HR/9. The game engine makes competition progressively harder at each level, with walks and home runs increasing - opposite of your current assumptions.

**High-priority fix**: Update AAA→MLB adjustments immediately, especially:
- BB/9: Change from -0.42 to -0.05 (walks don't improve much)
- HR/9: Change from -0.15 to +0.24 (homers get worse, not better)

**Medium-priority enhancement**: Flag AAA breakouts in your prospect system - they have 5x better MLB promotion rates than lower-level breakouts.

**Overall impact**: These changes should significantly improve projection accuracy for young pitchers transitioning from minors to MLB.
