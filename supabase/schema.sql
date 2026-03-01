-- WBL Database Schema
-- Migrates ~240 CSV files into PostgreSQL tables in Supabase
-- Run this in the Supabase SQL Editor or via migration

-- ============================================================
-- TABLES
-- ============================================================

-- Teams / Organizations
CREATE TABLE IF NOT EXISTS teams (
  id INT PRIMARY KEY,
  name VARCHAR(100),
  nickname VARCHAR(100),
  parent_team_id INT DEFAULT 0,    -- 0 = MLB org, >0 = minor league affiliate
  league_id INT
);

-- Players (master record, merges roster + DOB CSVs)
CREATE TABLE IF NOT EXISTS players (
  id INT PRIMARY KEY,              -- OOTP player_id
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  dob DATE,                        -- from DOB CSVs
  position INT,                    -- 1-10 enum
  team_id INT REFERENCES teams(id),
  parent_team_id INT REFERENCES teams(id),
  league_id INT,
  level VARCHAR(10),               -- MLB, AAA, AA, A, R
  role INT,
  age INT,
  retired BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_players_parent_team ON players(parent_team_id);

-- Pitching stats (MLB + all minor league levels)
CREATE TABLE IF NOT EXISTS pitching_stats (
  id INT,                          -- row ID from CSV (informational, not part of PK)
  player_id INT NOT NULL REFERENCES players(id),
  year INT NOT NULL,
  team_id INT,
  game_id INT,
  league_id INT NOT NULL,
  level_id INT,                    -- 1=MLB (200 league_id), 2=AAA (201), etc.
  split_id INT NOT NULL DEFAULT 1,
  ip VARCHAR(20),                  -- stored as string (e.g. "28" can be decimal)
  ab INT, tb INT, ha INT, k INT, bf INT, rs INT, bb INT,
  r INT, er INT, gb INT, fb INT, pi INT, ipf INT,
  g INT, gs INT, w INT, l INT, s INT,
  sa INT, da INT, sh INT, sf INT, ta INT,
  hra INT, bk INT, ci INT, iw INT, wp INT, hp INT,
  gf INT, dp INT, qs INT, svo INT, bs INT, ra INT,
  cg INT, sho INT, sb INT, cs INT,
  hld INT, ir INT, irs INT,
  wpa DECIMAL, li DECIMAL, stint INT, outs INT,
  sd INT, md INT,
  war DECIMAL, ra9war DECIMAL,
  PRIMARY KEY (player_id, year, league_id, split_id)
);
CREATE INDEX IF NOT EXISTS idx_pitch_year_league ON pitching_stats(year, league_id);
CREATE INDEX IF NOT EXISTS idx_pitch_player ON pitching_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_pitch_player_year ON pitching_stats(player_id, year);

-- Batting stats (MLB + all minor league levels)
CREATE TABLE IF NOT EXISTS batting_stats (
  id INT,                          -- row ID from CSV (informational, not part of PK)
  player_id INT NOT NULL REFERENCES players(id),
  year INT NOT NULL,
  team_id INT,
  game_id INT,
  league_id INT NOT NULL,
  level_id INT,
  split_id INT NOT NULL DEFAULT 1,
  position INT,
  ab INT, h INT, k INT, pa INT, pitches_seen INT,
  g INT, gs INT, d INT, t INT, hr INT, r INT, rbi INT,
  sb INT, cs INT, bb INT, ibb INT, gdp INT, sh INT, sf INT,
  hp INT, ci INT, wpa DECIMAL, stint INT, ubr DECIMAL, war DECIMAL,
  PRIMARY KEY (player_id, year, league_id, split_id)
);
CREATE INDEX IF NOT EXISTS idx_bat_year_league ON batting_stats(year, league_id);
CREATE INDEX IF NOT EXISTS idx_bat_player ON batting_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_bat_player_year ON batting_stats(player_id, year);

-- Pitcher scouting ratings
CREATE TABLE IF NOT EXISTS pitcher_scouting (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL,
  source VARCHAR(10) NOT NULL,     -- 'osa' or 'my'
  snapshot_date DATE NOT NULL,
  player_name VARCHAR(100),
  stuff INT, control INT, hra INT,
  age INT, ovr DECIMAL, pot DECIMAL, stamina INT,
  injury_proneness VARCHAR(20),
  lev VARCHAR(10), hsc VARCHAR(30), dob VARCHAR(20),
  pitcher_type VARCHAR(20),
  babip VARCHAR(10),
  raw_data JSONB                   -- variable columns (pitch types, personality, etc.)
);
CREATE INDEX IF NOT EXISTS idx_psct_source ON pitcher_scouting(source);
CREATE INDEX IF NOT EXISTS idx_psct_player ON pitcher_scouting(player_id);

-- Hitter scouting ratings
CREATE TABLE IF NOT EXISTS hitter_scouting (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL,
  source VARCHAR(10) NOT NULL,
  snapshot_date DATE NOT NULL,
  player_name VARCHAR(100),
  power INT, eye INT, avoid_k INT, contact INT, gap INT, speed INT,
  stealing_aggressiveness INT, stealing_ability INT,
  injury_proneness VARCHAR(20),
  age INT, ovr DECIMAL, pot DECIMAL,
  pos VARCHAR(10), lev VARCHAR(10), hsc VARCHAR(30), dob VARCHAR(20),
  raw_data JSONB
);
CREATE INDEX IF NOT EXISTS idx_hsct_source ON hitter_scouting(source);
CREATE INDEX IF NOT EXISTS idx_hsct_player ON hitter_scouting(player_id);

-- Contracts
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

-- Cache invalidation tracking
CREATE TABLE IF NOT EXISTS data_version (
  table_name VARCHAR(50) PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INT NOT NULL DEFAULT 1,
  game_date TEXT
);

-- Seed initial versions
INSERT INTO data_version (table_name, version) VALUES
  ('pitching_stats', 1),
  ('batting_stats', 1),
  ('pitcher_scouting', 1),
  ('hitter_scouting', 1),
  ('players', 1),
  ('teams', 1),
  ('contracts', 1)
ON CONFLICT (table_name) DO NOTHING;

-- Seed game_state row for sync orchestration
-- version=0 (even) = idle, game_date=NULL = never synced
INSERT INTO data_version (table_name, version, game_date)
VALUES ('game_state', 0, NULL)
ON CONFLICT (table_name) DO NOTHING;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitching_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE batting_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitcher_scouting ENABLE ROW LEVEL SECURITY;
ALTER TABLE hitter_scouting ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_version ENABLE ROW LEVEL SECURITY;

-- Anonymous read access (anon key)
CREATE POLICY "anon_read_teams" ON teams FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_players" ON players FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_pitching" ON pitching_stats FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_batting" ON batting_stats FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_pitcher_scouting" ON pitcher_scouting FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_hitter_scouting" ON hitter_scouting FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_contracts" ON contracts FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read_data_version" ON data_version FOR SELECT TO anon USING (true);

-- Anonymous write access (hero client sync)
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

-- Service role has full access (for migration scripts + admin tools)
CREATE POLICY "service_all_teams" ON teams FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_players" ON players FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_pitching" ON pitching_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_batting" ON batting_stats FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_pitcher_scouting" ON pitcher_scouting FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_hitter_scouting" ON hitter_scouting FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_contracts" ON contracts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_all_data_version" ON data_version FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- RPC FUNCTIONS (sync orchestration)
-- ============================================================

-- clear_for_sync: wipe snapshot tables before sync re-inserts fresh data
-- Only clobbers contracts + player_ratings (rows genuinely appear/disappear between game dates).
-- Players and teams are upserted (FK constraints from stats tables prevent DELETE).
-- Stats are upserted with natural PK (player_id, year, league_id, split_id) so no clearing needed.
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

GRANT EXECUTE ON FUNCTION clear_for_sync() TO anon;

-- claim_sync: atomic "first writer wins" lock using odd/even version
-- odd = sync in progress, even = idle. Does NOT set game_date.
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
  SELECT game_date, version, updated_at
    INTO current_date_val, current_version, current_updated
    FROM data_version
   WHERE table_name = 'game_state'
     FOR UPDATE;

  IF current_date_val IS NOT NULL AND current_date_val >= new_date THEN
    RETURN FALSE;
  END IF;

  IF current_version % 2 = 1
     AND current_updated > NOW() - INTERVAL '2 minutes' THEN
    RETURN FALSE;
  END IF;

  UPDATE data_version
     SET version = current_version + 1, updated_at = NOW()
   WHERE table_name = 'game_state';

  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_sync(TEXT) TO anon;

-- complete_sync: set game_date (data ready signal), bump versions
CREATE OR REPLACE FUNCTION complete_sync(sync_date TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE data_version
     SET game_date = sync_date, version = version + 1, updated_at = NOW()
   WHERE table_name = 'game_state';

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
