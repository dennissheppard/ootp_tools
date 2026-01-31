/**
 * Automated TFR Validation Tests
 *
 * Tests TFR projections against known expectations and actual MLB distributions.
 * Run this after any TFR calibration changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

// ============================================================================
// Configuration
// ============================================================================

const MODERN_ERA_YEARS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021]; // OOTP 25+26
const TEST_YEAR = 2020; // Year to test TFR projections

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  message?: string;
}

const results: TestResult[] = [];

// ============================================================================
// Data Loading
// ============================================================================

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

// ============================================================================
// Load Modern Era MLB Stats
// ============================================================================

interface MLBSeasonStats {
  year: number;
  players: Array<{
    playerId: number;
    ip: number;
    fip: number;
    war: number;
  }>;
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

function loadModernEraMLB(): MLBSeasonStats[] {
  console.log('   Loading age data for MLB pitchers...');
  const ageMap = loadAgeData();

  const seasons: MLBSeasonStats[] = [];
  let primeYearsCount = 0;
  let allAgesCount = 0;

  for (const year of MODERN_ERA_YEARS) {
    const rows = loadCSV(`public/data/mlb/${year}.csv`);
    const players = rows
      .map(row => {
        try {
          const ip = parseIp(row.ip); // lowercase - matches CSV header
          if (ip < 50) return null; // Exclude small samples

          const k = parseInt(row.k, 10); // lowercase
          const bb = parseInt(row.bb, 10); // lowercase
          const hr = parseInt(row.hra, 10); // lowercase

          // Skip if any values are invalid
          if (isNaN(k) || isNaN(bb) || isNaN(hr) || isNaN(ip)) return null;

          const playerId = parseInt(row.player_id, 10);
          const dob = ageMap.get(playerId);

          // Filter to prime years (25-32) for fair comparison with prospect peaks
          if (dob) {
            const age = calculateAge(dob, year);
            if (age < 25 || age > 32) return null; // Only include prime years
            primeYearsCount++;
          } else {
            // If no age data, skip (can't verify prime years)
            return null;
          }

          allAgesCount++;
          const fip = calculateFip(k, bb, hr, ip);
          const war = parseFloat(row.war) || 0; // lowercase

          return {
            playerId,
            ip,
            fip,
            war
          };
        } catch (e) {
          // Skip invalid rows
          return null;
        }
      })
      .filter(p => p !== null) as any[];

    seasons.push({ year, players });
  }

  console.log(`   Loaded ${primeYearsCount} MLB pitcher seasons (ages 25-32, prime years only)`);
  return seasons;
}

// ============================================================================
// Load TFR Projections
// ============================================================================

interface TFRProspect {
  playerId: number;
  name: string;
  age: number;
  level: string;
  tfr: number;
  projFip: number;
  projWar: number;
  totalMinorIp: number;
}

function loadTFRProspects(year: number): TFRProspect[] {
  // This would load from your actual TFR service output
  // For now, placeholder that shows the structure needed
  const filePath = `tools/reports/tfr_prospects_${year}.json`;
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`\n⚠️  TFR data not found: ${filePath}`);
    console.warn('Run TFR generation first to create this file.\n');
    return [];
  }

  const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  return data.prospects || [];
}

// ============================================================================
// Test 1: TFR Distribution Matches MLB Distribution
// ============================================================================

function testDistribution(prospects: TFRProspect[]): TestResult {
  const total = prospects.length;

  const elite = prospects.filter(p => p.tfr >= 4.5).length;
  const aboveAvg = prospects.filter(p => p.tfr >= 4.0 && p.tfr < 4.5).length;
  const average = prospects.filter(p => p.tfr >= 3.0 && p.tfr < 4.0).length;
  const fringe = prospects.filter(p => p.tfr >= 2.5 && p.tfr < 3.0).length;
  const poor = prospects.filter(p => p.tfr < 2.5).length;

  const elitePct = (elite / total) * 100;
  const aboveAvgPct = (aboveAvg / total) * 100;
  const averagePct = (average / total) * 100;

  // Expected: Match PROSPECT distribution (not MLB)
  // OOTP has only ~1.6% at 4★+, we're slightly more generous
  // Elite (4.5+): 1-3%, Above Avg (4.0-4.5): 3-6%, Average (3.0-4.0): 30-50%
  const passed =
    elitePct >= 1 && elitePct <= 3 &&
    aboveAvgPct >= 3 && aboveAvgPct <= 6 &&
    averagePct >= 30 && averagePct <= 50;

  return {
    name: 'TFR Distribution',
    passed,
    expected: 'Elite (4.5+): 1-3%, Above Avg (4.0-4.5): 3-6%, Average (3.0-4.0): 30-50%',
    actual: `Elite: ${elitePct.toFixed(1)}%, Above Avg: ${aboveAvgPct.toFixed(1)}%, Average: ${averagePct.toFixed(1)}%`,
    message: passed ? undefined : 'Distribution does not match expected prospect spread'
  };
}

// ============================================================================
// Test 2: Top Prospects Match Elite MLB FIP Range
// ============================================================================

function testTopProspectsFIP(prospects: TFRProspect[], mlbSeasons: MLBSeasonStats[]): TestResult {
  // Get top 10 prospects
  const top10 = prospects
    .sort((a, b) => b.tfr - a.tfr)
    .slice(0, 10);

  const avgTopFip = top10.reduce((sum, p) => sum + p.projFip, 0) / top10.length;

  // Get elite MLB pitchers (top 10% by FIP each year)
  const allElite: number[] = [];
  mlbSeasons.forEach(season => {
    const sorted = [...season.players].sort((a, b) => a.fip - b.fip);
    const top10Pct = sorted.slice(0, Math.ceil(sorted.length * 0.10));
    allElite.push(...top10Pct.map(p => p.fip));
  });

  const avgEliteFip = allElite.reduce((sum, fip) => sum + fip, 0) / allElite.length;

  // Top prospects should project 2.80-3.50 FIP (elite range)
  const passed = avgTopFip >= 2.80 && avgTopFip <= 3.50;

  return {
    name: 'Top Prospects FIP Range',
    passed,
    expected: '2.80-3.50 FIP (elite MLB range)',
    actual: `${avgTopFip.toFixed(2)} FIP (Elite MLB avg: ${avgEliteFip.toFixed(2)})`,
    message: passed ? undefined : 'Top prospects not projecting in elite FIP range'
  };
}

// ============================================================================
// Test 3: Top 200 Prospects Average Matches MLB Average
// ============================================================================

function testTop200vsMLB(prospects: TFRProspect[], mlbSeasons: MLBSeasonStats[]): TestResult {
  // Top 200 prospects should average similar to MLB pitchers
  const top200 = prospects
    .sort((a, b) => b.tfr - a.tfr)
    .slice(0, 200);

  const avgProspectFip = top200.reduce((sum, p) => sum + p.projFip, 0) / top200.length;

  // Get all MLB FIPs
  const allMlbFips = mlbSeasons.flatMap(s => s.players.map(p => p.fip));
  const avgMlbFip = allMlbFips.reduce((sum, fip) => sum + fip, 0) / allMlbFips.length;

  // Top 200 prospects should average 3.80-4.30 FIP (slightly better than league average ~4.20)
  // They're the BEST prospects, so should be better than average MLB
  const passed = avgProspectFip >= 3.50 && avgProspectFip <= 4.30;

  return {
    name: 'Top 200 Prospects vs MLB Average',
    passed,
    expected: '3.50-4.30 FIP (better than MLB average ~4.20)',
    actual: `Prospects: ${avgProspectFip.toFixed(2)}, MLB: ${avgMlbFip.toFixed(2)}`,
    message: passed ? undefined : 'Top 200 prospects not projecting realistically vs MLB'
  };
}

// ============================================================================
// Test 4: Peak WAR Range is Realistic
// ============================================================================

function testPeakWARRange(prospects: TFRProspect[], mlbSeasons: MLBSeasonStats[]): TestResult {
  // Top 10 prospects should project 3-6 WAR peaks
  const top10 = prospects
    .sort((a, b) => b.tfr - a.tfr)
    .slice(0, 10);

  const avgTopWar = top10.reduce((sum, p) => sum + p.projWar, 0) / top10.length;
  const maxWar = Math.max(...top10.map(p => p.projWar));
  const minWar = Math.min(...top10.map(p => p.projWar));

  // Elite prospects should average 3-6 WAR
  const passed = avgTopWar >= 3.0 && avgTopWar <= 6.0 && maxWar >= 4.0;

  return {
    name: 'Peak WAR Range',
    passed,
    expected: 'Top 10 avg: 3-6 WAR, Max ≥4 WAR',
    actual: `Avg: ${avgTopWar.toFixed(1)}, Range: ${minWar.toFixed(1)}-${maxWar.toFixed(1)}`,
    message: passed ? undefined : 'Peak WAR projections not realistic for elite prospects'
  };
}

// ============================================================================
// Test 5: Level Distribution is Balanced
// ============================================================================

function testLevelDistribution(prospects: TFRProspect[]): TestResult {
  const top100 = prospects
    .sort((a, b) => b.tfr - a.tfr)
    .slice(0, 100);

  const byLevel = {
    aaa: top100.filter(p => p.level.toLowerCase().includes('aaa')).length,
    aa: top100.filter(p => {
      const level = p.level.toLowerCase();
      return level.includes('aa') && !level.includes('aaa');
    }).length,
    a: top100.filter(p => {
      const level = p.level.toLowerCase();
      // Match A, A-, A+, but not AA or AAA
      return level.includes('a') && !level.includes('aa');
    }).length,
    r: top100.filter(p => {
      const level = p.level.toLowerCase();
      return level.includes('rookie') || level.includes('r-') || level === 'r';
    }).length
  };

  const aaaPct = (byLevel.aaa / 100) * 100;
  const aaPct = (byLevel.aa / 100) * 100;
  const aPct = (byLevel.a / 100) * 100;
  const rPct = (byLevel.r / 100) * 100;

  // Expected: AAA 30-45%, AA 30-45%, A 10-25%, Rookie 5-15%
  // Rookie range raised from 3-10% because high-upside teenagers should be valued
  const passed =
    aaaPct >= 30 && aaaPct <= 45 &&
    aaPct >= 30 && aaPct <= 45 &&
    aPct >= 10 && aPct <= 25 &&
    rPct >= 5 && rPct <= 15;

  return {
    name: 'Level Distribution (Top 100)',
    passed,
    expected: 'AAA: 30-45%, AA: 30-45%, A: 10-25%, Rookie: 5-15%',
    actual: `AAA: ${aaaPct.toFixed(0)}%, AA: ${aaPct.toFixed(0)}%, A: ${aPct.toFixed(0)}%, Rookie: ${rPct.toFixed(0)}%`,
    message: passed ? undefined : 'Level distribution is unbalanced (too many/few at certain levels)'
  };
}

// ============================================================================
// Test 6: Compression Check (Not Everyone 4.0+)
// ============================================================================

function testCompression(prospects: TFRProspect[]): TestResult {
  const top100 = prospects
    .sort((a, b) => b.tfr - a.tfr)
    .slice(0, 100);

  const below40 = top100.filter(p => p.tfr < 4.0).length;

  // 30-60% of top 100 should be below 4.0 (balanced distribution)
  const passed = below40 >= 30 && below40 <= 60;

  let message: string | undefined;
  if (!passed) {
    if (below40 < 30) {
      message = 'TFR distribution too compressed (everyone rated too high)';
    } else {
      message = 'TFR distribution too selective (too few high ratings)';
    }
  }

  return {
    name: 'Distribution Compression',
    passed,
    expected: '30-60% of top 100 below 4.0 TFR',
    actual: `${below40}% below 4.0`,
    message
  };
}

// ============================================================================
// Test 7: Young Prospects Are Represented
// ============================================================================

function testYoungProspects(prospects: TFRProspect[]): TestResult {
  const top100 = prospects
    .sort((a, b) => b.tfr - a.tfr)
    .slice(0, 100);

  const young = top100.filter(p => p.age <= 22).length;

  // At least 20% of top 100 should be age 22 or younger
  const passed = young >= 20;

  return {
    name: 'Young Prospects Represented',
    passed,
    expected: 'At least 20% of top 100 age ≤22',
    actual: `${young}% age ≤22`,
    message: passed ? undefined : 'Too few young prospects (over-penalizing youth)'
  };
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runTests() {
  console.log('='.repeat(80));
  console.log('TFR AUTOMATED VALIDATION TESTS');
  console.log('='.repeat(80));

  // Load data
  console.log('\n📊 Loading data...');
  const mlbSeasons = loadModernEraMLB();
  console.log(`   Loaded ${mlbSeasons.length} MLB seasons (${MODERN_ERA_YEARS[0]}-${MODERN_ERA_YEARS[MODERN_ERA_YEARS.length - 1]})`);

  const totalMlbPlayers = mlbSeasons.reduce((sum, s) => sum + s.players.length, 0);
  console.log(`   Total MLB players (50+ IP): ${totalMlbPlayers}`);

  const prospects = loadTFRProspects(TEST_YEAR);
  if (prospects.length === 0) {
    console.log('\n❌ No TFR data found. Generate TFR data first:\n');
    console.log('   1. Run TFR calculation for test year');
    console.log('   2. Save results to tools/reports/tfr_prospects_2020.json');
    console.log('   3. Re-run this test\n');
    return;
  }

  console.log(`   Loaded ${prospects.length} TFR prospects for ${TEST_YEAR}\n`);

  // Run tests
  console.log('🧪 Running tests...\n');

  results.push(testDistribution(prospects));
  results.push(testTopProspectsFIP(prospects, mlbSeasons));
  results.push(testTop200vsMLB(prospects, mlbSeasons));
  results.push(testPeakWARRange(prospects, mlbSeasons));
  results.push(testLevelDistribution(prospects));
  results.push(testCompression(prospects));
  results.push(testYoungProspects(prospects));

  // Print results
  console.log('='.repeat(80));
  console.log('TEST RESULTS');
  console.log('='.repeat(80));

  let passed = 0;
  let failed = 0;

  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`\n${icon} ${result.name}`);
    console.log(`   Expected: ${result.expected}`);
    console.log(`   Actual:   ${result.actual}`);
    if (result.message) {
      console.log(`   Issue:    ${result.message}`);
    }

    if (result.passed) passed++;
    else failed++;
  });

  console.log('\n' + '='.repeat(80));
  console.log(`SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(80));

  if (failed === 0) {
    console.log('\n🎉 All tests passed! TFR calibration looks good.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Review and adjust TFR calibration.\n');
  }

  // Save results
  const outputPath = path.join(process.cwd(), 'tools/reports/tfr_validation_results.json');
  fs.writeFileSync(outputPath, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
  console.log(`Results saved to: ${outputPath}\n`);
}

// ============================================================================
// Main
// ============================================================================

runTests().catch(console.error);
