/**
 * check-projections.ts — Sanity check precomputed projections without re-syncing.
 *
 * Reads pitcher_projections and batter_projections from precomputed_cache
 * and flags any outliers.
 *
 * Usage:
 *   npx tsx tools/check-projections.ts
 */

import { supabaseQuery } from './lib/supabase-client';

async function main() {
  console.log('=== Projection Sanity Check ===\n');

  const rows = await supabaseQuery<{ key: string; data: any }>(
    'precomputed_cache',
    'select=*&key=in.(pitcher_projections,batter_projections)'
  );

  const pitcherData = rows.find(r => r.key === 'pitcher_projections')?.data;
  const batterData = rows.find(r => r.key === 'batter_projections')?.data;

  // Pitcher checks
  const pitchers: any[] = pitcherData?.projections ?? [];
  let pitcherIssues = 0;
  console.log(`Pitchers: ${pitchers.length} projections (statsYear=${pitcherData?.statsYear})\n`);

  for (const p of pitchers) {
    const fip = p.projectedStats?.fip;
    const war = p.projectedStats?.war;
    const ip = p.projectedStats?.ip;
    const issues: string[] = [];
    if (!Number.isFinite(fip) || fip < 1.0 || fip > 8.0) issues.push(`FIP=${fip?.toFixed(2) ?? 'NaN'}`);
    if (!Number.isFinite(war) || war < -5 || war > 15) issues.push(`WAR=${war?.toFixed(1) ?? 'NaN'}`);
    if (p.isSp && (ip < 20 || ip > 300)) issues.push(`IP=${ip?.toFixed(0) ?? 'NaN'} (SP)`);
    if (!Number.isFinite(ip) || ip < 0) issues.push(`IP=${ip ?? 'NaN'}`);
    if (issues.length > 0) {
      pitcherIssues++;
      const team = p.teamName || `team=${p.teamId}`;
      const role = p.isSp ? 'SP' : 'RP';
      console.log(`  ⚠️  #${p.playerId} ${p.name} (${role}, ${team}): ${issues.join(', ')}  |  full: FIP=${fip?.toFixed(2)} WAR=${war?.toFixed(1)} IP=${ip?.toFixed(0)} K9=${p.projectedStats?.k9?.toFixed(1)} BB9=${p.projectedStats?.bb9?.toFixed(1)} HR9=${p.projectedStats?.hr9?.toFixed(2)}`);
    }
  }
  console.log(`\nPitcher issues: ${pitcherIssues}/${pitchers.length}\n`);

  // Batter checks
  const batters: any[] = batterData?.projections ?? [];
  let batterIssues = 0;
  console.log(`Batters: ${batters.length} projections (statsYear=${batterData?.statsYear})\n`);

  for (const p of batters) {
    const war = p.projectedStats?.war;
    const pa = p.projectedStats?.pa;
    const woba = p.projectedStats?.woba;
    const avg = p.projectedStats?.avg;
    const issues: string[] = [];
    if (!Number.isFinite(war) || war < -5 || war > 15) issues.push(`WAR=${war?.toFixed(1) ?? 'NaN'}`);
    if (!Number.isFinite(pa) || pa < 0 || pa > 800) issues.push(`PA=${pa?.toFixed(0) ?? 'NaN'}`);
    if (!Number.isFinite(woba) || woba < .150 || woba > .550) issues.push(`wOBA=${woba?.toFixed(3) ?? 'NaN'}`);
    if (!Number.isFinite(avg) || avg < .100 || avg > .400) issues.push(`AVG=${avg?.toFixed(3) ?? 'NaN'}`);
    if (issues.length > 0) {
      batterIssues++;
      const team = p.teamName || `team=${p.teamId}`;
      console.log(`  ⚠️  #${p.playerId} ${p.name} (${team}): ${issues.join(', ')}  |  full: WAR=${war?.toFixed(1)} PA=${pa?.toFixed(0)} wOBA=${woba?.toFixed(3)} AVG=${avg?.toFixed(3)} OBP=${p.projectedStats?.obp?.toFixed(3)} SLG=${p.projectedStats?.slg?.toFixed(3)}`);
    }
  }
  console.log(`\nBatter issues: ${batterIssues}/${batters.length}`);

  // Top/bottom outliers
  console.log('\n--- Top 5 pitcher WAR ---');
  const sortedPitchers = [...pitchers].sort((a, b) => (b.projectedStats?.war ?? 0) - (a.projectedStats?.war ?? 0));
  for (const p of sortedPitchers.slice(0, 5)) {
    console.log(`  ${p.name}: ${p.projectedStats.war?.toFixed(1)} WAR, ${p.projectedStats.fip?.toFixed(2)} FIP, ${p.projectedStats.ip?.toFixed(0)} IP`);
  }

  console.log('\n--- Top 5 batter WAR ---');
  const sortedBatters = [...batters].sort((a, b) => (b.projectedStats?.war ?? 0) - (a.projectedStats?.war ?? 0));
  for (const p of sortedBatters.slice(0, 5)) {
    console.log(`  ${p.name}: ${p.projectedStats.war?.toFixed(1)} WAR, ${p.projectedStats.woba?.toFixed(3)} wOBA, ${p.projectedStats.pa?.toFixed(0)} PA`);
  }

  console.log('');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
