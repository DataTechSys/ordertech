-- 20250901_devices_short_code_and_events.sql — device short_code and device_events
-- Idempotent and safe

-- Add 6-digit short_code to devices (generated for existing rows)
ALTER TABLE IF EXISTS devices
  ADD COLUMN IF NOT EXISTS short_code char(6);

-- Backfill any missing short_code values
UPDATE devices
SET short_code = lpad(floor(random()*1000000)::text, 6, '0')
WHERE short_code IS NULL;

-- Create device_events table for activity logs
CREATE TABLE IF NOT EXISTS device_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS ix_device_events_device_time ON device_events(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_device_events_tenant_time ON device_events(tenant_id, created_at DESC);

