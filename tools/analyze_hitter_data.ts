/**
 * Analyze the Hit Tool → AVG correlation from OOTP test data
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, '..', 'ootp_hitter_data_20260201.csv');
const csv = fs.readFileSync(dataPath, 'utf-8');
const lines = csv.trim().split('\n');

// Parse data
interface Row {
  babipRating: number;
  avoidKRating: number;
  eyeRating: number;
  powerRating: number;
  pa: number;
  hits: number;
  bb: number;
  ks: number;
  hr: number;
  ab: number;
  avg: number;
  bbPct: number;
  kPct: number;
  hrPct: number;
}

const data: Row[] = lines.slice(1).map(line => {
  const cells = line.split(',');
  const babipRating = parseInt(cells[0]);
  const avoidKRating = parseInt(cells[1]);
  const eyeRating = parseInt(cells[5]);
  const powerRating = parseInt(cells[4]);
  const pa = parseInt(cells[6]);
  const hits = parseInt(cells[8]);
  const bb = parseInt(cells[12]);
  const ks = parseInt(cells[13]);
  const hr = parseInt(cells[11]);
  const ab = pa - bb; // Simplified: AB ≈ PA - BB
  const avg = hits / ab;
  const bbPct = (bb / pa) * 100;
  const kPct = (ks / pa) * 100;
  const hrPct = (hr / pa) * 100;
  return { babipRating, avoidKRating, eyeRating, powerRating, pa, hits, bb, ks, hr, ab, avg, bbPct, kPct, hrPct };
});

function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) return 0;
  return numerator / denominator;
}

console.log('='.repeat(70));
console.log('OOTP HITTER DATA ANALYSIS');
console.log('='.repeat(70));
console.log(`Sample size: ${data.length} rows`);

// Analyze Hit Tool (BABIP rating) → AVG
console.log('\n--- Hit Tool Rating → Batting Average ---');
const byBabipRating = new Map<number, Row[]>();
for (const d of data) {
  if (!byBabipRating.has(d.babipRating)) byBabipRating.set(d.babipRating, []);
  byBabipRating.get(d.babipRating)!.push(d);
}

console.log('\nRating | N | Avg AVG | Min AVG | Max AVG');
console.log('-------|---|---------|---------|--------');

const babipRatings = [...byBabipRating.keys()].sort((a, b) => a - b);
for (const rating of babipRatings) {
  const rows = byBabipRating.get(rating)!;
  const avgs = rows.map(r => r.avg);
  const avgOfAvg = avgs.reduce((a, b) => a + b, 0) / avgs.length;
  const minAvg = Math.min(...avgs);
  const maxAvg = Math.max(...avgs);
  console.log(`${rating.toString().padStart(6)} | ${rows.length} | ${avgOfAvg.toFixed(3).padStart(7)} | ${minAvg.toFixed(3).padStart(7)} | ${maxAvg.toFixed(3).padStart(7)}`);
}

const babipCorr = calculateCorrelation(data.map(d => d.babipRating), data.map(d => d.avg));
console.log(`\nCorrelation (BABIP rating → AVG): r = ${babipCorr.toFixed(4)}, r² = ${(babipCorr * babipCorr).toFixed(4)}`);

// Analyze Eye Rating → BB%
console.log('\n--- Eye Rating → BB% ---');
const byEyeRating = new Map<number, Row[]>();
for (const d of data) {
  if (!byEyeRating.has(d.eyeRating)) byEyeRating.set(d.eyeRating, []);
  byEyeRating.get(d.eyeRating)!.push(d);
}

console.log('\nRating | N | Avg BB% | Min BB% | Max BB%');
console.log('-------|---|---------|---------|--------');

const eyeRatings = [...byEyeRating.keys()].sort((a, b) => a - b);
for (const rating of eyeRatings) {
  const rows = byEyeRating.get(rating)!;
  const bbPcts = rows.map(r => r.bbPct);
  const avgBb = bbPcts.reduce((a, b) => a + b, 0) / bbPcts.length;
  const minBb = Math.min(...bbPcts);
  const maxBb = Math.max(...bbPcts);
  console.log(`${rating.toString().padStart(6)} | ${rows.length} | ${avgBb.toFixed(2).padStart(6)}% | ${minBb.toFixed(2).padStart(6)}% | ${maxBb.toFixed(2).padStart(6)}%`);
}

const eyeCorr = calculateCorrelation(data.map(d => d.eyeRating), data.map(d => d.bbPct));
console.log(`\nCorrelation (Eye rating → BB%): r = ${eyeCorr.toFixed(4)}, r² = ${(eyeCorr * eyeCorr).toFixed(4)}`);

// Analyze AvoidK Rating → K%
console.log('\n--- AvoidK Rating → K% ---');
const byAvoidKRating = new Map<number, Row[]>();
for (const d of data) {
  if (!byAvoidKRating.has(d.avoidKRating)) byAvoidKRating.set(d.avoidKRating, []);
  byAvoidKRating.get(d.avoidKRating)!.push(d);
}

console.log('\nRating | N | Avg K%  | Min K%  | Max K%');
console.log('-------|---|---------|---------|--------');

const avoidKRatings = [...byAvoidKRating.keys()].sort((a, b) => a - b);
for (const rating of avoidKRatings) {
  const rows = byAvoidKRating.get(rating)!;
  const kPcts = rows.map(r => r.kPct);
  const avgK = kPcts.reduce((a, b) => a + b, 0) / kPcts.length;
  const minK = Math.min(...kPcts);
  const maxK = Math.max(...kPcts);
  console.log(`${rating.toString().padStart(6)} | ${rows.length} | ${avgK.toFixed(2).padStart(6)}% | ${minK.toFixed(2).padStart(6)}% | ${maxK.toFixed(2).padStart(6)}%`);
}

const avoidKCorr = calculateCorrelation(data.map(d => d.avoidKRating), data.map(d => d.kPct));
console.log(`\nCorrelation (AvoidK rating → K%): r = ${avoidKCorr.toFixed(4)}, r² = ${(avoidKCorr * avoidKCorr).toFixed(4)}`);

// Analyze Power Rating → HR%
console.log('\n--- Power Rating → HR% ---');
const byPowerRating = new Map<number, Row[]>();
for (const d of data) {
  if (!byPowerRating.has(d.powerRating)) byPowerRating.set(d.powerRating, []);
  byPowerRating.get(d.powerRating)!.push(d);
}

console.log('\nRating | N | Avg HR% | Min HR% | Max HR%');
console.log('-------|---|---------|---------|--------');

const powerRatings = [...byPowerRating.keys()].sort((a, b) => a - b);
for (const rating of powerRatings) {
  const rows = byPowerRating.get(rating)!;
  const hrPcts = rows.map(r => r.hrPct);
  const avgHr = hrPcts.reduce((a, b) => a + b, 0) / hrPcts.length;
  const minHr = Math.min(...hrPcts);
  const maxHr = Math.max(...hrPcts);
  console.log(`${rating.toString().padStart(6)} | ${rows.length} | ${avgHr.toFixed(2).padStart(6)}% | ${minHr.toFixed(2).padStart(6)}% | ${maxHr.toFixed(2).padStart(6)}%`);
}

const powerCorr = calculateCorrelation(data.map(d => d.powerRating), data.map(d => d.hrPct));
console.log(`\nCorrelation (Power rating → HR%): r = ${powerCorr.toFixed(4)}, r² = ${(powerCorr * powerCorr).toFixed(4)}`);

// Summary
console.log('\n' + '='.repeat(70));
console.log('SUMMARY: Rating → Stat Correlations (from OOTP test data)');
console.log('='.repeat(70));
console.log(`\n| Rating    | Stat | Correlation | r²    | Sample |`);
console.log(`|-----------|------|-------------|-------|--------|`);
console.log(`| Hit Tool  | AVG  | ${babipCorr.toFixed(4).padStart(11)} | ${(babipCorr*babipCorr).toFixed(4)} | ${data.length.toString().padStart(6)} |`);
console.log(`| Eye       | BB%  | ${eyeCorr.toFixed(4).padStart(11)} | ${(eyeCorr*eyeCorr).toFixed(4)} | ${data.length.toString().padStart(6)} |`);
console.log(`| AvoidK    | K%   | ${avoidKCorr.toFixed(4).padStart(11)} | ${(avoidKCorr*avoidKCorr).toFixed(4)} | ${data.length.toString().padStart(6)} |`);
console.log(`| Power     | HR%  | ${powerCorr.toFixed(4).padStart(11)} | ${(powerCorr*powerCorr).toFixed(4)} | ${data.length.toString().padStart(6)} |`);

console.log('\nNote: AvoidK correlation is negative because higher rating = lower K%');

// Additional analysis: Contact vs Hit Tool for AVG prediction
console.log('\n' + '='.repeat(70));
console.log('CONTACT vs HIT TOOL for AVG Prediction');
console.log('='.repeat(70));

// Contact rating is in the data
const contactCorr = calculateCorrelation(data.map(d => d.babipRating), data.map(d => d.avg));
const contactRatingCorr = calculateCorrelation(
  data.map(d => {
    const cells = lines[data.indexOf(d) + 1].split(',');
    return parseInt(cells[2]); // contact column
  }),
  data.map(d => d.avg)
);

// Also try (BABIP + AvoidK) / 2 as a proxy
const compositeCorr = calculateCorrelation(
  data.map(d => (d.babipRating + d.avoidKRating) / 2),
  data.map(d => d.avg)
);

// And weighted versions
const weighted60_40 = calculateCorrelation(
  data.map(d => d.babipRating * 0.6 + d.avoidKRating * 0.4),
  data.map(d => d.avg)
);

const weighted70_30 = calculateCorrelation(
  data.map(d => d.babipRating * 0.7 + d.avoidKRating * 0.3),
  data.map(d => d.avg)
);

const weighted80_20 = calculateCorrelation(
  data.map(d => d.babipRating * 0.8 + d.avoidKRating * 0.2),
  data.map(d => d.avg)
);

console.log('\n| Predictor | r | r² |');
console.log('|-----------|------|------|');
console.log(`| Hit Tool only | ${contactCorr.toFixed(4)} | ${(contactCorr*contactCorr).toFixed(4)} |`);
console.log(`| Contact rating | ${contactRatingCorr.toFixed(4)} | ${(contactRatingCorr*contactRatingCorr).toFixed(4)} |`);
console.log(`| (BABIP + AvoidK) / 2 | ${compositeCorr.toFixed(4)} | ${(compositeCorr*compositeCorr).toFixed(4)} |`);
console.log(`| 60% BABIP + 40% AvoidK | ${weighted60_40.toFixed(4)} | ${(weighted60_40*weighted60_40).toFixed(4)} |`);
console.log(`| 70% BABIP + 30% AvoidK | ${weighted70_30.toFixed(4)} | ${(weighted70_30*weighted70_30).toFixed(4)} |`);
console.log(`| 80% BABIP + 20% AvoidK | ${weighted80_20.toFixed(4)} | ${(weighted80_20*weighted80_20).toFixed(4)} |`);

// Try to reverse-engineer Contact formula
console.log('\n--- Attempting to reverse-engineer Contact formula ---');
const contactData = data.map((d, i) => {
  const cells = lines[i + 1].split(',');
  const contact = parseInt(cells[2]);
  return { babip: d.babipRating, avoidK: d.avoidKRating, contact };
});

// Check if Contact = (BABIP + AvoidK) / 2 (rounded)
let simpleAvgMatches = 0;
let weighted6040Matches = 0;
for (const cd of contactData) {
  const simpleAvg = Math.round((cd.babip + cd.avoidK) / 2);
  const w6040 = Math.round(cd.babip * 0.6 + cd.avoidK * 0.4);
  if (simpleAvg === cd.contact) simpleAvgMatches++;
  if (w6040 === cd.contact) weighted6040Matches++;
}

console.log(`Simple average (BABIP+AvoidK)/2 matches: ${simpleAvgMatches}/${contactData.length} (${(simpleAvgMatches/contactData.length*100).toFixed(1)}%)`);
console.log(`60/40 weighted matches: ${weighted6040Matches}/${contactData.length} (${(weighted6040Matches/contactData.length*100).toFixed(1)}%)`);

// Show some examples where formula doesn't match
console.log('\nExamples of Contact calculation:');
console.log('BABIP | AvoidK | Contact | (B+A)/2 | Diff');
console.log('------|--------|---------|---------|-----');
const uniqueCombos = new Map<string, typeof contactData[0]>();
for (const cd of contactData) {
  const key = `${cd.babip}-${cd.avoidK}`;
  if (!uniqueCombos.has(key)) uniqueCombos.set(key, cd);
}
const sortedCombos = [...uniqueCombos.values()].sort((a, b) => a.babip - b.babip || a.avoidK - b.avoidK).slice(0, 20);
for (const cd of sortedCombos) {
  const calc = Math.round((cd.babip + cd.avoidK) / 2);
  const diff = cd.contact - calc;
  console.log(`${cd.babip.toString().padStart(5)} | ${cd.avoidK.toString().padStart(6)} | ${cd.contact.toString().padStart(7)} | ${calc.toString().padStart(7)} | ${diff >= 0 ? '+' : ''}${diff}`);
}
