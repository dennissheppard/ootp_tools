/**
 * check-cached-proj.ts — Check a player's entry in the batter/pitcher projections cache.
 * Usage: npx tsx tools/check-cached-proj.ts 12862
 */
import { supabaseQuery } from './lib/supabase-client';

async function main() {
  const id = parseInt(process.argv[2], 10);
  if (isNaN(id)) { console.error('Usage: npx tsx tools/check-cached-proj.ts <playerId>'); process.exit(1); }

  const rows = await supabaseQuery<{ key: string; data: any }>('precomputed_cache', 'select=*&key=in.(batter_projections,pitcher_projections)');

  for (const row of rows) {
    const projs = row.data?.projections ?? [];
    const p = projs.find((p: any) => p.playerId === id);
    if (p) {
      console.log(`Found in ${row.key}:`);
      console.log(JSON.stringify(p, null, 2));
      return;
    }
  }
  console.log(`Player #${id} not found in batter_projections or pitcher_projections`);
}
main().catch(err => { console.error(err); process.exit(1); });
