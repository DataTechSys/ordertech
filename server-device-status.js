// Enhanced Device Status Management
// This module provides real-time device status coordination using the database
// and WebSocket notifications to keep all clients synchronized

const { Client } = require('pg');

class DeviceStatusManager {
  constructor(db, wss, clientMeta, basketClients) {
    this.db = db;
    this.wss = wss;
    this.clientMeta = clientMeta;
    this.basketClients = basketClients;
    this.notifyClient = null;
    this.setupDatabaseNotifications();
  }

  // Set up PostgreSQL LISTEN for real-time database notifications
  async setupDatabaseNotifications() {
    if (!this.db) return;
    
    try {
      // Create a separate connection for LISTEN/NOTIFY
      this.notifyClient = new Client({
        // Use same connection params as main db
        connectionString: process.env.DATABASE_URL,
      });
      
      await this.notifyClient.connect();
      
      // Listen for device status changes
      await this.notifyClient.query('LISTEN device_status_change');
      
      this.notifyClient.on('notification', (msg) => {
        if (msg.channel === 'device_status_change') {
          this.handleDeviceStatusNotification(JSON.parse(msg.payload));
        }
      });
      
      console.log('[DeviceStatus] Database notifications enabled');
    } catch (error) {
      console.warn('[DeviceStatus] Failed to setup database notifications:', error.message);
    }
  }

  // Handle database notifications and broadcast to WebSocket clients
  handleDeviceStatusNotification(data) {
    console.log('[DeviceStatus] Received notification:', data);
    
    // Broadcast to admin clients
    this.broadcastToAdminClients({
      type: 'device:status_change',
      ...data,
      timestamp: Date.now()
    });
    
    // Broadcast to cashier clients for display list updates
    this.broadcastToRoleClients('cashier', {
      type: 'displays:update',
      device_id: data.device_id,
      tenant_id: data.tenant_id,
      status: data.new_status,
      session_id: data.session_id,
      timestamp: Date.now()
    });
    
    // Trigger admin live dashboard update
    try {
      require('./server.js').broadcastAdminLive();
    } catch {}
  }

  // Update device connection status in database
  async updateDeviceStatus(tenantId, deviceId, connectionStatus, sessionId = null, peerDeviceId = null, peerRole = null, metadata = {}, cashierName = null) {
    if (!this.db) return false;
    
    try {
      await this.db.query(`
        SELECT update_device_connection_status($1, $2, $3, $4, $5, $6, $7, $8)
      `, [tenantId, deviceId, connectionStatus, sessionId, peerDeviceId, peerRole, JSON.stringify(metadata), cashierName]);
      
      console.log(`[DeviceStatus] Updated ${deviceId}: ${connectionStatus}${sessionId ? ` (session: ${sessionId})` : ''}${cashierName ? ` (cashier: ${cashierName})` : ''}`);
      return true;
    } catch (error) {
      console.error('[DeviceStatus] Failed to update device status:', error.message);
      return false;
    }
  }

  // Get live devices using enhanced database function
  async getLiveDevices(tenantId) {
    if (!this.db) return [];
    
    try {
      const result = await this.db.query(`
        SELECT * FROM get_live_devices($1)
      `, [tenantId]);
      
      return result.rows.map(device => ({
        id: device.device_id,
        name: device.name,
        role: device.role,
        branch: device.branch,
        branch_id: device.branch_id,
        online: device.online,
        connected: device.connected,
        busy: device.busy,
        session_id: device.session_id,
        last_seen: device.last_seen,
        connected_at: device.connected_at,
        peer_info: device.peer_info
      }));
    } catch (error) {
      console.error('[DeviceStatus] Failed to get live devices:', error.message);
      return [];
    }
  }

  // Handle WebSocket connection events
  async onWebSocketConnect(ws, meta) {
    if (!meta.device_id || !meta.tenant_id) return;
    
    // Update device to online status
    await this.updateDeviceStatus(
      meta.tenant_id, 
      meta.device_id, 
      'online',
      null, // no session yet
      null, // no peer yet
      null, // no peer role yet
      { ws_connected: true, user_agent: meta.user_agent || null }
    );
  }

  // Handle WebSocket disconnection events
  async onWebSocketDisconnect(ws, meta) {
    if (!meta.device_id || !meta.tenant_id) return;
    
    // Update device to offline status
    await this.updateDeviceStatus(
      meta.tenant_id, 
      meta.device_id, 
      'offline',
      null, // clear session
      null, // clear peer
      null, // clear peer role
      { ws_disconnected: true, disconnect_time: new Date().toISOString() }
    );
  }

  // Handle session start events
  async onSessionStart(basketId, cashierMeta, displayMeta) {
    if (!cashierMeta?.tenant_id || !displayMeta?.tenant_id) return;
    
    // Update cashier status
    if (cashierMeta.device_id) {
      await this.updateDeviceStatus(
        cashierMeta.tenant_id,
        cashierMeta.device_id,
        'connected',
        basketId,
        displayMeta.device_id,
        'display',
        { session_started: true, partner_name: displayMeta.name }
      );
    }
    
    // Update display status with cashier name
    if (displayMeta.device_id) {
      await this.updateDeviceStatus(
        displayMeta.tenant_id,
        displayMeta.device_id,
        'connected',
        basketId,
        cashierMeta.device_id,
        'cashier',
        { session_started: true, partner_name: cashierMeta.name },
        cashierMeta.name // Pass cashier name to store in database
      );
    }
    
    console.log(`[DeviceStatus] Session started: ${basketId} (${cashierMeta.name} <-> ${displayMeta.name})`);
  }

  // Handle peer connection events (when both cashier and display are connected)
  async onPeerConnected(basketId, cashierMeta, displayMeta) {
    if (!cashierMeta?.tenant_id || !displayMeta?.tenant_id) return;
    
    // Update both devices to busy status
    if (cashierMeta.device_id) {
      await this.updateDeviceStatus(
        cashierMeta.tenant_id,
        cashierMeta.device_id,
        'busy',
        basketId,
        displayMeta.device_id,
        'display',
        { peer_connected: true, peer_name: displayMeta.name }
      );
    }
    
    // Update display with cashier name
    if (displayMeta.device_id) {
      await this.updateDeviceStatus(
        displayMeta.tenant_id,
        displayMeta.device_id,
        'busy',
        basketId,
        cashierMeta.device_id,
        'cashier',
        { peer_connected: true, peer_name: cashierMeta.name },
        cashierMeta.name // Pass cashier name to store in database
      );
    }
    
    console.log(`[DeviceStatus] Peers connected: ${basketId} (${cashierMeta.name} <-> ${displayMeta.name})`);
  }

  // Handle session end events
  async onSessionEnd(basketId, reason = 'session_end') {
    // Find all devices in this session and reset their status
    const basketClients = this.basketClients.get(basketId);
    if (!basketClients) return;
    
    for (const ws of basketClients) {
      const meta = this.clientMeta.get(ws) || {};
      if (meta.device_id && meta.tenant_id) {
        await this.updateDeviceStatus(
          meta.tenant_id,
          meta.device_id,
          'online', // back to online but not in session
          null, // clear session
          null, // clear peer
          null, // clear peer role
          { session_ended: true, reason }
        );
      }
    }
    
    console.log(`[DeviceStatus] Session ended: ${basketId} (${reason})`);
  }

  // Broadcast message to all admin clients
  broadcastToAdminClients(message) {
    const payload = JSON.stringify(message);
    let sentCount = 0;
    
    for (const ws of this.wss.clients) {
      const meta = this.clientMeta.get(ws) || {};
      if (meta.role === 'admin' && ws.readyState === ws.OPEN) {
        try {
          ws.send(payload);
          sentCount++;
        } catch (error) {
          console.warn('[DeviceStatus] Failed to send to admin client:', error.message);
        }
      }
    }
    
    if (sentCount > 0) {
      console.log(`[DeviceStatus] Broadcasted to ${sentCount} admin clients`);
    }
  }

  // Broadcast message to clients with specific role
  broadcastToRoleClients(role, message) {
    const payload = JSON.stringify(message);
    let sentCount = 0;
    
    for (const ws of this.wss.clients) {
      const meta = this.clientMeta.get(ws) || {};
      if (meta.role === role && ws.readyState === ws.OPEN) {
        try {
          ws.send(payload);
          sentCount++;
        } catch (error) {
          console.warn(`[DeviceStatus] Failed to send to ${role} client:`, error.message);
        }
      }
    }
    
    if (sentCount > 0) {
      console.log(`[DeviceStatus] Broadcasted to ${sentCount} ${role} clients`);
    }
  }

  // Enhanced presence/displays endpoint that uses database status
  async getDisplaysForCashier(tenantId, includeOffline = false) {
    try {
      const devices = await this.getLiveDevices(tenantId);
      
      return devices
        .filter(device => 
          device.role === 'display' && 
          (includeOffline || device.online)
        )
        .map(device => ({
          id: device.id,
          name: device.name,
          branch: device.branch,
          branch_id: device.branch_id,
          online: device.online,
          connected: device.connected,
          busy: device.busy,
          session_id: device.session_id,
          last_seen: device.last_seen,
          connected_at: device.connected_at,
          peer_info: device.peer_info,
          cashier_name: device.cashier_name,
          cashier_device_id: device.cashier_device_id
        }));
    } catch (error) {
      console.error('[DeviceStatus] Failed to get displays for cashier:', error.message);
      return [];
    }
  }

  // Clean up on shutdown
  async cleanup() {
    if (this.notifyClient) {
      try {
        await this.notifyClient.end();
        console.log('[DeviceStatus] Database notifications cleaned up');
      } catch (error) {
        console.warn('[DeviceStatus] Error during cleanup:', error.message);
      }
    }
  }
}

module.exports = DeviceStatusManager;