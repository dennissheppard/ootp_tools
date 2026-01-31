/**
 * TFR Distribution Analysis
 *
 * Analyzes the entire TFR distribution across all prospects:
 * - Overall percentile distribution
 * - Rating tier breakdowns
 * - Statistical measures (mean, median, std dev)
 * - Comparison to expected bell curve
 */

import * as fs from 'fs';
import * as path from 'path';

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
  const filePath = `tools/reports/tfr_prospects_${year}.json`;
  const fullPath = path.join(process.cwd(), filePath);

  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.error('   Please export data from Farm Rankings first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(fullPath, 'utf-8'));
  return data.prospects;
}

function analyzeDistribution(prospects: TFRProspect[]): void {
  console.log('📊 TFR DISTRIBUTION ANALYSIS');
  console.log('='.repeat(80));

  const total = prospects.length;
  const sorted = [...prospects].sort((a, b) => b.tfr - a.tfr);

  // 1. Overall Rating Breakdown
  console.log('\n1️⃣  RATING TIER BREAKDOWN (All Prospects)');
  console.log('-'.repeat(80));

  const tiers = [
    { name: '5.0 (Elite)', min: 5.0, max: Infinity },
    { name: '4.5 (Star)', min: 4.5, max: 5.0 },
    { name: '4.0 (Above Avg)', min: 4.0, max: 4.5 },
    { name: '3.5 (Average)', min: 3.5, max: 4.0 },
    { name: '3.0 (Fringe)', min: 3.0, max: 3.5 },
    { name: '2.5 (Below Avg)', min: 2.5, max: 3.0 },
    { name: '2.0 (Poor)', min: 2.0, max: 2.5 },
    { name: '1.5 (Very Poor)', min: 1.5, max: 2.0 },
    { name: '1.0 (Replacement)', min: 1.0, max: 1.5 },
    { name: '0.5 (Bust)', min: 0.5, max: 1.0 },
  ];

  tiers.forEach(tier => {
    const count = prospects.filter(p => p.tfr >= tier.min && p.tfr < tier.max).length;
    const pct = (count / total * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(count / total * 50));
    console.log(`   ${tier.name.padEnd(20)} ${count.toString().padStart(4)} (${pct.padStart(5)}%) ${bar}`);
  });

  // 2. Cumulative Percentages
  console.log('\n2️⃣  CUMULATIVE PERCENTAGES');
  console.log('-'.repeat(80));

  const cumulative = [
    { label: '4.5+ (Elite)', threshold: 4.5 },
    { label: '4.0+ (Above Avg+)', threshold: 4.0 },
    { label: '3.5+ (Average+)', threshold: 3.5 },
    { label: '3.0+ (Fringe+)', threshold: 3.0 },
    { label: '2.5+ (Below Avg+)', threshold: 2.5 },
  ];

  cumulative.forEach(item => {
    const count = prospects.filter(p => p.tfr >= item.threshold).length;
    const pct = (count / total * 100).toFixed(1);
    console.log(`   ${item.label.padEnd(25)} ${count.toString().padStart(4)} (${pct.padStart(5)}%)`);
  });

  // 3. Percentile Analysis
  console.log('\n3️⃣  PERCENTILE BREAKDOWN');
  console.log('-'.repeat(80));

  const percentiles = [10, 25, 50, 75, 90, 95, 99];
  percentiles.forEach(p => {
    const index = Math.floor((100 - p) / 100 * total);
    const tfr = sorted[index]?.tfr || 0;
    const position = index + 1;
    console.log(`   ${p}th percentile: TFR ${tfr.toFixed(1)} (rank ${position}/${total})`);
  });

  // 4. Statistical Measures
  console.log('\n4️⃣  STATISTICAL MEASURES');
  console.log('-'.repeat(80));

  const tfrValues = prospects.map(p => p.tfr);
  const mean = tfrValues.reduce((a, b) => a + b, 0) / total;
  const median = sorted[Math.floor(total / 2)].tfr;
  const mode = tfrValues.sort((a, b) =>
    tfrValues.filter(v => v === a).length - tfrValues.filter(v => v === b).length
  ).pop() || 0;

  const variance = tfrValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / total;
  const stdDev = Math.sqrt(variance);

  console.log(`   Mean:     ${mean.toFixed(2)}`);
  console.log(`   Median:   ${median.toFixed(1)}`);
  console.log(`   Mode:     ${mode.toFixed(1)}`);
  console.log(`   Std Dev:  ${stdDev.toFixed(2)}`);
  console.log(`   Range:    ${Math.min(...tfrValues).toFixed(1)} - ${Math.max(...tfrValues).toFixed(1)}`);

  // 5. Top Slices Analysis
  console.log('\n5️⃣  TOP SLICES ANALYSIS');
  console.log('-'.repeat(80));

  const slices = [
    { name: 'Top 50', size: 50 },
    { name: 'Top 100', size: 100 },
    { name: 'Top 200', size: 200 },
    { name: 'Top 500', size: 500 },
  ];

  slices.forEach(slice => {
    const group = sorted.slice(0, slice.size);
    const below40 = group.filter(p => p.tfr < 4.0).length;
    const below35 = group.filter(p => p.tfr < 3.5).length;
    const avgTfr = group.reduce((sum, p) => sum + p.tfr, 0) / group.length;
    const minTfr = group[group.length - 1].tfr;

    console.log(`\n   ${slice.name}:`);
    console.log(`      Average TFR: ${avgTfr.toFixed(2)}`);
    console.log(`      Min TFR:     ${minTfr.toFixed(1)}`);
    console.log(`      Below 4.0:   ${below40} (${(below40/slice.size*100).toFixed(1)}%)`);
    console.log(`      Below 3.5:   ${below35} (${(below35/slice.size*100).toFixed(1)}%)`);
  });

  // 6. Level-Based Distribution
  console.log('\n6️⃣  RATING DISTRIBUTION BY LEVEL');
  console.log('-'.repeat(80));

  const levels = ['AAA', 'AA', 'A', 'Rookie'];
  levels.forEach(levelName => {
    const levelProspects = prospects.filter(p => {
      const level = p.level.toLowerCase();
      if (levelName === 'AAA') return level.includes('aaa');
      if (levelName === 'AA') return level.includes('aa') && !level.includes('aaa');
      if (levelName === 'A') return level.includes('a') && !level.includes('aa');
      if (levelName === 'Rookie') return level.includes('rookie') || level === 'r' || level === 'r-';
      return false;
    });

    if (levelProspects.length === 0) return;

    const avgTfr = levelProspects.reduce((sum, p) => sum + p.tfr, 0) / levelProspects.length;
    const above40 = levelProspects.filter(p => p.tfr >= 4.0).length;

    console.log(`   ${levelName.padEnd(8)} (n=${levelProspects.length.toString().padEnd(4)}): Avg TFR ${avgTfr.toFixed(2)}, ${above40} above 4.0 (${(above40/levelProspects.length*100).toFixed(1)}%)`);
  });

  // 7. Age-Based Distribution
  console.log('\n7️⃣  RATING DISTRIBUTION BY AGE');
  console.log('-'.repeat(80));

  const ageGroups = [
    { name: '≤20', min: 0, max: 20 },
    { name: '21-22', min: 21, max: 22 },
    { name: '23-24', min: 23, max: 24 },
    { name: '25-26', min: 25, max: 26 },
    { name: '27+', min: 27, max: 99 },
  ];

  ageGroups.forEach(group => {
    const ageProspects = prospects.filter(p => p.age >= group.min && p.age <= group.max);
    if (ageProspects.length === 0) return;

    const avgTfr = ageProspects.reduce((sum, p) => sum + p.tfr, 0) / ageProspects.length;
    const above40 = ageProspects.filter(p => p.tfr >= 4.0).length;

    console.log(`   Age ${group.name.padEnd(8)} (n=${ageProspects.length.toString().padEnd(4)}): Avg TFR ${avgTfr.toFixed(2)}, ${above40} above 4.0 (${(above40/ageProspects.length*100).toFixed(1)}%)`);
  });

  console.log('\n' + '='.repeat(80));
}

// Main execution
const prospects = loadTFRProspects(2020);
analyzeDistribution(prospects);
