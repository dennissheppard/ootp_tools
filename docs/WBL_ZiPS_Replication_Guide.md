# WBL ZiPS Projection System — Replication Guide for Claude

**Purpose**: This document contains every constant, formula, file path, function signature, and design decision needed to rebuild the WBL ZiPS projection system from scratch. It is written for a future Claude instance with no prior context.

---

## 1. SYSTEM OVERVIEW

This is a Dan Szymborski ZiPS-inspired projection system for the **World Baseball League (WBL)**, an online OOTP Baseball 26 simulation league at www.WorldBaseballLeague.org. It projects the upcoming 2022 season for all active players using:

- 5-year weighted historical stats (2017–2021)
- MiLB stats with level-based discounting and star-rating boosting
- Empirical aging curves (different per skill type)
- Regression to the mean (different PA/BF thresholds per stat)
- OOTP OSA scouted rating blending (for ages ≤30)
- Park factors (half home / half away, handedness-specific)
- Platoon splits (vs RHP/LHP blended 60/40)
- Positional WAR adjustments
- Defensive value (ZR + catcher framing)
- UBR (Ultimate Base Running)
- Context-aware R/RBI estimation
- Injury history adjustment
- Team-level win projections

The system outputs 3 CSVs (batting, pitching, team projections), 1 JSON (player history for popup cards), and 1 JSON (park factors for frontend).

---

## 2. FILE LOCATIONS

### Script
- **`wbl_zips_projections.py`** — Session root. Single-file Python script (~2900 lines). Run with `python3 wbl_zips_projections.py`.

### Input Files (Source Data)

All under `mnt/WBL Current app/Zips data/`:

| File | Rows (approx) | Key Fields |
|---|---|---|
| `players_career_batting_stats.csv` | ~150K | player_id, year, level_id, split_id, pa, ab, h, hr, bb, k, d, t, sb, cs, hp, sf, sh, ibb, r, rbi, g, war, ubr, gdp, team_id |
| `players_career_pitching_stats.csv` | ~125K | player_id, year, level_id, split_id, bf, outs, ha, k, bb, er, r, gb, fb, hp, hra, g, gs, w, l, s, war, sf, sh, team_id |
| `players_career_fielding_stats.csv` | ~134K | player_id, year, level_id, split_id, position, ip, g, e, zr, framing |
| `players_injury_history.csv` | ~38K | player_id, date, length, day_to_day |
| `parks.csv` | 101 | park_id, name, avg, avg_l, avg_r, d, t, hr, hr_l, hr_r |
| `teams.csv` | 112 | team_id, name, abbr, nickname, park_id, level, sub_league_id, division_id |
| `players_roster_status.csv` | varies | player_id, team_id, league_id, position, role, is_active |

Under `mnt/WBL Current app/world baseball league/csv/`:

| File | Key Fields |
|---|---|
| `players.csv` | player_id, first_name, last_name, position, bats, throws, date_of_birth, team_id, retired, organization_id |
| `players_scouted_ratings.csv` | player_id, scouting_coach_id, scouting_team_id, overall_rating, talent_rating, batting_ratings_talent_contact, batting_ratings_talent_gap, batting_ratings_talent_eye, batting_ratings_talent_strikeouts, batting_ratings_talent_power, batting_ratings_talent_babip, running_ratings_speed, pitching_ratings_talent_stuff, pitching_ratings_talent_movement, pitching_ratings_talent_control, pitching_ratings_talent_hra, pitching_ratings_misc_ground_fly, pitching_ratings_misc_stamina |

### Output Files

All written to `mnt/WBL Current app/Zips data/` AND copied to `mnt/WBL Current app/world baseball league/csv/`:

| File | Description |
|---|---|
| `wbl_zips_batting_projections_2022.csv` | One row per projected batter |
| `wbl_zips_pitching_projections_2022.csv` | One row per projected pitcher |
| `wbl_zips_team_projections_2022.csv` | One row per WBL team |
| `wbl_zips_player_history.json` | Year-by-year MLB stats for popup cards |
| `wbl_zips_parks.json` | Park factors per WBL team for frontend |

---

## 3. CONFIGURATION CONSTANTS

```python
PROJECTION_YEAR = 2022
HISTORY_YEARS = [2017, 2018, 2019, 2020, 2021]
YEAR_WEIGHTS = {2017: 1, 2018: 2, 2019: 3, 2020: 4, 2021: 5}
MLB_LEVEL = '1'
OVERALL_SPLIT = '1'
VS_RHP_SPLIT = '2'
VS_LHP_SPLIT = '3'
```

### Level IDs
- 1 = WBL (MLB equivalent, league 200)
- 2 = AAA
- 3 = AA
- 4 = A (league 203)
- 6 = RL / Rookie League (league 204)
- 10/11 = International

### MiLB Level Discounts
How much to weight MiLB stats vs MLB (1.0):
```python
MILB_LEVEL_DISCOUNT = {'2': 0.55, '3': 0.38, '4': 0.22, '6': 0.12, '10': 0.05, '11': 0.05}
```

### Star-Rating MiLB Boost
Multiplied on top of base discount. Higher stars = MiLB stats more predictive:
```python
STAR_MILB_BOOST = {10: 1.40, 9: 1.30, 8: 1.20, 7: 1.10, 6: 1.00, 5: 0.90, 4: 0.80}
```

### Positional WAR Adjustments (runs/162 games)
```python
POSITION_ADJ = {
    '2': 12.5,    # C
    '6': 7.5,     # SS
    '8': 2.5,     # CF
    '4': 2.5,     # 2B
    '5': 2.5,     # 3B
    '7': -7.5,    # LF
    '9': -7.5,    # RF
    '3': -12.5,   # 1B
    '0': -17.5,   # DH
    '10': -5.0,   # OF (generic)
    '11': 0.0,    # IF (generic)
    '12': 0.0,    # UT
    '1': 0.0,     # P
}
```

### Batting Regression PA Thresholds (PA needed for stat to stabilize)
```python
BATTING_REGRESSION_PA = {
    'bb_rate': 200, 'k_rate': 150, 'iso': 300,
    'babip': 400, 'hr_rate': 350, 'speed': 100
}
```

### Pitching Regression BF Thresholds
```python
PITCHING_REGRESSION_BF = {
    'k_rate': 200, 'bb_rate': 250, 'hr_rate': 400,
    'babip': 500, 'gb_rate': 150
}
```

---

## 4. OOTP CONVENTIONS (CRITICAL)

### Handedness Encoding
OOTP uses numeric codes, NOT letters:
- `1` = Right
- `2` = Left
- `3` = Switch

Both `bats` and `throws` fields use this encoding. You MUST normalize before any handedness-dependent logic:
```python
def _normalize_hand(val):
    if val in ('L', '2'): return 'L'
    elif val in ('R', '1'): return 'R'
    elif val in ('S', '3'): return 'S'
    return 'R'
```

### Rating Scale
- Individual ratings (`batting_ratings_talent_contact`, etc.): **20–80 scale** (20=worst, 50=average, 80=best)
- Star ratings (`overall_rating`, `talent_rating`): **1–10 scale** where 4=2★, 5=2.5★, 6=3★, 7=3.5★, 8=4★, 9=4.5★, 10=5★
- **IMPORTANT**: All `_overall_` individual rating fields (e.g., `batting_ratings_overall_contact`) are intentionally **zeros** in this league. Only `_talent_` fields have data. Use `_talent_` fields exclusively.

### OSA Ratings Filter
Only use scouted ratings where `scouting_coach_id = -1` AND `scouting_team_id = 0`. These are the OSA (Outside Scouting Agency) ratings — the "truth" ratings.

### Rookie Eligibility
- Batters: career WBL AB < 130
- Pitchers: career WBL IP < 50
- Two-way players: if NOT rookie on either side, set `rookie=0` on BOTH sides

---

## 5. AGING CURVES

Each skill type has its own peak age and decline rate. The function returns a multiplicative factor.

### Batting Aging Curves
```python
# (peak_age, pre_peak_gain_per_year, post_peak_decline_per_year)
'bb_rate':  (28, +0.008, -0.003)
'k_rate':   (25, -0.005, +0.006)   # K% improves toward peak, worsens after
'iso':      (27, +0.010, -0.008)
'babip':    (26, +0.003, -0.004)
'speed':    (25, +0.005, -0.012)
'hr_rate':  (27, +0.008, -0.007)
'general':  (27, +0.005, -0.005)
```

Formula: If age ≤ peak: `1.0 + (pre_gain × (peak - age) × -1)`. If age > peak: `1.0 + (post_decline × (age - peak))`.

### Pitching Aging Curves
```python
'k_rate':   (26, +0.006, -0.007)
'bb_rate':  (29, -0.003, +0.004)
'hr_rate':  (27, -0.002, +0.005)
'gb_rate':  (27, +0.002, -0.003)
'general':  (27, +0.005, -0.006)
'stamina':  (28, +0.003, -0.008)
```

### Defensive Aging
```python
if age > 27: factor = max(0.40, 1.0 - (age - 27) * 0.035)
elif age < 24: factor = 0.85 + (age - 20) * 0.0375
else: factor = 1.0
```

---

## 6. PARK FACTORS

### Half Home / Half Away Model
```python
effective_factor = (raw_park_factor + 1.0) / 2.0
```
This accounts for playing half games at home, half on the road.

### Batter Park Factors
- HR: Uses `hr_l` for LHB, `hr_r` for RHB, `hr` for switch hitters
- AVG: Uses `avg_l` for LHB, `avg_r` for RHB, `avg` for switch
- 2B: Uses `d` (no handedness split)
- 3B: Uses `t` (no handedness split)

### Pitcher Park Factors — OPPOSITE HAND LOGIC
Pitchers face the opposite hand predominantly:
- LHP faces mostly RHB → use **RH batter** park factors (`hr_r`, `avg_r`)
- RHP faces mostly LHB → use **LH batter** park factors (`hr_l`, `avg_l`)

### Application to Stats
**Batters:**
```python
hr_rate *= pf_hr
babip *= pf_avg        # Park avg factor affects BABIP
iso *= (pf_hr * 0.6 + pf_avg * 0.4)  # HR factor dominates ISO
```

**Pitchers:**
```python
hr_rate *= pf_hr
babip *= pf_avg
```

### Park Effects String
For display column. Shows `+HR`, `-AVG`, `+2B` etc. with handedness suffix (LH/RH/SW for batters, none for pitchers). Only shown if deviation > 2% from neutral.

---

## 7. OOTP RATINGS → STAT CONVERSION

### Development Scale
Players whose `overall_rating < talent_rating` are still developing. Their talent ratings are scaled toward league average:
```python
dev_scale = max(0.40, overall_rating / talent_rating)
scaled_rating = 50 + (talent_val - 50) * dev_scale
```
League average for the 20-80 scale is 50 (not 40).

### Batting Ratings → Stats (Calibrated to WBL Averages)
```python
bb_rate  = 0.012 + (eye - 20) / 60 * 0.108       # 20→.012, 50→.066, 80→.120
k_rate   = 0.243 - (k_rating - 20) / 60 * 0.180   # 20→.243, 50→.153, 80→.063
iso      = 0.006 + (power - 20) / 60 * 0.244       # 20→.006, 50→.128, 80→.250
babip    = 0.250 + (babip_rating - 20) / 60 * 0.120 # 20→.250, 50→.310, 80→.370
hr_rate  = (power - 20) / 60 * 0.040               # 20→.000, 50→.020, 80→.040
sb_per_600 = max(0, (speed - 30) / 50 * 35)
```

All outputs clamped:
```python
bb_rate:  [0.010, 0.150]
k_rate:   [0.040, 0.300]
iso:      [0.005, 0.300]
babip:    [0.220, 0.380]
hr_rate:  [0.001, 0.050]
```

### Pitching Ratings → Stats
```python
k_rate  = 0.063 + (stuff - 20) / 60 * 0.180       # 20→.063, 50→.153, 80→.243
bb_rate = 0.112 - (control - 20) / 60 * 0.092      # 20→.112, 50→.066, 80→.020
hr_rate = 0.035 - (hra_rating - 20) / 60 * 0.030   # 20→.035, 50→.020, 80→.005
gb_rate = 0.35 + (gbf - 20) / 60 * 0.25
babip   = 0.340 - (movement - 20) / 60 * 0.076     # 20→.340, 50→.302, 80→.264
```

Clamped:
```python
k_rate:  [0.05, 0.40]
bb_rate: [0.02, 0.15]
hr_rate: [0.005, 0.050]
gb_rate: [0.25, 0.65]
babip:   [0.240, 0.350]
```

### `safe_int()` Default
Missing or 0-value ratings default to **20** (OOTP minimum), not 40 or 50. This gives replacement-level stats for truly missing data.

---

## 8. BATTING PROJECTION PIPELINE

### Step 1: Collect Weighted Stats
For each player, iterate all `(year, level, split)` entries in batting stats:
- Only use `split_id = 1` (overall)
- `combined_weight = YEAR_WEIGHTS[year] × level_weight`
- MLB: `level_weight = 1.0`
- MiLB: `level_weight = min(0.80, MILB_LEVEL_DISCOUNT[level] × STAR_MILB_BOOST[stars])`
- Skip if PA < 10
- Track `raw_pa_total` (unweighted MLB PA only) and `raw_milb_pa` separately

If `weighted_pa < 50`, fall through to ratings-only projection (`_project_batter_from_ratings`).

### Step 2: Calculate Weighted Rates
```python
bb_rate = weighted_bb / weighted_pa
k_rate = weighted_k / weighted_pa
hr_rate = weighted_hr / weighted_pa
babip = (weighted_h - weighted_hr) / (weighted_ab - weighted_k - weighted_hr + weighted_sf)
iso = SLG - AVG (from weighted totals)
```

### Step 3: Platoon Split Blend
Extract vs-RHP (split 2) and vs-LHP (split 3) rates separately with year weights. Need ≥50 weighted PA per split.
- Blend: 60% vs RHP + 40% vs LHP
- Only adjust HR rate and ISO (most meaningful split effects)
- Blend 50/50 with overall rates: `hr_rate = overall * 0.5 + platoon * 0.5`

### Step 4: Regression to the Mean
For MiLB-only players (no MLB PA), give partial credit:
```python
milb_reg_credit = {AAA: 0.45, AA: 0.35, A: 0.20, RL: 0.10}
effective_pa = raw_milb_pa × milb_reg_credit × star_boost
```

Regression formula:
```python
regressed = (player_val × effective_pa + league_val × regression_pa) / (effective_pa + regression_pa)
```

### Step 5: Aging Curve
Multiply each rate stat by its age-specific factor.

### Step 6: OOTP Ratings Blend (age ≤ 30)
```python
# Experience-based weight (includes MiLB credit)
base_weight = max(0.05, 0.80 × e^(-effective_experience_pa / 400))

# Age taper past 27
if age > 27: base_weight *= max(0.20, 1.0 - (age - 27) * 0.25)

# Sanity check: if ISO diverges > 0.060 from ratings estimate with 300+ PA, halve weight
if raw_pa > 300 and |iso - ootp_iso| > 0.060: base_weight *= 0.50

ratings_weight = clamp(base_weight, 0.05, 0.80)

# Blend each rate stat
stat = stat × (1 - ratings_weight) + ootp_estimate × ratings_weight
```

### Step 7: Park Factor Application
See Section 6 above.

### Step 8: Clamp Rates
```python
bb_rate: [0.02, 0.20]
k_rate:  [0.05, 0.40]
iso:     [0.020, 0.350]
babip:   [0.200, 0.380]
hr_rate: [0.002, 0.070]
```

### Step 9: Playing Time
Weighted recent games (2021=50%, 2020=30%, 2019=20% if 3 years; 60/40 if 2; 85% if 1).
- Age ≥ 35: `× max(0.60, 1.0 - (age - 35) * 0.06)`
- Age ≤ 22: `× min(1.10, cap at 162)`
- No MLB games: use star-rating scale (4→30G, 5→50G, 6→80G, 7→100G, 8+→120G)

### Step 10: Injury Adjustment
Recent injuries (2019+, length > 7 days):
- 3+: `× 0.80`
- 2: `× 0.88`
- 1: `× 0.93`

Final: `games = clamp(games, 20, 162)`, `PA = games × 4.1`

### Step 11: Build Counting Stats
```python
proj_bb = PA × bb_rate
proj_k = PA × k_rate
proj_hr = PA × hr_rate
proj_hp = PA × 0.008
proj_sf = PA × 0.006
proj_ab = PA - bb - hp - sf

BIP = AB - K - HR
proj_h = round(babip × BIP) + HR

# Extra-base hits from ISO
proj_tb = (AVG_from_components + iso) × AB
xbh_non_hr = TB - H - 3×HR
proj_d = xbh_non_hr × 0.85 × pf_d
proj_t = xbh_non_hr × 0.15 × pf_t × age_speed_factor

# SB/CS
sb_opportunities = (singles + BB) × 0.10
proj_sb = sb_opportunities × sb_rate × age_speed_factor
proj_cs = sb × (1 - sb_rate) / sb_rate
```

### Step 12: UBR (Ultimate Base Running)
```python
ubr_per_pa = weighted_ubr / weighted_pa
# Regress: needs 500 PA, league mean = -0.001/PA
ubr_per_pa = ubr_per_pa × reliability + (-0.001) × (1 - reliability)
ubr_per_pa *= age_speed_factor
proj_ubr = ubr_per_pa × PA
```
Ratings-only projections use league-average UBR: `-0.001 × PA`.

### Step 13: Context-Aware R/RBI
```python
off_quality = (OBP × 1.8 + SLG) / 2.0
quality_ratio = off_quality / 0.38  # 0.38 = league average combined
pt_factor = min(1.0, games / 140)

# Runs: OBP-driven
obp_factor = OBP / 0.330
runs_rate = lg_r_per_pa × obp_factor × (quality_ratio ^ 0.3)
R = PA × runs_rate + SB × 0.15  # speed bonus
R *= (0.85 + 0.15 × pt_factor)

# RBI: SLG-driven
slg_factor = SLG / 0.420
rbi_rate = lg_rbi_per_pa × slg_factor × (quality_ratio ^ 0.3)
RBI = PA × rbi_rate + HR × 0.10
RBI *= (0.85 + 0.15 × pt_factor)
```

### Step 14: Defensive Value
From `players_career_fielding_stats.csv` (split_id=0 only, MLB level, IP ≥ 50, skip position=1):
```python
# Weighted ZR per IP across years
zr_per_ip = weighted_zr / weighted_ip

# Regression: ZR needs ~3000 IP to stabilize
zr_rate = (zr_per_ip × raw_ip) / (raw_ip + 3000)

# Apply aging factor
# Project over full season (1350 IP)
def_runs = zr_rate × 1350
framing_runs = framing_rate × 1350  # Same process for catchers

# Scale by playing time
def_runs *= (proj_games / 162)
```

### Step 15: WAR Calculation (OOTP-Calibrated)
Regression-fitted to 1,396 MLB player-seasons (2017–2021) against OOTP's internal WAR. R² = 0.934.

```python
WAR = 0.06851 × singles
    + 0.09879 × doubles
    + 0.11612 × triples
    + 0.15756 × HR
    + 0.05080 × BB
    + 0.03631 × HBP
    + 0.02828 × SB
    - 0.03269 × CS
    + 0.12234 × UBR
    - 0.02093 × PA        # out-cost
    + 0.08500 × pos_adj   # POSITION_ADJ[pos] × (games/162)
    + 0.10020 × def_runs  # ZR + framing
    - 0.04759              # intercept
```

---

## 9. PITCHING PROJECTION PIPELINE

### Steps 1–6: Identical Structure to Batting
Same weighted stats collection, regression, aging, and OOTP blend — but using BF instead of PA, and pitching-specific rate stats (K%, BB%, HR%, BABIP, GB%).

Key differences:
- Weighted BF threshold: 50 (vs 50 PA for batters)
- Ratings blend decay: `e^(-experience/500)` (vs `/400` for batters)

### SP/RP Classification
Most recent MLB season takes priority:
```python
if most_recent_season has ≥10 G:
    if GS/G ≥ 0.80: starter
    elif GS/G ≤ 0.20: reliever
    else: fall back to weighted career average (>50% GS = starter)
else:
    weighted career GS/G > 0.50 = starter
```

### Playing Time (Pitchers)
Same recent-year weighting. For role-switchers: if classified as starter but weighted GS diluted by old RP years, use most recent season × 0.90.

Star-based (no MLB games):
- **Starters**: 4→40IP, 5→60IP, 6→100IP, 7→140IP, 8+→180IP
- **Relievers**: 4→20IP, 5→35IP, 6→50IP, 7+→65IP

### ERA Formula
Blended 45% FIP + 55% Component ERA:
```python
FIP = (13 × HR + 3 × (BB + HBP) - 2 × K) / IP + 3.20

Component_ERA = 0.5618 × (H-HR)/9 + 1.5600 × HR/9 + 0.3500 × BB/9 - 0.0735 × K/9 - 2.5582

ERA = FIP × 0.45 + Component_ERA × 0.55
ERA = clamp(1.50, 7.00)
```

The component ERA coefficients were regression-fitted from 100 WBL team-seasons (2017–2021).

### Pitching rWAR (RA9-Based, Baseball-Reference Style)
```python
lg_RA9 = lg_ERA × 1.10       # unearned run factor
replacement_RA9 = lg_RA9 + 1.00  # replacement level
pitcher_RA9 = total_R × 9 / IP
runs_above_replacement = (replacement_RA9 - pitcher_RA9) × (IP / 9)
rWAR = max(-2.0, runs_above_replacement / 10.0)
```

### Team Defense Adjustment (Post-Processing)
After all batting projections are generated, aggregate defensive runs by team:
```python
team_def_per_9 = sum(player_def_runs) × 9 / sum(player_defensive_IP)
```
Then adjust each pitcher's ERA:
```python
era_adj = -team_def_per_9 × 0.55  # Only component ERA (55%) is defense-dependent
pitcher_ERA += era_adj
# Recalculate ER, R, and rWAR from new ERA
```

---

## 10. RATINGS-ONLY PROJECTIONS

For players with `weighted_pa < 50` (or `weighted_bf < 50`) who have OSA ratings.

### Key Differences from Stats-Based
1. Rates come from `ootp_batting_estimates()` / `ootp_pitching_estimates()` instead of historical stats
2. Regression: `ratings_pct = min(0.80, 0.50 + ovr_stars × 0.03)` — higher stars = less regression
3. MiLB stats blended if available (see below)
4. Playing time from star rating (see Section 8, Step 9)
5. UBR assumed league-average: `-0.001 × PA`
6. Defensive value = 0 (no fielding data)
7. Always `rookie = 1`
8. Pure pitchers (position=1 with 0 career batting PA) excluded from batting projections

### MiLB Stats Blend in Ratings Projections
When a prospect has MiLB stats alongside ratings:
```python
# Base weight by level
base_milb_w = {AAA: 0.35, AA: 0.25, A: 0.15, RL: 0.08}

# Star boost
milb_weight = min(0.50, base_milb_w × STAR_MILB_BOOST[stars])

# Sample size scaling: needs 300+ weighted PA/BF for full credit
milb_weight *= min(1.0, milb_pa / 300)

# Blend
stat = ratings_estimate × (1 - milb_weight) + milb_stat × milb_weight
```

---

## 11. EFFECTIVE POSITION DETECTION

After projections are generated, reclassify each batter's position based on actual playing history:

### Recency Weights
```python
{2021: 3.0, 2020: 2.0, 2019: 1.5, 2018: 1.0, 2017: 0.5}
```

### DH Detection
If weighted fielding games < 40% of weighted batting games → DH.

### Position Detection
- Group OF sub-positions (LF=7, CF=8, RF=9) into single "OF" bucket for majority detection
- Position with most weighted games wins
- For OF, pick the specific sub-position (7/8/9) with most games
- Skip if total weighted batting games < 50

---

## 12. TEAM PROJECTIONS

```python
REPLACEMENT_WINS = 48  # replacement-level team wins in 162-game season

for each team:
    bat_war = sum of batter WAR on team
    pit_war = sum of pitcher WAR on team
    total_war = bat_war + pit_war
    proj_wins = clamp(REPLACEMENT_WINS + total_war, 40, 120)
    proj_losses = 162 - proj_wins
    team_era = sum(ER) × 9 / sum(IP)
```

---

## 13. TWO-WAY PLAYER HANDLING

### Classification
A player appearing in both batting and pitching projections is "two-way" only if ALL of:
1. Played both roles in 2020–2021
2. ≥ 50 PA batting at WBL level in that period
3. ≥ 10 IP pitching at WBL level in that period

Otherwise, classified by primary role.

### Rookie Cross-Check
After both projections are generated, if a two-way player is NOT rookie on one side (e.g., 76+ IP), set `rookie=0` on BOTH sides.

### History JSON Format
Two-way players use nested format:
```json
{"2021": {"bat": {"pa":400,"avg":0.280,...}, "pit": {"g":20,"era":3.50,...}}, "twoway": true}
```

---

## 14. ELIGIBILITY RULES

### Stats-Based Eligibility
- Batters: ≥30 PA at WBL level in any year ≥ 2019, not retired
- Pitchers: ≥30 BF at WBL level in any year ≥ 2019, not retired
- Unaffiliated (team_id=0): only if ≥100 recent WBL PA/BF

### Ratings-Based Eligibility (Prospects)
- Must be affiliated with a team (team_id ≠ 0)
- Age 18–30
- `overall` score ≥ 80 OR `talent_rating` ≥ 6 (3★ potential)
- Must have scouted ratings in `players_scouted_ratings.csv`
- Pure pitchers excluded from batting eligibility

### MiLB-Based Eligibility
- Affiliated, not retired, age 18–28
- Must have scouted ratings
- ≥300 year-weighted PA/BF at AAA or AA
- Catches overperforming minor leaguers without top-tier ratings

---

## 15. OUTPUT CSV COLUMNS

### Batting CSV
`player_id, name, team_id, position, age, bats, g, pa, ab, h, d, t, hr, r, rbi, bb, k, sb, cs, avg, obp, slg, ops, babip, iso, bb_pct, k_pct, def_runs, war, park_name, park_effects, rookie`

### Pitching CSV
`player_id, name, team_id, position, age, throws, role, g, gs, ip, w, l, s, era, fip, whip, k, bb, ha, hra, er, r, k9, bb9, hr9, k_pct, bb_pct, babip, gb_pct, war, park_name, park_effects, rookie`

### Team CSV
`team_id, name, abbr, nickname, sub_league_id, division_id, proj_wins, proj_losses, bat_war, pit_war, total_war, proj_r, proj_hr, proj_rbi, proj_sb, team_era, batters, pitchers, park_name`

---

## 16. DATA FLOW DIAGRAM

```
players.csv ──────────┐
players_scouted_ratings.csv ──┤
players_roster_status.csv ────┤
                              ├──> load_players() + load_roster_status() → players dict (team_id overridden)
                              │
batting_stats.csv ────────────┤
pitching_stats.csv ───────────┤──> load_batting_stats() / load_pitching_stats()
fielding_stats.csv ───────────┤──> load_fielding_stats()
injury_history.csv ───────────┤──> load_injury_history()
parks.csv + teams.csv ────────┤──> build_team_park_map()
                              │
                              ├──> calculate_league_averages_batting/pitching()
                              │
                              ├──> Determine eligible batters/pitchers
                              │    (stats-based → ratings-based → MiLB-based)
                              │
                              ├──> project_batter() for each eligible batter
                              │    └──> _project_batter_from_ratings() if insufficient stats
                              │
                              ├──> calculate_team_defensive_runs() from batting projections
                              │
                              ├──> project_pitcher() for each eligible pitcher
                              │    └──> _project_pitcher_from_ratings() if insufficient stats
                              │
                              ├──> Apply team defense ERA adjustment to pitchers
                              ├──> Two-way player rookie cross-check
                              ├──> Effective position reclassification
                              │
                              └──> Write CSVs + History JSON + Parks JSON + Team Projections
```

---

## 17. KNOWN GOTCHAS AND LESSONS LEARNED

1. **OOTP `_overall_` rating fields are all zeros** — This league intentionally blanks them. Only `_talent_` fields have data. Don't try to use overall individual ratings.

2. **Handedness is numeric** — `1=R, 2=L, 3=S`. Always normalize before use.

3. **`safe_int()` default must be 20, not 40 or 50** — Missing ratings should produce replacement-level output, not league-average.

4. **`_scale_rating()` league_avg must be 50** — The OOTP 20–80 scale has midpoint at 50.

5. **MiLB regression bug** — If you only use MLB PA for regression `effective_pa`, MiLB-only players get 100% regressed to league average, erasing their actual stats. Always add MiLB PA credit.

6. **Unaffiliated player filtering** — Players with `team_id=0` after roster status update should be excluded from prospect/MiLB eligibility. Only free agents with 100+ recent WBL PA/BF get projections.

7. **Pure pitcher batting exclusion** — Position=1 players with 0 career PA appear in batting stats as ghost rows. Filter them out with `_is_pure_pitcher()`.

8. **SP/RP classification for role-switchers** — Most recent season must take priority. Otherwise, a pitcher who switched from RP to SP gets classified as RP because old years dilute the weighted average.

9. **Two-way player popup handling** — History JSON must use nested `{bat:{}, pit:{}}` format for genuine two-way players, not flat stats (which would overwrite batting with pitching).

10. **Park factor for pitchers uses opposite hand** — This is easy to forget. LHP → use RHB factors.

11. **The component ERA regression was fitted to WBL data specifically** — The coefficients `(0.5618, 1.5600, 0.3500, -0.0735, -2.5582)` may not work for other leagues.

12. **The WAR regression was fitted to OOTP's internal WAR** — The coefficients are specific to how OOTP calculates WAR and may differ from real baseball WAR.

---

## 18. FRONTEND (projections.html) OVERVIEW

The HTML page is a self-contained SPA with 6 tabs: **Batting, Pitching, Standings, Awards, Free Agents, Top Rookies**. It loads the 3 CSVs + 2 JSONs at startup, builds all tables client-side with JavaScript.

Key frontend features:
- Firebase integration for live roster updates (`playerRosterStatus`)
- Team dropdown filters (synced across tabs)
- Sortable columns with WAR color coding
- Depth chart view (baseball field layout) for individual teams
- All-Star depth charts (batting + pitching) with NL/SL/All-WBL toggle
- Player popup cards with 5-year history and WAR trend
- "Next Man Up" section showing top rookie prospects per team
- Global search across both batting and pitching
- Mobile responsive with abbreviated columns
- Park factor column with colored arrows

The frontend is documented in the session MD file (`2026-03-15-wbl-zips-projection-system.md`), version history sections v4.2 through v5.9.

---

*Last updated: 2026-03-16*
