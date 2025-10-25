-- Migration: 009_fix_users_multi_tenant.sql
-- Purpose: Re-insert users to ensure unique user_id per (tenant_id, legacy user_id) using deterministic UUID from md5.

BEGIN;

-- Temporarily disable RLS for affected tables
ALTER TABLE saas.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_logs DISABLE ROW LEVEL SECURITY;

-- Remove previously inserted users to avoid PK conflicts
TRUNCATE saas.users CASCADE;

-- Re-insert with deterministic UUID based on tenant_id and legacy user_id
INSERT INTO saas.users (
  user_id, tenant_id, branch_id, email, password_hash, name, role_id, status, last_login, created_at
)
SELECT
  (
    -- Build UUID from md5(tenant_id || ':' || legacy_user_id)
    (substring(md5(tu.tenant_id || ':' || u.user_id) from 1 for 8) || '-' ||
     substring(md5(tu.tenant_id || ':' || u.user_id) from 9 for 4) || '-' ||
     substring(md5(tu.tenant_id || ':' || u.user_id) from 13 for 4) || '-' ||
     substring(md5(tu.tenant_id || ':' || u.user_id) from 17 for 4) || '-' ||
     substring(md5(tu.tenant_id || ':' || u.user_id) from 21))::uuid
  ) AS user_id,
  tu.tenant_id::uuid,
  NULL, -- branch unknown in legacy mapping here
  lower(u.email),
  COALESCE(NULLIF(u.password_hash,''),'') ,
  COALESCE(NULLIF(u.full_name,''), NULLIF(u.name,'')),
  r.role_id,
  CASE
    WHEN lower(u.status) IN ('active','disabled','locked','pending','deleted') THEN lower(u.status)
    ELSE CASE WHEN u.deleted_at IS NOT NULL THEN 'deleted' ELSE 'active' END
  END,
  NULLIF(u.last_login,'')::timestamptz,
  COALESCE(NULLIF(u.created_at,''), now()::text)::timestamptz
FROM staging.users_raw u
JOIN staging.tenant_users_raw tu ON tu.user_id = u.user_id
LEFT JOIN saas.roles r ON r.tenant_id = tu.tenant_id::uuid AND lower(r.role_name) = lower(NULLIF(tu.role,''));

-- Re-enable RLS
ALTER TABLE saas.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_logs ENABLE ROW LEVEL SECURITY;

COMMIT;
