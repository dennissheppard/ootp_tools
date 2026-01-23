# True Pitcher Ratings - Implementation Plan

## Overview

This plan integrates the pitcher rating system from `true_pitcher_ratings.md` into the existing codebase. The system will calculate league-relative "True Ratings" (0.5-5.0 scale) for pitchers based on their performance stats, optionally blended with scouting data.

---

## Phase 1: Scouting Data CSV Upload

**Goal:** Allow users to upload scouting ratings since they're not API-accessible.

### Step 1.1: Define Scouting Data Interface
**File:** `src/models/ScoutingData.ts` (new)

```ts
interface PitcherScoutingRatings {
  playerId: number;
  playerName?: string;  // for matching if ID missing
  control: number;      // 20-80 scale
  stuff: number;        // 20-80 scale
  hra: number;          // 20-80 scale
  age?: number;         // for future value calculations
}
```

### Step 1.2: Create Scouting Data Service
**File:** `src/services/ScoutingDataService.ts` (new)

- `parseScoutingCsv(csvText: string): PitcherScoutingRatings[]`
- Store in localStorage with key `wbl_scouting_ratings_{year}`
- Method to retrieve: `getScoutingRatings(year: number)`
- Method to clear: `clearScoutingRatings(year: number)`

### Step 1.3: Add Upload UI to TrueRatingsView
**File:** `src/views/TrueRatingsView.ts`

- Add collapsible "Upload Scouting Data" section in controls area
- File input for CSV upload
- Display upload status (loaded X players, missing Y)
- Match uploaded data to existing player stats by `playerId` or fuzzy name match

---

## Phase 2: True Ratings Calculation Service

**Goal:** Implement the core rating calculation logic.

### Step 2.1: Create TrueRatingsCalculationService
**File:** `src/services/TrueRatingsCalculationService.ts` (new)

**Core Methods:**

```ts
interface TrueRatingInput {
  playerId: number;
  playerName: string;
  // Multi-year stats (most recent first)
  yearlyStats: Array<{
    year: number;
    ip: number;
    k9: number;
    bb9: number;
    hr9: number;
  }>;
  scoutingRatings?: PitcherScoutingRatings;
}

interface TrueRatingResult {
  playerId: number;
  playerName: string;
  // Blended rates after all calculations
  blendedK9: number;
  blendedBb9: number;
  blendedHr9: number;
  // Estimated ratings (from performance)
  estimatedStuff: number;
  estimatedControl: number;
  estimatedHra: number;
  // FIP-like metric
  fipLike: number;
  // Percentile rank (0-100)
  percentile: number;
  // Final True Rating (0.5-5.0)
  trueRating: number;
  // Total IP used in calculation
  totalIp: number;
}
```

### Step 2.2: Implement Multi-Year Weighted Average
From spec Step 1.1:
- Weights: Year N = 5, N-1 = 3, N-2 = 2
- Calculate `weightedK9`, `weightedBb9`, `weightedHr9`

```ts
calculateWeightedRates(yearlyStats: YearlyStats[]): WeightedRates
```

### Step 2.3: Implement Regression to League Mean
From spec Step 1.2:
- Stabilization constants: BB/9 = 40 IP, K/9 = 50 IP, HR/9 = 70 IP
- Formula: `regressed = (weighted × IP + leagueAvg × K) / (IP + K)`

```ts
regressToLeagueMean(
  weightedRate: number,
  totalIp: number,
  leagueRate: number,
  stabilizationK: number
): number
```

### Step 2.4: Implement Scouting Blend (Optional)
From spec Step 2:
- Map scouting ratings → expected rates (using existing inverse formulas from `RatingEstimatorService`)
- Blend: `w_stats = IP / (IP + 60)`, then interpolate

```ts
blendWithScouting(
  regressedRate: number,
  scoutingExpectedRate: number,
  totalIp: number,
  confidenceIp: number = 60
): number
```

### Step 2.5: Implement FIP-like Metric
From spec Step 3:
```ts
calculateFipLike(k9: number, bb9: number, hr9: number): number {
  return (13 * hr9 + 3 * bb9 - 2 * k9) / 9;
}
```

### Step 2.6: Implement Percentile Ranking
From spec Step 4:
- Rank all pitchers by `fipLike` (lower is better)
- Convert to percentile (inverted so higher = better)

```ts
calculatePercentiles(pitchers: TrueRatingResult[]): void
```

### Step 2.7: Implement Percentile → Rating Conversion
From spec Step 5, bell curve buckets:

| Percentile | Rating |
|------------|--------|
| ≥97.7%     | 5.0    |
| 93.3-97.7% | 4.5    |
| 84.1-93.3% | 4.0    |
| 69.1-84.1% | 3.5    |
| 50-69.1%   | 3.0    |
| 30.9-50%   | 2.5    |
| 15.9-30.9% | 2.0    |
| 6.7-15.9%  | 1.5    |
| 2.3-6.7%   | 1.0    |
| <2.3%      | 0.5    |

```ts
percentileToRating(percentile: number): number
```

---

## Phase 3: League Stats Service Extension

**Goal:** Calculate league-wide averages needed for regression.

### Step 3.1: Extend TrueRatingsService
**File:** `src/services/TrueRatingsService.ts`

Add method to calculate league averages:

```ts
async getLeagueAverages(year: number): Promise<{
  avgK9: number;
  avgBb9: number;
  avgHr9: number;
  totalPitchers: number;
}>
```

- Filter to qualified pitchers only (min IP threshold, e.g., 20 IP)
- Calculate weighted averages across league

---

## Phase 4: Multi-Year Data Aggregation

**Goal:** Fetch and aggregate stats across multiple years.

### Step 4.1: Add Multi-Year Fetch to TrueRatingsService
**File:** `src/services/TrueRatingsService.ts`

```ts
async getMultiYearPitchingStats(
  endYear: number,
  yearsBack: number = 3
): Promise<Map<number, YearlyStats[]>>
```

- Returns map of `playerId → [year stats]`
- Handles players who didn't pitch in all years
- Leverages existing caching

---

## Phase 5: View Integration

**Goal:** Display True Ratings in the existing TrueRatingsView.

### Step 5.1: Add True Ratings Columns
**File:** `src/views/TrueRatingsView.ts`

Add new columns to `DEFAULT_PITCHER_COLUMNS`:
- `trueRating` (True Rating)
- `percentile` (%)
- `fipLike` (FIP*)
- `estimatedStuff`, `estimatedControl`, `estimatedHra` (optional, toggleable)

### Step 5.2: Add Toggle for True Ratings Mode
- Toggle between "Raw Stats" and "True Ratings" view
- True Ratings view triggers calculation pipeline
- Show loading indicator during calculation

### Step 5.3: Add Visual Rating Indicators
- Color-code ratings: 5.0=gold, 4.0+=green, 3.0=neutral, 2.0-=orange, 1.0-=red
- Optional star/tier display

### Step 5.4: Add Scouting Comparison Column (when data uploaded)
- Show scout rating vs estimated rating
- Visual diff indicator

---

## Phase 6: CSS Styling

**File:** `src/styles.css`

- Styles for CSV upload section
- Rating badge colors
- Comparison diff indicators

---

## Implementation Order

1. **Phase 1** - Scouting CSV upload (separate agent)
2. **Phase 2.1-2.5** - Core calculation service (can test independently)
3. **Phase 3** - League averages (needed for regression)
4. **Phase 4** - Multi-year aggregation
5. **Phase 2.6-2.7** - Percentile/rating conversion
6. **Phase 5** - View integration
7. **Phase 6** - Styling polish

---

## Deferred Features (Phase 7+)

Per the spec, these can be added later:
- **Age curves & Future Value (FV)** - Requires historical data analysis
- **SP/RP separation** - Different curves per role
- **Individual rating columns** (Stuff/Control/HRA as separate 0.5-5.0 ratings)

---

## Files to Create
1. `src/models/ScoutingData.ts`
2. `src/services/ScoutingDataService.ts`
3. `src/services/TrueRatingsCalculationService.ts`

## Files to Modify
1. `src/services/TrueRatingsService.ts` - Add league averages + multi-year fetch
2. `src/views/TrueRatingsView.ts` - Add upload UI + True Ratings display
3. `src/styles.css` - New styles
