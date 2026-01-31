# 2017 TFR Calibration Workflow

This document outlines the complete workflow for calibrating and validating the True Future Rating (TFR) system using 2017 scouting data and validating against 2018-2021 outcomes.

## Overview

**Goal**: Use 2017 scouting/stats data to calculate TFRs, then validate against 2018-2021 actual performance.

**Key Insight**: We don't need prospects to reach age 27 to validate. We can check:
- Level adjustment accuracy (AAA→MLB transitions)
- Short-term trajectory (high-TFR prospects progress faster)
- Early MLB performance (ages 22-25 actual vs projected)
- Percentile ranking accuracy

## Step 1: Load 2017 Scouting Data

### Method A: Using HTML Loader (Recommended)

1. Start your dev server:
   ```bash
   npm run dev
   ```

2. Open `http://localhost:5173/tools/research/load_2017_data.html` in your browser

3. Click "Load Both" to load both My Scout and OSA data

4. Click "Verify Data" to confirm data was saved

### Method B: Manual Browser Console

1. Start your dev server and open the app: `http://localhost:5173`

2. Open browser console and run:
   ```javascript
   // Load My Scout data
   const myResponse = await fetch("/data/2017_scouting_ratings.csv");
   const myCsv = await response.text();
   const myRatings = scoutingDataService.parseScoutingCsv(myCsv, "my");
   await scoutingDataService.saveScoutingRatings("2017-01-01", myRatings, "my");
   console.log(`✅ Saved ${myRatings.length} My Scout ratings`);

   // Load OSA data
   const osaResponse = await fetch("/data/2017_OSA_ratings.csv");
   const osaCsv = await osaResponse.text();
   const osaRatings = scoutingDataService.parseScoutingCsv(osaCsv, "osa");
   await scoutingDataService.saveScoutingRatings("2017-01-01", osaRatings, "osa");
   console.log(`✅ Saved ${osaRatings.length} OSA ratings`);
   ```

3. Verify data:
   ```javascript
   const verify = await scoutingDataService.getScoutingRatings(2017, 'my');
   console.log(`Found ${verify.length} My Scout ratings for 2017`);
   ```

## Step 2: Calculate and Export 2017 TFRs

1. Open the app: `http://localhost:5173`

2. Navigate to "Farm Rankings" view

3. Change the year dropdown from 2021 to **2017**

4. Wait for data to load (you should see prospects with TFRs)

5. Click "Export for Testing" button

6. Save the file as: `tools/reports/tfr_prospects_2017.json`

**What this export contains:**
- All prospects with TFRs calculated using 2017 scouting data
- 2015-2017 MLB stats used for percentile distribution
- Minor league stats from 2017
- Scouting ratings from 2017

## Step 3: Validate Against 2018-2021 Outcomes

Run the validation script:
```bash
npx ts-node tools/research/tfr_2017_validation.ts
```

This script will analyze:

### A. Level Adjustment Accuracy
- Track players who went AAA→MLB between 2017-2021
- Compare actual stat changes to our adjustment formulas
- Report MAE (mean absolute error) for K/9, BB/9, HR/9 adjustments

### B. Trajectory Validation
- Do high-TFR prospects progress faster (reach AAA/MLB sooner)?
- Do they maintain/improve stats as they climb levels?
- Are low-TFR prospects stalling or regressing?

### C. Early MLB Performance
- Prospects who reached MLB by 2018-2021 (ages 22-25, not peak yet)
- Compare actual MLB FIP/WAR to TFR projections
- Calculate correlation between TFR and actual performance

### D. Percentile Ranking
- Were "top 2%" TFR prospects actually elite MLB performers?
- Do percentile rankings correlate with actual outcomes?

## Step 4: Iterate on Calibration

Based on validation results, adjust parameters in `TrueFutureRatingService.ts`:

### If level adjustments are off:
- Modify `LEVEL_ADJUSTMENTS` constants (lines 93-105)
- Example: If AAA→MLB HR/9 is too aggressive, reduce the multiplier

### If scouting weight is wrong:
- Modify scouting weight formula (lines 156-171)
- Adjust base weight, gap bonus, or IP factor

### If percentile thresholds need tuning:
- Modify `PERCENTILE_TO_RATING` array (lines 129-140)
- Shift thresholds to be more/less selective

## Data Requirements

### Minor League Stats
The system needs minor league stats for 2017-2021. Check what's available:

```bash
# Check what minor league data exists
ls public/data/minors/
```

Expected files:
- `2017_aaa.csv` through `2021_aaa.csv`
- `2017_aa.csv` through `2021_aa.csv`
- `2017_a.csv` through `2021_a.csv`
- `2017_r.csv` through `2021_r.csv`

**If data is missing:** Export from OOTP using StatsPlus API or CSV export.

### MLB Stats
The system needs MLB stats for 2015-2021 for:
- 2015-2017: Percentile distribution baseline
- 2018-2021: Validation outcomes

Check what's available:
```bash
ls public/data/mlb/
```

Expected files:
- `2015.csv` through `2021.csv`

## Validation Metrics

### Success Criteria

**Level Adjustments:**
- ✅ AAA→MLB K/9: MAE < 1.0
- ✅ AAA→MLB BB/9: MAE < 0.5
- ✅ AAA→MLB HR/9: MAE < 0.4

**Trajectory:**
- ✅ High-TFR prospects (4.0+) reach MLB at higher rate (>50%)
- ✅ High-TFR prospects progress faster (avg 1-2 years to MLB)
- ✅ Low-TFR prospects (<3.0) reach MLB at lower rate (<20%)

**Early MLB Performance:**
- ✅ Correlation (TFR vs actual FIP): r > 0.4
- ✅ High-TFR prospects (4.0+) avg FIP < 4.00
- ✅ Top-10 TFR prospects avg FIP < 3.50

**Percentile Rankings:**
- ✅ Top 2% TFR → top quartile MLB performance (>60% hit rate)
- ✅ Top 10% TFR → above average MLB performance (>50% hit rate)

## Comparing My Scout vs OSA

Once 2017 My Scout data is validated, repeat with OSA:

1. Modify FarmRankingsView to use OSA-only data (temporary for testing)
2. Export 2017 prospects using OSA scouting
3. Run same validation scripts
4. Compare results

**Expected outcome:** OSA performs worse (lower correlations, higher errors), confirming that scout quality matters.

## Next Steps After Validation

If validation passes:
1. Document final parameters in README
2. Update session_summary.md with 2017 validation results
3. Consider testing on additional years (2018, 2019) for robustness
4. Ship the calibration as production-ready

If validation fails:
1. Analyze which specific tests failed
2. Adjust corresponding parameters
3. Re-export and re-validate
4. Iterate until tests pass

## Troubleshooting

### "No scouting data found for 2017"
- Verify data was saved: Open DevTools → Application → IndexedDB → wbl_data → scouting_my
- Check for key: `2017-01-01_my`
- Re-run HTML loader if missing

### "Farm Rankings shows no prospects for 2017"
- Check that minor league stats exist for 2017
- Verify API endpoints are accessible
- Check browser console for errors

### "Export button doesn't work"
- Check browser console for JavaScript errors
- Verify you're viewing the correct year (2017, not 2021)
- Try hard refresh (Ctrl+Shift+R)

## Files Reference

### Data Files
- `public/data/2017_scouting_ratings.csv` - My Scout data
- `public/data/2017_OSA_ratings.csv` - OSA data
- `public/data/minors/*.csv` - Minor league stats 2017-2021
- `public/data/mlb/*.csv` - MLB stats 2015-2021

### Scripts
- `tools/research/load_2017_data.html` - Browser loader for scouting data
- `tools/research/load_2017_scouting_data.ts` - Node.js data parser/validator
- `tools/research/tfr_2017_validation.ts` - Main validation script (to be created)

### Output
- `tools/reports/tfr_prospects_2017.json` - Exported 2017 TFR results
- `tools/reports/2017_validation_results.json` - Validation metrics
- `tools/reports/2017_scouting_my_parsed.json` - Parsed My Scout data
- `tools/reports/2017_scouting_osa_parsed.json` - Parsed OSA data
