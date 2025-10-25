-- 20250926_add_modopt_reference.sql
-- Add missing reference column to modifier_options so we can enforce uniqueness by (tenant, group, lower(reference)).
-- Idempotent: safe to run multiple times.

ALTER TABLE IF EXISTS modifier_options
  ADD COLUMN IF NOT EXISTS reference text;

-- Helpful index for lookups before/without strict unique index
CREATE INDEX IF NOT EXISTS ix_modifier_options_tenant_group_ref
  ON modifier_options (tenant_id, group_id, reference);
