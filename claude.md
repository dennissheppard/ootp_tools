# WBL Stats - World Baseball League Player Statistics

A TypeScript/Vite web application for viewing baseball player statistics and calculating potential stats from OOTP (Out of the Park Baseball) ratings.

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
│   ├── StatsView.ts        # Player stats display
│   ├── PotentialStatsView.ts # Rating-to-stats calculator UI
│   ├── LoadingView.ts      # Loading overlay
│   └── ErrorView.ts        # Error display
├── controllers/
│   └── PlayerController.ts # Handles player search/stats logic
└── services/
    ├── PlayerService.ts    # Player data fetching
    ├── StatsService.ts     # Stats data fetching
    └── PotentialStatsService.ts # Rating-to-stats calculations
```

## Key Features

### 1. Player Search & Stats Display
Search players and view their historical pitching/batting statistics.

### 2. Potential Stats Calculator
Convert OOTP pitcher ratings to projected stats. Located in `PotentialStatsService.ts`.

**Input Ratings** (20-80 scale):
- Stuff, Control, HRA (Home Run Avoidance), Movement, BABIP

**WBL-Calibrated Formulas** (derived from 440+ WBL pitcher-seasons):

| Stat | Formula | R² | Notes |
|------|---------|-----|-------|
| K/9 | -1.65 + 0.223*Stuff - 0.00142*Stuff² | 0.22 | Diminishing returns at high Stuff |
| BB/9 | 8.27 - 0.170*Control + 0.0011*Control² | 0.43 | Strongest predictor |
| HR/9 | 3.99 - 0.098*HRA + 0.00071*HRA² | 0.20 | Moderate |
| H/9 | 12.91 - 0.065*BABIP - 0.037*Movement | 0.06 | High variance |

**Key WBL Insights**:
- WBL K rates are 25-40% LOWER than neutral MLB environment
- Stuff 70→80 only adds ~2 Ks/season (diminishing returns)
- Control→BB/9 is most predictable; BABIP→H/9 is nearly random

**Derived Stats**:
- FIP: ((13*HR) + (3*BB) - (2*K)) / IP + 3.10
- WHIP: (BB + H) / IP
- WAR: ((4.10 - FIP) / 10) * (IP / 9)

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

- `ootp_data_*.csv` - Collected rating/stat data for formula derivation
- `regions_pitcher.json` - Saved OCR regions for pitcher data collection

## Development Notes

- Dark theme UI with CSS variables in `:root`
- Responsive design with mobile breakpoints at 640px
- TypeScript strict mode enabled with `noUnusedLocals`
- Views self-initialize and bind to container elements
