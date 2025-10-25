-- 20250918_align_saas_core.sql — align column names and add required fields to match DDL while preserving existing data
SET lock_timeout = '10s';
SET statement_timeout = '5min';

-- Ensure pgcrypto for gen_random_uuid (even if not used directly here)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- TENANTS: rename id -> tenant_id, name -> company_name (only if target column names do not already exist)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE public.tenants RENAME COLUMN id TO tenant_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'company_name'
  ) THEN
    ALTER TABLE public.tenants RENAME COLUMN name TO company_name;
  END IF;
END $$;

-- TENANTS: add DDL columns
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS subdomain varchar(50),
  ADD COLUMN IF NOT EXISTS email varchar(100),
  ADD COLUMN IF NOT EXISTS status varchar(20),
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS renewal_date date,
  ADD COLUMN IF NOT EXISTS plan_type varchar(20);

-- TENANTS: unique subdomain (Postgres allows multiple NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_subdomain ON public.tenants(subdomain);

-- BRANCHES: rename id -> branch_id, name -> branch_name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'branch_id'
  ) THEN
    ALTER TABLE public.branches RENAME COLUMN id TO branch_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'branches' AND column_name = 'branch_name'
  ) THEN
    ALTER TABLE public.branches RENAME COLUMN name TO branch_name;
  END IF;
END $$;

-- BRANCHES: add DDL columns
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- DEVICES: rename id -> device_id, name -> device_name
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'device_id'
  ) THEN
    ALTER TABLE public.devices RENAME COLUMN id TO device_id;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'devices' AND column_name = 'device_name'
  ) THEN
    ALTER TABLE public.devices RENAME COLUMN name TO device_name;
  END IF;
END $$;

-- DEVICES: add missing DDL columns (keep enums device_role/device_status as-is)
ALTER TABLE public.devices
  ADD COLUMN IF NOT EXISTS uuid text,
  ADD COLUMN IF NOT EXISTS activation_token varchar(100),
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS last_checkin timestamptz,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- DEVICES: unique uuid
CREATE UNIQUE INDEX IF NOT EXISTS ux_devices_uuid ON public.devices(uuid);

-- USERS (global): rename id -> user_id; add status and last_login
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.users RENAME COLUMN id TO user_id;
  END IF;
END $$;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status varchar(20),
  ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- NOTE:
-- We intentionally keep the global users model (no tenant_id/branch_id/role_id on users).
-- Existing FKs referencing renamed PK columns will continue to function after the rename.
