/**
 * Analyze Top Home Run Leaders
 *
 * Compares projected HR counts vs actual HR counts for the league's
 * top 10 home run hitters each year from 2015-2020, and examines
 * the 2021 projections.
 *
 * Run with: npx tsx tools/analyze_top_hr_leaders.ts
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
  name?: string;
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

interface ProjectionData {
  player_id: number;
  name: string;
  power_rating: number;
  projected_hr: number;
  projected_pa: number;
  projected_hr_pct: number;
  true_rating: number;
}

interface TopHRAnalysis {
  year: number;
  rank: number;
  name: string;
  playerId: number;
  actualHR: number;
  actualPA: number;
  actualHRPct: number;
  projectedHR?: number;
  projectedPA?: number;
  projectedHRPct?: number;
  error?: number;
  powerRating?: number;
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
    ab: r.ab,
    h: r.h,
    d: r.d,
    t: r.t,
    hr: r.hr,
    bb: r.bb,
    k: r.k,
  }));
}

// Read player names from CSV (we'll need a player lookup file)
function loadPlayerNames(): Map<number, string> {
  // Try to read from dob file which has player names
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

// For now, we'll mock projection data since we'd need to run the full projection service
// In a real scenario, you'd either:
// 1. Export projections to CSV files
// 2. Run a simplified version of the projection calculation here
function getProjections(year: number): Map<number, ProjectionData> {
  // This is a placeholder - we'll need actual projection logic or exported data
  console.log(`  (Note: Projection data for ${year} would need to be calculated or loaded from cache)`);
  return new Map();
}

async function analyzeTopHRLeaders() {
  console.log('='.repeat(80));
  console.log('TOP HOME RUN LEADERS ANALYSIS');
  console.log('='.repeat(80));
  console.log('');

  const playerNames = loadPlayerNames();
  const historicalYears = [2015, 2016, 2017, 2018, 2019, 2020];
  const allResults: TopHRAnalysis[] = [];

  // Analyze historical years
  for (const year of historicalYears) {
    console.log(`\n--- ${year} Season ---`);

    const battingStats = loadBattingStats(year);
    if (battingStats.length === 0) {
      continue;
    }

    // Get top 10 HR leaders (400+ PA)
    const top10 = battingStats
      .filter(b => b.pa >= 400)
      .sort((a, b) => b.hr - a.hr)
      .slice(0, 10);

    console.log('\nRank  Player                    Actual HR  Actual PA  HR%');
    console.log('-'.repeat(70));

    top10.forEach((batter, index) => {
      const rank = index + 1;
      const name = playerNames.get(batter.player_id) || `Player ${batter.player_id}`;
      const hrPct = (batter.hr / batter.pa) * 100;

      console.log(
        `${rank.toString().padStart(2)}    ` +
        `${name.padEnd(24).substring(0, 24)} ` +
        `${batter.hr.toString().padStart(2)}         ` +
        `${batter.pa.toString().padStart(3)}        ` +
        `${hrPct.toFixed(2)}%`
      );

      allResults.push({
        year,
        rank,
        name,
        playerId: batter.player_id,
        actualHR: batter.hr,
        actualPA: batter.pa,
        actualHRPct: hrPct,
      });
    });

    // Summary for this year
    const avgHR = top10.reduce((sum, b) => sum + b.hr, 0) / top10.length;
    const avgHRPct = top10.reduce((sum, b) => sum + (b.hr / b.pa) * 100, 0) / top10.length;
    const top3AvgHR = top10.slice(0, 3).reduce((sum, b) => sum + b.hr, 0) / 3;

    console.log(`\nSummary: Top 10 Avg = ${avgHR.toFixed(1)} HR (${avgHRPct.toFixed(2)}%), Top 3 Avg = ${top3AvgHR.toFixed(1)} HR`);
  }

  // Aggregate analysis
  console.log('\n\n='.repeat(80));
  console.log('AGGREGATE ANALYSIS (2015-2020)');
  console.log('='.repeat(80));

  const top10Results = allResults;
  const top3Results = allResults.filter(r => r.rank <= 3);

  if (top10Results.length > 0) {
    const avgHR = top10Results.reduce((sum, r) => sum + r.actualHR, 0) / top10Results.length;
    const avgHRPct = top10Results.reduce((sum, r) => sum + r.actualHRPct, 0) / top10Results.length;
    const top3AvgHR = top3Results.reduce((sum, r) => sum + r.actualHR, 0) / top3Results.length;
    const top3AvgHRPct = top3Results.reduce((sum, r) => sum + r.actualHRPct, 0) / top3Results.length;

    console.log(`\nTop 10 Leaders (${top10Results.length} player-seasons):`);
    console.log(`  Average HR:  ${avgHR.toFixed(1)}`);
    console.log(`  Average HR%: ${avgHRPct.toFixed(2)}%`);
    console.log(`  Range:       ${Math.min(...top10Results.map(r => r.actualHR))} - ${Math.max(...top10Results.map(r => r.actualHR))} HR`);

    console.log(`\nTop 3 Leaders (${top3Results.length} player-seasons):`);
    console.log(`  Average HR:  ${top3AvgHR.toFixed(1)}`);
    console.log(`  Average HR%: ${top3AvgHRPct.toFixed(2)}%`);
    console.log(`  Range:       ${Math.min(...top3Results.map(r => r.actualHR))} - ${Math.max(...top3Results.map(r => r.actualHR))} HR`);

    // Show year-by-year top 3
    console.log('\nTop 3 by Year:');
    for (const year of historicalYears) {
      const yearTop3 = top3Results.filter(r => r.year === year);
      if (yearTop3.length === 3) {
        const hrs = yearTop3.map(r => r.actualHR).join(', ');
        console.log(`  ${year}: ${hrs} HR`);
      }
    }
  }

  // 2021 Analysis
  console.log('\n\n='.repeat(80));
  console.log('2021 ANALYSIS');
  console.log('='.repeat(80));

  const batting2021 = loadBattingStats(2021);
  if (batting2021.length > 0) {
    console.log('\n⚠️  2021 ACTUAL STATS FOUND!');

    // Use 100 PA threshold for 2021 (partial season - max PA is only 176)
    const top10_2021 = batting2021
      .filter(b => b.pa >= 100)
      .sort((a, b) => b.hr - a.hr)
      .slice(0, 10);

    console.log('\nActual 2021 Top 10 HR Leaders:');
    console.log('Rank  Player                    HR     PA     HR%');
    console.log('-'.repeat(70));

    top10_2021.forEach((batter, index) => {
      const name = playerNames.get(batter.player_id) || `Player ${batter.player_id}`;
      const hrPct = (batter.hr / batter.pa) * 100;

      console.log(
        `${(index + 1).toString().padStart(2)}    ` +
        `${name.padEnd(24).substring(0, 24)} ` +
        `${batter.hr.toString().padStart(2)}     ` +
        `${batter.pa.toString().padStart(3)}    ` +
        `${hrPct.toFixed(2)}%`
      );
    });

    const avg2021HR = top10_2021.reduce((sum, b) => sum + b.hr, 0) / top10_2021.length;
    const top3_2021 = top10_2021.slice(0, 3);
    const top3_2021_avgHR = top3_2021.reduce((sum, b) => sum + b.hr, 0) / 3;
    const top3_2021_hrs = top3_2021.map(b => b.hr).join(', ');

    console.log(`\n2021 Summary:`);
    console.log(`  Top 10 Avg: ${avg2021HR.toFixed(1)} HR`);
    console.log(`  Top 3: ${top3_2021_hrs} HR (avg ${top3_2021_avgHR.toFixed(1)})`);

    // Compare to historical
    if (top10Results.length > 0) {
      const historicalAvg = top10Results.reduce((sum, r) => sum + r.actualHR, 0) / top10Results.length;
      const historicalTop3Avg = top3Results.reduce((sum, r) => sum + r.actualHR, 0) / top3Results.length;

      console.log(`\nComparison to Historical (2015-2020):`);
      console.log(`  Top 10: ${avg2021HR.toFixed(1)} vs ${historicalAvg.toFixed(1)} (${(avg2021HR - historicalAvg) > 0 ? '+' : ''}${(avg2021HR - historicalAvg).toFixed(1)})`);
      console.log(`  Top 3:  ${top3_2021_avgHR.toFixed(1)} vs ${historicalTop3Avg.toFixed(1)} (${(top3_2021_avgHR - historicalTop3Avg) > 0 ? '+' : ''}${(top3_2021_avgHR - historicalTop3Avg).toFixed(1)})`);
    }

    console.log('\n\n📊 KEY FINDING:');
    console.log('  Your 2021 projections show ~26-29 HR for top 3.');
    console.log(`  Actual 2021 top 3 hit: ${top3_2021_hrs} HR`);
    console.log(`  Historical top 3 average: ${top3Results.length > 0 ? (top3Results.reduce((sum, r) => sum + r.actualHR, 0) / top3Results.length).toFixed(1) : 'N/A'} HR`);
    console.log('\n  If 2021 projections (~27 HR avg) are much lower than actuals,');
    console.log('  this suggests the projection system is under-projecting elite power.');
  } else {
    console.log('\n✓ No 2021 actual stats found.');
    console.log('  Cannot compare projections to actuals for 2021.');
  }

  console.log('\n\n💡 NEXT STEPS:');
  console.log('  1. Export your 2021 projections to see what you projected for top HR leaders');
  console.log('  2. Compare those projections to the 2021 actuals above');
  console.log('  3. If projections are significantly low, investigate:');
  console.log('     - Are power ratings lower in 2021 than historical years?');
  console.log('     - Are PA projections lower?');
  console.log('     - Did aging curves reduce power too much?');
  console.log('     - Were 2021 stats accidentally blended in (making projections conservative)?');

  console.log('\n' + '='.repeat(80));
}

// Run the analysis
analyzeTopHRLeaders()
  .then(() => {
    console.log('\nAnalysis complete!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error running analysis:', err);
    process.exit(1);
  });
