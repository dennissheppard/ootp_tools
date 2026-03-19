/**
 * watch-scouting.ts — Watch for OOTP scouting CSV exports, upload to Supabase,
 * then trigger sync-db to recompute TR/TFR/caches.
 *
 * Usage:
 *   npx tsx tools/watch-scouting.ts [--dir=<path>]
 *
 * Default --dir = current working directory.
 *
 * Watches for:
 *   player_search___shortlist_player_search_true_batting.csv  (hitter scouting)
 *   player_search___shortlist_player_search_true_pitching.csv (pitcher scouting)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  supabaseQuery,
  supabaseUpsertBatches,
  parseCsvLine,
  toIntOrNull,
  toFloatOrNull,
} from './lib/supabase-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────
// Known filenames
// ──────────────────────────────────────────────

const HITTER_FILENAME = 'player_search___shortlist_player_search_true_batting.csv';
const PITCHER_FILENAME = 'player_search___shortlist_player_search_true_pitching.csv';

// ──────────────────────────────────────────────
// CLI args
// ──────────────────────────────────────────────

const args = process.argv.slice(2);
const dirArg = args.find(a => a.startsWith('--dir='))?.split('=').slice(1).join('=');
const watchDir = dirArg ? path.resolve(dirArg) : process.cwd();

// ──────────────────────────────────────────────
// CSV parsing (copied from migrate-to-supabase.ts)
// ──────────────────────────────────────────────

function parseCsvFile(filePath: string): { headers: string[]; rows: string[][] } {
  const text = fs.readFileSync(filePath, 'utf-8').replace(/^\ufeff/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase().trim());
  const rows = lines.slice(1).map(l => parseCsvLine(l));
  return { headers, rows };
}

function parseStarRating(val: string): number | null {
  if (!val) return null;
  const stripped = val.toLowerCase().replace(/\s*stars?\s*/gi, '').trim();
  const n = parseFloat(stripped);
  if (isNaN(n) || n < 0.5 || n > 5.0) return null;
  return n;
}

function headerIdx(headers: string[], names: string[]): number {
  for (const n of names) {
    const idx = headers.indexOf(n);
    if (idx !== -1) return idx;
  }
  return -1;
}

// ──────────────────────────────────────────────
// Scouting row builders
// ──────────────────────────────────────────────

function buildPitcherScoutingRows(filePath: string, snapshotDate: string): any[] {
  const { headers, rows: csvRows } = parseCsvFile(filePath);
  const source = 'osa';

  const idIdx = headerIdx(headers, ['id', 'playerid', 'player_id']);
  const nameIdx = headerIdx(headers, ['name', 'playername']);
  const stuffIdx = headerIdx(headers, ['stu p', 'stuff', 'stu', 'stf']);
  const controlIdx = headerIdx(headers, ['con p', 'control', 'con', 'ctl']);
  const hraIdx = headerIdx(headers, ['hrr p', 'hra', 'hr']);
  const ageIdx = headerIdx(headers, ['age']);
  const ovrIdx = headerIdx(headers, ['ovr', 'overall']);
  const potIdx = headerIdx(headers, ['pot', 'potential']);
  const staminaIdx = headerIdx(headers, ['stm', 'stamina']);
  const injuryIdx = headerIdx(headers, ['prone', 'injury']);
  const typeIdx = headerIdx(headers, ['type', 'pitchertype', 'gf']);
  const babipIdx = headerIdx(headers, ['pbabip p', 'pbabipp', 'babip']);
  const levIdx = headerIdx(headers, ['lev', 'level']);
  const hscIdx = headerIdx(headers, ['hsc']);
  const dobIdx = headerIdx(headers, ['dob']);

  // Pitch type columns
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

    // Build raw_data JSONB
    const rawData: any = {};

    const pitches: Record<string, number> = {};
    for (const [name, idx] of Object.entries(pitchIdxMap)) {
      const val = toIntOrNull(csvRow[idx] ?? '');
      if (val !== null && val > 0) pitches[name] = val;
    }
    if (Object.keys(pitches).length > 0) rawData.pitches = pitches;

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

  return rows;
}

function buildHitterScoutingRows(filePath: string, snapshotDate: string): any[] {
  const { headers, rows: csvRows } = parseCsvFile(filePath);
  const source = 'osa';

  const idIdx = headerIdx(headers, ['id', 'playerid', 'player_id']);
  const nameIdx = headerIdx(headers, ['name', 'playername']);
  const powerIdx = headerIdx(headers, ['pow p', 'power', 'pow', 'pwr']);
  const eyeIdx = headerIdx(headers, ['eye p', 'eye', 'disc']);
  const avoidKIdx = headerIdx(headers, ['k p', 'avoidk', 'avoid_k', 'avk', 'kav']);
  const contactIdx = headerIdx(headers, ['con p', 'contact', 'con', 'cnt']);
  const gapIdx = headerIdx(headers, ['gap p', 'gap', 'gappower']);
  const speedIdx = headerIdx(headers, ['spe', 'speed', 'spd', 'run']);
  const srIdx = headerIdx(headers, ['sr', 'stealingaggressiveness']);
  const steIdx = headerIdx(headers, ['ste', 'stealingability', 'stealing']);
  const injuryIdx = headerIdx(headers, ['prone', 'injury', 'injuryproneness']);
  const ageIdx = headerIdx(headers, ['age']);
  const ovrIdx = headerIdx(headers, ['ovr', 'overall']);
  const potIdx = headerIdx(headers, ['pot', 'potential']);
  const posIdx = headerIdx(headers, ['pos', 'position']);
  const levIdx = headerIdx(headers, ['lev', 'level']);
  const hscIdx = headerIdx(headers, ['hsc']);
  const dobIdx = headerIdx(headers, ['dob']);

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

  return rows;
}

// ──────────────────────────────────────────────
// Supabase helpers
// ──────────────────────────────────────────────

async function fetchGameDate(): Promise<string | null> {
  const rows = await supabaseQuery<{ game_date?: string }>(
    'data_version',
    'select=game_date&table_name=eq.game_state'
  );
  return rows[0]?.game_date ?? null;
}

async function uploadFile(
  filePath: string,
  type: 'hitter' | 'pitcher',
  snapshotDate: string
): Promise<number> {
  const table = type === 'hitter' ? 'hitter_scouting' : 'pitcher_scouting';
  const rows = type === 'hitter'
    ? buildHitterScoutingRows(filePath, snapshotDate)
    : buildPitcherScoutingRows(filePath, snapshotDate);

  if (rows.length === 0) {
    console.log(`  No valid rows in ${path.basename(filePath)}`);
    return 0;
  }

  const count = await supabaseUpsertBatches(
    table,
    rows,
    500,
    'player_id,source,snapshot_date'
  );
  console.log(`  Uploaded ${count} ${type} scouting rows for ${snapshotDate}`);
  return count;
}

function runSyncDb(): void {
  console.log('\n  Running sync-db --force ...');
  const syncScript = path.join(__dirname, 'sync-db.ts');
  try {
    execSync(`npx tsx "${syncScript}" --force`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
  } catch (err: any) {
    console.error(`  sync-db exited with code ${err.status ?? 'unknown'}`);
  }
}

// ──────────────────────────────────────────────
// Interactive prompt
// ──────────────────────────────────────────────

function askQuestion(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function handleStartupFiles(
  files: { hitter?: string; pitcher?: string },
  gameDate: string | null
): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\nFound scouting files:');
  if (files.hitter) console.log(`  ✓ ${HITTER_FILENAME}`);
  if (files.pitcher) console.log(`  ✓ ${PITCHER_FILENAME}`);
  console.log(`\nCurrent game date: ${gameDate ?? '(not set)'}`);

  if (!gameDate) {
    console.log('\n  No game date set in DB. Skipping to watch mode.');
    rl.close();
    return;
  }

  console.log(`\n  [1] Upload for ${gameDate}`);
  console.log('  [2] Upload for a different date');
  console.log('  [3] Skip to watch mode');

  const choice = (await askQuestion(rl, '\n> ')).trim();

  let uploadDate = gameDate;

  if (choice === '2') {
    const custom = (await askQuestion(rl, '  Enter date (YYYY-MM-DD): ')).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(custom)) {
      uploadDate = custom;
    } else {
      console.log('  Invalid date format. Skipping upload.');
      rl.close();
      return;
    }
  } else if (choice !== '1') {
    rl.close();
    return;
  }

  rl.close();

  // Upload found files
  let uploaded = false;
  if (files.hitter) {
    const count = await uploadFile(files.hitter, 'hitter', uploadDate);
    if (count > 0) uploaded = true;
  }
  if (files.pitcher) {
    const count = await uploadFile(files.pitcher, 'pitcher', uploadDate);
    if (count > 0) uploaded = true;
  }

  if (uploaded) {
    runSyncDb();
  }
}

// ──────────────────────────────────────────────
// Watch mode
// ──────────────────────────────────────────────

let processing = false;

async function handleFileChange(filename: string): Promise<void> {
  if (processing) return;

  let type: 'hitter' | 'pitcher';
  if (filename === HITTER_FILENAME) type = 'hitter';
  else if (filename === PITCHER_FILENAME) type = 'pitcher';
  else return;

  processing = true;
  const filePath = path.join(watchDir, filename);

  try {
    // Wait for OOTP to finish writing
    console.log(`\n  Detected: ${filename}`);
    console.log('  Waiting 2s for file write to complete...');
    await new Promise(r => setTimeout(r, 2000));

    if (!fs.existsSync(filePath)) {
      console.log('  File disappeared, skipping.');
      return;
    }

    // Re-read game date (may have advanced)
    const gameDate = await fetchGameDate();
    if (!gameDate) {
      console.log('  No game date set in DB. Skipping upload.');
      return;
    }

    await uploadFile(filePath, type, gameDate);
    runSyncDb();
  } catch (err) {
    console.error('  Error processing file:', err);
  } finally {
    processing = false;
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────

async function main() {
  console.log('=== Scouting Watcher ===');
  console.log(`Watching: ${watchDir}`);

  // Fetch game date
  const gameDate = await fetchGameDate();
  console.log(`Game date: ${gameDate ?? '(not set)'}`);

  // Check for existing files
  const hitterPath = path.join(watchDir, HITTER_FILENAME);
  const pitcherPath = path.join(watchDir, PITCHER_FILENAME);
  const foundFiles: { hitter?: string; pitcher?: string } = {};
  if (fs.existsSync(hitterPath)) foundFiles.hitter = hitterPath;
  if (fs.existsSync(pitcherPath)) foundFiles.pitcher = pitcherPath;

  if (foundFiles.hitter || foundFiles.pitcher) {
    await handleStartupFiles(foundFiles, gameDate);
  }

  // Enter watch mode
  console.log(`\n  Watching for scouting exports in ${watchDir} ...`);
  console.log('  Press Ctrl+C to stop.\n');

  fs.watch(watchDir, (eventType, filename) => {
    if (!filename) return;
    if (filename === HITTER_FILENAME || filename === PITCHER_FILENAME) {
      handleFileChange(filename);
    }
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
