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
│   ├── TrueRatingsView.ts  # True Ratings page UI
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
    ├── ScoutingDataService.ts # Scouting CSV parsing and localStorage persistence
    ├── MinorLeagueStatsService.ts # Minor league stats CSV parsing and localStorage persistence
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

- **Data Source**: Fetches data from the `https://statsplus.net/wbl/api/playerpitchstatsv2/` and `playerbatstatsv2/` endpoints.
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

### 6. Data Management
A central hub for managing all offline data, including minor league statistics and scouting reports.

**Tabs**:
1.  **Minor League Stats**: Manage historical minor league data for projections.
2.  **Scouting Reports**: Manage scouting data ("My Scout" and "OSA").

**CSV Formats**:
- **Stats**: `ID,Name,IP,HR,BB,K,HR/9,BB/9,K/9`
- **Scouting**: `player_id, name, stuff, control, hra [, age]`

**Features**:
- **Multi-File Upload**: Batch upload multiple CSV files.
- **Source Selection**: Toggle between "My Scout" and "OSA" for scouting data.
- **Data Management**: View and delete stored data sets.

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

## Development Notes

- Dark theme UI with CSS variables in `:root`
- Responsive design with mobile breakpoints at 640px
- TypeScript strict mode enabled with `noUnusedLocals`
- Views self-initialize and bind to container elements
- User preferences persist in `localStorage` under the `wbl-prefs` key. Currently stores whether the CSV upload instructions are hidden and whether pitch-rating chips on the draft board are hidden. Preferences are loaded at startup and updated whenever the related toggles are used.
- **Vite Proxy**: The `vite.config.ts` file is configured to handle CORS issues by proxying API requests.
    - `/api` requests are proxied to `https://atl-01.statsplus.net/world`.
    - `/api-wbl` requests are proxied to `https://statsplus.net/wbl` for the True Ratings page.
