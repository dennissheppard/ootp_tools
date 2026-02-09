# Gap/Speed UI Display Recommendation

## Test Results Summary

Validated doubles/triples projections against **580 MLB player-seasons (2018-2024)** with 300+ PA.

### TEST 1: Round-Trip Accuracy (Estimate Gap/Speed from actual rates → Project)

**Doubles:**
- ✅ **Excellent accuracy:** MAE = 0.6 doubles per player
- ✅ Total projected: 14,428 vs actual: 14,228 (only +1.4% difference)
- ✅ Distribution matches well across all ranges (0-9, 10-19, 20-29, etc.)

**Triples:**
- ⚠️ **Moderate accuracy:** MAE = 1.0 triples per player
- ⚠️ Total projected: 1,221 vs actual: 1,688 (-27.7% difference)
- ⚠️ Systematic underestimate (bias = -0.8)

**Interpretation:** When Gap/Speed ratings accurately reflect player skills, the projection formulas work very well for doubles and reasonably well for triples.

### TEST 2: League-Average Defaults (Gap=50, Speed=50 for everyone)

**Doubles:**
- ❌ **Significant underestimate:** Total projected: 12,117 vs actual: 14,228 (-14.8%)
- ❌ Mean per player: 20.9 vs actual: 24.5 (MAE = 6.0)

**Triples:**
- ❌ **Severe underestimate:** Total projected: 509 vs actual: 1,688 (-69.9%)
- ❌ Mean per player: 0.9 vs actual: 2.9 (MAE = 2.3)

**Interpretation:** Using Gap=50 as a default significantly underestimates doubles and severely underestimates triples. This means Gap/Speed ratings carry important information.

---

## Key Insights

### 1. Gap/Speed Ratings Matter
Using league-average defaults (Gap=50, Speed=50) produces unrealistic projections:
- Projects 21 doubles per player vs actual 24.5
- Projects 0.9 triples per player vs actual 2.9

**This means:** You can't just ignore Gap and trust "projected 50 doubles" without context.

### 2. Projection Accuracy Depends on Scouting Quality
- ✅ Good Gap scouting → Accurate doubles projection
- ✅ Good Speed scouting → Reasonable triples projection
- ❌ Missing or default ratings → Underestimated totals

### 3. Triples Are Hard to Project
Even with perfect Speed estimation from actuals (Test 1), we still underestimate triples by 27.7%. This is because:
- Triples are rare events (mean = 2.9 per player)
- Many factors beyond Speed affect triples (park dimensions, hit spray, aggression)
- Our R² = 0.31 reflects this limitation

---

## UI Recommendation: **Show Gap (and AvoidK) in Expanded View**

### Rationale

You want to trust projections ("he's projected for 50 doubles, that's all I need"), but the data shows you **need context** to interpret those projections:

**Scenario 1: Two prospects, both projected for 25 doubles**
- Prospect A: Gap = 35 (low confidence, cautious projection)
- Prospect B: Gap = 65 (high confidence, power alley hitter)

Without seeing Gap, you can't tell:
- Which projection is more reliable?
- Which player has upside if they improve?
- Which player fits your team's needs (gap power vs home run power)?

**Scenario 2: Evaluating trade targets**
- Player projected for 30 doubles
- Is this because Gap = 55 (solid) or Gap = 80 (elite skill, maybe injured/unlucky year)?
- You need Gap to make informed decisions

### Proposed UI Design

**Compact View (Default):**
```
True Ratings: Power 55 | Eye 60 | Contact 65
Projected:    .280 AVG, 25 HR, 45 2B, 3 3B, 10 SB
```

**Expanded View (Click to expand):**
```
True Ratings:
  Power       55  ⚾⚾⚾○○  (20 HR pace)
  Eye         60  ⚾⚾⚾⚾○  (10% BB rate)
  Contact     65  ⚾⚾⚾⚾○  (.280 AVG)

Advanced Ratings:
  Gap         45  ⚾⚾○○○  (40 doubles pace) ← NEW
  AvoidK      70  ⚾⚾⚾⚾⚾ (15% K rate)    ← NEW
  Speed       85  ⚾⚾⚾⚾⚾ (4 triples, 15 SB pace) ← Already shown for SB
```

**Benefits:**
1. **Clean default view:** Most users see the 3 main ratings + projections
2. **Context when needed:** Click to expand shows Gap/AvoidK for deeper analysis
3. **Projection transparency:** Users can see WHY a player is projected for X doubles
4. **Trade evaluation:** Identify skill vs luck (low Gap + high actual 2B = lucky year?)

### Alternative: Tooltip on Hover

**Projected: 45 2B** ← Hover shows: "Based on Gap rating: 65 (Elite doubles power)"

This keeps the UI even cleaner but provides context on demand.

---

## Calibration Issue: Gap=50 Baseline

The Test 2 results reveal a calibration issue:

**Current:** Gap=50 → 25.0 doubles per 600 AB
**Actual MLB average:** ~30 doubles per 600 AB

This 5-double gap suggests our calibration may be using a restricted sample (only certain Gap ranges?) or the league-average Gap in OOTP is higher than 50.

### Recommendation: Recalibration Options

**Option A: Accept the current calibration**
- It's based on OOTP data where Gap=50 genuinely produces 25 doubles
- Prospects will have their actual Gap ratings (not 50)
- The issue only affects "unknown" players

**Option B: Adjust intercept to match MLB totals**
- Shift the doubles formula so league-average (Gap=X) matches 30 doubles
- This would require identifying what "league-average Gap" actually is in OOTP

**Option C: Document the baseline**
- Add UI note: "Gap=50 baseline represents 25 doubles per 600 AB"
- Users learn to interpret Gap relative to this baseline

I recommend **Option A** for now since:
1. Prospects have real Gap ratings from scouting
2. Test 1 shows projections are accurate when Gap is known
3. The system is designed for prospects, not "default unknown" players

---

## Answering Your Questions

### "Can I just trust projected 50 doubles?"

**Yes, IF:**
- The player has a reliable Gap rating from scouting
- You understand that projection assumes league-average context

**No, IF:**
- You're comparing players and want to know WHY one is projected higher
- You're evaluating upside/downside scenarios
- You're trading and need to assess skill vs luck

### "Do I need to see Gap and AvoidK?"

**Not always, but you want the option:**
- **90% of the time:** Projections alone are sufficient
- **10% of the time:** You need to see Gap to understand context (trade evaluation, draft decisions, identifying breakout candidates)

**Solution:** Show in expanded view. Let users drill down when they need it.

### "How much should I trust these projections?"

**Doubles:** Very trustworthy (MAE = 0.6 when Gap is known)
**Triples:** Moderately trustworthy (MAE = 1.0, systematic underestimate)

**For prospects:**
- Use projected doubles as primary metric (reliable)
- Use projected triples as directional guide (less precise)
- When in doubt, check Gap rating to assess projection confidence

---

## Implementation Plan

### Phase 1: Add Expanded View (Recommended)
1. Add "Show Advanced Ratings" toggle in Farm Rankings
2. Display Gap and AvoidK in expanded view
3. Include context labels: "Gap 65 → ~40 doubles per 600 AB"

### Phase 2: Improve Triples Projection (Optional)
- Investigate why triples are underestimated
- Consider park factor adjustments
- May need more OOTP data or non-linear Speed formula

### Phase 3: UI Polish (Optional)
- Add hover tooltips on projected stats showing underlying ratings
- Visual indicators for projection confidence based on PA sample size
- Comparison view: "Player A (Gap 45) vs Player B (Gap 70)"

---

## Conclusion

✅ **Show Gap and AvoidK in an expanded view**

This balances two goals:
1. **Trust projections:** Clean default UI with projected totals
2. **Understand context:** Drill down to see WHY those projections make sense

The data shows Gap ratings carry significant information (14.8% difference in doubles totals when missing). You don't want to hide that from users making draft/trade decisions.

**Recommended UI pattern:**
```
[Compact View]
→ Click "Advanced Ratings"
→ [Expanded View with Gap/AvoidK]
```

This lets casual users trust projections while giving serious evaluators the context they need.
