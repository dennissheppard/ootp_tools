# OSA Scouting Data Integration Plan

## Executive Summary

This document outlines the implementation plan for integrating OSA (OOTP Scouting Agency) data into the True Ratings app, including fallback strategies, UI changes, and user messaging.

**Key Context:**
- App works for stat-based True Ratings without OSA or Scouting data
- OSA/Scouting provides pitches data (essential for position classification in projections)
- Cannot project prospects or rate them without OSA or Scout opinions
- Upload and storage infrastructure already exists for both 'my' and 'osa' sources

---

## Current State Analysis

### What's Already Built ✓

1. **Storage Layer (ScoutingDataService.ts)**
   - Fully parameterized with `source: 'my' | 'osa'` parameter
   - Separate IndexedDB storage buckets per source
   - Methods: `parseScoutingCsv()`, `saveScoutingRatings()`, `getScoutingRatings()`, `getLatestScoutingRatings()`
   - TrueFutureRatingService already supports source parameter

2. **Data Upload UI (DataManagementView.ts)**
   - Source selection toggle ('my' vs 'osa')
   - CSV parsing with both sources
   - Upload and management for both sources

3. **Data Model (ScoutingData.ts)**
   - `PitcherScoutingRatings` interface includes optional `source?: 'my' | 'osa'` field

### What's Missing ✗

1. **Hardcoded 'my' Source Everywhere**
   - All callers use `getLatestScoutingRatings('my')` with no fallback
   - Files affected:
     - `ProjectionService.ts` (lines 89, 487)
     - `TrueRatingsView.ts` (line 1812)
     - `StatsView.ts` (line 274)
     - `TeamRatingsView.ts` (line 1015)
     - `GlobalSearchBar.ts` (line 268)
     - `ProjectionsView.ts` (line 1061)
     - `TeamRatingsService.ts` (line 235)

2. **No Fallback/Merge Logic**
   - When 'my' data is empty, OSA data is ignored
   - No strategy for handling both sources existing for the same player
   - No per-player fallback (e.g., player A from 'my', player B from 'osa')

3. **No UI Source Indicators**
   - PlayerRatingsCard doesn't show whether data is from 'my' or 'osa'
   - Users can't tell which source is being used
   - No visual distinction between scout sources

4. **No User Messaging**
   - No clear communication about data requirements for prospects
   - No guidance on when OSA vs 'my' data is being used
   - No warnings when pitches data is missing for projections

---

## Implementation Strategy

### A. How to Use OSA Data with Projections

**Recommended Approach: Intelligent Fallback with Per-Player Merge**

Create a new `ScoutingDataMergeService` that implements:

```typescript
interface MergedScoutingResult {
  ratings: PitcherScoutingRatings[];
  metadata: {
    totalPlayers: number;
    fromMyScout: number;
    fromOSA: number;
    fromBoth: number; // Player exists in both sources
  };
}

async getMergedScoutingRatings(year?: number): Promise<MergedScoutingResult> {
  // 1. Try to load 'my' scout data
  // 2. Try to load 'osa' data
  // 3. Merge with preference strategy:
  //    - If player exists in 'my', use 'my' (user's scout takes priority)
  //    - If player only in 'osa', use 'osa' (fallback)
  //    - Track metadata for UI display
}
```

**Why This Approach:**
- ✓ User's scout data takes priority (respects custom scouting work)
- ✓ OSA fills gaps for players not scouted by user
- ✓ Maximizes data availability for projections
- ✓ Transparent: metadata shows which source is used
- ✓ Backward compatible: works with existing 'my'-only users

**Alternative Considered: User Toggle**
- Allow users to choose 'my' OR 'osa' OR 'merged'
- **Rejected:** Adds UI complexity, most users want "best available data"

---

### B. How to Display OSA Opinions in UI

**1. Source Badge Indicator**

Update `PlayerRatingsData` interface:
```typescript
export interface PlayerRatingsData {
  // ... existing fields
  scoutSource?: 'my' | 'osa';  // NEW: which source provided this data
}
```

Update `PlayerRatingsCard.renderRatingsComparison()`:
```typescript
// In bar headers
<span class="bar-header">
  Scout Opinions
  ${data.scoutSource === 'osa' ? '<span class="source-badge osa">OSA</span>' : ''}
  ${data.scoutSource === 'my' ? '<span class="source-badge my">MY</span>' : ''}
</span>
```

**CSS for badges:**
```css
.source-badge {
  font-size: 0.7em;
  padding: 2px 4px;
  border-radius: 3px;
  margin-left: 4px;
}
.source-badge.my {
  background: #4a9eff;
  color: white;
}
.source-badge.osa {
  background: #ff9f43;
  color: white;
}
```

**2. Metadata Display in Projections/True Ratings Views**

Add summary banner showing data source breakdown:
```html
<div class="scouting-data-summary">
  📊 Scouting Data: 1,234 players (850 My Scout, 384 OSA)
</div>
```

**3. Player-Level Indicators**

- Show small badge/icon next to player name indicating source
- Tooltip on hover: "Scouting data from OSA" or "Scouting data from My Scout"

---

### C. Fallback Strategy

**Fallback Logic (Priority Order):**

```typescript
For each player:
  1. Try 'my' scout data by player ID
  2. Try 'my' scout data by normalized name (if ID match fails)
  3. Try 'osa' data by player ID
  4. Try 'osa' data by normalized name
  5. Use stats-based estimates only (no scouting)
```

**Pitches Data for Role Classification:**

Currently used in `ProjectionService.calculateProjectedIp()`:
- Check if player has 3+ usable pitches (rating > 25) AND stamina >= 35 → Starter
- **Fallback:** Accept pitches from either 'my' or 'osa' (same merge logic)
- If no pitches data from either source, fall back to GS history

**For Prospects (True Future Rating):**

Currently `TrueFutureRatingService` already supports source parameter:
```typescript
await trueFutureRatingService.getProspectTrueFutureRatings(2021, 'my');
```

**Update to use merged data:**
```typescript
const mergedData = await scoutingMergeService.getMergedScoutingRatings(2021);
// Use merged data instead of single source
```

---

## User Messaging Strategy

### Scenario 1: No Scouting Data at All

**Where:** TrueRatingsView, ProjectionsView, PlayerRatingsCard

**Message:**
```
ℹ️ Scouting Data Required
- Stat-based True Ratings work without scouting data
- Prospect projections and True Future Ratings require scouting data
- Upload your scout reports or OSA data to enable prospect analysis

[Manage Scouting Data →]
```

### Scenario 2: Missing Pitches Data (Affects Position Classification)

**Where:** ProjectionsView when prospects can't be classified as SP

**Message:**
```
⚠️ Limited Projection Data
Some players lack pitch repertoire data (needed for SP/RP classification).
Upload scouting reports with pitch ratings for better projections.

[View Affected Players]
```

### Scenario 3: Using OSA Fallback

**Where:** Inline badge next to affected players

**Visual:**
```
John Doe  [OSA]
  ↑
  Badge indicating "Scouting data from OSA (My Scout data not available)"
```

### Scenario 4: Mixed Sources

**Where:** Summary banner at top of True Ratings / Projections page

**Message:**
```
📊 Scouting Data Active
1,234 players with scouting data (850 My Scout, 384 OSA)
Using My Scout where available, OSA as fallback.
```

---

## Implementation Plan

### Phase 1: Create Merge Service (2-3 hours)

**File:** `src/services/ScoutingDataMergeService.ts`

**Responsibilities:**
- Fetch both 'my' and 'osa' sources
- Merge with priority logic (my > osa)
- Track metadata (counts per source)
- Handle name-based fallback matching
- Cache merged results to avoid repeated fetches

**Key Methods:**
```typescript
class ScoutingDataMergeService {
  async getMergedScoutingRatings(year?: number): Promise<MergedScoutingResult>
  async getLatestMergedScoutingRatings(): Promise<MergedScoutingResult>

  // Helper: resolve player from either source
  resolvePlayer(
    playerId: number,
    playerName: string,
    myData: PitcherScoutingRatings[],
    osaData: PitcherScoutingRatings[]
  ): PitcherScoutingRatings | undefined
}
```

### Phase 2: Update Core Services (3-4 hours)

**Files to Modify:**
1. `ProjectionService.ts`
   - Replace `getLatestScoutingRatings('my')` with `getMergedScoutingRatings()`
   - Pass merged data to IP projection and role classification
   - Update buildLeagueIpDistribution to use merged data

2. `TrueRatingsCalculationService.ts`
   - Update to accept merged scouting data
   - Ensure source tracking propagates through calculations

3. `TrueFutureRatingService.ts`
   - Update to use merged data instead of single source
   - Maintain source attribution for UI display

4. `TeamRatingsService.ts`
   - Use merged scouting data for team calculations

**Common Pattern:**
```typescript
// BEFORE:
const scoutingRatings = await scoutingDataService.getLatestScoutingRatings('my');

// AFTER:
const mergedScouting = await scoutingDataMergeService.getLatestMergedScoutingRatings();
const scoutingRatings = mergedScouting.ratings;
// Store metadata for UI display
```

### Phase 3: Update UI Components (2-3 hours)

**1. PlayerRatingsCard.ts**
- Add `scoutSource?: 'my' | 'osa'` to `PlayerRatingsData` interface
- Update `renderRatingsComparison()` to show source badge
- Add tooltip for source explanation

**2. TrueRatingsView.ts**
- Add scouting data summary banner
- Show metadata (counts per source)
- Update player rows to include source badges

**3. StatsView.ts**
- Show source badge in player ratings section
- Update scouting data fetch to use merged service

**4. ProjectionsView.ts**
- Add scouting data summary
- Show source indicators in player list
- Add messaging for missing pitches data

**5. GlobalSearchBar.ts**
- Update to use merged scouting data
- Show source badge in search results

### Phase 4: User Messaging & Documentation (1-2 hours)

**1. Add Info Panels**
- Create reusable `InfoPanel` component for consistent messaging
- Show appropriate message based on data availability

**2. Update Data Management View**
- Add explanation of fallback logic
- Show which source is being used for each player (optional debug view)

**3. Add Tooltips**
- Explain source badges on hover
- Clarify fallback behavior

### Phase 5: Testing & Validation (2-3 hours)

**Test Scenarios:**
1. No scouting data uploaded → Should work for stat-based TR, show guidance for prospects
2. Only 'my' data uploaded → Should use 'my' data, no OSA fallback
3. Only 'osa' data uploaded → Should use OSA data for all players
4. Both sources uploaded:
   - Player in both → Should prefer 'my'
   - Player only in 'my' → Use 'my'
   - Player only in 'osa' → Use 'osa'
5. Pitches data in 'my' but not 'osa' → Should use 'my' pitches for role classification
6. Pitches data in 'osa' but not 'my' → Should fall back to 'osa' pitches
7. Name-based matching → Should correctly match players when ID is missing

**Validation:**
- Check projection accuracy isn't degraded
- Verify UI shows correct source badges
- Confirm metadata counts are accurate
- Test with real WBL data (if available)

---

## Technical Considerations

### Performance

**Caching Strategy:**
- Cache merged results in-memory during session
- Invalidate cache when new scouting data is uploaded
- Use same 24-hour cache strategy as existing services

**IndexedDB Batch Queries:**
- Fetch both sources in parallel: `Promise.all([getMy, getOsa])`
- Merge in-memory (fast, thousands of records in milliseconds)

### Backward Compatibility

**Existing Users (my-only data):**
- ✓ No breaking changes
- ✓ Merge service returns same data structure
- ✓ Works identically to current behavior

**Migration:**
- No data migration needed (storage format unchanged)
- Existing 'my' data continues to work
- OSA data can be added incrementally

### Edge Cases

**1. Player ID Mismatches**
- Use normalized name matching as fallback (already implemented)
- If both sources have same player with different IDs, prefer 'my'

**2. Conflicting Ratings**
- Always prefer 'my' (user's scout is authoritative)
- OSA only used when 'my' data is absent

**3. Partial Data**
- Player in 'my' with only Stuff/Control/HRA
- Player in 'osa' with full data (pitches, stamina, etc.)
- → Use 'my' ratings, lose additional 'osa' metadata
- **Alternative:** Merge at field level (use 'my' ratings, 'osa' pitches if missing)
  - More complex, but provides richer data
  - Requires field-level merge logic

**4. Year Mismatches**
- 'my' data for 2021, 'osa' data for 2020
- Only merge data from same year
- If year doesn't match, treat as "not available"

---

## Success Criteria

### Functional Requirements
- [ ] OSA data is used when 'my' data is unavailable
- [ ] 'my' data takes priority when both sources have a player
- [ ] Pitches data from either source enables position classification
- [ ] UI clearly shows which source is being used
- [ ] Prospect projections work with OSA data
- [ ] Metadata accurately reflects source breakdown

### User Experience Requirements
- [ ] No breaking changes for existing users
- [ ] Clear messaging when scouting data is required
- [ ] Source badges are visible but not intrusive
- [ ] Fallback behavior is transparent
- [ ] Upload process unchanged (already works)

### Performance Requirements
- [ ] Merge operation completes in <100ms (typical: 1000+ players)
- [ ] No noticeable slowdown in page loads
- [ ] Caching prevents repeated merge operations

---

## Future Enhancements (Out of Scope)

### Field-Level Merge
Instead of player-level priority, merge at field level:
- Use 'my' Stuff/Control/HRA ratings
- Use 'osa' pitches if 'my' lacks pitches
- Use 'osa' stamina if 'my' lacks stamina

**Benefits:** Richer data, better projections
**Cost:** More complex merge logic, potential confusion about data source

### User Source Preference Toggle
Allow users to choose:
- "Auto (My Scout > OSA)" (default)
- "My Scout Only"
- "OSA Only"
- "Manual per player"

**Benefits:** Power user control
**Cost:** UI complexity, confusion for new users

### Source Comparison View
Side-by-side comparison of 'my' vs 'osa' ratings for same player

**Benefits:** Scout accuracy assessment, data validation
**Cost:** Significant UI work, not a common use case

---

## Files to Create/Modify

### New Files
- `src/services/ScoutingDataMergeService.ts` (new service)
- `OSA_INTEGRATION_PLAN.md` (this document)

### Files to Modify

**Services:**
- `src/services/ProjectionService.ts` (replace hardcoded 'my' source)
- `src/services/TrueFutureRatingService.ts` (use merged data)
- `src/services/TeamRatingsService.ts` (use merged data)

**Views:**
- `src/views/TrueRatingsView.ts` (add summary banner, source badges)
- `src/views/StatsView.ts` (show source badge)
- `src/views/ProjectionsView.ts` (add metadata, messaging)
- `src/views/GlobalSearchBar.ts` (use merged data)
- `src/views/TeamRatingsView.ts` (use merged data)
- `src/views/PlayerProfileModal.ts` (show source badge)
- `src/views/DataManagementView.ts` (add explanation)

**Components:**
- `src/views/PlayerRatingsCard.ts` (add source badge, update interface)

**Models:**
- `src/models/ScoutingData.ts` (ensure source field is properly typed)

**CSS:**
- `src/styles.css` (add source badge styles)

---

## Estimated Timeline

| Phase | Tasks | Time |
|-------|-------|------|
| 1. Merge Service | Create ScoutingDataMergeService | 2-3 hours |
| 2. Core Services | Update 7 service files | 3-4 hours |
| 3. UI Components | Update 7 view files | 2-3 hours |
| 4. Messaging | Add info panels, tooltips | 1-2 hours |
| 5. Testing | Test all scenarios | 2-3 hours |
| **Total** | | **10-15 hours** |

**Recommendation:** Implement in order (Phase 1 → 5) to minimize rework.

---

## Questions for Product Owner

1. **Field-level vs Player-level merge:**
   - Should we use 'my' pitches but 'osa' stamina if 'my' lacks stamina?
   - Or strict player-level priority (all fields from 'my' or all from 'osa')?

2. **Source visibility:**
   - Should source badges be prominent or subtle?
   - Should users be able to filter by source (e.g., "show only OSA players")?

3. **Data upload workflow:**
   - Should we encourage users to upload both sources?
   - Or position OSA as "fallback only"?

4. **Prospect messaging:**
   - How strongly should we emphasize the requirement for scouting data?
   - Should we block certain features without scouting data, or just show warnings?

---

## Appendix: Current Code Locations

### Hardcoded 'my' Source Calls

| File | Line | Method | Call |
|------|------|--------|------|
| ProjectionService.ts | 89 | getProjectionsWithContext | getLatestScoutingRatings('my') |
| ProjectionService.ts | 487 | ensureDistributionsLoaded | getLatestScoutingRatings('my') |
| TrueRatingsView.ts | 1812 | loadYearData | getLatestScoutingRatings('my') |
| StatsView.ts | 274 | fetchScoutingRatingsForYear | getLatestScoutingRatings('my') |
| TeamRatingsView.ts | 1015 | openPlayerModal | getLatestScoutingRatings('my') |
| GlobalSearchBar.ts | 268 | handleSearchResults | getLatestScoutingRatings('my') |
| ProjectionsView.ts | 1061 | openPlayerModal | getLatestScoutingRatings('my') |
| TeamRatingsService.ts | 235 | calculateTeamRatings | getScoutingRatings(year, 'my') |

### Scouting Data Usage for Role Classification

| File | Lines | Purpose |
|------|-------|---------|
| ProjectionService.ts | 640-660 | Profile-based SP detection (3+ pitches, stamina >= 35) |
| ProjectionService.ts | 507-592 | buildLeagueIpDistribution (SP prospect detection) |
| PlayerProfileModal.ts | 322 | Modal SP role detection |

---

**Document Version:** 1.0
**Date:** 2026-01-27
**Author:** Claude Code Analysis
