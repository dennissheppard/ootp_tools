/**
 * migrate-to-supabase.ts
 *
 * One-time migration script that imports all CSV data from public/data/ into
 * Supabase PostgreSQL tables. Run with:
 *
 *   npx tsx tools/migrate-to-supabase.ts
 *
 * Required env vars (set in .env or export):
 *   SUPABASE_URL          — e.g. https://xxx.supabase.co
 *   SUPABASE_SERVICE_KEY  — service_role key (full write access)
 *
 * Steps:
 *   1. Import DOBs from 5 DOB CSVs → players table (id + dob only)
 *   2. Import MLB pitching stats (2000-2020)
 *   3. Import MLB batting stats (2000-2020)
 *   4. Import minor league pitching stats (all years/levels)
 *   5. Import minor league batting stats (all years/levels)
 *   6. Import pitcher scouting (default OSA + dated files)
 *   7. Import hitter scouting (default OSA + dated files)
 *   8. Populate data_version table
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  supabasePost,
  supabaseUpsertBatches,
  parseCsvLine as sharedParseCsvLine,
  toIntOrNull,
  toFloatOrNull,
} from './lib/supabase-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ──────────────────────────────────────────────
// CSV parsing (minimal, node-only)
// ──────────────────────────────────────────────

// Use shared parseCsvLine as the local name for compat with parseCsvFile below
const parseCsvLine = sharedParseCsvLine;

function parseCsvFile(filePath: string): { headers: string[]; rows: string[][] } {
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^\ufeff/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  const rows = lines.slice(1).map(l => parseCsvLine(l));
  return { headers, rows };
}

// ──────────────────────────────────────────────
// Step 1: Import DOBs → players table
// ──────────────────────────────────────────────

async function importDOBs() {
  console.log('\n=== Step 1: Import Player DOBs ===');
  const dobFiles = ['mlb_dob.csv', 'aaa_dob.csv', 'aa_dob.csv', 'a_dob.csv', 'rookie_dob.csv'];
  const dobMap = new Map<number, string>(); // id → ISO date

  for (const file of dobFiles) {
    const filePath = path.join(DATA_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  Skipping ${file} (not found)`);
      continue;
    }

    const { headers, rows } = parseCsvFile(filePath);
    const idIdx = headers.indexOf('id');
    const dobIdx = headers.indexOf('dob');
    if (idIdx === -1 || dobIdx === -1) {
      console.warn(`  ${file}: missing ID or DOB column`);
      continue;
    }

    for (const row of rows) {
      const id = toIntOrNull(row[idIdx]);
      const dobStr = row[dobIdx]?.trim();
      if (!id || !dobStr) continue;

      // Parse MM/DD/YYYY → ISO date
      const parts = dobStr.split('/');
      if (parts.length !== 3) continue;
      const [month, day, year] = parts.map(s => parseInt(s, 10));
      if (!month || !day || !year) continue;

      const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (!dobMap.has(id)) {
        dobMap.set(id, isoDate);
      }
    }

    console.log(`  Parsed ${file}: ${rows.length} entries`);
  }

  // Upsert players with DOB only (other fields populated later or via API)
  const playerRows = Array.from(dobMap.entries()).map(([id, dob]) => ({
    id,
    dob,
  }));

  console.log(`  Upserting ${playerRows.length} players with DOBs...`);
  await supabaseUpsertBatches('players', playerRows);
  console.log(`  Done: ${playerRows.length} DOBs imported`);
}

// ──────────────────────────────────────────────
// Step 2-3: Import pitching/batting stats
// ──────────────────────────────────────────────

const PITCHING_COLS = [
  'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
  'ip', 'ab', 'tb', 'ha', 'k', 'bf', 'rs', 'bb', 'r', 'er', 'gb', 'fb', 'pi', 'ipf',
  'g', 'gs', 'w', 'l', 's', 'sa', 'da', 'sh', 'sf', 'ta', 'hra', 'bk', 'ci', 'iw',
  'wp', 'hp', 'gf', 'dp', 'qs', 'svo', 'bs', 'ra', 'cg', 'sho', 'sb', 'cs', 'hld',
  'ir', 'irs', 'wpa', 'li', 'stint', 'outs', 'sd', 'md', 'war', 'ra9war'
];

const BATTING_COLS = [
  'id', 'player_id', 'year', 'team_id', 'game_id', 'league_id', 'level_id', 'split_id',
  'position', 'ab', 'h', 'k', 'pa', 'pitches_seen', 'g', 'gs', 'd', 't', 'hr', 'r',
  'rbi', 'sb', 'cs', 'bb', 'ibb', 'gdp', 'sh', 'sf', 'hp', 'ci', 'wpa', 'stint', 'ubr', 'war'
];

// Columns that should remain as strings (not parsed as numbers)
const STRING_COLS = new Set(['ip']);
// Columns that are decimals
const DECIMAL_COLS = new Set(['wpa', 'li', 'war', 'ra9war', 'ubr']);

function parseStatsRow(headers: string[], row: string[], expectedCols: string[]): any | null {
  const obj: any = {};
  for (const col of expectedCols) {
    const idx = headers.indexOf(col);
    if (idx === -1 || idx >= row.length) {
      obj[col] = null;
      continue;
    }
    const val = row[idx]?.trim() ?? '';
    if (STRING_COLS.has(col)) {
      obj[col] = val || null;
    } else if (DECIMAL_COLS.has(col)) {
      obj[col] = toFloatOrNull(val);
    } else {
      obj[col] = toIntOrNull(val);
    }
  }

  // Skip rows without player_id
  if (!obj.player_id) return null;
  return obj;
}

async function importStatsDirectory(
  dir: string,
  table: string,
  columns: string[],
  filenamePattern: RegExp,
  label: string
) {
  console.log(`\n=== Import ${label} ===`);
  const dirPath = path.join(DATA_DIR, dir);
  if (!fs.existsSync(dirPath)) {
    console.log(`  Directory ${dir}/ not found, skipping`);
    return;
  }

  const files = fs.readdirSync(dirPath).filter(f => filenamePattern.test(f)).sort();
  console.log(`  Found ${files.length} files`);

  let totalRows = 0;
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const { headers, rows: csvRows } = parseCsvFile(filePath);

    const parsed = csvRows
      .map(row => parseStatsRow(headers, row, columns))
      .filter(Boolean);

    if (parsed.length === 0) {
      console.log(`  ${file}: 0 valid rows, skipping`);
      continue;
    }

    // Dedup by PK (player_id, year, league_id, split_id) — keep last occurrence
    const seen = new Map<string, any>();
    for (const row of parsed) {
      const key = `${row.player_id}_${row.year}_${row.league_id}_${row.split_id}`;
      seen.set(key, row);
    }
    const deduped = Array.from(seen.values());

    await supabaseUpsertBatches(table, deduped);
    totalRows += parsed.length;
    console.log(`  ${file}: ${parsed.length} rows`);
  }

  console.log(`  Total: ${totalRows} rows imported to ${table}`);
}

// ──────────────────────────────────────────────
// Step 6-7: Import scouting data
// ──────────────────────────────────────────────

function parseStarRating(val: string): number | null {
  if (!val) return null;
  const stripped = val.toLowerCase().replace(/\s*stars?\s*/gi, '').trim();
  const n = parseFloat(stripped);
  if (isNaN(n) || n < 0.5 || n > 5.0) return null;
  return n;
}

function extractDateFromFilename(filename: string): string {
  // Try patterns like "2021_05_31" or "2017_11_2"
  const match = filename.match(/(\d{4})_(\d{1,2})_(\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  // Default date for "default_osa_scouting.csv" files
  return '2021-01-01';
}

function extractSourceFromFilename(filename: string): string {
  if (filename.includes('_osa_') || filename.startsWith('default_osa') || filename.startsWith('default_hitter_osa')) {
    return 'osa';
  }
  if (filename.includes('_my_') || filename.includes('_OSA_')) {
    // "scouting_OSA_hitting" is actually OSA
    return filename.includes('_OSA_') ? 'osa' : 'my';
  }
  return 'my';
}

async function importPitcherScouting() {
  console.log('\n=== Step 6: Import Pitcher Scouting ===');

  const scoutingFiles = fs.readdirSync(DATA_DIR)
    .filter(f => (f.startsWith('pitcher_scouting_') || f === 'default_osa_scouting.csv' || f === '2017_scouting_ratings.csv') && f.endsWith('.csv'));

  console.log(`  Found ${scoutingFiles.length} pitcher scouting files`);

  let totalRows = 0;
  for (const file of scoutingFiles) {
    const filePath = path.join(DATA_DIR, file);
    const { headers, rows: csvRows } = parseCsvFile(filePath);

    const source = extractSourceFromFilename(file);
    const snapshotDate = extractDateFromFilename(file);

    // Build header index map
    const headerIdx = (names: string[]) => {
      for (const n of names) {
        const idx = headers.indexOf(n);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idIdx = headerIdx(['id', 'playerid', 'player_id']);
    const nameIdx = headerIdx(['name', 'playername']);
    const stuffIdx = headerIdx(['stu p', 'stuff', 'stu', 'stf']);
    const controlIdx = headerIdx(['con p', 'control', 'con', 'ctl']);
    const hraIdx = headerIdx(['hrr p', 'hra', 'hr']);
    const ageIdx = headerIdx(['age']);
    const ovrIdx = headerIdx(['ovr', 'overall']);
    const potIdx = headerIdx(['pot', 'potential']);
    const staminaIdx = headerIdx(['stm', 'stamina']);
    const injuryIdx = headerIdx(['prone', 'injury']);
    const typeIdx = headerIdx(['type', 'pitchertype', 'gf']);
    const babipIdx = headerIdx(['pbabip p', 'pbabipp', 'babip']);
    const levIdx = headerIdx(['lev', 'level']);
    const hscIdx = headerIdx(['hsc']);
    const dobIdx = headerIdx(['dob']);

    // Collect pitch type columns
    const pitchCols = ['fbp', 'chp', 'cbp', 'slp', 'sip', 'spp', 'ctp', 'fop', 'ccp', 'scp', 'kcp', 'knp'];
    const pitchIdxMap: Record<string, number> = {};
    for (const pc of pitchCols) {
      const idx = headers.indexOf(pc);
      if (idx !== -1) pitchIdxMap[pc] = idx;
    }

    // Personality columns
    const personalityCols = ['lea', 'loy', 'ad', 'fin', 'we', 'int'];
    const personalityIdxMap: Record<string, number> = {};
    for (const pc of personalityCols) {
      const idx = headers.indexOf(pc);
      if (idx !== -1) personalityIdxMap[pc] = idx;
    }

    const rows: any[] = [];
    for (const csvRow of csvRows) {
      const playerId = toIntOrNull(csvRow[idIdx] ?? '');
      if (!playerId) continue;

      const stuff = toIntOrNull(csvRow[stuffIdx] ?? '');
      const control = toIntOrNull(csvRow[controlIdx] ?? '');
      const hra = toIntOrNull(csvRow[hraIdx] ?? '');
      if (stuff === null || control === null || hra === null) continue;

      // Build raw_data JSONB for variable columns
      const rawData: any = {};

      // Pitches
      const pitches: Record<string, number> = {};
      for (const [name, idx] of Object.entries(pitchIdxMap)) {
        const val = toIntOrNull(csvRow[idx] ?? '');
        if (val !== null && val > 0) pitches[name] = val;
      }
      if (Object.keys(pitches).length > 0) rawData.pitches = pitches;

      // Personality
      for (const [name, idx] of Object.entries(personalityIdxMap)) {
        const val = (csvRow[idx] ?? '').trim().toUpperCase();
        if (val === 'H' || val === 'N' || val === 'L') {
          const keyMap: Record<string, string> = { lea: 'leadership', loy: 'loyalty', ad: 'adaptability', fin: 'greed', we: 'workEthic', int: 'intelligence' };
          rawData[keyMap[name] || name] = val;
        }
      }

      rows.push({
        player_id: playerId,
        source,
        snapshot_date: snapshotDate,
        player_name: nameIdx >= 0 ? (csvRow[nameIdx] ?? '').trim() || null : null,
        stuff,
        control,
        hra,
        age: ageIdx >= 0 ? toIntOrNull(csvRow[ageIdx] ?? '') : null,
        ovr: ovrIdx >= 0 ? parseStarRating(csvRow[ovrIdx] ?? '') : null,
        pot: potIdx >= 0 ? parseStarRating(csvRow[potIdx] ?? '') : null,
        stamina: staminaIdx >= 0 ? toIntOrNull(csvRow[staminaIdx] ?? '') : null,
        injury_proneness: injuryIdx >= 0 ? (csvRow[injuryIdx] ?? '').trim() || null : null,
        lev: levIdx >= 0 ? (csvRow[levIdx] ?? '').trim() || null : null,
        hsc: hscIdx >= 0 ? (csvRow[hscIdx] ?? '').trim() || null : null,
        dob: dobIdx >= 0 ? (csvRow[dobIdx] ?? '').trim() || null : null,
        pitcher_type: typeIdx >= 0 ? (csvRow[typeIdx] ?? '').trim() || null : null,
        babip: babipIdx >= 0 ? (csvRow[babipIdx] ?? '').trim() || null : null,
        raw_data: Object.keys(rawData).length > 0 ? rawData : null,
      });
    }

    if (rows.length > 0) {
      await supabaseUpsertBatches('pitcher_scouting', rows);
      totalRows += rows.length;
      console.log(`  ${file}: ${rows.length} ratings (source=${source}, date=${snapshotDate})`);
    }
  }

  console.log(`  Total: ${totalRows} pitcher scouting records`);
}

async function importHitterScouting() {
  console.log('\n=== Step 7: Import Hitter Scouting ===');

  const scoutingFiles = fs.readdirSync(DATA_DIR)
    .filter(f =>
      (f.startsWith('hitter_scouting_') || f === 'default_hitter_osa_scouting.csv' ||
       f.startsWith('scouting_OSA_hitting') || f.startsWith('scouting_my_hitting'))
      && f.endsWith('.csv') && !f.includes(' copy'));

  console.log(`  Found ${scoutingFiles.length} hitter scouting files`);

  let totalRows = 0;
  for (const file of scoutingFiles) {
    const filePath = path.join(DATA_DIR, file);
    const { headers, rows: csvRows } = parseCsvFile(filePath);

    const source = extractSourceFromFilename(file);
    const snapshotDate = extractDateFromFilename(file);

    const headerIdx = (names: string[]) => {
      for (const n of names) {
        const idx = headers.indexOf(n);
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const idIdx = headerIdx(['id', 'playerid', 'player_id']);
    const nameIdx = headerIdx(['name', 'playername']);
    const powerIdx = headerIdx(['pow p', 'power', 'pow', 'pwr']);
    const eyeIdx = headerIdx(['eye p', 'eye', 'disc']);
    const avoidKIdx = headerIdx(['k p', 'avoidk', 'avoid_k', 'avk', 'kav']);
    const contactIdx = headerIdx(['con p', 'contact', 'con', 'cnt']);
    const gapIdx = headerIdx(['gap p', 'gap', 'gappower']);
    const speedIdx = headerIdx(['spe', 'speed', 'spd', 'run']);
    const srIdx = headerIdx(['sr', 'stealingaggressiveness']);
    const steIdx = headerIdx(['ste', 'stealingability', 'stealing']);
    const injuryIdx = headerIdx(['prone', 'injury', 'injuryproneness']);
    const ageIdx = headerIdx(['age']);
    const ovrIdx = headerIdx(['ovr', 'overall']);
    const potIdx = headerIdx(['pot', 'potential']);
    const posIdx = headerIdx(['pos', 'position']);
    const levIdx = headerIdx(['lev', 'level']);
    const hscIdx = headerIdx(['hsc']);
    const dobIdx = headerIdx(['dob']);

    // Personality columns
    const personalityCols = ['lea', 'loy', 'ad', 'fin', 'we', 'int'];
    const personalityIdxMap: Record<string, number> = {};
    for (const pc of personalityCols) {
      const idx = headers.indexOf(pc);
      if (idx !== -1) personalityIdxMap[pc] = idx;
    }

    const rows: any[] = [];
    for (const csvRow of csvRows) {
      const playerId = toIntOrNull(csvRow[idIdx] ?? '');
      if (!playerId) continue;

      const power = toIntOrNull(csvRow[powerIdx] ?? '');
      const eye = toIntOrNull(csvRow[eyeIdx] ?? '');
      const avoidK = toIntOrNull(csvRow[avoidKIdx] ?? '');
      if (power === null || eye === null || avoidK === null) continue;

      const ovr = ovrIdx >= 0 ? parseStarRating(csvRow[ovrIdx] ?? '') : null;
      const pot = potIdx >= 0 ? parseStarRating(csvRow[potIdx] ?? '') : null;
      if (ovr === null || pot === null) continue;

      // Build raw_data for variable columns
      const rawData: any = {};
      for (const [name, idx] of Object.entries(personalityIdxMap)) {
        const val = (csvRow[idx] ?? '').trim().toUpperCase();
        if (val === 'H' || val === 'N' || val === 'L') {
          const keyMap: Record<string, string> = { lea: 'leadership', loy: 'loyalty', ad: 'adaptability', fin: 'greed', we: 'workEthic', int: 'intelligence' };
          rawData[keyMap[name] || name] = val;
        }
      }

      rows.push({
        player_id: playerId,
        source,
        snapshot_date: snapshotDate,
        player_name: nameIdx >= 0 ? (csvRow[nameIdx] ?? '').trim() || null : null,
        power,
        eye,
        avoid_k: avoidK,
        contact: contactIdx >= 0 ? toIntOrNull(csvRow[contactIdx] ?? '') : null,
        gap: gapIdx >= 0 ? toIntOrNull(csvRow[gapIdx] ?? '') : null,
        speed: speedIdx >= 0 ? toIntOrNull(csvRow[speedIdx] ?? '') : null,
        stealing_aggressiveness: srIdx >= 0 ? toIntOrNull(csvRow[srIdx] ?? '') : null,
        stealing_ability: steIdx >= 0 ? toIntOrNull(csvRow[steIdx] ?? '') : null,
        injury_proneness: injuryIdx >= 0 ? (csvRow[injuryIdx] ?? '').trim() || null : null,
        age: ageIdx >= 0 ? toIntOrNull(csvRow[ageIdx] ?? '') : null,
        ovr,
        pot,
        pos: posIdx >= 0 ? (csvRow[posIdx] ?? '').trim() || null : null,
        lev: levIdx >= 0 ? (csvRow[levIdx] ?? '').trim() || null : null,
        hsc: hscIdx >= 0 ? (csvRow[hscIdx] ?? '').trim() || null : null,
        dob: dobIdx >= 0 ? (csvRow[dobIdx] ?? '').trim() || null : null,
        raw_data: Object.keys(rawData).length > 0 ? rawData : null,
      });
    }

    if (rows.length > 0) {
      await supabaseUpsertBatches('hitter_scouting', rows);
      totalRows += rows.length;
      console.log(`  ${file}: ${rows.length} ratings (source=${source}, date=${snapshotDate})`);
    }
  }

  console.log(`  Total: ${totalRows} hitter scouting records`);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('=== WBL CSV → Supabase Migration ===');
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Supabase URL: ${process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '(not set)'}`);

  const startTime = Date.now();

  // Step 1: DOBs
  await importDOBs();

  // Step 2: MLB pitching
  await importStatsDirectory(
    'mlb',
    'pitching_stats',
    PITCHING_COLS,
    /^\d{4}\.csv$/,
    'MLB Pitching Stats'
  );

  // Step 3: MLB batting
  await importStatsDirectory(
    'mlb_batting',
    'batting_stats',
    BATTING_COLS,
    /^\d{4}_batting\.csv$/,
    'MLB Batting Stats'
  );

  // Step 4: Minor league pitching
  await importStatsDirectory(
    'minors',
    'pitching_stats',
    PITCHING_COLS,
    /^\d{4}_\w+\.csv$/,
    'Minor League Pitching Stats'
  );

  // Step 5: Minor league batting
  await importStatsDirectory(
    'minors_batting',
    'batting_stats',
    BATTING_COLS,
    /^\d{4}_\w+_batting\.csv$/,
    'Minor League Batting Stats'
  );

  // Step 6: Pitcher scouting
  await importPitcherScouting();

  // Step 7: Hitter scouting
  await importHitterScouting();

  // Step 8: Update data_version
  console.log('\n=== Step 8: Seed data_version ===');
  const versionRows = [
    'pitching_stats', 'batting_stats', 'pitcher_scouting', 'hitter_scouting', 'players', 'teams'
  ].map(table_name => ({ table_name, version: 1 }));
  await supabasePost('data_version', versionRows);
  console.log('  data_version seeded');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n=== Migration complete in ${elapsed}s ===`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
