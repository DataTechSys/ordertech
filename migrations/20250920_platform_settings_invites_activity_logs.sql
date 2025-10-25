BEGIN;

CREATE TABLE IF NOT EXISTS platform_settings (
  id text PRIMARY KEY,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (id, settings)
VALUES ('main','{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tenant_role') THEN
    CREATE TYPE tenant_role AS ENUM ('owner','admin','manager','viewer');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  email text NOT NULL,
  role tenant_role NOT NULL DEFAULT 'viewer',
  token text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  redeemed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_invites_tenant ON invites(tenant_id);

CREATE TABLE IF NOT EXISTS admin_activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  level text NOT NULL DEFAULT 'info',
  scope text NOT NULL,
  tenant_id uuid,
  actor text,
  action text,
  path text,
  method text,
  status integer,
  duration_ms integer,
  ip text,
  user_agent text,
  meta jsonb
);
CREATE INDEX IF NOT EXISTS ix_aal_ts ON admin_activity_logs(ts DESC);
CREATE INDEX IF NOT EXISTS ix_aal_tenant_ts ON admin_activity_logs(tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS ix_aal_action ON admin_activity_logs(action);

COMMIT;
