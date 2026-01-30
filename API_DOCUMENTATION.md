# StatsPlus API Documentation - WBL Edition

This document serves as both internal API reference and a brainstorming guide for leveraging the StatsPlus API in the True Ratings application.

---

## Table of Contents
1. [API Basics](#api-basics)
2. [WBL-Specific Configuration](#wbl-specific-configuration)
3. [Available Endpoints](#available-endpoints)
4. [Endpoint Details & Usage](#endpoint-details--usage)
5. [Ideas & Future Features](#ideas--future-features)
6. [Implementation Notes](#implementation-notes)

---

## API Basics

### URL Pattern
All APIs follow the pattern:
```
https://statsplus.net/LGURL/api/APINAME
```

Where `LGURL` is your league's unique URL identifier.

### Response Formats
- Most endpoints return **CSV** or **JSON**
- Some endpoints (e.g., `/ratings`) require authentication and trigger asynchronous CSV generation
- No authentication required for most endpoints (just HTTP GET requests)

---

## WBL-Specific Configuration

### League Identifiers
- **Major League ID**: `200`
- **AAA League ID**: `201`
- **AA League ID**: `202`
- **A-Ball League ID**: `203`
- **Rookie League ID**: `204`
- **International Complex League ID**: `-200` (negative indicates international complex)
- **LGURL**: `world`

### Important Notes
- The `level` field on the `/players` endpoint does **NOT** distinguish international complex players from other minor leaguers
- Use the `/contract` endpoint to identify international complex players via the `league_id` field (`-200`)
- International complex players will have `league_id = -200` in contract data

### Level IDs (Reference)
```
1  = ML (Major League)
2  = AAA
3  = AA
4  = A
5  = Short A
6  = Rookie
7  = Independent
8  = International Complex
10 = College
11 = High School
```

---

## Available Endpoints

| Endpoint | Purpose | Auth Required | Format |
|----------|---------|---------------|--------|
| `/teams` | Team ID ↔ Name mapping | No | CSV |
| `/players` | Player ID ↔ Name + basic info | No | CSV |
| `/date` | Current game date | No | Text/JSON |
| `/contract` | Active player contracts | No | CSV |
| `/contractextension` | Future contract extensions | No | CSV |
| `/exports` | Export status (last 10 game dates) | No | JSON |
| `/gamehistory` | All games in StatsPlus history | No | CSV |
| `/teambatstats` | Team batting stats (current season) | No | CSV |
| `/teampitchstats` | Team pitching stats (current season) | No | CSV |
| `/playerbatstatsv2` | Player batting stats (flexible) | No | CSV |
| `/playerpitchstatsv2` | Player pitching stats (flexible) | No | CSV |
| `/draftv2` | Current draft status | No | CSV |
| `/ratings` | Scout/OSA ratings for all players | **Yes** | CSV (async) |

---

## Endpoint Details & Usage

### `/teams`
**Format**: `"ID","Name","Nickname","Parent Team ID"`

**Use Cases**:
- Map team IDs to human-readable names
- Identify parent organizations for minor league teams
- Build team dropdowns/filters

---

### `/players`
**Format**: `"ID","First Name","Last Name","Team ID","Parent Team ID","Level","Pos","Role","Age","Retired"`

**Use Cases**:
- Build player lookup tables
- Filter by position, role, age
- Identify retired players
- **Limitation**: Cannot distinguish International Complex players by level alone

**Key Fields**:
- `Level`: Numeric level ID (see Level IDs reference)
- `Role`: SP (Starting Pitcher), RP (Relief Pitcher), etc.
- `Parent Team ID`: Links minor leaguers to their MLB organization

---

### `/contract` and `/contractextension`

**Contract Header** (OOTP26):
```
player_id,team_id,league_id,is_major,no_trade,last_year_team_option,
last_year_player_option,last_year_vesting_option,next_last_year_team_option,
next_last_year_player_option,next_last_year_vesting_option,contract_team_id,
contract_league_id,season_year,salary0,salary1,salary2,salary3,salary4,
salary5,salary6,salary7,salary8,salary9,salary10,salary11,salary12,salary13,
salary14,years,current_year,minimum_pa,minimum_pa_bonus,minimum_ip,
minimum_ip_bonus,mvp_bonus,cyyoung_bonus,allstar_bonus,
next_last_year_option_buyout,last_year_option_buyout
```

**Critical Field**: `league_id`
- Use this to identify International Complex players (`league_id = -200`)

**Use Cases**:
- **True Value calculations**: Combine salary data with True Ratings
- **Trade Analyzer**: Show contract implications of trades
- **International Complex identification**: Filter by `league_id = -200`
- **Contract analysis**: Identify team options, no-trade clauses, bonuses
- **Salary cap planning**: Project future payroll

---

### `/exports`
**Format**: JSON with current date + dictionary of valid exports by team

**Example Response**:
```json
{
  "current_date": "2043-08-31",
  "2043-08-31": [59, 57, 52, 42, 58, 46, 34, 55, 54],
  "2043-08-24": [...]
}
```

**Use Cases**:
- Verify data freshness
- Show users which teams have uploaded recent data
- Display "last updated" timestamps

---

### `/gamehistory`
**Format**: CSV with all major league games since StatsPlus adoption

**Fields**: `"game_id","league_id","home_team","away_team","attendance","date","time","game_type","played","dh","innings","runs0","runs1","hits0","hits1","errors0","errors1","winning_pitcher","losing_pitcher","save_pitcher","starter0","starter1","cup"`

**Use Cases**:
- Strength of schedule analysis
- Historical performance context
- Pitcher workload tracking (starts, saves)
- Head-to-head records
- Attendance trends
- Playoff game identification (`cup` field)

---

### `/playerbatstatsv2` and `/playerpitchstatsv2`

**Parameters**:
- `pid` (optional): Player ID - omit for all players
- `year` (optional): Specific season - defaults to current year (or all years if `pid` specified)
- `lid` (optional): **League ID** - defaults to major league only (200) when `pid` is used; defaults to all top-level leagues otherwise. **Must be specified to get minor league stats.**
- `split` (optional): 1=Overall, 2=vsL, 3=vsR, 21=Playoffs

**Important**: To get a player's complete career history across all levels, you must make separate requests for each league ID and combine the results.

**🎉 GAME-CHANGER**: The `lid` parameter means we can pull **historical minor league stats** for all levels!

**Example Queries**:

```
# All major league (lid=200) pitching stats for 2042
https://statsplus.net/LGURL/api/playerpitchstatsv2/?year=2042&lid=200

# All AAA pitching stats for 2042 (lid=201)
https://statsplus.net/LGURL/api/playerpitchstatsv2/?year=2042&lid=201

# All AA pitching stats for 2042 (lid=202)
https://statsplus.net/LGURL/api/playerpitchstatsv2/?year=2042&lid=202

# Single player's major league stats (defaults to MLB if no lid specified)
https://statsplus.net/LGURL/api/playerpitchstatsv2/?pid=12345

# Single player's AAA stats
https://statsplus.net/LGURL/api/playerpitchstatsv2/?pid=12345&lid=201

# Single player's major league career, overall split only
https://statsplus.net/LGURL/api/playerpitchstatsv2/?pid=12345&lid=200&split=1
```

**Use Cases**:
- Pull complete historical minor league databases
- Build comprehensive prospect tracking
- Analyze player development trajectories
- Level-adjusted performance projections
- **Bust/Boom Analysis** (see Ideas section)

---

### `/draftv2`

**Format**: CSV of drafted players

**Header**: `"ID","Round","Pick In Round","Supp","Overall","Player Name","Team","Team ID","Position","Age","College","Auto Pick","Time (UTC)"`

**Parameters**:
- `lid` (optional): Required for associations with multiple drafts

**Example**: `https://statsplus.net/LGURL/api/draftv2/?lid=200`

**Use Cases**:
- **Draft Board feature** (currently on hold)
- Mark players as drafted in real-time
- Track draft history
- Analyze draft value vs. actual production
- Build "draft recap" reports

**Google Sheets Integration Example**:
```javascript
function pullData() {
  var leagueUrl = "https://statsplus.net/LGURL/api/draftv2/";
  var cell = SpreadsheetApp.getActiveSheet().getRange("A1");
  cell.setFormula("importData(\"" + leagueUrl + "\")");
}
```

---

### `/ratings` ⚠️ (Problematic)

**Requirements**:
- User must be logged in at `https://statsplus.net/LGURL`
- User must be linked to a team in the league
- Asynchronous CSV generation (30 seconds - 5 minutes)

**Workflow**:
1. Visit `https://statsplus.net/LGURL/api/ratings/`
2. Receive response with temporary CSV URL
3. Wait for processing
4. Download CSV from temporary URL (valid for 30 minutes)

**Issues for Web App Integration**:
- Requires authentication (session-based)
- Asynchronous process requires polling or user intervention
- Temporary URLs expire
- Not suitable for automated/real-time pulls

**Workaround Ideas**:
- Provide a "Download Ratings" button that opens the API URL in a new tab
- Give users instructions to paste the CSV into the app
- Build a browser extension to automate the process
- **Conclusion**: Probably not usable for automated workflows

**Important Notes**:
- Star ratings are doubled (3.5 stars = 7)
- Negative `league_id` indicates International Complex
- Field order may change in future versions

---

## Ideas & Future Features

### 1. Historical Minor League Analysis 🔥

**Now Possible**: Pull complete minor league stats across all levels and years using `lid` parameter.

**Research Questions**:
- Does the game consistently produce realistic player development arcs?
- Are minor league stats predictive of MLB success?
- Do "Four-A players" exist in OOTP? (AAA stars who never succeed in MLB)
- Are there "late bloomers" who dominated MLB despite poor minor league stats?
- What's the correlation between age-adjusted minor league performance and peak MLB performance?

**Implementation Ideas**:
- **Bust/Boom Dashboard**: Track players who had elite minor league careers but flopped in MLB (and vice versa)
- **Development Curve Visualizations**: Show player progression through levels (A → AA → AAA → MLB)
- **Level Adjustments**: Use historical data to calibrate level difficulty multipliers
- **Prospect Probability Models**: Train models on historical data to predict MLB success probability

**Example Queries**:
```
# Pull all AAA pitching stats for the last 10 years
for year in 2033-2042:
  GET /playerpitchstatsv2/?year={year}&lid=201&split=1

# Pull all AA pitching stats for the last 10 years
for year in 2033-2042:
  GET /playerpitchstatsv2/?year={year}&lid=202&split=1

# Compare to MLB stats for same players
for year in 2033-2042:
  GET /playerpitchstatsv2/?year={year}&lid=200&split=1

# Join on player_id across all levels, analyze progression
# Note: Must query each league separately and combine results
```

---

### 2. True Value (Ratings + Contracts)

**Concept**: Combine True Ratings with salary data to calculate "$/WAR" and identify value players.

**Data Sources**:
- `/contract` endpoint for current salaries
- `/contractextension` for future commitments
- True Ratings calculations (already built)

**Metrics to Calculate**:
- **Value Score**: WAR / (Salary / League Average Salary)
- **Contract Efficiency**: Projected WAR over contract life vs. total contract value
- **Team Payroll Efficiency**: Sum of all player value scores

**Use Cases**:
- Identify underpaid breakout candidates
- Flag overpaid veterans
- Rank teams by payroll efficiency
- Trade analyzer: Show contract implications ("You're taking on $15M/year for 3 years")

---

### 3. Trade Analyzer Enhancements

**Current State**: Trade analyzer exists, but limited context.

**Additions with Contract Data**:
- Display salary obligations for each player
- Show contract years remaining
- Calculate "salary cap impact" of trade
- Flag no-trade clauses
- Show team/player options
- Display performance bonuses (MVP, Cy Young, All-Star)

**Additions with Historical Data**:
- Show player's career trajectory (trending up/down)
- Compare player's current stats to career averages
- Show age-adjusted projections for trade targets

---

### 4. Draft Board Integration

**Status**: Feature on hold, will return.

**Data Source**: `/draftv2` endpoint

**Features to Build**:
- Real-time draft tracker (refresh every N seconds)
- Mark players as "drafted" in player lists
- Show draft history for analysis
- "Best Available" rankings that update as players are picked
- Draft value analysis (retrospective: compare draft position to actual production)

**Implementation Notes**:
- Endpoint returns CSV - easy to parse
- Consider WebSocket or polling for live updates during draft
- Store draft history in IndexedDB for multi-year analysis

---

### 5. Farm System Valuation & Depth Analysis

**Current State**: Farm Rankings feature exists (Top Systems, Top 100, Organizational Reports).

**Enhancements with Historical Data**:
- **Historical Depth Trends**: Track how farm systems have evolved over time
- **Development Success Rate**: For each organization, what % of top prospects reach MLB and succeed?
- **Level-Specific Strength**: Which teams consistently produce strong AAA players? AA players?
- **Pipeline Analysis**: Identify teams with strong Rookie/A-ball systems but weak upper minors (gaps in pipeline)

**New Metrics**:
- **Organizational Development Score**: Historical success rate of converting prospects to productive MLB players
- **System Volatility**: How much do farm rankings fluctuate year-over-year? (High volatility = aggressive trades)
- **Positional Depth**: Heatmap showing which teams are deep at which positions across all levels

---

### 6. Game History Analytics

**Data Source**: `/gamehistory` endpoint

**Ideas**:
- **Strength of Schedule**: Calculate opponent quality for each team
- **Pitcher Usage Patterns**: Track starts, relief appearances, save opportunities
- **Clutch Performance**: Cross-reference game scores with high-leverage situations
- **Attendance Analysis**: Identify marquee matchups, playoff attendance trends
- **Team Streaks**: Detect hot/cold streaks over time
- **Division Rivalries**: Head-to-head records within divisions

---

### 7. Advanced Projection Refinements

**Current State**: Three-model ensemble (Optimistic/Neutral/Pessimistic).

**Enhancements with Historical Data**:
- **Calibrate Aging Curves**: Use actual historical aging patterns from the league (not generic OOTP curves)
- **Position-Specific Trends**: Do closers age differently than starters in this league?
- **Breakout Detection**: Identify statistical markers that preceded historical breakouts
- **Regression Detection**: Flag players whose stats diverge from historical norms (likely to regress)

---

### 8. Playoff-Specific Analysis

**Data Source**: `/playerbatstatsv2` and `/playerpitchstatsv2` with `split=21` (playoffs)

**Ideas**:
- **Playoff Performers**: Identify players who excel in high-pressure situations
- **Playoff Chokers**: Flag players who underperform in playoffs vs. regular season
- **Clutch Factor**: Build a "clutch rating" based on playoff vs. regular season splits
- **Roster Construction**: Analyze which types of pitchers (high K/9, low BB/9, etc.) perform best in playoffs

---

## Implementation Notes

### Handling CSV Downloads

**Problem**: Several endpoints return CSVs to be downloaded. How do we use this in a web app?

**Solutions**:

1. **Fetch API (Preferred for Most Endpoints)**:
   ```javascript
   async function fetchStats(endpoint) {
     const response = await fetch(`https://statsplus.net/LGURL/api/${endpoint}`);
     const csvText = await response.text();
     const data = parseCSV(csvText); // Use Papa Parse or similar
     return data;
   }
   ```

2. **User-Initiated Downloads (For `/ratings` and Other Authenticated Endpoints)**:
   - Provide a button: "Download Latest Ratings"
   - Button opens API URL in new tab
   - User follows instructions to download CSV
   - User uploads CSV to app via file input
   - App parses and stores in IndexedDB

3. **Hybrid Approach**:
   - Auto-fetch for unauthenticated endpoints
   - Manual download + upload for `/ratings`

### Caching Strategy

**Recommendations**:
- Cache `/teams` and `/players` in IndexedDB (update weekly)
- Cache historical stats (they never change) permanently
- Refresh current season stats daily
- Use `/exports` endpoint to detect stale data

### Rate Limiting

**Unknown**: StatsPlus API rate limits not documented.

**Best Practices**:
- Batch requests where possible
- Cache aggressively
- Use `lid` parameter to minimize response sizes
- Consider adding "Last Updated" timestamps to UI

### WBL League IDs Reference

**Confirmed League IDs**:
- Major League: `200`
- AAA: `201`
- AA: `202`
- A-Ball: `203`
- Rookie: `204`
- International Complex: `-200`

**Note**: To get a player's complete career across all levels, you must query each league ID separately and combine the results. There is no single query to return all leagues at once.

---

## Next Steps

### Immediate Actions:
1. **Confirm LGURL**: Identify the WBL league URL on StatsPlus
2. **Map League IDs**: Query `/teams` to build complete league ID reference
3. **Test Endpoints**: Verify all endpoints work for WBL
4. **Build Data Ingestion Service**: Create a service to pull and cache historical minor league stats

### Short-Term Features:
1. **Historical Minor League Data**: Implement bulk download of all minor league stats
2. **Contract Integration**: Add `/contract` endpoint to data management
3. **International Complex Filter**: Use `league_id = -200` to properly identify international players

### Long-Term Features:
1. **True Value Dashboard**: Combine ratings + contracts
2. **Bust/Boom Analysis**: Research tool for prospect development
3. **Draft Board**: Real-time draft tracker
4. **Development Curves**: Visualize player progressions through levels

---

## Appendix: Quick Reference

### Essential Endpoints for True Ratings

| Endpoint | When to Use | Frequency |
|----------|-------------|-----------|
| `/players` | Build player lookup table | Weekly |
| `/playerpitchstatsv2/?lid=200` | Current MLB stats | Daily |
| `/playerpitchstatsv2/?lid=XXX` | Historical minor league stats | One-time bulk load |
| `/contract` | Identify international players | Weekly |
| `/teams` | Team name mappings | Weekly |
| `/exports` | Check data freshness | Daily |

### WBL-Specific Constants

```javascript
const WBL_CONFIG = {
  LGURL: "world",
  MAJOR_LEAGUE_ID: 200,
  AAA_LEAGUE_ID: 201,
  AA_LEAGUE_ID: 202,
  A_BALL_LEAGUE_ID: 203,
  ROOKIE_LEAGUE_ID: 204,
  INTERNATIONAL_COMPLEX_ID: -200,

  // Helper array for iterating through all minor league levels
  MINOR_LEAGUE_IDS: [201, 202, 203, 204],
  ALL_LEAGUE_IDS: [200, 201, 202, 203, 204]
};
```

---

**Last Updated**: 2026-01-29
**Maintained By**: True Ratings Development Team
