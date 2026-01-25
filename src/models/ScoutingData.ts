export interface PitcherScoutingRatings {
  playerId: number;
  playerName?: string;
  stuff: number;
  control: number;
  hra: number;
  age?: number;
  /** Overall star rating (0.5-5.0 scale) */
  ovr?: number;
  /** Potential star rating (0.5-5.0 scale) */
  pot?: number;
  pitches?: Record<string, number>;
  source?: 'my' | 'osa';
}
