# True Ratings - OOTP Analysis & Projection Suite

A comprehensive analysis tool for Out of the Park Baseball (OOTP), designed to reveal the "true" performance levels of players and teams. This application blends scouting ratings with historical statistics to create accurate projections, evaluate trade targets, and uncover undervalued prospects.

> **Note**: This version is calibrated specifically for the WBL (World Baseball League) environment.

## 🚀 Quick Start

### Prerequisites
*   Node.js (v18+ recommended)
*   NPM

### Installation
1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```

### Running the App
Start the development server:
```bash
npm run dev
```
Open your browser to `http://localhost:5173` (or the port shown in the terminal).

To build for production:
```bash
npm run build
```

---

## 🌟 Key Features

### 1. True Ratings Explorer
The core dashboard for analyzing pitcher performance.
*   **Context-Aware**: Calculates a "True Rating" (0.5 - 5.0 stars) based on a blended analysis of scouting ratings and actual performance stats.
*   **Dual-View**: Toggle between standard stats and advanced metrics.
*   **Interactive**: Filter by year, sort by any column, and click any player for a deep-dive profile.

### 2. Advanced Projections
Uses a sophisticated **Three-Model Ensemble** to predict future performance:
*   **Optimistic Model**: Standard aging curves (great for developing youth).
*   **Neutral Model**: Conservative "status quo" approach.
*   **Pessimistic Model**: Trend-based analysis to catch declines early.
*   *See [Technical Reference](docs/TECHNICAL_REFERENCE.md) for the math behind the ensemble.*

### 3. Team Rater
Instantly evaluate the pitching strength of every organization.
*   **Rotation vs. Bullpen**: Automatically classifies pitchers into roles.
*   **Aggregate WAR**: Ranks teams based on the total value of their staff.
*   **Projected Improvement**: See which teams are trending up or down for the next season.

### 4. Farm Rankings & Prospect Analysis
Comprehensive tools for evaluating organizational depth and individual talent.
*   **Top Systems**: Ranks organizations by total **Peak WAR** across all qualified prospects. Provides a depth breakdown showing the number of prospects in each quality tier (Elite, Good, Average, Fringe).
*   **Top 100**: A league-wide leaderboard of the best prospects ranked by **TFR (True Future Rating)** and **Peak WAR**.
*   **Organizational Reports**: Detailed breakdowns of "Future Rotation" and "Future Bullpen" strength, identifying each team's top 5 prospects in each role.
*   **Peak Projection**: Projects long-term value by calculating **Peak FIP** and **Peak WAR** using standardized workloads (180 IP for Starters, 65 IP for Relievers).
*   **Level Adjustments**: Translates minor league performance from Rookie/A/AA/AAA into MLB-equivalent rates for accurate comparisons.

### 5. Calculators
*   **Potential Stats**: Convert 20-80 ratings into projected ERA, K/9, and WAR.
*   **Rating Estimator**: The reverse—enter stats to see what the underlying ratings *should* be (great for checking scout accuracy).

---

## 📂 Data Management

This app relies on CSV exports from OOTP or the StatsPlus API.

### Uploading Data
Navigate to the **Data Management** tab to upload your files.

1.  **Scouting Reports**: Upload your `scouting.csv` exports.
    *   **My Scout**: Your team's scout (Primary source).
    *   **OSA**: OOTP Scouting Assistant (Fallback source).
    *   *The app automatically blends sources: if "My Scout" misses a player, it falls back to OSA.*

2.  **Minor League Stats**: Upload batting/pitching exports for R/A/AA/AAA levels to power the Prospect Analysis tools.

### Storage
*   Data is stored locally in your browser using **IndexedDB**.
*   Supports large historical datasets (thousands of players across decades) without performance loss.

---

## 🛠️ Developer Notes

*   **Stack**: TypeScript, Vite, Vanilla CSS (Dark Theme).
*   **Architecture**: MVC (Models, Views, Controllers, Services).
*   **Math & Methodology**: detailed formulas for WAR, FIP, and Aging Curves can be found in [docs/TECHNICAL_REFERENCE.md](docs/TECHNICAL_REFERENCE.md).

### Project Structure
```
src/
├── services/   # Core business logic (Stats, Projections, Math)
├── models/     # TypeScript interfaces
├── views/      # UI Components
├── controllers/# Data orchestration
└── tools/      # Python/TS scripts for calibration and analysis
```