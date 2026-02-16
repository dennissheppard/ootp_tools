# Editable Team Planning Grid

## Overview
The Team Planning view allows users to customize the auto-generated roster grid by clicking on any cell to assign players, extend incumbents, or target trade/FA acquisitions. Changes persist across sessions via IndexedDB.

## Current State (as of 2026-02-15)
All core features are implemented and building cleanly (`npx tsc --noEmit` + `npm run build` both pass).

## Features Implemented
- **Cell editing**: Click any cell to open the edit modal with options to extend an incumbent, choose from org, or search all players
- **Multi-year fill**: Selecting a player fills all remaining years of team control (not just the clicked cell)
  - Minor leaguers: 6 years of team control
  - MLB players: remaining team control determined from actual MLB service years (counted from cached league-wide stats). Applies to all players including arb-eligible — not just minimum salary. Falls back to age-based estimate if no stats data.
  - MLB players on real contracts: fills max of contract years or team control years remaining
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
- **Override-aware auto-fill**: Overrides are applied BEFORE prospect fill so the greedy algorithm treats user edits as locked constraints. Override cells are never replaced, and override-placed players are excluded from the candidate pool for that year. This means editing a cell triggers a full re-optimization of remaining open slots.
- **Final-year cells open for prospect replacement**: Both contract and arb final-year cells are now considered open for prospect placement. The improvement check naturally prevents replacing good players — only genuinely better prospects will take the slot.
- **Rotation sorting by year**: After all prospect placement, SP1-SP5 are re-sorted by rating within each year column. If SP2 leaves and SP3 is the next best, SP3 slides up. Empty slots sink to SP4/SP5.
- **Development curve overrides**: The edit modal shows TFR alongside rating for cell occupants. Players with unrealized upside get a "Set as fully developed" toggle that skips the growth phase — the player projects at TFR immediately (with aging decline). Per-player, persisted in IndexedDB (`player_dev_overrides`, v11). Removable via "Remove development override" on subsequent modal opens.
- **Section header ratings**: Each section header (LINEUP, ROTATION, BULLPEN) shows per-year average star ratings computed from grid cells. A TEAM row at the bottom shows the overall team rating per year (40% rotation + 40% lineup + 20% bullpen). Color-coded with standard rating classes.

## Known Issues / TODO
- **Extend option UX**: The extend section works but uses a generic placeholder. Could show estimated extension cost based on arb tiers.
- **Pitcher TFR for young MLB pitchers**: Young MLB pitchers only get aging decline in the grid (no TFR growth projection) because pitcher TFR comes from `getFarmData()` which only includes farm-eligible prospects.

## Architecture

### Override Flow
1. User clicks cell → `handleCellClick(position, year)`
2. Modal opens via `cellEditModal.show(context, orgPlayers, allPlayers, contractMap, playerRatingMap)` — context includes TFR and dev override state
3. User selects action → modal resolves with `CellEditResult`
4. `processEditResult()` handles the action:
   - Cell overrides: creates `TeamPlanningOverrideRecord(s)`, saves to IndexedDB, updates in-memory map
   - Dev overrides: saves/removes `PlayerDevOverrideRecord` in IndexedDB, updates `devOverrides` set
5. `buildAndRenderGrid()` rebuilds grid: `buildGridData()` → `applyOverrides()` → `fillProspects()` → `sortRotationByYear()` → indicators/financials/ratings → render
6. Grid re-renders with overrides applied — prospect auto-fill optimizes around locked cells

### Override Loading
- `loadOverrides()` reads both cell overrides and dev overrides from IndexedDB — called ONLY when team changes (dropdown selection)
- `applyOverrides()` reads from `this.overrides` (in-memory Map) — called BEFORE `fillProspects()` on every `buildAndRenderGrid()`
- Dev overrides (`this.devOverrides: Set<number>`) are applied when building `prospectCurrentRatingMap` and in `buildRow()` projections
- `processEditResult()` writes to both IndexedDB AND in-memory state before triggering re-render
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
- `TYPICAL_DEBUT_AGE = 23` — fallback for service time estimation when stats data is unavailable
- `MIN_PROSPECT_GRID_AGE = 22` — prospects don't appear in grid before this age
- `MLB_LEAGUE_ID = 200` — league ID used to filter MLB-level stats when counting service years

### Service Year Computation (`computeServiceYears()`)
- Counts actual years with MLB stats by scanning cached league-wide pitching and batting data (2000 to current year)
- Uses `trueRatingsService.getTruePitchingStats(year)` / `getTrueBattingStats(year)` which hit in-memory cache first, then IndexedDB — zero additional API calls
- Only checks roster player IDs (pre-built set from team ranking)
- Result stored in `playerServiceYearsMap: Map<number, number>`
- Team control remaining = `6 - serviceYears + 1` (serviceYears includes current year)
- Falls back to age-based estimate (`age - 23`) only when no stats data exists AND player is on minimum salary

### Prospect Placement Algorithm (Greedy Improvement)
- Overrides are applied first — override cells are locked (never replaced), override-placed players excluded from candidate pool for that year
- For each future year, builds all (prospect, position) candidates with projected improvement over incumbent
- Sorts by improvement descending — biggest upgrades assigned first
- This prevents a high-rated prospect from replacing a decent player at a scarce position while a weak player at a flexible position keeps their spot
- Cells eligible for replacement: empty, existing prospect, min-contract, arb-eligible, or final-year
- Same greedy approach used for hitter lineup, rotation (SP), and bullpen (RP then overflow SP)
- After all prospect placement, rotation slots are re-sorted by rating per year (best pitcher = SP1)

### Future Improvements
- **Research actual league arbitration salaries**: Current arb estimates are rough tiers. Study real arbitration results for a model based on WAR, position, etc.
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

## IndexedDB Schema (v11)

### Cell Overrides (v10)
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

### Development Curve Overrides (v11)
```
Store: player_dev_overrides
KeyPath: 'key' (playerId as string)

Record fields:
  key, playerId
```

CRUD methods on `indexedDBService`:
- `savePlayerDevOverride(playerId)` — marks player as fully developed
- `deletePlayerDevOverride(playerId)` — removes the override
- `getAllPlayerDevOverrides()` — returns all overridden playerIds

Dev overrides are global (per player, not per team). "Reset Edits" only clears cell overrides; dev overrides are removed individually via the edit modal.

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
type CellEditAction = 'cancel' | 'clear' | 'extend' | 'org-select' | 'search-select' | 'dev-override-set' | 'dev-override-remove';
type OverrideSourceType = 'extend' | 'org' | 'trade-target' | 'fa-target';

interface CellEditResult {
  action: CellEditAction;
  player?: Player;
  sourceType?: OverrideSourceType;
  extensionYears?: number;
  rating?: number;
  level?: string;
  devOverridePlayerId?: number;
}
```

## CellEditContext (from CellEditModal.ts)
```ts
interface CellEditContext {
  position: string;
  year: number;
  section: 'lineup' | 'rotation' | 'bullpen';
  currentCell: { playerId, playerName, age, rating } | null;
  incumbentCell: { playerId, playerName, age, rating } | null;
  teamId: number;
  gameYear: number;
  currentPlayerTfr?: number;        // TFR for the current cell's player (shown in modal)
  currentPlayerDevOverride?: boolean; // Whether dev override is active for this player
}
```
