// Enhanced Display Picker with Real-time Updates
// This enhances the existing cashier display selection to use real-time database updates

(function() {
  // Enhanced display list with real-time updates
  let displayListCache = [];
  let lastUpdateTimestamp = 0;
  let updateListeners = [];
  
  // WebSocket message handler for display updates
  function handleDisplayUpdateMessage(data) {
    console.log('[DisplayPicker] Received display update:', data);
    
    if (data.type === 'displays:update' && data.device_id) {
      // Update cached display list
      const index = displayListCache.findIndex(d => d.id === data.device_id);
      
      if (index >= 0) {
        // Update existing device
        displayListCache[index] = {
          ...displayListCache[index],
          online: data.status !== 'offline',
          connected: data.status === 'connected' || data.status === 'busy',
          busy: data.status === 'busy',
          session_id: data.session_id,
          last_updated: Date.now()
        };
      } else if (data.status !== 'offline') {
        // Add new device (refresh full list to get complete info)
        setTimeout(refreshDisplayList, 100);
        return;
      }
      
      // Notify all listeners
      notifyUpdateListeners(displayListCache);
      
      // Update UI if picker is visible
      updateDisplayPickerUI();
    }
    
    // Handle device status changes for admin dashboard
    else if (data.type === 'device:status_change') {
      console.log(`[DisplayPicker] Device ${data.device_id} status changed from ${data.old_status} to ${data.new_status}`);
      
      // Update any admin UI elements
      updateAdminDeviceStatus(data);
    }
  }
  
  // Enhanced display list fetching with caching
  async function fetchDisplays(forceRefresh = false) {
    const now = Date.now();
    
    // Use cache if recent (within 2 seconds) and not forcing refresh
    if (!forceRefresh && displayListCache.length > 0 && (now - lastUpdateTimestamp) < 2000) {
      return displayListCache;
    }
    
    try {
      const headers = {};
      const tok = getToken(); 
      if (tok) headers['x-device-token'] = tok;
      if (tenant) headers['x-tenant-id'] = tenant;
      
      const r = await fetch('/presence/displays', { headers });
      const j = await r.json();
      
      if (Array.isArray(j.items)) {
        displayListCache = j.items.map(item => ({
          ...item,
          last_updated: now
        }));
        lastUpdateTimestamp = now;
        
        console.log(`[DisplayPicker] Fetched ${displayListCache.length} displays`);
        notifyUpdateListeners(displayListCache);
        
        return displayListCache;
      }
    } catch (error) {
      console.error('[DisplayPicker] Failed to fetch displays:', error);
    }
    
    return displayListCache; // Return cached version on error
  }
  
  // Refresh display list and update UI
  async function refreshDisplayList() {
    const displays = await fetchDisplays(true);
    updateDisplayPickerUI();
    return displays;
  }
  
  // Register update listener
  function onDisplayListUpdate(callback) {
    updateListeners.push(callback);
    
    // Return unregister function
    return () => {
      const index = updateListeners.indexOf(callback);
      if (index >= 0) updateListeners.splice(index, 1);
    };
  }
  
  // Notify all update listeners
  function notifyUpdateListeners(displays) {
    updateListeners.forEach(callback => {
      try {
        callback(displays);
      } catch (error) {
        console.error('[DisplayPicker] Update listener error:', error);
      }
    });
  }
  
  // Enhanced display picker UI with real-time updates
  function updateDisplayPickerUI() {
    // Update any visible display picker dropdown
    const menu = document.getElementById('displayDropdown');
    if (menu) {
      const anchorEl = document.getElementById('btnPlay') || document.body;
      showDropdown(displayListCache, anchorEl);
    }
    
    // Update display flags in order summary
    renderDisplayFlags(displayListCache);
    
    // Update any admin dashboard elements
    updateAdminDisplayList(displayListCache);
  }
  
  // Enhanced display flags rendering with real-time status
  function renderDisplayFlags(items) {
    const el = document.getElementById('branchFlags');
    if (!el) return;
    
    el.innerHTML = '';
    const current = (basketId && basketId !== 'unpaired') ? String(basketId) : '';
    
    // Filter out currently connected device and sort by availability
    const others = (items || [])
      .filter(it => !(current && String(it.id) === current))
      .sort((a, b) => {
        // Sort by: online -> available -> busy -> offline
        const aScore = a.online ? (a.busy ? 1 : 0) : 2;
        const bScore = b.online ? (b.busy ? 1 : 0) : 2;
        if (aScore !== bScore) return aScore - bScore;
        return (a.name || '').localeCompare(b.name || '');
      });
    
    if (!others.length) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flag idle';
      btn.textContent = 'Pair';
      btn.onclick = async (ev) => {
        ev.preventDefault();
        const list = await fetchDisplays(true);
        showDropdown(list, btn);
      };
      el.appendChild(btn);
      return;
    }
    
    others.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      
      // Enhanced status classes based on real-time data
      let statusCls = 'idle';
      if (!it.online) {
        statusCls = 'offline';
      } else if (it.busy) {
        statusCls = 'busy';
      } else if (it.connected) {
        statusCls = 'waiting';
      }
      
      btn.className = `flag ${statusCls}`;
      
      const label = it.name || 'Display';
      btn.title = `${label}${it.branch ? ` — ${it.branch}` : ''} (${getStatusText(it)})`;
      btn.textContent = label;
      
      // Disable button if device is not available
      btn.disabled = !it.online || it.busy;
      
      btn.onclick = async (ev) => {
        ev.preventDefault();
        if (btn.disabled) return;
        
        try {
          const p = new URLSearchParams(location.search);
          p.set('basket', String(it.id));
          p.set('pair', '1');
          location.search = p.toString();
        } catch {}
      };
      
      el.appendChild(btn);
    });
  }
  
  // Get human-readable status text
  function getStatusText(device) {
    if (!device.online) return 'Offline';
    if (device.busy) return 'In Use';
    if (device.connected) return 'Connected';
    return 'Available';
  }
  
  // Enhanced dropdown with real-time status indicators
  function showDropdown(items, anchorEl) {
    const anchor = anchorEl || document.querySelector('#btnPlay') || document.body;
    const rectSrc = anchor.getBoundingClientRect ? anchor : document.body;
    const pillRect = rectSrc.getBoundingClientRect ? rectSrc.getBoundingClientRect() : { top: 20, left: 20, bottom: 40 };
    
    let menu = document.querySelector('#displayDropdown');
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'displayDropdown';
      Object.assign(menu.style, {
        position: 'absolute',
        top: (pillRect.bottom + window.scrollY + 8) + 'px',
        left: (pillRect.left + window.scrollX) + 'px',
        background: '#0b1220',
        border: '1px solid #243244',
        borderRadius: '8px',
        padding: '8px',
        zIndex: 3000,
        minWidth: '280px',
        maxWidth: 'min(360px, 90vw)',
        maxHeight: 'min(60vh, 480px)',
        overflowY: 'auto',
        color: '#fff',
        boxSizing: 'border-box',
        boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
      });
      document.body.appendChild(menu);
    } else {
      menu.style.top = (pillRect.bottom + window.scrollY + 8) + 'px';
      menu.style.left = (pillRect.left + window.scrollX) + 'px';
    }
    
    menu.innerHTML = '';
    
    if (!items.length) {
      menu.textContent = 'No displays online';
      repositionDropdown(menu, pillRect);
      return;
    }
    
    // Sort items by availability and name
    const sortedItems = [...items].sort((a, b) => {
      const aAvailable = a.online && !a.busy;
      const bAvailable = b.online && !b.busy;
      
      if (aAvailable !== bAvailable) {
        return bAvailable ? 1 : -1; // Available items first
      }
      
      return (a.name || '').localeCompare(b.name || '');
    });
    
    sortedItems.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      
      const available = it.online && !it.busy;
      const statusText = getStatusText(it);
      
      btn.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="text-align: left;">
            <div style="font-weight: 500;">${it.name || 'Display'}</div>
            ${it.branch ? `<div style="font-size: 0.85em; opacity: 0.7;">${it.branch}</div>` : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="status-indicator status-${it.online ? (it.busy ? 'busy' : 'available') : 'offline'}"></div>
            <span style="font-size: 0.8em; opacity: 0.8;">${statusText}</span>
          </div>
        </div>
      `;
      
      Object.assign(btn.style, {
        display: 'block',
        width: '100%',
        textAlign: 'left',
        background: available ? 'transparent' : 'rgba(255,255,255,0.05)',
        color: available ? '#fff' : '#888',
        border: 'none',
        padding: '12px',
        cursor: available ? 'pointer' : 'not-allowed',
        borderRadius: '4px',
        margin: '2px 0'
      });
      
      if (available) {
        btn.onmouseenter = () => btn.style.background = '#1f2937';
        btn.onmouseleave = () => btn.style.background = 'transparent';
        btn.onclick = () => {
          const params = new URLSearchParams(location.search);
          params.set('basket', it.id);
          params.set('pair', '1');
          canConnect = true;
          location.search = params.toString();
        };
      } else {
        btn.style.cursor = 'not-allowed';
      }
      
      menu.appendChild(btn);
    });
    
    // Add status indicator styles
    if (!document.getElementById('display-status-styles')) {
      const styles = document.createElement('style');
      styles.id = 'display-status-styles';
      styles.textContent = `
        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-available { background-color: #22c55e; }
        .status-busy { background-color: #f59e0b; }
        .status-offline { background-color: #ef4444; }
      `;
      document.head.appendChild(styles);
    }
    
    repositionDropdown(menu, pillRect);
    
    const onDoc = (ev) => { 
      if (!menu.contains(ev.target) && ev.target !== anchor) { 
        menu.remove(); 
        document.removeEventListener('click', onDoc); 
      } 
    };
    setTimeout(() => document.addEventListener('click', onDoc), 0);
  }
  
  // Update admin dashboard with device statuses
  function updateAdminDisplayList(displays) {
    // Update any admin dashboard elements if they exist
    const adminList = document.getElementById('admin-device-list');
    if (adminList && displays.length > 0) {
      // Render admin device list with enhanced status information
      // This would be implemented based on your admin dashboard structure
    }
  }
  
  // Handle individual device status changes in admin UI
  function updateAdminDeviceStatus(statusData) {
    const deviceElement = document.getElementById(`device-${statusData.device_id}`);
    if (deviceElement) {
      // Update device status indicator in admin UI
      const statusIndicator = deviceElement.querySelector('.device-status');
      if (statusIndicator) {
        statusIndicator.className = `device-status status-${statusData.new_status}`;
        statusIndicator.title = `Status: ${statusData.new_status}`;
      }
    }
  }
  
  // Start periodic refresh (fallback for when WebSocket updates aren't available)
  let refreshInterval;
  function startPeriodicRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    
    refreshInterval = setInterval(async () => {
      // Only refresh if no recent WebSocket updates
      const now = Date.now();
      if (now - lastUpdateTimestamp > 10000) { // 10 seconds
        await refreshDisplayList();
      }
    }, 15000); // Every 15 seconds
  }
  
  // Stop periodic refresh
  function stopPeriodicRefresh() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }
  
  // Enhanced WebSocket message handling (integrate with existing cashier WebSocket)
  if (typeof window !== 'undefined') {
    // Hook into existing WebSocket or create message handler
    const originalHandleWebSocketMessage = window.handleWebSocketMessage;
    window.handleWebSocketMessage = function(data) {
      // Handle display-related updates
      if (data.type === 'displays:update' || data.type === 'device:status_change') {
        handleDisplayUpdateMessage(data);
      }
      
      // Call original handler if it exists
      if (originalHandleWebSocketMessage) {
        originalHandleWebSocketMessage(data);
      }
    };
    
    // Start periodic refresh as fallback
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startPeriodicRefresh);
    } else {
      startPeriodicRefresh();
    }
    
    // Stop refresh when page unloads
    window.addEventListener('beforeunload', stopPeriodicRefresh);
  }
  
  // Export functions for global use
  window.EnhancedDisplayPicker = {
    fetchDisplays,
    refreshDisplayList,
    onDisplayListUpdate,
    showDropdown,
    renderDisplayFlags,
    startPeriodicRefresh,
    stopPeriodicRefresh,
    handleDisplayUpdateMessage
  };
  
  console.log('[DisplayPicker] Enhanced display picker with real-time updates loaded');
})();