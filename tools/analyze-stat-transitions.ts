import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Types & Parsing ───────────────────────────────────────────────────
interface BattingRow {
  player_id: number; year: number; level_id: number;
  ab: number; h: number; k: number; pa: number;
  d: number; t: number; hr: number; bb: number; ibb: number;
  hp: number; sf: number; sh: number; war: number;
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
      player_id: parseInt(row.player_id), year: parseInt(row.year),
      level_id: parseInt(row.level_id),
      ab: parseInt(row.ab) || 0, h: parseInt(row.h) || 0, k: parseInt(row.k) || 0,
      pa: parseInt(row.pa) || 0, d: parseInt(row.d) || 0, t: parseInt(row.t) || 0,
      hr: parseInt(row.hr) || 0, bb: parseInt(row.bb) || 0, ibb: parseInt(row.ibb) || 0,
      hp: parseInt(row.hp) || 0, sf: parseInt(row.sf) || 0, sh: parseInt(row.sh) || 0,
      war: parseFloat(row.war) || 0,
    };
  });
}

const dataDir = path.join(__dirname, '..', 'public', 'data');

// ─── Load All Data ─────────────────────────────────────────────────────
console.log('Loading data...');
const minorRows: BattingRow[] = [];
const mlbRows: BattingRow[] = [];

for (let year = 2000; year <= 2021; year++) {
  for (const level of ['r', 'a', 'aa', 'aaa']) {
    const f = path.join(dataDir, 'minors_batting', `${year}_${level}_batting.csv`);
    if (fs.existsSync(f)) minorRows.push(...parseCSV(f));
  }
  const mlbFile = path.join(dataDir, 'mlb_batting', `${year}_batting.csv`);
  if (fs.existsSync(mlbFile)) mlbRows.push(...parseCSV(mlbFile));
}

// ─── Aggregate: Minor league CAREER stats per player ───────────────────
interface AggStats {
  pa: number; ab: number; h: number; k: number; bb: number; hr: number;
  d: number; t: number; hp: number; sf: number; ibb: number; war: number;
}
const emptyAgg = (): AggStats => ({ pa: 0, ab: 0, h: 0, k: 0, bb: 0, hr: 0, d: 0, t: 0, hp: 0, sf: 0, ibb: 0, war: 0 });

function addTo(s: AggStats, r: BattingRow) {
  s.pa += r.pa; s.ab += r.ab; s.h += r.h; s.k += r.k; s.bb += r.bb;
  s.hr += r.hr; s.d += r.d; s.t += r.t; s.hp += r.hp; s.sf += r.sf;
  s.ibb += r.ibb; s.war += r.war;
}

// Minor league career totals per player
const minorCareer = new Map<number, AggStats>();
for (const r of minorRows) {
  if (r.pa === 0) continue;
  let s = minorCareer.get(r.player_id);
  if (!s) { s = emptyAgg(); minorCareer.set(r.player_id, s); }
  addTo(s, r);
}

// MLB stats per player per year
const mlbByPlayerYear = new Map<string, AggStats>();
for (const r of mlbRows) {
  if (r.pa === 0) continue;
  const key = `${r.player_id}_${r.year}`;
  let s = mlbByPlayerYear.get(key);
  if (!s) { s = emptyAgg(); mlbByPlayerYear.set(key, s); }
  addTo(s, r);
}

// For each player: find their MLB seasons in chronological order
const mlbSeasonsByPlayer = new Map<number, { year: number; stats: AggStats }[]>();
for (const [key, stats] of mlbByPlayerYear) {
  const [pidStr, yearStr] = key.split('_');
  const pid = parseInt(pidStr);
  const year = parseInt(yearStr);
  let seasons = mlbSeasonsByPlayer.get(pid);
  if (!seasons) { seasons = []; mlbSeasonsByPlayer.set(pid, seasons); }
  seasons.push({ year, stats });
}
for (const seasons of mlbSeasonsByPlayer.values()) {
  seasons.sort((a, b) => a.year - b.year);
}

function rates(s: AggStats) {
  return {
    ba: s.ab > 0 ? s.h / s.ab : 0,
    bbPct: s.pa > 0 ? s.bb / s.pa : 0,
    kPct: s.pa > 0 ? s.k / s.pa : 0,
    hrPct: s.ab > 0 ? s.hr / s.ab : 0,
    xbhPct: s.ab > 0 ? (s.d + s.t + s.hr) / s.ab : 0,
    iso: s.ab > 0 ? (s.d + 2 * s.t + 3 * s.hr) / s.ab : 0,
  };
}

function avg(arr: number[]) { return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function median(arr: number[]) {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ════════════════════════════════════════════════════════════════════════
// PART 1: STAT-TO-STAT TRANSITIONS (Minor Career → MLB Yr 1-2)
// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(80));
console.log('PART 1: DO MINOR LEAGUE RATES TRANSLATE TO MLB? (First 1-2 Seasons)');
console.log('='.repeat(80));

const MIN_MINOR_PA = 1000;
const MIN_MLB_PA = 200;

interface TranslationPair {
  player_id: number;
  minorPA: number;
  minor: ReturnType<typeof rates>;
  mlbYr1: ReturnType<typeof rates> | null;
  mlbYr2: ReturnType<typeof rates> | null;
  mlbFirst2: ReturnType<typeof rates>;
  mlbFirst2Stats: AggStats;
}

const pairs: TranslationPair[] = [];

for (const [pid, minorStats] of minorCareer) {
  if (minorStats.pa < MIN_MINOR_PA) continue;
  const seasons = mlbSeasonsByPlayer.get(pid);
  if (!seasons || seasons.length === 0) continue;

  const yr1Stats = seasons[0]?.stats;
  const yr2Stats = seasons.length >= 2 ? seasons[1]?.stats : null;

  // Combine first 2 seasons
  const first2 = emptyAgg();
  if (yr1Stats) { Object.keys(first2).forEach(k => (first2 as any)[k] += (yr1Stats as any)[k]); }
  if (yr2Stats) { Object.keys(first2).forEach(k => (first2 as any)[k] += (yr2Stats as any)[k]); }

  if (first2.pa < MIN_MLB_PA) continue;

  pairs.push({
    player_id: pid,
    minorPA: minorStats.pa,
    minor: rates(minorStats),
    mlbYr1: yr1Stats && yr1Stats.pa >= 100 ? rates(yr1Stats) : null,
    mlbYr2: yr2Stats && yr2Stats.pa >= 100 ? rates(yr2Stats) : null,
    mlbFirst2: rates(first2),
    mlbFirst2Stats: first2,
  });
}

console.log(`\nPlayers with ≥${MIN_MINOR_PA} minor league PA who reached MLB (≥${MIN_MLB_PA} PA in first 2 yrs): ${pairs.length}`);

// ─── Stat Translation Table ────────────────────────────────────────────
console.log('\n── Average Rate Translation: Minor Career → MLB First 2 Seasons ──\n');

const statNames = ['BA', 'BB%', 'K%', 'HR/AB', 'XBH/AB', 'ISO'] as const;
const getMinor = (p: TranslationPair, s: typeof statNames[number]) => {
  switch (s) {
    case 'BA': return p.minor.ba;
    case 'BB%': return p.minor.bbPct;
    case 'K%': return p.minor.kPct;
    case 'HR/AB': return p.minor.hrPct;
    case 'XBH/AB': return p.minor.xbhPct;
    case 'ISO': return p.minor.iso;
  }
};
const getMLB = (p: TranslationPair, s: typeof statNames[number]) => {
  switch (s) {
    case 'BA': return p.mlbFirst2.ba;
    case 'BB%': return p.mlbFirst2.bbPct;
    case 'K%': return p.mlbFirst2.kPct;
    case 'HR/AB': return p.mlbFirst2.hrPct;
    case 'XBH/AB': return p.mlbFirst2.xbhPct;
    case 'ISO': return p.mlbFirst2.iso;
  }
};

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0) return 0;
  const mx = avg(xs), my = avg(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}

console.log('  Stat     Minor Avg   MLB Avg   Drop    Correlation');
console.log('  ' + '-'.repeat(56));
for (const s of statNames) {
  const minorVals = pairs.map(p => getMinor(p, s));
  const mlbVals = pairs.map(p => getMLB(p, s));
  const mAvg = avg(minorVals);
  const mlbAvg = avg(mlbVals);
  const drop = mAvg !== 0 ? ((mlbAvg - mAvg) / mAvg * 100) : 0;
  const r = pearsonR(minorVals, mlbVals);
  console.log(`  ${s.padEnd(8)} ${(mAvg * 100).toFixed(1).padStart(6)}%   ${(mlbAvg * 100).toFixed(1).padStart(6)}%   ${drop.toFixed(1).padStart(6)}%   r = ${r.toFixed(4)}`);
}

// ─── Bucketed Translation: "If you hit .X in minors, what do you hit in MLB?" ──
console.log('\n── If You Hit X in the Minors, What Do You Hit in the MLB? ──');
console.log('  (Minor league career → MLB first 2 seasons, median values)\n');

function bucketAnalysis(statName: string, getM: (p: TranslationPair) => number, getL: (p: TranslationPair) => number, buckets: [number, number][], fmt: (v: number) => string) {
  console.log(`  ${statName}:`);
  console.log(`    ${'Minor Range'.padEnd(18)} ${'n'.padStart(4)}  ${'Minor Med'.padStart(10)} → ${'MLB Med'.padStart(10)}  ${'Change'.padStart(8)}`);
  for (const [lo, hi] of buckets) {
    const inBucket = pairs.filter(p => getM(p) >= lo && getM(p) < hi);
    if (inBucket.length < 5) continue;
    const minorMed = median(inBucket.map(getM));
    const mlbMed = median(inBucket.map(getL));
    const change = minorMed !== 0 ? ((mlbMed - minorMed) / minorMed * 100).toFixed(1) : '0.0';
    console.log(`    ${fmt(lo)} - ${fmt(hi).padEnd(10)} ${inBucket.length.toString().padStart(4)}  ${fmt(minorMed).padStart(10)} → ${fmt(mlbMed).padStart(10)}  ${change.padStart(7)}%`);
  }
  console.log();
}

const pctFmt = (v: number) => (v * 100).toFixed(1) + '%';
const baFmt = (v: number) => '.' + (v * 1000).toFixed(0).padStart(3, '0');

bucketAnalysis('Batting Average',
  p => p.minor.ba, p => p.mlbFirst2.ba,
  [[.200, .240], [.240, .260], [.260, .280], [.280, .300], [.300, .320], [.320, .360]],
  baFmt);

bucketAnalysis('Walk Rate (BB%)',
  p => p.minor.bbPct, p => p.mlbFirst2.bbPct,
  [[.03, .06], [.06, .08], [.08, .10], [.10, .12], [.12, .15], [.15, .25]],
  pctFmt);

bucketAnalysis('Strikeout Rate (K%)',
  p => p.minor.kPct, p => p.mlbFirst2.kPct,
  [[.05, .10], [.10, .15], [.15, .20], [.20, .25], [.25, .35]],
  pctFmt);

bucketAnalysis('HR/AB',
  p => p.minor.hrPct, p => p.mlbFirst2.hrPct,
  [[.00, .01], [.01, .02], [.02, .03], [.03, .04], [.04, .06], [.06, .10]],
  pctFmt);

bucketAnalysis('ISO',
  p => p.minor.iso, p => p.mlbFirst2.iso,
  [[.050, .100], [.100, .130], [.130, .160], [.160, .200], [.200, .250], [.250, .350]],
  pctFmt);

// ─── Scatter-style: specific minor league BA → MLB BA ──────────────────
console.log('── Specific Question: .320+ minor league BA → MLB BA? ──\n');
const elite = pairs.filter(p => p.minor.ba >= .320);
const eliteMLBBAs = elite.map(p => p.mlbFirst2.ba).sort((a, b) => b - a);
console.log(`  Players with ≥.320 minor league career BA (≥${MIN_MINOR_PA} PA): ${elite.length}`);
console.log(`  Their MLB BA in first 2 seasons:`);
console.log(`    Average: .${(avg(eliteMLBBAs) * 1000).toFixed(0)}`);
console.log(`    Median:  .${(median(eliteMLBBAs) * 1000).toFixed(0)}`);
console.log(`    Hit .300+: ${eliteMLBBAs.filter(b => b >= .300).length} (${(eliteMLBBAs.filter(b => b >= .300).length / elite.length * 100).toFixed(0)}%)`);
console.log(`    Hit .280+: ${eliteMLBBAs.filter(b => b >= .280).length} (${(eliteMLBBAs.filter(b => b >= .280).length / elite.length * 100).toFixed(0)}%)`);
console.log(`    Hit .260+: ${eliteMLBBAs.filter(b => b >= .260).length} (${(eliteMLBBAs.filter(b => b >= .260).length / elite.length * 100).toFixed(0)}%)`);
console.log(`    Hit <.250: ${eliteMLBBAs.filter(b => b < .250).length} (${(eliteMLBBAs.filter(b => b < .250).length / elite.length * 100).toFixed(0)}%)`);

console.log('\n── Specific Question: 10%+ minor league BB% → MLB BB%? ──\n');
const walkers = pairs.filter(p => p.minor.bbPct >= .10);
const walkerMLB = walkers.map(p => p.mlbFirst2.bbPct).sort((a, b) => b - a);
console.log(`  Players with ≥10% minor league BB% (≥${MIN_MINOR_PA} PA): ${walkers.length}`);
console.log(`  Their MLB BB% in first 2 seasons:`);
console.log(`    Average: ${(avg(walkerMLB) * 100).toFixed(1)}%`);
console.log(`    Median:  ${(median(walkerMLB) * 100).toFixed(1)}%`);
console.log(`    Still ≥10%: ${walkerMLB.filter(b => b >= .10).length} (${(walkerMLB.filter(b => b >= .10).length / walkers.length * 100).toFixed(0)}%)`);
console.log(`    Still ≥8%:  ${walkerMLB.filter(b => b >= .08).length} (${(walkerMLB.filter(b => b >= .08).length / walkers.length * 100).toFixed(0)}%)`);
console.log(`    Dropped <6%: ${walkerMLB.filter(b => b < .06).length} (${(walkerMLB.filter(b => b < .06).length / walkers.length * 100).toFixed(0)}%)`);

// ════════════════════════════════════════════════════════════════════════
// PART 2: CAREER AGING CURVES
// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(80));
console.log('PART 2: CAREER AGING CURVES — MLB Service Year Analysis');
console.log('='.repeat(80));

// For each player, assign "MLB service year" (1st year in MLB = year 1)
interface ServiceYearStats {
  serviceYear: number;
  ba: number; bbPct: number; kPct: number; hrPct: number; iso: number; war: number;
  pa: number;
}

const allServiceYears: ServiceYearStats[] = [];

for (const [pid, seasons] of mlbSeasonsByPlayer) {
  if (seasons.length < 2) continue; // need at least 2 MLB seasons to be meaningful
  const rookieYear = seasons[0].year;

  for (const season of seasons) {
    if (season.stats.pa < 100) continue; // skip tiny samples
    const sy = season.year - rookieYear + 1;
    const r = rates(season.stats);
    allServiceYears.push({
      serviceYear: sy,
      ba: r.ba, bbPct: r.bbPct, kPct: r.kPct, hrPct: r.hrPct,
      iso: r.iso, war: season.stats.war, pa: season.stats.pa,
    });
  }
}

console.log(`\nTotal player-seasons with ≥100 PA: ${allServiceYears.length}`);
console.log('(Players with ≥2 MLB seasons, service year = years since debut)\n');

console.log('── Average Stats by MLB Service Year ──\n');
console.log('  Year   n    BA     BB%    K%    HR/AB   ISO    WAR/yr  PA/yr');
console.log('  ' + '-'.repeat(70));

for (let sy = 1; sy <= 16; sy++) {
  const bucket = allServiceYears.filter(s => s.serviceYear === sy);
  if (bucket.length < 15) {
    if (bucket.length > 0) {
      console.log(`  ${String(sy).padStart(3)}   ${String(bucket.length).padStart(4)}   (too few players)`);
    }
    continue;
  }
  console.log(
    `  ${String(sy).padStart(3)}   ${String(bucket.length).padStart(4)}` +
    `  .${(avg(bucket.map(b => b.ba)) * 1000).toFixed(0).padStart(3, '0')}` +
    `  ${(avg(bucket.map(b => b.bbPct)) * 100).toFixed(1).padStart(5)}%` +
    `  ${(avg(bucket.map(b => b.kPct)) * 100).toFixed(1).padStart(5)}%` +
    `  ${(avg(bucket.map(b => b.hrPct)) * 100).toFixed(1).padStart(5)}%` +
    `  .${(avg(bucket.map(b => b.iso)) * 1000).toFixed(0).padStart(3, '0')}` +
    `  ${avg(bucket.map(b => b.war)).toFixed(2).padStart(6)}` +
    `  ${avg(bucket.map(b => b.pa)).toFixed(0).padStart(5)}`
  );
}

// ─── Peak vs Rookie vs Decline ─────────────────────────────────────────
console.log('\n── Rookie vs Prime vs Decline (Players with ≥6 MLB seasons) ──\n');

const longCareers = new Map<number, ServiceYearStats[]>();
for (const s of allServiceYears) {
  // we need to reconstruct player_id... let me use a different approach
}

// Rebuild with player_id
const serviceByPlayer = new Map<number, ServiceYearStats[]>();
for (const [pid, seasons] of mlbSeasonsByPlayer) {
  if (seasons.length < 6) continue;
  const rookieYear = seasons[0].year;
  const syList: ServiceYearStats[] = [];
  for (const season of seasons) {
    if (season.stats.pa < 100) continue;
    const sy = season.year - rookieYear + 1;
    const r = rates(season.stats);
    syList.push({
      serviceYear: sy, ba: r.ba, bbPct: r.bbPct, kPct: r.kPct,
      hrPct: r.hrPct, iso: r.iso, war: season.stats.war, pa: season.stats.pa,
    });
  }
  if (syList.length >= 6) serviceByPlayer.set(pid, syList);
}

console.log(`  Players with ≥6 qualifying MLB seasons (≥100 PA each): ${serviceByPlayer.size}\n`);

// For each player, compute averages for phases
function phaseAvg(syList: ServiceYearStats[], yearRange: [number, number]) {
  const filtered = syList.filter(s => s.serviceYear >= yearRange[0] && s.serviceYear <= yearRange[1]);
  if (filtered.length === 0) return null;
  return {
    ba: avg(filtered.map(f => f.ba)),
    bbPct: avg(filtered.map(f => f.bbPct)),
    kPct: avg(filtered.map(f => f.kPct)),
    iso: avg(filtered.map(f => f.iso)),
    war: avg(filtered.map(f => f.war)),
    n: filtered.length,
  };
}

const phases: { label: string; range: [number, number] }[] = [
  { label: 'Rookie (Yr 1)', range: [1, 1] },
  { label: 'Year 2', range: [2, 2] },
  { label: 'Year 3', range: [3, 3] },
  { label: 'Early Prime (4-6)', range: [4, 6] },
  { label: 'Peak Prime (7-9)', range: [7, 9] },
  { label: 'Late Career (10-12)', range: [10, 12] },
  { label: 'Twilight (13+)', range: [13, 20] },
];

console.log('  Phase              n-seasons   BA     BB%    K%     ISO    WAR/yr');
console.log('  ' + '-'.repeat(68));
for (const phase of phases) {
  const allPhase: { ba: number; bbPct: number; kPct: number; iso: number; war: number }[] = [];
  for (const syList of serviceByPlayer.values()) {
    const p = phaseAvg(syList, phase.range);
    if (p) allPhase.push(p);
  }
  if (allPhase.length < 10) continue;
  console.log(
    `  ${phase.label.padEnd(20)} ${String(allPhase.length).padStart(5)}` +
    `    .${(avg(allPhase.map(p => p.ba)) * 1000).toFixed(0).padStart(3, '0')}` +
    `  ${(avg(allPhase.map(p => p.bbPct)) * 100).toFixed(1).padStart(5)}%` +
    `  ${(avg(allPhase.map(p => p.kPct)) * 100).toFixed(1).padStart(5)}%` +
    `   .${(avg(allPhase.map(p => p.iso)) * 1000).toFixed(0).padStart(3, '0')}` +
    `  ${avg(allPhase.map(p => p.war)).toFixed(2).padStart(6)}`
  );
}

// ─── WAR Trajectory for Long Careers ───────────────────────────────────
console.log('\n── WAR Trajectory: When Do Players Peak? ──\n');

// For players with 8+ seasons, find their peak WAR year
const peakYears: number[] = [];
for (const [pid, syList] of serviceByPlayer) {
  if (syList.length < 8) continue;
  let peakWar = -999, peakSY = 1;
  for (const s of syList) {
    if (s.war > peakWar) { peakWar = s.war; peakSY = s.serviceYear; }
  }
  peakYears.push(peakSY);
}
console.log(`  Players with ≥8 qualifying MLB seasons: ${peakYears.length}`);
console.log(`  Average peak WAR service year: ${avg(peakYears).toFixed(1)}`);
console.log(`  Median peak WAR service year: ${median(peakYears).toFixed(1)}`);

// Distribution of peak years
console.log('\n  Peak WAR season distribution:');
for (let sy = 1; sy <= 14; sy++) {
  const count = peakYears.filter(y => y === sy).length;
  const pct = (count / peakYears.length * 100).toFixed(1);
  const bar = '#'.repeat(Math.round(count / peakYears.length * 80));
  console.log(`    Year ${String(sy).padStart(2)}: ${pct.padStart(5)}% (${String(count).padStart(3)}) ${bar}`);
}

// ─── Rookie Year Struggle ──────────────────────────────────────────────
console.log('\n── Do Rookies Struggle? Year 1 vs Year 2 Comparison ──\n');

let yr1Better = 0, yr2Better = 0, totalCompared = 0;
const yr1Wars: number[] = [], yr2Wars: number[] = [];
const yr1BAs: number[] = [], yr2BAs: number[] = [];

for (const [pid, seasons] of mlbSeasonsByPlayer) {
  if (seasons.length < 2) continue;
  const s1 = seasons[0].stats, s2 = seasons[1].stats;
  if (s1.pa < 100 || s2.pa < 100) continue;
  const r1 = rates(s1), r2 = rates(s2);
  yr1Wars.push(s1.war); yr2Wars.push(s2.war);
  yr1BAs.push(r1.ba); yr2BAs.push(r2.ba);
  if (s2.war > s1.war) yr2Better++; else yr1Better++;
  totalCompared++;
}

console.log(`  Players compared (≥100 PA in both years): ${totalCompared}`);
console.log(`  Year 2 WAR > Year 1 WAR: ${yr2Better} (${(yr2Better / totalCompared * 100).toFixed(1)}%)`);
console.log(`  Year 1 WAR ≥ Year 2 WAR: ${yr1Better} (${(yr1Better / totalCompared * 100).toFixed(1)}%)`);
console.log(`  Avg Year 1 WAR: ${avg(yr1Wars).toFixed(2)}   Avg Year 2 WAR: ${avg(yr2Wars).toFixed(2)}`);
console.log(`  Avg Year 1 BA:  .${(avg(yr1BAs) * 1000).toFixed(0).padStart(3, '0')}   Avg Year 2 BA:  .${(avg(yr2BAs) * 1000).toFixed(0).padStart(3, '0')}`);

// ─── Career Length Distribution ────────────────────────────────────────
console.log('\n── How Long Do MLB Careers Last? ──\n');

const careerLengths: number[] = [];
for (const [pid, seasons] of mlbSeasonsByPlayer) {
  const qualSeasons = seasons.filter(s => s.stats.pa >= 100).length;
  if (qualSeasons >= 1) careerLengths.push(qualSeasons);
}
careerLengths.sort((a, b) => a - b);

console.log(`  Total players with ≥1 qualifying MLB season: ${careerLengths.length}`);
console.log(`  Average career length: ${avg(careerLengths).toFixed(1)} qualifying seasons`);
console.log(`  Median career length: ${median(careerLengths).toFixed(1)} qualifying seasons`);
console.log();
console.log('  Career length distribution:');
for (let len = 1; len <= 20; len++) {
  const count = careerLengths.filter(l => l === len).length;
  if (count === 0) continue;
  const pct = (count / careerLengths.length * 100).toFixed(1);
  const bar = '#'.repeat(Math.round(count / careerLengths.length * 60));
  console.log(`    ${String(len).padStart(2)} seasons: ${pct.padStart(5)}% (${String(count).padStart(3)}) ${bar}`);
}

// ─── "Still in MLB" survival curve ─────────────────────────────────────
console.log('\n── Survival Curve: % of Players Still in MLB by Service Year ──');
console.log('  (Among players who had ≥1 qualifying season)\n');

const totalPlayers = careerLengths.length;
for (let sy = 1; sy <= 16; sy++) {
  const surviving = careerLengths.filter(l => l >= sy).length;
  const pct = (surviving / totalPlayers * 100).toFixed(1);
  const bar = '█'.repeat(Math.round(surviving / totalPlayers * 50));
  console.log(`    Year ${String(sy).padStart(2)}: ${pct.padStart(5)}% (${String(surviving).padStart(4)}) ${bar}`);
}

// ════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
console.log(`
Key Takeaways:

1. STAT TRANSLATION (Minor → MLB first 2 seasons):
   - BB% translates best (highest correlation)
   - K% translates well
   - BA and power stats translate less reliably
   - All stats drop at MLB level, but the relative ranking holds

2. CAREER CURVE:
   - Check the aging curve table above for peak years
   - Check if rookies struggle vs year 2+
   - Check peak WAR service year distribution
`);
