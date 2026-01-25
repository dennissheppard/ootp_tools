"""
Additional analysis: Individual player progressions across levels
and age-adjusted performance analysis.
"""

import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

def load_all_data():
    """Load all CSV files."""
    scouting = pd.read_csv(DATA_DIR / "scouting.csv")
    scouting.columns = ['id', 'name', 'stuff', 'control', 'hra', 'age']
    scouting['id'] = scouting['id'].astype(int)

    levels = ['r', 'a', 'aa', 'aaa']
    years = [2019, 2020]
    all_stats = []
    for year in years:
        for level in levels:
            filepath = DATA_DIR / f"{level}_stats_{year}.csv"
            if filepath.exists():
                df = pd.read_csv(filepath)
                df.columns = ['id', 'name', 'ip', 'hr', 'bb', 'k', 'hr9', 'bb9', 'k9']
                df['year'] = year
                df['level'] = level
                df['id'] = df['id'].astype(int)
                all_stats.append(df)
    stats = pd.concat(all_stats, ignore_index=True)
    return scouting, stats


def analyze_age_adjusted_performance(scouting, stats):
    """See if younger players at same level have better scouting ratings."""

    print("\n" + "="*60)
    print("AGE-ADJUSTED ANALYSIS: Do younger players have better potential?")
    print("="*60)

    merged = stats.merge(scouting, on='id')
    merged = merged[merged['ip'] >= 30]

    # Calculate "expected" age for each level
    level_avg_age = {'r': 20.5, 'a': 22.3, 'aa': 23.8, 'aaa': 26.1}
    merged['level_avg_age'] = merged['level'].map(level_avg_age)
    merged['age_vs_level'] = merged['age'] - merged['level_avg_age']

    # Split into young-for-level and old-for-level
    print("\n--- Scouting Ratings by Age-for-Level ---")
    print("(Negative = younger than average for that level)")

    young = merged[merged['age_vs_level'] < -1]  # 1+ year younger than avg
    avg_age = merged[(merged['age_vs_level'] >= -1) & (merged['age_vs_level'] <= 1)]
    old = merged[merged['age_vs_level'] > 1]  # 1+ year older than avg

    print(f"\n{'Category':<20} {'Stuff':>8} {'Control':>10} {'HRA':>8} {'N':>6}")
    print("-" * 56)
    print(f"{'Young for level':<20} {young['stuff'].mean():>8.1f} {young['control'].mean():>10.1f} {young['hra'].mean():>8.1f} {len(young):>6}")
    print(f"{'Average age':<20} {avg_age['stuff'].mean():>8.1f} {avg_age['control'].mean():>10.1f} {avg_age['hra'].mean():>8.1f} {len(avg_age):>6}")
    print(f"{'Old for level':<20} {old['stuff'].mean():>8.1f} {old['control'].mean():>10.1f} {old['hra'].mean():>8.1f} {len(old):>6}")

    # Calculate projected FIP from scouting
    def expected_fip(row):
        k9 = 2.07 + 0.074 * row['stuff']
        bb9 = 5.22 - 0.052 * row['control']
        hr9 = 2.08 - 0.024 * row['hra']
        fip = (13 * hr9 + 3 * bb9 - 2 * k9) / 9 + 3.47
        return fip

    young_fip = young.apply(expected_fip, axis=1).mean()
    avg_fip = avg_age.apply(expected_fip, axis=1).mean()
    old_fip = old.apply(expected_fip, axis=1).mean()

    print(f"\n{'Projected FIP from scouting:'}")
    print(f"  Young for level: {young_fip:.2f}")
    print(f"  Average age:     {avg_fip:.2f}")
    print(f"  Old for level:   {old_fip:.2f}")


def analyze_top_prospects(scouting, stats):
    """Look at the top prospects by scouting and see their stats."""

    print("\n" + "="*60)
    print("TOP PROSPECTS ANALYSIS")
    print("="*60)

    # Calculate projected FIP from scouting
    def expected_fip(row):
        k9 = 2.07 + 0.074 * row['stuff']
        bb9 = 5.22 - 0.052 * row['control']
        hr9 = 2.08 - 0.024 * row['hra']
        fip = (13 * hr9 + 3 * bb9 - 2 * k9) / 9 + 3.47
        return fip

    scouting['proj_fip'] = scouting.apply(expected_fip, axis=1)

    # Top 30 by projected FIP
    top_30 = scouting.nsmallest(30, 'proj_fip')

    print("\n--- Top 30 Prospects by Scouting Ratings ---")
    print(f"{'Name':<25} {'Age':>4} {'STU':>4} {'CON':>4} {'HRA':>4} {'Proj FIP':>9}")
    print("-" * 60)

    for _, row in top_30.iterrows():
        print(f"{row['name'][:24]:<25} {row['age']:>4} {row['stuff']:>4} {row['control']:>4} {row['hra']:>4} {row['proj_fip']:>9.2f}")

    # Now see their actual stats
    print("\n--- Their Actual Minor League Stats (2020, highest level) ---")

    merged = stats[stats['year'] == 2020].merge(top_30[['id', 'proj_fip']], on='id')

    # Keep only highest level for each player
    level_order = {'r': 0, 'a': 1, 'aa': 2, 'aaa': 3}
    merged['level_num'] = merged['level'].map(level_order)
    merged = merged.sort_values('level_num', ascending=False).drop_duplicates('id')

    # Calculate actual FIP-like
    merged['actual_fip'] = (13 * merged['hr9'] + 3 * merged['bb9'] - 2 * merged['k9']) / 9 + 3.47

    print(f"\n{'Name':<25} {'Level':>5} {'IP':>6} {'K/9':>5} {'BB/9':>5} {'HR/9':>5} {'Act FIP':>8} {'Proj':>6}")
    print("-" * 76)

    for _, row in merged.sort_values('proj_fip').head(20).iterrows():
        name = row['name'] if isinstance(row['name'], str) else str(row['name'])
        print(f"{name[:24]:<25} {row['level'].upper():>5} {row['ip']:>6.0f} {row['k9']:>5.1f} {row['bb9']:>5.1f} {row['hr9']:>5.1f} {row['actual_fip']:>8.2f} {row['proj_fip']:>6.2f}")


def calculate_level_adjustments(scouting, stats):
    """Calculate empirical level adjustments."""

    print("\n" + "="*60)
    print("EMPIRICAL LEVEL ADJUSTMENTS")
    print("="*60)

    # The "Actual - Expected" differences can serve as level adjustments
    # If a player at AAA has K/9 0.30 lower than expected from ratings,
    # then to project to MLB, we add 0.30 to their K/9

    # But we need to think about this differently:
    # The ratings predict MLB performance.
    # The minor league stats are below this due to development.
    # So the "adjustment" is: how much do we trust stats vs ratings?

    merged = stats.merge(scouting, on='id')
    merged = merged[merged['ip'] >= 50]

    # Calculate expected from ratings
    merged['exp_k9'] = 2.07 + 0.074 * merged['stuff']
    merged['exp_bb9'] = 5.22 - 0.052 * merged['control']
    merged['exp_hr9'] = 2.08 - 0.024 * merged['hra']

    print("\n--- If we trusted stats 100%, what adjustments would we need? ---")
    print("(To translate minor league stats to 'rating-equivalent' MLB stats)")
    print(f"\n{'Level':<6} {'K/9 adj':>10} {'BB/9 adj':>10} {'HR/9 adj':>10}")
    print("-" * 42)

    for level in ['r', 'a', 'aa', 'aaa']:
        level_data = merged[merged['level'] == level]
        if len(level_data) > 10:
            # Adjustment = expected - actual (to bring stats UP to expected)
            k9_adj = (level_data['exp_k9'] - level_data['k9']).mean()
            bb9_adj = (level_data['exp_bb9'] - level_data['bb9']).mean()
            hr9_adj = (level_data['exp_hr9'] - level_data['hr9']).mean()
            print(f"{level.upper():<6} {k9_adj:>+10.2f} {bb9_adj:>+10.2f} {hr9_adj:>+10.2f}")

    print("\nInterpretation:")
    print("  Positive K/9 adj = Add to minor league K/9 to estimate MLB K/9")
    print("  Negative BB/9 adj = Subtract from minor league BB/9 for MLB estimate")
    print("\nNote: These adjustments assume ratings perfectly predict MLB performance.")
    print("In practice, we blend stats and ratings, with ratings weighted more heavily.")


def recommend_formula(scouting, stats):
    """Recommend True Future Rating formula based on analysis."""

    print("\n" + "="*70)
    print("RECOMMENDED TRUE FUTURE RATING APPROACH")
    print("="*70)

    print("""
Based on the data analysis:

1. CORRELATIONS ARE MODERATE (0.25-0.45)
   - Stats explain only 10-20% of scouting variance
   - Recommendation: Weight scouting 70-80%, stats 20-30%

2. LEVEL STATS ARE SIMILAR
   - Avg K/9: 5.5-5.7 across all levels (almost no difference!)
   - This suggests OOTP doesn't heavily simulate level difficulty differences
   - OR: Better pitchers are at higher levels, balancing out
   - Recommendation: Use simple level-based stat adjustments, not major ones

3. MINOR LEAGUERS UNDERPERFORM THEIR RATINGS
   - K/9 is ~0.3-0.5 LOWER than scouting predicts
   - BB/9 is ~0.4-0.6 HIGHER than scouting predicts
   - This makes sense: ratings = potential, not current performance
   - Recommendation: For future projection, trust ratings (they predict end state)

4. AGE MATTERS
   - Younger players at same level have better ratings
   - Young-for-level: ~51-52 avg ratings
   - Old-for-level: ~48-49 avg ratings
   - Recommendation: Weight scouting more for younger players

PROPOSED TRUE FUTURE RATING FORMULA:
=====================================

Step 1: Calculate "Projected MLB Rates"

  For each stat (K/9, BB/9, HR/9):

    projected_rate = w_scout * scouting_expected + w_stats * adjusted_stats

  Where:
    - scouting_expected = rate calculated from scouting ratings
    - adjusted_stats = minor league rate + level adjustment
    - w_scout = scouting weight (higher for younger players, lower IP)
    - w_stats = 1 - w_scout

  Scouting weight formula:
    base_weight = 0.7  (trust scouting 70% at baseline)
    age_bonus = max(0, (24 - age) * 0.03)  (younger = more scouting)
    ip_factor = 50 / (50 + total_ip)  (less IP = more scouting)

    w_scout = min(0.95, base_weight + age_bonus + ip_factor * 0.2)

  Level adjustments (to translate to MLB-equivalent):
    AAA: K/9 +0.30, BB/9 -0.42, HR/9 +0.14
    AA:  K/9 +0.33, BB/9 -0.47, HR/9 +0.06
    A:   K/9 +0.22, BB/9 -0.59, HR/9 +0.07
    R:   K/9 +0.45, BB/9 -0.58, HR/9 +0.06

Step 2: Calculate Projected FIP

  proj_fip = (13 * proj_hr9 + 3 * proj_bb9 - 2 * proj_k9) / 9 + FIP_constant

Step 3: Rank Against Current MLB Pitchers

  Compare proj_fip against all current MLB pitcher FIPs
  Calculate percentile

Step 4: Convert to 0.5-5.0 Rating

  Use same percentile-to-rating buckets as current True Rating
""")


def main():
    print("Loading data...")
    scouting, stats = load_all_data()

    analyze_age_adjusted_performance(scouting, stats)
    analyze_top_prospects(scouting, stats)
    calculate_level_adjustments(scouting, stats)
    recommend_formula(scouting, stats)


if __name__ == "__main__":
    main()
