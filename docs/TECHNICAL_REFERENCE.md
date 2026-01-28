# Technical Reference & Methodology

This document contains the deep-dive technical details, mathematical formulas, and calibration methodologies for the True Ratings application.

## 1. Core Formulas

### Rating-to-Stat Conversion (Potential Stats)
These linear formulas are calibrated for the WBL environment (Low-HR, ~64% of neutral MLB HR rates).

| Stat | Formula | Notes |
|------|---------|-------|
| **K/9** | `2.07 + 0.074 × Stuff` | 1:1 relationship with Stuff |
| **BB/9** | `5.22 - 0.052 × Control` | 1:1 relationship with Control |
| **HR/9** | `2.08 - 0.024 × HRA` | WBL specific environment |

### Stat-to-Rating Estimation (Rating Estimator)
Inverse formulas used to estimate ratings from observed stats.

*   **Control** = `100.4 - 19.2 × BB/9`
*   **Stuff** = `-28.0 + 13.5 × K/9`
*   **HRA** = `86.7 - 41.7 × HR/9`

*Note: BABIP and Movement cannot be reliably estimated from stats due to defense/park factors.*

### Derived Stats (FIP & WAR)
Calculated in `FipWarService.ts`.

*   **FIP**: `((13 × HR/9) + (3 × BB/9) - (2 × K/9)) / 9 + FIP_Constant`
*   **WAR**: `((Replacement_FIP - Player_FIP) / Runs_Per_Win) × (IP / 9)`

**Role-Based WAR Parameters:**
*   **Starters (≥150 IP)**: Repl FIP 5.25, 9.00 Runs/Win
*   **Middle (80-149 IP)**: Repl FIP 4.90, 8.50 Runs/Win
*   **Relievers (<80 IP)**: Repl FIP 4.60, 9.00 Runs/Win

---

## 2. Projection Ensemble System

The projection system uses a **three-model ensemble** to handle different player contexts.

### The Models
1.  **Optimistic (Standard Aging)**: Full aging curve adjustments. Best for young, developing players.
2.  **Neutral (Conservative Aging)**: 20% of normal aging adjustments. Best for veterans or status quo.
3.  **Pessimistic (Trend Continuation)**: Uses year-over-year trends with adaptive dampening. Best for declining players.

### Weighting Logic
The ensemble weights are dynamic based on:
*   **IP Confidence**: More IP = higher trust in recent performance (Neutral/Pessimistic).
*   **Age Factor**: Younger = higher trust in development (Optimistic).
*   **Trend & Volatility**: High variance favors the Neutral model.

### Regression Logic
To prevent over-projection, especially for low-IP pitchers, we use a 3-tier regression system based on FIP:
1.  **Good (FIP ≤ 4.5)**: Regress to League Average.
2.  **Bad (4.5 < FIP ≤ 6.0)**: Regress to Replacement Level.
3.  **Terrible (FIP > 6.0)**: Minimal regression (trust the bad data).

*IP Scaling*: Regression strength is reduced for low-IP pitchers to avoid "rescuing" bad performance with average baselines.

---

## 3. True Future Rating (Prospects)

Calculates peak potential for minor leaguers by blending scouting ratings with level-adjusted minor league stats.

### Scoring Formula
`Projected = (Scout_Weight × Scout_Rating) + ((1 - Scout_Weight) × Adjusted_Stats)`

**Scouting Weight Factors:**
*   **Age**: Older players (27+) rely mostly on stats.
*   **Star Gap (POT - OVR)**: Larger gap = "Raw" = Higher scouting weight.
*   **Experience**: Low Minor League IP = Higher scouting weight.

**Level Adjustments (Example)**:
Minor league stats are translated to MLB equivalents before blending.
*   **AAA**: K/9 +0.30, BB/9 -0.42
*   **Rookie**: K/9 +0.45, BB/9 -0.58

---

## 4. Calibration

### When to Calibrate
*   After OOTP version updates.
*   When adding significant new historical data.
*   If MAE (Mean Absolute Error) metrics degrade.

### Tools
*   `tools/calibrate_ensemble_weights.ts`: Grid search script to find optimal ensemble weights.
*   `tools/analyze_ootp_data.py`: Python script for linear regression analysis on collected data.

### Running Calibration
```bash
npx tsx tools/calibrate_ensemble_weights.ts
```

---

## 5. Performance Metrics (Benchmarks)

Based on 2015-2020 Historical Data:

**Elite Pitchers (75+ IP)**
*   **K/9 MAE**: ~0.64
*   **FIP MAE**: ~0.42 (Rivals professional systems)

**Known Limitations**
*   **Low-IP Relievers (<60 IP)**: High variance due to small sample sizes and role volatility. Use wider confidence intervals.
