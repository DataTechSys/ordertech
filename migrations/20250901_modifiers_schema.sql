-- 20250901_modifiers_schema.sql — Create modifier groups/options tables (idempotent)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Modifier groups table
CREATE TABLE IF NOT EXISTS modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  reference text,
  min_select integer,
  max_select integer,
  required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, reference)
);

-- Modifier options table
CREATE TABLE IF NOT EXISTS modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric(10,3) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS ix_modifier_groups_tenant_ref ON modifier_groups(tenant_id, reference);
CREATE INDEX IF NOT EXISTS ix_modifier_options_group ON modifier_options(group_id);

