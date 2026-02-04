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

**Algorithm:**
```typescript
trueRating = (scoutingProjection × 0.5) + (statsBasedRating × 0.5)
confidence = min(IP / 150, 1.0)  // or PA for batters
finalRating = (trueRating × confidence) + (scoutingProjection × (1 - confidence))
```

**For Batters:**
- Uses tier-aware regression that regresses elite hitters toward elite targets (not league average)
- Component-specific stabilization constants (BB%: 120 PA, K%: 60 PA, HR%: 160 PA, AVG: 300 PA)
- **HR%-based power estimation** (not ISO-based) to correctly distinguish gap hitters from power hitters

### True Future Rating (TFR)

A **pure peak/ceiling projection system** that projects what a prospect's age-27 peak season would look like if everything goes right. TFR answers: *"If this prospect develops perfectly, what would that season look like?"*

#### Pitcher TFR

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

#### Batter TFR

Projects peak wOBA for hitter prospects using a 4-component model. Like pitcher TFR, this represents ceiling/peak potential ("if everything goes right").

**The 4 Components:**

| Component | Rating | Stat | Calibrated Coefficient |
|-----------|--------|------|------------------------|
| Eye | Eye (20-80) | BB% | 1.6246 + 0.114789 × eye |
| AvoidK | AvoidK (20-80) | K% | 25.9942 - 0.200303 × avoidK |
| Power | Power (20-80) | HR% | -0.5906 + 0.058434 × power |
| Contact | Contact (20-80) | AVG | 0.035156 + 0.00395741 × contact |

**Peak Performance by Contact Rating:**
- 80 contact → .352 AVG peak (elite top 3)
- 75 contact → .332 AVG peak (excellent top 11)
- 70 contact → .312 AVG peak (good)
- 57 contact → .261 AVG peak (league average)

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

### Recent Projection System Improvements

#### 1. HR%-Based Power Estimation (Fixed Gap Hitter Inflation)

**Problem:** Gap hitters with high doubles/triples rates were getting inflated power ratings because the system estimated power from ISO (which includes all extra bases), not HR rate.

**Solution:** Changed to HR%-based power estimation.

**Impact:**
- Gap hitters (high AVG, many 2B/3B, low HR) now get appropriate moderate power ratings
- True power hitters (high HR%) correctly get high power ratings
- A.E. Douglas example: Power rating 80→62 (correct), HR projection 30→15-18 (realistic)
- HR% projection bias: -0.195 → -0.037 (81% improvement)

#### 2. Contact Rating Slope Increase (Elite Projections)

**Problem:** Elite scout ratings (75-80 contact) were mapping to AVGs that ranked 12th-20th in the league, not top-11 as they should.

**Solution:** Increased contact slope by 25%, anchored to keep league average at .260.

**Impact:**
- 80 contact: .333 → .352 AVG (now ranks top 1-3, appropriate for elite)
- 75 contact: .317 → .332 AVG (now ranks top 11, matches scout distribution)
- League average maintained at .260 (57 contact rating)
- Widens distribution at extremes without hurting overall accuracy

#### 3. Reduced AVG Over-Regression

**Problem:** AVG stabilization constant of 400 PA caused elite hitters with 500+ PA to still regress heavily (21 points for A.E. Douglas with 531 PA).

**Solution:** Reduced stabilization constant from 400 → 300 PA.

**Impact:**
- Elite hitters with substantial PAs trusted more
- Douglas type cases: Regression reduced from 21 pts → 17 pts
- Still provides meaningful regression for lower PA players

#### 4. Full System Recalibration

After changes, ran automated calibration (`tools/calibrate_batter_coefficients.ts`) to optimize all intercepts:

**Final Accuracy:**
- AVG MAE: 0.025, Bias: -0.0002 (near perfect)
- HR% MAE: 0.777, Bias: -0.037 (excellent)
- BB% MAE: 1.421, Bias: -0.047
- K% MAE: 1.946, Bias: -0.031
- All biases near zero while maintaining elite/poor separation

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

### Player Development Tracker
Tracks scouting ratings over time to visualize player development trends.

**How it works:**
- Snapshots are automatically created when scouting data is uploaded
- Each snapshot stores: Stuff, Control, HRA, OVR stars, POT stars (pitchers) or Eye, AvoidK, Power, Contact (batters)
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
| `HitterTrueRatingsCalculationService` | Batter True Rating calculation with HR%-based power estimation |
| `HitterTrueFutureRatingService` | Batter prospect TFR (wOBA-based peak projections) |
| `HitterRatingEstimatorService` | Rating↔stat conversion coefficients (calibrated) |
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

## Calibration Tools

Automated calibration scripts optimize coefficients to minimize projection bias:

| Tool | Purpose | Usage |
|------|---------|-------|
| `tools/calibrate_batter_coefficients.ts` | Optimize rating→stat intercepts | `npx tsx tools/calibrate_batter_coefficients.ts` |
| `tools/calibrate_level_adjustments.ts` | Analyze MiLB→MLB predictive validity | For tuning scouting weights |
| `tools/test_hitter_tfr.ts` | Validation test against historical outcomes | Validate TFR accuracy |
| `tools/analyze_hitter_data.ts` | Analyze OOTP engine test data | For coefficient research |

**Calibration Process:**
1. Simulates full projection pipeline (historical stats → ratings → projections)
2. Validates against 2015-2021 actual results
3. Iteratively adjusts intercepts to minimize bias
4. Outputs recommended coefficient changes
5. Reports MAE (mean absolute error) and bias for each stat

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

**wOBA (Weighted On-Base Average):**
```
wOBA = 0.69×BB_rate + 0.89×1B_rate + 1.27×2B_rate + 1.62×3B_rate + 2.10×HR_rate
```

**Level-Weighted IP/PA (for TFR scouting weight):**
```
weightedIp = (AAA_IP × 1.0) + (AA_IP × 0.7) + (A_IP × 0.4) + (R_IP × 0.2)
```

## Views

- **TrueRatingsView**: MLB pitcher dashboard with TR/projections
- **BatterTrueRatingsView**: MLB batter dashboard with TR/projections
- **FarmRankingsView**: Top 100 prospects, org rankings with Farm Score, sortable/draggable columns
- **ProjectionsView**: Future performance projections with 3-model ensemble
- **TradeAnalyzerView**: Side-by-side player comparisons
- **DataManagementView**: File uploads, data refresh, system maintenance
- **PlayerProfileModal**: Deep-dive with Ratings + Development tabs

## Data Sources

**StatsPlus API:**
- Base: `/api/playerpitchstatsv2/` (pitchers), `/api/playerbatstatsv2/` (batters)
- Params: `year`, `lid` (200=MLB, 201-204=minors), `split=1`

**CSV Uploads:**

*Pitcher Scouting:* `player_id, name, stuff, control, hra [, age, ovr, pot, pitches...]`

*Batter Scouting Columns (from OOTP export):*
| Column | Maps To | Notes |
|--------|---------|-------|
| `POW P` | power | Power rating (maps to HR%) |
| `EYE P` | eye | Eye/plate discipline |
| `K P` | avoidK | Avoid strikeout |
| `CON P` | contact | **Use this, NOT HT P** |
| `GAP P` | gap | Gap power (not used in TFR) |
| `SPE` | speed | Speed (not used in TFR) |
| `HT P` | — | **Not mapped** - Contact is better for AVG |

## Configuration

**General:**
- League start year: 2000
- Peak age: 27
- Replacement FIP: 5.00

**True Ratings:**
- Full confidence IP threshold: 150 (pitchers)
- Full confidence PA threshold: varies by stat (batters)

**Batter Stabilization Constants:**
- BB%: 120 PA
- K%: 60 PA
- HR%: 160 PA
- AVG: 300 PA

**TFR Scouting Weights (Pitchers):**
- < 75 weighted IP: 100% scout
- 76-150 weighted IP: 80% scout
- 151-250 weighted IP: 70% scout
- 250+ weighted IP: 60% scout

**TFR Scouting Weights (Batters, by weighted PA):**
- Eye: 100% always (MiLB BB% is noise, r=0.05)
- Contact: 100% always (MiLB AVG is noise, r=0.18)
- AvoidK: 100%/65%/50%/40% at <150/300/500/500+ PA
- Power: 100%/85%/80%/75% at <150/300/500/500+ PA

**Peak Workload Projections:**
- SP base: 30 + (stamina × 3.0), clamped 120-260 IP
- RP base: 50 + (stamina × 0.5), clamped 40-80 IP

**Pitcher MLB Distribution Data:**
- Source years: 2015-2020
- Peak ages: 25-29
- Minimum IP: 50

**Batter MLB Distribution Data:**
- Source years: 2015-2021 (modern era)
- Minimum PA: 300

**Batter Rating→Stat Coefficients (Calibrated 2026-02):**
```typescript
eye:     { intercept: 1.6246,   slope: 0.114789 }     // BB%
avoidK:  { intercept: 25.9942,  slope: -0.200303 }    // K%
power:   { intercept: -0.5906,  slope: 0.058434 }     // HR%
contact: { intercept: 0.035156, slope: 0.00395741 }   // AVG (25% slope increase)
```

## Development Notes

**When modifying coefficients:**
1. Update `HitterRatingEstimatorService.ts` (forward: rating → stat)
2. Update `HitterTrueRatingsCalculationService.ts` (inverse: stat → rating)
3. Run `npx tsx tools/calibrate_batter_coefficients.ts` to verify
4. Check MAE and bias - should be near zero for good calibration

**Key Design Decisions:**
- HR%-based power (not ISO) prevents gap hitter inflation
- Contact rating (not Hit Tool) for AVG predictions
- 25% increased contact slope for realistic elite projections
- Component-specific scouting weights based on MiLB→MLB correlations
- Tier-aware regression prevents over-regressing elite talent
