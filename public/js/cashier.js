(function() {
  const basketId = new URLSearchParams(location.search).get('basket') || 'lane-1';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  let reconnectDelay = 500;

  const state = {
    items: new Map(),
    total: 0,
    version: 0
  };

  function connect() {
    ws = new WebSocket(proto + '://' + location.host);
    ws.addEventListener('open', () => {
      setStatus('Connected');
      reconnectDelay = 500;
      ws.send(JSON.stringify({ type: 'subscribe', basketId }));
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'basket:sync' || msg.type === 'basket:update') {
        applyBasket(msg.basket);
      } else if (msg.type === 'error') {
        console.warn('WS error:', msg.error);
      }
    });
    ws.addEventListener('close', () => {
      setStatus('Disconnected - reconnecting...');
      setTimeout(connect, Math.min(reconnectDelay *= 2, 8000));
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
  }
  connect();

  function applyBasket(basket) {
    state.items = new Map((basket.items || []).map(i => [i.sku, i]));
    state.total = basket.total || 0;
    state.version = basket.version || 0;
    render();
  }

  function sendUpdate(op) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'basket:update', basketId, op }));
  }

  // Public API for UI buttons
  window.onAddItem = function(sku, name, price, qty = 1) {
    sendUpdate({ action: 'add', item: { sku, name, price }, qty });
  };
  window.onRemoveItem = function(sku) {
    sendUpdate({ action: 'remove', item: { sku } });
  };
  window.onSetQty = function(sku, qty) {
    sendUpdate({ action: 'setQty', item: { sku }, qty: Number(qty) });
  };
  window.onClearBasket = function() {
    sendUpdate({ action: 'clear' });
  };

  // Rendering logic
  function render() {
    const listEl = document.getElementById('basket-items-list');
    const totalEl = document.getElementById('basket-total');
    if (!listEl || !totalEl) return;

    listEl.innerHTML = '';
    for (const item of state.items.values()) {
      const itemEl = document.createElement('div');
      itemEl.className = 'basket-item';
      itemEl.dataset.sku = item.sku;
      itemEl.innerHTML = `
        <div class="item-name">${item.name}</div>
        <div class="item-price">${item.price.toFixed(3)} KWD</div>
        <div class="item-qty">
          <button onclick="onSetQty('${item.sku}', ${item.qty - 1})">-</button>
          <span>${item.qty}</span>
          <button onclick="onSetQty('${item.sku}', ${item.qty + 1})">+</button>
        </div>
        <div class="item-total">${(item.price * item.qty).toFixed(3)} KWD</div>
        <button class="item-remove" onclick="onRemoveItem('${item.sku}')">×</button>
      `;
      listEl.appendChild(itemEl);
    }
    totalEl.textContent = state.total.toFixed(3) + ' KWD';
  }

  function setStatus(text) {
    const s = document.getElementById('connection-status');
    if (s) s.textContent = text;
  }

  // Example: wire a Clear button if present
  const clearBtn = document.getElementById('clear-basket');
  if (clearBtn) clearBtn.addEventListener('click', () => window.onClearBasket());
})();
