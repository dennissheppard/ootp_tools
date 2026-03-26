# IP Projection v2 — Catastrophic Year Filtering + Injury Risk

## Problem

The current IP projection blend (45% model / 55% history) has MAE of 31.6 IP and near-zero R². Two issues:

1. **Catastrophic injury years pollute the historical component.** A pitcher who threw 200/200/65/195 gets a weighted average of ~140 instead of ~198. We project him too low when healthy.

2. **Catastrophic actual outcomes are unforeseeable.** A pitcher who tears his UCL and throws 65 IP was never going to be projected correctly. Grading ourselves on these cases inflates MAE and obscures real accuracy.

## Backtest Results (2021 season, N=99 SP-qualified)

| Run | Description | Best MAE | R² | Best blend |
|-|-|-|-|-|
| Baseline | All data, raw history | 31.6 | 0.048 | 50/50 |
| Healthy test set only | Remove 9 catastrophic 2021 actuals | 23.1 | 0.369 | 60/40 |
| **Clean history + healthy test** | Filter catastrophic from history AND test set | **20.9** | **0.413** | **50/50** |

Catastrophic = IP dropped 50%+ from pitcher's median full-season workload (120+ IP baseline).

## Part 1: Clean IP Projections (SP only)

**Scope: SP projections only.** RP IP projection is unchanged — the catastrophic filter, blend change, and risk model do not apply to relievers.

### 1a. Filter catastrophic years from historical IP component

**Where:** `calculateProjectedIp()` in `ProjectionService.ts` (Step 5: Historical Blend), and the equivalent section in `sync-db.ts`.

**Logic:**
```
fullSeasonIps = historical seasons with IP >= 120
IF fullSeasonIps.length < 2:
  // Not enough established seasons — skip catastrophic filter entirely.
  // Sub-120 seasons are developmental ramp-up, not catastrophic.
  completedSeasons = historical.filter(ip >= 50)
ELSE:
  median = median(fullSeasonIps)
  catastrophic = season where IP < median * 0.50
  completedSeasons = historical.filter(ip >= 50 AND not catastrophic)
  IF completedSeasons.length === 0:
    // All historical seasons were catastrophic (injury-prone veteran).
    // Fall back to 100% model weight — history has nothing clean to offer.
    completedSeasons = []  // triggers model-only path
```

The weighted average (5/3/2 weights) then uses only clean seasons. The IP projection represents **"given health, this is what we expect."**

### 1b. Keep blend at 50/50

Current: 45% model / 55% history. Change to **50/50** based on backtest optimal (MAE 20.9, bias +0.3).

**Fallback:** When clean history is empty (all seasons catastrophic or no established workload), use **100% model weight**.

### 1c. No changes to model side

The model (stamina-based IP + FIP skill modifier + elite boost) is pulling its weight at 50/50 clean.

### 1d. No age-based IP discount

WBL data (2000-2021) shows zero IP decline by age for full-time starters. Mean IP is 180-190 at every age from 23 to 42. Attrition handles decline — the survivors throw the same workload.

## Part 2: Catastrophic Season Risk Percentage

A separate signal shown alongside the IP projection. Not blended into the IP number. **SP only.**

### Data-driven risk factors (WBL 2000-2021, N=2512 established-SP seasons)

**Recency of last catastrophic season (strongest signal):**

| Last catastrophic | Raw rate | Smoothed multiplier |
|-|-|-|
| Never | 21.7% | 0.63x |
| 1 year ago | 66.8% | 1.93x |
| 2 years ago | 35.2% | 1.02x |
| 3 years ago | 36.4% | 1.05x |
| 4+ years ago | — | Cap at "never" baseline (0.63x) |

> **Note:** The raw 5+ years ago rate (16.7%) is lower than "never" (21.7%) — survivorship bias. A pitcher who blew up 5+ years ago and is still pitching is self-selected for durability. We cap the recency adjustment at the "never" baseline for 4+ years ago rather than rewarding a distant catastrophic season.

> **Note:** The 2yr (35.2%) vs 3yr (36.4%) reversal is likely sample noise. In implementation, use smoothed exponential decay from the 1yr rate back to the "never" baseline rather than raw lookup values.

**Age:**

| Age range | Rate | Multiplier |
|-|-|-|
| 20-24 | 11.7% | 0.34x |
| 25-29 | 27.4% | 0.79x |
| 30-34 | 40.0% | 1.16x |
| 35-39 | 42.1% | 1.22x |
| 40+ | 45.8% | 1.32x |

**Stamina:**

| Stamina | Rate | Multiplier |
|-|-|-|
| 65-80 | 21.2% | 0.61x |
| 55-64 | 26.0% | 0.75x |
| 45-54 | 37.6% | 1.09x |
| 35-44 | 41.5% | 1.20x |

**Injury rating is surprisingly flat** (24-28% for Durable/Normal/Fragile). Not a strong independent predictor — omit from the formula to keep it simple. The signal it would add is already captured by stamina and history.

### 2a. Risk model — base-rate-with-adjustments

Multiplicative adjustment approach. Transparent, explainable in tooltips, debuggable in explain-player.ts.

```
risk = BASE_RATE × recencyMult × ageMult × staminaMult
clamp to [5%, 85%]
```

Where `BASE_RATE = 0.346` (overall catastrophic rate) and each multiplier = segment rate / BASE_RATE.

Recency multiplier uses smoothed exponential decay:
- 1 year ago: 1.93x
- 2 years ago: ~1.02x (interpolated)
- 3 years ago: ~0.85x (decaying toward baseline)
- 4+ years ago: 0.63x (same as "never")

**No prior-catastrophic-count factor.** Recency already captures the strongest signal from history. Adding count on top risks double-counting and over-penalizing veterans. The count data (42% → 58% → 78%) is largely explained by recency — players with 3 prior catastrophic seasons almost always had one recently.

### 2b. UI — Peripherals section risk badge

**Placement:** Below the Proj IP box in the Peripherals section of the pitcher profile modal. Only shown when risk >= 20%.

```
┌──────────┬──────────┬──────┐
│    SP    │   195    │  55  │
│ PROJ ROLE│  PROJ IP │ BABIP│
└──────────┴──────────┴──────┘
              ⚠ 58%
```

**Color coding:**
- Hidden (< 20%)
- Yellow (20-39%)
- Orange (40-59%)
- Red (60%+)

**Tooltip on hover** — personalized factor breakdown:
```
58% chance of losing half or more of projected workload

Factors:
  Last catastrophic season: 1 year ago (1.93x)
  Age: 36 (1.22x)
  Stamina: 65 (0.61x — reduces risk)

This pitcher has had 2 catastrophic seasons in his career
(2018: 78 IP, 2021: 69 IP — vs typical 220+ IP workload)
```

### 2c. Where it shows

- **Pitcher profile modal** — Peripherals section, below Proj IP (primary location)
- **Projections view** — small colored dot or icon next to IP column for pitchers >= 20% risk
- **Trade analyzer** — risk-adjusted WAR as a secondary signal in the trade evaluation narrative (e.g., "4.0 WAR (healthy) / 2.1 WAR (risk-adjusted)" in the comparison table)
- **Team Planner** — rotation reliability indicator (future, lower priority)

### 2d. Risk-adjusted WAR in Trade Analyzer

Default WAR stays clean (healthy projection). The trade analyzer shows a secondary **risk-adjusted WAR** for pitchers:

```
riskAdjustedWar = healthyWar × (1 - risk) + (healthyWar × 0.15) × risk
```

Where `healthyWar × 0.15` approximates the WAR from a catastrophic season (~15% of healthy output). This surfaces in the trade comparison table as a secondary column, not as the primary WAR.

A pitcher at 4.0 WAR / 15% risk → risk-adjusted 3.6 WAR.
A pitcher at 4.0 WAR / 60% risk → risk-adjusted 1.96 WAR.

This makes the trade analyzer account for durability without corrupting the healthy projection.

## Guardrails

### Active injury override
If a pitcher is currently on the IL with known days remaining, the sync pipeline already reduces IP by injury days. In this case, **skip the catastrophic risk badge entirely** — we already know he's having a reduced season. The risk signal only appears when the pitcher is currently healthy.

### What the percentage means
The risk % is the **probability of losing 50%+ of the projected healthy workload to injury.** It's a binary outcome probability, not a margin of error or a confidence interval.

Framing: "58% chance this pitcher loses half or more of his projected workload."

It's NOT: "he might throw 140 instead of 195." It IS: "42% chance he's in the neighborhood of 195, 58% chance something goes seriously wrong and he's sub-100."

### Developmental ramp-up is not catastrophic
Pitchers need 2+ seasons of 120+ IP before the catastrophic filter activates. A young starter who threw 80/100/110 as he worked into the rotation is not injury-prone — he's developing. Sub-120 seasons without an established baseline are treated as normal history, not filtered out.

### RP projections unchanged
The catastrophic filter, 50/50 blend, and risk model apply to SP projections only. RP IP projection logic (formula-based, no historical blend for most RPs) is not modified.

## Files to Change

**Part 1 (IP projection cleanup):**
- `src/services/ProjectionService.ts` — `calculateProjectedIp()` Step 5 historical blend: add catastrophic filter, minimum-seasons gate, all-catastrophic fallback, 50/50 blend
- `tools/sync-db.ts` — equivalent inline historical blend section (~line 2304): same changes
- `src/services/ProjectionService.test.ts` — tests for: catastrophic year filtering, developmental ramp-up exclusion, all-catastrophic fallback to model-only, 50/50 blend

**Part 2 (risk percentage):**
- New: `computeCatastrophicRisk()` function in `ProjectionService.ts` (co-located with `classifyPitcherRole`)
- `tools/sync-db.ts` — compute risk per SP pitcher, store in projection cache alongside existing fields
- `src/views/PlayerProfileModal.ts` — render risk badge + tooltip in Peripherals section
- `src/views/ProjectionsView.ts` — risk indicator dot next to IP column
- `src/views/TradeAnalyzerView.ts` — risk-adjusted WAR secondary column in trade comparison
- `src/services/ProjectionService.test.ts` — tests for risk formula, clamping, edge cases

## Prototype Validation

Risk model prototype was run against 17 established MLB SPs. Sample results:

| Player | Age | Injury | History | Risk | Key driver |
|-|-|-|-|-|-|
| Fresquez | 36 | Fragile | 2 prior cat, last year | 58% | Recent blowup + age |
| Spuller | 29 | Durable | 1 prior cat, last year | 69% | Recent blowup + low stamina |
| McCants | 26 | Normal | Clean 5 years | 13% | Young, never hurt |
| Carrapa | 27 | Normal | 5 straight 195+ IP | 13% | Iron horse |
| Nelson | 39 | Durable | Clean, 200+ every year | 16% | Old but stamina 65, never hurt |
| DeLellis | 30 | Durable | Clean, 195-222 IP | 27% | Age 30 + stamina 50 |
| Cortez | 30 | Normal | Had one 3 years ago | 34% | Recovered but carries scar |
| Ramirez | 32 | Normal | Had one 2 years ago | 48% | Age + low stamina + prior cat |
