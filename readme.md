# WBL Analysis System

OOTP analysis application for the WBL (World Baseball League). Synthesizes scouting ratings and historical performance to generate True Ratings for pitchers and batters, project future performance, track player development, and evaluate organizational depth.

## Quick Start

```bash
npm install
npm run dev    # Development server (port 5173)
npm run build  # Production build
```

## Data Architecture

The app uses a **CLI-first data pipeline**: a local CLI tool writes all data to Supabase, and the browser is a **pure reader**.

### Data Flow

```
StatsPlus API ──→ CLI (tools/sync-db.ts) ──→ Supabase (PostgreSQL)
                                                    ↓
                                              Browser (read-only)
```

1. **CLI sync** (`npx tsx tools/sync-db.ts`): Fetches current-year data from StatsPlus API, writes players/teams/stats/contracts to Supabase, computes TR, TFR, and projections, writes pre-computed ratings to `player_ratings` table and projections to `precomputed_cache`
2. **Browser**: When Supabase is configured, all StatsPlus API calls are blocked (`ApiClient.ts` guard) — the only allowed API call is `/api/date/`. Services read exclusively from Supabase. Without Supabase, the app falls back to CSV/API for dev mode.
3. **Pre-computed ratings + projections**: TR, TFR, and pitcher/batter projections are computed by the CLI and stored as JSONB in `player_ratings` / `precomputed_cache`. The browser loads them directly — no expensive computation on page load.

### Supabase Tables

| Table | Purpose |
|-|-|
| `players` | Full player data (name, team, age, level, position, role). Level values: 1=MLB, 2=AAA, 3=AA, 4=A, 5=R, 6=IC (set by CLI from contract league_id) |
| `teams` | Team names, nicknames, parent relationships |
| `pitching_stats` | MLB + MiLB pitching stats by year/league/split (PK: id, year, level_id) |
| `batting_stats` | MLB + MiLB batting stats by year/league/split (PK: id, year, level_id) |
| `pitcher_scouting` | Pitcher scouting ratings by source (my/osa) |
| `hitter_scouting` | Hitter scouting ratings by source (my/osa) |
| `contracts` | Player contracts with salary schedules (JSONB) |
| `player_ratings` | Pre-computed TR/TFR as JSONB (PK: player_id, rating_type) |
| `precomputed_cache` | Key-value JSONB store for compact lookups and cached distributions (see below) |
| `data_version` | `game_date` TEXT — set by `complete_sync()` RPC as "data ready" signal |

**`precomputed_cache` keys:**

| Key | Written by | Read by | Purpose |
|-|-|-|-|
| `pitcher_scouting_lookup` | sync-db Step 6 | TrueRatingsView | Compact `{[playerId]: [stuff, ctrl, hra, ovr, pot, lev, hsc, name?, age?, stamina?]}` — replaces 12-page bulk scouting fetch |
| `hitter_scouting_lookup` | sync-db Step 6 | TrueRatingsView | Compact `{[playerId]: [con, pow, eye, avK, gap, spd, ovr, pot, lev, hsc, name?, age?]}` |
| `contract_lookup` | sync-db Step 6 | TrueRatingsView | Compact `{[playerId]: {salary, leagueId, faYear}}` — replaces 7-page bulk contract fetch |
| `dob_lookup` | sync-db Step 6 | TrueRatingsView | Compact `{[playerId]: birthYear}` — replaces 12-page bulk player DOB fetch |
| `pitcher_tfr_prospects` | sync-db Step 5 | TeamRatingsService | Full `RatedProspect[]` array — replaces 3-4 paginated `player_ratings` requests |
| `hitter_tfr_prospects` | sync-db Step 5 | TeamRatingsService | Full `RatedHitterProspect[]` array |
| `pitcher_mlb_distribution` | sync-db Step 5 | sync-db (cached) | MLB peak-age distribution for TFR percentile calculation |
| `hitter_mlb_distribution` | sync-db Step 5 | sync-db (cached) | Same for hitters |
| `league_context` | sync-db Step 6 | LeagueBattingAveragesService | League-wide averages, $/WAR thresholds |
| `pitcher_projections` | sync-db Step 5.5 | ProjectionService | Full `ProjectionContext` (projections array + metadata) — replaces 10+ Supabase requests + expensive computation |
| `batter_projections` | sync-db Step 5.5 | BatterProjectionService | Full `BatterProjectionContext` (projections array + metadata) |

**RPC functions:** `clear_for_sync()` (wipes contracts + ratings), `complete_sync(date)` (sets game_date)

### IndexedDB (Local-Only, v12)

| Store | Purpose |
|-|-|
| `team_planning_overrides` | Manual cell placements in team planning grid |
| `player_dev_overrides` | Per-player "fully developed" override |
| `salary_overrides` | Per-cell salary overrides in team planning grid |
| `scouting_ratings` | User-uploaded scouting snapshots (my scout data) |
| `player_development_snapshots` | Historical TR/TFR/scouting for dev tracking |

IndexedDB is bypassed for reads when Supabase is configured. In-memory caches only.

### CLI Sync Tool

```bash
npx tsx tools/sync-db.ts                 # Auto-detect year/date from API
npx tsx tools/sync-db.ts --year=2021     # Explicit year
npx tsx tools/sync-db.ts --skip-compute  # Data only, skip TR/TFR computation
npx tsx tools/sync-db.ts --force         # Re-sync even if DB is up to date
```

**Env vars** (`.env.local`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

**Steps:** Detect game date → Clear stale data → Fetch teams/players/stats/contracts → Patch IC player levels (contract league_id=-200 → level=6) → Compute TR (pitcher + hitter) → Compute TFR (pitcher + hitter) + store TFR arrays in precomputed_cache → Compute projections (pitcher + batter) → Compute league context + build scouting/contract/DOB lookups → Set game_date

**Skip detection:** The CLI compares the DB's `game_date` (set as the very last step of a successful sync) against the StatsPlus API date. If they match, the sync exits early — no work needed. Use `--force` to override.

### Non-Supabase Dev Mode

Without Supabase env vars, the app falls back to the StatsPlus API + CSV files. IndexedDB is used for caching in this mode. The API guard in `ApiClient.ts` is inactive, so all StatsPlus endpoints work normally.

## Deployment (Vercel)

Hosted on Vercel. The app needs to proxy `/api/*` requests to the StatsPlus server (`atl-01.statsplus.net`) since the browser can't call it directly (CORS).

**How it works:**

- `api/proxy.js` — Node.js serverless function that forwards requests to `https://atl-01.statsplus.net/world/api/`
- `ApiClient.ts` (`proxyRewrite()`) — In production, rewrites `/api/date/?foo=1` to `/api/proxy?path=date/&foo=1` so the browser calls the function route directly
- `vercel.json` — Only contains the SPA catch-all (`/(.*) → /index.html`). No API rewrites.
- Local dev uses Vite's built-in proxy (`vite.config.ts`) — `proxyRewrite()` is skipped on localhost

**Why not Vercel rewrites?** Vercel rewrites (both external URL and rewrite-to-function) don't reliably reach serverless functions in non-Next.js projects — the SPA catch-all intercepts first and serves `index.html`. The client-side rewrite bypasses this entirely since `/api/proxy` is resolved as a function route before rewrites are consulted.

## Technology Stack

- TypeScript + Vite
- Supabase (PostgreSQL via PostgREST) for primary data storage
- IndexedDB v12 for local-only data (team planning overrides, dev snapshots)
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
2. Apply ceiling boost: `ceilingValue = meanValue + (meanValue - avgAtRating50) × 0.27`
3. Find each component's percentile in MLB distribution (2015-2020, ages 25-32, 50+ IP)
4. Calculate FIP from mapped rates (K9: 3.0-13.0, BB9: 0.50-7.0, HR9: 0.20-2.5)
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
3. Eye/AvoidK/Power/Contact percentiles from MLB distribution (2015-2020, ages 25-32, 300+ PA)
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

**Batter SB blending:** Both pipelines blend scouting SB/CS projections with historical per-PA rates for MLB players (see Stolen Bases formula). Prospects with no MLB history use pure scouting. TFR peak projections always use pure scouting.

**Rating ranges:** Internal calculations use 0-100 (prevents artificial capping at extremes); UI displays 20-80.

### Pipeline Modes

Two pipelines that answer different questions (see `docs/pipeline-map.html`):

- **Canonical Current**: "What is this player worth right now?" Uses authoritative TR from `TrueRatingsService`, resolves TFR/prospect data, runs modal-equivalent projection math via `ModalDataService`. Every current-truth view shows the same numbers as the profile modal. `ProjectionService.calculateProjectedIp()` is used as a shared utility for IP estimation (not full projections).
- **Forecasting Model**: "What does the model predict for next season?" (`ProjectionService` / `BatterProjectionService`). Computes its own TR from arbitrary-year stats, uses ensemble projection math (40% optimistic, 30% neutral, 30% pessimistic), supports backtesting and year selection.

These are intentionally separate — numbers may differ between them and that's correct.

| View | Pipeline | Notes |
|-|-|-|
| Profile modals | Canonical Current | Always re-resolve canonical values |
| Trade Analyzer | Canonical Current | TR/TFR maps + on-demand projection from canonical data |
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
| `CanonicalCurrentProjectionService` | Builds cached modal-equivalent MLB projection snapshots for current-year canonical pipeline consumers |
| `SupabaseDataService` | Primary data layer — PostgREST queries with auto-pagination, column whitelists, pre-computed rating reads |
| `SyncOrchestrator` | Data-ready check: `checkDataReady()` verifies `game_date` is set in Supabase. No hero detection or write tracking |
| `ContractService` | Contract parsing, salary schedules, years remaining, team control |
| `TeamRatingsService` | Farm rankings, org depth, Farm Score, Power Rankings, team WAR projections |
| `StandingsService` | Historical standings data (lazy-loaded CSVs, 2005-2020) |
| `ProjectionService` | Future performance projections, IP projection pipeline |
| `EnsembleProjectionService` | Three-model ensemble blending |
| `AgingService` | Age-based rating adjustments |
| `DevelopmentSnapshotService` | Historical scouting snapshot storage |
| `MinorLeagueStatsService` | Minor league stats from Supabase/API/CSV |
| `IndexedDBService` | Local-only storage (v12): team planning overrides, dev snapshots, salary overrides |
| `DateService` | Game date from `/api/date/` (60-min localStorage cache + in-memory); season progress calculation for stat weighting |

## Views

| View | Purpose |
|------|---------|
| `TrueRatingsView` | Pitcher/batter dashboard with TR/projections; level-based filtering (MLB / Minor Leaguers / Future Draftees / Free Agents) via scouting `Lev`/`HSC` columns |
| `FarmRankingsView` | Top 100 prospects, org rankings with Farm Score |
| `ProjectionsView` | Future performance projections with 3-model ensemble |
| `TeamRatingsView` | Power Rankings / Projections / Standings toggle |
| `TeamPlanningView` | 6-year roster planning grid with prospects, contracts, trade market |
| `TradeAnalyzerView` | Multi-asset trade evaluation (MLB + prospects + draft picks) |
| `DataManagementView` | File uploads with header validation; analytics dashboard (localhost only, double-click logo to open). |
| `AboutView` | App overview with flow diagrams for TR, TFR, and projections. Default landing page. Accessible by single-clicking the logo. Not in the nav bar. |
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
- Data deferred until Trade Market tab is first viewed: bulk contracts + league-wide age lookup (`PlayerService.getPlayerAges`) load on demand, not during grid build
- Analyzes all teams' rosters/farms using cached power rankings
- Year selector shifts analysis to future years
- Sections: Your Situation (needs + trade chips) | Trade Targets by Position
- Blocked prospects: TFR≥3.0 blocked by incumbent TR≥3.5 with 3+ years remaining
- Scoring: `rating×10` + trade-match bonus + level bonus (AAA+5, AA+3) + age-proximity bonus (age≥24 at target year +8, 23 +5, 22 +2)
- **Prospect age gate**: prospects must be ≥22 at the target year to appear as trade targets — younger prospects can't realistically fill a near-term need
- **Clickable trade target rows**: clicking a row navigates to Trade Analyzer with Team 1 = my team, Team 2 = target's org, target player pre-added to Team 2; trade-match player (if any) pre-added to Team 1. Dispatches `wbl:open-trade-analyzer` event handled by `main.ts` → `TradeAnalyzerView.initWithTrade()`
- **Trade-match badge** (renamed from "2-Way"): only shown on surplus players (tier 1-2), never on general roster targets
- **Trade flags** (per-player, localStorage): "Tradeable" forces a player into trade chips; "Not Tradeable" removes them. Set via cell edit modal.
- **Need overrides** (per-position, localStorage): "Mark as Position of Need" forces a position into the needs list regardless of auto-detection. Set via cell edit modal footer.
- Trade flags and need overrides are team-scoped (`wbl-tp-tradeFlags-{teamId}`, `wbl-tp-needOverrides-{teamId}`)

**Cell Editing:** Overrides persisted in IndexedDB (`TeamPlanningOverrideRecord`). Dev curve overrides ("Set as fully developed"): skip growth phase, project at TFR with only aging decline — applied from the clicked cell's year forward only, not retroactively to prior grid years. Stored in `player_dev_overrides` IndexedDB store with `effectiveFromYear`. Salary overrides: any cell salary can be overridden via the edit modal; stored in `salary_overrides` IndexedDB store (v12) keyed by `teamId_position_year`. Estimated salaries (arb/prospect) shown with `~` prefix; salary overrides shown with `✎` marker; active dev overrides shown with `◆` superscript on the rating badge.
- **Canonical rating resolution:** Org picker and manual insert both use a shared best-known rating resolver (grid value, canonical TR, prospect current/TFR maps) to avoid stale `0.5` fallbacks.
- **Single-slot invariant:** Manual player insert clears that player from any other slot in the same team/year before saving, preventing duplicate placements (e.g. `MR1` + `MR5` in one season).
- **Org picker on-grid indicator:** Players already placed on the grid for the selected year are marked with ◆ (amber) in the "Choose from your org" list.

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
- Players loaded per-team via `getPlayersByOrgId` (not bulk `getAllPlayers`); projections computed on-demand from canonical TR/TFR via `buildPitcherFallbackFromCanonical` / `buildBatterFallbackFromCanonical`
- Prospect/farm context comes from unified TFR pools (`getUnifiedPitcherTfrData` / `getUnifiedHitterTfrData`)
- Power rankings + contracts lazy-loaded on first trade analysis (not on view init or team selection)
- WAR split into Current (MLB) and Future (prospects + picks)
- Trade archetypes: Roster swap (>70% current both sides), Win-now vs future (>50% ratio difference), Prospect swap (>70% future both sides)
- Team impact: clones power ranking roster, applies trade, recalculates with 40/40/15/5 weights
- Farm Impact tab: prospects lost/gained with tier summary
- AI analysis via `AITradeAnalysisService` (gpt-4o-mini, cached in IndexedDB)
- **`initWithTrade(myTeamId, targetTeamId, targetPlayerId, targetIsProspect, scrollY?, matchPlayerId?, matchPlayerIsProspect?)`**: public method for pre-populating from Trade Market. Awaits `this.initPromise` (async init) before touching the DOM — critical because `populateTeamDropdowns()` runs at the end of `initialize()`, not synchronously in the constructor. Adds a "← Back to Trade Market" button that restores saved scroll position.

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
| `wbl-proj-position` | Projections |
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

Historical blend (MLB players with qualifying seasons):
  Per-PA SB/CS rates weighted [5, 4, 3] (most-recent-first, up to 3 years, pa ≥ 50)
  historyWeight = min(0.35, 0.12 + yearsWithData × 0.08)
    → 1yr: 20%, 2yr: 28%, 3yr: 33%, 4+: 35%
  blendedRate = (1 - historyWeight) × scoutingRate + historyWeight × historicalRate
  Prospects (no MLB history) use pure scouting.
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
| Pitcher ceiling boost | 0.27 | `TrueFutureRatingService.ts` |
| Full confidence IP | 150 | Pitchers |
| Pitcher MLB distribution | 2015-2020, ages 25-32, 50+ IP | TFR |
| Batter MLB distribution | 2015-2020, ages 25-32, 300+ PA | TFR |

## Database Schema

See [Data Architecture](#data-architecture) above for the full Supabase table layout and IndexedDB local-only stores.

## Tools

### Data Pipeline

| Tool | Purpose | Usage |
|-|-|-|
| `tools/sync-db.ts` | **Primary data pipeline.** Fetches all data from StatsPlus API, writes to Supabase, computes and stores TR/TFR ratings. See [Sync Pipeline](#sync-pipeline) below. | `npx tsx tools/sync-db.ts [--year=N] [--skip-compute]` |
| `tools/migrate-to-supabase.ts` | One-time migration: historical DOBs, stats, scouting to Supabase | `npx tsx tools/migrate-to-supabase.ts` |
| `tools/check-db.ts` | Diagnostic: verify Supabase data integrity (player counts, join checks) | `npx tsx tools/check-db.ts` |
| `tools/lib/supabase-client.ts` | Shared PostgREST helpers (query, upsert, rpc, CSV parsing) used by all CLI tools | — |

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

### Sync Pipeline

`tools/sync-db.ts` is the backbone of the data layer. Every browser client is a **pure reader** — all writes go through this CLI tool.

**Data flow:** StatsPlus API → `sync-db.ts` → Supabase → browser clients (read-only)

**Steps (in order):**
1. **Detect game date** — fetches `/api/date/` from StatsPlus, parses year (or uses `--year=N`)
2. **Clear stale data** — calls `clear_for_sync()` RPC (deletes contracts + player_ratings; players/teams/stats are upserted)
3. **Sync data** — fetches players, teams, contracts, pitching stats (MLB + minors), batting stats (MLB + minors). Upserts everything to Supabase.
4. **Compute TR** — pitcher TR + hitter TR. Writes to `player_ratings` table as JSONB.
5. **Compute TFR** — pitcher TFR + hitter TFR. Writes to `player_ratings`. Also stores full TFR prospect arrays in `precomputed_cache` (`pitcher_tfr_prospects`, `hitter_tfr_prospects`) for single-request loading.
5.5. **Compute projections** — pitcher + batter projections using the same pipeline as the browser (TR → aging → ensemble/rates → IP/PA → WAR). Stores full `ProjectionContext` and `BatterProjectionContext` in `precomputed_cache`. Browser fast-paths in `ProjectionService` and `BatterProjectionService` return these directly (skipped when `hasCustomScouting` is true).
6. **Compute league context + lookups** — league-wide averages, compact scouting/contract/DOB lookups → `precomputed_cache`. These replace bulk table scans in the browser.
7. **Finalize** — calls `complete_sync(game_date)` RPC, which sets `game_date` on `data_version` (the "data is ready" signal) and bumps table versions so browser clients invalidate caches

**Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (service_role, full write access, no RLS)

**CLI args:**
- `--year=N` — override auto-detected year
- `--skip-compute` — sync data only, skip TR/TFR computation (steps 4-5)

**Self-healing:** If the tool crashes mid-run, `complete_sync` never fires → `game_date` stays stale → next run retries the full sync.

**Runtime:** ~15 seconds typical.

**Concurrency safety:** `claim_sync(date)` RPC uses odd/even version locking with a 2-minute timeout. `complete_sync` bumps version back to even. Multiple concurrent runs won't corrupt data (all writes are upserts), but only the last `complete_sync` sets the final date.

### Automated Sync (GitHub Actions)

`.github/workflows/sync-db.yml` automates the sync pipeline. Game date changes happen between **8am–noon Eastern**.

**Schedule:** Every 10 minutes, 12:00–17:50 UTC (7am–1pm ET with DST buffer on both sides).

**How it works:**
1. **Date check** (no checkout, ~2 seconds) — curls the StatsPlus date API and Supabase REST API, compares dates. If they match → job exits, consuming almost zero GHA minutes.
2. **Sync** (only when date changed) — checks out repo, `npm ci`, runs `npx tsx tools/sync-db.ts`.
3. **Manual trigger** — `workflow_dispatch` in GitHub UI always forces a sync regardless of date check.

**Concurrency group:** `sync-db` — prevents overlapping runs but queues the next one.

**GitHub Secrets required:**
- `SUPABASE_URL` — PostgREST base URL
- `SUPABASE_SERVICE_KEY` — service_role key (write access)
- `SUPABASE_ANON_KEY` — used for the lightweight date check query

**Failure handling:** GitHub sends email on workflow failure by default. If sync-db.ts fails, `game_date` stays stale and the next cron run retries automatically.

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
| `ProjectionService.test.ts` | 10 | IP projection pipeline, precomputed fast-path |
| `BatterProjectionService.test.ts` | 3 | Precomputed fast-path (Supabase configured, custom scouting bypass, null cache fallthrough) |
| `ProspectDevelopmentCurveService.test.ts` | 19 | Hitter/pitcher development curves: age-based TR scaling, rawStats adjustment, MLB stats boost, clamping, gap/speed avg devFraction, diagnostics |
| `PlayerService.test.ts` | 12 | Cache-path queries: name/info lookup, org filtering, search (case-insensitive, reverse name), hasCachedPlayers |
| `ContractService.test.ts` | 13 | Utility methods (yearsRemaining, FA year, salary access, last year check), team/player filtering, cache state |
| `SupabaseDataService.test.ts` | 53 | Column whitelist invariants: PITCHING_COLS excludes 14 bad CSV columns, BATTING_COLS excludes computed avg/obp, filterColumns strips extras |
| `TeamPlanningView.test.ts` | 3 | Rating resolution and grid manipulation |

## Architecture Notes

### Data Layer
- **Browser = pure reader**: All services try Supabase first when configured (`supabaseDataService.isConfigured`), fall back to CSV/API. No browser writes to Supabase.
- **Pre-computed TR/TFR**: `player_ratings` table stores JSONB per player+type. CLI writes, browser reads. Eliminates expensive computation on page load. Rating types: `pitcher_tr`, `hitter_tr`, `pitcher_tfr`, `hitter_tfr`
- **Pre-computed projections**: Pitcher and batter projections are computed by the CLI and stored in `precomputed_cache` (`pitcher_projections`, `batter_projections`). `ProjectionService` and `BatterProjectionService` return these directly when Supabase is configured and no custom scouting is active — eliminating 10+ Supabase requests and expensive computation per page load. Falls through to live computation when `hasCustomScouting` is true.
- **Deep link fast path**: `TrueRatingsView.openPlayerDeepLinkFast(playerId)` fetches single-player ratings from `player_ratings` → builds modal data directly → instant open
- **Lazy loading**: Scouting data and standings CSVs deferred to tab activation. Minor league stats skipped when pre-computed data available. Hitter scouting skipped in pitcher mode.
- **In-flight dedup**: `ScoutingDataService` and `HitterScoutingDataService` deduplicate concurrent Supabase queries via `supabaseOsaLoading` promise pattern
- **Pagination**: PostgREST caps at 1000 rows per request. Both `SupabaseDataService` (browser) and `supabase-client.ts` (CLI) auto-paginate in 1000-row batches.
- **Precomputed lookups**: The CLI pre-builds compact lookup tables (scouting, contracts, DOBs) and stores them as single JSONB entries in `precomputed_cache`. The browser reads these in one request instead of paginating through full tables (e.g. 12 pages of players → 1 DOB lookup). `SupabaseDataService.getPrecomputed()` caches results in-memory (`_precomputedCache` Map) to prevent redundant fetches within a session.

### Pipelines
- **Pipeline map (view -> data path):** `docs/pipeline-map.html` (Canonical Current vs Forecasting Model). Audited 2026-02-20: all views verified against documented pipeline assignments
- **Shared IP utility exception**: `ProjectionService.calculateProjectedIp()` is used by canonical consumers (`PitcherProfileModal`, `CanonicalCurrentProjectionService`) for innings-pitched estimation only — not full projections. This is a stateless utility call; no ensemble math or forecasting output crosses the pipeline boundary

### Single Sources of Truth
- **TFR**: use unified pools `TeamRatingsService.getUnifiedHitterTfrData()` / `getUnifiedPitcherTfrData()` for mixed MLB+prospect contexts; `getHitterFarmData()` / `getFarmData()` are farm-only wrappers. Never call `calculateTrueFutureRatings()` independently. Use `prospect.trueFutureRating` (precomputed) — NEVER re-derive from `prospect.percentile`
- **TR**: `TrueRatingsService.getHitterTrueRatings(year)` / `getPitcherTrueRatings(year)` — every view MUST use these cached methods instead of calling `trueRatingsCalculationService.calculateTrueRatings()` directly
- **Percentile→rating**: `PERCENTILE_TO_RATING` in `TrueFutureRatingService.ts` / `HitterTrueFutureRatingService.ts` — NEVER create local copies of this mapping (thresholds: 99→5.0, 97→4.5, 93→4.0, 75→3.5, 60→3.0, 35→2.5, 20→2.0, 10→1.5, 5→1.0, 0→0.5)

### UI / Modal Patterns
- **Modal canonical override**: Both profile modals override caller-provided TR/TFR data with canonical values, guaranteeing consistency regardless of which view opens them
- **Trade Analyzer lazy loading**: Players loaded per-team via `getPlayersByOrgId`; projections computed on-demand from canonical TR/TFR (no `CanonicalCurrentProjectionService`). Power rankings and contracts deferred to first trade analysis. Team dropdowns filter to orgs with minor league affiliates (excludes All-Star teams)
- **Data-source clarity**: use `renderDataSourceBadges()` from `src/utils/dataSourceBadges.ts` when a view mixes season/scouting modes (Current YTD vs Forecasting Model, My/OSA/Fallback)
- **Rating display rule**: Any view showing a player rating MUST use canonical TR/TFR values, not projection-derived or locally-computed alternatives. `ProjectionService` overlays canonical TR onto `currentTrueRating` after building projections (its internal TR is only used for aging/ensemble inputs)
- **Modal projectionOverride trap**: `projectedRatings` MUST use `trueRatings` values (not scouting), or True Rating bars show scouting values instead of TFR-derived

### Data Gotchas
- **PostgREST string columns**: The `players` table stores `level`, `role`, and `age` as TEXT in PostgreSQL. PostgREST returns them as strings (`"4"`, `"11"`, `"20"`), not numbers. Any code comparing these with `switch(level)` or `=== 11` must parse first: `parseInt(player.level, 10)`. The browser's `PlayerService` already handles this (`typeof r.level === 'string' ? parseInt(...)`); CLI code in `sync-db.ts` must do the same.
- **OOTP role values**: `players.role` stores OOTP numeric codes as strings: `"11"` = SP, `"12"` = RP, `"13"` = CL, `"0"` = position player/unknown. These are NOT `PitcherRole` values (`'SP'`/`'SW'`/`'RP'`). Must map before passing to `calculateTrueRatings()` or percentile tiers won't match.
- **IC player detection**: IC (International Complex) players are identified by `contracts.league_id = -200`, NOT by `players.level`. IC players have `level: "0"` or `"1"` in the players table. IC players have no DOB (`null`); use `players.age` column as fallback for age calculation.
- **Injury values** in CSV `Prone` column: `Iron Man, Durable, Normal, Fragile, Wrecked` (NOT `Wary`/`Prone` as ScoutingData.ts comments incorrectly say)
- **Player level classification**: `src/utils/playerLevel.ts` — `classifyPlayer(lev, hsc)` returns `'mlb' | 'minors' | 'draftee' | 'freeAgent'` from scouting CSV fields. Contract freshness updates stale levels when game date > scouting date via `buildFreshnessUpdatedLevels()`. Falls back to `isProspect` when `Lev` column is absent
- **Level labels**: `1`=MLB, `2`=AAA, `3`=AA, `4`=A, `6`=R (Rookie), `7`=R (fallback). There is no level `5` (Short-A) or `8` (IC) in this league — IC is detected via contracts, not level.
- **ISO trap**: Never use deprecated `expectedIso(power)` — ignores Gap/Speed. Use pre-computed `tfrSlg` or component rates
- **Forward/inverse intercept alignment**: Pitcher rating↔rate intercepts MUST match in both directions or round-trip bias is amplified by FIP weights
- **PostgREST pagination determinism**: Paginated queries (`OFFSET`/`LIMIT`) require an explicit `order` clause for deterministic results. Without it, rows can be duplicated or skipped across pages. Always add `&order=player_id` (or appropriate PK) to paginated queries.
