# Next Action: Update HR/9 Adjustment

**Priority**: HIGH
**File**: `src/services/TrueFutureRatingService.ts`
**Lines**: ~72-95 (LEVEL_ADJUSTMENTS constant)

---

## The Change

### Current Code (WRONG - only 103 samples)

```typescript
const LEVEL_ADJUSTMENTS: Record<MinorLeagueLevel, { k9: number; bb9: number; hr9: number }> = {
  aaa: { k9: 0.25, bb9: -0.05, hr9: 0.24 },  // ← HR/9 TOO LOW
  aa: { k9: -0.22, bb9: 0.26, hr9: 0.36 },
  a: { k9: -0.61, bb9: 0.46, hr9: 0.46 },
  r: { k9: -0.76, bb9: 0.88, hr9: 0.61 },
};
```

### Updated Code (CORRECT - 344 samples, OOTP 25+26)

```typescript
const LEVEL_ADJUSTMENTS: Record<MinorLeagueLevel, { k9: number; bb9: number; hr9: number }> = {
  // AAA → MLB (based on 344 samples, OOTP 25+26: 2012-2020)
  aaa: { k9: 0.27, bb9: -0.06, hr9: 0.39 },  // ← HR/9 UPDATED

  // AA → MLB (cumulative: AA→AAA + AAA→MLB)
  // k9: -0.16 + 0.27 = 0.11, bb9: 0.35 + (-0.06) = 0.29, hr9: 0.03 + 0.39 = 0.42
  aa: { k9: 0.11, bb9: 0.29, hr9: 0.42 },

  // A → MLB (cumulative: A→AA + AA→AAA + AAA→MLB)
  // k9: -0.19 + (-0.16) + 0.27 = -0.08, bb9: 0.08 + 0.35 + (-0.06) = 0.37, hr9: 0.09 + 0.03 + 0.39 = 0.51
  a: { k9: -0.08, bb9: 0.37, hr9: 0.51 },

  // Rookie → MLB (cumulative: R→A + A→AA + AA→AAA + AAA→MLB)
  // k9: -0.08 + (-0.19) + (-0.16) + 0.27 = -0.16, bb9: 0.27 + 0.08 + 0.35 + (-0.06) = 0.64, hr9: 0.06 + 0.09 + 0.03 + 0.39 = 0.57
  r: { k9: -0.16, bb9: 0.64, hr9: 0.57 },
};
```

---

## Why This Matters

### Problem
We're under-projecting home runs allowed by **62%** (0.39 vs 0.24).

### Impact Example
AAA prospect with 0.8 HR/9:
- **Current projection**: 1.04 HR/9 in MLB (too optimistic)
- **Should be**: 1.19 HR/9 in MLB (realistic)
- **FIP underestimate**: ~0.20 (making prospects look better than they are)

### Data Quality
- **Sample size**: 344 AAA→MLB transitions (2012-2020)
- **Era**: OOTP 25+26 combined (matches current engine)
- **Confidence**: HIGH (3x more data than initial analysis)
- **Source**: `tools/research/1_level_adjustments_ootp25_26.ts`

---

## Full Context

If you need background, read:
1. `SESSION_SUMMARY.md` - Complete session overview
2. `RESEARCH_SUMMARY.md` - All findings + corrected eras
3. `AGE_ANALYSIS_FINDINGS.md` - Age-adjusted insights
4. `tools/reports/1_level_adjustments_ootp25_26.json` - Raw data (344 samples)

---

## After Making the Change

1. **Test build**: `npm run build` (should pass with no errors)
2. **Validate**: Check a few AAA prospects to see new HR/9 projections
3. **Document**: Update comment in code to reference "344 samples, OOTP 25+26"
4. **(Optional)** Back-test on 2019 prospects → 2020 actuals to verify improvement

---

**Script that generated this**: `tools/research/1_level_adjustments_ootp25_26.ts`
**Date analyzed**: January 30, 2026
