-- 20250918_platform_admin_rbac.sql — Platform-level RBAC and tenant assignments
SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Platform admins (distinct from tenant users)
CREATE TABLE IF NOT EXISTS platform_admins (
  admin_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE NOT NULL,
  full_name   text,
  status      text NOT NULL DEFAULT 'active', -- active | disabled
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Platform roles
CREATE TABLE IF NOT EXISTS platform_roles (
  role_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name   text UNIQUE NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Platform permissions catalog (codes)
CREATE TABLE IF NOT EXISTS platform_permissions (
  code        text PRIMARY KEY,
  description text
);

-- Role → Permission mapping
CREATE TABLE IF NOT EXISTS platform_role_permissions (
  role_id     uuid NOT NULL,
  code        text NOT NULL,
  PRIMARY KEY (role_id, code)
);

-- Admin → Role mapping (many-to-many)
CREATE TABLE IF NOT EXISTS platform_admin_roles (
  admin_id    uuid NOT NULL,
  role_id     uuid NOT NULL,
  PRIMARY KEY (admin_id, role_id)
);

-- Admin → Tenant assignments (limit scope to specific tenants when present)
CREATE TABLE IF NOT EXISTS platform_admin_tenants (
  admin_id    uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS ix_pat_admin ON platform_admin_tenants(admin_id);
CREATE INDEX IF NOT EXISTS ix_pat_tenant ON platform_admin_tenants(tenant_id);

-- Seed minimal permissions (dashboard pages) idempotently
INSERT INTO platform_permissions(code, description) VALUES
  ('admin.page.company','Company page'),
  ('admin.page.users','Users page'),
  ('admin.page.roles','Roles page'),
  ('admin.page.branches','Branches page'),
  ('admin.page.devices','Devices page'),
  ('admin.page.products','Products page'),
  ('admin.page.categories','Categories page'),
  ('admin.page.modifiers','Modifiers page'),
  ('admin.page.posters','Posters page'),
  ('admin.page.messages','Messages page'),
  ('admin.page.tenants','Tenants page')
ON CONFLICT (code) DO NOTHING;

-- Seed SuperAdmin role with all permissions
DO $$
DECLARE r_id uuid;
BEGIN
  SELECT role_id INTO r_id FROM platform_roles WHERE role_name='SuperAdmin';
  IF r_id IS NULL THEN
    INSERT INTO platform_roles(role_name, description) VALUES('SuperAdmin','Full platform access') RETURNING role_id INTO r_id;
  END IF;
  INSERT INTO platform_role_permissions(role_id, code)
    SELECT r_id, p.code FROM platform_permissions p
    ON CONFLICT DO NOTHING;
END$$;

-- Upsert platform admin: hussain@mosawi.com as SuperAdmin (robust, skip if schema differs)
-- Ensure minimum columns on existing table
ALTER TABLE IF EXISTS platform_admins
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$
DECLARE
  pk_col text;
  a_id uuid;
  r_id uuid;
BEGIN
  -- Verify email column exists; otherwise skip seeding to avoid failure on legacy shapes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='platform_admins' AND column_name='email'
  ) THEN
    RETURN;
  END IF;

  -- Determine primary key column name
  SELECT a.attname INTO pk_col
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE n.nspname='public' AND c.relname='platform_admins' AND i.indisprimary
  LIMIT 1;

  IF pk_col IS NULL THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_admins' AND column_name='admin_id') THEN
      pk_col := 'admin_id';
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='platform_admins' AND column_name='id') THEN
      pk_col := 'id';
    ELSE
      RETURN;
    END IF;
  END IF;

  -- Insert if not exists (no reliance on unique constraint)
  EXECUTE
    'INSERT INTO platform_admins(email, full_name, status) ' ||
    'SELECT $1, $2, $3 WHERE NOT EXISTS (' ||
    'SELECT 1 FROM platform_admins WHERE lower(email)=lower($1))'
  USING 'hussain@mosawi.com', 'Hussain Mosawi', 'active';

  -- Read PK into a_id using dynamic PK column
  EXECUTE format('SELECT %I FROM platform_admins WHERE lower(email)=lower($1)', pk_col)
  INTO a_id
  USING 'hussain@mosawi.com';

  -- Ensure SuperAdmin role exists and get role_id
  SELECT role_id INTO r_id FROM platform_roles WHERE role_name='SuperAdmin';
  IF r_id IS NULL THEN
    INSERT INTO platform_roles(role_name, description) VALUES('SuperAdmin','Full platform access') RETURNING role_id INTO r_id;
  END IF;

  -- Grant role if mapping table present
  IF a_id IS NOT NULL AND r_id IS NOT NULL THEN
    BEGIN
      INSERT INTO platform_admin_roles(admin_id, role_id) VALUES(a_id, r_id) ON CONFLICT DO NOTHING;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  END IF;
END$$;
