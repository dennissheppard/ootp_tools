import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csv = fs.readFileSync(path.join(__dirname, '..', 'ootp_hitter_data_20260201.csv'), 'utf-8');
const lines = csv.trim().split('\n');

const data = lines.slice(1).map(line => {
  const cells = line.split(',');
  const contact = parseInt(cells[2]);
  const pa = parseInt(cells[6]);
  const hits = parseInt(cells[8]);
  const bb = parseInt(cells[12]);
  const ab = pa - bb;
  const avg = hits / ab;
  return { contact, avg };
});

// Linear regression: AVG = intercept + slope * contact
const n = data.length;
const sumX = data.reduce((a, d) => a + d.contact, 0);
const sumY = data.reduce((a, d) => a + d.avg, 0);
const sumXY = data.reduce((a, d) => a + d.contact * d.avg, 0);
const sumX2 = data.reduce((a, d) => a + d.contact * d.contact, 0);

const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
const intercept = (sumY - slope * sumX) / n;

console.log('Contact -> AVG Linear Regression:');
console.log(`AVG = ${intercept.toFixed(6)} + ${slope.toFixed(8)} * contact`);
console.log('');
console.log(`At rating 20: ${(intercept + slope * 20).toFixed(3)}`);
console.log(`At rating 50: ${(intercept + slope * 50).toFixed(3)}`);
console.log(`At rating 80: ${(intercept + slope * 80).toFixed(3)}`);
console.log('');
console.log('Suggested code:');
console.log(`contact: { intercept: ${intercept.toFixed(6)}, slope: ${slope.toFixed(8)} }`);
