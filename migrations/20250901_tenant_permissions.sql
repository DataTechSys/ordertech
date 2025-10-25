-- 20250901_tenant_permissions.sql — per-tenant fine-grained permissions overlay
-- Idempotent and safe

CREATE TABLE IF NOT EXISTS tenant_permissions (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, user_id)
);

