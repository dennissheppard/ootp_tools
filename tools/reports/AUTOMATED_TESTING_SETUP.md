# Automated TFR Testing Setup

**Date**: January 30, 2026
**Status**: Testing framework created, IP projections fixed

---

## What Was Fixed

### 1. ✅ IP Projections Now Realistic
**Problem**: All SPs showing 180 IP, all RPs showing 65 IP (fixed values)
**Root Cause**: `TeamRatingsService` used hard-coded IP assumptions

**Fix**: Realistic IP calculation based on stamina and injury proneness
```typescript
// SP IP Calculation
baseIp = 80 + (stamina * 1.8)  // stamina 50 → 170 IP, 70 → 206 IP
projectedIp = baseIp * injuryFactor // Fragile: 0.85x, Durable: 1.10x, etc.

// RP IP Calculation
baseIp = 50 + (stamina * 0.5)  // stamina 30 → 65 IP, 50 → 75 IP
projectedIp = baseIp * injuryFactor
```

**Impact**:
- SP range: 100-220 IP (realistic variation)
- RP range: 40-80 IP (realistic variation)
- Peak WAR now varies more naturally
- High-stamina durables → Higher WAR (more IP)
- Low-stamina fragiles → Lower WAR (fewer IP)

### 2. ✅ Automated Testing Framework Created

Created comprehensive automated testing suite:
- **7 automated tests** validate TFR calibration
- Compare against modern era MLB (OOTP 25+26: 2012-2021)
- Tests distribution, FIP range, WAR range, level balance
- Run anytime after TFR changes (no more manual checking!)

**Test Files**:
- `tools/research/tfr_automated_validation.ts` - Main test suite
- `tools/research/export_tfr_for_testing.ts` - Helper to export TFR data

---

## Automated Tests Overview

### Test 1: TFR Distribution Matches MLB
**Validates**: Rating distribution matches reality
**Expected**: Elite: 3-7%, Above Avg: 10-20%, Average: 30-45%
**Checks**: Are we over-rating everyone? Under-rating?

### Test 2: Top Prospects FIP Range
**Validates**: Elite prospects project in elite FIP range
**Expected**: Top 10 avg: 2.80-3.50 FIP
**Checks**: Are top prospects realistic elite arms?

### Test 3: Top 200 vs MLB Average
**Validates**: Prospects project better than average (they're prospects!)
**Expected**: Top 200 avg: 3.50-4.30 FIP (vs MLB ~4.20)
**Checks**: Are we projecting prospects realistically vs MLB?

### Test 4: Peak WAR Range
**Validates**: Elite prospects show star ceilings
**Expected**: Top 10 avg: 3-6 WAR, Max ≥4 WAR
**Checks**: Are Peak WAR projections realistic?

### Test 5: Level Distribution
**Validates**: Top 100 has balanced level representation
**Expected**: AAA: 30-45%, AA: 30-45%, A: 10-25%, Rookie: 3-10%
**Checks**: Are we over/under-penalizing certain levels?

### Test 6: Distribution Compression
**Validates**: Not everyone rated 4.0+
**Expected**: At least 50% of top 100 below 4.0
**Checks**: Is distribution too compressed?

### Test 7: Young Prospects Represented
**Validates**: High-ceiling young prospects included
**Expected**: At least 20% of top 100 age ≤22
**Checks**: Are we over-penalizing youth?

---

## How to Use Automated Testing

### Step 1: Export TFR Data (One Time Setup)

You need to export TFR data once for the test year. Create a script that:

```typescript
// In your app code or a test script
import { trueFutureRatingService } from './src/services/TrueFutureRatingService';
import * as fs from 'fs';

async function exportForTesting(year: number) {
  // Get TFR data
  const tfrs = await trueFutureRatingService.getProspectTrueFutureRatings(year);

  // Get corresponding RatedProspect data from TeamRatingsService
  const farmData = await teamRatingsService.getFarmData(year);

  // Map to test format
  const prospects = farmData.prospects.map(p => ({
    playerId: p.playerId,
    name: p.name,
    age: p.age,
    level: p.level,
    tfr: p.trueFutureRating,
    projFip: p.peakFip,
    projWar: p.peakWar,
    totalMinorIp: p.stats.ip
  }));

  // Save
  const output = { year, generated: new Date().toISOString(), prospects };
  fs.writeFileSync(`tools/reports/tfr_prospects_${year}.json`, JSON.stringify(output, null, 2));

  console.log(`Exported ${prospects.length} prospects for testing`);
}

exportForTesting(2020);
```

### Step 2: Run Tests

```bash
npx ts-node tools/research/tfr_automated_validation.ts
```

### Step 3: Review Results

Tests will output:
- ✅ Passed tests (green)
- ❌ Failed tests (red) with expected vs actual
- Summary report saved to `tools/reports/tfr_validation_results.json`

### Step 4: Iterate

If tests fail:
1. Review which test failed and why
2. Adjust TFR confidence factors or regression parameters
3. Rebuild and regenerate TFR data
4. Re-run tests
5. Repeat until all tests pass

---

## Current TFR Calibration Status

### After Iteration 2 + IP Fix

**Expected** (based on fixes applied):
- Distribution: More balanced (5-10 elite, spread below)
- Peak WAR: 3-6 for top prospects (up from 1.9)
- Peak IP: 100-220 for SP, 40-80 for RP (was all 180/65)
- Level diversity: 15-25% A-ball in top 100 (was 2%)

**Still Unknown** (need to run automated tests):
- Is distribution actually balanced?
- Are top 200 prospects aligned with MLB average?
- Is compression fixed?
- Are young prospects properly represented?

---

## Why Automated Testing Matters

### Manual Testing Problems
- ❌ Time consuming (30 min → 2 hours)
- ❌ Only checks top 100 (misses tail issues)
- ❌ Subjective ("looks good" vs quantitative)
- ❌ Inconsistent (checking different things each time)
- ❌ Not repeatable (can't easily compare iterations)

### Automated Testing Benefits
- ✅ Fast (runs in seconds)
- ✅ Checks ALL prospects (full distribution)
- ✅ Objective (pass/fail based on data)
- ✅ Consistent (same tests every time)
- ✅ Repeatable (track progress across iterations)
- ✅ Regression prevention (catches future breaks)

### Example: Comparing to MLB Reality

Instead of eyeballing "does 4.50 FIP for 100th prospect seem right?", we:
1. Load modern era MLB data (2012-2021)
2. Calculate actual FIP distribution
3. Compare top 200 prospects to actual MLB
4. **Objectively validate** if projections make sense

---

## Next Steps

### Immediate
1. **Export TFR data** for test year (2020)
   - Run TFR calculation
   - Save to `tools/reports/tfr_prospects_2020.json`

2. **Run automated tests**
   ```bash
   npx ts-node tools/research/tfr_automated_validation.ts
   ```

3. **Review results**
   - Check which tests pass/fail
   - Identify specific issues (distribution? WAR range? Level balance?)

### If Tests Fail
4. **Adjust calibration** based on test feedback
   - Distribution compressed? → Stronger regression
   - WAR too low? → Check IP calculation
   - Young players missing? → Soften age penalty
   - etc.

5. **Rebuild and retest**
   - Make changes to TrueFutureRatingService
   - Rebuild
   - Re-export TFR data
   - Re-run tests

6. **Iterate until all tests pass**

### Once Tests Pass
7. **Add to CI/CD** (optional)
   - Run tests automatically on every TFR change
   - Prevent regressions

8. **Expand tests** (optional)
   - Add historical validation (2012-2019 prospects → 2013-2024 actuals)
   - Test age-specific projections
   - Test breakout detection accuracy

---

## Technical Details

### File Changes

**TeamRatingsService.ts**:
- Added `peakIp` to `RatedProspect` interface
- Replaced fixed IP (180/65) with dynamic calculation
- IP now based on stamina (40-70 → 120-220 IP) and injury

**FarmRankingsView.ts**:
- Now passes `peakIp` to modal via `projectionOverride`
- Ensures table and modal show same numbers

**New Files**:
- `tools/research/tfr_automated_validation.ts` - Test suite
- `tools/research/export_tfr_for_testing.ts` - Export helper

### IP Calculation Formula

**Starters (stamina ≥30, pitches ≥3)**:
```
baseIp = 80 + (stamina * 1.8)
Examples:
  stamina 50 → 170 IP
  stamina 60 → 188 IP
  stamina 70 → 206 IP
```

**Injury Adjustment**:
- Normal: 1.0x
- Fragile: 0.85x
- Durable: 1.10x
- Wrecked: 0.60x
- Ironman: 1.15x

**Relievers (else)**:
```
baseIp = 50 + (stamina * 0.5)
Examples:
  stamina 30 → 65 IP
  stamina 40 → 70 IP
  stamina 50 → 75 IP
```

**Final IP**: Clamped to realistic bounds (SP: 100-220, RP: 40-80)

---

## Modern Era Definition

**Modern Era**: OOTP 25+26 (2012-2021)
- Consistent OOTP engine behavior
- Larger sample size (10 years vs 3-6)
- More representative of current game

**Why not OOTP 23-24?**
- Different patterns (K/9 -3.5 in early years)
- League inception noise
- Smaller samples

---

## Success Criteria

**Automated tests should pass**:
- ✅ Distribution: 3-7% elite, 10-20% above avg
- ✅ Top FIP: 2.80-3.50 for elite
- ✅ Top 200 vs MLB: 3.50-4.30 avg (better than ~4.20)
- ✅ Peak WAR: 3-6 avg for top 10
- ✅ Level balance: 30-45% AAA, 30-45% AA, 10-25% A
- ✅ Not compressed: 50%+ below 4.0 in top 100
- ✅ Young prospects: 20%+ age ≤22 in top 100

**When all pass**:
- TFR calibration is validated
- Safe to build features (breakout detection, etc.)
- Can trust projections for roster decisions

---

**Status**: Testing framework ready. Export TFR data and run tests to validate calibration.
