-- Add draft_eligible flag and hsc (high school/college) designation to players
-- Both are seasonal — refreshed via CSV import each year
ALTER TABLE players ADD COLUMN IF NOT EXISTS draft_eligible BOOLEAN DEFAULT FALSE;
ALTER TABLE players ADD COLUMN IF NOT EXISTS hsc TEXT;
