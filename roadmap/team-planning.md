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

### Data We Need to Acquire

**Must Have: Draft Logs**
A CSV per draft year with at minimum:
- `player_id` — must match our existing stats data player IDs
- `draft_year`
- `draft_round`
- `draft_pick` (overall pick number)
- `drafting_team_id`
- `position` at time of draft

This is the core — with just this + our existing 20 years of minor league and MLB stats, we can derive almost everything.

**Where to get it**: OOTP draft history exports, or scrape from StatsPlus league pages if available. One CSV per year (2000-2021) or a single combined file.

**Nice to Have (but not available)**:
- Scouting ratings at time of draft (OVR/POT when drafted) — would be great for "what did the scouts think vs what happened" but we don't have historical snapshots of scouting data
- Signing bonus amounts

### What We Can Analyze (Stats-Focused)

Once we have draft logs mapped to our stats data, we can answer:

**1. Pick Value Curves — "What is a 2nd round pick worth?"**
- % of picks that reach MLB, by round and by pick range (1-5, 6-10, 11-20, 21-40, etc.)
- Average and median career MLB WAR by pick range
- Expected years to MLB by pick range
- Basically: an "expected value" number for each draft slot

**2. Positional Draft Value — "Is drafting a SS in round 2 smart?"**
- Hit rate by position and round (are catchers drafted in round 1 more/less likely to pan out than SS?)
- WAR by position and draft slot
- Time to MLB by position (catchers take longer? pitchers bust more?)
- This tells you: "historically, a 2nd-round SS has a 35% chance of reaching MLB and averages 4.2 career WAR"

**3. Development Timelines — "When will my 2023 draft pick be ready?"**
- Average time from draft to MLB debut by round
- Average time from draft to peak WAR season by round
- Distribution: what % of 1st rounders arrive in 2 years? 3? 4? 5?
- This feeds directly into the roster grid — "expect this pick to fill your SS gap in ~3 years"

**4. Attrition/Bust Rates — "What are the odds this pick never makes it?"**
- % of picks per round that never reach MLB
- % that reach MLB but produce <0 career WAR (busts)
- % that produce 1+ WAR (contributors), 5+ WAR (starters), 10+ WAR (stars)
- By round and by position

**5. Late Round Value — "Are rounds 3-5 worth planning around?"**
- How often do later picks surprise?
- Is there a round where hit rate drops off a cliff?
- Are certain positions better late-round bets than others?

### How This Integrates With the Roster Grid

**Scenario**: Grid shows SS under contract through 2024, no SS prospect in farm.

The draft module would show:
1. "SS gap projected starting 2025" (from roster grid)
2. "Historical 2nd-round SS: 35% MLB rate, avg 3.8 WAR, ~3yr development time" (from draft analysis)
3. "You have pick #47 overall in the upcoming draft" (from draft capital data)
4. "Picks in the 40-50 range historically produce: X% MLB rate, Y avg WAR" (from pick value curve)
5. If we have upcoming draft pool data: "Here are the SS-eligible prospects projected for that range"

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

**Phase 2.5a: Data Acquisition & Analysis**
- [ ] Acquire draft log data (CSV export from OOTP) — all available years
- [ ] Build `DraftService.ts` to parse draft logs and map `player_id` to existing stats data
- [ ] Run analysis script (like our batting analysis): pick value curves, positional breakdown, development timelines, bust rates
- [ ] Store derived data: expected WAR by pick, MLB% by pick, years-to-MLB by pick and position

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

### Research We Can Do NOW (Before Acquiring Draft Data)

Even without draft logs, we can do some prep work:
- We already have the aging/career curve analysis (peak yr 3-4, median career 3 seasons)
- We already have the minor league stat translation data (rates carry over, WAR doesn't correlate)
- We can pre-build the analysis scripts that will process draft data once we have it
- We can build the `DraftService` skeleton and the grid UI slots for draft capital

---

## Implementation Phases

### Phase 0: Contract Data Pipeline
**Must happen first — everything depends on knowing when players are under contract.**

- [ ] Determine OOTP contract export format (what fields are available?)
- [ ] Design `Contract` model: `playerId, salary[], years, options, faYear, arbEligible`
- [ ] Expand `ContractService` to parse full contract data
- [ ] Or: build a simple manual entry UI / CSV import as a starting point

### Phase 1: Basic Roster Grid (MVP)
**Goal: replicate the spreadsheet, but in the app.**

- [ ] New `TeamPlanningView.ts` (register as a new tab)
- [ ] Team selector dropdown (like other views)
- [ ] Year columns: current year + 5 forward years
- [ ] Position rows: C, 1B, 2B, SS, 3B, LF, CF, RF, DH, Bench x3, SP1-5, CL, SU1-2, MR1-3
- [ ] Populate cells from roster data + contract years
- [ ] Color cells: green (under contract), red (empty), yellow (final year)
- [ ] Click a cell to open the existing player profile modal

### Phase 2: Prospect Pipeline Integration
**Goal: show where the farm can fill future gaps.**

- [ ] Pull farm data from `TeamRatingsService.getHitterFarmData()` / `getFarmData()`
- [ ] For each position with a future gap (red cell), check if there's a prospect at that position
- [ ] Show prospect name in blue cells with readiness tier tag
- [ ] "Best prospect at position" logic — match farm players to positions with gaps
- [ ] Prospect hover/tooltip: show TFR star, OVR/POT, age, current level

### Phase 2.5: Draft Capital (see Draft Capital Planning section above)
**Goal: connect roster gaps to draft strategy.**

- [ ] Acquire draft log data from OOTP
- [ ] Build `DraftService.ts`, run draft value analysis
- [ ] Add draft capital section to planning view
- [ ] Connect positional gaps → draft targets
- [ ] Draft board with prospect filtering by need

### Phase 3: Actionable Indicators
**Goal: turn the grid into a decision-making tool.**

- [ ] "CLIFF" indicator: use aging curves (peak yr 3-4, decline yr 10+) to flag players entering decline
- [ ] "EXT" indicator: flag players in penultimate contract year who are still in their prime
- [ ] "FA" indicator: positions with no contract AND no farm prospect AND no draft target = need FA
- [ ] "TR" indicator: positions where farm has low-rated prospects AND contract expiring = trade candidate
- [ ] "DRAFT" indicator: positions where gap aligns with upcoming draft pick value
- [ ] Summary row/section: "Positions of Strength" / "Positions of Need" / "Extension Priorities" / "Draft Targets"

### Phase 4: Financial Layer
**Goal: salary cap / luxury tax planning.**

- [ ] Show salary totals per year across the grid
- [ ] Cap space remaining per year
- [ ] Arbitration raise projections
- [ ] Color code expensive contracts ($$$ symbol)
- [ ] "What if" scenarios: what if we extend player X? What if we let player Y walk?

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
3. **Draft log format**: What exactly does OOTP export for draft history? Need to confirm fields available (player_id, round, pick, team, position at minimum). How many years of draft history are available?
4. **Draft pool / upcoming draft**: Can we get pre-draft prospect lists from OOTP for upcoming drafts? Or only historical completed drafts?
5. **Traded picks**: Can we track traded draft picks (team X owns team Y's 2nd rounder)? This might require manual tracking or a separate data source.

---

## Dependencies

- `ContractService` expansion to parse full contract fields (Phase 0 — data already available via API)
- `TeamRatingsService` for roster data (already exists)
- `HitterTrueFutureRatingService` / `TrueFutureRatingService` for prospect readiness (already exists)
- Player aging curve data (from our analysis: peak yr 3-4, decline yr 10+)
- Scouting data for OVR/POT ratings (already exists)
- **Draft log CSVs** (need to acquire from OOTP — Phase 2.5 blocker)
- Existing minor league + MLB stats data for mapping draft picks to outcomes (already have 2000-2021)

## Related Roadmap Items

- **Player Development Tracker**: complements this — shows individual trajectory, while Team Planning shows the team-level view
- **Trade Analyzer**: a "TR" indicator in the grid could link directly to the trade analyzer for that position. Draft picks involved in trades get valued using the pick value curves.
- **Advanced Projections**: win projections could be enhanced by knowing your future roster composition
- **What is the value of a draft pick?** (already on main roadmap as Low priority) — this feature absorbs and supersedes that item
