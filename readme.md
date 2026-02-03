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
Blends scouting grades with actual performance stats to produce a 0.5-5.0 star rating.

```typescript
trueRating = (scoutingProjection × 0.5) + (statsBasedRating × 0.5)
confidence = min(IP / 150, 1.0)
finalRating = (trueRating × confidence) + (scoutingProjection × (1 - confidence))
```

### True Future Rating (TFR)

A **pure peak/ceiling projection system** that projects what a prospect's age-27 peak season would look like if everything goes right. TFR answers: *"If this prospect develops perfectly, what would that season look like?"*

**Algorithm Flow:**

1. **Calculate Level-Weighted IP** for scouting weight determination
   - AAA: 1.0× (full weight)
   - AA: 0.7× (100 IP = 70 "AAA-equivalent")
   - A: 0.4× (100 IP = 40 "AAA-equivalent")
   - R: 0.2× (100 IP = 20 "AAA-equivalent")

2. **Determine Scouting Weight** based on weighted IP
   - < 75 weighted IP → 100% scout
   - 76-150 weighted IP → 80% scout
   - 151-250 weighted IP → 70% scout
   - 250+ weighted IP → 60% scout

3. **Blend Scouting + Stats** separately per component
   - Stuff → K9
   - Control → BB9
   - HRA → HR9

4. **Rank all prospects** by each component → percentiles

5. **Map component percentiles** to MLB peak-age distributions (2015-2020, ages 25-29)

6. **Calculate FIP** from mapped rates with clamping:
   - K9: 3.0 to 11.0
   - BB9: 0.85 to 7.0
   - HR9: 0.20 to 2.5

7. **Rank by FIP** for final TFR rating (0.5-5.0 scale)

**TFR Rating Scale:**

| TFR | Percentile | Description |
|-----|------------|-------------|
| 5.0 | 99-100% | Elite (top ~10 prospects) |
| 4.5 | 97-99% | Plus-Plus |
| 4.0 | 93-97% | Plus |
| 3.5 | 75-93% | Above Average |
| 3.0 | 60-75% | Average |
| 2.5 | 35-60% | Fringe |
| 2.0 | 20-35% | Below Average |
| 1.5 | 10-20% | Poor |
| 1.0 | 5-10% | Replacement |
| 0.5 | 0-5% | Organizational |

**Peak Workload Projections:**

IP projections are based on stamina and injury rating, not minor league IP:

*Starters (Stamina ≥ 30, 3+ pitches):*
```
baseIp = 30 + (stamina × 3.0)
// Stamina 50 → 180 IP, 60 → 210 IP, 70 → 240 IP
```

*Relievers:*
```
baseIp = 50 + (stamina × 0.5)
// Stamina 30 → 65 IP, 50 → 75 IP
```

*Injury Modifiers:* Ironman (1.15×), Durable (1.10×), Normal (1.0×), Fragile (0.90×), Wrecked (0.75×)

### Batter True Future Rating (TFR)

Projects peak wOBA for hitter prospects using a 4-component model. Like pitcher TFR, this represents ceiling/peak potential ("if everything goes right").

**The 4 Components:**

| Component | Rating | Stat | Coefficient |
|-----------|--------|------|-------------|
| Eye | Eye (20-80) | BB% | -0.4196 + 0.114789 × eye |
| AvoidK | AvoidK (20-80) | K% | 26.1423 - 0.200303 × avoidK |
| Power | Power (20-80) | HR% | -0.9862 + 0.058434 × power |
| Contact | Contact (20-80) | AVG | 0.074367 + 0.00316593 × contact |

**Critical Design Decision: Contact vs Hit Tool**

The system uses **Contact rating** instead of Hit Tool for AVG projection:
- Contact correlates with AVG at r=0.97 (from OOTP engine testing)
- Hit Tool alone correlates at only r=0.82
- Contact ≈ 60% Hit Tool + 40% AvoidK (OOTP composite)
- Scouting CSVs should map the `CON P` column, not `HT P`

**Component-Specific Scouting Weights:**

Different components have different predictive validity from MiLB stats:

| Component | MiLB→MLB Correlation | Scouting Weight | Rationale |
|-----------|---------------------|-----------------|-----------|
| Eye (BB%) | r = 0.05 | 100% always | MiLB walk rate is noise |
| Contact (AVG) | r = 0.18 | 100% always | MiLB batting avg is noise |
| AvoidK (K%) | r = 0.68 | 40-65% by PA | MiLB K% is predictive |
| Power (HR%) | r = 0.44 | 75-85% by PA | MiLB HR% moderately predictive |

**Algorithm Flow:**

1. **Calculate Level-Weighted PA** (same weights as pitcher: AAA=1.0, AA=0.7, A=0.4, R=0.2)

2. **Blend Scouting + Stats** per component using component-specific weights
   - Eye and Contact: Always 100% scouting (MiLB stats are noise)
   - AvoidK: 40-65% scouting based on PA
   - Power: 75-85% scouting based on PA

3. **Rank all prospects** by each component → percentiles

4. **Map percentiles** to MLB distributions (2015-2021 modern era, 300+ PA)

5. **Calculate wOBA** from mapped rates:
   ```
   wOBA = 0.69×BB_rate + 0.89×1B_rate + 1.27×2B_rate + 1.62×3B_rate + 2.10×HR_rate
   ```

6. **Rank by wOBA** for final TFR rating (0.5-5.0 scale)

**Validation Results (2017 scouting → 2018-2021 MLB):**

| TFR | Arrival Rate | Avg WAR/yr | Actual Peak wOBA |
|-----|--------------|------------|------------------|
| 5.0 | 43% | 2.7 | .377 |
| 4.5 | 25% | 2.2 | .370 |
| 4.0 | 31% | 1.9 | .365 |
| 3.5 | 21% | 1.2 | .333 |
| 2.5 | 8% | 0.5 | .305 |
| <2.0 | 2-5% | ~0 | .280-.290 |

**Key Batter TFR Files:**

| File | Purpose |
|------|---------|
| `HitterTrueFutureRatingService.ts` | Main TFR calculation, component blending, scouting weights |
| `HitterRatingEstimatorService.ts` | Rating→stat coefficients, inverse estimation |
| `HitterScoutingDataService.ts` | CSV parsing, column mapping (uses CON P not HT P) |
| `HitterTrueRatingsCalculationService.ts` | Current True Rating for MLB batters |
| `BatterProjectionService.ts` | Projections view integration |

**Calibration Tools:**

| Tool | Purpose |
|------|---------|
| `tools/test_hitter_tfr.ts` | Validation test against historical outcomes |
| `tools/calibrate_hitter_coefficients.ts` | Calibrate rating→stat from WBL MLB data |
| `tools/calibrate_level_adjustments.ts` | Analyze MiLB→MLB predictive validity |
| `tools/analyze_hitter_data.ts` | Analyze OOTP engine test data |

### Farm System Rankings

Organizations are ranked by **Farm Score**, a tier-based system that weights prospect quality:

**Farm Score Formula:**
```
Farm Score = (Elite × 10) + (Good × 5) + (Avg × 1) + Depth Bonus
```

**Prospect Tiers:**
| Tier | TFR Range | Points |
|------|-----------|--------|
| Elite | ≥ 4.5 | 10 pts each |
| Good | 3.5-4.4 | 5 pts each |
| Average | 2.5-3.4 | 1 pt each |
| Depth | < 2.5 | Scaled (see below) |

**Depth Bonus Scale:**
- < 10 depth prospects: 0 pts
- 10-14 depth prospects: 2 pts
- 15-24 depth prospects: 4 pts
- 25+ depth prospects: 5 pts

Hover over any Farm Score to see the breakdown formula for that organization.

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
- `scouting_[source]_YYYY_MM_DD.csv` (underscores also work)
- `[source]_YYYY-MM-DD.csv`
- Any file containing `YYYY-MM-DD` or `YYYY_MM_DD` pattern

Upload multiple files at once via Data Management → Scouting Reports. Dates are auto-detected from filenames.

### Projections
Three-model ensemble for future performance:
- **Optimistic** (40%): Standard aging curves
- **Neutral** (30%): Status quo
- **Pessimistic** (30%): Trend-based decline

## Key Services

### Pitcher Services

| Service | Purpose |
|---------|---------|
| `TrueRatingsService` | MLB stats fetching, pitcher True Rating calculation |
| `TrueRatingsCalculationService` | Core pitcher TR algorithm with multi-year weighting |
| `TrueFutureRatingService` | Pitcher prospect TFR (FIP-based peak projections) |
| `ScoutingDataService` | Pitcher scouting CSV parsing and storage |

### Batter Services

| Service | Purpose |
|---------|---------|
| `HitterTrueRatingsCalculationService` | Batter True Rating calculation |
| `HitterTrueFutureRatingService` | Batter prospect TFR (wOBA-based peak projections) |
| `HitterRatingEstimatorService` | Rating↔stat conversion coefficients |
| `HitterScoutingDataService` | Batter scouting CSV parsing (maps CON P, not HT P) |
| `BatterProjectionService` | Batter projections integration |

### Shared Services

| Service | Purpose |
|---------|---------|
| `TeamRatingsService` | Farm rankings, organizational depth analysis, Farm Score |
| `ProjectionService` | Future performance projections |
| `DevelopmentSnapshotService` | Historical scouting snapshot storage |
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

**Level-Weighted IP (for TFR scouting weight):**
```
weightedIp = (AAA_IP × 1.0) + (AA_IP × 0.7) + (A_IP × 0.4) + (R_IP × 0.2)
```

**TFR Rate Clamping (based on MLB peak-age extremes):**
- K9: 3.0 to 11.0 (allows elite strikeout ceiling)
- BB9: 0.85 to 7.0 (best observed: 0.89)
- HR9: 0.20 to 2.5 (best observed: 0.2 in 123 IP)

## Views

- **TrueRatingsView**: MLB pitcher dashboard with TR/projections
- **FarmRankingsView**: Top 100 prospects, org rankings with Farm Score, sortable/draggable columns
- **TradeAnalyzerView**: Side-by-side player comparisons
- **DataManagementView**: File uploads, data refresh
- **PlayerProfileModal**: Deep-dive with Ratings + Development tabs

## Data Sources

**StatsPlus API:**
- Base: `/api/playerpitchstatsv2/`
- Params: `year`, `lid` (200=MLB, 201-204=minors), `split=1`

**CSV Uploads:**

*Pitcher Scouting:* `player_id, name, stuff, control, hra [, age, ovr, pot, pitches...]`

*Batter Scouting Columns (from OOTP export):*
| Column | Maps To | Notes |
|--------|---------|-------|
| `POW P` | power | Power rating |
| `EYE P` | eye | Eye/plate discipline |
| `K P` | avoidK | Avoid strikeout |
| `CON P` | contact | **Use this, NOT HT P** |
| `GAP P` | gap | Gap power (not used in TFR) |
| `SPE` | speed | Speed (not used in TFR) |
| `HT P` | — | **Not mapped** - Contact is better for AVG |

*Stats:* `ID, Name, IP, HR, BB, K, HR/9, BB/9, K/9`

## Configuration

**General:**
- League start year: 2000
- Peak age: 27
- Replacement FIP: 5.00

**True Ratings:**
- Full confidence IP threshold: 150

**TFR Scouting Weights:**
- < 75 weighted IP: 100% scout
- 76-150 weighted IP: 80% scout
- 151-250 weighted IP: 70% scout
- 250+ weighted IP: 60% scout

**Peak Workload Projections:**
- SP base: 30 + (stamina × 3.0), clamped 120-260 IP
- RP base: 50 + (stamina × 0.5), clamped 40-80 IP

**Pitcher MLB Distribution Data:**
- Source years: 2015-2020
- Peak ages: 25-29
- Minimum IP: 50

**Batter TFR Scouting Weights (by weighted PA):**
- Eye: 100% always (MiLB BB% is noise, r=0.05)
- Contact: 100% always (MiLB AVG is noise, r=0.18)
- AvoidK: 100%/65%/50%/40% at <150/300/500/500+ PA
- Power: 100%/85%/80%/75% at <150/300/500/500+ PA

**Batter Rating→Stat Coefficients (Modern Era 2015-2021):**
```typescript
eye:     { intercept: -0.4196, slope: 0.114789 }   // BB%
avoidK:  { intercept: 26.1423, slope: -0.200303 }  // K%
power:   { intercept: -0.9862, slope: 0.058434 }   // HR%
contact: { intercept: 0.074367, slope: 0.00316593 } // AVG
```

**Batter MLB Distribution Data:**
- Source years: 2015-2021 (modern era)
- Minimum PA: 300
