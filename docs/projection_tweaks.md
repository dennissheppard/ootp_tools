# Pitcher Projection Calibration

**Last Updated**: January 29, 2026

## Problem

Back-projection testing (2015-2020) revealed systematic bias:
- **Elite pitchers (Q1)**: Over-projected FIP by 0.334 (too pessimistic)
- **Below-average (Q4)**: Under-projected FIP by 0.839 (too optimistic)
- **K/9 over-projection**: -0.605 bias (projecting strikeouts too high)
- **Top 10 WAR**: Under-projected by 0.46 WAR on average

**Root Cause**: Mixing starters, swingmen, and relievers into one regression model compromised accuracy for all groups.

## Solution: Three-Tier Regression System

Implemented separate regression parameters based on pitcher workload:

### Tier Boundaries
- **Starters**: 130+ IP (conservative regression, large samples)
- **Swingmen**: 70-130 IP (moderate regression, medium samples)
- **Relievers**: 20-70 IP (aggressive regression, high volatility)

### Optimized Parameters

**Starters (130+ IP)** - 306 samples, MAE 0.448
```
League Averages: K/9=5.60, BB/9=2.80, HR/9=0.90
Regression Ratios: k9=0.60, bb9=0.80, hr9=0.18
```

**Swingmen (70-130 IP)** - 101 samples, MAE 0.664
```
League Averages: K/9=6.60, BB/9=2.60, HR/9=0.75
Regression Ratios: k9=1.20, bb9=0.80, hr9=0.18
```

**Relievers (20-70 IP)** - 235 samples, MAE 0.856
```
League Averages: K/9=6.40, BB/9=2.80, HR/9=0.90
Regression Ratios: k9=1.20, bb9=0.40, hr9=0.18
```

### Why Swingmen Need Different Parameters

- **Higher K/9 baseline** (6.60 vs 5.60): Includes relievers making spot starts
- **2x stronger K/9 regression** (1.20 vs 0.60): Small samples need aggressive regression
- **Different role mix**: Transitional pitchers between starter/reliever roles

## Results

**Starters (What Matters Most)**
- FIP Bias: -0.012 (near-perfect!)
- K/9 Bias: +0.009 (fixed from -0.605)
- Overall MAE: 0.448

**Swingmen**
- FIP Bias: -0.001
- K/9 Bias: +0.020
- Overall MAE: 0.664

**Relievers**
- FIP Bias: -0.069
- K/9 Bias: +0.002
- Overall MAE: 0.856 (expected - inherently volatile)

## Implementation

**File**: `src/services/TrueRatingsCalculationService.ts`

Added two helper functions:
- `getLeagueAveragesByIp(totalIp)`: Returns tier-specific league averages
- `getRegressionRatioByIp(totalIp, statType)`: Returns tier-specific regression ratios

Modified core calculation to automatically apply tier-based parameters based on pitcher's total IP.

## Methodology

**Optimization**: Automated grid search testing 18,750-45,360 parameter combinations per tier
**Data**: 2015-2020 back-projections with consecutive qualifying seasons
**Runtime**: ~3-5 seconds per tier
**Validation**: Tested multiple boundary configurations (75-100, 75-125, 70-130) before selecting optimal

## Known Issues

### 1. Badge Display Issue [IN PROGRESS - Jan 28, 2026]

**Current Issue**: Tom Bach (22yo, 22 IP, starGap 1.5) is showing True Rating on his profile when it should be True Future Rating.

**Observations**:
- Console shows: `TR=2.5, TFR=3.5, starGap=undefined`
- Badge choosing TR and showing incorrectly (shows 3.5), UI might be displaying wrong value
- starGap is undefined despite having scouting data (OVR=2.0, POT=3.5, gap=1.5)


**Investigating**:
1. Why starGap is undefined in badge logic (scouting data not passed through?)
2. Why the console shows 2.5 TR but UI shows 3.5
3. Why we're showing TR on the profile rather than TFR

**Potential Fixes**:
- Ensure starGap is populated when TFR is calculated


### 5. Other Limitations

- **Bottom-of-barrel pitchers (Q4)**: Still project too optimistically due to survivor bias
- **Tier boundaries**: Pitchers at 70 or 130 IP may experience parameter discontinuity
- **"Cliff divers"**: Sudden collapses (4.0→6.0 FIP) due to injury/age are unpredictable



