import { supabaseQuery } from './lib/supabase-client';

async function main() {
  const p1 = await supabaseQuery('pitching_stats', 'select=player_id&league_id=eq.200&split_id=eq.1&year=eq.2021&limit=5');
  console.log('MLB pitching split_id=1 count:', p1.length);

  const p2 = await supabaseQuery('pitching_stats', 'select=split_id&league_id=eq.200&year=eq.2021&limit=20');
  console.log('MLB pitching sample split_ids:', p2.map((r: any) => r.split_id));

  const b1 = await supabaseQuery('batting_stats', 'select=player_id&league_id=eq.200&split_id=eq.1&year=eq.2021&limit=5');
  console.log('MLB batting split_id=1 count:', b1.length);

  const b2 = await supabaseQuery('batting_stats', 'select=split_id&league_id=eq.200&year=eq.2021&limit=20');
  console.log('MLB batting sample split_ids:', b2.map((r: any) => r.split_id));

  // Check total rows
  const allPitch = await supabaseQuery('pitching_stats', 'select=player_id&year=eq.2021&limit=1');
  console.log('Any pitching rows for 2021:', allPitch.length > 0 ? 'yes' : 'NO');

  const allBat = await supabaseQuery('batting_stats', 'select=player_id&year=eq.2021&limit=1');
  console.log('Any batting rows for 2021:', allBat.length > 0 ? 'yes' : 'NO');
}

main().catch(console.error);
