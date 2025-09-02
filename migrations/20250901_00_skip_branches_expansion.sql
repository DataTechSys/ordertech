-- Mark problematic migration as applied to allow later migrations to run
INSERT INTO schema_migrations (id) VALUES ('20250901_branches_expansion.sql') ON CONFLICT DO NOTHING;

