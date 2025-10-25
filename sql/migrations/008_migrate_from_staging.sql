-- Migration: 008_migrate_from_staging.sql
-- Purpose: Transform and load legacy data from staging into the new organized schema.

BEGIN;

-- Temporarily disable RLS to allow cross-tenant bulk inserts
ALTER TABLE saas.branches DISABLE ROW LEVEL SECURITY;
ALTER TABLE saas.roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE saas.users DISABLE ROW LEVEL SECURITY;
ALTER TABLE saas.devices DISABLE ROW LEVEL SECURITY;
ALTER TABLE saas.subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.products DISABLE ROW LEVEL SECURITY;

-- 1) Tenants
INSERT INTO saas.tenants (
  tenant_id, company_name, subdomain, domain, email, status,
  start_date, renewal_date, plan_type, timezone, created_at
)
SELECT
  NULLIF(t.tenant_id,'')::uuid,
  COALESCE(NULLIF(t.company_name,''),'Unnamed Company'),
  COALESCE(NULLIF(t.subdomain,''), lower(regexp_replace(COALESCE(NULLIF(t.company_name,''),'company'), '[^a-zA-Z0-9]+', '-', 'g'))),
  td.host, -- may be null
  NULLIF(t.email,''),
  CASE
    WHEN lower(t.status) IN ('active','trial','suspended','inactive','deleted') THEN lower(t.status)
    ELSE 'active'
  END,
  NULLIF(t.start_date,'')::date,
  NULLIF(t.renewal_date,'')::date,
  NULLIF(t.plan_type,''),
  'UTC',
  COALESCE(NULLIF(t.created_at,''), now()::text)::timestamptz
FROM staging.tenants_raw t
LEFT JOIN (
  SELECT tenant_id, min(host) AS host
  FROM staging.tenant_domains_raw
  WHERE NULLIF(host,'') IS NOT NULL
  GROUP BY tenant_id
) td
ON td.tenant_id = t.tenant_id
ON CONFLICT (tenant_id) DO NOTHING;

-- 2) Branches
INSERT INTO saas.branches (
  branch_id, tenant_id, branch_name, location, expiry_date, is_active, created_at
)
SELECT
  NULLIF(branch_id,'')::uuid,
  NULLIF(tenant_id,'')::uuid,
  COALESCE(NULLIF(branch_name,''),'Main Branch'),
  NULLIF(location,''),
  NULLIF(expiry_date,'')::date,
  CASE WHEN lower(COALESCE(is_active,'')) IN ('t','true','1','yes') THEN true ELSE false END,
  COALESCE(NULLIF(created_at,''), now()::text)::timestamptz
FROM staging.branches_raw
ON CONFLICT (branch_id) DO NOTHING;

-- 3) Permissions (global)
INSERT INTO saas.permissions (permission_id, code, description)
SELECT NULLIF(permission_id,'')::uuid, NULLIF(code,''), NULLIF(description,'')
FROM staging.permissions_raw
WHERE NULLIF(code,'') IS NOT NULL
ON CONFLICT (code) DO NOTHING;

-- 4) Roles (tenant-scoped) from roles_raw
INSERT INTO saas.roles (role_id, tenant_id, role_name, description, created_at)
SELECT
  NULLIF(role_id,'')::uuid,
  NULLIF(tenant_id,'')::uuid,
  NULLIF(role_name,''),
  NULLIF(description,''),
  COALESCE(NULLIF(created_at,''), now()::text)::timestamptz
FROM staging.roles_raw
WHERE NULLIF(role_name,'') IS NOT NULL
ON CONFLICT (role_id) DO NOTHING;

-- 4b) Ensure roles for tenant_users.role values exist
WITH distinct_roles AS (
  SELECT DISTINCT NULLIF(tenant_id,'')::uuid AS tenant_id, lower(NULLIF(role,'')) AS role_name
  FROM staging.tenant_users_raw
  WHERE NULLIF(role,'') IS NOT NULL
)
INSERT INTO saas.roles (tenant_id, role_name)
SELECT dr.tenant_id, dr.role_name
FROM distinct_roles dr
LEFT JOIN saas.roles r
  ON r.tenant_id = dr.tenant_id AND lower(r.role_name) = dr.role_name
WHERE r.role_id IS NULL;

-- 5) Role permissions
INSERT INTO saas.role_permissions(role_id, permission_id)
SELECT
  NULLIF(rp.role_id,'')::uuid,
  NULLIF(rp.permission_id,'')::uuid
FROM staging.role_permissions_raw rp
JOIN saas.roles r ON r.role_id = NULLIF(rp.role_id,'')::uuid
JOIN saas.permissions p ON p.permission_id = NULLIF(rp.permission_id,'')::uuid
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 6) Users (flatten tenant_users + users)
INSERT INTO saas.users (
  user_id, tenant_id, branch_id, email, password_hash, name, role_id, status, last_login, created_at
)
SELECT
  NULLIF(u.user_id,'')::uuid,
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
LEFT JOIN saas.roles r ON r.tenant_id = tu.tenant_id::uuid AND lower(r.role_name) = lower(NULLIF(tu.role,''))
ON CONFLICT (user_id) DO NOTHING;

-- 7) Devices
INSERT INTO saas.devices (
  device_id, tenant_id, branch_id, device_name, uuid, activation_token, status, expiry_date, last_checkin, created_at
)
SELECT
  NULLIF(device_id,'')::uuid,
  NULLIF(tenant_id,'')::uuid,
  NULLIF(branch_id,'')::uuid,
  COALESCE(NULLIF(device_name,''),'Device'),
  (CASE WHEN uuid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN uuid::uuid ELSE gen_random_uuid() END),
  NULLIF(activation_token,''),
  CASE WHEN lower(COALESCE(status,'')) IN ('active','inactive','pending','retired','deleted') THEN lower(status) ELSE 'active' END,
  NULLIF(expiry_date,'')::date,
  NULLIF(last_checkin,'')::timestamptz,
  COALESCE(NULLIF(created_at,''), now()::text)::timestamptz
FROM staging.devices_raw
ON CONFLICT (device_id) DO NOTHING;

-- 8) Subscriptions
INSERT INTO saas.subscriptions (
  subscription_id, tenant_id, start_date, end_date, is_active, devices_allowed, branches_allowed, notes, created_at
)
SELECT
  NULLIF(subscription_id,'')::uuid,
  NULLIF(tenant_id,'')::uuid,
  NULLIF(start_date,'')::date,
  NULLIF(end_date,'')::date,
  CASE WHEN lower(COALESCE(is_active,'')) IN ('t','true','1','yes') THEN true ELSE false END,
  NULLIF(devices_allowed,'')::int,
  NULLIF(branches_allowed,'')::int,
  NULLIF(notes,''),
  now()
FROM staging.subscriptions_raw
ON CONFLICT (subscription_id) DO NOTHING;

-- 9) Catalog categories
INSERT INTO catalog.categories (
  id, tenant_id, parent_id, name, slug, status, created_at, updated_at, legacy_source, legacy_id
)
SELECT
  NULLIF(id,'')::uuid,
  NULLIF(tenant_id,'')::uuid,
  NULL, -- no parent in legacy
  COALESCE(NULLIF(name,''),'Unnamed Category'),
  lower(regexp_replace(COALESCE(NULLIF(name,''),'unnamed'), '[^a-zA-Z0-9]+', '-', 'g')),
  CASE
    WHEN lower(COALESCE(deleted,'')) IN ('t','true','1','yes') THEN 'deleted'
    WHEN lower(COALESCE(active,'')) IN ('t','true','1','yes') THEN 'active'
    ELSE 'inactive'
  END,
  COALESCE(NULLIF(created_at,''), now()::text)::timestamptz,
  COALESCE(NULLIF(created_at,''), now()::text)::timestamptz,
  'smart_order',
  id
FROM staging.categories_raw
ON CONFLICT (id) DO NOTHING;

-- 10) Catalog products
INSERT INTO catalog.products (
  id, tenant_id, category_id, name, sku, price, currency, description, metadata, status, created_at, updated_at, legacy_source, legacy_id
)
SELECT
  NULLIF(p.id,'')::uuid,
  NULLIF(p.tenant_id,'')::uuid,
  NULLIF(p.category_id,'')::uuid,
  COALESCE(NULLIF(p.name,''),'Unnamed Product'),
  COALESCE(NULLIF(p.sku,''), 'SKU-' || p.id),
  CASE WHEN NULLIF(p.price,'') ~ '^[0-9]+(\.[0-9]+)?$' THEN p.price::numeric(12,2) ELSE 0::numeric(12,2) END,
  'USD',
  NULLIF(p.description,''),
  COALESCE(NULLIF(p.meta,''),'{}')::jsonb,
  CASE
    WHEN lower(COALESCE(p.is_active,'')) IN ('t','true','1','yes') THEN 'active'
    WHEN lower(COALESCE(p.active,'')) IN ('t','true','1','yes') THEN 'active'
    ELSE 'inactive'
  END,
  COALESCE(NULLIF(p.created_at,''), now()::text)::timestamptz,
  COALESCE(NULLIF(p.created_at,''), now()::text)::timestamptz,
  'smart_order',
  p.id
FROM staging.products_raw p
ON CONFLICT (id) DO NOTHING;

-- Re-enable RLS
ALTER TABLE saas.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.products ENABLE ROW LEVEL SECURITY;

COMMIT;
