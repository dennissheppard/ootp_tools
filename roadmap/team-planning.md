# Team Planning View — Feature Spec

## The Problem

There's no way to see the big picture for a team — who's locked up where, when contracts expire, where the farm can fill gaps, and where you'll need to go to FA or make a trade. Currently this lives in a spreadsheet with year columns and position rows.

## The Vision

A year-by-year roster planning grid that shows:
- Who's your best player at each roster slot, each year
- When players fall off (contract expiration, aging decline, etc.)
- Where the gaps are and how to fill them (farm, FA, trade)
- Prospect readiness indicators
- At-a-glance symbols/color-coding for roster health

---

## Layout

### Core Grid Structure

```
              2021    2022    2023    2024    2025    2026
─────────────────────────────────────────────────────────
LINEUP
  C           Player  Player  Player  ???     ???     ???
  1B          Player  Player  Player  Player  Player  ???
  2B          Player  Player  ???     ???     ???     ???
  SS          Player  Player  Player  Player  ???     ???
  3B          Player  Player  Player  Player  Player  Player
  LF          Player  Player  ???     ???     ???     ???
  CF          Player  Player  Player  Player  Player  ???
  RF          Player  Player  Player  Player  ???     ???
  DH          Player  Player  Player  ???     ???     ???

BENCH (3-4 slots)
  UT          ...
  OF          ...
  C            ...

ROTATION
  SP1         Player  Player  Player  Player  ???     ???
  SP2         Player  Player  Player  ???     ???     ???
  SP3         ...
  SP4         ...
  SP5         ...

BULLPEN
  CL          ...
  SU1         ...
  SU2         ...
  MR1-3       ...
```

Each cell shows:
- **Player name** (abbreviated)
- **Age** that year
- **OVR star rating** (or True Rating where available)
- **Color/background** indicating status (see below)

### Cell Color Coding

| Color | Meaning |
|-------|---------|
| Green | Under contract, performing well |
| Yellow | Final contract year — extension candidate? |
| Orange | Projected decline (aging curve says downhill) |
| Red | Empty / no one under contract — need to fill |
| Blue | Prospect projected to arrive (from farm) |
| Purple | Arbitration-eligible (cost rising) |
| Gray | Below-average player holding the spot |

### Cell Symbols/Icons

| Symbol | Meaning |
|--------|---------|
| FA | Free agent target needed |
| EXT | Extension candidate |
| TR | Trade target area |
| FARM | Farm system has a prospect for this |
| $$$ | Expensive contract (top-tier salary) |
| CLIFF | Player projected to decline sharply (aging) |
| READY | Prospect is MLB-ready based on ratings |

---

## Data Requirements

### What We Have Now
- Player names, ages, positions, team assignments (`PlayerService`)
- Scouting ratings: OVR/POT stars, individual tool grades (`ScoutingDataService`, `HitterScoutingDataService`)
- Stats: MLB and minor league batting/pitching by year (`mlb_batting/`, `minors_batting/`, etc.)
- Farm rankings and TFR pipeline (`TeamRatingsService`, `HitterTrueFutureRatingService`)
- Roster construction: lineup/bench/rotation/bullpen (`TeamRatingsService.getPowerRankings()`)

### Contract Data — AVAILABLE via API (No Blocker)

**Endpoint**: `https://atl-01.statsplus.net/world/api/contract/`
- 6,191 player contracts (1,691 MLB, 4,500 minor league)
- Already used by `ContractService.ts` (but only `playerId` + `leagueId` are parsed today)

**Fields available** (all we need):

| Field | Use |
|-------|-----|
| `player_id`, `team_id`, `league_id` | Who, where |
| `is_major` | MLB vs minor league roster |
| `season_year` | Contract start year |
| `years` | Total contract length |
| `current_year` | Years into contract (0-indexed) |
| `salary0`-`salary14` | Salary per year of deal (up to 15 years) |
| `no_trade` | No-trade clause flag |
| `last_year_team_option` | Team option on final year |
| `last_year_player_option` | Player option on final year |
| `last_year_vesting_option` | Vesting option on final year |
| `next_last_year_*_option` | Option on penultimate year |
| `*_buyout` | Option buyout amounts |
| `minimum_pa/ip` + bonus | Performance bonus thresholds |
| `mvp_bonus`, `cyyoung_bonus`, `allstar_bonus` | Award bonuses |

**Derived calculations**:
- Years remaining = `years - current_year`
- FA year = current game year + years remaining (accounting for options)
- Current salary = `salary{current_year}`
- Future salary schedule = `salary{current_year+1}`, `salary{current_year+2}`, etc.
- Minor leaguers: `season_year=0`, `salary0=0` → pre-arb minimum deals

**Action needed**: Expand `ContractService.ts` to parse all fields (currently only reads `playerId` + `leagueId`)

---

## Prospect Readiness Indicator

### What We Learned From the Data Analysis

Minor league stats alone are poor predictors of MLB WAR (all correlations < 0.13). However:
- **Rate stats do translate** to the MLB level (BB% r=0.71, K% r=0.47, BA r=0.46)
- **Stats just don't predict *value*** — a guy can hit .300 and still produce 0 WAR
- **Peak performance comes in years 2-4** of an MLB career (not year 1, not year 7)
- **Rookies don't really struggle** — year 1 avg WAR is 0.96, year 2 is 1.21

### So What Predicts Readiness?

Since stats don't predict WAR well, readiness indicators should lean on:

1. **OVR/POT gap**: A prospect with 4.5 POT and 2.0 OVR isn't ready. One with 4.5 POT and 4.0 OVR probably is.
2. **Age vs. level**: A 22-year-old in AAA is more "ready" than a 19-year-old in AAA (the young one has higher upside but needs time).
3. **POT star rating**: The raw ceiling — a 5-star POT at any level is someone you plan around.
4. **Minor league stat rates**: Not predictive of WAR, but they tell you *what kind* of player someone will be (contact hitter, power hitter, walks a lot, etc.) and the rates do carry over.
5. **TFR rating**: Our existing True Future Rating system already blends scouting + stats — use it directly.

### Proposed Readiness Tiers

| Tier | Criteria | Grid Display |
|------|----------|-------------|
| MLB Ready | OVR >= 3.0 stars AND age >= 22 AND AAA experience | Blue cell, "READY" tag |
| Near Ready (1 yr) | OVR >= 2.5 stars AND POT >= 3.5 AND AA+ experience | Light blue, "~1yr" tag |
| Development (2-3 yr) | POT >= 3.5 AND age < 22 | Faint blue, "2-3yr" tag |
| Long-term (3+ yr) | POT >= 4.0 AND A-ball or lower | Very faint, "LT" tag |
| Not a factor | POT < 3.0 | Don't show |

These tiers need validation — we should analyze historical OVR/POT gaps vs actual MLB arrival time in our data to calibrate.

---

## Draft Capital Planning

### The Idea

The planning grid shows future roster gaps — but gaps 3-5 years out can't always be filled via FA or trade. The draft is how you build the pipeline. If the grid shows "SS is a hole starting 2025," the draft board should flag: "prioritize SS in the next draft — here's what's available and what picks in that range historically produce."

This connects the roster grid directly to draft strategy: **identify the gap → value the pick → target the position → track the prospect.**

### Data Available

**Draft Logs**: 2,887 picks scraped from StatsPlus (2008-2020), with career WAR already computed. Pure stats — no snapshot dependency.

**Personality Snapshots** (see `data/draft_data/`):
- `batters_2010.csv` + `pitchers_2010.csv` — all active players in 2010 (3,943 players)
- `batters_2017.csv` + `pitchers_2017.csv` — all active players in 2017 (5,801 players)
- Merged: 8,282 unique players; 1,758 drafted players with personality data (2008-2017)
- Draft-year scouting CSVs (2016-2021) with WAR embedded — too recent for long-term conclusions

**Analysis scripts**: `analyze_2010.py`, `analyze_drafts.py`, `analyze_merged.py`, `draft_pick_value.py`, `triple_h_deep_dive.py`

### Data Validity Boundaries (IMPORTANT)

**Personality traits (WE, INT, AD, etc.)** — IMMUTABLE. Never change.
- 2010 snapshot covers 2008-2010 draft classes (663 players, minimal attrition)
- 2017 snapshot adds 2011-2017 draft classes (1,095 new players; some survivor bias for 2011-2013)
- Combined: **1,758 drafted players with personality data** across 10 draft classes
- Personality findings validated across both snapshots — direction and ranking consistent

**POT/OVR star ratings** — MUTABLE. Change year to year.
- Only accurate at draft-day values for **same-year draftees** (2010 class in 2010 snapshot, 2017 class in 2017 snapshot)
- For older draftees in a snapshot, POT/OVR reflect post-draft development, not draft-day values
- POT findings based on 2010+2017 same-year draftees combined (n=408) — better than single-year but still limited

**Stats/WAR** — ACCUMULATED. Available 2000-2021 for all players.
- Completely independent of any snapshot
- Pick value curves use 2,887 picks — the most robust data

### Key Findings (Validated with Expanded Data)

**1. Pick Value Curves [HIGH CONFIDENCE — 2,010 mature picks, pure stats]**

| Pick Group | Avg WAR | MLB% | WAR>=5 | WAR>=15 |
|------------|---------|------|--------|---------|
| #1-5 | **11.6** | 76% | 53% | 27% |
| #6-10 | **7.4** | 66% | 39% | 20% |
| #11-15 | **7.9** | 57% | 27% | 16% |
| #16-20 | 4.3 | 55% | 20% | 11% |
| #21-30 | 1.9 | 29% | 12% | 6% |
| #31-55 | 2.9 | 47% | 19% | 7% |
| #56-100 | 1.1 | 25% | 8% | 2% |
| #101+ | 0.2 | 11% | 2% | 0% |

**2. Round-Level Value [HIGH CONFIDENCE — mature classes 2008-2016]**

| Round | Avg WAR | MLB% | WAR>=5 | WAR>=15 |
|-------|---------|------|--------|---------|
| 1 | 7.0 | 84% | 31% | 16% |
| 2 | 3.1 | 67% | 19% | 8% |
| 3 | 2.0 | 60% | 12% | 3% |
| 4 | 1.6 | 42% | 10% | 4% |
| 5 | 0.8 | 41% | 5% | 2% |
| 6 | 0.7 | 41% | 6% | 2% |
| 7+ | ~0.1 | ~20% | ~1% | ~0% |

Sharp dropoff after Round 4. Rounds 7+ are near-zero expected value.

**3. Personality As Draft Edge [HIGH CONFIDENCE — validated across 1,758 players, 10 draft classes]**

Trait ranking by effect size (expanded 2008-2017 pool):

| Trait | H-L Delta (2008-2010, n=663) | H-L Delta (2008-2017, n=1,758) | Direction Holds? |
|-------|-----|-----|-----|
| AD | +4.3 | **+1.8** | YES — still #1 |
| WE | +3.0 | **+1.6** | YES — still #2 |
| INT | +0.9 | +0.5 | yes, small |
| LEA | +0.8 | -0.0 | NO — essentially zero |
| FIN | -1.0 | -0.5 | yes, greed still negative |

Deltas shrink with expanded pool partly because 2011-2017 classes have fewer career years. But **the ranking and direction are rock solid** — AD and WE are the traits that matter.

Key personality rules (all validated):
- **Low WE is devastating**: batters 16% MLB rate (vs 40% for H WE), pitchers 27% (vs 49%)
- **2+ Low in WE/INT/AD = auto-avoid**: 91% bust rate, 0% WAR>=10 (n=133)
- **Triple-H (WE+INT+AD all High)**: avg 4.6 WAR (n=23) vs 1.3 for All Normal (n=666) — ~3.5x multiplier
- **H WE + H AD is the best double combo**: avg 2.4 WAR (n=150), 47% MLB, 13% WAR>=5
- **The draft doesn't price personality** — market inefficiency still present

**4. Development Timelines [HIGH CONFIDENCE — derived from stats files, mature classes 2008-2016]**

*How long from draft to MLB debut?*

| Round | Avg Years | Median | Arrive in 2yr | 3yr | 4yr | 5yr |
|-------|-----------|--------|--------------|-----|-----|-----|
| 1 | 3.0 | 3 | 35% | 60% | 83% | 98% |
| 2 | 3.4 | 3 | 24% | 56% | 74% | 91% |
| 3 | 3.4 | 3 | 31% | 58% | 74% | 92% |
| 4 | 3.6 | 4 | 35% | 44% | 59% | 87% |
| 5 | 4.1 | 4 | 13% | 35% | 56% | 87% |
| 6 | 4.3 | 5 | 22% | 24% | 50% | 82% |

**Pitchers arrive ~0.5yr faster than batters.** Rd 1 pitchers: 43% arrive in 2yr. Rd 1 batters: 29% in 2yr.

*This directly feeds the roster grid*: "You draft a SS in Round 2 → median 4 years to MLB → plan for him to fill your 2026 gap if drafting in 2022."

**5. Position-Specific Draft Outcomes [HIGH CONFIDENCE — mature classes 2008-2016]**

| Position | n | MLB% | Avg WAR | WAR>=5 | Avg Yrs to MLB |
|----------|---|------|---------|--------|----------------|
| SP | 397 | 46% | 1.9 | 10% | 3.9 |
| RP | 315 | 37% | 0.7 | 5% | 3.4 |
| CF | 115 | 50% | 2.3 | 9% | 4.1 |
| 2B | 107 | 34% | 2.8 | 13% | 3.3 |
| SS | 101 | 39% | 1.1 | 10% | 3.6 |
| LF | 92 | 32% | 1.4 | 8% | 4.3 |
| 1B | 85 | 38% | 2.2 | 7% | 3.5 |
| RF | 84 | 44% | 1.2 | 7% | 3.9 |
| 3B | 80 | 34% | 1.3 | 8% | 3.7 |
| C | 127 | 25% | 0.7 | 5% | 3.9 |

**Position x Round highlights** (Rounds 1-4):
- **Best Rd 1 position**: 2B (15.6 avg WAR, 50% WAR>=5) and 1B (14.0 avg WAR)
- **SS Rd 1**: 100% MLB rate but only 3.2 avg WAR — they all make it but rarely become stars
- **SS Rd 2-3**: Better value plays (3.6 and 4.8 avg WAR respectively)
- **C Rd 1**: Risky (40% MLB, 3.0 avg WAR). **C Rd 2 is the sweet spot** (67% MLB, 6.2 avg WAR, 44% WAR>=5)
- **SP Rd 1**: 7.4 avg WAR, 36% WAR>=5 — the safest high-end pick
- **CF Rd 1**: 93% MLB rate but only 3.7 avg WAR — high floor, low ceiling

**6. Draft Slot Tier System [HIGH CONFIDENCE]**
- Tier 1 (Picks 1-8): Avg 11+ WAR, franchise-altering, 75%+ MLB rate
- Tier 2 (Picks 9-20): Avg 3-8 WAR, solid starters, ~50% MLB rate
- Tier 3 (Picks 21-55): Avg 1.5-4 WAR, lottery tickets, ~35% MLB rate
- Tier 4 (Picks 56-100): Avg 0.5-2 WAR, long shots, personality matters most here
- Tier 5 (Picks 101+): Avg <0.5 WAR, near-zero expected value

### Still Needed for Team Planning Integration

**Upcoming draft pool integration** — future work:
- Can we get pre-draft prospect lists from OOTP for upcoming drafts?
- If so, overlay personality data + POT to project which available players fit positional needs

### How This Integrates With the Roster Grid

**Scenario**: Grid shows SS under contract through 2024, no SS prospect in farm.

The draft module would show:
1. "SS gap projected starting 2025" (from roster grid)
2. "Rd 1 SS: 100% MLB rate, 3.2 avg WAR, median 3yr to debut. Rd 2 SS: 57% MLB, 3.6 avg WAR. Rd 3 SS: 56% MLB, 4.8 avg WAR" (from position x round data)
3. "You have pick #47 overall (early Rd 3) in the 2022 draft" (from draft capital data)
4. "Picks #41-50 historically: 42% MLB rate, 1.6 avg WAR" (from pick value curve)
5. "At Rd 3, a SS takes median 3yr to arrive → projected MLB debut 2025 — right when you need him"
6. "Prioritize H WE + H AD prospects — they outperform Normal by 2-3x at this draft range"
7. If we have upcoming draft pool data: "Here are the SS-eligible prospects projected for that range"

### Draft Board View (Part of Team Planning)

```
DRAFT CAPITAL
                    2022 Draft       2023 Draft       2024 Draft
─────────────────────────────────────────────────────────────────
Round 1             Pick #12         Pick #18         —(traded)
                    Hist: 62% MLB    Hist: 55% MLB
                    Target: SS       Target: BPA

Round 2             Pick #42         Pick #48         Pick #38
                    Hist: 35% MLB    Hist: 32% MLB    Hist: 38% MLB
                    Target: C/OF     Target: SP

Round 3+            Picks #71,#95    Picks #78,#102   Picks #68,#92

POSITIONAL NEEDS FROM GRID:
  SS (gap 2025) → prioritize Rd 1-2
  C  (gap 2026) → develop Rd 2-3 or FA
  SP (depth)    → always draft SP
```

### Implementation: Phase 2.5 (After Prospect Pipeline, Before Indicators)

**Phase 2.5a: Data Acquisition & Analysis — COMPLETE**
- [x] Draft logs scraped (2,887 picks, 2008-2020)
- [x] Personality snapshots merged (2010 + 2017 → 1,758 drafted players)
- [x] Analysis scripts: `analyze_merged.py`, `draft_pick_value.py`, `analyze_2010.py`
- [x] All key metrics computed: pick value curves, round-level value, position x round, development timelines, personality effects, bust rates

**Phase 2.5b: Draft Value Integration**
- [ ] Add draft capital section below the roster grid (or as a tab within Team Planning)
- [ ] Show team's picks for upcoming drafts by round
- [ ] Annotate each pick with historical value data (MLB%, avg WAR, avg years to MLB)
- [ ] Highlight picks that align with projected roster gaps
- [ ] "Positional Needs" summary connecting grid gaps → draft targets

**Phase 2.5c: Draft Board**
- [ ] Mock draft board: rank available prospects by position for upcoming draft
- [ ] Filter by positional need (from roster grid)
- [ ] Show prospect's current minor league stats (from our existing data)
- [ ] Tag picks: "fills SS gap in ~3yr" or "BPA — no positional need"
- [ ] Track post-draft: once drafted, prospect flows into the Phase 2 prospect pipeline on the grid

---

## Implementation Phases

### Phase 0: Contract Data Pipeline — COMPLETE
- [x] Full `ContractService` parsing: salary schedules, years, options, team/player/vesting options
- [x] League minimum contract detection with estimated team control (6 years from debut)
- [x] Salary formatting ($228K / $9.7M)

### Phase 1: Basic Roster Grid — COMPLETE
- [x] `TeamPlanningView.ts` registered as tab
- [x] Team selector using `filter-dropdown` pattern (consistent with other views)
- [x] Only real MLB teams (filtered via power rankings, excludes all-star/phantom)
- [x] 6 year columns (current + 5 forward)
- [x] Position rows: C, 1B, 2B, SS, 3B, LF, CF, RF, DH, SP1-5, CL, SU1-2, MR1-5
- [x] Cells populated from `getPowerRankings()` + contract data
- [x] Color coding: green (under contract), yellow (final year), red (empty), blue (prospect)
- [x] Position assignment via `positionLabel` matching (not array index)
- [x] Click cells to open player profile modals

### Phase 2: Prospect Pipeline Integration — COMPLETE
- [x] Hitter prospects from `getHitterFarmData()`, pitcher prospects from `getFarmData()`
- [x] ETA estimation by level: MLB=0, AAA=1, AA=2, A=3, R=4, IC=5 (with TFR-based acceleration)
- [x] Scarcity-based position assignment (mirrors `constructOptimalLineup` algorithm)
- [x] Year-independent evaluation: better prospects supersede lesser ones in later years
- [x] Min-contract players upgradeable by higher-rated prospects
- [x] SP/RP classification for pitcher prospects (3+ pitches + stamina ≥ 30 = SP)
- [x] Prospect cells show name, projected age, TFR rating, and level indicator

### Phase 2.5: Draft Capital (see Draft Capital Planning section above)
**Goal: connect roster gaps to draft strategy.**

Research complete (in `data/draft_data/`):
- [x] Draft logs scraped (2,887 picks, 2008-2020)
- [x] Pick value curves, round-level value, draft slot tiers
- [x] Personality analysis validated with expanded pool (1,758 players, 2008-2017 via merged 2010+2017 snapshots)
- [x] Development timelines by round (years from draft to MLB debut)
- [x] Position-specific draft outcomes (position x round matrix)
- [x] Bust rates by POT tier (2010+2017 same-year draftees)

Implementation needed:
- [ ] Build `DraftService.ts` to expose pick value data, personality flags, development timelines, and team draft capital
- [ ] Add draft capital section to planning view
- [ ] Connect positional gaps from roster grid → draft targets using position x round data
- [ ] Draft board: filter available prospects by positional need + personality profile
- [ ] Integrate personality data into prospect evaluation (flag H WE/AD prospects as higher value)
- [ ] Use development timelines to project "fills gap in ~Xyr" for each draft pick

### Phase 3: Actionable Indicators — COMPLETE
**Goal: turn the grid into a decision-making tool.**

- [x] "CLIFF" indicator: age ≥ 33 or ~10yr service (decline risk)
- [x] "EXT" indicator: extension candidate (under-contract, penultimate year, rating ≥ 3.0, age ≤ 31)
- [x] "FA" indicator: free agent target needed (empty cell in years 2-4 with no prospect)
- [x] "TR" indicator: trade target area (underperforming final-year player, no strong prospect coming)
- [x] "UPGRADE" indicator: year 0 only, MLB-ready prospect better than incumbent
- [x] "EXPENSIVE" indicator: salary ≥ $10M
- [x] Summary section: "Positions of Strength" / "Positions of Need" / "Extension Priorities" / "Draft Strategy"

### Phase 4: Financial Layer — COMPLETE
**Goal: salary cap / luxury tax planning.**

- [x] Show salary totals per year across the grid (lineup/rotation/bullpen subtotals + grand total)
- [x] Arbitration salary estimation by TFR tier
- [x] Color code expensive contracts ($$$ indicator)
- [x] Section header ratings: per-year average star ratings for each section (LINEUP, ROTATION, BULLPEN)
- [x] TEAM rating row: overall team rating per year (40% rotation + 40% lineup + 20% bullpen)
- [ ] Cap space remaining per year
- [ ] "What if" scenarios: what if we extend player X? What if we let player Y walk?

### Phase 4.5: Smart Grid Interactions — COMPLETE (Feb 2026)
**Goal: grid reacts intelligently to user edits.**

- [x] Override-aware auto-fill: overrides applied before prospect fill, greedy algorithm optimizes around user decisions
- [x] Final-year cells open for prospect replacement (prevents bad cascading placements)
- [x] Rotation re-sorted by rating per year (SP1 is always the best pitcher in each column)
- [x] Development curve overrides: "Set as fully developed" per-player toggle skips growth phase
- [x] Edit modal shows TFR alongside current rating for cell occupants
- [x] IndexedDB v11: `player_dev_overrides` store for per-player dev overrides

### Phase 5: Polish
- [ ] Diamond view toggle (OOTP-style visual for a single year)
- [ ] Print/export to image or PDF
- [ ] Comparison mode: overlay two teams' grids
- [ ] Historical mode: look at past years' planning accuracy

---

## Decisions Made

- **Contract data**: RESOLVED — API at `/api/contract/` has everything. Just expand `ContractService` parsing.
- **Positional flexibility**: Show at primary position. Allow user to drag/move to alternate positions.
- **Bench**: Low detail — no individual bench slot planning needed.
- **Bullpen**: Full detail — plan CL, SU, MR slots year by year (same as rotation).
- **Multi-team comparison**: Not essential. Maybe Phase 5 nice-to-have.

## Questions Still Open

1. **Readiness calibration**: Need to analyze historical OVR/POT gap vs actual MLB arrival timing to set tier thresholds.
2. **How many forward years?** 5 feels right for planning. 3 for a "win now" view?
3. **Draft pool / upcoming draft**: Can we get pre-draft prospect lists from OOTP for upcoming drafts? If so, we can overlay personality + POT to flag positional fits.
4. **Traded picks**: Can we track traded draft picks (team X owns team Y's 2nd rounder)? Might require manual tracking or a separate data source.

---

## Dependencies

- `ContractService` expansion to parse full contract fields (Phase 0 — data already available via API)
- `TeamRatingsService` for roster data (already exists)
- `HitterTrueFutureRatingService` / `TrueFutureRatingService` for prospect readiness (already exists)
- Player aging curve data (from our analysis: peak yr 3-4, decline yr 10+)
- Scouting data for OVR/POT ratings (already exists)
- Draft research complete in `data/draft_data/` — 2,887 picks (2008-2020), 1,758 with personality data (2010+2017 snapshots merged), pick value curves, position x round outcomes, development timelines all computed
- Existing minor league + MLB stats data (2000-2021)

## Related Roadmap Items

- **Player Development Tracker**: complements this — shows individual trajectory, while Team Planning shows the team-level view
- **Trade Analyzer**: a "TR" indicator in the grid could link directly to the trade analyzer for that position. Draft picks involved in trades get valued using the pick value curves.
- **Advanced Projections**: win projections could be enhanced by knowing your future roster composition
- **What is the value of a draft pick?** (already on main roadmap as Low priority) — this feature absorbs and supersedes that item. Core analysis already done in `data/draft_data/`
