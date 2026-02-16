# Pitcher WAR Projection Investigation — February 2026

## Problem

Current MLB pitcher projections for 2021 significantly under-project WAR compared to historical actuals:
- **2018-2020 actual top WARs:** low 6s
- **2021 projected top WARs:** high 4s
- **Gap:** ~1.5 WAR at the top end

This was discovered while investigating pitcher TFR inflation (see `docs/tfr-ceiling-fix-feb2026.md`).

## What Was Fixed in This Session

### 1. Pitcher TFR Architecture Fix
The pitcher TFR pipeline was ranking prospects **among each other** by component, then mapping those percentile ranks to MLB distributions. This made the ceiling boost completely invisible — a linear transform preserves rank order, so changing `CEILING_BOOST` had zero effect on TFR ratings.

**Fix:** Changed `TrueFutureRatingService.calculateTrueFutureRatings()` to compare boosted rate values **directly against MLB peak-age distributions** (same approach batters already used). The ceiling boost now actually affects pitcher TFR.

### 2. Pitcher Ceiling Boost Calibration
The original `CEILING_BOOST = 0.35` was calibrated for batters and applied unchanged to pitchers. Pitcher scouting coefficients have ~2.5x smaller slopes than batters (K/9: 0.074 vs K%: 0.200), so the same boost factor produces ~2.5x less effect for pitchers. User settled on `CEILING_BOOST = 0.30` for pitchers after testing.

### 3. Combined Top 100 Sort
Changed from percentile-based sort (which systematically ranked pitchers above batters due to different distribution shapes) to **peak WAR sort**, which provides a common currency across player types.

### 4. Rating↔Rate Intercept Mismatch Fix (MAJOR)

**Root cause:** The inverse formulas (stat → rating) in `TrueRatingsCalculationService` used **different intercepts** than the forward formulas (rating → stat) in `PotentialStatsService`. When the projection pipeline does a round-trip (actual stat → estimate rating → project stat), this created a systematic bias:

| Stat | Old Inverse | Forward | Round-trip bias |
|------|------------|---------|----------------|
| K/9  | 2.07       | 2.10    | +0.03 K/9 (slight help) |
| BB/9 | 5.22       | 5.30    | +0.08 BB/9 (harmful) |
| HR/9 | **2.08**   | **2.18**| **+0.10 HR/9 (very harmful)** |

Net effect: **+0.16 FIP systematic bias** for every pitcher. Since HR/9 has a 13/9 weight in the FIP formula, the 0.10 HR/9 mismatch alone contributed +0.14 FIP.

**Fix:** Aligned all inverse intercepts to match the forward formulas (2.10, 5.30, 2.18). Fixed in:
- `TrueRatingsCalculationService.ts` (inverse formulas)
- `StatsView.ts` (inline inverse calculations)
- `PotentialStatsService.ts` (stale comments)
- `PotentialStatsView.ts` (display text)

**Impact (measured on top 10 starters by 2020 game WAR):**
- Average FIP gap: +0.296 → **+0.132** (55% reduction)
- Average WAR gap: -1.06 → **-0.63** (41% reduction)
- Round-trip FIP bias: 0.16-0.17 → **0.00-0.03** for most pitchers
- Top pitcher (6.9 gWAR): projected 5.7 → **6.3** WAR

### 5. IP Projection Double-Penalty Fix

**Root cause:** The IP projection applied an injury modifier to the model-based IP *before* blending with historical data. Since historical IP already reflects injury outcomes (fragile pitchers have lower historical IP), this was double-counting injury proneness.

Example: A "fragile" pitcher with stamina 60 who has proven they can throw 200 IP:
- Before: model=175 (after fragile penalty), blend: 175×0.35 + 200×0.65 = 191 IP
- After: model=190 (no penalty when history exists), blend: 190×0.35 + 200×0.65 = 197 IP

**Fix:** Injury modifier now only applies when there's no historical data (prospects). For established pitchers with history, the history already captures durability.

## Investigation Results Summary

### What the investigation tool found (`tools/investigate-pitcher-war.ts`):

1. **Formula WAR vs Game WAR** — The FIP-based WAR formula closely matches game WAR (avg gap -0.08 to -0.36 for top 10 per year). The formula itself is not the bottleneck.

2. **The projection pipeline is the bottleneck** — It systematically under-projects elite pitchers by ~0.6 WAR (after fixes; was ~1.1 before).

3. **FIP dominates the remaining gap** — For the top pitcher, FIP accounts for ~60% of the remaining WAR gap, IP accounts for ~40%.

4. **HR/9 is the most sensitive component** — Due to the 13/9 FIP weight, small HR/9 errors (0.05-0.10) become large FIP errors (0.07-0.14). The intercept fix was most impactful on HR/9.

5. **The neutral model's 20-80 clamping** causes minor loss for extreme pitchers (stuff >80 → clamped). Only affects 1-2 pitchers in the top 10.

### Remaining gap analysis (after fixes)

Average -0.63 WAR gap for top 10 starters comes from:
- Multi-year regression to mean (~0.15 FIP)
- Scouting blend diluting stats (~0.05 FIP)
- Historical IP blending (~10 IP shortfall)
- These are intentional conservatism, not bugs

## Files Modified This Session
- `src/services/TrueFutureRatingService.ts` — Architecture fix (direct MLB comparison), ceiling boost = 0.30
- `src/services/TrueRatingsCalculationService.ts` — Fixed inverse intercepts (2.07→2.10, 5.22→5.30, 2.08→2.18)
- `src/services/ProjectionService.ts` — Fixed IP double-penalty (injury mod only for prospects)
- `src/services/PotentialStatsService.ts` — Fixed stale comments to match actual coefficients
- `src/views/StatsView.ts` — Fixed inline inverse formulas
- `src/views/PotentialStatsView.ts` — Fixed display text formulas
- `src/views/FarmRankingsView.ts` — Combined top 100 sorts by peak WAR
- `readme.md` — Updated TFR documentation (100% scouting, ceiling boost, clamp values)
- `docs/tfr-ceiling-fix-feb2026.md` — Updated pitcher ceiling boost constant
- `tools/investigate-pitcher-war.ts` — New investigation tool (Steps 1-8)

## Projection Pipeline Overview

### WAR Formula
```
WAR = ((replacementFIP - playerFIP) / runsPerWin) × (IP / 9)
```

### Key Constants (FipWarService.ts)
- `FIP_CONSTANT = 3.47`
- `replacementFip = avgFip + 1.00` (dynamically calculated; default ~5.20)
- `runsPerWin = 8.5`

### Rating↔Rate Formulas (MUST be identical in forward and inverse)
```
Forward (PotentialStatsService):     Inverse (TrueRatingsCalculationService):
K/9  = 2.10 + 0.074 × Stuff        Stuff   = (K/9  - 2.10) / 0.074
BB/9 = 5.30 - 0.052 × Control       Control = (5.30 - BB/9) / 0.052
HR/9 = 2.18 - 0.024 × HRA          HRA     = (2.18 - HR/9) / 0.024
```

### FIP Projection (what determines playerFIP)
1. **Multi-year weighted stats** → 3-year average (5/3/2 weighting)
2. **FIP-aware regression** → regresses toward quality-adjusted target (elite pitchers regress less)
3. **Scouting blend** → blends with scouting at IP/(IP+60) weight
4. **Rating estimation** → converts blended rates to 0-100 scale ratings
5. **Ensemble aging** → 35% full aging, 65% 20%-aging (neutral+pessimistic)
6. **Rating→Rate conversion** → converts aged ratings back to rate stats

### IP Projection (what determines innings)
1. **Base IP from stamina**: Percentile-based (maps stamina rank to IP distribution) or `10 + (stamina × 3.0)` fallback
2. **Injury modifier**: Only for prospects without historical data (Ironman +15%, Durable +8%, Fragile -8%, Wrecked -25%)
3. **Skill modifier**: FIP ≤3.50 → 1.20x, FIP ≤4.00 → 1.10x, FIP 4.0-4.5 → 1.0x, FIP >5.0 → 0.80x
4. **Historical blending**: Established pitchers use 55% historical IP, 45% model
5. **Elite pitcher boost**: FIP <3.0 → 1.08x, sliding to 1.0 at FIP 4.0
6. **Cap**: 105% of historical max IP from league distribution

## Key Files
| File | Role |
|------|------|
| `src/services/ProjectionService.ts` | Main projection orchestration, IP projection |
| `src/services/TrueRatingsCalculationService.ts` | True Rating estimation (inverse formulas, regression) |
| `src/services/EnsembleProjectionService.ts` | Three-model ensemble blending |
| `src/services/AgingService.ts` | Age-based rating adjustments |
| `src/services/PotentialStatsService.ts` | Rating→rate stat conversion (forward formulas) |
| `src/services/FipWarService.ts` | FIP calculation, WAR formula, constants |
| `src/views/ProjectionsView.ts` | Projections UI |
| `tools/investigate-pitcher-war.ts` | Investigation tool (Steps 1-8 analysis) |
| `tools/trace-rating.ts` | Debug tool — can trace individual pitcher pipeline |
| `tools/calibrate_projections.ts` | Full projection pipeline calibration with parameter sweep |

## Later Calibration: Parameter Sweep (Feb 2026)

Following the initial fixes above, a systematic calibration sweep was conducted using `tools/calibrate_projections.ts` to optimize the remaining pipeline parameters against 236 team-seasons (2005-2020).

### Changes Applied

1. **Elite strength multiplier**: `TrueRatingsCalculationService.calculateStrengthMultiplier()` for FIP < 3.5 reduced from 1.30 → **0.80**. This trusts elite pitchers' stats more (less regression), reducing the compounding compression that was most severe for top-of-rotation aces.

2. **IP model weight**: `ProjectionService` established pitcher blend shifted from 35/65 (model/history) to **45/55**. Gives more weight to the model for established pitchers.

3. **Elite WAR multiplier**: `PotentialStatsService.calculateWarMultiplier()` applies a FIP-based WAR boost: 1.20x for FIP < 3.20, tapering linearly to 1.0 at FIP 4.20. Compensates for compounding pipeline compression (regression + ensemble dampening + IP anchoring) on elite pitchers.

### Compression Analysis

The calibration tool includes an **IP decomposition diagnostic** that tests whether IP or FIP is the source of team-level WAR compression. Finding: **FIP regression is the main compressor** (~59%), not IP. Testing projected FIP × actual IP (hybrid) produced identical compression as projected FIP × projected IP.

Individual FIP projection accuracy: MAE 0.584, RMSE 0.767, Bias -0.019 (excellent).

### Piecewise WAR→Wins

The standings formula was changed from linear to **piecewise** to handle asymmetric compression:
- `Wins = 81 + (WAR − medianWAR) × slope`
- Above-median teams: slope = 0.830
- Below-median teams: slope = 0.780
- MAE: 7.52 (was 7.7 linear, 8.1 original)
