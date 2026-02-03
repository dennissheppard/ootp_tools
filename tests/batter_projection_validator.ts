/**
 * Batter Projection Validation Test Suite
 *
 * Runs comprehensive back-projection tests against historical batting data
 * to measure accuracy. Reports detailed metrics for manual parameter tuning.
 *
 * This is a standalone test that fetches all data from the StatsPlus API,
 * avoiding browser-specific fetch issues with local files.
 *
 * USAGE: npx tsx tests/batter_projection_validator.ts
 */

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface BatterStats {
  player_id: number;
  year: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
  avg: number;
  obp: number;
  slg: number;
  woba: number;
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
    wobaRange: string;
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

async function fetchBattingStats(year: number, minPa: number = 200): Promise<Map<number, BatterStats>> {
  console.log(`Fetching ${year} batting stats...`);
  const url = `${API_BASE}/playerbatstatsv2/?year=${year}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${year} batting stats`);

  const csvText = await response.text();
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');

  const indices = {
    player_id: headers.indexOf('player_id'),
    year: headers.indexOf('year'),
    split_id: headers.indexOf('split_id'),
    pa: headers.indexOf('pa'),
    ab: headers.indexOf('ab'),
    h: headers.indexOf('h'),
    d: headers.indexOf('d'),
    t: headers.indexOf('t'),
    hr: headers.indexOf('hr'),
    bb: headers.indexOf('bb'),
    k: headers.indexOf('k'),
    war: headers.indexOf('war'),
  };

  const playerMap = new Map<number, BatterStats>();

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const split_id = parseInt(values[indices.split_id]);
    if (split_id !== 1) continue; // Total stats only

    const player_id = parseInt(values[indices.player_id]);
    const pa = parseInt(values[indices.pa]) || 0;

    if (pa < minPa) continue;

    const ab = parseInt(values[indices.ab]) || 0;
    const h = parseInt(values[indices.h]) || 0;
    const d = parseInt(values[indices.d]) || 0;
    const t = parseInt(values[indices.t]) || 0;
    const hr = parseInt(values[indices.hr]) || 0;
    const bb = parseInt(values[indices.bb]) || 0;
    const k = parseInt(values[indices.k]) || 0;

    const avg = ab > 0 ? h / ab : 0;
    const obp = pa > 0 ? (h + bb) / pa : 0; // Simplified OBP
    const singles = h - d - t - hr;
    const tb = singles + 2 * d + 3 * t + 4 * hr;
    const slg = ab > 0 ? tb / ab : 0;

    // Calculate wOBA
    const woba = pa > 0 ? (
      0.69 * bb +
      0.89 * singles +
      1.27 * d +
      1.62 * t +
      2.10 * hr
    ) / pa : 0;

    playerMap.set(player_id, {
      player_id,
      year: parseInt(values[indices.year]),
      pa,
      ab,
      h,
      d,
      t,
      hr,
      bb,
      k,
      avg,
      obp,
      slg,
      woba,
      war: parseFloat(values[indices.war]) || 0,
    });
  }

  console.log(`  Found ${playerMap.size} batters with ${minPa}+ PA`);
  return playerMap;
}

/**
 * Simple projection: regress prior year stats toward league mean
 * This mimics what the projection service does without browser dependencies
 */
function projectStats(priorStats: BatterStats, lgWoba: number = 0.320): {
  projWoba: number;
  projAvg: number;
  projBbPct: number;
  projKPct: number;
  projWar: number;
} {
  // Regression toward mean based on PA
  // More PA = trust observed stats more
  const paConfidence = Math.min(1.0, priorStats.pa / 600);
  const regressWeight = 0.3 * (1 - paConfidence); // 0-30% regression based on PA

  const projWoba = priorStats.woba * (1 - regressWeight) + lgWoba * regressWeight;
  const projAvg = priorStats.avg * (1 - regressWeight) + 0.260 * regressWeight;
  const projBbPct = ((priorStats.bb / priorStats.pa) * 100) * (1 - regressWeight) + 8.5 * regressWeight;
  const projKPct = ((priorStats.k / priorStats.pa) * 100) * (1 - regressWeight) + 22.0 * regressWeight;

  // Simple WAR projection from wOBA
  // WAR ≈ (wOBA - lgWoba) / 0.115 * PA / 600 * 10 + replacement
  const wRAA = ((projWoba - lgWoba) / 1.15) * 600;
  const projWar = (wRAA + 20) / 10; // Assumes 600 PA

  return { projWoba, projAvg, projBbPct, projKPct, projWar };
}

function calculateMae(errors: number[]): number {
  if (errors.length === 0) return 0;
  return errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
}

function calculateRmse(errors: number[]): number {
  if (errors.length === 0) return 0;
  const mse = errors.reduce((sum, e) => sum + e * e, 0) / errors.length;
  return Math.sqrt(mse);
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

async function validateYear(projectionYear: number, actualYear: number): Promise<ValidationResults | null> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Validating Batters: ${projectionYear} → ${actualYear}`);
  console.log('='.repeat(80));

  try {
    // Fetch prior year stats (for projections)
    console.log(`Fetching ${projectionYear} stats for projection base...`);
    const priorStats = await fetchBattingStats(projectionYear, 200);

    // Fetch actual stats from target year
    const actualStats = await fetchBattingStats(actualYear, 200);

    // Calculate league average wOBA from prior year for regression target
    let lgWoba = 0.320;
    if (priorStats.size > 0) {
      const wobaSum = Array.from(priorStats.values()).reduce((sum, s) => sum + s.woba * s.pa, 0);
      const paSum = Array.from(priorStats.values()).reduce((sum, s) => sum + s.pa, 0);
      lgWoba = paSum > 0 ? wobaSum / paSum : 0.320;
    }
    console.log(`  League average wOBA (${projectionYear}): ${lgWoba.toFixed(3)}`);

    // Match players who appear in both years
    const matches: {
      playerId: number;
      name: string;
      actualWoba: number;
      projectedWoba: number;
      actualAvg: number;
      projectedAvg: number;
      actualBbPct: number;
      projectedBbPct: number;
      actualKPct: number;
      projectedKPct: number;
      actualWar: number;
      projectedWar: number;
    }[] = [];

    for (const [playerId, prior] of priorStats) {
      const actual = actualStats.get(playerId);
      if (!actual) continue;

      // Project from prior year stats
      const proj = projectStats(prior, lgWoba);

      // Calculate actual rate stats
      const actualBbPct = (actual.bb / actual.pa) * 100;
      const actualKPct = (actual.k / actual.pa) * 100;

      matches.push({
        playerId,
        name: `Player ${playerId}`,
        actualWoba: actual.woba,
        projectedWoba: proj.projWoba,
        actualAvg: actual.avg,
        projectedAvg: proj.projAvg,
        actualBbPct,
        projectedBbPct: proj.projBbPct,
        actualKPct,
        projectedKPct: proj.projKPct,
        actualWar: actual.war,
        projectedWar: proj.projWar,
      });
    }

    console.log(`  Matched ${matches.length} batters appearing in both years\n`);

    if (matches.length === 0) {
      console.log('  No matches found, skipping year\n');
      return null;
    }

    // Calculate overall metrics
    const wobaErrors = matches.map(m => m.projectedWoba - m.actualWoba);
    const avgErrors = matches.map(m => m.projectedAvg - m.actualAvg);
    const bbPctErrors = matches.map(m => m.projectedBbPct - m.actualBbPct);
    const kPctErrors = matches.map(m => m.projectedKPct - m.actualKPct);
    const warErrors = matches.map(m => m.projectedWar - m.actualWar);

    // Sort by actual wOBA for quartile analysis
    const sorted = [...matches].sort((a, b) => b.actualWoba - a.actualWoba);
    const quartileSize = Math.floor(sorted.length / 4);

    const quartiles: ValidationResults['quartiles'] = [];
    for (let q = 0; q < 4; q++) {
      const start = q * quartileSize;
      const end = q === 3 ? sorted.length : (q + 1) * quartileSize;
      const quartileData = sorted.slice(start, end);

      const qWobaErrors = quartileData.map(m => m.projectedWoba - m.actualWoba);
      const wobaRange = `${quartileData[quartileData.length - 1].actualWoba.toFixed(3)}-${quartileData[0].actualWoba.toFixed(3)}`;

      const qLabel = q === 0 ? 'Q1 (Elite)' : q === 1 ? 'Q2 (Good)' : q === 2 ? 'Q3 (Average)' : 'Q4 (Below Avg)';

      quartiles.push({
        quartile: qLabel,
        wobaRange,
        mae: calculateMae(qWobaErrors),
        rmse: calculateRmse(qWobaErrors),
        bias: calculateMean(qWobaErrors),
        count: quartileData.length,
      });
    }

    // Top 10 WAR analysis
    const top10ByActual = [...matches].sort((a, b) => b.actualWar - a.actualWar).slice(0, 10);
    const top10Errors = top10ByActual.map(m => m.projectedWar - m.actualWar);

    return {
      overall: [
        {
          metric: 'wOBA',
          mae: calculateMae(wobaErrors),
          rmse: calculateRmse(wobaErrors),
          bias: calculateMean(wobaErrors),
          count: matches.length,
        },
        {
          metric: 'AVG',
          mae: calculateMae(avgErrors),
          rmse: calculateRmse(avgErrors),
          bias: calculateMean(avgErrors),
          count: matches.length,
        },
        {
          metric: 'BB%',
          mae: calculateMae(bbPctErrors),
          rmse: calculateRmse(bbPctErrors),
          bias: calculateMean(bbPctErrors),
          count: matches.length,
        },
        {
          metric: 'K%',
          mae: calculateMae(kPctErrors),
          rmse: calculateRmse(kPctErrors),
          bias: calculateMean(kPctErrors),
          count: matches.length,
        },
        {
          metric: 'WAR',
          mae: calculateMae(warErrors),
          rmse: calculateRmse(warErrors),
          bias: calculateMean(warErrors),
          count: matches.length,
        },
      ],
      quartiles,
      top10: {
        avgProjectedWar: calculateMean(top10ByActual.map(m => m.projectedWar)),
        avgActualWar: calculateMean(top10ByActual.map(m => m.actualWar)),
        meanError: calculateMean(top10Errors),
        mae: calculateMae(top10Errors),
      },
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
    const metricPadded = metric.metric.padEnd(8);
    console.log(`${metricPadded}\t${metric.mae.toFixed(3)}\t${metric.rmse.toFixed(3)}\t${biasStr}\t${metric.count}`);
  }

  console.log(`\n--- QUARTILE ANALYSIS (${year}) ---\n`);
  console.log('Quartile\t\twOBA Range\t\tMAE\tRMSE\tBias\tCount');
  console.log('─'.repeat(80));
  for (const q of results.quartiles) {
    const biasStr = q.bias > 0 ? `+${q.bias.toFixed(3)}` : q.bias.toFixed(3);
    console.log(`${q.quartile}\t\t${q.wobaRange}\t\t${q.mae.toFixed(3)}\t${q.rmse.toFixed(3)}\t${biasStr}\t${q.count}`);
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
  console.log('AGGREGATED BATTER RESULTS');
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
    const metricPadded = metric.padEnd(8);
    console.log(`${metricPadded}\t${avgMae.toFixed(3)}\t\t${avgRmse.toFixed(3)}\t\t${biasStr}`);
  }

  // Aggregate quartile results
  const aggregatedQuartiles = [
    { bias: [] as number[], mae: [] as number[] },
    { bias: [] as number[], mae: [] as number[] },
    { bias: [] as number[], mae: [] as number[] },
    { bias: [] as number[], mae: [] as number[] },
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

  // Summary assessment
  console.log('\n=== SUMMARY ===');
  const wobaStats = aggregatedOverall.get('wOBA');
  if (wobaStats) {
    const avgWobaBias = calculateMean(wobaStats.bias);
    if (Math.abs(avgWobaBias) <= 0.005) {
      console.log(`✓ wOBA projections are well-calibrated (bias: ${avgWobaBias > 0 ? '+' : ''}${avgWobaBias.toFixed(3)})`);
    } else if (avgWobaBias < -0.005) {
      console.log(`⚠️  wOBA projections UNDER-ESTIMATE by ${Math.abs(avgWobaBias).toFixed(3)}`);
    } else {
      console.log(`⚠️  wOBA projections OVER-ESTIMATE by ${avgWobaBias.toFixed(3)}`);
    }
  }

  const avgRmse = calculateMean(aggregatedOverall.get('wOBA')?.rmse ?? [0]);
  console.log(`\nTypical wOBA error: ±${avgRmse.toFixed(3)} (RMSE)`);
  if (avgRmse < 0.025) {
    console.log(`✓ Excellent accuracy (RMSE < 0.025)`);
  } else if (avgRmse < 0.035) {
    console.log(`✓ Good accuracy (RMSE < 0.035)`);
  } else if (avgRmse < 0.045) {
    console.log(`~ Moderate accuracy (RMSE < 0.045)`);
  } else {
    console.log(`⚠️  High variance (RMSE >= 0.045)`);
  }
}

async function main() {
  console.log('=== Batter Projection Validation Test Suite ===\n');
  console.log('Testing year-over-year persistence for batters (200+ PA)\n');
  console.log('This uses simple regression projection from prior year stats.\n');

  const testYears = [
    { projection: 2017, actual: 2018 },
    { projection: 2018, actual: 2019 },
    { projection: 2019, actual: 2020 },
    { projection: 2020, actual: 2021 },
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

  console.log('\n✅ Batter validation complete!\n');
}

main().catch(console.error);
