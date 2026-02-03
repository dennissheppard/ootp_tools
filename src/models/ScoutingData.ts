export interface PitcherScoutingRatings {
  playerId: number;
  playerName?: string;
  stuff: number;
  control: number;
  hra: number;
  stamina?: number;
  injuryProneness?: string;
  age?: number;
  /** Overall star rating (0.5-5.0 scale) */
  ovr?: number;
  /** Potential star rating (0.5-5.0 scale) */
  pot?: number;
  pitches?: Record<string, number>;
  source?: 'my' | 'osa';
}

export interface HitterScoutingRatings {
  playerId: number;
  playerName?: string;
  /** Power rating (20-80): correlates with HR, ISO */
  power: number;
  /** Eye rating (20-80): correlates with BB% */
  eye: number;
  /** Avoid K rating (20-80): inverse correlation with K% */
  avoidK: number;
  /** Contact rating (20-80): correlates with batting average (~60% HT + ~40% AvK) */
  contact: number;
  /** Gap power rating (20-80): correlates with doubles */
  gap: number;
  /** Speed rating (20-200): correlates with triples, SB */
  speed: number;
  /** Injury proneness: Durable, Wary, Normal, Fragile, Prone */
  injuryProneness?: string;
  age?: number;
  /** Overall star rating (0.5-5.0 scale) */
  ovr: number;
  /** Potential star rating (0.5-5.0 scale) */
  pot: number;
  source?: 'my' | 'osa';
}
