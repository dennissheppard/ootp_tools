/**
 * check-player.ts — Quick lookup of a player's data across tables.
 * Usage: npx tsx tools/check-player.ts 17533
 */
import { supabaseQuery } from './lib/supabase-client';

const playerId = process.argv[2];
if (!playerId) { console.error('Usage: npx tsx tools/check-player.ts <playerId>'); process.exit(1); }

async function main() {
  const [players, ratings, hitterScout, pitcherScout] = await Promise.all([
    supabaseQuery('players', `select=*&id=eq.${playerId}`),
    supabaseQuery('player_ratings', `select=player_id,rating_type&player_id=eq.${playerId}`),
    supabaseQuery('hitter_scouting', `select=player_id,player_name,contact,power,eye,avoid_k,gap,speed,ovr,pot,injury_proneness&player_id=eq.${playerId}`),
    supabaseQuery('pitcher_scouting', `select=player_id,player_name,stuff,control,hra,ovr,pot&player_id=eq.${playerId}`),
  ]);

  console.log('\n=== Player ===');
  if (players.length === 0) { console.log('  NOT FOUND'); }
  else {
    const p = players[0];
    console.log(`  ${p.first_name} ${p.last_name} (#${p.id})`);
    console.log(`  DOB: ${p.dob ?? 'NULL'}, Age: ${p.age ?? 'NULL'}, Position: ${p.position}`);
    console.log(`  Team: ${p.team_id}, Parent: ${p.parent_team_id}, Level: ${p.level}`);
    console.log(`  Status: ${p.status}, Draft eligible: ${p.draft_eligible}, Retired: ${p.retired}`);
  }

  console.log('\n=== Player Ratings ===');
  if (ratings.length === 0) { console.log('  NONE'); }
  else { for (const r of ratings) console.log(`  ${r.rating_type}`); }

  console.log('\n=== Hitter Scouting ===');
  if (hitterScout.length === 0) { console.log('  NONE'); }
  else { for (const s of hitterScout) console.log(`  ${s.player_name}: CON=${s.contact} POW=${s.power} EYE=${s.eye} K=${s.avoid_k} GAP=${s.gap} SPD=${s.speed} OVR=${s.ovr} POT=${s.pot} INJ=${s.injury_proneness}`); }

  console.log('\n=== Pitcher Scouting ===');
  if (pitcherScout.length === 0) { console.log('  NONE'); }
  else { for (const s of pitcherScout) console.log(`  ${s.player_name}: STU=${s.stuff} CTL=${s.control} HRA=${s.hra} OVR=${s.ovr} POT=${s.pot}`); }

  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
