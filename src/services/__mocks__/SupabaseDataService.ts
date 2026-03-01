// Manual Jest mock — avoids import.meta.env parse error

export const LEVEL_IDS: Record<string, number> = {
  mlb: 1,
  aaa: 2,
  aa: 2,
  a: 2,
  r: 2,
};

export const LEAGUE_IDS: Record<string, number> = {
  mlb: 200,
  aaa: 201,
  aa: 202,
  a: 203,
  r: 204,
};

export const supabaseDataService = {
  get isConfigured() { return false; },
  hasCustomScouting: false,
  query: jest.fn().mockResolvedValue([]),
  upsert: jest.fn().mockResolvedValue(undefined),
  rpc: jest.fn().mockResolvedValue(undefined),
  getPrecomputed: jest.fn().mockResolvedValue(null),
  getDobs: jest.fn().mockResolvedValue(new Map()),
  getContracts: jest.fn().mockResolvedValue([]),
  getPlayerRatings: jest.fn().mockResolvedValue(null),
  getGameDate: jest.fn().mockResolvedValue(null),
  clearCaches: jest.fn(),
};
