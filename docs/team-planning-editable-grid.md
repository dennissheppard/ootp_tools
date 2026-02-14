# Editable Team Planning Grid

## Overview
The Team Planning view allows users to customize the auto-generated roster grid by clicking on any cell to assign players, extend incumbents, or target trade/FA acquisitions. Changes persist across sessions via IndexedDB.

## Current State (as of 2026-02-14)
All core features are implemented and building cleanly (`npx tsc --noEmit` + `npm run build` both pass). The feature is functional but has known issues listed below that still need fixing.

## Features Implemented
- **Cell editing**: Click any cell to open the edit modal with options to extend an incumbent, choose from org, or search all players
- **Multi-year fill**: Selecting a player fills all remaining years of team control (not just the clicked cell)
  - Minor leaguers: 6 years of team control
  - MLB players on minimum ($228K): remaining team control estimated from age
  - MLB players on real contracts: fills years remaining on contract
- **Position filtering**: "Choose from org" only shows players eligible for the grid position (uses same `canPlay` map as auto-fill: e.g., C slot only shows catchers, LF shows LF/CF/RF)
- **Org list sorted by TFR/TR**: Players sorted highest-rating-first, rating shown next to name
- **Trade/FA detection**: External players auto-labeled as TRADE or FA targets based on contract coverage at the target year
- **Override persistence**: Edits stored in IndexedDB (`team_planning_overrides` store, v10), survive page reloads
  - Overrides loaded from DB only on team selection change
  - In-memory map is source of truth during session (avoids DB race conditions)
- **Reset Edits**: Button (visible only when overrides exist) to clear all overrides with confirmation dialog
- **Prospect age floor**: `MIN_PROSPECT_GRID_AGE = 22` — prospects don't appear until age 22
- **Salary in prospect cells**: Shows estimated salary instead of MiLB level (e.g., "$228K" instead of "AAA")
- **Arbitration salary estimation**: `estimateTeamControlSalary(serviceYear, tfr)` function with tiered arb estimates
- **Financial totals**: Salary rows now use actual computed salaries (including arb estimates) instead of flat placeholder
- **Indicator badges**: TRADE (orange) and FA_TARGET (purple) badges on override cells
- **Visual differentiation**: Override cells have dashed left border; empty cells have pointer cursor
- **Override ratings from playerRatingMap**: User-placed players get their actual TR (MLB) or TFR (prospect) from the rating map, not 0. Arb salary estimates also use the real rating instead of defaulting to 3.0 TFR tier.
- **Player profile modals**: Clicking a player's name opens their profile modal (BatterProfileModal or PitcherProfileModal). Clicking elsewhere in the cell opens the edit modal. Profile data is built from cached ranking/farm data with full scouting ratings, TFR components, development TR, and projections for prospects; TR and estimated ratings for MLB players.

## Known Issues / TODO
- **Extend option UX**: The extend section works but uses a generic placeholder. Could show estimated extension cost based on arb tiers.

## Architecture

### Override Flow
1. User clicks cell → `handleCellClick(position, year)`
2. Modal opens via `cellEditModal.show(context, orgPlayers, allPlayers, contractMap, playerRatingMap)`
3. User selects action → modal resolves with `CellEditResult`
4. `processEditResult()` creates `TeamPlanningOverrideRecord(s)`, saves to IndexedDB, updates in-memory map
5. `buildAndRenderGrid()` rebuilds grid from scratch, calls `applyOverrides()` using in-memory map
6. Grid re-renders with overrides applied

### Override Loading
- `loadOverrides()` reads from IndexedDB — called ONLY when team changes (dropdown selection)
- `applyOverrides()` reads from `this.overrides` (in-memory Map) — called on every `buildAndRenderGrid()`
- `processEditResult()` writes to both IndexedDB AND `this.overrides` in-memory before triggering re-render
- This avoids a race condition where the DB write transaction hadn't committed before the re-read

### Player Rating Map
- `playerRatingMap: Map<number, number>` built in `buildPlayerRatingMap()` from:
  - `ranking.lineup` / `ranking.bench` → `trueRating` (MLB batters)
  - `ranking.rotation` / `ranking.bullpen` → `trueRating` (MLB pitchers)
  - `orgHitters` → `trueFutureRating` (hitter prospects)
  - `orgPitchers` → `trueFutureRating` (pitcher prospects)
- Used for sorting org player list and displaying ratings in the modal

## Salary Estimation for Team-Controlled Players

### Current Implementation (Rough Estimates)
Salaries shown in prospect cells are estimated based on service year (1-6) and TFR rating:

| Service Year | Description | 5.0+ TFR | 4.0-4.5 TFR | 3.0-3.5 TFR | 2.5 TFR | 2.0- TFR |
|---|---|---|---|---|---|---|
| 1-3 | Pre-arbitration | $228K | $228K | $228K | $228K | $228K |
| 4 | Arb Year 1 | $7M | $4M | $1M | $750K | $500K |
| 5 | Arb Year 2 | $10M | $7M | $4M | $2M | $1M |
| 6 | Arb Year 3 | $13M | $10M | $7M | $4M | $2M |

Defined in `ARB_TIERS` constant and `estimateTeamControlSalary()` function in `TeamPlanningView.ts`.

Service year for auto-filled prospects is computed from ETA: `serviceYear = yi - eta + 1`. For user-placed minor leaguers via overrides, service year = loop index + 1 from clicked year.

### Constants
- `MIN_SALARY = 228_000` — league minimum, also threshold for identifying team-control players
- `MIN_SALARY_THRESHOLD = MIN_SALARY` — alias used in contract checks
- `TEAM_CONTROL_YEARS = 6`
- `TYPICAL_DEBUT_AGE = 23` — used for service time estimation from age
- `MIN_PROSPECT_GRID_AGE = 22` — prospects don't appear in grid before this age

### Future Improvements
- **Research actual league arbitration salaries**: Current arb estimates are rough tiers. Study real arbitration results for a model based on WAR, position, etc.
- **Use playerRatingMap for override salaries**: Look up TFR from rating map when computing arb estimates for user-placed players (currently defaults to 3.0 tier)
- **MLB stats-based service time**: Count years with MLB stats in database instead of estimating from age
- **Extension cost estimation**: Show projected arb/FA cost when extending a player

## Position Eligibility (for org list filtering)
Defined in `POSITION_ELIGIBILITY` in `CellEditModal.ts`:
```
C:  [2]           (Catcher only)
1B: [3, 6]        (1B, SS)
2B: [4, 6]        (2B, SS)
SS: [6]           (SS only)
3B: [5, 6]        (3B, SS)
LF: [7, 8, 9]     (LF, CF, RF)
CF: [8]           (CF only)
RF: [9, 7, 8]     (RF, LF, CF)
DH: [2-10]        (anyone)
```
Rotation/bullpen slots: pitchers only (position === 1)

## IndexedDB Schema (v10)
```
Store: team_planning_overrides
KeyPath: 'key' (format: "teamId_position_year", e.g., "42_SS_2024")
Index: teamId (non-unique)

Record fields:
  key, teamId, position, year, playerId, playerName, age, rating, salary,
  contractStatus, level?, isProspect?, sourceType ('extend'|'org'|'trade-target'|'fa-target'), createdAt
```

CRUD methods on `indexedDBService`:
- `saveTeamPlanningOverride(record)` — single put
- `saveTeamPlanningOverrides(records)` — batch put
- `getTeamPlanningOverrides(teamId)` — get all by teamId index
- `deleteTeamPlanningOverride(key)` — delete single
- `deleteAllTeamPlanningOverrides(teamId)` — cursor delete all for team

## Key Files
- `src/views/TeamPlanningView.ts` — Grid logic, override loading/saving, salary estimation, `estimateTeamControlSalary()`, `buildPlayerRatingMap()`
- `src/views/CellEditModal.ts` — Cell editing modal UI, position eligibility filtering, trade/FA determination
- `src/services/IndexedDBService.ts` — Override persistence (v10 store, `TeamPlanningOverrideRecord` interface)
- `src/styles.css` — Modal styles (`.cell-edit-*`), indicator styles (`.cell-indicator-trade`, `.cell-indicator-fa_target`), `.cell-override`, `.tp-reset-btn`
- `docs/team-planning-editable-grid.md` — This file

## GridCell Interface (in TeamPlanningView.ts)
```ts
interface GridCell {
  playerId: number | null;
  playerName: string;
  age: number;
  rating: number;
  salary: number;
  contractStatus: 'under-contract' | 'final-year' | 'arb-eligible' | 'empty' | 'minor-league' | 'prospect';
  level?: string;
  isProspect?: boolean;
  isMinContract?: boolean;
  isOverride?: boolean;
  overrideSourceType?: string;
  indicators?: CellIndicator[];
}
```

## CellEditResult (from CellEditModal.ts)
```ts
type CellEditAction = 'cancel' | 'clear' | 'extend' | 'org-select' | 'search-select';
type OverrideSourceType = 'extend' | 'org' | 'trade-target' | 'fa-target';

interface CellEditResult {
  action: CellEditAction;
  player?: Player;
  sourceType?: OverrideSourceType;
  extensionYears?: number;
  rating?: number;
  level?: string;
}
```
