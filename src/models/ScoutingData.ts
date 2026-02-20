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
  /** Personality traits (H = high, N = neutral, L = low) */
  leadership?: 'H' | 'N' | 'L';
  loyalty?: 'H' | 'N' | 'L';
  adaptability?: 'H' | 'N' | 'L';
  greed?: 'H' | 'N' | 'L';
  workEthic?: 'H' | 'N' | 'L';
  intelligence?: 'H' | 'N' | 'L';
  /** Pitcher type: Ex FB, FB, Neu, GB, Ex GB */
  pitcherType?: string;
  /** Pitcher BABIP tendency */
  babip?: string;
  /** Player level: 'MLB' | 'AAA' | 'AA' | 'A' | 'R' | 'INT' | '-' */
  lev?: string;
  /** High School/College status: 'HS Senior' | 'CO Junior' | etc. | '-' */
  hsc?: string;
  /** Date of birth string from CSV (e.g. '02/26/2001') */
  dob?: string;
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
  /** Speed rating (20-80): correlates with triples, SB */
  speed: number;
  /** Stealing aggressiveness (20-80): how often the player attempts steals */
  stealingAggressiveness?: number;
  /** Stealing ability (20-80): steal success rate */
  stealingAbility?: number;
  /** Injury proneness: Durable, Wary, Normal, Fragile, Prone */
  injuryProneness?: string;
  age?: number;
  /** Overall star rating (0.5-5.0 scale) */
  ovr: number;
  /** Potential star rating (0.5-5.0 scale) */
  pot: number;
  /** Personality traits (H = high, N = neutral, L = low) */
  leadership?: 'H' | 'N' | 'L';
  loyalty?: 'H' | 'N' | 'L';
  adaptability?: 'H' | 'N' | 'L';
  greed?: 'H' | 'N' | 'L';
  workEthic?: 'H' | 'N' | 'L';
  intelligence?: 'H' | 'N' | 'L';
  /** Position label from scouting CSV (e.g. 'LF', 'SS', 'C') */
  pos?: string;
  /** Player level: 'MLB' | 'AAA' | 'AA' | 'A' | 'R' | 'INT' | '-' */
  lev?: string;
  /** High School/College status: 'HS Senior' | 'CO Junior' | etc. | '-' */
  hsc?: string;
  /** Date of birth string from CSV (e.g. '02/26/2001') */
  dob?: string;
  source?: 'my' | 'osa';
}
