# Fix Trade Analyzer Speed + Clarify Pipeline Boundaries (COMPLETED)


## Background

The app has two projection pipelines that serve **different purposes**:

1. **Canonical Current** — "What is this player worth right now?" Uses authoritative TR from `TrueRatingsService`, resolves TFR/prospect data, runs modal-equivalent projection math via `ModalDataService`. Every current-truth view should show the same numbers as the profile modal.

2. **Forecasting Model** — "What does the model predict for next season?" (`ProjectionService` / `BatterProjectionService`). Computes its own TR from arbitrary-year stats, uses ensemble projection math (40% optimistic, 30% neutral, 30% pessimistic), supports backtesting and year selection. This is a legitimately different question and should stay separate.

### The problem

`CanonicalCurrentProjectionService` (used only by Trade Analyzer) is **5-6 seconds per team** because it calls `await projectionService.calculateProjection()` per pitcher in a serial loop — the full async modal path — just to extract an IP number. The actual IP calculation (`calculateProjectedIp()`) is synchronous; the method is async only because it lazy-loads stamina/IP distributions on first call.

### Which views use which pipeline

| View | Pipeline | Correct? |
|-|-|-|
| Profile modals | Canonical Current (inline) | Yes |
| True Ratings | Canonical Current (TR/TFR maps) | Yes |
| Trade Analyzer | Canonical Current (CanonicalCurrentProjectionService) | Yes, but slow |
| Team Planning | Canonical Current (TR maps + TFR) | Yes |
| Farm Rankings | Canonical Current (TFR pools) | Yes |
| Projections view | Forecasting Model | Yes — different purpose |
| Team Ratings: Power Rankings | Canonical Current (TR maps) | Yes |
| Team Ratings: Projections/Standings | Forecasting Model | Yes — different purpose |

No migration needed. The pipeline assignments are correct. The only issue is performance.

---

## Phase 1: Fix IP Projection Bottleneck

**The root cause of the 5-6 second delay.**

In `CanonicalCurrentProjectionService.buildSnapshot()` (line ~236), for every pitcher where `data.projIp === undefined`:
```typescript
const calc = await projectionService.calculateProjection(...)
projectedIpFromService = calc.projectedStats.ip;  // only IP is used!
```

`calculateProjection()` is async solely because of `ensureDistributionsLoaded()` (line 516-518), which loads stamina/IP distributions from IndexedDB on first call. The actual IP calculation — `calculateProjectedIp()` (line 755) — is **synchronous**.

### Fix
1. Make `ProjectionService.ensureDistributionsLoaded()` public (or add a public wrapper)
2. Make `ProjectionService.calculateProjectedIp()` public
3. In `CanonicalCurrentProjectionService.buildSnapshot()`:
   - Call `await projectionService.ensureDistributionsLoaded()` **once** at the top, alongside the existing `Promise.all`
   - Replace the per-pitcher `await projectionService.calculateProjection(...)` with synchronous `projectionService.calculateProjectedIp(...)` calls
   - This eliminates all per-player awaits from the loop
4. Note: `calculateProjectedIp` needs a `projectedFip` parameter. The current code computes this inside `calculateProjection` via `PotentialStatsService.calculatePitchingStats()` with dummy 150 IP. Replicate that same FIP estimate inline before calling `calculateProjectedIp`.

### Files changed
- `src/services/ProjectionService.ts` — make two methods public
- `src/services/CanonicalCurrentProjectionService.ts` — restructure pitcher loop

### Validation
- Select teams in Trade Analyzer — should feel instant
- Projected WAR/IP values should be identical to before (same math, just called differently)
- Open a pitcher's profile modal from Trade Analyzer — numbers should still match

---

## Phase 2: Add Team-Level Cache + League-Wide Data Cache

Currently `getSnapshotForTeams()` always calls `buildSnapshot()` even for previously-processed teams, and `buildSnapshot()` re-fetches all league-wide data (12-item `Promise.all`) every time.

### Fix
1. Track processed team IDs in a `Set<number>` — skip `buildSnapshot` if team already in cache
2. Extract league-wide data loading into a separate `ensureLeagueDataLoaded(year)` method that caches results as instance fields (player list, TR maps, TFR data, scouting, stats by year). Called once, reused across all team builds.

### Files changed
- `src/services/CanonicalCurrentProjectionService.ts`

### Expected result
Switching back to a previously selected team is instant (cache hit). First team selection is faster (league-wide data loaded once).

---

## Phase 3: Update Documentation

### `docs/pipeline-map.html`
Rewrite to reflect the actual architecture: two pipelines with clear, intentional boundaries. Remove the "mismatch zone" framing — there's no mismatch, they answer different questions.

### `readme.md`
Update the Pipeline Modes section to match.

### `roadmap/pipeline-unification.md`
This file becomes historical record after implementation.

---

## Key Files Reference

| File | Role |
|-|-|
| `src/services/CanonicalCurrentProjectionService.ts` | Fix target (Phases 1-2) |
| `src/services/ProjectionService.ts` | Expose `ensureDistributionsLoaded()` + `calculateProjectedIp()` (Phase 1) |
| `src/services/ModalDataService.ts` | `resolveCanonical*Data()` + `compute*Projection()` — canonical projection math (already correct) |
| `src/services/TrueRatingsService.ts` | Canonical TR source (already correct) |
| `src/views/TradeAnalyzerView.ts` | Primary beneficiary of Phase 1-2 |
| `docs/pipeline-map.html` | Rewrite (Phase 3) |
