import { supabaseQuery } from './lib/supabase-client';

async function main() {
  // Check IC players with DOB
  const icContracts = await supabaseQuery<any>('contracts', 'select=player_id&league_id=eq.-200');
  const icIds = new Set(icContracts.map((r: any) => r.player_id));
  console.log(`IC contracts: ${icIds.size}`);

  const icPlayers = await supabaseQuery<any>('players', `select=id,dob,level,first_name&id=in.(${[...icIds].slice(0, 50).join(',')})`);
  let hasDob = 0, noDob = 0, hasName = 0;
  for (const p of icPlayers) {
    if (p.dob) hasDob++; else noDob++;
    if (p.first_name) hasName++;
  }
  console.log(`IC sample (50): hasDob=${hasDob}, noDob=${noDob}, hasName=${hasName}`);
  console.log('Sample IC players:', icPlayers.slice(0, 5).map((p: any) => `id=${p.id} dob=${p.dob} level=${p.level} name=${p.first_name}`));

  // Check how many IC players have scouting
  const pitcherScouting = await supabaseQuery<any>('pitcher_scouting', 'select=player_id&source=eq.osa');
  const hitterScouting = await supabaseQuery<any>('hitter_scouting', 'select=player_id&source=eq.osa');
  const scoutedPitchers = new Set(pitcherScouting.map((r: any) => r.player_id));
  const scoutedHitters = new Set(hitterScouting.map((r: any) => r.player_id));

  let icWithPitcherScouting = 0, icWithHitterScouting = 0;
  for (const id of icIds) {
    if (scoutedPitchers.has(id)) icWithPitcherScouting++;
    if (scoutedHitters.has(id)) icWithHitterScouting++;
  }
  console.log(`IC with pitcher scouting: ${icWithPitcherScouting}`);
  console.log(`IC with hitter scouting: ${icWithHitterScouting}`);

  // Check TFR level distribution
  const pitcherTfr = await supabaseQuery<any>('precomputed_cache', "select=data&key=eq.pitcher_tfr_prospects");
  const pData = pitcherTfr[0]?.data || [];
  const pLevels: Record<string, number> = {};
  for (const p of pData) { pLevels[p.level] = (pLevels[p.level] || 0) + 1; }
  console.log(`\nPitcher TFR levels (${pData.length} total):`, pLevels);

  // Check IC players in pitcher TFR (by checking playerId against IC set)
  let icInPitcherTfr = 0;
  for (const p of pData) { if (icIds.has(p.playerId)) icInPitcherTfr++; }
  console.log(`IC players in pitcher TFR: ${icInPitcherTfr}`);

  const hitterTfr = await supabaseQuery<any>('precomputed_cache', "select=data&key=eq.hitter_tfr_prospects");
  const hData = hitterTfr[0]?.data || [];
  const hLevels: Record<string, number> = {};
  for (const h of hData) { hLevels[h.level] = (hLevels[h.level] || 0) + 1; }
  console.log(`\nHitter TFR levels (${hData.length} total):`, hLevels);

  let icInHitterTfr = 0;
  for (const h of hData) { if (icIds.has(h.playerId)) icInHitterTfr++; }
  console.log(`IC players in hitter TFR: ${icInHitterTfr}`);

  // Check what level IC players have who ARE in TFR
  const icInTfr: string[] = [];
  for (const p of [...pData, ...hData]) {
    if (icIds.has(p.playerId)) icInTfr.push(`${p.playerId}: level=${p.level}`);
  }
  console.log(`\nSample IC in TFR:`, icInTfr.slice(0, 10));
}

main().catch(console.error);
