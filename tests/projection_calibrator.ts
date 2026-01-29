/**
 * Automated Projection Calibration System
 *
 * Fetches historical data (2017-2020, 100+ IP), runs back-projections,
 * calculates error metrics, and uses optimization to find optimal parameters.
 *
 * USAGE: npx tsx tests/projection_calibrator.ts [--iterations=100]
 */

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface PitcherStats {
  player_id: number;
  year: number;
  ip: number;
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
  war: number;
}

interface BackProjection {
  playerId: number;
  year: number;
  actualFip: number;
  actualK9: number;
  actualBb9: number;
  actualHr9: number;
  actualWar: number;
  projectedFip: number;
  projectedK9: number;
  projectedBb9: number;
  projectedHr9: number;
  projectedWar: number;
}

interface CalibrationParams {
  // League averages
  avgK9: number;
  avgBb9: number;
  avgHr9: number;

  // Regression coefficient ratios (how targetOffset translates to component changes)
  k9Ratio: number;
  bb9Ratio: number;
  hr9Ratio: number;

  // Sliding scale targetOffset breakpoints
  targetOffsets: {
    fip: number;
    offset: number;
  }[];
}

interface ErrorMetrics {
  overall: {
    fipMae: number;
    fipBias: number;
    k9Mae: number;
    k9Bias: number;
    bb9Mae: number;
    bb9Bias: number;
    hr9Mae: number;
    hr9Bias: number;
    warMae: number;
    warBias: number;
  };
  quartiles: {
    quartile: number;
    fipMae: number;
    fipBias: number;
    count: number;
  }[];
  top10: {
    avgProjectedWar: number;
    avgActualWar: number;
    meanError: number;
    mae: number;
  };
  // Combined loss function
  totalLoss: number;
}

function parseIp(ip: string): number {
  const parts = ip.split('.');
  if (parts.length === 1) return parseInt(ip);
  const whole = parseInt(parts[0]) || 0;
  const third = parseInt(parts[1]) || 0;
  return whole + third / 3;
}

async function fetchHistoricalData(startYear: number, endYear: number): Promise<PitcherStats[]> {
  const allStats: PitcherStats[] = [];

  for (let year = startYear; year <= endYear; year++) {
    console.log(`Fetching ${year} stats...`);
    const url = `${API_BASE}/playerpitchstatsv2/?year=${year}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${year} stats`);

    const csvText = await response.text();
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',');

    const indices = {
      player_id: headers.indexOf('player_id'),
      year: headers.indexOf('year'),
      split_id: headers.indexOf('split_id'),
      ip: headers.indexOf('ip'),
      k: headers.indexOf('k'),
      bb: headers.indexOf('bb'),
      hra: headers.indexOf('hra'),
      war: headers.indexOf('war')
    };

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const split_id = parseInt(values[indices.split_id]);
      if (split_id !== 1) continue; // Only total stats

      const player_id = parseInt(values[indices.player_id]);
      const ip = values[indices.ip];
      const ipNum = parseIp(ip);

      // Filter for starters with 100+ IP
      if (ipNum < 100) continue;

      const k = parseInt(values[indices.k]) || 0;
      const bb = parseInt(values[indices.bb]) || 0;
      const hra = parseInt(values[indices.hra]) || 0;

      // Calculate rate stats
      const k9 = ipNum > 0 ? (k / ipNum) * 9 : 0;
      const bb9 = ipNum > 0 ? (bb / ipNum) * 9 : 0;
      const hr9 = ipNum > 0 ? (hra / ipNum) * 9 : 0;

      // Calculate FIP using constant 3.47
      const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

      allStats.push({
        player_id,
        year: parseInt(values[indices.year]),
        ip: ipNum,
        k9,
        bb9,
        hr9,
        fip,
        war: parseFloat(values[indices.war]) || 0
      });
    }

    console.log(`  Found ${allStats.filter(s => s.year === year).length} pitchers with 100+ IP`);
  }

  return allStats;
}

/**
 * Simulates projection with given parameters
 * (Simplified version - just applies regression logic)
 */
function simulateProjection(
  historical: PitcherStats,
  params: CalibrationParams
): { fip: number; k9: number; bb9: number; hr9: number; war: number } {
  // Start with historical performance
  let k9 = historical.k9;
  let bb9 = historical.bb9;
  let hr9 = historical.hr9;

  // Calculate estimated FIP from historical
  const historicalFip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

  // Find targetOffset from sliding scale
  let targetOffset = 0;
  for (let i = 0; i < params.targetOffsets.length - 1; i++) {
    const lower = params.targetOffsets[i];
    const upper = params.targetOffsets[i + 1];

    if (historicalFip >= lower.fip && historicalFip <= upper.fip) {
      const t = (historicalFip - lower.fip) / (upper.fip - lower.fip);
      targetOffset = lower.offset + t * (upper.offset - lower.offset);
      break;
    }
  }

  // Apply regression toward league average with targetOffset adjustment
  // Simple regression: move 30% toward target (simplified from full IP-weighted logic)
  const regressionStrength = 0.3;

  const k9Target = params.avgK9 - (targetOffset * params.k9Ratio);
  const bb9Target = params.avgBb9 + (targetOffset * params.bb9Ratio);
  const hr9Target = params.avgHr9 + (targetOffset * params.hr9Ratio);

  k9 = k9 * (1 - regressionStrength) + k9Target * regressionStrength;
  bb9 = bb9 * (1 - regressionStrength) + bb9Target * regressionStrength;
  hr9 = hr9 * (1 - regressionStrength) + hr9Target * regressionStrength;

  // Calculate projected FIP
  const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

  // Simple WAR projection (very simplified)
  const war = Math.max(0, ((4.2 - fip) * historical.ip / 9 / 9));

  return { fip, k9, bb9, hr9, war };
}

function calculateMetrics(
  backProjections: BackProjection[],
  params: CalibrationParams
): ErrorMetrics {
  // Overall metrics
  const fipErrors = backProjections.map(p => p.projectedFip - p.actualFip);
  const k9Errors = backProjections.map(p => p.projectedK9 - p.actualK9);
  const bb9Errors = backProjections.map(p => p.projectedBb9 - p.actualBb9);
  const hr9Errors = backProjections.map(p => p.projectedHr9 - p.actualHr9);
  const warErrors = backProjections.map(p => p.projectedWar - p.actualWar);

  // Sort by actual FIP for quartile analysis
  const sorted = [...backProjections].sort((a, b) => a.actualFip - b.actualFip);
  const quartileSize = Math.floor(sorted.length / 4);

  const quartiles: ErrorMetrics['quartiles'] = [];
  for (let q = 0; q < 4; q++) {
    const start = q * quartileSize;
    const end = q === 3 ? sorted.length : (q + 1) * quartileSize;
    const quartileData = sorted.slice(start, end);

    const qFipErrors = quartileData.map(p => p.projectedFip - p.actualFip);

    quartiles.push({
      quartile: q + 1,
      fipMae: calculateMae(qFipErrors),
      fipBias: calculateMean(qFipErrors),
      count: quartileData.length
    });
  }

  // Top 10 WAR analysis
  const top10ByActual = [...backProjections]
    .sort((a, b) => b.actualWar - a.actualWar)
    .slice(0, 10);

  const top10ProjectedWar = top10ByActual.map(p => p.projectedWar);
  const top10ActualWar = top10ByActual.map(p => p.actualWar);
  const top10Errors = top10ByActual.map(p => p.projectedWar - p.actualWar);

  // Calculate combined loss function
  // Penalize:
  // 1. Overall bias (want close to 0)
  // 2. Quartile bias spread (want all quartiles close to 0)
  // 3. Top 10 error (important for elite pitchers)
  const overallBiasPenalty = Math.abs(calculateMean(fipErrors)) * 10;
  const quartileBiasPenalty = quartiles.reduce((sum, q) => sum + Math.abs(q.fipBias) * 5, 0);
  const top10Penalty = Math.abs(calculateMean(top10Errors)) * 15;
  const maePenalty = calculateMae(fipErrors) * 2;

  const totalLoss = overallBiasPenalty + quartileBiasPenalty + top10Penalty + maePenalty;

  return {
    overall: {
      fipMae: calculateMae(fipErrors),
      fipBias: calculateMean(fipErrors),
      k9Mae: calculateMae(k9Errors),
      k9Bias: calculateMean(k9Errors),
      bb9Mae: calculateMae(bb9Errors),
      bb9Bias: calculateMean(bb9Errors),
      hr9Mae: calculateMae(hr9Errors),
      hr9Bias: calculateMean(hr9Errors),
      warMae: calculateMae(warErrors),
      warBias: calculateMean(warErrors)
    },
    quartiles,
    top10: {
      avgProjectedWar: calculateMean(top10ProjectedWar),
      avgActualWar: calculateMean(top10ActualWar),
      meanError: calculateMean(top10Errors),
      mae: calculateMae(top10Errors)
    },
    totalLoss
  };
}

function calculateMae(errors: number[]): number {
  return errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
}

function calculateMean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Simple gradient descent optimization
 */
function optimizeParameters(
  historicalData: PitcherStats[],
  initialParams: CalibrationParams,
  maxIterations: number = 100
): { params: CalibrationParams; metrics: ErrorMetrics } {
  let currentParams = { ...initialParams };
  let currentMetrics = evaluateParams(currentParams, historicalData);
  let bestParams = currentParams;
  let bestMetrics = currentMetrics;

  console.log(`\nStarting optimization (${maxIterations} iterations)...`);
  console.log(`Initial loss: ${currentMetrics.totalLoss.toFixed(3)}\n`);

  const learningRate = 0.05;

  for (let iter = 0; iter < maxIterations; iter++) {
    // Try adjusting each parameter slightly
    const adjustments = [
      { param: 'avgK9', delta: 0.1 },
      { param: 'avgBb9', delta: 0.05 },
      { param: 'avgHr9', delta: 0.02 },
      { param: 'k9Ratio', delta: 0.05 },
      { param: 'bb9Ratio', delta: 0.05 },
      { param: 'hr9Ratio', delta: 0.01 }
    ];

    let improved = false;

    for (const adj of adjustments) {
      // Try positive delta
      const testParamsPos = { ...currentParams, [adj.param]: (currentParams as any)[adj.param] + adj.delta };
      const metricsPos = evaluateParams(testParamsPos, historicalData);

      // Try negative delta
      const testParamsNeg = { ...currentParams, [adj.param]: (currentParams as any)[adj.param] - adj.delta };
      const metricsNeg = evaluateParams(testParamsNeg, historicalData);

      // Keep best
      if (metricsPos.totalLoss < currentMetrics.totalLoss && metricsPos.totalLoss < metricsNeg.totalLoss) {
        currentParams = testParamsPos;
        currentMetrics = metricsPos;
        improved = true;
      } else if (metricsNeg.totalLoss < currentMetrics.totalLoss) {
        currentParams = testParamsNeg;
        currentMetrics = metricsNeg;
        improved = true;
      }
    }

    if (currentMetrics.totalLoss < bestMetrics.totalLoss) {
      bestParams = { ...currentParams };
      bestMetrics = currentMetrics;
    }

    if ((iter + 1) % 10 === 0) {
      console.log(`Iteration ${iter + 1}: Loss = ${currentMetrics.totalLoss.toFixed(3)} (best: ${bestMetrics.totalLoss.toFixed(3)})`);
      console.log(`  FIP Bias: Overall ${currentMetrics.overall.fipBias > 0 ? '+' : ''}${currentMetrics.overall.fipBias.toFixed(3)}, Q1 ${currentMetrics.quartiles[0].fipBias > 0 ? '+' : ''}${currentMetrics.quartiles[0].fipBias.toFixed(3)}, Q4 ${currentMetrics.quartiles[3].fipBias > 0 ? '+' : ''}${currentMetrics.quartiles[3].fipBias.toFixed(3)}`);
      console.log(`  Top 10 WAR Error: ${currentMetrics.top10.meanError > 0 ? '+' : ''}${currentMetrics.top10.meanError.toFixed(2)}\n`);
    }

    // Early stopping if no improvement
    if (!improved) {
      console.log(`Converged at iteration ${iter + 1} (no improvement)`);
      break;
    }
  }

  return { params: bestParams, metrics: bestMetrics };
}

function evaluateParams(params: CalibrationParams, historicalData: PitcherStats[]): ErrorMetrics {
  const backProjections: BackProjection[] = historicalData.map(stat => {
    const projection = simulateProjection(stat, params);
    return {
      playerId: stat.player_id,
      year: stat.year,
      actualFip: stat.fip,
      actualK9: stat.k9,
      actualBb9: stat.bb9,
      actualHr9: stat.hr9,
      actualWar: stat.war,
      projectedFip: projection.fip,
      projectedK9: projection.k9,
      projectedBb9: projection.bb9,
      projectedHr9: projection.hr9,
      projectedWar: projection.war
    };
  });

  return calculateMetrics(backProjections, params);
}

function printResults(params: CalibrationParams, metrics: ErrorMetrics) {
  console.log('\n' + '='.repeat(80));
  console.log('OPTIMIZATION COMPLETE');
  console.log('='.repeat(80));

  console.log('\n--- OPTIMIZED PARAMETERS ---\n');
  console.log('League Averages:');
  console.log(`  avgK9:  ${params.avgK9.toFixed(2)}`);
  console.log(`  avgBb9: ${params.avgBb9.toFixed(2)}`);
  console.log(`  avgHr9: ${params.avgHr9.toFixed(2)}`);

  console.log('\nRegression Coefficient Ratios:');
  console.log(`  k9Ratio:  ${params.k9Ratio.toFixed(2)}`);
  console.log(`  bb9Ratio: ${params.bb9Ratio.toFixed(2)}`);
  console.log(`  hr9Ratio: ${params.hr9Ratio.toFixed(2)}`);

  console.log('\n--- ERROR METRICS ---\n');
  console.log('Overall:');
  console.log(`  FIP:  MAE ${metrics.overall.fipMae.toFixed(3)}, Bias ${metrics.overall.fipBias > 0 ? '+' : ''}${metrics.overall.fipBias.toFixed(3)}`);
  console.log(`  K/9:  MAE ${metrics.overall.k9Mae.toFixed(3)}, Bias ${metrics.overall.k9Bias > 0 ? '+' : ''}${metrics.overall.k9Bias.toFixed(3)}`);
  console.log(`  BB/9: MAE ${metrics.overall.bb9Mae.toFixed(3)}, Bias ${metrics.overall.bb9Bias > 0 ? '+' : ''}${metrics.overall.bb9Bias.toFixed(3)}`);
  console.log(`  HR/9: MAE ${metrics.overall.hr9Mae.toFixed(3)}, Bias ${metrics.overall.hr9Bias > 0 ? '+' : ''}${metrics.overall.hr9Bias.toFixed(3)}`);

  console.log('\nQuartile Analysis:');
  for (const q of metrics.quartiles) {
    const label = `Q${q.quartile}`;
    console.log(`  ${label}: MAE ${q.fipMae.toFixed(3)}, Bias ${q.fipBias > 0 ? '+' : ''}${q.fipBias.toFixed(3)} (n=${q.count})`);
  }

  console.log('\nTop 10 WAR Leaders:');
  console.log(`  Projected: ${metrics.top10.avgProjectedWar.toFixed(2)} WAR`);
  console.log(`  Actual:    ${metrics.top10.avgActualWar.toFixed(2)} WAR`);
  console.log(`  Error:     ${metrics.top10.meanError > 0 ? '+' : ''}${metrics.top10.meanError.toFixed(2)} WAR`);
  console.log(`  MAE:       ${metrics.top10.mae.toFixed(2)}`);

  console.log(`\nTotal Loss: ${metrics.totalLoss.toFixed(3)}`);
  console.log('\n' + '='.repeat(80));
}

async function main() {
  const args = process.argv.slice(2);
  const iterationsArg = args.find(a => a.startsWith('--iterations='));
  const maxIterations = iterationsArg ? parseInt(iterationsArg.split('=')[1]) : 100;

  console.log('=== Projection Calibration System ===\n');
  console.log('Fetching historical data (2017-2020, 100+ IP)...\n');

  const historicalData = await fetchHistoricalData(2017, 2020);
  console.log(`\nLoaded ${historicalData.length} pitcher-seasons\n`);

  // Initial parameters (current values)
  const initialParams: CalibrationParams = {
    avgK9: 6.1,
    avgBb9: 2.4,
    avgHr9: 0.8,
    k9Ratio: 1.25,
    bb9Ratio: 0.75,
    hr9Ratio: 0.14,
    targetOffsets: [
      { fip: 2.5, offset: -3.0 },
      { fip: 3.0, offset: -2.8 },
      { fip: 3.5, offset: -2.0 },
      { fip: 4.0, offset: -0.8 },
      { fip: 4.2, offset: 0.0 },
      { fip: 4.5, offset: 1.0 },
      { fip: 5.0, offset: 1.5 },
      { fip: 6.0, offset: 1.5 }
    ]
  };

  const { params, metrics } = optimizeParameters(historicalData, initialParams, maxIterations);

  printResults(params, metrics);

  console.log('\n--- CODE UPDATE ---\n');
  console.log('Update TrueRatingsCalculationService.ts:');
  console.log(`const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = {`);
  console.log(`  avgK9: ${params.avgK9.toFixed(2)},`);
  console.log(`  avgBb9: ${params.avgBb9.toFixed(2)},`);
  console.log(`  avgHr9: ${params.avgHr9.toFixed(2)},`);
  console.log(`};`);
  console.log();
  console.log(`case 'k9':  regressionTarget = leagueRate - (targetOffset * ${params.k9Ratio.toFixed(2)});`);
  console.log(`case 'bb9': regressionTarget = leagueRate + (targetOffset * ${params.bb9Ratio.toFixed(2)});`);
  console.log(`case 'hr9': regressionTarget = leagueRate + (targetOffset * ${params.hr9Ratio.toFixed(2)});`);
}

main().catch(console.error);
