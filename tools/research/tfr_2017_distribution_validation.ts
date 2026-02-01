/**
 * TFR 2017 Distribution Validation (NEW Percentile-Based Algorithm)
 *
 * Tests the NEW algorithm using distribution-based metrics.
 * Focus: Do groups of prospects align to MLB reality?
 *
 * Metrics:
 * 1. MLB arrival rates by TFR tier
 * 2. Group-level performance (projected vs actual FIP by tier)
 * 3. Correlation (tier-based, not individual)
 * 4. Distribution shape alignment
 *
 * Usage: npx tsx tools/research/tfr_2017_distribution_validation.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface Prospect2017New {
  playerId: number;
  name: string;
  age: number;
  level: string;
  tfr: number;
  tfrPercentile: number;
  stuffPercentile: number;
  controlPercentile: number;
  hraPercentile: number;
  projFip: number;
  projK9: number;
  projBb9: number;
  projHr9: number;
  projWar: number;
  totalMinorIp: number;
}

interface MLBStats {
  player_id: number;
  player_name?: string;
  year: number;
  ip: number;
  k: number;
  bb: number;
  hra: number;
  k9?: number;
  bb9?: number;
  hr9?: number;
}

interface TierAnalysis {
  tierName: string;
  tfrRange: string;
  prospectCount: number;
  avgProjectedFip: number;
  mlbArrivals: number;
  mlbArrivalRate: number;
  avgActualFip: number;
  avgActualK9: number;
  avgActualBb9: number;
  avgActualHr9: number;
  totalMLBIp: number;
}

// ============================================================================
// Data Loading
// ============================================================================

function loadProspects2017New(): Prospect2017New[] {
  const filePath = path.join(__dirname, '../reports/tfr_prospects_2017_new.json');

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    console.error('Please export 2017 prospects from Farm Rankings first.');
    console.error('Navigate to Farm Rankings → Year 2017 → "Export for Testing"');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log(`📄 Loaded export: ${data.algorithm || 'unknown algorithm'}`);
  console.log(`   Generated: ${data.generated || 'unknown date'}`);
  console.log(`   Total prospects: ${data.totalProspects || 0}`);
  console.log();

  return data.prospects || [];
}

function loadMLBStats(year: number): MLBStats[] {
  const filePath = path.join(__dirname, `../../public/data/mlb/${year}.csv`);

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  MLB stats not found: ${path.basename(filePath)}`);
    return [];
  }

  return parseStatsCSV(fs.readFileSync(filePath, 'utf-8'), year);
}

function parseStatsCSV(csvText: string, year: number): MLBStats[] {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idIdx = header.findIndex(h => h === 'player_id' || h === 'playerid');
  const nameIdx = header.findIndex(h => h === 'name' || h === 'player_name' || h === 'playername');
  const ipIdx = header.findIndex(h => h === 'ip');
  const hrIdx = header.findIndex(h => h === 'hr' || h === 'hra');
  const bbIdx = header.findIndex(h => h === 'bb');
  const kIdx = header.findIndex(h => h === 'k' || h === 'so');

  const results: MLBStats[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.trim());

    const ipStr = cells[ipIdx] || '0';
    const ip = parseFloat(ipStr);
    if (ip === 0) continue;

    const player_id = parseInt(cells[idIdx] || '0', 10);
    const k = parseFloat(cells[kIdx] || '0');
    const bb = parseFloat(cells[bbIdx] || '0');
    const hra = parseFloat(cells[hrIdx] || '0');

    // Calculate rate stats
    const k9 = (k / ip) * 9;
    const bb9 = (bb / ip) * 9;
    const hr9 = (hra / ip) * 9;

    results.push({
      player_id,
      player_name: nameIdx >= 0 ? cells[nameIdx] : undefined,
      year,
      ip,
      k,
      bb,
      hra,
      k9,
      bb9,
      hr9,
    });
  }

  return results;
}

// ============================================================================
// Validation: MLB Arrival Rates
// ============================================================================

function validateMLBArrivalRates(prospects: Prospect2017New[]): void {
  console.log('='.repeat(70));
  console.log('TEST 1: MLB Arrival Rates by TFR Tier');
  console.log('='.repeat(70));
  console.log();

  // Load MLB stats for 2018-2021 to check who reached MLB
  const mlbYears = [2018, 2019, 2020, 2021];
  const mlbPlayerIds = new Set<number>();

  for (const year of mlbYears) {
    const mlbStats = loadMLBStats(year);
    mlbStats
      .filter(s => s.ip >= 10) // At least 10 IP to count as MLB arrival
      .forEach(s => mlbPlayerIds.add(s.player_id));
  }

  console.log(`📊 Found ${mlbPlayerIds.size} unique MLB pitchers (2018-2021, 10+ IP)`);
  console.log();

  // Define TFR tiers
  const tiers = [
    { name: 'Elite (4.5+)', min: 4.5, max: 10, expectedRate: 0.50 },
    { name: 'Star (4.0-4.4)', min: 4.0, max: 4.5, expectedRate: 0.40 },
    { name: 'Above Avg (3.5-3.9)', min: 3.5, max: 4.0, expectedRate: 0.30 },
    { name: 'Average (3.0-3.4)', min: 3.0, max: 3.5, expectedRate: 0.20 },
    { name: 'Fringe (2.5-2.9)', min: 2.5, max: 3.0, expectedRate: 0.10 },
    { name: 'Below Avg (<2.5)', min: 0, max: 2.5, expectedRate: 0.05 },
  ];

  console.log('MLB Arrival Rates by TFR Tier:');
  console.log('─'.repeat(70));

  const tierResults: Array<{ name: string; count: number; arrivals: number; rate: number }> = [];

  for (const tier of tiers) {
    const tierProspects = prospects.filter(p => p.tfr >= tier.min && p.tfr < tier.max);
    const arrivals = tierProspects.filter(p => mlbPlayerIds.has(p.playerId)).length;
    const rate = tierProspects.length > 0 ? arrivals / tierProspects.length : 0;

    tierResults.push({
      name: tier.name,
      count: tierProspects.length,
      arrivals,
      rate,
    });

    const ratePass = rate >= tier.expectedRate * 0.8; // Allow 20% margin
    const rateIcon = ratePass ? '✅' : '⚠️';

    console.log(`${tier.name}`);
    console.log(`  Prospects: ${tierProspects.length}`);
    console.log(`  Reached MLB: ${arrivals} (${(rate * 100).toFixed(1)}%) ${rateIcon}`);
    console.log(`  Expected: ${(tier.expectedRate * 100).toFixed(0)}%+`);
    console.log();
  }

  // Save results
  const outputPath = path.join(__dirname, '../reports/2017_arrival_rates_new.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        summary: {
          totalProspects: prospects.length,
          totalMLBArrivals: mlbPlayerIds.size,
          overallRate: mlbPlayerIds.size / prospects.length,
        },
        tiers: tierResults,
      },
      null,
      2
    )
  );

  console.log(`💾 Saved to: ${path.basename(outputPath)}`);
}

// ============================================================================
// Validation: Group-Level Performance
// ============================================================================

function validateGroupPerformance(prospects: Prospect2017New[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 2: Group-Level Performance (Projected vs Actual FIP)');
  console.log('='.repeat(70));
  console.log();

  // Load MLB stats for 2018-2021
  const mlbYears = [2018, 2019, 2020, 2021];
  const mlbStatsByPlayer = new Map<number, MLBStats[]>();

  for (const year of mlbYears) {
    const mlbStats = loadMLBStats(year);
    mlbStats.forEach(stat => {
      if (!mlbStatsByPlayer.has(stat.player_id)) {
        mlbStatsByPlayer.set(stat.player_id, []);
      }
      mlbStatsByPlayer.get(stat.player_id)!.push(stat);
    });
  }

  console.log(`📊 Loaded MLB stats for ${mlbStatsByPlayer.size} pitchers (2018-2021)`);
  console.log();

  // Define TFR tiers
  const tiers = [
    { name: 'Elite (4.5+)', min: 4.5, max: 10 },
    { name: 'Star (4.0-4.4)', min: 4.0, max: 4.5 },
    { name: 'Above Avg (3.5-3.9)', min: 3.5, max: 4.0 },
    { name: 'Average (3.0-3.4)', min: 3.0, max: 3.5 },
  ];

  const tierAnalysis: TierAnalysis[] = [];

  console.log('Group Performance by TFR Tier:');
  console.log('─'.repeat(70));

  for (const tier of tiers) {
    const tierProspects = prospects.filter(p => p.tfr >= tier.min && p.tfr < tier.max);

    if (tierProspects.length === 0) {
      console.log(`${tier.name}: No prospects`);
      console.log();
      continue;
    }

    // Calculate average projected FIP
    const avgProjFip = tierProspects.reduce((sum, p) => sum + p.projFip, 0) / tierProspects.length;

    // Find prospects who reached MLB
    const mlbProspects = tierProspects.filter(p => mlbStatsByPlayer.has(p.playerId));

    if (mlbProspects.length === 0) {
      console.log(`${tier.name}`);
      console.log(`  Prospects: ${tierProspects.length}`);
      console.log(`  Avg Projected FIP: ${avgProjFip.toFixed(2)}`);
      console.log(`  MLB Arrivals: 0 - Cannot validate performance`);
      console.log();
      continue;
    }

    // Calculate weighted average actual performance
    let totalIp = 0;
    let weightedK9 = 0;
    let weightedBb9 = 0;
    let weightedHr9 = 0;

    for (const prospect of mlbProspects) {
      const stats = mlbStatsByPlayer.get(prospect.playerId)!;
      const prospectTotalIp = stats.reduce((sum, s) => sum + s.ip, 0);
      const prospectWeightedK9 = stats.reduce((sum, s) => sum + (s.k9 || 0) * s.ip, 0);
      const prospectWeightedBb9 = stats.reduce((sum, s) => sum + (s.bb9 || 0) * s.ip, 0);
      const prospectWeightedHr9 = stats.reduce((sum, s) => sum + (s.hr9 || 0) * s.ip, 0);

      totalIp += prospectTotalIp;
      weightedK9 += prospectWeightedK9;
      weightedBb9 += prospectWeightedBb9;
      weightedHr9 += prospectWeightedHr9;
    }

    const avgK9 = weightedK9 / totalIp;
    const avgBb9 = weightedBb9 / totalIp;
    const avgHr9 = weightedHr9 / totalIp;
    const avgActualFip = ((13 * avgHr9 + 3 * avgBb9 - 2 * avgK9) / 9) + 3.47;

    const fipDiff = avgActualFip - avgProjFip;
    const fipDiffIcon = Math.abs(fipDiff) < 0.5 ? '✅' : Math.abs(fipDiff) < 1.0 ? '⚠️' : '❌';

    console.log(`${tier.name}`);
    console.log(`  Prospects: ${tierProspects.length} (${mlbProspects.length} reached MLB)`);
    console.log(`  Avg Projected FIP: ${avgProjFip.toFixed(2)}`);
    console.log(`  Avg Actual FIP: ${avgActualFip.toFixed(2)} ${fipDiffIcon}`);
    console.log(`  Difference: ${fipDiff >= 0 ? '+' : ''}${fipDiff.toFixed(2)}`);
    console.log(`  Total MLB IP: ${totalIp.toFixed(1)}`);
    console.log(`  Actual K9: ${avgK9.toFixed(2)} (proj: ${tierProspects.reduce((s, p) => s + p.projK9, 0) / tierProspects.length.toFixed(2)})`);
    console.log(`  Actual BB9: ${avgBb9.toFixed(2)} (proj: ${tierProspects.reduce((s, p) => s + p.projBb9, 0) / tierProspects.length.toFixed(2)})`);
    console.log(`  Actual HR9: ${avgHr9.toFixed(2)} (proj: ${tierProspects.reduce((s, p) => s + p.projHr9, 0) / tierProspects.length.toFixed(2)})`);
    console.log();

    tierAnalysis.push({
      tierName: tier.name,
      tfrRange: `${tier.min}-${tier.max}`,
      prospectCount: tierProspects.length,
      avgProjectedFip: avgProjFip,
      mlbArrivals: mlbProspects.length,
      mlbArrivalRate: mlbProspects.length / tierProspects.length,
      avgActualFip,
      avgActualK9: avgK9,
      avgActualBb9: avgBb9,
      avgActualHr9: avgHr9,
      totalMLBIp: totalIp,
    });
  }

  // Save results
  const outputPath = path.join(__dirname, '../reports/2017_group_performance_new.json');
  fs.writeFileSync(outputPath, JSON.stringify({ tiers: tierAnalysis }, null, 2));

  console.log(`💾 Saved to: ${path.basename(outputPath)}`);
}

// ============================================================================
// Validation: Correlation
// ============================================================================

function validateCorrelation(prospects: Prospect2017New[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: Correlation (Projected vs Actual FIP)');
  console.log('='.repeat(70));
  console.log();

  // Load MLB stats for 2018-2021
  const mlbYears = [2018, 2019, 2020, 2021];
  const mlbStatsByPlayer = new Map<number, MLBStats[]>();

  for (const year of mlbYears) {
    const mlbStats = loadMLBStats(year);
    mlbStats.forEach(stat => {
      if (!mlbStatsByPlayer.has(stat.player_id)) {
        mlbStatsByPlayer.set(stat.player_id, []);
      }
      mlbStatsByPlayer.get(stat.player_id)!.push(stat);
    });
  }

  // Build paired data (projected, actual)
  const pairs: Array<{ projected: number; actual: number; name: string }> = [];

  for (const prospect of prospects) {
    const mlbStats = mlbStatsByPlayer.get(prospect.playerId);
    if (!mlbStats || mlbStats.length === 0) continue;

    // Calculate weighted average actual FIP
    const totalIp = mlbStats.reduce((sum, s) => sum + s.ip, 0);
    if (totalIp < 20) continue; // Minimum 20 IP

    const weightedK9 = mlbStats.reduce((sum, s) => sum + (s.k9 || 0) * s.ip, 0) / totalIp;
    const weightedBb9 = mlbStats.reduce((sum, s) => sum + (s.bb9 || 0) * s.ip, 0) / totalIp;
    const weightedHr9 = mlbStats.reduce((sum, s) => sum + (s.hr9 || 0) * s.ip, 0) / totalIp;
    const actualFip = ((13 * weightedHr9 + 3 * weightedBb9 - 2 * weightedK9) / 9) + 3.47;

    pairs.push({
      projected: prospect.projFip,
      actual: actualFip,
      name: prospect.name,
    });
  }

  console.log(`📊 Found ${pairs.length} prospects with MLB data (20+ IP)`);
  console.log();

  if (pairs.length < 10) {
    console.log('⚠️  Not enough data for correlation analysis');
    return;
  }

  // Calculate correlation
  const correlation = calculateCorrelation(
    pairs.map(p => p.projected),
    pairs.map(p => p.actual)
  );

  const corrIcon = correlation > 0.25 ? '✅' : correlation > 0.15 ? '⚠️' : '❌';

  console.log(`Correlation (Projected FIP vs Actual FIP): ${correlation.toFixed(3)} ${corrIcon}`);
  console.log(`  Target: >0.25 (meaningful signal)`);
  console.log(`  Baseline (old algorithm): 0.140`);
  console.log();

  // Show top/bottom performers
  const sorted = [...pairs].sort((a, b) => a.actual - b.actual);

  console.log('Top 10 Actual Performers:');
  console.log('─'.repeat(70));
  sorted.slice(0, 10).forEach((p, i) => {
    const error = p.actual - p.projected;
    console.log(
      `${i + 1}. ${p.name.padEnd(25)} Proj: ${p.projected.toFixed(2)} | Actual: ${p.actual.toFixed(2)} | Err: ${error >= 0 ? '+' : ''}${error.toFixed(2)}`
    );
  });

  console.log();
  console.log('Bottom 10 Actual Performers:');
  console.log('─'.repeat(70));
  sorted.slice(-10).reverse().forEach((p, i) => {
    const error = p.actual - p.projected;
    console.log(
      `${i + 1}. ${p.name.padEnd(25)} Proj: ${p.projected.toFixed(2)} | Actual: ${p.actual.toFixed(2)} | Err: ${error >= 0 ? '+' : ''}${error.toFixed(2)}`
    );
  });

  // Save results
  const outputPath = path.join(__dirname, '../reports/2017_correlation_new.json');
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        correlation,
        sampleSize: pairs.length,
        pairs: sorted,
      },
      null,
      2
    )
  );

  console.log();
  console.log(`💾 Saved to: ${path.basename(outputPath)}`);
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) return 0;

  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('TFR 2017 Distribution Validation (NEW Algorithm)');
  console.log('Testing percentile-based projections against 2018-2021 outcomes');
  console.log('='.repeat(70));
  console.log();

  const prospects = loadProspects2017New();

  if (prospects.length === 0) {
    console.error('❌ No prospects found. Please export 2017 data first.');
    console.error('Navigate to Farm Rankings → Year 2017 → "Export for Testing"');
    process.exit(1);
  }

  console.log(`Loaded ${prospects.length} prospects from 2017`);
  console.log();

  // Run validation tests
  validateMLBArrivalRates(prospects);
  validateGroupPerformance(prospects);
  validateCorrelation(prospects);

  console.log('\n' + '='.repeat(70));
  console.log('✅ Validation Complete');
  console.log('='.repeat(70));
  console.log();
  console.log('Results saved to tools/reports/:');
  console.log('  - 2017_arrival_rates_new.json');
  console.log('  - 2017_group_performance_new.json');
  console.log('  - 2017_correlation_new.json');
  console.log();
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
