// /js/unified-orders.js — Unified orders (cashier + Foodics) with admin shell integration
(function(){
  const { STATE, api } = window.Admin;
  const $ = (s, el=document) => el.querySelector(s);

  // State
  const OST = { 
    offset: 0, 
    limit: 50, 
    allOrders: [],
    filteredOrders: [],
    loading: false
  };

  // Utility functions
  function fmtKWD(n) { 
    if (n == null || isNaN(n)) return '—'; 
    try { 
      return new Intl.NumberFormat('en-KW', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      }).format(Number(n)) + ' KWD'; 
    } catch { 
      return Number(n).toFixed(3) + ' KWD'; 
    } 
  }
  
  function fmtTime(s) { 
    try { 
      const date = new Date(s);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
        hour: '2-digit', 
        minute: '2-digit'
      });
    } catch { 
      return s; 
    } 
  }

  function getSourceBadge(orderType) {
    if (orderType === 'local') {
      return '<span class="badge local"><i class="ri-store-2-line"></i> Local</span>';
    } else if (orderType === 'foodics') {
      return '<span class="badge foodics"><i class="ri-restaurant-line"></i> Foodics</span>';
    }
    return '<span class="badge">❓ Unknown</span>';
  }

  function getStatusBadge(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'paid') return '<span class="badge paid">Paid</span>';
    if (s === 'closed') return '<span class="badge closed">Closed</span>';
    if (s === 'completed') return '<span class="badge paid">Completed</span>';
    return `<span class="badge">${status || 'Unknown'}</span>`;
  }

  // Load orders from both sources
  async function loadLocalOrders(tenantId) {
    try {
      const response = await api(`/admin/tenants/${encodeURIComponent(tenantId)}/orders`, {
        tenantId,
        query: { limit: 1000 }
      });
      const items = Array.isArray(response.items) ? response.items : [];
      
      return items.map(item => ({
        ...item,
        orderType: 'local',
        orderId: item.ticket_no,
        orderDate: item.paid_at,
        customer: item.customer_name || 'Walk-in',
        branch: item.branch || item.location || 'Unknown',
        status: 'paid',
        total: Number(item.total || 0),
        currency: item.currency || 'KWD',
        items: Array.isArray(item.items) ? item.items : []
      }));
    } catch (error) {
      console.warn('Failed to load local orders:', error);
      return [];
    }
  }

  async function loadFoodicsOrders(tenantId) {
    try {
      const response = await api(`/admin/tenants/${encodeURIComponent(tenantId)}/sales-orders`, {
        tenantId,
        query: { limit: 1000 }
      });
      const items = Array.isArray(response.items) ? response.items : [];
      
      return items.map(item => ({
        ...item,
        orderType: 'foodics',
        orderId: item.external_id,
        orderDate: item.created_at,
        customer: item.customer_name || 'Walk-in',
        branch: item.branch_name || 'Unknown',
        status: item.status || 'unknown',
        total: Number(item.total || 0),
        currency: item.currency || 'KWD',
        items: Array.isArray(item.items) ? item.items : []
      }));
    } catch (error) {
      console.warn('Failed to load Foodics orders:', error);
      return [];
    }
  }

  // Filter and update display
  function applyFilters() {
    const sourceFilter = $('#sourceFilter');
    const statusFilter = $('#statusFilter');
    const daysFilter = $('#daysFilter');
    
    const source = sourceFilter ? sourceFilter.value : '';
    const status = statusFilter ? statusFilter.value.toLowerCase() : '';
    const days = daysFilter ? Number(daysFilter.value) || 0 : 7;
    
    OST.filteredOrders = OST.allOrders.filter(order => {
      // Source filter
      if (source && order.orderType !== source) return false;
      
      // Status filter
      if (status && String(order.status || '').toLowerCase() !== status) return false;
      
      // Days filter
      if (days > 0) {
        const orderDate = new Date(order.orderDate);
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        if (orderDate < cutoff) return false;
      }
      
      return true;
    });
    
    // Sort by date descending
    OST.filteredOrders.sort((a, b) => new Date(b.orderDate) - new Date(a.orderDate));
    
    updateStats();
    renderTable();
  }

  function updateStats() {
    const localOrders = OST.filteredOrders.filter(o => o.orderType === 'local');
    const foodicsOrders = OST.filteredOrders.filter(o => o.orderType === 'foodics');
    const totalAmount = OST.filteredOrders.reduce((sum, o) => sum + (o.total || 0), 0);
    
    const localCountEl = $('#localCount');
    const foodicsCountEl = $('#foodicsCount');
    const totalCountEl = $('#totalCount');
    const totalAmountEl = $('#totalAmount');
    
    if (localCountEl) localCountEl.textContent = localOrders.length;
    if (foodicsCountEl) foodicsCountEl.textContent = foodicsOrders.length;
    if (totalCountEl) totalCountEl.textContent = OST.filteredOrders.length;
    if (totalAmountEl) totalAmountEl.textContent = fmtKWD(totalAmount);
  }

  async function loadAllOrders() {
    const tenantId = STATE.selectedTenantId;
    if (!tenantId) {
      OST.allOrders = [];
      OST.filteredOrders = [];
      renderTable();
      updateStats();
      return;
    }
    
    if (OST.loading) return;
    OST.loading = true;
    
    const tbody = $('#tbody');
    const ordersTable = $('#ordersTable');
    
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align: center; padding: 20px;">Loading orders from all sources…</td></tr>';
    }
    if (ordersTable) ordersTable.classList.add('loading');
    
    try {
      // Load both sources in parallel
      const [localOrders, foodicsOrders] = await Promise.all([
        loadLocalOrders(tenantId),
        loadFoodicsOrders(tenantId)
      ]);
      
      OST.allOrders = [...localOrders, ...foodicsOrders];
      OST.offset = 0; // Reset pagination
      applyFilters();
      
    } catch (error) {
      console.error('Failed to load orders:', error);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align: center; padding: 20px;">Failed to load orders</td></tr>';
      }
    } finally {
      OST.loading = false;
      if (ordersTable) ordersTable.classList.remove('loading');
    }
  }

  function renderTable() {
    const tbody = $('#tbody');
    const pageInfo = $('#ordersPageInfo');
    const prevBtn = $('#ordersPrev');
    const nextBtn = $('#ordersNext');
    
    if (!tbody) return;
    
    const start = OST.offset;
    const end = Math.min(start + OST.limit, OST.filteredOrders.length);
    const pageOrders = OST.filteredOrders.slice(start, end);
    
    if (pageOrders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align: center; padding: 40px;">No orders found</td></tr>';
      if (pageInfo) pageInfo.textContent = 'No results';
      return;
    }
    
    tbody.innerHTML = pageOrders.map(order => {
      const itemsStr = order.items.map(x => {
        const name = x.name || x.product_name || 'Unknown item';
        const qty = x.qty || x.quantity || 1;
        const price = x.price || x.unit_price || 0;
        return `${name} × ${qty}`;
      }).join('<br/>');
      
      return `<tr class="order-row" data-order-type="${order.orderType}" data-order-id="${order.orderId}" style="cursor: pointer;">
        <td>${getSourceBadge(order.orderType)}</td>
        <td class="nowrap">${order.orderId || ''}</td>
        <td class="nowrap">${fmtTime(order.orderDate)}</td>
        <td>${order.customer || ''}</td>
        <td>${order.branch || ''}</td>
        <td>${getStatusBadge(order.status)}</td>
        <td class="nowrap">${fmtKWD(order.total)}</td>
        <td class="order-items">${itemsStr || ''}</td>
      </tr>`;
    }).join('');
    
    if (pageInfo) pageInfo.textContent = `${start + 1}-${end} of ${OST.filteredOrders.length} orders`;
    if (prevBtn) prevBtn.disabled = start === 0;
    if (nextBtn) nextBtn.disabled = end >= OST.filteredOrders.length;
  }

  function openOrderDetails(orderType, orderId) {
    // Find the order in our data
    const order = OST.allOrders.find(o => o.orderType === orderType && String(o.orderId) === String(orderId));
    if (!order) return;

    const modal = $('#orderModal');
    const details = $('#orderDetails');
    if (!modal || !details) return;

    // Build order details HTML
    const itemsHtml = order.items.map(x => {
      const name = x.name || x.product_name || 'Unknown item';
      const qty = x.qty || x.quantity || 1;
      const price = x.price || x.unit_price || 0;
      return `<li><strong>${name}</strong> × ${qty} — ${fmtKWD(price)}</li>`;
    }).join('');

    details.innerHTML = `
      <div class="grid" style="grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
        <div><div class="muted">Source</div><div>${getSourceBadge(order.orderType)}</div></div>
        <div><div class="muted">Order ID</div><div>${order.orderId || ''}</div></div>
        <div><div class="muted">Date</div><div>${fmtTime(order.orderDate)}</div></div>
        <div><div class="muted">Customer</div><div>${order.customer || ''}</div></div>
        <div><div class="muted">Branch</div><div>${order.branch || ''}</div></div>
        <div><div class="muted">Status</div><div>${getStatusBadge(order.status)}</div></div>
        <div><div class="muted">Total</div><div>${fmtKWD(order.total)}</div></div>
        <div><div class="muted">Currency</div><div>${order.currency || 'KWD'}</div></div>
      </div>
      <div class="card">
        <div class="header"><div class="title">Items</div></div>
        <div class="body">
          <ul style="margin: 0; padding-left: 20px;">${itemsHtml || '<li>No items</li>'}</ul>
        </div>
      </div>
    `;
    
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function wireEventHandlers() {
    // Filter change handlers
    const sourceFilter = $('#sourceFilter');
    const statusFilter = $('#statusFilter');
    const daysFilter = $('#daysFilter');
    const refreshBtn = $('#refreshBtn');
    
    [sourceFilter, statusFilter, daysFilter].forEach(filter => {
      if (filter) {
        filter.addEventListener('change', () => {
          OST.offset = 0;
          applyFilters();
        });
      }
    });
    
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadAllOrders);
    }
    
    // Pagination handlers
    const prevBtn = $('#ordersPrev');
    const nextBtn = $('#ordersNext');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => { 
        OST.offset = Math.max(0, OST.offset - OST.limit); 
        renderTable(); 
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => { 
        OST.offset = Math.min(OST.offset + OST.limit, Math.max(0, OST.filteredOrders.length - OST.limit)); 
        renderTable(); 
      });
    }
    
    // Row click handler
    const tbody = $('#tbody');
    if (tbody) {
      tbody.addEventListener('click', (e) => {
        const row = e.target.closest('.order-row');
        if (row) {
          const orderType = row.dataset.orderType;
          const orderId = row.dataset.orderId;
          openOrderDetails(orderType, orderId);
        }
      });
    }
    
    // Modal handlers
    const modal = $('#orderModal');
    const closeBtn = $('#orderModalClose');
    const okBtn = $('#orderModalOk');
    
    const closeModal = () => {
      if (modal) {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
      }
    };
    
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (okBtn) okBtn.addEventListener('click', closeModal);
    
    // Close modal on backdrop click
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }
  }

  // Initialize when admin shell is ready
  Admin.bootstrapAuth(async function() {
    wireEventHandlers();
    
    // Load orders when tenant changes
    if (STATE.selectedTenantId) {
      await loadAllOrders();
    }
    
    // Listen for tenant changes
    window.addEventListener('tenantChanged', loadAllOrders);
  });
})();