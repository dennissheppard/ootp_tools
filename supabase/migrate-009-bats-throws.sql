-- Migration 009: Add bats and throws columns to players table
-- Values: R (right), L (left), S (switch) for bats; R/L for throws

ALTER TABLE players ADD COLUMN IF NOT EXISTS bats VARCHAR(1);
ALTER TABLE players ADD COLUMN IF NOT EXISTS throws VARCHAR(1);
