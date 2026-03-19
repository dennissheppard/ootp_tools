-- Migration 008: Defensive stats table for DRS data from /api/drs
-- Fielding scouting ratings are stored in hitter_scouting.raw_data JSONB

CREATE TABLE IF NOT EXISTS defensive_stats (
  player_id INT NOT NULL,
  year INT NOT NULL,
  position INT NOT NULL,
  g INT DEFAULT 0,
  ip TEXT DEFAULT '0',
  drs DECIMAL DEFAULT 0,
  drs_per_162 DECIMAL DEFAULT 0,
  zr DECIMAL DEFAULT 0,
  framing DECIMAL DEFAULT 0,
  arm DECIMAL DEFAULT 0,
  raw_data JSONB,
  PRIMARY KEY (player_id, year, position)
);

-- Index for quick lookups by player
CREATE INDEX IF NOT EXISTS idx_defensive_stats_player ON defensive_stats(player_id);

-- Grant access
GRANT ALL ON defensive_stats TO anon;
GRANT ALL ON defensive_stats TO authenticated;
