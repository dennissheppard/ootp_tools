/**
 * LineupConstructionService
 *
 * Extracted from TeamRatingsService — provides reusable lineup construction
 * and roster-aware PA redistribution for batter projections.
 */

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface LineupCandidate {
  playerId: number;
  position: number;
  positionLabel?: string;
}

/** Minimal projection shape needed for PA redistribution */
export interface ProjectionForRedist {
  playerId: number;
  position: number;
  positionLabel?: string;
  projectedStats: {
    pa: number;
    war: number;
    woba: number;
    hr: number;
    rbi: number;
    sb: number;
    defRuns?: number;
    posAdj?: number;
  };
}

export interface LineupResult<T> {
  lineup: T[];
  bench: T[];
}

// ──────────────────────────────────────────────
// Position slots and flexibility rules
// ──────────────────────────────────────────────

const POSITION_SLOTS = [
  { label: 'C',  position: 2, canPlay: [2] },
  { label: '1B', position: 3, canPlay: [3, 6] },
  { label: '2B', position: 4, canPlay: [4, 6] },
  { label: 'SS', position: 6, canPlay: [6] },
  { label: '3B', position: 5, canPlay: [5, 6] },
  { label: 'LF', position: 7, canPlay: [7, 8, 9] },
  { label: 'CF', position: 8, canPlay: [8] },
  { label: 'RF', position: 9, canPlay: [9, 7, 8] },
];

// ──────────────────────────────────────────────
// Lineup Construction (greedy scarcity-based)
// ──────────────────────────────────────────────

/**
 * Construct optimal 9-player lineup with position flexibility.
 * Uses scarcity-based assignment: fill most constrained positions first.
 *
 * Position flexibility rules:
 * - SS can play 1B, 2B, 3B, SS
 * - CF can play LF, CF, RF
 * - LF can play LF, RF
 * - RF can play LF, RF
 * - All other positions: natural position only
 *
 * @returns lineup (8 fielders + DH) and bench (remaining players)
 */
export function constructOptimalLineup<T extends LineupCandidate>(
  batters: T[],
  getValue: (b: T) => number = () => 0,
): LineupResult<T> {
  const lineup: T[] = [];
  const used = new Set<number>();
  const sorted = [...batters].sort((a, b) => getValue(b) - getValue(a));

  const remainingSlots = [...POSITION_SLOTS];

  while (remainingSlots.length > 0) {
    // Count eligible players for each remaining slot
    const slotScarcity = remainingSlots.map(slot => {
      const eligibleCount = sorted.filter(b =>
        !used.has(b.playerId) && slot.canPlay.includes(b.position)
      ).length;
      return { slot, eligibleCount };
    });

    // Sort by scarcity (fewest eligible players first)
    slotScarcity.sort((a, b) => a.eligibleCount - b.eligibleCount);

    const { slot } = slotScarcity[0];
    let filled = false;

    for (const batter of sorted) {
      if (used.has(batter.playerId)) continue;
      if (slot.canPlay.includes(batter.position)) {
        lineup.push({
          ...batter,
          position: slot.position,
          positionLabel: slot.label,
        });
        used.add(batter.playerId);
        filled = true;
        break;
      }
    }

    // Remove this slot from remaining
    const slotIndex = remainingSlots.findIndex(s => s.label === slot.label);
    remainingSlots.splice(slotIndex, 1);

    // If not filled with eligible player, try fallback with best available
    if (!filled) {
      for (const batter of sorted) {
        if (used.has(batter.playerId)) continue;
        lineup.push({
          ...batter,
          position: slot.position,
          positionLabel: slot.label,
        });
        used.add(batter.playerId);
        break;
      }
    }
  }

  // Assign best remaining player to DH
  for (const batter of sorted) {
    if (used.has(batter.playerId)) continue;
    lineup.push({ ...batter, position: 10, positionLabel: 'DH' });
    used.add(batter.playerId);
    break;
  }

  // Bench = everyone not in the lineup
  const bench = sorted.filter(b => !used.has(b.playerId));

  return { lineup, bench };
}

// ──────────────────────────────────────────────
// Roster-Aware PA Redistribution
// ──────────────────────────────────────────────

const CATCHER_MAX_PA = 550;
const CATCHER_BACKUP_MIN_PA = 130;
const PLAYER_MIN_PA = 50;

export interface RedistributeOptions {
  /** Recalculate WAR from adjusted PA. Requires leagueAvg context. */
  recalcWar?: (woba: number, pa: number, sbRuns: number, defRuns: number, posAdj: number) => number;
}

/**
 * Redistribute PA within position groups on a single team's roster.
 * Better players (by wOBA rate) get more playing time at each position.
 *
 * Mutates `projectedStats.pa`, `projectedStats.war`, and counting stats in place.
 *
 * @param lineup - Starters from constructOptimalLineup (with assigned positions)
 * @param bench - Bench players
 * @param opts - Optional WAR recalculation callback
 */
export function redistributeTeamPA<T extends ProjectionForRedist>(
  lineup: T[],
  bench: T[],
  opts?: RedistributeOptions,
): void {
  const all = [...lineup, ...bench];
  if (all.length === 0) return;

  // Original total PA for this team (preserve aggregate)
  const originalTotalPa = all.reduce((sum, p) => sum + p.projectedStats.pa, 0);

  // Group by assigned position label
  const groups = new Map<string, T[]>();
  for (const p of lineup) {
    const key = p.positionLabel ?? 'DH';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  // Bench players: find which position group they'd compete in
  for (const b of bench) {
    // Try to match an existing position group by the bench player's natural position
    let assigned = false;
    for (const [label, members] of groups) {
      const slot = POSITION_SLOTS.find(s => s.label === label);
      if (slot && slot.canPlay.includes(b.position)) {
        members.push(b);
        assigned = true;
        break;
      }
    }
    // If no match (e.g. extra utility player), assign to DH group
    if (!assigned) {
      if (!groups.has('DH')) groups.set('DH', []);
      groups.get('DH')!.push(b);
    }
  }

  // Redistribute within each position group
  for (const [label, members] of groups) {
    if (members.length <= 1) continue; // solo position, no redistribution needed

    const groupBudget = members.reduce((sum, p) => sum + p.projectedStats.pa, 0);
    if (groupBudget <= 0) continue;

    // Sort by wOBA descending (best player first)
    members.sort((a, b) => b.projectedStats.woba - a.projectedStats.woba);

    // Compute quality-weighted PA shares
    const totalWoba = members.reduce((sum, p) => sum + Math.max(0.200, p.projectedStats.woba), 0);
    const rawShares = members.map(p => Math.max(0.200, p.projectedStats.woba) / totalWoba);

    // Ensure starter (index 0) gets at least 60% of the group budget
    if (rawShares[0] < 0.60) {
      const deficit = 0.60 - rawShares[0];
      rawShares[0] = 0.60;
      // Proportionally reduce others
      const othersTotal = rawShares.slice(1).reduce((s, v) => s + v, 0);
      if (othersTotal > 0) {
        for (let i = 1; i < rawShares.length; i++) {
          rawShares[i] -= deficit * (rawShares[i] / othersTotal);
        }
      }
    }

    // Compute new PAs from shares
    let newPas = rawShares.map(share => Math.round(groupBudget * share));

    // Apply catcher cap
    if (label === 'C' && newPas.length >= 2) {
      if (newPas[0] > CATCHER_MAX_PA) {
        const excess = newPas[0] - CATCHER_MAX_PA;
        newPas[0] = CATCHER_MAX_PA;
        newPas[1] += excess; // give excess to backup
      }
      if (newPas[1] < CATCHER_BACKUP_MIN_PA && groupBudget >= CATCHER_BACKUP_MIN_PA + PLAYER_MIN_PA) {
        const needed = CATCHER_BACKUP_MIN_PA - newPas[1];
        newPas[1] = CATCHER_BACKUP_MIN_PA;
        newPas[0] -= needed;
      }
    }

    // Apply floor
    for (let i = 0; i < newPas.length; i++) {
      if (newPas[i] < PLAYER_MIN_PA) newPas[i] = PLAYER_MIN_PA;
    }

    // Normalize to preserve group budget exactly
    const paSum = newPas.reduce((s, v) => s + v, 0);
    if (paSum !== groupBudget && paSum > 0) {
      const scale = groupBudget / paSum;
      newPas = newPas.map(pa => Math.round(pa * scale));
      // Fix rounding drift on the starter
      const drift = groupBudget - newPas.reduce((s, v) => s + v, 0);
      newPas[0] += drift;
    }

    // Apply new PAs and rescale counting stats
    for (let i = 0; i < members.length; i++) {
      const p = members[i];
      const oldPa = p.projectedStats.pa;
      const newPa = newPas[i];
      if (oldPa === newPa || oldPa <= 0) continue;

      const ratio = newPa / oldPa;
      p.projectedStats.pa = newPa;
      p.projectedStats.hr = Math.round(p.projectedStats.hr * ratio);
      p.projectedStats.rbi = Math.round(p.projectedStats.rbi * ratio);
      p.projectedStats.sb = Math.round(p.projectedStats.sb * ratio);

      // Reprorate defensive value
      const defRuns = (p.projectedStats.defRuns ?? 0) * ratio;
      const posAdj = (p.projectedStats.posAdj ?? 0) * ratio;
      p.projectedStats.defRuns = Math.round(defRuns * 10) / 10;
      p.projectedStats.posAdj = Math.round(posAdj * 10) / 10;

      // Recalculate WAR if callback provided
      if (opts?.recalcWar) {
        const sbRuns = p.projectedStats.sb * 0.2; // approximate
        p.projectedStats.war = opts.recalcWar(
          p.projectedStats.woba, newPa, sbRuns, defRuns, posAdj
        );
      } else {
        // Simple proportional scaling as fallback
        p.projectedStats.war = Math.round(p.projectedStats.war * ratio * 10) / 10;
      }
    }
  }

  // Scale team total to preserve original aggregate PA
  const newTotalPa = all.reduce((sum, p) => sum + p.projectedStats.pa, 0);
  if (newTotalPa > 0 && Math.abs(newTotalPa - originalTotalPa) > 5) {
    const teamScale = originalTotalPa / newTotalPa;
    for (const p of all) {
      const oldPa = p.projectedStats.pa;
      const scaledPa = Math.round(oldPa * teamScale);
      if (scaledPa !== oldPa && oldPa > 0) {
        const ratio = scaledPa / oldPa;
        p.projectedStats.pa = scaledPa;
        p.projectedStats.hr = Math.round(p.projectedStats.hr * ratio);
        p.projectedStats.rbi = Math.round(p.projectedStats.rbi * ratio);
        p.projectedStats.sb = Math.round(p.projectedStats.sb * ratio);
        p.projectedStats.war = Math.round(p.projectedStats.war * ratio * 10) / 10;
      }
    }
  }
}
