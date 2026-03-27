/**
 * check-lookup.ts — Check player_lookup cache for specific players.
 * Usage: npx tsx tools/check-lookup.ts 12862 17533
 */
import { supabaseQuery } from './lib/supabase-client';

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) { console.error('Usage: npx tsx tools/check-lookup.ts <id> [id...]'); process.exit(1); }

  const rows = await supabaseQuery<{ key: string; data: any }>('precomputed_cache', 'select=data&key=eq.player_lookup');
  const lookup = rows[0]?.data;
  if (!lookup) { console.log('No player_lookup in cache'); return; }

  // Show field names for reference
  console.log('Fields: [firstName, lastName, position, age, teamId, parentTeamId, level, status, draftEligible, hsc, bats]\n');

  for (const id of ids) {
    const entry = lookup[id];
    if (!entry) { console.log(`#${id}: NOT IN LOOKUP`); continue; }
    console.log(`#${id}: ${entry[0]} ${entry[1]} | status=${entry[7]} draftEligible=${entry[8]} hsc=${entry[9] || 'null'} | team=${entry[4]} age=${entry[3]}`);
  }
}
main().catch(err => { console.error(err); process.exit(1); });
