# WBL Pitcher Analysis System

OOTP pitcher analysis application for the WBL (World Baseball League). Synthesizes scouting ratings and historical performance to generate True Ratings, project future performance, track player development, and evaluate organizational depth.

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
Blends scouting grades with actual performance stats to produce a 0.5-5.0 star rating.

```typescript
trueRating = (scoutingProjection × 0.5) + (statsBasedRating × 0.5)
confidence = min(IP / 150, 1.0)
finalRating = (trueRating × confidence) + (scoutingProjection × (1 - confidence))
```

### True Future Rating (TFR)
Projects peak WAR for minor league prospects by:
1. Applying level adjustments (Rookie → A → AA → AAA → MLB equivalent)
2. Projecting to peak age (27)
3. Calculating Peak FIP → WAR

### Player Development Tracker
Tracks scouting ratings over time to visualize player development trends.

**How it works:**
- Snapshots are automatically created when scouting data is uploaded
- Each snapshot stores: Stuff, Control, HRA, OVR stars, POT stars
- View development history in the PlayerProfileModal → Development tab
- ApexCharts visualization shows rating trends over time

**Bulk Historical Upload:**
To populate historical data, name your scouting CSVs with dates:
```
scouting_my_2024-01-15.csv
scouting_my_2024-03-01.csv
scouting_osa_2024-02-10.csv
```

Supported filename patterns:
- `scouting_[source]_YYYY-MM-DD.csv`
- `[source]_YYYY-MM-DD.csv`
- Any file containing `YYYY-MM-DD` pattern

Upload multiple files at once via Data Management → Scouting Reports. Dates are auto-detected from filenames.

### Projections
Three-model ensemble for future performance:
- **Optimistic** (40%): Standard aging curves
- **Neutral** (30%): Status quo
- **Pessimistic** (30%): Trend-based decline

## Key Services

| Service | Purpose |
|---------|---------|
| `TrueRatingsService` | MLB stats fetching, True Rating calculation |
| `TrueRatingsCalculationService` | Core TR algorithm with multi-year weighting |
| `TrueFutureRatingService` | Prospect TFR calculation with level adjustments |
| `ProjectionService` | Future performance projections |
| `DevelopmentSnapshotService` | Historical scouting snapshot storage |
| `ScoutingDataService` | Scouting CSV parsing and storage |
| `MinorLeagueStatsService` | Minor league stats from API/CSV |
| `IndexedDBService` | Persistent browser storage (v7) |

## IndexedDB Schema (v7)

| Store | Purpose |
|-------|---------|
| `scouting_ratings` | Date-stamped scouting snapshots |
| `minor_league_stats` | League-level stats by year/level |
| `player_minor_league_stats` | Player-indexed stats for O(1) lookup |
| `mlb_league_stats` | Full MLB data by year |
| `player_development_snapshots` | Historical TR/TFR/scouting for dev tracking |
| `players`, `teams` | Roster caches |

## Key Formulas

**FIP (Fielding Independent Pitching):**
```
FIP = ((13 × HR/9) + (3 × BB/9) - (2 × K/9)) / 9 + 3.47
```

**WAR:**
```
WAR = ((5.00 - FIP) / 9) × IP / 50
```

**Level Adjustments (applied to minor league rates):**
- AAA: 1.0× (no adjustment)
- AA: ~0.90-1.05× depending on stat
- A: ~0.80-1.10×
- Rookie: ~0.70-1.15×

## Views

- **TrueRatingsView**: MLB pitcher dashboard with TR/projections
- **FarmRankingsView**: Top 100 prospects, org rankings
- **TradeAnalyzerView**: Side-by-side player comparisons
- **DataManagementView**: File uploads, data refresh
- **PlayerProfileModal**: Deep-dive with Ratings + Development tabs

## Data Sources

**StatsPlus API:**
- Base: `/api/playerpitchstatsv2/`
- Params: `year`, `lid` (200=MLB, 201-204=minors), `split=1`

**CSV Uploads:**
- Scouting: `player_id, name, stuff, control, hra [, age, ovr, pot, pitches...]`
- Stats: `ID, Name, IP, HR, BB, K, HR/9, BB/9, K/9`

## Configuration

- League start year: 2000
- Peak age: 27
- Replacement FIP: 5.00
- Full confidence IP threshold: 150
- Starter workload (projections): 180 IP
- Reliever workload (projections): 65 IP
