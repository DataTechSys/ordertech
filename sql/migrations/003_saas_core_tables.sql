-- Migration: 003_saas_core_tables.sql
-- Purpose: Create core SaaS tables under saas schema using CSV column names, with constraints and soft-deletion.

-- ============
-- saas.tenants
-- ============
CREATE TABLE IF NOT EXISTS saas.tenants (
  tenant_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name  varchar(100) NOT NULL,
  subdomain     varchar(50)  NOT NULL,
  domain        text,
  email         varchar(100) NOT NULL,
  status        varchar(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','trial','suspended','inactive','deleted')),
  start_date    date,
  renewal_date  date,
  plan_type     varchar(20),
  timezone      text NOT NULL DEFAULT 'UTC',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_subdomain ON saas.tenants (subdomain);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_domain_partial ON saas.tenants (domain) WHERE domain IS NOT NULL;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_tenants_updated_at ON saas.tenants;
CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON saas.tenants
FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- =============
-- saas.branches
-- =============
CREATE TABLE IF NOT EXISTS saas.branches (
  branch_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  branch_name   varchar(100) NOT NULL,
  location      varchar(255),
  expiry_date   date,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  UNIQUE (tenant_id, branch_name)
);
CREATE INDEX IF NOT EXISTS ix_branches_tenant_id ON saas.branches(tenant_id);
DROP TRIGGER IF EXISTS trg_branches_updated_at ON saas.branches;
CREATE TRIGGER trg_branches_updated_at BEFORE UPDATE ON saas.branches FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- ==========
-- saas.roles
-- ==========
CREATE TABLE IF NOT EXISTS saas.roles (
  role_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  role_name     varchar(50) NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role_name)
);
CREATE INDEX IF NOT EXISTS ix_roles_tenant_id ON saas.roles(tenant_id);
DROP TRIGGER IF EXISTS trg_roles_updated_at ON saas.roles;
CREATE TRIGGER trg_roles_updated_at BEFORE UPDATE ON saas.roles FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- ==========
-- saas.users
-- ==========
CREATE TABLE IF NOT EXISTS saas.users (
  user_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  branch_id     uuid REFERENCES saas.branches(branch_id) ON DELETE SET NULL,
  email         varchar(100) NOT NULL,
  password_hash text NOT NULL,
  name          varchar(100),
  role_id       uuid REFERENCES saas.roles(role_id) ON DELETE SET NULL,
  status        varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','locked','pending','deleted')),
  last_login    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
-- Case-insensitive uniqueness per tenant for email
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_tenant_email ON saas.users(tenant_id, lower(email));
CREATE INDEX IF NOT EXISTS ix_users_tenant_id ON saas.users(tenant_id);
CREATE INDEX IF NOT EXISTS ix_users_branch_id ON saas.users(branch_id);
CREATE INDEX IF NOT EXISTS ix_users_role_id ON saas.users(role_id);
DROP TRIGGER IF EXISTS trg_users_updated_at ON saas.users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON saas.users FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- =================
-- saas.permissions
-- =================
CREATE TABLE IF NOT EXISTS saas.permissions (
  permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          varchar(100) NOT NULL UNIQUE,
  description   text
);

-- =====================
-- saas.role_permissions
-- =====================
CREATE TABLE IF NOT EXISTS saas.role_permissions (
  role_id        uuid NOT NULL REFERENCES saas.roles(role_id) ON DELETE RESTRICT,
  permission_id  uuid NOT NULL REFERENCES saas.permissions(permission_id) ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS ix_role_permissions_role_id ON saas.role_permissions(role_id);
CREATE INDEX IF NOT EXISTS ix_role_permissions_permission_id ON saas.role_permissions(permission_id);

-- ============
-- saas.devices
-- ============
CREATE TABLE IF NOT EXISTS saas.devices (
  device_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  branch_id       uuid REFERENCES saas.branches(branch_id) ON DELETE SET NULL,
  device_name     varchar(100) NOT NULL,
  uuid            uuid NOT NULL DEFAULT gen_random_uuid(),
  activation_token varchar(100),
  status          varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','pending','retired','deleted')),
  expiry_date     date,
  last_checkin    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (uuid)
);
CREATE INDEX IF NOT EXISTS ix_devices_tenant_id ON saas.devices(tenant_id);
CREATE INDEX IF NOT EXISTS ix_devices_branch_id ON saas.devices(branch_id);
DROP TRIGGER IF EXISTS trg_devices_updated_at ON saas.devices;
CREATE TRIGGER trg_devices_updated_at BEFORE UPDATE ON saas.devices FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- ==================
-- saas.subscriptions
-- ==================
CREATE TABLE IF NOT EXISTS saas.subscriptions (
  subscription_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  start_date       date,
  end_date         date,
  is_active        boolean NOT NULL DEFAULT true,
  devices_allowed  int,
  branches_allowed int,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_subscriptions_tenant_id ON saas.subscriptions(tenant_id);
DROP TRIGGER IF EXISTS trg_subscriptions_updated_at ON saas.subscriptions;
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON saas.subscriptions FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();
