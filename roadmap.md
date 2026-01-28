# True Ratings Roadmap

## Recent Decisions

### xFIP Removal from True Ratings Page
**Status**: ✅ Completed

**Rationale**:
- xFIP is a descriptive stat (backward-looking) that measures what a pitcher's FIP *should have been* after removing HR luck
- This creates confusion when compared to projections (forward-looking), especially for aging players
- Example: A 37-year-old shows xFIP 3.36 (past performance adjusted) vs projected FIP 3.68 (future with age decline)
- The True Rating blend already captures talent level without needing xFIP
- Removed from True Ratings toggle; will be added to future Analytics/Metrics section

---

## Feature Backlog

### Farm System Rankings
**Priority**: High

- [ ] Differentiate draftees/early prospects in the ranking system
- [ ] **Pitch ratings consideration**: Different pitch types have different ratings - should we account for all of them, or only care about "Stuff" always?
- [ ] **BABIP inclusion question**: Should we include BABIP in the rating if we don't include it in projection calculations?
  - Could differentiate clumps of prospects
  - All else equal, prefer the higher-rated BABIP prospect
  - Risk: May create confusion if rating and projection use different inputs

### Trade Analyzer
**Priority**: High

Build a tool to evaluate trade proposals by comparing true ratings and projections of players involved.

### Batter Support
**Priority**: Critical
Currently the app only handles pitching. Need to duplicate core functionality for batters.

- [ ] Batter data collection with screen reader
- [ ] Define data export contract for batters from OOTP
- [ ] Add toggles on all relevant pages to switch between pitcher/batter data
- [ ] Extend True Ratings system to batting metrics
- [ ] Extend projections to batting metrics

### WAR Formula Refinement
**Priority**: Medium

- [ ] Revisit/refine Pitching WAR formula to more closely match OOTP's calculations
- [ ] Document differences between our WAR and OOTP's WAR

### Advanced Projections
**Priority**: Medium

- [ ] Run prevention projections
- [ ] Run scoring projections
- [ ] Win projections (team-level?)
- [ ] **Defense ratings and stats?**
  - Open question: If run prevention/win projections are good enough, maybe we can ignore defense altogether?

### UI/UX Enhancements
**Priority**: Low

- [ ] Add team logos throughout the app
- [ ] Animate changes on scouting source change

### Player Development Tracker
**Priority**: High
Track player progression over time with visualizations.

- [ ] Build graphs for each player showing progression
  - Show True Rating over time
  - Compare: TR vs scout ratings vs OSA ratings vs actual stats?
- [ ] Historical view of development paths

### Scout Accuracy Analysis
**Priority**: Medium

- [ ] Build tool to evaluate: "Historically, how good was your scout?"
- [ ] Compare scout predictions vs actual performance over time
- [ ] Identify scout biases or blind spots

### TFR Validation
**Priority**: Medium
How accurate is the True Future Rating system?

- [ ] Backtest TFR predictions against actual MLB outcomes
- [ ] Automate analysis page for ongoing validation?
- [ ] Generate accuracy reports

### Analytics/Metrics Dashboard
**Priority**: Low
Advanced analytics and luck indicators for deeper performance analysis.

- [ ] **Luck Indicators Section**
  - xFIP (expected FIP with normalized HR/FB rate)
  - ERA-FIP differential
  - BABIP deviation from league average
  - LOB% (Left On Base percentage)
- [ ] **Peripheral Stats**
  - GB/FB ratio
  - Soft/Medium/Hard contact rates (if available)
  - First pitch strike percentage
- [ ] **Year-over-year comparisons** for detecting trends
- [ ] **Regression candidates** - players likely to regress or improve based on luck indicators

---

## Questions to Resolve

1. **Pitch ratings**: Do we need granular pitch-type ratings, or is "Stuff" sufficient?
2. **BABIP in ratings**: Include in True Rating even if not in projections?
3. **Defense**: Can we skip defensive metrics if other projections are comprehensive?
4. **TFR automation**: Should validation be automated or manual periodic analysis?
