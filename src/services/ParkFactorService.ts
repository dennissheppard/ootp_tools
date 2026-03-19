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
      // parts[1] = team_name, parts[2] = park_id, parts[3] = park_name
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
