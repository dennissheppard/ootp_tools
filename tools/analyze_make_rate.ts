import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'public', 'data');

function parseCsvRows(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/);
  return lines.map(l => l.split(','));
}

const scoutingPath = path.join(DATA_DIR, 'hitter_scouting_my_2021_05_31.csv');
const scoutingRows = parseCsvRows(fs.readFileSync(scoutingPath, 'utf-8'));
const scoutingHeader = scoutingRows[0];
const scoutingData = scoutingRows.slice(1);

const colIdx = (name: string) => scoutingHeader.indexOf(name);
const ID_COL = colIdx('ID');
const DOB_COL = colIdx('DOB');
const EYE_COL = colIdx('EYE P');
const LEV_COL = colIdx('Lev');
const NAME_COL = colIdx('Name');

console.log('Scouting file loaded: ' + scoutingData.length + ' rows');

const careerAB = new Map<number, number>();
const careerPA = new Map<number, number>();

for (let year = 2000; year <= 2021; year++) {
  const filePath = path.join(DATA_DIR, 'mlb_batting', year + '_batting.csv');
  if (!fs.existsSync(filePath)) continue;
  const rows = parseCsvRows(fs.readFileSync(filePath, 'utf-8'));
  const header = rows[0];
  const pidIdx = header.indexOf('player_id');
  const splitIdx = header.indexOf('split_id');
  const abIdx = header.indexOf('ab');
  const paIdx = header.indexOf('pa');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row[splitIdx] !== '1') continue;
    const pid = parseInt(row[pidIdx], 10);
    const ab = parseInt(row[abIdx], 10) || 0;
    const pa = parseInt(row[paIdx], 10) || 0;
    careerAB.set(pid, (careerAB.get(pid) || 0) + ab);
    careerPA.set(pid, (careerPA.get(pid) || 0) + pa);
  }
}

console.log('MLB batting data loaded: ' + careerAB.size + ' unique player_ids across 2000-2021\n');

interface Prospect {
  id: number;
  name: string;
  dob: string;
  age: number;
  eye: number;
  level: string;
  careerMLB_AB: number;
  careerMLB_PA: number;
}

const refDate = new Date(2021, 3, 1);

function calcAge(dobStr: string): number {
  const parts = dobStr.split('/');
  const month = parseInt(parts[0], 10) - 1;
  const day = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);
  const dob = new Date(year, month, day);
  let age = refDate.getFullYear() - dob.getFullYear();
  const monthDiff = refDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && refDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

const prospects: Prospect[] = [];

for (const row of scoutingData) {
  const id = parseInt(row[ID_COL], 10);
  const mlbAB = careerAB.get(id) || 0;
  if (mlbAB <= 130) {
    const eye = parseInt(row[EYE_COL], 10) || 0;
    const age = calcAge(row[DOB_COL]);
    prospects.push({
      id,
      name: row[NAME_COL],
      dob: row[DOB_COL],
      age,
      eye,
      level: row[LEV_COL],
      careerMLB_AB: mlbAB,
      careerMLB_PA: careerPA.get(id) || 0,
    });
  }
}

console.log('=== PROSPECT POOL (career MLB AB <= 130) ===');
console.log('Total prospects: ' + prospects.length + '\n');

const withAnyMLB = prospects.filter(p => p.careerMLB_AB > 0);
console.log('=== MLB MAKE RATE ===');
console.log('Any MLB AB (>=1):   ' + withAnyMLB.length + '  (' + (100 * withAnyMLB.length / prospects.length).toFixed(1) + '%)');

const thresholds = [1, 50, 130, 300];
for (const t of thresholds) {
  const label = t === 300 ? t + '+ PA' : t + '+ AB';
  const count = prospects.filter(p => (t === 300 ? p.careerMLB_PA : p.careerMLB_AB) >= t).length;
  console.log(label.padEnd(18) + String(count).padStart(5) + '  (' + (100 * count / prospects.length).toFixed(1) + '%)');
}

console.log('\n=== MAKE RATE BY AGE GROUP (age as of April 1, 2021) ===');

interface AgeGroup { label: string; min: number; max: number; }
const ageGroups: AgeGroup[] = [
  { label: '<=19', min: 0, max: 19 },
  { label: '20-22', min: 20, max: 22 },
  { label: '23-25', min: 23, max: 25 },
  { label: '26-28', min: 26, max: 28 },
  { label: '29+', min: 29, max: 99 },
];

console.log('Age'.padEnd(8) + 'Total'.padStart(6) + 'Any AB'.padStart(7) + 'Rate'.padStart(7) + '50+ AB'.padStart(7) + '130+AB'.padStart(7) + '300+PA'.padStart(7));
console.log('-'.repeat(55));

for (const ag of ageGroups) {
  const group = prospects.filter(p => p.age >= ag.min && p.age <= ag.max);
  const anyAB = group.filter(p => p.careerMLB_AB > 0).length;
  const ab50 = group.filter(p => p.careerMLB_AB >= 50).length;
  const ab130 = group.filter(p => p.careerMLB_AB >= 130).length;
  const pa300 = group.filter(p => p.careerMLB_PA >= 300).length;
  const rate = group.length > 0 ? (100 * anyAB / group.length).toFixed(1) : 'N/A';
  console.log(
    ag.label.padEnd(8) + String(group.length).padStart(6) + String(anyAB).padStart(7) + (rate + '%').padStart(7) + String(ab50).padStart(7) + String(ab130).padStart(7) + String(pa300).padStart(7)
  );
}

console.log('\n=== EYE RATING DISTRIBUTION (all ' + prospects.length + ' prospects) ===');

const eyeBuckets = [
  { label: '20-29', min: 20, max: 29 },
  { label: '30-39', min: 30, max: 39 },
  { label: '40-49', min: 40, max: 49 },
  { label: '50-59', min: 50, max: 59 },
  { label: '60-69', min: 60, max: 69 },
  { label: '70-80', min: 70, max: 80 },
];

for (const bucket of eyeBuckets) {
  const count = prospects.filter(p => p.eye >= bucket.min && p.eye <= bucket.max).length;
  const bar = '#'.repeat(Math.round(count / 20));
  console.log('  Eye ' + bucket.label + ': ' + String(count).padStart(5) + '  ' + bar);
}

const eyes = prospects.map(p => p.eye).sort((a, b) => a - b);
const meanEye = eyes.reduce((s, v) => s + v, 0) / eyes.length;
const medianEye = eyes.length % 2 === 0
  ? (eyes[eyes.length / 2 - 1] + eyes[eyes.length / 2]) / 2
  : eyes[Math.floor(eyes.length / 2)];

console.log('\n  Mean Eye:   ' + meanEye.toFixed(1));
console.log('  Median Eye: ' + medianEye);
console.log('  Min Eye:    ' + eyes[0]);
console.log('  Max Eye:    ' + eyes[eyes.length - 1]);

console.log('\n=== MAKE RATE BY EYE RATING ===');
console.log('Eye'.padEnd(10) + 'Total'.padStart(6) + 'Any AB'.padStart(7) + 'Rate'.padStart(7) + '130+AB'.padStart(7));
console.log('-'.repeat(40));

for (const bucket of eyeBuckets) {
  const group = prospects.filter(p => p.eye >= bucket.min && p.eye <= bucket.max);
  const anyAB = group.filter(p => p.careerMLB_AB > 0).length;
  const ab130 = group.filter(p => p.careerMLB_AB >= 130).length;
  const rate = group.length > 0 ? (100 * anyAB / group.length).toFixed(1) : 'N/A';
  console.log(
    bucket.label.padEnd(10) + String(group.length).padStart(6) + String(anyAB).padStart(7) + (rate + '%').padStart(7) + String(ab130).padStart(7)
  );
}
