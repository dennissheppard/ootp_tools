/**
 * Split Parameter Calibration: Starters vs Swingmen
 *
 * Runs separate optimizations for 100+ IP (starters) and 60-100 IP (swingmen)
 * to determine if they need different regression parameters.
 *
 * USAGE: npx tsx tests/split_calibration.ts
 */

// Mock localStorage for Node.js environment
(global as any).localStorage = {
  data: {} as Record<string, string>,
  getItem(key: string) {
    return this.data[key] || null;
  },
  setItem(key: string, value: string) {
    this.data[key] = value;
  },
  removeItem(key: string) {
    delete this.data[key];
  },
  clear() {
    this.data = {};
  }
};

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface HistoricalData {
  player_id: number;
  year: number;
  priorK9: number;
  priorBb9: number;
  priorHr9: number;
  priorIp: number;
  priorFip: number;
  actualK9: number;
  actualBb9: number;
  actualHr9: number;
  actualFip: number;
  actualWar: number;
  actualIp: number;
}

interface CalibrationParams {
  avgK9: number;
  avgBb9: number;
  avgHr9: number;
  k9Ratio: number;
  bb9Ratio: number;
  hr9Ratio: number;
}

interface TestResult {
  params: CalibrationParams;
  overallFipBias: number;
  overallFipMae: number;
  q1Bias: number;
  q4Bias: number;
  k9Bias: number;
  bb9Bias: number;
  hr9Bias: number;
  loss: number;
}

function parseIp(ip: string): number {
  const parts = ip.split('.');
  if (parts.length === 1) return parseInt(ip);
  const whole = parseInt(parts[0]) || 0;
  const third = parseInt(parts[1]) || 0;
  return whole + third / 3;
}

async function fetchHistoricalData(startYear: number, endYear: number, minIp: number, maxIp?: number): Promise<HistoricalData[]> {
  const ipLabel = maxIp ? `${minIp}-${maxIp}` : `${minIp}+`;
  console.log(`Fetching historical data (${ipLabel} IP)...`);
  const data: HistoricalData[] = [];

  for (let year = startYear; year <= endYear - 1; year++) {
    const priorYear = year;
    const actualYear = year + 1;

    const [priorStats, actualStats] = await Promise.all([
      fetchYearStats(priorYear, minIp, maxIp),
      fetchYearStats(actualYear, minIp, maxIp)
    ]);

    for (const [playerId, prior] of priorStats.entries()) {
      const actual = actualStats.get(playerId);
      if (!actual) continue;

      data.push({
        player_id: playerId,
        year: actualYear,
        priorK9: prior.k9,
        priorBb9: prior.bb9,
        priorHr9: prior.hr9,
        priorIp: prior.ip,
        priorFip: prior.fip,
        actualK9: actual.k9,
        actualBb9: actual.bb9,
        actualHr9: actual.hr9,
        actualFip: actual.fip,
        actualWar: actual.war,
        actualIp: actual.ip
      });
    }
  }

  console.log(`  Loaded ${data.length} pitcher-seasons\n`);
  return data;
}

async function fetchYearStats(year: number, minIp: number, maxIp?: number): Promise<Map<number, any>> {
  const url = `${API_BASE}/playerpitchstatsv2/?year=${year}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${year}`);

  const csvText = await response.text();
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');

  const indices = {
    player_id: headers.indexOf('player_id'),
    split_id: headers.indexOf('split_id'),
    ip: headers.indexOf('ip'),
    k: headers.indexOf('k'),
    bb: headers.indexOf('bb'),
    hra: headers.indexOf('hra'),
    war: headers.indexOf('war')
  };

  const statsMap = new Map<number, any>();

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const split_id = parseInt(values[indices.split_id]);
    if (split_id !== 1) continue;

    const player_id = parseInt(values[indices.player_id]);
    const ip = parseIp(values[indices.ip]);

    // Filter by IP range
    if (ip < minIp) continue;
    if (maxIp && ip >= maxIp) continue;

    const k = parseInt(values[indices.k]) || 0;
    const bb = parseInt(values[indices.bb]) || 0;
    const hra = parseInt(values[indices.hra]) || 0;

    const k9 = (k / ip) * 9;
    const bb9 = (bb / ip) * 9;
    const hr9 = (hra / ip) * 9;
    const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

    statsMap.set(player_id, {
      ip,
      k9,
      bb9,
      hr9,
      fip,
      war: parseFloat(values[indices.war]) || 0
    });
  }

  return statsMap;
}

function calculateTargetOffset(fip: number): number {
  const breakpoints = [
    { fip: 2.5, offset: -3.0 },
    { fip: 3.0, offset: -2.8 },
    { fip: 3.5, offset: -2.0 },
    { fip: 4.0, offset: -0.8 },
    { fip: 4.2, offset: 0.0 },
    { fip: 4.5, offset: 1.0 },
    { fip: 5.0, offset: 1.5 },
    { fip: 6.0, offset: 1.5 }
  ];

  if (fip <= breakpoints[0].fip) return breakpoints[0].offset;
  if (fip >= breakpoints[breakpoints.length - 1].fip) return breakpoints[breakpoints.length - 1].offset;

  for (let i = 0; i < breakpoints.length - 1; i++) {
    const lower = breakpoints[i];
    const upper = breakpoints[i + 1];
    if (fip >= lower.fip && fip <= upper.fip) {
      const t = (fip - lower.fip) / (upper.fip - lower.fip);
      return lower.offset + t * (upper.offset - lower.offset);
    }
  }

  return 0.0;
}

function simulateProjection(
  historical: HistoricalData,
  params: CalibrationParams
): { k9: number; bb9: number; hr9: number; fip: number } {
  const targetOffset = calculateTargetOffset(historical.priorFip);

  const k9Target = params.avgK9 - (targetOffset * params.k9Ratio);
  const bb9Target = params.avgBb9 + (targetOffset * params.bb9Ratio);
  const hr9Target = params.avgHr9 + (targetOffset * params.hr9Ratio);

  const regressionStrength = 0.30;

  const k9 = historical.priorK9 * (1 - regressionStrength) + k9Target * regressionStrength;
  const bb9 = historical.priorBb9 * (1 - regressionStrength) + bb9Target * regressionStrength;
  const hr9 = historical.priorHr9 * (1 - regressionStrength) + hr9Target * regressionStrength;

  const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

  return { k9, bb9, hr9, fip };
}

function evaluateParams(params: CalibrationParams, data: HistoricalData[]): TestResult {
  const projections = data.map(d => ({
    ...d,
    ...simulateProjection(d, params)
  }));

  const fipErrors = projections.map(p => p.fip - p.actualFip);
  const k9Errors = projections.map(p => p.k9 - p.actualK9);
  const bb9Errors = projections.map(p => p.bb9 - p.actualBb9);
  const hr9Errors = projections.map(p => p.hr9 - p.actualHr9);

  const sorted = [...projections].sort((a, b) => a.actualFip - b.actualFip);
  const q1Size = Math.floor(sorted.length / 4);
  const q1Data = sorted.slice(0, q1Size);
  const q4Data = sorted.slice(q1Size * 3);

  const q1FipErrors = q1Data.map(p => p.fip - p.actualFip);
  const q4FipErrors = q4Data.map(p => p.fip - p.actualFip);

  const overallFipBias = mean(fipErrors);
  const q1Bias = mean(q1FipErrors);
  const q4Bias = mean(q4FipErrors);
  const k9Bias = mean(k9Errors);
  const bb9Bias = mean(bb9Errors);
  const hr9Bias = mean(hr9Errors);

  const loss =
    Math.abs(overallFipBias) * 10 +
    Math.abs(q1Bias) * 8 +
    Math.abs(q4Bias) * 8 +
    Math.abs(k9Bias) * 15 +
    Math.abs(bb9Bias) * 6 +
    Math.abs(hr9Bias) * 3 +
    mae(fipErrors) * 2;

  return {
    params,
    overallFipBias,
    overallFipMae: mae(fipErrors),
    q1Bias,
    q4Bias,
    k9Bias,
    bb9Bias,
    hr9Bias,
    loss
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function mae(values: number[]): number {
  return values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;
}

async function gridSearch(data: HistoricalData[], label: string): Promise<TestResult> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`GRID SEARCH: ${label}`);
  console.log('='.repeat(80));

  const avgK9Range = [5.8, 6.0, 6.2, 6.4, 6.6, 6.8, 7.0];
  const avgBb9Range = [1.8, 2.0, 2.2, 2.4, 2.6];
  const avgHr9Range = [0.65, 0.70, 0.75, 0.80, 0.85];
  const k9RatioRange = [0.4, 0.6, 0.8, 1.0, 1.2, 1.4];
  const bb9RatioRange = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const hr9RatioRange = [0.06, 0.08, 0.10, 0.12, 0.14, 0.16];

  const totalCombinations =
    avgK9Range.length *
    avgBb9Range.length *
    avgHr9Range.length *
    k9RatioRange.length *
    bb9RatioRange.length *
    hr9RatioRange.length;

  console.log(`Testing ${totalCombinations.toLocaleString()} parameter combinations on ${data.length} pitcher-seasons\n`);

  let bestResult: TestResult | null = null;
  let tested = 0;
  const startTime = Date.now();

  for (const avgK9 of avgK9Range) {
    for (const avgBb9 of avgBb9Range) {
      for (const avgHr9 of avgHr9Range) {
        for (const k9Ratio of k9RatioRange) {
          for (const bb9Ratio of bb9RatioRange) {
            for (const hr9Ratio of hr9RatioRange) {
              const params: CalibrationParams = {
                avgK9,
                avgBb9,
                avgHr9,
                k9Ratio,
                bb9Ratio,
                hr9Ratio
              };

              const result = evaluateParams(params, data);
              tested++;

              if (!bestResult || result.loss < bestResult.loss) {
                bestResult = result;
              }

              if (tested % 5000 === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                const pct = (tested / totalCombinations * 100).toFixed(1);
                console.log(`Progress: ${tested.toLocaleString()}/${totalCombinations.toLocaleString()} (${pct}%)`);
              }
            }
          }
        }
      }
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\nComplete in ${elapsed.toFixed(1)}s`);

  return bestResult!;
}

function printComparison(starterResult: TestResult, swingmanResult: TestResult) {
  console.log('\n\n' + '='.repeat(80));
  console.log('RESULTS COMPARISON');
  console.log('='.repeat(80));

  console.log('\n--- OPTIMAL PARAMETERS ---\n');

  console.log('Parameter\t\t\tStarters (100+ IP)\tSwingmen (60-100 IP)\tDifference');
  console.log('─'.repeat(80));
  console.log(`avgK9\t\t\t\t${starterResult.params.avgK9.toFixed(2)}\t\t\t${swingmanResult.params.avgK9.toFixed(2)}\t\t\t${(swingmanResult.params.avgK9 - starterResult.params.avgK9).toFixed(2)}`);
  console.log(`avgBb9\t\t\t\t${starterResult.params.avgBb9.toFixed(2)}\t\t\t${swingmanResult.params.avgBb9.toFixed(2)}\t\t\t${(swingmanResult.params.avgBb9 - starterResult.params.avgBb9).toFixed(2)}`);
  console.log(`avgHr9\t\t\t\t${starterResult.params.avgHr9.toFixed(2)}\t\t\t${swingmanResult.params.avgHr9.toFixed(2)}\t\t\t${(swingmanResult.params.avgHr9 - starterResult.params.avgHr9).toFixed(2)}`);
  console.log(`k9Ratio\t\t\t\t${starterResult.params.k9Ratio.toFixed(2)}\t\t\t${swingmanResult.params.k9Ratio.toFixed(2)}\t\t\t${(swingmanResult.params.k9Ratio - starterResult.params.k9Ratio).toFixed(2)}`);
  console.log(`bb9Ratio\t\t\t${starterResult.params.bb9Ratio.toFixed(2)}\t\t\t${swingmanResult.params.bb9Ratio.toFixed(2)}\t\t\t${(swingmanResult.params.bb9Ratio - starterResult.params.bb9Ratio).toFixed(2)}`);
  console.log(`hr9Ratio\t\t\t${starterResult.params.hr9Ratio.toFixed(2)}\t\t\t${swingmanResult.params.hr9Ratio.toFixed(2)}\t\t\t${(swingmanResult.params.hr9Ratio - starterResult.params.hr9Ratio).toFixed(2)}`);

  console.log('\n--- ERROR METRICS ---\n');

  console.log('Metric\t\t\t\tStarters (100+ IP)\tSwingmen (60-100 IP)');
  console.log('─'.repeat(80));
  console.log(`Overall FIP Bias\t\t${starterResult.overallFipBias > 0 ? '+' : ''}${starterResult.overallFipBias.toFixed(3)}\t\t\t${swingmanResult.overallFipBias > 0 ? '+' : ''}${swingmanResult.overallFipBias.toFixed(3)}`);
  console.log(`Overall FIP MAE\t\t\t${starterResult.overallFipMae.toFixed(3)}\t\t\t${swingmanResult.overallFipMae.toFixed(3)}`);
  console.log(`Q1 (Elite) Bias\t\t\t${starterResult.q1Bias > 0 ? '+' : ''}${starterResult.q1Bias.toFixed(3)}\t\t\t${swingmanResult.q1Bias > 0 ? '+' : ''}${swingmanResult.q1Bias.toFixed(3)}`);
  console.log(`Q4 (Below) Bias\t\t\t${starterResult.q4Bias > 0 ? '+' : ''}${starterResult.q4Bias.toFixed(3)}\t\t\t${swingmanResult.q4Bias > 0 ? '+' : ''}${swingmanResult.q4Bias.toFixed(3)}`);
  console.log(`K/9 Bias\t\t\t${starterResult.k9Bias > 0 ? '+' : ''}${starterResult.k9Bias.toFixed(3)}\t\t\t${swingmanResult.k9Bias > 0 ? '+' : ''}${swingmanResult.k9Bias.toFixed(3)}`);
  console.log(`BB/9 Bias\t\t\t${starterResult.bb9Bias > 0 ? '+' : ''}${starterResult.bb9Bias.toFixed(3)}\t\t\t${swingmanResult.bb9Bias > 0 ? '+' : ''}${swingmanResult.bb9Bias.toFixed(3)}`);
  console.log(`HR/9 Bias\t\t\t${starterResult.hr9Bias > 0 ? '+' : ''}${starterResult.hr9Bias.toFixed(3)}\t\t\t${swingmanResult.hr9Bias > 0 ? '+' : ''}${swingmanResult.hr9Bias.toFixed(3)}`);
  console.log(`Total Loss\t\t\t${starterResult.loss.toFixed(2)}\t\t\t${swingmanResult.loss.toFixed(2)}`);

  console.log('\n--- ANALYSIS ---\n');

  const paramDiffs = [
    Math.abs(swingmanResult.params.avgK9 - starterResult.params.avgK9),
    Math.abs(swingmanResult.params.avgBb9 - starterResult.params.avgBb9),
    Math.abs(swingmanResult.params.avgHr9 - starterResult.params.avgHr9),
    Math.abs(swingmanResult.params.k9Ratio - starterResult.params.k9Ratio),
    Math.abs(swingmanResult.params.bb9Ratio - starterResult.params.bb9Ratio),
    Math.abs(swingmanResult.params.hr9Ratio - starterResult.params.hr9Ratio)
  ];

  const maxDiff = Math.max(...paramDiffs);
  const avgDiff = paramDiffs.reduce((a, b) => a + b, 0) / paramDiffs.length;

  console.log(`Max parameter difference: ${maxDiff.toFixed(2)}`);
  console.log(`Avg parameter difference: ${avgDiff.toFixed(2)}\n`);

  if (maxDiff > 0.3) {
    console.log('✅ RECOMMENDATION: Use separate parameters for starters vs swingmen');
    console.log('   The optimal parameters differ significantly between groups.');
  } else if (maxDiff > 0.15) {
    console.log('⚠️  RECOMMENDATION: Consider separate parameters');
    console.log('   Parameters differ moderately - may be worth the complexity.');
  } else {
    console.log('❌ RECOMMENDATION: Use unified parameters');
    console.log('   Parameters are very similar - splitting adds complexity without benefit.');
  }

  console.log('\n--- STARTER PARAMETERS (RECOMMENDED) ---\n');
  console.log('Use these for your main projection system (starters matter most):\n');
  console.log('```typescript');
  console.log('const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = {');
  console.log(`  avgK9: ${starterResult.params.avgK9.toFixed(2)},`);
  console.log(`  avgBb9: ${starterResult.params.avgBb9.toFixed(2)},`);
  console.log(`  avgHr9: ${starterResult.params.avgHr9.toFixed(2)},`);
  console.log('};');
  console.log('');
  console.log(`case 'k9':  regressionTarget = leagueRate - (targetOffset * ${starterResult.params.k9Ratio.toFixed(2)});`);
  console.log(`case 'bb9': regressionTarget = leagueRate + (targetOffset * ${starterResult.params.bb9Ratio.toFixed(2)});`);
  console.log(`case 'hr9': regressionTarget = leagueRate + (targetOffset * ${starterResult.params.hr9Ratio.toFixed(2)});`);
  console.log('```');

  console.log('\n' + '='.repeat(80));
}

async function main() {
  console.log('=== Split Parameter Calibration ===');
  console.log('Comparing optimal parameters for Starters (100+ IP) vs Swingmen (60-100 IP)\n');

  const [starterData, swingmanData] = await Promise.all([
    fetchHistoricalData(2015, 2020, 100),        // 100+ IP
    fetchHistoricalData(2015, 2020, 60, 100)     // 60-100 IP
  ]);

  if (starterData.length === 0 || swingmanData.length === 0) {
    console.error('Failed to load data! Exiting.');
    return;
  }

  const [starterResult, swingmanResult] = await Promise.all([
    gridSearch(starterData, 'Starters (100+ IP)'),
    gridSearch(swingmanData, 'Swingmen (60-100 IP)')
  ]);

  printComparison(starterResult, swingmanResult);
}

main().catch(console.error);
