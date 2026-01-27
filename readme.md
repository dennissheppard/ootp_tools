# True Ratings - An OOTP Utility to improve the ratings system

A TypeScript/Vite web application for calculating ratings and potential stats from OOTP (Out of the Park Baseball).

## Tech Stack

- **Frontend**: TypeScript, Vite, vanilla CSS
- **Architecture**: MVC pattern (Models, Views, Controllers, Services)
- **Build**: `npm run dev` (development), `npm run build` (production)

## Project Structure

```
src/
├── main.ts                 # App entry point
├── styles.css              # Global styles (dark theme)
├── models/
│   ├── Player.ts           # Player interface, Position enum
│   └── Stats.ts            # PitchingStats, BattingStats interfaces
├── views/
│   ├── SearchView.ts       # Player search UI
│   ├── PlayerListView.ts   # Search results list
│   ├── StatsView.ts        # Player stats display with True Ratings
│   ├── PlayerRatingsCard.ts # Shared component for rating bars display
│   ├── PlayerProfileModal.ts # Draggable modal for pitcher profiles
│   ├── PotentialStatsView.ts # Rating-to-stats calculator UI
│   ├── RatingEstimatorView.ts # Stats-to-ratings estimator UI
│   ├── DraftBoardView.ts   # Interactive draft board
│   ├── TrueRatingsView.ts  # True Ratings page UI (includes prospects with TFR)
│   ├── ProjectionsView.ts  # Stat projections with aging curves
│   ├── TeamRatingsView.ts  # Team-level pitching strength rankings
│   ├── FarmRankingsView.ts # Farm system rankings (placeholder)
│   ├── LoadingView.ts      # Loading overlay
│   └── ErrorView.ts        # Error display
├── controllers/
│   └── PlayerController.ts # Handles player search/stats logic
└── services/
    ├── PlayerService.ts    # Player data fetching
    ├── StatsService.ts     # Stats data fetching
    ├── PotentialStatsService.ts # Rating-to-stats calculations
    ├── RatingEstimatorService.ts # Stats-to-ratings reverse calculations
    ├── FipWarService.ts    # Shared FIP/WAR calculations (used by both calculators)
    ├── LeagueStatsService.ts # League-wide stats and FIP constant calculations
    ├── TrueRatingsService.ts # True Ratings data fetching and caching
    ├── TrueRatingsCalculationService.ts # True Rating calculation (percentile, blending)
    ├── TrueFutureRatingService.ts # True Future Rating calculation for prospects
    ├── ScoutingDataService.ts # Scouting CSV parsing and IndexedDB persistence
    ├── MinorLeagueStatsService.ts # Minor league stats CSV parsing and IndexedDB persistence (with batch loading)
    ├── IndexedDBService.ts   # Low-level IndexedDB wrapper for large datasets
    ├── StorageMigration.ts   # Automatic migration from localStorage to IndexedDB
    ├── AgingService.ts       # Aging curve calculations for projections
    ├── ProjectionService.ts  # Stat projection calculations
    └── DateService.ts        # Current game date fetching and caching
```

## Key Features

### 1. Player Search & Stats Display
Search players and view their historical pitching/batting statistics.

**Minor League Stats Integration**:
- When viewing a pitcher's profile, the app automatically fetches minor league stats within 2 years of the current game date
- Minor league stats are displayed interleaved with MLB stats, sorted by year (descending)
- A "Level" column shows the league level (MLB, AAA, AA, A, R) with color-coded badges
- ERA and WAR are shown as "—" for minor league stats (not available in uploaded data)
- The current game date is fetched from `/api/date` and cached globally via `DateService`

### 2. True Ratings Explorer
A new tab that provides a comprehensive view of player performance for a selected year, with separate views for pitchers and batters.

- **Data Source**: Fetches data from the `https://atl-01.statsplus.net/world/api/playerpitchstatsv2/` and `playerbatstatsv2/` endpoints.
- **Interactive Table**: Displays all relevant stats in a wide, horizontally scrollable table.
- **Custom Scrolling**: Features custom, fade-in-out arrow buttons for easier horizontal navigation on wide tables.
- **Dynamic Sorting**: All columns are sortable. Clicking a header sorts the data and triggers a subtle fading arrow animation to indicate the sort direction.
- **Pagination**: Includes controls to select the number of players to display per page (10, 50, 200, or All) and navigate through pages.
- **Year Selection**: A dropdown allows users to select a year from 2000 to 2021 to view historical data.
- **Aggressive Caching**: API responses are cached in `localStorage` for 24 hours to improve performance and reduce network requests.
- **Player Profile Modal**: Click any pitcher name to open a draggable modal showing:
  - True Rating badge (0.5-5.0 scale) with percentile
  - Rating comparison bars (True Ratings vs Scout Opinions)
  - Multi-year stats history table
  - Data completeness indicator (○ symbol when scouting data is missing)
- **Scouting Data Upload**: CSV upload for scout ratings, stored per-year in localStorage. Used to blend with performance-based ratings.

### 3. Player Search with True Ratings
When searching for a pitcher, the stats display now includes:
- **True Rating Badge**: Calculated against all pitchers for the selected year
- **Rating Comparison Bars**: Shows estimated Stuff/Control/HRA vs scout opinions (if scouting data uploaded)
- **Placeholder UI**: When scouting data is missing, shows dotted outline bars with link to upload on True Ratings page
- **Shared Component**: Uses `PlayerRatingsCard.ts` for consistent rendering between search results and modal

### 4. Potential Stats Calculator
Convert OOTP pitcher ratings to projected stats. Located in `PotentialStatsService.ts`.

**Input Ratings** (20-80 scale):
- Stuff, Control, HRA (Home Run Avoidance), Movement, BABIP

**How OOTP Ratings Work**:
- OOTP uses a hidden 500-point scale internally, displayed as 20-80 (rounded to nearest 5)
- Ratings have **1:1 linear relationships** with stats in the game engine
- Variance in observed data comes from rounding, not prediction error
- Movement is derived: `Movement ≈ 0.24×BABIP + 0.71×HRA`

**WBL-Calibrated Linear Formulas** (verified Jan 2026):

| Stat | Formula | Notes |
|------|---------|-------|
| K/9 | 2.07 + 0.074×Stuff | 1:1 with Stuff |
| BB/9 | 5.22 - 0.052×Control | 1:1 with Control |
| HR/9 | 2.08 - 0.024×HRA | 1:1 with HRA (WBL = 0.64× neutral) |
| H/9 | ~9.0 (league avg) | BABIP doesn't predict H/9 reliably |

**Inverse Formulas** (for Rating Estimator):
- `Control = 100.4 - 19.2×BB/9`
- `Stuff = -28.0 + 13.5×K/9`
- `HRA = 86.7 - 41.7×HR/9`

**Key WBL Insights**:
- WBL is a **low-HR environment** (~64% of neutral MLB HR rates)
- **"Three True Outcomes"**: K, BB, HR are what pitchers control
- **BABIP cannot be estimated from stats** - team defense and park factors dominate
- Defense is highly correlated with wins in WBL

**Derived Stats** (calculated in `FipWarService.ts`):
- FIP: ((13×HR/9) + (3×BB/9) - (2×K/9)) / 9 + FIP constant (default 3.47)
- WAR: ((replacementFIP - playerFIP) / runsPerWin) × (IP / 9)

**Role-Based WAR Parameters** (calibrated from OOTP data regression, Jan 2026):

OOTP uses dynamic runs-per-win and leverage adjustments. These parameters were derived by regression analysis against actual OOTP WAR values:

| Role | IP Range | Replacement FIP | Runs/Win | Notes |
|------|----------|-----------------|----------|-------|
| Starters | ≥150 | 5.25 | 9.00 | Default for projections |
| Middle | 80-149 | 4.90 | 8.50 | Swingmen, long relievers |
| Relievers | <80 | 4.60 | 9.00 | Leverage adjustment |

The lower replacement FIP for relievers reflects OOTP's leverage adjustment - relievers need to be better to accumulate positive WAR.

**WAR Accuracy**: ~0.35 RMSE vs OOTP values. Remaining variance is due to park factors and other OOTP-specific adjustments we can't replicate.

### 5. Rating Estimator
A reverse calculator to estimate pitcher ratings from actual stats, helping to evaluate scout accuracy.

**Purpose**: Compare scout ratings vs. actual performance to answer "How accurate is my scout?"

**How to Use**:
1.  Navigate to the "Rating Estimator" tab.
2.  Enter a pitcher's stats (IP, K/9, BB/9, HR/9).
3.  Optionally, enter the ratings from your scout and/or OSA in the "Comparison" section.
4.  Click "Estimate Ratings".

**Output**:
-   **Rating**: The calculated rating based on the provided stats.
-   **Scout/OSA**: The ratings you entered for comparison.
-   **Verdict**: A judgment on the scout's accuracy (`✓ Accurate`, `Scout LOW ⚠️`, or `Scout HIGH ⚠️`).

**Estimable Ratings**:
-   **Control** (from BB/9)
-   **Stuff** (from K/9)
-   **HRA** (from HR/9)

**Not Estimable**:
-   **BABIP/Movement**: These are not displayed as they cannot be reliably estimated from stats due to the large impact of team defense and park factors.

**Derived Stats (FIP & WAR)**:
The estimator calculates FIP and WAR using the shared `FipWarService.ts` (same formulas as the Potential Stats Calculator).
-   **FIP** is derived from K/9, BB/9, and HR/9 rates.
-   **WAR** uses role-based parameters that automatically adjust based on IP (starters vs relievers).
-   League constants (FIP constant, replacement FIP) can be loaded from `LeagueStatsService` for any year, with results cached in `localStorage`.

### 6. Team Rater
A comprehensive view of team-level pitching strength, identifying top rotations and bullpens.

- **Role Classification**: Intelligently classifies pitchers as Starters (SP) or Relievers (RP):
  - **Priority 1 (Profile)**: 3+ usable pitches (rated ≥45), Stamina ≥35, and True Rating ≥2.0 → **SP**.
  - **Priority 2 (Role)**: Explicit roster role is SP → **SP**.
  - **Priority 3 (History)**: Started ≥5 games recently → **SP**.
  - **Fallback**: Default to **RP**.
  - **Overflow Handling**: Rotations are strictly capped at 5 pitchers. Any additional qualified starters are moved to the bullpen list (boosting the bullpen rating as long relievers/swingmen).
- **Historical Team Assignment & Rotation Logic**:
  - **Traded/Multi-team Seasons**: Historical team ratings use per-team pitching splits so a player can appear on multiple teams in the same year.
  - **Historical Rotation Priority**: For past years, rotation selection is driven by actual **GS** (then IP) to reflect who really started, rather than scouting profile.
- **Team Scores (WAR)**:
  - **Metric**: Teams are ranked by the **Aggregate WAR** of their top 5 starters (Rotation) and top 5 relievers (Bullpen).
  - **Why WAR?**: WAR naturally balances quality (FIP) and quantity (IP), automatically handling the normalization issues that plagued custom "Runs Saved" metrics.
  - **Internal Runs Math**: While WAR is the primary display metric, the system still calculates **Runs Allowed** internally, using role-specific baselines (Starter-only vs Reliever-only FIP averages) to ensure fair comparisons.
- **Roadmap: Team Win Projections**:
  - WAR is the mathematical bridge to win projections.
  - `Projected Wins = (Team WAR) + (League Average Wins) + (Defense/Park Adjustments)`
  - Since `1 WAR ≈ 9 Runs`, the internal Runs Allowed engine is preserved to support future "Projected Standings" features.
- **View Modes**:
  - **Projections**: Upcoming season projection (base year fixed to 2020 in current data set).
  - **By Year**: Standard year selector (2000-2021).
  - **All Time**: Top 10 rotations and bullpens across all years, ranked by aggregate WAR for that season (year shown next to team name).
- **Projected Most Improved**: In projections view, a "Projected Most Improved" section compares projected WAR to the prior year and ranks teams by improvement/decline.
- **Interactive Lists**: Ranked lists of teams with expandable rows showing detailed player stats (TR, IP, K/9, BB/9, HR/9, ERA, WAR).
- **Clickable Player Names**: Click any player to open their profile modal with full stats history and scouting data.
- **Stat Hover/Tooltips**:
  - Flip cards on K/9, BB/9, and HR/9 show the estimated rating for that single season.
  - Tooltips on the Team WAR badge show the underlying Runs Allowed context compared to league average.

**Player Profile Modal** (accessed from Team Ratings, Projections, True Ratings pages):
- **Header Layout**: Comprehensive player snapshot in the modal header
  - **Left**: Player name, team, position (SP/RP), age
  - **Center**: True Rating emblem (year label only shown for historical data)
  - **Right-Center**: Metadata stack (Injury bar, Stamina bar, Star ratings)
    - Injury and Stamina bars show tooltips with raw values
  - **Far Right**: Pitch repertoire with ratings (color-coded: green ≥60, yellow 45-59, gray <45)
- **Rating Comparison Bars**: Estimated ratings vs scout opinions (Stuff, Control, HRA)
- **Multi-Year Stats Table**: Season-by-season performance with minor league stats integration
- **Projections Section**: Shows projected stats for upcoming season (when applicable)
- **Draggable**: Modal can be repositioned by dragging the header

### 7. Stat Projections & Ensemble System
Predicts future pitching performance using a sophisticated multi-model ensemble that rivals professional MLB projection systems (Steamer, ZiPS, PECOTA).

---

## Ensemble Methodology (Jan 2026)

The projection system uses a **three-model ensemble** that blends optimistic, neutral, and pessimistic scenarios to handle different player contexts (young developing players, stable veterans, declining pitchers).

### The Three Models

**1. Optimistic Model (Standard Aging)**
- Applies full aging curve adjustments
- Assumes typical development trajectory
- Best for: Young players following normal development patterns

**2. Neutral Model (Conservative Aging)**
- Applies 20% of normal aging adjustments
- "Status quo" projection - minimal change from current performance
- Best for: Volatile small samples, established veterans

**3. Pessimistic Model (Adaptive Trend Continuation)**
- Uses year-over-year trends with adaptive dampening
- Young declining players (<27, negative trend): 65-80% trend dampening
- Old declining players (32+, negative trend): 70-85% trend dampening
- Improving players: 30-40% dampening (conservative on variance)
- Best for: True talent changes, development stalls

### Dynamic Ensemble Weighting

The system automatically adjusts model weights based on:

**1. IP Confidence** (0-1 scale)
- More IP → trust recent performance more (neutral/pessimistic)
- Less IP → trust development more (optimistic)

**2. Age Factor** (0-1 scale)
- Younger → expect more development
- Older → "you are who you are"

**3. Trend Detection**
- Direction: improving, declining, stable, volatile
- Magnitude: size of year-over-year change
- Confidence: weighted by IP and volatility

**4. Volatility Penalty**
- High variance → favor neutral model
- Stable performance → trust trend direction

### Calibrated Weight Parameters

Optimized over 44,388 parameter combinations tested on 2015-2020 historical data:

```typescript
DEFAULT_WEIGHT_PARAMS = {
  baseOptimistic:   0.35,  // Starting optimistic weight
  baseNeutral:      0.55,  // Starting neutral weight (favored)
  basePessimistic:  0.10,  // Starting pessimistic weight
  ageImpact:        0.35,  // Age factor strength
  ipImpact:         0.35,  // IP confidence factor strength
  trendImpact:      0.40,  // Trend detection strength
  volatilityImpact: 0.80   // Volatility penalty strength
};
```

---

## Three-Tier Regression with IP-Aware Scaling

To prevent over-projection of bad players (especially on rebuilding teams) and low-IP pitchers, the system uses intelligent regression:

### Regression Tiers (by FIP Performance)

**Tier 1: Good Performance (FIP ≤ 4.5)**
- Regression target: League average (4.20 FIP equivalent)
- Regression strength: 100% (normal stabilization constant)

**Tier 2: Bad Performance (4.5 < FIP ≤ 6.0)**
- Regression target: Replacement level (5.50 FIP equivalent)
- Regression strength: 100% → 60% (reduces as FIP rises)
- Smooth blending to avoid cliffs

**Tier 3: Terrible Performance (FIP > 6.0)**
- Regression target: Terrible baseline (7.50 FIP equivalent)
- Regression strength: 30% (70% reduction - trust the bad data!)
- Philosophy: If someone is this bad, they're probably terrible

### IP-Aware Regression Scaling

Addresses systematic over-projection of low-IP pitchers (+0.15 bias observed for 20-75 IP range):

```typescript
// Calculate IP confidence (0-1 scale, capped at 100 IP)
const ipConfidence = Math.min(1.0, totalIP / 100);

// Scale regression strength
// Low IP (30): 0.65x strength (35% reduction - trust performance more)
// Medium IP (75): 0.88x strength (12% reduction)
// High IP (100+): 1.0x strength (no change)
const ipScale = 0.5 + (ipConfidence * 0.5);
adjustedK = baseAdjustedK * ipScale;
```

**Effect**: Low-IP pitchers get LESS regression → less "rescue" toward optimistic targets → more realistic projections.

---

## Performance Metrics

### Elite Performance (75+ IP pitchers, 826 players, 2015-2020):
```
K/9 MAE:  0.636 (world-class!)
FIP MAE:  0.421 (rivals professional systems!)
K/9 Bias: +0.062
FIP Bias: +0.013 (nearly perfect)

Starters (GS ≥ 10):
FIP MAE:  0.391 (professional-grade)
Bias:     +0.031
```

### Overall Performance (all IP ranges):
```
K/9 MAE:  0.748
FIP MAE:  0.534
Bias:     +0.070
N:        1,445 pitchers
```

### Known Limitations

**Low-IP Relievers (<60 IP, GS <10):**
```
FIP MAE:  0.759
Bias:     +0.212
N:        429 pitchers
```

**Why low-IP relievers are difficult:**
- Selection bias (bad RP get demoted mid-season)
- Role volatility (RP → setup → closer → demoted)
- Small samples (35 IP = 35 innings of noise)
- Random outliers (player going 3.31 → 6.99 → 3.99 FIP is unpredictable)

**Recommendation**: Use wide confidence intervals for low-IP RP (±1.0 FIP vs ±0.4 for starters).

---

## Analysis Dashboard

Built-in reporting tool to validate projection accuracy:

**Features:**
- **Metrics**: MAE, RMSE, Bias for FIP, K/9, BB/9, HR/9
- **Year Range Filter**: Test specific time periods (e.g., 2015-2020 vs 2000-2020)
- **IP Range Filter**: Analyze by IP buckets (20-75, 75+, etc.)
- **Role Breakdown**: Compare SP vs Swingman vs RP performance
- **Team Breakdown**: Per-team accuracy (uses actual team, not projected team)
- **Age Breakdown**: Performance by age bucket (<24, 24-26, 27-29, 30-33, 34+)
- **Biggest Outliers**: Top 20 misses (helps identify injuries vs model error)

**How to Access:**
1. Navigate to Projections tab
2. Click "Analysis" mode toggle
3. Set year range and IP filters
4. Click "Run Analysis Report"

---

## Implementation Files

**Core Services:**
- `src/services/EnsembleProjectionService.ts` - Three-model ensemble calculation (500+ lines)
- `src/services/TrueRatingsCalculationService.ts` - Enhanced with three-tier + IP-aware regression
- `src/services/ProjectionService.ts` - Integrates ensemble, defaults to `useEnsemble: true`
- `src/services/ProjectionAnalysisService.ts` - Validation/analysis framework

**Calibration Tools:**
- `tools/calibrate_ensemble_weights.ts` - Grid search calibration script
- `tools/quick_calibration_test.ts` - Fast parameter testing

**Key Constants:**
```typescript
// Rating-to-stat formulas (TrueRatingsCalculationService + PotentialStatsService)
K/9  = 2.10 + 0.074 × Stuff
BB/9 = 5.30 - 0.052 × Control
HR/9 = 2.18 - 0.024 × HRA

// Regression targets
LEAGUE_AVERAGE = { k9: 7.5, bb9: 3.0, hr9: 0.85 }    // ~4.20 FIP
REPLACEMENT = { k9: 5.5, bb9: 4.0, hr9: 1.3 }        // ~5.50 FIP
TERRIBLE = { k9: 4.5, bb9: 5.0, hr9: 1.6 }           // ~7.50 FIP

// Stabilization constants (IP needed for stat to stabilize)
STABILIZATION = { k9: 50, bb9: 40, hr9: 70 }
```

---

## How to Calibrate / Tune

### When to Re-Calibrate
- After OOTP version changes (formulas may shift)
- When adding more historical data
- If bias or MAE degrades over time

### Calibration Process

**1. Prepare Historical Data**
- Need actuals data for target years (e.g., 2015-2020)
- Analysis service automatically compares projections to actuals

**2. Run Grid Search**
```bash
npx tsx tools/calibrate_ensemble_weights.ts
```

**3. Review Results**
- Script tests thousands of parameter combinations
- Reports best parameters, MAE, bias, and which criteria met
- Outputs suggested values for `DEFAULT_WEIGHT_PARAMS`

**4. Update Constants**
- Copy best parameters to `EnsembleProjectionService.ts`
- Run validation analysis to confirm improvement

**5. Validate**
- Use Analysis Dashboard to test on held-out data
- Check that 75+ IP performance remains elite
- Verify no negative side effects

### Grid Search Parameters

Edit `calibrate_ensemble_weights.ts` to adjust search space:

```typescript
const PARAM_GRID = {
  baseOptimistic: [0.30, 0.35, 0.40, 0.45],
  baseNeutral: [0.50, 0.55, 0.60],
  basePessimistic: [0.10, 0.15, 0.20],
  ageImpact: [0.30, 0.35, 0.40],
  ipImpact: [0.30, 0.35, 0.40],
  trendImpact: [0.35, 0.40, 0.45],
  volatilityImpact: [0.70, 0.80, 0.90]
};
```

**Runtime:** ~30 seconds per 1,000 combinations (very fast!)

---

## Applying to Batting & Fielding

This methodology can be adapted to batting and fielding projections:

### Batting Ensemble

**Three Models:**
1. **Optimistic**: Standard aging, assume development
2. **Neutral**: Conservative aging, status quo
3. **Pessimistic**: Trend-based with adaptive dampening

**Key Stats to Project:**
- AVG, OBP, SLG (or wOBA, wRC+)
- K%, BB%, ISO
- Stabilization constants will differ (PA instead of IP)

**Regression Tiers:**
- Good hitters (wRC+ > 110): Regress toward 110
- Average (90-110): Regress toward league average (100)
- Bad (<90): Regress toward replacement (~80)
- Terrible (<70): Minimal regression (trust the data)

**IP-Aware → PA-Aware:**
```typescript
const paConfidence = Math.min(1.0, totalPA / 400); // 400 PA = 1 season
const paScale = 0.5 + (paConfidence * 0.5);
```

**Calibration:**
- Use same grid search framework
- Success criteria: wRC+ MAE < X, Bias < ±Y
- Validate on historical data (e.g., 2015-2020)

### Fielding Ensemble

**Challenges:**
- Fielding stats are VERY noisy (small sample, high variance)
- Position-dependent (different expectations)
- Team context matters (shift usage, pitcher GB/FB rates)

**Approach:**
1. **High UZR/DRS weight:** For established fielders (1000+ innings), trust the data
2. **Scouting weight:** For low-innings players, use fielding ratings
3. **Regression:** Regress aggressively toward positional average (fielding metrics unreliable)

**Recommendation:** Start simple, validate heavily before deploying.

---

## Aging Curves

**Standard Deterministic Baseline** (applied to ratings, not stats):

| Age Range | Stuff | Control | HRA | Notes |
|-----------|-------|---------|-----|-------|
| < 22 | +2.0 | +3.0 | +1.5 | Rapid development |
| 22-24 | +0.5 | +1.5 | +0.5 | Continued growth |
| 25-27 | 0.0 | 0.0 | 0.0 | Peak plateau |
| 28-31 | -1.5 | -1.0 | -0.5 | Slow decline |
| 32+ | -3.0 | -2.0 | -1.0 | Accelerated decline |

**Note:** These are AVERAGES. The ensemble's pessimistic model handles players whose actual trajectory differs from the average.

---

## IP Projection Logic

**Innings projections blend scouting and history:**

- **Late-Season Callups / Breakout Candidates**: Young pitchers (<28) with limited MLB experience (<80 total IP) but full starter profiles (classified as SP with stamina ≥50)
  - Blend: 90% stamina-based model, 10% limited history
  - Example: 23yo with 40 IP last year, 60 stamina → Projects ~159 IP

- **Established Players**: >50 IP weighted average over last 3 years
  - Blend: 70% historical IP, 30% stamina model
  - Prevents "Wrecked" injury label from destroying workhorse projection

- **Low-IP Players**: Limited track record
  - Blend: 50% historical IP, 50% stamina model

---

## Key Learnings

1. **Multi-model ensembles work** - Single model can't handle all scenarios (developing, stable, declining)
2. **IP matters more than role** - Low-IP pitchers are harder to project regardless of SP/RP classification
3. **Outliers are unpredictable** - Don't chase random variance (guy going 3.31 → 6.99 → 3.99 FIP)
4. **Trust bad data** - If someone has 8.50 FIP over 40 IP, don't rescue them with heavy regression
5. **Calibration is fast** - 44K combinations tested in 12 minutes (modern CPUs are powerful!)
6. **Focus on strengths** - Your system is elite for established pitchers (75+ IP). Market that.

---

## Roster Mapping
- Projection outputs use current player/team mapping from `players/` endpoint (force refresh)
- Analysis uses actual teams from actuals data (fixes trade/FA/call-up attribution)

### 8. True Future Rating (Minor League Prospects)

A forward-looking rating for minor league pitchers who don't have significant MLB stats. Projects what they would be as major leaguers.

**Data Sources**:
- Minor league stats by level (R, A, AA, AAA) stored via `MinorLeagueStatsService`
- Scouting ratings (Stuff, Control, HRA potential) via `ScoutingDataService`
- Star ratings: OVR (current overall) and POT (potential) from scout

**Key Research Findings** (Jan 2026 analysis of WBL data):

1. **Minor league stats correlate moderately with scouting** (r = 0.25-0.45)
   - Stats explain only ~10-20% of variance in ratings
   - Implication: Weight scouting heavily, but stats aren't worthless

2. **Level stats are remarkably similar across levels**
   - K/9: 5.5-5.7, BB/9: 3.3-3.4, HR/9: 0.8 at all levels
   - OOTP doesn't heavily differentiate level difficulty in raw averages

3. **Minor leaguers underperform their ratings**
   - K/9 is ~0.3-0.5 LOWER than rating-expected
   - BB/9 is ~0.4-0.6 HIGHER than rating-expected
   - Ratings = potential; stats = incomplete development

4. **Star gap (POT - OVR) predicts stats reliability**
   - Developed (gap 0-0.5): Total prediction error = 1.83
   - Mid-development (gap 1-2): Error = 2.35
   - Raw (gap 2.5+): Error = 3.22
   - Larger gap = stats less reliable = trust scouting more

5. **Age matters as a quality signal**
   - Young-for-level players have better ratings (they earned early promotion)
   - This is already captured in scouting ratings; no separate age adjustment needed

**Scouting Weight Formula**:

```typescript
function calculateScoutingWeight(
  age: number,
  starGap: number,      // POT - OVR (0 to 4)
  totalMinorIp: number
): number {
  // For older players (27+), stats should dominate regardless of star gap
  // They are who they are at this point
  if (age >= 30) return 0.40;  // 60% stats weight
  if (age >= 27) return 0.50;  // 50% stats weight

  // For younger players, use gap and IP to determine weight
  const baseWeight = 0.65;

  // More raw (larger gap) = trust scouting more
  const gapBonus = (starGap / 4.0) * 0.15;  // 0% to 15%

  // Less IP = trust scouting more (stats are noisy)
  const ipFactor = (50 / (50 + totalMinorIp)) * 0.15;  // 0% to 15%

  return Math.min(0.95, baseWeight + gapBonus + ipFactor);
}
```

**Example Scouting Weights**:

| Player Profile | Age | Gap | IP | Scout Weight |
|----------------|-----|-----|-----|--------------|
| Raw 5-star prospect, no stats | 15 | 4.0 | 0 | 95% |
| Developing prospect | 19 | 3.5 | 60 | 85% |
| Upper-minors starter | 22 | 2.0 | 150 | 77% |
| Near MLB-ready | 24 | 1.0 | 250 | 72% |
| Veteran minor leaguer | 27 | 0.5 | 400 | 50% |
| Career minor leaguer | 30 | 0.0 | 600 | 40% |

**Level Adjustments** (to translate minor league stats to MLB-equivalent):

These adjustments account for the gap between minor league performance and rating-expected MLB performance:

| Level | K/9 adj | BB/9 adj | HR/9 adj |
|-------|---------|----------|----------|
| AAA | +0.30 | -0.42 | +0.14 |
| AA | +0.33 | -0.47 | +0.06 |
| A | +0.22 | -0.59 | +0.07 |
| R | +0.45 | -0.58 | +0.06 |

**Calculation Steps**:

1. **Calculate scouting-expected rates** (from potential ratings):
   ```
   scoutK9 = 2.07 + 0.074 × Stuff
   scoutBb9 = 5.22 - 0.052 × Control
   scoutHr9 = 2.08 - 0.024 × HRA
   ```

2. **Calculate adjusted minor league rates**:
   - Weight stats by IP across levels
   - Apply level adjustments to translate to MLB-equivalent
   - More recent years weighted higher (5/3 for current/previous)

3. **Blend scouting and stats**:
   ```
   projK9 = scoutWeight × scoutK9 + (1 - scoutWeight) × adjustedK9
   projBb9 = scoutWeight × scoutBb9 + (1 - scoutWeight) × adjustedBb9
   projHr9 = scoutWeight × scoutHr9 + (1 - scoutWeight) × adjustedHr9
   ```

4. **Calculate projected FIP**:
   ```
   projFip = (13 × projHr9 + 3 × projBb9 - 2 × projK9) / 9 + FIP_CONSTANT
   ```

5. **Rank against current MLB pitchers**:
   - Compare `projFip` to all current MLB pitcher FIPs
   - Calculate percentile
   - Convert to 0.5-5.0 scale using standard buckets

**For Players WITH MLB Stats**:

When a player has MLB experience, use their True Rating as the stats component instead of minor league stats:

```typescript
// For MLB players, use True Rating instead of minor league stats
const statsComponent = hasMlbStats ? trueRatingFip : adjustedMinorLeagueFip;

// Blend with scouting projection
const projectedFip = scoutWeight * scoutingFip + (1 - scoutWeight) * statsComponent;
```

The scouting weight for MLB players is naturally lower because:
- They're typically older (age override at 27+)
- They have significant IP (IP factor reduces scouting weight)
- Star gap is typically smaller (more developed)

**Display Logic**:

| Scenario | Display |
|----------|---------|
| TFR > TR + 0.25 | Show both: "TR: 3.5 → TFR: 4.0" (has upside) |
| TFR ≈ TR (within 0.25) | Show TR only with "Developed" badge |
| TFR < TR - 0.25 | Show TR only with "Overperforming" indicator |
| No MLB stats | Show TFR only with "Prospect" badge |

**Relationship Between TR and TFR**:
- **True Rating (TR)**: What you ARE now (based on MLB performance)
- **True Future Rating (TFR)**: What you WILL BE at peak (based on scouting + development)

Examples:
- 24yo with 2 MLB seasons: TR=3.5, TFR=4.0 → Show both (has upside)
- 30yo veteran: TR=4.0, TFR=4.0 → Show TR with "Developed" badge
- 19yo prospect with no MLB stats: TFR=4.5 → Show TFR with "Prospect" badge

**Important Notes**:
- Star ratings (OVR/POT) are NOT used directly in FIP calculation
- Only the star GAP is used, as a development indicator for weighting
- This avoids the known issues with OOTP star inflation for prospects and deflation for MLB players

**Implementation Details**:

The TFR feature is implemented across several files:

**Service: `TrueFutureRatingService.ts`**
```typescript
import { trueFutureRatingService } from './services/TrueFutureRatingService';

// Get TFR for all prospects in a year
const results = await trueFutureRatingService.getProspectTrueFutureRatings(2021, 'my');

// Each result contains:
interface TrueFutureRatingResult {
  playerId: number;
  playerName: string;
  age: number;
  starGap: number;           // POT - OVR
  scoutingWeight: number;    // 0-1, how much to trust scouting
  projK9, projBb9, projHr9: number;  // Blended projected rates
  projFip: number;           // Projected FIP
  percentile: number;        // Rank vs MLB pitchers
  trueFutureRating: number;  // 0.5-5.0 scale
  totalMinorIp: number;
}
```

**UI Integration**:

1. **True Ratings Table** (`TrueRatingsView.ts`):
   - Prospects appear alongside MLB pitchers
   - TFR badge shown instead of TR (with dashed border)
   - "P" badge next to name indicates prospect
   - Stat columns show "—" (no MLB stats)
   - Sorting works across both TR and TFR

2. **Player Profile Modal** (`PlayerRatingsCard.ts`):
   - Shows "True Future Rating" emblem for prospects
   - Percentile shown against MLB pitcher pool
   - Rating bars show scouting vs projected ratings

3. **Projections View** (`ProjectionsView.ts`):
   - Prospects merged with MLB projections
   - TFR used as "Current TR" for sorting/display
   - Projected stats derived from TFR calculation

**Data Requirements**:

Scouting CSV must include OVR and POT columns for TFR to work:
```csv
ID,Name,STU P,OVR,POT,CON P,HRR P,Age
12345,John Doe,55,2.0 Stars,4.5 Stars,50,45,19
```

The parser handles "X.X Stars" format automatically.

### 9. Data Management
A central hub for managing all offline data, including minor league statistics and scouting reports.

**Tabs**:
1.  **Minor League Stats**: Manage historical minor league data for projections.
2.  **Scouting Reports**: Manage scouting data ("My Scout" and "OSA").

**CSV Formats**:
- **Stats**: `ID,Name,IP,HR,BB,K,HR/9,BB/9,K/9`
- **Scouting**: `player_id, name, stuff, control, hra [, ovr, pot, age, stamina, injury_proneness, pitch_ratings...]`
  - **Star Ratings**: OVR (overall) and POT (potential) columns support "X.X Stars" format (e.g., "3.5 Stars")
  - **Pitch Ratings Support**: The parser dynamically identifies additional columns (e.g., "Fastball", "Slider") to determine a pitcher's repertoire and role.
  - **Header Aliases**: Flexible parsing supports various column names:
    - OVR: `ovr`, `overall`, `cur`, `current`
    - POT: `pot`, `potential`, `ceil`, `ceiling`
    - Stamina: `stm`, `stamina`, `stam`
    - Injury: `prone`, `injury`, `injuryproneness`, `inj`

**Features**:
- **Multi-File Upload**: Batch upload multiple CSV files.
- **Source Selection**: Toggle between "My Scout" and "OSA" for scouting data.
- **Data Management**: View and delete stored data sets.
- **Historical Accuracy**: FIP calculations automatically utilize year-specific FIP constants derived from league-wide totals to ensure league average FIP matches league average ERA for every historical season.
- **IndexedDB Storage**: All scouting and minor league data is stored in IndexedDB (not localStorage), providing unlimited storage capacity for large datasets (thousands of prospects)
- **Automatic Migration**: On first launch after update, localStorage data is automatically migrated to IndexedDB with a one-click migration tool

**API Usage**:

```typescript
// Minor League Stats
import { minorLeagueStatsService } from './services/MinorLeagueStatsService';
const stats = minorLeagueStatsService.getStats(2021, 'aaa');

// Scouting Data
import { scoutingDataService } from './services/ScoutingDataService';
const myRatings = scoutingDataService.getScoutingRatings(2021, 'my');
const osaRatings = scoutingDataService.getScoutingRatings(2021, 'osa');
```

## Tools Directory

`tools/` contains Python utilities for data collection:
### `ocr_data_collector.py`
Screen OCR tool for collecting OOTP rating/stat data points.
- Define screen regions via click-drag
- F5 hotkey to log all regions to CSV
- Save/load region configurations as JSON
- Requirements: `pip install pillow pytesseract mss keyboard`
- Also requires Tesseract OCR installed

### `analyze_ootp_data.py`
Regression analysis script to derive rating-to-stat formulas from collected data.
- Requirements: `pip install pandas numpy scikit-learn`

## Data Files

- `ootp_data_*.csv` - Collected rating/stat data from OOTP calculator (screen reader)
- `bb_hits_homers_data.csv` - WBL league pitching data (current year)
- `homer_data.csv` - HR/H9 data with Movement, BABIP, HRA ratings
- `fip_war.csv` - OOTP FIP/WAR data used to calibrate WAR formula parameters
- `regions_pitcher.json` - Saved OCR regions for pitcher data collection
- `RATING_ESTIMATOR_PLAN.md` - Design document for Rating Estimator feature

## Performance Optimizations

### Batch Loading for Prospects
The True Ratings page efficiently handles thousands of prospects by using batch loading:
- **Problem**: Loading minor league stats for 2,700+ prospects required ~43,000 individual database queries (3 years × 4 levels × prospects)
- **Solution**: Single batch query loads all minor league stats at once (12 queries total), then prospects look up their data from an in-memory index
- **Result**: Page load time reduced from 57 seconds to 44 milliseconds (**1,304x speedup**)

### IndexedDB Storage
- **Capacity**: Unlimited storage for large datasets (localStorage is limited to 5-10MB)
- **Performance**: Optimized for bulk reads with batch queries
- **Use Cases**: Storing thousands of scouting reports and minor league stats across multiple years

## Development Notes

- Dark theme UI with CSS variables in `:root`
- Responsive design with mobile breakpoints at 640px
- TypeScript strict mode enabled with `noUnusedLocals`
- Views self-initialize and bind to container elements
- App header includes the WBL logo from `src/images/logo.jpg` (left of title); Draft Board tab is hidden from the main nav
- Team Ratings expanded tables support sortable + draggable columns (with floating sort hint)
- User preferences persist in `localStorage` under the `wbl-prefs` key. Currently stores whether the CSV upload instructions are hidden and whether pitch-rating chips on the draft board are hidden. Preferences are loaded at startup and updated whenever the related toggles are used.
- **Vite Proxy**: The `vite.config.ts` file is configured to handle CORS issues by proxying API requests.
    - `/api` requests are proxied to `https://atl-01.statsplus.net/world`.
