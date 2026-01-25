"""
Analyze the POT - OVR star gap as a development indicator.
"""

import pandas as pd
import numpy as np
from pathlib import Path
import re

DATA_DIR = Path(__file__).parent.parent / "data"

def parse_stars(star_str):
    """Parse '4.5 Stars' -> 4.5"""
    if pd.isna(star_str):
        return None
    match = re.search(r'([\d.]+)', str(star_str))
    return float(match.group(1)) if match else None

def load_data():
    """Load scouting and stats data."""
    scouting = pd.read_csv(DATA_DIR / "scouting.csv")
    scouting.columns = ['id', 'name', 'stuff', 'ovr_stars', 'pot_stars', 'control', 'hra', 'age']
    scouting['id'] = scouting['id'].astype(int)
    scouting['ovr'] = scouting['ovr_stars'].apply(parse_stars)
    scouting['pot'] = scouting['pot_stars'].apply(parse_stars)
    scouting['star_gap'] = scouting['pot'] - scouting['ovr']

    # Load stats
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
    stats = pd.concat(all_stats, ignore_index=True) if all_stats else pd.DataFrame()

    return scouting, stats

def analyze_star_gap(scouting, stats):
    """Analyze the star gap distribution and what it tells us."""

    print("="*60)
    print("STAR GAP ANALYSIS (POT - OVR)")
    print("="*60)

    print(f"\n--- Star Gap Distribution ---")
    print(f"{'Gap':<8} {'Count':>8} {'Avg Age':>10} {'Avg Stuff':>12} {'Avg Control':>12}")
    print("-" * 56)

    for gap in sorted(scouting['star_gap'].dropna().unique()):
        subset = scouting[scouting['star_gap'] == gap]
        print(f"{gap:<8.1f} {len(subset):>8} {subset['age'].mean():>10.1f} {subset['stuff'].mean():>12.1f} {subset['control'].mean():>12.1f}")

    print("\n--- What the Gap Means ---")

    # Fully developed (gap = 0)
    developed = scouting[scouting['star_gap'] == 0]
    print(f"\nFully Developed (gap = 0): {len(developed)} players")
    print(f"  Age range: {developed['age'].min()} - {developed['age'].max()}")
    print(f"  Avg age: {developed['age'].mean():.1f}")

    # Raw (gap >= 3)
    raw = scouting[scouting['star_gap'] >= 3]
    print(f"\nRaw Prospects (gap >= 3): {len(raw)} players")
    print(f"  Age range: {raw['age'].min()} - {raw['age'].max()}")
    print(f"  Avg age: {raw['age'].mean():.1f}")


def analyze_gap_vs_stats_reliability(scouting, stats):
    """See if players with smaller gaps have stats closer to their ratings."""

    print("\n" + "="*60)
    print("STAR GAP vs STATS RELIABILITY")
    print("="*60)
    print("(Do more developed players perform closer to their ratings?)")

    merged = stats.merge(scouting, on='id')
    merged = merged[merged['ip'] >= 50]

    # Calculate expected from ratings
    merged['exp_k9'] = 2.07 + 0.074 * merged['stuff']
    merged['exp_bb9'] = 5.22 - 0.052 * merged['control']
    merged['exp_hr9'] = 2.08 - 0.024 * merged['hra']

    # Calculate absolute errors
    merged['k9_error'] = abs(merged['k9'] - merged['exp_k9'])
    merged['bb9_error'] = abs(merged['bb9'] - merged['exp_bb9'])
    merged['hr9_error'] = abs(merged['hr9'] - merged['exp_hr9'])
    merged['total_error'] = merged['k9_error'] + merged['bb9_error'] + merged['hr9_error']

    print(f"\n--- Average Error by Star Gap (50+ IP) ---")
    print(f"{'Gap':<8} {'K/9 err':>10} {'BB/9 err':>10} {'HR/9 err':>10} {'Total err':>10} {'N':>6}")
    print("-" * 62)

    for gap in sorted(merged['star_gap'].dropna().unique()):
        subset = merged[merged['star_gap'] == gap]
        if len(subset) >= 5:
            print(f"{gap:<8.1f} {subset['k9_error'].mean():>10.2f} {subset['bb9_error'].mean():>10.2f} {subset['hr9_error'].mean():>10.2f} {subset['total_error'].mean():>10.2f} {len(subset):>6}")

    # Group into buckets
    print("\n--- Grouped by Development Stage ---")

    buckets = [
        ('Developed (gap 0-0.5)', merged[merged['star_gap'] <= 0.5]),
        ('Mid-development (gap 1-2)', merged[(merged['star_gap'] >= 1) & (merged['star_gap'] <= 2)]),
        ('Raw (gap 2.5+)', merged[merged['star_gap'] >= 2.5]),
    ]

    print(f"{'Stage':<28} {'Avg Total Error':>16} {'N':>6}")
    print("-" * 56)

    for name, subset in buckets:
        if len(subset) > 0:
            print(f"{name:<28} {subset['total_error'].mean():>16.2f} {len(subset):>6}")


def propose_scouting_weight_formula(scouting):
    """Show how star gap could influence scouting weight."""

    print("\n" + "="*60)
    print("PROPOSED: Use Star Gap for Scouting Weight")
    print("="*60)

    print("""
The star gap (POT - OVR) tells us how much development remains.

Insight:
- Larger gap = player hasn't developed yet = trust ratings more (they're projections)
- Smaller gap = player is near peak = stats are more meaningful

Proposed scouting weight adjustment:

  gap_factor = star_gap / 4.0  (normalize to 0-1 range, assuming max gap is 4)

  scouting_weight = base_weight + gap_factor * 0.15

  Where:
    - gap = 0 (fully developed): +0% scouting weight
    - gap = 2: +7.5% scouting weight
    - gap = 4 (raw): +15% scouting weight

Combined with IP factor:

  base_weight = 0.65
  gap_bonus = (star_gap / 4.0) * 0.15  # 0 to 0.15 based on rawness
  ip_factor = 50 / (50 + total_ip) * 0.15  # 0 to 0.15 based on sample size

  scouting_weight = min(0.95, base_weight + gap_bonus + ip_factor)

Examples:
""")

    examples = [
        ("15yo, 5* POT, 1* OVR, 0 IP", 15, 5.0, 1.0, 0),
        ("19yo, 5* POT, 1.5* OVR, 60 IP", 19, 5.0, 1.5, 60),
        ("22yo, 5* POT, 2* OVR, 150 IP", 22, 5.0, 2.0, 150),
        ("26yo, 5* POT, 4.5* OVR, 300 IP", 26, 5.0, 4.5, 300),
        ("28yo, 4.5* POT, 4.5* OVR, 400 IP", 28, 4.5, 4.5, 400),
    ]

    print(f"{'Description':<40} {'Gap':>5} {'Scout Wt':>10}")
    print("-" * 60)

    for desc, age, pot, ovr, ip in examples:
        gap = pot - ovr
        base = 0.65
        gap_bonus = (gap / 4.0) * 0.15
        ip_factor = (50 / (50 + ip)) * 0.15
        scout_wt = min(0.95, base + gap_bonus + ip_factor)
        print(f"{desc:<40} {gap:>5.1f} {scout_wt:>10.1%}")


def main():
    print("Loading data...")
    scouting, stats = load_data()

    print(f"Loaded {len(scouting)} scouting records")
    print(f"Star gap range: {scouting['star_gap'].min():.1f} to {scouting['star_gap'].max():.1f}")

    analyze_star_gap(scouting, stats)
    analyze_gap_vs_stats_reliability(scouting, stats)
    propose_scouting_weight_formula(scouting)


if __name__ == "__main__":
    main()
