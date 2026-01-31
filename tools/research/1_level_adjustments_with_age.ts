/**
 * Test 1: Level Adjustment Analysis (WITH AGE DATA)
 *
 * UPDATED VERSION with age-adjusted analysis
 *
 * Analyzes actual stat changes when pitchers transition between levels
 * to determine optimal level adjustment factors, segmented by age.
 */

import { findConsecutiveTransitions, Transition } from './lib/careerLinker';
import { mean, median, standardDeviation, percentile, getLevelName } from './lib/dataLoader';
import { loadPlayerDOBs, getPlayerSeasonAge, getAgeBucket } from './lib/playerAges';
import * as fs from 'fs';
import * as path from 'path';

interface LevelAdjustment {
  level: string;
  sampleSize: number;
  k9Delta: StatMetrics;
  bb9Delta: StatMetrics;
  hr9Delta: StatMetrics;
  fipDelta: StatMetrics;
}

interface StatMetrics {
  mean: number;
  median: number;
  stdDev: number;
  p25: number;
  p75: number;
}

interface AgeGroupResult {
  ageGroup: string;
  count: number;
  avgAge: number;
  k9Delta: number;
  bb9Delta: number;
  hr9Delta: number;
  fipDelta: number;
}

function analyzeTransitions(transitions: Transition[], label: string): LevelAdjustment {
  const k9Deltas = transitions.map(t => t.statsTo.k9 - t.statsFrom.k9);
  const bb9Deltas = transitions.map(t => t.statsTo.bb9 - t.statsFrom.bb9);
  const hr9Deltas = transitions.map(t => t.statsTo.hr9 - t.statsFrom.hr9);
  const fipDeltas = transitions.map(t => t.statsTo.fip - t.statsFrom.fip);

  return {
    level: label,
    sampleSize: transitions.length,
    k9Delta: {
      mean: mean(k9Deltas),
      median: median(k9Deltas),
      stdDev: standardDeviation(k9Deltas),
      p25: percentile(k9Deltas, 25),
      p75: percentile(k9Deltas, 75)
    },
    bb9Delta: {
      mean: mean(bb9Deltas),
      median: median(bb9Deltas),
      stdDev: standardDeviation(bb9Deltas),
      p25: percentile(bb9Deltas, 25),
      p75: percentile(bb9Deltas, 75)
    },
    hr9Delta: {
      mean: mean(hr9Deltas),
      median: median(hr9Deltas),
      stdDev: standardDeviation(hr9Deltas),
      p25: percentile(hr9Deltas, 25),
      p75: percentile(hr9Deltas, 75)
    },
    fipDelta: {
      mean: mean(fipDeltas),
      median: median(fipDeltas),
      stdDev: standardDeviation(fipDeltas),
      p25: percentile(fipDeltas, 25),
      p75: percentile(fipDeltas, 75)
    }
  };
}

function analyzeByAge(transitions: Transition[], dobs: Map<number, Date>): AgeGroupResult[] {
  // Group by age bucket
  const byAge = new Map<string, Transition[]>();

  for (const t of transitions) {
    const age = getPlayerSeasonAge(t.player_id, t.yearFrom, dobs);
    if (!age) continue; // Skip if no DOB

    const bucket = getAgeBucket(age);
    if (!byAge.has(bucket)) {
      byAge.set(bucket, []);
    }
    byAge.get(bucket)!.push(t);
  }

  const results: AgeGroupResult[] = [];

  for (const [bucket, group] of byAge) {
    const ages = group
      .map(t => getPlayerSeasonAge(t.player_id, t.yearFrom, dobs))
      .filter((age): age is number => age !== undefined);

    const k9Deltas = group.map(t => t.statsTo.k9 - t.statsFrom.k9);
    const bb9Deltas = group.map(t => t.statsTo.bb9 - t.statsFrom.bb9);
    const hr9Deltas = group.map(t => t.statsTo.hr9 - t.statsFrom.hr9);
    const fipDeltas = group.map(t => t.statsTo.fip - t.statsFrom.fip);

    results.push({
      ageGroup: bucket,
      count: group.length,
      avgAge: mean(ages),
      k9Delta: mean(k9Deltas),
      bb9Delta: mean(bb9Deltas),
      hr9Delta: mean(hr9Deltas),
      fipDelta: mean(fipDeltas)
    });
  }

  // Sort by age
  return results.sort((a, b) => a.avgAge - b.avgAge);
}

async function analyzeLevelAdjustments() {
  console.log('🔬 Test 1: Level Adjustment Analysis (WITH AGE DATA)');
  console.log('=' .repeat(80));
  console.log('Analyzing stat changes when pitchers move between levels\n');

  // Load age data
  console.log('📅 Loading age data...');
  const dobs = loadPlayerDOBs();
  console.log();

  // Focus on OOTP 26 era (2018-2020) for current engine
  const startYear = 2018;
  const endYear = 2020;

  console.log(`Using OOTP 26 data: ${startYear}-${endYear}\n`);

  // Analyze all major transitions
  const transitions = [
    { from: 2, to: 1, label: 'AAA → MLB' },
    { from: 3, to: 2, label: 'AA → AAA' },
    { from: 4, to: 3, label: 'A → AA' },
    { from: 6, to: 4, label: 'Rookie → A' }
  ];

  const results: LevelAdjustment[] = [];

  for (const { from, to, label } of transitions) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`📊 Analyzing ${label} transitions...`);
    console.log('─'.repeat(80));

    const trans = findConsecutiveTransitions(from, to, startYear, endYear, 30);

    if (trans.length === 0) {
      console.log(`⚠️  No transitions found\n`);
      continue;
    }

    const result = analyzeTransitions(trans, label);
    results.push(result);

    // Display results
    console.log(`\nSample Size: ${result.sampleSize} player-seasons`);
    console.log('\nStatistic Changes (Next Level - Current Level):');
    console.log('─'.repeat(80));

    const statRows = [
      { name: 'K/9', current: from === 2 ? '+0.25' : 'N/A', ...result.k9Delta },
      { name: 'BB/9', current: from === 2 ? '-0.05' : 'N/A', ...result.bb9Delta },
      { name: 'HR/9', current: from === 2 ? '+0.24' : 'N/A', ...result.hr9Delta },
      { name: 'FIP', current: 'N/A', ...result.fipDelta }
    ];

    console.log('Stat   Current  Mean    Median  Std Dev  25th %   75th %');
    console.log('─'.repeat(80));

    for (const row of statRows) {
      const sign = (val: number) => (val >= 0 ? '+' : '');
      console.log(
        `${row.name.padEnd(6)} ${row.current.padEnd(8)} ` +
        `${sign(row.mean)}${row.mean.toFixed(2)}`.padEnd(7) + '  ' +
        `${sign(row.median)}${row.median.toFixed(2)}`.padEnd(7) + '  ' +
        `${row.stdDev.toFixed(2)}`.padEnd(8) + '  ' +
        `${sign(row.p25)}${row.p25.toFixed(2)}`.padEnd(8) + '  ' +
        `${sign(row.p75)}${row.p75.toFixed(2)}`.padEnd(7)
      );
    }

    // Age group analysis (WITH AGE DATA!)
    console.log('\n\n🎂 By Age Group (NEW!):');
    console.log('─'.repeat(80));

    const ageGroups = analyzeByAge(trans, dobs);

    if (ageGroups.length > 0) {
      console.log('Age Group           N     Avg Age  K/9 Δ   BB/9 Δ  HR/9 Δ  FIP Δ');
      console.log('─'.repeat(80));

      for (const group of ageGroups) {
        const sign = (val: number) => (val >= 0 ? '+' : '');
        console.log(
          `${group.ageGroup.padEnd(19)} ${group.count.toString().padEnd(5)} ` +
          `${group.avgAge.toFixed(1).padEnd(8)} ` +
          `${sign(group.k9Delta)}${group.k9Delta.toFixed(2)}`.padEnd(7) + '  ' +
          `${sign(group.bb9Delta)}${group.bb9Delta.toFixed(2)}`.padEnd(7) + '  ' +
          `${sign(group.hr9Delta)}${group.hr9Delta.toFixed(2)}`.padEnd(7) + '  ' +
          `${sign(group.fipDelta)}${group.fipDelta.toFixed(2)}`.padEnd(6)
        );
      }

      // Key insight
      console.log('\n💡 Age Insights:');
      const youngGroup = ageGroups.find(g => g.ageGroup.includes('Young'));
      const oldGroup = ageGroups.find(g => g.ageGroup.includes('Veteran'));

      if (youngGroup && oldGroup) {
        const k9Diff = youngGroup.k9Delta - oldGroup.k9Delta;
        const bb9Diff = youngGroup.bb9Delta - oldGroup.bb9Delta;

        console.log(`  • Young pitchers (≤22): K/9 ${youngGroup.k9Delta >= 0 ? '+' : ''}${youngGroup.k9Delta.toFixed(2)}, BB/9 ${youngGroup.bb9Delta >= 0 ? '+' : ''}${youngGroup.bb9Delta.toFixed(2)}`);
        console.log(`  • Veterans (29+): K/9 ${oldGroup.k9Delta >= 0 ? '+' : ''}${oldGroup.k9Delta.toFixed(2)}, BB/9 ${oldGroup.bb9Delta >= 0 ? '+' : ''}${oldGroup.bb9Delta.toFixed(2)}`);

        if (Math.abs(k9Diff) > 0.3) {
          console.log(`  • K/9 difference: ${k9Diff >= 0 ? '+' : ''}${k9Diff.toFixed(2)} (${Math.abs(k9Diff) > 0.5 ? 'SIGNIFICANT' : 'moderate'})`);
        }
        if (Math.abs(bb9Diff) > 0.3) {
          console.log(`  • BB/9 difference: ${bb9Diff >= 0 ? '+' : ''}${bb9Diff.toFixed(2)} (${Math.abs(bb9Diff) > 0.5 ? 'SIGNIFICANT' : 'moderate'})`);
        }
      }
    } else {
      console.log('⚠️  Not enough age data for this transition');
    }
  }

  // Summary recommendations
  console.log('\n\n' + '═'.repeat(80));
  console.log('💡 RECOMMENDATIONS');
  console.log('═'.repeat(80));

  const aaaToMlb = results.find(r => r.level === 'AAA → MLB');

  if (aaaToMlb) {
    console.log('\n📌 AAA → MLB Adjustments (Updated with Age Data):');
    console.log('─'.repeat(80));

    const recommendations = [
      {
        stat: 'K/9',
        current: 0.25,
        recommended: aaaToMlb.k9Delta.mean,
        change: aaaToMlb.k9Delta.mean - 0.25
      },
      {
        stat: 'BB/9',
        current: -0.05,
        recommended: aaaToMlb.bb9Delta.mean,
        change: aaaToMlb.bb9Delta.mean - (-0.05)
      },
      {
        stat: 'HR/9',
        current: 0.24,
        recommended: aaaToMlb.hr9Delta.mean,
        change: aaaToMlb.hr9Delta.mean - 0.24
      }
    ];

    console.log('\nStat   Current   Found    Difference  Recommendation');
    console.log('─'.repeat(80));

    for (const rec of recommendations) {
      const sign = (val: number) => (val >= 0 ? '+' : '');
      const magnitude = Math.abs(rec.change);
      let recommendation = '';

      if (magnitude < 0.05) {
        recommendation = '✅ Keep current';
      } else if (magnitude < 0.15) {
        recommendation = '⚠️  Minor adjustment';
      } else {
        recommendation = '🔴 Significant change';
      }

      console.log(
        `${rec.stat.padEnd(6)} ` +
        `${sign(rec.current)}${rec.current.toFixed(2)}`.padEnd(9) + '  ' +
        `${sign(rec.recommended)}${rec.recommended.toFixed(2)}`.padEnd(8) + '  ' +
        `${sign(rec.change)}${rec.change.toFixed(2)}`.padEnd(11) + '  ' +
        recommendation
      );
    }
  }

  // Save detailed report
  const reportPath = path.join('tools', 'reports', '1_level_adjustments_with_age.json');
  const reportDir = path.dirname(reportPath);

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  console.log(`\n\n✅ Detailed results saved to: ${reportPath}\n`);
}

analyzeLevelAdjustments().catch(console.error);
