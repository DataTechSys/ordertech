BEGIN;

-- Add cashier name tracking fields to existing devices table
ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'offline',
ADD COLUMN IF NOT EXISTS current_session_id TEXT NULL,
ADD COLUMN IF NOT EXISTS cashier_name TEXT NULL,
ADD COLUMN IF NOT EXISTS cashier_device_id TEXT NULL,
ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ NULL;

-- Add check constraint for connection_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'devices_connection_status_check'
  ) THEN
    ALTER TABLE devices ADD CONSTRAINT devices_connection_status_check 
    CHECK (connection_status IN ('offline', 'online', 'connected', 'busy'));
  END IF;
END $$;

-- Add indexes for efficient lookups  
CREATE INDEX IF NOT EXISTS ix_devices_connection_status ON devices(tenant_id, connection_status);
CREATE INDEX IF NOT EXISTS ix_devices_cashier_device_id ON devices(cashier_device_id) WHERE cashier_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_devices_connection_cashier ON devices(tenant_id, connection_status, cashier_name) WHERE cashier_name IS NOT NULL;

-- Initialize existing devices with proper connection status
UPDATE devices 
SET 
  connection_status = CASE 
    WHEN last_seen > (now() - interval '15 seconds') THEN 'online'
    ELSE 'offline'
  END
WHERE connection_status IS NULL;

COMMIT;