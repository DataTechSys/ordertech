-- 002_devices.sql — licensing and device activation

-- Add license_limit to tenants
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS license_limit integer NOT NULL DEFAULT 1;

-- Create device_role enum if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_role') THEN
    CREATE TYPE device_role AS ENUM ('cashier','display');
  END IF;
END$$;

-- Create device_status enum if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_status') THEN
    CREATE TYPE device_status AS ENUM ('active','revoked');
  END IF;
END$$;

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text,
  role device_role NOT NULL,
  status device_status NOT NULL DEFAULT 'active',
  branch text,
  device_token text UNIQUE NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  last_seen timestamptz,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Ensure columns exist when table already existed without new columns
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS role device_role,
  ADD COLUMN IF NOT EXISTS status device_status NOT NULL DEFAULT 'active';

-- Add tenant FK, compatible with either tenants(id) or tenants(tenant_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='devices' AND constraint_name='devices_tenant_fk'
  ) THEN
    BEGIN
      ALTER TABLE devices
        ADD CONSTRAINT devices_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_column THEN
      ALTER TABLE devices
        ADD CONSTRAINT devices_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    END;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_devices_tenant ON devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_role ON devices(tenant_id, role);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- Activation codes table
CREATE TABLE IF NOT EXISTS device_activation_codes (
  code text PRIMARY KEY,
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  device_id uuid REFERENCES devices(id),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Add tenant FK for activation codes, compatible with tenants(id) or tenants(tenant_id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='device_activation_codes' AND constraint_name='device_activation_codes_tenant_fk'
  ) THEN
    BEGIN
      ALTER TABLE device_activation_codes
        ADD CONSTRAINT device_activation_codes_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES tenants(id) ON DELETE CASCADE;
    EXCEPTION WHEN undefined_column THEN
      ALTER TABLE device_activation_codes
        ADD CONSTRAINT device_activation_codes_tenant_fk FOREIGN KEY (tenant_id)
        REFERENCES tenants(tenant_id) ON DELETE CASCADE;
    END;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_dac_tenant_expires ON device_activation_codes(tenant_id, expires_at);

