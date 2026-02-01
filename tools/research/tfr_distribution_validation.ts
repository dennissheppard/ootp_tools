/**
 * TFR Distribution Validation
 *
 * Tests whether the percentile-based algorithm creates realistic distributions.
 *
 * KEY INSIGHT: We can't validate individual peak outcomes (prospects haven't peaked yet),
 * but we CAN validate that our projection method creates distributions that match
 * actual MLB peak-year distributions.
 *
 * Tests:
 * 1. Distribution Shape - Do projected FIPs match the shape of actual MLB FIPs?
 * 2. Percentile Alignment - Does 95th %ile projection ≈ 95th %ile MLB reality?
 * 3. Component Distributions - Do K9/BB9/HR9 distributions make sense?
 * 4. Tier Targets - Do elite projections target elite MLB levels?
 *
 * Usage: npx tsx tools/research/tfr_distribution_validation.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface Prospect2017 {
  playerId: number;
  name: string;
  age: number;
  tfr: number;
  projFip: number;
  projK9: number;
  projBb9: number;
  projHr9: number;
  totalMinorIp: number;
}

interface MLBPitcher {
  player_id: number;
  year: number;
  age: number;
  ip: number;
  fip: number;
  k9: number;
  bb9: number;
  hr9: number;
}

interface DistributionStats {
  count: number;
  min: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  mean: number;
  stdDev: number;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadProspects2017(): Prospect2017[] {
  const filePath = path.join(__dirname, '../reports/tfr_prospects_2017_new.json');

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.error('Please export 2017 prospects from Farm Rankings first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`📄 Loaded: ${data.algorithm || 'unknown'} (${data.totalProspects || 0} prospects)`);
  return data.prospects || [];
}

function loadPlayerDOBs(): Map<number, Date> {
  const filePath = path.join(__dirname, '../../public/data/mlb_dob.csv');

  if (!fs.existsSync(filePath)) {
    console.warn('⚠️  mlb_dob.csv not found, cannot filter by age');
    return new Map();
  }

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const dobMap = new Map<number, Date>();

  // Skip header (ID,DOB)
  for (let i = 1; i < lines.length; i++) {
    const [idStr, dobStr] = lines[i].split(',');
    const playerId = parseInt(idStr, 10);

    if (!playerId || !dobStr) continue;

    // Parse MM/DD/YYYY format
    const [month, day, year] = dobStr.split('/').map(s => parseInt(s, 10));
    if (!month || !day || !year) continue;

    const dob = new Date(year, month - 1, day);
    dobMap.set(playerId, dob);
  }

  console.log(`📅 Loaded ${dobMap.size} player DOBs`);
  return dobMap;
}

function calculateAge(dob: Date | undefined, season: number): number | null {
  if (!dob) return null;

  const seasonStart = new Date(season, 3, 1); // April 1st of season year
  const ageMs = seasonStart.getTime() - dob.getTime();
  const age = Math.floor(ageMs / (1000 * 60 * 60 * 24 * 365.25));

  return age;
}

function loadMLBPeakYears(): MLBPitcher[] {
  console.log('📊 Loading MLB peak-age data (2015-2020, ages 25-29, 50+ IP)...');

  const dobMap = loadPlayerDOBs();
  const years = [2015, 2016, 2017, 2018, 2019, 2020];
  const peakPitchers: MLBPitcher[] = [];

  for (const year of years) {
    const filePath = path.join(__dirname, `../../public/data/mlb/${year}.csv`);

    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  Missing: ${year}.csv`);
      continue;
    }

    const pitchers = parseMLBStats(filePath, year, dobMap);

    // Filter to peak ages (25-29) and minimum IP (50+)
    const qualified = pitchers.filter(p => p.age >= 25 && p.age <= 29 && p.ip >= 50);
    peakPitchers.push(...qualified);
  }

  console.log(`   Loaded ${peakPitchers.length} peak-age pitcher seasons (ages 25-29, 50+ IP)`);
  return peakPitchers;
}

function parseMLBStats(filePath: string, year: number, dobMap: Map<number, Date>): MLBPitcher[] {
  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  if (lines.length === 0) return [];

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idIdx = header.findIndex(h => h === 'player_id' || h === 'playerid');
  const ipIdx = header.findIndex(h => h === 'ip');
  const kIdx = header.findIndex(h => h === 'k' || h === 'so');
  const bbIdx = header.findIndex(h => h === 'bb');
  const hrIdx = header.findIndex(h => h === 'hr' || h === 'hra');

  const results: MLBPitcher[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());

    const ip = parseFloat(cells[ipIdx] || '0');
    if (ip === 0) continue;

    const player_id = parseInt(cells[idIdx] || '0', 10);
    const k = parseFloat(cells[kIdx] || '0');
    const bb = parseFloat(cells[bbIdx] || '0');
    const hr = parseFloat(cells[hrIdx] || '0');

    // Calculate age
    const dob = dobMap.get(player_id);
    const age = calculateAge(dob, year) || 0;

    const k9 = (k / ip) * 9;
    const bb9 = (bb / ip) * 9;
    const hr9 = (hr / ip) * 9;
    const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + 3.47;

    results.push({ player_id, year, age, ip, fip, k9, bb9, hr9 });
  }

  return results;
}

// ============================================================================
// Distribution Analysis
// ============================================================================

function calculateDistributionStats(values: number[]): DistributionStats {
  if (values.length === 0) {
    return { count: 0, min: 0, p10: 0, p25: 0, median: 0, p75: 0, p90: 0, max: 0, mean: 0, stdDev: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const getPercentile = (p: number) => {
    const idx = Math.floor((p / 100) * (n - 1));
    return sorted[idx];
  };

  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  const stdDev = Math.sqrt(variance);

  return {
    count: n,
    min: sorted[0],
    p10: getPercentile(10),
    p25: getPercentile(25),
    median: getPercentile(50),
    p75: getPercentile(75),
    p90: getPercentile(90),
    max: sorted[n - 1],
    mean,
    stdDev,
  };
}

function compareDistributions(
  name1: string,
  values1: number[],
  name2: string,
  values2: number[]
): void {
  const stats1 = calculateDistributionStats(values1);
  const stats2 = calculateDistributionStats(values2);

  console.log(`${name1.padEnd(30)} | ${name2}`);
  console.log('─'.repeat(70));
  console.log(`Count:    ${stats1.count.toString().padEnd(18)} | ${stats2.count}`);
  console.log(`Mean:     ${stats1.mean.toFixed(2).padEnd(18)} | ${stats2.mean.toFixed(2)}`);
  console.log(`Median:   ${stats1.median.toFixed(2).padEnd(18)} | ${stats2.median.toFixed(2)}`);
  console.log(`Std Dev:  ${stats1.stdDev.toFixed(2).padEnd(18)} | ${stats2.stdDev.toFixed(2)}`);
  console.log(`10th %:   ${stats1.p10.toFixed(2).padEnd(18)} | ${stats2.p10.toFixed(2)}`);
  console.log(`25th %:   ${stats1.p25.toFixed(2).padEnd(18)} | ${stats2.p25.toFixed(2)}`);
  console.log(`75th %:   ${stats1.p75.toFixed(2).padEnd(18)} | ${stats2.p75.toFixed(2)}`);
  console.log(`90th %:   ${stats1.p90.toFixed(2).padEnd(18)} | ${stats2.p90.toFixed(2)}`);
  console.log();

  // Calculate alignment score
  const meanDiff = Math.abs(stats1.mean - stats2.mean);
  const medianDiff = Math.abs(stats1.median - stats2.median);
  const p25Diff = Math.abs(stats1.p25 - stats2.p25);
  const p75Diff = Math.abs(stats1.p75 - stats2.p75);

  const alignmentScore = (
    (meanDiff < 0.3 ? 25 : meanDiff < 0.5 ? 15 : 0) +
    (medianDiff < 0.3 ? 25 : medianDiff < 0.5 ? 15 : 0) +
    (p25Diff < 0.4 ? 25 : p25Diff < 0.6 ? 15 : 0) +
    (p75Diff < 0.4 ? 25 : p75Diff < 0.6 ? 15 : 0)
  );

  const grade = alignmentScore >= 80 ? '✅ Excellent' :
                alignmentScore >= 60 ? '⚠️  Good' :
                alignmentScore >= 40 ? '⚠️  Fair' : '❌ Poor';

  console.log(`Alignment Score: ${alignmentScore}/100 ${grade}`);
  console.log();
}

// ============================================================================
// Test 1: Overall FIP Distribution
// ============================================================================

function testFIPDistribution(prospects: Prospect2017[], mlbPitchers: MLBPitcher[]): void {
  console.log('='.repeat(70));
  console.log('TEST 1: Overall FIP Distribution Alignment');
  console.log('='.repeat(70));
  console.log();
  console.log('Question: Do projected peak FIPs match actual MLB peak-age performance?');
  console.log('Note: Comparing prospect peak projections (age 27) to MLB ages 25-29');
  console.log();

  const prospectFips = prospects.map(p => p.projFip);
  const mlbFips = mlbPitchers.map(p => p.fip);

  compareDistributions('2017 Prospects (Peak Proj)', prospectFips, 'MLB Peak Age (25-29)', mlbFips);
}

// ============================================================================
// Test 2: Component Distributions
// ============================================================================

function testComponentDistributions(prospects: Prospect2017[], mlbPitchers: MLBPitcher[]): void {
  console.log('='.repeat(70));
  console.log('TEST 2: Component Distribution Alignment (K9, BB9, HR9)');
  console.log('='.repeat(70));
  console.log();

  console.log('K/9 Distribution:');
  console.log('─'.repeat(70));
  compareDistributions(
    '2017 Prospects (Peak Proj)',
    prospects.map(p => p.projK9),
    'MLB Peak Age (25-29)',
    mlbPitchers.map(p => p.k9)
  );

  console.log('BB/9 Distribution:');
  console.log('─'.repeat(70));
  compareDistributions(
    '2017 Prospects (Peak Proj)',
    prospects.map(p => p.projBb9),
    'MLB Peak Age (25-29)',
    mlbPitchers.map(p => p.bb9)
  );

  console.log('HR/9 Distribution:');
  console.log('─'.repeat(70));
  compareDistributions(
    '2017 Prospects (Peak Proj)',
    prospects.map(p => p.projHr9),
    'MLB Peak Age (25-29)',
    mlbPitchers.map(p => p.hr9)
  );
}

// ============================================================================
// Test 3: Percentile Targets
// ============================================================================

function testPercentileTargets(prospects: Prospect2017[], mlbPitchers: MLBPitcher[]): void {
  console.log('='.repeat(70));
  console.log('TEST 3: Percentile Target Validation');
  console.log('='.repeat(70));
  console.log();
  console.log('Question: Do elite projections target elite MLB levels?');
  console.log();

  const prospectFips = [...prospects].sort((a, b) => a.projFip - b.projFip);
  const mlbFips = [...mlbPitchers].sort((a, b) => a.fip - b.fip);

  const percentiles = [5, 10, 25, 50, 75, 90, 95];

  console.log('Percentile Alignment (FIP):');
  console.log('─'.repeat(70));
  console.log('Percentile | Prospect Projection | MLB Actual | Difference');
  console.log('─'.repeat(70));

  for (const p of percentiles) {
    const prospectIdx = Math.floor((p / 100) * (prospectFips.length - 1));
    const mlbIdx = Math.floor((p / 100) * (mlbFips.length - 1));

    const prospectFip = prospectFips[prospectIdx].projFip;
    const mlbFip = mlbFips[mlbIdx].fip;
    const diff = Math.abs(prospectFip - mlbFip);

    const icon = diff < 0.3 ? '✅' : diff < 0.5 ? '⚠️' : '❌';

    console.log(
      `${p.toString().padStart(4)}th %  | ${prospectFip.toFixed(2).padEnd(19)} | ${mlbFip.toFixed(2).padEnd(10)} | ${diff >= 0 ? '+' : ''}${(prospectFip - mlbFip).toFixed(2).padEnd(10)} ${icon}`
    );
  }

  console.log();
}

// ============================================================================
// Test 4: Tier Target Validation
// ============================================================================

function testTierTargets(prospects: Prospect2017[], mlbPitchers: MLBPitcher[]): void {
  console.log('='.repeat(70));
  console.log('TEST 4: Tier Target Validation');
  console.log('='.repeat(70));
  console.log();
  console.log('Question: Do TFR tiers target appropriate MLB levels?');
  console.log();

  // Define TFR tiers
  const tiers = [
    { name: 'Elite (4.5+)', min: 4.5, max: 10, mlbTarget: '< 3.50 (Elite)' },
    { name: 'Star (4.0-4.4)', min: 4.0, max: 4.5, mlbTarget: '< 3.80 (Star)' },
    { name: 'Above Avg (3.5-3.9)', min: 3.5, max: 4.0, mlbTarget: '< 4.00 (Above Avg)' },
    { name: 'Average (3.0-3.4)', min: 3.0, max: 3.5, mlbTarget: '< 4.30 (Average)' },
  ];

  // Calculate MLB tier cutoffs
  const sortedMLBFips = [...mlbPitchers].sort((a, b) => a.fip - b.fip);
  const mlbElite = sortedMLBFips[Math.floor(0.05 * sortedMLBFips.length)].fip; // Top 5%
  const mlbStar = sortedMLBFips[Math.floor(0.10 * sortedMLBFips.length)].fip;  // Top 10%
  const mlbAboveAvg = sortedMLBFips[Math.floor(0.25 * sortedMLBFips.length)].fip; // Top 25%
  const mlbAverage = sortedMLBFips[Math.floor(0.50 * sortedMLBFips.length)].fip; // Top 50%

  console.log(`MLB Peak-Age Benchmarks (2015-2020, ages 25-29, 50+ IP):`);
  console.log(`  Elite (Top 5%):      ${mlbElite.toFixed(2)} FIP`);
  console.log(`  Star (Top 10%):      ${mlbStar.toFixed(2)} FIP`);
  console.log(`  Above Avg (Top 25%): ${mlbAboveAvg.toFixed(2)} FIP`);
  console.log(`  Average (Top 50%):   ${mlbAverage.toFixed(2)} FIP`);
  console.log();

  console.log('TFR Tier Projections:');
  console.log('─'.repeat(70));

  for (const tier of tiers) {
    const tierProspects = prospects.filter(p => p.tfr >= tier.min && p.tfr < tier.max);

    if (tierProspects.length === 0) {
      console.log(`${tier.name}: No prospects`);
      continue;
    }

    const avgFip = tierProspects.reduce((sum, p) => sum + p.projFip, 0) / tierProspects.length;
    const minFip = Math.min(...tierProspects.map(p => p.projFip));
    const maxFip = Math.max(...tierProspects.map(p => p.projFip));

    console.log(`${tier.name}`);
    console.log(`  Count: ${tierProspects.length}`);
    console.log(`  Avg Projection: ${avgFip.toFixed(2)} FIP`);
    console.log(`  Range: ${minFip.toFixed(2)} - ${maxFip.toFixed(2)}`);
    console.log(`  MLB Target: ${tier.mlbTarget}`);
    console.log();
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('TFR Distribution Validation');
  console.log('Testing percentile-based algorithm distribution alignment');
  console.log('='.repeat(70));
  console.log();

  const prospects = loadProspects2017();
  const mlbPitchers = loadMLBPeakYears();

  if (prospects.length === 0) {
    console.error('❌ No prospects loaded');
    process.exit(1);
  }

  if (mlbPitchers.length === 0) {
    console.error('❌ No MLB data loaded');
    process.exit(1);
  }

  console.log();

  // Run tests
  testFIPDistribution(prospects, mlbPitchers);
  testComponentDistributions(prospects, mlbPitchers);
  testPercentileTargets(prospects, mlbPitchers);
  testTierTargets(prospects, mlbPitchers);

  console.log('='.repeat(70));
  console.log('✅ Validation Complete');
  console.log('='.repeat(70));
  console.log();
  console.log('Summary:');
  console.log('• Distribution alignment shows how well projections match MLB reality');
  console.log('• Component distributions validate K9/BB9/HR9 mapping accuracy');
  console.log('• Percentile targets show if elite prospects → elite MLB levels');
  console.log('• Tier targets validate TFR rating scale calibration');
  console.log();
  console.log('This validates the ALGORITHM, not individual outcomes.');
  console.log('Individual prospects may not reach their ceiling - that\'s prospect risk.');
  console.log();
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
