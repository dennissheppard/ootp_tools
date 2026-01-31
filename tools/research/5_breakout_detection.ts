/**
 * Test 5: Breakout Detection Analysis
 *
 * Identifies year-over-year improvement patterns in minor leagues that
 * predict MLB success.
 *
 * Key Questions:
 * 1. What improvement patterns (K/9 gains, BB/9 drops) lead to MLB success?
 * 2. Do breakouts at different levels predict differently?
 * 3. What's the success rate of breakout players?
 */

import { buildCareerProfiles, CareerArc } from './lib/careerLinker';
import { mean } from './lib/dataLoader';
import * as fs from 'fs';
import * as path from 'path';

interface Breakout {
  player_id: number;
  breakoutYear: number;
  breakoutLevel: number;
  breakoutLevelName: string;
  yearBeforeStats: {
    k9: number;
    bb9: number;
    hr9: number;
    fip: number;
    ip: number;
  };
  breakoutYearStats: {
    k9: number;
    bb9: number;
    hr9: number;
    fip: number;
    ip: number;
  };
  improvements: {
    k9Gain: number;
    bb9Drop: number;
    hr9Drop: number;
    fipDrop: number;
  };
  mlbOutcome: {
    reachedMLB: boolean;
    yearsToMLB?: number;
    mlbSeasons: number;
    avgMLBFip?: number;
    totalMLBIP: number;
    successful: boolean; // FIP < 4.0 with 100+ IP
  };
}

function getLevelName(level_id: number): string {
  switch (level_id) {
    case 1: return 'MLB';
    case 2: return 'AAA';
    case 3: return 'AA';
    case 4: return 'A';
    case 6: return 'Rookie';
    default: return 'Unknown';
  }
}

function detectBreakouts(
  careers: Map<number, CareerArc>,
  criteria: {
    minK9Gain: number;
    minBB9Drop: number;
    minFIPDrop: number;
    minIPBefore: number;
    minIPBreakout: number;
  }
): Breakout[] {
  const breakouts: Breakout[] = [];

  for (const [pid, career] of careers) {
    // Only look at minor league breakouts
    const minorSeasons = career.seasons.filter(s => s.level_id > 1).sort((a, b) => a.year - b.year);

    for (let i = 1; i < minorSeasons.length; i++) {
      const prev = minorSeasons[i - 1];
      const curr = minorSeasons[i];

      // Must be same level or promotion (not demotion)
      if (curr.level_id > prev.level_id) continue;

      // Check IP minimums
      if (prev.stats.ip < criteria.minIPBefore || curr.stats.ip < criteria.minIPBreakout) continue;

      // Calculate improvements
      const k9Gain = curr.stats.k9 - prev.stats.k9;
      const bb9Drop = prev.stats.bb9 - curr.stats.bb9;
      const hr9Drop = prev.stats.hr9 - curr.stats.hr9;
      const fipDrop = prev.stats.fip - curr.stats.fip;

      // Check if meets breakout criteria
      if (
        k9Gain >= criteria.minK9Gain &&
        bb9Drop >= criteria.minBB9Drop &&
        fipDrop >= criteria.minFIPDrop
      ) {
        // Analyze MLB outcome
        const mlbSeasons = career.seasons.filter(s => s.level_id === 1);
        const reachedMLB = mlbSeasons.length > 0;
        const totalMLBIP = mlbSeasons.reduce((sum, s) => sum + s.stats.ip, 0);
        const yearsToMLB = reachedMLB
          ? mlbSeasons[0].year - curr.year
          : undefined;

        let avgMLBFip: number | undefined;
        let successful = false;

        if (totalMLBIP >= 100) {
          avgMLBFip = mlbSeasons.reduce((sum, s) => sum + s.stats.fip * s.stats.ip, 0) / totalMLBIP;
          successful = avgMLBFip < 4.0;
        }

        breakouts.push({
          player_id: pid,
          breakoutYear: curr.year,
          breakoutLevel: curr.level_id,
          breakoutLevelName: getLevelName(curr.level_id),
          yearBeforeStats: {
            k9: prev.stats.k9,
            bb9: prev.stats.bb9,
            hr9: prev.stats.hr9,
            fip: prev.stats.fip,
            ip: prev.stats.ip
          },
          breakoutYearStats: {
            k9: curr.stats.k9,
            bb9: curr.stats.bb9,
            hr9: curr.stats.hr9,
            fip: curr.stats.fip,
            ip: curr.stats.ip
          },
          improvements: {
            k9Gain,
            bb9Drop,
            hr9Drop,
            fipDrop
          },
          mlbOutcome: {
            reachedMLB,
            yearsToMLB,
            mlbSeasons: mlbSeasons.length,
            avgMLBFip,
            totalMLBIP,
            successful
          }
        });
      }
    }
  }

  return breakouts;
}

async function analyzeBreakouts() {
  console.log('🔬 Test 5: Breakout Detection Analysis');
  console.log('=' .repeat(80));
  console.log('Identifying improvement patterns that predict MLB success\n');

  // Use full OOTP 26 era for better sample size
  const startYear = 2014; // OOTP 25 + 26 combined for more data
  const endYear = 2020;

  console.log(`Building career profiles (${startYear}-${endYear})...`);
  const careers = buildCareerProfiles(startYear, endYear);

  // Define breakout criteria
  const criteria = {
    minK9Gain: 1.0, // K/9 improved by at least 1.0
    minBB9Drop: 0.3, // BB/9 dropped by at least 0.3
    minFIPDrop: 0.5, // FIP dropped by at least 0.5
    minIPBefore: 40, // At least 40 IP year before
    minIPBreakout: 40 // At least 40 IP in breakout year
  };

  console.log('\n📊 Breakout Criteria:');
  console.log(`  • K/9 gain: ≥ ${criteria.minK9Gain}`);
  console.log(`  • BB/9 drop: ≥ ${criteria.minBB9Drop}`);
  console.log(`  • FIP drop: ≥ ${criteria.minFIPDrop}`);
  console.log(`  • Minimum IP: ${criteria.minIPBefore} (both seasons)\n`);

  const breakouts = detectBreakouts(careers, criteria);

  console.log(`\n✅ Found ${breakouts.length} breakout seasons\n`);

  // Analyze by level
  console.log('═'.repeat(80));
  console.log('📈 Breakouts by Level');
  console.log('═'.repeat(80));

  const byLevel = new Map<string, Breakout[]>();
  for (const breakout of breakouts) {
    const level = breakout.breakoutLevelName;
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level)!.push(breakout);
  }

  console.log('\nLevel   Count  MLB%   Success%  Avg Years to MLB  Avg MLB FIP');
  console.log('─'.repeat(80));

  for (const [level, group] of byLevel) {
    const reachedMLB = group.filter(b => b.mlbOutcome.reachedMLB);
    const successful = group.filter(b => b.mlbOutcome.successful);
    const mlbPct = (reachedMLB.length / group.length) * 100;
    const successPct = (successful.length / group.length) * 100;

    const yearsToMLB = reachedMLB
      .filter(b => b.mlbOutcome.yearsToMLB !== undefined)
      .map(b => b.mlbOutcome.yearsToMLB!);
    const avgYearsToMLB = yearsToMLB.length > 0 ? mean(yearsToMLB) : 0;

    const mlbFips = reachedMLB
      .filter(b => b.mlbOutcome.avgMLBFip !== undefined)
      .map(b => b.mlbOutcome.avgMLBFip!);
    const avgMLBFip = mlbFips.length > 0 ? mean(mlbFips) : 0;

    console.log(
      `${level.padEnd(7)} ${group.length.toString().padEnd(6)} ` +
      `${mlbPct.toFixed(1)}%`.padEnd(7) +
      `${successPct.toFixed(1)}%`.padEnd(9) +
      `${avgYearsToMLB.toFixed(1)}`.padEnd(17) +
      `${avgMLBFip > 0 ? avgMLBFip.toFixed(2) : 'N/A'}`
    );
  }

  // Overall success rates
  console.log('\n\n═'.repeat(80));
  console.log('🎯 Overall Success Metrics');
  console.log('═'.repeat(80));

  const reachedMLB = breakouts.filter(b => b.mlbOutcome.reachedMLB);
  const successful = breakouts.filter(b => b.mlbOutcome.successful);

  console.log(`\nTotal Breakouts: ${breakouts.length}`);
  console.log(`Reached MLB: ${reachedMLB.length} (${(reachedMLB.length / breakouts.length * 100).toFixed(1)}%)`);
  console.log(`MLB Success (FIP < 4.0, 100+ IP): ${successful.length} (${(successful.length / breakouts.length * 100).toFixed(1)}%)`);

  if (reachedMLB.length > 0) {
    const avgYearsToMLB = mean(
      reachedMLB.filter(b => b.mlbOutcome.yearsToMLB !== undefined).map(b => b.mlbOutcome.yearsToMLB!)
    );
    console.log(`Average time to MLB: ${avgYearsToMLB.toFixed(1)} years`);
  }

  // Improvement magnitude analysis
  console.log('\n\n═'.repeat(80));
  console.log('📊 Improvement Magnitude (Successful vs. Failed)');
  console.log('═'.repeat(80));

  const successfulBreakouts = breakouts.filter(b => b.mlbOutcome.successful);
  const failedBreakouts = breakouts.filter(b => !b.mlbOutcome.successful);

  console.log('\nMetric       Successful    Failed    Difference');
  console.log('─'.repeat(80));

  const successK9Gain = successfulBreakouts.length > 0
    ? mean(successfulBreakouts.map(b => b.improvements.k9Gain))
    : 0;
  const failedK9Gain = failedBreakouts.length > 0
    ? mean(failedBreakouts.map(b => b.improvements.k9Gain))
    : 0;

  const successBB9Drop = successfulBreakouts.length > 0
    ? mean(successfulBreakouts.map(b => b.improvements.bb9Drop))
    : 0;
  const failedBB9Drop = failedBreakouts.length > 0
    ? mean(failedBreakouts.map(b => b.improvements.bb9Drop))
    : 0;

  const successFIPDrop = successfulBreakouts.length > 0
    ? mean(successfulBreakouts.map(b => b.improvements.fipDrop))
    : 0;
  const failedFIPDrop = failedBreakouts.length > 0
    ? mean(failedBreakouts.map(b => b.improvements.fipDrop))
    : 0;

  console.log(
    `K/9 Gain     +${successK9Gain.toFixed(2)}`.padEnd(18) +
    `+${failedK9Gain.toFixed(2)}`.padEnd(10) +
    `+${(successK9Gain - failedK9Gain).toFixed(2)}`
  );
  console.log(
    `BB/9 Drop    +${successBB9Drop.toFixed(2)}`.padEnd(18) +
    `+${failedBB9Drop.toFixed(2)}`.padEnd(10) +
    `+${(successBB9Drop - failedBB9Drop).toFixed(2)}`
  );
  console.log(
    `FIP Drop     +${successFIPDrop.toFixed(2)}`.padEnd(18) +
    `+${failedFIPDrop.toFixed(2)}`.padEnd(10) +
    `+${(successFIPDrop - failedFIPDrop).toFixed(2)}`
  );

  // Recommendations
  console.log('\n\n═'.repeat(80));
  console.log('💡 RECOMMENDATIONS');
  console.log('═'.repeat(80));

  console.log('\n1. **Breakout Threshold Tuning**:');
  if (successful.length / breakouts.length < 0.2) {
    console.log('   ⚠️  Low success rate - consider tightening criteria');
    console.log('   • Increase K/9 gain requirement');
    console.log('   • Require larger FIP drops');
  } else if (successful.length / breakouts.length > 0.5) {
    console.log('   ✅ High success rate - criteria are predictive');
    console.log('   • Consider loosening criteria to catch more breakouts');
  }

  console.log('\n2. **Level-Specific Insights**:');
  for (const [level, group] of byLevel) {
    const mlbPct = (group.filter(b => b.mlbOutcome.reachedMLB).length / group.length) * 100;
    if (mlbPct > 60) {
      console.log(`   ✅ ${level} breakouts are highly predictive (${mlbPct.toFixed(0)}% reach MLB)`);
    } else if (mlbPct < 40) {
      console.log(`   ⚠️  ${level} breakouts less reliable (${mlbPct.toFixed(0)}% reach MLB)`);
    }
  }

  console.log('\n3. **Application to Projections**:');
  console.log('   • Flag players with recent breakout patterns');
  console.log('   • Boost projection confidence for breakout players');
  console.log('   • Weight recent breakout season more heavily');
  console.log('   • Track multi-year improvement trends\n');

  // Save detailed results
  const reportPath = path.join('tools', 'reports', '5_breakout_detection.json');
  fs.writeFileSync(reportPath, JSON.stringify(breakouts, null, 2));

  console.log(`✅ Detailed results saved to: ${reportPath}\n`);
}

analyzeBreakouts().catch(console.error);
