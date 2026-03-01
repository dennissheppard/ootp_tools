-- migrate-004-precomputed.sql
-- Persistent cache for pre-computed static data (MLB distributions, PA-by-injury, etc.)
-- NOT cleared by clear_for_sync() — this data never changes across syncs.

CREATE TABLE IF NOT EXISTS precomputed_cache (
  key TEXT PRIMARY KEY,
  data JSONB NOT NULL
);

ALTER TABLE precomputed_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_precomputed" ON precomputed_cache FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_precomputed" ON precomputed_cache FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_precomputed" ON precomputed_cache FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "service_all_precomputed" ON precomputed_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
