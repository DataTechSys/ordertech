BEGIN;

-- Enhanced device status tracking for real-time coordination
-- This migration adds better connection state persistence and WebSocket event coordination

-- Add enhanced connection status fields to devices table
ALTER TABLE devices 
ADD COLUMN IF NOT EXISTS connection_status TEXT DEFAULT 'offline' 
    CHECK (connection_status IN ('offline', 'online', 'connected', 'busy')),
ADD COLUMN IF NOT EXISTS current_session_id TEXT NULL,
ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS connected_peer_info JSONB DEFAULT NULL;

-- Create device connection events table for real-time coordination
CREATE TABLE IF NOT EXISTS device_connection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('online', 'offline', 'session_start', 'session_end', 'peer_connected', 'peer_disconnected')),
  session_id TEXT NULL,
  peer_device_id TEXT NULL,
  peer_role TEXT NULL CHECK (peer_role IN ('cashier', 'display', NULL)),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS ix_devices_connection_status ON devices(tenant_id, connection_status, last_seen DESC);
CREATE INDEX IF NOT EXISTS ix_devices_current_session ON devices(tenant_id, current_session_id) WHERE current_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_device_connection_events_tenant_created ON device_connection_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_device_connection_events_device_created ON device_connection_events(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_device_connection_events_session ON device_connection_events(session_id, created_at DESC) WHERE session_id IS NOT NULL;

-- Create a view for live device status that combines all information
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

-- Function to update device connection status atomically
CREATE OR REPLACE FUNCTION update_device_connection_status(
  p_tenant_id UUID,
  p_device_id TEXT,
  p_connection_status TEXT,
  p_session_id TEXT DEFAULT NULL,
  p_peer_device_id TEXT DEFAULT NULL,
  p_peer_role TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  -- Update device status
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
    last_seen = now()
  WHERE tenant_id = p_tenant_id AND device_id = p_device_id;
  
  -- Log connection event
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
    COALESCE(p_metadata, '{}')
  );
END;
$$ LANGUAGE plpgsql;

-- Function to get real-time device list with connection status
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
  peer_info JSONB
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
    lds.connected_peer_info as peer_info
  FROM live_device_status lds
  WHERE lds.tenant_id = p_tenant_id
    AND lds.device_status = 'active'
  ORDER BY 
    lds.online DESC, 
    lds.connection_status DESC,
    lds.name ASC;
END;
$$ LANGUAGE plpgsql;

-- Trigger to broadcast device status changes via NOTIFY
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
      'timestamp', extract(epoch from now())
    )::text
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger on devices table for real-time notifications
DROP TRIGGER IF EXISTS trg_device_connection_status_change ON devices;
CREATE TRIGGER trg_device_connection_status_change
  AFTER INSERT OR UPDATE OF connection_status, current_session_id OR DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION notify_device_status_change();

-- Initialize existing devices with proper connection status
UPDATE devices 
SET 
  connection_status = CASE 
    WHEN last_seen > (now() - interval '15 seconds') THEN 'online'
    ELSE 'offline'
  END
WHERE connection_status IS NULL;

COMMIT;