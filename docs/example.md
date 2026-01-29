Key Findings                                                                                                                                                                                                                         
  Actual Performance by Quartile:                                                                                                                                                                                                                                                                                                                                                       
  1. Q1 (Elite): FIP 3.43, K9 6.61, BB9 1.86, HR9 0.56
  2. Q2 (Good): FIP 3.91, K9 5.99, BB9 2.23, HR9 0.71
  3. Q3 (Avg): FIP 4.24, K9 6.06, BB9 2.57, HR9 0.87
  4. Q4 (Below Avg): FIP 4.75, K9 5.74, BB9 2.96, HR9 1.08

  Critical Issue Discovered

  Your league average constants in TrueRatingsCalculationService.ts are WRONG:

  src/services/TrueRatingsCalculationService.ts:143-147
  const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = {
    avgK9: 7.5,    // ❌ WRONG! Actual is ~6.1
    avgBb9: 3.0,   // ❌ WRONG! Actual is ~2.4
    avgHr9: 0.85,  // ✅ Close (actual ~0.8)
  };

  The system regresses historical performance toward incorrect league averages, causing systematic bias:
  - Elite pitchers get regressed UP toward 7.5 K9 (too high) instead of 6.1
  - Elite pitchers get regressed UP toward 3.0 BB9 (too high) instead of 2.4

  Root Cause Analysis

  Looking at the FIP formula weights:
  - K9 has -2 coefficient (higher K9 = better FIP)
  - BB9 has +3 coefficient (higher BB9 = worse FIP)
  - HR9 has +13 coefficient (higher HR9 = much worse FIP)

  Your current regression target adjustment ratios in TrueRatingsCalculationService.ts:461-471:
  - K9: targetOffset * 0.5
  - BB9: targetOffset * 0.3
  - HR9: targetOffset * 0.1

  This only produces 36% of the intended FIP change! Here's why:

  For targetOffset = -1.0 (wanting 1.0 better FIP):
  - K9 impact: (-2 × 0.5) / 9 = -0.111 FIP improvement
  - BB9 impact: (3 × -0.3) / 9 = -0.100 FIP improvement
  - HR9 impact: (13 × -0.1) / 9 = -0.144 FIP improvement
  - Total: -0.355 FIP change (need -1.0!)

  Recommended Fixes

  Fix 1: Correct League Averages (CRITICAL)

  Update src/services/TrueRatingsCalculationService.ts:
  const DEFAULT_LEAGUE_AVERAGES: LeagueAverages = {
    avgK9: 6.1,    // Was 7.5
    avgBb9: 2.4,   // Was 3.0
    avgHr9: 0.8,   // Was 0.85
  };

  Fix 2: Recalibrate Regression Target Ratios

  The current ratios (0.5, 0.3, 0.1) need to sum to produce the full FIP change. Here are the mathematically correct ratios:

  // In regressToLeagueMean(), around line 461-471:
  switch (statType) {
    case 'k9':
      regressionTarget = leagueRate - (targetOffset * 1.25);  // Was 0.5
      break;
    case 'bb9':
      regressionTarget = leagueRate + (targetOffset * 0.75);  // Was 0.3
      break;
    case 'hr9':
      regressionTarget = leagueRate + (targetOffset * 0.14);  // Was 0.1
      break;
  }

  These ratios distribute the FIP adjustment proportionally:
  - K9 gets 50% of the weight (2/4 total weight units)
  - BB9 gets 37.5% (1.5/4)
  - HR9 gets 12.5% (0.5/4)

  Would you like me to make these changes to the code?