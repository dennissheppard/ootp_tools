-- migrate-005-career-aggregates.sql
-- Server-side career aggregate RPCs for sync-db.ts performance.
-- Replaces 50k+ row client-side pagination (100 round-trips) with single RPC calls.

-- Career MLB IP per pitcher
CREATE OR REPLACE FUNCTION career_pitching_ip()
RETURNS TABLE(player_id INT, total_ip NUMERIC) AS $$
  SELECT player_id, SUM(ip::numeric) as total_ip
  FROM pitching_stats
  WHERE league_id = 200 AND split_id = 1
  GROUP BY player_id;
$$ LANGUAGE sql STABLE;

-- Career MLB batting aggregates per hitter
CREATE OR REPLACE FUNCTION career_batting_aggregates()
RETURNS TABLE(player_id INT, total_ab BIGINT, total_h BIGINT, total_bb BIGINT, total_k BIGINT, total_hr BIGINT, total_pa BIGINT) AS $$
  SELECT player_id,
    SUM(COALESCE(ab, 0))::BIGINT as total_ab,
    SUM(COALESCE(h, 0))::BIGINT as total_h,
    SUM(COALESCE(bb, 0))::BIGINT as total_bb,
    SUM(COALESCE(k, 0))::BIGINT as total_k,
    SUM(COALESCE(hr, 0))::BIGINT as total_hr,
    SUM(COALESCE(pa, 0))::BIGINT as total_pa
  FROM batting_stats
  WHERE league_id = 200 AND split_id = 1
  GROUP BY player_id;
$$ LANGUAGE sql STABLE;

-- Partial indexes to speed up the RPCs (WHERE league_id=200 AND split_id=1)
CREATE INDEX IF NOT EXISTS idx_pitch_career_mlb ON pitching_stats(player_id) WHERE league_id = 200 AND split_id = 1;
CREATE INDEX IF NOT EXISTS idx_bat_career_mlb ON batting_stats(player_id) WHERE league_id = 200 AND split_id = 1;

-- Grant to anon for PostgREST access
GRANT EXECUTE ON FUNCTION career_pitching_ip() TO anon;
GRANT EXECUTE ON FUNCTION career_batting_aggregates() TO anon;
