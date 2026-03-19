/**
 * Park Factor Impact Report
 *
 * Shows projected stats with and without park adjustments for batters.
 * Useful for validating that park factors are working correctly.
 *
 * Usage:
 *   npx tsx tools/park-factor-report.ts                  # top 20 biggest impacts
 *   npx tsx tools/park-factor-report.ts --player=9814    # specific player
 *   npx tsx tools/park-factor-report.ts --team=Denver    # all batters on team
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { supabaseQuery } from './lib/supabase-client';
import { parseParkFactorsCsv, computeEffectiveParkFactors } from '../src/services/ParkFactorService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ProjectedBatter {
  playerId: number;
  name: string;
  teamId: number;
  teamName: string;
  position: number;
  positionLabel: string;
  projectedStats: {
    avg: number;
    obp: number;
    slg: number;
    ops: number;
    hr: number;
    war: number;
    pa: number;
    woba: number;
    defRuns?: number;
    posAdj?: number;
  };
}

async function main() {
  const args = process.argv.slice(2);
  const playerIdArg = args.find(a => a.startsWith('--player='))?.split('=')[1];
  const teamArg = args.find(a => a.startsWith('--team='))?.split('=')[1];

  // Load park factors
  const parkCsvPath = path.join(__dirname, '..', 'public', 'data', 'park_factors.csv');
  const parkCsv = fs.readFileSync(parkCsvPath, 'utf-8');
  const parkFactorsMap = parseParkFactorsCsv(parkCsv);

  // Load current projections from precomputed_cache (these are park-adjusted)
  const [cacheRows] = await Promise.all([
    supabaseQuery<any>('precomputed_cache', 'select=*&key=eq.batter_projections'),
  ]);
  if (!cacheRows[0]?.data?.projections) {
    console.error('No batter projections found in precomputed_cache. Run sync-db first.');
    process.exit(1);
  }
  const projections: ProjectedBatter[] = cacheRows[0].data.projections;

  // Load players for bats hand
  const players = await supabaseQuery<any>('players', 'select=id,bats,team_id,first_name,last_name&order=id');
  const playerBatsMap = new Map<number, string>();
  const playerTeamMap = new Map<number, number>();
  for (const p of players) {
    if (p.bats) playerBatsMap.set(p.id, p.bats);
    if (p.team_id) playerTeamMap.set(p.id, p.team_id);
  }

  // Build report rows
  const rows: {
    name: string;
    team: string;
    bats: string;
    pos: string;
    pa: number;
    // Park-adjusted (current projection)
    adj_avg: number;
    adj_ops: number;
    adj_hr: number;
    adj_war: number;
    // Neutral (reverse the park factor)
    neu_avg: number;
    neu_ops: number;
    neu_hr: number;
    neu_war: number;
    // Deltas
    d_avg: number;
    d_ops: number;
    d_hr: number;
    d_war: number;
    // Park info
    pf_avg: number;
    pf_hr: number;
  }[] = [];

  for (const b of projections) {
    if (playerIdArg && b.playerId !== parseInt(playerIdArg)) continue;
    if (teamArg && !b.teamName.toLowerCase().includes(teamArg.toLowerCase())) continue;

    const bats = playerBatsMap.get(b.playerId) ?? 'R';
    const teamId = b.teamId;
    const parkRaw = parkFactorsMap.get(teamId);
    if (!parkRaw) continue;

    const pf = computeEffectiveParkFactors(parkRaw, bats);
    const s = b.projectedStats;

    // Show effective park factors applied + resulting stats
    // "Neutral" = what stats would be if all factors were 1.0
    // Reverse: neutral_rate = adjusted_rate / pf
    const neuAvg = s.avg / pf.avg;
    const neuHr = Math.round(s.hr / pf.hr);

    // Properly reverse SLG: decompose ISO into HR/2B/3B components
    const ab = Math.round(s.pa * 0.88);
    const adjHrPerAb = ab > 0 ? s.hr / ab : 0;
    // We don't have 2B/3B counts on the projection, so reverse SLG from components
    // adj_slg = adj_avg + adj_2bRate*1 + adj_3bRate*2 + adj_hrPerAb*3
    // where adj_XRate = neu_XRate * pf.X
    // So: adj_slg - adj_avg = neu_2bRate*pf.d + 2*neu_3bRate*pf.t + 3*neu_hrPerAb*pf.hr
    // And: neu_slg - neu_avg = neu_2bRate + 2*neu_3bRate + 3*neu_hrPerAb
    // Approximate: scale the non-HR ISO by avg(pf.d, pf.t)
    const adjIso = s.slg - s.avg;
    const adjHrIso = 3 * adjHrPerAb;
    const adjXbhIso = Math.max(0, adjIso - adjHrIso);
    const xbhPf = (pf.d + pf.t) / 2;
    const neuIso = (adjXbhIso / xbhPf) + 3 * (adjHrPerAb / pf.hr);
    const neuSlg = neuAvg + neuIso;
    const neuObp = s.obp / pf.avg;  // BB not park-adjusted, but OBP includes AVG
    const neuOps = neuObp + neuSlg;

    // WAR delta estimate from wOBA change
    const neuWoba = s.woba / ((pf.avg + pf.hr) / 2); // rough weighted factor
    const warDelta = ((s.woba - neuWoba) / 1.15) * s.pa / 10;
    const neuWar = Math.round((s.war - warDelta) * 10) / 10;

    rows.push({
      name: b.name,
      team: b.teamName,
      bats,
      pos: b.positionLabel,
      pa: s.pa,
      adj_avg: s.avg,
      adj_ops: s.ops,
      adj_hr: s.hr,
      adj_war: s.war,
      neu_avg: Math.round(neuAvg * 1000) / 1000,
      neu_ops: Math.round(neuOps * 1000) / 1000,
      neu_hr: neuHr,
      neu_war: neuWar,
      d_avg: Math.round((s.avg - neuAvg) * 1000) / 1000,
      d_ops: Math.round((s.ops - neuOps) * 1000) / 1000,
      d_hr: s.hr - neuHr,
      d_war: Math.round((s.war - neuWar) * 10) / 10,
      pf_avg: pf.avg,
      pf_hr: pf.hr,
      pf_d: pf.d,
      pf_t: pf.t,
    });
  }

  if (rows.length === 0) {
    console.log('No matching batters found.');
    return;
  }

  // Sort by WAR delta magnitude (biggest impact first)
  rows.sort((a, b) => Math.abs(b.d_war) - Math.abs(a.d_war));

  const display = playerIdArg || teamArg ? rows : rows.slice(0, 20);

  // Per-player detail when --player used
  if (playerIdArg && display.length > 0) {
    const r = display[0];
    console.log(`\n=== Park Factor Detail: ${r.name} (${r.team}, Bats ${r.bats}) ===\n`);
    console.log(`Effective park factors (half home / half away):`);
    console.log(`  AVG: ${r.pf_avg.toFixed(4)}  HR: ${r.pf_hr.toFixed(4)}  2B: ${r.pf_d.toFixed(4)}  3B: ${r.pf_t.toFixed(4)}`);
    const sign = (v: number) => v >= 0 ? '+' : '';
    console.log(`\nProjected stats:       AVG    OPS    HR   WAR`);
    console.log(`  Neutral:            ${r.neu_avg.toFixed(3)}  ${r.neu_ops.toFixed(3)}  ${String(r.neu_hr).padStart(3)}   ${r.neu_war.toFixed(1)}`);
    console.log(`  Park-adjusted:      ${r.adj_avg.toFixed(3)}  ${r.adj_ops.toFixed(3)}  ${String(r.adj_hr).padStart(3)}   ${r.adj_war.toFixed(1)}`);
    console.log(`  Delta:             ${sign(r.d_avg)}${r.d_avg.toFixed(3)} ${sign(r.d_ops)}${r.d_ops.toFixed(3)}  ${sign(r.d_hr)}${String(r.d_hr).padStart(2)}  ${sign(r.d_war)}${r.d_war.toFixed(1)}`);
    console.log('');
  }

  console.log('\n=== Park Factor Impact Report ===\n');
  console.log('Player                    Team          Bats  Pos   PA   | Neutral      | Park-Adj     | Delta');
  console.log('                                                        | AVG   OPS  HR | AVG   OPS  HR | AVG    OPS   HR  WAR');
  console.log('─'.repeat(120));

  for (const r of display) {
    const name = r.name.padEnd(25);
    const team = r.team.padEnd(13);
    const neu = `${r.neu_avg.toFixed(3)} ${r.neu_ops.toFixed(3)} ${String(r.neu_hr).padStart(2)}`;
    const adj = `${r.adj_avg.toFixed(3)} ${r.adj_ops.toFixed(3)} ${String(r.adj_hr).padStart(2)}`;
    const sign = (v: number) => v >= 0 ? '+' : '';
    const delta = `${sign(r.d_avg)}${r.d_avg.toFixed(3)} ${sign(r.d_ops)}${r.d_ops.toFixed(3)} ${sign(r.d_hr)}${String(r.d_hr).padStart(2)}  ${sign(r.d_war)}${r.d_war.toFixed(1)}`;
    console.log(`${name} ${team} ${r.bats.padEnd(4)} ${r.pos.padEnd(4)} ${String(r.pa).padStart(3)}  | ${neu} | ${adj} | ${delta}`);
  }

  console.log(`\n${display.length} of ${rows.length} batters shown (sorted by |WAR delta|)`);

  // Pitcher park factor analysis
  const [pitcherCacheRows] = await Promise.all([
    supabaseQuery<any>('precomputed_cache', 'select=*&key=eq.pitcher_projections'),
  ]);
  const pitcherProjections: any[] = pitcherCacheRows[0]?.data?.projections ?? [];

  const pitcherTeamWar = new Map<string, { count: number; totalDelta: number; pfHr: number }>();
  for (const p of pitcherProjections) {
    if (teamArg && !p.teamName?.toLowerCase().includes(teamArg.toLowerCase())) continue;
    const parkRaw = parkFactorsMap.get(p.teamId);
    if (!parkRaw) continue;
    const { computePitcherParkHrFactor } = await import('../src/services/ParkFactorService');
    const pfHr = computePitcherParkHrFactor(parkRaw);
    const s = p.projectedStats;
    // Reverse: neutral HR9 = adj HR9 / pfHr, then recompute FIP/WAR
    const neuHr9 = s.hr9 / pfHr;
    const neuFip = ((13 * neuHr9 + 3 * s.bb9 - 2 * s.k9) / 9 + 3.47);
    // WAR ≈ (lg_RA9 - pitcher_RA9) * IP/9 / 10; approximate delta from FIP change
    const fipDelta = s.fip - neuFip;
    const warDelta = -(fipDelta * (s.ip / 9) / 10); // negative because higher FIP = lower WAR

    const entry = pitcherTeamWar.get(p.teamName) ?? { count: 0, totalDelta: 0, pfHr };
    entry.count++;
    entry.totalDelta += Math.round(warDelta * 10) / 10;
    pitcherTeamWar.set(p.teamName, entry);
  }

  // Team summary: batters + pitchers combined
  if (!playerIdArg) {
    const batterTeamWar = new Map<string, { count: number; totalDelta: number; pfAvg: number; pfHr: number }>();
    for (const r of rows) {
      const entry = batterTeamWar.get(r.team) ?? { count: 0, totalDelta: 0, pfAvg: r.pf_avg, pfHr: r.pf_hr };
      entry.count++;
      entry.totalDelta += r.d_war;
      batterTeamWar.set(r.team, entry);
    }

    console.log('\n=== Team WAR Impact from Park Factors ===\n');
    console.log('Team              PF(AVG) PF(HR)  Bat WAR  Pitch WAR  Net WAR');
    console.log('─'.repeat(68));

    const allTeams = new Set([...batterTeamWar.keys(), ...pitcherTeamWar.keys()]);
    const combined = [...allTeams].map(team => {
      const bat = batterTeamWar.get(team);
      const pit = pitcherTeamWar.get(team);
      return {
        team,
        batDelta: bat?.totalDelta ?? 0,
        pitDelta: pit?.totalDelta ?? 0,
        net: (bat?.totalDelta ?? 0) + (pit?.totalDelta ?? 0),
        pfAvg: bat?.pfAvg ?? 1,
        pfHr: bat?.pfHr ?? 1,
      };
    }).sort((a, b) => b.net - a.net);

    for (const { team, batDelta, pitDelta, net, pfAvg, pfHr } of combined) {
      const sign = (v: number) => v >= 0 ? '+' : '';
      console.log(`${team.padEnd(18)} ${pfAvg.toFixed(3)}   ${pfHr.toFixed(3)}   ${sign(batDelta)}${batDelta.toFixed(1).padStart(5)}    ${sign(pitDelta)}${pitDelta.toFixed(1).padStart(5)}      ${sign(net)}${net.toFixed(1)}`);
    }
  }
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
