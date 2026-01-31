/**
 * Check sample sizes across all eras to see if we should use more data
 */

import { findConsecutiveTransitions } from './lib/careerLinker';

async function checkSampleSizes() {
  console.log('📊 Checking AAA→MLB Transition Sample Sizes\n');

  const eras = [
    { name: 'OOTP 23', start: 2000, end: 2005 },
    { name: 'OOTP 24', start: 2006, end: 2011 },
    { name: 'OOTP 25', start: 2012, end: 2017 },
    { name: 'OOTP 26', start: 2018, end: 2020 }  // Only have through 2020
  ];

  console.log('Era         Years       Windows  Transitions  Avg/Window');
  console.log('─'.repeat(70));

  let totalTransitions = 0;

  for (const era of eras) {
    const transitions = findConsecutiveTransitions(2, 1, era.start, era.end, 30);
    const windows = era.end - era.start;  // Number of year-to-year windows
    const avgPerWindow = transitions.length / windows;

    console.log(
      `${era.name.padEnd(11)} ${era.start}-${era.end}   ${windows.toString().padEnd(8)} ` +
      `${transitions.length.toString().padEnd(12)} ${avgPerWindow.toFixed(1)}`
    );

    totalTransitions += transitions.length;
  }

  console.log('─'.repeat(70));
  console.log(`TOTAL: ${totalTransitions} transitions across all eras\n`);

  // Check if patterns are consistent
  console.log('\n📈 Comparing Patterns Across Eras:\n');

  for (const era of eras) {
    const trans = findConsecutiveTransitions(2, 1, era.start, era.end, 30);

    if (trans.length === 0) continue;

    const k9Deltas = trans.map(t => t.statsTo.k9 - t.statsFrom.k9);
    const bb9Deltas = trans.map(t => t.statsTo.bb9 - t.statsFrom.bb9);
    const hr9Deltas = trans.map(t => t.statsTo.hr9 - t.statsFrom.hr9);

    const avgK9 = k9Deltas.reduce((sum, d) => sum + d, 0) / k9Deltas.length;
    const avgBB9 = bb9Deltas.reduce((sum, d) => sum + d, 0) / bb9Deltas.length;
    const avgHR9 = hr9Deltas.reduce((sum, d) => sum + d, 0) / hr9Deltas.length;

    console.log(`${era.name} (N=${trans.length}):`);
    console.log(`  K/9 Δ: ${avgK9 >= 0 ? '+' : ''}${avgK9.toFixed(3)}`);
    console.log(`  BB/9 Δ: ${avgBB9 >= 0 ? '+' : ''}${avgBB9.toFixed(3)}`);
    console.log(`  HR/9 Δ: ${avgHR9 >= 0 ? '+' : ''}${avgHR9.toFixed(3)}`);
    console.log();
  }

  console.log('\n💡 Recommendation:');
  console.log('If patterns are similar across eras, we can use all data for larger sample size.');
  console.log('If patterns differ significantly, stick with OOTP 26 only.\n');
}

checkSampleSizes().catch(console.error);
