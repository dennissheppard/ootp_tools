# 2017 Calibration Setup Complete ✅

## What's Been Done

I've set up a complete 2017-based calibration workflow using your My Scout data. This addresses the data contamination issue and provides rigorous validation.

### ✅ Created Files

1. **tools/research/load_2017_scouting_data.ts**
   - Parses and validates your 2017 CSV files
   - Confirms: 2,818 pitchers in both My Scout and OSA
   - Perfect overlap (same players in both files)
   - Scout accuracy distribution captured: Very High (47%), High (24%), Average (19%), Low (10%)

2. **tools/research/load_2017_data.html**
   - Browser-based loader for scouting data
   - One-click "Load Both" button
   - Verification tool
   - Saves data to IndexedDB with key `2017-01-01`

3. **tools/research/tfr_2017_validation.ts**
   - Comprehensive validation suite
   - Tracks prospects through 2018-2021
   - Tests: Level adjustments, trajectory, MLB performance, correlations

4. **tools/research/2017_calibration_workflow.md**
   - Step-by-step instructions
   - Troubleshooting guide
   - Success criteria
   - Complete documentation

### ✅ Data Verified

Ran the parser on your CSV files:
- **My Scout**: 2,818 ratings with pitches (FBP, CHP, CBP, SLP, etc.)
- **OSA**: 2,818 ratings (same players)
- All have OVR/POT, Stuff/Control/HRA, Stamina
- New fields captured: POS, DOB, Scout Accuracy

## Next Steps (In Order)

### Step 1: Load the 2017 Scouting Data

**Option A - HTML Loader (Easiest):**
```bash
npm run dev
# Then open: http://localhost:5173/tools/research/load_2017_data.html
# Click: "Load Both"
# Click: "Verify Data"
```

**Option B - Data Management View:**
- Open app → Data Management
- Upload `2017_scouting_ratings.csv` as "My Scout" with date `2017-01-01`
- Upload `2017_OSA_ratings.csv` as "OSA" with date `2017-01-01`

### Step 2: Export 2017 TFR Projections

1. In the app, go to "Farm Rankings"
2. Change year dropdown: 2021 → **2017**
3. Wait for data to load (will use your 2017 scouting + 2015-2017 MLB percentiles)
4. Click "Export for Testing"
5. Save as: `tools/reports/tfr_prospects_2017.json`

### Step 3: Run Validation

```bash
npx ts-node tools/research/tfr_2017_validation.ts
```

This will:
- ✅ Track AAA→MLB transitions (2017-2021) and validate level adjustments
- ✅ Analyze progression speed/quality by TFR tier
- ✅ Compare actual vs projected MLB performance
- ✅ Calculate correlation between TFR and outcomes

**Success criteria:**
- Level adjustments MAE < 1.0 (K/9), < 0.5 (BB/9), < 0.4 (HR/9)
- High-TFR prospects reach MLB at higher rate (>50% for 4.0+)
- Correlation (TFR vs actual FIP) > 0.4
- Elite prospects (4.0+) avg MLB FIP < 4.00

## What This Fixes

### ❌ Old Approach (2020 data)
- Used 2021 scouting data for 2020 prospects (data leakage)
- No outcome data to validate (we're "in" 2021)
- Calibration contaminated with future information

### ✅ New Approach (2017 data)
- Uses 2017 scouting data for 2017 prospects (no leakage)
- 4 years of outcome data (2018-2021) to validate
- Can see who actually succeeded vs. failed
- Proper train/test split

## Data Requirements

You'll need these files for validation to work:

**Minor League Stats (2017-2021):**
- `public/data/minors/2017_aaa.csv` through `2021_aaa.csv`
- `public/data/minors/2017_aa.csv` through `2021_aa.csv`
- `public/data/minors/2017_a.csv` through `2021_a.csv`
- `public/data/minors/2017_r.csv` through `2021_r.csv`

**MLB Stats (2015-2021):**
- `public/data/mlb/2015.csv` through `2021.csv`

The validation script will warn you which files are missing.

## Calibration Philosophy (Answered)

**Q: Should we calibrate on OSA or My Scout?**

**A: My Scout (better data)**

Why:
1. The scouting weight formula should be universal - it calculates "how much to trust scouting" based on age, gap, IP
2. If calibrated on good data (My Scout), the formula works correctly regardless of scout quality
3. OSA performing worse is *expected behavior* - the scout is less accurate, not the formula
4. Most engaged users eventually get My Scout data

The formula will still use OSA data when that's all that's available - it just won't predict as accurately because the scouting inputs are lower quality. This is correct.

## Quick Reference

**Parse data (verify CSVs):**
```bash
npx ts-node tools/research/load_2017_scouting_data.ts
```

**Load data (browser):**
```
http://localhost:5173/tools/research/load_2017_data.html
```

**Export TFRs:**
Farm Rankings → Year: 2017 → Export for Testing

**Validate:**
```bash
npx ts-node tools/research/tfr_2017_validation.ts
```

## Files Created

```
tools/research/
├── load_2017_scouting_data.ts  # Data parser/validator
├── load_2017_data.html          # Browser loader
├── tfr_2017_validation.ts       # Validation suite
└── 2017_calibration_workflow.md # Full documentation

public/data/
├── 2017_scouting_ratings.csv    # My Scout (2,818 pitchers)
└── 2017_OSA_ratings.csv         # OSA (2,818 pitchers)

tools/reports/ (after export)
├── 2017_scouting_my_parsed.json      # Parsed My Scout JSON
├── 2017_scouting_osa_parsed.json     # Parsed OSA JSON
├── tfr_prospects_2017.json           # Exported TFRs (from app)
├── 2017_level_adjustments.json       # Validation results
├── 2017_trajectory.json              # Validation results
└── 2017_mlb_performance.json         # Validation results
```

## What Happens Next?

After validation completes, you'll have:
1. **Hard numbers** on whether the current TFR formula works (MAE, correlations, etc.)
2. **Specific areas to improve** if tests fail (e.g., "HR/9 adjustments too aggressive")
3. **Confidence** that the calibration generalizes (tested on unseen data)

Then you can iterate:
- Adjust parameters in `TrueFutureRatingService.ts`
- Re-export 2017 prospects
- Re-validate
- Repeat until tests pass

Ready to start?
1. Load the data (Step 1 above)
2. Export TFRs (Step 2 above)
3. Run validation (Step 3 above)
