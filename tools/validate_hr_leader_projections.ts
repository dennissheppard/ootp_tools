/**
 * Validate HR Leader Projections
 *
 * Tests the CORRECT question: Are we accurately projecting the players
 * who actually lead the league in home runs?
 *
 * This addresses the flawed "quartile analysis" approach which lumps together
 * all 69-80 power players. Instead, we specifically look at:
 * 1. Who were the actual top HR hitters each year?
 * 2. What power ratings did we assign them (based on prior year stats)?
 * 3. What HR total did we project for them?
 * 4. How close were we?
 *
 * Run with: npx tsx tools/validate_hr_leader_projections.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Piecewise power coefficients from HitterRatingEstimatorService
const POWER_LOW = { intercept: -1.034, slope: 0.0637 };   // power 20-50
const POWER_HIGH = { intercept: -2.75, slope: 0.098 };    // power 50-80

interface BattingStats {
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
}

interface PlayerYearData {
  playerId: number;
  name: string;
  year: number;
  actualHR: number;
  actualPA: number;
  actualHRPct: number;
  // From prior year(s) - what we'd use to project
  priorYearHRPct: number;
  priorYearPA: number;
  // Calculated ratings and projections
  assignedPowerRating: number;
  projectedHRPct: number;
  projectedHR: number;
  error: number;
  errorPct: number;
}

// Calculate HR% from power rating (piecewise linear)
function hrPctFromPower(powerRating: number): number {
  if (powerRating <= 50) {
    return Math.max(0, POWER_LOW.intercept + POWER_LOW.slope * powerRating);
  } else {
    return Math.max(0, POWER_HIGH.intercept + POWER_HIGH.slope * powerRating);
  }
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
    ab: r.ab,
    h: r.h,
    d: r.d,
    t: r.t,
    hr: r.hr,
    bb: r.bb,
    k: r.k,
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

// Calculate percentile-based power rating for a player given all players' HR%
function calculatePercentilePowerRating(
  playerHRPct: number,
  allPlayersHRPct: number[]
): number {
  // Sort descending (higher HR% = better)
  const sorted = [...allPlayersHRPct].sort((a, b) => b - a);

  // Find where this player ranks
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (playerHRPct >= sorted[i]) {
      rank = i;
      break;
    }
    rank = i + 1;
  }

  // Convert rank to percentile (0-100, where 100 = best)
  const percentile = ((sorted.length - rank) / sorted.length) * 100;

  // Convert percentile to rating (20-80 scale)
  // 100th percentile = 80, 0th percentile = 20
  return 20 + (percentile / 100) * 60;
}

async function validateHRLeaderProjections() {
  console.log('='.repeat(100));
  console.log('HR LEADER PROJECTION VALIDATION');
  console.log('='.repeat(100));
  console.log('');
  console.log('This script tests whether we accurately project the ACTUAL HR leaders.');
  console.log('Unlike quartile analysis, this focuses on the players who matter most.');
  console.log('');
  console.log('Piecewise coefficient:');
  console.log(`  Power 20-50: HR% = ${POWER_LOW.intercept} + ${POWER_LOW.slope} × Power`);
  console.log(`  Power 50-80: HR% = ${POWER_HIGH.intercept} + ${POWER_HIGH.slope} × Power`);
  console.log(`  20 power → ${hrPctFromPower(20).toFixed(2)}% HR → ${Math.round(650 * hrPctFromPower(20) / 100)} HR in 650 PA`);
  console.log(`  50 power → ${hrPctFromPower(50).toFixed(2)}% HR → ${Math.round(650 * hrPctFromPower(50) / 100)} HR in 650 PA`);
  console.log(`  80 power → ${hrPctFromPower(80).toFixed(2)}% HR → ${Math.round(650 * hrPctFromPower(80) / 100)} HR in 650 PA`);
  console.log('');

  const playerNames = loadPlayerNames();

  // We'll test backcasting for 2018, 2019, 2020
  // For each year, we use PRIOR year stats to assign power ratings
  const testYears = [2018, 2019, 2020];
  const allResults: PlayerYearData[] = [];

  for (const targetYear of testYears) {
    const priorYear = targetYear - 1;

    console.log('='.repeat(100));
    console.log(`BACKCASTING ${targetYear} (using ${priorYear} stats to project)`);
    console.log('='.repeat(100));

    // Load both years' data
    const priorYearStats = loadBattingStats(priorYear);
    const targetYearStats = loadBattingStats(targetYear);

    if (priorYearStats.length === 0 || targetYearStats.length === 0) {
      console.log(`Missing data for ${priorYear} or ${targetYear}`);
      continue;
    }

    // Build maps for quick lookup
    const priorYearMap = new Map<number, BattingStats>();
    for (const stats of priorYearStats) {
      if (stats.pa >= 400) {
        priorYearMap.set(stats.player_id, stats);
      }
    }

    // Get all qualified players' HR% from prior year (for percentile calculation)
    const allPriorYearHRPct = Array.from(priorYearMap.values())
      .map(s => (s.hr / s.pa) * 100);

    // Get top 10 HR leaders from TARGET year
    const top10Target = targetYearStats
      .filter(b => b.pa >= 400)
      .sort((a, b) => b.hr - a.hr)
      .slice(0, 10);

    console.log('');
    console.log('Top 10 HR Leaders in ' + targetYear + ':');
    console.log('-'.repeat(100));
    console.log(
      'Rank'.padEnd(5) +
      'Name'.padEnd(22) +
      'Act HR'.padEnd(8) +
      'Act PA'.padEnd(8) +
      'Act HR%'.padEnd(9) +
      'Prior HR%'.padEnd(10) +
      'Pwr Rtg'.padEnd(8) +
      'Proj HR%'.padEnd(10) +
      'Proj HR'.padEnd(9) +
      'Error'
    );
    console.log('-'.repeat(100));

    for (let i = 0; i < top10Target.length; i++) {
      const target = top10Target[i];
      const prior = priorYearMap.get(target.player_id);
      const name = playerNames.get(target.player_id) || `Player ${target.player_id}`;

      const actualHRPct = (target.hr / target.pa) * 100;

      if (!prior) {
        // Player didn't have enough PA in prior year
        console.log(
          `${(i + 1).toString().padEnd(5)}` +
          `${name.substring(0, 20).padEnd(22)}` +
          `${target.hr.toString().padEnd(8)}` +
          `${target.pa.toString().padEnd(8)}` +
          `${actualHRPct.toFixed(2).padEnd(9)}` +
          `${'N/A'.padEnd(10)}` +
          `${'N/A'.padEnd(8)}` +
          `${'N/A'.padEnd(10)}` +
          `${'N/A'.padEnd(9)}` +
          'No prior year data (< 400 PA)'
        );
        continue;
      }

      const priorHRPct = (prior.hr / prior.pa) * 100;

      // Calculate power rating based on percentile in prior year
      const powerRating = calculatePercentilePowerRating(priorHRPct, allPriorYearHRPct);

      // Project HR% using our coefficient
      const projectedHRPct = hrPctFromPower(powerRating);

      // Project HR count (use actual PA from target year for fair comparison)
      const projectedHR = Math.round(target.pa * (projectedHRPct / 100));

      const error = projectedHR - target.hr;
      const errorPct = ((projectedHR - target.hr) / target.hr) * 100;

      console.log(
        `${(i + 1).toString().padEnd(5)}` +
        `${name.substring(0, 20).padEnd(22)}` +
        `${target.hr.toString().padEnd(8)}` +
        `${target.pa.toString().padEnd(8)}` +
        `${actualHRPct.toFixed(2).padEnd(9)}` +
        `${priorHRPct.toFixed(2).padEnd(10)}` +
        `${powerRating.toFixed(1).padEnd(8)}` +
        `${projectedHRPct.toFixed(2).padEnd(10)}` +
        `${projectedHR.toString().padEnd(9)}` +
        `${error >= 0 ? '+' : ''}${error} (${errorPct >= 0 ? '+' : ''}${errorPct.toFixed(1)}%)`
      );

      allResults.push({
        playerId: target.player_id,
        name,
        year: targetYear,
        actualHR: target.hr,
        actualPA: target.pa,
        actualHRPct,
        priorYearHRPct: priorHRPct,
        priorYearPA: prior.pa,
        assignedPowerRating: powerRating,
        projectedHRPct,
        projectedHR,
        error,
        errorPct,
      });
    }

    // Year summary
    const yearResults = allResults.filter(r => r.year === targetYear);
    if (yearResults.length > 0) {
      const avgError = yearResults.reduce((sum, r) => sum + r.error, 0) / yearResults.length;
      const avgAbsError = yearResults.reduce((sum, r) => sum + Math.abs(r.error), 0) / yearResults.length;
      const avgPowerRating = yearResults.reduce((sum, r) => sum + r.assignedPowerRating, 0) / yearResults.length;

      console.log('');
      console.log(`${targetYear} Summary (top ${yearResults.length} HR leaders):`);
      console.log(`  Avg Power Rating Assigned: ${avgPowerRating.toFixed(1)}`);
      console.log(`  Avg Error: ${avgError >= 0 ? '+' : ''}${avgError.toFixed(1)} HR`);
      console.log(`  Avg Absolute Error: ${avgAbsError.toFixed(1)} HR`);
    }
  }

  // Overall summary
  console.log('');
  console.log('='.repeat(100));
  console.log('OVERALL SUMMARY (2018-2020 Top 10 HR Leaders)');
  console.log('='.repeat(100));

  if (allResults.length > 0) {
    const avgError = allResults.reduce((sum, r) => sum + r.error, 0) / allResults.length;
    const avgAbsError = allResults.reduce((sum, r) => sum + Math.abs(r.error), 0) / allResults.length;
    const avgPowerRating = allResults.reduce((sum, r) => sum + r.assignedPowerRating, 0) / allResults.length;
    const rmse = Math.sqrt(allResults.reduce((sum, r) => sum + r.error * r.error, 0) / allResults.length);

    // Split by top 3 vs rest
    const top3Results = allResults.filter((_, i) => i % 10 < 3);
    const avgErrorTop3 = top3Results.reduce((sum, r) => sum + r.error, 0) / top3Results.length;
    const avgAbsErrorTop3 = top3Results.reduce((sum, r) => sum + Math.abs(r.error), 0) / top3Results.length;
    const avgPowerRatingTop3 = top3Results.reduce((sum, r) => sum + r.assignedPowerRating, 0) / top3Results.length;

    console.log('');
    console.log(`All Top 10 Leaders (${allResults.length} player-seasons):`);
    console.log(`  Avg Power Rating Assigned: ${avgPowerRating.toFixed(1)}`);
    console.log(`  Avg Error (bias): ${avgError >= 0 ? '+' : ''}${avgError.toFixed(1)} HR`);
    console.log(`  Avg Absolute Error: ${avgAbsError.toFixed(1)} HR`);
    console.log(`  RMSE: ${rmse.toFixed(1)} HR`);

    console.log('');
    console.log(`Top 3 Leaders Only (${top3Results.length} player-seasons):`);
    console.log(`  Avg Power Rating Assigned: ${avgPowerRatingTop3.toFixed(1)}`);
    console.log(`  Avg Error (bias): ${avgErrorTop3 >= 0 ? '+' : ''}${avgErrorTop3.toFixed(1)} HR`);
    console.log(`  Avg Absolute Error: ${avgAbsErrorTop3.toFixed(1)} HR`);

    // Interpretation
    console.log('');
    console.log('='.repeat(100));
    console.log('INTERPRETATION');
    console.log('='.repeat(100));
    console.log('');

    if (Math.abs(avgError) <= 3) {
      console.log('✅ PROJECTIONS ARE WELL-CALIBRATED');
      console.log(`   Average bias of ${avgError >= 0 ? '+' : ''}${avgError.toFixed(1)} HR is within acceptable range.`);
    } else if (avgError > 3) {
      console.log('⚠️  PROJECTIONS ARE OVER-PREDICTING');
      console.log(`   Average bias of +${avgError.toFixed(1)} HR suggests coefficient may be too steep.`);
    } else {
      console.log('⚠️  PROJECTIONS ARE UNDER-PREDICTING');
      console.log(`   Average bias of ${avgError.toFixed(1)} HR suggests coefficient may be too flat.`);
    }

    console.log('');
    console.log('Key insight: The quartile analysis in hr_bug.md was misleading because it');
    console.log('averaged together all 69-80 power players. This analysis focuses specifically');
    console.log('on the actual HR leaders - the players the system should project most accurately.');

    // Show distribution of errors
    console.log('');
    console.log('Error Distribution:');
    const buckets = [
      { label: 'Under by 10+', min: -Infinity, max: -10, count: 0 },
      { label: 'Under by 5-10', min: -10, max: -5, count: 0 },
      { label: 'Under by 1-5', min: -5, max: -1, count: 0 },
      { label: 'Within ±1', min: -1, max: 1, count: 0 },
      { label: 'Over by 1-5', min: 1, max: 5, count: 0 },
      { label: 'Over by 5-10', min: 5, max: 10, count: 0 },
      { label: 'Over by 10+', min: 10, max: Infinity, count: 0 },
    ];

    for (const result of allResults) {
      for (const bucket of buckets) {
        if (result.error > bucket.min && result.error <= bucket.max) {
          bucket.count++;
          break;
        }
      }
    }

    for (const bucket of buckets) {
      const pct = (bucket.count / allResults.length) * 100;
      const bar = '█'.repeat(Math.round(pct / 2));
      console.log(`  ${bucket.label.padEnd(15)} ${bucket.count.toString().padStart(2)} (${pct.toFixed(0).padStart(2)}%) ${bar}`);
    }
  }

  console.log('');
  console.log('='.repeat(100));
}

// Run the validation
validateHRLeaderProjections()
  .then(() => {
    console.log('\nValidation complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error running validation:', err);
    process.exit(1);
  });
