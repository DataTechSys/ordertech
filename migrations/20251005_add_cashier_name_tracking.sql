BEGIN;

-- Add cashier_name field to track the cashier connected to each display
-- This allows displays to show the actual cashier name and lets other cashiers 
-- know which displays are occupied and by whom

ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS cashier_name TEXT NULL,
ADD COLUMN IF NOT EXISTS cashier_device_id TEXT NULL;

-- Add indexes for efficient lookups
CREATE INDEX IF NOT EXISTS ix_devices_cashier_device_id ON devices(cashier_device_id) WHERE cashier_device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_devices_connection_cashier ON devices(tenant_id, connection_status, cashier_name) WHERE cashier_name IS NOT NULL;

-- Update the device status update function to handle cashier name
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
    disconnected_at = CASE WHEN p_connection_status = 'offline' THEN now() ELSE disconnected_at END,
    connected_peer_info = CASE 
      WHEN p_peer_device_id IS NOT NULL THEN jsonb_build_object('peer_device_id', p_peer_device_id, 'peer_role', p_peer_role, 'connected_at', now())
      WHEN p_connection_status = 'offline' THEN NULL
      ELSE connected_peer_info
    END,
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
  
  -- Log connection event with cashier name
  INSERT INTO device_connection_events (
    tenant_id, device_id, event_type, session_id, peer_device_id, peer_role, metadata
  ) VALUES (
    p_tenant_id, 
    p_device_id, 
    CASE 
      WHEN p_connection_status = 'offline' THEN 'offline'
      WHEN p_connection_status = 'online' THEN 'online'
      WHEN p_connection_status = 'connected' AND p_peer_device_id IS NOT NULL THEN 'peer_connected'
      WHEN p_connection_status = 'connected' THEN 'session_start'
      WHEN p_connection_status = 'busy' THEN 'peer_connected'
      ELSE p_connection_status
    END,
    p_session_id,
    p_peer_device_id,
    p_peer_role,
    COALESCE(p_metadata, '{}') || 
    CASE WHEN p_cashier_name IS NOT NULL THEN jsonb_build_object('cashier_name', p_cashier_name) ELSE '{}' END
  );
END;
$$ LANGUAGE plpgsql;

-- Update the live_device_status view to include cashier information
CREATE OR REPLACE VIEW live_device_status AS
SELECT 
  d.device_id,
  d.tenant_id,
  d.device_name as name,
  d.role::text as role,
  d.status::text as device_status,
  d.branch,
  d.branch_id,
  d.connection_status,
  d.current_session_id,
  d.last_seen,
  d.connected_at,
  d.disconnected_at,
  d.connected_peer_info,
  d.cashier_name,
  d.cashier_device_id,
  -- Calculate if device is truly online (heartbeat within last 15 seconds)
  CASE 
    WHEN d.last_seen > (now() - interval '15 seconds') THEN true 
    ELSE false 
  END as online,
  -- Calculate if device is in active session
  CASE 
    WHEN d.current_session_id IS NOT NULL AND d.connection_status IN ('connected', 'busy') THEN true 
    ELSE false 
  END as in_session,
  -- Latest connection event
  (SELECT event_type FROM device_connection_events dce 
   WHERE dce.device_id = d.device_id AND dce.tenant_id = d.tenant_id 
   ORDER BY dce.created_at DESC LIMIT 1) as latest_event
FROM devices d
WHERE d.status = 'active';

-- Update the get_live_devices function to return cashier information
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
  peer_info JSONB,
  cashier_name TEXT,
  cashier_device_id TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    lds.device_id,
    lds.name,
    lds.role,
    lds.branch,
    lds.branch_id,
    lds.online,
    lds.in_session as connected,
    (lds.connection_status = 'busy') as busy,
    lds.current_session_id as session_id,
    lds.last_seen,
    lds.connected_at,
    lds.connected_peer_info as peer_info,
    lds.cashier_name,
    lds.cashier_device_id
  FROM live_device_status lds
  WHERE lds.tenant_id = p_tenant_id
    AND lds.device_status = 'active'
  ORDER BY 
    lds.online DESC, 
    lds.connection_status DESC,
    lds.name ASC;
END;
$$ LANGUAGE plpgsql;

-- Update the notification trigger to include cashier name
CREATE OR REPLACE FUNCTION notify_device_status_change() 
RETURNS TRIGGER AS $$
BEGIN
  -- Send notification for real-time updates to listening applications
  PERFORM pg_notify(
    'device_status_change', 
    json_build_object(
      'tenant_id', COALESCE(NEW.tenant_id, OLD.tenant_id),
      'device_id', COALESCE(NEW.device_id, OLD.device_id),
      'event', TG_OP,
      'old_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.connection_status ELSE NULL END,
      'new_status', CASE WHEN TG_OP != 'DELETE' THEN NEW.connection_status ELSE NULL END,
      'session_id', CASE WHEN TG_OP != 'DELETE' THEN NEW.current_session_id ELSE NULL END,
      'cashier_name', CASE WHEN TG_OP != 'DELETE' THEN NEW.cashier_name ELSE NULL END,
      'cashier_device_id', CASE WHEN TG_OP != 'DELETE' THEN NEW.cashier_device_id ELSE NULL END,
      'timestamp', extract(epoch from now())
    )::text
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Update trigger to also fire on cashier_name changes
DROP TRIGGER IF EXISTS trg_device_connection_status_change ON devices;
CREATE TRIGGER trg_device_connection_status_change
  AFTER INSERT OR UPDATE OF connection_status, current_session_id, cashier_name, cashier_device_id OR DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION notify_device_status_change();

COMMIT;