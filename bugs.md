# Batter Implementation Bugs

## UI/UX Bugs
- [x] **Raw Stats toggle missing for Batters** - Fixed: Enabled Raw Stats button for batters in TrueRatingsView.ts
- [x] **WAR column not visible without scrolling** - Fixed: Moved WAR column earlier (after wOBA) and changed default sort to TR instead of WAR

## Projections Page
- [x] **"No projections found" for All Batters** - Implemented BatterProjectionService and updated ProjectionsView to render batter projections with wOBA, wRC+, WAR bars

## Calibration Issues (Projections)
- [x] **Projected WAR too low** - Fixed wobaScale calculation in LeagueBattingAveragesService.ts (was ~3.0, now 1.15)
- [x] **wRC+ too low** - Fixed by same wobaScale fix above
- [ ] **TFR distribution skewed high** - Too many 4.0+ TFR prospects, Top 100 has no 3.5s (may need re-testing after wobaScale fix)

## Notes
- ~~WAR formula may need adjustment (likely PA projection or runs-per-win factor)~~ Fixed via wobaScale
- ~~wRC+ scale may need recalibration against league averages~~ Fixed via wobaScale
- TFR star mapping percentiles may need tightening (test after wobaScale fix first)

## New Files Created
- `src/services/BatterProjectionService.ts` - Service for generating batter stat projections
