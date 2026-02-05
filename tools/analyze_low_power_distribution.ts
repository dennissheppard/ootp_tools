/**
 * Analyze Low Power Distribution
 *
 * Check what HR rates the bottom percentile hitters actually have.
 * This helps us understand what power 20-30 should map to.
 *
 * Run with: npx tsx tools/analyze_low_power_distribution.ts
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

function loadBattingStats(year: number): BattingStats[] {
  const filePath = path.join(__dirname, '..', 'public', 'data', 'mlb_batting', `${year}_batting.csv`);
  if (!fs.existsSync(filePath)) return [];

  const csvContent = fs.readFileSync(filePath, 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, cast: true });

  return records.map((r: any) => ({
    player_id: r.player_id,
    year: r.year,
    pa: r.pa,
    hr: r.hr,
  }));
}

function loadPlayerNames(): Map<number, string> {
  const dobPath = path.join(__dirname, '..', 'public', 'data', 'mlb_dob.csv');
  if (!fs.existsSync(dobPath)) return new Map();

  const csvContent = fs.readFileSync(dobPath, 'utf-8');
  const records = parse(csvContent, { columns: true, skip_empty_lines: true, cast: true });

  const nameMap = new Map<number, string>();
  records.forEach((r: any) => {
    if (r.player_id && r.first_name && r.last_name) {
      nameMap.set(r.player_id, `${r.first_name} ${r.last_name}`);
    }
  });
  return nameMap;
}

async function analyzeDistribution() {
  console.log('='.repeat(80));
  console.log('HR% DISTRIBUTION ANALYSIS (2018-2020)');
  console.log('='.repeat(80));
  console.log('');

  const playerNames = loadPlayerNames();
  const allPlayerSeasons: { playerId: number; year: number; pa: number; hr: number; hrPct: number }[] = [];

  for (const year of [2018, 2019, 2020]) {
    const stats = loadBattingStats(year);
    for (const s of stats) {
      if (s.pa >= 400) {
        allPlayerSeasons.push({
          playerId: s.player_id,
          year,
          pa: s.pa,
          hr: s.hr,
          hrPct: (s.hr / s.pa) * 100,
        });
      }
    }
  }

  // Sort by HR%
  allPlayerSeasons.sort((a, b) => a.hrPct - b.hrPct);

  console.log(`Total qualified player-seasons (400+ PA): ${allPlayerSeasons.length}`);
  console.log('');

  // Show percentile breakpoints
  console.log('HR% by Percentile:');
  console.log('-'.repeat(60));

  const percentiles = [1, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 95, 99];
  for (const p of percentiles) {
    const idx = Math.floor((p / 100) * (allPlayerSeasons.length - 1));
    const ps = allPlayerSeasons[idx];
    const name = playerNames.get(ps.playerId) || `Player ${ps.playerId}`;
    const projectedHR = Math.round(650 * ps.hrPct / 100);
    console.log(
      `${p.toString().padStart(2)}th: ${ps.hrPct.toFixed(2)}% HR (${ps.hr} HR in ${ps.pa} PA) - ${name.substring(0, 20)} → ${projectedHR} HR/650PA`
    );
  }

  // Show the bottom 20 players
  console.log('');
  console.log('='.repeat(80));
  console.log('BOTTOM 20 HR% PLAYERS (2018-2020, 400+ PA)');
  console.log('='.repeat(80));
  console.log('');
  console.log('Rank  Name                  Year  HR   PA    HR%    HR/650PA');
  console.log('-'.repeat(70));

  for (let i = 0; i < Math.min(20, allPlayerSeasons.length); i++) {
    const ps = allPlayerSeasons[i];
    const name = playerNames.get(ps.playerId) || `Player ${ps.playerId}`;
    const projectedHR = Math.round(650 * ps.hrPct / 100);
    console.log(
      `${(i + 1).toString().padStart(4)}  ${name.substring(0, 20).padEnd(20)}  ${ps.year}  ${ps.hr.toString().padStart(2)}   ${ps.pa.toString().padStart(3)}   ${ps.hrPct.toFixed(2)}%  ${projectedHR}`
    );
  }

  // Calculate what coefficient would work better
  console.log('');
  console.log('='.repeat(80));
  console.log('COEFFICIENT ANALYSIS');
  console.log('='.repeat(80));
  console.log('');

  // Get key percentiles
  const p1 = allPlayerSeasons[Math.floor(0.01 * (allPlayerSeasons.length - 1))];
  const p10 = allPlayerSeasons[Math.floor(0.10 * (allPlayerSeasons.length - 1))];
  const p50 = allPlayerSeasons[Math.floor(0.50 * (allPlayerSeasons.length - 1))];
  const p99 = allPlayerSeasons[Math.floor(0.99 * (allPlayerSeasons.length - 1))];

  console.log('Key percentiles:');
  console.log(`  1st percentile (power ~20):  ${p1.hrPct.toFixed(2)}% HR → ${Math.round(650 * p1.hrPct / 100)} HR`);
  console.log(`  10th percentile (power ~26): ${p10.hrPct.toFixed(2)}% HR → ${Math.round(650 * p10.hrPct / 100)} HR`);
  console.log(`  50th percentile (power ~50): ${p50.hrPct.toFixed(2)}% HR → ${Math.round(650 * p50.hrPct / 100)} HR`);
  console.log(`  99th percentile (power ~80): ${p99.hrPct.toFixed(2)}% HR → ${Math.round(650 * p99.hrPct / 100)} HR`);

  // Calculate ideal coefficient that maps:
  // 20 power → 1st percentile HR%
  // 80 power → 99th percentile HR%
  const slope = (p99.hrPct - p1.hrPct) / (80 - 20);
  const intercept = p1.hrPct - slope * 20;

  console.log('');
  console.log('Suggested coefficient (linear fit to 1st-99th percentile):');
  console.log(`  HR% = ${intercept.toFixed(4)} + ${slope.toFixed(6)} × Power`);
  console.log('');
  console.log('  This would give:');
  console.log(`    20 power → ${(intercept + slope * 20).toFixed(2)}% → ${Math.round(650 * (intercept + slope * 20) / 100)} HR`);
  console.log(`    30 power → ${(intercept + slope * 30).toFixed(2)}% → ${Math.round(650 * (intercept + slope * 30) / 100)} HR`);
  console.log(`    50 power → ${(intercept + slope * 50).toFixed(2)}% → ${Math.round(650 * (intercept + slope * 50) / 100)} HR`);
  console.log(`    70 power → ${(intercept + slope * 70).toFixed(2)}% → ${Math.round(650 * (intercept + slope * 70) / 100)} HR`);
  console.log(`    80 power → ${(intercept + slope * 80).toFixed(2)}% → ${Math.round(650 * (intercept + slope * 80) / 100)} HR`);

  // Compare with current
  console.log('');
  console.log('Current coefficient: HR% = -3.4667 + 0.113333 × Power');
  console.log('  20 power → 0.00% → 0 HR (PROBLEM: actual 1st percentile hits ' + Math.round(650 * p1.hrPct / 100) + ' HR)');
  console.log('  80 power → 5.60% → 36 HR');
}

analyzeDistribution()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
