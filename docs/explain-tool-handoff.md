# Explain Tool Handoff

## Goal
Build a debugging/explanation flow that shows **why** a displayed rating/projection is what it is, using the **real service pipeline** (no reimplemented math).

## What Was Implemented

### 1. Service-level trace hooks (opt-in)
- `src/services/TrueRatingsCalculationService.ts`
  - Added `PitcherTrueRatingTrace` + `PitcherRegressionTrace`.
  - `calculateSinglePitcher(...)` accepts optional `trace`.
  - Captures raw inputs/year weights, weighted rates, role/tier context, regression internals, scouting blend internals, and final blended outputs.

- `src/services/HitterTrueRatingsCalculationService.ts`
  - Added `HitterTrueRatingTrace` + `HitterRegressionTrace`.
  - `calculateSingleHitter(...)` accepts optional `trace`.
  - Captures raw inputs/year weights, weighted rates, raw wOBA tier signal, regression internals, scouting blend internals, and final blended outputs.

- `src/services/ProjectionService.ts`
  - Added `ProjectionCalculationTrace` + `ProjectionIpTrace`.
  - `calculateProjection(...)` accepts optional `trace`.
  - Captures pitcher projection internals including aging, FIP pre-IP estimate, IP pipeline decisions/modifiers, and final projected line.

### 2. Hitter projection trace path (implemented)
- `src/services/BatterProjectionService.ts`
  - Added `BatterProjectionCalculationTrace`.
  - Refactored hitter projection math into reusable `calculateProjectionFromTrueRating(...)`.
  - Added `getProjectionWithTrace(year, playerId)` for explain-tool use.
  - Added `projectionPoolSize` to traced return payload for percentile-context messaging.

### 3. CLI explanation tool
- `tools/explain-player.ts`
  - Uses real services + trace hooks for:
    - pitcher rating
    - hitter rating
    - pitcher projection
    - hitter projection (implemented; no placeholder)
  - Supports:
    - `--playerId=<id>`
    - `--type=pitcher|hitter` (optional; auto-detect if omitted)
    - `--mode=rating|projection|all`
    - `--year=<year>`
    - `--format=text|json|markdown` (default `text`; `md` alias also accepted)
    - `--verbose=true` (optional)
  - Output modes:
    - `text` (step-by-step narrative)
    - `json` (structured payload + traces)
    - `markdown` (ticket/paste-friendly headings + bullets)

### 4. Explanation depth improvements (text mode)
- Expanded output to answer "why" questions directly, not just list values.
- Added explicit provenance and context:
  - raw scouting inputs in Step 1 when present (ratings + OVR/POT + injury; pitchers also pitch set summary)
  - year-weight display tied to actual years
  - canonical pool qualifications and percentile-to-star bins
  - explicit note that component ratings are derived from blended stats, not raw scouting
- Added richer math/context detail:
  - aging deltas with age context
  - formula family notes for rating->rate conversion
  - wOBA contribution breakdown in hitter projection
  - regression target/strength internals surfaced in prose

### 5. Tests
- `src/services/RatingConsistency.test.ts`
  - Existing trace assertions for pitcher/hitter TR retained.
  - Added hitter projection trace assertion via `BatterProjectionService.calculateProjectionFromTrueRating(...)`.
- `src/services/ProjectionService.test.ts`
  - Existing pitcher projection trace assertion retained.

### 6. Docs
- `readme.md`
  - Includes explain-tool entry in debugging tools section.

### 7. Markdown output mode (implemented)
- `tools/explain-player.ts`
  - Added `--format=markdown` output mode (plus `md` alias).
  - Reuses the same explanation builders as text mode, rendered as Markdown sections and step headings.

## Current CLI Behavior

### Human-readable output (`--format=text`, default)
- Rating mode explains:
  - exact source years/weights
  - whether scouting is included and source
  - raw scouting inputs (if present)
  - weighted rates -> regression -> scouting blend -> final offense/pitching outputs
  - canonical pool + percentile/rating mapping context
- Projection mode explains:
  - starting component ratings + context
  - aging adjustments and deltas
  - conversion math context
  - workload/play-time logic
  - final projected line

### JSON output (`--format=json`)
- Full structured payload with trace objects for requested mode(s).

### Markdown output (`--format=markdown` or `--format=md`)
- Same explanation content as text mode, formatted with Markdown headings and bullets for direct ticket/wiki paste.

## Useful Known Player IDs For Smoke Tests
- Pitcher: `5254` (works for 2020 in this dataset)
- Hitter: `6464` (works for 2020/2021 in this dataset)

## Validation Commands Run
- `npx tsc --noEmit`
- `npx jest src/services/RatingConsistency.test.ts src/services/ProjectionService.test.ts --runInBand`
- `npx tsx tools/explain-player.ts --playerId=5254 --type=pitcher --mode=rating --year=2020`
- `npx tsx tools/explain-player.ts --playerId=5254 --type=pitcher --mode=projection --year=2020`
- `npx tsx tools/explain-player.ts --playerId=6464 --type=hitter --mode=rating --year=2020`
- `npx tsx tools/explain-player.ts --playerId=6464 --type=hitter --mode=projection --year=2020`
- `npx tsx tools/explain-player.ts --playerId=6464 --type=hitter --mode=rating --year=2021`
- `npx tsx tools/explain-player.ts --playerId=6464 --type=hitter --mode=rating --year=2020 --format=markdown`

## Files Touched (explain-tool work)
- `src/services/TrueRatingsCalculationService.ts`
- `src/services/HitterTrueRatingsCalculationService.ts`
- `src/services/ProjectionService.ts`
- `src/services/BatterProjectionService.ts`
- `tools/explain-player.ts`
- `src/services/RatingConsistency.test.ts`
- `src/services/ProjectionService.test.ts`
- `readme.md`
- `docs/explain-tool-handoff.md`

## Notable Repo State
- There are unrelated working-tree modifications outside explain-tool scope (for example `src/styles.css`).
- Treat existing non-explain diffs as user-owned unless explicitly asked to modify.

## Recommended Next Steps
1. Wire the same trace structures into player profile modals for in-app Explain panels.
