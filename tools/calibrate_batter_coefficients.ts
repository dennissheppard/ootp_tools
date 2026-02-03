/**
 * Automated Batter Coefficient Calibration Script
 *
 * This script runs the full projection pipeline with different coefficient values
 * and finds the optimal intercepts to minimize MAE and bias.
 *
 * USAGE: npx tsx tools/calibrate_batter_coefficients.ts
 */

const API_BASE = 'https://atl-01.statsplus.net/world/api';

// ============================================================================
// Coefficient Configuration (what we're optimizing)
// ============================================================================

interface Coefficients {
  eye: { intercept: number; slope: number };      // BB%
  avoidK: { intercept: number; slope: number };   // K%
  power: { intercept: number; slope: number };    // HR%
  contact: { intercept: number; slope: number };  // AVG
}

// Current coefficients from HitterRatingEstimatorService
const CURRENT_COEFFICIENTS: Coefficients = {
  eye: { intercept: 0.64, slope: 0.114789 },
  avoidK: { intercept: 25.35, slope: -0.200303 },
  power: { intercept: -1.30, slope: 0.058434 },
  contact: { intercept: 0.0772, slope: 0.00316593 },
};

// ============================================================================
// Projection Functions (mirrors HitterRatingEstimatorService)
// ============================================================================

function expectedBbPct(eye: number, coef: Coefficients): number {
  return coef.eye.intercept + coef.eye.slope * eye;
}

function expectedKPct(avoidK: number, coef: Coefficients): number {
  return coef.avoidK.intercept + coef.avoidK.slope * avoidK;
}

function expectedHrPct(power: number, coef: Coefficients): number {
  return coef.power.intercept + coef.power.slope * power;
}

function expectedAvg(contact: number, coef: Coefficients): number {
  return coef.contact.intercept + coef.contact.slope * contact;
}

// Inverse functions (mirrors HitterTrueRatingsCalculationService)
function estimateEye(bbPct: number, coef: Coefficients): number {
  const rating = (bbPct - coef.eye.intercept) / coef.eye.slope;
  return Math.max(20, Math.min(80, rating));
}

function estimateAvoidK(kPct: number, coef: Coefficients): number {
  const rating = (kPct - coef.avoidK.intercept) / coef.avoidK.slope;
  return Math.max(20, Math.min(80, rating));
}

function estimatePower(hrPct: number, coef: Coefficients): number {
  const rating = (hrPct - coef.power.intercept) / coef.power.slope;
  return Math.max(20, Math.min(80, rating));
}

function estimateContact(avg: number, coef: Coefficients): number {
  const rating = (avg - coef.contact.intercept) / coef.contact.slope;
  return Math.max(20, Math.min(80, rating));
}

// ============================================================================
// Data Types
// ============================================================================

interface BatterStats {
  player_id: number;
  pa: number;
  ab: number;
  h: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  k: number;
  avg: number;
}

interface ValidationMetrics {
  bbPct: { mae: number; bias: number };
  kPct: { mae: number; bias: number };
  hrPct: { mae: number; bias: number };
  avg: { mae: number; bias: number };
  woba: { mae: number; bias: number };
  count: number;
}

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchBattingStats(year: number, minPa: number = 200): Promise<Map<number, BatterStats>> {
  const url = `${API_BASE}/playerbatstatsv2/?year=${year}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${year} batting stats`);

  const csvText = await response.text();
  const lines = csvText.trim().split('\n');
  const headers = lines[0].split(',');

  const indices = {
    player_id: headers.indexOf('player_id'),
    split_id: headers.indexOf('split_id'),
    pa: headers.indexOf('pa'),
    ab: headers.indexOf('ab'),
    h: headers.indexOf('h'),
    d: headers.indexOf('d'),
    t: headers.indexOf('t'),
    hr: headers.indexOf('hr'),
    bb: headers.indexOf('bb'),
    k: headers.indexOf('k'),
  };

  const playerMap = new Map<number, BatterStats>();

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const split_id = parseInt(values[indices.split_id]);
    if (split_id !== 1) continue; // Total stats only

    const player_id = parseInt(values[indices.player_id]);
    const pa = parseInt(values[indices.pa]) || 0;

    if (pa < minPa) continue;

    const ab = parseInt(values[indices.ab]) || 0;
    const h = parseInt(values[indices.h]) || 0;
    const d = parseInt(values[indices.d]) || 0;
    const t = parseInt(values[indices.t]) || 0;
    const hr = parseInt(values[indices.hr]) || 0;
    const bb = parseInt(values[indices.bb]) || 0;
    const k = parseInt(values[indices.k]) || 0;

    const avg = ab > 0 ? h / ab : 0;

    playerMap.set(player_id, {
      player_id,
      pa,
      ab,
      h,
      d,
      t,
      hr,
      bb,
      k,
      avg,
    });
  }

  return playerMap;
}

// ============================================================================
// Projection & Validation
// ============================================================================

function calculateWoba(stats: BatterStats): number {
  const singles = stats.h - stats.d - stats.t - stats.hr;
  return (
    0.69 * stats.bb +
    0.89 * singles +
    1.27 * stats.d +
    1.62 * stats.t +
    2.10 * stats.hr
  ) / stats.pa;
}

/**
 * Component-specific scouting weights for MLB batters.
 * Higher weight = trust scouting more, stats less.
 *
 * Based on year-to-year correlation analysis:
 * - Stats with low Y-o-Y correlation benefit from more scouting weight
 * - Stats with high Y-o-Y correlation can trust historical stats more
 */
interface ScoutingWeights {
  bbPct: number;  // 0-1, how much to weight scouting vs stats for BB%
  kPct: number;   // 0-1, how much to weight scouting vs stats for K%
  hrPct: number;  // 0-1, how much to weight scouting vs stats for HR%
  avg: number;    // 0-1, how much to weight scouting vs stats for AVG
}

const DEFAULT_SCOUTING_WEIGHTS: ScoutingWeights = {
  bbPct: 0.0,  // 0% scouting, 100% stats (baseline)
  kPct: 0.0,
  hrPct: 0.0,
  avg: 0.0,
};

/**
 * Project next year stats using the coefficient-based approach.
 *
 * Pipeline:
 * 1. Calculate prior year rate stats
 * 2. Estimate ratings from rate stats (stat → rating)
 * 3. Apply simple regression toward mean (simulating True Ratings blend)
 * 4. Optionally blend with scouting-based projection
 * 5. Project next year stats from ratings (rating → stat)
 */
function projectStats(
  prior: BatterStats,
  coef: Coefficients,
  leagueAvg: { bbPct: number; kPct: number; hrPct: number; avg: number },
  scoutingWeights: ScoutingWeights = DEFAULT_SCOUTING_WEIGHTS
): { bbPct: number; kPct: number; hrPct: number; avg: number; woba: number } {
  // Calculate prior year rate stats
  const priorBbPct = (prior.bb / prior.pa) * 100;
  const priorKPct = (prior.k / prior.pa) * 100;
  const priorHrPct = (prior.hr / prior.pa) * 100;
  const priorAvg = prior.avg;

  // Estimate ratings from prior stats
  const eyeRating = estimateEye(priorBbPct, coef);
  const avoidKRating = estimateAvoidK(priorKPct, coef);
  const powerRating = estimatePower(priorHrPct, coef);
  const contactRating = estimateContact(priorAvg, coef);

  // Apply regression toward mean based on PA confidence
  // More PA = trust observed stats more, less regression
  const paConfidence = Math.min(1.0, prior.pa / 600);
  const regressStrength = 0.15 * (1 - paConfidence); // 0-15% regression

  // Regress ratings toward 50 (league average rating)
  const regressedEye = eyeRating * (1 - regressStrength) + 50 * regressStrength;
  const regressedAvoidK = avoidKRating * (1 - regressStrength) + 50 * regressStrength;
  const regressedPower = powerRating * (1 - regressStrength) + 50 * regressStrength;
  const regressedContact = contactRating * (1 - regressStrength) + 50 * regressStrength;

  // Project stats from regressed ratings (stats-based projection)
  let projBbPct = expectedBbPct(regressedEye, coef);
  let projKPct = expectedKPct(regressedAvoidK, coef);
  let projHrPct = expectedHrPct(regressedPower, coef);
  let projAvg = expectedAvg(regressedContact, coef);

  // Calculate scouting-based projection (regress toward league average = rating 50)
  const scoutBbPct = expectedBbPct(50, coef);
  const scoutKPct = expectedKPct(50, coef);
  const scoutHrPct = expectedHrPct(50, coef);
  const scoutAvg = expectedAvg(50, coef);

  // Blend stats-based and scouting-based projections
  projBbPct = projBbPct * (1 - scoutingWeights.bbPct) + scoutBbPct * scoutingWeights.bbPct;
  projKPct = projKPct * (1 - scoutingWeights.kPct) + scoutKPct * scoutingWeights.kPct;
  projHrPct = projHrPct * (1 - scoutingWeights.hrPct) + scoutHrPct * scoutingWeights.hrPct;
  projAvg = projAvg * (1 - scoutingWeights.avg) + scoutAvg * scoutingWeights.avg;

  // Clamp to reasonable ranges
  projBbPct = Math.max(0, Math.min(25, projBbPct));
  projKPct = Math.max(5, Math.min(40, projKPct));
  projHrPct = Math.max(0, Math.min(10, projHrPct));
  projAvg = Math.max(0.150, Math.min(0.350, projAvg));

  // Calculate projected wOBA from projected rate stats
  const bbRate = projBbPct / 100;
  const hitRate = projAvg * (1 - bbRate);
  const hrRate = projHrPct / 100;
  const nonHrHitRate = Math.max(0, hitRate - hrRate);
  const singleRate = nonHrHitRate * 0.65;
  const doubleRate = nonHrHitRate * 0.27;
  const tripleRate = nonHrHitRate * 0.08;

  const projWoba = Math.max(0.200, Math.min(0.500,
    0.69 * bbRate +
    0.89 * singleRate +
    1.27 * doubleRate +
    1.62 * tripleRate +
    2.10 * hrRate
  ));

  return { bbPct: projBbPct, kPct: projKPct, hrPct: projHrPct, avg: projAvg, woba: projWoba };
}

/**
 * Run validation across multiple years and return aggregate metrics
 */
async function validate(
  coef: Coefficients,
  scoutingWeights: ScoutingWeights = DEFAULT_SCOUTING_WEIGHTS,
  verbose: boolean = false
): Promise<ValidationMetrics> {
  const testYears = [
    { prior: 2015, actual: 2016 },
    { prior: 2016, actual: 2017 },
    { prior: 2017, actual: 2018 },
    { prior: 2018, actual: 2019 },
    { prior: 2019, actual: 2020 },
    { prior: 2020, actual: 2021 },
  ];

  const allErrors = {
    bbPct: [] as number[],
    kPct: [] as number[],
    hrPct: [] as number[],
    avg: [] as number[],
    woba: [] as number[],
  };

  for (const { prior, actual } of testYears) {
    if (verbose) console.log(`  Validating ${prior} → ${actual}...`);

    const priorStats = await fetchBattingStats(prior, 200);
    const actualStats = await fetchBattingStats(actual, 200);

    // Calculate league averages from prior year
    let totalBb = 0, totalK = 0, totalHr = 0, totalH = 0, totalPa = 0, totalAb = 0;
    for (const s of priorStats.values()) {
      totalBb += s.bb;
      totalK += s.k;
      totalHr += s.hr;
      totalH += s.h;
      totalPa += s.pa;
      totalAb += s.ab;
    }
    const leagueAvg = {
      bbPct: (totalBb / totalPa) * 100,
      kPct: (totalK / totalPa) * 100,
      hrPct: (totalHr / totalPa) * 100,
      avg: totalH / totalAb,
    };

    // Match players and calculate errors
    for (const [playerId, priorStat] of priorStats) {
      const actualStat = actualStats.get(playerId);
      if (!actualStat) continue;

      const proj = projectStats(priorStat, coef, leagueAvg, scoutingWeights);

      const actualBbPct = (actualStat.bb / actualStat.pa) * 100;
      const actualKPct = (actualStat.k / actualStat.pa) * 100;
      const actualHrPct = (actualStat.hr / actualStat.pa) * 100;
      const actualWoba = calculateWoba(actualStat);

      // Error = projected - actual (positive = overpredicting)
      allErrors.bbPct.push(proj.bbPct - actualBbPct);
      allErrors.kPct.push(proj.kPct - actualKPct);
      allErrors.hrPct.push(proj.hrPct - actualHrPct);
      allErrors.avg.push(proj.avg - actualStat.avg);
      allErrors.woba.push(proj.woba - actualWoba);
    }
  }

  const calcMae = (arr: number[]) => arr.reduce((s, e) => s + Math.abs(e), 0) / arr.length;
  const calcBias = (arr: number[]) => arr.reduce((s, e) => s + e, 0) / arr.length;

  return {
    bbPct: { mae: calcMae(allErrors.bbPct), bias: calcBias(allErrors.bbPct) },
    kPct: { mae: calcMae(allErrors.kPct), bias: calcBias(allErrors.kPct) },
    hrPct: { mae: calcMae(allErrors.hrPct), bias: calcBias(allErrors.hrPct) },
    avg: { mae: calcMae(allErrors.avg), bias: calcBias(allErrors.avg) },
    woba: { mae: calcMae(allErrors.woba), bias: calcBias(allErrors.woba) },
    count: allErrors.bbPct.length,
  };
}

function printMetrics(label: string, m: ValidationMetrics) {
  console.log(`\n${label}`);
  console.log('─'.repeat(60));
  console.log('Stat    MAE      RMSE     Bias      Count');
  console.log(`wOBA    ${m.woba.mae.toFixed(3)}    -        ${m.woba.bias >= 0 ? '+' : ''}${m.woba.bias.toFixed(3)}     ${m.count}`);
  console.log(`AVG     ${m.avg.mae.toFixed(3)}    -        ${m.avg.bias >= 0 ? '+' : ''}${m.avg.bias.toFixed(3)}     ${m.count}`);
  console.log(`BB%     ${m.bbPct.mae.toFixed(3)}    -        ${m.bbPct.bias >= 0 ? '+' : ''}${m.bbPct.bias.toFixed(3)}     ${m.count}`);
  console.log(`K%      ${m.kPct.mae.toFixed(3)}    -        ${m.kPct.bias >= 0 ? '+' : ''}${m.kPct.bias.toFixed(3)}     ${m.count}`);
  console.log(`HR%     ${m.hrPct.mae.toFixed(3)}    -        ${m.hrPct.bias >= 0 ? '+' : ''}${m.hrPct.bias.toFixed(3)}     ${m.count}`);
}

// ============================================================================
// Optimization
// ============================================================================

/**
 * Calculate year-over-year correlations for MLB batters.
 * This tells us how predictive each stat is from one year to the next.
 */
async function analyzeYearOverYearCorrelations(): Promise<void> {
  console.log('\n' + '='.repeat(70));
  console.log('MLB YEAR-OVER-YEAR CORRELATION ANALYSIS');
  console.log('='.repeat(70));

  const testYears = [
    { prior: 2015, actual: 2016 },
    { prior: 2016, actual: 2017 },
    { prior: 2017, actual: 2018 },
    { prior: 2018, actual: 2019 },
    { prior: 2019, actual: 2020 },
    { prior: 2020, actual: 2021 },
  ];

  const allPairs = {
    bbPct: [] as { prior: number; actual: number }[],
    kPct: [] as { prior: number; actual: number }[],
    hrPct: [] as { prior: number; actual: number }[],
    avg: [] as { prior: number; actual: number }[],
  };

  console.log('\nCollecting matched player data across years...');

  for (const { prior, actual } of testYears) {
    const priorStats = await fetchBattingStats(prior, 200);
    const actualStats = await fetchBattingStats(actual, 200);

    for (const [playerId, priorStat] of priorStats) {
      const actualStat = actualStats.get(playerId);
      if (!actualStat) continue;

      allPairs.bbPct.push({
        prior: (priorStat.bb / priorStat.pa) * 100,
        actual: (actualStat.bb / actualStat.pa) * 100,
      });
      allPairs.kPct.push({
        prior: (priorStat.k / priorStat.pa) * 100,
        actual: (actualStat.k / actualStat.pa) * 100,
      });
      allPairs.hrPct.push({
        prior: (priorStat.hr / priorStat.pa) * 100,
        actual: (actualStat.hr / actualStat.pa) * 100,
      });
      allPairs.avg.push({
        prior: priorStat.avg,
        actual: actualStat.avg,
      });
    }
  }

  // Calculate Pearson correlation for each stat
  const calcCorrelation = (pairs: { prior: number; actual: number }[]): number => {
    const n = pairs.length;
    const sumX = pairs.reduce((s, p) => s + p.prior, 0);
    const sumY = pairs.reduce((s, p) => s + p.actual, 0);
    const sumXY = pairs.reduce((s, p) => s + p.prior * p.actual, 0);
    const sumX2 = pairs.reduce((s, p) => s + p.prior * p.prior, 0);
    const sumY2 = pairs.reduce((s, p) => s + p.actual * p.actual, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  };

  console.log(`\nAnalyzed ${allPairs.bbPct.length} player-seasons\n`);
  console.log('─'.repeat(70));
  console.log('MLB YEAR-OVER-YEAR CORRELATIONS');
  console.log('─'.repeat(70));
  console.log('Stat     Correlation    Interpretation');
  console.log('─'.repeat(70));

  const stats = ['bbPct', 'kPct', 'hrPct', 'avg'] as const;
  const labels = { bbPct: 'BB%', kPct: 'K%', hrPct: 'HR%', avg: 'AVG' };

  for (const stat of stats) {
    const r = calcCorrelation(allPairs[stat]);
    let interpretation = '';
    if (r >= 0.7) interpretation = 'STRONG - trust prior year stats';
    else if (r >= 0.5) interpretation = 'MODERATE - blend stats & scouting';
    else if (r >= 0.3) interpretation = 'WEAK - lean toward scouting';
    else interpretation = 'VERY WEAK - rely on scouting';

    console.log(`${labels[stat].padEnd(8)} r = ${r.toFixed(3).padEnd(10)} ${interpretation}`);
  }

  console.log('─'.repeat(70));
}

async function optimizeScoutingWeights(): Promise<ScoutingWeights> {
  console.log('\n' + '='.repeat(70));
  console.log('SCOUTING WEIGHT OPTIMIZATION');
  console.log('='.repeat(70));

  console.log('\nTesting different scouting weights (0% to 50% in 10% increments)...\n');

  const testWeights = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const results: { weight: number; stat: string; mae: number; bias: number }[] = [];

  // Test each component independently
  for (const stat of ['bbPct', 'kPct', 'hrPct', 'avg'] as const) {
    console.log(`\nTesting ${stat} scouting weights...`);
    for (const weight of testWeights) {
      const weights: ScoutingWeights = { bbPct: 0, kPct: 0, hrPct: 0, avg: 0 };
      weights[stat] = weight;

      const metrics = await validate(CURRENT_COEFFICIENTS, weights, false);
      const m = metrics[stat];

      results.push({ weight, stat, mae: m.mae, bias: m.bias });
      console.log(`  ${stat} @ ${(weight * 100).toFixed(0)}% scouting: MAE=${m.mae.toFixed(3)}, bias=${m.bias >= 0 ? '+' : ''}${m.bias.toFixed(3)}`);
    }
  }

  // Find optimal weight for each stat (minimize MAE)
  const optimalWeights: ScoutingWeights = { bbPct: 0, kPct: 0, hrPct: 0, avg: 0 };
  for (const stat of ['bbPct', 'kPct', 'hrPct', 'avg'] as const) {
    const statResults = results.filter(r => r.stat === stat);
    const best = statResults.reduce((a, b) => a.mae < b.mae ? a : b);
    optimalWeights[stat] = best.weight;
  }

  console.log('\n' + '─'.repeat(70));
  console.log('OPTIMAL SCOUTING WEIGHTS (minimizing MAE):');
  console.log('─'.repeat(70));
  console.log(`  BB%:  ${(optimalWeights.bbPct * 100).toFixed(0)}% scouting`);
  console.log(`  K%:   ${(optimalWeights.kPct * 100).toFixed(0)}% scouting`);
  console.log(`  HR%:  ${(optimalWeights.hrPct * 100).toFixed(0)}% scouting`);
  console.log(`  AVG:  ${(optimalWeights.avg * 100).toFixed(0)}% scouting`);

  // Validate with all optimal weights combined
  console.log('\nValidating with combined optimal weights...');
  const combinedMetrics = await validate(CURRENT_COEFFICIENTS, optimalWeights, false);
  printMetrics('COMBINED OPTIMAL SCOUTING WEIGHTS', combinedMetrics);

  return optimalWeights;
}

async function optimizeIntercepts(): Promise<Coefficients> {
  console.log('='.repeat(70));
  console.log('BATTER COEFFICIENT CALIBRATION');
  console.log('='.repeat(70));

  // Start with current coefficients
  const best: Coefficients = JSON.parse(JSON.stringify(CURRENT_COEFFICIENTS));

  console.log('\n1. Fetching data and running baseline validation...');
  const baseline = await validate(best, DEFAULT_SCOUTING_WEIGHTS, true);
  printMetrics('BASELINE (Current Coefficients)', baseline);

  // Iteratively adjust intercepts to minimize bias
  console.log('\n2. Optimizing intercepts to minimize bias...\n');

  const iterations = 5;
  for (let iter = 0; iter < iterations; iter++) {
    console.log(`  Iteration ${iter + 1}/${iterations}...`);

    const metrics = await validate(best, DEFAULT_SCOUTING_WEIGHTS, false);

    // Adjust intercepts based on bias
    // If bias is positive (overpredicting), decrease intercept
    // If bias is negative (underpredicting), increase intercept
    // Use smaller adjustments as we iterate (dampening factor)
    const dampen = 0.7;

    best.eye.intercept -= metrics.bbPct.bias * dampen;
    best.avoidK.intercept -= metrics.kPct.bias * dampen;
    best.power.intercept -= metrics.hrPct.bias * dampen;
    // Note: AVG uses different scale, need to convert bias to intercept units
    best.contact.intercept -= metrics.avg.bias * dampen;

    console.log(`    BB% bias: ${metrics.bbPct.bias >= 0 ? '+' : ''}${metrics.bbPct.bias.toFixed(3)} → eye intercept: ${best.eye.intercept.toFixed(4)}`);
    console.log(`    K%  bias: ${metrics.kPct.bias >= 0 ? '+' : ''}${metrics.kPct.bias.toFixed(3)} → avoidK intercept: ${best.avoidK.intercept.toFixed(4)}`);
    console.log(`    HR% bias: ${metrics.hrPct.bias >= 0 ? '+' : ''}${metrics.hrPct.bias.toFixed(3)} → power intercept: ${best.power.intercept.toFixed(4)}`);
    console.log(`    AVG bias: ${metrics.avg.bias >= 0 ? '+' : ''}${metrics.avg.bias.toFixed(4)} → contact intercept: ${best.contact.intercept.toFixed(6)}`);
  }

  // Final validation
  console.log('\n3. Final validation with optimized coefficients...');
  const final = await validate(best, DEFAULT_SCOUTING_WEIGHTS, false);
  printMetrics('FINAL (Optimized Coefficients)', final);

  // Print recommended changes
  console.log('\n' + '='.repeat(70));
  console.log('RECOMMENDED COEFFICIENT CHANGES');
  console.log('='.repeat(70));

  console.log('\nIn HitterRatingEstimatorService.ts, update REGRESSION_COEFFICIENTS:\n');
  console.log(`  eye: { intercept: ${best.eye.intercept.toFixed(4)}, slope: ${best.eye.slope} },`);
  console.log(`  avoidK: { intercept: ${best.avoidK.intercept.toFixed(4)}, slope: ${best.avoidK.slope} },`);
  console.log(`  power: { intercept: ${best.power.intercept.toFixed(4)}, slope: ${best.power.slope} },`);
  console.log(`  contact: { intercept: ${best.contact.intercept.toFixed(6)}, slope: ${best.contact.slope} },`);

  console.log('\nIn HitterTrueRatingsCalculationService.ts, update estimation functions:\n');
  console.log(`  estimateEyeFromBbPct:    eye = (BB% - (${best.eye.intercept.toFixed(4)})) / ${best.eye.slope}`);
  console.log(`  estimateAvoidKFromKPct:  avoidK = (K% - (${best.avoidK.intercept.toFixed(4)})) / ${best.avoidK.slope}`);
  console.log(`  estimatePowerFromIso:    (uses HR% internally) power = (HR% - (${best.power.intercept.toFixed(4)})) / ${best.power.slope}`);
  console.log(`  estimateContactFromAvg:  contact = (AVG - (${best.contact.intercept.toFixed(6)})) / ${best.contact.slope}`);

  // Improvement summary
  console.log('\n' + '='.repeat(70));
  console.log('IMPROVEMENT SUMMARY');
  console.log('='.repeat(70));
  console.log(`\n${'Stat'.padEnd(8)} ${'Baseline Bias'.padEnd(15)} ${'Final Bias'.padEnd(15)} ${'Baseline MAE'.padEnd(15)} ${'Final MAE'.padEnd(15)}`);
  console.log('─'.repeat(70));
  console.log(`${'BB%'.padEnd(8)} ${formatBias(baseline.bbPct.bias).padEnd(15)} ${formatBias(final.bbPct.bias).padEnd(15)} ${baseline.bbPct.mae.toFixed(3).padEnd(15)} ${final.bbPct.mae.toFixed(3).padEnd(15)}`);
  console.log(`${'K%'.padEnd(8)} ${formatBias(baseline.kPct.bias).padEnd(15)} ${formatBias(final.kPct.bias).padEnd(15)} ${baseline.kPct.mae.toFixed(3).padEnd(15)} ${final.kPct.mae.toFixed(3).padEnd(15)}`);
  console.log(`${'HR%'.padEnd(8)} ${formatBias(baseline.hrPct.bias).padEnd(15)} ${formatBias(final.hrPct.bias).padEnd(15)} ${baseline.hrPct.mae.toFixed(3).padEnd(15)} ${final.hrPct.mae.toFixed(3).padEnd(15)}`);
  console.log(`${'AVG'.padEnd(8)} ${formatBias(baseline.avg.bias, 4).padEnd(15)} ${formatBias(final.avg.bias, 4).padEnd(15)} ${baseline.avg.mae.toFixed(4).padEnd(15)} ${final.avg.mae.toFixed(4).padEnd(15)}`);
  console.log(`${'wOBA'.padEnd(8)} ${formatBias(baseline.woba.bias).padEnd(15)} ${formatBias(final.woba.bias).padEnd(15)} ${baseline.woba.mae.toFixed(3).padEnd(15)} ${final.woba.mae.toFixed(3).padEnd(15)}`);

  return best;
}

function formatBias(bias: number, decimals: number = 3): string {
  const formatted = bias.toFixed(decimals);
  return bias >= 0 ? `+${formatted}` : formatted;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    // First, analyze year-over-year correlations to understand predictability
    await analyzeYearOverYearCorrelations();

    // Then, test different scouting weights
    const optimalWeights = await optimizeScoutingWeights();

    // Finally, optimize intercepts (without scouting weights for now)
    await optimizeIntercepts();

    console.log('\n' + '='.repeat(70));
    console.log('RECOMMENDATIONS');
    console.log('='.repeat(70));
    console.log('\nBased on the analysis, consider implementing component-specific');
    console.log('scouting weights in HitterTrueRatingsCalculationService:');
    console.log(`\n  BB%:  ${(optimalWeights.bbPct * 100).toFixed(0)}% scouting weight`);
    console.log(`  K%:   ${(optimalWeights.kPct * 100).toFixed(0)}% scouting weight`);
    console.log(`  HR%:  ${(optimalWeights.hrPct * 100).toFixed(0)}% scouting weight`);
    console.log(`  AVG:  ${(optimalWeights.avg * 100).toFixed(0)}% scouting weight`);

    console.log('\n✅ Calibration complete!\n');
  } catch (error) {
    console.error('Error during calibration:', error);
    process.exit(1);
  }
}

main();
