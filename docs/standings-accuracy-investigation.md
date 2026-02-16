# Standings Projection Accuracy Investigation

## Status: Resolved — Piecewise WAR→Wins (Feb 2026)

## Observed Problem

Projected win totals show **compression** — under-projecting the best teams and over-projecting the worst teams. Recent years show MAEs of 8-10 wins with max single-team misses of 20-28 wins.

The user notes this is visible by eyeballing the Diff column in Standings mode for 2016-2020.

## Baseline Context

**WAR→Wins formula** (calibrated on 298 team-seasons, 2005-2020):
```
Projected Wins = 43.0 + 0.998 × Role-Adjusted Team WAR
```
- Calibration R²=0.743, MAE=5.9, ±7.4 wins (1σ)
- Current observed MAEs: ~8-10 per year (higher than calibration)

**Role adjustments** (standings mode only):
- Bench batters capped at 250 PA
- Bullpen arms capped at 110 IP
- Rotation and lineup WAR used as-is

**League normalization**: Uniform offset so total W = total L = numTeams × 81

## Key Question: Where Does Compression Come From?

### Possible Sources

1. **WAR projection compression** — Our projection pipeline (scouting + stats → blended ratings → projected stats → WAR) inherently regresses toward the mean. Elite players get pulled down, bad players get pulled up. This is correct behavior for individual players, but when summed across a full roster, it may over-compress team WAR ranges.

2. **Role-adjusted playing time caps** — Capping bullpen at 110 IP and bench at 250 PA might disproportionately affect good teams (whose bullpens/benches are more valuable). Check if the caps are too aggressive.

3. **Linear WAR→Wins model** — The formula assumes linear conversion, but real win distributions may be non-linear (elite teams synergize, bad teams collapse). A quadratic term or different slope for high/low WAR teams might help.

4. **League normalization offset** — The uniform offset shifts all teams equally. If our total projected WAR is systematically off, this shift could hurt accuracy at extremes.

5. **OOTP simulation variance** — Even with perfect projections, OOTP's game engine introduces ~4-6 wins of random noise. Some of the 20+ win misses may be OOTP outliers (lucky/unlucky teams) that no projection system could capture.

## Investigation Plan

### Step 1: Diagnose — Where is the compression?

Run a systematic analysis across all backtestable years (2005-2020):

```
For each year, for each team:
  - Our projected WAR (from projection pipeline)
  - Our projected wins (after normalization)
  - Actual wins (from standings CSV)
  - Actual OOTP WAR (from standings CSV — batter + pitcher)
  - Diff = projected wins - actual wins
```

Then check:
- **Is projected WAR compressed vs actual WAR?** Plot our projected total team WAR vs OOTP's actual team WAR. If the slope < 1.0, our WAR projections themselves are compressed.
- **Is WAR→Wins compressed?** If projected WAR range is similar to actual WAR range, but projected wins range is narrower than actual wins range, the linear formula is the issue.
- **Residual pattern**: Plot Diff vs actual wins. If slope is negative (best teams under-projected, worst teams over-projected), that's compression. The magnitude tells us how much.

### Step 2: Quantify

- Overall MAE, RMSE, R² by year
- MAE by team WAR quartile (top 5, middle 10, bottom 5)
- Bias by quartile (is the sign consistently wrong at extremes?)
- Check if certain team archetypes are systematically mispriced (rotation-heavy vs lineup-heavy)

### Step 3: Fix candidates

Depending on where the compression lives:

**If WAR projections are compressed:**
- Reduce regression strength in the projection pipeline for team-level aggregation
- Check if scouting blend weight is too heavy (pulling toward scouting mean)

**If WAR→Wins conversion is compressed:**
- Try a piecewise linear or quadratic model:
  ```
  Wins = a + b×WAR + c×WAR² (if compression is consistent)
  Wins = different slopes for WAR > median vs WAR < median
  ```
- Re-run `tools/calibrate_wins.ts` to check if recalibration helps

**If role adjustments are compressing:**
- Try relaxing caps (150 IP bullpen, 300 PA bench)
- Or try no caps and compare MAE

## Key Files

| File | Role |
|------|------|
| `src/views/TeamRatingsView.ts` | Standings rendering, WAR→Wins formula, role adjustments |
| `src/services/TeamRatingsService.ts` | `getProjectedTeamRatings()` — team WAR calculation |
| `src/services/StandingsService.ts` | Loads actual standings CSVs |
| `tools/calibrate_wins.ts` | WAR→Wins calibration script |
| `data/*_standings.csv` | Actual standings (16 teams 2005-2008, 18 teams 2009-2011, 20 teams 2012-2020) |

## Data Available in Standings CSVs

Each CSV has: `#, Team, W, L, BatterWAR, PitcherWAR, TotalWAR, Wins-WAR`

The TotalWAR column is **OOTP's calculated WAR** (actual, not projected). This can be compared against our projected WAR to isolate whether compression is in our WAR projections or in the WAR→Wins step.

## Findings (Feb 2026)

### Root Cause: WAR Formula Compression

Ran `diagnose_compression.ts` on 286 matched team-seasons (2005-2020). Results:

**WAR range compression** (Our WAR computed from actual stats vs OOTP WAR):
- Overall: slope=0.784 (21.6% compression), R²=0.789
- **Batting**: slope=0.590 (41% compression) — **dominant source**
- Pitching: slope=0.743 (26% compression)

**Why batters compress so much**: Our batter WAR only models offensive value (wOBA → wRAA → WAR). It omits **positional adjustment** and **fielding value**, which together account for ~41% of team-level batter WAR spread. Good defensive teams (GG SS, C, CF) get boosted in OOTP's WAR; bad defensive teams get penalized — we miss all of that.

**Compression signature**: -0.345 slope (diff vs actual wins). For every 10 wins of actual quality, our projection misses by 3.5 wins toward the mean.

**Role adjustments were hurting**: MAE 5.6 raw vs 5.9 with role adjustments. The PA/IP caps added compression on top of the already-compressed WAR.

**Irreducible OOTP noise**: 4.5 wins MAE (using OOTP's own WAR with our formula). Our WAR formula only adds 1.4 wins of additional error.

**Quadratic model**: No improvement over linear.

### Fixes Applied

1. **Piecewise WAR→Wins formula** (latest): `Wins = 81 + (WAR − median) × slope`, with upper=0.830, lower=0.780. Different slopes above/below median WAR capture asymmetric compression (top teams under-projected more than bottom teams over-projected). MAE 7.52 on 236 team-seasons.

2. **Removed role adjustments**: Bullpen IP cap (110) and bench PA cap (250) removed from standings mode. Diagnostic showed they hurt accuracy.

3. **Stats-driven batter projections**: `BatterProjectionService` refactored from roster-driven to stats-driven (like pitcher `ProjectionService`). Fixed 30-60% of historical batters being excluded from projections. Removed `player.retired` filter from both services.

4. **Pitcher regression calibration**: Elite strength multiplier reduced from 1.30 to 0.80 (trust elite pitchers' stats more). IP model weight shifted from 35% to 45% (more model, less history).

5. **Elite WAR multiplier**: PotentialStatsService applies FIP-based WAR multiplier (1.20x for FIP < 3.20, tapering to 1.0 at FIP 4.20) to compensate for compounding pipeline regression on elite pitchers.

6. **WAR-based lineup construction** (Feb 2026): Changed lineup/bench classification from True Rating sorting with position-scarcity algorithm to simple top-9-by-projected-WAR. Previous approach sorted batters by TR and used a scarcity-based position-filling strategy — this caused high-PA veterans (634 PA) to land on the bench behind low-PA players (229 PA) who had higher TR, inflating bench WAR to absurd levels (17+ WAR). WAR-based sorting ensures the most productive players (quality × playing time) are in the lineup. Now matches the calibration tool pipeline exactly. A bench PA cap (150) was also tested but worsened MAE — the uncapped bench WAR contains real signal.

7. **Simplified standings UI** (Feb 2026): Removed expandable roster detail rows from Standings mode. Roster breakdowns are available in Power Rankings and Projections modes. Standings is now a flat table focused on projected W-L and backtesting accuracy.

### Compression Analysis (from `calibrate_projections.ts`)

- **FIP regression is the main compression source** — inherent to regression-based projections. Individual FIP MAE is 0.584 (excellent), but regression compresses team-level spread by ~59% (pitcher) and ~50% (batter).
- **IP projection is NOT the bottleneck** — tested via hybrid (projected FIP × actual IP) analysis. Same compression with perfect IP.
- **Non-linear sweep tested 4 strategies**: Power curve, asymmetric spread, quadratic WAR→Wins, piecewise WAR→Wins. Piecewise was the clear winner.
- **Irreducible OOTP noise**: ~4.5 wins MAE. Current model adds ~3.0 wins additional error.

### Previous WAR→Wins Formulas

| Version | Formula | MAE | Notes |
|---------|---------|-----|-------|
| Original | `43.0 + 0.998 × WAR` | ~10 | Pre-Feb 2026 |
| Linear recalibration | `35.0 + 1.107 × WAR` | 8.1 | First fix, Feb 2026 |
| Projection-based linear | `51.7 + 0.687 × WAR` | 7.7 | Calibrated on projected WAR |
| **Piecewise (current)** | `81 + (WAR−median) × 0.830/0.780` | **7.52** | Non-linear, asymmetric |

## Expansion History

- 2005-2008: 16 teams
- 2009-2011: 18 teams (added Centurions, Boazu)
- 2012-2020: 20 teams (added Red Coats, Bedouins)
