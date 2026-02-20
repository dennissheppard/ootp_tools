import type { Contract } from '../services/ContractService';

export type PlayerCategory = 'mlb' | 'minors' | 'draftee' | 'freeAgent';

const MINOR_LEVELS = new Set(['AAA', 'AA', 'A', 'R', 'INT']);

/**
 * Classify a player into a category based on their scouting lev + hsc fields.
 * - MLB: lev === 'MLB'
 * - Minor Leaguer: lev in AAA/AA/A/R/INT
 * - Future Draftee: lev === '-' AND hsc has a real value
 * - Free Agent: everything else (lev === '-' with no hsc, or unknown)
 */
export function classifyPlayer(lev?: string, hsc?: string): PlayerCategory {
  if (!lev) return 'freeAgent'; // No lev column → fallback
  if (lev === 'MLB') return 'mlb';
  if (MINOR_LEVELS.has(lev)) return 'minors';
  if (lev === '-') {
    if (hsc && hsc !== '-' && hsc.trim() !== '') return 'draftee';
    return 'freeAgent';
  }
  return 'freeAgent';
}

/**
 * Map a contract leagueId to its corresponding level string.
 * Returns null for unknown leagueIds.
 */
export function leagueIdToLev(leagueId: number): string | null {
  switch (leagueId) {
    case 200: return 'MLB';
    case 201: return 'AAA';
    case 202: return 'AA';
    case 203: return 'A';
    case 204: return 'R';
    case -200: return 'INT';
    default: return null;
  }
}

/**
 * Build an updated level map from contracts for players whose scouting data
 * may be stale (game date > scouting file date).
 * Skips draftees (players with an hsc value) since they aren't signed yet.
 * Players with leagueId === 0 and no hsc → Free Agent (lev = '-').
 */
export function buildFreshnessUpdatedLevels(
  scoutingMap: Map<number, { lev?: string; hsc?: string }>,
  contracts: Map<number, Contract>,
): Map<number, string> {
  const updatedLevels = new Map<number, string>();

  for (const [playerId, scouting] of scoutingMap) {
    // Skip draftees — they won't have contracts
    if (scouting.hsc && scouting.hsc !== '-' && scouting.hsc.trim() !== '') {
      continue;
    }

    const contract = contracts.get(playerId);
    if (contract) {
      const newLev = leagueIdToLev(contract.leagueId);
      if (newLev) {
        updatedLevels.set(playerId, newLev);
      }
      // leagueId === 0 with no contract mapping → leave as-is (free agent)
    }
  }

  return updatedLevels;
}
