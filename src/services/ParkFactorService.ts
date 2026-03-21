/**
 * ParkFactorService
 *
 * Loads park factors from CSV/precomputed cache and computes
 * effective (half home / half away) factors per player based on
 * their team and batting hand.
 *
 * ZiPS model: effective_factor = (raw_park_factor + 1.0) / 2.0
 * This accounts for playing half games at home, half on the road (neutral = 1.0).
 *
 * Handedness:
 * - L: use avg_l, hr_l
 * - R: use avg_r, hr_r
 * - S (switch): 75% L-handed splits, 25% R-handed splits
 * - 2B/3B: no handedness split (use d, t)
 */

export interface ParkFactorRow {
  team_id: number;
  park_name: string;
  avg: number;
  avg_l: number;
  avg_r: number;
  hr: number;
  hr_l: number;
  hr_r: number;
  d: number;
  t: number;
}

export interface EffectiveParkFactors {
  avg: number;
  hr: number;
  d: number;
  t: number;
}

/**
 * Compute effective park factors for a batter.
 * @param park - Raw park factor row for the player's home team
 * @param bats - 'L', 'R', or 'S' (switch)
 * @returns Effective factors (half home / half away)
 */
export function computeEffectiveParkFactors(
  park: ParkFactorRow,
  bats: string,
): EffectiveParkFactors {
  let rawAvg: number;
  let rawHr: number;

  switch (bats) {
    case 'L':
      rawAvg = park.avg_l;
      rawHr = park.hr_l;
      break;
    case 'R':
      rawAvg = park.avg_r;
      rawHr = park.hr_r;
      break;
    case 'S':
      // Switch hitters: 75% of PAs as lefty, 25% as righty
      rawAvg = park.avg_l * 0.75 + park.avg_r * 0.25;
      rawHr = park.hr_l * 0.75 + park.hr_r * 0.25;
      break;
    default:
      rawAvg = park.avg;
      rawHr = park.hr;
  }

  // Half home / half away: effective = (raw + 1.0) / 2.0
  return {
    avg: (rawAvg + 1.0) / 2.0,
    hr: (rawHr + 1.0) / 2.0,
    d: (park.d + 1.0) / 2.0,
    t: (park.t + 1.0) / 2.0,
  };
}

/**
 * Compute effective park HR factor for a pitcher.
 * Pitchers face ~75% RHB, 25% LHB, so their effective HR factor
 * is a weighted blend of the park's RH and LH batter HR factors.
 * Then half home / half away.
 */
export function computePitcherParkHrFactor(park: ParkFactorRow): number {
  const rawHr = park.hr_r * 0.75 + park.hr_l * 0.25;
  return (rawHr + 1.0) / 2.0;
}

/**
 * Parse park_factors.csv content into a Map keyed by team_id.
 */
export function parseParkFactorsCsv(csvText: string): Map<number, ParkFactorRow> {
  const map = new Map<number, ParkFactorRow>();
  const lines = csvText.trim().split(/\r?\n/);
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 12) continue;
    const teamId = parseInt(parts[0], 10);
    if (!teamId) continue;
    map.set(teamId, {
      team_id: teamId,
      park_name: parts[3] ?? '',
      avg: parseFloat(parts[4]),
      avg_l: parseFloat(parts[5]),
      avg_r: parseFloat(parts[6]),
      hr: parseFloat(parts[7]),
      hr_l: parseFloat(parts[8]),
      hr_r: parseFloat(parts[9]),
      d: parseFloat(parts[10]),
      t: parseFloat(parts[11]),
    });
  }
  return map;
}

/**
 * Ensure a ParkFactorRow has park_name populated.
 * Precomputed cache rows may lack park_name if synced before the field was added.
 * This lazily loads the CSV to fill in missing names.
 */
let _parkNameCache: Map<number, string> | null = null;
let _parkNamePromise: Promise<Map<number, string>> | null = null;

async function loadParkNames(): Promise<Map<number, string>> {
  if (_parkNameCache) return _parkNameCache;
  if (_parkNamePromise) return _parkNamePromise;
  _parkNamePromise = (async () => {
    const map = new Map<number, string>();
    try {
      const resp = await fetch('/data/park_factors.csv');
      if (resp.ok) {
        const text = await resp.text();
        const lines = text.trim().split(/\r?\n/);
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',');
          if (parts.length >= 4) {
            map.set(parseInt(parts[0], 10), parts[3] ?? '');
          }
        }
      }
    } catch { /* ignore */ }
    _parkNameCache = map;
    return map;
  })();
  return _parkNamePromise;
}

export async function ensureParkName(pf: ParkFactorRow): Promise<void> {
  if (pf.park_name) return;
  const names = await loadParkNames();
  pf.park_name = names.get(pf.team_id) ?? '';
}

/**
 * Format a park factor value as a percentage deviation from neutral (1.0).
 * e.g. 1.05 → "+5%", 0.97 → "-3%", 1.0 → "0%"
 */
export function formatParkFactor(value: number): string {
  const pct = Math.round((value - 1.0) * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

/**
 * Get a human-readable character label and CSS class for a park
 * based on its overall HR factor.
 */
export function getParkCharacterLabel(park: ParkFactorRow): { label: string; class: string } {
  if (park.hr >= 1.05) return { label: 'Hitter-friendly', class: 'pf-hitter-friendly' };
  if (park.hr <= 0.95) return { label: 'Pitcher-friendly', class: 'pf-pitcher-friendly' };
  return { label: 'Neutral', class: 'pf-neutral' };
}

// ============================================================================
// Park Dimensions (from parks.csv)
// ============================================================================

export interface ParkDimensions {
  distances: number[];  // 7 fence distances: LF pole → CF → RF pole
  wallHeights: number[];  // 7 wall heights corresponding to distances
  name: string;
  capacity: number;
  turf: number;  // 0 = grass, 1 = turf
  foulGround: number;  // 0 = normal, 1 = large, etc.
}

/**
 * Parse parks.csv into a Map keyed by park_id.
 * Columns: park_id, distances0-6, wall_heights0-6, name, picture, picture_night, nation_id, capacity, type, foul_ground, turf
 */
export function parseParksCsv(csvText: string): Map<number, ParkDimensions> {
  const map = new Map<number, ParkDimensions>();
  const lines = csvText.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 22) continue;
    const parkId = parseInt(parts[0], 10);
    if (!parkId) continue;
    map.set(parkId, {
      distances: [
        parseInt(parts[1], 10), parseInt(parts[2], 10), parseInt(parts[3], 10),
        parseInt(parts[4], 10), parseInt(parts[5], 10), parseInt(parts[6], 10),
        parseInt(parts[7], 10),
      ],
      wallHeights: [
        parseInt(parts[8], 10), parseInt(parts[9], 10), parseInt(parts[10], 10),
        parseInt(parts[11], 10), parseInt(parts[12], 10), parseInt(parts[13], 10),
        parseInt(parts[14], 10),
      ],
      name: parts[15] ?? '',
      capacity: parseInt(parts[19], 10) || 0,
      foulGround: parseInt(parts[21], 10) || 0,
      turf: parseInt(parts[22], 10) || 0,
    });
  }
  return map;
}
