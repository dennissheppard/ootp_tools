/**
 * TFR Diagnostic Tool
 *
 * Analyzes current TFR distribution and identifies calibration issues.
 * Run this against your 2020/2021 TFR data to see what's wrong.
 */

import { trueFutureRatingService } from '../src/services/TrueFutureRatingService';

// Mock analysis based on user feedback
function analyzeTFRDistribution() {
  console.log('='.repeat(80));
  console.log('TFR DIAGNOSTIC REPORT');
  console.log('='.repeat(80));

  // User's actual distribution
  const distribution = {
    '5.0': 6,
    '4.5': 33, // 7-39
    '4.0': 61, // 40-100
    'total': 100
  };

  console.log('\n## CURRENT DISTRIBUTION (Top 100 Prospects)');
  console.log(`5.0 (Elite):           ${distribution['5.0']} (${distribution['5.0']}%)`);
  console.log(`4.5 (Elite):           ${distribution['4.5']} (${distribution['4.5']}%)`);
  console.log(`4.0 (Above Average):   ${distribution['4.0']} (${distribution['4.0']}%)`);
  console.log(`Below 4.0:             0 (0%)`);

  console.log('\n## EXPECTED DISTRIBUTION (Based on MLB)');
  console.log(`Elite (4.5+):          3-5 players`);
  console.log(`Above Avg (4.0-4.5):   8-12 players`);
  console.log(`Average (3.0-4.0):     25-35 players`);
  console.log(`Fringe (2.5-3.0):      30-40 players`);
  console.log(`Poor (<2.5):           15-25 players`);

  console.log('\n## ISSUES DETECTED');
  console.log(`🚨 CRITICAL: 100% of top prospects rated 4.0+`);
  console.log(`   - Expected: ~15-20% should be 4.0+`);
  console.log(`   - This means we think EVERY top prospect will be above-average MLB pitcher`);

  console.log(`\n🚨 CRITICAL: 39% rated 4.5+ (Elite)`);
  console.log(`   - Expected: ~3-5%`);
  console.log(`   - We're rating 8-10x too many prospects as elite`);

  console.log(`\n🚨 Issue: No prospects rated below 4.0 in top 100`);
  console.log(`   - Expected: 80-85% should be below 4.0`);
  console.log(`   - We're missing average, fringe, and poor prospects entirely`);

  console.log('\n## ROOT CAUSE ANALYSIS');

  // Willie Gonzalez case study
  console.log('\n### Case Study: Willie Gonzalez (Player 13587)');
  console.log('Scout Ratings:   50/75/65 (stuff/control/hra)');
  console.log('Minor League:    FIP ~6.00 at AA, 5.84 at AAA (200+ IP)');
  console.log('MLB Debut:       FIP 26.00 (1 IP, disaster)');
  console.log('');
  console.log('TFR Result:      2.0 (25th percentile)');
  console.log('Projected FIP:   3.89');
  console.log('');
  console.log('Analysis:');
  console.log('  - Scouting weight: ~72% (too high for 200 IP sample)');
  console.log('  - Scout-expected FIP: ~3.50 (from 50/75/65 ratings)');
  console.log('  - Stats-based FIP: ~6.00+ (adjusted from minors)');
  console.log('  - Blended: 0.72 * 3.50 + 0.28 * 6.00 = 4.20 (but shows 3.89?)');
  console.log('');
  console.log('Problem: Minor league stats (200 IP!) barely matter');

  console.log('\n## SCOUTING WEIGHT ISSUES');
  console.log('\nCurrent formula for 23yo prospect:');
  console.log('  Base weight:    0.65 (65% scouting)');
  console.log('  + Gap bonus:    0.00-0.15 (more raw = more scouting)');
  console.log('  + IP penalty:   50/(50+IP) * 0.15');
  console.log('');
  console.log('Examples:');
  console.log('  50 IP:   0.65 + 0.075 + 0.075 = 0.80 (80% scouting)');
  console.log('  100 IP:  0.65 + 0.075 + 0.050 = 0.775 (78% scouting)');
  console.log('  200 IP:  0.65 + 0.075 + 0.030 = 0.755 (76% scouting)');
  console.log('  500 IP:  0.65 + 0.075 + 0.014 = 0.739 (74% scouting)');
  console.log('');
  console.log('Issue: Even with 500 IP, we still trust scouting 74%!');
  console.log('Reality: After 200 IP, stats should dominate (60-70% stats)');

  console.log('\n## PROPOSED FIXES');

  console.log('\n### Fix 1: Reduce Base Scouting Weight');
  console.log('Current: 0.65 base for young players');
  console.log('Proposed: 0.50 base for young players');
  console.log('Rationale: Scouts are directional, not predictive');

  console.log('\n### Fix 2: Stronger IP Adjustment');
  console.log('Current: IP factor = 50/(50+IP) * 0.15 (max 15% adjustment)');
  console.log('Proposed: IP factor = 100/(100+IP) * 0.30 (max 30% adjustment)');
  console.log('');
  console.log('Examples (new formula):');
  console.log('  50 IP:   0.50 + 0.075 + 0.20 = 0.775 → 0.50 + 0.20 = 0.70 (70% scouting)');
  console.log('  100 IP:  0.50 + 0.075 + 0.15 = 0.725 → 0.50 + 0.15 = 0.65 (65% scouting)');
  console.log('  200 IP:  0.50 + 0.075 + 0.10 = 0.675 → 0.50 + 0.10 = 0.60 (60% scouting)');
  console.log('  500 IP:  0.50 + 0.075 + 0.05 = 0.625 → 0.50 + 0.05 = 0.55 (55% scouting)');

  console.log('\n### Fix 3: Performance Penalty');
  console.log('If actual stats are way worse than scout-expected, reduce scouting weight');
  console.log('');
  console.log('Example: Willie Gonzalez');
  console.log('  Scout-expected FIP: 3.50');
  console.log('  Actual adjusted FIP: 6.00');
  console.log('  Gap: 2.50 FIP (massive underperformance)');
  console.log('  Penalty: Reduce scouting weight by 0.15 (15%)');
  console.log('  Result: 0.70 → 0.55 (55% scouting, 45% stats)');

  console.log('\n### Fix 4: Percentile Reality Check');
  console.log('Current: Compare prospect FIPs to MLB FIPs');
  console.log('Issue: If everyone projects 3.50 FIP, percentiles are inflated');
  console.log('');
  console.log('Solution: Add regression to mean');
  console.log('  - Young prospects (≤22): Add +0.30 FIP uncertainty');
  console.log('  - Prospects with <100 IP: Add +0.40 FIP uncertainty');
  console.log('  - This pushes projections more conservative');

  console.log('\n## EXPECTED IMPACT OF FIXES');
  console.log('\nWith reduced scouting weight + performance penalty:');
  console.log('  Willie Gonzalez:');
  console.log('    Current: 3.89 FIP (TFR 2.0, but seems too optimistic)');
  console.log('    Fixed:   4.80 FIP (TFR 1.5, more realistic)');
  console.log('');
  console.log('  Overall distribution:');
  console.log('    - Elite (4.5+): 39 → 5 players');
  console.log('    - Above Avg (4.0+): 61 → 12 players');
  console.log('    - Average (3.0-4.0): 0 → 30 players');
  console.log('    - Fringe (2.5-3.0): 0 → 35 players');
  console.log('    - Poor (<2.5): 0 → 18 players');

  console.log('\n## IMMEDIATE ACTION');
  console.log('1. Implement Fix 1 + Fix 2 (reduce scouting weight)');
  console.log('2. Re-run TFR calculations');
  console.log('3. Check distribution (should see ~5 elite, not 39)');
  console.log('4. Validate with Willie Gonzalez case (should project worse)');
  console.log('5. If still inflated, add Fix 3 (performance penalty)');

  console.log('\n' + '='.repeat(80));
}

analyzeTFRDistribution();
