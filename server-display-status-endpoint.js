// Additional server endpoint for display apps to get their current connection status
// Add this to your server.js file

// Get current display connection status including cashier name
addRoute('get', '/display/status', requireTenant, async (req, res) => {
  const deviceId = String(req.header('x-device-id') || '').trim();
  const token = String(req.header('x-device-token') || '').trim();
  
  if (!deviceId) {
    return res.status(400).json({ error: 'device_id_required' });
  }
  
  if (!HAS_DB) {
    return res.status(503).json({ error: 'database_not_configured' });
  }
  
  try {
    // Verify device token and get device info
    const deviceResult = await db(`
      SELECT device_id, device_name as name, role::text as role, status::text as status, 
             connection_status, current_session_id, cashier_name, cashier_device_id,
             last_seen, connected_at, connected_peer_info
      FROM devices 
      WHERE device_id = $1 AND tenant_id = $2
    `, [deviceId, req.tenantId]);
    
    if (!deviceResult.length) {
      return res.status(404).json({ error: 'device_not_found' });
    }
    
    const device = deviceResult[0];
    
    // Verify device token if provided
    if (token && device.device_token !== token) {
      return res.status(401).json({ error: 'invalid_token' });
    }
    
    // Update last_seen timestamp
    try {
      await db('UPDATE devices SET last_seen = now() WHERE device_id = $1 AND tenant_id = $2', [deviceId, req.tenantId]);
    } catch (updateError) {
      console.warn('[Display Status] Failed to update last_seen:', updateError.message);
    }
    
    // Calculate connection status
    const isOnline = device.last_seen && new Date(device.last_seen).getTime() > (Date.now() - 15000); // 15 seconds
    const isConnected = device.connection_status === 'connected' || device.connection_status === 'busy';
    const hasCashier = device.cashier_name && device.cashier_device_id;
    
    const response = {
      device_id: device.device_id,
      name: device.name,
      role: device.role,
      status: device.status,
      online: isOnline,
      connected: isConnected,
      connection_status: device.connection_status,
      session_id: device.current_session_id,
      cashier_name: device.cashier_name,
      cashier_device_id: device.cashier_device_id,
      connected_at: device.connected_at,
      last_seen: device.last_seen,
      peer_info: device.connected_peer_info
    };
    
    console.log(`[Display Status] Device ${deviceId} status: ${device.connection_status}${hasCashier ? ` (cashier: ${device.cashier_name})` : ''}`);
    
    res.json(response);
  } catch (error) {
    console.error('[Display Status] Error getting device status:', error.message);
    res.status(500).json({ error: 'status_check_failed' });
  }
});

// WebSocket event handler for display apps to notify about their status
// This should be integrated into your existing WebSocket message handling
function handleDisplayStatusMessage(ws, message, clientMeta) {
  const { type, device_id, status, cashier_name, session_id } = message;
  
  if (type === 'display:status_update' && device_id && clientMeta.tenant_id) {
    if (deviceStatusManager) {
      // Update device status with any provided cashier info
      deviceStatusManager.updateDeviceStatus(
        clientMeta.tenant_id,
        device_id,
        status || 'online',
        session_id || null,
        null, // peer_device_id - will be set by session management
        null, // peer_role - will be set by session management  
        { ws_status_update: true, timestamp: Date.now() },
        cashier_name || null
      ).catch(error => {
        console.error('[Display Status] Failed to update via WebSocket:', error.message);
      });
    }
    
    console.log(`[Display Status] WebSocket update from ${device_id}: ${status}${cashier_name ? ` (cashier: ${cashier_name})` : ''}`);
  }
}

// Export the handler function for integration
module.exports = {
  handleDisplayStatusMessage
};