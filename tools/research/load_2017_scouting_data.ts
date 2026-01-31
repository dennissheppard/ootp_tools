/**
 * Load 2017 Scouting Data
 *
 * Validates and parses the 2017_scouting_ratings.csv and 2017_OSA_ratings.csv files
 * from public/data. Outputs parsed JSON for browser upload.
 *
 * Usage: npx ts-node tools/research/load_2017_scouting_data.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface PitcherScoutingRatings {
  playerId: number;
  playerName?: string;
  stuff: number;
  control: number;
  hra: number;
  stamina?: number;
  injuryProneness?: string;
  age?: number;
  ovr?: number;
  pot?: number;
  pitches?: Record<string, number>;
  source: 'my' | 'osa';
}

// Simple CSV parser (replicates ScoutingDataService logic)
function parseScoutingCsv(csvText: string, source: 'my' | 'osa'): PitcherScoutingRatings[] {
  const lines = csvText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  const headerCells = parseCsvLine(lines[0]);
  const { indexMap, pitchIndexMap } = buildHeaderMap(headerCells);
  const dataLines = lines.slice(1);

  const results: PitcherScoutingRatings[] = [];

  for (const line of dataLines) {
    const cells = parseCsvLine(line);
    if (cells.length === 0) continue;

    const stuff = getNumberFromIndex(cells, indexMap.stuff);
    const control = getNumberFromIndex(cells, indexMap.control);
    const hra = getNumberFromIndex(cells, indexMap.hra);

    if (!isNumber(stuff) || !isNumber(control) || !isNumber(hra)) {
      continue;
    }

    const rawId = getNumberFromIndex(cells, indexMap.playerId);
    const playerId = isNumber(rawId) ? Math.round(rawId) : -1;
    const playerName = getStringFromIndex(cells, indexMap.playerName);
    const age = getNumberFromIndex(cells, indexMap.age);
    const stamina = getNumberFromIndex(cells, indexMap.stamina);
    const injuryProneness = getStringFromIndex(cells, indexMap.injuryProneness);
    const ovr = parseStarRating(cells, indexMap.ovr);
    const pot = parseStarRating(cells, indexMap.pot);

    const pitches: Record<string, number> = {};
    for (const [pitchName, idx] of Object.entries(pitchIndexMap)) {
      const val = getNumberFromIndex(cells, idx);
      if (isNumber(val) && val > 0) {
        pitches[pitchName] = val;
      }
    }

    results.push({
      playerId,
      playerName: playerName || undefined,
      stuff,
      control,
      hra,
      stamina: isNumber(stamina) ? stamina : undefined,
      injuryProneness: injuryProneness || undefined,
      age: isNumber(age) ? Math.round(age) : undefined,
      ovr: isNumber(ovr) ? ovr : undefined,
      pot: isNumber(pot) ? pot : undefined,
      pitches: Object.keys(pitches).length > 0 ? pitches : undefined,
      source,
    });
  }

  return results;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function buildHeaderMap(headerCells: string[]): {
  indexMap: Partial<Record<string, number>>;
  pitchIndexMap: Record<string, number>;
} {
  const normalized = headerCells.map(cell => cell.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const indexMap: Partial<Record<string, number>> = {};
  const pitchIndexMap: Record<string, number> = {};

  const headerAliases: Record<string, string[]> = {
    playerId: ['playerid', 'player_id', 'id', 'pid'],
    playerName: ['playername', 'player_name', 'name', 'player'],
    stuff: ['stuff', 'stu', 'stf', 'stup', 'stfp', 'stuffp'],
    control: ['control', 'con', 'ctl', 'conp', 'controlp'],
    hra: ['hra', 'hr', 'hrr', 'hravoid', 'hravoidance', 'hrrp', 'hrp'],
    age: ['age'],
    ovr: ['ovr', 'overall', 'cur', 'current'],
    pot: ['pot', 'potential', 'ceil', 'ceiling'],
    stamina: ['stm', 'stamina', 'stam'],
    injuryProneness: ['prone', 'injury', 'injuryproneness', 'inj', 'sctacc']
  };

  for (const [key, aliases] of Object.entries(headerAliases)) {
    const idx = normalized.findIndex(h => aliases.includes(h));
    if (idx !== -1) {
      indexMap[key] = idx;
    }
  }

  const usedIndices = new Set(Object.values(indexMap));
  const ignoreHeaders = new Set([
    'team', 'pos', 'position', 'height', 'weight', 'bats', 'throws', 'dob',
    'velocity', 'arm', 'hold', 'gb', 'mov', 'movement', 'babip'
  ]);

  headerCells.forEach((rawHeader, idx) => {
    if (usedIndices.has(idx)) return;
    const norm = normalized[idx];
    if (!norm || ignoreHeaders.has(norm)) return;
    pitchIndexMap[rawHeader.trim()] = idx;
  });

  return { indexMap, pitchIndexMap };
}

function getNumberFromIndex(cells: string[], index?: number): number | null {
  if (typeof index !== 'number') return null;
  const value = cells[index] || '';
  if (value === '-' || value === '') return null;
  const num = parseFloat(value);
  return isNaN(num) ? null : num;
}

function getStringFromIndex(cells: string[], index?: number): string {
  if (typeof index !== 'number') return '';
  return cells[index] || '';
}

function parseStarRating(cells: string[], index?: number): number | null {
  if (typeof index !== 'number') return null;
  const raw = cells[index] || '';
  const stripped = raw.toLowerCase().replace(/\s*stars?\s*/gi, '').trim();
  const num = parseFloat(stripped);
  if (isNaN(num) || num < 0.5 || num > 5.0) return null;
  return num;
}

function isNumber(value: number | null): value is number {
  return typeof value === 'number' && isFinite(value);
}

async function loadScoutingData() {
  console.log('='.repeat(60));
  console.log('Loading 2017 Scouting Data');
  console.log('='.repeat(60));
  console.log();

  const publicDataDir = path.join(__dirname, '../../public/data');
  const myScoutFile = path.join(publicDataDir, '2017_scouting_ratings.csv');
  const osaFile = path.join(publicDataDir, '2017_OSA_ratings.csv');

  // Check files exist
  if (!fs.existsSync(myScoutFile)) {
    console.error(`❌ File not found: ${myScoutFile}`);
    return;
  }
  if (!fs.existsSync(osaFile)) {
    console.error(`❌ File not found: ${osaFile}`);
    return;
  }

  console.log('📂 Found data files:');
  console.log(`   - ${path.basename(myScoutFile)}`);
  console.log(`   - ${path.basename(osaFile)}`);
  console.log();

  // Load and parse My Scout data
  console.log('📋 Loading My Scout ratings...');
  const myScoutCsv = fs.readFileSync(myScoutFile, 'utf-8');
  const myScoutRatings = parseScoutingCsv(myScoutCsv, 'my');

  console.log(`   ✅ Parsed ${myScoutRatings.length} My Scout ratings`);

  // Sample validation
  if (myScoutRatings.length > 0) {
    const sample = myScoutRatings[0];
    console.log('   Sample entry:');
    console.log(`      ID: ${sample.playerId}`);
    console.log(`      Name: ${sample.playerName}`);
    console.log(`      Age: ${sample.age}`);
    console.log(`      OVR: ${sample.ovr} | POT: ${sample.pot}`);
    console.log(`      Stuff: ${sample.stuff} | Control: ${sample.control} | HRA: ${sample.hra}`);
    console.log(`      Stamina: ${sample.stamina}`);
    if (sample.pitches) {
      console.log(`      Pitches: ${Object.keys(sample.pitches).join(', ')}`);
    }
  }
  console.log();

  // Load and parse OSA data
  console.log('📋 Loading OSA ratings...');
  const osaCsv = fs.readFileSync(osaFile, 'utf-8');
  const osaRatings = parseScoutingCsv(osaCsv, 'osa');

  console.log(`   ✅ Parsed ${osaRatings.length} OSA ratings`);

  if (osaRatings.length > 0) {
    const sample = osaRatings[0];
    console.log('   Sample entry:');
    console.log(`      ID: ${sample.playerId}`);
    console.log(`      Name: ${sample.playerName}`);
    console.log(`      Age: ${sample.age}`);
    console.log(`      OVR: ${sample.ovr} | POT: ${sample.pot}`);
    console.log(`      Stuff: ${sample.stuff} | Control: ${sample.control} | HRA: ${sample.hra}`);
  }
  console.log();

  // Analyze overlap
  const myScoutIds = new Set(myScoutRatings.map(r => r.playerId).filter(id => id > 0));
  const osaIds = new Set(osaRatings.map(r => r.playerId).filter(id => id > 0));
  const overlap = Array.from(myScoutIds).filter(id => osaIds.has(id));

  console.log('📊 Data overlap analysis:');
  console.log(`   My Scout players: ${myScoutIds.size}`);
  console.log(`   OSA players: ${osaIds.size}`);
  console.log(`   Players in both: ${overlap.length}`);
  console.log(`   My Scout only: ${myScoutIds.size - overlap.length}`);
  console.log(`   OSA only: ${osaIds.size - overlap.length}`);
  console.log();

  // Scouting accuracy field analysis
  const scoutAccCounts = myScoutRatings.reduce((acc, r) => {
    if (r.injuryProneness) {
      acc[r.injuryProneness] = (acc[r.injuryProneness] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  console.log('📊 Scout Accuracy distribution (My Scout):');
  Object.entries(scoutAccCounts)
    .sort(([, a], [, b]) => b - a)
    .forEach(([accuracy, count]) => {
      console.log(`   ${accuracy}: ${count} players`);
    });
  console.log();

  // Save instructions
  console.log('='.repeat(60));
  console.log('✅ Data parsing complete!');
  console.log('='.repeat(60));
  console.log();
  console.log('📝 Next steps:');
  console.log('   1. Open the app in browser');
  console.log('   2. Go to Data Management view');
  console.log('   3. Upload these files:');
  console.log(`      - 2017_scouting_ratings.csv as "My Scout" for date 2017-01-01`);
  console.log(`      - 2017_OSA_ratings.csv as "OSA" for date 2017-01-01`);
  console.log('   4. Verify upload in browser console');
  console.log();
  console.log('Or use browser console:');
  console.log('```javascript');
  console.log('// Load and save manually via browser console');
  console.log('const response = await fetch("/data/2017_scouting_ratings.csv");');
  console.log('const csvText = await response.text();');
  console.log('const ratings = scoutingDataService.parseScoutingCsv(csvText, "my");');
  console.log('await scoutingDataService.saveScoutingRatings("2017-01-01", ratings, "my");');
  console.log('console.log(`Saved ${ratings.length} My Scout ratings`);');
  console.log('```');
  console.log();

  // Save parsed data to JSON for easy upload
  const outputDir = path.join(__dirname, '../reports');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const myScoutOutput = path.join(outputDir, '2017_scouting_my_parsed.json');
  const osaOutput = path.join(outputDir, '2017_scouting_osa_parsed.json');

  fs.writeFileSync(myScoutOutput, JSON.stringify(myScoutRatings, null, 2));
  fs.writeFileSync(osaOutput, JSON.stringify(osaRatings, null, 2));

  console.log('💾 Saved parsed data to:');
  console.log(`   - ${path.basename(myScoutOutput)}`);
  console.log(`   - ${path.basename(osaOutput)}`);
  console.log();
  console.log('   These can be imported via browser console if needed.');
  console.log();
}

loadScoutingData().catch(error => {
  console.error('❌ Error loading scouting data:', error);
  process.exit(1);
});
