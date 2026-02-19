# Modal-Equivalent Pipeline Rollout Handoff

## Date
- 2026-02-19

## Status Update (2026-02-19, latest)

### Completed
- Trade Analyzer now uses canonical-current snapshot data (modal-equivalent source path) instead of base-year projection maps.
  - `src/services/CanonicalCurrentProjectionService.ts`
  - `src/views/TradeAnalyzerView.ts`
- Pitcher prospect sourcing now has a unified pool API (parity with hitter unified flow), with farm filtering applied as a wrapper.
  - `src/services/TeamRatingsService.ts`
  - `src/views/PitcherProfileModal.ts`
- Data Source badges were added and wired for:
  - Trade Analyzer
  - Projections View
  - Team Ratings View
  - True Ratings View
  - `src/utils/dataSourceBadges.ts`
  - `src/styles.css`

### Validation
- Typecheck passed:
  - `npx tsc --noEmit`
- Service tests passed:
  - `npx jest src/services/RatingConsistency.test.ts src/services/ProjectionService.test.ts --runInBand`

### Remaining Follow-ups
- Add dedicated tests for canonical snapshot parity:
  - `CanonicalCurrentProjectionService` coverage vs modal outputs
- Decide final user-facing naming pass:
  - Rebrand Projections tab copy to "Pre-season Projections"
  - Confirm Team Ratings mode copy (power rankings vs projected/standings) with explicit season-mode language

## Owner Intent
- Make outputs modal-equivalent everywhere except:
  - `ProjectionsView` (to be rebranded "Pre-season Projections")
  - `TeamRatingsView` projected/standings modes (pre-season model outputs)

## Confirmed Current Behavior

### 1. Modal pipeline (canonical-current)
- Batter modal always re-resolves canonical TR/TFR for current game year and recomputes projection display from canonical data:
  - `src/views/BatterProfileModal.ts:344`
  - `src/views/BatterProfileModal.ts:357`
  - `src/views/BatterProfileModal.ts:1563`
- Pitcher modal does the same, with ProjectionService-based IP precompute:
  - `src/views/PitcherProfileModal.ts:281`
  - `src/views/PitcherProfileModal.ts:294`
  - `src/views/PitcherProfileModal.ts:503`
  - `src/views/PitcherProfileModal.ts:1563`
- Modal `show(..., _selectedYear)` ignores caller year and uses current year:
  - `src/views/BatterProfileModal.ts:307`
  - `src/views/PitcherProfileModal.ts:252`

### 2. Trade Analyzer pipeline (currently mixed)
- Loads projection maps from base year (`currentYear - 1`):
  - `src/views/TradeAnalyzerView.ts:490`
  - `src/views/TradeAnalyzerView.ts:532`
  - `src/views/TradeAnalyzerView.ts:534`
- Uses canonical TR for rating badges when available, but projection stats/WAR from projection maps:
  - `src/views/TradeAnalyzerView.ts:1041`
  - `src/views/TradeAnalyzerView.ts:1059`
  - `src/views/TradeAnalyzerView.ts:349`
  - `src/views/TradeAnalyzerView.ts:188`

### 3. Team Ratings projected/standings behavior
- Projected/standings views force selected year to current game year:
  - `src/views/TeamRatingsView.ts:286`
  - `src/views/TeamRatingsView.ts:288`
- Team projection engine uses projection services (not modal canonical compute):
  - `src/views/TeamRatingsView.ts:393`
  - `src/services/TeamRatingsService.ts:1531`
- These are model projections, not actual standings progression:
  - `src/views/TeamRatingsView.ts:1009`
- In-season data can still affect parts of the projection engines (workload/readiness/distribution), so this is "pre-season style", not purely frozen:
  - `src/services/ProjectionService.ts:188`
  - `src/services/ProjectionService.ts:214`
  - `src/services/BatterProjectionService.ts:193`

## Decision Labels (recommended)
- `Canonical Current`:
  - Uses canonical TR/TFR + modal projection compute path.
- `Pre-season Projection`:
  - Uses base-year batch projection services (`ProjectionService`, `BatterProjectionService`).

## Scope For Next Implementation
- In scope now:
  - `TradeAnalyzerView` ratings/projections/war impact outputs must be modal-equivalent (canonical current pipeline).
- Out of scope now:
  - `ProjectionsView` logic (rename/label only later).
  - `TeamRatingsView` projected/standings math changes.

## Implementation Plan

### Phase 1: Centralize canonical-current projection snapshots
- Add a shared service:
  - `src/services/CanonicalCurrentProjectionService.ts` (new)
- Responsibilities:
  - Build pitcher and batter projection snapshots that match modal "current" mode.
  - Reuse existing pure modal functions in `ModalDataService`:
    - `resolveCanonicalBatterData`
    - `computeBatterProjection`
    - `resolveCanonicalPitcherData`
    - `computePitcherProjection`
  - For pitcher IP parity, replicate modal precompute sequence using `projectionService.calculateProjection(...)` and feed result into `computePitcherProjection`.
  - Return maps keyed by playerId with fields needed by Trade Analyzer.

### Phase 2: Switch Trade Analyzer data source
- In `src/views/TradeAnalyzerView.ts`:
  - Replace base-year `allProjections` / `allBatterProjections` initialization for MLB players with canonical-current snapshot maps from new service.
  - Keep existing farm/TFR prospect fallback branches for non-MLB players.
  - Keep canonical TR preference behavior for rating badges.
  - Ensure trade impact calculations use canonical-current projection WAR for MLB players.

### Phase 3: Labels and UX clarity
- Add explicit pipeline labels in Trade Analyzer UI:
  - e.g. subtitle suffix: `Data mode: Canonical Current`.
- Keep Projections and Team Ratings labeled as projection mode (future PR for naming pass).

### Phase 4: Tests
- Add service tests:
  - `src/services/CanonicalCurrentProjectionService.test.ts` (new)
  - Validate known player parity against modal-equivalent outputs from `ModalDataService` path.
- Add/extend Trade Analyzer tests if present (or add focused unit tests for mapping helpers).

## Risks
- Risk: subtle drift if modal behavior changes and new service forks logic.
  - Mitigation: call `ModalDataService` functions directly, do not reimplement equations.
- Risk: async load cost in Trade Analyzer initialization.
  - Mitigation: batch fetches with `Promise.all`, cache snapshots by year.
- Risk: prospect vs MLB branch conflicts in existing fallback logic.
  - Mitigation: preserve existing prospect path and only replace MLB projection source.

## Acceptance Criteria
- For MLB players in Trade Analyzer:
  - Player modal and Trade Analyzer shown projection stats/ratings match for current mode.
  - No base-year projection artifacts for MLB players (unless explicitly tagged pre-season mode).
- For prospects:
  - Existing TFR/farm behavior unchanged.
- No regressions in trade value summary rendering and sorting.

## Suggested Work Order
1. Build `CanonicalCurrentProjectionService`.
2. Wire Trade Analyzer to consume it.
3. Run focused smoke checks:
   - known mismatch player IDs from explain runs.
4. Add tests.
5. Add UI labels.

## Notes For Next Agent
- Explain CLI was already updated to support modal-equivalent projection output and `--projectionMode=current|peak`; use it as a debugging reference for expected numbers.
- Do not change ProjectionsView or TeamRatings projection math in this task.
