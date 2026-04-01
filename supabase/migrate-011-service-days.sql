-- Add MLB service days tracking to players table.
-- Source: Firebase playerRosterStatus/{playerId}.mlb_service_days
-- Used by Team Planner to determine arb eligibility (3+ years) vs FA (6+ years).
ALTER TABLE players ADD COLUMN IF NOT EXISTS service_days INT DEFAULT NULL;
