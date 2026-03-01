-- migrate-002-sync.sql
-- Adds sync infrastructure: contracts table, game_date tracking, RPC functions,
-- and anon write policies so the first browser client can seed Supabase.

-- ============================================================
-- 1. game_date column on data_version
-- ============================================================
ALTER TABLE data_version ADD COLUMN IF NOT EXISTS game_date TEXT;

-- Seed the game_state row used by claim_sync / complete_sync
-- version=0 (even) means "no sync in progress", game_date=NULL means "never synced"
INSERT INTO data_version (table_name, version, game_date)
VALUES ('game_state', 0, NULL)
ON CONFLICT (table_name) DO NOTHING;

-- ============================================================
-- 2. contracts table
-- ============================================================
CREATE TABLE IF NOT EXISTS contracts (
  player_id INT PRIMARY KEY,
  team_id INT,
  league_id INT,
  is_major BOOLEAN DEFAULT FALSE,
  season_year INT,
  years INT,
  current_year INT,
  salaries JSONB,
  no_trade BOOLEAN DEFAULT FALSE,
  last_year_team_option BOOLEAN DEFAULT FALSE,
  last_year_player_option BOOLEAN DEFAULT FALSE,
  last_year_vesting_option BOOLEAN DEFAULT FALSE
);

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

-- Read access for anon
CREATE POLICY "anon_read_contracts" ON contracts FOR SELECT TO anon USING (true);

-- Service role full access
CREATE POLICY "service_all_contracts" ON contracts FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- 3. Anon INSERT / UPDATE policies (hero client writes)
-- ============================================================
CREATE POLICY "anon_insert_players" ON players FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_players" ON players FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_insert_teams" ON teams FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_teams" ON teams FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_insert_contracts" ON contracts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_contracts" ON contracts FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_insert_pitching" ON pitching_stats FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_pitching" ON pitching_stats FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_insert_batting" ON batting_stats FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_batting" ON batting_stats FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_update_data_version" ON data_version FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- ============================================================
-- 4. clear_for_sync RPC — wipe snapshot tables before hero re-inserts
-- ============================================================
-- Only clobbers contracts (rows genuinely appear/disappear between game dates).
-- Players and teams are upserted (FK constraints from stats tables prevent DELETE).
CREATE OR REPLACE FUNCTION clear_for_sync()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM contracts WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION clear_for_sync() TO anon;

-- ============================================================
-- 5. claim_sync RPC — atomic "first writer wins" lock
--
-- Uses odd/even version on the game_state row:
--   even = idle (no sync in progress)
--   odd  = sync in progress
--
-- Does NOT set game_date — that only happens in complete_sync
-- when data is actually ready to read.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_sync(new_date TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_date_val TEXT;
  current_version INT;
  current_updated TIMESTAMPTZ;
BEGIN
  -- Lock the game_state row so only one caller wins
  SELECT game_date, version, updated_at
    INTO current_date_val, current_version, current_updated
    FROM data_version
   WHERE table_name = 'game_state'
     FOR UPDATE;

  -- Already synced for this date (game_date set by complete_sync = data ready)
  IF current_date_val IS NOT NULL AND current_date_val >= new_date THEN
    RETURN FALSE;
  END IF;

  -- Another hero is actively syncing (odd version, claimed < 2 minutes ago)
  IF current_version % 2 = 1
     AND current_updated > NOW() - INTERVAL '2 minutes' THEN
    RETURN FALSE;
  END IF;

  -- Claim: set version to odd (sync in progress), update timestamp
  UPDATE data_version
     SET version = current_version + 1,
         updated_at = NOW()
   WHERE table_name = 'game_state';

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_sync(TEXT) TO anon;

-- ============================================================
-- 6. complete_sync RPC — set game_date + bump versions
--
-- Only called after the hero has finished writing all data.
-- Sets game_date (the "data ready" signal) and bumps version
-- back to even (idle).
-- ============================================================
CREATE OR REPLACE FUNCTION complete_sync(sync_date TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Mark sync complete: set game_date, bump version to even
  UPDATE data_version
     SET game_date = sync_date,
         version = version + 1,
         updated_at = NOW()
   WHERE table_name = 'game_state';

  -- Bump data table versions so followers invalidate caches
  UPDATE data_version
     SET version = version + 1, updated_at = NOW()
   WHERE table_name IN ('players', 'teams', 'pitching_stats', 'batting_stats');

  INSERT INTO data_version (table_name, version)
  VALUES ('contracts', 1)
  ON CONFLICT (table_name) DO UPDATE
     SET version = data_version.version + 1, updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION complete_sync(TEXT) TO anon;
