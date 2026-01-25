export interface PitcherScoutingRatings {
  playerId: number;
  playerName?: string;
  stuff: number;
  control: number;
  hra: number;
  age?: number;
  pitches?: Record<string, number>;
  source?: 'my' | 'osa';
}
