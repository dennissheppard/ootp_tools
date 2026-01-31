/**
 * Test 1: Level Adjustment Analysis
 *
 * Analyzes actual stat changes when pitchers transition between levels
 * to determine optimal level adjustment factors.
 *
 * Key Questions:
 * 1. What are the actual K/9, BB/9, HR/9 changes from AAA → MLB?
 * 2. Do these vary by age?
 * 3. Are current adjustments (+0.30 K/9, -0.42 BB/9) accurate?
 */

import { findConsecutiveTransitions, Transition } from './lib/careerLinker';
import { mean, median, standardDeviation, percentile, getLevelName } from './lib/dataLoader';
import * as fs from 'fs';
import * as path from 'path';

interface LevelAdjustment {
  level: string;
  sampleSize: number;
  k9Delta: {
    mean: number;
    median: number;
    stdDev: number;
    p25: number;
    p75: number;
  };
  bb9Delta: {
    mean: number;
    median: number;
    stdDev: number;
    p25: number;
    p75: number;
  };
  hr9Delta: {
    mean: number;
    median: number;
    stdDev: number;
    p25: number;
    p75: number;
  };
  fipDelta: {
    mean: number;
    median: number;
    stdDev: number;
    p25: number;
    p75: number;
  };
}

interface AgeGroupResult {
  ageGroup: string;
  count: number;
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

function analyzeByAgeGroup(transitions: Transition[]): AgeGroupResult[] {
  // Group by age (need to estimate age from career context)
  // For now, use simple heuristic: year - 2000 gives rough career stage
  // Young: early in dataset, Old: late in dataset
  // This is a placeholder - ideally we'd have actual age data

  // Simple age groups based on years played
  const young = transitions.filter(t => t.yearFrom <= 2010);
  const middle = transitions.filter(t => t.yearFrom > 2010 && t.yearFrom <= 2016);
  const recent = transitions.filter(t => t.yearFrom > 2016);

  const groups: AgeGroupResult[] = [];

  for (const [label, group] of [
    ['Early Era (2000-2010)', young],
    ['Middle Era (2011-2016)', middle],
    ['Recent Era (2017+)', recent]
  ] as const) {
    if (group.length === 0) continue;

    const k9Deltas = group.map(t => t.statsTo.k9 - t.statsFrom.k9);
    const bb9Deltas = group.map(t => t.statsTo.bb9 - t.statsFrom.bb9);
    const hr9Deltas = group.map(t => t.statsTo.hr9 - t.statsFrom.hr9);
    const fipDeltas = group.map(t => t.statsTo.fip - t.statsFrom.fip);

    groups.push({
      ageGroup: label,
      count: group.length,
      k9Delta: mean(k9Deltas),
      bb9Delta: mean(bb9Deltas),
      hr9Delta: mean(hr9Deltas),
      fipDelta: mean(fipDeltas)
    });
  }

  return groups;
}

async function analyzeLevelAdjustments() {
  console.log('🔬 Test 1: Level Adjustment Analysis');
  console.log('=' .repeat(80));
  console.log('Analyzing stat changes when pitchers move between levels\n');

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
      {
        name: 'K/9',
        current: from === 2 ? '+0.30' : 'N/A',
        ...result.k9Delta
      },
      {
        name: 'BB/9',
        current: from === 2 ? '-0.42' : 'N/A',
        ...result.bb9Delta
      },
      {
        name: 'HR/9',
        current: from === 2 ? '-0.15' : 'N/A',
        ...result.hr9Delta
      },
      {
        name: 'FIP',
        current: 'N/A',
        ...result.fipDelta
      }
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

    // Age group analysis (using era as proxy)
    console.log('\n\nBy Time Period:');
    console.log('─'.repeat(80));

    const ageGroups = analyzeByAgeGroup(trans);

    console.log('Period                   N     K/9 Δ   BB/9 Δ  HR/9 Δ  FIP Δ');
    console.log('─'.repeat(80));

    for (const group of ageGroups) {
      const sign = (val: number) => (val >= 0 ? '+' : '');
      console.log(
        `${group.ageGroup.padEnd(24)} ${group.count.toString().padEnd(5)} ` +
        `${sign(group.k9Delta)}${group.k9Delta.toFixed(2)}`.padEnd(7) + '  ' +
        `${sign(group.bb9Delta)}${group.bb9Delta.toFixed(2)}`.padEnd(7) + '  ' +
        `${sign(group.hr9Delta)}${group.hr9Delta.toFixed(2)}`.padEnd(7) + '  ' +
        `${sign(group.fipDelta)}${group.fipDelta.toFixed(2)}`.padEnd(6)
      );
    }
  }

  // Summary recommendations
  console.log('\n\n' + '═'.repeat(80));
  console.log('💡 RECOMMENDATIONS');
  console.log('═'.repeat(80));

  const aaaToMlb = results.find(r => r.level === 'AAA → MLB');

  if (aaaToMlb) {
    console.log('\n📌 AAA → MLB Adjustments:');
    console.log('─'.repeat(80));

    const recommendations = [
      {
        stat: 'K/9',
        current: 0.30,
        recommended: aaaToMlb.k9Delta.mean,
        change: aaaToMlb.k9Delta.mean - 0.30
      },
      {
        stat: 'BB/9',
        current: -0.42,
        recommended: aaaToMlb.bb9Delta.mean,
        change: aaaToMlb.bb9Delta.mean - (-0.42)
      },
      {
        stat: 'HR/9',
        current: -0.15,
        recommended: aaaToMlb.hr9Delta.mean,
        change: aaaToMlb.hr9Delta.mean - (-0.15)
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

    console.log('\n📝 Notes:');
    console.log(`• Sample size: ${aaaToMlb.sampleSize} transitions`);
    console.log(`• Standard deviations are high (~${aaaToMlb.k9Delta.stdDev.toFixed(1)} for K/9)`);
    console.log('• Individual pitcher variance is significant');
    console.log('• Consider using confidence intervals for projections');
  }

  // Save detailed report
  const reportPath = path.join('tools', 'reports', '1_level_adjustments.json');
  const reportDir = path.dirname(reportPath);

  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  console.log(`\n\n✅ Detailed results saved to: ${reportPath}\n`);
}

analyzeLevelAdjustments().catch(console.error);
