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
