-- migrate-003-ratings.sql
-- Pre-computed TR/TFR storage so followers skip expensive computation.

-- ============================================================
-- 1. player_ratings table
-- ============================================================
CREATE TABLE IF NOT EXISTS player_ratings (
  player_id INT NOT NULL REFERENCES players(id),
  rating_type TEXT NOT NULL CHECK (rating_type IN ('pitcher_tr', 'hitter_tr', 'pitcher_tfr', 'hitter_tfr')),
  data JSONB NOT NULL,
  PRIMARY KEY (player_id, rating_type)
);

ALTER TABLE player_ratings ENABLE ROW LEVEL SECURITY;

-- Read access for anon
CREATE POLICY "anon_read_player_ratings" ON player_ratings FOR SELECT TO anon USING (true);

-- Anon write access (hero client writes)
CREATE POLICY "anon_insert_player_ratings" ON player_ratings FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_player_ratings" ON player_ratings FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Service role full access
CREATE POLICY "service_all_player_ratings" ON player_ratings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 2. Update clear_for_sync to also wipe player_ratings
-- ============================================================
CREATE OR REPLACE FUNCTION clear_for_sync()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM contracts WHERE true;
  DELETE FROM player_ratings WHERE true;
END;
$$;
