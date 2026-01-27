# OSA Integration Plan - FINAL
## Fallback + Per-Modal Toggle

## Executive Summary

**Approach:** OSA as fallback when user has no 'my' scout data, with per-modal toggle to compare sources.

**Key Principles:**
1. **First-time user experience**: App works out-of-the-box with OSA data
2. **Priority**: My Scout > OSA > Stats-only (both display and calculations)
3. **Simple UI**: Keep two-column layout, add dropdown toggle on modal
4. **Let data decide**: After 2+ years, analyze which source is more accurate

---

## User Experience Flow

### Scenario 1: New User (No Scout Data Uploaded)

**Initial State:**
- User hasn't uploaded any 'my' scout data
- App checks for OSA data

**Behavior:**
- ✅ Projections use OSA data (enables TFR, role classification, etc.)
- ✅ UI shows "Scout Opinions (OSA)" with small badge
- ✅ App works immediately, no upload required
- ℹ️ Banner: "Using OSA scouting data. Upload your scout reports for custom scouting."

### Scenario 2: User Uploads 'My' Scout Data

**Initial State:**
- User uploads their scout reports
- Both 'my' and OSA data now exist

**Behavior:**
- ✅ Projections switch to using 'my' scout data (preferred)
- ✅ UI shows "Scout Opinions (My Scout)"
- ✅ Toggle appears: hover over label → dropdown shows "[My Scout ▼]"
- ✅ User can click to swap to OSA view (display only, doesn't affect calculations)

### Scenario 3: Player Exists in 'My' but Not OSA

**Behavior:**
- ✅ Show 'my' scout bars (normal)
- ✅ No toggle (only one source available)
- ✅ Projections use 'my' data

### Scenario 4: Player Exists in OSA but Not 'My'

**Behavior:**
- ✅ Show OSA scout bars with "(OSA)" badge
- ✅ No toggle (only one source available)
- ✅ Projections use OSA data for this player
- ℹ️ Subtle message: "No scout report for this player (using OSA)"

---

## Implementation Plan

### Phase 1: Create ScoutingDataFallbackService (2 hours)

**File:** `src/services/ScoutingDataFallbackService.ts`

**Purpose:** Intelligent per-player fallback logic

```typescript
interface ScoutingFallbackResult {
  ratings: PitcherScoutingRatings[];
  metadata: {
    totalPlayers: number;
    fromMyScout: number;
    fromOSA: number;
    hasMyScoutData: boolean;  // User has uploaded ANY 'my' data
  };
}

class ScoutingDataFallbackService {
  /**
   * Get scouting ratings with My Scout > OSA fallback
   * Returns per-player best available source
   */
  async getScoutingRatingsWithFallback(year?: number): Promise<ScoutingFallbackResult> {
    // 1. Load both sources in parallel
    const [myRatings, osaRatings] = await Promise.all([
      year ? scoutingDataService.getScoutingRatings(year, 'my')
           : scoutingDataService.getLatestScoutingRatings('my'),
      year ? scoutingDataService.getScoutingRatings(year, 'osa')
           : scoutingDataService.getLatestScoutingRatings('osa')
    ]);

    // 2. Build lookup maps
    const myMap = new Map<number, PitcherScoutingRatings>();
    const myNameMap = new Map<string, PitcherScoutingRatings[]>();

    myRatings.forEach(r => {
      if (r.playerId > 0) myMap.set(r.playerId, r);
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const list = myNameMap.get(norm) ?? [];
        list.push(r);
        myNameMap.set(norm, list);
      }
    });

    const osaMap = new Map<number, PitcherScoutingRatings>();
    const osaNameMap = new Map<string, PitcherScoutingRatings[]>();

    osaRatings.forEach(r => {
      if (r.playerId > 0) osaMap.set(r.playerId, r);
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const list = osaNameMap.get(norm) ?? [];
        list.push(r);
        osaNameMap.set(norm, list);
      }
    });

    // 3. Merge with priority: My Scout > OSA
    const merged: PitcherScoutingRatings[] = [];
    const processedIds = new Set<number>();
    let fromMyScout = 0;
    let fromOSA = 0;

    // Add all 'my' scout data first
    myRatings.forEach(r => {
      merged.push({ ...r, source: 'my' });
      if (r.playerId > 0) processedIds.add(r.playerId);
      fromMyScout++;
    });

    // Add OSA data only if not in 'my'
    osaRatings.forEach(r => {
      if (r.playerId > 0 && processedIds.has(r.playerId)) {
        return; // Skip: already have 'my' data for this player
      }

      // Check name-based duplicate (if 'my' has this name, skip OSA)
      if (r.playerName) {
        const norm = this.normalizeName(r.playerName);
        const myMatches = myNameMap.get(norm);
        if (myMatches && myMatches.length > 0) {
          return; // Skip: 'my' has this player by name
        }
      }

      merged.push({ ...r, source: 'osa' });
      fromOSA++;
    });

    return {
      ratings: merged,
      metadata: {
        totalPlayers: merged.length,
        fromMyScout,
        fromOSA,
        hasMyScoutData: myRatings.length > 0
      }
    };
  }

  /**
   * Get scouting for a specific player with fallback
   * Returns: { rating, source, hasAlternative }
   */
  async getPlayerScoutingWithFallback(
    playerId: number,
    playerName: string,
    year?: number
  ): Promise<{
    my: PitcherScoutingRatings | null;
    osa: PitcherScoutingRatings | null;
    active: PitcherScoutingRatings | null;
    activeSource: 'my' | 'osa' | null;
    hasAlternative: boolean;
  }> {
    const [myRatings, osaRatings] = await Promise.all([
      year ? scoutingDataService.getScoutingRatings(year, 'my')
           : scoutingDataService.getLatestScoutingRatings('my'),
      year ? scoutingDataService.getScoutingRatings(year, 'osa')
           : scoutingDataService.getLatestScoutingRatings('osa')
    ]);

    // Find player in both sources
    const my = this.findPlayer(playerId, playerName, myRatings);
    const osa = this.findPlayer(playerId, playerName, osaRatings);

    // Determine active source (my > osa)
    const active = my ?? osa;
    const activeSource = my ? 'my' : osa ? 'osa' : null;
    const hasAlternative = !!(my && osa); // Both exist

    return { my, osa, active, activeSource, hasAlternative };
  }

  private findPlayer(
    playerId: number,
    playerName: string,
    ratings: PitcherScoutingRatings[]
  ): PitcherScoutingRatings | null {
    // Try ID match first
    if (playerId > 0) {
      const byId = ratings.find(r => r.playerId === playerId);
      if (byId) return byId;
    }

    // Fall back to name match
    if (playerName) {
      const norm = this.normalizeName(playerName);
      const matches = ratings.filter(r => {
        if (!r.playerName) return false;
        return this.normalizeName(r.playerName) === norm;
      });
      if (matches.length === 1) return matches[0]; // Only if unique match
    }

    return null;
  }

  private normalizeName(name: string): string {
    const suffixes = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
    const cleaned = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(t => t && !suffixes.has(t));
    return tokens.join('');
  }
}

export const scoutingDataFallbackService = new ScoutingDataFallbackService();
```

### Phase 2: Update Core Services to Use Fallback (2-3 hours)

**Files to Modify:**

**1. ProjectionService.ts**
```typescript
// BEFORE (line 89):
const scoutingRatings = await scoutingDataService.getLatestScoutingRatings('my');

// AFTER:
const scoutingFallback = await scoutingDataFallbackService.getScoutingRatingsWithFallback();
const scoutingRatings = scoutingFallback.ratings;

// Store metadata for UI banner
if (!scoutingFallback.metadata.hasMyScoutData && scoutingFallback.metadata.fromOSA > 0) {
  console.log(`Using OSA fallback: ${scoutingFallback.metadata.fromOSA} players`);
}
```

**Repeat for:**
- ProjectionService.ts (line 487 - ensureDistributionsLoaded)
- TrueRatingsCalculationService.ts (if it directly fetches scouting)
- TrueFutureRatingService.ts (use fallback instead of single source)
- TeamRatingsService.ts (line 235)

**2. Update Views to Fetch Both Sources (for toggle functionality)**

**Pattern for views that show player modals:**
```typescript
// StatsView.ts, TrueRatingsView.ts, etc.

// Fetch both sources for toggle functionality
async fetchScoutingData(year?: number) {
  const fallback = await scoutingDataFallbackService.getScoutingRatingsWithFallback(year);

  // Store for use in rendering
  this.scoutingMetadata = fallback.metadata;

  // Build maps for both sources (for toggle)
  const [myRatings, osaRatings] = await Promise.all([
    year ? scoutingDataService.getScoutingRatings(year, 'my')
         : scoutingDataService.getLatestScoutingRatings('my'),
    year ? scoutingDataService.getScoutingRatings(year, 'osa')
         : scoutingDataService.getLatestScoutingRatings('osa')
  ]);

  this.myScoutMap = new Map(myRatings.map(r => [r.playerId, r]));
  this.osaScoutMap = new Map(osaRatings.map(r => [r.playerId, r]));
}
```

### Phase 3: Add Toggle to PlayerRatingsCard (2-3 hours)

**Update PlayerRatingsData interface:**
```typescript
export interface PlayerRatingsData {
  // Existing fields...

  // My Scout data (existing fields, keep as-is)
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
  scoutStamina?: number;
  scoutInjuryProneness?: string;
  scoutOvr?: number;
  scoutPot?: number;

  // NEW: OSA data (parallel structure for toggle)
  osaStuff?: number;
  osaControl?: number;
  osaHra?: number;
  osaStamina?: number;
  osaInjuryProneness?: string;
  osaOvr?: number;
  osaPot?: number;

  // Pitches (can come from either source)
  pitchCount?: number;
  pitches?: string[];
  pitchRatings?: Record<string, number>;

  // NEW: Toggle state
  activeScoutSource?: 'my' | 'osa';  // Which source is currently displayed
  hasMyScout?: boolean;               // Does 'my' data exist for this player?
  hasOsaScout?: boolean;              // Does 'osa' data exist for this player?
}
```

**Update renderRatingsComparison:**
```typescript
static renderRatingsComparison(data: PlayerRatingsData, hasScout: boolean): string {
  // Determine which scout data to display
  const activeSource = data.activeScoutSource ?? 'my'; // Default to 'my'
  const hasMyScout = data.hasMyScout ?? false;
  const hasOsaScout = data.hasOsaScout ?? false;
  const hasAlternative = hasMyScout && hasOsaScout;

  // Get active scout values based on toggle state
  const scoutStuff = activeSource === 'my' ? data.scoutStuff : data.osaStuff;
  const scoutControl = activeSource === 'my' ? data.scoutControl : data.osaControl;
  const scoutHra = activeSource === 'my' ? data.scoutHra : data.osaHra;

  // Build header with toggle (if both sources exist)
  const headerLabel = hasAlternative
    ? `<div class="scout-header-toggle">
         Scout Opinions
         <select class="scout-source-toggle" data-player-id="${data.playerId}">
           <option value="my" ${activeSource === 'my' ? 'selected' : ''}>My Scout</option>
           <option value="osa" ${activeSource === 'osa' ? 'selected' : ''}>OSA</option>
         </select>
       </div>`
    : `Scout Opinions <span class="source-badge ${activeSource}">${activeSource === 'my' ? 'MY' : 'OSA'}</span>`;

  if (hasScout) {
    return `
      <div class="ratings-comparison">
        <div class="rating-row rating-row-header">
          <span class="rating-label"></span>
          <div class="rating-bars">
            <span class="bar-header">True Ratings</span>
            <span class="bar-vs"></span>
            <span class="bar-header">${headerLabel}</span>
            <span class="rating-diff"></span>
          </div>
        </div>
        ${this.renderRatingBar('Stuff', data.estimatedStuff, scoutStuff)}
        ${this.renderRatingBar('Control', data.estimatedControl, scoutControl)}
        ${this.renderRatingBar('HRA', data.estimatedHra, scoutHra)}
      </div>
    `;
  }

  // No scout data at all
  return this.renderPlaceholderComparison(data);
}
```

**Add event listener for toggle:**
```typescript
// In modal or view rendering code
document.addEventListener('change', (e) => {
  const target = e.target as HTMLSelectElement;
  if (target.classList.contains('scout-source-toggle')) {
    const playerId = parseInt(target.dataset.playerId ?? '0');
    const newSource = target.value as 'my' | 'osa';

    // Re-render modal with new source
    this.updatePlayerModalSource(playerId, newSource);
  }
});
```

**CSS for toggle:**
```css
.scout-header-toggle {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.scout-source-toggle {
  font-size: 0.85em;
  padding: 2px 6px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  cursor: pointer;
}

.scout-source-toggle:hover {
  background: var(--bg-hover);
}

.source-badge {
  font-size: 0.7em;
  padding: 2px 5px;
  border-radius: 3px;
  font-weight: 600;
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

### Phase 4: Update Views to Populate Both Scout Fields (2 hours)

**Files to Update:**
- StatsView.ts
- TrueRatingsView.ts (if showing player cards)
- ProjectionsView.ts (modals)
- TeamRatingsView.ts (modals)
- PlayerProfileModal.ts

**Pattern:**
```typescript
// When building PlayerRatingsData for a player
const myScout = this.myScoutMap.get(playerId);
const osaScout = this.osaScoutMap.get(playerId);

const playerData: PlayerRatingsData = {
  playerId,
  playerName,
  // ... other fields

  // My Scout data
  scoutStuff: myScout?.stuff,
  scoutControl: myScout?.control,
  scoutHra: myScout?.hra,
  scoutStamina: myScout?.stamina,
  scoutInjuryProneness: myScout?.injuryProneness,
  scoutOvr: myScout?.ovr,
  scoutPot: myScout?.pot,

  // OSA data
  osaStuff: osaScout?.stuff,
  osaControl: osaScout?.control,
  osaHra: osaScout?.hra,
  osaStamina: osaScout?.stamina,
  osaInjuryProneness: osaScout?.injuryProneness,
  osaOvr: osaScout?.ovr,
  osaPot: osaScout?.pot,

  // Pitches: prefer 'my', fall back to 'osa' for display
  pitches: myScout?.pitches ?? osaScout?.pitches,
  pitchRatings: myScout?.pitches ? myScout.pitches : osaScout?.pitches,

  // Toggle state
  activeScoutSource: myScout ? 'my' : 'osa', // Default to 'my' if exists
  hasMyScout: !!myScout,
  hasOsaScout: !!osaScout
};
```

### Phase 5: Add User Messaging (1 hour)

**1. Banner on Projections/TrueRatings when using OSA fallback:**

```typescript
// In view render method
renderScoutingDataBanner(): string {
  if (!this.scoutingMetadata) return '';

  const { hasMyScoutData, fromOSA, fromMyScout } = this.scoutingMetadata;

  if (!hasMyScoutData && fromOSA > 0) {
    // Using OSA fallback
    return `
      <div class="info-banner osa-fallback">
        <span class="banner-icon">ℹ️</span>
        Using OSA scouting data (${fromOSA} players).
        <a href="#" class="banner-link" data-tab-target="tab-data-management">
          Upload your scout reports
        </a> for custom scouting.
      </div>
    `;
  }

  if (hasMyScoutData && fromOSA > 0) {
    // Using both sources
    return `
      <div class="info-banner mixed-sources">
        <span class="banner-icon">📊</span>
        ${fromMyScout} players from My Scout, ${fromOSA} from OSA.
      </div>
    `;
  }

  return ''; // Using 'my' only, no banner needed
}
```

**2. Tooltip on source badge:**
```html
<span class="source-badge osa" title="OSA scouting data (OOTP Scouting Agency)">OSA</span>
```

**3. Message when player only in OSA:**
```typescript
// In PlayerRatingsCard when hasOsaScout && !hasMyScout
<p class="scout-source-note">
  No scout report available. Using OSA data.
</p>
```

### Phase 6: Testing (2 hours)

**Test Scenarios:**

1. **Fresh user (no data uploaded)**
   - [ ] Upload OSA data
   - [ ] Projections work (use OSA for role classification, TFR, etc.)
   - [ ] UI shows "OSA" badges
   - [ ] Banner: "Using OSA scouting data. Upload your scout reports..."

2. **User uploads 'my' scout data**
   - [ ] Projections switch to using 'my'
   - [ ] UI shows "My Scout" by default
   - [ ] Toggle appears on players that exist in both sources
   - [ ] Clicking toggle swaps bars

3. **Player in 'my' but not OSA**
   - [ ] Show 'my' scout bars
   - [ ] No toggle (only one source)
   - [ ] Badge: "MY"

4. **Player in OSA but not 'my'**
   - [ ] Show OSA scout bars
   - [ ] No toggle
   - [ ] Badge: "OSA"
   - [ ] Subtle message: "No scout report (using OSA)"

5. **Player in both sources**
   - [ ] Default to 'my'
   - [ ] Toggle visible
   - [ ] Can swap to OSA view
   - [ ] Toggle state persists during session (not across page reload)

6. **Role classification (pitches)**
   - [ ] With 'my' pitches: use 'my' for SP detection
   - [ ] Without 'my' pitches, with OSA pitches: use OSA for SP detection
   - [ ] Verify IP projections work correctly

7. **True Future Rating**
   - [ ] Works with 'my' scout data
   - [ ] Works with OSA data (fallback)
   - [ ] Properly attributes source in UI

---

## Implementation Phases

| Phase | Task | Time |
|-------|------|------|
| 1 | Create ScoutingDataFallbackService | 2 hours |
| 2 | Update core services (projections, TFR, etc.) | 2-3 hours |
| 3 | Add toggle to PlayerRatingsCard | 2-3 hours |
| 4 | Update views to populate both scout fields | 2 hours |
| 5 | Add user messaging (banners, tooltips) | 1 hour |
| 6 | Testing all scenarios | 2 hours |
| **Total** | | **11-13 hours** |

---

## Files to Create/Modify

### New Files
- `src/services/ScoutingDataFallbackService.ts`

### Files to Modify

**Services:**
- `src/services/ProjectionService.ts` (2 locations: lines 89, 487)
- `src/services/TrueFutureRatingService.ts` (use fallback)
- `src/services/TeamRatingsService.ts` (line 235)

**Views:**
- `src/views/StatsView.ts` (fetch both, populate both fields)
- `src/views/TrueRatingsView.ts` (fetch both, add banner)
- `src/views/ProjectionsView.ts` (fetch both, add banner)
- `src/views/TeamRatingsView.ts` (fetch both)
- `src/views/PlayerProfileModal.ts` (populate both fields)
- `src/views/GlobalSearchBar.ts` (if showing scout data)

**Components:**
- `src/views/PlayerRatingsCard.ts` (add toggle, dual fields)

**CSS:**
- `src/styles.css` (toggle, badges, banners)

---

## Success Criteria

### Functional
- [ ] New users can use OSA data immediately (no 'my' upload required)
- [ ] Projections work with OSA fallback
- [ ] Users with 'my' data see 'my' by default
- [ ] Toggle works when both sources exist
- [ ] Toggle swaps bars correctly
- [ ] Source badges show correct source
- [ ] Banners appear when using OSA fallback

### User Experience
- [ ] First-time user: app works out-of-the-box with OSA
- [ ] Existing user: no breaking changes, 'my' data preferred
- [ ] Toggle is discoverable (visible when hovering header)
- [ ] Source is always clear (badge or toggle label)
- [ ] Messaging guides users to upload their scout data

### Performance
- [ ] Fetching both sources in parallel doesn't slow page loads
- [ ] Fallback service completes in <100ms (typical)
- [ ] Toggle swap is instant (no API call, just re-render)

---

## Future Analysis Path (Post-Implementation)

After 2+ seasons of data collection:

```typescript
// Run comparison analysis
const analysis = await projectionAnalysisService.compareScoutSources(2021, 2023);

console.log('My Scout Accuracy:', analysis.myScoutAccuracy);
console.log('OSA Accuracy:', analysis.osaAccuracy);
console.log('Stats-Only Accuracy:', analysis.statsOnlyAccuracy);
console.log('Recommendation:', analysis.recommendation);

// If OSA wins empirically, consider:
// - Making OSA the default (instead of 'my')
// - Showing OSA more prominently in UI
// - Adding automatic source selection based on accuracy
```

---

## Answers to Your Points

1. ✅ **OSA as fallback when no scouting**: YES - handles first-time users
2. ✅ **Toggle on player modal (hover over label)**: YES - simpler than global toggle
3. ✅ **No three-column layout**: YES - keep current two-column, toggle swaps source
4. ✅ **Priority: My Scout > OSA > Stats**: YES - in both display and calculations
5. ✅ **Wait for data to prove OSA's worth**: YES - toggle lets users compare, data decides later

---

## Next Steps

Ready to implement?

**Recommended order:**
1. Phase 1: Create fallback service (foundation)
2. Phase 2: Update services to use fallback (enable OSA in projections)
3. Phase 3-4: Add toggle UI (comparison functionality)
4. Phase 5: Add messaging (user guidance)
5. Phase 6: Test all scenarios

Should I proceed with implementation?

---

**Document Version:** 3.0 (FINAL)
**Date:** 2026-01-27
**Status:** Ready for implementation
