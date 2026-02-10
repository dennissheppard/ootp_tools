import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CSV Parsing ───────────────────────────────────────────────────────
interface BattingRow {
  player_id: number;
  year: number;
  level_id: number;
  ab: number;
  h: number;
  k: number;
  pa: number;
  d: number;
  t: number;
  hr: number;
  bb: number;
  ibb: number;
  hp: number;
  sf: number;
  sh: number;
  war: number;
}

function parseCSV(filePath: string): BattingRow[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row: any = {};
    headers.forEach((h, i) => row[h.trim()] = vals[i]?.trim());
    return {
      player_id: parseInt(row.player_id),
      year: parseInt(row.year),
      level_id: parseInt(row.level_id),
      ab: parseInt(row.ab) || 0,
      h: parseInt(row.h) || 0,
      k: parseInt(row.k) || 0,
      pa: parseInt(row.pa) || 0,
      d: parseInt(row.d) || 0,
      t: parseInt(row.t) || 0,
      hr: parseInt(row.hr) || 0,
      bb: parseInt(row.bb) || 0,
      ibb: parseInt(row.ibb) || 0,
      hp: parseInt(row.hp) || 0,
      sf: parseInt(row.sf) || 0,
      sh: parseInt(row.sh) || 0,
      war: parseFloat(row.war) || 0,
    };
  });
}

// ─── Load All Data ─────────────────────────────────────────────────────
const dataDir = path.join(__dirname, '..', 'public', 'data');

// Aggregate stats per player per year per level
interface AggStats {
  pa: number; ab: number; h: number; k: number; bb: number; hr: number;
  d: number; t: number; hp: number; sf: number; ibb: number; war: number;
}

function aggregate(rows: BattingRow[]): Map<string, AggStats> {
  const map = new Map<string, AggStats>();
  for (const r of rows) {
    if (r.pa === 0) continue;
    const key = `${r.player_id}_${r.year}`;
    let s = map.get(key);
    if (!s) { s = { pa: 0, ab: 0, h: 0, k: 0, bb: 0, hr: 0, d: 0, t: 0, hp: 0, sf: 0, ibb: 0, war: 0 }; map.set(key, s); }
    s.pa += r.pa; s.ab += r.ab; s.h += r.h; s.k += r.k; s.bb += r.bb;
    s.hr += r.hr; s.d += r.d; s.t += r.t; s.hp += r.hp; s.sf += r.sf;
    s.ibb += r.ibb; s.war += r.war;
  }
  return map;
}

console.log('Loading data...');

// Load AAA data (also load AA for comparison)
const aaaRows: BattingRow[] = [];
const aaRows: BattingRow[] = [];
const mlbRows: BattingRow[] = [];

for (let year = 2000; year <= 2021; year++) {
  const aaaFile = path.join(dataDir, 'minors_batting', `${year}_aaa_batting.csv`);
  if (fs.existsSync(aaaFile)) aaaRows.push(...parseCSV(aaaFile));

  const aaFile = path.join(dataDir, 'minors_batting', `${year}_aa_batting.csv`);
  if (fs.existsSync(aaFile)) aaRows.push(...parseCSV(aaFile));

  const mlbFile = path.join(dataDir, 'mlb_batting', `${year}_batting.csv`);
  if (fs.existsSync(mlbFile)) mlbRows.push(...parseCSV(mlbFile));
}

const aaaByPlayerYear = aggregate(aaaRows);
const aaByPlayerYear = aggregate(aaRows);
const mlbByPlayerYear = aggregate(mlbRows);

// Build MLB career stats for all players who ever appeared in MLB
const mlbCareer = new Map<number, AggStats>();
for (const r of mlbRows) {
  if (r.pa === 0) continue;
  let s = mlbCareer.get(r.player_id);
  if (!s) { s = { pa: 0, ab: 0, h: 0, k: 0, bb: 0, hr: 0, d: 0, t: 0, hp: 0, sf: 0, ibb: 0, war: 0 }; mlbCareer.set(r.player_id, s); }
  s.pa += r.pa; s.ab += r.ab; s.h += r.h; s.k += r.k; s.bb += r.bb;
  s.hr += r.hr; s.d += r.d; s.t += r.t; s.hp += r.hp; s.sf += r.sf;
  s.ibb += r.ibb; s.war += r.war;
}

// ─── Analysis 1: AAA → MLB Transition ──────────────────────────────────
// Find players with meaningful AAA seasons who then played MLB within 1-2 years
console.log('\n' + '='.repeat(80));
console.log('ANALYSIS: Do Minor League Stats Predict MLB Success?');
console.log('='.repeat(80));

interface TransitionPair {
  player_id: number;
  aaaYear: number;
  mlbYear: number;
  aaa: AggStats;
  mlb: AggStats;
  // Rates
  aaaBA: number; mlbBA: number;
  aaaBBpct: number; mlbBBpct: number;
  aaaKpct: number; mlbKpct: number;
  aaaHRpct: number; mlbHRpct: number;
  aaaXBHpct: number; mlbXBHpct: number;
  aaaISO: number; mlbISO: number;
}

function calcRates(s: AggStats) {
  return {
    ba: s.ab > 0 ? s.h / s.ab : 0,
    bbPct: s.pa > 0 ? s.bb / s.pa : 0,
    kPct: s.pa > 0 ? s.k / s.pa : 0,
    hrPct: s.ab > 0 ? s.hr / s.ab : 0,
    xbhPct: s.ab > 0 ? (s.d + s.t + s.hr) / s.ab : 0,
    iso: s.ab > 0 ? (s.d + 2 * s.t + 3 * s.hr) / s.ab : 0,
  };
}

const transitions: TransitionPair[] = [];
const MIN_AAA_PA = 200;
const MIN_MLB_PA = 100;

for (const [key, aaaStats] of aaaByPlayerYear) {
  const [pidStr, yearStr] = key.split('_');
  const pid = parseInt(pidStr);
  const aaaYear = parseInt(yearStr);

  if (aaaStats.pa < MIN_AAA_PA) continue;

  // Look for MLB stats in same year or next year
  for (const offset of [0, 1]) {
    const mlbKey = `${pid}_${aaaYear + offset}`;
    const mlbStats = mlbByPlayerYear.get(mlbKey);
    if (mlbStats && mlbStats.pa >= MIN_MLB_PA) {
      const aaaR = calcRates(aaaStats);
      const mlbR = calcRates(mlbStats);
      transitions.push({
        player_id: pid,
        aaaYear,
        mlbYear: aaaYear + offset,
        aaa: aaaStats,
        mlb: mlbStats,
        aaaBA: aaaR.ba, mlbBA: mlbR.ba,
        aaaBBpct: aaaR.bbPct, mlbBBpct: mlbR.bbPct,
        aaaKpct: aaaR.kPct, mlbKpct: mlbR.kPct,
        aaaHRpct: aaaR.hrPct, mlbHRpct: mlbR.hrPct,
        aaaXBHpct: aaaR.xbhPct, mlbXBHpct: mlbR.xbhPct,
        aaaISO: aaaR.iso, mlbISO: mlbR.iso,
      });
      break; // take the first MLB match
    }
  }
}

console.log(`\nFound ${transitions.length} AAA→MLB transition pairs (AAA PA≥${MIN_AAA_PA}, MLB PA≥${MIN_MLB_PA})`);

// ─── Correlation ───────────────────────────────────────────────────────
function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}

console.log('\n── Correlation: AAA stat → Same stat at MLB level ──');
const stats: { name: string; aaaKey: keyof TransitionPair; mlbKey: keyof TransitionPair }[] = [
  { name: 'BA', aaaKey: 'aaaBA', mlbKey: 'mlbBA' },
  { name: 'BB%', aaaKey: 'aaaBBpct', mlbKey: 'mlbBBpct' },
  { name: 'K%', aaaKey: 'aaaKpct', mlbKey: 'mlbKpct' },
  { name: 'HR%', aaaKey: 'aaaHRpct', mlbKey: 'mlbHRpct' },
  { name: 'XBH%', aaaKey: 'aaaXBHpct', mlbKey: 'mlbXBHpct' },
  { name: 'ISO', aaaKey: 'aaaISO', mlbKey: 'mlbISO' },
];

for (const s of stats) {
  const xs = transitions.map(t => t[s.aaaKey] as number);
  const ys = transitions.map(t => t[s.mlbKey] as number);
  const r = pearsonR(xs, ys);
  console.log(`  ${s.name.padEnd(6)} r = ${r.toFixed(4)}`);
}

// ─── Correlation: AAA stats → MLB WAR ──────────────────────────────────
console.log('\n── Correlation: AAA stat → MLB WAR (first full season) ──');
const mlbWars = transitions.map(t => t.mlb.war);
for (const s of stats) {
  const xs = transitions.map(t => t[s.aaaKey] as number);
  const r = pearsonR(xs, mlbWars);
  console.log(`  ${s.name.padEnd(6)} r = ${r.toFixed(4)}`);
}

// Also: AAA PA→MLB WAR
console.log(`  ${'PA'.padEnd(6)} r = ${pearsonR(transitions.map(t => t.aaa.pa), mlbWars).toFixed(4)}`);

// ─── Correlation: AAA stats → MLB Career WAR ──────────────────────────
console.log('\n── Correlation: AAA stat → MLB Career WAR ──');
// Use the player's last AAA season before reaching MLB
const lastAAAbeforeMLB = new Map<number, TransitionPair>();
for (const t of transitions) {
  const existing = lastAAAbeforeMLB.get(t.player_id);
  if (!existing || t.aaaYear > existing.aaaYear) {
    lastAAAbeforeMLB.set(t.player_id, t);
  }
}
const uniqueTransitions = Array.from(lastAAAbeforeMLB.values());
const careerWars = uniqueTransitions.map(t => mlbCareer.get(t.player_id)?.war ?? 0);

console.log(`  (${uniqueTransitions.length} unique players)`);
for (const s of stats) {
  const xs = uniqueTransitions.map(t => t[s.aaaKey] as number);
  const r = pearsonR(xs, careerWars);
  console.log(`  ${s.name.padEnd(6)} r = ${r.toFixed(4)}`);
}

// ─── Success Rate by Quartile ──────────────────────────────────────────
console.log('\n── MLB Success Rate by AAA Performance Quartile ──');
console.log('  (Success = MLB WAR ≥ 1.0 in first full season)\n');

function quartileAnalysis(name: string, values: number[], mlbWars: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q2 = sorted[Math.floor(sorted.length * 0.50)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];

  const buckets = [
    { label: 'Bottom 25%', min: -Infinity, max: q1, count: 0, success: 0 },
    { label: '25-50%', min: q1, max: q2, count: 0, success: 0 },
    { label: '50-75%', min: q2, max: q3, count: 0, success: 0 },
    { label: 'Top 25%', min: q3, max: Infinity, count: 0, success: 0 },
  ];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const war = mlbWars[i];
    for (const b of buckets) {
      if (v >= b.min && (v < b.max || b.max === Infinity)) {
        b.count++;
        if (war >= 1.0) b.success++;
        break;
      }
    }
  }

  console.log(`  ${name}:`);
  for (const b of buckets) {
    const rate = b.count > 0 ? (b.success / b.count * 100).toFixed(1) : '0.0';
    console.log(`    ${b.label.padEnd(12)} ${rate.padStart(5)}% success (${b.success}/${b.count})`);
  }
  console.log();
}

const statExtractors: { name: string; extract: (t: TransitionPair) => number }[] = [
  { name: 'BA', extract: t => t.aaaBA },
  { name: 'BB%', extract: t => t.aaaBBpct },
  { name: 'K%', extract: t => t.aaaKpct },
  { name: 'HR%', extract: t => t.aaaHRpct },
  { name: 'XBH%', extract: t => t.aaaXBHpct },
  { name: 'ISO', extract: t => t.aaaISO },
];

for (const s of statExtractors) {
  quartileAnalysis(s.name, transitions.map(s.extract), mlbWars);
}

// ─── Average Drop-off from AAA → MLB ───────────────────────────────────
console.log('── Average Stat Change: AAA → MLB ──');
function avg(arr: number[]) { return arr.reduce((a, b) => a + b, 0) / arr.length; }

for (const s of stats) {
  const diffs = transitions.map(t => (t[s.mlbKey] as number) - (t[s.aaaKey] as number));
  const aaaAvg = avg(transitions.map(t => t[s.aaaKey] as number));
  const mlbAvg = avg(transitions.map(t => t[s.mlbKey] as number));
  const diffAvg = avg(diffs);
  const pctChange = aaaAvg !== 0 ? (diffAvg / aaaAvg * 100).toFixed(1) : '0.0';
  console.log(`  ${s.name.padEnd(6)} AAA avg: ${(aaaAvg * 100).toFixed(1).padStart(5)}%  MLB avg: ${(mlbAvg * 100).toFixed(1).padStart(5)}%  Change: ${pctChange.padStart(6)}%`);
}

// ─── Threshold Analysis ────────────────────────────────────────────────
console.log('\n── Promotion Readiness Thresholds ──');
console.log('  What AAA thresholds best predict positive MLB WAR?\n');

function thresholdAnalysis(name: string, values: number[], mlbWars: number[], thresholds: number[], invert: boolean = false) {
  console.log(`  ${name} (${invert ? 'lower is better' : 'higher is better'}):`);
  for (const threshold of thresholds) {
    const passing = values.map((v, i) => ({ v, war: mlbWars[i] }))
      .filter(x => invert ? x.v <= threshold : x.v >= threshold);
    const failing = values.map((v, i) => ({ v, war: mlbWars[i] }))
      .filter(x => invert ? x.v > threshold : x.v < threshold);

    const passSuccess = passing.filter(x => x.war > 0).length;
    const passRate = passing.length > 0 ? (passSuccess / passing.length * 100).toFixed(1) : '0.0';
    const passAvgWar = passing.length > 0 ? avg(passing.map(x => x.war)).toFixed(2) : '0.00';
    const failAvgWar = failing.length > 0 ? avg(failing.map(x => x.war)).toFixed(2) : '0.00';

    console.log(`    ${invert ? '≤' : '≥'}${(threshold * 100).toFixed(1).padStart(5)}%: ${passRate.padStart(5)}% positive WAR (n=${passing.length.toString().padStart(3)}), avg WAR: ${passAvgWar} vs ${failAvgWar} below`);
  }
  console.log();
}

thresholdAnalysis('BA', transitions.map(t => t.aaaBA), mlbWars,
  [0.240, 0.260, 0.280, 0.300, 0.320]);

thresholdAnalysis('BB%', transitions.map(t => t.aaaBBpct), mlbWars,
  [0.06, 0.08, 0.10, 0.12, 0.14]);

thresholdAnalysis('K%', transitions.map(t => t.aaaKpct), mlbWars,
  [0.25, 0.22, 0.20, 0.18, 0.15], true);

thresholdAnalysis('HR/AB', transitions.map(t => t.aaaHRpct), mlbWars,
  [0.02, 0.03, 0.04, 0.05, 0.06]);

thresholdAnalysis('ISO', transitions.map(t => t.aaaISO), mlbWars,
  [0.120, 0.150, 0.180, 0.200, 0.230]);

// ─── AA vs AAA as Promotion Indicator ──────────────────────────────────
console.log('── Does Level Matter? AA vs AAA as MLB Predictor ──\n');

const aaTransitions: TransitionPair[] = [];
for (const [key, aaStats] of aaByPlayerYear) {
  const [pidStr, yearStr] = key.split('_');
  const pid = parseInt(pidStr);
  const aaYear = parseInt(yearStr);
  if (aaStats.pa < MIN_AAA_PA) continue;

  for (const offset of [0, 1, 2]) {
    const mlbKey = `${pid}_${aaYear + offset}`;
    const mlbStats = mlbByPlayerYear.get(mlbKey);
    if (mlbStats && mlbStats.pa >= MIN_MLB_PA) {
      const aaR = calcRates(aaStats);
      const mlbR = calcRates(mlbStats);
      aaTransitions.push({
        player_id: pid, aaaYear: aaYear, mlbYear: aaYear + offset,
        aaa: aaStats, mlb: mlbStats,
        aaaBA: aaR.ba, mlbBA: mlbR.ba,
        aaaBBpct: aaR.bbPct, mlbBBpct: mlbR.bbPct,
        aaaKpct: aaR.kPct, mlbKpct: mlbR.kPct,
        aaaHRpct: aaR.hrPct, mlbHRpct: mlbR.hrPct,
        aaaXBHpct: aaR.xbhPct, mlbXBHpct: mlbR.xbhPct,
        aaaISO: aaR.iso, mlbISO: mlbR.iso,
      });
      break;
    }
  }
}

console.log(`  AA→MLB pairs: ${aaTransitions.length}  |  AAA→MLB pairs: ${transitions.length}\n`);
console.log('  Correlation with MLB WAR:');
for (const s of stats) {
  const aaR = pearsonR(aaTransitions.map(t => t[s.aaaKey] as number), aaTransitions.map(t => t.mlb.war));
  const aaaR = pearsonR(transitions.map(t => t[s.aaaKey] as number), mlbWars);
  console.log(`    ${s.name.padEnd(6)} AA r=${aaR.toFixed(4)}  AAA r=${aaaR.toFixed(4)}`);
}

// ─── Multi-Stat "Readiness Score" ──────────────────────────────────────
console.log('\n── Composite Readiness Score ──');
console.log('  Testing: BA + BB% + (1-K%) + ISO as combined predictor\n');

function compositeScore(t: TransitionPair): number {
  // Normalize each stat to 0-1 range roughly
  return (t.aaaBA / 0.350) * 0.25 +
         (t.aaaBBpct / 0.15) * 0.25 +
         ((1 - t.aaaKpct) / 0.85) * 0.20 +
         (t.aaaISO / 0.250) * 0.30;
}

const scores = transitions.map(compositeScore);
const compR = pearsonR(scores, mlbWars);
console.log(`  Composite score correlation with MLB WAR: r = ${compR.toFixed(4)}`);

// Quartile analysis on composite
quartileAnalysis('Composite', scores, mlbWars);

// ─── What percentage of AAA guys ever make MLB? ────────────────────────
console.log('── AAA Players Who Reach MLB ──');
const allAAAplayers = new Set<number>();
const aaaWhoReachedMLB = new Set<number>();
for (const r of aaaRows) {
  if (r.pa >= 100) allAAAplayers.add(r.player_id);
}
for (const pid of allAAAplayers) {
  if (mlbCareer.has(pid)) aaaWhoReachedMLB.add(pid);
}
console.log(`  AAA players (≥100 PA in any season): ${allAAAplayers.size}`);
console.log(`  Of those who reached MLB: ${aaaWhoReachedMLB.size} (${(aaaWhoReachedMLB.size / allAAAplayers.size * 100).toFixed(1)}%)`);

// Of those, how many had positive career WAR?
let posWAR = 0, war1plus = 0, war5plus = 0;
for (const pid of aaaWhoReachedMLB) {
  const career = mlbCareer.get(pid);
  if (career) {
    if (career.war > 0) posWAR++;
    if (career.war >= 1) war1plus++;
    if (career.war >= 5) war5plus++;
  }
}
console.log(`  Positive career WAR: ${posWAR} (${(posWAR / aaaWhoReachedMLB.size * 100).toFixed(1)}%)`);
console.log(`  Career WAR ≥ 1: ${war1plus} (${(war1plus / aaaWhoReachedMLB.size * 100).toFixed(1)}%)`);
console.log(`  Career WAR ≥ 5: ${war5plus} (${(war5plus / aaaWhoReachedMLB.size * 100).toFixed(1)}%)`);

// ─── Top/Bottom Examples ───────────────────────────────────────────────
console.log('\n── Top 15 AAA Performers & Their MLB Outcome ──');
const sorted = [...transitions].sort((a, b) => compositeScore(b) - compositeScore(a));
console.log('  '.padEnd(2) + 'Player'.padEnd(10) + 'AAA Yr'.padEnd(8) + 'AAA BA'.padEnd(9) + 'AAA BB%'.padEnd(9) + 'AAA K%'.padEnd(9) + 'AAA ISO'.padEnd(9) + 'MLB WAR'.padEnd(9) + 'MLB BA');
for (let i = 0; i < Math.min(15, sorted.length); i++) {
  const t = sorted[i];
  console.log(`  ${String(i + 1).padStart(2)}. ${String(t.player_id).padEnd(8)} ${t.aaaYear}  ${(t.aaaBA * 100).toFixed(1).padStart(5)}%  ${(t.aaaBBpct * 100).toFixed(1).padStart(5)}%  ${(t.aaaKpct * 100).toFixed(1).padStart(5)}%  ${(t.aaaISO * 100).toFixed(1).padStart(5)}%  ${t.mlb.war.toFixed(1).padStart(5)}  ${(t.mlbBA * 100).toFixed(1).padStart(5)}%`);
}

console.log('\n── Bottom 15 AAA Performers & Their MLB Outcome ──');
const bottomSorted = [...transitions].sort((a, b) => compositeScore(a) - compositeScore(b));
console.log('  '.padEnd(2) + 'Player'.padEnd(10) + 'AAA Yr'.padEnd(8) + 'AAA BA'.padEnd(9) + 'AAA BB%'.padEnd(9) + 'AAA K%'.padEnd(9) + 'AAA ISO'.padEnd(9) + 'MLB WAR'.padEnd(9) + 'MLB BA');
for (let i = 0; i < Math.min(15, bottomSorted.length); i++) {
  const t = bottomSorted[i];
  console.log(`  ${String(i + 1).padStart(2)}. ${String(t.player_id).padEnd(8)} ${t.aaaYear}  ${(t.aaaBA * 100).toFixed(1).padStart(5)}%  ${(t.aaaBBpct * 100).toFixed(1).padStart(5)}%  ${(t.aaaKpct * 100).toFixed(1).padStart(5)}%  ${(t.aaaISO * 100).toFixed(1).padStart(5)}%  ${t.mlb.war.toFixed(1).padStart(5)}  ${(t.mlbBA * 100).toFixed(1).padStart(5)}%`);
}

// ─── Summary / Key Findings ────────────────────────────────────────────
console.log('\n' + '='.repeat(80));
console.log('SUMMARY OF FINDINGS');
console.log('='.repeat(80));

// Find the best single predictor
const statCorrs = stats.map(s => ({
  name: s.name,
  r: pearsonR(transitions.map(t => t[s.aaaKey] as number), mlbWars)
})).sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

console.log('\nBest single predictors of MLB WAR (by |correlation|):');
for (const sc of statCorrs) {
  const strength = Math.abs(sc.r) >= 0.4 ? 'STRONG' : Math.abs(sc.r) >= 0.25 ? 'MODERATE' : Math.abs(sc.r) >= 0.15 ? 'WEAK' : 'VERY WEAK';
  console.log(`  ${sc.name.padEnd(6)} r=${sc.r.toFixed(4).padStart(7)}  (${strength})`);
}
console.log(`  Composite r=${compR.toFixed(4).padStart(7)}`);

console.log(`\nAverage stat dropoff AAA → MLB:`);
for (const s of stats) {
  const aaaAvg = avg(transitions.map(t => t[s.aaaKey] as number));
  const mlbAvg = avg(transitions.map(t => t[s.mlbKey] as number));
  const change = aaaAvg !== 0 ? ((mlbAvg - aaaAvg) / aaaAvg * 100).toFixed(1) : '0.0';
  console.log(`  ${s.name.padEnd(6)} ${change.padStart(6)}%`);
}
