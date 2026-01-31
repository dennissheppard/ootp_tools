/**
 * TFR Parameter Optimization
 *
 * Automatically searches for optimal confidence factor parameters
 * to achieve desired TFR distribution and level balance.
 *
 * Uses random search to explore parameter space and scores each
 * combination against test criteria.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const ITERATIONS = 10000; // Number of random combinations to try
const TOP_RESULTS = 10; // Show top N results

// Test criteria weights (higher = more important)
// Level distribution is now PERFECT, so lower those weights
// Focus on compression (24% → 40-50%) and Elite/Above Avg distribution
const WEIGHTS = {
  eliteDistribution: 2.5,      // Elite: 3-7% (slightly low at 1.6%)
  aboveAvgDistribution: 2.5,   // Above Avg: 10-20% (slightly low at 5.5%)
  averageDistribution: 1.0,    // Average: 30-45% (good at 40%)
  compressionTest: 4.0,        // 50%+ of top 100 below 4.0 (MAIN ISSUE: 24%)
  aaaLevel: 0.5,               // AAA: 30-45% (PERFECT at 38%)
  aaLevel: 0.5,                // AA: 30-45% (PERFECT at 35%)
  aLevel: 0.5,                 // A: 10-25% (PERFECT at 17%)
  rookieLevel: 0.5,            // Rookie: 3-10% (PERFECT at 10%)
};

// Parameter ranges to search (narrowed for fine-tuning)
// Current results are good, just need minor adjustments:
// - Level distribution: PERFECT ✓
// - Compression: 24% (target 40-50%)
// - Elite/Above Avg: slightly low
const PARAM_RANGES = {
  age20: [0.78, 0.88],          // Age ≤20 factor (currently 0.82)
  age22: [0.86, 0.94],          // Age ≤22 factor (currently 0.90)
  age24: [0.90, 0.96],          // Age ≤24 factor (currently 0.93)
  age26: [0.94, 0.99],          // Age ≤26 factor (currently 0.97)

  ip50: [0.70, 0.85],           // IP <50 factor (currently 0.75)
  ip100: [0.78, 0.90],          // IP <100 factor (currently 0.85)
  ip200: [0.88, 0.96],          // IP <200 factor (currently 0.92)

  gap2: [0.75, 0.88],           // Scout-stat gap >2.0 FIP factor (currently 0.80)
  gap15: [0.83, 0.93],          // Scout-stat gap 1.5-2.0 factor (currently 0.88)
  gap1: [0.90, 0.98],           // Scout-stat gap 1.0-1.5 factor (currently 0.95)

  regressionTarget: [4.80, 5.30], // Average prospect outcome FIP (currently 5.10)
  confidenceFloor: [0.52, 0.60],  // Minimum confidence (currently 0.55)
};

// ============================================================================
// Load MLB Data
// ============================================================================

const MODERN_ERA_YEARS = [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021];

interface MLBSeasonStats {
  year: number;
  players: Array<{
    playerId: number;
    ip: number;
    fip: number;
    war: number;
  }>;
}

function loadCSV(filePath: string): any[] {
  const fullPath = path.join(process.cwd(), filePath);
  if (!fs.existsSync(fullPath)) {
    return [];
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).filter(line => line.trim()).map(line => {
    const values = line.split(',');
    const obj: any = {};
    headers.forEach((h, i) => obj[h.trim()] = values[i]?.trim());
    return obj;
  });
}

function parseIp(ipString: string | undefined): number {
  if (!ipString) return 0;
  const [full, partial] = ipString.split('.');
  return parseInt(full, 10) + (partial ? parseInt(partial, 10) / 3 : 0);
}

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
  const midSeason = new Date(seasonYear, 6, 1);
  const age = midSeason.getFullYear() - dob.getFullYear();
  const m = midSeason.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && midSeason.getDate() < dob.getDate())) {
    return age - 1;
  }
  return age;
}

function loadModernEraMLB(): MLBSeasonStats[] {
  const ageMap = loadAgeData();
  const seasons: MLBSeasonStats[] = [];

  for (const year of MODERN_ERA_YEARS) {
    const rows = loadCSV(`public/data/mlb/${year}.csv`);
    const players = rows
      .map(row => {
        try {
          const ip = parseIp(row.ip);
          if (ip < 50) return null;

          const k = parseInt(row.k, 10);
          const bb = parseInt(row.bb, 10);
          const hr = parseInt(row.hra, 10);

          if (isNaN(k) || isNaN(bb) || isNaN(hr) || isNaN(ip)) return null;

          const playerId = parseInt(row.player_id, 10);
          const dob = ageMap.get(playerId);

          // Filter to prime years (25-32)
          if (dob) {
            const age = calculateAge(dob, year);
            if (age < 25 || age > 32) return null;
          } else {
            return null;
          }

          const fip = calculateFip(k, bb, hr, ip);
          const war = parseFloat(row.war) || 0;

          return { playerId, ip, fip, war };
        } catch (e) {
          return null;
        }
      })
      .filter(p => p !== null) as any[];

    seasons.push({ year, players });
  }

  return seasons;
}

// ============================================================================
// Load Test Data
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

  // Raw data for recalculation
  scoutK9?: number;
  scoutBb9?: number;
  scoutHr9?: number;
  adjustedK9?: number;
  adjustedBb9?: number;
  adjustedHr9?: number;
  scoutingWeight?: number;
  starGap?: number;
}

function loadProspects(): TFRProspect[] {
  const filePath = path.join(process.cwd(), 'tools/reports/tfr_prospects_2020.json');
  if (!fs.existsSync(filePath)) {
    throw new Error('TFR prospects file not found. Export from Farm Rankings first.');
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.prospects || [];
}

// ============================================================================
// TFR Recalculation with Custom Parameters
// ============================================================================

const FIP_CONSTANT = 3.47;

interface Parameters {
  age20: number;
  age22: number;
  age24: number;
  age26: number;
  ip50: number;
  ip100: number;
  ip200: number;
  gap2: number;
  gap15: number;
  gap1: number;
  regressionTarget: number;
  confidenceFloor: number;
}

function calculateFip(k9: number, bb9: number, hr9: number): number {
  return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;
}

function calculateConfidence(
  age: number,
  totalIp: number,
  scoutStatGap: number,
  params: Parameters
): number {
  let confidence = 1.0;

  // Age factor
  if (age <= 20) confidence *= params.age20;
  else if (age <= 22) confidence *= params.age22;
  else if (age <= 24) confidence *= params.age24;
  else if (age <= 26) confidence *= params.age26;

  // Sample size factor
  if (totalIp < 50) confidence *= params.ip50;
  else if (totalIp < 100) confidence *= params.ip100;
  else if (totalIp < 200) confidence *= params.ip200;

  // Scout-stat agreement factor
  if (scoutStatGap > 2.0) confidence *= params.gap2;
  else if (scoutStatGap > 1.5) confidence *= params.gap15;
  else if (scoutStatGap > 1.0) confidence *= params.gap1;

  return Math.max(params.confidenceFloor, confidence);
}

function applyRegression(projFip: number, confidence: number, regressionTarget: number): number {
  return confidence * projFip + (1 - confidence) * regressionTarget;
}

function percentileToRating(percentile: number): number {
  // Updated thresholds (loosened for better distribution)
  if (percentile >= 97.5) return 5.0;  // Elite: Top 2.5%
  if (percentile >= 93.5) return 4.5;  // Star: Top 6.5%
  if (percentile >= 86.0) return 4.0;  // Above Avg: Top 14%
  if (percentile >= 70.0) return 3.5;  // Average: Top 30%
  if (percentile >= 50.0) return 3.0;  // Fringe: Top 50%
  if (percentile >= 30.0) return 2.5;
  if (percentile >= 15.0) return 2.0;
  if (percentile >= 6.0) return 1.5;
  if (percentile >= 2.0) return 1.0;
  return 0.5;
}

function recalculateTFR(prospects: TFRProspect[], mlbFips: number[], params: Parameters): TFRProspect[] {
  // Recalculate ranking FIPs with new parameters
  const prospectsWithRankingFip = prospects.map(p => {
    // Use peak FIP from export (scouting + stats blended projection)
    const projFip = p.projFip;

    // Estimate scout-stat gap (we don't have raw scouting K9/BB9/HR9 in export)
    // Assume moderate gap of 1.0 for now (could enhance export to include this)
    const scoutStatGap = 1.0; // TODO: Export actual gap

    const confidence = calculateConfidence(p.age, p.totalMinorIp, scoutStatGap, params);
    const rankingFip = applyRegression(projFip, confidence, params.regressionTarget);

    return { ...p, rankingFip };
  });

  // Combine with MLB and calculate percentiles
  const allFips = [...mlbFips, ...prospectsWithRankingFip.map(p => p.rankingFip)];
  allFips.sort((a, b) => a - b);
  const n = allFips.length;

  // Recalculate TFR for each prospect
  return prospectsWithRankingFip.map(p => {
    let rank = 1;
    for (const fip of allFips) {
      if (fip < p.rankingFip) rank++;
      else break;
    }

    let tiedCount = 0;
    for (const fip of allFips) {
      if (fip === p.rankingFip) tiedCount++;
    }
    const avgRank = rank + (tiedCount - 1) / 2;
    const percentile = Math.round(((n - avgRank + 0.5) / n) * 1000) / 10;
    const tfr = percentileToRating(percentile);

    return { ...p, tfr, percentile };
  });
}

// ============================================================================
// Test Scoring
// ============================================================================

interface TestScores {
  eliteDistribution: number;
  aboveAvgDistribution: number;
  averageDistribution: number;
  compressionTest: number;
  aaaLevel: number;
  aaLevel: number;
  aLevel: number;
  rookieLevel: number;
  totalScore: number;
}

function scoreResults(prospects: TFRProspect[]): TestScores {
  const total = prospects.length;
  const elite = prospects.filter(p => p.tfr >= 4.5).length;
  const aboveAvg = prospects.filter(p => p.tfr >= 4.0 && p.tfr < 4.5).length;
  const average = prospects.filter(p => p.tfr >= 3.0 && p.tfr < 4.0).length;

  const elitePct = (elite / total) * 100;
  const aboveAvgPct = (aboveAvg / total) * 100;
  const averagePct = (average / total) * 100;

  // Distribution scores (0-100, 100 = perfect)
  const eliteScore = elitePct >= 3 && elitePct <= 7 ? 100 :
                     Math.max(0, 100 - Math.abs(5 - elitePct) * 20); // Target: 5%

  const aboveAvgScore = aboveAvgPct >= 10 && aboveAvgPct <= 20 ? 100 :
                        Math.max(0, 100 - Math.abs(15 - aboveAvgPct) * 10); // Target: 15%

  const averageScore = averagePct >= 30 && averagePct <= 45 ? 100 :
                       Math.max(0, 100 - Math.abs(37.5 - averagePct) * 5); // Target: 37.5%

  // Compression test
  const top100 = prospects.sort((a, b) => b.tfr - a.tfr).slice(0, 100);
  const below40 = top100.filter(p => p.tfr < 4.0).length;
  const compressionScore = Math.min(100, (below40 / 50) * 100); // Target: 50+

  // Level distribution
  const aaaCount = top100.filter(p => p.level.includes('AAA')).length;
  const aaCount = top100.filter(p => p.level.includes('AA') && !p.level.includes('AAA')).length;
  const aCount = top100.filter(p => p.level.includes('A') && !p.level.includes('AA')).length;
  const rookieCount = top100.filter(p => p.level.toLowerCase().includes('rookie') || p.level.includes('R-')).length;

  const aaaScore = aaaCount >= 30 && aaaCount <= 45 ? 100 :
                   Math.max(0, 100 - Math.abs(37.5 - aaaCount) * 5); // Target: 37.5

  const aaScore = aaCount >= 30 && aaCount <= 45 ? 100 :
                  Math.max(0, 100 - Math.abs(37.5 - aaCount) * 5); // Target: 37.5

  const aScore = aCount >= 10 && aCount <= 25 ? 100 :
                 Math.max(0, 100 - Math.abs(17.5 - aCount) * 10); // Target: 17.5

  const rookieScore = rookieCount >= 3 && rookieCount <= 10 ? 100 :
                      Math.max(0, 100 - Math.abs(6.5 - rookieCount) * 15); // Target: 6.5

  // Calculate weighted total
  const totalScore =
    eliteScore * WEIGHTS.eliteDistribution +
    aboveAvgScore * WEIGHTS.aboveAvgDistribution +
    averageScore * WEIGHTS.averageDistribution +
    compressionScore * WEIGHTS.compressionTest +
    aaaScore * WEIGHTS.aaaLevel +
    aaScore * WEIGHTS.aaLevel +
    aScore * WEIGHTS.aLevel +
    rookieScore * WEIGHTS.rookieLevel;

  const maxScore = Object.values(WEIGHTS).reduce((sum, w) => sum + w * 100, 0);
  const normalizedScore = (totalScore / maxScore) * 100;

  return {
    eliteDistribution: eliteScore,
    aboveAvgDistribution: aboveAvgScore,
    averageDistribution: averageScore,
    compressionTest: compressionScore,
    aaaLevel: aaaScore,
    aaLevel: aaScore,
    aLevel: aScore,
    rookieLevel: rookieScore,
    totalScore: normalizedScore,
  };
}

// ============================================================================
// Random Search
// ============================================================================

function randomParam(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function generateRandomParams(): Parameters {
  return {
    age20: randomParam(...PARAM_RANGES.age20),
    age22: randomParam(...PARAM_RANGES.age22),
    age24: randomParam(...PARAM_RANGES.age24),
    age26: randomParam(...PARAM_RANGES.age26),
    ip50: randomParam(...PARAM_RANGES.ip50),
    ip100: randomParam(...PARAM_RANGES.ip100),
    ip200: randomParam(...PARAM_RANGES.ip200),
    gap2: randomParam(...PARAM_RANGES.gap2),
    gap15: randomParam(...PARAM_RANGES.gap15),
    gap1: randomParam(...PARAM_RANGES.gap1),
    regressionTarget: randomParam(...PARAM_RANGES.regressionTarget),
    confidenceFloor: randomParam(...PARAM_RANGES.confidenceFloor),
  };
}

// ============================================================================
// Main
// ============================================================================

function optimize(): void {
  console.log('================================================================================');
  console.log('TFR PARAMETER OPTIMIZATION');
  console.log('================================================================================\n');

  console.log(`Loading test data...`);
  const prospects = loadProspects();
  console.log(`Loaded ${prospects.length} prospects\n`);

  // Load actual MLB FIPs (ages 25-32, prime years) from validation test data
  console.log('Loading MLB prime-year FIPs...');
  const mlbSeasons = loadModernEraMLB();
  const mlbFips = mlbSeasons.flatMap(season => season.players.map(p => p.fip));
  console.log(`Loaded ${mlbFips.length} MLB prime-year pitcher seasons\n`);

  console.log(`Testing ${ITERATIONS} random parameter combinations...`);
  console.log(`This may take a few minutes...\n`);

  const results: Array<{ params: Parameters; scores: TestScores }> = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const params = generateRandomParams();
    const recalculated = recalculateTFR(prospects, mlbFips, params);
    const scores = scoreResults(recalculated);

    results.push({ params, scores });

    if ((i + 1) % 1000 === 0) {
      console.log(`  Completed ${i + 1}/${ITERATIONS} iterations...`);
    }
  }

  // Sort by total score
  results.sort((a, b) => b.scores.totalScore - a.scores.totalScore);

  console.log('\n================================================================================');
  console.log(`TOP ${TOP_RESULTS} PARAMETER COMBINATIONS`);
  console.log('================================================================================\n');

  for (let i = 0; i < Math.min(TOP_RESULTS, results.length); i++) {
    const { params, scores } = results[i];

    console.log(`Rank #${i + 1} - Total Score: ${scores.totalScore.toFixed(1)}/100`);
    console.log('─'.repeat(80));

    console.log('\nScores:');
    console.log(`  Elite Distribution:    ${scores.eliteDistribution.toFixed(1)}/100`);
    console.log(`  Above Avg Distribution: ${scores.aboveAvgDistribution.toFixed(1)}/100`);
    console.log(`  Average Distribution:   ${scores.averageDistribution.toFixed(1)}/100`);
    console.log(`  Compression Test:       ${scores.compressionTest.toFixed(1)}/100`);
    console.log(`  AAA Level:              ${scores.aaaLevel.toFixed(1)}/100`);
    console.log(`  AA Level:               ${scores.aaLevel.toFixed(1)}/100`);
    console.log(`  A Level:                ${scores.aLevel.toFixed(1)}/100 ⚠️`);
    console.log(`  Rookie Level:           ${scores.rookieLevel.toFixed(1)}/100 ⚠️`);

    console.log('\nParameters:');
    console.log(`  Age ≤20 factor:         ${params.age20.toFixed(3)}`);
    console.log(`  Age ≤22 factor:         ${params.age22.toFixed(3)}`);
    console.log(`  Age ≤24 factor:         ${params.age24.toFixed(3)}`);
    console.log(`  Age ≤26 factor:         ${params.age26.toFixed(3)}`);
    console.log(`  IP <50 factor:          ${params.ip50.toFixed(3)}`);
    console.log(`  IP <100 factor:         ${params.ip100.toFixed(3)}`);
    console.log(`  IP <200 factor:         ${params.ip200.toFixed(3)}`);
    console.log(`  Gap >2.0 factor:        ${params.gap2.toFixed(3)}`);
    console.log(`  Gap 1.5-2.0 factor:     ${params.gap15.toFixed(3)}`);
    console.log(`  Gap 1.0-1.5 factor:     ${params.gap1.toFixed(3)}`);
    console.log(`  Regression target:      ${params.regressionTarget.toFixed(2)} FIP`);
    console.log(`  Confidence floor:       ${params.confidenceFloor.toFixed(2)}`);

    console.log('\n');
  }

  // Save best result
  const best = results[0];
  const outputPath = path.join(process.cwd(), 'tools/reports/optimal_tfr_parameters.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    date: new Date().toISOString(),
    iterations: ITERATIONS,
    bestScore: best.scores.totalScore,
    parameters: best.params,
    scores: best.scores,
  }, null, 2));

  console.log(`\n✅ Optimization complete!`);
  console.log(`Best parameters saved to: tools/reports/optimal_tfr_parameters.json`);
  console.log(`\nApply these parameters in TrueFutureRatingService.ts to achieve target distribution.`);
}

// ============================================================================
// Run
// ============================================================================

optimize();
