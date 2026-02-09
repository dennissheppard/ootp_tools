# Advanced Ratings Accordion - Implementation Summary

## Status: COMPLETE

## What Was Built

Added a collapsible "Expanded Ratings" section to the Batter Profile Modal showing Gap and AvoidK comparisons (True vs Scout), plus redesigned header with WAR badge and OVR/POT stars.

### Header (Upper Right)
- **WAR Badge**: Color-coded projected WAR (elite/allstar/starter/bench/replacement)
- **OVR/POT Stars**: Scout ratings display
- **Injury & Speed Donuts**: Quick visual indicators

### Expanded Ratings Accordion
- **Gap**: True vs Scout comparison (when true ratings available)
- **AvoidK**: True vs Scout comparison
- **Scout-only fallback**: For prospects without MLB stats
- **State persistence**: Accordion expand/collapse saved to localStorage

## Gap & Speed in Projections

Gap and Speed ratings are now used to project doubles and triples:

**Doubles Rate** (from Gap rating):
```
doublesRate = 0.01 + (gap - 20) * 0.0008  // per AB
```
- 20 Gap → 1.0% doubles rate
- 50 Gap → 3.4% doubles rate
- 80 Gap → 5.8% doubles rate

**Triples Rate** (from Speed rating):
Speed is now on 20-80 scale (same as other ratings). Internally converted to 20-200 scale for calculations.
```
triplesRate = expectedTriplesRate(speed)  // speed on 20-80 scale
```
- 20 Speed (20-80) → slow → ~0% triples rate
- 50 Speed (20-80) → average → ~0.75% triples rate (4.5 per 600 AB)
- 80 Speed (20-80) → elite → ~1.5% triples rate (8.9 per 600 AB)

These feed into wOBA calculation:
```
wOBA = 0.69×BB + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR
```

## Files Modified

- `BatterProfileModal.ts` - Accordion UI, header redesign
- `HitterTrueRatingsCalculationService.ts` - Added `estimatedGap`, `estimatedSpeed`
- `HitterTrueFutureRatingService.ts` - Added `trueGap`, `trueSpeed`, Gap/Speed in wOBA calculation
- `HitterRatingEstimatorService.ts` - Added `expectedDoublesRate()`, `expectedTriplesRate()`
- `TeamRatingsService.ts` - Added Gap/Speed to `RatedHitterProspect.trueRatings`
- `styles.css` - WAR badge styles, accordion styles

## Key Design Decisions

1. **Gap from doubles rate, Speed from triples rate** - For MLB players with stats, we estimate these from actual performance using percentile ranking.

2. **100% scout for prospect Gap/Speed** - No research shows MiLB doubles/triples rates predict MLB performance, so prospects use scout values only.

3. **WAR badge prominence** - Gives immediate value context in header, color-coded by tier.

4. **No Speed in accordion** - Speed is shown as donut in header; Gap and AvoidK comparison more useful in accordion.
