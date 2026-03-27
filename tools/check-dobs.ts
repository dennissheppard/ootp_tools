/**
 * check-dobs.ts — Check for missing DOBs and optionally fill from a local export.
 *
 * Usage:
 *   npx tsx tools/check-dobs.ts                              # report only
 *   npx tsx tools/check-dobs.ts --fix                        # fill from latest local export
 *   npx tsx tools/check-dobs.ts --fix --file=path/to/dob.csv # fill from specific file
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { supabaseQuery, supabaseUpsertBatches } from './lib/supabase-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const fix = process.argv.includes('--fix');

  console.log('=== DOB Gap Check ===\n');

  // Fetch players and scouting in parallel
  const [players, pitcherScout, hitterScout] = await Promise.all([
    supabaseQuery<any>('players', 'select=id,first_name,last_name,dob,age&order=id'),
    supabaseQuery<any>('pitcher_scouting', 'select=player_id&source=eq.osa&order=player_id'),
    supabaseQuery<any>('hitter_scouting', 'select=player_id&source=eq.osa&order=player_id'),
  ]);

  const dobMap = new Map<number, string>();
  const ageMap = new Map<number, number>();
  const nameMap = new Map<number, string>();
  for (const p of players) {
    if (p.dob) dobMap.set(p.id, p.dob);
    if (p.age) ageMap.set(p.id, typeof p.age === 'string' ? parseInt(p.age, 10) : p.age);
    if (p.first_name) nameMap.set(p.id, `${p.first_name} ${p.last_name}`);
  }

  const scoutedIds = new Set<number>();
  for (const s of pitcherScout) scoutedIds.add(s.player_id);
  for (const s of hitterScout) scoutedIds.add(s.player_id);

  // Find gaps
  const missingDob: number[] = [];
  const missingBoth: number[] = [];
  for (const pid of scoutedIds) {
    if (!dobMap.has(pid)) {
      missingDob.push(pid);
      if (!ageMap.has(pid)) missingBoth.push(pid);
    }
  }

  console.log(`Scouted players: ${scoutedIds.size}`);
  console.log(`With DOB: ${scoutedIds.size - missingDob.length}`);
  console.log(`Missing DOB: ${missingDob.length} (${missingBoth.length} also missing age)`);

  if (missingBoth.length > 0) {
    console.log(`\nPlayers missing BOTH DOB and age (no age source at all):`);
    for (const pid of missingBoth.slice(0, 20)) {
      console.log(`  #${pid} ${nameMap.get(pid) ?? '(not in players table)'}`);
    }
    if (missingBoth.length > 20) console.log(`  ... and ${missingBoth.length - 20} more`);
  }

  if (!fix) {
    if (missingDob.length > 0) {
      console.log(`\nRun with --fix to fetch players.csv and fill gaps.`);
    }
    return;
  }

  // Find DOB file: explicit --file= arg, or latest player_id_dob_*.csv in public/data/
  const fileArg = process.argv.find(a => a.startsWith('--file='))?.split('=')[1];
  let csvPath: string;
  if (fileArg) {
    csvPath = path.resolve(fileArg);
  } else {
    const dataDir = path.join(projectRoot, 'public', 'data');
    const dobFiles = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('player_id_dob_') && f.endsWith('.csv'))
      .sort()
      .reverse();
    if (dobFiles.length === 0) {
      console.error('No player_id_dob_*.csv found in public/data/. Use --file= to specify a path.');
      process.exit(1);
    }
    csvPath = path.join(dataDir, dobFiles[0]);
  }
  console.log(`\nReading ${path.basename(csvPath)}...`);
  const csv = fs.readFileSync(csvPath, 'utf-8');
  const lines = csv.split(/\r?\n/);
  const header = lines[0]?.split(',') ?? [];
  const idIdx = header.findIndex(h => h.trim().toLowerCase() === 'player_id' || h.trim().toLowerCase() === 'id');
  const dobIdx = header.findIndex(h => h.trim().toLowerCase() === 'date_of_birth' || h.trim().toLowerCase() === 'dob');

  if (idIdx < 0 || dobIdx < 0) {
    console.error(`Cannot find ID/DOB columns in CSV. Headers: ${header.join(', ')}`);
    process.exit(1);
  }

  // Parse DOBs, normalizing to YYYY-MM-DD for Supabase
  function normalizeDob(raw: string): string | null {
    const trimmed = raw.trim();
    // MM/DD/YYYY → YYYY-MM-DD
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) return `${slashMatch[3]}-${slashMatch[1].padStart(2, '0')}-${slashMatch[2].padStart(2, '0')}`;
    // Already YYYY-MM-DD?
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return null;
  }

  const csvDobs = new Map<number, string>();
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const pid = parseInt(cols[idIdx], 10);
    const dob = normalizeDob(cols[dobIdx] ?? '');
    if (!isNaN(pid) && dob) csvDobs.set(pid, dob);
  }
  console.log(`CSV has ${csvDobs.size} players with DOB`);

  // Fill gaps
  const updates: { id: number; dob: string }[] = [];
  let notInCsv = 0;
  for (const pid of missingDob) {
    const dob = csvDobs.get(pid);
    if (dob) {
      updates.push({ id: pid, dob });
    } else {
      notInCsv++;
    }
  }

  if (updates.length > 0) {
    await supabaseUpsertBatches('players', updates, 200, 'id');
    console.log(`\n✅ Filled ${updates.length} DOBs`);
  } else {
    console.log(`\nNo new DOBs to fill.`);
  }
  if (notInCsv > 0) {
    console.log(`⚠️  ${notInCsv} scouted players not found in CSV (may be too new)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
