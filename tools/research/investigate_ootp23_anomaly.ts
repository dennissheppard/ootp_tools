/**
 * Investigate why OOTP 23 shows -3.5 K/9 change from AAA to MLB
 */

import { findConsecutiveTransitions } from './lib/careerLinker';

async function investigate() {
  console.log('🔍 Investigating OOTP 23 K/9 Anomaly\n');

  const trans = findConsecutiveTransitions(2, 1, 2000, 2005, 30);

  console.log(`Found ${trans.length} transitions`);
  console.log('\nSample of 10 transitions:\n');
  console.log('Player  Year  AAA K/9  MLB K/9  Delta    AAA IP  MLB IP');
  console.log('─'.repeat(70));

  for (let i = 0; i < Math.min(10, trans.length); i++) {
    const t = trans[i];
    const delta = t.statsTo.k9 - t.statsFrom.k9;

    console.log(
      `${t.player_id.toString().padEnd(7)} ${t.yearFrom}  ` +
      `${t.statsFrom.k9.toFixed(2).padEnd(8)} ${t.statsTo.k9.toFixed(2).padEnd(8)} ` +
      `${delta >= 0 ? '+' : ''}${delta.toFixed(2).padEnd(8)} ` +
      `${t.statsFrom.ip.toFixed(0).padEnd(7)} ${t.statsTo.ip.toFixed(0)}`
    );
  }

  // Check average K/9 levels
  const avgAAAk9 = trans.reduce((sum, t) => sum + t.statsFrom.k9, 0) / trans.length;
  const avgMLBk9 = trans.reduce((sum, t) => sum + t.statsTo.k9, 0) / trans.length;

  console.log('\n📊 Average K/9 Levels:');
  console.log(`  AAA: ${avgAAAk9.toFixed(2)}`);
  console.log(`  MLB: ${avgMLBk9.toFixed(2)}`);
  console.log(`  Delta: ${(avgMLBk9 - avgAAAk9).toFixed(2)}`);

  // Check if there are any extreme outliers
  const deltas = trans.map(t => t.statsTo.k9 - t.statsFrom.k9).sort((a, b) => a - b);
  console.log('\n📈 K/9 Delta Distribution:');
  console.log(`  Min: ${deltas[0].toFixed(2)}`);
  console.log(`  25th percentile: ${deltas[Math.floor(deltas.length * 0.25)].toFixed(2)}`);
  console.log(`  Median: ${deltas[Math.floor(deltas.length * 0.5)].toFixed(2)}`);
  console.log(`  75th percentile: ${deltas[Math.floor(deltas.length * 0.75)].toFixed(2)}`);
  console.log(`  Max: ${deltas[deltas.length - 1].toFixed(2)}`);

  // Check for data quality - are K/9s calculated correctly?
  console.log('\n🔬 Data Quality Check (first 5 transitions):');
  for (let i = 0; i < Math.min(5, trans.length); i++) {
    const t = trans[i];
    const aaaK9Calc = (t.statsFrom.k / t.statsFrom.ip) * 9;
    const mlbK9Calc = (t.statsTo.k / t.statsTo.ip) * 9;

    console.log(`\nPlayer ${t.player_id}:`);
    console.log(`  AAA: ${t.statsFrom.k} K in ${t.statsFrom.ip.toFixed(1)} IP = ${aaaK9Calc.toFixed(2)} K/9 (stored: ${t.statsFrom.k9.toFixed(2)})`);
    console.log(`  MLB: ${t.statsTo.k} K in ${t.statsTo.ip.toFixed(1)} IP = ${mlbK9Calc.toFixed(2)} K/9 (stored: ${t.statsTo.k9.toFixed(2)})`);
  }
}

investigate().catch(console.error);
