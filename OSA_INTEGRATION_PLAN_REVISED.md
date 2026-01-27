# OSA Integration Plan - REVISED
## Comparison Tool, Not Automatic Fallback

## Executive Summary

**Key Decision:** Do NOT use OSA data in projections automatically. Instead, set up infrastructure to:
1. Display OSA opinions alongside user scout opinions in UI
2. Allow users to toggle between sources for viewing
3. Keep projection calculations using only 'my' scout data
4. Enable future analysis to determine which source (scout, OSA, or stats) is most accurate

**Philosophy:** "Trust but verify" - let the data prove which source is better before baking it into calculations.

---

## Revised Implementation Strategy

### What We're Building

**A. Dual Display System**
- Show both 'my' and 'osa' scout opinions side-by-side in UI
- Three columns: True Ratings (stats) | My Scout | OSA
- When only one source exists, show placeholder for missing source

**B. User Source Toggle**
- Allow users to switch between viewing:
  - "My Scout" (default)
  - "OSA"
  - "Both" (side-by-side comparison)
- Toggle stored in user preferences
- Affects display only, not calculations

**C. Calculations Stay 'My'-Only**
- ProjectionService continues using only 'my' scout data
- No OSA fallback in role classification
- No OSA data in True Future Rating calculations
- Stats-based projections work when no 'my' data exists

**D. Analysis Hooks for Future**
- Track which source was used for each calculation
- Store metadata to enable retrospective analysis
- When we have 2+ years of data, can compare:
  - My Scout projections vs actuals
  - OSA projections vs actuals
  - Stats-only projections vs actuals
- Determine winner empirically

---

## UI Changes

### 1. PlayerRatingsCard - Three-Column Comparison

**Current:**
```
True Ratings  vs  Scout Opinions
   [bars]            [bars]
```

**New (when both sources exist):**
```
True Ratings  vs  My Scout  vs  OSA
   [bars]         [bars]      [bars]
```

**New (when only one source exists):**
```
True Ratings  vs  My Scout  vs  OSA
   [bars]         [bars]       [?]
                              (no data)
```

### 2. Source Toggle (Global Preference)

**Location:** Data Management page, or as floating toggle on pages with scout data

**Options:**
- ⚪ My Scout Only (default)
- ⚪ OSA Only
- ⚪ Both (side-by-side)

**Behavior:**
- "My Scout Only": Show only 'my' column, hide OSA column
- "OSA Only": Show only 'osa' column, hide My Scout column
- "Both": Show both columns side-by-side (three-column layout)

**Storage:** Save to `localStorage` under `wbl-prefs` (existing preferences object)

### 3. Data Source Indicators

**Subtle badges (as requested):**
- Small badge next to column header: `[MY]` or `[OSA]`
- Tooltip on hover: "My Scout (Joe Smith, Accuracy: 45)" or "OSA (OOTP Scouting Agency)"
- If scout has accuracy rating in data, show it

### 4. Missing Data Messaging

**Scenario A: User has uploaded 'my' data, viewing player with 'my' data**
- Show: True Ratings vs My Scout (normal)
- OSA column: hidden (unless "Both" mode)

**Scenario B: User has uploaded 'my' data, viewing player WITHOUT 'my' data**
- Show: True Ratings only
- My Scout column: "No scout report for this player"
- OSA column: Show OSA if exists, otherwise "No OSA report"

**Scenario C: User has NO 'my' data uploaded**
- Show banner: "Upload your scout reports to see scouting-based projections"
- Link to Data Management
- OSA column: Show if exists (in "OSA Only" or "Both" mode)

---

## Technical Implementation

### Phase 1: Extend PlayerRatingsCard Interface (1 hour)

**Update `PlayerRatingsData` interface:**
```typescript
export interface PlayerRatingsData {
  // Existing fields...

  // My Scout data (existing)
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
  scoutStamina?: number;
  scoutInjuryProneness?: string;
  scoutOvr?: number;
  scoutPot?: number;

  // NEW: OSA data (parallel structure)
  osaStuff?: number;
  osaControl?: number;
  osaHra?: number;
  osaStamina?: number;
  osaInjuryProneness?: string;
  osaOvr?: number;
  osaPot?: number;

  // Pitches can come from either source
  pitchCount?: number;
  pitches?: string[];
  pitchRatings?: Record<string, number>;
  pitchSource?: 'my' | 'osa';  // NEW: which source provided pitches
}
```

### Phase 2: Create UserPreferencesService (1 hour)

**File:** `src/services/UserPreferencesService.ts`

```typescript
type ScoutingDisplayMode = 'my' | 'osa' | 'both';

interface UserPreferences {
  hideUploadInstructions?: boolean;
  hidePitchChips?: boolean;
  scoutingDisplayMode?: ScoutingDisplayMode;  // NEW
}

class UserPreferencesService {
  getScoutingDisplayMode(): ScoutingDisplayMode {
    const prefs = this.loadPreferences();
    return prefs.scoutingDisplayMode ?? 'my';  // Default to 'my'
  }

  setScoutingDisplayMode(mode: ScoutingDisplayMode): void {
    const prefs = this.loadPreferences();
    prefs.scoutingDisplayMode = mode;
    this.savePreferences(prefs);
  }

  // Emit event when preferences change (for live UI updates)
  onChange(callback: (prefs: UserPreferences) => void): void;
}
```

### Phase 3: Update PlayerRatingsCard Rendering (2-3 hours)

**New Methods:**

```typescript
static renderRatingsComparisonThreeColumn(
  data: PlayerRatingsData,
  hasMyScout: boolean,
  hasOsa: boolean,
  displayMode: ScoutingDisplayMode
): string {
  // Three-column layout: True Ratings | My Scout | OSA
  // Hide columns based on displayMode
  // Show placeholders for missing data
}

static renderRatingBarThreeColumn(
  label: string,
  estimated?: number,
  myScout?: number,
  osa?: number,
  displayMode: ScoutingDisplayMode
): string {
  // Three bars side-by-side
  // Visual diff indicators between all three
}
```

**CSS for three-column layout:**
```css
.ratings-comparison.three-column {
  grid-template-columns: 1fr 1fr 1fr 0.3fr; /* TR, My, OSA, Diff */
}

.ratings-comparison.hide-osa {
  grid-template-columns: 1fr 1fr 0.3fr; /* Hide OSA column */
}

.ratings-comparison.hide-my {
  grid-template-columns: 1fr 1fr 0.3fr; /* Hide My column */
}
```

### Phase 4: Update Data Fetching in Views (2-3 hours)

**Pattern for all views:**

```typescript
// Fetch both sources in parallel
const [myScoutingRatings, osaRatings] = await Promise.all([
  scoutingDataService.getLatestScoutingRatings('my'),
  scoutingDataService.getLatestScoutingRatings('osa')
]);

// Build lookup maps for both
const myScoutMap = new Map(myScoutingRatings.map(s => [s.playerId, s]));
const osaScoutMap = new Map(osaRatings.map(s => [s.playerId, s]));

// When rendering player, populate both fields:
const playerData: PlayerRatingsData = {
  // ... existing fields
  scoutStuff: myScoutMap.get(playerId)?.stuff,
  scoutControl: myScoutMap.get(playerId)?.control,
  scoutHra: myScoutMap.get(playerId)?.hra,

  osaStuff: osaScoutMap.get(playerId)?.stuff,
  osaControl: osaScoutMap.get(playerId)?.control,
  osaHra: osaScoutMap.get(playerId)?.hra,

  // Prefer 'my' for pitches, fall back to 'osa' for display purposes only
  pitches: myScoutMap.get(playerId)?.pitches ?? osaScoutMap.get(playerId)?.pitches,
  pitchSource: myScoutMap.get(playerId)?.pitches ? 'my' : 'osa'
};
```

**Files to modify:**
- `StatsView.ts` - Player search results
- `TrueRatingsView.ts` - True Ratings table
- `ProjectionsView.ts` - Projections table
- `TeamRatingsView.ts` - Team ratings modals
- `GlobalSearchBar.ts` - Search results
- `PlayerProfileModal.ts` - Player detail modal

### Phase 5: Add Source Toggle UI (1-2 hours)

**Location Option A: Data Management Page**
```html
<div class="preference-section">
  <h3>Scouting Data Display</h3>
  <p>Choose which scouting source to display in player profiles:</p>

  <label>
    <input type="radio" name="scoutDisplay" value="my" checked>
    My Scout Only (projections use this)
  </label>

  <label>
    <input type="radio" name="scoutDisplay" value="osa">
    OSA Only (for comparison)
  </label>

  <label>
    <input type="radio" name="scoutDisplay" value="both">
    Both (side-by-side comparison)
  </label>
</div>
```

**Location Option B: Floating Toggle on Scout-Heavy Pages**
```html
<!-- Top-right of TrueRatingsView, ProjectionsView -->
<div class="scout-display-toggle">
  <label>Scout Display:</label>
  <select id="scoutDisplayMode">
    <option value="my">My Scout</option>
    <option value="osa">OSA</option>
    <option value="both">Both</option>
  </select>
</div>
```

**Recommendation:** Option A (Data Management) for initial version, Option B later if users request it.

### Phase 6: Projections Stay 'My'-Only (NO CHANGES)

**Files that do NOT change:**
- `ProjectionService.ts` - Keep using `getLatestScoutingRatings('my')`
- `TrueFutureRatingService.ts` - Keep using 'my' source parameter
- `TeamRatingsService.ts` - Keep using 'my'
- `TrueRatingsCalculationService.ts` - No OSA integration

**Messaging:**
- Add banner on Projections page: "Projections use My Scout data only. OSA shown for comparison."
- If no 'my' data, show: "Upload scout reports to enable projection calculations."

---

## User Messaging

### Scenario 1: User has uploaded both 'my' and 'osa' data

**Projections Page Banner:**
```
📊 Projections use My Scout data
OSA data shown for comparison. Switch display mode in Data Management.
```

**Player Modal:**
```
[True Ratings]  [My Scout]  [OSA]
    3.5            55          60
```
(User can see both, but projections use 'my')

### Scenario 2: User has uploaded only 'osa' data

**Projections Page Banner:**
```
ℹ️ Projections require My Scout data
You've uploaded OSA data, which is displayed for reference.
Upload your scout reports to calculate projections.

[Manage Data →]
```

### Scenario 3: User viewing in "OSA Only" mode

**Banner:**
```
⚠️ Viewing OSA data
Projections still use My Scout data. This is display mode only.
```

### Scenario 4: Player exists in 'my' but not 'osa'

**OSA Column:**
```
[OSA]
  —
  (No OSA report)
```

---

## Analysis Infrastructure (Future Work)

### What to Track Now

**Add metadata to projection results:**
```typescript
interface ProjectedPlayer {
  // ... existing fields

  // NEW: Track data sources used
  metadata?: {
    usedMyScout: boolean;
    usedOsa: boolean;  // Future: when we add OSA to calculations
    usedStatsOnly: boolean;
    scoutAccuracy?: number;  // If available from scout data
  };
}
```

**Why:** When we have 2+ years of data, we can run analysis:
```sql
-- Pseudocode for future analysis
Compare projection accuracy:
- Players projected with 'my' scout → MAE vs actuals
- Players projected with 'osa' scout → MAE vs actuals
- Players projected with stats only → MAE vs actuals

Determine winner:
- Which source has lowest MAE?
- Does scout accuracy rating correlate with projection accuracy?
- Are there player types where one source is better?
```

### Future Analysis Service (Not Built Yet)

**File:** `src/services/ProjectionAnalysisService.ts` (already exists!)

**New Method:**
```typescript
async compareScoutSources(
  startYear: number,
  endYear: number
): Promise<{
  myScoutAccuracy: { mae: number; bias: number; n: number };
  osaAccuracy: { mae: number; bias: number; n: number };
  statsOnlyAccuracy: { mae: number; bias: number; n: number };
  recommendation: 'my' | 'osa' | 'stats';
}> {
  // Compare projection performance across sources
  // Requires 2+ years of historical projections + actuals
}
```

**Not implemented now, but infrastructure in place to build it later.**

---

## Implementation Phases

### Phase 1: Foundation (2-3 hours)
- [ ] Create UserPreferencesService with scoutingDisplayMode
- [ ] Extend PlayerRatingsData interface with OSA fields
- [ ] Update localStorage preferences schema

### Phase 2: UI Components (3-4 hours)
- [ ] Update PlayerRatingsCard to support three-column layout
- [ ] Add CSS for three-column grid
- [ ] Implement column hiding based on display mode
- [ ] Add source badges (subtle)

### Phase 3: Data Fetching (2-3 hours)
- [ ] Update 6 view files to fetch both 'my' and 'osa' in parallel
- [ ] Populate both scout fields in PlayerRatingsData
- [ ] Ensure pitches fall back to 'osa' for display (but not calculations)

### Phase 4: User Controls (1-2 hours)
- [ ] Add source toggle to Data Management page
- [ ] Wire up toggle to UserPreferencesService
- [ ] Emit events to update live UI when preference changes

### Phase 5: Messaging (1 hour)
- [ ] Add banners explaining projections use 'my' only
- [ ] Add tooltips for source badges
- [ ] Add "No OSA report" placeholders

### Phase 6: Testing (2 hours)
- [ ] Test with only 'my' data (should work as before)
- [ ] Test with only 'osa' data (show OSA, disable projections)
- [ ] Test with both sources (show side-by-side)
- [ ] Test toggle switching between modes
- [ ] Verify projections still use 'my' only

**Total Estimated Time: 11-15 hours**

---

## What We're NOT Doing (Yet)

❌ **OSA fallback in projections** - Wait for data-driven proof
❌ **OSA-based True Future Ratings** - Keep using 'my' only
❌ **OSA-based role classification (pitches)** - 'my' only for calculations
❌ **Automatic source selection** - User explicitly chooses display mode
❌ **Scout source comparison analysis** - Need 2+ years of data first

---

## Future Decision Points

### When to Revisit Using OSA in Projections

**Trigger:** After 2+ seasons of data collection (e.g., 2021-2022 actuals available)

**Analysis to Run:**
1. Compare My Scout projection accuracy vs actuals (FIP MAE, K/9 MAE, etc.)
2. Compare OSA projection accuracy vs actuals
3. Compare stats-only projection accuracy
4. Segment by player type (prospects, veterans, etc.)

**Decision Criteria:**
- If OSA has significantly lower MAE (e.g., >0.3 FIP difference), consider using OSA
- If My Scout is better, keep current approach
- If stats-only is competitive, question whether scouting adds value at all

**Implementation Path if OSA Wins:**
- Add OSA fallback to ProjectionService (1-2 hours)
- Add user preference: "Use OSA when My Scout unavailable?" (1 hour)
- Update messaging to reflect new behavior (1 hour)

---

## Files to Create/Modify

### New Files
- `src/services/UserPreferencesService.ts` (centralize preferences)
- `OSA_INTEGRATION_PLAN_REVISED.md` (this document)

### Files to Modify

**Services (minimal changes):**
- No changes to ProjectionService, TrueFutureRatingService, etc.
- Only change: fetching both sources in views

**Views (fetch both sources, display based on mode):**
- `src/views/StatsView.ts`
- `src/views/TrueRatingsView.ts`
- `src/views/ProjectionsView.ts`
- `src/views/TeamRatingsView.ts`
- `src/views/GlobalSearchBar.ts`
- `src/views/PlayerProfileModal.ts`
- `src/views/DataManagementView.ts` (add toggle)

**Components:**
- `src/views/PlayerRatingsCard.ts` (major update: three-column layout)

**CSS:**
- `src/styles.css` (three-column grid, source badges)

---

## Success Criteria

### Functional
- [ ] Users can upload both 'my' and 'osa' data
- [ ] Users can toggle display mode (my / osa / both)
- [ ] Three-column comparison shows when "both" mode selected
- [ ] Projections continue using 'my' data only
- [ ] OSA data displayed correctly when available
- [ ] Placeholders shown when source missing

### User Experience
- [ ] Clear messaging: projections use 'my', OSA is for comparison
- [ ] Source badges are subtle but visible
- [ ] Toggle is intuitive and easy to find
- [ ] No breaking changes for existing 'my'-only users

### Future-Proofing
- [ ] Infrastructure in place to add OSA to calculations later
- [ ] Metadata tracked to enable future analysis
- [ ] Easy to run source comparison when 2+ years of data available

---

## Questions for Product Owner (ANSWERED)

1. ✅ **Field-level vs Player-level merge:** Player-level (simpler)
2. ✅ **Source badge visibility:** Subtle, with toggle when both exist
3. ✅ **Use OSA in projections?** NO - wait for data-driven proof

---

## Next Steps

**Recommended Approach:**
1. Review this revised plan
2. Confirm you agree with "display only, no projection changes" approach
3. I'll implement Phase 1-6 in order
4. Ship and collect data for 1-2 seasons
5. Revisit OSA projection usage with empirical evidence

**Want me to proceed with implementation?**

---

**Document Version:** 2.0 (REVISED)
**Date:** 2026-01-27
**Author:** Claude Code Analysis
**Status:** Awaiting approval to implement
