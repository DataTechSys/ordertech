// Integration patch for server.js to use enhanced device status management
// Add this code to your server.js file

const DeviceStatusManager = require('./server-device-status.js');

// Add near the top of server.js after database setup
let deviceStatusManager = null;

// Initialize the device status manager after database connection is established
if (HAS_DB) {
  deviceStatusManager = new DeviceStatusManager(db, wss, clientMeta, basketClients);
  console.log('[Server] Enhanced device status management initialized');
}

// Enhance the existing WebSocket message handler
// Replace or enhance the existing WebSocket message handling code
wss.on('connection', (ws, req) => {
  const headers = req.headers || {};
  const forwarded = headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  const ip = forwarded.split(',')[0].trim();
  const userAgent = headers['user-agent'] || '';
  
  ws.on('message', async (data) => {
    try {
      const obj = JSON.parse(data);
      const type = String(obj.type || '');
      
      // Enhanced hello handling with device status tracking
      if (type === 'hello') {
        const basketId = String(obj.basketId || '').trim();
        const role = String(obj.role || '');
        const name = String(obj.name || '');
        const deviceId = String(obj.device_id || '');
        const token = String(obj.token || '');
        
        if (basketId && role) {
          let set = basketClients.get(basketId);
          if (!set) { set = new Set(); basketClients.set(basketId, set); }
          set.add(ws);
          
          const meta = {
            role, 
            name, 
            basketId, 
            device_id: deviceId, 
            token,
            tenant_id: req.tenantId,
            user_agent: userAgent,
            ip: ip,
            connected_at: new Date().toISOString()
          };
          clientMeta.set(ws, meta);
          
          // Notify device status manager of connection
          if (deviceStatusManager && deviceId && req.tenantId) {
            await deviceStatusManager.onWebSocketConnect(ws, meta);
          }
          
          console.log(`[ws] hello: ${role} "${name}" joined basket ${basketId} ${deviceId ? `(device: ${deviceId})` : ''}`);
          
          // Existing logic for peer status broadcasting
          setTimeout(() => broadcastPeerStatus(basketId), 100);
        }
      }
      
      // Enhanced session start handling
      else if (type === 'session:started' && obj.basketId) {
        const basketId = String(obj.basketId).trim();
        const s = getSession(basketId);
        if (!s.osn || s.status !== 'active') {
          s.osn = genOSN(); 
          s.status = 'active'; 
          s.started_at = Date.now();
          
          // Get cashier and display meta for session tracking
          if (deviceStatusManager) {
            const basketSet = basketClients.get(basketId);
            let cashierMeta = null, displayMeta = null;
            
            if (basketSet) {
              for (const clientWs of basketSet) {
                const meta = clientMeta.get(clientWs) || {};
                if (meta.role === 'cashier' && !cashierMeta) cashierMeta = meta;
                if (meta.role === 'display' && !displayMeta) displayMeta = meta;
              }
            }
            
            if (cashierMeta && displayMeta) {
              await deviceStatusManager.onSessionStart(basketId, cashierMeta, displayMeta);
            }
          }
        }
        
        broadcast(basketId, { type:'session:started', basketId, osn: s.osn });
        broadcastPeerStatus(basketId);
        broadcastAdminLive();
      }
      
      // Enhanced peer status handling
      else if (type === 'peer:status') {
        const basketId = String(obj.basketId || '').trim();
        if (basketId) {
          // Check if both cashier and display are connected
          const basketSet = basketClients.get(basketId);
          let cashierMeta = null, displayMeta = null;
          
          if (basketSet) {
            for (const clientWs of basketSet) {
              const meta = clientMeta.get(clientWs) || {};
              if (meta.role === 'cashier' && !cashierMeta) cashierMeta = meta;
              if (meta.role === 'display' && !displayMeta) displayMeta = meta;
            }
          }
          
          if (deviceStatusManager && cashierMeta && displayMeta && obj.status === 'connected') {
            await deviceStatusManager.onPeerConnected(basketId, cashierMeta, displayMeta);
          }
        }
      }
      
      // Handle other message types...
      // [Include other existing message handlers here]
      
    } catch (e) {
      console.error('[ws] message error:', e.message);
    }
  });
  
  // Enhanced disconnection handling
  ws.on('close', async () => {
    const meta = clientMeta.get(ws) || {};
    
    // Notify device status manager of disconnection
    if (deviceStatusManager && meta.device_id && meta.tenant_id) {
      await deviceStatusManager.onWebSocketDisconnect(ws, meta);
    }
    
    // Remove from basket clients
    if (meta.basketId) {
      const set = basketClients.get(meta.basketId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) basketClients.delete(meta.basketId);
      }
      
      // Check if this was the last client in a session
      if (deviceStatusManager && set && set.size === 0) {
        await deviceStatusManager.onSessionEnd(meta.basketId, 'all_disconnected');
      } else {
        // Broadcast updated peer status
        setTimeout(() => broadcastPeerStatus(meta.basketId), 100);
      }
    }
    
    clientMeta.delete(ws);
    console.log(`[ws] disconnect: ${meta.role} "${meta.name}" left basket ${meta.basketId || 'unknown'}`);
  });
});

// Enhanced /presence/displays endpoint
addRoute('get', '/presence/displays', requireTenant, async (req, res) => {
  const token = String(req.header('x-device-token') || '').trim();
  if (token && HAS_DB) {
    const rows = await db(`select role::text as role from devices where device_token=$1 and status='active'`, [token]);
    if (!rows.length) return res.status(401).json({ error: 'device_unauthorized' });
    if (rows[0].role !== 'cashier') return res.status(403).json({ error: 'device_role_invalid' });
    db(`update devices set last_seen=now() where device_token=$1`, [token]).catch(()=>{});
  }
  
  // Use enhanced device status manager if available
  let items = [];
  if (deviceStatusManager) {
    items = await deviceStatusManager.getDisplaysForCashier(req.tenantId);
  } else {
    // Fallback to existing logic
    let list = [];
    try { list = await computeLiveDevices(req.tenantId); } catch {}
    items = (list || [])
      .filter(it => String(it.role||'').toLowerCase() === 'display' && (it.online || it.connected))
      .map(it => ({ 
        id: it.id, 
        name: it.name, 
        branch: it.branch, 
        branch_id: it.branch_id || null, 
        online: !!it.online, 
        connected: !!it.connected, 
        busy: !!it.busy, 
        session_id: it.session_id || null, 
        last_seen: it.last_seen || null 
      }));
  }
  
  try { broadcastAdminLive(); } catch {}
  res.json({ items });
});

// Enhanced session end handling
addRoute('delete', '/webrtc/session/:pairId', async (req, res) => {
  const id = String(req.params.pairId||'').trim();
  const reason = String(req.query?.reason || '').trim() || 'user';
  
  // Notify device status manager of session end
  if (deviceStatusManager) {
    await deviceStatusManager.onSessionEnd(id, reason);
  }
  
  // Mark session ended in database
  if (HAS_DB) {
    try { 
      await ensureRtcSessionSchema(); 
      let tenantId = DEFAULT_TENANT_ID; 
      try { 
        const r = await db('select tenant_id from devices where device_id=$1', [id]); 
        if (r && r[0] && r[0].tenant_id) tenantId = r[0].tenant_id; 
      } catch {}
      await db('update rtc_sessions set ended_at=now() where tenant_id=$1 and basket_id=$2 and ended_at is null', [tenantId, id]); 
    } catch {} 
  }
  
  if (HAS_DB) {
    await db('delete from webrtc_rooms where pair_id=$1', [id]);
  } else {
    webrtcRooms.delete(id);
  }
  
  // Notify clients via websocket to tear down
  broadcast(id, { type: 'rtc:stopped', basketId: id, reason });
  console.log(`[rtc] DELETE /webrtc/session pair=${id} reason=${reason}`);
  broadcastAdminLive();
  res.json({ ok:true });
});

// Enhanced admin session eviction
addRoute('post', '/admin/sessions/:basketId/evict', verifyAuth, requireTenant, requireTenantAdminResolved, async (req, res) => {
  const id = String(req.params.basketId||'').trim();
  const reason = String(req.body?.reason||'admin').trim();
  if (!id) return res.status(400).json({ error: 'invalid_basket_id' });
  
  // Notify device status manager
  if (deviceStatusManager) {
    await deviceStatusManager.onSessionEnd(id, `admin_evict_${reason}`);
  }
  
  try { if (HAS_DB) await db('delete from webrtc_rooms where pair_id=$1', [id]); } catch {}
  try { sessions.delete(id); } catch {}
  try { broadcast(id, { type:'rtc:stopped', basketId: id, reason }); } catch {}
  try { broadcast(id, { type:'session:ended', basketId: id, reason }); } catch {}
  try { broadcastAdminLive(); } catch {}
  res.json({ ok:true });
});

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('[Server] Received SIGTERM, cleaning up...');
  if (deviceStatusManager) {
    await deviceStatusManager.cleanup();
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Server] Received SIGINT, cleaning up...');
  if (deviceStatusManager) {
    await deviceStatusManager.cleanup();
  }
  process.exit(0);
});

console.log('[Server] Enhanced device status management integration complete');