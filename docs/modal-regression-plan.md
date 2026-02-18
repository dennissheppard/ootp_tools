# Modal Regression Fix Plan — Updated Feb 17 2026

## Current State

Branch: `age-column-fix`, single commit `f1ee4ac` ("modal blew up") + uncommitted fixes.

### What's been fixed so far:
1. **resolveCanonicalBatterData / resolveCanonicalPitcherData** — Converted from patch-return to direct mutation (matching original main code). Fixed 3 bugs:
   - Bug 1 (Pitcher): Missing `if (playerTR)` branch — MLB pitchers with TFR were all treated as prospects
   - Bug 2 (Batter): Wrong condition `if (playerTR && !tfrEntry.isFarmEligible)` → reverted to `if (playerTR)`
   - Bug 3 (Batter): Explicit `trueRating = undefined` in prospect path — removed (original never did this)
2. **`this`-binding crash** — Static methods (`expectedTriplesRate`, `projectStolenBases`, etc.) passed as bare function references to `computeBatterProjection` lost their `this` context. Wrapped all 6 `HitterRatingEstimatorService` method refs in arrow functions.
3. **Callers updated** — `Object.assign` pattern removed from both modal `show()` methods.
4. **`import type`** — ModalDataService now uses `import type` for interface-only imports (eliminates circular dependency concern).
5. **Better error messages** — Catch blocks now show actual error text + player context in the modal.
6. **Tests** — 14 tests pass (13 adapted + 1 new pitcher upside test).

### What's still broken:

4. **71 PA projection** — Reported for some player (unknown which). Could be:
   - A player with very limited MLB history whose weighted-average PA is very low
   - A bug in the PA recomputation after `projPa = undefined` is set in step 5
   - **Action**: Need to identify the specific player and trace their PA computation

### Root cause found and fixed — Contact=79 / Eye>TFR / TR>TFR (player 11813)

Traced player 11813 (Toyohiro Okimoto): only **2 PA total** (1 in 2020, 1 in 2019).

**Root cause**: `HitterTrueRatingsCalculationService` Step 3 was blending scouting *potential* ratings into TR as a stabilization target. With 2 PA, the blend weight was 99.4% scouting. Since contact scouting = 80 (potential/ceiling), the TR estimated contact was inflated to 79-80 — the potential ceiling, not current ability. Same issue inflated TR wOBA → TR=4.0 even though the player has essentially no MLB statistical track record.

This is architecturally wrong: potential ratings belong in **TFR**, not **TR**.

**Fix applied** (`HitterTrueRatingsCalculationService.ts`): Modified `scoutingToExpectedRates` to scale each component rating toward league average (50) by `devRatio = OVR / POT` (both on 0.5–5.0 star scale) before using it as the blend target:
```
scaledComponent = 50 + (potential - 50) × (OVR / POT)
```
- 2★OVR / 4★POT player → devRatio = 0.5 → blend target is halfway between league avg and ceiling
- 4★OVR / 4★POT (fully developed) → devRatio = 1.0 → blend target unchanged (full potential)
- Sparse-stat player with 2 PA → 99.4% scouting weight still, but target is now current-ability-scaled

**What changed**:
- `scoutingToExpectedRates` now applies `devRatio` scaling before converting to expected rates
- `blendWithScouting`, thresholds, constants: unchanged
- TypeScript clean, 14 tests pass

**Expected outcome for player 11813 after fix**: TR depends on OVR/POT — if the player is, e.g., 3★OVR/3.5★POT, devRatio≈0.86, Contact blend target ≈ 75 instead of 80, TR will be slightly lower. More importantly, for a 2★OVR/4★POT player the contact target would be ≈65, significantly reducing TR inflation.

## Files Modified (from main)

### Service layer:
- `src/services/ModalDataService.ts` — **NEW** — resolve + compute pure functions (FIXED)
- `src/services/ModalDataService.test.ts` — **NEW** — 14 archetype tests
- `src/services/ProspectDevelopmentCurveService.ts` — Per-component sensitivity + MLB stats adjustment
- `src/services/TeamRatingsService.ts` — `getCareerMlbStatsMap` richer stats for dev curves

### View layer:
- `src/views/BatterProfileModal.ts` — Extraction to ModalDataService + arrow-wrapped deps (FIXED)
- `src/views/PitcherProfileModal.ts` — Extraction to ModalDataService (FIXED)
- `src/views/TeamPlanningView.ts` — `resolveCurrentRatingForProjection` + `projectPlanningRating`
- `src/views/CellEditModal.ts` — Recommended/all player split in picker

### Tools:
- `tools/trace-rating.ts` — Per-component trace support

## Key Architecture Notes

- **Resolve functions mutate `data` directly** — No more patch + Object.assign pattern.
- **`computeBatterProjection` / `computePitcherProjection`** — Extracted from `renderProjectionContent()`. All service method deps MUST be wrapped in arrow functions to preserve `this` binding for static methods that call other static methods (e.g., `expectedTriplesRate` → `convertSpeed2080To20200`).
- **`isProspectPeak` → `data.isProspect === true`** — The extraction unified the original two-flag system (`isPeakMode` + `isProspectPeak`) into a single `isPeakMode` check. This is equivalent because `resolveCanonicalBatterData` correctly sets `data.isProspect`.
- **Step 5 always clears projPa** — For batters, both prospects and non-prospects get `projPa = undefined`. Downstream code at line 532 recomputes from MLB history. `computeBatterProjection` also has its own fallback.

## Recommended Next Steps

1. ✅ **Trace player 11813** — done. Confirmed root cause: scouting potential blend in TR.
2. ✅ **Remove scouting potential blend from TR** — done. TR is now purely stats-driven.
3. **Identify the 71 PA player** and trace their PA computation (still unknown which player)
4. **Write invariant tests** for the resolve functions (was planned but deferred to fix crashes)
5. **Consider same fix for pitcher TR** (`TrueRatingsCalculationService.ts` Step 3) — pitcher scouting ratings (stuff, control, hra) are also potential, same architectural problem exists there. `SCOUTING_BLEND_CONFIDENCE_IP = 60` means at 20 IP, pitcher TR is 75% scouting potential.
