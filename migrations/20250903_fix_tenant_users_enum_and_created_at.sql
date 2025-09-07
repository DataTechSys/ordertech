-- 20250903_fix_tenant_users_enum_and_created_at.sql
-- Align tenant_users.role to tenant_role enum and add created_at column if missing
-- Idempotent and safe

-- Ensure tenant_role enum exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_role') THEN
    CREATE TYPE tenant_role AS ENUM ('owner','admin','manager','viewer');
  END IF;
END$$;

-- If tenant_users.role is of type user_role, convert it to tenant_role by creating a new column and swapping
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
    -- Add temporary column with target enum type
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema='public' AND c.table_name='tenant_users' AND c.column_name='role_tmp'
    ) THEN
      ALTER TABLE public.tenant_users ADD COLUMN role_tmp tenant_role;
    END IF;
    -- Ensure default and copy values
    ALTER TABLE public.tenant_users ALTER COLUMN role_tmp SET DEFAULT 'viewer'::tenant_role;
    UPDATE public.tenant_users SET role_tmp = role::text::tenant_role WHERE role_tmp IS NULL;
    ALTER TABLE public.tenant_users ALTER COLUMN role_tmp SET NOT NULL;
    -- Drop old column and rename
    ALTER TABLE public.tenant_users DROP COLUMN role;
    ALTER TABLE public.tenant_users RENAME COLUMN role_tmp TO role;
  END IF;
END$$;

-- Ensure supporting index exists (tenant_id, role) for admin queries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='ix_tenant_users_tenant_role'
  ) THEN
    EXECUTE 'CREATE INDEX ix_tenant_users_tenant_role ON tenant_users(tenant_id, role)';
  END IF;
END$$;

-- Add created_at column if missing
ALTER TABLE IF EXISTS public.tenant_users
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

