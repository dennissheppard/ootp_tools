# Current TFR Parameters (As of Latest Test)

**Date:** January 30, 2026
**Test Score:** 5/7 passing
**Status:** One threshold adjustment needed (see NEXT_SESSION_START_HERE.md)

---

## Percentile Thresholds

**Location:** `src/services/TrueFutureRatingService.ts` line ~130

```typescript
const PERCENTILE_TO_RATING: Array<{ threshold: number; rating: number }> = [
  { threshold: 95.8, rating: 5.0 },  // Elite: Top 4.2%
  { threshold: 92.0, rating: 4.5 },  // Star: Top 8%
  { threshold: 89.5, rating: 4.0 },  // Above Avg: Top 10.5% ← CHANGE TO 87.0
  { threshold: 74.0, rating: 3.5 },  // Average: Top 26%
  { threshold: 55.0, rating: 3.0 },  // Fringe
  { threshold: 35.0, rating: 2.5 },
  { threshold: 18.0, rating: 2.0 },
  { threshold: 8.0, rating: 1.5 },
  { threshold: 3.0, rating: 1.0 },
  { threshold: 0.0, rating: 0.5 },
];
```

**Pending Change:** threshold 89.5 → **87.0** for 4.0 rating

---

## Confidence Factors

**Location:** `src/services/TrueFutureRatingService.ts` line ~340-380

### Age Factors
```typescript
if (age <= 20) confidence *= 0.84;
else if (age <= 22) confidence *= 0.95;
else if (age <= 24) confidence *= 0.92;
else if (age <= 26) confidence *= 0.97;
// 27+ stays at 1.0
```

### Sample Size (IP) Factors
```typescript
if (totalMinorIp < 50) confidence *= 0.80;
else if (totalMinorIp < 100) confidence *= 0.92;
else if (totalMinorIp < 200) confidence *= 0.95;
// 200+ IP stays at 1.0
```

### Scout-Stat Agreement
```typescript
const scoutStatGap = Math.abs(adjustedFip - scoutFip);
if (scoutStatGap > 2.0) confidence *= 0.75;
else if (scoutStatGap > 1.5) confidence *= 0.93;
else if (scoutStatGap > 1.0) confidence *= 0.97;
// Gap < 1.0 stays at 1.0
```

### Rookie Level Penalty
```typescript
if (levelLower.includes('r') || levelLower.includes('rookie')) {
  confidence *= 0.87;
}
// AAA, AA, A: No penalty
```

### Regression
```typescript
const averageProspectFip = 4.88;
const confidenceFloor = 0.59;
return Math.max(confidenceFloor, confidence);
```

---

## Level Adjustments

**Location:** `src/services/TrueFutureRatingService.ts` line ~94-109

Based on 344 AAA→MLB transitions from OOTP 25+26 (2012-2020):

```typescript
const LEVEL_ADJUSTMENTS = {
  aaa: { k9: 0.27, bb9: -0.06, hr9: 0.39 },  // AAA → MLB
  aa:  { k9: 0.11, bb9: 0.29, hr9: 0.42 },   // AA → MLB (cumulative)
  a:   { k9: -0.08, bb9: 0.37, hr9: 0.51 },  // A → MLB (cumulative)
  r:   { k9: -0.16, bb9: 0.64, hr9: 0.57 },  // Rookie → MLB (cumulative)
};
```

**Key:** HR/9 adjustment critical (+0.39 at AAA level, was under-projecting by 62%)

---

## MLB Comparison Pool

**Ages:** 25-32 only (prime years)
**Count:** 1144 pitchers across 2012-2021
**Avg FIP:** 4.37

**Rationale:**
- Compare peak projections (prospects) vs peak performance (prime MLB)
- Excludes young replacement-level pitchers (ages 21-24)
- Excludes decline years (ages 33+)
- Apples-to-apples comparison

---

## Level Mapping

**Location:** `src/services/TeamRatingsService.ts` line ~337-355

```typescript
switch(level) {
  case 1: return 'MLB';
  case 2: return 'AAA';
  case 3: return 'AA';
  case 4: return 'A';      // Fixed! Was "A+"
  case 5: return 'Short-A'; // Not used in WBL
  case 6: return 'R';       // Fixed! Was "A-"
  case 7: return 'R';
  case 8: return 'DSL';
  default: return `Lvl ${level}`;
}
```

---

## Test Expectations

**Location:** `tools/research/tfr_automated_validation.ts`

| Test | Expectation |
|------|-------------|
| Elite Distribution | 3-7% |
| Above Avg Distribution | 10-20% |
| Average Distribution | 30-45% |
| Top Prospects FIP | 2.80-3.50 |
| Top 200 vs MLB Avg | 3.50-4.30 |
| Peak WAR Range | Top 10 avg: 3-6 WAR, Max ≥4 |
| Level Distribution | AAA: 30-45%, AA: 30-45%, A: 10-25%, Rookie: 5-15% |
| Compression | At least 30% of top 100 below 4.0 TFR |
| Young Prospects | At least 20% of top 100 age ≤22 |

---

## Files Modified This Session

**Core TFR Logic:**
- `src/services/TrueFutureRatingService.ts` - Main algorithm, confidence factors, thresholds
- `src/services/TeamRatingsService.ts` - Level mapping fix, peak WAR calculation

**Testing:**
- `tools/research/tfr_automated_validation.ts` - 7 automated tests
- `tools/research/optimize_tfr_complete.ts` - Complete parameter optimizer (NEW)

**Documentation:**
- `tools/reports/session_summary.md` - Full session documentation
- `tools/reports/CURRENT_TFR_PARAMETERS.md` - This file
- `NEXT_SESSION_START_HERE.md` - Quick start for next session (NEW)
