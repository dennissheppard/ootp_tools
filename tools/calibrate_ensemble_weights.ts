/**
 * Grid Search Calibration for Ensemble Projection Weights
 *
 * This script finds optimal weight parameters by testing combinations
 * against historical data (2015-2020 → actuals).
 *
 * Success Criteria:
 * - K/9 MAE < 0.75 (from 0.825 baseline)
 * - K/9 Bias within ±0.10
 * - FIP MAE ≤ 0.65 (don't harm overall)
 * - BB/9 MAE ≤ 0.72
 * - HR/9 MAE ≤ 0.37
 */

// Mock localStorage for Node.js environment
const storage = new Map<string, string>();
(global as any).localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear()
};

// Configure API base URL for Node.js environment
// In browser, Vite proxy handles /api → https://atl-01.statsplus.net/world/api
// In Node.js, we need to rewrite relative URLs to absolute URLs
const API_BASE_URL = 'https://atl-01.statsplus.net/world';
const originalFetch = global.fetch;
global.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let url: string;
  if (typeof input === 'string') {
    url = input;
  } else if (input instanceof URL) {
    url = input.toString();
  } else {
    url = input.url;
  }

  // Rewrite /api paths to full URLs
  if (url.startsWith('/api')) {
    url = API_BASE_URL + url;
  }

  return originalFetch(url, init);
} as typeof fetch;

import { projectionAnalysisService, StatMetrics } from '../src/services/ProjectionAnalysisService';
import { ensembleProjectionService, WeightParams } from '../src/services/EnsembleProjectionService';
import { projectionService } from '../src/services/ProjectionService';

// Enable ensemble mode globally for calibration
const ORIGINAL_GET_PROJECTIONS = projectionService.getProjectionsWithContext.bind(projectionService);

// Monkey-patch to force ensemble mode
(projectionService as any).getProjectionsWithContext = async function(year: number, options?: any) {
  return ORIGINAL_GET_PROJECTIONS(year, { ...options, useEnsemble: true });
};

/**
 * Success criteria thresholds
 */
const SUCCESS_CRITERIA = {
  k9Mae: 0.75,      // Target: < 0.75 (baseline 0.825)
  k9BiasMax: 0.10,  // Target: ±0.10
  fipMae: 0.65,     // Target: ≤ 0.65 (baseline 0.606, allow margin)
  bb9Mae: 0.72,     // Target: ≤ 0.72 (baseline 0.69 + margin)
  hr9Mae: 0.37      // Target: ≤ 0.37 (baseline 0.34 + margin)
};

/**
 * Parameter grid for search (FOCUSED - Run 3)
 * Narrowing in on best performers from Run 2, pushing trendImpact higher
 * Estimated combinations: ~1,800 valid (after base weight filtering)
 */
const PARAM_GRID = {
  baseOptimistic: [0.30, 0.35, 0.40],                       // Tight around 0.35
  baseNeutral: [0.50, 0.55, 0.60],                          // Tight around 0.55
  basePessimistic: [0.05, 0.10, 0.15],                      // Test lower (enhanced model needs less)
  ageImpact: [0.30, 0.35, 0.40],                            // Around best (0.35)
  ipImpact: [0.30, 0.35, 0.40],                             // Around best (0.35)
  trendImpact: [0.35, 0.40, 0.45, 0.50, 0.55],              // PUSH HIGHER (was 0.40)
  volatilityImpact: [0.75, 0.80, 0.85]                      // Keep high (was 0.80)
};

interface CalibrationResult {
  params: WeightParams;
  metrics: StatMetrics;
  score: number; // Lower is better
  meetsAllCriteria: boolean;
}

/**
 * Test a specific parameter combination
 */
async function testParams(params: WeightParams, startYear: number, endYear: number): Promise<CalibrationResult> {
  // Set ensemble parameters
  ensembleProjectionService.setWeightParams(params);

  // Run analysis
  const report = await projectionAnalysisService.runAnalysis(
    startYear,
    endYear,
    (year) => process.stdout.write('.')
  );

  const metrics = report.overallMetrics;

  // Check success criteria
  const meetsAllCriteria = (
    metrics.k9.mae < SUCCESS_CRITERIA.k9Mae &&
    Math.abs(metrics.k9.bias) < SUCCESS_CRITERIA.k9BiasMax &&
    metrics.fip.mae <= SUCCESS_CRITERIA.fipMae &&
    metrics.bb9.mae <= SUCCESS_CRITERIA.bb9Mae &&
    metrics.hr9.mae <= SUCCESS_CRITERIA.hr9Mae
  );

  // Calculate composite score (weighted by importance)
  // Primary: K/9 MAE (60% weight)
  // Secondary: Bias balance (20% weight)
  // Tertiary: Don't harm other stats (20% weight)
  const score =
    (metrics.k9.mae * 0.60) +
    (Math.abs(metrics.k9.bias) * 0.20) +
    (metrics.fip.mae * 0.10) +
    (metrics.bb9.mae * 0.05) +
    (metrics.hr9.mae * 0.05);

  return {
    params,
    metrics,
    score,
    meetsAllCriteria
  };
}

/**
 * Check if parameters are valid (base weights should sum to ~1.0)
 */
function isValidParams(params: WeightParams): boolean {
  const baseSum = params.baseOptimistic + params.baseNeutral + params.basePessimistic;
  return Math.abs(baseSum - 1.0) < 0.05; // Allow 5% tolerance
}

/**
 * Main calibration function
 */
async function calibrateWeights(startYear: number, endYear: number): Promise<CalibrationResult | null> {
  console.log('='.repeat(80));
  console.log('ENSEMBLE WEIGHT CALIBRATION');
  console.log('='.repeat(80));
  console.log(`\nCalibrating on years ${startYear}-${endYear}`);
  console.log('\nParameter Grid:');
  console.log(`  Base Optimistic:  [${PARAM_GRID.baseOptimistic.join(', ')}]`);
  console.log(`  Base Neutral:     [${PARAM_GRID.baseNeutral.join(', ')}]`);
  console.log(`  Base Pessimistic: [${PARAM_GRID.basePessimistic.join(', ')}]`);
  console.log(`  Age Impact:       [${PARAM_GRID.ageImpact.join(', ')}]`);
  console.log(`  IP Impact:        [${PARAM_GRID.ipImpact.join(', ')}]`);
  console.log(`  Trend Impact:     [${PARAM_GRID.trendImpact.join(', ')}]`);
  console.log(`  Volatility Impact:[${PARAM_GRID.volatilityImpact.join(', ')}]`);

  // Calculate total combinations
  const totalCombos =
    PARAM_GRID.baseOptimistic.length *
    PARAM_GRID.baseNeutral.length *
    PARAM_GRID.basePessimistic.length *
    PARAM_GRID.ageImpact.length *
    PARAM_GRID.ipImpact.length *
    PARAM_GRID.trendImpact.length *
    PARAM_GRID.volatilityImpact.length;

  console.log(`\nTotal combinations to test: ${totalCombos}`);
  console.log(`Estimated time: ${Math.ceil(totalCombos * 0.5)} seconds\n`);

  console.log('Success Criteria:');
  console.log(`  K/9 MAE:  < ${SUCCESS_CRITERIA.k9Mae}`);
  console.log(`  K/9 Bias: ± ${SUCCESS_CRITERIA.k9BiasMax}`);
  console.log(`  FIP MAE:  ≤ ${SUCCESS_CRITERIA.fipMae}`);
  console.log(`  BB/9 MAE: ≤ ${SUCCESS_CRITERIA.bb9Mae}`);
  console.log(`  HR/9 MAE: ≤ ${SUCCESS_CRITERIA.hr9Mae}`);
  console.log();

  let bestResult: CalibrationResult | null = null;
  let bestScore = Infinity;
  let testedCount = 0;
  let validCount = 0;
  let meetsCriteriaCount = 0;

  // Grid search
  console.log('Starting grid search...\n');
  const startTime = Date.now();
  let lastProgressUpdate = Date.now();

  for (const baseOpt of PARAM_GRID.baseOptimistic) {
    for (const baseNeut of PARAM_GRID.baseNeutral) {
      for (const basePes of PARAM_GRID.basePessimistic) {
        const params: WeightParams = {
          baseOptimistic: baseOpt,
          baseNeutral: baseNeut,
          basePessimistic: basePes,
          ageImpact: 0,
          ipImpact: 0,
          trendImpact: 0,
          volatilityImpact: 0
        };

        // Skip invalid base weight combinations
        if (!isValidParams(params)) continue;

        for (const ageImp of PARAM_GRID.ageImpact) {
          for (const ipImp of PARAM_GRID.ipImpact) {
            for (const trendImp of PARAM_GRID.trendImpact) {
              for (const volImp of PARAM_GRID.volatilityImpact) {
                params.ageImpact = ageImp;
                params.ipImpact = ipImp;
                params.trendImpact = trendImp;
                params.volatilityImpact = volImp;

                testedCount++;
                validCount++;

                // Progress indicator every 2 seconds
                const now = Date.now();
                if (now - lastProgressUpdate > 2000) {
                  const elapsed = ((now - startTime) / 1000).toFixed(1);
                  const rate = testedCount / (now - startTime) * 1000;
                  const remaining = Math.ceil((totalCombos - testedCount) / rate);
                  process.stdout.write(`\rTested: ${testedCount}/${totalCombos} (${(testedCount/totalCombos*100).toFixed(1)}%) | Elapsed: ${elapsed}s | ETA: ${remaining}s | Best MAE: ${bestResult?.metrics.k9.mae.toFixed(3) ?? 'N/A'}     `);
                  lastProgressUpdate = now;
                }

                try {
                  const result = await testParams(params, startYear, endYear);

                  if (result.meetsAllCriteria) {
                    meetsCriteriaCount++;
                  }

                  if (result.score < bestScore) {
                    bestScore = result.score;
                    bestResult = result;

                    console.log(`\n\n✓ New best score: ${bestScore.toFixed(4)} (tested ${testedCount}/${totalCombos})`);
                    console.log(`  K/9 MAE:  ${result.metrics.k9.mae.toFixed(3)} ${result.metrics.k9.mae < SUCCESS_CRITERIA.k9Mae ? '✓' : '✗'}`);
                    console.log(`  K/9 Bias: ${result.metrics.k9.bias >= 0 ? '+' : ''}${result.metrics.k9.bias.toFixed(3)} ${Math.abs(result.metrics.k9.bias) < SUCCESS_CRITERIA.k9BiasMax ? '✓' : '✗'}`);
                    console.log(`  FIP MAE:  ${result.metrics.fip.mae.toFixed(3)} ${result.metrics.fip.mae <= SUCCESS_CRITERIA.fipMae ? '✓' : '✗'}`);
                    console.log(`  Params: baseOpt=${baseOpt.toFixed(2)}, baseNeut=${baseNeut.toFixed(2)}, basePes=${basePes.toFixed(2)}`);
                    console.log(`          age=${ageImp.toFixed(2)}, ip=${ipImp.toFixed(2)}, trend=${trendImp.toFixed(2)}, vol=${volImp.toFixed(2)}`);
                  }
                } catch (err) {
                  console.error(`\nError testing params:`, err);
                }
              }
            }
          }
        }
      }
    }
  }
  console.log(); // New line after progress indicator

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n' + '='.repeat(80));
  console.log('CALIBRATION COMPLETE');
  console.log('='.repeat(80));
  console.log(`\nTested ${testedCount} valid parameter combinations in ${elapsed}s`);
  console.log(`Combinations meeting all criteria: ${meetsCriteriaCount}`);

  if (bestResult) {
    console.log('\n' + '-'.repeat(80));
    console.log('BEST PARAMETERS');
    console.log('-'.repeat(80));
    console.log('\nWeight Parameters:');
    console.log(`  baseOptimistic:   ${bestResult.params.baseOptimistic.toFixed(2)}`);
    console.log(`  baseNeutral:      ${bestResult.params.baseNeutral.toFixed(2)}`);
    console.log(`  basePessimistic:  ${bestResult.params.basePessimistic.toFixed(2)}`);
    console.log(`  ageImpact:        ${bestResult.params.ageImpact.toFixed(2)}`);
    console.log(`  ipImpact:         ${bestResult.params.ipImpact.toFixed(2)}`);
    console.log(`  trendImpact:      ${bestResult.params.trendImpact.toFixed(2)}`);
    console.log(`  volatilityImpact: ${bestResult.params.volatilityImpact.toFixed(2)}`);

    console.log('\nPerformance Metrics:');
    console.log(`  Composite Score:  ${bestScore.toFixed(4)}`);
    console.log(`  Meets Criteria:   ${bestResult.meetsAllCriteria ? 'YES ✓' : 'NO ✗'}`);

    console.log('\nDetailed Metrics:');
    console.log(`  K/9  - MAE: ${bestResult.metrics.k9.mae.toFixed(3)}, RMSE: ${bestResult.metrics.k9.rmse.toFixed(3)}, Bias: ${bestResult.metrics.k9.bias >= 0 ? '+' : ''}${bestResult.metrics.k9.bias.toFixed(3)}, N: ${bestResult.metrics.k9.count}`);
    console.log(`  BB/9 - MAE: ${bestResult.metrics.bb9.mae.toFixed(3)}, RMSE: ${bestResult.metrics.bb9.rmse.toFixed(3)}, Bias: ${bestResult.metrics.bb9.bias >= 0 ? '+' : ''}${bestResult.metrics.bb9.bias.toFixed(3)}, N: ${bestResult.metrics.bb9.count}`);
    console.log(`  HR/9 - MAE: ${bestResult.metrics.hr9.mae.toFixed(3)}, RMSE: ${bestResult.metrics.hr9.rmse.toFixed(3)}, Bias: ${bestResult.metrics.hr9.bias >= 0 ? '+' : ''}${bestResult.metrics.hr9.bias.toFixed(3)}, N: ${bestResult.metrics.hr9.count}`);
    console.log(`  FIP  - MAE: ${bestResult.metrics.fip.mae.toFixed(3)}, RMSE: ${bestResult.metrics.fip.rmse.toFixed(3)}, Bias: ${bestResult.metrics.fip.bias >= 0 ? '+' : ''}${bestResult.metrics.fip.bias.toFixed(3)}, N: ${bestResult.metrics.fip.count}`);

    console.log('\n' + '-'.repeat(80));
    console.log('NEXT STEPS');
    console.log('-'.repeat(80));
    console.log('\n1. Update EnsembleProjectionService.ts DEFAULT_WEIGHT_PARAMS with values above');
    console.log('2. Run validation on held-out test set (if available)');
    console.log('3. Compare to baseline system performance');
    console.log('4. If successful, enable useEnsemble by default');
    console.log();
  } else {
    console.log('\n❌ No valid parameters found. Try expanding the grid or adjusting criteria.');
  }

  return bestResult;
}

// Run calibration
const CALIBRATION_START_YEAR = 2015;
const CALIBRATION_END_YEAR = 2020;

calibrateWeights(CALIBRATION_START_YEAR, CALIBRATION_END_YEAR)
  .then((result) => {
    if (result) {
      console.log('\n✅ Calibration successful!\n');
      process.exit(0);
    } else {
      console.log('\n❌ Calibration failed.\n');
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('\n❌ Calibration error:', err);
    process.exit(1);
  });
