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

-- Upsert platform admin: hussain@mosawi.com as SuperAdmin (support either admin_id or id PK)
DO $$
DECLARE a_id uuid;
DECLARE r_id uuid;
BEGIN
  BEGIN
    SELECT admin_id INTO a_id FROM platform_admins WHERE lower(email)=lower('hussain@mosawi.com');
  EXCEPTION WHEN undefined_column THEN
    EXECUTE 'SELECT id FROM platform_admins WHERE lower(email)=lower($1)' INTO a_id USING 'hussain@mosawi.com';
  END;

  IF a_id IS NULL THEN
    BEGIN
      INSERT INTO platform_admins(email, full_name, status)
        VALUES('hussain@mosawi.com','Hussain Mosawi','active')
        RETURNING admin_id INTO a_id;
    EXCEPTION WHEN undefined_column THEN
      EXECUTE 'INSERT INTO platform_admins(email, full_name, status) VALUES ($1,$2,$3) RETURNING id'
        INTO a_id USING 'hussain@mosawi.com','Hussain Mosawi','active';
    END;
  END IF;

  SELECT role_id INTO r_id FROM platform_roles WHERE role_name='SuperAdmin';
  IF a_id IS NOT NULL AND r_id IS NOT NULL THEN
    -- platform_admin_roles uses admin_id column name regardless; if table shape differs, ignore error
    BEGIN
      INSERT INTO platform_admin_roles(admin_id, role_id) VALUES(a_id, r_id) ON CONFLICT DO NOTHING;
    EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;
END$$;
