-- 20250905_integration_sync_runs.sql — audit log for per-tenant external integration sync runs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS integration_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean,
  error text,
  stats jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_sync_runs_tenant_provider'
  ) THEN
    EXECUTE 'CREATE INDEX idx_sync_runs_tenant_provider
               ON integration_sync_runs (tenant_id, provider, started_at DESC)';
  END IF;
END$$;
