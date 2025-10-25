-- 20250918_roles_permissions_subscriptions_audit.sql — add roles/permissions/role_permissions/subscriptions/audit_logs
SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ROLES (tenant-scoped); keep tenant_users enum-based roles as-is for now
CREATE TABLE IF NOT EXISTS public.roles (
  role_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
  role_name varchar(50) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role_name)
);
CREATE INDEX IF NOT EXISTS ix_roles_tenant ON public.roles(tenant_id);

-- PERMISSIONS (global)
CREATE TABLE IF NOT EXISTS public.permissions (
  permission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(100) UNIQUE NOT NULL,
  description text
);

-- ROLE_PERMISSIONS (tenant role -> permission)
CREATE TABLE IF NOT EXISTS public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(role_id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(permission_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- SUBSCRIPTIONS (allow multiple rows per tenant; is_active not unique)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
  start_date date,
  end_date date,
  is_active boolean DEFAULT true,
  devices_allowed int,
  branches_allowed int,
  notes text
);
CREATE INDEX IF NOT EXISTS ix_subscriptions_tenant ON public.subscriptions(tenant_id);

-- AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
  log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(tenant_id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(user_id) ON DELETE SET NULL,
  action varchar(100) NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  meta jsonb
);
CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_time ON public.audit_logs(tenant_id, "timestamp" DESC);
