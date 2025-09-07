-- 20250905_tenant_external_mappings.sql — map local entities to external provider IDs (e.g., Foodics)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant_external_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  external_id text NOT NULL,
  external_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Uniqueness and performance indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uniq_tenant_provider_entitytype_externalid'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX uniq_tenant_provider_entitytype_externalid
               ON tenant_external_mappings (tenant_id, provider, entity_type, external_id)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_entityid_provider'
  ) THEN
    EXECUTE 'CREATE INDEX idx_entityid_provider
               ON tenant_external_mappings (entity_id, provider)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_tenant_provider_entitytype_entityid'
  ) THEN
    EXECUTE 'CREATE INDEX idx_tenant_provider_entitytype_entityid
               ON tenant_external_mappings (tenant_id, provider, entity_type, entity_id)';
  END IF;
END$$;
