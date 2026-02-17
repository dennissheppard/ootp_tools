# WBL Analysis System

OOTP analysis application for the WBL (World Baseball League). Synthesizes scouting ratings and historical performance to generate True Ratings for pitchers and batters, project future performance, track player development, and evaluate organizational depth.

## Quick Start

```bash
npm install
npm run dev    # Development server (port 5173)
npm run build  # Production build
```

## Technology Stack

- TypeScript + Vite
- IndexedDB v7 for client-side storage
- ApexCharts for data visualization
- Vanilla CSS (dark theme)

## Project Structure

```
src/
├── components/   # Reusable UI components (DevelopmentChart)
├── models/       # TypeScript interfaces
├── services/     # Business logic layer
├── views/        # View components
└── controllers/  # Data orchestration
```

## Core Features

### True Ratings (TR)
Blends scouting grades with actual performance stats to produce a 0.5-5.0 star rating for current MLB players.

**Algorithm:**
```typescript
trueRating = (scoutingProjection × 0.5) + (statsBasedRating × 0.5)
confidence = min(IP / 150, 1.0)  // or PA for batters
finalRating = (trueRating × confidence) + (scoutingProjection × (1 - confidence))
```

**For Batters:**
- Uses tier-aware regression that regresses elite hitters toward elite targets (not league average)
- Component-specific stabilization constants (BB%: 120 PA, K%: 60 PA, HR%: 160 PA, AVG: 300 PA)
- **Percentile-based component ratings** - Contact, Power, Eye, and AvK ratings are calculated by ranking players within each season (not absolute thresholds). This ensures league leaders always receive elite ratings regardless of year-to-year offensive environment changes.
- **HR%-based power estimation** (not ISO-based) to correctly distinguish gap hitters from power hitters
- **WAR-based ranking** - Final TR percentiles are determined by WAR per 600 PA (not wOBA), which incorporates baserunning value from SB/CS alongside hitting. Using standardized 600 PA keeps TR as a rate-based "how good" measure rather than penalizing injured players for fewer PA.

### True Future Rating (TFR)

A **pure peak/ceiling projection system** that projects what a prospect's age-27 peak season would look like if everything goes right. TFR answers: *"If this prospect develops perfectly, what would that season look like?"*

#### Pitcher TFR

**Algorithm Flow:**

1. **Convert scout potential ratings to projected peak rates** (100% scouting)
   - Stuff → K/9, Control → BB/9, HRA → HR/9
   - MiLB stats affect TR (development curves), not TFR (ceiling projection)

2. **Apply ceiling boost** — Scale projections proportionally above average
   - `ceilingValue = meanValue + (meanValue - avgAtRating50) × 0.30`
   - At rating 50 (average): no boost. At rating 80 (elite): significant boost
   - Pitcher boost (0.30) is lower than batter boost (0.35) because pitcher scouting slopes are ~2.5x smaller

3. **Find each component's percentile in MLB distribution** (2015-2020, ages 25-29, 50+ IP)
   - Each prospect's boosted rate is compared directly against the MLB peak-age distribution
   - Stuff (K/9), Control (BB/9), HRA (HR/9) all ranked against MLB distributions

4. **Calculate FIP** from mapped rates with clamping:
   - K9: 3.0 to 13.0
   - BB9: 0.50 to 7.0
   - HR9: 0.15 to 2.5

5. **Map FIP to MLB peak-year FIP distribution** for final TFR rating (0.5-5.0 scale)
   - Uses same MLB peak-age pool (2015-2020, ages 25-29, 50+ IP) as component distributions
   - Makes TFR calibration consistent: components and final rating both compared to MLB

**Peak Workload Projections:**

IP projections are based on stamina and injury rating, not minor league IP:

*Starters (Stamina ≥ 30, 3+ pitches):*
```
baseIp = 30 + (stamina × 3.0)
// Stamina 50 → 180 IP, 60 → 210 IP, 70 → 240 IP
```

*Relievers:*
```
baseIp = 50 + (stamina × 0.5)
// Stamina 30 → 65 IP, 50 → 75 IP
```

*Injury Modifiers:* Ironman (1.15×), Durable (1.10×), Normal (1.0×), Fragile (0.90×), Wrecked (0.75×)

#### Batter TFR

Projects peak wOBA for hitter prospects using a 4-component model. Like pitcher TFR, this represents ceiling/peak potential ("if everything goes right").

**The 6 Components:**

| Component | Rating | Stat | Calibrated Coefficient |
|-----------|--------|------|------------------------|
| Eye | Eye (20-80) | BB% | 1.6246 + 0.114789 × eye |
| AvoidK | AvoidK (20-80) | K% | 25.9942 - 0.200303 × avoidK |
| Power | Power (20-80) | HR% | -0.5906 + 0.058434 × power |
| Contact | Contact (20-80) | AVG | 0.035156 + 0.00395741 × contact |
| Gap | Gap (20-80) | 2B rate | 0.01 + 0.0008 × (gap - 20) |
| Speed | Speed (20-80) | 3B rate | Converted to 20-200 internally, then applied |

**Critical Design Decision: Contact vs Hit Tool**

The system uses **Contact rating** instead of Hit Tool for AVG projection:
- Contact correlates with AVG at r=0.97 (from OOTP engine testing)
- Hit Tool alone correlates at only r=0.82
- Contact ≈ 60% Hit Tool + 40% AvoidK (OOTP composite)
- Scouting CSVs should map the `CON P` column, not `HT P`

**Scouting Weights:**

TFR uses **100% scouting potential ratings** for all components — scout ratings define the ceiling, and MiLB stats belong in TR (development curves), not TFR (ceiling projection). MiLB predictive validity research is documented for reference:

| Component | MiLB→MLB Correlation | Rationale for 100% Scouting in TFR |
|-----------|---------------------|-----------------------------------|
| Eye (BB%) | r = 0.05 | MiLB walk rate is noise |
| Contact (AVG) | r = 0.18 | MiLB batting avg is noise |
| AvoidK (K%) | r = 0.68 | Predictive, but ceiling ≠ current performance |
| Power (HR%) | r = 0.44 | Moderately predictive, but ceiling ≠ current |
| Gap (2B rate) | Not studied | No MiLB research available |
| Speed (3B rate) | Not studied | No MiLB research available |

**Algorithm Flow:**

1. **Convert scout potential ratings to projected peak rates** (100% scouting for all components)
   - Eye → BB%, AvoidK → K%, Power → HR%, Contact → AVG, Gap → 2B rate, Speed → 3B rate

2. **Apply ceiling boost** — Scale projections proportionally above average
   - `ceilingValue = meanValue + (meanValue - avgAtRating50) × 0.35`
   - At rating 50 (average): no boost. At rating 80 (elite): significant boost

3. **Find each component's percentile in MLB distribution** (2015-2020, ages 25-29, 300+ PA)
   - Eye, Power, Contact, AvoidK: compared directly to MLB peak-age distributions
   - Gap, Speed: ranked among prospects (no MLB distribution available)

4. **Calculate wOBA** from projected rates:
   ```
   wOBA = 0.69×BB_rate + 0.89×1B_rate + 1.27×2B_rate + 1.62×3B_rate + 2.10×HR_rate
   ```
   - Doubles rate calculated from Gap rating (higher Gap → more doubles)
   - Triples rate calculated from Speed rating (higher Speed → more triples)
   - Singles = remaining hits after subtracting 2B, 3B, HR

6. **Compute WAR per 600 PA** (standardized for ranking, not volume-dependent):
   ```
   sbRuns = projectStolenBases(SR, STE, 600).sb × 0.2 − .cs × 0.4
   wRAA = ((projWoba − lgWoba) / wobaScale) × 600
   projWar = (wRAA + 20 + sbRuns) / runsPerWin
   ```

7. **Map WAR to MLB peak-year WAR distribution** for final TFR rating (0.5-5.0 scale)
   - Uses same MLB peak-age pool (2015-2020, ages 25-29, 300+ PA) as component distributions
   - Makes TFR calibration consistent: components and final rating both compared to MLB

**TFR Rating Scale:**

| TFR | Percentile | Description |
|-----|------------|-------------|
| 5.0 | 99-100% | Elite (MVP-caliber peak) |
| 4.5 | 97-99% | Plus-Plus |
| 4.0 | 93-97% | Plus |
| 3.5 | 75-93% | Above Average |
| 3.0 | 60-75% | Average MLB starter |
| 2.5 | 35-60% | Fringe |
| 2.0 | 20-35% | Below Average |
| 1.5 | 10-20% | Poor |
| 1.0 | 5-10% | Replacement level |
| 0.5 | 0-5% | Below replacement |

### Prospect True Rating (Development Curves)

For prospects (no MLB stats), TR represents **estimated current ability** — where on the development path from raw talent to peak potential the player currently sits. This is the blue solid line on the radar chart; TFR (green dashed) shows the ceiling.

**Previous approach (devCap):** `TR = 50 + (TFR - 50) × (age - 16) / 11` — a deterministic function of TFR + age that added no independent signal.

**Current approach:** Data-driven development curves derived from historical cohort analysis (245 MLB players, 2012+ debuts, 600+ PA with MiLB history).

**Algorithm:**

1. **Cohort selection** — The prospect's projected peak stat (from TFR pipeline) selects a cohort of historical players with similar peak MLB performance:
   - Eye: 3-5%, 5-7%, 7-9%, 9-11%, 11%+ peak BB%
   - AvoidK: 8-12%, 12-16%, 16-20%, 20-25% peak K%
   - Power: 0-1.5%, 1.5-3%, 3-4.5% peak HR%
   - Contact: .200-.240, .240-.270, .270-.300, .300-.330 peak AVG

2. **Expected curve value** — Within the cohort, the PA-weighted mean MiLB stat at each age (18-26) defines the development curve. Interpolate to get the expected stat at the prospect's current age.

3. **Development fraction** — How far along the curve the prospect's age is: `devFraction = (curveVal[age] - curveVal[minAge]) / (curveVal[maxAge] - curveVal[minAge])`. For AvoidK (lower-is-better), uses age-based fraction directly.

4. **Baseline TR** — `baseline = 20 + (TFR - 20) × devFraction`

5. **Individual adjustment** (if raw MiLB stats available):
   - `deviation = (actualRaw - expectedRaw) / expectedRaw`
   - For AvoidK: sign inverted (lower K% than expected = positive)
   - `shrinkage = totalMinorPa / (totalMinorPa + stabilizationPa)`
   - `ratingAdjust = deviation × shrinkage × 8` (sensitivity: 8 rating pts per 100% deviation)

6. **Final TR** — `clamp(baseline + ratingAdjust, 20, TFR)`

**Stabilization PA** (controls how quickly individual stats override the curve baseline):

| Component | Stabilization PA | Rationale |
|-----------|-----------------|-----------|
| Eye (BB%) | 600 | MiLB BB% weakly predictive — high PA needed |
| AvoidK (K%) | 200 | MiLB K% strongly predictive (r=0.68) — trusts stats quickly |
| Power (HR%) | 400 | MiLB HR% moderately predictive (r=0.44) |
| Contact (AVG) | 400 | MiLB AVG weakly predictive — moderate PA threshold |

**Gap/Speed:** No MiLB stat equivalent — use the average development fraction from the four stats-based components.

**Implementation:** `ProspectDevelopmentCurveService.calculateProspectTR()` is called once per data load. Results are stored on `RatedHitterProspect.developmentTR` and read by all views.

### Recent Projection System Improvements

#### 1. HR%-Based Power Estimation (Fixed Gap Hitter Inflation)

**Problem:** Gap hitters with high doubles/triples rates were getting inflated power ratings because the system estimated power from ISO (which includes all extra bases), not HR rate.

**Solution:** Changed to HR%-based power estimation.

**Impact:**
- Gap hitters (high AVG, many 2B/3B, low HR) now get appropriate moderate power ratings
- True power hitters (high HR%) correctly get high power ratings
- A.E. Douglas example: Power rating 80→62 (correct), HR projection 30→15-18 (realistic)
- HR% projection bias: -0.195 → -0.037 (81% improvement)

#### 2. Contact Rating Slope Increase (Elite Projections)

**Problem:** Elite scout ratings (75-80 contact) were mapping to AVGs that ranked 12th-20th in the league, not top-11 as they should.

**Solution:** Increased contact slope by 25%, anchored to keep league average at .260.

**Impact:**
- 80 contact: .333 → .352 AVG (now ranks top 1-3, appropriate for elite)
- 75 contact: .317 → .332 AVG (now ranks top 11, matches scout distribution)
- League average maintained at .260 (57 contact rating)
- Widens distribution at extremes without hurting overall accuracy

#### 3. Reduced AVG Over-Regression

**Problem:** AVG stabilization constant of 400 PA caused elite hitters with 500+ PA to still regress heavily (21 points for A.E. Douglas with 531 PA).

**Solution:** Reduced stabilization constant from 400 → 300 PA.

**Impact:**
- Elite hitters with substantial PAs trusted more
- Douglas type cases: Regression reduced from 21 pts → 17 pts
- Still provides meaningful regression for lower PA players

#### 4. Full System Recalibration

After changes, ran automated calibration (`tools/calibrate_batter_coefficients.ts`) to optimize all intercepts:

**Final Accuracy:**
- AVG MAE: 0.025, Bias: -0.0002 (near perfect)
- HR% MAE: 0.777, Bias: -0.037 (excellent)
- BB% MAE: 1.421, Bias: -0.047
- K% MAE: 1.946, Bias: -0.031
- All biases near zero while maintaining elite/poor separation

#### 5. Batter Projection Pipeline Fix (Feb 2026)

**Problem:** `BatterProjectionService` was using deprecated `expectedIso()` method and rough estimation formulas instead of proper HR% coefficient, causing systematic HR% projection bias.

**Solution:** Fixed projection pipeline to use proper coefficient-based calculations:
- Changed from: `hrRate = hitRate * 0.12 * isoFactor` (hacky formula)
- Changed to: `hrRate = projHrPct / 100` (proper coefficient)
- Removed deprecated `expectedIso()` dependency
- Calculate HR count as: `projHr = PA × (HR% / 100)`

**Impact:**
- HR% projection bias: **-1.867 → +0.033** (98% improvement!)
- wOBA bias remained excellent: -0.013
- All other stats remained stable

#### 6. Internal Rating Range Expansion (Feb 2026)

**Problem:** 20-80 rating caps were artificially limiting projections for extreme players. High-K guys all projected to exactly 21.1% K rate, elite low-K guys all projected to 9.1%.

**Solution:** Implemented OOTP-style dual range system:
- **Internal calculations:** 0-100 range (allows extreme projections)
- **User display:** 20-80 range (standard OOTP/baseball convention)
- Applied to all rating estimation and aging functions (batters & pitchers)

**Impact:**
- Extreme projections now vary realistically (high-K: 22-25%, low-K: 7.7-8.1%)
- MAE improved: K% 1.822→1.724, HR% 0.686→0.648, BB% 1.286→1.224
- RMSE improved by better capturing tail distributions
- No artificial ceiling/floor effects

#### 7. K% Coefficient Calibration (Feb 2026)

**Problem:** K% projections had systematic overprediction bias of -0.559 (bias = actual - projected).

**Solution:** Calibrated avoidK intercept from 25.9942 → 25.10 through iterative validation against 2015-2020 MLB data.

**Impact:**
- K% bias reduced: -0.559 → -0.400 (still overpredicting ~2.4 Ks per 600 PA)
- MAE improved: 1.822 → 1.724
- Considered acceptable given practical impact (~2 strikeouts difference per season)

#### 8. Percentile-Based Component Ratings (Feb 2026)

**Problem:** Component ratings (Contact, Power, Eye, AvK) used absolute performance thresholds that didn't account for year-to-year offensive environment changes. A .315 league-leader in a low-offense year would get only a 71 Contact rating, while a .380 league-leader in a high-offense year would get 80. This was unfair - being the best hitter in your season should always yield an elite rating regardless of league-wide offensive levels.

**Solution:** Replaced formula-based rating calculations with **percentile-based rankings within each season**:
- Each component (Contact, Power, Eye, AvK) ranks all players by their blended stat
- Percentile rank (0-100) maps to rating scale (20-80): `rating = 20 + (percentile / 100) × 60`
- League leader (100th percentile) → 80 rating
- Median player (50th percentile) → 50 rating
- Worst player (0th percentile) → 20 rating
- Distribution is relative to peers in the same season

**Impact:**
- League leader in any stat always receives 80 rating, regardless of absolute value (.315 or .380)
- Top 2-3 players receive 79-80 ratings
- Ratings adjust automatically for offensive environment changes
- Fair cross-era comparison: players judged against their peers
- Consistent distribution across all four components
- Historical comparisons remain valid (everyone rated relative to their era)

**Current Validation Metrics (2015-2020, 200+ PA, n=770):**
```
Stat    MAE    RMSE    Bias
wOBA    0.026  0.033   -0.014
AVG     0.021  0.027   +0.008
BB%     1.224  1.555   -0.252
K%      1.724  2.214   -0.400
HR%     0.648  0.849   -0.069
```

#### 10. Pitcher Forward/Inverse Intercept Alignment (Feb 2026)

**Problem:** The inverse formulas (stat → rating) in `TrueRatingsCalculationService` used different intercepts than the forward formulas (rating → stat) in `PotentialStatsService`. When the projection pipeline does a round-trip (actual stat → estimate rating → project stat), this created a systematic FIP bias:

| Stat | Old Inverse Intercept | Forward Intercept | Round-trip bias |
|------|----------------------|-------------------|----------------|
| K/9  | 2.07                 | 2.10              | +0.03 K/9 |
| BB/9 | 5.22                 | 5.30              | +0.08 BB/9 |
| HR/9 | 2.08                 | 2.18              | +0.10 HR/9 |

Net effect: **+0.16 FIP systematic bias** for every pitcher. Since HR/9 has a 13/9 weight in the FIP formula, the 0.10 HR/9 mismatch alone contributed +0.14 FIP.

**Solution:** Aligned all inverse intercepts to match the forward formulas (2.10, 5.30, 2.18) across `TrueRatingsCalculationService`, `StatsView`, `PotentialStatsService`, and `PotentialStatsView`.

**Impact (measured on top 10 starters by 2020 game WAR):**
- Average FIP gap: +0.296 → +0.132 (55% reduction)
- Average WAR gap: -1.06 → -0.63 (41% reduction)
- Top pitcher (6.9 gWAR): projected 5.7 → 6.3 WAR

**Critical lesson:** Forward and inverse formula intercepts MUST always match. Mismatch causes round-trip bias amplified by FIP component weights.

#### 11. IP Projection Double-Penalty Fix (Feb 2026)

**Problem:** The IP projection applied an injury modifier to the model-based IP *before* blending with historical data. Since historical IP already reflects injury outcomes (fragile pitchers have lower historical IP), this was double-counting injury proneness.

Example: A "fragile" pitcher (stamina 60, proven 200 IP):
- Before: model=175 (fragile penalty), blend: 175×0.35 + 200×0.65 = 191 IP
- After: model=190 (no penalty when history exists), blend: 190×0.35 + 200×0.65 = 197 IP

**Solution:** Injury modifier now only applies when there's no historical data (prospects). For established pitchers, history already captures durability.

#### 12. Pitcher TFR Architecture Fix (Feb 2026)

**Problem:** The pitcher TFR pipeline ranked prospects **among each other** by component, then mapped those percentile ranks to MLB distributions. The ceiling boost is a linear transform that preserves rank order, so it had **zero effect** on TFR. This also created a "combining unicorn" problem — the #1 prospect in K/9, BB/9, and HR/9 simultaneously received the best MLB value for all three, even though no real pitcher achieves that.

**Solution:** Changed to direct MLB distribution comparison (same approach batters already used). Each prospect's boosted rate value is compared directly against the MLB peak-age distribution to find its percentile.

**Impact:** Ceiling boost now meaningfully affects pitcher TFR ratings; combined with separate calibration (0.30 vs batter's 0.35), produces a healthy pitcher TFR distribution.

#### 13. Development-Curve-Based Prospect TR (Feb 2026)

**Problem:** Prospect TR used a deterministic "devCap" formula: `TR = 50 + (TFR - 50) × (age - 16) / 11`. This was purely a function of TFR + age — it added no independent signal and couldn't differentiate between a 22-year-old who was outperforming expectations vs. one who was underperforming.

**Solution:** Replaced devCap with **data-driven development curves** from historical cohort analysis (245 MLB players, 2012+ debuts, 600+ PA with MiLB history). For each component, historical players are grouped by peak MLB stat into cohorts. The average MiLB stat at each age within each cohort defines an expected development curve. A prospect's TR is derived from where they fall on this curve, with individual adjustment via Bayesian shrinkage weighted by PA.

**Impact:**
- TR now varies based on the prospect's actual MiLB performance, not just age
- Different development trajectories for different player types (e.g., power developers vs. contact-first)
- Consistent TR derivation across all views (FarmRankings, TrueRatings, TradeAnalyzer, GlobalSearch)
- Removed ~25 lines of duplicated devCap/rateToRating code from each view

### Team Planning

A year-by-year roster planning grid that shows contract obligations, projected gaps, and where farm system prospects slot in. Select a team and see 6 years of roster planning across lineup, rotation, and bullpen.

**File:** `src/views/TeamPlanningView.ts`

**Grid Structure:**
- Position rows: C, 1B, 2B, SS, 3B, LF, CF, RF, DH (lineup), SP1-5 (rotation), CL/SU/MR (bullpen)
- Year columns: current year + 5 forward years
- Each cell shows abbreviated name, age (labeled "Age: X"), star rating, and salary
- Sections (Lineup, Rotation, Bullpen) are collapsible accordions

**Rating Projections (`projectPlanningRating()`):**
- Ratings are projected per-year using growth and aging curves — they are NOT static across the grid
- **Growth phase** (age < 27, TFR > TR): linear interpolation from current TR toward TFR, reaching peak at age 27
- **Peak plateau**: ages 27-29, no decline
- **Aging decline**: per-year star loss based on age bracket (30-32: -0.05/yr, 33-35: -0.10/yr, 36-38: -0.20/yr, 39+: -0.30/yr). Decline rate is keyed on age at start of each transition, not end
- **Floor**: all projected ratings clamped to minimum 0.5
- All projected ratings rounded to nearest 0.5 (matching the game's star scale)
- TFR for MLB hitters comes from `getUnifiedHitterTfrData()` (expanded pool including young MLB players with upside); pitcher TFR comes from `getFarmData()` (farm-eligible prospects only — young MLB pitchers only get aging decline for now)
- Fallback: scans full unified prospect list for any MLB roster player missed by the orgId filter

**Prospect Starting Ratings (`computeProspectCurrentRating()`):**
- Prospects don't appear at full TFR — they start at an estimated current rating derived from `developmentTR` component ratings
- For each component: `fraction = (devTR - 20) / max(1, tfrRating - 20)`, averaged across all components
- `estimatedStar = 0.5 + (TFR - 0.5) * avgFraction`, clamped to [0.5, TFR]
- Fallback (no developmentTR): age-based fraction `(age - 18) / (peakAge - 18)`

**Team Control & Service Years:**
- Service years determined by counting actual years with MLB stats in the cached league-wide data (`computeServiceYears()`)
- Scans all years from `LEAGUE_START_YEAR` (2000) to current year using `trueRatingsService.getTruePitchingStats()` / `getTrueBattingStats()` — these hit the in-memory/IndexedDB cache, making zero additional API calls
- `teamControlRemaining = TEAM_CONTROL_YEARS (6) - serviceYears + 1`
- Applies to ALL players (not just minimum-salary) — arb players on 1-year deals correctly show remaining team control years
- Fallback for players with no stats data: age-based estimate for min-salary players (`age - TYPICAL_DEBUT_AGE`)
- Years beyond the explicit contract but within team control use `estimateTeamControlSalary()` for salary and show as `arb-eligible` (purple tint)

**Contract Intelligence:**
- Parses full contract data from `ContractService` (salary schedule, years, options)
- Salary formatting: `$228K` for thousands, `$9.7M` / `$21.1M` for millions
- Arb salary estimates by TFR tier in `ARB_TIERS` constant (salary uses TFR, not projected rating)

**Color Coding (cell CSS classes):**
- `.cell-under-contract` — green: player under explicit contract
- `.cell-final-year` — yellow: last year of team control (contract or arb)
- `.cell-arb-eligible` — purple: team-control year beyond explicit contract (estimated arb salary)
- `.cell-minor-league` — blue: prospect slot (also used for `.cell-prospect` contractStatus)
- `.cell-empty` — red tint: no player / roster gap
- `.cell-override` — dashed blue border: manual edit by user

**Prospect Integration:**
- Hitter prospects from `getUnifiedHitterTfrData()` filtered to `isFarmEligible`; pitcher prospects from `getFarmData()`
- **ETA estimation** based on current minor league level: MLB=0yr, AAA=1yr, AA=2yr, A=3yr, R=4yr, IC=5yr
  - Elite prospects (TFR ≥ 4.0) get 1 year acceleration; strong prospects (≥ 3.5) get 0.5yr
- **Greedy improvement-based position assignment**: prospects placed where they provide the biggest rating upgrade over the incumbent, not at the most position-scarce slot. This ensures a 3.0 SS prospect goes to the 1.0-rated 1B slot (+2.0 improvement) rather than the 2.5-rated SS slot (+0.5)
- Cells open for prospect replacement: empty, existing prospect, min-contract, arb-eligible, or final-year
- Prospect vs incumbent comparison uses projected ratings for both (not static TFR)
- Pitcher prospects classified as SP (3+ pitches, stamina ≥ 30) or RP; rotation fills with SP, bullpen with RP then overflow SP
- **Override-aware auto-fill**: user overrides are applied BEFORE prospect fill, acting as locked constraints. The greedy algorithm optimizes around user decisions — locked players are excluded from the candidate pool, and override cells are never replaced. This means editing a cell triggers a full re-optimization of the remaining open slots.
- **Rotation sorting**: after all prospect placement, rotation slots (SP1-SP5) are re-sorted by rating within each year column, so the best pitcher is always SP1. Empty slots sink to the bottom.

**Data Flow (key maps):**
- `playerTfrMap` — playerId → TFR star rating (built from unified hitter data + pitcher farm data + roster fallback scan)
- `playerServiceYearsMap` — playerId → number of years with MLB stats (from cached league-wide data)
- `prospectCurrentRatingMap` — playerId → estimated current star rating (from `computeProspectCurrentRating()`; overridden to TFR for players with dev curve overrides)
- `playerRatingMap` — playerId → max(TR, TFR) for edit modal sorting
- `playerAgeMap` — playerId → current age (from TFR data)
- `devOverrides` — `Set<number>` of playerIds marked as "fully developed" (loaded from IndexedDB on team change)
- `cachedTradeProfiles` — `Map<number, TeamTradeProfile>` of all 20 teams' needs/surplus (rebuilt when year offset changes)

**View Toggle:**
- Filter bar toggle: "Planning Grid" shows the grid + color legend; "Org Analysis" shows summary cards + draft strategy; "Trade Market" shows cross-team trade target analysis
- **Positions of Strength**: positions with 5+ years of 3.5+ rated coverage, shows position label and player name (e.g., "CF — J. Jones: 6 years of 3.5+ coverage")
- **Positions of Need**: any cell across the grid with a player rated under 3.0, grouped by player with years listed (e.g., "SS — J. Smith at 2.5 (2022, 2023)"), plus empty year counts
- **Extension Priorities**: players in penultimate contract year, rated 3.0+, age ≤ 31
- **Draft Strategy**: matches positions of need with urgency-based suggestions:
  - Gap in 0-1 years: "SS needed now, lean college player or trade target"
  - Gap in 2-3 years: "2B needed, lean college player for gap in 3 years"
  - Gap in 4+ years: "No long term 2B depth in the majors, draft now"
  - Gaps include both empty cells and cells with sub-3.0 players

**Trade Market (`analyzeTeamTradeProfile()`, `findTradeMatches()`, `renderTradeMarket()`):**

Surfaces actionable trade targets by analyzing all 20 teams' rosters and farm systems. No additional data fetches — uses the already-cached `cachedAllRankings`, `cachedAllHitterProspects`, `cachedAllPitcherProspects`, and `contractMap`.

- **Year selector**: Toggle buttons for each of the 6 planning years (current through +5). Rebuilds all team profiles at the selected year offset. For rebuilding teams, shift the target season forward to focus on future needs rather than the current roster's gaps.
  - **Selected team needs (future years)**: Uses the planning grid data at the target year — includes prospect fill-ins, user overrides, and projected ratings already baked in
  - **Other teams' needs (future years)**: Uses current roster adjusted for contract expiration — if an incumbent's contract expires before the target year, that position becomes a need
  - **Surplus adjustments**: Blocking years reduced by year offset; surplus MLB players must still be under contract at the target year

- **Section 1 — "Your Situation"** (two side-by-side cards):
  - *Positions of Need*: Lists positions with TR < 3.0 (or empty) at the target year, with severity badges (Critical: < 2.0 or empty; Moderate: 2.0-2.9). Deep bullpen (MR1-MR5) excluded.
  - *Trade Chips*: Two sub-groups:
    - **Blocked Prospects**: Org prospects with TFR >= 3.0 whose natural position is blocked by an incumbent with TR >= 3.5 and 3+ years of contract remaining (adjusted for year offset). Shows blocking player, their rating, and remaining years.
    - **Tradeable Players**: MLB players with TR >= 3.0 on expiring contracts (1-2 years remaining at target year) AND a prospect replacement ready within 2 years (TFR >= 3.0 at the same position).

- **Section 2 — "Trade Targets by Position"**: One expandable group per position of need:
  - Scans other 19 teams' surplus prospects and surplus MLB players
  - **Position matching**: Uses `POSITION_SLOTS` — a surplus SS prospect matches needs at SS, 2B, 3B (positions SS can play). SP prospects match any SP1-5 need; RP prospects match CL/SU needs.
  - **Complementary matching**: If the target's team needs a position where we have surplus, marked with a green "Match" badge. Bilateral matches are scored higher and sorted first.
  - **Scoring**: `rating × 10` (quality) + `20` (complementary bonus) + proximity bonus (AAA=5, AA=3 for prospects; expiring=3 for MLB). Capped at 8 targets per position.
  - Player names are clickable → open profile modals

**Cell Editing & Overrides:**
- Any cell is clickable to open `CellEditModal` — assign org players, search all players, extend contracts, or clear
- Overrides persisted in IndexedDB (`TeamPlanningOverrideRecord`), keyed by `{teamId}_{position}_{year}`
- "Reset Edits" button clears all overrides for the selected team
- **Development curve overrides**: modal shows TFR alongside current rating for the cell occupant. Players with unrealized upside (TFR > current rating) get a "Set as fully developed" button that skips the growth phase — the player immediately projects at their TFR with only aging decline applied. Per-player, persisted in IndexedDB (`player_dev_overrides` store, v11). Removable via "Remove development override" button on subsequent clicks.

**Section Ratings & Team Rating:**
- Each section header (LINEUP, ROTATION, BULLPEN) shows a color-coded average star rating per year column, computed from the grid cells
- A TEAM row at the bottom shows the overall team rating per year using weighted formula: 40% rotation + 40% lineup + 20% bullpen
- Ratings automatically reflect prospects, overrides, and dev curve overrides — the full planning picture
- Color-coded using the standard rating classes (elite/plus/avg/fringe/poor)

**Indicators (`computeIndicators()`):**
- `CLIFF` — age ≥ 33 or ~10yr service (decline risk)
- `EXT` — extension candidate (under-contract, penultimate year, rating ≥ 3.0, age ≤ 31)
- `FA` — free agent target needed (empty cell in years 2-4 with no prospect)
- `TR` — trade target area (underperforming final-year player, no strong prospect coming)
- `UPGRADE` — year 0 only, MLB-ready prospect better than incumbent
- `EXPENSIVE` — salary ≥ $10M
- `TRADE` / `FA_TARGET` — from manual override annotations

### Farm System Rankings

Organizations are ranked by **Farm Score**, a tier-based system that weights prospect quality:

**Farm Score Formula:**
```
Farm Score = (Elite × 10) + (Good × 5) + (Avg × 1) + Depth Bonus
```

**Prospect Tiers:**
| Tier | TFR Range | Points |
|------|-----------|--------|
| Elite | ≥ 4.5 | 10 pts each |
| Good | 3.5-4.4 | 5 pts each |
| Average | 2.5-3.4 | 1 pt each |
| Depth | < 2.5 | Scaled (see below) |

**Depth Bonus Scale:**
- < 10 depth prospects: 0 pts
- 10-14 depth prospects: 2 pts
- 15-24 depth prospects: 4 pts
- 25+ depth prospects: 5 pts

### Team Ratings & Projected Standings

**File:** `src/views/TeamRatingsView.ts`

Three-mode team-level analysis dashboard with a toggle between Power Rankings, Projections, and Standings.

**Modes:**

| Mode | What it shows | Data source |
|------|--------------|-------------|
| Power Rankings | Teams ranked by weighted average TR (40% Rotation + 40% Lineup + 15% Bullpen + 5% Bench) | `getPowerRankings()` |
| Projections | Teams ranked by weighted WAR total (same 40/40/15/5 split) | `getProjectedTeamRatings()` |
| Standings | Projected W-L, RS/RA, Pythagorean record from team WAR and runs projections | `getProjectedTeamRatings()` (same data, different lens) |

**Standings Mode — Piecewise WAR→Wins Calibration:**

Projected wins use a **piecewise formula** with different slopes for above-median and below-median teams:

```
medianWAR = median of all team WARs
deviation = Team WAR - medianWAR
slope = 0.830 (if deviation > 0) or 0.780 (if deviation ≤ 0)
rawWins = 81 + deviation × slope
```

| Constant | Value | Notes |
|----------|-------|-------|
| Upper Slope | 0.830 | Above-median teams — WAR deviations count more toward wins |
| Lower Slope | 0.780 | Below-median teams — WAR deviations count less toward wins |
| Season Games | 162 | Standard MLB season |

**Why piecewise?** The projection pipeline compresses team WAR asymmetrically — top teams are under-projected more (~11 wins) than bottom teams are over-projected (~8 wins). A single linear slope can't capture this asymmetry. The piecewise approach was the clear winner in a 4-strategy non-linear sweep (power curve, asymmetric spread, quadratic, piecewise).

**Calibration source:** 236 team-seasons (2005-2020), MAE 7.52. Fine-tuned via two-pass parameter sweep in `tools/calibrate_projections.ts`. The compression is inherent to regression-based projections (FIP regression is the main source, NOT IP projection — tested via hybrid proj-FIP × actual-IP diagnostic). Individual FIP projections are excellent (MAE 0.584, bias -0.019).

**Important:** Standings uses **raw WAR sum** (rotation + bullpen + lineup + bench), NOT the weighted 40/40/15/5 composite. Role-adjusted playing-time caps were removed in Feb 2026 after diagnostic analysis showed they were hurting accuracy (MAE 5.6 raw vs 5.9 adjusted).

**Runs Scored / Runs Allowed / Pythagorean Record:**

The Standings table shows runs-based projections alongside the WAR-based W-L:

| Column | Source | Notes |
|--------|--------|-------|
| RS (Runs Scored) | wRC from projected wOBA × PA (lineup + bench) | Normalized so league-total RS = league-total RA |
| RA (Runs Allowed) | FIP × IP / 9 (rotation + bullpen) | IP-normalized to targets (950 rot + 500 bp), replacement-filled |
| RD (Run Differential) | RS − RA | Color-coded: green positive, red negative |
| Pyth (Pythagorean W-L) | Pythagenpat formula (exponent 1.83) | `pythPct = RS^1.83 / (RS^1.83 + RA^1.83)` |
| Pyth Diff | Pythagorean wins − WAR-projected wins | Sanity check on WAR→Wins conversion |

**RS normalization:** Raw wRC systematically exceeds FIP-based RA because (a) FIP estimates earned runs only (~8% below total runs), and (b) projected rosters exclude below-replacement players that drag down league R/PA. A multiplicative scale factor `(totalRA / totalRawRS)` is applied so the league is zero-sum. This preserves relative RS differences between teams.

**Backtesting result (2015-2020):** WAR-based wins outperform Pythagorean (MAE 7.64 vs 10.33). The Pythagorean column serves as a sanity check, not a replacement. See `tools/backtest_pythagorean.ts` for full comparison.

**Lineup/Bench Construction (Standings & Projections):**

Batters are sorted by **projected WAR** (descending). The top 9 go to lineup, the next 4 to bench. This simple WAR-based split matches the calibration tool pipeline exactly (`tools/calibrate_projections.ts`). WAR naturally combines quality and playing time, so high-production players land in the lineup regardless of True Rating. Power Rankings mode still uses the position-scarcity algorithm with True Rating sorting (since TR is a rate-based quality measure, not a production measure).

**League Normalization:**

In a closed league, total wins must equal total losses. Since each team's wins are computed independently from the regression, the raw sum can drift slightly. A uniform offset is applied to all teams before rounding so that `sum(W) = sum(L) = numTeams × 81`. The offset is typically ~1 win per team — well within projection noise — and preserves relative ordering.

**Historical Backtesting:**

When viewing a historical year with actual standings data (2005-2020), the Standings table automatically shows three additional columns: **Act W**, **Act L**, and **Diff** (projected − actual). This lets you visually validate how well the projections match reality.

- Diff is color-coded: green (≤5 wins off), yellow (6-10), red (11+)
- A summary bar shows **MAE** (mean absolute error), **R²**, and **Max miss** for the year
- All three columns are sortable — sort by Diff to see where the model is best/worst
- For years without standings data (current year, pre-2005), these columns don't appear

**Data:** Actual standings CSVs live in `data/` (e.g., `data/2020_standings.csv`) and are bundled at build time via `import.meta.glob` with `?raw` — no runtime fetch needed.

**Team matching:** `StandingsService` stores standings under multiple keys (abbreviation, city name, full label) so matching works regardless of whether the team name is stored as a nickname, abbreviation, or city name.

**Shared features across all modes:**
- Year selector (single year or All-Time for Power Rankings)
- Expandable rows — click a team to see full roster detail (Power Rankings and Projections modes only; Standings mode shows flat rows without expansion)
- Sortable columns (click header to sort)
- Draggable column reordering
- Player name clicks open profile modals (in expandable detail rows)

### Player Development Tracker
Tracks scouting ratings over time to visualize player development trends.

**How it works:**
- Snapshots are automatically created when scouting data is uploaded
- Each snapshot stores: Stuff, Control, HRA, OVR stars, POT stars (pitchers) or Eye, AvoidK, Power, Contact (batters)
- View development history in the PlayerProfileModal → Development tab
- ApexCharts visualization shows rating trends over time

**Bulk Historical Upload:**
To populate historical data, name your scouting CSVs with dates:
```
pitcher_scouting_my_2024-01-15.csv
pitcher_scouting_osa_2024-03-01.csv
hitter_scouting_my_2024-02-10.csv
hitter_scouting_osa_2024-02-10.csv
```

Naming format: `[type]_scouting_[source]_YYYY-MM-DD.csv`
- Type: `pitcher`/`pitchers` or `hitter`/`hitters`
- Source: `my` or `osa`
- Date: `YYYY-MM-DD` or `YYYY_MM_DD` (underscores also work)

Files are validated on upload — headers are checked against expected columns for the selected data type, and mismatches between filename and selected toggles are flagged.

### Projections
Three-model ensemble for future performance:
- **Optimistic** (40%): Standard aging curves
- **Neutral** (30%): Status quo
- **Pessimistic** (30%): Trend-based decline

**Pitcher Projection Pipeline:**
1. **Multi-year weighted stats** → 3-year average (5/3/2 weighting)
2. **FIP-aware regression** → regresses toward quality-adjusted target (elite pitchers regress less)
3. **Scouting blend** → blends with scouting at IP/(IP+60) weight
4. **Rating estimation** → converts blended rates to 0-100 scale ratings (inverse formulas)
5. **Ensemble aging** → 35% full aging, 65% 20%-aging (neutral+pessimistic)
6. **Rating→Rate conversion** → converts aged ratings back to rate stats (forward formulas)

## Key Services

### Pitcher Services

| Service | Purpose |
|---------|---------|
| `TrueRatingsService` | MLB stats fetching, pitcher True Rating calculation |
| `TrueRatingsCalculationService` | Core pitcher TR algorithm with multi-year weighting (inverse formulas) |
| `TrueFutureRatingService` | Pitcher prospect TFR (FIP-based peak projections, direct MLB distribution comparison) |
| `PotentialStatsService` | Rating→rate stat conversion (forward formulas — intercepts must match inverse) |
| `FipWarService` | FIP calculation, WAR formula, constants (FIP_CONSTANT, replacementFip, runsPerWin) |
| `ScoutingDataService` | Pitcher scouting CSV parsing and storage |

### Batter Services

| Service | Purpose |
|---------|---------|
| `HitterTrueRatingsCalculationService` | Batter True Rating calculation |
| `HitterTrueFutureRatingService` | Batter prospect TFR (wOBA-based peak projections) |
| `ProspectDevelopmentCurveService` | Prospect TR via historical development curves (cohort-based) |
| `HitterRatingEstimatorService` | Rating↔stat conversion coefficients (calibrated) |
| `HitterScoutingDataService` | Batter scouting CSV parsing (maps CON P, not HT P) |
| `BatterProjectionService` | Batter projections integration |

### Shared Services

| Service | Purpose |
|---------|---------|
| `ContractService` | Contract parsing, salary schedules, years remaining, team control |
| `TeamRatingsService` | Farm rankings, organizational depth analysis, Farm Score, Power Rankings, team WAR projections |
| `StandingsService` | Historical standings data loader (bundled CSVs, 2005-2020), team matching for backtesting |
| `DevTrackerService` | Org development scoring (youth dev, peak WAR, aging curves, trade impact) |
| `ProjectionService` | Future performance projections, IP projection pipeline |
| `EnsembleProjectionService` | Three-model ensemble blending (optimistic/neutral/pessimistic) |
| `AgingService` | Age-based rating adjustments |
| `DevelopmentSnapshotService` | Historical scouting snapshot storage |
| `MinorLeagueStatsService` | Minor league stats from API/CSV |
| `IndexedDBService` | Persistent browser storage (v7) |

## Tools

### Debugging & Validation

Primary tools for inspecting and validating ratings:

| Tool | Purpose | Usage |
|------|---------|-------|
| `tools/trace-rating.ts` | Trace the full TR/TFR pipeline for a single player — shows every step from scouting/stats through blending, percentiles, and final rating | `npx tsx tools/trace-rating.ts <playerId> --type=batter --full --scouting=my` |
| `tools/validate-ratings.ts` | Automated TR validation: formula WAR vs game WAR correlation, distribution shape, year-over-year stability, extreme value detection | `npx tsx tools/validate-ratings.ts --year=2020` |
| `tools/investigate-pitcher-war.ts` | Investigate pitcher WAR projection gaps — compares formula WAR vs game WAR, isolates FIP vs IP contributions, identifies pipeline bottlenecks | `npx tsx tools/investigate-pitcher-war.ts` |

**trace-rating.ts** is a diagnostic tool that mirrors the service-layer pipeline. If the trace output disagrees with the UI, the **service** (`HitterTrueFutureRatingService`, `TrueFutureRatingService`) is authoritative — update the trace tool to match. Key flags:
- `--type=batter|pitcher` — player type (auto-detected if omitted)
- `--full` — full TFR mode with MLB distribution ranking
- `--scouting=my|osa` — scouting data source
- `--stage=early|q1_done|q2_done|q3_done|complete` — season stage for stat weighting

**validate-ratings.ts** checks:
- `--check=war` — Formula WAR vs game WAR correlation (batters ~0.73, pitchers ~0.96)
- `--check=dist` — Rate stat distributions and league totals
- `--check=stability` — Year-over-year rating consistency
- `--check=extremes` — Detect absurd computed values
- `--check=all` — Run all checks (default)

### Calibration

Scripts for optimizing coefficients against historical data:

| Tool | Purpose | Usage |
|------|---------|-------|
| `tools/calibrate_projections.ts` | Full projection pipeline calibration: WAR→Wins formula, compression diagnostics, IP decomposition, non-linear sweep | `npx tsx tools/calibrate_projections.ts` or `--sweep` |
| `tools/backtest_pythagorean.ts` | Compare WAR-based vs Pythagorean win projections against actual standings (2015-2020) | `npx tsx tools/backtest_pythagorean.ts` |
| `tools/calibrate_wins.ts` | Legacy WAR→Wins calibration (actual-stats based) | `npx tsx tools/calibrate_wins.ts` |
| `tools/calibrate_batter_coefficients.ts` | Optimize rating→stat intercepts | `npx tsx tools/calibrate_batter_coefficients.ts` |
| `tools/calibrate_sb_coefficients.ts` | Grid-search SR/STE coefficient space | `npx tsx tools/calibrate_sb_coefficients.ts` |
| `tools/validate_sb_projections.ts` | Validate SB projections against actuals | `npx tsx tools/validate_sb_projections.ts` |
| `tools/calibrate_level_adjustments.ts` | Analyze MiLB→MLB predictive validity | For tuning scouting weights |
| `tools/calibrate_hitter_coefficients.ts` | Find optimal coefficients for scout rating→stat conversion | For coefficient research |
| `tools/calibrate_gap_speed_coefficients.ts` | Calibrate Gap→Doubles% and Speed→Triples% | For hit composition tuning |
| `tools/calibrate_ensemble_weights.ts` | Grid-search optimal pitcher projection ensemble weights | For pitcher projection tuning |
| `tools/test_hitter_tfr.ts` | Validation test against historical outcomes | Validate TFR accuracy |
| `tools/analyze_hitter_data.ts` | Analyze OOTP engine test data | For coefficient research |

**Calibration Process:**
1. Simulates full projection pipeline (historical stats → ratings → projections)
2. Validates against 2015-2021 actual results
3. Iteratively adjusts intercepts to minimize bias
4. Outputs recommended coefficient changes
5. Reports MAE (mean absolute error) and bias for each stat

### Research

The `tools/research/` folder contains one-off analysis scripts used during development to build the models:

| Tool | Purpose |
|------|---------|
| `explore_development_all_components.ts` | Analyze MiLB batter development curves by peak cohort — generates constants for `ProspectDevelopmentCurveService` |
| `explore_pitcher_development.ts` | Build pitcher development curves (K/9, BB/9, HR/9) from 2012-2020 peak cohorts |
| `1_level_adjustments.ts` | Analyze MiLB→MLB stat transitions by level for level adjustment calibration |
| `optimize_tfr_parameters.ts` / `optimize_tfr_complete.ts` | Parameter optimization for TFR model |
| `tfr_*_validation.ts` | Various TFR validation and distribution analysis scripts |
| `mlb_aging_curves.ts` | MLB aging curve analysis |

These are historical artifacts — useful for understanding how the models were built, but not needed for day-to-day use.

## IndexedDB Schema (v7)

| Store | Purpose |
|-------|---------|
| `scouting_ratings` | Date-stamped scouting snapshots |
| `minor_league_stats` | League-level stats by year/level |
| `player_minor_league_stats` | Player-indexed stats for O(1) lookup |
| `mlb_league_stats` | Full MLB data by year |
| `player_development_snapshots` | Historical TR/TFR/scouting for dev tracking |
| `players`, `teams` | Roster caches |

## Key Formulas

**Pitcher Rating↔Rate Conversion (forward and inverse MUST match):**
```
Forward (PotentialStatsService):     Inverse (TrueRatingsCalculationService):
K/9  = 2.10 + 0.074 × Stuff        Stuff   = (K/9  - 2.10) / 0.074
BB/9 = 5.30 - 0.052 × Control       Control = (5.30 - BB/9) / 0.052
HR/9 = 2.18 - 0.024 × HRA          HRA     = (2.18 - HR/9) / 0.024
```
> **Critical:** These intercepts must be identical in both directions. A mismatch causes round-trip bias amplified by FIP weights (see improvement #10).

**FIP (Fielding Independent Pitching):**
```
FIP = ((13 × HR/9) + (3 × BB/9) - (2 × K/9)) / 9 + 3.47
```

**FIP WAR Constants (FipWarService.ts):**
- `FIP_CONSTANT = 3.47`
- `replacementFip = avgFip + 1.00` (dynamically calculated; default ~5.20)
- `runsPerWin = 8.5`

**Pitcher WAR:**
```
WAR = ((replacementFIP - playerFIP) / runsPerWin) × (IP / 9)
```

**Batter WAR:**
```
sbRuns = SB × 0.2 − CS × 0.4
wRAA = ((wOBA − lgWoba) / wobaScale) × PA
replacementRuns = (PA / 600) × 20
WAR = (wRAA + replacementRuns + sbRuns) / runsPerWin
```

**wOBA (Weighted On-Base Average):**
```
wOBA = 0.69×BB_rate + 0.89×1B_rate + 1.27×2B_rate + 1.62×3B_rate + 2.10×HR_rate
```

**Doubles/Triples Rates (from Gap/Speed):**
```
doublesRate = 0.01 + (gap - 20) × 0.0008       // per AB
triplesRate = expectedTriplesRate(speed)  // speed on 20-80 scale, converted internally
```

**Stolen Base Projection (from SR/STE):**
```
attempts = attemptRate(SR) × (PA / 600)   // 3-segment piecewise
successRate = 0.160 + 0.0096 × STE        // clamped 0.30-0.98
projSB = attempts × successRate
projCS = attempts × (1 - successRate)
```

**Team WAR→Wins (Projected Standings):**
```
Team WAR = rotationWar + bullpenWar + lineupWar + benchWar
medianWAR = median(all team WARs)
deviation = Team WAR - medianWAR
slope = 0.830 (above median) or 0.780 (below median)
rawWins = 81 + deviation × slope

// League normalization (total wins must equal total losses):
offset = (numTeams × 81 - sum(rawWins)) / numTeams
Projected Wins = round(rawWins + offset)
Projected Losses = 162 - Projected Wins
```
> Piecewise calibration (Feb 2026) on 236 team-seasons (2005-2020), MAE 7.52. Different slopes capture asymmetric projection compression (top teams under-projected more than bottom teams over-projected). FIP regression is the main compression source, not IP projection. Uses raw WAR sum without role-adjusted playing-time caps.

**Level-Weighted IP/PA (for TFR scouting weight):**
```
weightedIp = (AAA_IP × 1.0) + (AA_IP × 0.7) + (A_IP × 0.4) + (R_IP × 0.2)
```

## Views

- **TrueRatingsView**: MLB pitcher dashboard with TR/projections
- **BatterTrueRatingsView**: MLB batter dashboard with TR/projections
- **FarmRankingsView**: Top 100 prospects, org rankings with Farm Score, sortable/draggable columns
- **ProjectionsView**: Future performance projections with 3-model ensemble
- **TeamRatingsView**: Three-mode team analysis — Power Rankings (avg TR), Projections (weighted WAR), and Standings (projected W-L from WAR→Wins calibration)
- **TeamPlanningView**: 6-year roster planning grid with age-based rating projections (growth toward TFR, aging decline), contract tracking, prospect ETA with ramping ratings, accordion sections, and Planning Grid / Org Analysis / Trade Market toggle
- **DevTrackerView**: Org-level development rankings (2015-2021 WAR), expandable rows with player trajectories and trade impact
- **TradeAnalyzerView**: Multi-asset trade evaluation tool (see below)
- **DataManagementView**: File uploads with header validation, filename mismatch detection, data refresh
- **PlayerProfileModal**: Deep-dive with Ratings + Development tabs

### Trade Analyzer

Three-column layout: Team 1 roster (left), analysis panel (center), Team 2 roster (right). Supports trading MLB players, minor leaguers across all levels, and draft picks.

**Key files:**
- `src/views/TradeAnalyzerView.ts` — Main view (~2100 lines). All UI, data loading, analysis logic.
- `src/services/AITradeAnalysisService.ts` — OpenAI integration for narrative trade evaluation.
- `src/styles.css` — Search for `.trade-`, `.team-impact-`, `.ai-trade-`, `.war-comparison-`, `.asset-type-badge`, `.farm-impact-`, and `.impact-tab-` sections.

**Data flow:**
- `initialize()` loads players, projections, scouting, minor league stats, then in parallel: pitcher farm data (`getFarmData`), hitter farm data (`getHitterFarmData`), power rankings (`getPowerRankings`), and contracts (`getAllContracts`).
- Precomputed farm data is stored in `pitcherProspectMap` / `hitterProspectMap` (keyed by playerId). These are the single source of truth for prospect TFR — the same full-pool TFR that Farm Rankings shows.
- When a player is added to a trade, `addPlayerToTrade()` checks: MLB projection map first, then farm data map, then falls back to on-the-fly TFR calculation.
- `getPlayerRating()` and `updatePlayerList()` follow the same lookup chain for display ratings.

**Current vs Future WAR split:**
- WAR is classified into **Current** (MLB players) and **Future** (prospects + draft picks) categories.
- Classification: pitchers use `projection.isProspect`; batters use `!allBatterProjections.has(playerId)` (same logic as AI analysis context); draft picks are always future.
- `calculateTeamWar(state)` returns `{ current, future, total }` for each team.
- The WAR comparison display shows up to three rows per team: **Now** (MLB value), **Future** (prospect peak + pick value, labeled "(peak)"), and **Total**. Rows only appear when their value is > 0.
- The winning team in each row is highlighted green.

**Trade archetype summaries:**
- `calculateTradeAnalysis()` determines the trade type based on the current/future WAR split:
  - **Roster swap** — both sides exchanging > 70% current MLB value
  - **Win-now vs future** — one side heavily current, the other heavily future (> 50% difference in current/total ratio between teams)
  - **Prospect swap** — both sides exchanging > 70% future value

**Asset type badges:**
- Each item in the WAR detail list gets a small inline badge: `MLB` (blue), `Prospect` (green), or `Pick` (purple).
- Badges use `isProspectPitcher()` / `isProspectBatter()` helper methods for consistent classification.

**Team impact analysis (Roster/Farm tabs):**
- `calculateTeamImpact(teamNum)` clones the team's power ranking roster, removes outgoing players, inserts incoming players, handles overflow (rotation > 5 spills to bullpen, lineup > 9 spills to bench), and recalculates component averages using the standard 40% rotation + 40% lineup + 15% bullpen + 5% bench formula.
- `renderTeamImpact()` includes a **Roster / Farm toggle** when prospects are involved in the trade.
- **Roster Impact** tab: displays before→after ratings for each component with color-coded deltas and slot tags showing which roster positions are affected.
- **Farm Impact** tab: shows prospects being lost/gained by each team with TFR star rating and tier label, plus a net tier count summary (e.g., "Losing 1 Elite, Gaining 2 Good").
- `calculateFarmImpact(teamNum)` looks up prospect TFR from `pitcherProspectMap` / `hitterProspectMap` and classifies into tiers:

| Tier | TFR Range |
|------|-----------|
| Elite | ≥ 4.5 |
| Good | 3.5–4.4 |
| Average | 2.5–3.4 |
| Depth | < 2.5 |

**AI analysis:**
- `AITradeAnalysisService` follows `AIScoutingService` patterns: `gpt-4o-mini`, `VITE_OPENAI_API_KEY`, cached in IndexedDB `ai_scouting_blurbs` store with key `trade_<hash>`. Hash is based on player names + pick descriptions.
- `requestAIAnalysis()` builds a `TradeContext` with player data (name, role, age, TR, TFR, projected stats, salary, contract years), team power rankings, and post-trade rating deltas.

**Player profile modals:**
- `openPlayerProfile()` passes comprehensive data to pitcher/batter profile modals including: TR, estimated ratings, scouting grades, projected stats, TFR with ceiling components, pitch ratings, injury proneness, parent team, and TFR-by-source toggle data.
- For pitcher prospects: uses `pitcherProspectMap` for development TR (current ability), TFR (peak ceiling), and peak projection stats.
- For batter prospects: uses `hitterProspectMap` for the same, plus TFR blended rates.

**Level filtering:**
- "All Prospects" aggregates all minor league levels (AAA through Rookie) plus International Complex players into one list, still filtered by the pitcher/batter toggle.
- Draft picks are a separate mode with estimated WAR values (adjustable by pick position for 1st round).

**Architecture notes for future work:**
- `TradeTeamState` holds both `tradingPlayers` (pitcher `ProjectedPlayer[]`) and `tradingBatters` (`ProjectedBatter[]`) separately because they have different interfaces. Draft picks are a third array (`tradingPicks: DraftPick[]`).
- The view uses click-to-add (clicking a player row adds them to the trade bucket) and also supports drag-and-drop.
- `updateAnalysis()` is the central render function for the middle column — it calls `calculateTradeAnalysis()` for WAR totals (split by current/future), `renderTeamImpact()` for before/after ratings with Roster/Farm tabs, `renderRatingsTable()` for the detailed comparison table, and wires up the AI analysis button and impact tab toggle handlers.

## Data Sources

**StatsPlus API:**
- Base: `/api/playerpitchstatsv2/` (pitchers), `/api/playerbatstatsv2/` (batters)
- Params: `year`, `lid` (200=MLB, 201-204=minors), `split=1`

**CSV Uploads:**

*Pitcher Scouting:* `player_id, name, stuff, control, hra [, age, ovr, pot, pitches...]`

*Batter Scouting Columns (from OOTP export):*
| Column | Maps To | Notes |
|--------|---------|-------|
| `POW P` | power | Power rating (maps to HR%) |
| `EYE P` | eye | Eye/plate discipline |
| `K P` | avoidK | Avoid strikeout |
| `CON P` | contact | **Use this, NOT HT P** |
| `GAP P` | gap | Gap power (used for doubles projection) |
| `SPE` | speed | Speed rating (used for triples projection) |
| `SR` | stealingAggressiveness | Steal aggressiveness (drives attempt volume) |
| `STE` | stealingAbility | Steal ability (drives success rate) |
| `HT P` | — | **Not mapped** - Contact is better for AVG |

## Configuration

**General:**
- League start year: 2000
- Peak age: 27 (pitcher prospect TR only; batter prospect TR uses development curves)
- Replacement FIP: 5.00

**True Ratings:**
- Full confidence IP threshold: 150 (pitchers)
- Full confidence PA threshold: varies by stat (batters)

**Batter Stabilization Constants:**
- BB%: 120 PA
- K%: 60 PA
- HR%: 160 PA
- AVG: 300 PA

**TFR Scouting Weights:**
- All components use **100% scouting potential ratings** for TFR (ceiling projection)
- MiLB stats affect TR (development curves via `ProspectDevelopmentCurveService`), not TFR

**TFR Ceiling Boost:**
- `CEILING_BOOST_FACTOR = 0.35` (batters, in `HitterTrueFutureRatingService.ts`)
- `CEILING_BOOST = 0.30` (pitchers, in `TrueFutureRatingService.ts`)
- Formula: `ceilingValue = meanValue + (meanValue - avgAtRating50) × boost`
- At rating 50: no boost. At rating 80: significant boost above mean projection

**Peak Workload Projections:**
- SP base: 30 + (stamina × 3.0), clamped 120-260 IP
- RP base: 50 + (stamina × 0.5), clamped 40-80 IP
- Injury modifiers only apply to prospects without historical data (established pitchers' history already captures durability)
- Established pitchers use 55% historical IP + 45% model blend
- Skill modifier: FIP ≤3.50 → 1.20x, FIP ≤4.00 → 1.10x, FIP >5.0 → 0.80x
- Elite boost: FIP <3.0 → 1.08x (sliding to 1.0 at FIP 4.0)
- Cap: 105% of historical max IP

**Pitcher MLB Distribution Data:**
- Source years: 2015-2020
- Peak ages: 25-29
- Minimum IP: 50

**Batter MLB Distribution Data:**
- Source years: 2015-2021 (modern era)
- Minimum PA: 300

**Batter Rating→Stat Coefficients (Used for TFR projections):**
```typescript
eye:     { intercept: 1.6246,  slope: 0.114789 }     // BB%
avoidK:  { intercept: 25.10,   slope: -0.200303 }    // K% (calibrated to reduce overprediction)
power:   { intercept: -0.5906, slope: 0.058434 }     // HR%
contact: { intercept: 0.035156, slope: 0.003873 }    // AVG
gap:     { intercept: 0.01,    slope: 0.0008 }       // 2B rate per AB
speed:   { intercept: -0.001657, slope: 0.000083 }   // 3B rate per AB (speed converted from 20-80 to 20-200 internally)

// Stolen base projection (SR/STE → SB/CS)
stealAttempts (3-segment piecewise, per 600 PA):
  SR ≤ 55:  attempts = -2.300 + 0.155 × SR
  55 < SR ≤ 70: attempts = -62.525 + 1.250 × SR
  SR > 70:  attempts = -360.0 + 5.5 × SR     // elite segment: projects capability, not strategy-constrained outcomes
stealSuccess: rate = 0.160 + 0.0096 × STE     // success rate (clamped 0.30-0.98)

Note: True Ratings now use percentile-based component ratings instead of these formulas.
These coefficients are still used for TFR (prospect projections) and scouting conversions.
```

## Testing

Jest with ts-jest (ESM mode). Run all tests:

```bash
npx jest
```

Run a specific test file:

```bash
npx jest src/services/RatingConsistency.test.ts
```

### Test Files

| File | Tests | What it covers |
|------|-------|----------------|
| `src/services/RatingConsistency.test.ts` | 29 | TR/TFR determinism, cross-service consistency, rating estimator round-trips, data contracts, projection formula verification |
| `src/services/RatingEstimatorService.test.ts` | 14 | Pitcher rating estimation (Stuff, Control, HRA) with confidence intervals |
| `src/services/ProjectionService.test.ts` | 6 | IP projection pipeline (stamina, injury, role detection, ramp-up) |

### Rating Consistency Tests

The rating consistency suite (`RatingConsistency.test.ts`) guards against the most common bug class in the app: the same player showing different TR, TFR, or projection values depending on which view you're looking at. It tests the pure calculation services directly (no DB, no mocks needed):

- **Determinism** — Same inputs to `calculateTrueRatings()` always produce identical outputs (pitchers and batters)
- **Cross-service consistency** — FIP ordering matches percentile ordering, WAR ordering matches percentile ordering, component ratings are consistent with blended stats
- **Round-trip integrity** — Rating → stat → rating conversions preserve the original value (hitter estimators round-trip exactly; pitcher estimators within tolerance due to different calibration data)
- **Data contracts** — All fields that profile modals depend on are present and non-NaN, all values fall in realistic baseball ranges
- **Formula verification** — FIP from blended rates matches the manual formula, wOBA recalculation is consistent

## Development Notes

**True Ratings Component Rating System:**
- Batter component ratings (Contact, Power, Eye, AvK) use **percentile-based ranking** within each season
- Implementation: `HitterTrueRatingsCalculationService.calculateComponentRatingsFromPercentiles()`
- Each player is ranked by their blended stat and assigned a rating based on percentile: `rating = 20 + (percentile / 100) × 60`
- This ensures fair comparison across different offensive environments

**When modifying batter coefficients (TFR only):**
1. Update `HitterRatingEstimatorService.ts` (forward: rating → stat)
2. Note: These are now only used for TFR projections and scouting conversions
3. True Ratings use percentile-based rankings, not formulas
4. Run `npx tsx tools/calibrate_batter_coefficients.ts` to verify TFR accuracy

**Rating Ranges:**
- Batter component ratings (Contact, Power, Eye, AvK) use **20-80 scale** directly via percentile mapping
- TFR projections use **0-100 internal range** to prevent artificial capping
- UI displays all ratings as **20-80** (standard OOTP/baseball convention)

**Key Design Decisions:**
- **Percentile-based component ratings** for True Ratings (ensures fair cross-era comparison)
- HR%-based power (not ISO) prevents gap hitter inflation
- Contact rating (not Hit Tool) for AVG predictions
- Component-specific stabilization weights for prospect TR based on MiLB→MLB correlations (TFR uses 100% scouting with ceiling boost)
- Tier-aware regression prevents over-regressing elite talent
- **TFR/TR unification** — TFR shown alongside TR when TFR > TR; hidden when fully realized (see below)
- **Elite stealer uncapping** — SB projections for SR > 70 deliberately overshoot calibration data to project capability rather than strategy-constrained outcomes
- **WAR-based TR/TFR ranking** — Ranking uses WAR per 600 PA (not wOBA) to incorporate baserunning and future-proof for fielding; standardized PA keeps it rate-based
- **Development-curve-based prospect TR** — Batter prospect current ability derived from historical cohort development curves (245 MLB careers), not a deterministic age formula. Individual stats adjust the baseline via Bayesian shrinkage.

### TFR/TR Unified Display

TFR and TR are unified across all views. Instead of proxy thresholds (`isProspect`, `careerAb <= 130`, etc.), the actual ratings comparison determines display:

- **TFR > TR or component upside** → Show both: TR as primary + TFR ceiling bars, Peak badge, Current/Peak projection toggle
  - Rating bars show TR value inside the colored bar, TFR value at the bar's end
  - Diff column compares TFR vs Scout (both are peak projections), not current TR vs Scout
  - Component upside: if any TFR component exceeds its TR counterpart by >= 5 points (on 20-80 scale), the player has unrealized ceiling even if overall TFR == TR
- **TFR <= TR and no component upside** → TFR disappears entirely, player is "fully realized"
- **No TR** (pure prospect) → Show development-curve TR as current ability + TFR as ceiling (see *Prospect True Rating* section)

**Gate check** (skip TFR calculation entirely if): age >= 26 AND star gap < 0.5

**Projection toggle**: MLB players with unrealized upside (`hasTfrUpside` — overall TFR > TR, or any component TFR >= TR + 5) get a Current/Peak toggle on their projection table. Current uses TR blended rates at current age; Peak uses TFR blended rates directly (from the same pipeline that produces the TFR star rating) at peak age with empirical PA projections. Pitcher peak projections are pre-computed async; batter peak projections re-render inline.

**Important**: Peak projections use the TFR pipeline's blended rates directly (`tfrBbPct`, `tfrAvg`, `tfrSlg`, etc.), NOT rates derived from converting 20-80 TFR ratings back through regression formulas. The round-trip (rate → percentile → 20-80 → formula → rate) is lossy and produces inconsistent projections.
