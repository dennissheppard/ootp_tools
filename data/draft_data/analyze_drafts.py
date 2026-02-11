"""
WBL Draft Data Analysis
Analyzes personality traits, bust rates, and draft slot value
"""
import csv
import os
from collections import defaultdict
from pathlib import Path

BASE = Path(r"C:\Users\neags\Downloads\dev projects\wbl\data\draft_data")

# ─── Draft pick logs (from web scrape) ───
DRAFT_PICKS = {}  # id -> {year, pick, round, team}

draft_logs_raw = {
    2015: """1,1,Isami Endo,CLE
1,2,Glen Smith,LDN
1,3,Mike Golunski,DUB
1,4,Clive Cunningham,LAP
1,5,Kade MacKay,ADE
1,6,Egiodeo Lucetti,SMT
1,7,Diego Acevedo,VAN
1,8,Oscar Owen,CAL
1,9,Min-gook Park,AMS
1,10,Phil Watt,STU
1,11,Maurice Sartoretti,RME
1,12,Joel Harris,TOK
1,13,Dave Larocque,VAN
1,14,Katsumi Nishi,ADE
1,15,Naofumi Shimizu,SPA
1,16,Wen-bin Tada,HAV
1,17,Landon Gunn,NKO
1,18,Ceasario Menocchio,DUB
1,19,Jesus Aragon,DEN
1,20,Holden Tudix,LON
1,21,Matt Marr,NKO""",
    2016: """1,1,Clotilde Bailo,LDN
1,2,Jonah Casey,DUB
1,3,Danny Aguilar,LAP
1,4,Danny Melendez,CLE
1,5,Michael Mellor,AMS
1,6,Jason Clark,VAN
1,7,Reginald Verschuur,SMT
1,8,Will Bradnock,TOK
1,9,Alex Watson,ADE
1,10,Hyun-woo Kim,NKO""",
    2017: """1,1,Owen Begum,NKO
1,2,Brayden Bourke,SMT
1,3,Nikau Pouaka-Grego,ADE
1,4,Chris Johnson,DUB
1,5,John Denver,DEN
1,6,Jung-hoon Park,CLE""",
    2018: """1,1,Charlie Parker,LDN
1,2,Lorenzo Lara,SMT""",
    2019: """1,1,R.J. Hoffe,HAV
1,2,Paolo Janssen,LDN""",
    2020: """1,1,Gene Wills,TOK"""
}


def normalize_trait(val):
    """Normalize personality trait values to H/N/L"""
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


def parse_war(val):
    """Parse WAR value, return None if invalid"""
    if not val or val.strip() == '':
        return None
    try:
        return float(val.strip())
    except (ValueError, TypeError):
        return None


def parse_pot(val):
    """Parse potential stars value"""
    if not val:
        return None
    v = val.strip().replace(' Stars', '').replace(' Star', '')
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def parse_ovr(val):
    """Parse OVR stars value"""
    if not val:
        return None
    v = val.strip().replace(' Stars', '').replace(' Star', '')
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def load_csv(filepath):
    """Load a CSV file and return list of dicts"""
    rows = []
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def get_col(row, *candidates):
    """Get first matching column value"""
    for c in candidates:
        if c in row and row[c] is not None and str(row[c]).strip():
            return row[c].strip()
    return None


# ─── Load all data files with WAR ───
all_players = []

# 2016 Pitchers (has WAR, ERA+, FIP)
for row in load_csv(BASE / "2016 pitchers.csv"):
    war = parse_war(get_col(row, 'WAR'))
    if war is None:
        continue
    all_players.append({
        'name': get_col(row, 'Name'),
        'id': get_col(row, 'ID'),
        'draft_year': 2016,
        'type': 'pitcher',
        'age': get_col(row, 'Age'),
        'war': war,
        'pot': parse_pot(get_col(row, 'POT')),
        'ovr': parse_ovr(get_col(row, 'OVR')),
        'lea': normalize_trait(get_col(row, 'LEA')),
        'we': normalize_trait(get_col(row, 'WE')),
        'int': normalize_trait(get_col(row, 'INT')),
        'prone': get_col(row, 'Prone'),
    })

# 2018 Pitching (has WAR)
for row in load_csv(BASE / "2018 pitching.csv"):
    war = parse_war(get_col(row, 'WAR'))
    if war is None:
        continue
    all_players.append({
        'name': get_col(row, 'Name'),
        'id': get_col(row, 'ID'),
        'draft_year': 2018,
        'type': 'pitcher',
        'age': get_col(row, 'Age'),
        'war': war,
        'pot': parse_pot(get_col(row, 'POT')),
        'ovr': parse_ovr(get_col(row, 'OVR')),
        'lea': normalize_trait(get_col(row, 'LEA')),
        'we': normalize_trait(get_col(row, 'WE')),
        'int': normalize_trait(get_col(row, 'INT')),
        'prone': get_col(row, 'Prone'),
    })

# 2018 Batters (has WAR)
for row in load_csv(BASE / "2018 batters.csv"):
    war = parse_war(get_col(row, 'WAR'))
    if war is None:
        continue
    all_players.append({
        'name': get_col(row, 'Name'),
        'id': get_col(row, 'ID'),
        'draft_year': 2018,
        'type': 'batter',
        'age': get_col(row, 'Age'),
        'war': war,
        'pot': parse_pot(get_col(row, 'POT')),
        'ovr': parse_ovr(get_col(row, 'OVR')),
        'lea': normalize_trait(get_col(row, 'LEA')),
        'we': normalize_trait(get_col(row, 'WE')),
        'int': normalize_trait(get_col(row, 'INT')),
        'prone': get_col(row, 'Prone'),
    })

# 2019 Pitchers (has WAR, ERA+)
for row in load_csv(BASE / "2019 pitchers.csv"):
    war = parse_war(get_col(row, 'WAR'))
    if war is None:
        continue
    all_players.append({
        'name': get_col(row, 'Name'),
        'id': get_col(row, 'ID'),
        'draft_year': 2019,
        'type': 'pitcher',
        'age': get_col(row, 'Age'),
        'war': war,
        'pot': parse_pot(get_col(row, 'POT')),
        'ovr': parse_ovr(get_col(row, 'OVR')),
        'lea': normalize_trait(get_col(row, 'LEA')),
        'we': normalize_trait(get_col(row, 'WE')),
        'int': normalize_trait(get_col(row, 'INT')),
        'prone': get_col(row, 'Prone'),
    })

# 2019 Batters (has WAR)
for row in load_csv(BASE / "2019 batters.csv"):
    war = parse_war(get_col(row, 'WAR'))
    if war is None:
        continue
    all_players.append({
        'name': get_col(row, 'Name'),
        'id': get_col(row, 'ID'),
        'draft_year': 2019,
        'type': 'batter',
        'age': get_col(row, 'Age'),
        'war': war,
        'pot': parse_pot(get_col(row, 'POT')),
        'ovr': parse_ovr(get_col(row, 'OVR')),
        'lea': normalize_trait(get_col(row, 'LEA')),
        'we': normalize_trait(get_col(row, 'WE')),
        'int': normalize_trait(get_col(row, 'INT')),
        'prone': get_col(row, 'Prone'),
    })

# 2021 Pitchers (has WAR, ERA+)
for row in load_csv(BASE / "2021 pitchers.csv"):
    war = parse_war(get_col(row, 'WAR'))
    if war is None:
        continue
    all_players.append({
        'name': get_col(row, 'Name'),
        'id': get_col(row, 'ID'),
        'draft_year': 2021,
        'type': 'pitcher',
        'age': get_col(row, 'Age'),
        'war': war,
        'pot': parse_pot(get_col(row, 'POT')),
        'ovr': parse_ovr(get_col(row, 'OVR')),
        'lea': normalize_trait(get_col(row, 'LEA')),
        'we': normalize_trait(get_col(row, 'WE')),
        'int': normalize_trait(get_col(row, 'INT')),
        'prone': get_col(row, 'Prone'),
    })

# 2021 Batters (has WAR)
for row in load_csv(BASE / "2021 batters.csv"):
    war = parse_war(get_col(row, 'WAR'))
    if war is None:
        continue
    all_players.append({
        'name': get_col(row, 'Name'),
        'id': get_col(row, 'ID'),
        'draft_year': 2021,
        'type': 'batter',
        'age': get_col(row, 'Age'),
        'war': war,
        'pot': parse_pot(get_col(row, 'POT')),
        'ovr': parse_ovr(get_col(row, 'OVR')),
        'lea': normalize_trait(get_col(row, 'LEA')),
        'we': normalize_trait(get_col(row, 'WE')),
        'int': normalize_trait(get_col(row, 'INT')),
        'prone': get_col(row, 'Prone'),
    })

print(f"Total players loaded: {len(all_players)}")
print(f"  Pitchers: {sum(1 for p in all_players if p['type'] == 'pitcher')}")
print(f"  Batters: {sum(1 for p in all_players if p['type'] == 'batter')}")
print(f"  By draft year: ", end="")
by_year = defaultdict(int)
for p in all_players:
    by_year[p['draft_year']] += 1
for y in sorted(by_year):
    print(f"{y}:{by_year[y]} ", end="")
print()

# ═══════════════════════════════════════════════════════════
# ANALYSIS 1: Personality Traits vs WAR
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("ANALYSIS 1: PERSONALITY TRAITS vs WAR")
print("=" * 70)

for trait_name, trait_key in [("Work Ethic (WE)", 'we'), ("Leadership (LEA)", 'lea'), ("Intelligence (INT)", 'int')]:
    print(f"\n--- {trait_name} ---")

    groups = {'H': [], 'N': [], 'L': []}
    for p in all_players:
        t = p[trait_key]
        if t in groups:
            groups[t].append(p['war'])

    for level in ['H', 'N', 'L']:
        vals = groups[level]
        if not vals:
            print(f"  {level}: No players")
            continue
        avg = sum(vals) / len(vals)
        med = sorted(vals)[len(vals) // 2]
        pos = sum(1 for v in vals if v > 0)
        neg = sum(1 for v in vals if v < 0)
        top = sum(1 for v in vals if v >= 3.0)
        print(f"  {level}: n={len(vals):>4}, avg WAR={avg:>6.2f}, median={med:>6.2f}, "
              f"WAR>0: {pos}/{len(vals)} ({100*pos/len(vals):.0f}%), "
              f"WAR>=3: {top}/{len(vals)} ({100*top/len(vals):.0f}%)")

# Breakdown by type (pitcher vs batter)
for ptype in ['pitcher', 'batter']:
    print(f"\n--- Work Ethic (WE) - {ptype.upper()}S ONLY ---")
    groups = {'H': [], 'N': [], 'L': []}
    for p in all_players:
        if p['type'] != ptype:
            continue
        t = p['we']
        if t in groups:
            groups[t].append(p['war'])

    for level in ['H', 'N', 'L']:
        vals = groups[level]
        if not vals:
            print(f"  {level}: No players")
            continue
        avg = sum(vals) / len(vals)
        med = sorted(vals)[len(vals) // 2]
        pos = sum(1 for v in vals if v > 0)
        top = sum(1 for v in vals if v >= 3.0)
        print(f"  {level}: n={len(vals):>4}, avg WAR={avg:>6.2f}, median={med:>6.2f}, "
              f"WAR>0: {pos}/{len(vals)} ({100*pos/len(vals):.0f}%), "
              f"WAR>=3: {top}/{len(vals)} ({100*top/len(vals):.0f}%)")

# Combined personality analysis
print(f"\n--- Combined Traits: High WE + High INT (the 'best' personality) ---")
best = [p for p in all_players if p['we'] == 'H' and p['int'] == 'H']
normal = [p for p in all_players if p['we'] == 'N' and p['int'] == 'N']
worst = [p for p in all_players if p['we'] == 'L' or p['int'] == 'L']

for label, group in [("High WE + High INT", best), ("Normal WE + Normal INT", normal), ("Low WE or Low INT", worst)]:
    if not group:
        print(f"  {label}: No players")
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    pos = sum(1 for v in wars if v > 0)
    top = sum(1 for v in wars if v >= 3.0)
    print(f"  {label}: n={len(wars):>4}, avg WAR={avg:>6.2f}, "
          f"WAR>0: {pos}/{len(wars)} ({100*pos/len(wars):.0f}%), "
          f"WAR>=3: {top}/{len(wars)} ({100*top/len(wars):.0f}%)")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 2: BUST RATES
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("ANALYSIS 2: BUST RATES")
print("=" * 70)

# Define bust: negative career WAR or WAR < 0.5 (replacement level)
print("\nBust = career WAR < 0 (net negative value)")
print("Disappointment = career WAR < 1.0 (minimal value)")

for ptype_label, ptype_filter in [("ALL PLAYERS", None), ("PITCHERS", 'pitcher'), ("BATTERS", 'batter')]:
    players = [p for p in all_players if ptype_filter is None or p['type'] == ptype_filter]

    busts = sum(1 for p in players if p['war'] < 0)
    disappoints = sum(1 for p in players if p['war'] < 1.0)
    solid = sum(1 for p in players if p['war'] >= 2.0)
    stars = sum(1 for p in players if p['war'] >= 4.0)

    print(f"\n  {ptype_label} (n={len(players)}):")
    print(f"    Bust (WAR < 0):           {busts:>4} ({100*busts/len(players):.1f}%)")
    print(f"    Disappointment (WAR < 1):  {disappoints:>4} ({100*disappoints/len(players):.1f}%)")
    print(f"    Solid (WAR >= 2):          {solid:>4} ({100*solid/len(players):.1f}%)")
    print(f"    Star (WAR >= 4):           {stars:>4} ({100*stars/len(players):.1f}%)")

# Bust rate by potential
print("\n--- Bust Rate by Draft Potential (POT) ---")
pot_groups = defaultdict(list)
for p in all_players:
    pot = p['pot']
    if pot is not None:
        # Group into buckets
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
    busts = sum(1 for w in wars if w < 0)
    avg = sum(wars) / len(wars)
    top = sum(1 for w in wars if w >= 3.0)
    print(f"  POT {bucket}: n={len(wars):>4}, avg WAR={avg:>6.2f}, bust rate={100*busts/len(wars):>5.1f}%, hit rate (WAR>=3)={100*top/len(wars):>5.1f}%")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 3: VALUE BY DRAFT SLOT
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("ANALYSIS 3: VALUE BY DRAFT SLOT (approximate)")
print("=" * 70)

# We don't have draft pick mapped to all players yet, but we can use POT
# as a proxy for draft position (higher POT = earlier pick generally)
# And we can look at WAR distributions by POT tier

# Also look at WAR by age at draft (proxy for round)
print("\n--- WAR by Draft Age (younger = higher pick typically) ---")
age_groups = defaultdict(list)
for p in all_players:
    age = p.get('age')
    if age:
        try:
            a = float(age)
            if a <= 18:
                bucket = "17-18 (HS)"
            elif a <= 20:
                bucket = "19-20"
            else:
                bucket = "21-23 (College)"
        except:
            continue
        age_groups[bucket].append(p['war'])

for bucket in ["17-18 (HS)", "19-20", "21-23 (College)"]:
    vals = age_groups.get(bucket, [])
    if not vals:
        continue
    avg = sum(vals) / len(vals)
    med = sorted(vals)[len(vals) // 2]
    busts = sum(1 for v in vals if v < 0)
    top = sum(1 for v in vals if v >= 3.0)
    print(f"  {bucket:>18}: n={len(vals):>4}, avg WAR={avg:>6.2f}, median={med:>6.2f}, "
          f"bust={100*busts/len(vals):>5.1f}%, star={100*top/len(vals):>5.1f}%")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 4: INJURY PRONENESS
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("ANALYSIS 4: INJURY PRONENESS vs WAR")
print("=" * 70)

prone_groups = defaultdict(list)
for p in all_players:
    pr = p.get('prone', '')
    if pr:
        prone_groups[pr].append(p['war'])

for level in ['Durable', 'Normal', 'Fragile']:
    vals = prone_groups.get(level, [])
    if not vals:
        continue
    avg = sum(vals) / len(vals)
    busts = sum(1 for v in vals if v < 0)
    top = sum(1 for v in vals if v >= 3.0)
    print(f"  {level:>10}: n={len(vals):>4}, avg WAR={avg:>6.2f}, "
          f"bust={100*busts/len(vals):>5.1f}%, star={100*top/len(vals):>5.1f}%")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 5: TOP PERFORMERS
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("TOP 20 PERFORMERS BY WAR (across all draft classes)")
print("=" * 70)

sorted_players = sorted(all_players, key=lambda p: p['war'], reverse=True)
for i, p in enumerate(sorted_players[:20]):
    print(f"  {i+1:>2}. {p['name']:<35} WAR={p['war']:>6.2f} | "
          f"POT={p['pot']:.1f}* | WE={p['we'] or '?'} LEA={p['lea'] or '?'} INT={p['int'] or '?'} | "
          f"{p['type']:>7} | {p['draft_year']}")

print("\n" + "=" * 70)
print("BOTTOM 20 PERFORMERS BY WAR")
print("=" * 70)
for i, p in enumerate(sorted_players[-20:]):
    print(f"  {i+1:>2}. {p['name']:<35} WAR={p['war']:>6.2f} | "
          f"POT={p['pot']:.1f}* | WE={p['we'] or '?'} LEA={p['lea'] or '?'} INT={p['int'] or '?'} | "
          f"{p['type']:>7} | {p['draft_year']}")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 6: YEARS OF DATA ASSESSMENT
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("DATA COVERAGE ASSESSMENT")
print("=" * 70)
print("""
Files with WAR outcomes:
  2016 pitchers: Drafted 2016, ~5 years of career data by 2021
  2018 pitchers + batters: Drafted 2018, ~3 years of career data
  2019 pitchers + batters: Drafted 2019, ~2 years of career data
  2021 pitchers + batters: Drafted 2021, <1 year of career data

Files WITHOUT WAR (scouting only):
  2015 pitchers: Scouting ratings only, no outcomes
  2017 pitchers: Scouting ratings only, no outcomes

Missing entirely:
  2015 batters, 2016 batters, 2017 batters, 2020 (all)
""")

# ═══════════════════════════════════════════════════════════
# ANALYSIS 7: WE effect controlling for POT
# ═══════════════════════════════════════════════════════════
print("=" * 70)
print("ANALYSIS 7: WORK ETHIC EFFECT CONTROLLING FOR POTENTIAL")
print("=" * 70)
print("(Does WE matter WITHIN the same talent tier?)")

for pot_min, pot_max, label in [(3.5, 5.5, "High POT (3.5-5.0*)"), (2.5, 3.4, "Med POT (2.5-3.0*)"), (0.5, 2.4, "Low POT (0.5-2.0*)")]:
    print(f"\n  {label}:")
    for we_level in ['H', 'N', 'L']:
        group = [p for p in all_players if p['pot'] is not None and pot_min <= p['pot'] <= pot_max and p['we'] == we_level]
        if not group:
            continue
        wars = [p['war'] for p in group]
        avg = sum(wars) / len(wars)
        busts = sum(1 for w in wars if w < 0)
        print(f"    WE={we_level}: n={len(wars):>4}, avg WAR={avg:>6.2f}, bust={100*busts/len(wars):>5.1f}%")

# Same for INT
print("\n--- INTELLIGENCE EFFECT CONTROLLING FOR POTENTIAL ---")
for pot_min, pot_max, label in [(3.5, 5.5, "High POT (3.5-5.0*)"), (2.5, 3.4, "Med POT (2.5-3.0*)"), (0.5, 2.4, "Low POT (0.5-2.0*)")]:
    print(f"\n  {label}:")
    for int_level in ['H', 'N', 'L']:
        group = [p for p in all_players if p['pot'] is not None and pot_min <= p['pot'] <= pot_max and p['int'] == int_level]
        if not group:
            continue
        wars = [p['war'] for p in group]
        avg = sum(wars) / len(wars)
        busts = sum(1 for w in wars if w < 0)
        print(f"    INT={int_level}: n={len(wars):>4}, avg WAR={avg:>6.2f}, bust={100*busts/len(wars):>5.1f}%")

print("\n\nDone!")
