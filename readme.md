# WBL Analysis System

OOTP analysis app for the WBL (World Baseball League). True Ratings, projections, farm rankings, trade analysis, and Monte Carlo season simulation.

## Quick Start

```bash
npm install
npm run dev    # Development server (port 5173)
npm run build  # Production build
```

**Env vars** (`.env.local`): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`

Without Supabase env vars, the app falls back to WBL API + CSV files with IndexedDB caching.

## Tech Stack

- TypeScript + Vite (vanilla, no framework)
- Supabase (PostgreSQL via PostgREST)
- IndexedDB v12 for local-only data (team planning overrides, dev snapshots)
- ApexCharts for charts
- Vanilla CSS (dark theme)

## Data Architecture

**CLI-first pipeline**: CLI writes all data to Supabase, browser is a **pure reader**.

```
WBL API ──┐
Firebase  ──┼──→ CLI (tools/sync-db.ts) ──→ Supabase ──→ Browser (read-only)
CSV (fallback)─┘
```

**Core rule**: `precomputed_cache` is the canonical source of truth for all projection components (WAR, wOBA, PA, avg, obp, slg, defRuns, posAdj, bbPct, kPct, hrPct). Browser reads and displays — never recomputes current-year data except during custom scouting upload.

**Two computation points**: (1) sync-db computes everything and writes to Supabase. (2) Custom scouting upload recomputes TR/TFR in-browser with new scouting grades (reuses cached stats and distributions). Every other code path is display-only.

### CLI Sync Tool

```bash
npx tsx tools/sync-db.ts                 # Auto-detect year/date from API
npx tsx tools/sync-db.ts --year=2021     # Explicit year
npx tsx tools/sync-db.ts --skip-compute  # Data only, skip TR/TFR
npx tsx tools/sync-db.ts --force         # Re-sync even if up to date
```

**Steps**: Detect date → Auto-freeze opening day snapshot (if first in-season sync) → Clear stale → Fetch all data + DOB gap-fill → Build SyncContext (2-wave parallel queries) → Compute TR → Compute TFR → Compute projections (injury/park/defense adjusted) → Build lookups → Set game_date

**Skip detection**: Compares DB `game_date` against WBL API date; exits early if matched. `--force` overrides.

**Automated**: GitHub Actions (`.github/workflows/sync-db.yml`) runs every 10min during 12:00–17:50 UTC. Date-check-first design uses ~2s of GHA time when no update needed.

### Supabase Tables

| Table | Purpose |
|-|-|
| `players` | Player data. Level: 1=MLB, 2=AAA, 3=AA, 4=A, 5=R, 6=IC |
| `teams` | Team names, parent relationships |
| `pitching_stats` / `batting_stats` | Stats by year/league/split |
| `pitcher_scouting` / `hitter_scouting` | Scouting ratings by source (my/osa) |
| `contracts` | Salary schedules (JSONB) |
| `player_ratings` | Pre-computed TR/TFR as JSONB |
| `precomputed_cache` | Key-value JSONB: projections, lookups, distributions |
| `data_version` | `game_date` = "data ready" signal |

Key `precomputed_cache` entries: `batter_projections`, `pitcher_projections`, `hitter_tfr_prospects`, `pitcher_tfr_prospects`, `*_scouting_lookup`, `contract_lookup`, `dob_lookup`, `defensive_lookup`, `league_context`, `snapshots__index`, `*__snapshot__*` (frozen projection snapshots).

Batter projections include full component breakdown: WAR, wOBA, PA, avg, obp, slg, defRuns, posAdj, bbPct, kPct, hrPct. The modal reads ALL components from the cache — it does not recompute them.

### IndexedDB (Local-Only, v12)

Team planning overrides, salary overrides, player dev overrides, uploaded scouting snapshots, development history. Bypassed for reads when Supabase is configured.

## Project Structure

```
src/
├── components/       # Reusable UI (DevelopmentChart)
├── models/           # TypeScript interfaces
├── services/         # Business logic
│   └── simulation/   # Monte Carlo season sim engine
├── views/            # View components
├── controllers/      # Data orchestration
└── utils/            # Helpers
tools/
├── sync-db.ts        # Primary data pipeline (CLI)
├── explain-player.ts # TR/projection trace debugger
├── lib/              # Shared CLI helpers (supabase-client.ts)
├── research/         # One-off analysis scripts
└── *.ts              # Calibration & validation tools
```

## Core Concepts

### True Ratings (TR)
Blends scouting grades with MLB stats → 0.5–5.0 star rating. Percentile-based components (Contact, Power, Eye, AvoidK). Multi-year weighted stats (4-year rolling window). Tier-aware regression. Per-component credibility discount when scouting contradicts stats.

### True Future Rating (TFR)
Pure peak/ceiling projection — projects age-27 peak from 100% scouting potential ratings. Pitchers: FIP-based. Batters: wOBA-based (6 components: Eye, AvoidK, Power, Contact, Gap, Speed).

### TFR/TR Display
- TFR > TR → show both with ceiling bars and Peak badge
- TFR ≤ TR → TFR hidden
- No TR (pure prospect) → development-curve TR + TFR ceiling
- Profile modal has Current/Peak projection toggle

### Projections
**Batter**: TR blended rates → aging delta → wOBA → PA (historical + injury) → defensive value → WAR. Single function: `ModalDataService.computeBatterProjection()`.

**Pitcher**: Three-model ensemble (optimistic 40%, neutral 30%, pessimistic 30%). FIP-based WAR.

Both use shared pure functions between CLI (sync-db) and browser (custom scouting recompute only). The CLI is the canonical computation point — all views read from the cache.

### Opening Day Snapshots
Frozen pre-season projections for comparison against in-season updates. Toggle on Projections and Team Ratings views. Global banner when viewing snapshot data.

- `tools/freeze-projections.ts` — manual snapshot creation (`--label`, `--year`, `--delete`)
- Auto-freeze in sync-db on first in-season sync (if no snapshot exists for the projection year)
- Snapshot keys use `__snapshot__` delimiter in `precomputed_cache` (e.g., `batter_projections__snapshot__opening_day_2022`)
- `SupabaseDataService.setSnapshotMode()` transparently redirects all `getPrecomputed()` reads to snapshot keys

### Draft Eligibility
`draft_eligible.csv` in `public/data/` is the source of truth. sync-db reads it each run. Players in the CSV with no team = draft-eligible. Players in the CSV who are on a team = drafted/signed (API wins). Players not in the CSV = never draft-eligible, regardless of API status.

### DOB Gap-Fill
sync-db checks if any scouted players are missing DOB. If gaps exist, reads `public/data/player_id_dob_*.csv` (manual OOTP export) to fill them. `tools/check-dobs.ts` for standalone gap checking and fixing.

## Key Services

| Service | Purpose |
|-|-|
| `TrueRatingsService` | Pitcher TR calculation, MLB stats |
| `HitterTrueRatingsCalculationService` | Batter TR calculation |
| `TrueFutureRatingService` | Pitcher TFR (FIP peak) |
| `HitterTrueFutureRatingService` | Batter TFR (wOBA peak) |
| `ModalDataService` | Shared projection math (`computeBatterProjection`, `resolveCanonicalBatterData`) |
| `TeamRatingsService` | Farm rankings, power rankings, team WAR, trade market analysis |
| `BatterProjectionService` / `ProjectionService` | Read precomputed projections; recompute for custom scouting/historical |
| `DefensiveProjectionService` | Fielding scouting → defensive runs + positional adjustment |
| `ProspectDevelopmentCurveService` | Prospect TR via historical dev curves |
| `SupabaseDataService` | Primary data layer (PostgREST, pagination, precomputed cache reads, snapshot mode) |
| `ConsistencyChecker` | Dev-only: compares displayed values vs cache vs formula. Amber banner on mismatch |
| `DateService` | Game date, season year, projection target year, season progress. Handles API season lag (trusts game date calendar year Apr-Oct) |
| `SimulationService` | Converts team ratings → Monte Carlo sim snapshots |

## Views

| View | Purpose |
|-|-|
| `TrueRatingsView` | TR dashboard with level-based filtering |
| `FarmRankingsView` | Top 100 prospects, org rankings, Farm Score |
| `ProjectionsView` | Projection tables (3-model ensemble) |
| `TeamRatingsView` | Power Rankings / WAR / Win Projections (WAR-based or Monte Carlo) |
| `TeamPlanningView` | 6-year roster planning grid with prospect ETA, contracts, trade market |
| `TradeAnalyzerView` | Multi-asset trade evaluation |
| `PlayerProfileModal` / `BatterProfileModal` | Deep-dive: Ratings, Projections, Development tabs |
| `DraftBoardView` | Draft board |
| `ParksView` | Park factors |
| `AboutView` | Landing page with flow diagrams |

### URL Router

Client-side router (`src/router.ts`) using History API. Key routes: `/true_ratings`, `/projections`, `/farm_rankings`, `/team_ratings`, `/team_planner`, `/trade_analyzer`, `/player/:id`. Player modals push `/player/:id`, restore tab URL on close.

## Deployment (Vercel)

- `api/proxy.js` — serverless function proxying `/api/*` to WBL server (CORS workaround)
- `ApiClient.ts` rewrites API calls in production: `/api/date/?foo=1` → `/api/proxy?path=date/&foo=1`
- Local dev uses Vite's built-in proxy (`vite.config.ts`)
- `vercel.json` — SPA catch-all only

## Key Tools

| Tool | Usage |
|-|-|
| `sync-db.ts` | Primary data pipeline — see above |
| `freeze-projections.ts` | Snapshot projections: `--year=2022`, `--label=opening_day`, `--delete=opening_day_2022` |
| `check-projections.ts` | Sanity check cached projections (flags outlier WAR/FIP/IP, shows top/bottom 5) |
| `check-player.ts` | Quick player lookup across all tables: `npx tsx tools/check-player.ts 17533` |
| `check-dobs.ts` | DOB gap report and fix: `--fix` fills from local CSV export |
| `explain-player.ts` | `npx tsx tools/explain-player.ts --playerId=1234 --type=hitter --mode=all --year=2022 --format=markdown` |
| `validate-ratings.ts` | `npx tsx tools/validate-ratings.ts --year=2020` |
| `check-db.ts` | Verify Supabase data integrity |

## Architecture Docs

- `docs/pipeline-map.html` — interactive diagram of the full data/computation pipeline
