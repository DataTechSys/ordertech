-- Pre-migration for appdb: ensure categories.reference exists before creating unique index
ALTER TABLE IF EXISTS categories
  ADD COLUMN IF NOT EXISTS reference text;

