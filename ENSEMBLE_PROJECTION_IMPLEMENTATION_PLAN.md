# Implementation Plan: Multi-Model Ensemble Projections

## Overview
Replace single-point projections with a weighted ensemble of three models to better capture uncertainty and handle edge cases (declining young players, volatile small samples, etc.).

**Goal**: Reduce K/9 MAE from 0.825 to <0.75 and bias from +0.075 to <0.05 without negatively impacting other stats.

---

## Current System Performance (Baseline)

```
Component Breakdown:
Stat    MAE     RMSE    Bias    Count
FIP     0.606   0.853   +0.144  4658
K/9     0.825   1.082   +0.075  4658  ← Weakest component
BB/9    0.690   0.965   +0.085  4658
HR/9    0.342   0.494   +0.073  4658
```

**Key Observations**:
- Slight optimistic bias across the board (+0.07 to +0.14)
- K/9 has highest error (0.825 MAE)
- Overall system is performing well (0.606 FIP MAE)

---

## Phase 1: Infrastructure Setup

### 1.1 Create Ensemble Service

**New File**: `src/services/EnsembleProjectionService.ts`

```typescript
export interface EnsembleProjection {
  // Final blended projection
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;

  // Individual model outputs (for debugging/analysis)
  components: {
    optimistic: { k9: number; bb9: number; hr9: number; fip: number };
    neutral: { k9: number; bb9: number; hr9: number; fip: number };
    pessimistic: { k9: number; bb9: number; hr9: number; fip: number };
  };

  // Weights used in final blend
  weights: {
    optimistic: number;
    neutral: number;
    pessimistic: number;
  };

  // Metadata for understanding the projection
  metadata: {
    totalIp: number;
    recentTrend: 'improving' | 'declining' | 'stable' | 'volatile';
    trendMagnitude: number; // e.g., -0.46 K/9 change
    confidence: 'low' | 'medium' | 'high';
  };
}
```

### 1.2 Three Model Variants

#### Model A: Optimistic (Current System)
- Uses standard aging curves (+0.5 Stuff at age 24)
- Assumes average development trajectory
- **When it's right**: Young players who follow typical development
- **When it's wrong**: Players whose development has stalled

#### Model B: Neutral (Conservative Aging)
- No aging adjustment (or minimal: +0.0 Stuff instead of +0.5)
- Projects "status quo" talent level
- **When it's right**: Players who've plateaued, volatile small samples
- **When it's wrong**: True breakouts, late bloomers

#### Model C: Pessimistic (Trend Continuation)
- Assumes recent trajectory continues (or mean-reverts minimally)
- If declining, projects further decline (dampened)
- If improving, projects further improvement (dampened)
- **When it's right**: True talent changes (injury, mechanics shift)
- **When it's wrong**: Random variance, small sample noise

---

## Phase 2: Weight Calibration Strategy

### 2.1 Confidence Factors

The ensemble weights should be dynamic based on:

#### Factor 1: Sample Size Confidence
```typescript
function calculateIpConfidence(totalIp: number): number {
  // Maps IP to confidence score [0, 1]
  // 0 IP = 0.0 (no confidence)
  // 300 IP = 1.0 (full confidence)
  // Sigmoid-like curve
  return Math.min(1.0, totalIp / 300);
}
```

**Logic**: More IP = trust recent performance more (pessimistic/neutral), less IP = trust scouting/development (optimistic)

#### Factor 2: Age Development Phase
```typescript
function calculateAgeFactor(age: number): number {
  // Young players (< 25): Higher optimistic weight
  // Peak players (25-30): Balanced
  // Declining (30+): Higher neutral/pessimistic weight

  if (age < 23) return 0.7;      // Rapid development expected
  if (age < 25) return 0.5;      // Still developing, but less certain
  if (age < 28) return 0.3;      // Peak plateau
  if (age < 32) return 0.2;      // Slow decline
  return 0.1;                     // Established decline
}
```

**Logic**: Younger = more room for development, older = "you are who you are"

#### Factor 3: Recent Trend Volatility
```typescript
function calculateTrendVolatility(yearlyStats: YearlyPitchingStats[]): number {
  // Calculate coefficient of variation in recent K/9
  // Low volatility = stable player (trust trend more)
  // High volatility = noisy (trust neutral more)

  const k9Values = yearlyStats.slice(0, 3).map(s => s.k9);
  const mean = k9Values.reduce((a, b) => a + b) / k9Values.length;
  const stdDev = Math.sqrt(
    k9Values.reduce((sum, k9) => sum + Math.pow(k9 - mean, 2), 0) / k9Values.length
  );

  return stdDev / mean; // Coefficient of variation
}
```

**Logic**: Volatile stats = less reliable trends, stable stats = trust direction

#### Factor 4: Trend Direction & Magnitude
```typescript
function calculateTrendFactor(yearlyStats: YearlyPitchingStats[]): {
  direction: 'improving' | 'declining' | 'stable';
  magnitude: number;
  confidence: number;
} {
  const recent = yearlyStats[0];
  const previous = yearlyStats[1];

  const change = recent.k9 - previous.k9;
  const percentChange = change / previous.k9;

  // Weight by IP (more IP = more confident in trend)
  const ipWeight = Math.min(1.0, recent.ip / 60);
  const confidence = ipWeight * (1 - calculateTrendVolatility(yearlyStats));

  let direction: 'improving' | 'declining' | 'stable';
  if (Math.abs(percentChange) < 0.05) {
    direction = 'stable';
  } else {
    direction = change > 0 ? 'improving' : 'declining';
  }

  return { direction, magnitude: change, confidence };
}
```

### 2.2 Initial Weight Formula (Starting Point)

```typescript
function calculateEnsembleWeights(
  ipConfidence: number,      // 0-1
  ageFactor: number,         // 0-1
  trendVolatility: number,   // 0-0.5 typically
  trendFactor: { direction: string; magnitude: number; confidence: number }
): { optimistic: number; neutral: number; pessimistic: number } {

  // Base weights (will be calibrated in Phase 3)
  let wOptimistic = 0.4;
  let wNeutral = 0.4;
  let wPessimistic = 0.2;

  // Adjust for age (younger = more optimistic)
  wOptimistic += ageFactor * 0.2;
  wNeutral -= ageFactor * 0.1;
  wPessimistic -= ageFactor * 0.1;

  // Adjust for IP confidence (more IP = trust recent performance)
  wOptimistic -= ipConfidence * 0.2;
  wNeutral += ipConfidence * 0.15;
  wPessimistic += ipConfidence * 0.05;

  // Adjust for volatility (high volatility = favor neutral)
  const volatilityPenalty = Math.min(0.2, trendVolatility * 0.5);
  wOptimistic -= volatilityPenalty;
  wNeutral += volatilityPenalty;

  // Adjust for trend direction (only if high confidence)
  if (trendFactor.confidence > 0.5) {
    if (trendFactor.direction === 'declining') {
      wPessimistic += 0.15;
      wOptimistic -= 0.15;
    } else if (trendFactor.direction === 'improving') {
      wPessimistic -= 0.10;
      wOptimistic += 0.10;
    }
  }

  // Normalize to sum to 1.0
  const sum = wOptimistic + wNeutral + wPessimistic;
  return {
    optimistic: wOptimistic / sum,
    neutral: wNeutral / sum,
    pessimistic: wPessimistic / sum
  };
}
```

**Note**: These are starting values. Phase 3 will optimize via grid search on historical data.

---

## Phase 3: Historical Calibration & Validation

### 3.1 Create Calibration Dataset

**File**: `tools/calibrate_ensemble.py` (or `.ts`)

```python
"""
Calibration Script for Ensemble Projections

1. Load historical projection validation data (years 2015-2020 → actuals 2021)
2. For each player-year:
   - Calculate all 3 model projections (optimistic, neutral, pessimistic)
   - Try different weight formulas
   - Compare to actual 2021 performance
3. Find weight parameters that minimize MAE/RMSE
4. Output optimized weight formula
"""

import pandas as pd
import numpy as np
from scipy.optimize import minimize

# Grid search parameters
AGE_FACTOR_RANGE = np.linspace(0.1, 0.9, 9)
IP_FACTOR_RANGE = np.linspace(0.1, 0.3, 5)
TREND_FACTOR_RANGE = np.linspace(0.05, 0.20, 4)

def calculate_projection_error(weights_params, validation_data):
    """
    Calculate MAE/RMSE for a given set of weight parameters
    """
    errors = []

    for player in validation_data:
        weights = calculate_weights(player.ip, player.age, player.trend, weights_params)
        predicted_k9 = (
            weights['optimistic'] * player.optimistic_k9 +
            weights['neutral'] * player.neutral_k9 +
            weights['pessimistic'] * player.pessimistic_k9
        )
        actual_k9 = player.actual_k9
        errors.append(abs(predicted_k9 - actual_k9))

    return {
        'mae': np.mean(errors),
        'rmse': np.sqrt(np.mean(np.square(errors))),
        'bias': np.mean([p - a for p, a in zip(predicted, actual)])
    }

def grid_search_optimal_weights():
    """
    Try all combinations of weight parameters
    Find the one with lowest MAE on K/9
    """
    best_params = None
    best_mae = float('inf')

    for age_weight in AGE_FACTOR_RANGE:
        for ip_weight in IP_FACTOR_RANGE:
            for trend_weight in TREND_FACTOR_RANGE:
                params = {
                    'age_factor': age_weight,
                    'ip_factor': ip_weight,
                    'trend_factor': trend_weight
                }

                error_metrics = calculate_projection_error(params, validation_data)

                if error_metrics['mae'] < best_mae:
                    best_mae = error_metrics['mae']
                    best_params = params

    return best_params, best_mae
```

### 3.2 Validation Metrics to Track

Compare ensemble vs current system on:

| Metric | Current System | Ensemble Target | Status |
|--------|----------------|-----------------|--------|
| K/9 MAE | 0.825 | < 0.75 | 🎯 Primary goal |
| K/9 RMSE | 1.082 | < 1.00 | Secondary |
| K/9 Bias | +0.075 | ±0.05 | Balance optimism |
| FIP MAE | 0.606 | ≤ 0.65 | Don't harm overall |
| BB/9 MAE | 0.690 | ≤ 0.70 | Don't harm |
| HR/9 MAE | 0.342 | ≤ 0.35 | Don't harm |

**Success Criteria**:
- K/9 MAE improves by at least 0.05 (6% reduction)
- No other stat gets worse by more than 0.03
- Bias stays within ±0.10 (not too pessimistic)

### 3.3 Stratified Analysis

Break down performance by player segments:

```typescript
// Test ensemble performance on different player types
const segments = {
  'young_declining': { age: '<25', trend: 'declining', minIP: 50 },
  'young_improving': { age: '<25', trend: 'improving', minIP: 50 },
  'peak_stable': { age: '25-30', trend: 'stable', minIP: 100 },
  'old_declining': { age: '>30', trend: 'declining', minIP: 100 },
  'low_ip_volatile': { age: 'any', trend: 'volatile', maxIP: 80 }
};

// Ensure ensemble helps the problematic cases without hurting others
```

This ensures we're not just optimizing average error, but specifically fixing the "declining young player" problem.

---

## Phase 4: Implementation Details

### 4.1 Modify ProjectionService

**File**: `src/services/ProjectionService.ts`

```typescript
import { ensembleProjectionService } from './EnsembleProjectionService';

class ProjectionService {
  // ... existing code ...

  async getProjections(year: number, options?: {
    forceRosterRefresh?: boolean;
    useEnsemble?: boolean; // Feature flag
  }): Promise<ProjectedPlayer[]> {

    // ... existing data fetching ...

    for (const tr of trResults) {
      // ... existing player logic ...

      let projectedStats;

      if (options?.useEnsemble) {
        // NEW: Ensemble projection
        const ensemble = ensembleProjectionService.calculateEnsemble({
          currentRatings,
          age: ageInYear,
          yearlyStats,
          leagueContext,
          scouting,
          currentStats
        });

        projectedStats = {
          k9: ensemble.k9,
          bb9: ensemble.bb9,
          hr9: ensemble.hr9,
          fip: ensemble.fip,
          // ... rest of stats
        };

        // Store ensemble metadata for UI display (future Phase 5)
        (projectedStats as any).__ensembleMeta = ensemble.metadata;

      } else {
        // EXISTING: Single-model projection (unchanged)
        const projectedRatings = agingService.applyAging(currentRatings, ageInYear);
        projectedStats = PotentialStatsService.calculatePitchingStats(
          { ...projectedRatings, movement: 50, babip: 50 },
          ipResult.ip,
          leagueContext
        );
      }

      tempProjections.push({
        // ... existing fields
        projectedStats
      });
    }

    // ... rest of existing logic
  }
}
```

### 4.2 Ensemble Service Core Logic

**File**: `src/services/EnsembleProjectionService.ts`

```typescript
class EnsembleProjectionService {
  calculateEnsemble(input: {
    currentRatings: { stuff: number; control: number; hra: number };
    age: number;
    yearlyStats?: YearlyPitchingStats[];
    leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number };
    scouting?: PitcherScoutingRatings;
    currentStats?: TruePlayerStats;
  }): EnsembleProjection {

    const { currentRatings, age, yearlyStats, leagueContext } = input;

    // STEP 1: Calculate all three models
    const optimistic = this.calculateOptimisticModel(currentRatings, age, leagueContext);
    const neutral = this.calculateNeutralModel(currentRatings, age, leagueContext);
    const pessimistic = this.calculatePessimisticModel(
      currentRatings,
      age,
      yearlyStats,
      leagueContext
    );

    // STEP 2: Calculate confidence factors
    const totalIp = yearlyStats?.reduce((sum, s) => sum + s.ip, 0) ?? 0;
    const ipConfidence = this.calculateIpConfidence(totalIp);
    const ageFactor = this.calculateAgeFactor(age);
    const trendFactor = yearlyStats && yearlyStats.length >= 2
      ? this.calculateTrendFactor(yearlyStats)
      : { direction: 'stable' as const, magnitude: 0, confidence: 0 };
    const trendVolatility = yearlyStats && yearlyStats.length >= 3
      ? this.calculateTrendVolatility(yearlyStats)
      : 0.15; // Default moderate volatility

    // STEP 3: Calculate ensemble weights (using calibrated formula)
    const weights = this.calculateEnsembleWeights(
      ipConfidence,
      ageFactor,
      trendVolatility,
      trendFactor
    );

    // STEP 4: Blend projections
    const blendedK9 =
      optimistic.k9 * weights.optimistic +
      neutral.k9 * weights.neutral +
      pessimistic.k9 * weights.pessimistic;

    const blendedBb9 =
      optimistic.bb9 * weights.optimistic +
      neutral.bb9 * weights.neutral +
      pessimistic.bb9 * weights.pessimistic;

    const blendedHr9 =
      optimistic.hr9 * weights.optimistic +
      neutral.hr9 * weights.neutral +
      pessimistic.hr9 * weights.pessimistic;

    const blendedFip =
      optimistic.fip * weights.optimistic +
      neutral.fip * weights.neutral +
      pessimistic.fip * weights.pessimistic;

    // STEP 5: Generate metadata
    const metadata = {
      totalIp,
      recentTrend: trendFactor.direction,
      trendMagnitude: trendFactor.magnitude,
      confidence: ipConfidence > 0.7 ? 'high' as const :
                  ipConfidence > 0.4 ? 'medium' as const :
                  'low' as const
    };

    return {
      k9: Math.round(blendedK9 * 100) / 100,
      bb9: Math.round(blendedBb9 * 100) / 100,
      hr9: Math.round(blendedHr9 * 100) / 100,
      fip: Math.round(blendedFip * 100) / 100,
      components: { optimistic, neutral, pessimistic },
      weights,
      metadata
    };
  }

  private calculateOptimisticModel(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    leagueContext: any
  ): { k9: number; bb9: number; hr9: number; fip: number } {
    // Existing system: full aging curve
    const projectedRatings = agingService.applyAging(currentRatings, age);
    return {
      k9: PotentialStatsService.calculateK9(projectedRatings.stuff),
      bb9: PotentialStatsService.calculateBB9(projectedRatings.control),
      hr9: PotentialStatsService.calculateHR9(projectedRatings.hra),
      fip: this.calculateFip(
        PotentialStatsService.calculateK9(projectedRatings.stuff),
        PotentialStatsService.calculateBB9(projectedRatings.control),
        PotentialStatsService.calculateHR9(projectedRatings.hra),
        leagueContext.fipConstant
      )
    };
  }

  private calculateNeutralModel(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    leagueContext: any
  ): { k9: number; bb9: number; hr9: number; fip: number } {
    // No aging adjustment (or minimal)
    const agingMods = agingService.getAgingModifiers(age);
    const dampedMods = {
      stuff: agingMods.stuff * 0.2,   // 20% of normal aging
      control: agingMods.control * 0.2,
      hra: agingMods.hra * 0.2
    };

    const projectedRatings = {
      stuff: Math.max(20, Math.min(80, currentRatings.stuff + dampedMods.stuff)),
      control: Math.max(20, Math.min(80, currentRatings.control + dampedMods.control)),
      hra: Math.max(20, Math.min(80, currentRatings.hra + dampedMods.hra))
    };

    return {
      k9: PotentialStatsService.calculateK9(projectedRatings.stuff),
      bb9: PotentialStatsService.calculateBB9(projectedRatings.control),
      hr9: PotentialStatsService.calculateHR9(projectedRatings.hra),
      fip: this.calculateFip(
        PotentialStatsService.calculateK9(projectedRatings.stuff),
        PotentialStatsService.calculateBB9(projectedRatings.control),
        PotentialStatsService.calculateHR9(projectedRatings.hra),
        leagueContext.fipConstant
      )
    };
  }

  private calculatePessimisticModel(
    currentRatings: { stuff: number; control: number; hra: number },
    age: number,
    yearlyStats: YearlyPitchingStats[] | undefined,
    leagueContext: any
  ): { k9: number; bb9: number; hr9: number; fip: number } {
    // Trend-based projection (dampened)
    if (!yearlyStats || yearlyStats.length < 2) {
      // No trend data, fall back to neutral model
      return this.calculateNeutralModel(currentRatings, age, leagueContext);
    }

    // Calculate recent trend
    const recentK9 = yearlyStats[0].k9;
    const previousK9 = yearlyStats[1].k9;
    const k9Trend = recentK9 - previousK9;

    const recentBb9 = yearlyStats[0].bb9;
    const previousBb9 = yearlyStats[1].bb9;
    const bb9Trend = recentBb9 - previousBb9;

    const recentHr9 = yearlyStats[0].hr9;
    const previousHr9 = yearlyStats[1].hr9;
    const hr9Trend = recentHr9 - previousHr9;

    // Dampen trends (assume 50% continuation)
    const dampening = 0.5;

    // Convert current ratings to stats
    const currentK9 = PotentialStatsService.calculateK9(currentRatings.stuff);
    const currentBb9 = PotentialStatsService.calculateBB9(currentRatings.control);
    const currentHr9 = PotentialStatsService.calculateHR9(currentRatings.hra);

    // Apply dampened trend
    const projK9 = currentK9 + (k9Trend * dampening);
    const projBb9 = currentBb9 + (bb9Trend * dampening);
    const projHr9 = currentHr9 + (hr9Trend * dampening);

    return {
      k9: projK9,
      bb9: projBb9,
      hr9: projHr9,
      fip: this.calculateFip(projK9, projBb9, projHr9, leagueContext.fipConstant)
    };
  }

  private calculateFip(k9: number, bb9: number, hr9: number, fipConstant: number): number {
    return (13 * hr9 + 3 * bb9 - 2 * k9) + fipConstant;
  }

  // ... confidence factor methods from Phase 2.1 ...
}
```

### 4.3 Testing Strategy

```typescript
// File: tests/ensemble_projection_test.ts

describe('EnsembleProjectionService', () => {

  test('declining young player gets conservative projection', () => {
    const result = ensembleService.calculateEnsemble({
      currentRatings: { stuff: 46, control: 50, hra: 45 },
      age: 24,
      yearlyStats: [
        { year: 2024, ip: 48, k9: 4.84, bb9: 3.2, hr9: 1.1, gs: 8 },
        { year: 2023, ip: 71, k9: 5.30, bb9: 3.0, hr9: 1.0, gs: 12 },
        { year: 2022, ip: 86, k9: 4.98, bb9: 3.5, hr9: 1.2, gs: 15 }
      ],
      leagueContext: { fipConstant: 3.47, avgFip: 4.2, runsPerWin: 8.5 }
    });

    // Should project BELOW age 23 peak (5.30)
    expect(result.k9).toBeLessThan(5.30);

    // Should not be overly pessimistic (ABOVE age 24 actual)
    expect(result.k9).toBeGreaterThan(4.84);

    // Should increase pessimistic weight due to declining trend
    expect(result.weights.pessimistic).toBeGreaterThan(0.25);
  });

  test('improving young player maintains optimism', () => {
    const result = ensembleService.calculateEnsemble({
      currentRatings: { stuff: 46, control: 50, hra: 45 },
      age: 24,
      yearlyStats: [
        { year: 2024, ip: 48, k9: 5.30, bb9: 3.2, hr9: 1.1, gs: 8 },
        { year: 2023, ip: 71, k9: 4.84, bb9: 3.0, hr9: 1.0, gs: 12 },
        { year: 2022, ip: 86, k9: 4.98, bb9: 3.5, hr9: 1.2, gs: 15 }
      ],
      leagueContext: { fipConstant: 3.47, avgFip: 4.2, runsPerWin: 8.5 }
    });

    // Should project continued improvement
    expect(result.k9).toBeGreaterThan(5.30);

    // Should favor optimistic model
    expect(result.weights.optimistic).toBeGreaterThan(0.35);
  });

  test('veteran with limited IP favors neutral', () => {
    const result = ensembleService.calculateEnsemble({
      currentRatings: { stuff: 55, control: 60, hra: 50 },
      age: 32,
      yearlyStats: [
        { year: 2024, ip: 30, k9: 8.0, bb9: 2.5, hr9: 0.9, gs: 2 }
      ],
      leagueContext: { fipConstant: 3.47, avgFip: 4.2, runsPerWin: 8.5 }
    });

    // Small sample + old age = trust neutral model
    expect(result.weights.neutral).toBeGreaterThan(0.4);
    expect(result.metadata.confidence).toBe('low');
  });

  test('ensemble weights sum to 1.0', () => {
    const result = ensembleService.calculateEnsemble({
      currentRatings: { stuff: 50, control: 50, hra: 50 },
      age: 27,
      yearlyStats: [],
      leagueContext: { fipConstant: 3.47, avgFip: 4.2, runsPerWin: 8.5 }
    });

    const sum = result.weights.optimistic + result.weights.neutral + result.weights.pessimistic;
    expect(sum).toBeCloseTo(1.0, 5);
  });
});
```

---

## Phase 5: Gradual Rollout

### 5.1 Feature Flag Integration

```typescript
// Add to user preferences or config
interface ProjectionConfig {
  useEnsembleProjections: boolean; // Default: false initially
  showEnsembleComponents: boolean; // Show breakdown for debugging
}

// In ProjectionsView.ts
const config = loadProjectionConfig();
const projections = await projectionService.getProjections(year, {
  forceRosterRefresh: false,
  useEnsemble: config.useEnsembleProjections
});
```

### 5.2 Parallel Comparison Mode

Run both systems side-by-side for one season:

```
Player: John Doe (Age 25)

Current System: 5.56 K/9 (FIP 3.85)
Ensemble: 5.16 K/9 (FIP 4.02)

[Show Details]
  Optimistic: 5.56 K/9 (40% weight)
  Neutral: 5.04 K/9 (45% weight)
  Pessimistic: 4.72 K/9 (15% weight)

Trend: Declining (5.30 → 4.84, -8.7%)
Confidence: Medium (205 IP)
```

### 5.3 Gradual Transition Plan

**Week 1-2**: Deploy with feature flag OFF
- Monitor for any integration bugs
- Ensure no performance regression

**Week 3-4**: Enable for small subset (10% of users)
- Collect feedback
- Monitor if projections "feel right" to users

**Month 2**: Enable for all users as "Beta" toggle
- Show comparison mode
- Let users choose which they prefer

**Month 3**: Analyze one season of actuals
- Compare ensemble vs current system accuracy
- If ensemble wins: make it default
- If current wins: keep as optional

---

## Phase 6: Post-Launch Monitoring

### 6.1 Metrics Dashboard

Track on ongoing basis:

```typescript
// Analytics to collect
interface EnsembleAnalytics {
  // How often does ensemble differ significantly from current?
  divergenceRate: number;
  avgDivergence: number; // Average K/9 difference

  // Which model wins most often?
  modelContributions: {
    optimistic: number;
    neutral: number;
    pessimistic: number;
  };

  // Accuracy by player segment
  segmentAccuracy: {
    youngDeclining: { mae: number; count: number };
    youngImproving: { mae: number; count: number };
    peakStable: { mae: number; count: number };
    // ... etc
  };
}
```

### 6.2 Continuous Calibration

After each season:
1. Collect actual performance data
2. Re-run calibration script
3. Update weight parameters if significant drift detected
4. A/B test new weights vs old weights

---

## Implementation Timeline

### Week 1: Infrastructure
- [ ] Create `EnsembleProjectionService.ts` skeleton
- [ ] Implement three model variants (optimistic, neutral, pessimistic)
- [ ] Write unit tests for each model

### Week 2: Confidence Factors
- [ ] Implement IP confidence calculation
- [ ] Implement age factor calculation
- [ ] Implement trend detection (direction, magnitude, volatility)
- [ ] Test on sample players

### Week 3: Weight Formula
- [ ] Implement initial weight calculation (uncalibrated)
- [ ] Create test suite with edge cases
- [ ] Integrate with ProjectionService (behind feature flag)

### Week 4: Calibration Setup
- [ ] Extract historical projection data (2015-2020 → 2021 actuals)
- [ ] Create calibration script (`tools/calibrate_ensemble.py` or `.ts`)
- [ ] Prepare validation data in structured format

### Week 5: Grid Search Calibration
- [ ] Run grid search on weight parameters
- [ ] Test different weight formulas
- [ ] Identify optimal parameters that minimize K/9 MAE

### Week 6: Validation
- [ ] Run full validation suite (all 4658 player-seasons)
- [ ] Compare metrics: ensemble vs current
- [ ] Stratified analysis by player segment
- [ ] Verify we hit success criteria

### Week 7: Refinement
- [ ] Tune parameters based on validation results
- [ ] Fix any edge cases
- [ ] Performance optimization (if needed)
- [ ] Final testing

### Week 8: Documentation & Deployment
- [ ] Update README with ensemble methodology
- [ ] Add inline code comments
- [ ] Deploy with feature flag OFF
- [ ] Monitor for integration issues

### Week 9+: Gradual Rollout
- [ ] Enable for 10% of users
- [ ] Collect feedback
- [ ] Enable for all users as beta toggle
- [ ] Wait for next season to validate accuracy

---

## Success Criteria

### Must Have (Launch Blockers)
- ✅ K/9 MAE improves by ≥0.05 (from 0.825 to ≤0.775)
- ✅ K/9 Bias stays within ±0.10 (not overly pessimistic)
- ✅ FIP MAE does not worsen by >0.03
- ✅ All unit tests pass
- ✅ No performance regression (projections still load in <2s)

### Nice to Have (Post-Launch Goals)
- 🎯 K/9 MAE under 0.75 (stretch goal)
- 🎯 Bias reduced to ±0.05 (perfectly balanced)
- 🎯 User feedback positive (if comparison mode enabled)

### Fail Conditions (Revert if True)
- ❌ K/9 MAE increases (gets worse)
- ❌ Bias swings below -0.15 (too pessimistic)
- ❌ Other stats (BB/9, HR/9, FIP) worsen significantly
- ❌ Projections take >5s to load (performance hit)

---

## Risks & Mitigations

### Risk 1: Overfitting to Historical Data
**Problem**: Calibrated weights work great on 2015-2021, fail on future years.

**Mitigation**:
- Use k-fold cross-validation (train on 2015-2019, test on 2020-2021)
- Reserve 2022 data (if available) as final holdout test
- Keep weight formula simple (avoid too many parameters)

### Risk 2: Ensemble is Too Conservative
**Problem**: Reducing optimism too much, underprojecting breakouts.

**Mitigation**:
- Strict bias monitoring (must stay >-0.10)
- Stratified analysis (ensure we don't hurt "improving player" accuracy)
- A/B test before full rollout

### Risk 3: Computational Complexity
**Problem**: Calculating 3 models for every player slows down projections.

**Mitigation**:
- Profile code, optimize hot paths
- Cache intermediate calculations
- Consider pre-computing projections overnight (async)

### Risk 4: User Confusion
**Problem**: Users don't understand why projections changed.

**Mitigation**:
- Add changelog/explanation in UI
- Show comparison mode (old vs new)
- Provide "Show Details" to explain ensemble weights

---

## Open Questions for Discussion

### Q1: Should we ensemble all stats or just K/9?
**Option A**: Only ensemble K/9 (our weakest stat), keep BB/9 and HR/9 unchanged.
**Option B**: Ensemble all three stats (K/9, BB/9, HR/9) for consistency.

**Recommendation**: Option B (ensemble all), because:
- Consistent methodology
- BB/9 and HR/9 might also benefit (slight optimistic bias)
- FIP is derived from all three, needs them in sync

### Q2: Should pessimistic model use recent stats or extrapolated trend?
**Current Plan**: Extrapolate trend (if K/9 dropped 0.46, assume another 0.23 drop)

**Alternative**: Use most recent season as-is (no aging adjustment at all)

**Recommendation**: Start with trend extrapolation (dampened 50%), easier to calibrate.

### Q3: How often should we re-calibrate weights?
**Options**:
- Annually (after each season ends)
- Every 3 years (avoid chasing noise)
- Only when validation metrics degrade significantly

**Recommendation**: Annual review, but only update if MAE improves by >0.03.

---

## Next Steps

1. **Review this plan** - Do you agree with the overall approach?
2. **Adjust timeline** - Is 8 weeks reasonable or too ambitious?
3. **Prioritize phases** - Which phases are MVP vs nice-to-have?
4. **Historical data prep** - Do you already have 2015-2021 projection validation data?
5. **Begin Phase 1** - Once approved, I can start implementing the infrastructure.

Let me know your thoughts!
