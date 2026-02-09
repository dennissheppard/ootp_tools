import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

function parseCSV(csvText: string) {
  const lines = csvText.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map(line => line.split(','));
  return { headers, rows };
}

function loadDOBMap(): Map<number, Date> {
  const dobMap = new Map<number, Date>();
  const mlbDobPath = path.join(DATA_DIR, 'mlb_dob.csv');
  if (fs.existsSync(mlbDobPath)) {
    const lines = fs.readFileSync(mlbDobPath, 'utf-8').trim().split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const [idStr, dobStr] = lines[i].split(',');
      const pid = parseInt(idStr, 10);
      if (!pid || !dobStr) continue;
      const [m, d, y] = dobStr.split('/').map(s => parseInt(s, 10));
      if (m && d && y) dobMap.set(pid, new Date(y, m - 1, d));
    }
  }
  return dobMap;
}

function calcAge(dob: Date | undefined, season: number): number | null {
  if (!dob) return null;
  const start = new Date(season, 3, 1);
  return Math.floor((start.getTime() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

// Build MLB distributions
const dobMap = loadDOBMap();
const years = [2015, 2016, 2017, 2018, 2019, 2020];
const allBbPct: number[] = [];
const allKPct: number[] = [];
const allHrPct: number[] = [];
const allAvg: number[] = [];

for (const year of years) {
  const fp = path.join(DATA_DIR, 'mlb_batting', `${year}_batting.csv`);
  if (!fs.existsSync(fp)) continue;
  const { headers, rows } = parseCSV(fs.readFileSync(fp, 'utf-8'));
  const idx = {
    player_id: headers.indexOf('player_id'), split_id: headers.indexOf('split_id'),
    pa: headers.indexOf('pa'), ab: headers.indexOf('ab'),
    h: headers.indexOf('h'), hr: headers.indexOf('hr'),
    bb: headers.indexOf('bb'), k: headers.indexOf('k'),
  };
  for (const row of rows) {
    if (parseInt(row[idx.split_id]) !== 1) continue;
    const pid = parseInt(row[idx.player_id]);
    const pa = parseInt(row[idx.pa]) || 0;
    if (pa < 300) continue;
    const age = calcAge(dobMap.get(pid), year);
    if (!age || age < 25 || age > 29) continue;
    const ab = parseInt(row[idx.ab]) || 0;
    const h = parseInt(row[idx.h]) || 0;
    const hr = parseInt(row[idx.hr]) || 0;
    const bb = parseInt(row[idx.bb]) || 0;
    const k = parseInt(row[idx.k]) || 0;
    const bbPct = (bb / pa) * 100;
    const kPct = (k / pa) * 100;
    const hrPct = (hr / pa) * 100;
    const avg = ab > 0 ? h / ab : 0;
    if (bbPct >= 2 && bbPct <= 25 && kPct >= 5 && kPct <= 40 &&
        hrPct >= 0 && hrPct <= 10 && avg >= 0.150 && avg <= 0.400) {
      allBbPct.push(bbPct);
      allKPct.push(kPct);
      allHrPct.push(hrPct);
      allAvg.push(avg);
    }
  }
}
allBbPct.sort((a, b) => a - b);
allKPct.sort((a, b) => a - b);
allHrPct.sort((a, b) => a - b);
allAvg.sort((a, b) => a - b);

console.log(`\nMLB Distribution: ${allBbPct.length} peak-age hitter-seasons`);
console.log(`  BB% range: ${allBbPct[0].toFixed(1)}% - ${allBbPct[allBbPct.length-1].toFixed(1)}%, median: ${allBbPct[Math.floor(allBbPct.length/2)].toFixed(1)}%, mean: ${(allBbPct.reduce((a,b)=>a+b,0)/allBbPct.length).toFixed(1)}%`);
console.log(`  K%  range: ${allKPct[0].toFixed(1)}% - ${allKPct[allKPct.length-1].toFixed(1)}%, median: ${allKPct[Math.floor(allKPct.length/2)].toFixed(1)}%`);
console.log(`  HR% range: ${allHrPct[0].toFixed(2)}% - ${allHrPct[allHrPct.length-1].toFixed(2)}%, median: ${allHrPct[Math.floor(allHrPct.length/2)].toFixed(2)}%`);
console.log(`  AVG range: ${allAvg[0].toFixed(3)} - ${allAvg[allAvg.length-1].toFixed(3)}, median: ${allAvg[Math.floor(allAvg.length/2)].toFixed(3)}`);

// Find percentile of a value in a sorted array
function findPercentileHigherBetter(value: number, sorted: number[]): number {
  let count = 0;
  for (const v of sorted) { if (v <= value) count++; else break; }
  return (count / sorted.length) * 100;
}

function findPercentileLowerBetter(value: number, sorted: number[]): number {
  let count = 0;
  for (const v of sorted) { if (v >= value) count++; }
  return (count / sorted.length) * 100;
}

// Player 14874
console.log(`\n${'='.repeat(70)}`);
console.log(`Player 14874 (Eye=50, AvoidK=75, Power=75, Contact=80)`);
console.log(`${'='.repeat(70)}`);

const blended = { bbPct: 7.36, kPct: 14.11, hrPct: 3.69, avg: 0.345 };

const bbPctl = findPercentileHigherBetter(blended.bbPct, allBbPct);
const kPctl = findPercentileLowerBetter(blended.kPct, allKPct);
const hrPctl = findPercentileHigherBetter(blended.hrPct, allHrPct);
const avgPctl = findPercentileHigherBetter(blended.avg, allAvg);

console.log(`\n  Component    Scout  Blended Rate    MLB Pctl   Old True  New True  Delta`);
console.log(`  Eye          50     BB% ${blended.bbPct.toFixed(2)}%      ${bbPctl.toFixed(1).padStart(5)}      69        ${Math.round(20 + (bbPctl / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (bbPctl / 100) * 60) - 69}`);
console.log(`  AvoidK       75     K%  ${blended.kPct.toFixed(2)}%     ${kPctl.toFixed(1).padStart(5)}      60        ${Math.round(20 + (kPctl / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (kPctl / 100) * 60) - 60}`);
console.log(`  Power        75     HR% ${blended.hrPct.toFixed(3)}%     ${hrPctl.toFixed(1).padStart(5)}      78        ${Math.round(20 + (hrPctl / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (hrPctl / 100) * 60) - 78}`);
console.log(`  Contact      80     AVG ${blended.avg.toFixed(3)}      ${avgPctl.toFixed(1).padStart(5)}      80        ${Math.round(20 + (avgPctl / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (avgPctl / 100) * 60) - 80}`);

// Player 15354
console.log(`\n${'='.repeat(70)}`);
console.log(`Player 15354 (Eye=55, AvoidK=70, Power=60, Contact=70)`);
console.log(`${'='.repeat(70)}`);

const blended2 = { bbPct: 7.94, kPct: 11.08, hrPct: 3.13, avg: 0.306 };

const bbPctl2 = findPercentileHigherBetter(blended2.bbPct, allBbPct);
const kPctl2 = findPercentileLowerBetter(blended2.kPct, allKPct);
const hrPctl2 = findPercentileHigherBetter(blended2.hrPct, allHrPct);
const avgPctl2 = findPercentileHigherBetter(blended2.avg, allAvg);

console.log(`\n  Component    Scout  Blended Rate    MLB Pctl   Old True  New True  Delta`);
console.log(`  Eye          55     BB% ${blended2.bbPct.toFixed(2)}%      ${bbPctl2.toFixed(1).padStart(5)}      75        ${Math.round(20 + (bbPctl2 / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (bbPctl2 / 100) * 60) - 75}`);
console.log(`  AvoidK       70     K%  ${blended2.kPct.toFixed(2)}%     ${kPctl2.toFixed(1).padStart(5)}      77        ${Math.round(20 + (kPctl2 / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (kPctl2 / 100) * 60) - 77}`);
console.log(`  Power        60     HR% ${blended2.hrPct.toFixed(3)}%     ${hrPctl2.toFixed(1).padStart(5)}      76        ${Math.round(20 + (hrPctl2 / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (hrPctl2 / 100) * 60) - 76}`);
console.log(`  Contact      70     AVG ${blended2.avg.toFixed(3)}      ${avgPctl2.toFixed(1).padStart(5)}      78        ${Math.round(20 + (avgPctl2 / 100) * 60).toString().padStart(3)}       ${Math.round(20 + (avgPctl2 / 100) * 60) - 78}`);

// Reference: what does each "50" scouting rating map to?
console.log(`\n${'='.repeat(70)}`);
console.log(`Reference: "50" scouting rating = league average`);
console.log(`${'='.repeat(70)}`);

const eye50 = 1.6246 + 0.114789 * 50;
const avk50 = 25.10 + (-0.200303) * 50;
const pow50 = -1.034 + 0.0637 * 50;
const con50 = 0.035156 + 0.003873 * 50;

console.log(`\n  Eye 50     -> BB%  ${eye50.toFixed(2)}% -> ${findPercentileHigherBetter(eye50, allBbPct).toFixed(1)}th pctl -> True ${Math.round(20 + (findPercentileHigherBetter(eye50, allBbPct) / 100) * 60)}`);
console.log(`  AvoidK 50  -> K%   ${avk50.toFixed(2)}% -> ${findPercentileLowerBetter(avk50, allKPct).toFixed(1)}th pctl -> True ${Math.round(20 + (findPercentileLowerBetter(avk50, allKPct) / 100) * 60)}`);
console.log(`  Power 50   -> HR%  ${pow50.toFixed(3)}% -> ${findPercentileHigherBetter(pow50, allHrPct).toFixed(1)}th pctl -> True ${Math.round(20 + (findPercentileHigherBetter(pow50, allHrPct) / 100) * 60)}`);
console.log(`  Contact 50 -> AVG  ${con50.toFixed(3)}  -> ${findPercentileHigherBetter(con50, allAvg).toFixed(1)}th pctl -> True ${Math.round(20 + (findPercentileHigherBetter(con50, allAvg) / 100) * 60)}`);

// A few more reference points
console.log(`\nScouting -> True Rating mapping (direct MLB comparison):`);
console.log(`  Scout  Eye   AvoidK  Power  Contact`);
for (const rating of [20, 30, 40, 50, 60, 70, 80]) {
  const bb = 1.6246 + 0.114789 * rating;
  const k = 25.10 + (-0.200303) * rating;
  const hr = rating <= 50 ? -1.034 + 0.0637 * rating : -2.75 + 0.098 * rating;
  const avg = 0.035156 + 0.003873 * rating;

  const eTrueEye = Math.round(20 + (findPercentileHigherBetter(bb, allBbPct) / 100) * 60);
  const eTrueAvK = Math.round(20 + (findPercentileLowerBetter(k, allKPct) / 100) * 60);
  const eTruePow = Math.round(20 + (findPercentileHigherBetter(hr, allHrPct) / 100) * 60);
  const eTrueCon = Math.round(20 + (findPercentileHigherBetter(avg, allAvg) / 100) * 60);

  console.log(`  ${rating.toString().padStart(4)}   ${eTrueEye.toString().padStart(3)}    ${eTrueAvK.toString().padStart(3)}     ${eTruePow.toString().padStart(3)}    ${eTrueCon.toString().padStart(3)}`);
}
