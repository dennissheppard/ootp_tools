# WBL Analysis System

OOTP analysis application for the WBL (World Baseball League). Synthesizes scouting ratings and historical performance to generate True Ratings for pitchers and batters, project future performance, track player development, and evaluate organizational depth.

## Quick Start

```bash
npm install
npm run dev    # Development server (port 5173)
npm run build  # Production build
```

## Technology Stack

- TypeScript + Vite
- IndexedDB v7 for client-side storage
- ApexCharts for data visualization
- Vanilla CSS (dark theme)

## Project Structure

```
src/
├── components/   # Reusable UI components (DevelopmentChart)
├── models/       # TypeScript interfaces
├── services/     # Business logic layer
├── views/        # View components
└── controllers/  # Data orchestration
```

## Core Features

### True Ratings (TR)

Blends scouting grades with actual performance stats to produce a 0.5-5.0 star rating for current MLB players.

**Key design choices:**
- **Percentile-based component ratings** — Contact, Power, Eye, AvK ranked within each season (not absolute thresholds), ensuring fair cross-era comparison
- **HR%-based power** (not ISO) to correctly distinguish gap hitters from power hitters
- **WAR-based ranking** — Final TR percentiles use WAR per 600 PA (incorporates baserunning via SB/CS)
- **Tier-aware regression** — Elite hitters regress toward elite targets, not league average
- **Component stabilization**: BB% 120 PA, K% 60 PA, HR% 160 PA, AVG 300 PA
- **3-layer scouting blend** — see below

#### Scouting Blend (3-Layer System)

Scouting potential ratings are blended with stats-based rates using three layers that work together to handle prospects, rookies, and veterans correctly:

**Layer 1: effectiveDevRatio** — geometric mean of star gap and MLB experience:
```
starDev = min(1.0, OVR / POT)
experienceThreshold = starDev < 1.0 ? 1200 : 500  // PA; pitchers: 150 / 60 IP
experienceDev = min(1.0, totalPA / experienceThreshold)
effectiveDevRatio = √(starDev × experienceDev)
```

**Layer 2: Target scaling** — scouting targets pulled toward league average (50) by effectiveDevRatio:
```
scaledComponent = 50 + (potential − 50) × effectiveDevRatio
```
A 2★/3★ rookie with 56 PA gets effectiveDevRatio ≈ 0.18 → scouting targets sit near league average. A 4★/4★ veteran with 2000 PA gets effectiveDevRatio = 1.0 → full potential.

**Layer 3: Weight boosting** — unproven players get louder scouting voice (anchoring both over- and under-performers):
```
baseScoutWeight = threshold / (PA + threshold)
scoutBoost = 1 − effectiveDevRatio
scoutWeight = min(0.95, baseScoutWeight + scoutBoost × (1 − baseScoutWeight))
```

This design is **directionally neutral**: it dampens scouting inflation for bad players AND preserves scouting's ability to pull down overperformers on small samples. A lucky rookie batting .324 with contact scouting of 45 gets anchored toward league average, not inflated by the hot start.

### True Future Rating (TFR)

A **pure peak/ceiling projection system** — projects what a prospect's age-27 peak season would look like if everything goes right. Uses **100% scouting potential ratings** for all components (MiLB stats belong in TR development curves, not TFR).

#### Pitcher TFR

1. Convert scout potential ratings to projected peak rates (Stuff→K/9, Control→BB/9, HRA→HR/9)
2. Apply ceiling boost: `ceilingValue = meanValue + (meanValue - avgAtRating50) × 0.30`
3. Find each component's percentile in MLB distribution (2015-2020, ages 25-29, 50+ IP)
4. Calculate FIP from mapped rates (K9: 3.0-13.0, BB9: 0.50-7.0, HR9: 0.15-2.5)
5. Map FIP to MLB peak-year FIP distribution for final TFR (0.5-5.0 scale)

**Peak Workload:**
- Starters (Stamina ≥ 30, 3+ pitches): `baseIp = 30 + (stamina × 3.0)` (clamped 120-260)
- Relievers: `baseIp = 50 + (stamina × 0.5)` (clamped 40-80)
- Injury modifiers: Ironman 1.15×, Durable 1.10×, Normal 1.0×, Fragile 0.90×, Wrecked 0.75×
- Injury modifier only applies to prospects without historical data

#### Batter TFR

**6 Components:**

| Component | Rating | Stat | Coefficient |
|-----------|--------|------|-------------|
| Eye | Eye (20-80) | BB% | 1.6246 + 0.114789 × eye |
| AvoidK | AvoidK (20-80) | K% | 25.10 - 0.200303 × avoidK |
| Power | Power (20-80) | HR% | Piecewise: ≤50: -1.034 + 0.0637 × power, >50: -2.75 + 0.098 × power |
| Contact | Contact (20-80) | AVG | 0.035156 + 0.003873 × contact |
| Gap | Gap (20-80) | 2B rate | -0.012627 + 0.001086 × gap |
| Speed | Speed (20-80) | 3B rate | -0.001657 + 0.000083 × speed (20-200 internally) |

**Important:** Uses **Contact rating** (not Hit Tool) for AVG — Contact correlates at r=0.97 vs Hit Tool's r=0.82. CSVs map `CON P`, not `HT P`.

**Algorithm:**
1. Convert scout potential ratings to projected peak rates (100% scouting)
2. Apply ceiling boost: `ceilingValue = meanValue + (meanValue - avgAtRating50) × 0.35`
3. Eye/AvoidK/Power/Contact percentiles from MLB distribution (2015-2020, ages 25-29, 300+ PA)
4. Gap/Speed mapped to expected 2B/AB and 3B/AB, then percentile-ranked in MLB doubles/triples distributions from the same peak-age sample (prospect-rank fallback only if MLB arrays are unavailable)
5. Calculate wOBA: `0.69×BB + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR`
6. Compute WAR per 600 PA (includes SB runs)
7. Map WAR to MLB peak-year distribution for final TFR (0.5-5.0 scale)

### Prospect True Rating (Development Curves)

For prospects (no MLB stats), TR represents **estimated current ability** derived from historical cohort analysis (245 MLB players, 2012+ debuts, 600+ PA with MiLB history).

1. **Cohort selection** — Prospect's projected peak stat selects historical players with similar peak MLB performance
2. **Expected curve value** — PA-weighted mean MiLB stat at each age (18-26) defines the development curve
3. **Development fraction** — `devFraction = (curveVal[age] - curveVal[minAge]) / (curveVal[maxAge] - curveVal[minAge])`
4. **Baseline TR** — `baseline = 20 + (TFR - 20) × devFraction`
5. **Individual adjustment** — `ratingAdjust = deviation × shrinkage × 8` (if MiLB stats available)
6. **Final TR** — `clamp(baseline + ratingAdjust, 20, TFR)`

**Stabilization PA:** Eye 600, AvoidK 200, Power 400, Contact 400. Gap/Speed use average fraction from stats-based components.

**Implementation:** `ProspectDevelopmentCurveService.calculateProspectTR()` → stored on `RatedHitterProspect.developmentTR`.

### Multi-Year Stat Weighting

4-year rolling window with weights that shift as the season progresses (`DateService.getSeasonProgress()` returns 0-1):

```
currentYear = 5 × progress        // 0 → 5
yearN1      = 5 − 2 × progress    // 5 → 3
yearN2      = 3 − progress         // 3 → 2
yearN3      = 2 − 2 × progress    // 2 → 0
                                   // Always sums to 10
```

### TFR/TR Unified Display

Instead of proxy thresholds, the actual ratings comparison determines display:

- **TFR > TR or component upside** → Show both: TR primary + TFR ceiling bars, Peak badge, Current/Peak toggle
  - Rating bars: TR value inside colored bar, TFR at bar's end
  - Diff column compares TFR vs Scout (both peak projections)
  - Component upside: any TFR component exceeds TR counterpart by >= 5 points
- **TFR <= TR and no component upside** → TFR disappears entirely
- **No TR** (pure prospect) → Development-curve TR as current + TFR as ceiling
- **Gate check** (skip TFR calculation): age >= 26 AND star gap < 0.5
- **Projection toggle**: Current uses TR blended rates; Peak uses TFR blended rates directly (NOT formula-derived from 20-80 ratings — the round-trip is lossy)

### Player Tags

Contextual pill badges in the profile modal tab bar (right-aligned, next to Ratings/Career/Development tabs). Computed by `src/utils/playerTags.ts`. Currently calculated on-the-fly at modal launch (not pre-indexed); future work could batch-compute for searchability.

**Shared tags (pitchers & batters):**

| Tag | Color | Condition |
|-|-|
| Overperformer | amber | Overall TR > TFR |
| Underperformer | amber | devRatio ≥ 0.8, TFR − TR ≥ 0.5 |
| Expensive | amber | salary ≥ $3M, WAR > 0.5, $/WAR in bottom 1/3 of league |
| Bargain | green | salary ≥ $3M, WAR > 0.5, $/WAR in top 1/3 of league |
| Ready for Promotion | green | prospect, devRatio ≥ 0.5, MiLB PA ≥ 300 (batters) or IP ≥ 100 (pitchers) |
| Blocked | red | prospect, TFR ≥ 3.0, incumbent TR ≥ 3.5 with 3+ years remaining |

**Pitcher workload tags (mutually exclusive, priority order):**

| Tag | Color | Condition |
|-|-|
| Workhorse | green | projIP ≥ 230 AND injury = Durable or Iron Man |
| Full-Time Starter | green | projIP ≥ 180 AND FIP ≥ 40th percentile |
| Innings Eater | amber | projIP ≥ 180 AND FIP 30th–59th percentile (below Full-Time Starter threshold) |

FIP percentile: higher = better pitcher (% of league with worse FIP). Computed from league distribution (50+ IP qualifiers).

**Batter workload & profile tags:**

| Tag | Color | Condition |
|-|-|
| Workhorse | green | projPA ≥ 650 |
| 3-Outcomes | amber | projAVG < .250, K% > 16%, BB% > 9%, HR% > 3.7% |
| Gap Hitter | green | True Gap ≥ 65, True Power ≤ 40 |
| Triples Machine | green | True Gap ≥ 70, Speed ≥ 60 |

Gap Hitter and Triples Machine can coexist. All use True Rating (20-80) values from `estimatedGap`/`estimatedPower`/`estimatedSpeed`.

### Projections

Three-model ensemble:
- **Optimistic** (40%): Standard aging curves
- **Neutral** (30%): Status quo
- **Pessimistic** (30%): Trend-based decline

**Pitcher projection pipeline:**
1. Multi-year weighted stats → 4-year rolling average
2. FIP-aware regression (elite pitchers regress less)
3. Scouting blend at IP/(IP+60) weight
4. Rating estimation (inverse formulas)
5. Ensemble aging: 35% full aging, 65% 20%-aging
6. Rating→Rate conversion (forward formulas)

**Rating ranges:** Internal calculations use 0-100 (prevents artificial capping at extremes); UI displays 20-80.

### Pipeline Modes

Two pipelines that answer different questions (see `docs/pipeline-map.html`):

- **Canonical Current**: "What is this player worth right now?" Uses authoritative TR from `TrueRatingsService`, resolves TFR/prospect data, runs modal-equivalent projection math via `ModalDataService`. Every current-truth view shows the same numbers as the profile modal. `ProjectionService.calculateProjectedIp()` is used as a shared utility for IP estimation (not full projections).
- **Forecasting Model**: "What does the model predict for next season?" (`ProjectionService` / `BatterProjectionService`). Computes its own TR from arbitrary-year stats, uses ensemble projection math (40% optimistic, 30% neutral, 30% pessimistic), supports backtesting and year selection.

These are intentionally separate — numbers may differ between them and that's correct.

| View | Pipeline | Notes |
|-|-|-|
| Profile modals | Canonical Current | Always re-resolve canonical values |
| Trade Analyzer | Canonical Current | Via `CanonicalCurrentProjectionService` |
| True Ratings | Canonical Current | TR/TFR maps as source of truth |
| Farm Rankings | Canonical Current | TFR pools for prospect rankings |
| Team Planning | Canonical Current | TR maps + TFR for roster construction |
| Global Search | Canonical Current | Canonical TR + TFR pools for search results |
| Team Ratings: Power Rankings | Canonical Current | Weighted-average TR |
| Team Ratings: Projections/Standings | Forecasting Model | Pre-season/Current Year Stats toggle controls stats year |
| Projections view | Forecasting Model | Year selector, backtesting |
| Data Management | Canonical Current | Infrastructure: data upload + cache priming |
| Other views | — | Analytics, DraftBoard, Calculators, etc. — no pipeline dependency |

TeamRatingsView projections/standings force the selected season to the current game year, but remain model outputs (not literal in-season standings progression). The Pre-Season/Current Year Stats toggle controls whether projection services use prior-year-only data (pure pre-season) or allow current-year stats to influence projections.

## Key Services

### Pitcher Services

| Service | Purpose |
|---------|---------|
| `TrueRatingsService` | MLB stats fetching, pitcher True Rating calculation |
| `TrueRatingsCalculationService` | Core pitcher TR algorithm with multi-year weighting (inverse formulas) |
| `TrueFutureRatingService` | Pitcher prospect TFR (FIP-based peak projections, direct MLB distribution comparison) |
| `PotentialStatsService` | Rating→rate stat conversion (forward formulas — intercepts must match inverse) |
| `FipWarService` | FIP calculation, WAR formula, constants |
| `ScoutingDataService` | Pitcher scouting CSV parsing and storage |

### Batter Services

| Service | Purpose |
|---------|---------|
| `HitterTrueRatingsCalculationService` | Batter True Rating calculation (percentile-based components) |
| `HitterTrueFutureRatingService` | Batter prospect TFR (wOBA-based peak projections) |
| `ProspectDevelopmentCurveService` | Prospect TR via historical development curves |
| `HitterRatingEstimatorService` | Rating↔stat conversion coefficients |
| `HitterScoutingDataService` | Batter scouting CSV parsing (maps CON P, not HT P) |
| `BatterProjectionService` | Batter projections integration |

### Shared Services

| Service | Purpose |
|---------|---------|
| `ModalDataService` | Pure functions for modal data resolution and projection computation (extracted from profile modals for testability) |
| `CanonicalCurrentProjectionService` | Builds cached modal-equivalent MLB projection snapshots for current-year canonical pipeline consumers (Trade Analyzer) |
| `ContractService` | Contract parsing, salary schedules, years remaining, team control |
| `TeamRatingsService` | Farm rankings, org depth, Farm Score, Power Rankings, team WAR projections |
| `StandingsService` | Historical standings data (bundled CSVs, 2005-2020) |
| `ProjectionService` | Future performance projections, IP projection pipeline |
| `EnsembleProjectionService` | Three-model ensemble blending |
| `AgingService` | Age-based rating adjustments |
| `DevelopmentSnapshotService` | Historical scouting snapshot storage |
| `MinorLeagueStatsService` | Minor league stats from API/CSV |
| `IndexedDBService` | Persistent browser storage (v7) |
| `DateService` | Season progress calculation for stat weighting |

## Views

| View | Purpose |
|------|---------|
| `TrueRatingsView` | Pitcher/batter dashboard with TR/projections; level-based filtering (MLB / Minor Leaguers / Future Draftees / Free Agents) via scouting `Lev`/`HSC` columns |
| `FarmRankingsView` | Top 100 prospects, org rankings with Farm Score |
| `ProjectionsView` | Future performance projections with 3-model ensemble |
| `TeamRatingsView` | Power Rankings / Projections / Standings toggle |
| `TeamPlanningView` | 6-year roster planning grid with prospects, contracts, trade market |
| `TradeAnalyzerView` | Multi-asset trade evaluation (MLB + prospects + draft picks) |
| `DataManagementView` | File uploads with header validation |
| `PlayerProfileModal` / `BatterProfileModal` | Deep-dive with Ratings + Development tabs + player tags |

### Team Ratings & Projected Standings

Three modes: Power Rankings (weighted avg TR), Projections (weighted WAR), Standings (projected W-L).

**Pre-Season / Current Year Stats toggle** (Projections & Standings): Pre-Season forces all data sources to `year - 1` (stats, IP distribution, league context, role classification). Current Year Stats uses live data. Persisted in `wbl-teamratings-statsMode`. Data source badge updates accordingly.

**Weighting:** 40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench (Power Rankings & Projections). Standings uses raw WAR sum (rotation + bullpen + lineup; bench excluded).

**WAR→Wins (Piecewise):**
```
medianWAR = median(all team WARs)
deviation = Team WAR - medianWAR
slope = 0.830 (above median) or 0.780 (below median)
rawWins = 81 + deviation × slope
// League normalized so total W = total L
```

**Runs Scored/Allowed:** RS from wRC (lineup+bench), RA from FIP×IP/9 (rotation+bullpen). RS normalized so league RS = league RA. Pythagorean record (exponent 1.83) shown as sanity check.

**Roster assignment:** Players assigned by current roster team (`player.teamId`), not stats-year team. Free agents (`teamId=0`) are excluded even if they have stats for a team.

**Lineup/Bench split (Standings & Projections):** Top 9 by projected WAR → lineup, next 4 → bench.

**Historical backtesting:** When viewing 2005-2020, shows Act W/L and Diff columns with MAE/R² summary.

### Team Planning

6-year roster planning grid. `src/views/TeamPlanningView.ts`

**Rating Projections (`projectPlanningRating()`):**
- Growth (age < 27, TFR > TR): linear interpolation toward TFR, peak at 27
- Peak plateau: ages 27-29
- Aging decline: 30-32 -0.05/yr, 33-35 -0.10/yr, 36-38 -0.20/yr, 39+ -0.30/yr
- Floor: 0.5, rounded to nearest 0.5

**Prospect Starting Ratings (`computeProspectCurrentRating()`):**
- Derived from `developmentTR` component fractions, averaged: `estimatedStar = 0.5 + (TFR - 0.5) * avgFraction`
- **Planning grid uses canonical TR when available** (`canonicalTr ?? devRating`), not `Math.max(devRating, canonicalTr)`. Once a player has MLB stats, the stats-based TR is authoritative.

**Team Control:** Service years counted from actual MLB stats years. `teamControlRemaining = 6 - serviceYears + 1`.

**Color Coding:** Green=under contract, Yellow=final year, Purple=arb eligible, Blue=prospect, Red=empty/gap, Dashed blue=override.

**Prospect ETA:** MLB=0yr, AAA=1yr, AA=2yr, A=3yr, R=4yr, IC=5yr. Elite (TFR≥4.0) get 1yr acceleration, strong (≥3.5) get 0.5yr.

**Prospect placement:** Greedy improvement-based (biggest rating upgrade over incumbent). Override-aware: user edits are locked constraints.

**View modes:** Planning Grid | Org Analysis | Trade Market toggle.

**Trade Market (`analyzeTeamTradeProfile()`, `findTradeMatches()`):**
- Analyzes all 20 teams' rosters/farms, no additional fetches
- Year selector shifts analysis to future years
- Sections: Your Situation (needs + trade chips) | Trade Targets by Position
- Blocked prospects: TFR≥3.0 blocked by incumbent TR≥3.5 with 3+ years remaining
- Scoring: `rating×10` + trade-match bonus + proximity bonus
- **Trade-match badge** (renamed from "2-Way"): only shown on surplus players (tier 1-2), never on general roster targets
- **Trade flags** (per-player, localStorage): "Tradeable" forces a player into trade chips; "Not Tradeable" removes them. Set via cell edit modal.
- **Need overrides** (per-position, localStorage): "Mark as Position of Need" forces a position into the needs list regardless of auto-detection. Set via cell edit modal footer.
- Trade flags and need overrides are team-scoped (`wbl-tp-tradeFlags-{teamId}`, `wbl-tp-needOverrides-{teamId}`)

**Cell Editing:** Overrides persisted in IndexedDB (`TeamPlanningOverrideRecord`). Dev curve overrides: skip growth phase, project at TFR with only aging decline.
- **Canonical rating resolution:** Org picker and manual insert both use a shared best-known rating resolver (grid value, canonical TR, prospect current/TFR maps) to avoid stale `0.5` fallbacks.
- **Single-slot invariant:** Manual player insert clears that player from any other slot in the same team/year before saving, preventing duplicate placements (e.g. `MR1` + `MR5` in one season).

**Section/Team Ratings:** Lineup/Rotation/Bullpen averages per year. Team row = 40% rotation + 40% lineup + 20% bullpen.

**Indicators:** CLIFF, EXT, FA, TR, UPGRADE, EXPENSIVE, TRADE, FA_TARGET.

### Farm System Rankings

```
Farm Score = (Elite × 10) + (Good × 5) + (Avg × 1) + Depth Bonus
```
Elite: TFR≥4.5 (10pts), Good: 3.5-4.4 (5pts), Average: 2.5-3.4 (1pt). Depth bonus: <10=0, 10-14=2, 15-24=4, 25+=5.

### Trade Analyzer

Three-column layout: Team 1 | Analysis | Team 2. `src/views/TradeAnalyzerView.ts` (~2100 lines).

**Key points:**
- MLB player projections come from `CanonicalCurrentProjectionService` (modal-equivalent current pipeline)
- Prospect/farm context comes from unified TFR pools (`getUnifiedPitcherTfrData` / `getUnifiedHitterTfrData`)
- WAR split into Current (MLB) and Future (prospects + picks)
- Trade archetypes: Roster swap (>70% current both sides), Win-now vs future (>50% ratio difference), Prospect swap (>70% future both sides)
- Team impact: clones power ranking roster, applies trade, recalculates with 40/40/15/5 weights
- Farm Impact tab: prospects lost/gained with tier summary
- AI analysis via `AITradeAnalysisService` (gpt-4o-mini, cached in IndexedDB)

### Player Development Tracker

- Snapshots auto-created on scouting data upload
- Historical upload: name files `[type]_scouting_[source]_YYYY-MM-DD.csv`
- Development tab shows rating trends via ApexCharts
- MLB players see True Rating history; prospects see scouting snapshots

### Sticky User Preferences

| Key | Scope |
|-----|-------|
| `wbl-selected-team` | Global (shared across all views) |
| `wbl-tp-viewMode` | Team Planning (grid/analysis/market) |
| `wbl-tp-marketYear` | Team Planning year offset |
| `wbl-tp-tradeFlags-{teamId}` | Team Planning per-player trade flags |
| `wbl-tp-needOverrides-{teamId}` | Team Planning per-position need overrides |
| `wbl-teamratings-viewMode` | Team Ratings mode |
| `wbl-teamratings-statsMode` | Team Ratings pre-season vs current year stats |
| `wbl-proj-position` / `wbl-proj-year` | Projections |
| `wbl-prefs` | True Ratings (JSON blob) |
| `wbl-active-tab` | Active nav tab |

## Key Formulas

**Pitcher Rating↔Rate (forward and inverse MUST match):**
```
K/9  = 2.10 + 0.074 × Stuff        Stuff   = (K/9  - 2.10) / 0.074
BB/9 = 5.30 - 0.052 × Control       Control = (5.30 - BB/9) / 0.052
HR/9 = 2.18 - 0.024 × HRA          HRA     = (2.18 - HR/9) / 0.024
```

**FIP:** `((13 × HR/9) + (3 × BB/9) - (2 × K/9)) / 9 + 3.47`

**Pitcher WAR:** `((replacementFIP - playerFIP) / 8.5) × (IP / 9)`

**Batter WAR:** `(wRAA + replacementRuns + sbRuns) / runsPerWin` where `wRAA = ((wOBA − lgWoba) / wobaScale) × PA`, `replacementRuns = (PA / 600) × 20`

**wOBA:** `0.69×BB + 0.89×1B + 1.27×2B + 1.62×3B + 2.10×HR`

**Stolen Bases:**
```
Attempts (per 600 PA, 3-segment piecewise):
  SR ≤ 55:  -2.300 + 0.155 × SR
  55 < SR ≤ 70: -62.525 + 1.250 × SR
  SR > 70:  -360.0 + 5.5 × SR
Success rate: 0.160 + 0.0096 × STE (clamped 0.30-0.98)
```

**Doubles/Triples:** `doublesRate = -0.012627 + 0.001086 × gap`, `triplesRate = -0.001657 + 0.000083 × speed(20-200 converted)`

**Level-Weighted IP/PA:** `(AAA × 1.0) + (AA × 0.7) + (A × 0.4) + (R × 0.2)`

## Data Sources

**StatsPlus API:**
- Pitchers: `/api/playerpitchstatsv2/` | Batters: `/api/playerbatstatsv2/`
- Params: `year`, `lid` (200=MLB, 201-204=minors), `split=1`

**CSV Column Mappings:**

*Pitcher Scouting:* `player_id, name, stuff, control, hra [, age, ovr, pot, pitches...]`

*Shared Columns (both pitcher and batter scouting):*

| Column | Maps To | Notes |
|-|-|-|
| `Lev` | lev | Player level: `MLB`, `AAA`, `AA`, `A`, `R`, `INT`, `-` |
| `HSC` | hsc | High school/college status (e.g. `HS Senior`, `CO Junior`). Only present in hitter CSVs |
| `DOB` | dob | Date of birth (`MM/DD/YYYY`). Used for age when `Age` column absent |
| `POS` | pos | Position label (hitter CSVs only): `LF`, `SS`, `C`, etc. |

*Batter Scouting:*

| Column | Maps To | Notes |
|-|-|-|
| `POW P` | power | HR% |
| `EYE P` | eye | Plate discipline |
| `K P` | avoidK | Avoid strikeout |
| `CON P` | contact | **Use this, NOT HT P** |
| `GAP P` | gap | Doubles projection |
| `SPE` | speed | Triples projection |
| `SR` | stealingAggressiveness | Attempt volume |
| `STE` | stealingAbility | Success rate |

## Configuration

| Constant | Value | Location |
|----------|-------|----------|
| League start year | 2000 | — |
| Peak age | 27 | Pitcher prospect TR; batter uses dev curves |
| FIP_CONSTANT | 3.47 | `FipWarService.ts` |
| replacementFip | avgFip + 1.00 | Dynamic (~5.20) |
| runsPerWin | 8.5 | `FipWarService.ts` |
| Batter ceiling boost | 0.35 | `HitterTrueFutureRatingService.ts` |
| Pitcher ceiling boost | 0.30 | `TrueFutureRatingService.ts` |
| Full confidence IP | 150 | Pitchers |
| Pitcher MLB distribution | 2015-2020, ages 25-29, 50+ IP | TFR |
| Batter MLB distribution | 2015-2020, ages 25-29, 300+ PA | TFR |

## IndexedDB Schema (v7)

| Store | Purpose |
|-------|---------|
| `scouting_ratings` | Date-stamped scouting snapshots |
| `minor_league_stats` | League-level stats by year/level |
| `player_minor_league_stats` | Player-indexed stats for O(1) lookup |
| `mlb_league_stats` | Full MLB data by year |
| `player_development_snapshots` | Historical TR/TFR/scouting for dev tracking |
| `players`, `teams` | Roster caches |

## Tools

### Debugging & Validation

| Tool | Purpose | Usage |
|------|---------|-------|
| `tools/validate-ratings.ts` | Automated TR validation (WAR correlation, distributions, stability) | `npx tsx tools/validate-ratings.ts --year=2020` |
| `tools/investigate-pitcher-war.ts` | Investigate pitcher WAR projection gaps | `npx tsx tools/investigate-pitcher-war.ts` |
| `tools/report-hitter-gap-speed-deltas.mjs` | Offline delta report for Gap/Speed migration (MLB-mapped vs legacy prospect-rank midpoint) | `node tools/report-hitter-gap-speed-deltas.mjs --playerId=14422 --top=20` |
| `tools/explain-player.ts` | Explains a player's TR/projection using real services + trace output (text/json/markdown), including modal-equivalent current projection path and `--projectionMode=current|peak` | `npx tsx tools/explain-player.ts --playerId=1234 --type=hitter --mode=all --year=2026 --projectionMode=current --format=markdown` |

The CLI explain flow uses instrumented service calls so output stays in sync with production math. It now emits canonical future component context (including Future Gap/Speed derivation) to debug modal-equivalent outputs. A future in-app "Explain This Rating" panel can reuse the same trace objects.

### Calibration

| Tool | Purpose |
|------|---------|
| `calibrate_projections.ts` | Full projection pipeline calibration (WAR→Wins, compression, IP) |
| `calibrate_batter_coefficients.ts` | Optimize rating→stat intercepts |
| `calibrate_sb_coefficients.ts` | Grid-search SR/STE coefficient space |
| `calibrate_ensemble_weights.ts` | Grid-search pitcher projection ensemble weights |
| `backtest_pythagorean.ts` | Compare WAR vs Pythagorean win projections |
| `test_hitter_tfr.ts` | Validate TFR accuracy against outcomes |

### Research

`tools/research/` contains one-off analysis scripts (development curves, level adjustments, TFR optimization, aging curves). Historical artifacts for understanding model construction.

## Testing

Jest with ts-jest (ESM mode):

```bash
npx jest                                              # All tests
npx jest src/services/RatingConsistency.test.ts        # Specific file
```

| File | Tests | Coverage |
|------|-------|----------|
| `RatingConsistency.test.ts` | 36 | TR/TFR determinism, cross-service consistency, hitter round-trips, data contracts, pool sensitivity, TFR display logic, scouting blend dev-ratio scaling |
| `playerTags.test.ts` | 43 | Player tags: shared (overperformer, underperformer, expensive, bargain, ready for promotion, blocked), pitcher workload (workhorse, full-time starter, innings eater), batter profile (workhorse, 3-outcomes, gap hitter, triples machine) + edge cases |
| `ModalDataService.test.ts` | 17 | Resolve and projection functions across prospect/MLB player archetypes (batter and pitcher) |
| `RatingEstimatorService.test.ts` | 20 | Pitcher rating estimation with confidence intervals |
| `ProjectionService.test.ts` | 8 | IP projection pipeline |
| `TeamPlanningView.test.ts` | 3 | Rating resolution and grid manipulation |

## Architecture Notes

- **Pipeline map (view -> data path):** `docs/pipeline-map.html` (Canonical Current vs Forecasting Model). Audited 2026-02-20: all views verified against documented pipeline assignments
- **Shared IP utility exception**: `ProjectionService.calculateProjectedIp()` is used by canonical consumers (`PitcherProfileModal`, `CanonicalCurrentProjectionService`) for innings-pitched estimation only — not full projections. This is a stateless utility call; no ensemble math or forecasting output crosses the pipeline boundary
- **Single source of truth for TFR**: use unified pools `TeamRatingsService.getUnifiedHitterTfrData()` / `getUnifiedPitcherTfrData()` for mixed MLB+prospect contexts; `getHitterFarmData()` / `getFarmData()` are farm-only wrappers. Never call `calculateTrueFutureRatings()` independently. Use `prospect.trueFutureRating` (precomputed) — NEVER re-derive from `prospect.percentile`
- **Single source of truth for TR**: `TrueRatingsService.getHitterTrueRatings(year)` / `getPitcherTrueRatings(year)` — every view MUST use these cached methods instead of calling `trueRatingsCalculationService.calculateTrueRatings()` directly
- **Single source of truth for percentile→rating**: `PERCENTILE_TO_RATING` in `TrueFutureRatingService.ts` / `HitterTrueFutureRatingService.ts` — NEVER create local copies of this mapping (thresholds: 99→5.0, 97→4.5, 93→4.0, 75→3.5, 60→3.0, 35→2.5, 20→2.0, 10→1.5, 5→1.0, 0→0.5)
- **Modal canonical override**: Both profile modals override caller-provided TR/TFR data with canonical values, guaranteeing consistency regardless of which view opens them
- **Trade Analyzer MLB parity**: `CanonicalCurrentProjectionService` snapshots are modal-equivalent and should be preferred over base-year projection maps for current-context analysis. League-wide data (TR, TFR, scouting, stats) is loaded once and cached; per-team snapshots are built synchronously from cached data with team-level cache tracking to skip already-processed teams
- **Data-source clarity**: use `renderDataSourceBadges()` from `src/utils/dataSourceBadges.ts` when a view mixes season/scouting modes (Current YTD vs Forecasting Model, My/OSA/Fallback)
- **Rating display rule**: Any view showing a player rating MUST use canonical TR/TFR values, not projection-derived or locally-computed alternatives. `ProjectionService` overlays canonical TR onto `currentTrueRating` after building projections (its internal TR is only used for aging/ensemble inputs)
- **Modal projectionOverride trap**: `projectedRatings` MUST use `trueRatings` values (not scouting), or True Rating bars show scouting values instead of TFR-derived
- **Injury values** in CSV `Prone` column: `Iron Man, Durable, Normal, Fragile, Wrecked` (NOT `Wary`/`Prone` as ScoutingData.ts comments incorrectly say)
- **Player level classification**: `src/utils/playerLevel.ts` — `classifyPlayer(lev, hsc)` returns `'mlb' | 'minors' | 'draftee' | 'freeAgent'` from scouting CSV fields. Contract freshness updates stale levels when game date > scouting date via `buildFreshnessUpdatedLevels()`. Falls back to `isProspect` when `Lev` column is absent
- **ISO trap**: Never use deprecated `expectedIso(power)` — ignores Gap/Speed. Use pre-computed `tfrSlg` or component rates
- **Forward/inverse intercept alignment**: Pitcher rating↔rate intercepts MUST match in both directions or round-trip bias is amplified by FIP weights
