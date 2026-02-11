# WBL Draft Data Analysis

## Overview

Analysis of WBL (OOTP sim) historical draft data to answer:
1. Do personality traits influence player development/career outcomes?
2. What are bust rates by player type, POT tier, and draft round?
3. Can personality overcome talent tier deficits?
4. What is the expected WAR by draft slot?

**Primary dataset**: 2010 league snapshot (`batters_2010.csv`, `pitchers_2010.csv`) cross-referenced with career WAR from `public/data/mlb/` (pitching) and `public/data/mlb_batting/` (batting) stats files spanning 2000-2021.

**Secondary dataset**: Draft-year scouting CSVs (2016-2021) with WAR already embedded. Analyzed in `analyze_drafts.py`.

---

## Data Sources & Structure

### 2010 Snapshot Files

**`batters_2010.csv`** — All active players in the league as of 2010, batting scouting view.
- Columns: `ID, POS, Name, Age, OVR, POT, LEA, LOY, AD, FIN, WE, INT, Type, CON P, GAP P, POW P, EYE P, K P, SPE, STE, RUN, Draft, Round, Pick`
- 2113 rows (includes pitchers — POS=SP/RP/CL — with their batting scouting)
- POT/OVR format: `"2.5 Stars"` (string, needs parsing)
- Personality traits: H/N/L values
- `Type` = personality archetype (Normal, Unknown, Sparkplug, Captain, Selfish, Fan Fav, Disruptive, Outspoken, Unmotivated, Humble, Prankster)
- `Draft` = draft year (0 = undrafted), `Round` = draft round, `Pick` = pick within round

**`pitchers_2010.csv`** — All active pitchers, pitching scouting view.
- Columns: `ID, POS, Name, Age, T, OVR, POT, LEA, LOY, AD, FIN, WE, INT, Type, STU P, CON P, HRR P, FBP, CHP, CBP, SLP, SIP, SPP, CTP, FOP, CCP, SCP, KCP, KNP, STM, Draft, Round, Pick`
- 1854 rows

**Key**: The `ID` column in both files maps to `player_id` (2nd column) in the stats files. NOT the `id` (1st column / record ID) in stats files.

### Stats Files (WAR source)

**Pitching WAR**: `public/data/mlb/YYYY.csv` (2000-2021)
- Columns: `id, player_id, year, team_id, ..., ip, ..., war, ra9war`
- Match on `player_id`. Only count rows where `ip > 0`.

**Batting WAR**: `public/data/mlb_batting/YYYY_batting.csv` (2000-2021)
- Columns: `id, player_id, year, team_id, ..., pa, ..., war`
- Match on `player_id`. Only count rows where `pa > 0`.

**Career WAR** = sum of yearly WAR across all files for a player_id.

### Player Type Classification

- If player's POS in {SP, RP, CL, MR, LR} → pitcher → use pitching WAR from `mlb/` files
- Otherwise → position player → use batting WAR from `mlb_batting/` files
- Load pitchers from `pitchers_2010.csv` first (has pitching-specific scouting), then load remaining position players from `batters_2010.csv` (skip IDs already seen)

### Draft Log Sources

Draft logs scraped from `https://atl-01.statsplus.net/world/draftyear/?year=YYYY` for 2008-2020.
Used to measure attrition (how many draftees are missing from the 2010 snapshot).

**Attrition rates (2008-2010)**:
- 2008: 287 drafted, 275 in snapshot → 12 gone (4.2% in 2 years)
- 2009: 217 drafted, 207 in snapshot → 10 gone (4.6% in 1 year)
- 2010: 181 drafted, 181 in snapshot → 0 gone

Conclusion: **minimal survivor bias** for 2008-2010 draft classes.

### Draft-Year Scouting CSVs (secondary data)

Files with WAR already embedded (used in `analyze_drafts.py`):
- `2016 pitchers.csv` — 170 rows, ~5yr career data
- `2018 pitching.csv` — ~159 rows, ~3yr career data
- `2018 batters.csv` — ~153 rows, ~3yr career data
- `2019 pitchers.csv` — ~167 rows, ~2yr career data
- `2019 batters.csv` — ~145 rows, ~2yr career data
- `2021 pitchers.csv` — ~178 rows, <1yr career data
- `2021 batters.csv` — ~143 rows, <1yr career data

Files WITHOUT WAR (scouting only): `2015 pitchers.csv`, `2017 pitchers.csv`
Missing entirely: 2015 batters, 2016 batters, 2017 batters, 2020 (all)

Column names vary across files. Use a `get_col(row, *candidates)` helper to check multiple names.

---

## Scripts

### `analyze_2010.py`
- Main analysis script for 2010 snapshot data
- Builds career WAR lookup from stats files, loads 2010 snapshot, runs Analyses 1-10
- Run: `cd data/draft_data && python analyze_2010.py`

### `analyze_drafts.py`
- Original analysis of draft-year CSVs (2016-2021 data with embedded WAR)
- Run: `cd data/draft_data && python analyze_drafts.py`

### `triple_h_deep_dive.py`
- Focused analysis on whether personality can overcome talent tier
- Cross-tier comparisons (e.g., 3.0* Triple-H vs 4.0* Normal)
- Run: `cd data/draft_data && python triple_h_deep_dive.py`

---

## How to Repeat with Updated Data

### When the league advances and new draft classes have meaningful career data:

1. **Export new snapshot** (like the 2010 one but from a later year). Needs:
   - All active batters with: ID, POS, Name, Age, OVR, POT, LEA, LOY, AD, FIN, WE, INT, Type, scouting ratings, Draft, Round, Pick
   - All active pitchers with same personality columns + pitching scouting
   - Ensure batters file includes ID column

2. **Update stats file paths** if new yearly stats exist beyond 2021. In scripts, change:
   ```python
   for year in range(2000, 2022):  # bump upper bound
   ```

3. **Fetch draft logs** for any new draft years from:
   `https://atl-01.statsplus.net/world/draftyear/?year=YYYY`
   Compare draftee count from logs vs snapshot to measure attrition.

4. **Run scripts** — they're self-contained. Update file paths if directory structure changes.

5. **Key comparisons to re-check**:
   - Trait ranking by effect size (H vs L delta)
   - WE/AD/INT controlling for POT
   - Triple-H cross-tier comparison
   - Bust rates by POT tier
   - Draft round value curve

### For the existing draft-year CSVs (2016-2021):

Once enough career time passes (ideally 5+ years), re-export those draft classes with updated WAR and re-run `analyze_drafts.py`. The 2016 class should be most meaningful first (~5yr already), followed by 2018.

To add new draft-year CSVs: ensure they have at minimum: `Name, ID, POT, WAR, LEA, WE, INT` columns. Add a loading block in `analyze_drafts.py` following the existing pattern.

---

## Key Findings: 2008-2010 Draft Classes (n=663)

### Trait Ranking by Effect Size

Ranked by H avg WAR minus L avg WAR:

| Rank | Trait | H avg WAR (n) | N avg WAR (n) | L avg WAR (n) | H-L Delta |
|------|-------|---------------|---------------|---------------|-----------|
| **1** | **Adaptability (AD)** | **4.7** (110) | 2.4 (387) | 0.4 (166) | **+4.3** |
| **2** | **Work Ethic (WE)** | **3.3** (155) | 2.5 (389) | 0.3 (119) | **+3.0** |
| 3 | Loyalty (LOY) | 3.6 (106) | 1.9 (461) | 2.5 (96) | +1.0 |
| 4 | Intelligence (INT) | 2.7 (76) | 2.3 (520) | 1.8 (67) | +0.9 |
| 5 | Leadership (LEA) | 2.5 (61) | 2.4 (500) | 1.6 (102) | +0.8 |
| 6 | Greed (FIN) | 1.1 (96) | 2.6 (448) | 2.1 (119) | **-1.0** |

**Adaptability is the #1 trait** — even bigger effect than Work Ethic.
**Greed has a negative correlation** — high-greed players underperform.

### Work Ethic by Player Type (2008-2010)

**Pitchers:**
| WE | n | Avg WAR | MLB% | WAR>=3 | WAR>=10 |
|----|---|---------|------|--------|---------|
| H | 74 | 3.2 | 57% | 20% | 11% |
| N | 176 | 2.1 | 41% | 12% | 8% |
| L | 43 | 0.2 | 26% | 2% | 2% |

**Batters:**
| WE | n | Avg WAR | MLB% | WAR>=3 | WAR>=10 |
|----|---|---------|------|--------|---------|
| H | 81 | 3.3 | 47% | 12% | 10% |
| N | 213 | 2.8 | 42% | 14% | 10% |
| L | 76 | 0.3 | 17% | 4% | 1% |

WE effect is strong for both types. Low WE is devastating for batters (17% MLB vs 47% for High).

### WE Controlling for Potential (2008-2010)

**Elite POT (4.0-5.0*):**
| WE | n | Avg WAR | MLB% | Bust% | WAR>=3 |
|----|---|---------|------|-------|--------|
| H | 8 | 30.6 | 100% | 25% | 75% |
| N | 18 | 26.5 | 94% | 28% | 67% |

**Good POT (3.0-3.5*):**
| WE | n | Avg WAR | MLB% | Bust% | WAR>=3 |
|----|---|---------|------|-------|--------|
| H | 21 | 7.0 | 90% | 43% | 43% |
| N | 56 | 5.4 | 80% | 50% | 32% |
| L | 6 | 3.5 | 50% | 67% | 33% |

**Med POT (2.0-2.5*):**
| WE | n | Avg WAR | MLB% | Bust% | WAR>=3 |
|----|---|---------|------|-------|--------|
| H | 98 | 1.0 | 50% | 71% | 9% |
| N | 259 | 0.7 | 36% | 83% | 8% |
| L | 74 | 0.1 | 26% | 89% | 3% |

**Low POT (0.5-1.5*):**
| WE | n | Avg WAR | MLB% | Bust% | WAR>=3 |
|----|---|---------|------|-------|--------|
| H | 28 | 0.4 | 14% | 89% | 4% |
| N | 56 | -0.0 | 12% | 95% | 0% |
| L | 38 | 0.0 | 3% | 97% | 0% |

WE effect is consistent at every tier but can't save sub-2.0* talent.

### Adaptability Controlling for Potential (2008-2010)

**Med POT (2.0-2.5*) — the bulk of draftees:**
| AD | n | Avg WAR | MLB% | Bust% | WAR>=3 |
|----|---|---------|------|-------|--------|
| H | 64 | 1.5 | 45% | 80% | 12% |
| N | 253 | 0.8 | 37% | 79% | 9% |
| L | 114 | -0.0 | 33% | 88% | 2% |

### Trait Combinations (2008-2010)

| Combo | n | Avg WAR | MLB% | Bust% | WAR>=3 | WAR>=10 |
|-------|---|---------|------|-------|--------|---------|
| **All H (WE+INT+AD)** | **7** | **14.2** | **100%** | **14%** | **71%** | **57%** |
| H WE + H INT | 19 | 5.5 | 63% | 58% | 32% | 21% |
| H WE + H AD | 53 | 5.4 | 60% | 68% | 25% | 17% |
| H INT + H AD (not H WE) | 11 | 1.7 | 73% | 64% | 18% | 9% |
| H WE only (INT/AD!=H) | 90 | 2.4 | 48% | 67% | 12% | 8% |
| All Normal (WE+INT+AD) | 204 | 2.8 | 43% | 76% | 15% | 10% |
| Any L in WE/INT/AD | 254 | 0.8 | 28% | 88% | 6% | 4% |
| L WE (any INT/AD) | 119 | 0.3 | 20% | 90% | 3% | 2% |
| L AD (any WE/INT) | 166 | 0.4 | 27% | 90% | 3% | 1% |
| 2+ Low in WE/INT/AD | 79 | 0.1 | 20% | 91% | 1% | 0% |

### Cross-Tier Comparison: Personality vs Talent

**The key question: Does a 3.0* Triple-H beat a 4.0* Normal?**

| Group | n | Avg WAR | MLB% | Bust% | WAR>=5 | WAR>=10 |
|-------|---|---------|------|-------|--------|---------|
| 5.0* + Triple H | 2 | 25.1 | 100% | 0% | 100% | 100% |
| 5.0* + All Normal | 7 | 31.4 | 86% | 29% | 71% | 71% |
| 4.0* + H WE | 10 | 9.9 | 100% | 30% | 30% | 30% |
| 4.0* + All Normal | 12 | 7.5 | 100% | 42% | 33% | 25% |
| **3.0* + Triple H** | **5** | **9.8** | **100%** | **20%** | **40%** | **40%** |
| 3.0* + H WE | 60 | 3.6 | 72% | 57% | 22% | 13% |
| 3.0* + All Normal | 83 | 3.1 | 59% | 64% | 22% | 16% |
| 3.0* + Any Low | 69 | 1.1 | 55% | 72% | 9% | 6% |
| 2.5* + Triple H | 3 | 3.7 | 100% | 33% | 33% | 33% |
| 2.5* + Double H | 20 | 3.2 | 70% | 65% | 20% | 10% |
| 2.0* + H WE | 79 | 0.2 | 28% | 85% | 3% | 1% |
| 2.0* + All Normal | 100 | -0.0 | 20% | 93% | 0% | 0% |

**Answer: YES.** A 3.0* Triple-H (avg 9.8 WAR) outproduces a 4.0* All Normal (avg 7.5 WAR). That's roughly one full star of value from personality. Below 2.0* POT, personality can't overcome the talent deficit.

### Named Triple-H and Double-H Standouts (2008-2010)

**Triple-H players:**
- David Aldridge — POT 4.5*, Rd 1/Pk 6 (2010), pitcher → 31.4 WAR
- Ben Marek — POT 5.0*, Rd 1/Pk 3 (2010), batter → 18.7 WAR
- JUSTIN DELELLIS — POT 3.0*, Rd 4/Pk 6 (2010), pitcher → **33.9 WAR** (best value pick)
- SCOTT RICHARDSON — POT 2.5*, Rd 3/Pk 4 (2009), batter → 10.6 WAR
- Mike Palmer — POT 3.0*, Rd 3/Pk 17 (2009), pitcher → 4.1 WAR

**Double-H standouts (2.5-3.0* POT):**
- BRIAN HAYNES — POT 2.5*, WE+AD, Rd 4/Pk 10 (2010), batter → **39.5 WAR** (!!!)
- BILL DOUGHERTY — POT 3.0*, WE+AD, Rd 6/Pk 1 (2008), pitcher → 14.7 WAR
- Larry Haake — POT 2.5*, WE+AD, Rd 1/Pk 2 (2009), pitcher → 10.5 WAR
- SAM MURPHREE — POT 2.5*, WE+AD, Rd 6/Pk 11 (2008), batter → 9.4 WAR

BRIAN HAYNES is the poster child: 2.5* POT, Round 4, H WE + H AD → 39.5 career WAR. Top performer in the entire 2010 draft class.

### Bust Rates — 2010 Draft Class (10-year outcomes)

**Overall (n=181):**
| Metric | Count | Rate |
|--------|-------|------|
| Never reached MLB | 110 | 60.8% |
| Negative WAR (in MLB) | 32 | 17.7% |
| Total bust (never + neg) | 142 | 78.5% |
| Minimal value (WAR < 1) | 155 | 85.6% |
| Solid career (WAR >= 5) | 18 | 9.9% |
| Star career (WAR >= 15) | 14 | 7.7% |

**By type:**
| | Pitchers (87) | Batters (94) |
|---|---|---|
| Total bust | 73.6% | 83.0% |
| Solid (WAR>=5) | 10.3% | 9.6% |
| Star (WAR>=15) | 6.9% | 8.5% |

**By POT tier (2010 class):**
| POT | n | MLB% | Avg WAR | Bust% | Solid (>=5) |
|-----|---|------|---------|-------|-------------|
| 4.5-5.0* | 6 | 83% | 17.0 | 33% | 67% |
| 3.5-4.0* | 13 | 100% | 4.0 | 54% | 15% |
| 2.5-3.0* | 90 | 47% | 2.1 | 76% | 12% |
| 1.5-2.0* | 72 | 15% | 0.2 | 90% | 1% |

### Draft Round Value — 2008-2010 Combined

| Round | n | MLB% | Avg WAR | WAR>=5 | WAR>=15 |
|-------|---|------|---------|--------|---------|
| 1 | 53 | 83% | 14.2 | 25 | 19 |
| 2 | 56 | 75% | 5.3 | 15 | 9 |
| 3 | 51 | 73% | 2.9 | 7 | 3 |
| 4 | 54 | 48% | 2.7 | 9 | 4 |
| 5 | 48 | 52% | 0.5 | 3 | 0 |
| 6 | 48 | 50% | 1.5 | 5 | 2 |
| 7 | 50 | 34% | 0.5 | 2 | 1 |
| 8 | 46 | 24% | -0.0 | 0 | 0 |
| 9 | 48 | 29% | 0.5 | 1 | 1 |
| 10 | 48 | 23% | -0.0 | 0 | 0 |
| 11 | 45 | 4% | -0.0 | 0 | 0 |
| 12 | 47 | 15% | 0.3 | 2 | 0 |

Sharp dropoff after Round 4. Rounds 7+ average near-zero WAR.

### Draft Round Value — All Classes in Snapshot (survivor bias for pre-2008)

| Round | n | MLB% | Avg WAR |
|-------|---|------|---------|
| 1 | 176 | 86% | 20.0 |
| 2 | 170 | 78% | 5.3 |
| 3 | 155 | 73% | 3.6 |
| 4 | 146 | 60% | 2.2 |
| 5 | 141 | 47% | 0.9 |
| 6+ | diminishing | <42% | <1.1 |

### Personality Type Archetypes (full snapshot, survivor bias)

| Type | n | Avg WAR | Bust% | WAR>=3 | WAR>=10 |
|------|---|---------|-------|--------|---------|
| Captain | 20 | 17.6 | 15% | 75% | 55% |
| Fan Fav | 10 | 15.6 | 10% | 70% | 50% |
| Selfish | 17 | 14.1 | 12% | 53% | 41% |
| Disruptive | 10 | 20.8 | 20% | 50% | 50% |
| Normal | 390 | 8.5 | 36% | 35% | 21% |
| Prankster | 13 | 5.0 | 23% | 46% | 15% |
| Outspoken | 20 | 5.8 | 45% | 25% | 20% |
| Humble | 25 | 5.3 | 48% | 28% | 20% |
| Unknown | 223 | 4.5 | 45% | 27% | 17% |
| Sparkplug | 40 | 3.4 | 42% | 22% | 12% |
| Unmotivated | 19 | 1.1 | 58% | 26% | 0% |

**Caveat**: Heavy survivor bias here (only active players in 2010). Captain/Selfish/Fan Fav look amazing but are small samples of established veterans. The 2010 draftees are ALL "Unknown" type (too young to have developed archetypes).

### 2010 Draft Class Top 15 by WAR

| Rank | Name | WAR | Round/Pick | POT | Type | WE | INT |
|------|------|-----|-----------|-----|------|----|-----|
| 1 | BRIAN HAYNES | 39.5 | Rd 4/Pk 10 | 2.5* | batter | H | N |
| 2 | Erik Hilton | 37.8 | Rd 1/Pk 7 | 5.0* | batter | N | N |
| 3 | JUSTIN DELELLIS | 33.9 | Rd 4/Pk 6 | 3.0* | pitcher | H | H |
| 4 | JASON WILLIAMS | 31.7 | Rd 3/Pk 4 | 4.0* | batter | H | N |
| 5 | David Aldridge | 31.4 | Rd 1/Pk 6 | 4.5* | pitcher | H | H |
| 6 | JEREMY CARPENTER | 23.1 | Rd 3/Pk 5 | 3.0* | batter | H | N |
| 7 | PAUL SCHWARTZ | 20.6 | Rd 6/Pk 3 | 2.5* | pitcher | N | N |
| 8 | Ben Marek | 18.7 | Rd 1/Pk 3 | 5.0* | batter | H | H |
| 9 | MATT ROY | 18.1 | Rd 2/Pk 1 | 3.5* | batter | N | H |
| 10 | Bobby Miller | 17.8 | Rd 1/Pk 1 | 5.0* | pitcher | N | N |
| 11 | JUSTIN SOLOMON | 16.7 | Rd 6/Pk 11 | 2.5* | batter | N | N |
| 12 | JUAN VILLEGAS | 16.1 | Rd 2/Pk 15 | 3.0* | pitcher | N | N |
| 13 | ANDREW LEONHARDT | 15.9 | Rd 4/Pk 13 | 3.0* | pitcher | N | N |
| 14 | ALFONSO VANEGAS | 15.8 | Rd 2/Pk 18 | 3.0* | batter | N | H |
| 15 | JAY YANCHEK | 10.9 | Rd 12/Pk 4 | 1.5* | pitcher | H | N |

Notable: 4 of top 6 have H WE. #1 (BRIAN HAYNES) is a 2.5* with H WE. #15 (JAY YANCHEK) is a 1.5* from Round 12 with H WE — the ultimate long-shot hit.

### 2010 Round 1 Individual Outcomes

| Pick | Name | WAR | POT | Type | WE | INT |
|------|------|-----|-----|------|----|-----|
| 1 | Bobby Miller | 17.8 | 5.0* | pitcher | N | N |
| 2 | Miguel Fonseca | -0.9 | 4.0* | batter | N | N |
| 3 | Ben Marek | 18.7 | 5.0* | batter | H | H |
| 4 | Shane Dillenburg | 0.8 | 3.0* | pitcher | N | N |
| 5 | Ryan Kelley | 0.0 | 3.0* | pitcher | N | N |
| 6 | David Aldridge | 31.4 | 4.5* | pitcher | H | H |
| 7 | Erik Hilton | 37.8 | 5.0* | batter | N | N |
| 9 | DYLAN WEAVER | -3.8 | 5.0* | batter | H | N |
| 10 | MATT MYRICK | -0.2 | 3.5* | batter | H | N |
| 11 | ALEX WILTZ | -0.5 | 3.5* | pitcher | N | N |
| 12 | NICK CHANDLER | -3.6 | 3.0* | batter | N | L |
| 13 | JOHN SNYDER | 2.3 | 3.5* | pitcher | N | L |
| 15 | CHRIS MORRIS | -0.6 | 3.0* | pitcher | H | H |
| 16 | DAVID TELLEZ | 0.0 | 3.0* | pitcher | N | N |
| 17 | JOHN VALLEY | 0.0 | 3.0* | pitcher | N | N |
| 18 | RAUL SAPPINGTON | -3.5 | 2.5* | batter | N | H |
| 19 | JOSH JACOBS | 0.0 | 2.5* | batter | L | N |

---

## Practical Draft Strategy Takeaways

### Tier 1 Rules (strong signal)
1. **Never draft Low WE or Low AD below 3.5* POT** — 90%+ bust rate
2. **2+ Low traits in WE/INT/AD = auto-avoid** — 91% bust, 0% WAR>=10
3. **Triple-H (WE+INT+AD all High) adds ~1 full star of value** — a 3.0* Triple-H produces like a 4.0* Normal
4. **H WE + H AD is the best double combo** — avg 5.4 WAR (2008-2010), better than H WE + H INT (5.5 but smaller MLB%)

### Tier 2 Rules (moderate signal)
5. **Adaptability > Work Ethic > Intelligence** for effect size — AD was +4.3 delta, WE +3.0, INT +0.9
6. **High Greed (FIN=H) is a mild red flag** — these players underperform (avg 1.1 vs 2.1 for Low Greed)
7. **POT remains the dominant factor** — personality is a modifier, not a replacement. Below 2.0*, nothing helps
8. **Round 1-4 is where value lives** — avg WAR drops to near-zero after Round 6

### Tier 3 Rules (weak/noisy signal)
9. **Leadership (LEA) shows almost no effect** — H/N/L are all within noise
10. **Loyalty is inconsistent** — High LOY helps slightly, Low LOY isn't clearly bad
11. **Personality Type archetypes** — Captain/Fan Fav look great but we only see them on established veterans (survivor bias). All draftees start as "Unknown"

### Sweet Spot for Draft Steals
- **2.5-3.0* POT with H WE + H AD** — these go in Rounds 3-6 and produce like Round 1-2 picks
- At 2.5* with Double-H: avg 3.2 WAR, 70% MLB, 20% WAR>=5
- The draft doesn't appear to price personality: H WE players are drafted at the same round distribution as Normal players

---

## Findings from Original Draft-Year Analysis (analyze_drafts.py)

These are from the 2016-2021 draft-year CSVs (shorter career windows, different data format):

### Personality (shorter career data — 1-5 years)
- WE showed modest positive effect overall: H=0.88, N=0.68, L=0.60 avg WAR
- WE effect stronger for pitchers: H=0.58, N=0.41, L=0.16 (Low median goes negative)
- WE effect minimal for batters in this dataset (but 2010 data shows it matters with longer careers)
- LEA and INT: no effect (confirmed by 2010 data — LEA still nothing, INT shows small effect with 10yr data)

### Bust Rates (1-5yr career windows)
- All: 38.9% bust (<0 WAR), 59.8% disappointment (<1 WAR)
- Pitchers: 45.5% bust, 67.1% disappointment
- Batters: 28.9% bust, 48.6% disappointment
- POT 4.5-5.0*: 0% bust, 89.5% hit rate
- POT 1.5-2.0*: 57.5% bust

### Age at Draft
- HS players (17-18): avg WAR 1.17, 27.9% bust
- College (21-23): avg WAR 0.02, 56.8% bust

Note: these bust rates are lower than the 2010 analysis because the 2010 analysis includes "never reached MLB" as busts, while the draft-year CSVs only include players who got MLB time.

---

## Draft Pick Value Curve (2,887 picks, 2008-2020)

### Data Source & Method

Script `draft_pick_value.py` scrapes draft logs directly from StatsPlus URLs (`https://atl-01.statsplus.net/world/draftyear/?year=YYYY`). The HTML contains player IDs in hrefs (`href='/world/player/PID'`) AND career WAR (Bat WAR, Pitch WAR, Total WAR) already computed. No stats file lookup needed.

- 13 draft classes (2008-2020), 2,887 total picks scraped
- "Mature classes" = 5+ years of career data = 2008-2016 (2,010 picks, 9 classes)
- WAR in the HTML is cumulative through the current game date (mid-2021)
- StatsPlus Total WAR = Bat WAR + Pitch WAR (may differ slightly from stats file WAR which we used in personality analysis, because stats files only count one role per player)

**Note on names**: StatsPlus draft log names may differ from 2010 snapshot names (e.g., "Janos von Neumann" in draft log = "Bobby Miller" in snapshot for 2010 Rd1/Pk1). Player IDs are consistent.

### Overall Pick Value (Mature Classes, Individual Picks 1-30)

| OA Pick | n | Avg WAR | Med WAR | MLB% | Best Player (WAR) |
|---------|---|---------|---------|------|-------------------|
| 1 | 9 | 18.8 | 12.3 | 89% | Janos von Neumann (51) |
| 2 | 9 | 11.1 | 7.4 | 78% | Aaron Williams (44) |
| 3 | 9 | 6.9 | 1.5 | 67% | David Harby (34) |
| 4 | 9 | 8.8 | 5.7 | 100% | Brent Fortson (28) |
| 5 | 9 | 12.4 | 0.0 | 44% | Jeff Monroe (72) |
| 6 | 9 | 7.1 | 3.3 | 78% | Cecil Cantrell (32) |
| 7 | 9 | 16.4 | 6.5 | 100% | Joe Ross (50) |
| 8 | 8 | 7.6 | 1.4 | 62% | Trystan Traywick (34) |
| 9 | 9 | 2.5 | 0.0 | 44% | Danny Tobin (26) |
| 10 | 9 | 3.6 | 0.0 | 44% | Bill Johnson (25) |
| 11 | 9 | 8.8 | 3.0 | 56% | Gregor Mendel (60) |
| 12 | 9 | 14.3 | 1.8 | 67% | Matt Kelley (70) |
| 13 | 9 | 2.7 | 0.0 | 33% | Bobby Kaptein (19) |
| 14 | 8 | 3.6 | 1.9 | 62% | Henry Skrimshander (22) |
| 15 | 9 | 9.6 | 2.3 | 67% | Carl Linnaeus (58) |
| 16 | 9 | 1.6 | 0.0 | 56% | Jason Carranza (7) |
| 17 | 9 | 3.3 | 0.3 | 67% | Jean-Baptiste Lamarc (16) |
| 18 | 9 | 3.1 | 0.0 | 44% | Nate Brazil (19) |
| 19 | 9 | 8.5 | 0.7 | 56% | Steve Fontenot (74) |
| 20 | 8 | 4.9 | 1.4 | 50% | Matt Roy (17) |

Notable: Huge variance per pick (n=9 each). Pick #1 averages 18.8 but pick #5 has 12.4 avg driven by one 72-WAR outlier (Jeff Monroe) with a 0.0 median. Individual pick values are noisy; grouped values are more reliable.

### 5-Pick Group Value (Mature Classes)

| Pick Group | n | Avg WAR | MLB% | WAR>=5 | WAR>=15 |
|------------|---|---------|------|--------|---------|
| #1-5 | 45 | **11.6** | 76% | 53% | 27% |
| #6-10 | 44 | **7.4** | 66% | 39% | 20% |
| #11-15 | 44 | **7.9** | 57% | 27% | 16% |
| #16-20 | 44 | 4.3 | 55% | 20% | 11% |
| #21-25 | 44 | 1.5 | 27% | 11% | 5% |
| #26-30 | 45 | 2.3 | 31% | 13% | 7% |
| #31-35 | 44 | 3.3 | 59% | 18% | 9% |
| #36-40 | 45 | 4.2 | 47% | 31% | 9% |
| #41-45 | 44 | 2.3 | 41% | 11% | 7% |
| #46-50 | 45 | 1.6 | 42% | 13% | 4% |
| #51-55 | 39 | 2.9 | 44% | 18% | 3% |
| #56-60 | 43 | 1.9 | 28% | 12% | 5% |
| #61-70 | ~89 | ~1.7 | ~22% | ~12% | ~4% |
| #71-100 | ~170 | ~0.8 | ~25% | ~6% | ~1% |
| #101-130 | ~130 | ~0.3 | ~16% | ~3% | ~1% |
| #131-200 | ~280 | ~0.1 | ~12% | ~1% | ~0% |
| #201+ | ~200 | ~0.1 | ~5% | ~1% | ~0% |

**Interesting "second wave"**: Picks 31-55 (early Rd 2 to mid Rd 3) outperform late Rd 1 (picks 16-20). This could reflect comp picks, savvy drafting in the middle rounds, or that POT isn't perfectly correlated with draft order.

### Round-Level Value (Mature Classes)

| Round | n | Avg WAR | MLB% | WAR>=5 | WAR>=15 |
|-------|---|---------|------|--------|---------|
| 1 | 183 | **7.1** | 61% | 61 (33%) | 31 (17%) |
| 2 | 174 | 3.3 | 40% | 33 (19%) | 15 (9%) |
| 3 | 159 | 1.9 | 39% | 21 (13%) | 6 (4%) |
| 4 | 166 | 1.5 | 25% | 17 (10%) | 6 (4%) |
| 5 | 163 | 0.9 | 26% | 9 (6%) | 3 (2%) |
| 6 | 159 | 0.6 | 19% | 7 (4%) | 2 (1%) |
| 7 | 161 | 0.3 | 12% | 2 (1%) | 1 (1%) |
| 8 | 158 | 0.1 | 14% | 1 (1%) | 0 |
| 9 | 161 | 0.4 | 14% | 3 (2%) | 2 (1%) |
| 10+ | ~490 | ~0.0 | ~7% | ~2 total | 0 |

### WAR/Year Normalized (All Classes, 2+ Years)

Normalizing by career length to compare across draft classes:

| Round | n | WAR/Year | Avg Total WAR | MLB% |
|-------|---|----------|--------------|------|
| 1 | 251 | 0.53 | 5.2 | 49% |
| 2 | 229 | 0.26 | 2.5 | 31% |
| 3 | 212 | 0.15 | 1.5 | 30% |
| 4 | 221 | 0.12 | 1.1 | 19% |
| 5 | 217 | 0.08 | 0.7 | 21% |
| 6 | 212 | 0.04 | 0.4 | 14% |
| 7+ | ~860 | ~0.01 | ~0.1 | ~8% |

### Value Dropoff Thresholds

- **Avg WAR < 5.0**: OA pick #9 (~mid Round 1)
- **Avg WAR < 2.0**: OA pick #16 (~late Round 1)
- **Avg WAR < 1.0**: OA pick #22 (~early Round 2)
- **MLB rate < 50%**: OA pick #21 (~end of Round 1)

### Draft Class Summaries (2008-2020)

| Year | n | Years Data | Avg WAR | MLB (%) | WAR>=5 | Best Player (WAR) |
|------|---|-----------|---------|---------|--------|-------------------|
| 2008 | 275 | 13 | 2.4 | 54 (20%) | 24 | Steve Fontenot (74.4) |
| 2009 | 207 | 12 | 2.5 | 55 (27%) | 26 | Matt Kelley (70.4) |
| 2010 | 181 | 11 | 2.2 | 40 (22%) | 18 | Janos von Neumann (51.3) |
| 2011 | 198 | 10 | 1.6 | 52 (26%) | 17 | David Overholser (47.8) |
| 2012 | 255 | 9 | 1.2 | 57 (22%) | 23 | Bill Johnson (25.2) |
| 2013 | 225 | 8 | 1.2 | 52 (23%) | 17 | Brent Fortson (27.6) |
| 2014 | 229 | 7 | 0.6 | 54 (24%) | 11 | Matt Riga (14.8) |
| 2015 | 224 | 6 | 0.6 | 52 (23%) | 11 | Imbart van Vliet (14.8) |
| 2016 | 216 | 5 | 0.4 | 35 (16%) | 9 | Heliodoro Carrapa (17.4) |
| 2017 | 226 | 4 | 0.0 | 13 (6%) | 0 | Bogdan Loman (4.0) |
| 2018 | 211 | 3 | -0.0 | 4 (2%) | 0 | Michele Moravia (1.9) |
| 2019 | 211 | 2 | 0.0 | 5 (2%) | 0 | Paolo Janssen (1.3) |
| 2020 | 229 | 1 | 0.0 | 3 (1%) | 0 | John Shepard (2.5) |

### Top 30 Career WAR (All Draftees 2008-2020)

| Rank | Name | WAR | OA Pick | Round/Pick | Year | Team |
|------|------|-----|---------|-----------|------|------|
| 1 | Steve Fontenot | 74.4 | #19 | Rd2/Pk1 | 2008 | STU |
| 2 | Jeff Monroe | 72.0 | #5 | Rd1/Pk5 | 2008 | LON |
| 3 | Matt Kelley | 70.4 | #12 | Rd1/Pk12 | 2009 | LON |
| 4 | Gregor Mendel | 59.7 | #11 | Rd1/Pk11 | 2008 | GAL |
| 5 | Carl Linnaeus | 58.0 | #15 | Rd1/Pk15 | 2009 | GAL |
| 6 | Janos von Neumann | 51.3 | #1 | Rd1/Pk1 | 2010 | GAL |
| 7 | Joe Ross | 50.1 | #7 | Rd1/Pk7 | 2009 | HAV |
| 8 | David Overholser | 47.8 | #89 | Rd5/Pk15 | 2011 | NKO |
| 9 | Aaron Williams | 44.0 | #2 | Rd1/Pk2 | 2008 | RME |
| 10 | John Parks | 43.7 | #12 | Rd1/Pk12 | 2008 | LON |
| 11 | Brian Haynes | 40.7 | #64 | Rd4/Pk10 | 2010 | LON |
| 12 | Erik Hilton | 40.2 | #7 | Rd1/Pk7 | 2010 | LON |
| 13 | Tyler Dawson | 39.3 | #52 | Rd3/Pk15 | 2008 | SPA |
| 14 | Steve Gripp | 35.8 | #1 | Rd1/Pk1 | 2008 | ZAG |
| 15 | Justin DeLellis | 35.1 | #60 | Rd4/Pk6 | 2010 | RME |
| 16 | Dave Spuller | 34.5 | #1 | Rd1/Pk1 | 2011 | ZAG |
| 17 | Trystan Traywick | 34.0 | #8 | Rd1/Pk8 | 2008 | ADE |
| 18 | David Harby | 34.0 | #3 | Rd1/Pk3 | 2009 | HON |
| 19 | Sincere Williams | 33.4 | #37 | Rd2/Pk19 | 2008 | TOK |
| 20 | Jason Williams | 32.5 | #42 | Rd3/Pk4 | 2010 | HON |
| 21 | Cecil Cantrell | 32.3 | #6 | Rd1/Pk6 | 2010 | AMS |
| 22 | Mike Hawes | 32.2 | #21 | Rd2/Pk3 | 2009 | GAL |
| 23 | Brent Fortson | 27.6 | #4 | Rd1/Pk4 | 2013 | TOR |
| 24 | Mike Warner | 27.5 | #162 | Rd9/Pk17 | 2009 | STU |
| 25 | John Ranson | 27.0 | #33 | Rd2/Pk15 | 2008 | LON |
| 26 | Chris Wyckoff | 26.9 | #27 | Rd2/Pk5 | 2013 | RME |
| 27 | Danny Tobin | 26.4 | #9 | Rd1/Pk9 | 2009 | TOK |
| 28 | Bill Johnson | 25.2 | #10 | Rd1/Pk10 | 2012 | TOR |
| 29 | Sergio Ovevedo | 24.9 | #5 | Rd1/Pk5 | 2009 | RME |
| 30 | Cameron Finch | 24.1 | #60 | Rd4/Pk4 | 2011 | VAN |

Notable late-round gems: David Overholser (#89, 47.8 WAR), Brian Haynes (#64, 40.7 WAR), Mike Warner (#162, 27.5 WAR).

### Practical Draft Slot Valuation

**Tier 1 (Picks 1-8)**: Avg 11+ WAR. Franchise-altering picks. 75%+ MLB rate.
**Tier 2 (Picks 9-20)**: Avg 3-8 WAR. Solid starters. ~50% MLB rate. High variance.
**Tier 3 (Picks 21-55)**: Avg 1.5-4 WAR. Lottery tickets with upside. ~35% MLB rate.
**Tier 4 (Picks 56-100)**: Avg 0.5-2 WAR. Long-shot value plays. ~22% MLB rate. Personality matters most here.
**Tier 5 (Picks 101+)**: Avg <0.5 WAR. Near-zero expected value. <15% MLB rate.

---

## Data Gaps & Future Work

### Missing Data
- No batter CSVs for 2015, 2016, 2017 draft classes
- No data at all for 2020 draft class
- Personality Type archetype analysis needs non-survivor-biased data (e.g., a snapshot from 2025 looking at 2015-2020 draftees)

### Future Analysis Ideas
- Does WE effect compound over time? (compare 5yr vs 10yr WAR for same players)
- Position-specific personality effects (does WE matter more for catchers? pitchers?)
- Interaction between personality and injury proneness
- Does personality predict peak WAR or career longevity differently?
- Re-run on 2015-2020 draft classes once they have 5+ years of career data
