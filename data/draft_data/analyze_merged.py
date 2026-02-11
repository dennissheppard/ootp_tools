"""
Merged personality analysis: 2010 + 2017 snapshots.

Personality is immutable, so we union both snapshots by player_id.
Career WAR comes from stats files (2000-2021).
Draft info comes from snapshot files (Draft, Round, Pick columns).

Focus: validate the 2010 findings with 3x the sample size.
New: 2011-2017 draft classes get personality data from the 2017 snapshot.
"""

import csv
import os
from collections import defaultdict

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
STATS_DIR = os.path.join(DATA_DIR, '..', '..', 'public', 'data')

# ─── Load Career WAR ────────────────────────────────────────────────────

def load_career_war():
    """Sum WAR across all MLB years for each player_id."""
    batting_war = defaultdict(float)
    pitching_war = defaultdict(float)

    # Batting WAR
    bat_dir = os.path.join(STATS_DIR, 'mlb_batting')
    for year in range(2000, 2022):
        fpath = os.path.join(bat_dir, f'{year}_batting.csv')
        if not os.path.exists(fpath):
            continue
        with open(fpath, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = int(row['player_id'].strip())
                pa = int(row['pa'].strip() or '0')
                war = float(row['war'].strip() or '0')
                if pa > 0:
                    batting_war[pid] += war

    # Pitching WAR
    pitch_dir = os.path.join(STATS_DIR, 'mlb')
    for year in range(2000, 2022):
        fpath = os.path.join(pitch_dir, f'{year}.csv')
        if not os.path.exists(fpath):
            continue
        with open(fpath, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                pid = int(row['player_id'].strip())
                ip = float(row['ip'].strip() or '0')
                war = float(row['war'].strip() or '0')
                if ip > 0:
                    pitching_war[pid] += war

    return batting_war, pitching_war

# Track which players appeared in MLB at all
def load_mlb_players():
    """Set of player_ids who appeared in any MLB stats file."""
    mlb_pids = set()
    for year in range(2000, 2022):
        for subdir, pa_col in [('mlb_batting', 'pa'), ('mlb', 'ip')]:
            suffix = f'{year}_batting.csv' if subdir == 'mlb_batting' else f'{year}.csv'
            fpath = os.path.join(STATS_DIR, subdir, suffix)
            if not os.path.exists(fpath):
                continue
            with open(fpath, 'r') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    val = float(row[pa_col].strip() or '0')
                    if val > 0:
                        mlb_pids.add(int(row['player_id'].strip()))
    return mlb_pids

print("Loading career WAR from stats files...")
batting_war, pitching_war = load_career_war()
mlb_players = load_mlb_players()
print(f"  Batting WAR: {len(batting_war)} players")
print(f"  Pitching WAR: {len(pitching_war)} players")
print(f"  Total MLB players: {len(mlb_players)}")

# ─── Load Snapshots ─────────────────────────────────────────────────────

PITCHER_POS = {'SP', 'RP', 'CL', 'MR', 'LR'}

def parse_round(s):
    """Parse round/pick, handling supplemental rounds like '9S'."""
    if not s:
        return 0
    # Strip non-numeric suffixes (e.g., '9S' for supplemental)
    cleaned = ''.join(c for c in s if c.isdigit())
    return int(cleaned) if cleaned else 0

def parse_stars(s):
    """Parse '3.0 Stars' -> 3.0"""
    try:
        return float(s.replace(' Stars', '').replace(' Star', '').strip())
    except:
        return 0.0

class Player:
    def __init__(self, pid, pos, name, age, ovr, pot, lea, loy, ad, fin, we, intel, ptype, draft_year, draft_round, draft_pick):
        self.pid = pid
        self.pos = pos
        self.name = name
        self.age = age
        self.ovr = ovr
        self.pot = pot
        self.lea = lea
        self.loy = loy
        self.ad = ad
        self.fin = fin
        self.we = we
        self.intel = intel
        self.ptype = ptype
        self.draft_year = draft_year
        self.draft_round = draft_round
        self.draft_pick = draft_pick
        self.is_pitcher = pos in PITCHER_POS

    @property
    def war(self):
        if self.is_pitcher:
            return pitching_war.get(self.pid, 0.0)
        else:
            return batting_war.get(self.pid, 0.0)

    @property
    def reached_mlb(self):
        return self.pid in mlb_players

def load_snapshot(batters_file, pitchers_file, snapshot_year):
    """Load a snapshot, return dict of pid -> Player. Pitchers loaded first, then batters (skip dupes)."""
    players = {}

    # Pitchers first
    with open(os.path.join(DATA_DIR, pitchers_file), 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = int(row['ID'].strip())
            draft_year = int(row['Draft'].strip() or '0')
            draft_round = parse_round(row['Round'].strip())
            draft_pick = parse_round(row['Pick'].strip())
            players[pid] = Player(
                pid=pid, pos=row['POS'].strip(), name=row['Name'].strip(),
                age=int(row['Age'].strip()), ovr=parse_stars(row['OVR']),
                pot=parse_stars(row['POT']), lea=row['LEA'].strip(),
                loy=row['LOY'].strip(), ad=row['AD'].strip(),
                fin=row['FIN'].strip(), we=row['WE'].strip(),
                intel=row['INT'].strip(), ptype=row['Type'].strip(),
                draft_year=draft_year, draft_round=draft_round, draft_pick=draft_pick
            )

    # Then batters (skip if already seen as pitcher)
    with open(os.path.join(DATA_DIR, batters_file), 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            pid = int(row['ID'].strip())
            if pid in players:
                continue  # already loaded as pitcher
            draft_year = int(row['Draft'].strip() or '0')
            draft_round = parse_round(row['Round'].strip())
            draft_pick = parse_round(row['Pick'].strip())
            players[pid] = Player(
                pid=pid, pos=row['POS'].strip(), name=row['Name'].strip(),
                age=int(row['Age'].strip()), ovr=parse_stars(row['OVR']),
                pot=parse_stars(row['POT']), lea=row['LEA'].strip(),
                loy=row['LOY'].strip(), ad=row['AD'].strip(),
                fin=row['FIN'].strip(), we=row['WE'].strip(),
                intel=row['INT'].strip(), ptype=row['Type'].strip(),
                draft_year=draft_year, draft_round=draft_round, draft_pick=draft_pick
            )

    return players

print("\nLoading 2010 snapshot...")
snap_2010 = load_snapshot('batters_2010.csv', 'pitchers_2010.csv', 2010)
print(f"  {len(snap_2010)} players")

print("Loading 2017 snapshot...")
snap_2017 = load_snapshot('batters_2017.csv', 'pitchers_2017.csv', 2017)
print(f"  {len(snap_2017)} players")

# ─── Merge: union by player_id, personality doesn't change ──────────────
# For players in both, personality is the same. Use 2010 snapshot for draft info
# if available (it's closer to draft day for earlier classes).
# For players only in 2017, use 2017 data.

merged = {}
for pid, p in snap_2010.items():
    merged[pid] = p
for pid, p in snap_2017.items():
    if pid not in merged:
        merged[pid] = p

print(f"\nMerged: {len(merged)} unique players")
print(f"  Only in 2010: {len(set(snap_2010.keys()) - set(snap_2017.keys()))}")
print(f"  Only in 2017: {len(set(snap_2017.keys()) - set(snap_2010.keys()))}")
print(f"  In both: {len(set(snap_2010.keys()) & set(snap_2017.keys()))}")

# ─── Filter to drafted players with valid personality ────────────────────

def get_drafted(players, min_year=2008, max_year=2017):
    """Filter to players drafted in the given range with valid draft info."""
    return [p for p in players.values()
            if p.draft_year >= min_year and p.draft_year <= max_year
            and p.draft_round > 0]

# 2008-2010: covered by 2010 snapshot (original analysis)
original_pool = get_drafted(snap_2010, 2008, 2010)
# 2011-2017: NEW players from 2017 snapshot
new_pool = get_drafted(merged, 2011, 2017)
# Combined: 2008-2017
combined_pool = get_drafted(merged, 2008, 2017)

print(f"\nDrafted players:")
print(f"  2008-2010 (original): {len(original_pool)}")
print(f"  2011-2017 (new from 2017 snapshot): {len(new_pool)}")
print(f"  2008-2017 (combined): {len(combined_pool)}")

# Show per-year counts
for yr in range(2008, 2018):
    count = len([p for p in combined_pool if p.draft_year == yr])
    mlb_count = len([p for p in combined_pool if p.draft_year == yr and p.reached_mlb])
    print(f"    {yr}: {count} drafted, {mlb_count} reached MLB ({mlb_count/count*100:.0f}%)" if count > 0 else f"    {yr}: 0")

# ─── Attrition check for 2017 snapshot ──────────────────────────────────
print("\n" + "="*80)
print("ATTRITION CHECK: How many draftees are missing from 2017 snapshot?")
print("="*80)
# We know draft log counts from the analysis doc. Let's count what we have.
for yr in range(2011, 2018):
    in_snap = len([p for p in snap_2017.values() if p.draft_year == yr and p.draft_round > 0])
    print(f"  {yr}: {in_snap} draftees in 2017 snapshot")

# ════════════════════════════════════════════════════════════════════════
# ANALYSIS: Personality Effects (replicating 2010 findings with expanded data)
# ════════════════════════════════════════════════════════════════════════

print("\n" + "="*80)
print("ANALYSIS 1: Trait Ranking by Effect Size")
print("  Original: 2008-2010 (n=663) | Expanded: 2008-2017")
print("="*80)

def trait_analysis(pool, label):
    traits = ['WE', 'AD', 'INT', 'LEA', 'LOY', 'FIN']
    results = []
    for trait in traits:
        get_val = lambda p: getattr(p, trait.lower()) if trait != 'INT' else p.intel
        groups = {'H': [], 'N': [], 'L': []}
        for p in pool:
            v = get_val(p)
            if v in groups:
                groups[v].append(p.war)

        h_avg = sum(groups['H'])/len(groups['H']) if groups['H'] else 0
        n_avg = sum(groups['N'])/len(groups['N']) if groups['N'] else 0
        l_avg = sum(groups['L'])/len(groups['L']) if groups['L'] else 0
        delta = h_avg - l_avg
        results.append((trait, h_avg, len(groups['H']), n_avg, len(groups['N']), l_avg, len(groups['L']), delta))

    results.sort(key=lambda x: -x[7])
    print(f"\n  {label}:")
    print(f"  {'Trait':<6} {'H avg WAR':>10} {'(n)':>5} {'N avg WAR':>10} {'(n)':>5} {'L avg WAR':>10} {'(n)':>5} {'H-L Delta':>10}")
    print(f"  {'-'*62}")
    for trait, h_avg, h_n, n_avg, n_n, l_avg, l_n, delta in results:
        print(f"  {trait:<6} {h_avg:>10.1f} ({h_n:>3}) {n_avg:>10.1f} ({n_n:>3}) {l_avg:>10.1f} ({l_n:>3}) {delta:>+10.1f}")

trait_analysis(original_pool, "Original 2008-2010")
trait_analysis(combined_pool, "Expanded 2008-2017")
trait_analysis(new_pool, "New classes only: 2011-2017")

# ════════════════════════════════════════════════════════════════════════
print("\n" + "="*80)
print("ANALYSIS 2: WE by Player Type (Pitcher vs Batter)")
print("="*80)

def we_by_type(pool, label):
    for ptype, pfilter in [("Pitchers", True), ("Batters", False)]:
        sub = [p for p in pool if p.is_pitcher == pfilter]
        print(f"\n  {label} — {ptype}:")
        print(f"  {'WE':<4} {'n':>4} {'Avg WAR':>8} {'MLB%':>6} {'WAR>=3':>7} {'WAR>=10':>8}")
        for we_val in ['H', 'N', 'L']:
            group = [p for p in sub if p.we == we_val]
            if not group:
                continue
            avg_war = sum(p.war for p in group) / len(group)
            mlb_pct = sum(1 for p in group if p.reached_mlb) / len(group) * 100
            war3 = sum(1 for p in group if p.war >= 3) / len(group) * 100
            war10 = sum(1 for p in group if p.war >= 10) / len(group) * 100
            print(f"  {we_val:<4} {len(group):>4} {avg_war:>8.1f} {mlb_pct:>5.0f}% {war3:>6.0f}% {war10:>7.0f}%")

we_by_type(original_pool, "2008-2010")
we_by_type(combined_pool, "2008-2017")

# ════════════════════════════════════════════════════════════════════════
print("\n" + "="*80)
print("ANALYSIS 3: Trait Combinations")
print("="*80)

def combo_analysis(pool, label):
    combos = [
        ("All H (WE+INT+AD)", lambda p: p.we=='H' and p.intel=='H' and p.ad=='H'),
        ("H WE + H AD", lambda p: p.we=='H' and p.ad=='H'),
        ("H WE + H INT", lambda p: p.we=='H' and p.intel=='H'),
        ("H AD + H INT (not H WE)", lambda p: p.ad=='H' and p.intel=='H' and p.we!='H'),
        ("H WE only (INT/AD!=H)", lambda p: p.we=='H' and p.intel!='H' and p.ad!='H'),
        ("All Normal (WE+INT+AD)", lambda p: p.we=='N' and p.intel=='N' and p.ad=='N'),
        ("Any L in WE/INT/AD", lambda p: p.we=='L' or p.intel=='L' or p.ad=='L'),
        ("L WE (any INT/AD)", lambda p: p.we=='L'),
        ("L AD (any WE/INT)", lambda p: p.ad=='L'),
        ("2+ Low in WE/INT/AD", lambda p: sum(1 for v in [p.we, p.intel, p.ad] if v=='L') >= 2),
    ]

    print(f"\n  {label}:")
    print(f"  {'Combo':<30} {'n':>4} {'Avg WAR':>8} {'MLB%':>6} {'Bust%':>6} {'WAR>=3':>7} {'WAR>=10':>8}")
    print(f"  {'-'*72}")
    for name, filt in combos:
        group = [p for p in pool if filt(p)]
        if not group:
            continue
        avg_war = sum(p.war for p in group) / len(group)
        mlb_pct = sum(1 for p in group if p.reached_mlb) / len(group) * 100
        bust_pct = sum(1 for p in group if not p.reached_mlb or p.war < 0) / len(group) * 100
        war3 = sum(1 for p in group if p.war >= 3) / len(group) * 100
        war10 = sum(1 for p in group if p.war >= 10) / len(group) * 100
        print(f"  {name:<30} {len(group):>4} {avg_war:>8.1f} {mlb_pct:>5.0f}% {bust_pct:>5.0f}% {war3:>6.0f}% {war10:>7.0f}%")

combo_analysis(original_pool, "2008-2010")
combo_analysis(combined_pool, "2008-2017")

# ════════════════════════════════════════════════════════════════════════
print("\n" + "="*80)
print("ANALYSIS 4: Draft Round Value (expanded)")
print("="*80)

def round_analysis(pool, label):
    print(f"\n  {label}:")
    print(f"  {'Round':>5} {'n':>5} {'MLB%':>6} {'Avg WAR':>8} {'WAR>=5':>7} {'WAR>=15':>8}")
    print(f"  {'-'*42}")
    for rd in range(1, 13):
        group = [p for p in pool if p.draft_round == rd]
        if not group:
            continue
        avg_war = sum(p.war for p in group) / len(group)
        mlb_pct = sum(1 for p in group if p.reached_mlb) / len(group) * 100
        war5 = sum(1 for p in group if p.war >= 5)
        war15 = sum(1 for p in group if p.war >= 15)
        print(f"  {rd:>5} {len(group):>5} {mlb_pct:>5.0f}% {avg_war:>8.1f} {war5:>7} {war15:>8}")

round_analysis(original_pool, "2008-2010")
round_analysis(combined_pool, "2008-2017")

# Only look at classes with enough career data (5+ years by 2021)
mature_expanded = get_drafted(merged, 2008, 2016)
round_analysis(mature_expanded, "Mature classes (2008-2016, 5+ yr career data)")

# ════════════════════════════════════════════════════════════════════════
print("\n" + "="*80)
print("ANALYSIS 5: Cross-Tier — Personality vs Talent (expanded)")
print("  Does a 3.0* Triple-H still beat a 4.0* Normal?")
print("  NOTE: POT values only accurate at draft year for same-year snapshot")
print("  2010 snapshot POT is accurate for 2010 draftees; stale for 2008-2009")
print("  2017 snapshot POT is accurate for 2017 draftees; stale for earlier")
print("="*80)

def cross_tier(pool, label):
    groups = [
        ("5.0* + Triple H", lambda p: p.pot >= 5.0 and p.we=='H' and p.intel=='H' and p.ad=='H'),
        ("5.0* + All Normal", lambda p: p.pot >= 5.0 and p.we=='N' and p.intel=='N' and p.ad=='N'),
        ("4.0* + H WE", lambda p: 4.0 <= p.pot < 5.0 and p.we=='H'),
        ("4.0* + All Normal", lambda p: 4.0 <= p.pot < 5.0 and p.we=='N' and p.intel=='N' and p.ad=='N'),
        ("3.0-3.5* + Triple H", lambda p: 3.0 <= p.pot <= 3.5 and p.we=='H' and p.intel=='H' and p.ad=='H'),
        ("3.0-3.5* + H WE + H AD", lambda p: 3.0 <= p.pot <= 3.5 and p.we=='H' and p.ad=='H'),
        ("3.0-3.5* + All Normal", lambda p: 3.0 <= p.pot <= 3.5 and p.we=='N' and p.intel=='N' and p.ad=='N'),
        ("3.0-3.5* + Any Low", lambda p: 3.0 <= p.pot <= 3.5 and (p.we=='L' or p.intel=='L' or p.ad=='L')),
        ("2.0-2.5* + H WE + H AD", lambda p: 2.0 <= p.pot <= 2.5 and p.we=='H' and p.ad=='H'),
        ("2.0-2.5* + All Normal", lambda p: 2.0 <= p.pot <= 2.5 and p.we=='N' and p.intel=='N' and p.ad=='N'),
        ("2.0-2.5* + Any Low", lambda p: 2.0 <= p.pot <= 2.5 and (p.we=='L' or p.intel=='L' or p.ad=='L')),
    ]

    print(f"\n  {label}:")
    print(f"  {'Group':<25} {'n':>4} {'Avg WAR':>8} {'MLB%':>6} {'Bust%':>6} {'WAR>=5':>7} {'WAR>=10':>8}")
    print(f"  {'-'*68}")
    for name, filt in groups:
        group = [p for p in pool if filt(p)]
        if len(group) < 2:
            print(f"  {name:<25} {len(group):>4}   (too few)")
            continue
        avg_war = sum(p.war for p in group) / len(group)
        mlb_pct = sum(1 for p in group if p.reached_mlb) / len(group) * 100
        bust_pct = sum(1 for p in group if not p.reached_mlb or p.war < 0) / len(group) * 100
        war5 = sum(1 for p in group if p.war >= 5) / len(group) * 100
        war10 = sum(1 for p in group if p.war >= 10) / len(group) * 100
        print(f"  {name:<25} {len(group):>4} {avg_war:>8.1f} {mlb_pct:>5.0f}% {bust_pct:>5.0f}% {war5:>6.0f}% {war10:>7.0f}%")

# Only use same-year draftees for POT analysis (POT is accurate for them)
pot_accurate_2010 = [p for p in original_pool if p.draft_year == 2010]
pot_accurate_2017 = [p for p in new_pool if p.draft_year == 2017]
pot_accurate_combined = pot_accurate_2010 + pot_accurate_2017

cross_tier(pot_accurate_2010, "2010 draftees only (POT accurate)")
cross_tier(pot_accurate_combined, "2010 + 2017 draftees (POT accurate for both)")

# ════════════════════════════════════════════════════════════════════════
print("\n" + "="*80)
print("ANALYSIS 6: WE Controlling for POT (same-year draftees only)")
print("  POT only accurate for same-year snapshot draftees")
print("="*80)

def we_by_pot(pool, label):
    tiers = [
        ("Elite (4.0-5.0*)", 4.0, 5.5),
        ("Good (3.0-3.5*)", 3.0, 3.5),
        ("Med (2.0-2.5*)", 2.0, 2.5),
        ("Low (0.5-1.5*)", 0.5, 1.5),
    ]
    print(f"\n  {label}:")
    for tier_name, lo, hi in tiers:
        print(f"\n  {tier_name}:")
        print(f"  {'WE':<4} {'n':>4} {'Avg WAR':>8} {'MLB%':>6} {'Bust%':>6} {'WAR>=3':>7}")
        for we_val in ['H', 'N', 'L']:
            group = [p for p in pool if lo <= p.pot <= hi and p.we == we_val]
            if not group:
                continue
            avg_war = sum(p.war for p in group) / len(group)
            mlb_pct = sum(1 for p in group if p.reached_mlb) / len(group) * 100
            bust_pct = sum(1 for p in group if not p.reached_mlb or p.war < 0) / len(group) * 100
            war3 = sum(1 for p in group if p.war >= 3) / len(group) * 100
            print(f"  {we_val:<4} {len(group):>4} {avg_war:>8.1f} {mlb_pct:>5.0f}% {bust_pct:>5.0f}% {war3:>6.0f}%")

we_by_pot(pot_accurate_2010, "2010 draftees (POT accurate)")
we_by_pot(pot_accurate_combined, "2010 + 2017 draftees (POT accurate)")

# ════════════════════════════════════════════════════════════════════════
print("\n" + "="*80)
print("ANALYSIS 7: Development Timeline — Years from Draft to MLB Debut")
print("  (Uses stats files to find first MLB appearance)")
print("="*80)

# Find first MLB year for each player
def load_first_mlb_year():
    first_year = {}
    for year in range(2000, 2022):
        for subdir, pa_col in [('mlb_batting', 'pa'), ('mlb', 'ip')]:
            suffix = f'{year}_batting.csv' if subdir == 'mlb_batting' else f'{year}.csv'
            fpath = os.path.join(STATS_DIR, subdir, suffix)
            if not os.path.exists(fpath):
                continue
            with open(fpath, 'r') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    pid = int(row['player_id'].strip())
                    val = float(row[pa_col].strip() or '0')
                    if val > 0:
                        if pid not in first_year or year < first_year[pid]:
                            first_year[pid] = year
    return first_year

print("\nLoading first MLB year for all players...")
first_mlb_year = load_first_mlb_year()

def timeline_analysis(pool, label):
    print(f"\n  {label}:")
    print(f"  {'Round':>5} {'n (MLB)':>8} {'Avg Yrs':>8} {'Med Yrs':>8} {'<=2yr':>6} {'<=3yr':>6} {'<=4yr':>6} {'<=5yr':>6}")
    print(f"  {'-'*58}")
    for rd in range(1, 8):
        group = [p for p in pool if p.draft_round == rd and p.pid in first_mlb_year and p.draft_year > 0]
        if not group:
            continue
        years_to_mlb = [first_mlb_year[p.pid] - p.draft_year for p in group]
        avg_yrs = sum(years_to_mlb) / len(years_to_mlb)
        sorted_yrs = sorted(years_to_mlb)
        med_yrs = sorted_yrs[len(sorted_yrs)//2]
        pct2 = sum(1 for y in years_to_mlb if y <= 2) / len(years_to_mlb) * 100
        pct3 = sum(1 for y in years_to_mlb if y <= 3) / len(years_to_mlb) * 100
        pct4 = sum(1 for y in years_to_mlb if y <= 4) / len(years_to_mlb) * 100
        pct5 = sum(1 for y in years_to_mlb if y <= 5) / len(years_to_mlb) * 100
        print(f"  {rd:>5} {len(group):>8} {avg_yrs:>8.1f} {med_yrs:>8} {pct2:>5.0f}% {pct3:>5.0f}% {pct4:>5.0f}% {pct5:>5.0f}%")

# Use mature classes so we're not penalizing recent drafts for "not yet debuted"
mature_pool = get_drafted(merged, 2008, 2016)
timeline_analysis(mature_pool, "Draft to MLB debut — Mature classes (2008-2016)")

# By player type
timeline_analysis([p for p in mature_pool if p.is_pitcher], "Pitchers only (2008-2016)")
timeline_analysis([p for p in mature_pool if not p.is_pitcher], "Batters only (2008-2016)")

# ════════════════════════════════════════════════════════════════════════
print("\n" + "="*80)
print("ANALYSIS 8: Position-Specific Draft Outcomes")
print("  How do different positions fare when drafted?")
print("="*80)

def position_analysis(pool, label):
    positions = defaultdict(list)
    for p in pool:
        positions[p.pos].append(p)

    print(f"\n  {label}:")
    print(f"  {'Pos':<4} {'n':>5} {'MLB%':>6} {'Avg WAR':>8} {'WAR>=5':>7} {'WAR>=15':>8} {'Avg Yrs to MLB':>15}")
    print(f"  {'-'*58}")

    # Sort by count
    for pos in sorted(positions.keys(), key=lambda x: -len(positions[x])):
        group = positions[pos]
        if len(group) < 10:
            continue
        avg_war = sum(p.war for p in group) / len(group)
        mlb_pct = sum(1 for p in group if p.reached_mlb) / len(group) * 100
        war5 = sum(1 for p in group if p.war >= 5) / len(group) * 100
        war15 = sum(1 for p in group if p.war >= 15) / len(group) * 100
        mlb_group = [p for p in group if p.pid in first_mlb_year and p.draft_year > 0]
        avg_yrs = sum(first_mlb_year[p.pid] - p.draft_year for p in mlb_group) / len(mlb_group) if mlb_group else 0
        print(f"  {pos:<4} {len(group):>5} {mlb_pct:>5.0f}% {avg_war:>8.1f} {war5:>6.0f}% {war15:>7.0f}% {avg_yrs:>15.1f}")

position_analysis(mature_pool, "All positions — Mature classes (2008-2016)")

# Breakdown: position + round
print(f"\n  Position x Round (2008-2016, Rounds 1-4 only):")
print(f"  {'Pos':<4} {'Rd':>3} {'n':>4} {'MLB%':>6} {'Avg WAR':>8} {'WAR>=5':>7}")
print(f"  {'-'*35}")
for pos in ['SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']:
    for rd in range(1, 5):
        group = [p for p in mature_pool if p.pos == pos and p.draft_round == rd]
        if len(group) < 5:
            continue
        avg_war = sum(p.war for p in group) / len(group)
        mlb_pct = sum(1 for p in group if p.reached_mlb) / len(group) * 100
        war5 = sum(1 for p in group if p.war >= 5) / len(group) * 100
        print(f"  {pos:<4} {rd:>3} {len(group):>4} {mlb_pct:>5.0f}% {avg_war:>8.1f} {war5:>6.0f}%")

print("\n" + "="*80)
print("DONE")
print("="*80)
