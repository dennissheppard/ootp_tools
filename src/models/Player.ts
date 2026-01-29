export interface Player {
  id: number;
  firstName: string;
  lastName: string;
  teamId: number;
  parentTeamId: number;
  level: number;
  position: Position;
  role: number;
  age: number;
  retired: boolean;
}

export enum Position {
  Pitcher = 1,
  Catcher = 2,
  FirstBase = 3,
  SecondBase = 4,
  ThirdBase = 5,
  Shortstop = 6,
  LeftField = 7,
  CenterField = 8,
  RightField = 9,
  DesignatedHitter = 10,
}

export const PositionLabels: Record<Position, string> = {
  [Position.Pitcher]: 'P',
  [Position.Catcher]: 'C',
  [Position.FirstBase]: '1B',
  [Position.SecondBase]: '2B',
  [Position.ThirdBase]: '3B',
  [Position.Shortstop]: 'SS',
  [Position.LeftField]: 'LF',
  [Position.CenterField]: 'CF',
  [Position.RightField]: 'RF',
  [Position.DesignatedHitter]: 'DH',
};

export function getPositionLabel(position: Position): string {
  return PositionLabels[position] || 'Unknown';
}

export function isPitcher(player: Player): boolean {
  return player.position === Position.Pitcher;
}

export function getFullName(player: Player): string {
  return `${player.firstName} ${player.lastName}`;
}

/**
 * Pitcher role types
 */
export type PitcherRole = 'SP' | 'SW' | 'RP';

/**
 * Input for determining pitcher role from scouting data
 */
export interface PitcherRoleInput {
  /** Pitch ratings (20-80 scale) for available pitches */
  pitchRatings?: Record<string, number>;
  /** Stamina rating (20-80 scale) */
  stamina?: number;
  /** Number of usable pitches (25+ rating) */
  pitchCount?: number;
  /** Player role from OOTP (11 = SP, etc.) */
  ootpRole?: number;
  /** Games started (for stats-based fallback) */
  gamesStarted?: number;
  /** Total innings pitched (for stats-based fallback) */
  inningsPitched?: number;
}

/**
 * Determine pitcher role (SP/SW/RP) based on pitches, stamina, and ratings
 *
 * Logic:
 * - 4+ pitches → SP (unless stamina < 35, then SW)
 * - 2 pitches, stamina < 50 → RP
 * - 2 pitches, stamina >= 50 → SW
 * - 3 pitches, stamina < 35 → SW
 * - 3 pitches, stamina >= 35, 3rd best pitch >= 35 → SP
 * - 3 pitches, stamina >= 35, 3rd best pitch < 35 → SW
 *
 * Falls back to stats-based determination if scouting data unavailable.
 */
export function determinePitcherRole(input: PitcherRoleInput): PitcherRole {
  const stamina = input.stamina ?? 0;

  // Get pitch count - prefer explicit count, else count pitches >= 25
  let pitchCount = input.pitchCount;
  if (pitchCount === undefined && input.pitchRatings) {
    pitchCount = Object.values(input.pitchRatings).filter(rating => rating >= 25).length;
  }

  // If we have pitch count and stamina, use attribute-based logic
  if (pitchCount !== undefined && input.stamina !== undefined) {
    // 4+ pitches
    if (pitchCount >= 4) {
      return stamina < 35 ? 'SW' : 'SP';
    }

    // 2 pitches
    if (pitchCount === 2) {
      return stamina < 50 ? 'RP' : 'SW';
    }

    // 3 pitches
    if (pitchCount === 3 && input.pitchRatings) {
      if (stamina < 35) {
        return 'SW';
      }
      // Get 3rd best pitch (worst of the 3)
      const pitchValues = Object.values(input.pitchRatings)
        .filter(rating => rating >= 25)
        .sort((a, b) => b - a); // Sort descending
      const thirdBestPitch = pitchValues[2] ?? 0;
      return thirdBestPitch >= 35 ? 'SP' : 'SW';
    }

    // 1 pitch or unknown
    if (pitchCount <= 1) {
      return 'RP';
    }
  }

  // Fallback: Check OOTP role
  if (input.ootpRole === 11) {
    return 'SP';
  }

  // Fallback: Stats-based determination
  if (input.gamesStarted !== undefined && input.inningsPitched !== undefined) {
    if (input.gamesStarted >= 5 || input.inningsPitched >= 100) {
      return 'SP';
    }
    if (input.inningsPitched >= 70) {
      return 'SW';
    }
  }

  // Final fallback: If stamina is high, assume starter/swingman
  if (stamina >= 50) return 'SP';
  if (stamina >= 35) return 'SW';

  return 'RP';
}
