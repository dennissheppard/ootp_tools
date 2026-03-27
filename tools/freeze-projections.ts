/**
 * freeze-projections.ts — Snapshot current precomputed_cache entries.
 *
 * Copies all projection-related cache entries to snapshot-suffixed keys
 * so they can be viewed later via the browser's Opening Day toggle.
 *
 * Usage:
 *   npx tsx tools/freeze-projections.ts                          # auto-detect year
 *   npx tsx tools/freeze-projections.ts --year=2022              # explicit year
 *   npx tsx tools/freeze-projections.ts --label=trade_deadline   # custom label (default: opening_day)
 *   npx tsx tools/freeze-projections.ts --delete=opening_day_2022  # remove a snapshot
 *
 * Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY (loaded from .env.local)
 */

import {
  supabaseQuery,
  supabaseUpsertBatches,
  supabaseDelete,
} from './lib/supabase-client';

// Keys to snapshot — covers all projection and lookup data
const SNAPSHOT_KEYS = [
  'pitcher_projections',
  'batter_projections',
  'league_context',
  'park_factors',
  'defensive_lookup',
  'player_lookup',
  'pitcher_scouting_lookup',
  'hitter_scouting_lookup',
  'contract_lookup',
  'dob_lookup',
  'position_ratings_lookup',
  'pitcher_tfr_prospects',
  'hitter_tfr_prospects',
  'pitcher_mlb_distribution',
  'hitter_mlb_distribution_def_def_def',
];

// Re-export for use by sync-db auto-freeze
export { SNAPSHOT_KEYS };

interface SnapshotEntry {
  id: string;
  label: string;
  year: number;
  createdAt: string;
}

// ── Helpers ──────────────────────────────────

async function detectYear(): Promise<number> {
  try {
    const resp = await fetch('https://worldbaseballleague.org/api/date');
    const data = await resp.json();
    const season = parseInt(data.season, 10);
    // Offseason: projections target next year
    const dateStr: string = data.in_game_date?.date ?? '';
    const month = parseInt(dateStr.split('-')[1], 10);
    return (month >= 11 || month <= 3) ? season + 1 : season;
  } catch {
    throw new Error('Could not auto-detect year from WBL API. Use --year=YYYY.');
  }
}

async function readSnapshotIndex(): Promise<SnapshotEntry[]> {
  const rows = await supabaseQuery<{ key: string; data: any }>(
    'precomputed_cache',
    'select=data&key=eq.snapshots__index'
  );
  return rows[0]?.data?.snapshots ?? [];
}

async function writeSnapshotIndex(snapshots: SnapshotEntry[]): Promise<void> {
  await supabaseUpsertBatches(
    'precomputed_cache',
    [{ key: 'snapshots__index', data: { snapshots } }],
    1,
    'key'
  );
}

// ── Main ─────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const explicitYear = args.find(a => a.startsWith('--year='))?.split('=')[1];
  const label = args.find(a => a.startsWith('--label='))?.split('=')[1] ?? 'opening_day';
  const deleteId = args.find(a => a.startsWith('--delete='))?.split('=')[1];

  // ── Delete mode ──
  if (deleteId) {
    console.log(`\nDeleting snapshot: ${deleteId}`);

    // Remove snapshot cache entries
    let deleted = 0;
    for (const key of SNAPSHOT_KEYS) {
      const snapshotKey = `${key}__snapshot__${deleteId}`;
      const count = await supabaseDelete('precomputed_cache', `key=eq.${encodeURIComponent(snapshotKey)}`);
      deleted += count;
    }
    console.log(`  Removed ${deleted} cache entries`);

    // Update index
    const index = await readSnapshotIndex();
    const updated = index.filter(s => s.id !== deleteId);
    await writeSnapshotIndex(updated);
    console.log(`  Updated snapshot index (${updated.length} snapshots remaining)`);
    console.log('Done.\n');
    return;
  }

  // ── Freeze mode ──
  const year = explicitYear ? parseInt(explicitYear, 10) : await detectYear();
  const snapshotId = `${label}_${year}`;

  console.log(`\nFreezing projections: ${snapshotId}`);
  console.log(`  Label: ${label}`);
  console.log(`  Year: ${year}`);
  console.log(`  Keys to snapshot: ${SNAPSHOT_KEYS.length}`);

  // Read current cache entries
  let snapshotted = 0;
  const rows: { key: string; data: any }[] = [];

  for (const key of SNAPSHOT_KEYS) {
    const result = await supabaseQuery<{ key: string; data: any }>(
      'precomputed_cache',
      `select=key,data&key=eq.${key}`
    );
    if (result.length > 0 && result[0].data) {
      rows.push({
        key: `${key}__snapshot__${snapshotId}`,
        data: result[0].data,
      });
      snapshotted++;
    } else {
      console.warn(`  ⚠️  Key not found: ${key} (skipping)`);
    }
  }

  if (rows.length === 0) {
    console.error('\n  No data to snapshot. Is the database populated?');
    process.exit(1);
  }

  // Write snapshot entries
  await supabaseUpsertBatches('precomputed_cache', rows, 5, 'key');
  console.log(`  Wrote ${snapshotted}/${SNAPSHOT_KEYS.length} snapshot entries`);

  // Update snapshot index
  const index = await readSnapshotIndex();
  const existing = index.findIndex(s => s.id === snapshotId);
  const entry: SnapshotEntry = {
    id: snapshotId,
    label: label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    year,
    createdAt: new Date().toISOString(),
  };

  if (existing >= 0) {
    index[existing] = entry;
    console.log(`  Updated existing index entry for ${snapshotId}`);
  } else {
    index.push(entry);
    console.log(`  Added new index entry for ${snapshotId}`);
  }

  await writeSnapshotIndex(index);
  console.log(`\n  ✅ Snapshot complete: ${snapshotId} (${snapshotted} keys)`);
  console.log('');
}

// Only run when executed directly (not when imported by sync-db for SNAPSHOT_KEYS)
const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('freeze-projections');
if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
