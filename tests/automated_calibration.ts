/**
 * Automated Parameter Calibration
 *
 * Grid search optimization to find optimal league averages and regression ratios.
 * Mocks localStorage to allow Node.js testing.
 *
 * USAGE: npx tsx tests/automated_calibration.ts
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

import { trueRatingsCalculationService } from '../src/services/TrueRatingsCalculationService';
import { PotentialStatsService } from '../src/services/PotentialStatsService';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = 'https://atl-01.statsplus.net/world/api';

interface HistoricalData {
  player_id: number;
  year: number;
  // Prior year stats (for projection input)
  priorK9: number;
  priorBb9: number;
  priorHr9: number;
  priorIp: number;
  priorFip: number;
  // Actual next year performance (validation target)
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
  top10WarError: number;
  loss: number;
}

function parseIp(ip: string): number {
  const parts = ip.split('.');
  if (parts.length === 1) return parseInt(ip);
  const whole = parseInt(parts[0]) || 0;
  const third = parseInt(parts[1]) || 0;
  return whole + third / 3;
}

async function fetchHistoricalData(startYear: number, endYear: number): Promise<HistoricalData[]> {
  console.log('Fetching historical data...\n');
  const data: HistoricalData[] = [];

  for (let year = startYear; year <= endYear - 1; year++) {
    const priorYear = year;
    const actualYear = year + 1;

    console.log(`Fetching ${priorYear} (prior) and ${actualYear} (actual)...`);

    // Fetch both years
    const [priorStats, actualStats] = await Promise.all([
      fetchYearStats(priorYear),
      fetchYearStats(actualYear)
    ]);

    // Match players who appeared in both years with 60+ IP (matching test conditions)
    for (const [playerId, prior] of priorStats.entries()) {
      const actual = actualStats.get(playerId);
      if (!actual) continue;
      if (prior.ip < 60 || actual.ip < 60) continue;

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

    console.log(`  Matched ${data.filter(d => d.year === actualYear).length} pitchers\n`);
  }

  console.log(`Total samples: ${data.length}\n`);
  return data;
}

async function fetchYearStats(year: number): Promise<Map<number, any>> {
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
    if (ip < 60) continue;

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

/**
 * Simulate projection with given parameters
 * Uses simplified regression logic from TrueRatingsCalculationService
 */
function simulateProjection(
  historical: HistoricalData,
  params: CalibrationParams
): { k9: number; bb9: number; hr9: number; fip: number } {
  // Determine targetOffset based on historical FIP
  const targetOffset = calculateTargetOffset(historical.priorFip);

  // Calculate regression targets
  const k9Target = params.avgK9 - (targetOffset * params.k9Ratio);
  const bb9Target = params.avgBb9 + (targetOffset * params.bb9Ratio);
  const hr9Target = params.avgHr9 + (targetOffset * params.hr9Ratio);

  // Apply regression (simplified - use 30% regression strength)
  // Real system uses IP-weighted regression, but this is close enough
  const regressionStrength = 0.30;

  const k9 = historical.priorK9 * (1 - regressionStrength) + k9Target * regressionStrength;
  const bb9 = historical.priorBb9 * (1 - regressionStrength) + bb9Target * regressionStrength;
  const hr9 = historical.priorHr9 * (1 - regressionStrength) + hr9Target * regressionStrength;

  const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

  return { k9, bb9, hr9, fip };
}

/**
 * Calculate targetOffset from FIP (same as TrueRatingsCalculationService)
 */
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

function evaluateParams(params: CalibrationParams, data: HistoricalData[]): TestResult {
  // Generate projections
  const projections = data.map(d => ({
    ...d,
    ...simulateProjection(d, params)
  }));

  // Calculate errors
  const fipErrors = projections.map(p => p.fip - p.actualFip);
  const k9Errors = projections.map(p => p.k9 - p.actualK9);
  const bb9Errors = projections.map(p => p.bb9 - p.actualBb9);
  const hr9Errors = projections.map(p => p.hr9 - p.actualHr9);

  // Quartile analysis (by actual FIP)
  const sorted = [...projections].sort((a, b) => a.actualFip - b.actualFip);
  const q1Size = Math.floor(sorted.length / 4);
  const q1Data = sorted.slice(0, q1Size);
  const q4Data = sorted.slice(q1Size * 3);

  const q1FipErrors = q1Data.map(p => p.fip - p.actualFip);
  const q4FipErrors = q4Data.map(p => p.fip - p.actualFip);

  // Top 10 WAR
  const top10 = [...projections].sort((a, b) => b.actualWar - a.actualWar).slice(0, 10);
  const top10Errors = top10.map(p => {
    // Simplified WAR projection
    const projWar = Math.max(0, ((4.2 - p.fip) * p.actualIp / 9 / 9));
    return projWar - p.actualWar;
  });

  const overallFipBias = mean(fipErrors);
  const q1Bias = mean(q1FipErrors);
  const q4Bias = mean(q4FipErrors);
  const k9Bias = mean(k9Errors);
  const bb9Bias = mean(bb9Errors);
  const hr9Bias = mean(hr9Errors);
  const top10WarError = mean(top10Errors);

  // Loss function: penalize bias and spread
  // UPDATED: K/9 bias is the main problem (-0.605), so weight it heavily
  const loss =
    Math.abs(overallFipBias) * 10 +
    Math.abs(q1Bias) * 8 +
    Math.abs(q4Bias) * 8 +
    Math.abs(k9Bias) * 15 +          // Increased from 5 - K/9 is critical
    Math.abs(bb9Bias) * 6 +           // Increased from 5
    Math.abs(hr9Bias) * 3 +
    Math.abs(top10WarError) * 12 +    // Slightly reduced from 15
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
    top10WarError,
    loss
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function mae(values: number[]): number {
  return values.reduce((sum, v) => sum + Math.abs(v), 0) / values.length;
}

async function gridSearch(data: HistoricalData[]): Promise<TestResult> {
  console.log('Starting grid search...\n');

  // Define search space - EXPANDED based on K/9 over-projection issue
  const avgK9Range = [6.0, 6.2, 6.4, 6.6, 6.8, 7.0, 7.2];  // Expanded upward
  const avgBb9Range = [2.0, 2.2, 2.4, 2.6];                // Slightly reduced
  const avgHr9Range = [0.70, 0.75, 0.80, 0.85];            // Slightly reduced
  const k9RatioRange = [0.4, 0.6, 0.8, 1.0, 1.2];          // More conservative range
  const bb9RatioRange = [0.3, 0.4, 0.5, 0.6, 0.7];         // More conservative range
  const hr9RatioRange = [0.06, 0.08, 0.10, 0.12, 0.14];    // More conservative range

  const totalCombinations =
    avgK9Range.length *
    avgBb9Range.length *
    avgHr9Range.length *
    k9RatioRange.length *
    bb9RatioRange.length *
    hr9RatioRange.length;

  console.log(`Testing ${totalCombinations.toLocaleString()} parameter combinations...\n`);

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
                console.log(`\n✨ New best! (tested ${tested.toLocaleString()}/${totalCombinations.toLocaleString()})`);
                console.log(`   Loss: ${result.loss.toFixed(2)}`);
                console.log(`   Params: K9=${avgK9.toFixed(1)}, BB9=${avgBb9.toFixed(1)}, HR9=${avgHr9.toFixed(2)}`);
                console.log(`   Ratios: K9=${k9Ratio.toFixed(2)}, BB9=${bb9Ratio.toFixed(2)}, HR9=${hr9Ratio.toFixed(2)}`);
                console.log(`   Bias: Overall=${result.overallFipBias > 0 ? '+' : ''}${result.overallFipBias.toFixed(3)}, Q1=${result.q1Bias > 0 ? '+' : ''}${result.q1Bias.toFixed(3)}, Q4=${result.q4Bias > 0 ? '+' : ''}${result.q4Bias.toFixed(3)}`);
              }

              if (tested % 1000 === 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                const rate = tested / elapsed;
                const remaining = (totalCombinations - tested) / rate;
                console.log(`Progress: ${tested.toLocaleString()}/${totalCombinations.toLocaleString()} (${(tested / totalCombinations * 100).toFixed(1)}%) - ETA: ${remaining.toFixed(0)}s`);
              }
            }
          }
        }
      }
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  console.log(`\n\nGrid search complete in ${elapsed.toFixed(1)}s`);

  return bestResult!;
}

function printResults(result: TestResult) {
  console.log('\n' + '='.repeat(80));
  console.log('OPTIMIZATION COMPLETE');
  console.log('='.repeat(80));

  console.log('\n--- OPTIMAL PARAMETERS ---\n');
  console.log('League Averages:');
  console.log(`  avgK9:  ${result.params.avgK9.toFixed(2)}`);
  console.log(`  avgBb9: ${result.params.avgBb9.toFixed(2)}`);
  console.log(`  avgHr9: ${result.params.avgHr9.toFixed(2)}`);

  console.log('\nRegression Coefficient Ratios:');
  console.log(`  k9Ratio:  ${result.params.k9Ratio.toFixed(2)}`);
  console.log(`  bb9Ratio: ${result.params.bb9Ratio.toFixed(2)}`);
  console.log(`  hr9Ratio: ${result.params.hr9Ratio.toFixed(2)}`);

  console.log('\n--- ERROR METRICS ---\n');
  console.log(`Overall FIP Bias: ${result.overallFipBias > 0 ? '+' : ''}${result.overallFipBias.toFixed(3)} (MAE: ${result.overallFipMae.toFixed(3)})`);
  console.log(`Q1 (Elite) Bias:  ${result.q1Bias > 0 ? '+' : ''}${result.q1Bias.toFixed(3)}`);
  console.log(`Q4 (Below) Bias:  ${result.q4Bias > 0 ? '+' : ''}${result.q4Bias.toFixed(3)}`);
  console.log(`K/9 Bias:         ${result.k9Bias > 0 ? '+' : ''}${result.k9Bias.toFixed(3)}`);
  console.log(`BB/9 Bias:        ${result.bb9Bias > 0 ? '+' : ''}${result.bb9Bias.toFixed(3)}`);
  console.log(`HR/9 Bias:        ${result.hr9Bias > 0 ? '+' : ''}${result.hr9Bias.toFixed(3)}`);
  console.log(`Top 10 WAR Error: ${result.top10WarError > 0 ? '+' : ''}${result.top10WarError.toFixed(2)}`);
  console.log(`\nTotal Loss: ${result.loss.toFixed(2)}`);

  console.log('\n--- CODE UPDATE ---\n');
  console.log('File: src/services/TrueRatingsCalculationService.ts\n');
  console.log('Update DEFAULT_LEAGUE_AVERAGES (around line 143):');
  console.log('```typescript');
  console.log('const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = {');
  console.log(`  avgK9: ${result.params.avgK9.toFixed(2)},`);
  console.log(`  avgBb9: ${result.params.avgBb9.toFixed(2)},`);
  console.log(`  avgHr9: ${result.params.avgHr9.toFixed(2)},`);
  console.log('};');
  console.log('```\n');
  console.log('Update regression ratios (around line 465):');
  console.log('```typescript');
  console.log('case \'k9\':');
  console.log(`  regressionTarget = leagueRate - (targetOffset * ${result.params.k9Ratio.toFixed(2)});`);
  console.log('  break;');
  console.log('case \'bb9\':');
  console.log(`  regressionTarget = leagueRate + (targetOffset * ${result.params.bb9Ratio.toFixed(2)});`);
  console.log('  break;');
  console.log('case \'hr9\':');
  console.log(`  regressionTarget = leagueRate + (targetOffset * ${result.params.hr9Ratio.toFixed(2)});`);
  console.log('  break;');
  console.log('```');

  console.log('\n' + '='.repeat(80));
}

async function main() {
  console.log('=== Automated Parameter Calibration ===\n');
  console.log('Expanded data set: 2015-2020, 60+ IP (matching test conditions)\n');

  const data = await fetchHistoricalData(2015, 2020);

  if (data.length === 0) {
    console.error('No data collected! Exiting.');
    return;
  }

  const result = await gridSearch(data);
  printResults(result);
}

main().catch(console.error);
