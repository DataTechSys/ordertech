-- 20250918_seed_permissions_and_roles.sql — minimal seed for permissions and default roles per tenant
SET lock_timeout = '10s';
SET statement_timeout = '5min';

-- Seed permissions (idempotent)
INSERT INTO public.permissions (code, description) VALUES
  ('tenant.manage','Manage tenant settings'),
  ('branches.read','Read branches'),
  ('branches.write','Create/update branches'),
  ('devices.read','Read devices'),
  ('devices.write','Create/update devices'),
  ('users.read','Read users'),
  ('users.write','Create/update users'),
  ('roles.read','Read roles'),
  ('roles.write','Create/update roles'),
  ('permissions.read','Read permissions'),
  ('permissions.write','Create/update permissions'),
  ('subscriptions.read','Read subscriptions'),
  ('subscriptions.write','Create/update subscriptions'),
  ('audit.read','Read audit logs')
ON CONFLICT (code) DO NOTHING;

-- Default roles per tenant
WITH role_defs(role_name, description) AS (
  VALUES
    ('Owner','Full access'),
    ('Admin','Administrative access'),
    ('Manager','Manage core entities'),
    ('Staff','Operational read access'),
    ('Viewer','Read-only')
)
INSERT INTO public.roles (tenant_id, role_name, description)
SELECT t.tenant_id, rd.role_name, rd.description
FROM public.tenants t
CROSS JOIN role_defs rd
ON CONFLICT (tenant_id, role_name) DO NOTHING;

-- Map roles to permissions
-- Owner → all permissions
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.role_name = 'Owner'
ON CONFLICT DO NOTHING;

-- Admin → all except tenant.manage
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r
JOIN public.permissions p ON p.code <> 'tenant.manage'
WHERE r.role_name = 'Admin'
ON CONFLICT DO NOTHING;

-- Manager → mid-tier
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r
JOIN public.permissions p ON p.code IN (
  'branches.read','branches.write',
  'devices.read','devices.write',
  'users.read','users.write',
  'roles.read','permissions.read',
  'subscriptions.read','audit.read'
)
WHERE r.role_name = 'Manager'
ON CONFLICT DO NOTHING;

-- Staff → basic read
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('branches.read','devices.read','users.read')
WHERE r.role_name = 'Staff'
ON CONFLICT DO NOTHING;

-- Viewer → read-only
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM public.roles r
JOIN public.permissions p ON p.code IN ('branches.read','devices.read','users.read','audit.read')
WHERE r.role_name = 'Viewer'
ON CONFLICT DO NOTHING;
