# Stolen Base Projection: SR & STE Ratings

## What Was Built

Two new scouting ratings—**SR (Stealing Aggressiveness)** and **STE (Stealing Ability)**—were added end-to-end: CSV parsing, projection model, calibration, and UI display.

### Projection Model

```
attempts = attemptRate(SR)          // per 600 PA, piecewise linear
successRate = successPct(STE)       // decimal 0-1
projSB = (PA / 600) × attempts × successRate
projCS = (PA / 600) × attempts × (1 - successRate)
```

### Calibrated Coefficients (current)

**SR → Steal Attempts per 600 PA** (3-segment piecewise, breakpoints at SR 55 and SR 70):
- Low segment (SR ≤ 55): `attempts = -2.300 + 0.155 × SR`
- Mid segment (55 < SR ≤ 70): `attempts = -62.525 + 1.250 × SR`
- Elite segment (SR > 70): `attempts = -360.0 + 5.5 × SR`

The elite segment deliberately projects **above** the calibration data. Actual SB data is suppressed by team strategy — an elite stealer on a conservative team may only get 25-30 attempts, but given freedom would attempt 50-80+. We project capability, not strategy-constrained outcomes.

| SR  | Attempts/600PA |
|-----|----------------|
| 20  | 0.8            |
| 40  | 3.9            |
| 55  | 6.2            |
| 60  | 12.5           |
| 70  | 25.0           |
| 75  | 52.5           |
| 80  | 80.0           |

**STE → Success Rate**: `rate = 0.160 + 0.0096 × STE`

| STE | Success Rate |
|-----|-------------|
| 20  | 35%         |
| 50  | 64%         |
| 80  | 93%         |

**Projected SB (600 PA):**
```
       STE20  STE35  STE50  STE65  STE80
SR 20    0      0      1      1      1
SR 35    1      2      2      2      3
SR 50    2      3      3      4      5
SR 65    7      9     12     15     17
SR 70    9     12     16     20     23
SR 75   18     26     34     41     49
SR 80   28     40     51     63     74
```

---

## Files Modified

### Source Code
| File | Change |
|------|--------|
| `src/models/ScoutingData.ts` | Added `stealingAggressiveness?: number` and `stealingAbility?: number` to `HitterScoutingRatings` |
| `src/services/HitterScoutingDataService.ts` | Added `stealingAggressiveness`/`stealingAbility` to header key type, aliases (`sr`, `ste`, etc.), and CSV parsing logic |
| `src/services/HitterRatingEstimatorService.ts` | Added piecewise `stealAttempts` and linear `stealSuccess` coefficients. Added `expectedStealAttempts()`, `expectedStealSuccessRate()`, `projectStolenBases()` methods |
| `src/views/BatterProfileModal.ts` | Added `scoutSR`, `scoutSTE`, `projSb`, `projCs` to `BatterProfileData`. Added `renderRatingDonut()` method. SR/STE donuts in header metadata. SB column in projection table |
| `src/views/FarmRankingsView.ts` | Passes `scoutSR`/`scoutSTE` from `myScouting` to `BatterProfileData` |
| `src/views/TeamRatingsView.ts` | Same, in both batter profile construction points |

Note: TrueRatingsView, GlobalSearchBar, TradeAnalyzerView, DevTrackerView don't pass scout fields explicitly—the modal fetches scouting data itself in `show()`, so SR/STE flow through `this.scoutingData` automatically.

### Tools Created
| File | Purpose |
|------|---------|
| `tools/validate_sb_projections.ts` | Validates projections against actual SB/CS. Loads scouting CSVs + batting CSVs, matches by player ID, reports league totals, per-player MAE/bias, SR/STE bucket analysis, distribution, and top player comparisons. Run: `npx tsx tools/validate_sb_projections.ts` |
| `tools/calibrate_sb_coefficients.ts` | Grid-searches SR and STE coefficient space. Tests both linear and piecewise SR models. Scoring function penalizes MAE, bias, bucket imbalance, success rate mismatch, and attempt mismatch. Two-phase search (coarse then fine). Run: `npx tsx tools/calibrate_sb_coefficients.ts` |

---

## Calibration Results

**Data:** 3,224 scouted players (June 2021 CSV) matched against 2018-2020 MLB batting stats. 654 matched player-seasons with 200+ PA.

**SR distribution in scouting data:** 20-80 scale, mean=41.2, median=40. Only 44 players have SR 80.

### Before vs After Calibration (n=654, 3-year combined)

| Metric | Initial Guess | Calibrated |
|--------|--------------|------------|
| SB MAE (per player) | 8.0 | 5.7 |
| SB Bias | +1.6 | ~0 |
| League Total SB Diff | +15.6% | ~0% |
| Success Rate Bias | +1.8pp | ~0pp |
| Max SR Bucket Bias | 6.3 | 0.1 |
| Composite Score | 25.4 | 5.9 |

### Per-bucket accuracy (calibrated)

| SR Bucket | Count | Actual Mean SB | Projected Mean SB | Bias |
|-----------|-------|----------------|-------------------|------|
| SR 20-34  | 73    | 0.6            | 0.6               | -0.1 |
| SR 35-49  | 145   | 1.4            | 1.5               | +0.1 |
| SR 50-64  | 131   | 4.2            | 4.1               | -0.1 |
| SR 65-80  | 305   | 19.7           | 19.7              | +0.0 |

---

## Elite Stealer Uncapping (Resolved)

**Previous limitation:** Players with SR 80 / STE 80 stole 60-90 SB/season in actuals but projected to only ~35-40.

**Root cause:** The calibration data is suppressed by team strategy. A player with SR 80 on a conservative team may only attempt 25-30 steals, but given freedom would attempt far more. The piecewise model's high-segment slope of 1.25 was the best fit for the SR 65-80 bucket *as a whole*, but this fit to strategy-constrained data, not player capability.

**Fix applied:** Added a third piecewise segment (SR > 70) with a steep slope of 5.5, deliberately projecting above calibrated data. This projects what a player is *capable of*, not what team strategy allows.

- SR 70: 25 attempts (unchanged, continuous with mid segment)
- SR 75: 52.5 attempts
- SR 80: 80 attempts → with STE 80 (93% success) → **74 projected SB**

**Trade-off:** This will overproject SB for elite stealers on conservative teams in validation against historical data. That's intentional — the goal is to show other teams what a player is actually capable of when given the green light.

---

## How to Re-run Validation

```bash
# Validate current coefficients against actual data
npx tsx tools/validate_sb_projections.ts

# Re-calibrate (grid search, takes ~30s)
npx tsx tools/calibrate_sb_coefficients.ts
```

Both tools read from:
- Scouting: `public/data/hitter_scouting_my_2021_06_14.csv` (has SR/STE columns)
- Batting: `public/data/mlb_batting/{year}_batting.csv` (has sb/cs columns)
