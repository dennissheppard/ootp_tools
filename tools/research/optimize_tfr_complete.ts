/**
 * Complete TFR Optimization
 *
 * Searches both confidence factors AND percentile thresholds
 * to find the optimal combination that passes all validation tests.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const ITERATIONS = 20000; // More iterations for larger search space
const TOP_RESULTS = 5;

// Test criteria weights
const WEIGHTS = {
  eliteDistribution: 2.0,
  aboveAvgDistribution: 2.0,
  averageDistribution: 1.5,
  compressionTest: 2.5,
  aaaLevel: 1.0,
  aaLevel: 1.0,
  aLevel: 1.0,
  rookieLevel: 2.0, // Higher weight - currently 24% vs target 3-10%
};

// Parameter ranges for confidence factors
const CONFIDENCE_RANGES = {
  age20: [0.78, 0.90],
  age22: [0.86, 0.96],
  age24: [0.90, 0.98],
  age26: [0.94, 0.99],
  ip50: [0.70, 0.85],
  ip100: [0.78, 0.92],
  ip200: [0.85, 0.95],
  gap2: [0.75, 0.90],
  gap15: [0.83, 0.95],
  gap1: [0.90, 0.98],
  regressionTarget: [4.80, 5.20],
  confidenceFloor: [0.52, 0.65],
  rookieLevel: [0.88, 0.98], // Level penalty for Rookie ball
};

// Parameter ranges for percentile thresholds
const THRESHOLD_RANGES = {
  elite: [95.5, 98.5],      // 5.0 rating (target: 3-7% Elite)
  star: [90.0, 95.0],       // 4.5 rating (target: total 10-20% for 4.5+)
  aboveAvg: [84.0, 91.0],   // 4.0 rating (target: more Above Avg tier)
  average: [70.0, 82.0],    // 3.5 rating (target: 30-45% Average)
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
  if (!fs.existsSync(fullPath)) return [];
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
// Load Prospect Data
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

function loadProspects(): TFRProspect[] {
  const filePath = path.join(process.cwd(), 'tools/reports/tfr_prospects_2020.json');
  if (!fs.existsSync(filePath)) {
    throw new Error('TFR prospects file not found. Export from Farm Rankings first.');
  }
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return data.prospects || [];
}

// ============================================================================
// TFR Calculation
// ============================================================================

const FIP_CONSTANT = 3.47;

interface ConfidenceParams {
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
  rookieLevel: number;
}

interface ThresholdParams {
  elite: number;
  star: number;
  aboveAvg: number;
  average: number;
}

interface AllParams extends ConfidenceParams, ThresholdParams {}

function calculateFip(k: number, bb: number, hr: number, ip: number): number {
  const k9 = (k / ip) * 9;
  const bb9 = (bb / ip) * 9;
  const hr9 = (hr / ip) * 9;
  return ((13 * hr9 + 3 * bb9 - 2 * k9) / 9) + FIP_CONSTANT;
}

function calculateConfidence(
  age: number,
  level: string,
  totalIp: number,
  scoutStatGap: number,
  params: ConfidenceParams
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

  // Level factor (Rookie only)
  if (level.toLowerCase().includes('r')) {
    confidence *= params.rookieLevel;
  }

  return Math.max(params.confidenceFloor, confidence);
}

function applyRegression(projFip: number, confidence: number, regressionTarget: number): number {
  return confidence * projFip + (1 - confidence) * regressionTarget;
}

function percentileToRating(percentile: number, thresholds: ThresholdParams): number {
  if (percentile >= thresholds.elite) return 5.0;
  if (percentile >= thresholds.star) return 4.5;
  if (percentile >= thresholds.aboveAvg) return 4.0;
  if (percentile >= thresholds.average) return 3.5;
  if (percentile >= 55.0) return 3.0;
  if (percentile >= 35.0) return 2.5;
  if (percentile >= 18.0) return 2.0;
  if (percentile >= 8.0) return 1.5;
  if (percentile >= 3.0) return 1.0;
  return 0.5;
}

function recalculateTFR(
  prospects: TFRProspect[],
  mlbFips: number[],
  params: AllParams
): TFRProspect[] {
  const prospectsWithRankingFip = prospects.map(p => {
    const projFip = p.projFip;
    const scoutStatGap = 1.0; // Assume moderate gap
    const confidence = calculateConfidence(p.age, p.level, p.totalMinorIp, scoutStatGap, params);
    const rankingFip = applyRegression(projFip, confidence, params.regressionTarget);
    return { ...p, rankingFip };
  });

  const allFips = [...mlbFips, ...prospectsWithRankingFip.map(p => p.rankingFip)];
  allFips.sort((a, b) => a - b);
  const n = allFips.length;

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
    const tfr = percentileToRating(percentile, params);

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

  const eliteScore = elitePct >= 3 && elitePct <= 7 ? 100 :
                     Math.max(0, 100 - Math.abs(5 - elitePct) * 20);

  const aboveAvgScore = aboveAvgPct >= 10 && aboveAvgPct <= 20 ? 100 :
                        Math.max(0, 100 - Math.abs(15 - aboveAvgPct) * 10);

  const averageScore = averagePct >= 30 && averagePct <= 45 ? 100 :
                       Math.max(0, 100 - Math.abs(37.5 - averagePct) * 5);

  const top100 = prospects.sort((a, b) => b.tfr - a.tfr).slice(0, 100);
  const below40 = top100.filter(p => p.tfr < 4.0).length;
  const compressionScore = below40 >= 30 ? 100 : (below40 / 30) * 100;

  const byLevel = {
    aaa: top100.filter(p => p.level.toLowerCase().includes('aaa')).length,
    aa: top100.filter(p => {
      const level = p.level.toLowerCase();
      return level.includes('aa') && !level.includes('aaa');
    }).length,
    a: top100.filter(p => {
      const level = p.level.toLowerCase();
      return level.includes('a') && !level.includes('aa');
    }).length,
    r: top100.filter(p => {
      const level = p.level.toLowerCase();
      return level.includes('r');
    }).length
  };

  const aaaScore = byLevel.aaa >= 30 && byLevel.aaa <= 45 ? 100 :
                   Math.max(0, 100 - Math.abs(37.5 - byLevel.aaa) * 5);

  const aaScore = byLevel.aa >= 30 && byLevel.aa <= 45 ? 100 :
                  Math.max(0, 100 - Math.abs(37.5 - byLevel.aa) * 5);

  const aScore = byLevel.a >= 10 && byLevel.a <= 25 ? 100 :
                 Math.max(0, 100 - Math.abs(17.5 - byLevel.a) * 10);

  const rookieScore = byLevel.r >= 3 && byLevel.r <= 10 ? 100 :
                      Math.max(0, 100 - Math.abs(6.5 - byLevel.r) * 15);

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

function generateRandomParams(): AllParams {
  return {
    age20: randomParam(...CONFIDENCE_RANGES.age20),
    age22: randomParam(...CONFIDENCE_RANGES.age22),
    age24: randomParam(...CONFIDENCE_RANGES.age24),
    age26: randomParam(...CONFIDENCE_RANGES.age26),
    ip50: randomParam(...CONFIDENCE_RANGES.ip50),
    ip100: randomParam(...CONFIDENCE_RANGES.ip100),
    ip200: randomParam(...CONFIDENCE_RANGES.ip200),
    gap2: randomParam(...CONFIDENCE_RANGES.gap2),
    gap15: randomParam(...CONFIDENCE_RANGES.gap15),
    gap1: randomParam(...CONFIDENCE_RANGES.gap1),
    regressionTarget: randomParam(...CONFIDENCE_RANGES.regressionTarget),
    confidenceFloor: randomParam(...CONFIDENCE_RANGES.confidenceFloor),
    rookieLevel: randomParam(...CONFIDENCE_RANGES.rookieLevel),
    elite: randomParam(...THRESHOLD_RANGES.elite),
    star: randomParam(...THRESHOLD_RANGES.star),
    aboveAvg: randomParam(...THRESHOLD_RANGES.aboveAvg),
    average: randomParam(...THRESHOLD_RANGES.average),
  };
}

// ============================================================================
// Main
// ============================================================================

function optimize(): void {
  console.log('================================================================================');
  console.log('COMPLETE TFR OPTIMIZATION (Confidence + Thresholds)');
  console.log('================================================================================\n');

  console.log(`Loading test data...`);
  const prospects = loadProspects();
  console.log(`Loaded ${prospects.length} prospects\n`);

  console.log('Loading MLB prime-year FIPs...');
  const mlbSeasons = loadModernEraMLB();
  const mlbFips = mlbSeasons.flatMap(season => season.players.map(p => p.fip));
  console.log(`Loaded ${mlbFips.length} MLB prime-year pitcher seasons\n`);

  console.log(`Testing ${ITERATIONS} random parameter combinations...`);
  console.log(`This may take several minutes...\n`);

  const results: Array<{ params: AllParams; scores: TestScores }> = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const params = generateRandomParams();
    const recalculated = recalculateTFR(prospects, mlbFips, params);
    const scores = scoreResults(recalculated);

    results.push({ params, scores });

    if ((i + 1) % 2000 === 0) {
      console.log(`  Completed ${i + 1}/${ITERATIONS} iterations...`);
    }
  }

  results.sort((a, b) => b.scores.totalScore - a.scores.totalScore);

  console.log('\n================================================================================');
  console.log(`TOP ${TOP_RESULTS} COMPLETE SOLUTIONS`);
  console.log('================================================================================\n');

  for (let i = 0; i < Math.min(TOP_RESULTS, results.length); i++) {
    const { params, scores } = results[i];

    console.log(`Rank #${i + 1} - Total Score: ${scores.totalScore.toFixed(1)}/100`);
    console.log('─'.repeat(80));

    console.log('\nScores:');
    console.log(`  Elite Distribution:     ${scores.eliteDistribution.toFixed(1)}/100`);
    console.log(`  Above Avg Distribution: ${scores.aboveAvgDistribution.toFixed(1)}/100`);
    console.log(`  Average Distribution:   ${scores.averageDistribution.toFixed(1)}/100`);
    console.log(`  Compression Test:       ${scores.compressionTest.toFixed(1)}/100`);
    console.log(`  AAA Level:              ${scores.aaaLevel.toFixed(1)}/100`);
    console.log(`  AA Level:               ${scores.aaLevel.toFixed(1)}/100`);
    console.log(`  A Level:                ${scores.aLevel.toFixed(1)}/100`);
    console.log(`  Rookie Level:           ${scores.rookieLevel.toFixed(1)}/100`);

    console.log('\nConfidence Parameters:');
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
    console.log(`  Rookie level penalty:   ${params.rookieLevel.toFixed(3)}`);

    console.log('\nPercentile Thresholds:');
    console.log(`  5.0 (Elite):            ${params.elite.toFixed(1)}%`);
    console.log(`  4.5 (Star):             ${params.star.toFixed(1)}%`);
    console.log(`  4.0 (Above Avg):        ${params.aboveAvg.toFixed(1)}%`);
    console.log(`  3.5 (Average):          ${params.average.toFixed(1)}%`);

    console.log('\n');
  }

  const best = results[0];
  const outputPath = path.join(process.cwd(), 'tools/reports/optimal_tfr_complete.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    date: new Date().toISOString(),
    iterations: ITERATIONS,
    bestScore: best.scores.totalScore,
    parameters: best.params,
    scores: best.scores,
  }, null, 2));

  console.log(`\n✅ Optimization complete!`);
  console.log(`Best solution saved to: tools/reports/optimal_tfr_complete.json`);
  console.log(`\nApply these parameters in TrueFutureRatingService.ts.`);
}

optimize();
