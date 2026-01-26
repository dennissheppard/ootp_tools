# K/9 Projection Analysis: The "Downward Trajectory" Problem

## Player Profile
- **Age**: 25 years old
- **Recent K/9 History**:
  - Age 22: 4.98 K/9 (86 IP)
  - Age 23: 5.30 K/9 (71 IP)  ← Career high
  - Age 24: 4.84 K/9 (48 IP)  ← Declined from previous year
- **Current Projection**: 5.50 K/9 at age 25
- **Issue**: Projecting a career high despite recent decline

---

## Step-by-Step Projection Breakdown

### Step 1: Multi-Year Weighted Average
**Formula**: Recent years weighted 5:3:2, IP-weighted within each year

```
Weighted K9 = (4.84 × 48 × 5 + 5.30 × 71 × 3 + 4.98 × 86 × 2) / (48×5 + 71×3 + 86×2)
            = (1,161.6 + 1,128.9 + 856.56) / (240 + 213 + 172)
            = 3,147.06 / 625
            = 5.04 K/9
```

**Total IP**: 205

**Observation**: The weighted average (5.04) is actually BELOW all three individual seasons. This correctly captures that the recent downward trend pulls the average below his age-23 peak.

---

### Step 2: Regression to League Mean
**Formula**: `Regressed = (weighted × totalIP + leagueAvg × K) / (totalIP + K)`
- **K/9 Stabilization Constant**: 50 IP
- **League Average K/9**: 7.5

```
Regressed K9 = (5.04 × 205 + 7.5 × 50) / (205 + 50)
             = (1,033.2 + 375) / 255
             = 5.52 K/9
```

**🚨 KEY ISSUE #1**: Regression to league mean **INCREASES** K/9 from 5.04 → 5.52

This is because:
- The player is below league average (5.04 < 7.5)
- With "only" 205 IP, the system still applies ~20% regression toward 7.5
- This pushes the projection UP despite the downward trajectory

---

### Step 3: Convert to Estimated Rating
**Inverse Formula**: `Stuff = (K9 - 2.10) / 0.074`

```
Current Stuff = (5.52 - 2.10) / 0.074
              = 46.2
```

---

### Step 4: Apply Aging Curve (Age 24 → 25)
**Age 24 Modifier**: +0.5 Stuff (from AgingService)

```
Projected Stuff = 46.2 + 0.5 = 46.7
```

**🚨 KEY ISSUE #2**: The aging curve is **deterministic** and **positive** for age 24.

The system assumes:
- ALL 24-year-olds improve by +0.5 Stuff
- No consideration for whether the player actually showed improvement in recent years
- The player gets a "free" boost despite declining from 5.30 → 4.84

---

### Step 5: Convert Back to Projected K/9
**Forward Formula**: `K9 = 2.10 + 0.074 × Stuff`

```
Projected K9 = 2.10 + 0.074 × 46.7
             = 5.56 K/9
```

**Final Projection**: ~5.50 K/9 (after rounding/blending)

---

## Root Causes of the Problem

### 1. **Regression to League Mean is Too Aggressive**
- **Current behavior**: Regresses toward 7.5 K/9 (ALL pitchers)
- **Problem**: A below-average pitcher (5.04 K/9) gets pulled UP toward league average
- **Alternative**: Should regress toward a lower baseline (e.g., replacement-level ~5.0 K/9?)

### 2. **Aging Curves Ignore Recent Trajectory**
- **Current behavior**: Age 24 → 25 gets +0.5 Stuff regardless of context
- **Problem**: A player declining (5.30 → 4.84) gets the same boost as one improving (4.84 → 5.30)
- **Reality**: Development is not linear; some players stall or regress

### 3. **Limited IP Makes Regression Volatile**
- **205 Total IP**: Still well above stabilization constant (50 IP) but...
- **48 IP Last Year**: Most recent season is small sample
- **Tradeoff**: Do we trust the decline or write it off as noise?

### 4. **No Momentum/Acceleration Term**
- **Current model**: Treats all historical data as static "talent" measurements
- **Missing**: The *direction* of change (improving vs. declining)
- **Physics analogy**: We calculate position and velocity, but ignore acceleration

---

## Discussion Questions

### Q1: Is 205 IP enough to "trust" the data?
**Current system says**: No, apply 20% regression toward league mean.

**Counter-argument**:
- 205 IP is ~1.3 full seasons worth
- K/9 stabilizes at 50 IP (we're 4× that threshold)
- Maybe we're over-regressing?

**Proposal**: Use a lower regression target (e.g., replacement level ~5.5 K/9 instead of league average 7.5)

---

### Q2: Should we incorporate recent performance trends?
**Current system says**: No, all years are blended by weights (5:3:2).

**Scenarios to consider**:

| Pattern | Ages 22-24 | Should we project 25 differently? |
|---------|------------|-----------------------------------|
| **Steady growth** | 4.5 → 5.0 → 5.5 | Yes, continue upward trend |
| **Peak & decline** | 4.98 → 5.30 → 4.84 | **This case** - maybe don't assume improvement? |
| **Volatile** | 5.5 → 4.5 → 5.5 | No, treat as noise |

**Proposal**: Calculate a "momentum factor" based on year-over-year changes:
```typescript
momentum = (mostRecentK9 - previousK9) weighted by recency
If momentum < 0 and age 23-25: reduce aging boost (or apply penalty)
```

**Risk**: Small samples make year-over-year changes very noisy.

---

### Q3: Are aging curves too optimistic for ages 24-26?
**Current curve**:
- Age 22-23: +0.5 Stuff
- Age 24: +0.5 Stuff
- Age 25-27: +0.0 Stuff (plateau)

**Observation**: Your player is at the tail end of the "development" phase.

**Proposal**:
- Keep the curve as-is (it's an average)
- But add a "confidence interval" or "development variance" based on recent trends
- Players declining from 23→24 get a lower/flat projection
- Players improving from 23→24 get the full boost

---

### Q4: What about injuries/role changes/other context?
**Missing factors**:
- IP drop (86 → 71 → 48): Is this injury? Role change? Performance-driven?
- If he was injured, the K/9 decline might be noise
- If he lost his rotation spot, maybe the decline is real

**Current system**: Doesn't account for this (no injury data in projection)

---

## Proposed Solutions (Discussion)

### Option A: **Soften Regression for Experienced Players**
```typescript
// Instead of regressing toward league average (7.5 K/9)
// Regress toward a lower baseline for below-average pitchers
const regressionTarget = weightedK9 < leagueAvg
  ? replacementLevelK9 // e.g., 5.5 K/9
  : leagueAvg;
```

**Pros**: Prevents inflating projections for weak pitchers
**Cons**: Might over-penalize unlucky small samples

---

### Option B: **Add Momentum/Trajectory Adjustment**
```typescript
// Calculate year-over-year change
const recentChange = yearlyStats[0].k9 - yearlyStats[1].k9; // -0.46 in this case
const momentum = recentChange * (yearlyStats[0].ip / 50); // Weight by IP confidence

// Modify aging boost
if (age >= 23 && age <= 26 && momentum < -0.3) {
  agingModifier.stuff -= 0.5; // Reduce/eliminate development boost
}
```

**Pros**: Captures players whose development stalled
**Cons**: Very noisy with small samples (48 IP)

---

### Option C: **Multi-Model Ensemble**
Calculate 3 projections:
1. **Optimistic**: Current system (assume development continues)
2. **Neutral**: No aging adjustment (assume plateau)
3. **Pessimistic**: Assume recent trend continues

Weight by:
- IP confidence (more IP → trust trend more)
- Age (younger → trust development more)
- Recent volatility (stable → trust trend more)

**Pros**: Captures uncertainty
**Cons**: Complex, needs calibration

---

### Option D: **Status Quo + User Education**
Keep the current system but:
- Add a "trend indicator" in the UI (↗ improving, ↘ declining, → stable)
- Show confidence intervals based on IP
- Let users mentally adjust for context

**Pros**: Simple, transparent
**Cons**: Doesn't solve the projection accuracy issue

---

## Recommendation for Next Steps

### 1. **Data Analysis**
Run historical analysis:
- Find all pitchers age 23-26 with declining K/9 (age N-1 > age N)
- Compare: Did they rebound (current system correct) or continue declining?
- Calculate accuracy by trend bucket

### 2. **Test Option A** (Soften Regression)
Quick fix:
- Change regression target from 7.5 → 5.5 for below-average pitchers
- Re-run historical projections
- Measure RMSE improvement

### 3. **Prototype Option B** (Momentum)
Add experimental flag:
```typescript
const USE_MOMENTUM = true;
if (USE_MOMENTUM && recentDecline && youngPlayer) {
  // Reduce aging boost
}
```

Test on validation set (2015-2020 data → 2021 actuals)

### 4. **UI Enhancement**
Regardless of model changes:
- Show the 3-year trend (5.3 → 4.8 ↘)
- Flag projections as "Optimistic" when trend conflicts with projection
- Add tooltip: "Despite recent decline, projecting improvement based on typical age-24 development"

---

## Open Questions for Discussion

1. **Philosophy**: Should projections be:
   - **Conservative** (don't project improvement without evidence)?
   - **Optimistic** (assume average aging curve unless proven otherwise)?
   - **Uncertain** (show ranges instead of point estimates)?

2. **Sample Size**: At what IP threshold do we "trust" a decline vs. write it off as noise?
   - 48 IP (half season)
   - 100 IP (full season)
   - 200+ IP (multiple years)

3. **Age Cutoff**: At what age do we stop expecting automatic improvement?
   - Current: Age 24 gets boost, 25+ plateau
   - Alternative: Age 23 gets boost, 24+ plateau?

4. **Performance**: If we add momentum/trend detection:
   - What's the acceptable computational cost?
   - Do we need to pre-calculate trends or compute on-the-fly?

---

## Example Output with Enhanced UI

```
Player: John Doe (Age 25, SP)
Current TR: 2.5

Projected K/9: 5.50 ⚠️ TREND CONFLICT
  └─ Recent trend: 5.30 → 4.84 (↘ -8.7%)
  └─ Projection assumes typical age-24 development (+0.5 Stuff)
  └─ Confidence: MEDIUM (205 total IP, 48 IP last year)

Historical Performance:
  Age 22: 4.98 K/9 (86 IP)
  Age 23: 5.30 K/9 (71 IP) ★ Career high
  Age 24: 4.84 K/9 (48 IP) ⚠️ Decline

Projection Range:
  Optimistic (current model): 5.50 K/9
  Neutral (no aging): 5.04 K/9
  Pessimistic (trend continues): 4.60 K/9
```

This gives users context to make their own judgment calls.
