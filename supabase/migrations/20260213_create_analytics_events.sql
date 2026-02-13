-- Analytics events table for lightweight usage tracking
-- Run this against your Supabase project via the SQL Editor

CREATE TABLE analytics_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_analytics_created ON analytics_events (created_at DESC);
CREATE INDEX idx_analytics_type ON analytics_events (event_type);
CREATE INDEX idx_analytics_session ON analytics_events (session_id);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Anon can INSERT (track events) and SELECT (dashboard queries)
CREATE POLICY "anon_insert" ON analytics_events FOR INSERT WITH CHECK (true);
CREATE POLICY "anon_select" ON analytics_events FOR SELECT USING (true);
