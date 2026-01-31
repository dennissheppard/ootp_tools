/**
 * MLB Aging Curves Analysis
 *
 * Analyzes MLB pitcher performance by age to determine peak years.
 * This will help us filter the TFR comparison pool to "prime" MLB years only.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

// ============================================================================
// Configuration
// ============================================================================

const MODERN_ERA_YEARS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021];
const MIN_IP = 50; // Minimum IP for inclusion

// ============================================================================
// Data Loading
// ============================================================================

interface MLBPitcher {
  playerId: number;
  year: number;
  age: number;
  ip: number;
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
  war: number;
}

function loadCSV(filePath: string): any[] {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  return parse(content, { columns: true, skip_empty_lines: true });
}

function parseIp(ipString: string | undefined): number {
  if (!ipString) return 0;
  const [full, partial] = ipString.split('.');
  return parseInt(full, 10) + (partial ? parseInt(partial, 10) / 3 : 0);
}

function calculateFip(k: number, bb: number, hr: number, ip: number): number {
  const k9 = (k / ip) * 9;
  const bb9 = (bb / ip) * 9;
  const hr9 = (hr / ip) * 9;
  return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;
}

// Load age data (DOB)
function loadAgeData(): Map<number, Date> {
  const ageMap = new Map<number, Date>();
  const dobFile = loadCSV('public/data/mlb_dob.csv');

  for (const row of dobFile) {
    const playerId = parseInt(row.ID || row.id || row.player_id, 10);
    const dob = row.DOB || row.dob;
    if (!isNaN(playerId) && dob) {
      ageMap.set(playerId, new Date(dob));
    }
  }

  return ageMap;
}

function calculateAge(dob: Date, seasonYear: number): number {
  // Age as of July 1 of season year (mid-season)
  const midSeason = new Date(seasonYear, 6, 1);
  const age = midSeason.getFullYear() - dob.getFullYear();
  const m = midSeason.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && midSeason.getDate() < dob.getDate())) {
    return age - 1;
  }
  return age;
}

// ============================================================================
// Main Analysis
// ============================================================================

function analyzeAgingCurves(): void {
  console.log('Loading age data...');
  const ageMap = loadAgeData();
  console.log(`Found ${ageMap.size} players with DOB`);

  console.log('\nLoading MLB data...');
  const allPitchers: MLBPitcher[] = [];

  for (const year of MODERN_ERA_YEARS) {
    const rows = loadCSV(`public/data/mlb/${year}.csv`);

    for (const row of rows) {
      try {
        const ip = parseIp(row.ip);
        if (ip < MIN_IP) continue;

        const playerId = parseInt(row.player_id, 10);
        const dob = ageMap.get(playerId);
        if (!dob) continue; // Skip if no age data

        const age = calculateAge(dob, year);
        if (age < 20 || age > 45) continue; // Filter unrealistic ages

        const k = parseInt(row.k, 10);
        const bb = parseInt(row.bb, 10);
        const hr = parseInt(row.hra, 10);

        if (isNaN(k) || isNaN(bb) || isNaN(hr) || isNaN(ip)) continue;

        const fip = calculateFip(k, bb, hr, ip);
        const war = parseFloat(row.war) || 0;

        allPitchers.push({
          playerId,
          year,
          age,
          ip,
          k9: (k / ip) * 9,
          bb9: (bb / ip) * 9,
          hr9: (hr / ip) * 9,
          fip,
          war
        });
      } catch (e) {
        // Skip invalid rows
      }
    }
  }

  console.log(`Loaded ${allPitchers.length} MLB pitcher seasons with age data\n`);

  // Group by age
  const byAge = new Map<number, MLBPitcher[]>();
  for (const pitcher of allPitchers) {
    if (!byAge.has(pitcher.age)) {
      byAge.set(pitcher.age, []);
    }
    byAge.get(pitcher.age)!.push(pitcher);
  }

  // Calculate averages by age
  console.log('================================================================================');
  console.log('MLB PITCHER AGING CURVES (2012-2021)');
  console.log('================================================================================\n');
  console.log('Age | N   | Avg IP | K/9  | BB/9 | HR/9 | FIP  | WAR/Season | WAR/200IP');
  console.log('----|-----|--------|------|------|------|------|------------|----------');

  const ageStats: Array<{age: number, n: number, avgIp: number, k9: number, bb9: number, hr9: number, fip: number, war: number, warPer200: number}> = [];

  for (let age = 20; age <= 42; age++) {
    const pitchers = byAge.get(age);
    if (!pitchers || pitchers.length < 5) continue; // Need at least 5 samples

    const n = pitchers.length;
    const avgIp = pitchers.reduce((sum, p) => sum + p.ip, 0) / n;
    const avgK9 = pitchers.reduce((sum, p) => sum + p.k9, 0) / n;
    const avgBb9 = pitchers.reduce((sum, p) => sum + p.bb9, 0) / n;
    const avgHr9 = pitchers.reduce((sum, p) => sum + p.hr9, 0) / n;
    const avgFip = pitchers.reduce((sum, p) => sum + p.fip, 0) / n;
    const avgWar = pitchers.reduce((sum, p) => sum + p.war, 0) / n;
    const warPer200 = (avgWar / avgIp) * 200;

    ageStats.push({
      age,
      n,
      avgIp,
      k9: avgK9,
      bb9: avgBb9,
      hr9: avgHr9,
      fip: avgFip,
      war: avgWar,
      warPer200
    });

    console.log(
      `${age.toString().padStart(3)} | ${n.toString().padStart(3)} | ${avgIp.toFixed(1).padStart(6)} | ${avgK9.toFixed(2)} | ${avgBb9.toFixed(2)} | ${avgHr9.toFixed(2)} | ${avgFip.toFixed(2)} | ${avgWar.toFixed(2).padStart(10)} | ${warPer200.toFixed(2)}`
    );
  }

  // Find peak ages by FIP
  const sortedByFip = [...ageStats].sort((a, b) => a.fip - b.fip);
  const bestFipAges = sortedByFip.slice(0, 5);

  // Find peak ages by WAR per 200 IP
  const sortedByWar = [...ageStats].sort((a, b) => b.warPer200 - a.warPer200);
  const bestWarAges = sortedByWar.slice(0, 5);

  console.log('\n================================================================================');
  console.log('PEAK PERFORMANCE AGES');
  console.log('================================================================================\n');

  console.log('By FIP (Lower is better):');
  bestFipAges.forEach((stat, i) => {
    console.log(`  ${i + 1}. Age ${stat.age}: ${stat.fip.toFixed(2)} FIP (${stat.n} pitchers)`);
  });

  console.log('\nBy WAR per 200 IP (Higher is better):');
  bestWarAges.forEach((stat, i) => {
    console.log(`  ${i + 1}. Age ${stat.age}: ${stat.warPer200.toFixed(2)} WAR/200IP (${stat.n} pitchers)`);
  });

  // Determine "prime" range
  const fipPrimeAges = bestFipAges.map(s => s.age);
  const warPrimeAges = bestWarAges.map(s => s.age);
  const allPrimeAges = [...new Set([...fipPrimeAges, ...warPrimeAges])].sort((a, b) => a - b);

  console.log('\n================================================================================');
  console.log('RECOMMENDED "PRIME YEARS" FOR TFR COMPARISON');
  console.log('================================================================================\n');

  const minPrime = Math.min(...allPrimeAges);
  const maxPrime = Math.max(...allPrimeAges);

  console.log(`Ages ${minPrime}-${maxPrime} represent peak MLB performance`);
  console.log(`This includes ages: ${allPrimeAges.join(', ')}`);

  // Conservative range (most common peak ages)
  const conservativeRange = ageStats.filter(s => s.age >= 24 && s.age <= 29);
  const avgPrimeFip = conservativeRange.reduce((sum, s) => sum + s.fip, 0) / conservativeRange.length;

  console.log(`\nConservative prime range: 24-29 (avg FIP: ${avgPrimeFip.toFixed(2)})`);
  console.log(`Total pitchers in prime range: ${conservativeRange.reduce((sum, s) => sum + s.n, 0)}`);

  // Show comparison
  const allAgesAvgFip = ageStats.reduce((sum, s) => sum + s.fip * s.n, 0) / ageStats.reduce((sum, s) => sum + s.n, 0);
  console.log(`\nAll ages avg FIP: ${allAgesAvgFip.toFixed(2)}`);
  console.log(`Prime ages avg FIP: ${avgPrimeFip.toFixed(2)}`);
  console.log(`Difference: ${(allAgesAvgFip - avgPrimeFip).toFixed(2)} FIP`);
}

// ============================================================================
// Run
// ============================================================================

analyzeAgingCurves();
