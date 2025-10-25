-- Add cashier name tracking fields to existing devices table
ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'offline';

ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS current_session_id TEXT NULL;

ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS cashier_name TEXT NULL;

ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS cashier_device_id TEXT NULL;

ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ NULL;

-- Add indexes for efficient lookups  
CREATE INDEX IF NOT EXISTS ix_devices_connection_status ON devices(tenant_id, connection_status);
CREATE INDEX IF NOT EXISTS ix_devices_cashier_device_id ON devices(cashier_device_id) WHERE cashier_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_devices_connection_cashier ON devices(tenant_id, connection_status, cashier_name) WHERE cashier_name IS NOT NULL;

-- Initialize existing devices with proper connection status
UPDATE devices 
SET connection_status = 'offline'
WHERE connection_status IS NULL;