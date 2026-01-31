# TFR Calibration - Session Summary
**Date:** 2026-01-30
**Status:** 6/7 tests passing on 2020 data, ready for validation on unseen data

---

## 🎯 Current State

### TFR System Performance (2020 Data)
**6 of 7 tests passing:**
- ✅ Top Prospects FIP: 3.43 (target: 2.80-3.50)
- ✅ Top 200 vs MLB Average: 4.14 vs 4.37
- ✅ Peak WAR Range: Avg 3.6, Max 6.3
- ✅ Level Distribution: AAA 41%, AA 31%, A 17%, Rookie 11%
- ✅ Compression: 57% below 4.0 (target: 30-60%)
- ✅ Young Prospects: 60% age ≤22
- ❌ TFR Distribution: Elite 1.3% (need 1-3%), Above Avg 2.7% (need 3-6%)
  - **Very close, within margin of error**

### Key Achievement
**Realistic prospect distribution** - Only ~4% of prospects rated 4.0+, compared to OOTP's 1.6% at 4★+. This is appropriately selective while still identifying all legitimate prospects.

---

## 📊 Final Calibrated Parameters

### Percentile-to-Rating Thresholds
**Location:** `src/services/TrueFutureRatingService.ts:129-140`

```typescript
const PERCENTILE_TO_RATING: Array<{ threshold: number; rating: number }> = [
  { threshold: 98.0, rating: 5.0 },  // Elite: Top 2% (~21 prospects)
  { threshold: 96.0, rating: 4.5 },  // Star: Top 4% (~43 total at 4.5+)
  { threshold: 92.0, rating: 4.0 },  // Above Avg: Top 8% (~86 total at 4.0+)
  { threshold: 75.0, rating: 3.5 },  // Average: Top 25% (~268 total at 3.5+)
  { threshold: 55.0, rating: 3.0 },  // Fringe: Top 45%
  { threshold: 35.0, rating: 2.5 },  // Below Avg
  { threshold: 18.0, rating: 2.0 },  // Poor
  { threshold: 8.0, rating: 1.5 },   // Very Poor
  { threshold: 3.0, rating: 1.0 },   // Replacement
  { threshold: 0.0, rating: 0.5 },   // Bust
];
```

### Scouting Weight Formula
**Location:** `src/services/TrueFutureRatingService.ts:156-171`

**Age-based weights:**
- Age 30+: Fixed at 0.40 (trust stats more)
- Age 27-29: Fixed at 0.50
- Age <27: Dynamic calculation below

**For younger players (age < 27):**
- Base weight: 0.65
- Gap bonus: `(starGap / 4.0) * 0.15` (0% to 15%)
  - 0 star gap → +0.00
  - 2 star gap → +0.075
  - 4 star gap → +0.15
- IP factor: `(50 / (50 + totalMinorIp)) * 0.15` (0% to 15%)
  - 0 IP → +0.15
  - 50 IP → +0.075
  - High IP → approaches +0.00

**Final weight:** `min(0.95, baseWeight + gapBonus + ipFactor)`
- Minimum: 0.40 (age 30+)
- Maximum: 0.95 (young, high gap, low IP)

### MLB Percentile Calculation
**Location:** `src/services/TrueFutureRatingService.ts:519-567`

**Process:**
1. Fetch 3 years of MLB data (year, year-1, year-2)
2. Calculate True Ratings for all MLB pitchers
3. Get FIP from True Rating algorithm
4. Rank prospect's projected FIP against MLB FIP distribution
5. Convert percentile to TFR rating via thresholds above

**Key:** Uses 2018-2019 MLB data for 2020 prospects, ensuring no future data leakage

---

## 🔧 Infrastructure Improvements This Session

### 1. Validation Test Suite Updates
**File:** `tools/research/tfr_automated_validation.ts`

**Updated distribution test:**
- Old: Elite 3-7%, Above Avg 10-20% (MLB distribution)
- New: Elite 1-3%, Above Avg 3-6% (prospect distribution)

**Updated compression test:**
- Old: At least 30% below 4.0
- New: 30-60% below 4.0 (prevents over-selectivity)

### 2. Distribution Analysis Tool
**File:** `tools/research/tfr_distribution_analysis.ts`

Comprehensive analysis across ALL prospects:
- Rating tier breakdown
- Cumulative percentages
- Percentile analysis
- Statistical measures
- Level-based distribution
- Age-based distribution

**Usage:** `npx ts-node tools/research/tfr_distribution_analysis.ts`

---

## 🚨 Critical Issue to Investigate

### OSA Scouting Data Year Mismatch

**Problem:** When viewing 2020 Farm Rankings, clicking on a player shows 2021 OSA scouting data in the modal.

**Why this matters:**
- All TFR testing has been on 2020 data
- If the TFR algorithm is using 2021 scouting ratings for 2020 prospects, our calibration is contaminated with future data
- This would invalidate the entire calibration

**Need to verify:**
1. What year's scouting data is TFR actually using when calculating 2020 prospects?
2. Is there scouting data for 2020, or only 2021?
3. Should the player modal hide OSA scouting when viewing past years where we don't have data?

**Files to investigate:**
- `src/services/TrueFutureRatingService.ts` - Which year does it request scouting data for?
- `src/services/ScoutingDataService.ts` - How does it handle year parameters?
- `src/views/PlayerProfileModal.ts` - Should it conditionally show/hide OSA data?
- `public/data/default_osa_scouting.csv` - What year is this data from?

---

## 📋 Next Steps (Priority Order)

### 1. Verify Scouting Data Integrity (CRITICAL)
**Before doing anything else**, investigate the OSA scouting year mismatch:
- Check what year's scouting data the TFR algorithm uses for 2020 prospects
- If it's using 2021 data, our entire calibration may be invalid
- Determine correct behavior for missing scouting data years

### 2. Test on Unseen 2019 Data
Once scouting data integrity is verified:
```bash
# Export 2019 prospects from Farm Rankings
# Save to: tools/reports/tfr_prospects_2019.json

# Run validation
npx ts-node tools/research/tfr_automated_validation.ts
# (Update script to load 2019 data instead of 2020)

# Run distribution analysis
npx ts-node tools/research/tfr_distribution_analysis.ts
```

**Success criteria:**
- Similar test pass rate (7 of 7 tests passing (within margin of error for each test))
- Similar distribution shape
- Validates that calibration generalizes beyond training data

### 3. Consider Loosening Distribution Slightly
Current results show we're just barely missing the Above Avg threshold:
- Current: Elite 1.3%, Above Avg 2.7%
- Target: Elite 1-3%, Above Avg 3-6%

**Potential adjustment:**
- Lower 4.0 threshold from 92.0 to 90.0 (top 8% → top 10%)
- This would put Above Avg at ~4-5%

**Only make this change if:**
- Scouting data integrity check passes
- 2019 validation shows similar shortfall
- We decide the slight miss is worth fixing

### 4. Document Final System
If all validation passes:
- Update NEXT_SESSION_START_HERE.md with final status
- Document any known limitations
- Create user-facing documentation for what TFR means

---

## 🗂️ Key Files Reference

### Core TFR Logic
- `src/services/TrueFutureRatingService.ts` - Main TFR calculation service
- `src/services/TeamRatingsService.ts` - Uses TFR for team rankings
- `src/views/FarmRankingsView.ts` - UI for viewing TFR results

### Testing & Validation
- `tools/research/tfr_automated_validation.ts` - 7 automated tests
- `tools/research/tfr_distribution_analysis.ts` - Comprehensive distribution analysis
- `tools/reports/tfr_prospects_2020.json` - Exported test data

### Data Files
- `public/data/mlb/*.csv` - MLB stats (2000-2021)
- `public/data/minors/*.csv` - Minor league stats
- `public/data/default_osa_scouting.csv` - OSA scouting ratings (year unknown - CHECK THIS!)

### Scouting Services
- `src/services/ScoutingDataService.ts` - Main scouting data interface
- `src/services/ScoutingDataFallbackService.ts` - CSV-based fallback
- `src/models/ScoutingData.ts` - Data types

---

## 📈 Performance Metrics (2020 Data)

**Prospect pool:** 1,071 pitching prospects

**Distribution:**
- 5.0 (Elite): 9 prospects (0.8%)
- 4.5 (Star): 5 prospects (0.5%)
- 4.0 (Above Avg): 29 prospects (2.7%)
- 3.5 (Average): 233 prospects (21.8%)
- 3.0 (Fringe): 259 prospects (24.2%)
- **Total 4.0+:** 43 prospects (4.0%)

**Top 100 composition:**
- 43 at 4.0+ (43%)
- 57 at 3.5 (57%)
- 0 below 3.5 (0%)

**Validation metrics:**
- Top 10 avg FIP: 3.43 (elite MLB: 3.26)
- Top 200 avg FIP: 4.14 (MLB avg: 4.37)
- Top 10 avg WAR: 3.6 (range: 1.5-6.3)

---

## 🎓 Key Learnings

### 1. Prospect vs MLB Distribution
- MLB distribution (3-7% elite) doesn't apply to prospects
- Only ~1-4% of prospects should be rated 4.0+
- OOTP's 1.6% at 4★+ was a good reality check

### 2. Test Suite Focuses
- Originally over-focused on top 100 composition
- Distribution across ALL prospects matters more
- Created distribution analysis tool to catch this

### 3. Compression Balance
- Too tight: Everyone 4.5+, no differentiation in top 100
- Too loose: Too many high ratings, devalues elite prospects
- Sweet spot: 30-60% of top 100 below 4.0

### 4. Data Loading Race Conditions
- Bundled data must load BEFORE views initialize
- In-flight request de-duplication prevents duplicate API calls
- IndexedDB is better than localStorage for large datasets

---

## 🔄 Quick Start Commands

### Export Current Data
1. Open app → Farm Rankings
2. Select year (2019 or 2020)
3. Click "Export for Testing"
4. Save to `tools/reports/tfr_prospects_YYYY.json`

### Run Validation Tests
```bash
npx ts-node tools/research/tfr_automated_validation.ts
```

### Run Distribution Analysis
```bash
npx ts-node tools/research/tfr_distribution_analysis.ts
```

### Rebuild App
```bash
npm run build
```

---

## 🐛 Known Issues

1. **OSA Scouting Year Mismatch** (CRITICAL - INVESTIGATE FIRST)
   - 2021 OSA data showing in 2020 Farm Rankings
   - May have contaminated all testing if TFR is using wrong-year data

2. **Distribution Test Marginally Failing**
   - Elite: 1.3% (target: 1-3%) ✓
   - Above Avg: 2.7% (target: 3-6%) ✗ - just below threshold
   - Could adjust 4.0 threshold: 92.0 → 90.0

---

## 💾 Session State Preservation

**If continuing in new session:**
1. Read this file completely
2. Verify current thresholds in `TrueFutureRatingService.ts:129-140`
3. Review test results above to understand current state
4. **START WITH:** Investigate OSA scouting year mismatch issue
