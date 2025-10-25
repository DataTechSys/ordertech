BEGIN;

-- Add cashier name tracking fields to existing devices table
ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'offline' 
    CHECK (connection_status IN ('offline', 'online', 'connected', 'busy')),
ADD COLUMN IF NOT EXISTS current_session_id TEXT NULL,
ADD COLUMN IF NOT EXISTS cashier_name TEXT NULL,
ADD COLUMN IF NOT EXISTS cashier_device_id TEXT NULL,
ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ NULL;

-- Add indexes for efficient lookups  
CREATE INDEX IF NOT EXISTS ix_devices_connection_status ON devices(tenant_id, connection_status);
CREATE INDEX IF NOT EXISTS ix_devices_cashier_device_id ON devices(cashier_device_id) WHERE cashier_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_devices_connection_cashier ON devices(tenant_id, connection_status, cashier_name) WHERE cashier_name IS NOT NULL;

-- Simple function to update device connection status
CREATE OR REPLACE FUNCTION update_device_connection_status(
  p_tenant_id UUID,
  p_device_id TEXT,
  p_connection_status TEXT,
  p_session_id TEXT DEFAULT NULL,
  p_peer_device_id TEXT DEFAULT NULL,
  p_peer_role TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL,
  p_cashier_name TEXT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  -- Update device status including cashier name
  UPDATE devices 
  SET 
    connection_status = p_connection_status,
    current_session_id = p_session_id,
    connected_at = CASE WHEN p_connection_status IN ('connected', 'busy') THEN now() ELSE connected_at END,
    -- Set cashier name for displays when connected to a cashier
    cashier_name = CASE
      WHEN role = 'display' AND p_peer_role = 'cashier' AND p_cashier_name IS NOT NULL THEN p_cashier_name
      WHEN p_connection_status = 'offline' THEN NULL
      ELSE cashier_name
    END,
    -- Set cashier device ID for displays
    cashier_device_id = CASE
      WHEN role = 'display' AND p_peer_role = 'cashier' THEN p_peer_device_id
      WHEN p_connection_status = 'offline' THEN NULL
      ELSE cashier_device_id
    END,
    last_seen = now()
  WHERE tenant_id = p_tenant_id AND device_id = p_device_id;
END;
$$ LANGUAGE plpgsql;

-- Simple function to get live devices with cashier information
CREATE OR REPLACE FUNCTION get_live_devices(p_tenant_id UUID) 
RETURNS TABLE (
  device_id TEXT,
  name TEXT,
  role TEXT,
  branch TEXT,
  branch_id UUID,
  online BOOLEAN,
  connected BOOLEAN,
  busy BOOLEAN,
  session_id TEXT,
  last_seen TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  cashier_name TEXT,
  cashier_device_id TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.device_id::TEXT,
    d.device_name as name,
    d.role::text,
    d.branch,
    d.branch_id,
    -- Calculate if device is truly online (heartbeat within last 15 seconds)
    CASE 
      WHEN d.last_seen > (now() - interval '15 seconds') THEN true 
      ELSE false 
    END as online,
    -- Calculate if device is in active session
    CASE 
      WHEN d.current_session_id IS NOT NULL AND d.connection_status IN ('connected', 'busy') THEN true 
      ELSE false 
    END as connected,
    (d.connection_status = 'busy') as busy,
    d.current_session_id as session_id,
    d.last_seen,
    d.connected_at,
    d.cashier_name,
    d.cashier_device_id
  FROM devices d
  WHERE d.tenant_id = p_tenant_id
    AND d.status = 'active'
  ORDER BY 
    d.last_seen DESC NULLS LAST,
    d.device_name ASC;
END;
$$ LANGUAGE plpgsql;

-- Initialize existing devices with proper connection status
UPDATE devices 
SET 
  connection_status = CASE 
    WHEN last_seen > (now() - interval '15 seconds') THEN 'online'
    ELSE 'offline'
  END
WHERE connection_status IS NULL;

COMMIT;