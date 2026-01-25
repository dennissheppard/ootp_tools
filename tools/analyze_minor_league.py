"""
Analyze minor league data to derive True Future Rating parameters.

Questions to answer:
1. Do minor league stats correlate with scouting ratings?
2. How do stats change across levels for same players?
3. How does age interact with level and performance?
"""

import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"

def load_all_data():
    """Load all CSV files into a structured format."""

    # Load scouting data
    scouting = pd.read_csv(DATA_DIR / "scouting.csv")
    scouting.columns = ['id', 'name', 'stuff', 'control', 'hra', 'age']
    scouting['id'] = scouting['id'].astype(int)
    print(f"Scouting data: {len(scouting)} players")
    print(f"Age range: {scouting['age'].min()} - {scouting['age'].max()}")
    print(f"Age distribution:\n{scouting['age'].value_counts().sort_index()}\n")

    # Load minor league stats
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
                print(f"Loaded {level.upper()} {year}: {len(df)} pitchers")

    stats = pd.concat(all_stats, ignore_index=True)
    print(f"\nTotal stats rows: {len(stats)}")

    return scouting, stats


def analyze_correlations(scouting, stats):
    """Analyze correlations between minor league stats and scouting ratings."""

    print("\n" + "="*60)
    print("CORRELATION ANALYSIS: Minor League Stats vs Scouting Ratings")
    print("="*60)

    # Merge stats with scouting
    merged = stats.merge(scouting, on='id', suffixes=('', '_scout'))
    print(f"\nPlayers with both stats and scouting: {merged['id'].nunique()}")

    # Filter for meaningful IP (at least 30 IP)
    merged_30ip = merged[merged['ip'] >= 30]
    print(f"Players with 30+ IP: {merged_30ip['id'].nunique()}")

    # Calculate correlations by level
    print("\n--- Correlations by Level (30+ IP) ---")
    print(f"{'Level':<6} {'K/9-Stuff':>12} {'BB/9-Control':>14} {'HR/9-HRA':>12} {'N':>6}")
    print("-" * 56)

    for level in ['r', 'a', 'aa', 'aaa']:
        level_data = merged_30ip[merged_30ip['level'] == level]
        if len(level_data) > 10:
            k9_stuff = level_data['k9'].corr(level_data['stuff'])
            bb9_control = level_data['bb9'].corr(level_data['control'])  # Note: should be negative
            hr9_hra = level_data['hr9'].corr(level_data['hra'])  # Note: should be negative
            print(f"{level.upper():<6} {k9_stuff:>12.3f} {bb9_control:>14.3f} {hr9_hra:>12.3f} {len(level_data):>6}")

    # Overall correlation
    all_data = merged_30ip
    if len(all_data) > 10:
        k9_stuff = all_data['k9'].corr(all_data['stuff'])
        bb9_control = all_data['bb9'].corr(all_data['control'])
        hr9_hra = all_data['hr9'].corr(all_data['hra'])
        print("-" * 56)
        print(f"{'ALL':<6} {k9_stuff:>12.3f} {bb9_control:>14.3f} {hr9_hra:>12.3f} {len(all_data):>6}")

    # Show expected direction
    print("\n(Positive = higher stat with higher rating)")
    print("Expected: K/9-Stuff positive, BB/9-Control negative, HR/9-HRA negative")

    return merged


def analyze_level_transitions(stats):
    """Analyze how stats change when players move between levels."""

    print("\n" + "="*60)
    print("LEVEL TRANSITION ANALYSIS")
    print("="*60)

    # Find players who pitched at multiple levels in the same year or consecutive years
    player_levels = stats.groupby('id').agg({
        'level': list,
        'year': list,
        'k9': list,
        'bb9': list,
        'hr9': list,
        'ip': list
    }).reset_index()

    multi_level = player_levels[player_levels['level'].apply(len) > 1]
    print(f"\nPlayers with stats at multiple levels: {len(multi_level)}")

    # Define level order
    level_order = {'r': 0, 'a': 1, 'aa': 2, 'aaa': 3}

    # Calculate average stats by level (weighted by IP, min 50 IP)
    level_stats = stats[stats['ip'] >= 50].groupby('level').agg({
        'k9': ['mean', 'std', 'count'],
        'bb9': ['mean', 'std'],
        'hr9': ['mean', 'std']
    }).round(2)

    print("\n--- Average Stats by Level (50+ IP) ---")
    print(f"{'Level':<6} {'K/9 (avg+/-std)':>16} {'BB/9 (avg+/-std)':>16} {'HR/9 (avg+/-std)':>16} {'N':>6}")
    print("-" * 66)

    for level in ['r', 'a', 'aa', 'aaa']:
        if level in level_stats.index:
            row = level_stats.loc[level]
            k9_str = f"{row['k9']['mean']:.1f}+/-{row['k9']['std']:.1f}"
            bb9_str = f"{row['bb9']['mean']:.1f}+/-{row['bb9']['std']:.1f}"
            hr9_str = f"{row['hr9']['mean']:.1f}+/-{row['hr9']['std']:.1f}"
            n = int(row['k9']['count'])
            print(f"{level.upper():<6} {k9_str:>16} {bb9_str:>16} {hr9_str:>16} {n:>6}")


def analyze_age_by_level(scouting, stats):
    """Analyze age distribution by level."""

    print("\n" + "="*60)
    print("AGE BY LEVEL ANALYSIS")
    print("="*60)

    # Merge to get age
    merged = stats.merge(scouting[['id', 'age']], on='id')

    # Filter for meaningful IP
    merged = merged[merged['ip'] >= 30]

    print("\n--- Average Age by Level (30+ IP) ---")
    print(f"{'Level':<6} {'Avg Age':>10} {'Min':>6} {'Max':>6} {'N':>6}")
    print("-" * 40)

    for level in ['r', 'a', 'aa', 'aaa']:
        level_data = merged[merged['level'] == level]
        if len(level_data) > 0:
            avg = level_data['age'].mean()
            min_age = level_data['age'].min()
            max_age = level_data['age'].max()
            print(f"{level.upper():<6} {avg:>10.1f} {min_age:>6} {max_age:>6} {len(level_data):>6}")


def analyze_stats_vs_expected(scouting, stats):
    """Compare actual stats to expected stats from scouting ratings."""

    print("\n" + "="*60)
    print("ACTUAL vs EXPECTED (from scouting)")
    print("="*60)

    # Formulas from CLAUDE.md
    def expected_k9(stuff):
        return 2.07 + 0.074 * stuff

    def expected_bb9(control):
        return 5.22 - 0.052 * control

    def expected_hr9(hra):
        return 2.08 - 0.024 * hra

    # Merge
    merged = stats.merge(scouting, on='id')
    merged = merged[merged['ip'] >= 50]  # Meaningful sample

    # Calculate expected
    merged['exp_k9'] = merged['stuff'].apply(expected_k9)
    merged['exp_bb9'] = merged['control'].apply(expected_bb9)
    merged['exp_hr9'] = merged['hra'].apply(expected_hr9)

    # Calculate residuals
    merged['k9_diff'] = merged['k9'] - merged['exp_k9']
    merged['bb9_diff'] = merged['bb9'] - merged['exp_bb9']
    merged['hr9_diff'] = merged['hr9'] - merged['exp_hr9']

    print("\n--- Actual - Expected by Level (50+ IP) ---")
    print("(Positive means actual > expected from scouting)")
    print(f"{'Level':<6} {'K/9 diff':>12} {'BB/9 diff':>12} {'HR/9 diff':>12} {'N':>6}")
    print("-" * 52)

    for level in ['r', 'a', 'aa', 'aaa']:
        level_data = merged[merged['level'] == level]
        if len(level_data) > 5:
            k9_diff = level_data['k9_diff'].mean()
            bb9_diff = level_data['bb9_diff'].mean()
            hr9_diff = level_data['hr9_diff'].mean()
            print(f"{level.upper():<6} {k9_diff:>+12.2f} {bb9_diff:>+12.2f} {hr9_diff:>+12.2f} {len(level_data):>6}")

    print("\nInterpretation:")
    print("  - Negative K/9 diff = level is inflating K/9 relative to true talent")
    print("  - Positive BB/9 diff = level has more walks than talent suggests")
    print("  - Positive HR/9 diff = level has more HRs than talent suggests")


def main():
    print("Loading data...")
    scouting, stats = load_all_data()

    merged = analyze_correlations(scouting, stats)
    analyze_level_transitions(stats)
    analyze_age_by_level(scouting, stats)
    analyze_stats_vs_expected(scouting, stats)

    print("\n" + "="*60)
    print("SUMMARY & RECOMMENDATIONS")
    print("="*60)
    print("""
Key findings will help determine:
1. How much to weight scouting vs stats at each level
2. Level adjustment factors for translating to MLB
3. Age-based adjustments for projection

If correlations are LOW: Trust scouting more
If correlations are HIGH: Stats are predictive
""")


if __name__ == "__main__":
    main()
