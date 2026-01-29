/**
 * Broad Swingman Range Test: 70-130 IP
 *
 * Tests if expanding the swingman tier to 70-130 IP provides enough samples
 * for reliable calibration while maintaining distinct characteristics.
 *
 * USAGE: npx tsx tests/broad_swingman_test.ts
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
  sampleSize: number;
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
  console.log(`\nFetching ${ipLabel} IP data...`);
  const data: HistoricalData[] = [];

  for (let year = startYear; year <= endYear - 1; year++) {
    const [priorStats, actualStats] = await Promise.all([
      fetchYearStats(year, minIp, maxIp),
      fetchYearStats(year + 1, minIp, maxIp)
    ]);

    for (const [playerId, prior] of priorStats.entries()) {
      const actual = actualStats.get(playerId);
      if (!actual) continue;

      data.push({
        player_id: playerId,
        year: year + 1,
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

  console.log(`  Loaded ${data.length} pitcher-seasons`);
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

    if (ip < minIp) continue;
    if (maxIp && ip >= maxIp) continue;

    const k = parseInt(values[indices.k]) || 0;
    const bb = parseInt(values[indices.bb]) || 0;
    const hra = parseInt(values[indices.hra]) || 0;

    const k9 = (k / ip) * 9;
    const bb9 = (bb / ip) * 9;
    const hr9 = (hra / ip) * 9;
    const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

    statsMap.set(player_id, { ip, k9, bb9, hr9, fip, war: parseFloat(values[indices.war]) || 0 });
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
    loss,
    sampleSize: data.length
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

  const avgK9Range = [5.6, 5.8, 6.0, 6.2, 6.4, 6.6];
  const avgBb9Range = [2.0, 2.2, 2.4, 2.6, 2.8];
  const avgHr9Range = [0.70, 0.75, 0.80, 0.85, 0.90];
  const k9RatioRange = [0.4, 0.6, 0.8, 1.0, 1.2];
  const bb9RatioRange = [0.4, 0.5, 0.6, 0.7, 0.8];
  const hr9RatioRange = [0.10, 0.12, 0.14, 0.16, 0.18];

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
              const params: CalibrationParams = { avgK9, avgBb9, avgHr9, k9Ratio, bb9Ratio, hr9Ratio };
              const result = evaluateParams(params, data);
              tested++;

              if (!bestResult || result.loss < bestResult.loss) {
                bestResult = result;
              }

              if (tested % 2000 === 0) {
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

function printComparison(starterResult: TestResult, swingmanResult: TestResult, relieverResult: TestResult) {
  console.log('\n\n' + '='.repeat(80));
  console.log('THREE-TIER RESULTS: Starters (130+), Swingmen (70-130), Relievers (20-70)');
  console.log('='.repeat(80));

  console.log('\n--- SAMPLE SIZES ---\n');
  console.log(`Starters (130+ IP):    ${starterResult.sampleSize} pitcher-seasons`);
  console.log(`Swingmen (70-130 IP):  ${swingmanResult.sampleSize} pitcher-seasons`);
  console.log(`Relievers (20-70 IP):  ${relieverResult.sampleSize} pitcher-seasons`);

  const minViableSamples = 100;
  if (swingmanResult.sampleSize < minViableSamples) {
    console.log(`\n⚠️  WARNING: Swingman sample size (${swingmanResult.sampleSize}) may be too small for reliable calibration.`);
    console.log(`   Recommend at least ${minViableSamples} samples. Consider merging with starters or relievers.`);
  } else {
    console.log(`\n✅ All tiers have sufficient sample sizes for calibration.`);
  }

  console.log('\n--- OPTIMAL PARAMETERS ---\n');
  console.log('Parameter\t\tStarters\tSwingmen\tRelievers\tSwing Diff');
  console.log('─'.repeat(90));

  const k9Diff = Math.abs(swingmanResult.params.avgK9 - starterResult.params.avgK9);
  const bb9Diff = Math.abs(swingmanResult.params.avgBb9 - starterResult.params.avgBb9);
  const hr9Diff = Math.abs(swingmanResult.params.avgHr9 - starterResult.params.avgHr9);
  const k9RatioDiff = Math.abs(swingmanResult.params.k9Ratio - starterResult.params.k9Ratio);
  const bb9RatioDiff = Math.abs(swingmanResult.params.bb9Ratio - starterResult.params.bb9Ratio);
  const hr9RatioDiff = Math.abs(swingmanResult.params.hr9Ratio - starterResult.params.hr9Ratio);

  console.log(`avgK9\t\t\t${starterResult.params.avgK9.toFixed(2)}\t\t${swingmanResult.params.avgK9.toFixed(2)}\t\t${relieverResult.params.avgK9.toFixed(2)}\t\t${k9Diff.toFixed(2)}`);
  console.log(`avgBb9\t\t\t${starterResult.params.avgBb9.toFixed(2)}\t\t${swingmanResult.params.avgBb9.toFixed(2)}\t\t${relieverResult.params.avgBb9.toFixed(2)}\t\t${bb9Diff.toFixed(2)}`);
  console.log(`avgHr9\t\t\t${starterResult.params.avgHr9.toFixed(2)}\t\t${swingmanResult.params.avgHr9.toFixed(2)}\t\t${relieverResult.params.avgHr9.toFixed(2)}\t\t${hr9Diff.toFixed(2)}`);
  console.log(`k9Ratio\t\t\t${starterResult.params.k9Ratio.toFixed(2)}\t\t${swingmanResult.params.k9Ratio.toFixed(2)}\t\t${relieverResult.params.k9Ratio.toFixed(2)}\t\t${k9RatioDiff.toFixed(2)}`);
  console.log(`bb9Ratio\t\t${starterResult.params.bb9Ratio.toFixed(2)}\t\t${swingmanResult.params.bb9Ratio.toFixed(2)}\t\t${relieverResult.params.bb9Ratio.toFixed(2)}\t\t${bb9RatioDiff.toFixed(2)}`);
  console.log(`hr9Ratio\t\t${starterResult.params.hr9Ratio.toFixed(2)}\t\t${swingmanResult.params.hr9Ratio.toFixed(2)}\t\t${relieverResult.params.hr9Ratio.toFixed(2)}\t\t${hr9RatioDiff.toFixed(2)}`);

  console.log('\n--- ERROR METRICS ---\n');
  console.log('Metric\t\t\tStarters\tSwingmen\tRelievers');
  console.log('─'.repeat(80));
  console.log(`FIP MAE\t\t\t${starterResult.overallFipMae.toFixed(3)}\t\t${swingmanResult.overallFipMae.toFixed(3)}\t\t${relieverResult.overallFipMae.toFixed(3)}`);
  console.log(`FIP Bias\t\t${starterResult.overallFipBias > 0 ? '+' : ''}${starterResult.overallFipBias.toFixed(3)}\t\t${swingmanResult.overallFipBias > 0 ? '+' : ''}${swingmanResult.overallFipBias.toFixed(3)}\t\t${relieverResult.overallFipBias > 0 ? '+' : ''}${relieverResult.overallFipBias.toFixed(3)}`);
  console.log(`K/9 Bias\t\t${starterResult.k9Bias > 0 ? '+' : ''}${starterResult.k9Bias.toFixed(3)}\t\t${swingmanResult.k9Bias > 0 ? '+' : ''}${swingmanResult.k9Bias.toFixed(3)}\t\t${relieverResult.k9Bias > 0 ? '+' : ''}${relieverResult.k9Bias.toFixed(3)}`);
  console.log(`BB/9 Bias\t\t${starterResult.bb9Bias > 0 ? '+' : ''}${starterResult.bb9Bias.toFixed(3)}\t\t${swingmanResult.bb9Bias > 0 ? '+' : ''}${swingmanResult.bb9Bias.toFixed(3)}\t\t${relieverResult.bb9Bias > 0 ? '+' : ''}${relieverResult.bb9Bias.toFixed(3)}`);
  console.log(`HR/9 Bias\t\t${starterResult.hr9Bias > 0 ? '+' : ''}${starterResult.hr9Bias.toFixed(3)}\t\t${swingmanResult.hr9Bias > 0 ? '+' : ''}${swingmanResult.hr9Bias.toFixed(3)}\t\t${relieverResult.hr9Bias > 0 ? '+' : ''}${relieverResult.hr9Bias.toFixed(3)}`);

  console.log('\n--- RECOMMENDATION ---\n');

  const avgParamDiff = (k9Diff + bb9Diff + hr9Diff + k9RatioDiff + bb9RatioDiff + hr9RatioDiff) / 6;

  if (swingmanResult.sampleSize < minViableSamples) {
    console.log('❌ Swingman tier has insufficient samples.');
    console.log('   RECOMMEND: Use 2-tier system (Starters 130+, Everyone else <130)');
  } else if (avgParamDiff > 0.25) {
    console.log('✅ Swingmen parameters differ significantly from starters.');
    console.log(`   Avg parameter difference: ${avgParamDiff.toFixed(2)}`);
    console.log('   RECOMMEND: Use 3-tier system with separate parameters.');
  } else {
    console.log('⚠️  Swingmen parameters are similar to starters.');
    console.log(`   Avg parameter difference: ${avgParamDiff.toFixed(2)}`);
    console.log('   RECOMMEND: Consider merging swingmen with starters (simpler 2-tier system).');
  }

  console.log('\n' + '='.repeat(80));
}

async function main() {
  console.log('=== Broad Swingman Range Test: 70-130 IP ===\n');

  const [starterData, swingmanData, relieverData] = await Promise.all([
    fetchHistoricalData(2015, 2020, 130),        // Starters: 130+ IP
    fetchHistoricalData(2015, 2020, 70, 130),    // Swingmen: 70-130 IP
    fetchHistoricalData(2015, 2020, 20, 70)      // Relievers: 20-70 IP
  ]);

  const [starterResult, swingmanResult, relieverResult] = await Promise.all([
    gridSearch(starterData, 'Starters (130+ IP)'),
    gridSearch(swingmanData, 'Swingmen (70-130 IP)'),
    gridSearch(relieverData, 'Relievers (20-70 IP)')
  ]);

  printComparison(starterResult, swingmanResult, relieverResult);
}

main().catch(console.error);
