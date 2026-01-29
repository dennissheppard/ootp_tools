/**
 * Projection Validation Test Suite
 *
 * Runs comprehensive back-projection tests against historical data
 * to measure accuracy. This doesn't optimize - it just reports detailed
 * metrics so you can manually adjust parameters and re-run.
 *
 * Think of this as your automated "analysis page" that you've been
 * manually checking.
 *
 * USAGE: npx tsx tests/projection_validator.ts
 */

import { projectionService } from '../src/services/ProjectionService';
import { trueRatingsService } from '../src/services/TrueRatingsService';

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

interface ValidationResults {
  overall: {
    metric: string;
    mae: number;
    rmse: number;
    bias: number;
    count: number;
  }[];
  quartiles: {
    quartile: string;
    fipRange: string;
    mae: number;
    rmse: number;
    bias: number;
    count: number;
  }[];
  top10: {
    avgProjectedWar: number;
    avgActualWar: number;
    meanError: number;
    mae: number;
  };
}

function parseIp(ip: string): number {
  const parts = ip.split('.');
  if (parts.length === 1) return parseInt(ip);
  const whole = parseInt(parts[0]) || 0;
  const third = parseInt(parts[1]) || 0;
  return whole + third / 3;
}

async function fetchActualStats(year: number): Promise<Map<number, PitcherStats>> {
  console.log(`Fetching ${year} actual stats...`);
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

  const playerMap = new Map<number, PitcherStats>();

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const split_id = parseInt(values[indices.split_id]);
    if (split_id !== 1) continue;

    const player_id = parseInt(values[indices.player_id]);
    const ip = values[indices.ip];
    const ipNum = parseIp(ip);

    if (ipNum < 100) continue; // Filter: 100+ IP

    const k = parseInt(values[indices.k]) || 0;
    const bb = parseInt(values[indices.bb]) || 0;
    const hra = parseInt(values[indices.hra]) || 0;

    const k9 = ipNum > 0 ? (k / ipNum) * 9 : 0;
    const bb9 = ipNum > 0 ? (bb / ipNum) * 9 : 0;
    const hr9 = ipNum > 0 ? (hra / ipNum) * 9 : 0;
    const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

    playerMap.set(player_id, {
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

  console.log(`  Found ${playerMap.size} pitchers with 100+ IP`);
  return playerMap;
}

function calculateMae(errors: number[]): number {
  return errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
}

function calculateRmse(errors: number[]): number {
  const mse = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
  return Math.sqrt(mse);
}

function calculateMean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function validateYear(projectionYear: number, actualYear: number): Promise<ValidationResults | null> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Validating: ${projectionYear} → ${actualYear}`);
  console.log('='.repeat(80));

  try {
    // Get projections from prior year
    console.log(`Generating ${projectionYear} projections...`);
    const projections = await projectionService.getProjections(projectionYear, {
      forceRosterRefresh: false,
      useEnsemble: false
    });
    console.log(`  Generated ${projections.length} projections`);

    // Get actual stats from target year
    const actualStats = await fetchActualStats(actualYear);

    // Match projections to actuals
    const matches: {
      playerId: number;
      actualFip: number;
      projectedFip: number;
      actualK9: number;
      projectedK9: number;
      actualBb9: number;
      projectedBb9: number;
      actualHr9: number;
      projectedHr9: number;
      actualWar: number;
      projectedWar: number;
    }[] = [];

    for (const proj of projections) {
      const actual = actualStats.get(proj.playerId);
      if (!actual) continue;

      matches.push({
        playerId: proj.playerId,
        actualFip: actual.fip,
        projectedFip: proj.projectedStats.fip,
        actualK9: actual.k9,
        projectedK9: proj.projectedStats.k9,
        actualBb9: actual.bb9,
        projectedBb9: proj.projectedStats.bb9,
        actualHr9: actual.hr9,
        projectedHr9: proj.projectedStats.hr9,
        actualWar: actual.war,
        projectedWar: proj.projectedStats.war
      });
    }

    console.log(`  Matched ${matches.length} pitchers\n`);

    if (matches.length === 0) {
      console.log('  No matches found, skipping year\n');
      return null;
    }

    // Calculate overall metrics
    const fipErrors = matches.map(m => m.projectedFip - m.actualFip);
    const k9Errors = matches.map(m => m.projectedK9 - m.actualK9);
    const bb9Errors = matches.map(m => m.projectedBb9 - m.actualBb9);
    const hr9Errors = matches.map(m => m.projectedHr9 - m.actualHr9);

    // Sort by actual FIP for quartile analysis
    const sorted = [...matches].sort((a, b) => a.actualFip - b.actualFip);
    const quartileSize = Math.floor(sorted.length / 4);

    const quartiles: ValidationResults['quartiles'] = [];
    for (let q = 0; q < 4; q++) {
      const start = q * quartileSize;
      const end = q === 3 ? sorted.length : (q + 1) * quartileSize;
      const quartileData = sorted.slice(start, end);

      const qFipErrors = quartileData.map(m => m.projectedFip - m.actualFip);
      const fipRange = `${quartileData[0].actualFip.toFixed(2)}-${quartileData[quartileData.length - 1].actualFip.toFixed(2)}`;

      const qLabel = q === 0 ? 'Q1 (Elite)' : q === 1 ? 'Q2 (Good)' : q === 2 ? 'Q3 (Average)' : 'Q4 (Below Avg)';

      quartiles.push({
        quartile: qLabel,
        fipRange,
        mae: calculateMae(qFipErrors),
        rmse: calculateRmse(qFipErrors),
        bias: calculateMean(qFipErrors),
        count: quartileData.length
      });
    }

    // Top 10 WAR analysis
    const top10ByActual = [...matches].sort((a, b) => b.actualWar - a.actualWar).slice(0, 10);
    const top10Errors = top10ByActual.map(m => m.projectedWar - m.actualWar);

    return {
      overall: [
        {
          metric: 'FIP',
          mae: calculateMae(fipErrors),
          rmse: calculateRmse(fipErrors),
          bias: calculateMean(fipErrors),
          count: matches.length
        },
        {
          metric: 'K/9',
          mae: calculateMae(k9Errors),
          rmse: calculateRmse(k9Errors),
          bias: calculateMean(k9Errors),
          count: matches.length
        },
        {
          metric: 'BB/9',
          mae: calculateMae(bb9Errors),
          rmse: calculateRmse(bb9Errors),
          bias: calculateMean(bb9Errors),
          count: matches.length
        },
        {
          metric: 'HR/9',
          mae: calculateMae(hr9Errors),
          rmse: calculateRmse(hr9Errors),
          bias: calculateMean(hr9Errors),
          count: matches.length
        }
      ],
      quartiles,
      top10: {
        avgProjectedWar: calculateMean(top10ByActual.map(m => m.projectedWar)),
        avgActualWar: calculateMean(top10ByActual.map(m => m.actualWar)),
        meanError: calculateMean(top10Errors),
        mae: calculateMae(top10Errors)
      }
    };
  } catch (error) {
    console.error(`Error validating ${projectionYear} → ${actualYear}:`, error);
    return null;
  }
}

function printYearResults(year: number, results: ValidationResults) {
  console.log(`\n--- OVERALL METRICS (${year}) ---\n`);
  console.log('Metric\t\tMAE\tRMSE\tBias\tCount');
  console.log('─'.repeat(60));
  for (const metric of results.overall) {
    const biasStr = metric.bias > 0 ? `+${metric.bias.toFixed(3)}` : metric.bias.toFixed(3);
    console.log(`${metric.metric}\t\t${metric.mae.toFixed(3)}\t${metric.rmse.toFixed(3)}\t${biasStr}\t${metric.count}`);
  }

  console.log(`\n--- QUARTILE ANALYSIS (${year}) ---\n`);
  console.log('Quartile\t\tFIP Range\t\tMAE\tRMSE\tBias\tCount');
  console.log('─'.repeat(80));
  for (const q of results.quartiles) {
    const biasStr = q.bias > 0 ? `+${q.bias.toFixed(3)}` : q.bias.toFixed(3);
    console.log(`${q.quartile}\t\t${q.fipRange}\t\t${q.mae.toFixed(3)}\t${q.rmse.toFixed(3)}\t${biasStr}\t${q.count}`);
  }

  console.log(`\n--- TOP 10 WAR LEADERS (${year}) ---\n`);
  console.log(`Avg Projected WAR: ${results.top10.avgProjectedWar.toFixed(2)}`);
  console.log(`Avg Actual WAR:    ${results.top10.avgActualWar.toFixed(2)}`);
  const errorStr = results.top10.meanError > 0 ? `+${results.top10.meanError.toFixed(2)}` : results.top10.meanError.toFixed(2);
  console.log(`Mean Error:        ${errorStr}`);
  console.log(`MAE:               ${results.top10.mae.toFixed(2)}`);
}

function printAggregatedResults(allResults: { year: number; results: ValidationResults }[]) {
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('AGGREGATED RESULTS (2017-2020)');
  console.log('='.repeat(80));

  // Aggregate overall metrics
  const aggregatedOverall = new Map<string, { mae: number[]; rmse: number[]; bias: number[] }>();

  for (const { results } of allResults) {
    for (const metric of results.overall) {
      if (!aggregatedOverall.has(metric.metric)) {
        aggregatedOverall.set(metric.metric, { mae: [], rmse: [], bias: [] });
      }
      const agg = aggregatedOverall.get(metric.metric)!;
      agg.mae.push(metric.mae);
      agg.rmse.push(metric.rmse);
      agg.bias.push(metric.bias);
    }
  }

  console.log('\n--- OVERALL METRICS (All Years) ---\n');
  console.log('Metric\t\tAvg MAE\t\tAvg RMSE\tAvg Bias');
  console.log('─'.repeat(60));
  for (const [metric, values] of aggregatedOverall.entries()) {
    const avgMae = calculateMean(values.mae);
    const avgRmse = calculateMean(values.rmse);
    const avgBias = calculateMean(values.bias);
    const biasStr = avgBias > 0 ? `+${avgBias.toFixed(3)}` : avgBias.toFixed(3);
    console.log(`${metric}\t\t${avgMae.toFixed(3)}\t\t${avgRmse.toFixed(3)}\t\t${biasStr}`);
  }

  // Aggregate quartile results
  const aggregatedQuartiles = [
    { bias: [] as number[], mae: [] as number[] },
    { bias: [] as number[], mae: [] as number[] },
    { bias: [] as number[], mae: [] as number[] },
    { bias: [] as number[], mae: [] as number[] }
  ];

  for (const { results } of allResults) {
    results.quartiles.forEach((q, idx) => {
      aggregatedQuartiles[idx].bias.push(q.bias);
      aggregatedQuartiles[idx].mae.push(q.mae);
    });
  }

  console.log('\n--- QUARTILE ANALYSIS (All Years) ---\n');
  console.log('Quartile\t\tAvg MAE\t\tAvg Bias');
  console.log('─'.repeat(60));
  aggregatedQuartiles.forEach((q, idx) => {
    const label = idx === 0 ? 'Q1 (Elite)' : idx === 1 ? 'Q2 (Good)' : idx === 2 ? 'Q3 (Average)' : 'Q4 (Below Avg)';
    const avgMae = calculateMean(q.mae);
    const avgBias = calculateMean(q.bias);
    const biasStr = avgBias > 0 ? `+${avgBias.toFixed(3)}` : avgBias.toFixed(3);
    console.log(`${label}\t\t${avgMae.toFixed(3)}\t\t${biasStr}`);
  });

  // Aggregate Top 10
  const top10Errors: number[] = [];
  const top10Mae: number[] = [];
  for (const { results } of allResults) {
    top10Errors.push(results.top10.meanError);
    top10Mae.push(results.top10.mae);
  }

  console.log('\n--- TOP 10 WAR LEADERS (All Years) ---\n');
  const avgError = calculateMean(top10Errors);
  const avgMae = calculateMean(top10Mae);
  const errorStr = avgError > 0 ? `+${avgError.toFixed(2)}` : avgError.toFixed(2);
  console.log(`Avg Mean Error: ${errorStr} WAR`);
  console.log(`Avg MAE:        ${avgMae.toFixed(2)}`);

  console.log('\n' + '='.repeat(80));
}

async function main() {
  console.log('=== Projection Validation Test Suite ===\n');
  console.log('Testing back-projections for 2017-2020 (100+ IP starters)\n');

  const testYears = [
    { projection: 2017, actual: 2018 },
    { projection: 2018, actual: 2019 },
    { projection: 2019, actual: 2020 },
    { projection: 2020, actual: 2021 }
  ];

  const allResults: { year: number; results: ValidationResults }[] = [];

  for (const { projection, actual } of testYears) {
    const results = await validateYear(projection, actual);
    if (results) {
      printYearResults(actual, results);
      allResults.push({ year: actual, results });
    }
  }

  if (allResults.length > 0) {
    printAggregatedResults(allResults);
  }

  console.log('\n✅ Validation complete!\n');
}

main().catch(console.error);
