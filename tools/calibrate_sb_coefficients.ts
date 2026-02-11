/**
 * Stolen Base Coefficient Calibration
 *
 * Grid-searches SR (steal aggressiveness) and STE (steal ability) coefficients
 * to find the best fit against actual SB/CS data.
 *
 * Approach:
 * 1. Load scouting data (SR/STE per player)
 * 2. Load MLB batting stats (SB/CS per player) from multiple years
 * 3. Match players by ID
 * 4. Grid-search coefficient space to minimize weighted error
 * 5. Report best-fit coefficients and diagnostics
 *
 * Explores both linear and piecewise-linear models for SR.
 *
 * USAGE: npx tsx tools/calibrate_sb_coefficients.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Data Types
// ============================================================================

interface ScoutingPlayer {
  playerId: number;
  playerName: string;
  sr: number;
  ste: number;
}

interface BattingPlayer {
  playerId: number;
  year: number;
  pa: number;
  sb: number;
  cs: number;
}

interface MatchedPlayer {
  playerId: number;
  playerName: string;
  year: number;
  pa: number;
  sr: number;
  ste: number;
  actualSb: number;
  actualCs: number;
  actualAttempts: number;
}

interface LinearCoef {
  intercept: number;
  slope: number;
}

interface PiecewiseCoef {
  low: LinearCoef;   // sr <= breakpoint
  high: LinearCoef;  // sr > breakpoint
  breakpoint: number;
}

interface SteCoef {
  intercept: number;
  slope: number;
}

interface SearchResult {
  label: string;
  srCoef: LinearCoef | PiecewiseCoef;
  steCoef: SteCoef;
  metrics: ErrorMetrics;
  isPiecewise: boolean;
}

interface ErrorMetrics {
  sbMae: number;
  sbBias: number;
  sbRmse: number;
  attemptMae: number;
  attemptBias: number;
  successRateBias: number; // pp
  totalActualSb: number;
  totalProjSb: number;
  totalDiffPct: number;
  count: number;
  // By-bucket metrics
  bucketBiases: { label: string; count: number; bias: number; actMean: number; projMean: number }[];
}

// ============================================================================
// CSV Parsing (same as validate tool)
// ============================================================================

function parseScoutingCsv(filePath: string): ScoutingPlayer[] {
  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idIdx = headers.indexOf('id');
  const nameIdx = headers.indexOf('name');
  const srIdx = headers.indexOf('sr');
  const steIdx = headers.indexOf('ste');

  if (idIdx === -1 || srIdx === -1 || steIdx === -1) {
    console.error('Missing columns. Found:', headers.join(', '));
    return [];
  }

  const players: ScoutingPlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const playerId = parseInt(values[idIdx]);
    const sr = parseInt(values[srIdx]);
    const ste = parseInt(values[steIdx]);
    if (isNaN(playerId) || isNaN(sr) || isNaN(ste)) continue;
    players.push({ playerId, playerName: values[nameIdx]?.trim() || 'Unknown', sr, ste });
  }
  return players;
}

function parseBattingCsv(filePath: string, year: number): BattingPlayer[] {
  const csvText = fs.readFileSync(filePath, 'utf-8');
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => idx[h] = i);

  const players: BattingPlayer[] = [];
  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].split(',');
    if (parseInt(v[idx['split_id']]) !== 1) continue;
    if (parseInt(v[idx['level_id']]) !== 1) continue;

    const pa = parseInt(v[idx['pa']]) || 0;
    const playerId = parseInt(v[idx['player_id']]);
    if (isNaN(playerId) || pa === 0) continue;

    players.push({
      playerId,
      year,
      pa,
      sb: parseInt(v[idx['sb']]) || 0,
      cs: parseInt(v[idx['cs']]) || 0,
    });
  }
  return players;
}

// ============================================================================
// Projection Functions (parameterized)
// ============================================================================

function calcAttempts(sr: number, coef: LinearCoef | PiecewiseCoef, isPiecewise: boolean): number {
  if (isPiecewise) {
    const pw = coef as PiecewiseCoef;
    if (sr <= pw.breakpoint) {
      return Math.max(0, pw.low.intercept + pw.low.slope * sr);
    } else {
      return Math.max(0, pw.high.intercept + pw.high.slope * sr);
    }
  }
  const lin = coef as LinearCoef;
  return Math.max(0, lin.intercept + lin.slope * sr);
}

function calcSuccessRate(ste: number, coef: SteCoef): number {
  return Math.max(0.30, Math.min(0.98, coef.intercept + coef.slope * ste));
}

function projectSb(
  sr: number,
  ste: number,
  pa: number,
  srCoef: LinearCoef | PiecewiseCoef,
  steCoef: SteCoef,
  isPiecewise: boolean
): { sb: number; cs: number } {
  const attemptsPerSeason = calcAttempts(sr, srCoef, isPiecewise);
  const successRate = calcSuccessRate(ste, steCoef);
  const attempts = attemptsPerSeason * (pa / 600);
  return {
    sb: Math.round(attempts * successRate),
    cs: Math.round(attempts * (1 - successRate)),
  };
}

// ============================================================================
// Error Calculation
// ============================================================================

function evaluate(
  matched: MatchedPlayer[],
  srCoef: LinearCoef | PiecewiseCoef,
  steCoef: SteCoef,
  isPiecewise: boolean
): ErrorMetrics {
  let totalActualSb = 0, totalProjSb = 0;
  let sbErrorSum = 0, sbAbsErrorSum = 0, sbSqErrorSum = 0;
  let attErrorSum = 0, attAbsErrorSum = 0;
  let srNumerator = 0, srDenominator = 0;

  const projections: { sr: number; ste: number; actualSb: number; projSb: number; actualAtt: number; projAtt: number }[] = [];

  for (const p of matched) {
    const proj = projectSb(p.sr, p.ste, p.pa, srCoef, steCoef, isPiecewise);
    const projAtt = proj.sb + proj.cs;

    totalActualSb += p.actualSb;
    totalProjSb += proj.sb;

    const sbErr = proj.sb - p.actualSb;
    sbErrorSum += sbErr;
    sbAbsErrorSum += Math.abs(sbErr);
    sbSqErrorSum += sbErr * sbErr;

    const attErr = projAtt - p.actualAttempts;
    attErrorSum += attErr;
    attAbsErrorSum += Math.abs(attErr);

    if (p.actualAttempts > 0) {
      srNumerator += p.actualSb;
      srDenominator += p.actualAttempts;
    }

    projections.push({
      sr: p.sr, ste: p.ste,
      actualSb: p.actualSb, projSb: proj.sb,
      actualAtt: p.actualAttempts, projAtt,
    });
  }

  const n = matched.length;

  // Success rate bias (league-level)
  const actualLeagueSR = srDenominator > 0 ? srNumerator / srDenominator : 0;
  const projLeagueSb = projections.reduce((s, p) => s + p.projSb, 0);
  const projLeagueAtt = projections.reduce((s, p) => s + p.projAtt, 0);
  const projLeagueSR = projLeagueAtt > 0 ? projLeagueSb / projLeagueAtt : 0;

  // Bucket analysis
  const srBuckets = [
    { label: 'SR 20-34', min: 20, max: 34 },
    { label: 'SR 35-49', min: 35, max: 49 },
    { label: 'SR 50-64', min: 50, max: 64 },
    { label: 'SR 65-80', min: 65, max: 80 },
  ];

  const bucketBiases = srBuckets.map(b => {
    const group = projections.filter(p => p.sr >= b.min && p.sr <= b.max);
    if (group.length === 0) return { label: b.label, count: 0, bias: 0, actMean: 0, projMean: 0 };
    const actMean = group.reduce((s, p) => s + p.actualSb, 0) / group.length;
    const projMean = group.reduce((s, p) => s + p.projSb, 0) / group.length;
    return { label: b.label, count: group.length, bias: projMean - actMean, actMean, projMean };
  });

  return {
    sbMae: sbAbsErrorSum / n,
    sbBias: sbErrorSum / n,
    sbRmse: Math.sqrt(sbSqErrorSum / n),
    attemptMae: attAbsErrorSum / n,
    attemptBias: attErrorSum / n,
    successRateBias: (projLeagueSR - actualLeagueSR) * 100,
    totalActualSb,
    totalProjSb,
    totalDiffPct: totalActualSb > 0 ? ((totalProjSb / totalActualSb) - 1) * 100 : 0,
    count: n,
    bucketBiases,
  };
}

/** Combined score: weighted MAE + penalties for bias, bucket imbalance, success rate, attempts */
function score(m: ErrorMetrics): number {
  const maeWeight = 1.0;
  const biasWeight = 2.0;         // Penalize systematic SB bias
  const bucketWeight = 1.5;       // Penalize uneven SR bucket biases
  const totalWeight = 1.0;        // Penalize league total SB mismatch
  const srBiasWeight = 1.5;       // Penalize success rate mismatch
  const attemptBiasWeight = 1.0;  // Penalize attempt count mismatch

  // Bucket imbalance: max absolute bias across buckets
  const maxBucketBias = Math.max(...m.bucketBiases.filter(b => b.count > 5).map(b => Math.abs(b.bias)));

  return (
    maeWeight * m.sbMae +
    biasWeight * Math.abs(m.sbBias) +
    bucketWeight * maxBucketBias +
    totalWeight * Math.abs(m.totalDiffPct) * 0.1 +
    srBiasWeight * Math.abs(m.successRateBias) * 0.5 +  // 1pp SR bias → 0.75 score penalty
    attemptBiasWeight * Math.abs(m.attemptBias)
  );
}

// ============================================================================
// Grid Search
// ============================================================================

function gridSearchLinear(matched: MatchedPlayer[]): SearchResult {
  console.log('\n  Searching linear SR coefficients...');

  let bestScore = Infinity;
  let bestSrCoef: LinearCoef = { intercept: 0, slope: 0 };
  let bestSteCoef: SteCoef = { intercept: 0, slope: 0 };
  let bestMetrics: ErrorMetrics | null = null;
  let combos = 0;

  // Phase 1: Coarse search
  for (let srSlope = 0.3; srSlope <= 2.5; srSlope += 0.1) {
    for (let srIntercept = -60; srIntercept <= 0; srIntercept += 2) {
      for (let steSlope = 0.003; steSlope <= 0.012; steSlope += 0.001) {
        for (let steIntercept = 0.2; steIntercept <= 0.7; steIntercept += 0.05) {
          combos++;
          const srCoef: LinearCoef = { intercept: srIntercept, slope: srSlope };
          const steCoef: SteCoef = { intercept: steIntercept, slope: steSlope };
          const metrics = evaluate(matched, srCoef, steCoef, false);
          const s = score(metrics);
          if (s < bestScore) {
            bestScore = s;
            bestSrCoef = srCoef;
            bestSteCoef = steCoef;
            bestMetrics = metrics;
          }
        }
      }
    }
  }
  console.log(`    Phase 1: ${combos} combos, best score=${bestScore.toFixed(2)}`);

  // Phase 2: Fine search around best
  const sr2 = bestSrCoef;
  const ste2 = bestSteCoef;
  let refineCombos = 0;

  for (let srSlope = sr2.slope - 0.1; srSlope <= sr2.slope + 0.1; srSlope += 0.01) {
    for (let srIntercept = sr2.intercept - 2; srIntercept <= sr2.intercept + 2; srIntercept += 0.25) {
      for (let steSlope = ste2.slope - 0.001; steSlope <= ste2.slope + 0.001; steSlope += 0.0002) {
        for (let steIntercept = ste2.intercept - 0.05; steIntercept <= ste2.intercept + 0.05; steIntercept += 0.005) {
          refineCombos++;
          const srCoef: LinearCoef = { intercept: srIntercept, slope: srSlope };
          const steCoef: SteCoef = { intercept: steIntercept, slope: steSlope };
          const metrics = evaluate(matched, srCoef, steCoef, false);
          const s = score(metrics);
          if (s < bestScore) {
            bestScore = s;
            bestSrCoef = srCoef;
            bestSteCoef = steCoef;
            bestMetrics = metrics;
          }
        }
      }
    }
  }
  console.log(`    Phase 2: ${refineCombos} combos, best score=${bestScore.toFixed(2)}`);

  return {
    label: 'LINEAR',
    srCoef: bestSrCoef,
    steCoef: bestSteCoef,
    metrics: bestMetrics!,
    isPiecewise: false,
  };
}

function gridSearchPiecewise(matched: MatchedPlayer[]): SearchResult {
  console.log('\n  Searching piecewise SR coefficients (breakpoint at SR=55)...');

  const breakpoint = 55;
  let bestScore = Infinity;
  let bestSrCoef: PiecewiseCoef = { low: { intercept: 0, slope: 0 }, high: { intercept: 0, slope: 0 }, breakpoint };
  let bestSteCoef: SteCoef = { intercept: 0, slope: 0 };
  let bestMetrics: ErrorMetrics | null = null;
  let combos = 0;

  // Phase 1: Coarse search
  // Low segment: SR 20-55, want ~0-10 attempts
  for (let lowSlope = 0.05; lowSlope <= 0.6; lowSlope += 0.05) {
    for (let lowIntercept = -12; lowIntercept <= 0; lowIntercept += 1) {
      // High segment: SR 55-80, want ~10-100+ attempts
      for (let highSlope = 1.0; highSlope <= 6.0; highSlope += 0.25) {
        // Ensure continuity at breakpoint
        const lowAtBreak = lowIntercept + lowSlope * breakpoint;
        const highIntercept = lowAtBreak - highSlope * breakpoint;

        for (let steSlope = 0.003; steSlope <= 0.012; steSlope += 0.001) {
          for (let steIntercept = 0.15; steIntercept <= 0.70; steIntercept += 0.05) {
            combos++;
            const srCoef: PiecewiseCoef = {
              low: { intercept: lowIntercept, slope: lowSlope },
              high: { intercept: highIntercept, slope: highSlope },
              breakpoint,
            };
            const steCoef: SteCoef = { intercept: steIntercept, slope: steSlope };
            const metrics = evaluate(matched, srCoef, steCoef, true);
            const s = score(metrics);
            if (s < bestScore) {
              bestScore = s;
              bestSrCoef = srCoef;
              bestSteCoef = steCoef;
              bestMetrics = metrics;
            }
          }
        }
      }
    }
  }
  console.log(`    Phase 1: ${combos} combos, best score=${bestScore.toFixed(2)}`);

  // Phase 2: Fine search around best
  const pw = bestSrCoef;
  const ste2 = bestSteCoef;
  let refineCombos = 0;

  for (let lowSlope = pw.low.slope - 0.05; lowSlope <= pw.low.slope + 0.05; lowSlope += 0.005) {
    for (let lowIntercept = pw.low.intercept - 1; lowIntercept <= pw.low.intercept + 1; lowIntercept += 0.1) {
      for (let highSlope = pw.high.slope - 0.5; highSlope <= pw.high.slope + 0.5; highSlope += 0.05) {
        const lowAtBreak = lowIntercept + lowSlope * breakpoint;
        const highIntercept = lowAtBreak - highSlope * breakpoint;

        for (let steSlope = ste2.slope - 0.001; steSlope <= ste2.slope + 0.001; steSlope += 0.0002) {
          for (let steIntercept = ste2.intercept - 0.05; steIntercept <= ste2.intercept + 0.05; steIntercept += 0.005) {
            refineCombos++;
            const srCoef: PiecewiseCoef = {
              low: { intercept: lowIntercept, slope: lowSlope },
              high: { intercept: highIntercept, slope: highSlope },
              breakpoint,
            };
            const steCoef: SteCoef = { intercept: steIntercept, slope: steSlope };
            const metrics = evaluate(matched, srCoef, steCoef, true);
            const s = score(metrics);
            if (s < bestScore) {
              bestScore = s;
              bestSrCoef = srCoef;
              bestSteCoef = steCoef;
              bestMetrics = metrics;
            }
          }
        }
      }
    }
  }
  console.log(`    Phase 2: ${refineCombos} combos, best score=${bestScore.toFixed(2)}`);

  return {
    label: 'PIECEWISE',
    srCoef: bestSrCoef,
    steCoef: bestSteCoef,
    metrics: bestMetrics!,
    isPiecewise: true,
  };
}

// ============================================================================
// Reporting
// ============================================================================

function printResult(result: SearchResult, matched: MatchedPlayer[]) {
  const m = result.metrics;

  console.log('\n' + '='.repeat(80));
  console.log(`BEST ${result.label} FIT`);
  console.log('='.repeat(80));

  // Print coefficients
  if (result.isPiecewise) {
    const pw = result.srCoef as PiecewiseCoef;
    console.log(`\nSR Coefficients (piecewise, breakpoint=${pw.breakpoint}):`);
    console.log(`  Low  (SR <= ${pw.breakpoint}): intercept=${pw.low.intercept.toFixed(4)}, slope=${pw.low.slope.toFixed(4)}`);
    console.log(`  High (SR >  ${pw.breakpoint}): intercept=${pw.high.intercept.toFixed(4)}, slope=${pw.high.slope.toFixed(4)}`);
    console.log(`\n  SR→Attempts curve:`);
    for (const sr of [20, 30, 40, 50, 55, 60, 70, 80]) {
      const att = calcAttempts(sr, pw, true);
      console.log(`    SR ${sr.toString().padEnd(3)}: ${att.toFixed(1)} attempts/600PA`);
    }
  } else {
    const lin = result.srCoef as LinearCoef;
    console.log(`\nSR Coefficients (linear):`);
    console.log(`  intercept=${lin.intercept.toFixed(4)}, slope=${lin.slope.toFixed(4)}`);
    console.log(`\n  SR→Attempts curve:`);
    for (const sr of [20, 30, 40, 50, 60, 70, 80]) {
      const att = calcAttempts(sr, lin, false);
      console.log(`    SR ${sr.toString().padEnd(3)}: ${att.toFixed(1)} attempts/600PA`);
    }
  }

  console.log(`\nSTE Coefficients:`);
  console.log(`  intercept=${result.steCoef.intercept.toFixed(4)}, slope=${result.steCoef.slope.toFixed(4)}`);
  console.log(`\n  STE→Success Rate curve:`);
  for (const ste of [20, 30, 40, 50, 60, 70, 80]) {
    const rate = calcSuccessRate(ste, result.steCoef);
    console.log(`    STE ${ste.toString().padEnd(3)}: ${(rate * 100).toFixed(1)}%`);
  }

  // Print projected SB matrix
  console.log('\n  Projected SB (600 PA):');
  console.log('       STE20  STE35  STE50  STE65  STE80');
  for (const sr of [20, 35, 50, 65, 80]) {
    const cells = [20, 35, 50, 65, 80].map(ste => {
      const proj = projectSb(sr, ste, 600, result.srCoef, result.steCoef, result.isPiecewise);
      return proj.sb.toString().padEnd(7);
    });
    console.log(`  SR ${sr.toString().padEnd(3)} ${cells.join('')}`);
  }

  // Error metrics
  console.log(`\n--- Error Metrics (n=${m.count}) ---`);
  console.log(`  SB:       MAE=${m.sbMae.toFixed(1)}, Bias=${f(m.sbBias)}, RMSE=${m.sbRmse.toFixed(1)}`);
  console.log(`  Attempts: MAE=${m.attemptMae.toFixed(1)}, Bias=${f(m.attemptBias)}`);
  console.log(`  Total SB: Actual=${m.totalActualSb}, Proj=${m.totalProjSb}, Diff=${f(m.totalDiffPct)}%`);
  console.log(`  Success Rate Bias: ${f(m.successRateBias)}pp`);

  // Bucket analysis
  console.log('\n--- By SR Bucket ---');
  console.log('  Bucket          Count  ActMean  ProjMean  Bias');
  console.log('  ' + '-'.repeat(55));
  for (const b of m.bucketBiases) {
    if (b.count === 0) continue;
    console.log(
      '  ' + b.label.padEnd(16) +
      b.count.toString().padEnd(7) +
      b.actMean.toFixed(1).padEnd(9) +
      b.projMean.toFixed(1).padEnd(10) +
      f(b.bias)
    );
  }

  // Show top misses
  console.log('\n--- Top 10 SB Leaders (Actual vs Projected) ---');
  const sorted = [...matched].sort((a, b) => b.actualSb - a.actualSb);
  console.log('  ' + 'Player'.padEnd(22) + 'PA'.padEnd(5) + 'SR'.padEnd(5) + 'STE'.padEnd(5) + 'ActSB'.padEnd(7) + 'ProjSB'.padEnd(7) + 'Error');
  console.log('  ' + '-'.repeat(60));
  for (const p of sorted.slice(0, 10)) {
    const proj = projectSb(p.sr, p.ste, p.pa, result.srCoef, result.steCoef, result.isPiecewise);
    const err = proj.sb - p.actualSb;
    console.log(
      '  ' + p.playerName.substring(0, 20).padEnd(22) +
      p.pa.toString().padEnd(5) +
      p.sr.toString().padEnd(5) +
      p.ste.toString().padEnd(5) +
      p.actualSb.toString().padEnd(7) +
      proj.sb.toString().padEnd(7) +
      (err >= 0 ? '+' : '') + err
    );
  }
}

function f(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(1);
}

function printCodeSnippet(result: SearchResult) {
  console.log('\n' + '='.repeat(80));
  console.log('CODE SNIPPET FOR HitterRatingEstimatorService.ts');
  console.log('='.repeat(80));

  if (result.isPiecewise) {
    const pw = result.srCoef as PiecewiseCoef;
    console.log(`
  // SR (Stealing Aggressiveness, 20-80) → Steal attempts per 600 PA
  // PIECEWISE LINEAR: Different slopes for low vs high SR
  // Calibrated from WBL scouting + batting data
  //
  // Segment 1 (SR <= ${pw.breakpoint}): attempts = ${pw.low.intercept.toFixed(3)} + ${pw.low.slope.toFixed(4)} * SR
  //   At 20: ${calcAttempts(20, pw, true).toFixed(1)} attempts
  //   At ${pw.breakpoint}: ${calcAttempts(pw.breakpoint, pw, true).toFixed(1)} attempts
  //
  // Segment 2 (SR > ${pw.breakpoint}): attempts = ${pw.high.intercept.toFixed(3)} + ${pw.high.slope.toFixed(4)} * SR
  //   At ${pw.breakpoint}: ${calcAttempts(pw.breakpoint, pw, true).toFixed(1)} attempts (continuous)
  //   At 80: ${calcAttempts(80, pw, true).toFixed(1)} attempts
  stealAttempts: {
    low: { intercept: ${pw.low.intercept.toFixed(3)}, slope: ${pw.low.slope.toFixed(4)} },
    high: { intercept: ${pw.high.intercept.toFixed(3)}, slope: ${pw.high.slope.toFixed(4)} },
  },`);
  } else {
    const lin = result.srCoef as LinearCoef;
    console.log(`
  // SR (Stealing Aggressiveness, 20-80) → Steal attempts per 600 PA
  // Calibrated from WBL scouting + batting data
  // At 20: ${calcAttempts(20, lin, false).toFixed(1)} attempts
  // At 50: ${calcAttempts(50, lin, false).toFixed(1)} attempts
  // At 80: ${calcAttempts(80, lin, false).toFixed(1)} attempts
  stealAttempts: { intercept: ${lin.intercept.toFixed(3)}, slope: ${lin.slope.toFixed(4)} },`);
  }

  console.log(`
  // STE (Stealing Ability, 20-80) → Steal success rate (decimal 0-1)
  // Calibrated from WBL scouting + batting data
  // At 20: ${(calcSuccessRate(20, result.steCoef) * 100).toFixed(1)}%
  // At 50: ${(calcSuccessRate(50, result.steCoef) * 100).toFixed(1)}%
  // At 80: ${(calcSuccessRate(80, result.steCoef) * 100).toFixed(1)}%
  stealSuccess: { intercept: ${result.steCoef.intercept.toFixed(4)}, slope: ${result.steCoef.slope.toFixed(4)} },`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('STOLEN BASE COEFFICIENT CALIBRATION');
  console.log('Grid-searching SR/STE coefficients for best fit');
  console.log('='.repeat(80));

  // Load data
  const dataDir = path.join(__dirname, '..', 'public', 'data');

  const scoutingFiles = [
    'hitter_scouting_my_2021_06_14.csv',
    'hitter_scouting_my_2021_05_31.csv',
    'hitter_scouting_osa_2021_06_14.csv',
  ];

  let scouting: ScoutingPlayer[] = [];
  for (const file of scoutingFiles) {
    const p = path.join(dataDir, file);
    if (fs.existsSync(p)) {
      scouting = parseScoutingCsv(p);
      console.log(`\nScouting: ${scouting.length} players from ${file}`);
      break;
    }
  }
  if (scouting.length === 0) { console.error('No scouting data found'); process.exit(1); }

  // Load batting from multiple years
  const years = [2020, 2019, 2018];
  let allBatting: BattingPlayer[] = [];
  for (const year of years) {
    const p = path.join(dataDir, 'mlb_batting', `${year}_batting.csv`);
    if (fs.existsSync(p)) {
      const yb = parseBattingCsv(p, year);
      console.log(`Batting ${year}: ${yb.length} players`);
      allBatting.push(...yb);
    }
  }

  // Match with min PA = 200
  const scoutLookup = new Map(scouting.map(s => [s.playerId, s]));
  const matched: MatchedPlayer[] = [];
  for (const b of allBatting) {
    if (b.pa < 200) continue;
    const s = scoutLookup.get(b.playerId);
    if (!s) continue;
    matched.push({
      playerId: b.playerId,
      playerName: s.playerName,
      year: b.year,
      pa: b.pa,
      sr: s.sr,
      ste: s.ste,
      actualSb: b.sb,
      actualCs: b.cs,
      actualAttempts: b.sb + b.cs,
    });
  }

  console.log(`\nMatched players (200+ PA, ${years.join('+')}): ${matched.length}`);

  // Show distribution
  const srDist = [0, 0, 0, 0];
  for (const p of matched) {
    if (p.sr <= 34) srDist[0]++;
    else if (p.sr <= 49) srDist[1]++;
    else if (p.sr <= 64) srDist[2]++;
    else srDist[3]++;
  }
  console.log(`SR distribution: 20-34=${srDist[0]}, 35-49=${srDist[1]}, 50-64=${srDist[2]}, 65-80=${srDist[3]}`);

  // Evaluate current coefficients
  console.log('\n' + '='.repeat(80));
  console.log('CURRENT COEFFICIENTS (before optimization)');
  console.log('='.repeat(80));
  const currentSrCoef: LinearCoef = { intercept: -8.667, slope: 0.4833 };
  const currentSteCoef: SteCoef = { intercept: 0.4333, slope: 0.00583 };
  const currentMetrics = evaluate(matched, currentSrCoef, currentSteCoef, false);
  const currentResult: SearchResult = {
    label: 'CURRENT',
    srCoef: currentSrCoef,
    steCoef: currentSteCoef,
    metrics: currentMetrics,
    isPiecewise: false,
  };
  printResult(currentResult, matched);

  // Run grid searches
  console.log('\n' + '#'.repeat(80));
  console.log('# GRID SEARCH');
  console.log('#'.repeat(80));

  const linearResult = gridSearchLinear(matched);
  const piecewiseResult = gridSearchPiecewise(matched);

  // Print results
  printResult(linearResult, matched);
  printResult(piecewiseResult, matched);

  // Compare
  console.log('\n' + '='.repeat(80));
  console.log('COMPARISON SUMMARY');
  console.log('='.repeat(80));

  const results = [currentResult, linearResult, piecewiseResult];
  console.log('\n' + 'Model'.padEnd(15) + 'SB MAE'.padEnd(10) + 'SB Bias'.padEnd(10) + 'SB RMSE'.padEnd(10) + 'Total%'.padEnd(10) + 'MaxBktBias'.padEnd(12) + 'Score');
  console.log('-'.repeat(75));
  for (const r of results) {
    const maxBkt = Math.max(...r.metrics.bucketBiases.filter(b => b.count > 5).map(b => Math.abs(b.bias)));
    console.log(
      r.label.padEnd(15) +
      r.metrics.sbMae.toFixed(1).padEnd(10) +
      f(r.metrics.sbBias).padEnd(10) +
      r.metrics.sbRmse.toFixed(1).padEnd(10) +
      f(r.metrics.totalDiffPct).padEnd(10) +
      maxBkt.toFixed(1).padEnd(12) +
      score(r.metrics).toFixed(2)
    );
  }

  // Recommend best
  const best = score(linearResult.metrics) <= score(piecewiseResult.metrics) ? linearResult : piecewiseResult;
  console.log(`\nRECOMMENDED: ${best.label}`);

  printCodeSnippet(best);

  console.log('\n' + '='.repeat(80));
}

main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
});
