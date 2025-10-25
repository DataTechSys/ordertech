-- Migration: 005_rls_policies.sql
-- Purpose: Enable Row-Level Security on tenant-scoped tables and define a tenant isolation policy.

DO $$
DECLARE
  t text;
  -- Only include tables that have a tenant_id column
  tables text[] := ARRAY[
    'saas.branches',
    'saas.roles',
    'saas.users',
    'saas.devices',
    'saas.subscriptions',
    'audit.audit_logs',
    'catalog.categories',
    'catalog.products'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;', t);
    -- Single policy covering SELECT/UPDATE/DELETE and WITH CHECK for INSERT/UPDATE
    EXECUTE format($p$
      DROP POLICY IF EXISTS tenant_isolation ON %1$s;
      CREATE POLICY tenant_isolation ON %1$s
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    $p$, t);
  END LOOP;
END $$;
