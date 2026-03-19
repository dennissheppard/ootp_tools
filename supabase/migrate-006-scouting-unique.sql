-- migrate-006-scouting-unique.sql
-- Deduplicate existing rows, then add unique constraints for PostgREST on_conflict upsert.

-- Remove duplicate pitcher_scouting rows, keeping the one with the highest id
DELETE FROM pitcher_scouting a
  USING pitcher_scouting b
  WHERE a.player_id = b.player_id
    AND a.source = b.source
    AND a.snapshot_date = b.snapshot_date
    AND a.id < b.id;

-- Remove duplicate hitter_scouting rows, keeping the one with the highest id
DELETE FROM hitter_scouting a
  USING hitter_scouting b
  WHERE a.player_id = b.player_id
    AND a.source = b.source
    AND a.snapshot_date = b.snapshot_date
    AND a.id < b.id;

ALTER TABLE pitcher_scouting
  ADD CONSTRAINT pitcher_scouting_player_source_date_uq
  UNIQUE (player_id, source, snapshot_date);

ALTER TABLE hitter_scouting
  ADD CONSTRAINT hitter_scouting_player_source_date_uq
  UNIQUE (player_id, source, snapshot_date);
