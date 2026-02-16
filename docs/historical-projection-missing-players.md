# Historical Projection Missing Players — Investigation & Fix Plan

## Problem

The batter projection analysis (Projections view, 2015-2020) shows only 5-11 batters per team-year, when there should be 12-17+. This causes:

- **Massive apparent under-projection** of batter team WAR (top quartile bias: -10.7 WAR)
- **Misleading compression diagnostics** — hard to separate real pipeline compression from missing data
- **Team Ratings page** missing batters for historical teams (confirmed: 2016 Sugar Kings missing 4 batters totaling 1100 PA)
- **Pitcher analysis** also affected but less severely (retired pitchers excluded)

## Root Cause

### Batter Projection Service is Roster-Driven (not Stats-Driven)

`BatterProjectionService.getProjectionsWithContext()` (`src/services/BatterProjectionService.ts:112-119`):

```typescript
const mlbBatters = allPlayers.filter((p: Player) => {
    if (p.retired) return false;           // ← Excludes anyone who retired since analysis year
    const team = teamMap.get(p.teamId);
    if (!team || team.parentTeamId !== 0) return false; // ← Must be on CURRENT MLB roster
    if (p.position === 1) return false;
    return true;
});
```

`playerService.getAllPlayers()` returns the **current** game state. For historical analysis (e.g., 2015), any batter who:
- **Retired** between 2015 and the current game year → excluded
- **Was demoted** to minors → excluded
- **Was released** → excluded
- **Moved to a non-MLB affiliate** → excluded

### Pitcher Projection Service is Stats-Driven (correct approach)

`ProjectionService.getProjectionsWithContext()` (`src/services/ProjectionService.ts:166-170`):

```typescript
const playerIds = new Set<number>();
multiYearStats.forEach((_stats, playerId) => playerIds.add(playerId));
pitchingStats.forEach(stat => playerIds.add(stat.player_id));
```

Builds the player pool from **stats records** — anyone who pitched gets considered, regardless of current roster status. This naturally includes historical players.

However, it still has a `retired` filter at line 201:
```typescript
if (!player || player.retired) continue;
```
This causes some data loss for pitchers too, but less severely since the initial pool is much larger.

### Impact Quantification

From the 2016 batting CSV: team_id groups have 12-17 batters with 100+ PA each. But analysis only shows 5-11 per team. Roughly **30-60% of historical batters are missing** from projections, depending on how far back the analysis year is from the current game year.

## Fix Plan

### 1. Make BatterProjectionService stats-driven

**File**: `src/services/BatterProjectionService.ts`

Change `getProjectionsWithContext()` to build the player pool from batting stats (like the pitcher service), not from the current roster.

**Current flow** (lines 105-157):
1. `allPlayers.filter(...)` → only current MLB non-retired batters
2. For each: get multi-year stats, skip if no stats
3. Build TR inputs

**New flow** (mirror pitcher service pattern from `ProjectionService.ts:166-190`):
1. Get batting stats for the year: `trueRatingsService.getTrueBattingStats(year)`
2. Build `playerIds` set from `multiYearStats` keys AND current-year batting stats `player_id`s
3. For each player ID: look up player info from `playerMap`, stats from `multiYearStats`, scouting from `scoutingMap`
4. Filter: skip if `position === 1` (pitcher) — use position from player record or stats record
5. Filter: skip if no stats AND no scouting data (same as pitcher service line 190)
6. Do NOT filter by `retired` or current team

Key considerations:
- `playerMap.get(playerId)` may return `undefined` for players no longer in the database. Need a fallback for name, position, and age — can derive from stats records
- Team assignment should come from the stats record's `team_id` (which reflects where they played that year), not from `player.teamId` (which is current team)
- Position should prefer the player record but fall back to the stats record's position field
- Age calculation needs the player's birth date. If the player record is missing, estimate from available data or skip the aging curve

### 2. Remove retired filter from pitcher projections

**File**: `src/services/ProjectionService.ts`, line 201

Change:
```typescript
if (!player || player.retired) continue;
```
To:
```typescript
if (!player) continue;  // Skip only if player record is completely gone
```

Or better: construct a minimal player record from stats data when the player lookup fails.

### 3. Remove retired filter from batter projections

Part of the refactor in step 1 — the new stats-driven approach simply shouldn't filter by `retired`.

### 4. Handle missing player records gracefully

For players who have stats but no entry in `playerService.getAllPlayers()` (truly purged from the database):
- Use `stat.playerName` for display name (stats records already have this from `fetchAndProcessStats`)
- Use `stat.position` for position
- Estimate age from the year (or use a default aging assumption)
- Use `stat.team_id` for team assignment

## Files to Modify

| File | Change |
|------|--------|
| `src/services/BatterProjectionService.ts` | Refactor `getProjectionsWithContext()` to be stats-driven |
| `src/services/ProjectionService.ts` | Remove `player.retired` filter (line 201) |

## Verification

After the fix:
1. Run batter projection analysis for 2015-2020
2. Player counts per team should jump from 5-11 to 12-17+
3. Team WAR totals (both projected and actual) should be much closer to standings data
4. Re-evaluate compression metrics — the "under-projection" bias should shrink dramatically
5. Check Team Ratings page for 2016 Sugar Kings — should show the previously missing batters
6. Run pitcher analysis — verify no regression, possibly improved player counts

## Also Fixed This Session

**Bundled MLB batting data loader** (`src/services/TrueRatingsService.ts`):
- Added `loadDefaultMlbBattingData()` mirroring the existing `loadDefaultMlbData()` for pitching
- Wired into `DataManagementView.ts` onboarding
- This was a real gap (batting CSVs existed but were never loaded into the TrueRatingsService cache), but wasn't the cause of the missing players since the data had been accumulated from API calls

**Team WAR Compression Diagnostics** (`src/views/ProjectionsView.ts`):
- Added compression analysis section to both pitcher and batter analysis panels
- Shows regression slope, R², MAE, quartile biases, and optional WAR→Wins metrics
- This is what surfaced the missing players issue
