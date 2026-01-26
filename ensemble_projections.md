# Ensemble Projections Implementation Plan

## Quick Start Guide (For Future Sessions)

**When resuming this work, start here:**

1. **Read the Executive Summary** below for context
2. **Review the Problem Statement** to understand what we're solving
3. **Jump to Phase 1 Implementation Checklist** to see what needs to be built
4. **Reference the Detailed Walkthrough Examples** to understand expected behavior

### Key Files You'll Need to Reference

**Existing Services** (understand these first):
- `src/services/ProjectionService.ts` - Main projection logic, integration point for ensemble
- `src/services/AgingService.ts` - Current aging curve implementation (used by optimistic model)
- `src/services/TrueRatingsCalculationService.ts` - Rating estimation, regression to mean
- `src/services/PotentialStatsService.ts` - Rating-to-stat conversions (formulas)
- `src/services/ProjectionAnalysisService.ts` - Validation framework (already exists!)

**Files to Create**:
- `src/services/EnsembleProjectionService.ts` - NEW: Core ensemble logic
- `tools/calibrate_ensemble_weights.ts` - NEW: Weight calibration script
- `tests/ensemble_projection_test.ts` - NEW: Unit tests

**Supporting Analysis** (reference for context):
- `k9_projection_analysis.md` - Detailed breakdown of the declining player problem
- `tests/projection_trajectory_test.ts` - Test script showing current system behavior

### Critical Context

**The Core Issue**: Current system projects a 25yo pitcher with declining K/9 (5.30→4.84) to achieve a career-high 5.56 K/9. This happens because:
1. Regression to league mean (7.5) inflates the projection
2. Aging curve applies +0.5 Stuff boost regardless of recent trajectory

**The Solution**: Ensemble of 3 models (Optimistic/Neutral/Pessimistic) with dynamic weights based on age, IP, trends, and volatility.

**Success Criteria**: K/9 MAE from 0.825 → <0.75, Bias from +0.075 → ±0.05, without harming other stats.

### Before Starting Implementation

- [ ] Verify test script runs: `npx tsx tests/projection_trajectory_test.ts`
- [ ] Confirm analysis service works: Check ProjectionsView → Analysis tab in app
- [ ] Review current projection formulas in PotentialStatsService (K/9 = 2.10 + 0.074×Stuff)
- [ ] Understand aging modifiers in AgingService (age 24 gets +0.5 Stuff)

### Implementation Order

**Phase 1** (Week 1): Build EnsembleProjectionService with uncalibrated weights
**Phase 2** (Week 2-3): Run calibration script to optimize weights on historical data
**Phase 3** (Week 4): Analyze results, verify success criteria
**Phase 4** (Week 5+): Deploy with feature flag, validate on new season

### Important Notes

- **Don't overthink calibration initially** - Start with the pre-defined weight formula in Phase 1, optimize in Phase 2
- **Use existing ProjectionAnalysisService** - It already does validation (2015-2020→actuals), leverage it!
- **Feature flag everything** - Easy rollback is critical
- **Test on declining player example** - If ensemble doesn't fix that case (5.56→~5.35), weights need tuning

### Questions to Ask if Stuck

1. "Does the test case in `tests/projection_trajectory_test.ts` still show the problem?"
2. "Are the three models producing different outputs? (optimistic ≠ neutral ≠ pessimistic)"
3. "Do weights sum to 1.0 and make logical sense? (declining player → higher pessimistic weight)"
4. "Does integration with ProjectionService work via feature flag?"

---

## Executive Summary

Replace single-point projections with a weighted ensemble of three models to better handle edge cases (declining young players, volatile small samples, etc.) while improving overall accuracy.

**Target**: Reduce K/9 MAE from 0.825 to <0.75 and reduce optimistic bias across all stats.

**Approach**: Blend Optimistic, Neutral, and Pessimistic models with dynamic weights based on player context (age, IP, recent trends).

**Scope**: Ensemble all three rate stats (K/9, BB/9, HR/9) since they all show slight optimistic bias and FIP depends on all three.

---

## Current System Performance (Baseline)

```
Overall Performance (FIP)
MAE:   0.606
RMSE:  0.853
Bias:  +0.144
N:     4658

Component Breakdown:
Stat    MAE     RMSE    Bias    Count
FIP     0.606   0.853   +0.144  4658
K/9     0.825   1.082   +0.075  4658  ← Weakest component
BB/9    0.690   0.965   +0.085  4658
HR/9    0.342   0.494   +0.073  4658
```

**Key Observations**:
- All stats show optimistic bias (+0.07 to +0.14)
- K/9 has highest error (0.825 MAE)
- Overall system is performing well

---

## Problem Statement

### Example Case: 25yo Pitcher with Declining K/9

**History**:
- Age 22: 4.98 K/9 (86 IP)
- Age 23: 5.30 K/9 (71 IP) ← Career high
- Age 24: 4.84 K/9 (48 IP) ← Declined 8.7%

**Current Projection**: 5.56 K/9 at age 25 (career high despite decline!)

**Root Causes**:
1. **Regression to league mean** (7.5 K/9) inflates projection by 9.6%
2. **Aging curve** is deterministic (+0.5 Stuff for all 24yo), ignores recent trajectory
3. No momentum/trend detection

---

## Solution: Multi-Model Ensemble

### Three Model Variants

#### Model A: Optimistic (Current System)
- Uses standard aging curves (+0.5 Stuff at age 24)
- Assumes average development trajectory
- **When it's right**: Young players following typical development
- **When it's wrong**: Players whose development has stalled

#### Model B: Neutral (Conservative Aging)
- Applies 20% of normal aging adjustment
- Projects "status quo" talent level
- **When it's right**: Plateaued players, volatile small samples
- **When it's wrong**: True breakouts, late bloomers

#### Model C: Pessimistic (Trend Continuation)
- Assumes recent trajectory continues (dampened 50%)
- If declining, projects further decline
- If improving, projects further improvement
- **When it's right**: True talent changes (injury, mechanics shift)
- **When it's wrong**: Random variance, small sample noise

### Expected Results for Declining Player

```
Current System:  5.56 K/9 (career high)
Ensemble:        5.16 K/9 (blended)
  ├─ Optimistic: 5.56 K/9 (32% weight)
  ├─ Neutral:    5.04 K/9 (48% weight)
  └─ Pessimistic: 4.72 K/9 (20% weight)
```

Much more reasonable given the 5.30 → 4.84 trajectory.

---

## Phase 1: Core Implementation

### 1.1 Create Ensemble Service

**New File**: `src/services/EnsembleProjectionService.ts`

```typescript
export interface EnsembleProjection {
  // Final blended rates
  k9: number;
  bb9: number;
  hr9: number;

  // Individual model outputs (for debugging/calibration)
  components: {
    optimistic: { k9: number; bb9: number; hr9: number };
    neutral: { k9: number; bb9: number; hr9: number };
    pessimistic: { k9: number; bb9: number; hr9: number };
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

class EnsembleProjectionService {
  calculateEnsemble(input: {
    currentRatings: { stuff: number; control: number; hra: number };
    age: number;
    yearlyStats?: YearlyPitchingStats[];
    leagueContext: { fipConstant: number; avgFip: number; runsPerWin: number };
  }): EnsembleProjection {
    // 1. Calculate all three models
    const optimistic = this.calculateOptimisticModel(...);
    const neutral = this.calculateNeutralModel(...);
    const pessimistic = this.calculatePessimisticModel(...);

    // 2. Calculate confidence factors
    const ipConfidence = this.calculateIpConfidence(totalIp);
    const ageFactor = this.calculateAgeFactor(age);
    const trendFactor = this.calculateTrendFactor(yearlyStats);
    const trendVolatility = this.calculateTrendVolatility(yearlyStats);

    // 3. Calculate dynamic weights
    const weights = this.calculateEnsembleWeights(
      ipConfidence,
      ageFactor,
      trendVolatility,
      trendFactor
    );

    // 4. Blend projections
    const blendedK9 =
      optimistic.k9 * weights.optimistic +
      neutral.k9 * weights.neutral +
      pessimistic.k9 * weights.pessimistic;

    // ... same for bb9, hr9 ...

    return { k9: blendedK9, bb9: blendedBb9, hr9: blendedHr9, components, weights, metadata };
  }
}
```

### 1.2 Model Implementations

#### Optimistic Model
```typescript
private calculateOptimisticModel(
  currentRatings: { stuff: number; control: number; hra: number },
  age: number,
  leagueContext: any
): { k9: number; bb9: number; hr9: number } {
  // EXISTING SYSTEM: Full aging curve
  const projectedRatings = agingService.applyAging(currentRatings, age);

  return {
    k9: PotentialStatsService.calculateK9(projectedRatings.stuff),
    bb9: PotentialStatsService.calculateBB9(projectedRatings.control),
    hr9: PotentialStatsService.calculateHR9(projectedRatings.hra)
  };
}
```

#### Neutral Model
```typescript
private calculateNeutralModel(
  currentRatings: { stuff: number; control: number; hra: number },
  age: number,
  leagueContext: any
): { k9: number; bb9: number; hr9: number } {
  // CONSERVATIVE: 20% of normal aging
  const agingMods = agingService.getAgingModifiers(age);
  const dampedMods = {
    stuff: agingMods.stuff * 0.2,
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
    hr9: PotentialStatsService.calculateHR9(projectedRatings.hra)
  };
}
```

#### Pessimistic Model
```typescript
private calculatePessimisticModel(
  currentRatings: { stuff: number; control: number; hra: number },
  age: number,
  yearlyStats: YearlyPitchingStats[] | undefined,
  leagueContext: any
): { k9: number; bb9: number; hr9: number } {
  // TREND-BASED: Extrapolate recent trajectory (dampened 50%)
  if (!yearlyStats || yearlyStats.length < 2) {
    return this.calculateNeutralModel(currentRatings, age, leagueContext);
  }

  // Calculate year-over-year trends
  const recentK9 = yearlyStats[0].k9;
  const previousK9 = yearlyStats[1].k9;
  const k9Trend = recentK9 - previousK9;

  const recentBb9 = yearlyStats[0].bb9;
  const previousBb9 = yearlyStats[1].bb9;
  const bb9Trend = recentBb9 - previousBb9;

  const recentHr9 = yearlyStats[0].hr9;
  const previousHr9 = yearlyStats[1].hr9;
  const hr9Trend = recentHr9 - previousHr9;

  // Apply dampened trend (50% continuation)
  const dampening = 0.5;
  const currentK9 = PotentialStatsService.calculateK9(currentRatings.stuff);
  const currentBb9 = PotentialStatsService.calculateBB9(currentRatings.control);
  const currentHr9 = PotentialStatsService.calculateHR9(currentRatings.hra);

  return {
    k9: currentK9 + (k9Trend * dampening),
    bb9: currentBb9 + (bb9Trend * dampening),
    hr9: currentHr9 + (hr9Trend * dampening)
  };
}
```

### 1.3 Confidence Factors

#### IP Confidence
```typescript
private calculateIpConfidence(totalIp: number): number {
  // Maps IP to confidence score [0, 1]
  // 0 IP = 0.0 (no confidence)
  // 300 IP = 1.0 (full confidence)
  return Math.min(1.0, totalIp / 300);
}
```

#### Age Factor
```typescript
private calculateAgeFactor(age: number): number {
  // Young players: Higher optimistic weight
  // Peak players: Balanced
  // Declining: Higher neutral/pessimistic weight

  if (age < 23) return 0.7;      // Rapid development expected
  if (age < 25) return 0.5;      // Still developing
  if (age < 28) return 0.3;      // Peak plateau
  if (age < 32) return 0.2;      // Slow decline
  return 0.1;                    // Established decline
}
```

#### Trend Detection
```typescript
private calculateTrendFactor(yearlyStats: YearlyPitchingStats[]): {
  direction: 'improving' | 'declining' | 'stable';
  magnitude: number;
  confidence: number;
} {
  if (!yearlyStats || yearlyStats.length < 2) {
    return { direction: 'stable', magnitude: 0, confidence: 0 };
  }

  const recent = yearlyStats[0];
  const previous = yearlyStats[1];

  const change = recent.k9 - previous.k9;
  const percentChange = change / previous.k9;

  // Weight by IP (more IP = more confident in trend)
  const ipWeight = Math.min(1.0, recent.ip / 60);
  const volatility = this.calculateTrendVolatility(yearlyStats);
  const confidence = ipWeight * (1 - volatility);

  let direction: 'improving' | 'declining' | 'stable';
  if (Math.abs(percentChange) < 0.05) {
    direction = 'stable';
  } else {
    direction = change > 0 ? 'improving' : 'declining';
  }

  return { direction, magnitude: change, confidence };
}
```

#### Trend Volatility
```typescript
private calculateTrendVolatility(yearlyStats: YearlyPitchingStats[]): number {
  // Calculate coefficient of variation in recent K/9
  // Low volatility = stable (trust trend more)
  // High volatility = noisy (trust neutral more)

  if (!yearlyStats || yearlyStats.length < 3) return 0.15; // Default moderate

  const k9Values = yearlyStats.slice(0, 3).map(s => s.k9);
  const mean = k9Values.reduce((a, b) => a + b) / k9Values.length;
  const stdDev = Math.sqrt(
    k9Values.reduce((sum, k9) => sum + Math.pow(k9 - mean, 2), 0) / k9Values.length
  );

  return stdDev / mean; // Coefficient of variation
}
```

### 1.4 Initial Weight Formula (Pre-Calibration)

```typescript
private calculateEnsembleWeights(
  ipConfidence: number,      // 0-1
  ageFactor: number,         // 0-1
  trendVolatility: number,   // 0-0.5 typically
  trendFactor: { direction: string; magnitude: number; confidence: number }
): { optimistic: number; neutral: number; pessimistic: number } {

  // Base weights (WILL BE CALIBRATED in Phase 2)
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

**Note**: These are starting values. Phase 2 will optimize via grid search.

### 1.5 Integration with ProjectionService

**Modify**: `src/services/ProjectionService.ts`

```typescript
import { ensembleProjectionService } from './EnsembleProjectionService';

class ProjectionService {
  async getProjections(year: number, options?: {
    forceRosterRefresh?: boolean;
    useEnsemble?: boolean; // Feature flag
  }): Promise<ProjectedPlayer[]> {

    // ... existing data fetching ...

    for (const tr of trResults) {
      // ... existing player logic ...

      let projectedK9, projectedBb9, projectedHr9;

      if (options?.useEnsemble) {
        // NEW: Ensemble projection
        const ensemble = ensembleProjectionService.calculateEnsemble({
          currentRatings: {
            stuff: tr.estimatedStuff,
            control: tr.estimatedControl,
            hra: tr.estimatedHra
          },
          age: ageInYear,
          yearlyStats,
          leagueContext
        });

        projectedK9 = ensemble.k9;
        projectedBb9 = ensemble.bb9;
        projectedHr9 = ensemble.hr9;

        // Store metadata for future UI enhancements
        (tempProjections as any).__ensembleMeta = ensemble.metadata;

      } else {
        // EXISTING: Single-model projection (unchanged)
        const projectedRatings = agingService.applyAging(currentRatings, ageInYear);
        projectedK9 = PotentialStatsService.calculateK9(projectedRatings.stuff);
        projectedBb9 = PotentialStatsService.calculateBB9(projectedRatings.control);
        projectedHr9 = PotentialStatsService.calculateHR9(projectedRatings.hra);
      }

      // Calculate FIP from the projected rates
      const projectedFip = (13 * projectedHr9 + 3 * projectedBb9 - 2 * projectedK9) + leagueContext.fipConstant;

      // ... rest of existing logic
    }
  }
}
```

### 1.6 Unit Tests

**New File**: `tests/ensemble_projection_test.ts`

```typescript
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

## Phase 2: Calibration & Optimization

### 2.1 Leverage Existing Analysis System

**File**: `src/services/ProjectionAnalysisService.ts` (already exists!)

The existing `ProjectionAnalysisService.runAnalysis()` method:
1. Runs projections for year N-1
2. Compares to actual stats in year N
3. Calculates MAE, RMSE, Bias

**We can reuse this infrastructure!**

### 2.2 Create Calibration Script

**New File**: `tools/calibrate_ensemble_weights.ts`

```typescript
import { projectionAnalysisService } from '../src/services/ProjectionAnalysisService';
import { projectionService } from '../src/services/ProjectionService';

/**
 * Grid Search for Optimal Ensemble Weights
 *
 * Tests different weight formulas against historical data to find
 * the parameters that minimize K/9 MAE without harming other stats.
 */

interface WeightParams {
  baseOptimistic: number;
  baseNeutral: number;
  basePessimistic: number;
  ageImpact: number;
  ipImpact: number;
  trendImpact: number;
  volatilityImpact: number;
}

async function calibrateWeights(
  startYear: number,
  endYear: number
): Promise<WeightParams> {

  console.log(`Calibrating ensemble weights using years ${startYear}-${endYear}...`);

  // Define search space
  const paramGrid = {
    baseOptimistic: [0.3, 0.4, 0.5],
    baseNeutral: [0.3, 0.4, 0.5],
    basePessimistic: [0.1, 0.2, 0.3],
    ageImpact: [0.1, 0.15, 0.2, 0.25],
    ipImpact: [0.15, 0.2, 0.25],
    trendImpact: [0.10, 0.15, 0.20],
    volatilityImpact: [0.3, 0.4, 0.5]
  };

  let bestParams: WeightParams | null = null;
  let bestK9Mae = Infinity;
  let bestOverallMetrics = null;

  // Grid search
  for (const baseOpt of paramGrid.baseOptimistic) {
    for (const baseNeut of paramGrid.baseNeutral) {
      for (const basePes of paramGrid.basePessimistic) {
        // Ensure base weights sum to 1.0
        if (Math.abs(baseOpt + baseNeut + basePes - 1.0) > 0.01) continue;

        for (const ageImp of paramGrid.ageImpact) {
          for (const ipImp of paramGrid.ipImpact) {
            for (const trendImp of paramGrid.trendImpact) {
              for (const volImp of paramGrid.volatilityImpact) {

                const params: WeightParams = {
                  baseOptimistic: baseOpt,
                  baseNeutral: baseNeut,
                  basePessimistic: basePes,
                  ageImpact: ageImp,
                  ipImpact: ipImp,
                  trendImpact: trendImp,
                  volatilityImpact: volImp
                };

                // Test this parameter set
                const metrics = await testWeightParams(params, startYear, endYear);

                // Check if this is the best so far
                if (metrics.k9.mae < bestK9Mae && meetsConstraints(metrics)) {
                  bestK9Mae = metrics.k9.mae;
                  bestParams = params;
                  bestOverallMetrics = metrics;

                  console.log(`New best K/9 MAE: ${bestK9Mae.toFixed(3)}`);
                  console.log(params);
                }
              }
            }
          }
        }
      }
    }
  }

  console.log('\n=== CALIBRATION COMPLETE ===');
  console.log('Best Parameters:', bestParams);
  console.log('Metrics:', bestOverallMetrics);

  return bestParams!;
}

async function testWeightParams(
  params: WeightParams,
  startYear: number,
  endYear: number
): Promise<any> {

  // Temporarily inject these params into EnsembleProjectionService
  // (You'd need to expose a setWeightParams() method)
  ensembleProjectionService.setWeightParams(params);

  // Run analysis with ensemble enabled
  const report = await projectionAnalysisService.runAnalysis(startYear, endYear);

  return report.overallMetrics;
}

function meetsConstraints(metrics: any): boolean {
  // Success criteria:
  // - K/9 MAE improves significantly
  // - Bias stays within ±0.10 (not too pessimistic)
  // - Other stats don't worsen by >0.03

  const k9Ok = metrics.k9.mae < 0.775; // Target
  const biasOk = Math.abs(metrics.k9.bias) < 0.10;
  const bb9Ok = metrics.bb9.mae < 0.72; // Don't harm (current 0.69 + 0.03)
  const hr9Ok = metrics.hr9.mae < 0.37; // Don't harm (current 0.34 + 0.03)
  const fipOk = metrics.fip.mae < 0.65; // Don't harm (current 0.606 + margin)

  return k9Ok && biasOk && bb9Ok && hr9Ok && fipOk;
}

// Run calibration
calibrateWeights(2015, 2020).then(params => {
  console.log('\n=== OPTIMIZED WEIGHT FORMULA ===');
  console.log('Update EnsembleProjectionService with these values:');
  console.log(JSON.stringify(params, null, 2));
});
```

### 2.3 Run Calibration

```bash
# Run grid search
npx tsx tools/calibrate_ensemble_weights.ts

# This will:
# 1. Try different weight parameter combinations
# 2. Run full projection analysis for each (2015-2020 → actuals)
# 3. Find the params that minimize K/9 MAE
# 4. Output optimized weight formula
```

### 2.4 Update Service with Calibrated Weights

After calibration, update `EnsembleProjectionService.calculateEnsembleWeights()` with the optimized parameters:

```typescript
// BEFORE CALIBRATION (initial guess)
let wOptimistic = 0.4;
let wNeutral = 0.4;
let wPessimistic = 0.2;

// AFTER CALIBRATION (replace with actual results)
let wOptimistic = 0.38; // Example calibrated value
let wNeutral = 0.45;
let wPessimistic = 0.17;
```

### 2.5 Validation Strategy

Use k-fold cross-validation to avoid overfitting:

```typescript
// Split years into train/test sets
const trainYears = [2015, 2016, 2017, 2018, 2019]; // Calibrate on these
const testYears = [2020, 2021];                    // Validate on these

// 1. Calibrate on train set
const params = await calibrateWeights(trainYears[0], trainYears[trainYears.length - 1]);

// 2. Test on held-out test set
const testMetrics = await testWeightParams(params, testYears[0], testYears[testYears.length - 1]);

// 3. Compare to baseline
console.log('Test Set Performance:');
console.log('K/9 MAE:', testMetrics.k9.mae, 'vs baseline 0.825');
console.log('K/9 Bias:', testMetrics.k9.bias, 'vs baseline +0.075');
```

---

## Phase 3: Analysis & Refinement

### 3.1 Stratified Analysis

After calibration, analyze performance by player segments:

```typescript
// File: tools/analyze_ensemble_by_segment.ts

const segments = {
  'young_declining': {
    ageMin: 20, ageMax: 25,
    trendMin: -Infinity, trendMax: -0.2, // K/9 declined >0.2
    minIP: 50
  },
  'young_improving': {
    ageMin: 20, ageMax: 25,
    trendMin: 0.2, trendMax: Infinity, // K/9 improved >0.2
    minIP: 50
  },
  'peak_stable': {
    ageMin: 25, ageMax: 30,
    trendMin: -0.2, trendMax: 0.2, // K/9 stable
    minIP: 100
  },
  'old_declining': {
    ageMin: 30, ageMax: 40,
    trendMin: -Infinity, trendMax: -0.2,
    minIP: 100
  },
  'low_ip_volatile': {
    ageMin: 20, ageMax: 40,
    maxIP: 80,
    volatilityMin: 0.15 // High CoV
  }
};

// For each segment, compare:
// - Current system MAE
// - Ensemble MAE
// - Improvement (% reduction)

// Goal: Ensemble should specifically help "young_declining" without hurting others
```

### 3.2 Outlier Analysis

Identify the biggest misses to understand remaining error:

```typescript
// Top 20 biggest errors (ensemble vs actual)
const outliers = report.years
  .flatMap(y => y.details)
  .map(d => ({
    ...d,
    k9Error: Math.abs(d.diff.k9)
  }))
  .sort((a, b) => b.k9Error - a.k9Error)
  .slice(0, 20);

// For each outlier, investigate:
// - Was it injury-related? (IP dropped significantly)
// - Was it a role change? (SP → RP or vice versa)
// - Was it park/defense? (team-wide anomaly)
// - Was it just random variance?

// This helps distinguish model error from unpredictable events
```

---

## Phase 4: Deployment

### 4.1 Feature Flag

```typescript
// Add to ProjectionService
interface ProjectionOptions {
  forceRosterRefresh?: boolean;
  useEnsemble?: boolean; // NEW: Default false initially
}

// In ProjectionsView, add toggle (development only)
if (isDevelopmentMode) {
  const ensembleToggle = document.createElement('input');
  ensembleToggle.type = 'checkbox';
  ensembleToggle.id = 'ensemble-toggle';
  ensembleToggle.addEventListener('change', (e) => {
    localStorage.setItem('wbl-use-ensemble', e.target.checked.toString());
    this.loadProjections();
  });
}
```

### 4.2 Gradual Rollout Plan

**Week 1**: Deploy with feature flag OFF
- Ensure no integration bugs
- Monitor performance (page load times)

**Week 2-3**: Enable for testing
- Toggle ON locally
- Compare projections side-by-side
- Verify "feels right"

**Month 2**: Make it default
- Change default to `useEnsemble: true`
- Keep flag for easy rollback

**After Next Season**: Final validation
- Compare ensemble accuracy vs current system on new actuals
- If successful: remove feature flag, make permanent

### 4.3 Documentation

Update `readme.md` with ensemble methodology:

```markdown
### Projection Methodology

Projections use a **multi-model ensemble** that blends three approaches:

1. **Optimistic Model**: Assumes typical aging curve development
2. **Neutral Model**: Conservative aging (20% of normal adjustment)
3. **Pessimistic Model**: Extrapolates recent performance trends (dampened)

**Dynamic Weights**: Models are weighted based on:
- **IP Confidence**: More IP → trust recent performance more
- **Age Factor**: Younger → expect more development
- **Trend Direction**: Declining → shift toward pessimistic model
- **Volatility**: High variance → favor neutral (don't overreact to noise)

This approach handles edge cases like declining young players and volatile small samples
better than single-model projections.

**Accuracy**: K/9 MAE ~0.75, Bias ±0.05 (calibrated on 2015-2020 historical data)
```

---

## Success Metrics

### Must-Have (Launch Blockers)
- ✅ K/9 MAE improves by ≥0.075 (from 0.825 to ≤0.75)
- ✅ K/9 Bias stays within ±0.10 (not overly pessimistic)
- ✅ FIP MAE does not worsen by >0.03
- ✅ BB/9 and HR/9 MAE do not worsen by >0.03
- ✅ All unit tests pass
- ✅ No performance regression (projections load in <2s)

### Nice-to-Have (Stretch Goals)
- 🎯 K/9 MAE under 0.75 (10% improvement)
- 🎯 Bias reduced to ±0.05 (perfectly balanced)
- 🎯 BB/9 and HR/9 MAE also improve (slight optimistic bias currently)

### Fail Conditions (Revert if True)
- ❌ K/9 MAE increases (gets worse)
- ❌ Bias swings below -0.15 (too pessimistic)
- ❌ Other stats worsen significantly
- ❌ Projections take >5s to load

---

## Implementation Checklist

### Phase 1: Core Implementation
- [ ] Create `EnsembleProjectionService.ts`
- [ ] Implement three model variants (optimistic, neutral, pessimistic)
- [ ] Implement confidence factor calculations (IP, age, trend, volatility)
- [ ] Implement initial weight formula (pre-calibration)
- [ ] Integrate with `ProjectionService` behind feature flag
- [ ] Write unit tests for ensemble logic
- [ ] Test on sample players (declining, improving, stable)

### Phase 2: Calibration
- [ ] Create `tools/calibrate_ensemble_weights.ts`
- [ ] Define parameter grid search space
- [ ] Implement constraint checking (success criteria)
- [ ] Run calibration on historical data (2015-2020)
- [ ] Update service with optimized weights
- [ ] Validate on held-out test set (2020-2021)
- [ ] Document calibrated parameters

### Phase 3: Analysis
- [ ] Run stratified analysis by player segment
- [ ] Identify outliers (biggest misses)
- [ ] Compare ensemble vs current system by age, team, year
- [ ] Verify we hit target metrics (K/9 MAE <0.75, Bias ±0.10)
- [ ] Generate performance report

### Phase 4: Deployment
- [ ] Add feature flag to ProjectionService
- [ ] Deploy with flag OFF (integration testing)
- [ ] Enable flag locally for comparison testing
- [ ] Make ensemble default if successful
- [ ] Update readme.md with methodology
- [ ] Wait for next season to validate on new actuals

---

## Risks & Mitigations

### Risk 1: Overfitting to Historical Data
**Problem**: Calibrated weights work great on 2015-2020, fail on future years.

**Mitigation**:
- Use train/test split (calibrate on 2015-2019, validate on 2020-2021)
- Keep weight formula simple (avoid too many parameters)
- Reserve most recent year as holdout test

### Risk 2: Ensemble is Too Conservative
**Problem**: Reducing optimism too much, under-projecting breakouts.

**Mitigation**:
- Strict bias monitoring (must stay > -0.10)
- Stratified analysis (ensure "improving player" accuracy doesn't worsen)
- Calibration constraints prevent overly pessimistic solutions

### Risk 3: Computational Complexity
**Problem**: Calculating 3 models for every player slows down projections.

**Mitigation**:
- Profile code, optimize hot paths
- The extra calculations are minimal (just 3× aging curve applications)
- Existing system already handles thousands of projections quickly

### Risk 4: No Improvement
**Problem**: After all this work, K/9 MAE doesn't actually improve.

**Mitigation**:
- Feature flag allows instant rollback
- Keep current system as fallback
- If calibration shows no improvement, abort before deployment

---

## Open Questions

### Q1: Should we ensemble BB/9 and HR/9 too?
**Answer**: Yes, for three reasons:
1. All three stats show slight optimistic bias (+0.07 to +0.09)
2. FIP is calculated from all three, so they need to be in sync
3. Consistent methodology is cleaner than mixing approaches

### Q2: How often should we re-calibrate?
**Recommendation**: Annually after each season, but only update weights if MAE improves by >0.03. This avoids chasing noise while adapting to long-term trends.

### Q3: What about minor league prospects (TFR)?
**Recommendation**: Keep TFR system unchanged for now. It already uses a different methodology (blending scouting + minor league stats). Tackle ensemble for MLB projections first, then revisit prospects if successful.

---

## Next Steps

1. **Implement Phase 1** (Core Infrastructure)
   - Create `EnsembleProjectionService.ts`
   - Write unit tests
   - Integrate with `ProjectionService`

2. **Run Phase 2** (Calibration)
   - Create calibration script
   - Grid search for optimal weights
   - Validate on test set

3. **Analyze Phase 3** (Results)
   - Compare to baseline
   - Stratified analysis
   - Verify success criteria met

4. **Deploy Phase 4** (Rollout)
   - Feature flag deployment
   - Testing period
   - Make default if successful

**Estimated Effort**: 3-4 focused sessions (assuming ~4-6 hours each)
- Session 1: Phase 1 (implementation)
- Session 2: Phase 2 (calibration + initial testing)
- Session 3: Phase 3 (analysis + refinement)
- Session 4: Phase 4 (deployment + documentation)

---

## Detailed Walkthrough Examples

### Example 1: Declining Young Player (The Motivating Case)

**Player Profile**:
- Name: John Doe
- Age: 24 → projecting 25
- Position: SP
- Recent History:
  - Age 22: 4.98 K/9 (86 IP)
  - Age 23: 5.30 K/9 (71 IP) ← Career high
  - Age 24: 4.84 K/9 (48 IP) ← Declined 8.7%

**Current System Projection**:
```
Weighted Avg:     5.04 K/9 (5:3:2 weights)
Regressed:        5.52 K/9 (toward league 7.5)
Current Stuff:    46.2
Aging +0.5:       46.7
Projected K/9:    5.56 K/9 ⚠️ Career high!
```

**Ensemble Calculation**:

**Step 1: Calculate Three Models**
```typescript
// Optimistic (current system)
projectedStuff = 46.2 + 0.5 = 46.7
optimisticK9 = 2.10 + 0.074 × 46.7 = 5.56 K/9

// Neutral (20% aging)
projectedStuff = 46.2 + (0.5 × 0.2) = 46.3
neutralK9 = 2.10 + 0.074 × 46.3 = 5.53 K/9

// Pessimistic (trend continuation)
recentTrend = 4.84 - 5.30 = -0.46 K/9
currentK9 = 2.10 + 0.074 × 46.2 = 5.52
pessimisticK9 = 5.52 + (-0.46 × 0.5) = 5.29 K/9
```

**Step 2: Calculate Confidence Factors**
```typescript
ipConfidence = 205 / 300 = 0.68
ageFactor = 0.5 (age 24)
trendDirection = 'declining'
trendMagnitude = -0.46
trendConfidence = (48/60) × (1 - 0.12) = 0.70
trendVolatility = 0.12 (low, fairly stable)
```

**Step 3: Calculate Weights**
```typescript
// Base weights
wOptimistic = 0.4
wNeutral = 0.4
wPessimistic = 0.2

// Age adjustment (still developing)
wOptimistic += 0.5 × 0.2 = +0.10 → 0.50
wNeutral -= 0.5 × 0.1 = -0.05 → 0.35
wPessimistic -= 0.5 × 0.1 = -0.05 → 0.15

// IP adjustment (moderate experience)
wOptimistic -= 0.68 × 0.2 = -0.14 → 0.36
wNeutral += 0.68 × 0.15 = +0.10 → 0.45
wPessimistic += 0.68 × 0.05 = +0.03 → 0.18

// Volatility adjustment (stable)
penalty = min(0.2, 0.12 × 0.5) = 0.06
wOptimistic -= 0.06 → 0.30
wNeutral += 0.06 → 0.51

// Trend adjustment (declining + high confidence)
wPessimistic += 0.15 → 0.33
wOptimistic -= 0.15 → 0.15

// Normalize (sum = 0.99)
wOptimistic = 0.15 / 0.99 = 0.15
wNeutral = 0.51 / 0.99 = 0.52
wPessimistic = 0.33 / 0.99 = 0.33
```

**Step 4: Blend Projections**
```typescript
ensembleK9 = (5.56 × 0.15) + (5.53 × 0.52) + (5.29 × 0.33)
           = 0.83 + 2.88 + 1.75
           = 5.46 K/9
```

**Result**:
- **Current System**: 5.56 K/9 (career high, unrealistic)
- **Ensemble**: 5.46 K/9 (still optimistic but more reasonable)
- **Improvement**: 0.10 K/9 reduction (closer to reality)

**Note**: After calibration, we expect weights to shift even more toward neutral/pessimistic for declining players, potentially getting closer to 5.30-5.35 range.

---

### Example 2: Improving Young Player

**Player Profile**:
- Age: 24 → projecting 25
- Recent History:
  - Age 22: 4.98 K/9 (86 IP)
  - Age 23: 4.84 K/9 (71 IP)
  - Age 24: 5.30 K/9 (48 IP) ← Improving trend

**Ensemble Calculation**:

**Models**:
- Optimistic: 5.56 K/9 (same as Example 1)
- Neutral: 5.53 K/9
- Pessimistic: 5.52 + (+0.46 × 0.5) = 5.75 K/9 (trend extrapolation)

**Confidence Factors**:
- IP: 0.68 (same)
- Age: 0.5 (same)
- Trend: +0.46, 'improving', confidence 0.70
- Volatility: 0.12 (same)

**Weights** (different from Example 1 due to improving trend):
```typescript
// After all adjustments...
// Trend boost to optimistic (improving)
wOptimistic += 0.10
wPessimistic -= 0.10

// Final weights (normalized):
wOptimistic = 0.48
wNeutral = 0.38
wPessimistic = 0.14
```

**Result**:
```typescript
ensembleK9 = (5.56 × 0.48) + (5.53 × 0.38) + (5.75 × 0.14)
           = 2.67 + 2.10 + 0.81
           = 5.58 K/9
```

**Comparison**:
- **Current System**: 5.57 K/9
- **Ensemble**: 5.58 K/9 (slightly higher!)
- **Why**: Improving trend gets rewarded, pessimistic model actually projects higher

This shows the ensemble is **directionally aware** - it treats improving and declining players differently.

---

### Example 3: Veteran with Small Sample

**Player Profile**:
- Age: 32 → projecting 33
- Recent History:
  - Age 32: 8.0 K/9 (30 IP, 2 GS) ← Tiny sample

**Ensemble Calculation**:

**Models**:
- Optimistic: Aging -1.5 Stuff → projects decline
- Neutral: Aging -0.3 Stuff → slight decline
- Pessimistic: No trend data (only 1 year) → defaults to neutral

**Confidence Factors**:
- IP: 30 / 300 = 0.10 (very low!)
- Age: 0.2 (old)
- Trend: 'stable' (no prior data)
- Volatility: 0.15 (default)

**Weights**:
```typescript
// Low IP + old age = heavy neutral weighting
wOptimistic = 0.20
wNeutral = 0.65 ← Dominates
wPessimistic = 0.15
```

**Result**: Ensemble heavily favors neutral model, avoiding overreaction to small sample 8.0 K/9.

---

### Example 4: Peak Player with Stable Performance

**Player Profile**:
- Age: 27 → projecting 28
- Recent History:
  - Age 25: 7.2 K/9 (180 IP)
  - Age 26: 7.4 K/9 (175 IP)
  - Age 27: 7.3 K/9 (182 IP) ← Very stable

**Ensemble Calculation**:

**Confidence Factors**:
- IP: 537 / 300 = 1.0 (maxed out)
- Age: 0.3 (peak plateau)
- Trend: 'stable' (±0.1 variance)
- Volatility: 0.02 (very low, highly stable)

**Weights**:
```typescript
// High IP + stable performance = trust neutral/pessimistic
wOptimistic = 0.25
wNeutral = 0.55
wPessimistic = 0.20
```

**Result**: Ensemble projects minimal change (maybe 7.2-7.3 K/9), avoiding both optimistic aging boost and pessimistic decline.

---

## Edge Cases & Special Handling

### Edge Case 1: No Historical Data (Rookies)

**Scenario**: Player with 0 IP in MLB, projecting from scouting/minor league data.

**Handling**:
```typescript
if (!yearlyStats || yearlyStats.length === 0) {
  // No trend data available
  // Default to optimistic model (trust development for young players)
  return {
    optimistic: 0.60,
    neutral: 0.30,
    pessimistic: 0.10
  };
}
```

**Rationale**: Without performance history, trust scouting and development projections.

---

### Edge Case 2: Extreme Volatility (Reliever Role Changes)

**Scenario**: Player with K/9 of [9.5, 5.2, 8.8] in last 3 years (RP → SP → RP).

**Handling**:
```typescript
if (trendVolatility > 0.25) {
  // High volatility = don't trust trends
  // Heavy neutral weighting
  const volatilityPenalty = Math.min(0.3, (trendVolatility - 0.15) * 2);
  wNeutral += volatilityPenalty;
  wOptimistic -= volatilityPenalty * 0.5;
  wPessimistic -= volatilityPenalty * 0.5;
}
```

**Result**: For CoV > 0.25, neutral weight increases by up to 0.30, dampening both optimistic and pessimistic extremes.

---

### Edge Case 3: Injury-Shortened Season

**Scenario**: Player with [180 IP, 175 IP, 40 IP] but maintained same K/9.

**Detection**:
```typescript
const ipDropRatio = recentIP / avgHistoricalIP;
if (ipDropRatio < 0.5 && Math.abs(k9Trend) < 0.3) {
  // IP dropped significantly but performance stable
  // Treat as injury, ignore trend
  trendFactor.confidence *= 0.5;
}
```

**Result**: Reduces confidence in "decline" signal if it's IP-driven rather than skill-driven.

---

### Edge Case 4: Breakout Season (Mechanical Change?)

**Scenario**: Player with [5.0, 5.2, 7.5] K/9 - huge age 26 jump.

**Handling**:
```typescript
if (recentChange > 1.5 && age < 30) {
  // Potential breakout
  // Don't fully extrapolate (could be outlier)
  // But give some credit via pessimistic model
  dampening = 0.3; // Instead of 0.5
}
```

**Result**: Dampening at 30% allows some trend continuation without overcommitting to a single-season spike.

---

### Edge Case 5: Age Cliff (40+ year olds)

**Scenario**: 41-year-old pitcher still performing well.

**Handling**:
```typescript
if (age >= 40) {
  // Survival bias: if still pitching, likely above replacement
  // But expect sharp decline soon
  wOptimistic = 0.10; // Minimal
  wNeutral = 0.40;
  wPessimistic = 0.50; // Expect decline
}
```

**Result**: Heavily pessimistic weights for elderly pitchers, reflecting high attrition risk.

---

## Performance Considerations

### Computational Complexity

**Current System**:
```typescript
// For each player (N ≈ 500-1000):
1. Calculate weighted average rates (O(1))
2. Regress to league mean (O(1))
3. Apply aging curve (O(1))
4. Convert to stats (O(1))

Total: O(N) ≈ 500-1000 operations
```

**Ensemble System**:
```typescript
// For each player:
1. Calculate weighted average rates (O(1))
2. Regress to league mean (O(1))
3. Calculate THREE aging variants (O(1) × 3)
4. Calculate confidence factors (O(1))
5. Calculate weights (O(1))
6. Blend results (O(1))

Total: O(N) × 3 ≈ 1500-3000 operations
```

**Impact**: 3× more work per player, but still O(N). With N=1000, expect ~10-20ms increase in total projection time (negligible).

**Bottleneck**: The actual bottleneck is API calls to fetch historical stats, not calculations. Ensemble math is trivial compared to network I/O.

---

### Memory Usage

**Additional Memory**:
- Store 3 model outputs per player: ~24 bytes × 3 = 72 bytes
- Store weights: 24 bytes
- Store metadata: ~50 bytes

**Total per player**: ~150 bytes

**For 1000 players**: 150 KB (negligible)

---

### Caching Strategy

```typescript
// Cache confidence factors if recalculating projections
private confidenceCache = new Map<number, {
  ipConfidence: number;
  ageFactor: number;
  trendFactor: any;
  trendVolatility: number;
}>();

calculateEnsemble(input: EnsembleInput): EnsembleProjection {
  const cached = this.confidenceCache.get(input.playerId);
  if (cached && !input.forceRecalc) {
    // Skip confidence calculations
    return this.blendWithCachedFactors(input, cached);
  }
  // ... normal calculation
}
```

**Benefit**: If re-projecting with different league contexts (FIP constant changes), can skip confidence recalc.

---

## Testing Strategy

### Unit Tests (tests/ensemble_projection_test.ts)

#### Test Suite 1: Model Outputs
```typescript
describe('Model Calculations', () => {
  test('optimistic model applies full aging curve', () => {
    const result = service.calculateOptimisticModel(
      { stuff: 50, control: 50, hra: 50 },
      24,
      leagueContext
    );
    // Should apply +0.5 aging for age 24
    expect(result.k9).toBeCloseTo(
      PotentialStatsService.calculateK9(50.5),
      2
    );
  });

  test('neutral model applies 20% aging', () => {
    const result = service.calculateNeutralModel(
      { stuff: 50, control: 50, hra: 50 },
      24,
      leagueContext
    );
    // Should apply +0.1 aging (20% of +0.5)
    expect(result.k9).toBeCloseTo(
      PotentialStatsService.calculateK9(50.1),
      2
    );
  });

  test('pessimistic model extrapolates trend', () => {
    const result = service.calculatePessimisticModel(
      { stuff: 50, control: 50, hra: 50 },
      24,
      [
        { year: 2024, ip: 50, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 10 },
        { year: 2023, ip: 60, k9: 7.0, bb9: 3.0, hr9: 1.0, gs: 12 }
      ],
      leagueContext
    );
    // Trend: -1.0 K/9, dampened 50% = -0.5
    // Current: 6.0, projected: 5.5
    expect(result.k9).toBeCloseTo(5.5, 1);
  });
});
```

#### Test Suite 2: Confidence Factors
```typescript
describe('Confidence Calculations', () => {
  test('IP confidence scales linearly to 300 IP', () => {
    expect(service.calculateIpConfidence(0)).toBe(0.0);
    expect(service.calculateIpConfidence(150)).toBe(0.5);
    expect(service.calculateIpConfidence(300)).toBe(1.0);
    expect(service.calculateIpConfidence(600)).toBe(1.0); // Capped
  });

  test('age factor decreases with age', () => {
    expect(service.calculateAgeFactor(22)).toBe(0.7);
    expect(service.calculateAgeFactor(24)).toBe(0.5);
    expect(service.calculateAgeFactor(27)).toBe(0.3);
    expect(service.calculateAgeFactor(32)).toBe(0.2);
  });

  test('trend detection identifies direction', () => {
    const declining = service.calculateTrendFactor([
      { year: 2024, ip: 60, k9: 5.0, bb9: 3.0, hr9: 1.0, gs: 12 },
      { year: 2023, ip: 60, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 12 }
    ]);
    expect(declining.direction).toBe('declining');
    expect(declining.magnitude).toBe(-1.0);

    const improving = service.calculateTrendFactor([
      { year: 2024, ip: 60, k9: 6.0, bb9: 3.0, hr9: 1.0, gs: 12 },
      { year: 2023, ip: 60, k9: 5.0, bb9: 3.0, hr9: 1.0, gs: 12 }
    ]);
    expect(improving.direction).toBe('improving');
  });

  test('volatility measures coefficient of variation', () => {
    const stable = service.calculateTrendVolatility([
      { year: 2024, ip: 60, k9: 7.0, bb9: 3.0, hr9: 1.0, gs: 12 },
      { year: 2023, ip: 60, k9: 7.1, bb9: 3.0, hr9: 1.0, gs: 12 },
      { year: 2022, ip: 60, k9: 6.9, bb9: 3.0, hr9: 1.0, gs: 12 }
    ]);
    expect(stable).toBeLessThan(0.05); // Very stable

    const volatile = service.calculateTrendVolatility([
      { year: 2024, ip: 60, k9: 9.0, bb9: 3.0, hr9: 1.0, gs: 12 },
      { year: 2023, ip: 60, k9: 5.0, bb9: 3.0, hr9: 1.0, gs: 12 },
      { year: 2022, ip: 60, k9: 8.0, bb9: 3.0, hr9: 1.0, gs: 12 }
    ]);
    expect(volatile).toBeGreaterThan(0.20); // Highly volatile
  });
});
```

#### Test Suite 3: Weight Calculations
```typescript
describe('Weight Calculations', () => {
  test('weights sum to 1.0', () => {
    const weights = service.calculateEnsembleWeights(0.5, 0.5, 0.1, {
      direction: 'stable',
      magnitude: 0,
      confidence: 0.5
    });
    const sum = weights.optimistic + weights.neutral + weights.pessimistic;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  test('declining trend increases pessimistic weight', () => {
    const declining = service.calculateEnsembleWeights(0.7, 0.5, 0.1, {
      direction: 'declining',
      magnitude: -0.5,
      confidence: 0.8
    });
    const stable = service.calculateEnsembleWeights(0.7, 0.5, 0.1, {
      direction: 'stable',
      magnitude: 0,
      confidence: 0.8
    });
    expect(declining.pessimistic).toBeGreaterThan(stable.pessimistic);
    expect(declining.optimistic).toBeLessThan(stable.optimistic);
  });

  test('young age increases optimistic weight', () => {
    const young = service.calculateEnsembleWeights(0.5, 0.7, 0.1, {
      direction: 'stable',
      magnitude: 0,
      confidence: 0.5
    });
    const old = service.calculateEnsembleWeights(0.5, 0.1, 0.1, {
      direction: 'stable',
      magnitude: 0,
      confidence: 0.5
    });
    expect(young.optimistic).toBeGreaterThan(old.optimistic);
  });

  test('high IP increases neutral/pessimistic weight', () => {
    const highIP = service.calculateEnsembleWeights(0.9, 0.5, 0.1, {
      direction: 'stable',
      magnitude: 0,
      confidence: 0.5
    });
    const lowIP = service.calculateEnsembleWeights(0.1, 0.5, 0.1, {
      direction: 'stable',
      magnitude: 0,
      confidence: 0.5
    });
    expect(highIP.optimistic).toBeLessThan(lowIP.optimistic);
    expect(highIP.neutral).toBeGreaterThan(lowIP.neutral);
  });
});
```

#### Test Suite 4: Integration Tests
```typescript
describe('End-to-End Ensemble', () => {
  test('declining young player gets conservative projection', () => {
    // Full test from example 1
  });

  test('improving young player maintains optimism', () => {
    // Full test from example 2
  });

  test('veteran with small sample favors neutral', () => {
    // Full test from example 3
  });

  test('stable peak player projects minimal change', () => {
    // Full test from example 4
  });
});
```

---

### Integration Tests (with ProjectionService)

```typescript
describe('Ensemble Integration with ProjectionService', () => {
  test('feature flag toggles between ensemble and current', async () => {
    const current = await projectionService.getProjections(2020, {
      useEnsemble: false
    });
    const ensemble = await projectionService.getProjections(2020, {
      useEnsemble: true
    });

    // Should have same players
    expect(ensemble.length).toBe(current.length);

    // Should have different projections (at least for some)
    const differences = ensemble.filter((e, i) =>
      Math.abs(e.projectedStats.k9 - current[i].projectedStats.k9) > 0.05
    );
    expect(differences.length).toBeGreaterThan(0);
  });

  test('ensemble projections pass sanity checks', async () => {
    const projections = await projectionService.getProjections(2020, {
      useEnsemble: true
    });

    projections.forEach(p => {
      // K/9 should be reasonable (1.0 to 15.0)
      expect(p.projectedStats.k9).toBeGreaterThan(1.0);
      expect(p.projectedStats.k9).toBeLessThan(15.0);

      // BB/9 should be reasonable (0.5 to 8.0)
      expect(p.projectedStats.bb9).toBeGreaterThan(0.5);
      expect(p.projectedStats.bb9).toBeLessThan(8.0);

      // FIP should be reasonable (1.0 to 8.0)
      expect(p.projectedStats.fip).toBeGreaterThan(1.0);
      expect(p.projectedStats.fip).toBeLessThan(8.0);
    });
  });
});
```

---

## Debugging & Troubleshooting Guide

### Debug Mode

Add verbose logging for troubleshooting:

```typescript
const DEBUG_ENSEMBLE = false; // Toggle in development

calculateEnsemble(input: EnsembleInput): EnsembleProjection {
  if (DEBUG_ENSEMBLE) {
    console.group(`Ensemble for ${input.playerId}`);
  }

  const optimistic = this.calculateOptimisticModel(...);
  if (DEBUG_ENSEMBLE) {
    console.log('Optimistic K/9:', optimistic.k9);
  }

  const neutral = this.calculateNeutralModel(...);
  if (DEBUG_ENSEMBLE) {
    console.log('Neutral K/9:', neutral.k9);
  }

  const pessimistic = this.calculatePessimisticModel(...);
  if (DEBUG_ENSEMBLE) {
    console.log('Pessimistic K/9:', pessimistic.k9);
  }

  const weights = this.calculateEnsembleWeights(...);
  if (DEBUG_ENSEMBLE) {
    console.log('Weights:', weights);
    console.log('Final K/9:', blendedK9);
    console.groupEnd();
  }

  return result;
}
```

---

### Common Issues

#### Issue 1: Ensemble projections identical to current system

**Symptom**: All projections match current system exactly.

**Diagnosis**:
```typescript
// Check if feature flag is actually being used
console.log('useEnsemble:', options?.useEnsemble);

// Check if weights are all going to optimistic
console.log('Weights:', weights);
```

**Fix**: Verify feature flag is passed through, check weight calculation logic.

---

#### Issue 2: Projections seem too pessimistic

**Symptom**: Average K/9 projection drops significantly, bias goes negative.

**Diagnosis**:
```typescript
// Run analysis on a sample
const analysis = await projectionAnalysisService.runAnalysis(2020, 2020);
console.log('Bias:', analysis.overallMetrics.k9.bias);

// Check weight distribution
const avgWeights = {
  optimistic: projections.reduce((sum, p) => sum + p.weights.optimistic, 0) / projections.length,
  neutral: ...,
  pessimistic: ...
};
console.log('Average weights:', avgWeights);
```

**Fix**: If pessimistic weight is too high (>0.4), recalibrate weight formula parameters.

---

#### Issue 3: NaN or Infinity projections

**Symptom**: Some projections return NaN or Infinity.

**Diagnosis**:
```typescript
// Check for division by zero
if (trendVolatility calculation) {
  if (mean === 0) return 0.15; // Default
}

// Check for invalid inputs
if (!Number.isFinite(blendedK9)) {
  console.error('Invalid K/9:', { optimistic, neutral, pessimistic, weights });
}
```

**Fix**: Add guards for edge cases (zero means, missing data, etc.).

---

## Future Enhancements (V2)

### Enhancement 1: Bayesian Uncertainty Quantification

Instead of single-point projections, output confidence intervals:

```typescript
interface EnsembleProjectionV2 {
  k9: number;
  k9_lower: number; // 10th percentile
  k9_upper: number; // 90th percentile
  k9_std: number;   // Standard deviation
}
```

**Calculation**:
```typescript
// Treat models as samples from a distribution
const k9Samples = [
  optimistic.k9,
  neutral.k9,
  pessimistic.k9
];

// Weight samples
const weightedSamples = [
  ...Array(Math.round(weights.optimistic * 100)).fill(optimistic.k9),
  ...Array(Math.round(weights.neutral * 100)).fill(neutral.k9),
  ...Array(Math.round(weights.pessimistic * 100)).fill(pessimistic.k9)
];

// Calculate percentiles
k9_lower = percentile(weightedSamples, 10);
k9_upper = percentile(weightedSamples, 90);
```

**UI Display**:
```
Projected K/9: 5.5 (range: 5.0-6.0)
Confidence: ████████░░ 80%
```

---

### Enhancement 2: Machine Learning Weight Optimization

Instead of grid search, use ML to learn optimal weights:

```typescript
// Train a neural network to predict optimal weights
// Input features:
// - IP confidence
// - Age factor
// - Trend direction
// - Trend magnitude
// - Volatility
// - Recent K/9, BB/9, HR/9

// Output: weights (3 values summing to 1)

// Loss function: Weighted MAE + Bias penalty
loss = alpha * MAE(predicted, actual) + beta * abs(Bias(predicted, actual))
```

**Benefits**:
- Discover non-linear relationships
- Handle feature interactions automatically
- Continuously improve with new data

**Risks**:
- Overfitting
- Black-box (less interpretable)
- Requires more historical data

---

### Enhancement 3: Context-Aware Models

Add more sophisticated pessimistic model:

```typescript
// Instead of simple trend extrapolation, use:
// - Injury history (if available)
// - Team context (park factors, defense)
// - Opponent-adjusted stats
// - Pitch usage patterns (if fastball velocity declining)

class AdvancedPessimisticModel {
  calculateProjection(input: {
    player: Player;
    injuryHistory: Injury[];
    parkFactors: ParkFactors;
    pitchData: PitchUsage[];
  }): { k9: number; bb9: number; hr9: number } {
    // More nuanced decline modeling
  }
}
```

---

### Enhancement 4: Adaptive Dampening

Instead of fixed 50% dampening for trend continuation, make it dynamic:

```typescript
// More confidence in trend = less dampening
const dampening = 1.0 - trendFactor.confidence;

// Strong trend (high confidence) → 70% continuation
// Weak trend (low confidence) → 30% continuation
```

---

## Comparison Tables

### Scenario Comparison: Current vs Ensemble

| Player Type | Current Proj | Ensemble Proj | Improvement | Notes |
|-------------|--------------|---------------|-------------|-------|
| Declining Young (24yo, 5.30→4.84) | 5.56 K/9 | 5.46 K/9 | -0.10 | More realistic |
| Improving Young (24yo, 4.84→5.30) | 5.57 K/9 | 5.58 K/9 | +0.01 | Maintains optimism |
| Stable Peak (27yo, 7.2-7.4) | 7.35 K/9 | 7.30 K/9 | -0.05 | Avoids overaging |
| Volatile Veteran (32yo, 30 IP) | 7.80 K/9 | 7.20 K/9 | -0.60 | Regresses to talent |
| Rookie (no history) | 6.50 K/9 | 6.50 K/9 | 0.00 | Same (no data) |

---

### Weight Distribution by Player Segment (Expected)

| Segment | Optimistic | Neutral | Pessimistic | Rationale |
|---------|------------|---------|-------------|-----------|
| Young Declining | 15% | 52% | 33% | Trust recent downturn |
| Young Improving | 48% | 38% | 14% | Trust development + trend |
| Peak Stable | 25% | 55% | 20% | Conservative, proven talent |
| Old Declining | 10% | 40% | 50% | Expect continued decline |
| High Volatility | 20% | 65% | 15% | Don't trust extremes |

---

## Appendix: Mathematical Formulas

### Weighted Average (Multi-Year)

```
weightedK9 = (K9_recent × IP_recent × 5 + K9_prev × IP_prev × 3 + K9_old × IP_old × 2) /
             (IP_recent × 5 + IP_prev × 3 + IP_old × 2)
```

### Regression to Mean

```
regressedK9 = (weightedK9 × totalIP + leagueAvgK9 × K) / (totalIP + K)

where K = stabilization constant (50 for K/9)
```

### Coefficient of Variation (Volatility)

```
mean = (K9_1 + K9_2 + K9_3) / 3
stdDev = sqrt(((K9_1 - mean)² + (K9_2 - mean)² + (K9_3 - mean)²) / 3)
CoV = stdDev / mean
```

### Trend Confidence

```
trendConfidence = (recentIP / 60) × (1 - volatility)

clamped to [0, 1]
```

### Weight Normalization

```
sum = w_opt + w_neut + w_pess

w_opt_final = w_opt / sum
w_neut_final = w_neut / sum
w_pess_final = w_pess / sum
```

### Ensemble Blend

```
ensembleK9 = w_opt × optimisticK9 + w_neut × neutralK9 + w_pess × pessimisticK9
```

---

## References & Related Work

### Similar Approaches in Baseball

1. **PECOTA (Baseball Prospectus)**:
   - Uses comparable player method
   - Generates percentile forecasts (10th, 50th, 90th)
   - Our ensemble is simpler but more transparent

2. **Steamer / ZiPS**:
   - Weighted average of recent performance + regression
   - Our neutral model is similar
   - We add optimistic/pessimistic variants

3. **Marcel the Monkey**:
   - Simple 5/4/3 weighting scheme
   - Heavy regression to mean
   - Our baseline (current system) is essentially Marcel + aging

### Academic Literature

- **Bayesian Model Averaging**: Similar concept to our ensemble
- **Bootstrap Aggregating (Bagging)**: Train multiple models on resampled data
- **Ensemble Learning (Stacking)**: Learn optimal weights via meta-model

Our approach is closest to **model averaging with dynamic weights**.

---

## Changelog

### Version 1.0 (Initial Plan)
- Defined three-model ensemble architecture
- Specified confidence factors and weight formula
- Outlined calibration strategy
- Documented testing approach

### Future Versions
- v1.1: Add calibration results and optimized weights
- v1.2: Document actual performance improvements
- v2.0: Add confidence intervals and advanced features

---

---

## Notes for Future Implementation Sessions

### Context from Original Discussion (Jan 2025)

**User's Priorities**:
- No shipping urgency - take time to get it right
- Current system is already quite good (0.606 FIP MAE overall)
- K/9 is the weakest component (0.825 MAE) - main focus
- Want to ensemble all 3 stats (K/9, BB/9, HR/9) for consistency
- Willing to run full historical validation to optimize weights

**Key Decisions Made**:
1. ✅ Use Option 3 (Multi-Model Ensemble) over simpler approaches
2. ✅ Ensemble all three rate stats (not just K/9)
3. ✅ Leverage existing ProjectionAnalysisService for validation
4. ✅ Use grid search for weight calibration (not ML initially)
5. ✅ Deploy behind feature flag for easy rollback

**Historical Data Available**:
- System can run projections on any historical year
- ProjectionAnalysisService compares projections to actuals
- Example: Project 2019 (using 2018 stats) → compare to actual 2020 performance
- Full validation set: 2015-2020 → actuals (4658 player-seasons)

**Test Case to Validate Against**:
```
Player: 25yo pitcher
History: 4.98 K/9 (age 22), 5.30 K/9 (age 23), 4.84 K/9 (age 24)
Current System: Projects 5.56 K/9 (career high!)
Target: Project ~5.30-5.35 K/9 (more realistic given decline)
```

### Implementation Tips

**Start Simple**:
- Get the three models working first (don't worry about perfect weights)
- Verify optimistic model exactly matches current system
- Use dummy weights initially (0.4, 0.4, 0.2)
- Get integration working before optimizing

**Calibration Strategy**:
- Start with 2-3 year subset (2018-2020) for fast iteration
- Once promising, run full 2015-2020 calibration
- Reserve 2021 as final holdout test (if available)
- Grid search should take ~10-30 minutes to run

**Common Pitfalls**:
- Don't over-penalize young players (bias monitoring crucial)
- Ensure trend detection handles missing data gracefully
- Watch for division by zero in volatility calculation
- Test edge cases: rookies, relievers, 40+ year olds

### File Structure Reminder

```
src/
  services/
    EnsembleProjectionService.ts  ← NEW (main implementation)
    ProjectionService.ts           ← MODIFY (add feature flag)
    AgingService.ts                ← READ ONLY (use as-is)
    PotentialStatsService.ts       ← READ ONLY (formulas)
    ProjectionAnalysisService.ts   ← USE (for validation)
    TrueRatingsCalculationService.ts ← REFERENCE (regression logic)

tools/
  calibrate_ensemble_weights.ts   ← NEW (grid search)
  analyze_ensemble_by_segment.ts  ← OPTIONAL (stratified analysis)

tests/
  ensemble_projection_test.ts     ← NEW (unit tests)
  projection_trajectory_test.ts   ← EXISTS (shows current problem)
```

### Debugging Checklist

If ensemble isn't improving accuracy:

1. **Check model outputs differ**: Print all three model K/9 for same player - should diverge
2. **Check weights make sense**: Declining 24yo should have ~15-30% optimistic, ~50% neutral, ~20-35% pessimistic
3. **Check integration**: Verify `useEnsemble: true` flag actually triggers new code path
4. **Check calibration ran**: Ensure grid search explored parameter space fully
5. **Check success criteria**: MAE, RMSE, Bias all within targets

### Final Sanity Check Before Deployment

Run these commands:
```bash
# 1. Unit tests pass
npm test ensemble_projection_test.ts

# 2. Integration test passes
npx tsx tests/projection_trajectory_test.ts

# 3. Full validation (this takes a few minutes)
# In browser: Go to Projections tab → Analysis mode → Run 2015-2020
# Check: K/9 MAE < 0.75, Bias within ±0.10

# 4. Spot check projections
# In browser: Toggle ensemble on/off, compare 10-20 players manually
```

---

**End of Implementation Plan**

**Status**: Ready for Phase 1 implementation
**Last Updated**: January 2026
**Next Step**: Create `src/services/EnsembleProjectionService.ts` and begin implementation checklist
