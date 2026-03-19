-- Add status column to players table
-- Values: 'active' (on a team), 'free_agent', 'draftee', 'retired'
ALTER TABLE players ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
