/**
 * TFR Validation Analysis
 *
 * Validates True Future Rating accuracy by comparing prospect TFRs
 * to their actual MLB performance.
 *
 * Key Questions:
 * 1. Do TFR ratings match actual MLB True Ratings?
 * 2. Are we creating too many 5.0s or too few?
 * 3. Do projected FIPs match actual FIPs?
 * 4. How accurate are our level adjustments?
 * 5. Does age matter (should we apply age adjustments)?
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

// ============================================================================
// Interfaces
// ============================================================================

interface ProspectTFR {
  playerId: number;
  name: string;
  year: number; // Year of projection
  age: number;
  level: string;
  trueFutureRating: number;
  projK9: number;
  projBb9: number;
  projHr9: number;
  projFip: number;
  scoutingWeight: number;
  totalMinorIp: number;
}

interface MLBActuals {
  playerId: number;
  year: number;
  ip: number;
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
  trueRating?: number;
}

interface ValidationResult {
  playerId: number;
  name: string;
  prospectYear: number; // Year TFR was calculated
  mlbYear: number; // Year of MLB performance
  yearsToMlb: number; // How long it took to reach MLB

  // At time of projection
  age: number;
  level: string;
  tfr: number;
  projFip: number;

  // Actual MLB performance
  actualFip: number;
  actualTrueRating?: number;
  actualIp: number;

  // Errors
  fipError: number; // actual - projected
  ratingError?: number; // actual TR - TFR
}

interface TFRMetrics {
  count: number;
  mae: number; // Mean absolute error
  rmse: number; // Root mean squared error
  bias: number; // Average error (actual - projected)

  // TFR distribution
  tfrDistribution: {
    elite: number; // 4.5+
    aboveAvg: number; // 3.5-4.0
    average: number; // 2.5-3.0
    fringe: number; // 2.0-2.5
    poor: number; // < 2.0
  };

  // Success rates
  mlbRate: number; // % who reached MLB (50+ IP)
  successRate: number; // % who had FIP < 4.50
}

interface AgeGroupMetrics {
  age: string;
  count: number;
  mae: number;
  bias: number;
  mlbRate: number;
}

interface LevelMetrics {
  level: string;
  count: number;
  mae: number;
  bias: number;
  mlbRate: number;
  yearsToMlb: number; // Average years to reach MLB
}

interface TFRValidationReport {
  overall: TFRMetrics;
  byAge: Map<string, TFRMetrics>;
  byLevel: Map<string, TFRMetrics>;
  byTFR: Map<string, TFRMetrics>; // Group by TFR tier
  details: ValidationResult[];
}

// ============================================================================
// Data Loading
// ============================================================================

function loadCSV(filePath: string): any[] {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    console.warn(`File not found: ${fullPath}`);
    return [];
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true });
}

function loadMLBStats(year: number): MLBActuals[] {
  const rows = loadCSV(`public/data/mlb/${year}.csv`);
  return rows.map(row => {
    const ip = parseIp(row.IP);
    const k = parseInt(row.K, 10);
    const bb = parseInt(row.BB, 10);
    const hr = parseInt(row.HRA, 10);

    return {
      playerId: parseInt(row.ID, 10),
      year,
      ip,
      k9: (k / ip) * 9,
      bb9: (bb / ip) * 9,
      hr9: (hr / ip) * 9,
      fip: calculateFip(k, bb, hr, ip)
    };
  });
}

function parseIp(ipString: string): number {
  const [full, partial] = ipString.split('.');
  return parseInt(full, 10) + (partial ? parseInt(partial, 10) / 3 : 0);
}

function calculateFip(k: number, bb: number, hr: number, ip: number): number {
  const k9 = (k / ip) * 9;
  const bb9 = (bb / ip) * 9;
  const hr9 = (hr / ip) * 9;
  return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;
}

// ============================================================================
// TFR Data Collection
// ============================================================================

/**
 * NOTE: This is a placeholder. In reality, you'd need to:
 * 1. Run TFR calculations for historical years (2012-2019)
 * 2. Save the results to JSON files
 * 3. Load those files here
 *
 * For now, we'll just outline the validation logic.
 */
function loadHistoricalTFRs(year: number): ProspectTFR[] {
  // TODO: Implement loading of historical TFR data
  // This would require running TrueFutureRatingService for each historical year
  // and saving the results

  const filePath = `tools/reports/tfr_${year}.json`;
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`TFR data not found for ${year}. Run TFR generation first.`);
    return [];
  }

  const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  return data.prospects || [];
}

// ============================================================================
// Validation Logic
// ============================================================================

function validateTFR(startYear: number, endYear: number): TFRValidationReport {
  const results: ValidationResult[] = [];

  // Load all MLB actuals (we'll look forward 1-5 years for each prospect)
  const mlbActualsMap = new Map<number, Map<number, MLBActuals>>();
  for (let year = startYear; year <= endYear + 5; year++) {
    const actuals = loadMLBStats(year);
    actuals.forEach(actual => {
      if (!mlbActualsMap.has(actual.playerId)) {
        mlbActualsMap.set(actual.playerId, new Map());
      }
      mlbActualsMap.get(actual.playerId)!.set(actual.year, actual);
    });
  }

  // For each year, load TFRs and match to future MLB performance
  for (let prospectYear = startYear; prospectYear <= endYear; prospectYear++) {
    const prospects = loadHistoricalTFRs(prospectYear);

    for (const prospect of prospects) {
      const playerActuals = mlbActualsMap.get(prospect.playerId);
      if (!playerActuals) continue;

      // Find first MLB season with 50+ IP within 5 years
      let mlbActual: MLBActuals | null = null;
      let mlbYear = prospectYear + 1;

      for (let lookAhead = 1; lookAhead <= 5; lookAhead++) {
        const checkYear = prospectYear + lookAhead;
        const actual = playerActuals.get(checkYear);

        if (actual && actual.ip >= 50) {
          mlbActual = actual;
          mlbYear = checkYear;
          break;
        }
      }

      if (!mlbActual) continue; // Never reached MLB or not enough IP

      results.push({
        playerId: prospect.playerId,
        name: prospect.name,
        prospectYear,
        mlbYear,
        yearsToMlb: mlbYear - prospectYear,
        age: prospect.age,
        level: prospect.level,
        tfr: prospect.trueFutureRating,
        projFip: prospect.projFip,
        actualFip: mlbActual.fip,
        actualTrueRating: mlbActual.trueRating,
        actualIp: mlbActual.ip,
        fipError: mlbActual.fip - prospect.projFip,
        ratingError: mlbActual.trueRating ? mlbActual.trueRating - prospect.trueFutureRating : undefined
      });
    }
  }

  // Calculate metrics
  const overall = calculateMetrics(results);
  const byAge = groupAndCalculate(results, r => getAgeGroup(r.age));
  const byLevel = groupAndCalculate(results, r => r.level);
  const byTFR = groupAndCalculate(results, r => getTFRTier(r.tfr));

  return { overall, byAge, byLevel, byTFR, details: results };
}

function calculateMetrics(results: ValidationResult[]): TFRMetrics {
  if (results.length === 0) {
    return {
      count: 0,
      mae: 0,
      rmse: 0,
      bias: 0,
      tfrDistribution: { elite: 0, aboveAvg: 0, average: 0, fringe: 0, poor: 0 },
      mlbRate: 0,
      successRate: 0
    };
  }

  const errors = results.map(r => r.fipError);
  const absErrors = errors.map(e => Math.abs(e));

  const mae = absErrors.reduce((a, b) => a + b, 0) / errors.length;
  const rmse = Math.sqrt(errors.map(e => e * e).reduce((a, b) => a + b, 0) / errors.length);
  const bias = errors.reduce((a, b) => a + b, 0) / errors.length;

  // TFR distribution (only from results, not all prospects)
  const elite = results.filter(r => r.tfr >= 4.5).length;
  const aboveAvg = results.filter(r => r.tfr >= 3.5 && r.tfr < 4.5).length;
  const average = results.filter(r => r.tfr >= 2.5 && r.tfr < 3.5).length;
  const fringe = results.filter(r => r.tfr >= 2.0 && r.tfr < 2.5).length;
  const poor = results.filter(r => r.tfr < 2.0).length;

  // Success rate (FIP < 4.50 in MLB = useful pitcher)
  const successRate = results.filter(r => r.actualFip < 4.50).length / results.length;

  return {
    count: results.length,
    mae,
    rmse,
    bias,
    tfrDistribution: { elite, aboveAvg, average, fringe, poor },
    mlbRate: 1.0, // By definition 100% (we filtered for MLB players)
    successRate
  };
}

function groupAndCalculate<K>(
  results: ValidationResult[],
  keyFn: (r: ValidationResult) => K
): Map<string, TFRMetrics> {
  const grouped = new Map<string, ValidationResult[]>();

  results.forEach(r => {
    const key = String(keyFn(r));
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  });

  const metrics = new Map<string, TFRMetrics>();
  grouped.forEach((group, key) => {
    metrics.set(key, calculateMetrics(group));
  });

  return metrics;
}

function getAgeGroup(age: number): string {
  if (age <= 22) return '≤22';
  if (age <= 25) return '23-25';
  if (age <= 28) return '26-28';
  return '29+';
}

function getTFRTier(tfr: number): string {
  if (tfr >= 4.5) return 'Elite (4.5+)';
  if (tfr >= 3.5) return 'Above Avg (3.5-4.0)';
  if (tfr >= 2.5) return 'Average (2.5-3.0)';
  if (tfr >= 2.0) return 'Fringe (2.0-2.5)';
  return 'Poor (<2.0)';
}

// ============================================================================
// Reporting
// ============================================================================

function generateReport(report: TFRValidationReport): void {
  console.log('\n='.repeat(80));
  console.log('TFR VALIDATION REPORT');
  console.log('='.repeat(80));

  console.log('\n## OVERALL METRICS');
  console.log(`Prospects who reached MLB: ${report.overall.count}`);
  console.log(`Mean Absolute Error (FIP): ${report.overall.mae.toFixed(3)}`);
  console.log(`RMSE: ${report.overall.rmse.toFixed(3)}`);
  console.log(`Bias: ${report.overall.bias > 0 ? '+' : ''}${report.overall.bias.toFixed(3)} (${report.overall.bias > 0 ? 'over-projecting' : 'under-projecting'})`);
  console.log(`Success Rate (FIP < 4.50): ${(report.overall.successRate * 100).toFixed(1)}%`);

  console.log('\n## TFR DISTRIBUTION');
  const dist = report.overall.tfrDistribution;
  console.log(`Elite (4.5+):      ${dist.elite} (${(dist.elite / report.overall.count * 100).toFixed(1)}%)`);
  console.log(`Above Avg (3.5+):  ${dist.aboveAvg} (${(dist.aboveAvg / report.overall.count * 100).toFixed(1)}%)`);
  console.log(`Average (2.5+):    ${dist.average} (${(dist.average / report.overall.count * 100).toFixed(1)}%)`);
  console.log(`Fringe (2.0+):     ${dist.fringe} (${(dist.fringe / report.overall.count * 100).toFixed(1)}%)`);
  console.log(`Poor (<2.0):       ${dist.poor} (${(dist.poor / report.overall.count * 100).toFixed(1)}%)`);

  console.log('\n## BY AGE GROUP');
  const ageGroups = Array.from(report.byAge.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  ageGroups.forEach(([age, metrics]) => {
    console.log(`\n${age}: N=${metrics.count}`);
    console.log(`  MAE: ${metrics.mae.toFixed(3)}, Bias: ${metrics.bias > 0 ? '+' : ''}${metrics.bias.toFixed(3)}`);
    console.log(`  Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  });

  console.log('\n## BY LEVEL');
  const levels = ['AAA', 'AA', 'A', 'Rookie'];
  levels.forEach(level => {
    const metrics = report.byLevel.get(level);
    if (!metrics) return;

    console.log(`\n${level}: N=${metrics.count}`);
    console.log(`  MAE: ${metrics.mae.toFixed(3)}, Bias: ${metrics.bias > 0 ? '+' : ''}${metrics.bias.toFixed(3)}`);
    console.log(`  Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  });

  console.log('\n## BY TFR TIER');
  report.byTFR.forEach((metrics, tier) => {
    console.log(`\n${tier}: N=${metrics.count}`);
    console.log(`  MAE: ${metrics.mae.toFixed(3)}, Bias: ${metrics.bias > 0 ? '+' : ''}${metrics.bias.toFixed(3)}`);
    console.log(`  Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  });

  console.log('\n## BIGGEST MISSES (Top 10)');
  const sorted = [...report.details].sort((a, b) => Math.abs(b.fipError) - Math.abs(a.fipError));
  sorted.slice(0, 10).forEach((r, i) => {
    console.log(`${i + 1}. ${r.name} (${r.prospectYear})`);
    console.log(`   TFR: ${r.tfr.toFixed(1)}, Proj FIP: ${r.projFip.toFixed(2)}, Actual: ${r.actualFip.toFixed(2)}`);
    console.log(`   Error: ${r.fipError > 0 ? '+' : ''}${r.fipError.toFixed(2)} (${r.age}yo ${r.level}, reached MLB in ${r.yearsToMlb} years)`);
  });

  // Save detailed results
  const outputPath = path.join(process.cwd(), 'tools/reports/tfr_validation.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\nDetailed results saved to: ${outputPath}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('TFR Validation Analysis');
  console.log('This validates True Future Rating projections against actual MLB performance.\n');

  // Validate 2012-2019 (gives us 2013-2024 actuals to compare)
  const report = validateTFR(2012, 2019);

  generateReport(report);
}

main().catch(console.error);
