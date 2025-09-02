-- 20250901_tenant_permissions.sql — per-tenant fine-grained permissions overlay
-- Idempotent and safe

CREATE TABLE IF NOT EXISTS tenant_permissions (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, user_id)
);

