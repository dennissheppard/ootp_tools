# Rating Estimator Feature Plan

## Overview

A "reverse calculator" that estimates pitcher ratings from actual stats, helping users evaluate scout accuracy by comparing:
- **Scout ratings** (what your in-game scout says)
- **OSA ratings** (the game's basic scouting service)
- **Estimated ratings** (derived from actual performance in the WBL environment)

This answers the question: "How accurate is my scout?"

---

## Important: How OOTP Ratings Actually Work

### The Hidden 500-Point Scale

OOTP uses a **hidden 500-point scale** internally, which gets converted to the visible 20-80 scale and rounded to the nearest 5. This means:

- A displayed "50" could be anywhere from ~47.5 to ~52.5 on the true scale
- A displayed "60" could be ~57.5 to ~62.5
- **Two pitchers with the same displayed rating can have different true ratings**

### 1:1 Correlations (Per Game Engine)

The game engine uses **direct 1:1 correlations**:
- **Control → BB**: Walks are directly determined by Control
- **Stuff → K**: Strikeouts are directly determined by Stuff
- **HRA → HR**: Home runs are directly determined by HRA

The variance we see in the data (R² < 1.0) is **not prediction error** - it's the rounding noise from the 500→20-80 conversion.

### The Movement/BABIP/HRA Relationship

In the OOTP editor:
- **Movement** is the "primary" rating (what you see and edit)
- **BABIP** can be directly edited
- **HRA** is derived/calculated - you cannot directly edit it

Movement appears to be derived from BABIP and HRA combined, but since you edit Movement and BABIP, the game back-calculates HRA.

---

## The Math (Verified Jan 2026)

### Final WBL-Calibrated Linear Formulas

These are **1:1 relationships** in the game engine. All variance comes from the hidden 500-point scale being rounded to 20-80.

#### Control ↔ BB/9

**Forward (Rating → Stat):**
```
BB/9 = 5.22 - 0.052 × Control
```

**Inverse (Stat → Rating):**
```
Control = (5.22 - BB/9) / 0.052
Control = 100.4 - 19.2 × BB/9
```

| BB/9 | Estimated Control |
|------|-------------------|
| 1.5  | 71 |
| 2.0  | 62 |
| 2.5  | 52 |
| 3.0  | 43 |
| 3.5  | 33 |

**Accuracy**: ±5 rating points (rounding + sample variance)

#### Stuff ↔ K/9

**Forward (Rating → Stat):**
```
K/9 = 2.07 + 0.074 × Stuff
```

**Inverse (Stat → Rating):**
```
Stuff = (K/9 - 2.07) / 0.074
Stuff = -28.0 + 13.5 × K/9
```

| K/9 | Estimated Stuff |
|-----|-----------------|
| 5.0 | 40 |
| 6.0 | 53 |
| 7.0 | 67 |
| 8.0 | 80 |

**Accuracy**: ±8 rating points

#### HRA ↔ HR/9 (Verified from OOTP Calculator)

**Forward (Rating → Stat):**
```
HR/9 = 2.08 - 0.024 × HRA
```
*Note: WBL is ~64% of neutral MLB HR rates*

**Inverse (Stat → Rating):**
```
HRA = (2.08 - HR/9) / 0.024
HRA = 86.7 - 41.7 × HR/9
```

| HR/9 | Estimated HRA |
|------|---------------|
| 0.50 | 66 |
| 0.70 | 58 |
| 0.85 | 51 |
| 1.00 | 45 |
| 1.20 | 37 |

**Accuracy**: ±11 rating points (HRs are rare events with high variance)

#### BABIP ↔ H/9: NOT ESTIMABLE

**Why it fails**: Calculator shows perfect 1:1, but league data shows R² = 0.02

- Team defense dominates hit outcomes
- Park factors vary significantly
- BABIP is the most "luck-dependent" stat

**Recommendation**: Do not estimate BABIP from stats. Show message:
> "BABIP cannot be estimated from stats due to defense and park factors"

---

## Confidence Bands

### Two Sources of Uncertainty

1. **Rounding uncertainty**: ±2.5 rating points (always present due to 500→20-80 conversion)
2. **Sample size uncertainty**: Small IP means stat might not reflect true talent yet

### Sample Size Adjustment

Stats stabilize over innings. Rough stabilization points:
- **BB/9**: ~200 IP (walks stabilize relatively quickly)
- **K/9**: ~150 IP (strikeouts stabilize quickly)
- **HR/9**: ~300+ IP (home runs are rare events, high variance)

For sample sizes below stabilization:
```
Additional_Uncertainty ≈ Base_Variance * sqrt(Stabilization_IP / Actual_IP)
```

**Example for HR/9**:
- 300 IP → ±2.5 (just rounding)
- 150 IP → ±3.5 (rounding + sample noise)
- 75 IP → ±5.0 (high uncertainty)

### Display Approach

Instead of R²-based confidence (which was misleading), show:

| IP Range | Confidence Label | Note |
|----------|------------------|------|
| 200+ IP  | High | "Estimate reliable" |
| 100-200  | Moderate | "Estimate may vary ±5" |
| < 100 IP | Low | "Small sample - treat as rough guide" |

### The ±2.5 Rounding Band

Since we can't know the true 500-point rating, always show:
```
Estimated: 65 (could be 62-67 on true scale)
```

This helps users understand why their "60 Control" pitcher might perform like a 58 or 62.

---

## UI Design

### Input Section

```
┌─────────────────────────────────────────────────────────┐
│  Rating Estimator - "How Accurate Is Your Scout?"       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Player Stats                    Comparison (optional)  │
│  ┌─────────────────────────┐    ┌────────────────────┐ │
│  │ IP:    [____180____]    │    │ Scout  OSA         │ │
│  │ K/9:   [____7.2____]    │    │ STF: [50]  [50]    │ │
│  │ BB/9:  [____2.5____]    │    │ CON: [60]  [50]    │ │
│  │ HR/9:  [____0.8____]    │    │ HRA: [55]  [55]    │ │
│  │ H/9:   [____9.0____]    │    │ MOV: [50]  [--]    │ │
│  └─────────────────────────┘    │ BAB: [50]  [--]    │ │
│                                  └────────────────────┘ │
│  [Estimate Ratings]                                     │
└─────────────────────────────────────────────────────────┘
```

### Output Section

```
┌─────────────────────────────────────────────────────────┐
│  Estimated Ratings                                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Rating     Estimated    Scout    OSA     Verdict       │
│  ────────────────────────────────────────────────────── │
│  Control    72 ±5 ●●●●○  60       50      Scout LOW ⚠️  │
│  Stuff      53 ±8 ●●●○○  50       50      ✓ Accurate    │
│  HRA        58 ±7 ●●●○○  55       55      ✓ Accurate    │
│  Movement   --           50       --      (not estimated)│
│  BABIP      --           50       --      (not estimated)│
│                                                         │
│  ● = confidence (more = better)                         │
│  Bands based on 180 IP sample size                      │
└─────────────────────────────────────────────────────────┘
```

### Verdict Logic

```
If |Estimated - Scout| <= uncertainty:
    "✓ Accurate"
Else if Estimated > Scout + uncertainty:
    "Scout LOW ⚠️" (scout is underrating)
Else:
    "Scout HIGH ⚠️" (scout is overrating)
```

---

## Implementation

### New Files

1. **`src/services/RatingEstimatorService.ts`** - Core estimation logic
2. **`src/views/RatingEstimatorView.ts`** - UI component

### RatingEstimatorService.ts

```typescript
interface StatInput {
  ip: number;
  k9: number;
  bb9: number;
  hr9: number;
  h9?: number;
}

interface RatingEstimate {
  rating: number;
  low: number;      // lower bound of confidence interval
  high: number;     // upper bound
  confidence: 'high' | 'moderate' | 'low';
  r2: number;
}

interface EstimatedRatings {
  stuff: RatingEstimate;
  control: RatingEstimate;
  hra: RatingEstimate;
  movement?: RatingEstimate;  // null if not estimable
  babip?: RatingEstimate;
}

class RatingEstimatorService {
  static estimateControl(bb9: number, ip: number): RatingEstimate { ... }
  static estimateStuff(k9: number, ip: number): RatingEstimate { ... }
  static estimateHRA(hr9: number, ip: number): RatingEstimate { ... }
  static estimateAll(stats: StatInput): EstimatedRatings { ... }
  static compareToScout(estimated: RatingEstimate, scoutRating: number): string { ... }
}
```

### Integration with Existing Code

- Add a new tab/section to the main UI alongside the Potential Stats Calculator
- Reuse existing CSS patterns from `PotentialStatsView`
- Could potentially allow importing a player's actual stats to auto-populate

---

## Edge Cases

1. **Impossible stats**: BB/9 = 0.5 might estimate Control > 80 (cap at 80)
2. **Extreme stats**: Very high K/9 might have no solution (quadratic has no real roots)
3. **Negative discriminant**: If sqrt argument is negative, stat is outside model range
4. **Very small IP**: Show warning for IP < 50 ("Estimate unreliable - small sample")

---

## Future Enhancements

1. **Bulk estimation**: Upload CSV of player stats, get rating estimates for whole roster
2. **Historical tracking**: Compare estimates across seasons
3. **Scout grading**: "Your scout is 85% accurate on Control, 60% on Stuff"
4. **Integration with player search**: Click a player, auto-populate their stats

---

## Implementation Order

1. [ ] Create `RatingEstimatorService.ts` with core math
2. [ ] Add unit tests for edge cases (impossible stats, bounds)
3. [ ] Create `RatingEstimatorView.ts` with basic UI
4. [ ] Wire up to main app (new section/tab)
5. [ ] Add confidence bands and sample size adjustment
6. [ ] Add scout/OSA comparison inputs
7. [ ] Style and polish
8. [ ] Update CLAUDE.md with new feature documentation

---

---

## Verified Formulas (Jan 2026)

### From OOTP Calculator (Perfect 1:1 Relationships)

Using fresh screen reader data from the in-game calculator:

**HRA → HR (R² = 1.000)**
```
HR = 72.27 - 0.823 * HRA  (for ~200 IP, neutral environment)
```

**PBABIP → Non-HR Hits (R² = 0.999)**
```
Non-HR Hits = 225.9 - 0.351 * PBABIP_hidden  (hidden 500-point scale)
```

Note: PBABIP in calculator uses hidden 20-250 scale, not display 20-80.

### WBL Environment Adjustment

WBL is a **low-HR environment** - approximately **0.64× neutral** HR rates.

**WBL-Adjusted HR/9 Formula:**
```
HR/9 (WBL) = 2.08 - 0.024 * HRA
```

**Inverted for Rating Estimator:**
```
HRA = 86.7 - 41.7 * HR/9
```

Accuracy: ±11 rating points (1 sigma), works best for HRA 45-65 range.

| HR/9 | Estimated HRA |
|------|---------------|
| 0.50 | 66 |
| 0.70 | 58 |
| 0.85 | 51 |
| 1.00 | 45 |
| 1.20 | 37 |

### BABIP: The Problem Child

**Calculator shows perfect 1:1**, but **league data shows R² = 0.018** (almost zero correlation).

Why BABIP doesn't translate to league stats:
1. **Team defense** affects hits allowed significantly
2. **Park factors** vary across the league
3. **Rating drift** - BABIP ratings may have changed since stats were accrued
4. **High variance** - BABIP outcomes are notoriously "lucky" even in real baseball

**Recommendation**: Skip BABIP estimation, or show with heavy caveat:
> "BABIP cannot be reliably estimated from stats due to defense and park factors"

---

## Questions to Resolve

1. **Naming**: "Rating Estimator", "Scout Checker", "True Talent Calculator"?
2. ~~**H/9 handling**: Skip entirely, or show with heavy caveats?~~ **RESOLVED: Skip BABIP estimation**
3. **Tab vs Section**: New tab in nav, or section below Potential Stats Calculator?
4. **OSA availability**: Does OSA provide all 5 ratings or just some?
5. ~~**Movement/BABIP/HRA triangle**~~ **RESOLVED: Movement = 2.3 + 0.24×BABIP + 0.71×HRA (R²=0.92)**
6. ~~**Linear vs Polynomial**~~ **RESOLVED: Use linear, polynomials were overfitting noise**
