/**
 * Calibrate power coefficient based on actual HR data
 *
 * Calculates optimal intercept and slope to match actual top HR leaders
 * from recent years (weighted toward current environment)
 *
 * Run with: npx tsx tools/calibrate_power_coefficient.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface BattingStats {
  player_id: number;
  year: number;
  pa: number;
  hr: number;
}

// Read batting stats from CSV
function loadBattingStats(year: number): BattingStats[] {
  const filePath = path.join(__dirname, '..', 'public', 'data', 'mlb_batting', `${year}_batting.csv`);

  if (!fs.existsSync(filePath)) {
    return [];
  }

  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
  });

  return records.map((r: any) => ({
    player_id: r.player_id,
    year: r.year,
    pa: r.pa,
    hr: r.hr,
  }));
}

// Read player names
function loadPlayerNames(): Map<number, string> {
  const dobPath = path.join(__dirname, '..', 'public', 'data', 'mlb_dob.csv');

  if (!fs.existsSync(dobPath)) {
    return new Map();
  }

  const csvContent = fs.readFileSync(dobPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    cast: true,
  });

  const nameMap = new Map<number, string>();
  records.forEach((r: any) => {
    if (r.player_id && r.first_name && r.last_name) {
      nameMap.set(r.player_id, `${r.first_name} ${r.last_name}`);
    }
  });

  return nameMap;
}

async function calibratePowerCoefficient() {
  console.log('='.repeat(120));
  console.log('POWER COEFFICIENT CALIBRATION');
  console.log('='.repeat(120));
  console.log('');

  // Analyze multiple year ranges to see the trend
  const yearRanges = [
    { name: 'All years (2015-2020)', years: [2015, 2016, 2017, 2018, 2019, 2020], weight: 1.0 },
    { name: 'Recent years (2018-2020)', years: [2018, 2019, 2020], weight: 1.0 },
    { name: 'Most recent (2019-2020)', years: [2019, 2020], weight: 1.0 },
  ];

  for (const range of yearRanges) {
    console.log(`\n${'='.repeat(120)}`);
    console.log(`Analysis: ${range.name}`);
    console.log('='.repeat(120));

    const allHRPcts: number[] = [];
    const playerNames = loadPlayerNames();

    // Collect top 3 HR leaders from each year
    for (const year of range.years) {
      const battingStats = loadBattingStats(year);
      if (battingStats.length === 0) continue;

      const top3 = battingStats
        .filter(b => b.pa >= 400)
        .sort((a, b) => b.hr - a.hr)
        .slice(0, 3);

      top3.forEach(b => {
        const hrPct = (b.hr / b.pa) * 100;
        allHRPcts.push(hrPct);
      });
    }

    if (allHRPcts.length === 0) continue;

    // Calculate statistics
    const avgHRPct = allHRPcts.reduce((sum, pct) => sum + pct, 0) / allHRPcts.length;
    const maxHRPct = Math.max(...allHRPcts);
    const minHRPct = Math.min(...allHRPcts);
    const p90HRPct = allHRPcts.sort((a, b) => b - a)[Math.floor(allHRPcts.length * 0.1)];
    const p10HRPct = allHRPcts.sort((a, b) => b - a)[Math.floor(allHRPcts.length * 0.9)];

    console.log(`\nTop 3 HR Leaders HR% Distribution (${allHRPcts.length} player-seasons):`);
    console.log(`  Average: ${avgHRPct.toFixed(2)}%`);
    console.log(`  Range: ${minHRPct.toFixed(2)}% - ${maxHRPct.toFixed(2)}%`);
    console.log(`  90th percentile: ${p90HRPct.toFixed(2)}%`);
    console.log(`  10th percentile: ${p10HRPct.toFixed(2)}%`);

    // Calculate coefficient options
    // Assumption: Top HR leaders should have power ratings between 75-80
    // Let's target 80 power → average top-3 HR%
    //          and 70 power → 10th percentile HR%

    console.log('\n' + '-'.repeat(120));
    console.log('COEFFICIENT OPTIONS:');
    console.log('-'.repeat(120));

    // Option 1: 80 power = average top-3 HR%, 70 power = 10th percentile
    const slope1 = (avgHRPct - p10HRPct) / (80 - 70);
    const intercept1 = avgHRPct - slope1 * 80;

    console.log(`\nOption 1: Calibrate to average (conservative)`);
    console.log(`  Map 80 power → ${avgHRPct.toFixed(2)}% HR (avg top-3)`);
    console.log(`  Map 70 power → ${p10HRPct.toFixed(2)}% HR (10th percentile)`);
    console.log(`  Coefficient: HR% = ${intercept1.toFixed(4)} + ${slope1.toFixed(6)} × Power`);
    console.log(`  Results:`);
    console.log(`    80 power → ${(intercept1 + slope1 * 80).toFixed(2)}% → ${Math.round((intercept1 + slope1 * 80) * 650 / 100)} HR in 650 PA`);
    console.log(`    75 power → ${(intercept1 + slope1 * 75).toFixed(2)}% → ${Math.round((intercept1 + slope1 * 75) * 650 / 100)} HR in 650 PA`);
    console.log(`    70 power → ${(intercept1 + slope1 * 70).toFixed(2)}% → ${Math.round((intercept1 + slope1 * 70) * 650 / 100)} HR in 650 PA`);
    console.log(`    50 power → ${(intercept1 + slope1 * 50).toFixed(2)}% → ${Math.round((intercept1 + slope1 * 50) * 650 / 100)} HR in 650 PA`);

    // Option 2: 80 power = 90th percentile (more aggressive, targets elite)
    const slope2 = (p90HRPct - p10HRPct) / (80 - 70);
    const intercept2 = p90HRPct - slope2 * 80;

    console.log(`\nOption 2: Calibrate to elite (aggressive)`);
    console.log(`  Map 80 power → ${p90HRPct.toFixed(2)}% HR (90th percentile)`);
    console.log(`  Map 70 power → ${p10HRPct.toFixed(2)}% HR (10th percentile)`);
    console.log(`  Coefficient: HR% = ${intercept2.toFixed(4)} + ${slope2.toFixed(6)} × Power`);
    console.log(`  Results:`);
    console.log(`    80 power → ${(intercept2 + slope2 * 80).toFixed(2)}% → ${Math.round((intercept2 + slope2 * 80) * 650 / 100)} HR in 650 PA`);
    console.log(`    75 power → ${(intercept2 + slope2 * 75).toFixed(2)}% → ${Math.round((intercept2 + slope2 * 75) * 650 / 100)} HR in 650 PA`);
    console.log(`    70 power → ${(intercept2 + slope2 * 70).toFixed(2)}% → ${Math.round((intercept2 + slope2 * 70) * 650 / 100)} HR in 650 PA`);
    console.log(`    50 power → ${(intercept2 + slope2 * 50).toFixed(2)}% → ${Math.round((intercept2 + slope2 * 50) * 650 / 100)} HR in 650 PA`);

    // Option 3: Middle ground
    const slope3 = ((avgHRPct + p90HRPct) / 2 - p10HRPct) / (80 - 70);
    const intercept3 = (avgHRPct + p90HRPct) / 2 - slope3 * 80;

    console.log(`\nOption 3: Balanced (middle ground)`);
    console.log(`  Map 80 power → ${((avgHRPct + p90HRPct) / 2).toFixed(2)}% HR (avg of avg + 90th pctile)`);
    console.log(`  Map 70 power → ${p10HRPct.toFixed(2)}% HR (10th percentile)`);
    console.log(`  Coefficient: HR% = ${intercept3.toFixed(4)} + ${slope3.toFixed(6)} × Power`);
    console.log(`  Results:`);
    console.log(`    80 power → ${(intercept3 + slope3 * 80).toFixed(2)}% → ${Math.round((intercept3 + slope3 * 80) * 650 / 100)} HR in 650 PA`);
    console.log(`    75 power → ${(intercept3 + slope3 * 75).toFixed(2)}% → ${Math.round((intercept3 + slope3 * 75) * 650 / 100)} HR in 650 PA`);
    console.log(`    70 power → ${(intercept3 + slope3 * 70).toFixed(2)}% → ${Math.round((intercept3 + slope3 * 70) * 650 / 100)} HR in 650 PA`);
    console.log(`    50 power → ${(intercept3 + slope3 * 50).toFixed(2)}% → ${Math.round((intercept3 + slope3 * 50) * 650 / 100)} HR in 650 PA`);
  }

  console.log('\n' + '='.repeat(120));
  console.log('CURRENT COEFFICIENT (for comparison):');
  console.log('='.repeat(120));
  const currentIntercept = -0.5906;
  const currentSlope = 0.058434;
  console.log(`HR% = ${currentIntercept.toFixed(4)} + ${currentSlope.toFixed(6)} × Power`);
  console.log(`  80 power → ${(currentIntercept + currentSlope * 80).toFixed(2)}% → ${Math.round((currentIntercept + currentSlope * 80) * 650 / 100)} HR in 650 PA`);
  console.log(`  75 power → ${(currentIntercept + currentSlope * 75).toFixed(2)}% → ${Math.round((currentIntercept + currentSlope * 75) * 650 / 100)} HR in 650 PA`);
  console.log(`  70 power → ${(currentIntercept + currentSlope * 70).toFixed(2)}% → ${Math.round((currentIntercept + currentSlope * 70) * 650 / 100)} HR in 650 PA`);
  console.log(`  50 power → ${(currentIntercept + currentSlope * 50).toFixed(2)}% → ${Math.round((currentIntercept + currentSlope * 50) * 650 / 100)} HR in 650 PA`);

  console.log('\n' + '='.repeat(120));
  console.log('RECOMMENDATION:');
  console.log('='.repeat(120));
  console.log('');
  console.log('1. Use the "Recent years (2018-2020)" coefficients to match current environment');
  console.log('2. Choose between Option 1 (conservative), Option 2 (aggressive), or Option 3 (balanced)');
  console.log('3. Update HitterRatingEstimatorService.ts with the selected coefficient');
  console.log('4. Re-run backcasting analysis to validate the new coefficient');
  console.log('5. Monitor and adjust as league environment changes');
  console.log('');
  console.log('='.repeat(120));
}

// Run the calibration
calibratePowerCoefficient()
  .then(() => {
    console.log('\nCalibration complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error running calibration:', err);
    process.exit(1);
  });
