-- 20250918_pairing_codes_status_and_role.sql — explicit lifecycle for pairing codes
SET lock_timeout = '10s';
SET statement_timeout = '5min';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_activation_status') THEN
    CREATE TYPE device_activation_status AS ENUM ('pending','claimed','expired','canceled');
  END IF;
END$$;

-- Add lifecycle columns (idempotent)
ALTER TABLE IF EXISTS device_activation_codes
  ADD COLUMN IF NOT EXISTS status device_activation_status NOT NULL DEFAULT 'pending';

ALTER TABLE IF EXISTS device_activation_codes
  ADD COLUMN IF NOT EXISTS role device_role;

-- Preserve leading zeros: code must be exactly 6 digits
DO $$
BEGIN
  ALTER TABLE IF EXISTS device_activation_codes
    ADD CONSTRAINT chk_dac_code_6digits CHECK (code ~ '^\d{6}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN
  -- already exists; ignore
  NULL;
END$$;

-- Helpful index for admin lists and cleanup
CREATE INDEX IF NOT EXISTS ix_dac_tenant_status_expires
  ON device_activation_codes(tenant_id, status, expires_at DESC);
