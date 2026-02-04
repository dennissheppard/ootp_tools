/**
 * Analyze power ratings needed to match top HR leaders
 *
 * Reads actual batting stats and calculates what power ratings
 * would be needed to produce the observed HR rates using the
 * current power coefficient.
 *
 * This helps diagnose if:
 * 1. Coefficient is too flat (need ratings > 80 to match reality)
 * 2. True Ratings is compressing (need reasonable ratings but not getting them)
 *
 * Run with: npx tsx tools/analyze_power_ratings.ts
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

// Current power coefficient from HitterRatingEstimatorService
const POWER_INTERCEPT = -0.5906;
const POWER_SLOPE = 0.058434;

// Calculate HR% from power rating using current coefficient
function hrPctFromPower(powerRating: number): number {
  return POWER_INTERCEPT + POWER_SLOPE * powerRating;
}

// Calculate power rating needed to produce a given HR%
function powerFromHrPct(hrPct: number): number {
  return (hrPct - POWER_INTERCEPT) / POWER_SLOPE;
}

// Read batting stats from CSV
function loadBattingStats(year: number): BattingStats[] {
  const filePath = path.join(__dirname, '..', 'public', 'data', 'mlb_batting', `${year}_batting.csv`);

  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  No batting stats file found for ${year}`);
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

async function analyzePowerRatings() {
  const yearsToAnalyze = [2015, 2016, 2017, 2018, 2019, 2020, 2021];
  const playerNames = loadPlayerNames();

  console.log('='.repeat(120));
  console.log('POWER RATING ANALYSIS - What ratings are needed to match top HR leaders?');
  console.log('='.repeat(120));
  console.log('');
  console.log('Current Coefficient: HR% = -0.5906 + 0.058434 × Power');
  console.log('  80 power → 4.08% HR → 27 HR in 650 PA');
  console.log('  75 power → 3.79% HR → 25 HR in 650 PA');
  console.log('  70 power → 3.50% HR → 23 HR in 650 PA');
  console.log('');
  console.log('This analysis shows what power ratings WOULD BE NEEDED to project the actual HR totals.');
  console.log('If needed ratings are > 80, the coefficient is too conservative.');
  console.log('If needed ratings are 70-80, then True Ratings might be compressing elite power.');
  console.log('');

  const allNeededRatings: number[] = [];

  for (const year of yearsToAnalyze) {
    try {
      console.log(`\n${'='.repeat(120)}`);
      console.log(`YEAR ${year}`);
      console.log('='.repeat(120));

      const battingStats = loadBattingStats(year);
      if (battingStats.length === 0) {
        console.log(`No data available for ${year}`);
        continue;
      }

      // Get top 10 HR leaders (400+ PA, or 100+ for 2021 partial season)
      const minPA = year === 2021 ? 100 : 400;
      const top10 = battingStats
        .filter(b => b.pa >= minPA)
        .sort((a, b) => b.hr - a.hr)
        .slice(0, 10);

      // Print header
      console.log('Rank | Name'.padEnd(30) + '| Actual HR | Actual PA | HR%   | Needed Power Rating');
      console.log('-'.repeat(120));

      // Print each player
      top10.forEach((batter, idx) => {
        const rank = (idx + 1).toString().padStart(2);
        const name = (playerNames.get(batter.player_id) || `Player ${batter.player_id}`).padEnd(25);
        const hr = batter.hr.toString().padStart(9);
        const pa = batter.pa.toString().padStart(9);
        const hrPct = ((batter.hr / batter.pa) * 100).toFixed(2).padStart(5);
        const neededPower = powerFromHrPct((batter.hr / batter.pa) * 100);
        const neededPowerStr = neededPower.toFixed(1).padStart(19);

        console.log(`${rank}   | ${name} | ${hr} | ${pa} | ${hrPct} | ${neededPowerStr}`);

        if (idx < 3) { // Track top 3 for overall stats
          allNeededRatings.push(neededPower);
        }
      });

      // Summary stats
      const top3 = top10.slice(0, 3);
      const avgHR = top3.reduce((sum, b) => sum + b.hr, 0) / 3;
      const avgHRPct = top3.reduce((sum, b) => sum + (b.hr / b.pa) * 100, 0) / 3;
      const avgNeededPower = top3.reduce((sum, b) => sum + powerFromHrPct((b.hr / b.pa) * 100), 0) / 3;
      const maxNeededPower = Math.max(...top3.map(b => powerFromHrPct((b.hr / b.pa) * 100)));

      console.log('');
      console.log(`Summary for ${year} Top 3:`);
      console.log(`  Average HR: ${avgHR.toFixed(1)}`);
      console.log(`  Average HR%: ${avgHRPct.toFixed(2)}%`);
      console.log(`  Average Needed Power Rating: ${avgNeededPower.toFixed(1)}`);
      console.log(`  Max Needed Power Rating: ${maxNeededPower.toFixed(1)}`);

      if (avgNeededPower > 85) {
        console.log(`  ⚠️  WARNING: Needed power ratings (avg ${avgNeededPower.toFixed(1)}) are well above 80 → Coefficient is TOO CONSERVATIVE`);
      } else if (avgNeededPower > 80) {
        console.log(`  ⚠️  WARNING: Needed power ratings (avg ${avgNeededPower.toFixed(1)}) slightly exceed 80 → Coefficient may be slightly conservative`);
      } else if (avgNeededPower >= 75) {
        console.log(`  ✓ Needed power ratings (avg ${avgNeededPower.toFixed(1)}) are reasonable → Check if True Ratings produces these ratings`);
      } else {
        console.log(`  ℹ️  Needed power ratings (avg ${avgNeededPower.toFixed(1)}) are moderate → Coefficient may be fine`);
      }

    } catch (error) {
      console.error(`Error analyzing ${year}:`, error);
    }
  }

  // Overall summary
  console.log('\n' + '='.repeat(120));
  console.log('OVERALL SUMMARY - Top 3 HR Leaders Across All Years');
  console.log('='.repeat(120));

  if (allNeededRatings.length > 0) {
    const avgNeeded = allNeededRatings.reduce((sum, r) => sum + r, 0) / allNeededRatings.length;
    const maxNeeded = Math.max(...allNeededRatings);
    const minNeeded = Math.min(...allNeededRatings);

    console.log(`\nNeeded Power Ratings for Top 3 HR Leaders (${allNeededRatings.length} player-seasons):`);
    console.log(`  Average: ${avgNeeded.toFixed(1)}`);
    console.log(`  Range: ${minNeeded.toFixed(1)} - ${maxNeeded.toFixed(1)}`);
    console.log(`  Count above 80: ${allNeededRatings.filter(r => r > 80).length} of ${allNeededRatings.length}`);
    console.log(`  Count above 85: ${allNeededRatings.filter(r => r > 85).length} of ${allNeededRatings.length}`);

    console.log('\n' + '='.repeat(120));
    console.log('DIAGNOSIS:');
    console.log('='.repeat(120));

    if (avgNeeded > 85) {
      console.log('🔴 COEFFICIENT IS TOO CONSERVATIVE');
      console.log(`   Average needed power: ${avgNeeded.toFixed(1)} (well above max possible 80)`);
      console.log('   ');
      console.log('   RECOMMENDATION: Increase the power coefficient slope');
      console.log(`   Current: HR% = -0.5906 + 0.058434 × Power`);
      console.log(`   Suggested: HR% = -1.0 + 0.095 × Power (would give 80 power → 6.6% → 43 HR)`);
      console.log('   ');
    } else if (avgNeeded > 80) {
      console.log('🟡 COEFFICIENT MAY BE SLIGHTLY CONSERVATIVE');
      console.log(`   Average needed power: ${avgNeeded.toFixed(1)} (slightly above max 80)`);
      console.log('   ');
      console.log('   RECOMMENDATION: Slightly increase slope OR check True Ratings compression');
      console.log(`   Current: HR% = -0.5906 + 0.058434 × Power`);
      console.log(`   Option 1: HR% = -0.8 + 0.08 × Power (would give 80 power → 5.6% → 36 HR)`);
      console.log('   Option 2: Check if True Ratings is producing 78-80 power for elite HR hitters');
      console.log('   ');
    } else if (avgNeeded >= 70) {
      console.log('🟢 COEFFICIENT LOOKS REASONABLE');
      console.log(`   Average needed power: ${avgNeeded.toFixed(1)} (within 70-80 range)`);
      console.log('   ');
      console.log('   NEXT STEP: Check if True Ratings is actually producing these power ratings');
      console.log('   If your top projected HR leaders have power ratings of 60-70 instead of 75-80,');
      console.log('   then the issue is in the True Ratings calculation, not the coefficient.');
      console.log('   ');
    } else {
      console.log('ℹ️  NEEDED RATINGS ARE MODERATE');
      console.log(`   Average needed power: ${avgNeeded.toFixed(1)}`);
      console.log('   The coefficient may be fine - need to investigate other factors.');
    }
  }

  console.log('='.repeat(120));
}

// Run the analysis
analyzePowerRatings()
  .then(() => {
    console.log('\nAnalysis complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error running analysis:', err);
    process.exit(1);
  });
