Perfect — this is a great candidate for a clean, implementation-ready spec. Below is a **Markdown design document** you can drop straight into your repo (or hand to Codex) as a guiding blueprint.

I’ve written it in a way that is:

* **algorithmically explicit**
* **implementation-oriented**
* opinionated where helpful, but extensible where you’ll want to iterate later

You can treat this as `docs/pitcher_ratings.md` or similar.

---

# Custom Pitcher Rating System (OOTP)

## Overview

OOTP’s built-in overall ratings conflate many skills and obscure league context.
This system derives **league-relative pitcher ratings** using only the “true outcomes” a pitcher controls in OOTP:

* **BB/9** → Control
* **K/9** → Stuff
* **HR/9** → Home Run Avoidance (HRA)

The goal is to:

* evaluate pitchers **relative to their league**
* stabilize noisy stats using multi-year data
* incorporate scouting as a **prior, not truth**
* account for **aging and historical decline**
* produce a **5-point rating scale** in **0.5 increments**
  (`0.5, 1.0, 1.5, …, 5.0`)

This system is designed to output both **current value** and **future value** ratings.

---

## Rating Philosophy

* Ratings are **contextual**, not absolute.
* Most pitchers should cluster around **2.5–3.5**.
* **5.0** ratings should be extremely rare.
* Scouting informs expectations, but **performance earns the rating**.
* Age matters — decline is modeled empirically, not heuristically.

---

## Inputs

### Required Per-Pitcher Inputs

* Age
* Scouting ratings:

  * `Control`
  * `Stuff`
  * `HRA`
* Pitching stats for the last N seasons (recommended: 3):

  * `BB/9`
  * `K/9`
  * `HR/9`
  * `IP`

### Required League-Level Inputs

* League-wide pitcher stats (same metrics as above)
* Historical pitcher seasons (for age curve modeling)

---

## Step 1: Multi-Year Stat Stabilization

### 1.1 Weighted Multi-Year Averages

Use a weighted average favoring recent seasons.

**Example (3 years):**

* Year N: weight = 5
* Year N-1: weight = 3
* Year N-2: weight = 2

For each stat independently:

```
weighted_rate =
  (rate_N * 5 + rate_N-1 * 3 + rate_N-2 * 2) /
  (5 + 3 + 2)
```

### 1.2 Regression to League Mean

To reduce small-sample noise, regress each stat toward the league average.

```
regressed_rate =
  (weighted_rate * IP + league_rate * K) /
  (IP + K)
```

Where:

* `IP` = total innings across the weighted seasons
* `K` = stabilization constant (stat-specific)

Suggested stabilization constants:

* BB/9: 40 IP
* K/9: 50 IP
* HR/9: 70 IP

(These can be tuned empirically.)

---

## Step 2: Scouting as a Bayesian Prior

Scouting ratings represent **expected performance**, not observed performance.

### 2.1 Mapping Scouting → Expected Rates

Two viable approaches:

#### Option A: Empirical Mapping (Preferred)

Fit regressions using league data:

* `BB/9 ~ Control`
* `K/9 ~ Stuff`
* `HR/9 ~ HRA`

This produces league-specific expectations:

```
expected_BB9_from_control
expected_K9_from_stuff
expected_HR9_from_hra
```

#### Option B: Hand-Tuned Anchors (Bootstrap)

Define anchor points (example):

| Rating | BB/9 | K/9 | HR/9 |
| ------ | ---- | --- | ---- |
| 20     | 3.0  | 4.0 | 1.8  |
| 50     | 1.8  | 6.0 | 1.1  |
| 80     | 0.8  | 8.0 | 0.5  |

Interpolate linearly between anchors.

---

### 2.2 Blending Stats and Scouting

Blend regressed stats with scouting expectations using innings as confidence.

```
w_stats = IP / (IP + scout_confidence)
final_rate =
  w_stats * regressed_rate +
  (1 - w_stats) * scouting_expected_rate
```

Suggested `scout_confidence`: 60 IP

This ensures:

* Prospects lean on scouting
* Veterans lean on results

---

## Step 3: Compute FIP-like Metric

Classic FIP requires counting stats; instead, use a **rate-based proxy**.

```
FIP_like =
  (13 * HR9 + 3 * BB9 - 2 * K9) / 9
```

Notes:

* Lower is better
* Constant term is omitted (ranking only)
* This metric aligns cleanly with OOTP’s internal pitcher controls

---

## Step 4: League-Relative Ranking

### 4.1 Percentile Calculation

Across all qualified league pitchers:

* Compute percentiles of `FIP_like`
* Invert so **higher percentile = better pitcher**

```
goodness_percentile = 1 - percentile_rank(FIP_like)
```

---

## Step 5: Convert Percentiles to Ratings (Bell Curve)

Ratings follow a normal-distribution-inspired scale.

| Percentile Range | Rating |
| ---------------- | ------ |
| ≥ 97.7%          | 5.0    |
| 93.3–97.7%       | 4.5    |
| 84.1–93.3%       | 4.0    |
| 69.1–84.1%       | 3.5    |
| 50.0–69.1%       | 3.0    |
| 30.9–50.0%       | 2.5    |
| 15.9–30.9%       | 2.0    |
| 6.7–15.9%        | 1.5    |
| 2.3–6.7%         | 1.0    |
| < 2.3%           | 0.5    |

This ensures:

* Most pitchers cluster near average
* Elite ratings are rare and meaningful

---

## Step 6: Age Curve and Decline Modeling

### 6.1 Build Empirical Age Curves

From historical league data:

* Group pitcher seasons by age
* Compute year-over-year deltas:

  * ΔBB/9
  * ΔK/9
  * ΔHR/9

Optionally segment by archetype:

* High-K pitchers
* Control specialists
* HR suppressors

---

### 6.2 Project Forward

For each pitcher:

```
projected_rate =
  final_rate +
  expected_delta(age, archetype)
```

Apply per-stat deltas independently.

---

## Step 7: Output Ratings

Produce **two ratings**:

### 7.1 Current Value (NV)

* Based on final blended rates
* Represents present-day effectiveness

### 7.2 Future Value (FV)

* Apply age-based projections (1–3 years forward)
* Recompute FIP_like and rating
* Represents trade/extension value

---

## Summary Pipeline

1. Ingest multi-year pitcher stats
2. Compute weighted, regressed BB/9, K/9, HR/9
3. Map scouting ratings → expected rates
4. Blend stats and scouting by innings
5. Compute FIP-like metric
6. Rank pitchers league-wide
7. Convert percentiles → 0.5–5.0 ratings
8. Apply age curves for future value (optional)

---

## Design Notes

* This system intentionally ignores ERA, BABIP, defense, and sequencing.
* It measures **pitcher skill**, not results.
* Extensions:

  * Separate SP/RP curves
  * Injury risk adjustments
  * Park factors


---
