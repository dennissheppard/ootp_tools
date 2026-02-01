/**
 * TFR Percentile-Based Prototype
 *
 * Tests a new approach: Instead of projecting absolute rates (K9/BB9/HR9),
 * rank prospects by percentile and map to actual MLB distributions.
 *
 * Philosophy:
 * - We can't predict if AAA 7.0 K9 → MLB 7.1 or 8.5 (huge variance)
 * - But we CAN predict that 73rd %ile prospect → ~73rd %ile MLB pitcher
 * - Use actual MLB percentile distributions as the projection basis
 *
 * Usage: npx ts-node tools/research/tfr_percentile_prototype.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Types
// ============================================================================

interface Prospect {
  playerId: number;
  name: string;
  age: number;
  tfr: number;
  projFip: number;
  level: string;
  totalMinorIp: number;
}

interface MLBPitcher {
  player_id: number;
  age: number;
  ip: number;
  k9: number;
  bb9: number;
  hr9: number;
  fip: number;
}

interface PercentileDistribution {
  percentiles: number[]; // [0, 10, 20, ... 100]
  k9Values: number[];
  bb9Values: number[];
  hr9Values: number[];
}

interface ProspectWithPercentiles {
  playerId: number;
  name: string;
  age: number;
  stuffPercentile: number;
  controlPercentile: number;
  hraPercentile: number;
  projK9: number;
  projBb9: number;
  projHr9: number;
  projFip: number;
  oldTfr: number;
  oldProjFip: number;
}

// ============================================================================
// Constants
// ============================================================================

const FIP_CONSTANT = 3.47;

// ============================================================================
// Data Loading
// ============================================================================

function loadProspects2017(): Prospect[] {
  const filePath = path.join(__dirname, '../reports/tfr_prospects_2017.json');
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.prospects || [];
}

function loadMLBStats(year: number): MLBPitcher[] {
  const filePath = path.join(__dirname, `../../public/data/mlb/${year}.csv`);
  if (!fs.existsSync(filePath)) return [];

  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idIdx = header.findIndex(h => h === 'player_id');
  const ipIdx = header.findIndex(h => h === 'ip');
  const kIdx = header.findIndex(h => h === 'k');
  const bbIdx = header.findIndex(h => h === 'bb');
  const hraIdx = header.findIndex(h => h === 'hra');

  const results: MLBPitcher[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const ip = parseFloat(cells[ipIdx] || '0');
    if (ip < 20) continue; // Minimum IP for meaningful data

    const player_id = parseInt(cells[idIdx] || '0', 10);
    const k = parseFloat(cells[kIdx] || '0');
    const bb = parseFloat(cells[bbIdx] || '0');
    const hra = parseFloat(cells[hraIdx] || '0');

    const k9 = (k / ip) * 9;
    const bb9 = (bb / ip) * 9;
    const hr9 = (hra / ip) * 9;
    const fip = ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;

    results.push({ player_id, age: 0, ip, k9, bb9, hr9, fip }); // age not available
  }

  return results;
}

// ============================================================================
// MLB Percentile Distribution Builder
// ============================================================================

function buildMLBPercentileDistribution(years: number[], peakAgeMin: number = 24, peakAgeMax: number = 29): PercentileDistribution {
  console.log(`Building MLB percentile distributions from ${years.join(', ')}...`);

  // Load all MLB pitchers from specified years
  const allPitchers: MLBPitcher[] = [];
  for (const year of years) {
    const yearPitchers = loadMLBStats(year);
    allPitchers.push(...yearPitchers);
  }

  // For prototype: Use all pitchers (age data not available in CSV)
  const peakPitchers = allPitchers;
  console.log(`  Loaded ${peakPitchers.length} MLB pitchers`);

  // Sort by each metric
  const k9Sorted = [...peakPitchers].sort((a, b) => a.k9 - b.k9);
  const bb9Sorted = [...peakPitchers].sort((a, b) => a.bb9 - b.bb9); // Lower is better
  const hr9Sorted = [...peakPitchers].sort((a, b) => a.hr9 - b.hr9); // Lower is better

  // Calculate percentiles (0, 10, 20, ... 100)
  const percentiles = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const k9Values: number[] = [];
  const bb9Values: number[] = [];
  const hr9Values: number[] = [];

  for (const pct of percentiles) {
    const idx = Math.floor((pct / 100) * (k9Sorted.length - 1));
    k9Values.push(k9Sorted[idx].k9);
    bb9Values.push(bb9Sorted[idx].bb9);
    hr9Values.push(hr9Sorted[idx].hr9);
  }

  console.log('  MLB Percentile Examples:');
  console.log(`    50th %ile: K9=${k9Values[5].toFixed(2)}, BB9=${bb9Values[5].toFixed(2)}, HR9=${hr9Values[5].toFixed(2)}`);
  console.log(`    90th %ile: K9=${k9Values[9].toFixed(2)}, BB9=${bb9Values[1].toFixed(2)}, HR9=${hr9Values[1].toFixed(2)}`);
  console.log();

  return { percentiles, k9Values, bb9Values, hr9Values };
}

function interpolatePercentile(percentile: number, distribution: PercentileDistribution, metric: 'k9' | 'bb9' | 'hr9'): number {
  const { percentiles } = distribution;
  const values = metric === 'k9' ? distribution.k9Values :
                 metric === 'bb9' ? distribution.bb9Values :
                 distribution.hr9Values;

  // Clamp percentile to [0, 100]
  percentile = Math.max(0, Math.min(100, percentile));

  // Find surrounding percentiles
  let lowerIdx = 0;
  for (let i = 0; i < percentiles.length; i++) {
    if (percentiles[i] <= percentile) lowerIdx = i;
    else break;
  }

  const upperIdx = Math.min(lowerIdx + 1, percentiles.length - 1);

  if (lowerIdx === upperIdx) return values[lowerIdx];

  // Linear interpolation
  const lowerPct = percentiles[lowerIdx];
  const upperPct = percentiles[upperIdx];
  const lowerVal = values[lowerIdx];
  const upperVal = values[upperIdx];

  const ratio = (percentile - lowerPct) / (upperPct - lowerPct);
  return lowerVal + ratio * (upperVal - lowerVal);
}

// ============================================================================
// Prospect Percentile Ranking
// ============================================================================

/**
 * For now, use a simple approach: Rank prospects by their OLD projected rates
 * (from existing TFR system) to get percentiles.
 *
 * In the full implementation, we'd blend scouting + minor league stats
 * separately for each component (stuff/control/HRA).
 */
function rankProspectsByOldProjections(prospects: Prospect[]): ProspectWithPercentiles[] {
  console.log('Ranking prospects by OLD projected rates to get percentiles...');

  // We need to reverse-engineer K9/BB9/HR9 from the old FIP
  // For prototype, let's use a simplified approach:
  // - Assume league-average rates as baseline
  // - Rank by FIP as proxy for "stuff" (lower FIP = higher percentile)
  // This is simplified but tests the concept

  // For this prototype, let's use the old TFR to rank overall talent
  // and assume prospects ranked higher have better stuff/control/HRA

  const sorted = [...prospects].sort((a, b) => a.projFip - b.projFip); // Lower FIP is better

  const results: ProspectWithPercentiles[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const prospect = sorted[i];

    // Calculate percentile (0-100, higher = better)
    const percentile = ((sorted.length - i - 1) / (sorted.length - 1)) * 100;

    // For prototype: assume balanced ratings
    // In reality, we'd calculate stuff/control/HRA separately
    const stuffPercentile = percentile; // Simplified
    const controlPercentile = percentile; // Simplified
    const hraPercentile = percentile; // Simplified

    results.push({
      playerId: prospect.playerId,
      name: prospect.name,
      age: prospect.age,
      stuffPercentile,
      controlPercentile,
      hraPercentile,
      projK9: 0, // Will be filled in next step
      projBb9: 0,
      projHr9: 0,
      projFip: 0,
      oldTfr: prospect.tfr,
      oldProjFip: prospect.projFip
    });
  }

  console.log(`  Ranked ${results.length} prospects`);
  console.log();

  return results;
}

// ============================================================================
// Percentile Mapping
// ============================================================================

function mapPercentilestoMLB(
  prospects: ProspectWithPercentiles[],
  mlbDist: PercentileDistribution
): ProspectWithPercentiles[] {
  console.log('Mapping prospect percentiles to MLB distributions...');

  for (const prospect of prospects) {
    // Map percentiles to MLB rates
    prospect.projK9 = interpolatePercentile(prospect.stuffPercentile, mlbDist, 'k9');
    prospect.projBb9 = interpolatePercentile(100 - prospect.controlPercentile, mlbDist, 'bb9'); // Invert - high %ile = low BB9
    prospect.projHr9 = interpolatePercentile(100 - prospect.hraPercentile, mlbDist, 'hr9'); // Invert - high %ile = low HR9

    // Calculate FIP
    prospect.projFip = ((13 * prospect.projHr9 + 3 * prospect.projBb9 - 2 * prospect.projK9) / 9) + FIP_CONSTANT;
  }

  console.log('  Example mappings:');
  const samples = [0, Math.floor(prospects.length / 4), Math.floor(prospects.length / 2), prospects.length - 1];
  for (const idx of samples) {
    const p = prospects[idx];
    console.log(`    ${p.name} (${p.stuffPercentile.toFixed(0)}th %ile):`);
    console.log(`      K9: ${p.projK9.toFixed(2)}, BB9: ${p.projBb9.toFixed(2)}, HR9: ${p.projHr9.toFixed(2)}`);
    console.log(`      NEW FIP: ${p.projFip.toFixed(2)} (OLD: ${p.oldProjFip.toFixed(2)})`);
  }
  console.log();

  return prospects;
}

// ============================================================================
// Validation
// ============================================================================

function validateAgainstActuals(prospects: ProspectWithPercentiles[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('Validation: Percentile-Based vs Current System');
  console.log('='.repeat(70));
  console.log();

  // Load actual MLB outcomes (2018-2021)
  const actualMLB = new Map<number, { fip: number; ip: number }>();

  for (let year = 2018; year <= 2021; year++) {
    const yearStats = loadMLBStats(year);
    for (const stat of yearStats) {
      if (!actualMLB.has(stat.player_id)) {
        actualMLB.set(stat.player_id, { fip: stat.fip, ip: stat.ip });
      } else {
        // Aggregate multiple years (weighted by IP)
        const existing = actualMLB.get(stat.player_id)!;
        const totalIp = existing.ip + stat.ip;
        const weightedFip = (existing.fip * existing.ip + stat.fip * stat.ip) / totalIp;
        actualMLB.set(stat.player_id, { fip: weightedFip, ip: totalIp });
      }
    }
  }

  // Filter to prospects who reached MLB
  const prospectsWithMLB = prospects.filter(p => actualMLB.has(p.playerId));
  console.log(`Found ${prospectsWithMLB.length} prospects who reached MLB\n`);

  if (prospectsWithMLB.length === 0) {
    console.log('⚠️  No prospects reached MLB. Cannot validate.');
    return;
  }

  // Calculate correlations
  const newProjFips = prospectsWithMLB.map(p => p.projFip);
  const oldProjFips = prospectsWithMLB.map(p => p.oldProjFip);
  const actualFips = prospectsWithMLB.map(p => actualMLB.get(p.playerId)!.fip);

  const newCorr = calculateCorrelation(newProjFips, actualFips);
  const oldCorr = calculateCorrelation(oldProjFips, actualFips);

  console.log('Correlation Results:');
  console.log(`  OLD System: ${oldCorr.toFixed(3)}`);
  console.log(`  NEW System: ${newCorr.toFixed(3)}`);
  console.log(`  Improvement: ${(newCorr > oldCorr ? '+' : '')}${(newCorr - oldCorr).toFixed(3)}`);
  console.log();

  // Calculate MAE
  const newMAE = calculateMAE(newProjFips, actualFips);
  const oldMAE = calculateMAE(oldProjFips, actualFips);

  console.log('Mean Absolute Error:');
  console.log(`  OLD System: ${oldMAE.toFixed(2)}`);
  console.log(`  NEW System: ${newMAE.toFixed(2)}`);
  console.log(`  Improvement: ${(newMAE < oldMAE ? '-' : '+')}${Math.abs(newMAE - oldMAE).toFixed(2)}`);
  console.log();

  // Show top 10
  const sorted = [...prospectsWithMLB].sort((a, b) => {
    const aActual = actualMLB.get(a.playerId)!.fip;
    const bActual = actualMLB.get(b.playerId)!.fip;
    return aActual - bActual;
  });

  console.log('Top 10 MLB Performers (Actual FIP):');
  console.log('─'.repeat(70));
  sorted.slice(0, 10).forEach((p, i) => {
    const actual = actualMLB.get(p.playerId)!.fip;
    const newErr = actual - p.projFip;
    const oldErr = actual - p.oldProjFip;

    console.log(`${i + 1}. ${p.name}`);
    console.log(`   Actual: ${actual.toFixed(2)} | NEW Proj: ${p.projFip.toFixed(2)} (err: ${newErr.toFixed(2)}) | OLD Proj: ${p.oldProjFip.toFixed(2)} (err: ${oldErr.toFixed(2)})`);
  });
  console.log();
}

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

function calculateMAE(predicted: number[], actual: number[]): number {
  if (predicted.length !== actual.length || predicted.length === 0) return 0;

  let sum = 0;
  for (let i = 0; i < predicted.length; i++) {
    sum += Math.abs(predicted[i] - actual[i]);
  }

  return sum / predicted.length;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('TFR Percentile-Based Prototype');
  console.log('Testing: Rank prospects → Map to MLB %ile distributions');
  console.log('='.repeat(70));
  console.log();

  // Step 1: Build MLB percentile distributions (2015-2017, peak ages 24-29)
  const mlbDist = buildMLBPercentileDistribution([2015, 2016, 2017], 24, 29);

  // Step 2: Load 2017 prospects
  const prospects = loadProspects2017();
  console.log(`Loaded ${prospects.length} prospects from 2017\n`);

  // Step 3: Rank prospects (simplified - by old FIP as proxy)
  let rankedProspects = rankProspectsByOldProjections(prospects);

  // Step 4: Map percentiles to MLB distributions
  rankedProspects = mapPercentilestoMLB(rankedProspects, mlbDist);

  // Step 5: Validate against actual 2018-2021 outcomes
  validateAgainstActuals(rankedProspects);

  console.log('='.repeat(70));
  console.log('✅ Prototype Complete');
  console.log('='.repeat(70));
  console.log();
  console.log('Note: This is a simplified prototype. Full implementation would:');
  console.log('  1. Blend scouting + minors separately for stuff/control/HRA');
  console.log('  2. Apply age/level weighting to blending');
  console.log('  3. Rank each component independently');
  console.log('  4. Map each to MLB distributions separately');
  console.log();
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
