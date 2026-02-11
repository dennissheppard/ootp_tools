"""
WBL Draft Pick Value Curve
Scrapes draft logs from StatsPlus (which include career WAR in the HTML).
Builds pick-by-pick value curve for 2008-2020 draft classes.
"""
import re
import urllib.request
from collections import defaultdict

DRAFT_URL = "https://atl-01.statsplus.net/world/draftyear/?year={}"


def sf(val, d=0.0):
    try: return float(val)
    except: return d

def si(val, d=0):
    try: return int(val)
    except: return d


def scrape_draft_year(year):
    """Scrape draft page. Returns list of dicts with round, pick, oa_pick, name, pid, war."""
    url = DRAFT_URL.format(year)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  ERROR fetching {year}: {e}")
        return []

    picks = []
    # HTML structure per row:
    # <tr>
    #   <td>round</td><td>pick</td><td>oa_pick</td><td>team</td><td>pos</td>
    #   <td><a href='/world/player/PID' ...>Name</a></td>
    #   <td>age</td><td>bat_war</td><td>pitch_war</td><td>total_war</td>
    # </tr>

    row_re = re.compile(r'<tr>\s*(.*?)\s*</tr>', re.DOTALL)
    td_re = re.compile(r'<td[^>]*>(.*?)</td>', re.DOTALL)
    player_re = re.compile(r"href='[^']*?/player/(\d+)'[^>]*>([^<]+)</a>")

    for row_match in row_re.finditer(html):
        row_html = row_match.group(1)
        # Must contain a player link
        pm = player_re.search(row_html)
        if not pm:
            continue

        pid = int(pm.group(1))
        name = pm.group(2).strip()

        # Extract all td contents
        tds = td_re.findall(row_html)
        if len(tds) < 10:
            continue

        rd = si(tds[0])
        pk = si(tds[1])
        oa = si(tds[2])
        team = re.sub(r'<[^>]+>', '', tds[3]).strip()
        pos = re.sub(r'<[^>]+>', '', tds[4]).strip()
        # tds[5] = player link (already parsed)
        age = si(tds[6])
        bat_war = sf(tds[7])
        pitch_war = sf(tds[8])
        total_war = sf(tds[9])

        if rd > 0 and oa > 0:
            picks.append({
                'year': year,
                'round': rd,
                'pick': pk,
                'oa_pick': oa,
                'player_id': pid,
                'name': name,
                'team': team,
                'pos': pos,
                'age': age,
                'bat_war': bat_war,
                'pitch_war': pitch_war,
                'war': total_war,
                'years_data': 2021 - year,
            })

    return picks


# ═══════════════════════════════════════════════════════════
# Scrape all years
# ═══════════════════════════════════════════════════════════
print("Scraping draft logs from StatsPlus (with career WAR)...")

all_picks = []
for year in range(2008, 2021):
    picks = scrape_draft_year(year)
    all_picks.extend(picks)
    mlb = sum(1 for p in picks if p['war'] != 0)
    if picks:
        print(f"  {year}: {len(picks):>3} picks, {mlb:>3} with WAR, "
              f"avg WAR={sum(p['war'] for p in picks)/len(picks):.1f}")
    else:
        print(f"  {year}: FAILED")

print(f"\nTotal: {len(all_picks)} draft picks across {len(set(p['year'] for p in all_picks))} years")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 1: Pick-by-pick value (mature classes only)
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("PICK-BY-PICK VALUE CURVE (classes with 5+ years of data)")
print("=" * 90)

mature = [p for p in all_picks if p['years_data'] >= 5]
years_used = sorted(set(p['year'] for p in mature))
print(f"Years: {years_used} ({len(mature)} total picks)")

# Individual picks 1-30
print(f"\n--- Overall Picks 1-30 (individual) ---")
for oa in range(1, 31):
    group = [p for p in mature if p['oa_pick'] == oa]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    med = sorted(wars)[len(wars) // 2]
    mlb = sum(1 for w in wars if w > 0)
    best = max(group, key=lambda p: p['war'])
    bar = "#" * max(0, int(avg / 2))
    print(f"  #{oa:>3}: n={len(group):>2}, avg={avg:>6.1f}, med={med:>5.1f}, "
          f"MLB={100*mlb/len(group):>3.0f}% | "
          f"best: {best['name'][:20]} ({best['war']:.0f}) {bar}")

# 5-pick groups
print(f"\n--- 5-Pick Groups (mature classes) ---")
for start in range(1, 251, 5):
    end = start + 4
    group = [p for p in mature if start <= p['oa_pick'] <= end]
    if len(group) < 3:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for w in wars if w > 0)
    top5 = sum(1 for w in wars if w >= 5)
    top15 = sum(1 for w in wars if w >= 15)
    bar = "#" * max(0, int(avg / 1.5))
    print(f"  #{start:>3}-{end:>3}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
          f"MLB={100*mlb/len(group):>3.0f}%, >=5={100*top5/len(group):>3.0f}%, "
          f">=15={100*top15/len(group):>3.0f}% {bar}")

# By round
print(f"\n--- By Round (mature classes) ---")
for rd in range(1, 16):
    group = [p for p in mature if p['round'] == rd]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for w in wars if w > 0)
    top5 = sum(1 for w in wars if w >= 5)
    top15 = sum(1 for w in wars if w >= 15)
    print(f"  Rd {rd:>2}: n={len(group):>3}, avg WAR={avg:>6.1f}, "
          f"MLB={100*mlb/len(group):>3.0f}%, WAR>=5={top5:>3}, WAR>=15={top15:>3}")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 2: All classes with WAR/year normalization
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("WAR/YEAR NORMALIZED (all classes, 2+ years data)")
print("=" * 90)

recent = [p for p in all_picks if p['years_data'] >= 2]

print(f"\n--- WAR/Year by Round ---")
for rd in range(1, 13):
    group = [p for p in recent if p['round'] == rd]
    if not group:
        continue
    wpy = [p['war'] / max(p['years_data'], 1) for p in group]
    avg_wpy = sum(wpy) / len(wpy)
    avg_war = sum(p['war'] for p in group) / len(group)
    mlb = sum(1 for p in group if p['war'] > 0)
    print(f"  Rd {rd:>2}: n={len(group):>3}, avg WAR/yr={avg_wpy:>5.2f}, "
          f"avg total WAR={avg_war:>6.1f}, MLB={100*mlb/len(group):>3.0f}%")

print(f"\n--- WAR/Year by 5-Pick Group (top 60) ---")
for start in range(1, 61, 5):
    end = start + 4
    group = [p for p in recent if start <= p['oa_pick'] <= end]
    if len(group) < 3:
        continue
    wpy = [p['war'] / max(p['years_data'], 1) for p in group]
    avg_wpy = sum(wpy) / len(wpy)
    mlb = sum(1 for p in group if p['war'] > 0)
    print(f"  #{start:>3}-{end:>3}: n={len(group):>3}, avg WAR/yr={avg_wpy:>5.2f}, "
          f"MLB={100*mlb/len(group):>3.0f}%")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 3: Class-by-class summary
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("DRAFT CLASS SUMMARY")
print("=" * 90)

for yr in range(2008, 2021):
    group = [p for p in all_picks if p['year'] == yr]
    if not group:
        continue
    wars = [p['war'] for p in group]
    avg = sum(wars) / len(wars)
    mlb = sum(1 for w in wars if w > 0)
    top5 = sum(1 for w in wars if w >= 5)
    best = max(group, key=lambda p: p['war'])
    print(f"  {yr} ({2021-yr:>2}yr): n={len(group):>3}, avg={avg:>5.1f}, "
          f"MLB={mlb:>3} ({100*mlb/len(group):>3.0f}%), WAR>=5={top5:>2} | "
          f"Best: {best['name'][:25]} ({best['war']:.1f})")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 4: Top performers
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("TOP 30 CAREER WAR (all draftees 2008-2020)")
print("=" * 90)

top = sorted(all_picks, key=lambda p: -p['war'])[:30]
for i, p in enumerate(top):
    print(f"  {i+1:>2}. {p['name']:<30} WAR={p['war']:>6.1f} | "
          f"OA#{p['oa_pick']:>3} Rd{p['round']:>2}/Pk{p['pick']:>2} | {p['year']} | {p['team']}")


# ═══════════════════════════════════════════════════════════
# ANALYSIS 5: Value dropoff points
# ═══════════════════════════════════════════════════════════
print("\n" + "=" * 90)
print("VALUE DROPOFF ANALYSIS (mature classes)")
print("=" * 90)

# Find where expected WAR drops below key thresholds
print("\n--- Where does expected WAR drop below thresholds? ---")
for threshold_label, threshold in [("5.0 WAR", 5.0), ("2.0 WAR", 2.0), ("1.0 WAR", 1.0), ("0.0 WAR (replacement)", 0.0)]:
    for oa in range(1, 300):
        group = [p for p in mature if p['oa_pick'] == oa]
        if len(group) < 2:
            continue
        avg = sum(p['war'] for p in group) / len(group)
        if avg < threshold:
            print(f"  Avg WAR drops below {threshold_label} at OA pick #{oa} (~Rd {(oa-1)//18 + 1})")
            break

# MLB rate dropoff
print("\n--- Where does MLB rate drop below 50%? ---")
for oa_start in range(1, 250, 5):
    group = [p for p in mature if oa_start <= p['oa_pick'] <= oa_start + 4]
    if len(group) < 3:
        continue
    mlb_pct = 100 * sum(1 for p in group if p['war'] > 0) / len(group)
    if mlb_pct < 50:
        print(f"  MLB rate drops below 50% around OA pick #{oa_start} (~Rd {(oa_start-1)//18 + 1})")
        break


print("\n\nDone!")
