-- fix_tenant_users.sql — one-off repair for production
-- Align tenant_users schema to app expectations

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_role') THEN
    CREATE TYPE tenant_role AS ENUM ('owner','admin','manager','viewer');
  END IF;
END$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'tenant_users'
      AND c.column_name = 'role'
      AND c.udt_name = 'user_role'
  ) THEN
    ALTER TABLE public.tenant_users
      ALTER COLUMN role TYPE tenant_role USING role::text::tenant_role;
  END IF;
END$$;

ALTER TABLE IF EXISTS public.tenant_users
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

