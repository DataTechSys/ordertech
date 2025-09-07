-- 20250904_tenant_api_integrations.sql — per-tenant external API integrations (e.g., Foodics)
-- Idempotent and safe; relies on pgcrypto for gen_random_uuid()

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant_api_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  label text,
  token_encrypted bytea,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Uniqueness per tenant/provider/label (label NULL treated as empty string)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'ux_tenant_api_integrations_tenant_provider_label'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX ux_tenant_api_integrations_tenant_provider_label
               ON tenant_api_integrations(tenant_id, provider, coalesce(label, ''''))';
  END IF;
END$$;
