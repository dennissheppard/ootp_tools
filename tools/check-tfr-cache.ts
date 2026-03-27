/**
 * check-tfr-cache.ts — Check a player's entry in the TFR prospects cache.
 * Usage: npx tsx tools/check-tfr-cache.ts 12862
 */
import { supabaseQuery } from './lib/supabase-client';

async function main() {
  const id = parseInt(process.argv[2], 10);
  if (isNaN(id)) { console.error('Usage: npx tsx tools/check-tfr-cache.ts <playerId>'); process.exit(1); }

  const rows = await supabaseQuery<{ key: string; data: any }>('precomputed_cache', 'select=*&key=in.(hitter_tfr_prospects,pitcher_tfr_prospects)');

  for (const row of rows) {
    const prospects = row.data ?? [];
    const p = prospects.find((p: any) => p.playerId === id);
    if (p) {
      console.log(`Found in ${row.key}:`);
      console.log(JSON.stringify(p, null, 2));
      return;
    }
  }
  console.log(`Player #${id} not found in TFR prospects cache`);
}
main().catch(err => { console.error(err); process.exit(1); });
