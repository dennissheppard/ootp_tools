"""
Quick deep dive: Does triple-H personality elevate a 2.5* prospect
to first-round value? Compare personality combos across POT tiers.
"""
import csv
from collections import defaultdict
from pathlib import Path

BASE = Path(r"C:\Users\neags\Downloads\dev projects\wbl\data\draft_data")
STATS = Path(r"C:\Users\neags\Downloads\dev projects\wbl\public\data")

def load_csv(filepath):
    rows = []
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows

def parse_stars(val):
    if not val: return None
    try: return float(val.strip().replace(' Stars','').replace(' Star',''))
    except: return None

def norm(val):
    if not val or val.strip() in ('', 'U'): return None
    v = val.strip().upper()
    if v in ('H','HIGH'): return 'H'
    if v in ('N','NORMAL'): return 'N'
    if v in ('L','LOW'): return 'L'
    return None

def si(val, d=0):
    try: return int(val)
    except: return d

def sf(val, d=0.0):
    try: return float(val)
    except: return d

# Load WAR
print("Loading WAR data...")
pitching_war = defaultdict(float)
pitching_seasons = defaultdict(int)
for yr in range(2000, 2022):
    f = STATS/"mlb"/f"{yr}.csv"
    if not f.exists(): continue
    for r in load_csv(f):
        pid = si(r.get('player_id',0))
        if pid and sf(r.get('ip',0)) > 0:
            pitching_war[pid] += sf(r.get('war',0))
            pitching_seasons[pid] += 1

batting_war = defaultdict(float)
batting_seasons = defaultdict(int)
for yr in range(2000, 2022):
    f = STATS/"mlb_batting"/f"{yr}_batting.csv"
    if not f.exists(): continue
    for r in load_csv(f):
        pid = si(r.get('player_id',0))
        if pid and si(r.get('pa',0)) > 0:
            batting_war[pid] += sf(r.get('war',0))
            batting_seasons[pid] += 1

# Load players
PITCHER_POS = {'SP','RP','CL','MR','LR'}
all_players = []
seen = set()

for row in load_csv(BASE/"pitchers_2010.csv"):
    pid = si(row.get('ID',0))
    if not pid or pid in seen: continue
    seen.add(pid)
    dy = si(row.get('Draft',0))
    all_players.append({
        'id': pid, 'name': row.get('Name','').strip(),
        'type': 'pitcher', 'pos': row.get('POS','').strip(),
        'age': si(row.get('Age',0)),
        'ovr': parse_stars(row.get('OVR','')),
        'pot': parse_stars(row.get('POT','')),
        'war': pitching_war.get(pid, 0.0),
        'seasons': pitching_seasons.get(pid, 0),
        'mlb': pitching_seasons.get(pid, 0) > 0,
        'we': norm(row.get('WE','')), 'int': norm(row.get('INT','')),
        'ad': norm(row.get('AD','')), 'lea': norm(row.get('LEA','')),
        'loy': norm(row.get('LOY','')), 'fin': norm(row.get('FIN','')),
        'draft_year': dy, 'draft_round': si(row.get('Round',0)),
        'draft_pick': si(row.get('Pick',0)), 'drafted': dy > 0,
    })

for row in load_csv(BASE/"batters_2010.csv"):
    pid = si(row.get('ID',0))
    if not pid or pid in seen: continue
    seen.add(pid)
    pos = row.get('POS','').strip()
    is_p = pos in PITCHER_POS
    dy = si(row.get('Draft',0))
    w = pitching_war.get(pid,0.0) if is_p else batting_war.get(pid,0.0)
    s = pitching_seasons.get(pid,0) if is_p else batting_seasons.get(pid,0)
    all_players.append({
        'id': pid, 'name': row.get('Name','').strip(),
        'type': 'pitcher' if is_p else 'batter', 'pos': pos,
        'age': si(row.get('Age',0)),
        'ovr': parse_stars(row.get('OVR','')),
        'pot': parse_stars(row.get('POT','')),
        'war': w, 'seasons': s, 'mlb': s > 0,
        'we': norm(row.get('WE','')), 'int': norm(row.get('INT','')),
        'ad': norm(row.get('AD','')), 'lea': norm(row.get('LEA','')),
        'loy': norm(row.get('LOY','')), 'fin': norm(row.get('FIN','')),
        'draft_year': dy, 'draft_round': si(row.get('Round',0)),
        'draft_pick': si(row.get('Pick',0)), 'drafted': dy > 0,
    })

pool = [p for p in all_players if p['draft_year'] >= 2008 and p['drafted']]
print(f"2008-2010 draftees: {len(pool)}\n")

def describe(group, label):
    if not group:
        print(f"  {label}: no players")
        return
    wars = [p['war'] for p in group]
    avg = sum(wars)/len(wars)
    med = sorted(wars)[len(wars)//2]
    mlb = sum(1 for p in group if p['mlb'])
    top3 = sum(1 for w in wars if w >= 3)
    top5 = sum(1 for w in wars if w >= 5)
    top10 = sum(1 for w in wars if w >= 10)
    top20 = sum(1 for w in wars if w >= 20)
    bust = sum(1 for p in group if not p['mlb'] or p['war'] < 0)
    p75 = sorted(wars)[int(len(wars)*0.75)] if len(wars) >= 4 else max(wars)
    p90 = sorted(wars)[int(len(wars)*0.9)] if len(wars) >= 10 else max(wars)
    print(f"  {label:<45}: n={len(group):>3}, avg={avg:>5.1f}, med={med:>5.1f}, "
          f"MLB={100*mlb/len(group):>3.0f}%, bust={100*bust/len(group):>3.0f}%, "
          f"WAR>=5={100*top5/len(group):>3.0f}%, >=10={100*top10/len(group):>3.0f}%, >=20={100*top20/len(group):>3.0f}%, "
          f"p75={p75:>5.1f}, p90={p90:>5.1f}")

# ═══════════════════════════════════════════════════════════
# THE BIG QUESTION: Does triple-H at 2.5* beat higher POT?
# ═══════════════════════════════════════════════════════════
print("=" * 120)
print("THE BIG QUESTION: Can personality overcome talent tier?")
print("=" * 120)

# Define personality buckets
def is_triple_h(p): return p['we']=='H' and p['int']=='H' and p['ad']=='H'
def is_double_h(p): return sum([p['we']=='H', p['int']=='H', p['ad']=='H']) >= 2
def is_any_h(p): return p['we']=='H' or p['int']=='H' or p['ad']=='H'
def is_all_normal(p): return p['we']=='N' and p['int']=='N' and p['ad']=='N'
def is_any_low(p): return p['we']=='L' or p['int']=='L' or p['ad']=='L'
def is_h_we(p): return p['we']=='H'
def is_l_we(p): return p['we']=='L'

print("\n--- POT tier x Personality bucket ---")
print("(Each cell: how does personality affect outcomes WITHIN a talent tier?)\n")

for pot_min, pot_max, pot_label in [
    (4.5, 5.5, "4.5-5.0* (Elite)"),
    (3.5, 4.4, "3.5-4.0* (High)"),
    (3.0, 3.4, "3.0* (Good)"),
    (2.5, 2.9, "2.5* (Average)"),
    (2.0, 2.4, "2.0* (Below Avg)"),
    (1.0, 1.9, "1.0-1.5* (Low)"),
]:
    pot_pool = [p for p in pool if p['pot'] is not None and pot_min <= p['pot'] <= pot_max]
    if not pot_pool:
        continue
    print(f"\n  POT {pot_label} (total n={len(pot_pool)}):")
    describe([p for p in pot_pool if is_triple_h(p)], "Triple H (WE+INT+AD all H)")
    describe([p for p in pot_pool if is_double_h(p) and not is_triple_h(p)], "Double H (2 of 3)")
    describe([p for p in pot_pool if is_h_we(p) and not is_double_h(p)], "H WE only")
    describe([p for p in pot_pool if is_all_normal(p)], "All Normal")
    describe([p for p in pot_pool if is_any_low(p) and not is_all_normal(p)], "Any Low trait")

# ═══════════════════════════════════════════════════════════
# CROSS-TIER COMPARISON: The money question
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 120)
print("CROSS-TIER: Triple-H 2.5* vs Normal 3.5* vs Normal 4.0*")
print("(Does personality + lower POT beat higher POT + average personality?)")
print("=" * 120)

combos = [
    ("5.0* + Triple H",     lambda p: p['pot'] is not None and p['pot'] >= 4.5 and is_triple_h(p)),
    ("5.0* + All Normal",   lambda p: p['pot'] is not None and p['pot'] >= 4.5 and is_all_normal(p)),
    ("4.0* + Triple H",     lambda p: p['pot'] is not None and 3.5 <= p['pot'] <= 4.4 and is_triple_h(p)),
    ("4.0* + H WE",         lambda p: p['pot'] is not None and 3.5 <= p['pot'] <= 4.4 and is_h_we(p)),
    ("4.0* + All Normal",   lambda p: p['pot'] is not None and 3.5 <= p['pot'] <= 4.4 and is_all_normal(p)),
    ("4.0* + Any Low",      lambda p: p['pot'] is not None and 3.5 <= p['pot'] <= 4.4 and is_any_low(p)),
    ("3.0* + Triple H",     lambda p: p['pot'] is not None and 2.5 <= p['pot'] <= 3.4 and is_triple_h(p)),
    ("3.0* + Double H",     lambda p: p['pot'] is not None and 2.5 <= p['pot'] <= 3.4 and is_double_h(p)),
    ("3.0* + H WE",         lambda p: p['pot'] is not None and 2.5 <= p['pot'] <= 3.4 and is_h_we(p)),
    ("3.0* + All Normal",   lambda p: p['pot'] is not None and 2.5 <= p['pot'] <= 3.4 and is_all_normal(p)),
    ("3.0* + Any Low",      lambda p: p['pot'] is not None and 2.5 <= p['pot'] <= 3.4 and is_any_low(p)),
    ("2.0* + Triple H",     lambda p: p['pot'] is not None and 1.5 <= p['pot'] <= 2.4 and is_triple_h(p)),
    ("2.0* + H WE",         lambda p: p['pot'] is not None and 1.5 <= p['pot'] <= 2.4 and is_h_we(p)),
    ("2.0* + All Normal",   lambda p: p['pot'] is not None and 1.5 <= p['pot'] <= 2.4 and is_all_normal(p)),
    ("2.0* + Any Low",      lambda p: p['pot'] is not None and 1.5 <= p['pot'] <= 2.4 and is_any_low(p)),
]

print()
for label, fn in combos:
    group = [p for p in pool if fn(p)]
    describe(group, label)

# ═══════════════════════════════════════════════════════════
# NAME THE TRIPLE-H 2.5* PLAYERS
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 120)
print("TRIPLE-H PLAYERS BY POT TIER (individual outcomes)")
print("=" * 120)

for pot_min, pot_max, label in [
    (4.0, 5.5, "4.0*+ Triple H"),
    (2.5, 3.9, "2.5-3.5* Triple H"),
    (1.0, 2.4, "Sub-2.5* Triple H"),
]:
    group = sorted([p for p in pool if p['pot'] is not None and pot_min <= p['pot'] <= pot_max and is_triple_h(p)],
                   key=lambda p: -p['war'])
    if not group:
        continue
    print(f"\n  {label}:")
    for p in group:
        mlb_tag = "MLB" if p['mlb'] else "---"
        print(f"    {p['name']:<28} WAR={p['war']:>6.1f} {mlb_tag} | POT={p['pot']:.1f}* | "
              f"Rd{p['draft_round']:>2}/Pk{p['draft_pick']:>2} ({p['draft_year']}) | "
              f"{p['type']:>7} | age={p['age']}")

# Also show double-H at 2.5* for more examples
print(f"\n  2.5* Double-H (2 of WE/INT/AD = H):")
dh_25 = sorted([p for p in pool if p['pot'] is not None and 2.0 <= p['pot'] <= 3.0
                 and is_double_h(p) and not is_triple_h(p)],
                key=lambda p: -p['war'])
for p in dh_25[:20]:
    h_traits = []
    if p['we']=='H': h_traits.append('WE')
    if p['int']=='H': h_traits.append('INT')
    if p['ad']=='H': h_traits.append('AD')
    mlb_tag = "MLB" if p['mlb'] else "---"
    print(f"    {p['name']:<28} WAR={p['war']:>6.1f} {mlb_tag} | POT={p['pot']:.1f}* | "
          f"H={'+'.join(h_traits):<8} | Rd{p['draft_round']:>2}/Pk{p['draft_pick']:>2} ({p['draft_year']}) | "
          f"{p['type']:>7}")


# ═══════════════════════════════════════════════════════════
# DRAFT VALUE: Where do triple-H players get drafted?
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 120)
print("WHERE DO HIGH-PERSONALITY PLAYERS GET DRAFTED?")
print("=" * 120)
print("(Are they going undiscovered in later rounds?)\n")

for label, fn in [
    ("Triple H (WE+INT+AD)", is_triple_h),
    ("H WE (any INT/AD)", is_h_we),
    ("All Normal", is_all_normal),
    ("Any Low trait", is_any_low),
]:
    group = [p for p in pool if fn(p) and p['drafted']]
    if not group:
        continue
    by_round = defaultdict(int)
    for p in group:
        if p['draft_round'] <= 3: by_round['Rd 1-3'] += 1
        elif p['draft_round'] <= 6: by_round['Rd 4-6'] += 1
        else: by_round['Rd 7+'] += 1
    total = len(group)
    rd13 = by_round.get('Rd 1-3', 0)
    rd46 = by_round.get('Rd 4-6', 0)
    rd7p = by_round.get('Rd 7+', 0)
    print(f"  {label:<28}: n={total:>3}, Rd1-3={100*rd13/total:>3.0f}%, Rd4-6={100*rd46/total:>3.0f}%, Rd7+={100*rd7p/total:>3.0f}%")


print("\n\nDone!")
