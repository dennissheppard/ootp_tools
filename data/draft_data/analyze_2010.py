"""
WBL 2010 Snapshot Analysis
Analyzes 2010 league snapshot data with career WAR from stats files.
Focus: 10-year outcomes for 2010 draft class, expanded personality traits.
"""
import csv
import os
from collections import defaultdict
from pathlib import Path

BASE = Path(r"C:\Users\neags\Downloads\dev projects\wbl\data\draft_data")
STATS = Path(r"C:\Users\neags\Downloads\dev projects\wbl\public\data")

# ─── Helpers ───

def load_csv(filepath):
    rows = []
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows

def parse_stars(val):
    if not val:
        return None
    v = val.strip().replace(' Stars', '').replace(' Star', '')
    try:
        return float(v)
    except (ValueError, TypeError):
        return None

def normalize_trait(val):
    if not val or val.strip() == '' or val.strip() == 'U':
        return None
    v = val.strip().upper()
    if v in ('H', 'HIGH'):
        return 'H'
    if v in ('N', 'NORMAL'):
        return 'N'
    if v in ('L', 'LOW'):
        return 'L'
    return None

def safe_int(val, default=0):
    try:
        return int(val)
    except (ValueError, TypeError):
        return default

def safe_float(val, default=0.0):
    try:
        return float(val)
    except (ValueError, TypeError):
        return default

def percentile(values, pct):
    """Simple percentile calculation"""
    if not values:
        return 0
    s = sorted(values)
    idx = int(len(s) * pct / 100)
    return s[min(idx, len(s) - 1)]

def stats_line(vals, label=""):
    """Format a stats line for WAR values"""
    if not vals:
        return f"  {label}: No players"
    avg = sum(vals) / len(vals)
    med = sorted(vals)[len(vals) // 2]
    pos = sum(1 for v in vals if v > 0)
    top3 = sum(1 for v in vals if v >= 3.0)
    top10 = sum(1 for v in vals if v >= 10.0)
    bust = sum(1 for v in vals if v < 0)
    return (f"  {label}: n={len(vals):>4}, avg={avg:>6.1f}, med={med:>5.1f}, "
            f"bust(<0)={100*bust/len(vals):>4.0f}%, "
            f"WAR>0={100*pos/len(vals):>4.0f}%, "
            f"WAR>=3={100*top3/len(vals):>4.0f}%, "
            f"WAR>=10={100*top10/len(vals):>4.0f}%")


# ═══════════════════════════════════════════════════════════
# STEP 1: Build career WAR lookup from stats files
# ═══════════════════════════════════════════════════════════
print("Loading career WAR from stats files...")

# Pitching WAR: public/data/mlb/YYYY.csv (player_id is column 2)
pitching_war = defaultdict(float)
pitching_seasons = defaultdict(int)
for year in range(2000, 2022):
    fpath = STATS / "mlb" / f"{year}.csv"
    if not fpath.exists():
        continue
    for row in load_csv(fpath):
        pid = safe_int(row.get('player_id', 0))
        if pid == 0:
            continue
        war = safe_float(row.get('war', 0))
        ip = safe_float(row.get('ip', 0))
        if ip > 0:  # Only count rows with actual innings
            pitching_war[pid] += war
            pitching_seasons[pid] += 1

# Batting WAR: public/data/mlb_batting/YYYY_batting.csv
batting_war = defaultdict(float)
batting_seasons = defaultdict(int)
for year in range(2000, 2022):
    fpath = STATS / "mlb_batting" / f"{year}_batting.csv"
    if not fpath.exists():
        continue
    for row in load_csv(fpath):
        pid = safe_int(row.get('player_id', 0))
        if pid == 0:
            continue
        war = safe_float(row.get('war', 0))
        pa = safe_int(row.get('pa', 0))
        if pa > 0:  # Only count rows with actual plate appearances
            batting_war[pid] += war
            batting_seasons[pid] += 1

print(f"  Pitching WAR loaded for {len(pitching_war)} players")
print(f"  Batting WAR loaded for {len(batting_war)} players")


# ═══════════════════════════════════════════════════════════
# STEP 2: Load 2010 snapshot players
# ═══════════════════════════════════════════════════════════
print("\nLoading 2010 snapshot data...")

PITCHER_POS = {'SP', 'RP', 'CL', 'MR', 'LR'}

all_players = []
seen_ids = set()

# Load pitchers from pitchers_2010.csv
for row in load_csv(BASE / "pitchers_2010.csv"):
    pid = safe_int(row.get('ID', 0))
    if pid == 0 or pid in seen_ids:
        continue
    seen_ids.add(pid)

    war = pitching_war.get(pid, 0.0)
    seasons = pitching_seasons.get(pid, 0)

    draft_year = safe_int(row.get('Draft', 0))
    draft_round = safe_int(row.get('Round', 0))
    draft_pick = safe_int(row.get('Pick', 0))

    all_players.append({
        'id': pid,
        'name': row.get('Name', '').strip(),
        'type': 'pitcher',
        'pos': row.get('POS', '').strip(),
        'age': safe_int(row.get('Age', 0)),
        'ovr': parse_stars(row.get('OVR', '')),
        'pot': parse_stars(row.get('POT', '')),
        'war': war,
        'mlb_seasons': seasons,
        'ever_mlb': seasons > 0,
        # Original traits
        'lea': normalize_trait(row.get('LEA', '')),
        'we': normalize_trait(row.get('WE', '')),
        'int': normalize_trait(row.get('INT', '')),
        # New traits
        'loy': normalize_trait(row.get('LOY', '')),
        'ad': normalize_trait(row.get('AD', '')),
        'fin': normalize_trait(row.get('FIN', '')),
        'type_personality': row.get('Type', '').strip(),
        # Draft info
        'draft_year': draft_year,
        'draft_round': draft_round,
        'draft_pick': draft_pick,
        'drafted': draft_year > 0,
    })

# Load position players from batters_2010.csv (exclude pitchers already loaded)
for row in load_csv(BASE / "batters_2010.csv"):
    pid = safe_int(row.get('ID', 0))
    if pid == 0:
        continue

    pos = row.get('POS', '').strip()

    # Skip if this is a pitcher already loaded from pitchers file
    if pid in seen_ids:
        continue
    seen_ids.add(pid)

    # Determine if pitcher or position player
    is_pitcher = pos in PITCHER_POS

    if is_pitcher:
        war = pitching_war.get(pid, 0.0)
        seasons = pitching_seasons.get(pid, 0)
    else:
        war = batting_war.get(pid, 0.0)
        seasons = batting_seasons.get(pid, 0)

    draft_year = safe_int(row.get('Draft', 0))
    draft_round = safe_int(row.get('Round', 0))
    draft_pick = safe_int(row.get('Pick', 0))

    all_players.append({
        'id': pid,
        'name': row.get('Name', '').strip(),
        'type': 'pitcher' if is_pitcher else 'batter',
        'pos': pos,
        'age': safe_int(row.get('Age', 0)),
        'ovr': parse_stars(row.get('OVR', '')),
        'pot': parse_stars(row.get('POT', '')),
        'war': war,
        'mlb_seasons': seasons,
        'ever_mlb': seasons > 0,
        'lea': normalize_trait(row.get('LEA', '')),
        'we': normalize_trait(row.get('WE', '')),
        'int': normalize_trait(row.get('INT', '')),
        'loy': normalize_trait(row.get('LOY', '')),
        'ad': normalize_trait(row.get('AD', '')),
        'fin': normalize_trait(row.get('FIN', '')),
        'type_personality': row.get('Type', '').strip(),
        'draft_year': draft_year,
        'draft_round': draft_round,
        'draft_pick': draft_pick,
        'drafted': draft_year > 0,
    })

print(f"Total players loaded: {len(all_players)}")
print(f"  Pitchers: {sum(1 for p in all_players if p['type'] == 'pitcher')}")
print(f"  Batters: {sum(1 for p in all_players if p['type'] == 'batter')}")
print(f"  With MLB WAR data: {sum(1 for p in all_players if p['ever_mlb'])}")
print(f"  Drafted: {sum(1 for p in all_players if p['drafted'])}")

# Draft year distribution
by_draft = defaultdict(int)
for p in all_players:
    if p['drafted']:
        by_draft[p['draft_year']] += 1
print("  By draft year: ", end="")
for y in sorted(by_draft):
    print(f"{y}:{by_draft[y]} ", end="")
print()

# ─── Focus populations ───
# 2010 draft class: cleanest data, 10+ years of outcomes
draft_2010 = [p for p in all_players if p['draft_year'] == 2010]
# Recent classes (2008-2010): enough career time, less survivor bias
recent_drafted = [p for p in all_players if p['draft_year'] >= 2008 and p['drafted']]
# All drafted players with MLB time
mlb_drafted = [p for p in all_players if p['drafted'] and p['ever_mlb']]

print(f"\n2010 draft class: {len(draft_2010)} players ({sum(1 for p in draft_2010 if p['ever_mlb'])} reached MLB)")
print(f"2008-2010 drafted: {len(recent_drafted)} players")
print(f"All drafted + reached MLB: {len(mlb_drafted)} players")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 1: 2010 DRAFT CLASS - 10 YEAR OUTCOMES
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 1: 2010 DRAFT CLASS - 10 YEAR CAREER OUTCOMES")
print("=" * 75)
print("(Cleanest data - no survivor bias, full career arc through 2021)")

d10 = draft_2010
d10_mlb = [p for p in d10 if p['ever_mlb']]

print(f"\n  Total 2010 draftees in snapshot: {len(d10)}")
print(f"  Reached MLB: {len(d10_mlb)} ({100*len(d10_mlb)/len(d10):.0f}%)")
print(f"  Never reached MLB: {len(d10) - len(d10_mlb)}")

# By round
print("\n--- 2010 Draft: Outcomes by Round ---")
round_groups = defaultdict(list)
for p in d10:
    r = p['draft_round']
    if r <= 3:
        bucket = f"Round 1-3"
    elif r <= 6:
        bucket = f"Round 4-6"
    elif r <= 10:
        bucket = f"Round 7-10"
    else:
        bucket = f"Round 11+"
    round_groups[bucket].append(p)

for bucket in ["Round 1-3", "Round 4-6", "Round 7-10", "Round 11+"]:
    group = round_groups.get(bucket, [])
    if not group:
        continue
    wars = [p['war'] for p in group]
    mlb_pct = 100 * sum(1 for p in group if p['ever_mlb']) / len(group)
    print(f"  {bucket:>12}: n={len(group):>3}, reached MLB={mlb_pct:>4.0f}%, ", end="")
    if any(p['ever_mlb'] for p in group):
        mlb_wars = [p['war'] for p in group if p['ever_mlb']]
        avg = sum(mlb_wars) / len(mlb_wars)
        print(f"avg WAR(MLB)={avg:>6.1f}, ", end="")
    avg_all = sum(wars) / len(wars)
    bust = sum(1 for w in wars if w < 0)
    top = sum(1 for w in wars if w >= 5.0)
    print(f"avg WAR(all)={avg_all:>5.1f}, bust={100*bust/len(wars):>4.0f}%, WAR>=5={100*top/len(wars):>4.0f}%")

# Top performers from 2010 class
print("\n--- 2010 Draft: Top 15 Performers ---")
d10_sorted = sorted(d10, key=lambda p: p['war'], reverse=True)
for i, p in enumerate(d10_sorted[:15]):
    print(f"  {i+1:>2}. {p['name']:<30} WAR={p['war']:>6.1f} | "
          f"Rd {p['draft_round']:>2} Pk {p['draft_pick']:>2} | "
          f"POT={p['pot']:.1f}* | {p['type']:>7} | "
          f"WE={p['we'] or '?'} INT={p['int'] or '?'} Type={p['type_personality']}")

# Biggest busts (high draft pick, low WAR)
print("\n--- 2010 Draft: Biggest Busts (Round 1-5, lowest WAR) ---")
early_picks = sorted([p for p in d10 if p['draft_round'] <= 5], key=lambda p: p['war'])
for i, p in enumerate(early_picks[:15]):
    print(f"  {i+1:>2}. {p['name']:<30} WAR={p['war']:>6.1f} | "
          f"Rd {p['draft_round']:>2} Pk {p['draft_pick']:>2} | "
          f"POT={p['pot']:.1f}* | {p['type']:>7} | "
          f"WE={p['we'] or '?'} INT={p['int'] or '?'} Type={p['type_personality']}")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 2: PERSONALITY TRAITS vs WAR (all drafted + MLB)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 2: PERSONALITY TRAITS vs CAREER WAR")
print("=" * 75)
print("(All drafted players who reached MLB - survivor bias for pre-2008 classes)")

pool = mlb_drafted

# ─── Original traits ───
for trait_name, trait_key in [
    ("Work Ethic (WE)", 'we'),
    ("Leadership (LEA)", 'lea'),
    ("Intelligence (INT)", 'int'),
    ("Loyalty (LOY)", 'loy'),
    ("Adaptability (AD)", 'ad'),
    ("Greed (FIN)", 'fin'),
]:
    print(f"\n--- {trait_name} ---")
    groups = {'H': [], 'N': [], 'L': []}
    for p in pool:
        t = p.get(trait_key)
        if t in groups:
            groups[t].append(p['war'])

    for level in ['H', 'N', 'L']:
        print(stats_line(groups[level], f"{level}"))

# ─── WE by player type ───
for ptype in ['pitcher', 'batter']:
    print(f"\n--- Work Ethic (WE) - {ptype.upper()}S ONLY ---")
    groups = {'H': [], 'N': [], 'L': []}
    for p in pool:
        if p['type'] != ptype:
            continue
        t = p['we']
        if t in groups:
            groups[t].append(p['war'])
    for level in ['H', 'N', 'L']:
        print(stats_line(groups[level], f"{level}"))

# ─── Personality Type archetype ───
print(f"\n--- Personality Type (archetype) ---")
type_groups = defaultdict(list)
for p in pool:
    pt = p['type_personality']
    if pt:
        type_groups[pt].append(p['war'])

# Sort by count descending
for ptype, wars in sorted(type_groups.items(), key=lambda x: -len(x[1])):
    if len(wars) >= 5:
        print(stats_line(wars, f"{ptype:>15}"))


# ═══════════════════════════════════════════════════════════
# ANALYSIS 3: PERSONALITY ON 2010 CLASS ONLY (no survivor bias)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 3: PERSONALITY ON 2010 DRAFT CLASS (no survivor bias)")
print("=" * 75)

pool_2010 = draft_2010  # Include all, even those who never reached MLB (WAR=0)

for trait_name, trait_key in [
    ("Work Ethic (WE)", 'we'),
    ("Leadership (LEA)", 'lea'),
    ("Intelligence (INT)", 'int'),
    ("Loyalty (LOY)", 'loy'),
    ("Adaptability (AD)", 'ad'),
    ("Greed (FIN)", 'fin'),
]:
    print(f"\n--- {trait_name} ---")
    groups = {'H': [], 'N': [], 'L': []}
    for p in pool_2010:
        t = p.get(trait_key)
        if t in groups:
            groups[t].append(p['war'])
    for level in ['H', 'N', 'L']:
        print(stats_line(groups[level], f"{level}"))

# WE by type for 2010 class
for ptype in ['pitcher', 'batter']:
    print(f"\n--- WE - 2010 {ptype.upper()}S ---")
    groups = {'H': [], 'N': [], 'L': []}
    for p in pool_2010:
        if p['type'] != ptype:
            continue
        t = p['we']
        if t in groups:
            groups[t].append(p['war'])
    for level in ['H', 'N', 'L']:
        print(stats_line(groups[level], f"{level}"))

# Personality Type for 2010 class
print(f"\n--- Personality Type (2010 class) ---")
type_groups = defaultdict(list)
for p in pool_2010:
    pt = p['type_personality']
    if pt:
        type_groups[pt].append(p['war'])
for ptype, wars in sorted(type_groups.items(), key=lambda x: -len(x[1])):
    if len(wars) >= 3:
        print(stats_line(wars, f"{ptype:>15}"))


# ═══════════════════════════════════════════════════════════
# ANALYSIS 4: WE CONTROLLING FOR POTENTIAL (2010 class)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 4: WORK ETHIC CONTROLLING FOR POTENTIAL (2010 class)")
print("=" * 75)

for pot_min, pot_max, label in [
    (3.5, 5.5, "High POT (3.5-5.0*)"),
    (2.5, 3.4, "Med POT (2.5-3.0*)"),
    (0.5, 2.4, "Low POT (0.5-2.0*)"),
]:
    print(f"\n  {label}:")
    for we_level in ['H', 'N', 'L']:
        group = [p for p in pool_2010
                 if p['pot'] is not None and pot_min <= p['pot'] <= pot_max
                 and p['we'] == we_level]
        if not group:
            print(f"    WE={we_level}: no players")
            continue
        wars = [p['war'] for p in group]
        avg = sum(wars) / len(wars)
        mlb = sum(1 for p in group if p['ever_mlb'])
        bust = sum(1 for w in wars if w < 0)
        top = sum(1 for w in wars if w >= 3)
        print(f"    WE={we_level}: n={len(wars):>3}, avg WAR={avg:>6.1f}, "
              f"reached MLB={100*mlb/len(wars):>4.0f}%, "
              f"bust={100*bust/len(wars):>4.0f}%, WAR>=3={100*top/len(wars):>4.0f}%")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 5: BUST RATES (2010 class)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 5: BUST RATES - 2010 DRAFT CLASS")
print("=" * 75)
print("(Bust = negative career WAR or never reached MLB)")

for label, group in [
    ("ALL 2010 DRAFTEES", pool_2010),
    ("PITCHERS", [p for p in pool_2010 if p['type'] == 'pitcher']),
    ("BATTERS", [p for p in pool_2010 if p['type'] == 'batter']),
]:
    if not group:
        continue
    never_mlb = sum(1 for p in group if not p['ever_mlb'])
    neg_war = sum(1 for p in group if p['ever_mlb'] and p['war'] < 0)
    low_war = sum(1 for p in group if p['war'] < 1.0)
    solid = sum(1 for p in group if p['war'] >= 5.0)
    star = sum(1 for p in group if p['war'] >= 15.0)

    print(f"\n  {label} (n={len(group)}):")
    print(f"    Never reached MLB:       {never_mlb:>4} ({100*never_mlb/len(group):.1f}%)")
    print(f"    Negative WAR (in MLB):   {neg_war:>4} ({100*neg_war/len(group):.1f}%)")
    print(f"    Total bust (never+neg):  {never_mlb+neg_war:>4} ({100*(never_mlb+neg_war)/len(group):.1f}%)")
    print(f"    Minimal value (WAR<1):   {low_war:>4} ({100*low_war/len(group):.1f}%)")
    print(f"    Solid career (WAR>=5):   {solid:>4} ({100*solid/len(group):.1f}%)")
    print(f"    Star career (WAR>=15):   {star:>4} ({100*star/len(group):.1f}%)")

# Bust rate by POT tier
print("\n--- Bust Rate by POT (2010 class) ---")
print("(Bust = never MLB + negative WAR)")
pot_groups = defaultdict(list)
for p in pool_2010:
    pot = p['pot']
    if pot is not None:
        if pot >= 4.5:
            bucket = "4.5-5.0*"
        elif pot >= 3.5:
            bucket = "3.5-4.0*"
        elif pot >= 2.5:
            bucket = "2.5-3.0*"
        elif pot >= 1.5:
            bucket = "1.5-2.0*"
        else:
            bucket = "0.5-1.0*"
        pot_groups[bucket].append(p)

for bucket in ["4.5-5.0*", "3.5-4.0*", "2.5-3.0*", "1.5-2.0*", "0.5-1.0*"]:
    group = pot_groups.get(bucket, [])
    if not group:
        continue
    wars = [p['war'] for p in group]
    bust = sum(1 for p in group if not p['ever_mlb'] or p['war'] < 0)
    mlb = sum(1 for p in group if p['ever_mlb'])
    avg_all = sum(wars) / len(wars)
    top = sum(1 for w in wars if w >= 5.0)
    print(f"  POT {bucket}: n={len(wars):>4}, reached MLB={100*mlb/len(wars):>4.0f}%, "
          f"avg WAR={avg_all:>6.1f}, bust={100*bust/len(wars):>4.0f}%, "
          f"solid(>=5)={100*top/len(wars):>4.0f}%")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 6: WAR BY DRAFT ROUND/PICK (2010 class)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 6: WAR BY DRAFT POSITION - 2010 CLASS")
print("=" * 75)

# By individual round
print("\n--- Career WAR by Draft Round ---")
for rd in range(1, 16):
    group = [p for p in pool_2010 if p['draft_round'] == rd]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for p in group if p['ever_mlb'])
    top = sum(1 for w in wars if w >= 5.0)
    print(f"  Round {rd:>2}: n={len(group):>3}, reached MLB={mlb:>3} ({100*mlb/len(group):>4.0f}%), "
          f"avg WAR={avg:>6.1f}, WAR>=5: {top}")

# By pick within round 1
print("\n--- Round 1: WAR by Pick ---")
r1 = sorted([p for p in pool_2010 if p['draft_round'] == 1], key=lambda p: p['draft_pick'])
for p in r1:
    mlb_tag = "*" if p['ever_mlb'] else " "
    print(f"  Pick {p['draft_pick']:>2}: {p['name']:<30} WAR={p['war']:>6.1f} {mlb_tag} | "
          f"POT={p['pot']:.1f}* | {p['type']:>7} | "
          f"WE={p['we'] or '?'} INT={p['int'] or '?'}")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 7: MULTI-CLASS DRAFT SLOT VALUE (all classes)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 7: DRAFT SLOT VALUE ACROSS CLASSES")
print("=" * 75)
print("(CAVEAT: Pre-2008 classes have survivor bias - bad players already retired)")

# All drafted players (not just 2010)
all_drafted = [p for p in all_players if p['drafted']]

print(f"\nAll drafted players in snapshot: {len(all_drafted)}")

# By round across all years
print("\n--- Career WAR by Draft Round (all classes) ---")
for rd in range(1, 16):
    group = [p for p in all_drafted if p['draft_round'] == rd]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for p in group if p['ever_mlb'])
    top = sum(1 for w in wars if w >= 10.0)
    print(f"  Round {rd:>2}: n={len(group):>3}, MLB={mlb:>3} ({100*mlb/len(group):>4.0f}%), "
          f"avg WAR={avg:>6.1f}, WAR>=10: {top}")

# By draft class year
print("\n--- Avg WAR by Draft Class (survivor bias for earlier years) ---")
for yr in range(2000, 2011):
    group = [p for p in all_drafted if p['draft_year'] == yr]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for p in group if p['ever_mlb'])
    top = sum(1 for w in wars if w >= 10.0)
    years_tracked = 2021 - yr
    print(f"  {yr} class (n={len(group):>3}, {years_tracked}yr track): "
          f"MLB={mlb:>3} ({100*mlb/len(group):>4.0f}%), "
          f"avg WAR={avg:>6.1f}, WAR>=10: {top}")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 8: COMBINED TRAIT INTERACTIONS
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 8: TRAIT INTERACTIONS (2010 class)")
print("=" * 75)

# High WE + High INT vs others
combos = [
    ("H WE + H INT", lambda p: p['we'] == 'H' and p['int'] == 'H'),
    ("H WE + H AD", lambda p: p['we'] == 'H' and p['ad'] == 'H'),
    ("H WE + H LOY", lambda p: p['we'] == 'H' and p['loy'] == 'H'),
    ("All H (WE+INT+AD)", lambda p: p['we'] == 'H' and p['int'] == 'H' and p['ad'] == 'H'),
    ("Normal everything", lambda p: p['we'] == 'N' and p['int'] == 'N' and p['lea'] == 'N'),
    ("Any L WE or L INT", lambda p: p['we'] == 'L' or p['int'] == 'L'),
    ("L WE + L INT", lambda p: p['we'] == 'L' and p['int'] == 'L'),
    ("H Greed (FIN)", lambda p: p['fin'] == 'H'),
    ("L Greed (FIN)", lambda p: p['fin'] == 'L'),
]

for label, fn in combos:
    group = [p for p in pool_2010 if fn(p)]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for p in group if p['ever_mlb'])
    bust = sum(1 for p in group if not p['ever_mlb'] or p['war'] < 0)
    top = sum(1 for w in wars if w >= 5.0)
    print(f"  {label:<25}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
          f"MLB={100*mlb/len(group):>4.0f}%, bust={100*bust/len(group):>4.0f}%, "
          f"WAR>=5={100*top/len(group):>4.0f}%")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 9: PITCHER-SPECIFIC DEEP DIVE
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 9: PITCHER BUST ANALYSIS (2010 class)")
print("=" * 75)

pitchers_2010 = [p for p in pool_2010 if p['type'] == 'pitcher']
batters_2010 = [p for p in pool_2010 if p['type'] == 'batter']

print(f"\n  2010 Pitchers: {len(pitchers_2010)}")
print(f"  2010 Batters: {len(batters_2010)}")

# Pitcher WE effect controlling for POT
print("\n--- Pitcher WE x POT (2010 class) ---")
for pot_min, pot_max, label in [
    (3.0, 5.5, "POT 3.0+"),
    (2.0, 2.9, "POT 2.0-2.5*"),
    (0.5, 1.9, "POT <2.0*"),
]:
    print(f"  {label}:")
    for we in ['H', 'N', 'L']:
        group = [p for p in pitchers_2010
                 if p['pot'] is not None and pot_min <= p['pot'] <= pot_max
                 and p['we'] == we]
        if len(group) < 3:
            print(f"    WE={we}: n={len(group)} (too few)")
            continue
        wars = [p['war'] for p in group]
        avg = sum(wars) / len(wars)
        mlb = sum(1 for p in group if p['ever_mlb'])
        print(f"    WE={we}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
              f"MLB={100*mlb/len(group):>4.0f}%")


# ═══════════════════════════════════════════════════════════
# TOP/BOTTOM LISTS
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("TOP 25 CAREER WAR (all players in 2010 snapshot)")
print("=" * 75)

all_sorted = sorted(all_players, key=lambda p: p['war'], reverse=True)
for i, p in enumerate(all_sorted[:25]):
    draft_info = f"Rd{p['draft_round']:>2}/Pk{p['draft_pick']:>2} ({p['draft_year']})" if p['drafted'] else "undrafted"
    print(f"  {i+1:>2}. {p['name']:<30} WAR={p['war']:>6.1f} | {p['type']:>7} {p['pos']:>2} | "
          f"POT={p['pot']:.1f}* | {draft_info} | "
          f"WE={p['we'] or '?'} INT={p['int'] or '?'} Type={p['type_personality']}")


# ═══════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("SUMMARY OF KEY FINDINGS")
print("=" * 75)

# Calculate key metrics for summary
we_h = [p['war'] for p in pool_2010 if p['we'] == 'H']
we_n = [p['war'] for p in pool_2010 if p['we'] == 'N']
we_l = [p['war'] for p in pool_2010 if p['we'] == 'L']

print(f"""
2010 Draft Class (10-year career outcomes):
  - Total draftees: {len(pool_2010)}
  - Reached MLB: {sum(1 for p in pool_2010 if p['ever_mlb'])} ({100*sum(1 for p in pool_2010 if p['ever_mlb'])/len(pool_2010):.0f}%)
  - WE effect (avg WAR): H={sum(we_h)/max(len(we_h),1):.1f}, N={sum(we_n)/max(len(we_n),1):.1f}, L={sum(we_l)/max(len(we_l),1):.1f}

See detailed analyses above for breakdowns by trait, potential, draft slot, and type.
""")

# ═══════════════════════════════════════════════════════════
# ANALYSIS 10: 2008-2010 COMBINED (with draft log attrition)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 75)
print("ANALYSIS 10: 2008-2010 COMBINED DRAFT CLASSES")
print("=" * 75)
print("(Using draft logs to measure attrition from 2008/2009)")

# Draft log counts (from web scrape)
draft_log_counts = {
    2008: 287,  # picks 1-287
    2009: 217,  # picks 1-217
    2010: 181,  # from snapshot Draft=2010 count
}

# Count how many from each class are in the 2010 snapshot
for yr in [2008, 2009, 2010]:
    in_snapshot = sum(1 for p in all_players if p['draft_year'] == yr)
    total = draft_log_counts.get(yr, in_snapshot)
    missing = total - in_snapshot
    print(f"  {yr}: Drafted={total}, In 2010 snapshot={in_snapshot}, "
          f"Already gone={missing} ({100*missing/total:.1f}% attrition in {2010-yr}yr)")

print("\nAttrition is low -> minimal survivor bias for personality analysis")

pool_0810 = [p for p in all_players if p['draft_year'] >= 2008 and p['draft_year'] <= 2010 and p['drafted']]
pitchers_0810 = [p for p in pool_0810 if p['type'] == 'pitcher']
batters_0810 = [p for p in pool_0810 if p['type'] == 'batter']

print(f"\nTotal 2008-2010 draftees in snapshot: {len(pool_0810)}")
print(f"  Pitchers: {len(pitchers_0810)}, Batters: {len(batters_0810)}")
print(f"  Reached MLB: {sum(1 for p in pool_0810 if p['ever_mlb'])}")

# ─── All personality traits ───
print("\n--- PERSONALITY TRAITS: 2008-2010 COMBINED ---")
for trait_name, trait_key in [
    ("Work Ethic (WE)", 'we'),
    ("Intelligence (INT)", 'int'),
    ("Adaptability (AD)", 'ad'),
    ("Leadership (LEA)", 'lea'),
    ("Loyalty (LOY)", 'loy'),
    ("Greed (FIN)", 'fin'),
]:
    print(f"\n  {trait_name}:")
    groups = {'H': [], 'N': [], 'L': []}
    for p in pool_0810:
        t = p.get(trait_key)
        if t in groups:
            groups[t].append(p)

    for level in ['H', 'N', 'L']:
        g = groups[level]
        if not g:
            print(f"    {level}: no players")
            continue
        wars = [p['war'] for p in g]
        avg = sum(wars) / len(wars)
        med = sorted(wars)[len(wars) // 2]
        mlb = sum(1 for p in g if p['ever_mlb'])
        bust = sum(1 for p in g if not p['ever_mlb'] or p['war'] < 0)
        top3 = sum(1 for w in wars if w >= 3)
        top10 = sum(1 for w in wars if w >= 10)
        print(f"    {level}: n={len(g):>4}, avg WAR={avg:>6.1f}, med={med:>5.1f}, "
              f"MLB={100*mlb/len(g):>4.0f}%, bust={100*bust/len(g):>4.0f}%, "
              f"WAR>=3={100*top3/len(g):>4.0f}%, WAR>=10={100*top10/len(g):>4.0f}%")

# ─── WE by player type ───
for ptype, ptype_pool in [("PITCHER", pitchers_0810), ("BATTER", batters_0810)]:
    print(f"\n  Work Ethic (WE) - {ptype}S:")
    groups = {'H': [], 'N': [], 'L': []}
    for p in ptype_pool:
        t = p['we']
        if t in groups:
            groups[t].append(p)
    for level in ['H', 'N', 'L']:
        g = groups[level]
        if not g:
            continue
        wars = [p['war'] for p in g]
        avg = sum(wars) / len(wars)
        mlb = sum(1 for p in g if p['ever_mlb'])
        top3 = sum(1 for w in wars if w >= 3)
        top10 = sum(1 for w in wars if w >= 10)
        print(f"    {level}: n={len(g):>4}, avg WAR={avg:>6.1f}, "
              f"MLB={100*mlb/len(g):>4.0f}%, "
              f"WAR>=3={100*top3/len(g):>4.0f}%, WAR>=10={100*top10/len(g):>4.0f}%")

# ─── WE controlling for POT ───
print("\n--- WE CONTROLLING FOR POTENTIAL (2008-2010) ---")
for pot_min, pot_max, label in [
    (4.0, 5.5, "Elite POT (4.0-5.0*)"),
    (3.0, 3.9, "Good POT (3.0-3.5*)"),
    (2.0, 2.9, "Med POT (2.0-2.5*)"),
    (0.5, 1.9, "Low POT (0.5-1.5*)"),
]:
    print(f"\n  {label}:")
    for we_level in ['H', 'N', 'L']:
        group = [p for p in pool_0810
                 if p['pot'] is not None and pot_min <= p['pot'] <= pot_max
                 and p['we'] == we_level]
        if len(group) < 3:
            print(f"    WE={we_level}: n={len(group)} (too few)")
            continue
        wars = [p['war'] for p in group]
        avg = sum(wars) / len(wars)
        mlb = sum(1 for p in group if p['ever_mlb'])
        bust = sum(1 for p in group if not p['ever_mlb'] or p['war'] < 0)
        top3 = sum(1 for w in wars if w >= 3)
        print(f"    WE={we_level}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
              f"MLB={100*mlb/len(group):>4.0f}%, bust={100*bust/len(group):>4.0f}%, "
              f"WAR>=3={100*top3/len(group):>4.0f}%")

# ─── AD controlling for POT ───
print("\n--- ADAPTABILITY CONTROLLING FOR POTENTIAL (2008-2010) ---")
for pot_min, pot_max, label in [
    (4.0, 5.5, "Elite POT (4.0-5.0*)"),
    (3.0, 3.9, "Good POT (3.0-3.5*)"),
    (2.0, 2.9, "Med POT (2.0-2.5*)"),
    (0.5, 1.9, "Low POT (0.5-1.5*)"),
]:
    print(f"\n  {label}:")
    for ad_level in ['H', 'N', 'L']:
        group = [p for p in pool_0810
                 if p['pot'] is not None and pot_min <= p['pot'] <= pot_max
                 and p['ad'] == ad_level]
        if len(group) < 3:
            print(f"    AD={ad_level}: n={len(group)} (too few)")
            continue
        wars = [p['war'] for p in group]
        avg = sum(wars) / len(wars)
        mlb = sum(1 for p in group if p['ever_mlb'])
        bust = sum(1 for p in group if not p['ever_mlb'] or p['war'] < 0)
        top3 = sum(1 for w in wars if w >= 3)
        print(f"    AD={ad_level}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
              f"MLB={100*mlb/len(group):>4.0f}%, bust={100*bust/len(group):>4.0f}%, "
              f"WAR>=3={100*top3/len(group):>4.0f}%")

# ─── INT controlling for POT ───
print("\n--- INTELLIGENCE CONTROLLING FOR POTENTIAL (2008-2010) ---")
for pot_min, pot_max, label in [
    (4.0, 5.5, "Elite POT (4.0-5.0*)"),
    (3.0, 3.9, "Good POT (3.0-3.5*)"),
    (2.0, 2.9, "Med POT (2.0-2.5*)"),
    (0.5, 1.9, "Low POT (0.5-1.5*)"),
]:
    print(f"\n  {label}:")
    for int_level in ['H', 'N', 'L']:
        group = [p for p in pool_0810
                 if p['pot'] is not None and pot_min <= p['pot'] <= pot_max
                 and p['int'] == int_level]
        if len(group) < 3:
            print(f"    INT={int_level}: n={len(group)} (too few)")
            continue
        wars = [p['war'] for p in group]
        avg = sum(wars) / len(wars)
        mlb = sum(1 for p in group if p['ever_mlb'])
        bust = sum(1 for p in group if not p['ever_mlb'] or p['war'] < 0)
        top3 = sum(1 for w in wars if w >= 3)
        print(f"    INT={int_level}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
              f"MLB={100*mlb/len(group):>4.0f}%, bust={100*bust/len(group):>4.0f}%, "
              f"WAR>=3={100*top3/len(group):>4.0f}%")

# ─── Trait combos (2008-2010) ───
print("\n--- TRAIT COMBINATIONS (2008-2010) ---")
combos = [
    ("All H (WE+INT+AD)",      lambda p: p['we'] == 'H' and p['int'] == 'H' and p['ad'] == 'H'),
    ("H WE + H INT",           lambda p: p['we'] == 'H' and p['int'] == 'H'),
    ("H WE + H AD",            lambda p: p['we'] == 'H' and p['ad'] == 'H'),
    ("H INT + H AD (not H WE)",lambda p: p['we'] != 'H' and p['int'] == 'H' and p['ad'] == 'H'),
    ("H WE only (INT/AD!=H)",  lambda p: p['we'] == 'H' and p['int'] != 'H' and p['ad'] != 'H'),
    ("All Normal (WE+INT+AD)", lambda p: p['we'] == 'N' and p['int'] == 'N' and p['ad'] == 'N'),
    ("Any L in WE/INT/AD",     lambda p: p['we'] == 'L' or p['int'] == 'L' or p['ad'] == 'L'),
    ("L WE (any INT/AD)",      lambda p: p['we'] == 'L'),
    ("L AD (any WE/INT)",      lambda p: p['ad'] == 'L'),
    ("L INT (any WE/AD)",      lambda p: p['int'] == 'L'),
    ("2+ Low in WE/INT/AD",    lambda p: sum([p['we'] == 'L', p['int'] == 'L', p['ad'] == 'L']) >= 2),
]

for label, fn in combos:
    group = [p for p in pool_0810 if fn(p)]
    if len(group) < 3:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for p in group if p['ever_mlb'])
    bust = sum(1 for p in group if not p['ever_mlb'] or p['war'] < 0)
    top3 = sum(1 for w in wars if w >= 3)
    top10 = sum(1 for w in wars if w >= 10)
    print(f"  {label:<28}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
          f"MLB={100*mlb/len(group):>4.0f}%, bust={100*bust/len(group):>4.0f}%, "
          f"WAR>=3={100*top3/len(group):>4.0f}%, WAR>=10={100*top10/len(group):>4.0f}%")

# ─── Which trait matters most? Rank by effect size ───
print("\n--- TRAIT RANKING BY EFFECT SIZE (H vs L, 2008-2010) ---")
trait_effects = []
for trait_name, trait_key in [
    ("Work Ethic (WE)", 'we'),
    ("Intelligence (INT)", 'int'),
    ("Adaptability (AD)", 'ad'),
    ("Leadership (LEA)", 'lea'),
    ("Loyalty (LOY)", 'loy'),
    ("Greed (FIN)", 'fin'),
]:
    h_wars = [p['war'] for p in pool_0810 if p.get(trait_key) == 'H']
    l_wars = [p['war'] for p in pool_0810 if p.get(trait_key) == 'L']
    n_wars = [p['war'] for p in pool_0810 if p.get(trait_key) == 'N']
    if h_wars and l_wars and n_wars:
        h_avg = sum(h_wars) / len(h_wars)
        n_avg = sum(n_wars) / len(n_wars)
        l_avg = sum(l_wars) / len(l_wars)
        diff = h_avg - l_avg
        trait_effects.append((trait_name, diff, h_avg, n_avg, l_avg, len(h_wars), len(n_wars), len(l_wars)))

trait_effects.sort(key=lambda x: -x[1])
for name, diff, h_avg, n_avg, l_avg, h_n, n_n, l_n in trait_effects:
    print(f"  {name:<22}: H={h_avg:>5.1f}(n={h_n:>3}) N={n_avg:>5.1f}(n={n_n:>3}) L={l_avg:>5.1f}(n={l_n:>3}) => H-L delta={diff:>+5.1f}")

# ─── Draft round outcomes (2008-2010 combined) ───
print("\n--- DRAFT ROUND OUTCOMES (2008-2010 combined) ---")
for rd in range(1, 13):
    group = [p for p in pool_0810 if p['draft_round'] == rd]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for p in group if p['ever_mlb'])
    top5 = sum(1 for w in wars if w >= 5)
    top15 = sum(1 for w in wars if w >= 15)
    print(f"  Rd {rd:>2}: n={len(group):>3}, MLB={mlb:>3} ({100*mlb/len(group):>4.0f}%), "
          f"avg WAR={avg:>5.1f}, WAR>=5={top5:>2}, WAR>=15={top15:>2}")


print("\n\nDone!")
