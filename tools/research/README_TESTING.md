# How to Run Automated TFR Tests

## Quick Start (3 steps)

### 1. Export TFR Data from UI

1. Open your app
2. Go to **Farm Rankings** page
3. Click **"Export for Testing"** button (top right, next to Reports tab)
4. Save the downloaded `tfr_prospects_2020.json` file to `tools/reports/`

### 2. Run the Tests

```bash
npx ts-node tools/research/tfr_automated_validation.ts
```

### 3. Review Results

Tests will show:
- ✅ Green = Passed
- ❌ Red = Failed (with details on what's wrong)

Results saved to: `tools/reports/tfr_validation_results.json`

---

## What the Tests Check

1. **TFR Distribution** - Is it realistic? (Elite: 3-7%, Above Avg: 10-20%, etc.)
2. **Top Prospects FIP** - Do top 10 average 2.80-3.50 FIP?
3. **Top 200 vs MLB** - Are prospects better than MLB average?
4. **Peak WAR Range** - Do top prospects show 3-6 WAR peaks?
5. **Level Distribution** - Is top 100 balanced across levels?
6. **Compression** - Are we avoiding "everyone 4.0+" problem?
7. **Young Prospects** - Are 20%+ of top 100 age ≤22?

---

## If Tests Fail

The test output will tell you exactly what's wrong:

**Example**:
```
❌ TFR Distribution
   Expected: Elite: 3-7%, Above Avg: 10-20%, Average: 30-45%
   Actual:   Elite: 39.0%, Above Avg: 61.0%, Average: 0.0%
   Issue:    Distribution does not match expected MLB-like spread
```

**What to do**: Adjust TFR calibration in `TrueFutureRatingService.ts` (confidence factors, regression, etc.), rebuild, re-export, re-test.

---

## Why This Matters

Instead of manually eyeballing "does this look right?", you now have objective pass/fail tests that compare your projections to actual MLB data from 2012-2021.

**Manual testing**: Slow, subjective, incomplete
**Automated testing**: Fast, objective, comprehensive

---

## Troubleshooting

**"No TFR data found"**
- Make sure you exported from the UI
- Make sure the file is in `tools/reports/tfr_prospects_2020.json`
- Check the year matches (default is 2020)

**"Module not found" errors**
- Run `npm install` first
- Make sure you're in the project root directory

**Tests all fail**
- That's OK! That's why we have tests - to identify issues
- Review the output to see what needs adjusting
- Make changes, rebuild, re-export, re-test
- Iterate until tests pass

---

## Advanced: Test Different Years

Export data for different year:
1. Change year dropdown in Farm Rankings
2. Click "Export for Testing"
3. Save as `tfr_prospects_YYYY.json`
4. Edit `tfr_automated_validation.ts` line 15 to change `TEST_YEAR`
5. Re-run tests

---

**That's it!** Export → Test → Fix → Repeat
