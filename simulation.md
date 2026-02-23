# WBL Season Simulation Engine

## Overview

A Monte Carlo simulation engine that builds on the existing WBL analysis infrastructure (True Ratings, projections, team rosters) to answer questions like:

- "Over 1000 simulations, this team beat this team 58% of the time"
- "Over 1000 sims, these are the win totals for every team"
- "This team makes the playoffs 73% of the time"
- "This team wins the championship 12% of the time"

The current standings projection is a **deterministic simulation** — it estimates expected wins but doesn't model variance. A Monte Carlo sim gives distributions, upset probabilities, and playoff odds.

---

## What Already Exists

The existing infrastructure covers the hardest analytical work:

- **Per-player rate stats** — BB%, K%, HR%, AVG, 2B rate, 3B rate for every batter; K/9, BB/9, HR/9 for every pitcher
- **WAR projections** — per-player expected value
- **Team rosters** — lineup (top 9 by WAR), rotation, bullpen assignments
- **Projected PA/IP** — workload by injury tier
- **WAR-to-Wins** — piecewise conversion for team win totals
- **Aging & projection models** — multi-year forecasts
- **League averages** — via `LeagueBattingAveragesService`

---

## Phase 1: Plate Appearance Outcome Model

Convert existing rate stats into a **complete probability vector** for each PA:

```
P(HR), P(3B), P(2B), P(1B), P(BB), P(K), P(other_out)
```

### Batter Rate Conversion

Most inputs already exist. The conversion from per-AB rates to per-PA probabilities:

- `P(BB) = bbPct` (already per-PA)
- `P(K) = kPct` (already per-PA)
- `P(HR) = hrPct × (1 - bbPct)` (HR% is per-AB, scale to per-PA)
- `P(2B) = doublesRate × (1 - bbPct)` (from gap coefficient: `-0.012627 + 0.001086 × gap`)
- `P(3B) = triplesRate × (1 - bbPct)` (from speed coefficient: `-0.001657 + 0.000083 × speed200`)
- `P(1B) = (AVG - HR/AB - 2B/AB - 3B/AB) × (1 - bbPct)` (singles per PA)
- `P(other_out) = 1 - sum(above)`

### Pitcher Rate Conversion

Pitchers have K/9, BB/9, HR/9. Convert to per-PA rates:

```
PA_per_9 ≈ 38 (league average ~4.2 PA/IP × 9)
P_pitcher(K) = K/9 / PA_per_9
P_pitcher(BB) = BB/9 / PA_per_9
P_pitcher(HR) = HR/9 / PA_per_9
```

For batted ball outcomes (1B, 2B, 3B), pitchers use league-average rates (pitchers primarily influence K/BB/HR; batted ball distribution is mostly batter-driven).

### Matchup Formula (Log5 / Odds-Ratio)

Combines pitcher and batter rates against a league-average baseline:

```
P(event) = (P_batter × P_pitcher) / P_league
```

Example: batter walks 12%, pitcher allows walks 6%, league average 8%:

```
P(BB) = (0.12 × 0.06) / 0.08 = 0.09 = 9%
```

Applied to each outcome independently, then the full vector is renormalized so probabilities sum to 1.0.

League averages are already available from `LeagueBattingAveragesService`.

**Difficulty: Low** — all inputs exist, just normalization into a probability simplex.

---

## Phase 2: Game State Machine

A single-game simulator tracking:

- **Inning** (1-9+, top/bottom)
- **Outs** (0-2)
- **Base state** (8 possible: empty, 1B, 2B, 3B, 1B+2B, 1B+3B, 2B+3B, loaded)
- **Score** (home, away)
- **Lineup position** (1-9, persistent across innings)
- **Current pitcher** (starter vs. reliever)

### PA Resolution

Each plate appearance:

1. Get batter's probability vector
2. Get pitcher's probability vector
3. Combine via log5 matchup formula
4. Roll random number against cumulative probabilities
5. Resolve outcome → advance runners → update outs/score

### Runner Advancement Rules (Simplified)

| Outcome | Runners | Notes |
|-|-|-|
| Walk (BB) | Forced advances only | Runner on 1st→2nd only if forced |
| Single (1B) | Runners advance 1 base | Runner on 2nd scores, runner on 1st→2nd |
| Double (2B) | Runners on base score | Batter to 2nd |
| Triple (3B) | All runners score | Batter to 3rd |
| Home Run (HR) | Everyone scores | Batter scores too |
| Strikeout (K) | No advancement | Outs++ |
| Other out | No advancement | Outs++ |

This simplified model gets ~90% accuracy. Enhancements for later:

- Speed-based advancement (fast runner scores from 1st on a double)
- GIDP (ground into double play with runner on 1st, <2 outs)
- Sacrifice flies (runner on 3rd scores on flyout, <2 outs)
- Errors

### Game Flow

```
while game not over:
    for each half-inning (top, bottom):
        outs = 0
        while outs < 3:
            resolve PA → outcome
            advance runners, update outs/score
            advance lineup position

    if inning >= 9 and scores not tied:
        game over (leader wins)
    if bottom of 9+ and home team takes lead:
        walk-off, game over
```

### Stolen Base Attempts

Between PAs, check for stolen base attempts:

- Probability of attempt based on `stealingAggressiveness` (SR rating)
- Success probability based on `stealingAbility` (STE rating)
- Only attempt with runner on 1st or 2nd, base ahead empty, <2 outs
- Existing SB model: `attempts = f(SR)`, `successRate = 0.160 + 0.0096 × STE`
- Scale attempt rate to per-PA probability

**Difficulty: Medium** — straightforward state machine, but edge cases (extra innings, walk-offs, etc.)

---

## Phase 3: Game Management / Strategy Layer

### Starting Rotation

- 5-man rotation, cycling through starters in order
- Starters ranked by projected WAR or FIP
- Rest days tracked (starter unavailable for 4 days after start)

### Starter Pull Rules (Simple)

Pull the starter when any condition is met:

- Pitched 6+ innings AND 100+ pitches (estimated: ~15 pitches/IP)
- Gave up 5+ runs
- Pitch count exceeds `stamina × 2 + 20` (maps stamina 30-80 to ~80-180 max pitches)

Starter IP per game can also be sampled from a distribution centered on their projected IP/GS.

### Bullpen Usage

Map bullpen arms by role:

| Role | When Used | Condition |
|-|-|-|
| Closer | 9th inning | Lead of 1-3 runs |
| Setup | 7th-8th inning | Lead of 1-4 runs |
| Middle relief | 5th-7th inning | Any score |
| Long relief | Any inning | Starter pulled early (<5 IP) |
| Mop-up | Any inning | Deficit of 5+ runs |

Reliever selection within role: best available (by FIP/WAR), subject to rest (unavailable after 2 consecutive days or 40+ pitches previous day).

### Lineup Construction

Use existing logic (top 9 by projected WAR). Batting order heuristic:

| Slot | Selection |
|-|-|
| 1 | Best OBP (among high-OBP players) |
| 2 | Best overall hitter (highest WAR) |
| 3 | 2nd best WAR |
| 4 | Best power (highest HR%) |
| 5-7 | Next best by WAR |
| 8-9 | Remaining, worst hitter bats 9th |

### What to Skip Initially

- Pinch hitting and defensive substitutions
- Platoon splits (L/R matchups)
- Double switches
- Intentional walks
- Bunt/sacrifice strategies

**Difficulty: Low-Medium** — start simple, add layers later.

---

## Phase 4: Season Simulation

### Schedule Generator

Options (in order of complexity):

1. **Balanced round-robin**: Each team plays every other team `162 / (N-1)` times. With 20 teams: ~8-9 games each, adjusted to hit 162.
2. **Division-weighted**: More games within division (realistic). Requires division/league structure.
3. **Import actual schedule**: Parse OOTP schedule export if available.

For initial implementation, balanced round-robin is sufficient.

### Season Loop

```
for each simulation (1..N):
    for each game in schedule:
        result = simulate_game(home, away, home_starter, away_starter)
        record winner, score

    calculate final standings (W-L per team)
    determine playoff qualifiers
    (optional) simulate playoffs

aggregate across all simulations:
    mean/median wins per team
    win distribution (std dev, min, max, percentiles)
    playoff probability per team
    division winner probability
```

### Output

- **Win distribution table**: Team, Mean W, Median W, Std Dev, Min, Max, P10, P90
- **Playoff odds**: % of sims each team makes playoffs
- **Division winners**: % of sims each team wins division
- **Head-to-head**: Season series record distribution

**Difficulty: Low** — loop around the game engine.

---

## Phase 5: Head-to-Head Mode

Simpler than full season — just simulate N games between two specific teams:

```
simulate_series(teamA, teamB, numGames=1000)
→ "Team A wins 58.3% of the time"
→ "Average score: 4.7 - 4.2"
→ "Team A is shut out 8.2% of games"
```

Can also simulate playoff series (best-of-5, best-of-7):

```
simulate_playoff_series(teamA, teamB, seriesLength=7, numSims=1000)
→ "Team A wins series 62% of the time"
→ "Average series length: 5.8 games"
→ "Team A sweeps 15% of the time"
```

**Difficulty: Low** — subset of the season simulation.

---

## Phase 6: Playoff Simulation

After regular season standings are determined:

1. Seed teams by record (or use league's actual playoff format)
2. Simulate each playoff round (best-of-5 or best-of-7)
3. Track championship winners across all sims

### Output

- Championship probability per team
- Pennant/league championship probability
- Round-by-round advancement probability
- Cinderella/upset frequency

Requires knowing the league's playoff structure (number of teams, wild cards, bracket format).

**Difficulty: Low-Medium** — straightforward once game engine exists.

---

## Phase 7: Variance & Realism Layer

Pure rate-stat dice rolls produce tighter distributions than real baseball. Optional enhancements for realistic spread:

### Injury Simulation

Random missed games based on injury tier (tiers already exist):

| Tier | Games Missed Distribution |
|-|-|
| Iron Man | 0-5 games (95% healthy) |
| Durable | 0-15 games (90% healthy) |
| Normal | 0-30 games (80% healthy) |
| Fragile | 10-60 games (65% healthy) |
| Wrecked | 20-100 games (50% healthy) |

When a starter is injured, call up replacement (bench player or minor leaguer with lower ratings).

### Performance Variance

Add noise around projected rates each sim to represent true talent uncertainty:

```
simBbPct = projected_bbPct × (1 + noise)
where noise ~ Normal(0, σ)
σ decreases with more PA (established players have less uncertainty)
```

### Hot/Cold Streaks

Optional autocorrelation in game-to-game performance. Probably overkill for initial implementation.

### Home Field Advantage

Historical MLB home teams win ~54% of games. Simple implementation: small boost to home team's rates (e.g., +2% to all offensive rates for home batters).

**Difficulty: Medium-High** — the "make it feel real" layer. Each sub-feature is independently optional.

---

## Architecture

### Where It Runs

| Option | Pros | Cons |
|-|-|-|
| **Web Worker** (recommended) | Fits existing client-side architecture, UI stays responsive, access to IndexedDB data | Limited to single thread per worker |
| **Browser main thread** | Simplest implementation | UI freezes during sims |
| **Node CLI tool** | Matches existing `tools/` pattern, easy to script | Separate from UI, needs its own data loading |

**Recommended: Web Worker** with a SimulationView in the app. The worker pulls team/player data from existing services, runs simulations, and posts progress/results back to the UI.

### File Structure

```
src/
├── services/
│   ├── simulation/
│   │   ├── PlateAppearanceEngine.ts    # PA outcome model + matchup formula
│   │   ├── GameEngine.ts               # Game state machine
│   │   ├── GameManager.ts              # Lineup, rotation, bullpen strategy
│   │   ├── SeasonSimulator.ts          # Season loop + schedule
│   │   ├── PlayoffSimulator.ts         # Postseason bracket simulation
│   │   └── SimulationConfig.ts         # Tunable parameters
│   └── SimulationService.ts            # Orchestration, data loading, worker interface
├── workers/
│   └── simulation.worker.ts            # Web Worker entry point
├── views/
│   └── SimulationView.ts               # UI: team picker, run button, results display
└── models/
    └── SimulationTypes.ts              # Interfaces for sim config, results, game state
```

### Data Flow

```
Existing Services (TR, projections, rosters, league averages)
    ↓
SimulationService (builds team/player snapshots for sim)
    ↓
Web Worker (receives snapshots, runs N simulations)
    ↓ progress updates
SimulationView (progress bar, results tables, charts)
```

### Key Interfaces

```typescript
interface SimConfig {
    numSimulations: number;      // default 1000
    mode: 'season' | 'series';  // full season or head-to-head
    teams?: [number, number];    // for series mode
    seriesLength?: number;       // for playoff series (5 or 7)
    includePlayoffs: boolean;
    includeInjuries: boolean;
    includeVariance: boolean;
    homeFieldAdvantage: number;  // default 0.54
}

interface TeamSnapshot {
    teamId: number;
    teamName: string;
    lineup: PlayerSnapshot[];    // 9 batters in order
    bench: PlayerSnapshot[];     // 4-5 bench bats
    rotation: PlayerSnapshot[];  // 5 starters
    bullpen: PlayerSnapshot[];   // 7-8 relievers
}

interface PlayerSnapshot {
    playerId: number;
    name: string;
    // Batter rates (per-PA probabilities)
    bbPct: number;
    kPct: number;
    hrRate: number;
    singleRate: number;
    doubleRate: number;
    tripleRate: number;
    // Pitcher rates (per-PA probabilities)
    pK: number;
    pBB: number;
    pHR: number;
    // Workload
    projectedPa: number;
    projectedIp: number;
    stamina: number;
    injuryTier: string;
    // Baserunning
    sbAttemptRate: number;
    sbSuccessRate: number;
}

interface SeasonResult {
    wins: number;
    losses: number;
    runsScored: number;
    runsAllowed: number;
    madePlayoffs: boolean;
    wonChampionship: boolean;
}

interface SimulationResults {
    teamResults: Map<number, SeasonResult[]>;  // teamId → array of N season results
    summary: TeamSummary[];                     // aggregated stats per team
}

interface TeamSummary {
    teamId: number;
    teamName: string;
    meanWins: number;
    medianWins: number;
    stdDev: number;
    minWins: number;
    maxWins: number;
    p10Wins: number;
    p90Wins: number;
    playoffPct: number;
    championshipPct: number;
}
```

---

## Build Order Summary

| Phase | What | Delivers | Depends On |
|-|-|-|-|
| 1 | PA outcome model + matchup formula | Per-PA result generation | Existing rate stats |
| 2 | Game state machine | Simulate a single game | Phase 1 |
| 3 | Lineup/rotation/bullpen rules | Realistic game flow | Phase 2 |
| 4 | Season loop + schedule | Win totals for every team (N sims) | Phase 3 |
| 5 | Head-to-head mode | "Team A beats Team B X% of the time" | Phase 2 |
| 6 | Playoff simulation | Championship odds | Phase 4 |
| 7 | Injury/variance layer | Realistic spread in distributions | Phase 4 |

Phases 1-2 are the core engine. Phase 3 makes it playable. Phases 4-5 answer the headline questions. Phases 6-7 are polish.

---

## Calibration & Validation

### Sanity Checks

- Average team should win ~81 games (by construction if schedule is balanced)
- League total wins = league total losses
- Individual player stat lines should roughly match projected rates (over many sims)
- Team run scoring should correlate with lineup wOBA
- Pythagorean expectation from simulated RS/RA should roughly match simulated W-L

### Backtesting

Use historical seasons (2005-2020) where actual standings are known:

- Compare simulated mean wins to actual wins (target: MAE < 5 wins)
- Compare simulated playoff probabilities to actual outcomes
- Verify that the spread of simulated outcomes brackets reality (actual wins should fall within P10-P90 most of the time)

### Tuning Parameters

- Log5 exponent (how strongly matchups matter)
- Home field advantage magnitude
- Variance/noise amplitude per PA
- Bullpen usage thresholds
- Injury frequency distributions
