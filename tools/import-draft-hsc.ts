/**
 * import-draft-hsc.ts — Import draft-eligible IDs and HSC designations from CSVs.
 *
 * Reads two seasonal CSV files:
 *   - draft_eligible_ids.csv: one column of player IDs (draft-eligible players)
 *   - hsc.csv: player_id,hsc (high school/college designation)
 *
 * Sets `draft_eligible = true` for listed players (resets all others to false first).
 * Sets `hsc` for listed players (clears all others first).
 *
 * Usage:
 *   npx tsx tools/import-draft-hsc.ts [--draft=path/to/draft_eligible_ids.csv] [--hsc=path/to/hsc.csv]
 *
 * Defaults:
 *   --draft=public/data/2026_draft_eligible_ids.csv
 *   --hsc=public/data/hsc.csv
 */

import * as fs from 'fs';
import { supabasePatch } from './lib/supabase-client';

const args = process.argv.slice(2);
function getArg(name: string, defaultValue: string): string {
  const match = args.find(a => a.startsWith(`--${name}=`));
  return match?.split('=').slice(1).join('=') ?? defaultValue;
}

const draftCsvPath = getArg('draft', 'public/data/draft_eligible.csv');
const hscCsvPath = getArg('hsc', 'public/data/hsc.csv');

async function main() {
  console.log('=== Import Draft Eligible + HSC Data ===\n');

  // --- Draft Eligible ---
  // Always clear existing draft_eligible values first — CSV is source of truth
  console.log('  Clearing existing draft_eligible values...');
  await supabasePatch('players', 'draft_eligible=eq.true', { draft_eligible: false });
  console.log('  ✅ Cleared all draft_eligible values');

  if (fs.existsSync(draftCsvPath)) {
    console.log(`Reading draft-eligible IDs from: ${draftCsvPath}`);
    const raw = fs.readFileSync(draftCsvPath, 'utf-8');
    const ids = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !isNaN(parseInt(line, 10)))
      .map(line => parseInt(line, 10));

    console.log(`  Found ${ids.length} draft-eligible player IDs`);

    if (ids.length > 0) {
      // Set listed players to true (batch by 200)
      const BATCH = 200;
      let updated = 0;
      for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const idList = batch.join(',');
        await supabasePatch('players', `id=in.(${idList})`, { draft_eligible: true });
        updated += batch.length;
        if (updated % 500 === 0) console.log(`    ...${updated}/${ids.length}`);
      }
      console.log(`  ✅ Set draft_eligible=true for ${updated} players`);
    }
  } else {
    console.log(`⚠️  Draft CSV not found: ${draftCsvPath} — skipping`);
  }

  // --- HSC ---
  // Always clear existing HSC values first — CSV is source of truth
  console.log('\n  Clearing existing HSC values...');
  await supabasePatch('players', 'hsc=not.is.null', { hsc: null });
  console.log('  ✅ Cleared all HSC values');

  if (fs.existsSync(hscCsvPath)) {
    console.log(`\nReading HSC data from: ${hscCsvPath}`);
    const raw = fs.readFileSync(hscCsvPath, 'utf-8');
    const lines = raw.split(/\r?\n/).filter(line => line.trim());

    // Detect header
    const firstLine = lines[0];
    const hasHeader = firstLine.toLowerCase().includes('player_id') || firstLine.toLowerCase().includes('hsc');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const entries: Array<{ id: number; hsc: string }> = [];
    for (const line of dataLines) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length < 2) continue;
      const id = parseInt(parts[0], 10);
      const hsc = parts[1];
      if (!isNaN(id) && hsc) {
        entries.push({ id, hsc });
      }
    }

    console.log(`  Found ${entries.length} HSC entries`);

    if (entries.length > 0) {
      // Group by hsc value so we can batch-PATCH all players with the same designation
      const byHsc = new Map<string, number[]>();
      for (const e of entries) {
        const arr = byHsc.get(e.hsc) ?? [];
        arr.push(e.id);
        byHsc.set(e.hsc, arr);
      }
      let updated = 0;
      for (const [hsc, ids] of byHsc) {
        const BATCH = 200;
        for (let i = 0; i < ids.length; i += BATCH) {
          const batch = ids.slice(i, i + BATCH);
          const idList = batch.join(',');
          await supabasePatch('players', `id=in.(${idList})`, { hsc });
          updated += batch.length;
        }
      }
      console.log(`  ✅ Set hsc for ${updated} players`);
    }
  } else {
    console.log(`⚠️  HSC CSV not found: ${hscCsvPath} — skipping`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
