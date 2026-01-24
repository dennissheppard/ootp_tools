# Player Profile Card - Implementation Plan

## Overview

Add a clickable player profile modal to the True Ratings page. When a user clicks on a pitcher's name, a modal overlay displays:

1. **Header**: Player name with True Rating badge
2. **Ratings Comparison**: Visual bar chart comparing estimated ratings vs scout ratings
3. **Stats History**: Year-by-year stats table (IP, ERA, K/9, BB/9, HR/9, WAR)

Batters are not clickable in this phase.

---

## Phase 1: Data Layer

### Step 1.1: Extend TrueRatingsService for Single-Player Stats

**File:** `src/services/TrueRatingsService.ts`

Add method to get a single player's multi-year stats with full detail:

```ts
interface PlayerYearlyDetail {
  year: number;
  ip: number;
  era: number;
  k9: number;
  bb9: number;
  hr9: number;
  war: number;
}

async getPlayerYearlyStats(
  playerId: number,
  endYear: number,
  yearsBack: number = 5
): Promise<PlayerYearlyDetail[]>
```

**Logic:**
1. Check in-memory cache for each year's full stats (`getTruePitchingStats`)
2. Filter to the specific `player_id`
3. Calculate derived rates (ERA, K/9, BB/9, HR/9) from raw counts
4. If player not found in cached years, fall back to `StatsService.getPitchingStats(playerId)`

**Why this approach:**
- Leverages existing 24-hour localStorage cache
- No extra API calls if data is already loaded
- Fallback ensures we always have data

---

## Phase 2: Modal Component

### Step 2.1: Create PlayerProfileModal

**File:** `src/views/PlayerProfileModal.ts` (new)

```ts
interface PlayerProfileData {
  playerId: number;
  playerName: string;
  // True Ratings data (from table row)
  trueRating?: number;
  percentile?: number;
  estimatedStuff?: number;
  estimatedControl?: number;
  estimatedHra?: number;
  // Scout data (if available)
  scoutStuff?: number;
  scoutControl?: number;
  scoutHra?: number;
}

class PlayerProfileModal {
  private overlay: HTMLElement;

  constructor();

  async show(data: PlayerProfileData, selectedYear: number): Promise<void>;
  hide(): void;

  private renderHeader(data: PlayerProfileData): string;
  private renderRatingsComparison(data: PlayerProfileData): string;
  private renderRatingBar(label: string, estimated: number, scout?: number): string;
  private renderEstimatedOnlyBar(label: string, estimated: number): string;
  private hasScoutingData(data: PlayerProfileData): boolean;
  private renderStatsTable(stats: PlayerYearlyDetail[]): string;
}
```

**Conditional Rendering Logic:**
```ts
private renderRatingsComparison(data: PlayerProfileData): string {
  const hasScout = this.hasScoutingData(data);

  if (hasScout) {
    // Render side-by-side comparison bars
    return `
      <div class="ratings-comparison">
        <h4 class="section-label">Rating Breakdown</h4>
        ${this.renderRatingBar('Stuff', data.estimatedStuff, data.scoutStuff)}
        ${this.renderRatingBar('Control', data.estimatedControl, data.scoutControl)}
        ${this.renderRatingBar('HRA', data.estimatedHra, data.scoutHra)}
      </div>
    `;
  } else {
    // Render estimated-only bars with notice
    return `
      <div class="ratings-comparison no-scout-data">
        <h4 class="section-label">Estimated Ratings</h4>
        <p class="no-scout-notice">No scouting data available for this player</p>
        ${this.renderEstimatedOnlyBar('Stuff', data.estimatedStuff)}
        ${this.renderEstimatedOnlyBar('Control', data.estimatedControl)}
        ${this.renderEstimatedOnlyBar('HRA', data.estimatedHra)}
      </div>
    `;
  }
}

private hasScoutingData(data: PlayerProfileData): boolean {
  return data.scoutStuff !== undefined
      && data.scoutControl !== undefined
      && data.scoutHra !== undefined;
}
```

### Step 2.2: Modal HTML Structure

**With Scouting Data:**
```html
<div class="modal-overlay player-profile-modal" aria-hidden="true">
  <div class="modal modal-lg">
    <div class="modal-header">
      <div class="profile-header">
        <h3 class="modal-title">Player Name</h3>
        <span class="badge rating-elite">4.5</span>
      </div>
      <button class="modal-close" aria-label="Close">×</button>
    </div>
    <div class="modal-body">
      <!-- Ratings Comparison Section -->
      <div class="ratings-comparison">
        <h4 class="section-label">Rating Breakdown</h4>
        <div class="rating-row">
          <span class="rating-label">Stuff</span>
          <div class="rating-bars">
            <div class="bar-container">
              <div class="bar bar-estimated" style="width: 65%"></div>
              <span class="bar-value">65</span>
            </div>
            <span class="bar-vs">vs</span>
            <div class="bar-container">
              <div class="bar bar-scout" style="width: 75%"></div>
              <span class="bar-value">75</span>
            </div>
            <span class="rating-diff diff-positive">+10</span>
          </div>
        </div>
        <!-- Repeat for Control, HRA -->
      </div>

**Without Scouting Data:**
```html
      <!-- Ratings Section (no comparison) -->
      <div class="ratings-comparison no-scout-data">
        <h4 class="section-label">Estimated Ratings</h4>
        <p class="no-scout-notice">No scouting data uploaded for this player</p>
        <div class="rating-row">
          <span class="rating-label">Stuff</span>
          <div class="rating-bars single">
            <div class="bar-container">
              <div class="bar bar-estimated" style="width: 65%"></div>
              <span class="bar-value">65</span>
            </div>
          </div>
        </div>
        <!-- Repeat for Control, HRA -->
      </div>
```

      <!-- Stats History Section -->
      <div class="stats-history">
        <h4 class="section-label">Season Stats</h4>
        <div class="table-wrapper">
          <table class="stats-table">
            <thead>
              <tr>
                <th>Year</th>
                <th>IP</th>
                <th>ERA</th>
                <th>K/9</th>
                <th>BB/9</th>
                <th>HR/9</th>
                <th>WAR</th>
              </tr>
            </thead>
            <tbody>
              <!-- Rows -->
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</div>
```

---

## Phase 3: View Integration

### Step 3.1: Wire Up Click Handler in TrueRatingsView

**File:** `src/views/TrueRatingsView.ts`

**Changes:**

1. Import and instantiate `PlayerProfileModal`
2. In `renderPitcherTable()`, make player name cells clickable (only in pitcher mode)
3. Store row data in a lookup map by `player_id` for quick retrieval on click
4. On click:
   - Get row data from lookup
   - Get matched scouting data (if any)
   - Call `playerProfileModal.show(data, this.selectedYear)`

```ts
// In renderPitcherTable, change name cell:
<td data-col-key="playerName">
  <button class="btn-link player-name-link" data-player-id="${player.player_id}">
    ${player.playerName}
  </button>
</td>
```

### Step 3.2: Bind Click Events

```ts
private bindPlayerNameClicks(): void {
  const links = this.container.querySelectorAll<HTMLButtonElement>('.player-name-link');
  links.forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger row selection
      const playerId = parseInt(link.dataset.playerId ?? '', 10);
      if (!playerId) return;
      this.openPlayerProfile(playerId);
    });
  });
}

private async openPlayerProfile(playerId: number): Promise<void> {
  const row = this.playerRowLookup.get(playerId);
  if (!row) return;

  const scouting = this.scoutingLookup?.byId.get(playerId);

  const profileData: PlayerProfileData = {
    playerId: row.player_id,
    playerName: row.playerName,
    trueRating: row.trueRating,
    percentile: row.percentile,
    estimatedStuff: row.estimatedStuff,
    estimatedControl: row.estimatedControl,
    estimatedHra: row.estimatedHra,
    scoutStuff: scouting?.stuff,
    scoutControl: scouting?.control,
    scoutHra: scouting?.hra,
  };

  await this.playerProfileModal.show(profileData, this.selectedYear);
}
```

---

## Phase 4: CSS Styling

**File:** `src/styles.css`

### 4.1: Modal Size Variant

```css
.modal-lg {
  width: min(640px, 95vw);
}
```

### 4.2: Profile Header

```css
.profile-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.profile-header .badge {
  font-size: 1rem;
  padding: 0.25rem 0.625rem;
}
```

### 4.3: Ratings Comparison Bars

```css
.ratings-comparison {
  margin-bottom: 1.5rem;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0 0 0.75rem 0;
}

.rating-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.rating-label {
  width: 60px;
  font-size: 0.875rem;
  font-weight: 500;
}

.rating-bars {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.bar-container {
  flex: 1;
  height: 20px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  position: relative;
  overflow: hidden;
}

.bar {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.bar-estimated {
  background: linear-gradient(90deg, var(--color-primary), rgba(29, 155, 240, 0.6));
}

.bar-scout {
  background: linear-gradient(90deg, var(--color-success), rgba(0, 186, 124, 0.6));
}

.bar-value {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
  font-weight: 600;
}

.bar-vs {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.rating-diff {
  width: 40px;
  text-align: right;
  font-size: 0.875rem;
  font-weight: 600;
}

.diff-positive {
  color: var(--color-success);
}

.diff-negative {
  color: var(--color-error);
}

.diff-neutral {
  color: var(--color-text-muted);
}
```

### 4.4: No Scout Data State

```css
/* Notice message when no scouting data */
.no-scout-notice {
  font-size: 0.8125rem;
  color: var(--color-text-muted);
  font-style: italic;
  margin: 0 0 0.75rem 0;
  padding: 0.5rem 0.75rem;
  background-color: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  border-left: 3px solid var(--color-border);
}

/* Single bar layout (no comparison) */
.rating-bars.single {
  max-width: 300px;
}

.rating-bars.single .bar-container {
  flex: none;
  width: 100%;
}

/* Hide vs and diff elements when no scout */
.no-scout-data .bar-vs,
.no-scout-data .rating-diff {
  display: none;
}
```

### 4.5: Stats History Table

```css
.stats-history {
  margin-top: 1rem;
}

.stats-history .table-wrapper {
  max-height: 250px;
  overflow-y: auto;
}

.stats-history .stats-table {
  font-size: 0.875rem;
}

.stats-history .stats-table th,
.stats-history .stats-table td {
  padding: 0.5rem 0.625rem;
}
```

### 4.6: Player Name Link

```css
.player-name-link {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: inherit;
  font-weight: inherit;
  padding: 0;
  text-decoration: none;
}

.player-name-link:hover {
  text-decoration: underline;
}
```

---

## Phase 5: Edge Cases & Polish

### 5.1: Loading State
Show spinner while fetching historical stats:
```html
<div class="modal-body loading">
  <div class="loading-spinner"></div>
  <p class="loading-message">Loading player stats...</p>
</div>
```

### 5.2: No Scout Data
When scouting data isn't available for a player:
- Show only estimated ratings bars
- Display "No scout data" label where scout bars would be
- Hide the diff column

### 5.3: Percentile Display
Show percentile below True Rating badge:
```html
<div class="profile-header">
  <div class="profile-title-group">
    <h3 class="modal-title">Player Name</h3>
    <span class="percentile-label">92nd percentile</span>
  </div>
  <span class="badge rating-elite">4.5</span>
</div>
```

### 5.4: Keyboard Accessibility
- Close modal on Escape key
- Trap focus within modal when open

---

## Files to Create

1. `src/views/PlayerProfileModal.ts`

## Files to Modify

1. `src/services/TrueRatingsService.ts` - Add `getPlayerYearlyStats()`
2. `src/views/TrueRatingsView.ts` - Add click handlers, integrate modal
3. `src/styles.css` - Add modal and rating bar styles

---

## Implementation Order

1. **Phase 1** - Data layer (extend TrueRatingsService)
2. **Phase 2** - Modal component (PlayerProfileModal)
3. **Phase 3** - View integration (wire up clicks)
4. **Phase 4** - CSS styling
5. **Phase 5** - Edge cases & polish

---

## Visual Mockups

### With Scouting Data
```
┌─────────────────────────────────────────────────┐
│  Clayton Kershaw                        [4.5]   │
│  92nd percentile                          ×     │
├─────────────────────────────────────────────────┤
│  RATING BREAKDOWN                               │
│                                                 │
│  Stuff   ████████░░ 65  vs  ████████████ 75     │  +10
│  Control ██████████ 70  vs  ████████░░░░ 55     │  -15
│  HRA     █████░░░░░ 50  vs  ██████░░░░░ 55      │   +5
│                                                 │
│  SEASON STATS                                   │
│  ┌─────────────────────────────────────────┐   │
│  │ Year   IP    ERA   K/9  BB/9  HR/9  WAR │   │
│  │ 2020  180.1  2.85  10.2  2.1   0.8  5.2 │   │
│  │ 2019  165.0  3.12   9.8  2.4   0.9  4.1 │   │
│  │ 2018  158.2  3.45   9.1  2.6   1.0  3.5 │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Without Scouting Data
```
┌─────────────────────────────────────────────────┐
│  Clayton Kershaw                        [4.5]   │
│  92nd percentile                          ×     │
├─────────────────────────────────────────────────┤
│  ESTIMATED RATINGS                              │
│  ┌───────────────────────────────────────────┐  │
│  │ No scouting data available for this player│  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Stuff   ████████░░░░░░░░░░ 65                  │
│  Control ██████████░░░░░░░░ 70                  │
│  HRA     █████░░░░░░░░░░░░░ 50                  │
│                                                 │
│  SEASON STATS                                   │
│  ┌─────────────────────────────────────────┐   │
│  │ Year   IP    ERA   K/9  BB/9  HR/9  WAR │   │
│  │ 2020  180.1  2.85  10.2  2.1   0.8  5.2 │   │
│  │ 2019  165.0  3.12   9.8  2.4   0.9  4.1 │   │
│  │ 2018  158.2  3.45   9.1  2.6   1.0  3.5 │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## Future Enhancements (Not in Scope)

- Batter profile cards with batting True Ratings
- Link to full player page (main search)
- Career totals row in stats table
- Sparkline/trend visualization for ratings over time
