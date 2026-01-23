# Rating Estimator Feature Plan

## Overview

A "reverse calculator" that estimates pitcher ratings from actual stats, helping users evaluate scout accuracy by comparing:
- **Scout ratings** (what your in-game scout says)
- **OSA ratings** (the game's basic scouting service)
- **Estimated ratings** (derived from actual performance in the WBL environment)

This answers the question: "How accurate is my scout?"

---

## The Math

### Inverting the Formulas

We have forward formulas (Rating → Stat). We need to solve for Rating given Stat.

#### BB/9 → Control (Highest confidence, R² = 0.43)

```
BB/9 = 8.267 - 0.16971*Control + 0.0010962*Control²
```

Rearranging to standard quadratic form `ax² + bx + c = 0`:
```
0.0010962*Control² - 0.16971*Control + (8.267 - BB/9) = 0
```

Using quadratic formula:
```
a = 0.0010962
b = -0.16971
c = 8.267 - BB/9

Control = (0.16971 - sqrt(0.16971² - 4*0.0010962*(8.267 - BB/9))) / (2*0.0010962)
```
*(We use the minus branch because Control increases as BB/9 decreases)*

**Example**: BB/9 = 1.4 → Control ≈ 75

#### K/9 → Stuff (Moderate confidence, R² = 0.22)

```
K/9 = -1.654 + 0.22275*Stuff - 0.0014204*Stuff²
```

Rearranging:
```
0.0014204*Stuff² - 0.22275*Stuff + (1.654 + K/9) = 0
```

```
a = 0.0014204
b = -0.22275
c = 1.654 + K/9

Stuff = (0.22275 - sqrt(0.22275² - 4*0.0014204*(1.654 + K/9))) / (2*0.0014204)
```

**Example**: K/9 = 7.2 → Stuff ≈ 52

#### HR/9 → HRA (Moderate confidence, R² = 0.20)

```
HR/9 = 3.989 - 0.09810*HRA + 0.0007065*HRA²
```

Rearranging:
```
0.0007065*HRA² - 0.09810*HRA + (3.989 - HR/9) = 0
```

```
a = 0.0007065
b = -0.09810
c = 3.989 - HR/9

HRA = (0.09810 - sqrt(0.09810² - 4*0.0007065*(3.989 - HR/9))) / (2*0.0007065)
```

**Example**: HR/9 = 0.7 → HRA ≈ 57

#### H/9 → BABIP/Movement (Low confidence, R² = 0.06)

```
H/9 = 12.914 - 0.06536*BABIP - 0.03712*Movement
```

**Problem**: Two unknowns, one equation. Options:
1. Show a "combined" rating estimate (assume equal contribution)
2. Let user fix one rating and solve for the other
3. Skip this estimate due to low predictive power
4. Show a range of possible combinations

**Recommendation**: Option 3 or show with heavy caveats. R² = 0.06 means 94% of variance is unexplained.

---

## Confidence Bands

### Sample Size Adjustment

Small sample sizes mean more uncertainty. We can estimate standard error:

```
Standard Error ≈ Base_SE / sqrt(IP / 180)
```

Where `Base_SE` is derived from the regression residuals:
- Control: ±5 rating points (at 180 IP)
- Stuff: ±8 rating points
- HRA: ±7 rating points

**Example**:
- 180 IP → ±5 for Control
- 90 IP → ±7 for Control (wider band)
- 360 IP → ±3.5 for Control (tighter band)

### Confidence Levels Display

| R² | Confidence Label | Color |
|----|------------------|-------|
| 0.40+ | High | Green |
| 0.20-0.39 | Moderate | Yellow |
| < 0.20 | Low | Red/Gray |

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

## Questions to Resolve

1. **Naming**: "Rating Estimator", "Scout Checker", "True Talent Calculator"?
2. **H/9 handling**: Skip entirely, or show with heavy caveats?
3. **Tab vs Section**: New tab in nav, or section below Potential Stats Calculator?
4. **OSA availability**: Does OSA provide all 5 ratings or just some?
