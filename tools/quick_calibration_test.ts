/**
 * Quick Calibration Test
 *
 * Tests the calibration infrastructure on a single year (faster)
 * to verify the system works before running the full grid search.
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

import { projectionAnalysisService } from '../src/services/ProjectionAnalysisService';
import { ensembleProjectionService, WeightParams } from '../src/services/EnsembleProjectionService';
import { projectionService } from '../src/services/ProjectionService';

// Monkey-patch to force ensemble mode
const ORIGINAL_GET_PROJECTIONS = projectionService.getProjectionsWithContext.bind(projectionService);
(projectionService as any).getProjectionsWithContext = async function(year: number, options?: any) {
  return ORIGINAL_GET_PROJECTIONS(year, { ...options, useEnsemble: true });
};

async function quickTest() {
  console.log('='.repeat(80));
  console.log('QUICK CALIBRATION TEST');
  console.log('='.repeat(80));

  // Test 3 different parameter sets
  const paramSets: Array<{ name: string; params: WeightParams }> = [
    {
      name: 'Default (Uncalibrated)',
      params: {
        baseOptimistic: 0.4,
        baseNeutral: 0.4,
        basePessimistic: 0.2,
        ageImpact: 0.2,
        ipImpact: 0.2,
        trendImpact: 0.15,
        volatilityImpact: 0.5
      }
    },
    {
      name: 'More Pessimistic',
      params: {
        baseOptimistic: 0.35,
        baseNeutral: 0.40,
        basePessimistic: 0.25,
        ageImpact: 0.20,
        ipImpact: 0.25,
        trendImpact: 0.25,
        volatilityImpact: 0.5
      }
    },
    {
      name: 'More Neutral',
      params: {
        baseOptimistic: 0.30,
        baseNeutral: 0.50,
        basePessimistic: 0.20,
        ageImpact: 0.15,
        ipImpact: 0.20,
        trendImpact: 0.20,
        volatilityImpact: 0.6
      }
    }
  ];

  console.log('\nTesting on single year (2020) for speed...\n');

  for (const { name, params } of paramSets) {
    console.log('-'.repeat(80));
    console.log(name);
    console.log('-'.repeat(80));

    // Set parameters
    ensembleProjectionService.setWeightParams(params);

    // Run analysis for one year
    const report = await projectionAnalysisService.runAnalysis(2020, 2020);
    const metrics = report.overallMetrics;

    console.log('\nParameters:');
    console.log(`  Base: ${params.baseOptimistic.toFixed(2)} / ${params.baseNeutral.toFixed(2)} / ${params.basePessimistic.toFixed(2)}`);
    console.log(`  Adjustments: age=${params.ageImpact.toFixed(2)}, ip=${params.ipImpact.toFixed(2)}, trend=${params.trendImpact.toFixed(2)}, vol=${params.volatilityImpact.toFixed(2)}`);

    console.log('\nMetrics:');
    console.log(`  K/9  MAE:  ${metrics.k9.mae.toFixed(3)} (Bias: ${metrics.k9.bias >= 0 ? '+' : ''}${metrics.k9.bias.toFixed(3)})`);
    console.log(`  BB/9 MAE:  ${metrics.bb9.mae.toFixed(3)} (Bias: ${metrics.bb9.bias >= 0 ? '+' : ''}${metrics.bb9.bias.toFixed(3)})`);
    console.log(`  HR/9 MAE:  ${metrics.hr9.mae.toFixed(3)} (Bias: ${metrics.hr9.bias >= 0 ? '+' : ''}${metrics.hr9.bias.toFixed(3)})`);
    console.log(`  FIP  MAE:  ${metrics.fip.mae.toFixed(3)} (Bias: ${metrics.fip.bias >= 0 ? '+' : ''}${metrics.fip.bias.toFixed(3)})`);
    console.log(`  Sample:    ${metrics.k9.count} players`);

    console.log();
  }

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
  console.log('\nIf the above shows different metrics for each parameter set,');
  console.log('the calibration infrastructure is working correctly.');
  console.log('\nNext: Run full calibration with:');
  console.log('  npx tsx tools/calibrate_ensemble_weights.ts');
  console.log();
}

quickTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
