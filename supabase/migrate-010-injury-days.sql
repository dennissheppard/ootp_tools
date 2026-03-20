-- Add active injury tracking to players table.
-- injury_days_remaining: days until the player returns from current injury (0 = healthy).
-- Written by sync-db from the WBL CSV endpoint; read by projection pipeline to reduce PA/IP.
ALTER TABLE players ADD COLUMN IF NOT EXISTS injury_days_remaining INTEGER DEFAULT 0;
