# True Ratings System - Technical Architecture

## System Overview

OOTP pitcher analysis application that synthesizes scouting ratings and historical performance data to generate "True Ratings" (0.5-5.0 scale), project future performance, and evaluate organizational depth. Calibrated for WBL (World Baseball League) environment.

**Core Concept**: Blend scouting ratings (potential) with actual stats (reality) to produce accurate performance assessments and projections.

## Technology Stack

- TypeScript + Vite
- IndexedDB v3 for client-side storage
- Vanilla CSS (dark theme)
- MVC architecture

**Commands**:
- `npm install` - Dependencies
- `npm run dev` - Development server (port 5173)
- `npm run build` - Production build

## Architecture

### MVC Pattern
```
src/
├── models/       # TypeScript interfaces (Player, PitchingStats, ScoutingReport, Projection)
├── services/     # Business logic layer
├── views/        # UI components
├── controllers/  # Data orchestration between services and views
└── tools/        # Python/TS analysis scripts
```

## Core Services

### TrueRatingsService
**Purpose**: Calculate "True Rating" by blending scouting grades with actual performance.

**Algorithm**: Weighted average of ratings-based projection and stats-based rating, adjusted by IP threshold:
```typescript
trueRating = (ratingBasedProjection × 0.5) + (statsBasedRating × 0.5)
confidence = min(IP / 150, 1.0)  // Fully trust at 150+ IP
finalRating = (trueRating × confidence) + (ratingBasedProjection × (1 - confidence))
```

**Location**: `src/services/TrueRatingsService.ts`

### ProjectionService
**Purpose**: Three-model ensemble for future performance prediction.

**Models**:
1. **Optimistic**: Standard aging curves (peak at 27, gradual decline)
2. **Neutral**: Status quo (minimal change)
3. **Pessimistic**: Trend-based (exponential smoothing of recent trajectory)

**Output**: Weighted average (0.4 / 0.3 / 0.3 split) of HR/9, BB/9, K/9 → FIP → WAR

**Location**: `src/services/ProjectionService.ts`

### TrueFutureRatingService
**Purpose**: Calculate Peak WAR for minor league prospects.

**Process**:
1. Apply level adjustments (Rookie/A/AA/AAA → MLB equivalent rates)
2. Project to player's "peak age" (27 years old)
3. Calculate Peak FIP using standardized workload (180 IP starter / 65 IP reliever)
4. Convert FIP → WAR using replacement level baseline

**Level Adjustment Multipliers** (applied to HR/9, BB/9, K/9):
- AAA: 1.0× (no adjustment)
- AA: Varies by stat
- A: Larger adjustments
- Rookie: Largest adjustments

**Location**: `src/services/TrueFutureRatingService.ts`

### MinorLeagueStatsService
**Purpose**: Fetch and cache minor league stats from StatsPlus API or CSV uploads.

**Dual Storage System**:
- League-level store: `{year}_{level}` keys (bulk operations)
- Player-indexed store: `{playerId}_{year}_{level}` keys (O(1) lookups)

**Caching Strategy**:
- Historical years (< current): Permanent cache
- Current year: 24-hour TTL
- In-flight request deduplication

**Location**: `src/services/MinorLeagueStatsService.ts`

### TeamRatingsService
**Purpose**: Aggregate pitcher WAR by team and role (rotation vs bullpen).

**Role Classification**:
- Starter: GS ≥ 10 or IP ≥ 100
- Reliever: Otherwise

**Metrics**:
- Current aggregate WAR
- Projected aggregate WAR
- Improvement delta

**Location**: `src/services/TeamRatingsService.ts`

### IndexedDBService
**Purpose**: Manage persistent browser storage.

**Schema** (v3):
```typescript
// Store 1: League-level data
{
  key: "2020_aaa",
  year: 2020,
  level: "aaa",
  data: Array<PitchingStats>
}

// Store 2: Player-indexed data
{
  key: "12937_2020_aaa",
  playerId: 12937,
  year: 2020,
  level: "aaa",
  data: PitchingStats
}

// Store 3: Metadata
{
  key: "2020_aaa",
  year: 2020,
  level: "aaa",
  source: "api" | "csv",
  fetchedAt: timestamp,
  recordCount: number
}
```

**Location**: `src/services/IndexedDBService.ts`

## Data Flow

### First-Time Initialization
1. App detects empty IndexedDB
2. Navigates to DataManagementView
3. OnboardingView renders with loading animation
4. Sequential API calls for all year/level combinations:
   - MLB: years 2000-present (league ID 200)
   - AAA/AA/A/Rookie: years 2000-present (league IDs 201-204)
   - 250ms delay between requests (rate limiting)
5. Stores data in dual format (league-level + player-indexed)
6. Total: ~110 datasets for 22-year league (~50-100 MB)

### Runtime Data Access
- **PlayerProfileModal**: Fetches individual player stats via player-indexed store (O(1) lookup)
- **FarmRankingsView**: Loads bulk league data for all prospects across all levels
- **TrueRatingsView**: Operates on current MLB data only
- **Cache hits**: Instant load from IndexedDB
- **Cache misses**: API fetch → store → return

## Data Sources & API

### StatsPlus API
**Base URL**: `/api/playerpitchstatsv2/`

**Parameters**:
- `year`: Season year
- `lid`: League ID (200=MLB, 201=AAA, 202=AA, 203=A, 204=Rookie)
- `split`: 1 (standard splits)

**Response Format**: CSV with headers
```csv
id,player_name,team_id,ip,hr,bb,k,hra,bb9,k9,...
12937,John Smith,5,145.2,18,42,139,1.11,2.59,8.59,...
```

**Parser Features**:
- Column name normalization (`player_id` → `id`, `hra` → `hr`)
- Auto-calculates rate stats if missing: `hr/9 = (hr / ip) * 9`
- Handles empty results (returns empty array, not cached)
- Placeholder names for missing `player_name`

### CSV Upload Format
**Scouting Reports**:
```csv
ID,Pitcher Name,Stuff,Movement,Control,...
12937,John Smith,60,55,65,...
```

**Minor League Stats**:
```csv
ID,Name,IP,HR,BB,K,HR/9,BB/9,K/9
12937,John Smith,145.2,18,42,139,1.11,2.59,8.59
```

**File Naming**: `{level}_stats_{year}.csv` (e.g., `aaa_stats_2020.csv`)

## Key Algorithms & Formulas

### FIP (Fielding Independent Pitching)
Primary performance metric (replaces ERA).

```typescript
FIP = ((13 × HR/9) + (3 × BB/9) - (2 × K/9)) / 9 + 3.47
```

**Why**: Removes defensive variance, consistent with projection methodology.

### WAR Calculation
```typescript
replacementFIP = 5.00
ipPerWAR = 50  // 50 IP at replacement level = 1 WAR difference

WAR = ((replacementFIP - playerFIP) / 9) × IP / ipPerWAR
```

### Peak Projection (Prospects)
```typescript
// 1. Apply level adjustment
mlbEquivalentRate = minorLeagueRate × levelMultiplier

// 2. Age curve adjustment to peak (27 years old)
peakRate = mlbEquivalentRate × ageCurveMultiplier

// 3. Project Peak FIP
peakFIP = calculateFIP(peakHR9, peakBB9, peakK9)

// 4. Calculate Peak WAR
standardIP = isStarter ? 180 : 65
peakWAR = ((5.00 - peakFIP) / 9) × standardIP / 50
```

### Level Adjustment Multipliers
Located in `TrueFutureRatingService.ts`:
```typescript
const levelAdjustments = {
  aaa: { hr9Mult: 1.00, bb9Mult: 1.00, k9Mult: 1.00 },
  aa:  { hr9Mult: 0.90, bb9Mult: 0.95, k9Mult: 1.05 },
  a:   { hr9Mult: 0.80, bb9Mult: 0.90, k9Mult: 1.10 },
  rk:  { hr9Mult: 0.70, bb9Mult: 0.85, k9Mult: 1.15 }
}
```

### Projection Ensemble Weights
```typescript
const ensembleWeights = {
  optimistic: 0.4,  // Standard aging curves
  neutral: 0.3,     // Status quo
  pessimistic: 0.3  // Trend-based decline
}
```

## Views & UI Components

### Primary Views
- **TrueRatingsView**: Main dashboard, displays all MLB pitchers with True Rating, current/projected stats
- **FarmRankingsView**: Top 100 prospects, organizational rankings, depth charts
- **StatsView**: Raw stats lookup tool
- **TradeAnalyzerView**: Side-by-side player comparisons
- **DataManagementView**: File upload interface, API data refresh controls
- **PlayerProfileModal**: Deep-dive modal with career trajectory, minor league history, rating breakdown

### Key Controllers
- **PlayerController**: Singleton managing scouting data, provides player lookup by ID
- **MainController** (implied in main.ts): Routes between views, handles global search bar

## Important Constants & Configuration

### WBL-Specific Calibration
- League start year: 2000
- Current year: Auto-detected from system
- Replacement level FIP: 5.00
- Peak age: 27
- Starter threshold: 180 IP (for peak projections)
- Reliever threshold: 65 IP (for peak projections)

### Performance Thresholds
- API rate limiting: 250ms between requests
- Cache TTL (current year): 24 hours
- Minimum IP for True Rating confidence: 150 IP
- Prospect qualification: Age < 30, Minor league stats available

## Development Utilities

### Tools Directory
- `src/tools/`: Contains Python/TypeScript scripts for calibration analysis
- Common tasks: Backtest projection accuracy, calibrate level adjustments, validate WAR calculations

### Debugging Modes
- Player profile modal shows raw scouting data when available
- Console logs API fetch timing and cache hits
- IndexedDB inspector available via browser DevTools

## Known Edge Cases

1. **Missing Scouting Data**: Falls back to OSA (OOTP Scouting Assistant) if "My Scout" data unavailable
2. **Empty API Responses**: Not cached (prevents perpetual errors)
3. **Partial Seasons**: Pro-rates WAR calculations based on actual IP
4. **Split Seasons**: Player stats aggregated across team changes within same year/level
5. **Pre-2026-01-29 Data**: Auto-invalidated due to player ID parsing bugs in earlier versions