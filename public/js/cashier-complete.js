(function() {
  const basketId = new URLSearchParams(location.search).get('basket') || 'lane-1';
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  let reconnectDelay = 500;

  const POPULER = 'Populer';
  let allProducts = [];
  let populerList = [];
  let imgById = new Map();

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
    renderBill();
  }

  function sendUpdate(op) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'basket:update', basketId, op }));
  }

  window.onAddItem = function(p) {
    sendUpdate({ action: 'add', item: { sku: p.id, name: p.name, price: p.price }, qty: 1 });
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

  const catsEl = document.querySelector('#cats');
  const gridEl = document.querySelector('#grid');

  const api = {
    get: async (url) => {
        const r = await fetch(url);
        return await r.json();
    }
  };

  async function init() {
    const cats = await api.get('/categories');
    allProducts = await api.get('/products');
    imgById = new Map(allProducts.map(p => [p.id, p.image_url]));
    populerList = computePopular(allProducts);
    const withPop = [{ name: POPULER }, ...cats];
    renderCategories(withPop);
    if (withPop[0]) {
      emitCategory(POPULER);
      await showCategory(POPULER);
      if (!populerList.length && cats[0]) {
        emitCategory(cats[0].name);
        await showCategory(cats[0].name);
      }
    }
  }
  init();

  function renderCategories(cats) {
    catsEl.innerHTML = '';
    cats.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'tab' + (i === 0 ? ' active' : '');
      b.textContent = c.name;
      b.onclick = async () => {
        Array.from(catsEl.querySelectorAll('.tab')).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        emitCategory(c.name);
        await showCategory(c.name);
      };
      catsEl.appendChild(b);
    });
  }

  function emitCategory(name){
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ui:selectCategory', basketId, name }));
      }
    } catch {}
  }

  async function showCategory(name) {
    if (name === POPULER) {
      renderProducts(populerList);
      return;
    }
    const prods = await api.get(`/products?category_name=${encodeURIComponent(name)}`);
    renderProducts(prods);
  }

  function renderProducts(list) {
    gridEl.innerHTML = '';
    list.forEach(p => {
      const card = document.createElement('button');
      card.className = 'tile';
      card.onclick = () => onProductClick(p);

      const img = document.createElement('img');
      const src = p.image_url || '/public/images/products/placeholder.jpg';
      img.src = src;
      img.addEventListener('load', () => {});
      img.onerror = () => {
        img.src = '/public/images/products/placeholder.jpg';
      };

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = p.name;

      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = `${fmtPrice(p.price)} KWD`;

      card.appendChild(img);
      card.appendChild(name);
      card.appendChild(price);
      gridEl.appendChild(card);
    });
  }

  function renderBill() {
    const billItemsEl = document.getElementById('billItems');
    const grandTotalEl = document.getElementById('grandTotal');

    billItemsEl.innerHTML = '';
    const mapped = [];
    for (const item of state.items.values()) {
      const thumb = imgById.get(item.sku) || '/public/images/products/placeholder.jpg';
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = thumb;
      img.onerror = () => { img.src = '/public/images/products/placeholder.jpg'; };

      const info = document.createElement('div');
      const t = document.createElement('div'); t.textContent = `${item.name} × ${item.qty}`;
      const p = document.createElement('div'); p.className = 'muted'; p.textContent = `${fmtPrice(item.price)} KWD`;
      info.appendChild(t); info.appendChild(p);

      const amt = document.createElement('div'); amt.textContent = `${fmtPrice(item.price * item.qty)} KWD`;

      li.appendChild(img); li.appendChild(info); li.appendChild(amt);
      billItemsEl.appendChild(li);
      mapped.push({ id: item.sku, name: item.name, price: item.price, qty: item.qty, thumb });
    }
    grandTotalEl.textContent = `${state.total.toFixed(3)} KWD`;
  }

  function setStatus(text) {
    const s = document.getElementById('connection-status');
    if (s) s.textContent = text;
  }

  const clearBtn = document.getElementById('clear-basket');
  if (clearBtn) clearBtn.addEventListener('click', () => window.onClearBasket());


  function computePopular(all) {
    const withPhotos = (all || []).filter(p => p.image_url);
    const shuffled = shuffle(withPhotos.slice());
    return shuffled.slice(0, 12);
  }
  function fmtPrice(n) {
    const v = Math.round(Number(n) * 100) / 100;
    return v.toFixed(2);
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ---- Options / Modifiers flow (cashier drives)
  function productOptions(p){
    const cat = String(p.category_name||'').toLowerCase();
    if (cat.includes('coffee')) {
      return {
        size: [ {id:'reg', label:'Regular', delta:0}, {id:'lg', label:'Large', delta:0.5} ],
        milk: [ {id:'full', label:'Full fat', delta:0}, {id:'low', label:'Low fat', delta:0}, {id:'oat', label:'Oat', delta:0.25}, {id:'almond', label:'Almond', delta:0.25} ]
      };
    }
    return null;
  }

  function onProductClick(p){
    const opts = productOptions(p);
    if (!opts) {
      return window.onAddItem(p);
    }
    const sel = { sizeId: opts.size?.[0]?.id || null, milkId: opts.milk?.[0]?.id || null };
    showOptionsUI(false, p, opts, sel);
    try { ws && ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: { id:p.id, name:p.name, price:p.price }, options: opts, selection: sel })); } catch {}
  }

  function computePriceWith(p, opts, sel){
    let price = Number(p.price)||0;
    const size = (opts.size||[]).find(x=>x.id===sel.sizeId);
    const milk = (opts.milk||[]).find(x=>x.id===sel.milkId);
    if (size) price += Number(size.delta||0);
    if (milk) price += Number(milk.delta||0);
    return Math.round(price*1000)/1000;
  }
  function selectionLabel(opts, sel){
    const parts = [];
    const size = (opts.size||[]).find(x=>x.id===sel.sizeId); if (size) parts.push(size.label);
    const milk = (opts.milk||[]).find(x=>x.id===sel.milkId); if (milk) parts.push(milk.label);
    return parts.join(', ');
  }

  function showOptionsUI(readOnly, p, opts, sel){
    const modal = document.getElementById('optionsModal');
    const body = document.getElementById('optBody');
    const title = document.getElementById('optTitle');
    const btnCancel = document.getElementById('optCancel');
    const btnConfirm = document.getElementById('optConfirm');
    if (!modal||!body) return;
    title.textContent = `Choose options — ${p.name}`;

    function render(){
      const price = computePriceWith(p, opts, sel);
      const grp = [];
      if (opts.size && opts.size.length){
        grp.push(`<fieldset><legend>Size</legend>${opts.size.map(o=>`<label style="display:block;margin:4px 0;"><input type=radio name=opt_size value="${o.id}" ${sel.sizeId===o.id?'checked':''} ${readOnly?'disabled':''}> ${o.label}${o.delta?` (+${fmtPrice(o.delta)} KWD)`:''}</label>`).join('')}</fieldset>`);
      }
      if (opts.milk && opts.milk.length){
        grp.push(`<fieldset><legend>Milk</legend>${opts.milk.map(o=>`<label style="display:block;margin:4px 0;"><input type=radio name=opt_milk value="${o.id}" ${sel.milkId===o.id?'checked':''} ${readOnly?'disabled':''}> ${o.label}${o.delta?` (+${fmtPrice(o.delta)} KWD)`:''}</label>`).join('')}</fieldset>`);
      }
      grp.push(`<div style="margin-top:8px;font-weight:600;">Price: ${fmtPrice(price)} KWD</div>`);
      body.innerHTML = grp.join('');
    }
    render();

    function onChange(e){
      if (e.target.name==='opt_size') sel.sizeId = e.target.value;
      if (e.target.name==='opt_milk') sel.milkId = e.target.value;
      render();
      try { ws && ws.send(JSON.stringify({ type:'ui:optionsUpdate', basketId, selection: sel })); } catch {}
    }

    body.onchange = readOnly ? null : onChange;
    btnCancel.style.display = readOnly ? 'none' : '';
    btnConfirm.style.display = readOnly ? 'none' : '';

    btnCancel.onclick = () => { hideOptionsUI(); try { ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {} };
    btnConfirm.onclick = () => {
      const price = computePriceWith(p, opts, sel);
      const suffix = selectionLabel(opts, sel);
      const variantKey = `${p.id}#size=${sel.sizeId||''}&milk=${sel.milkId||''}`;
      sendUpdate({ action:'add', item:{ sku: variantKey, name: suffix?`${p.name} (${suffix})`:p.name, price }, qty:1 });
      hideOptionsUI();
      try { ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {}
    };

    modal.style.display = 'flex';
  }
  function hideOptionsUI(){
    const modal = document.getElementById('optionsModal');
    if (modal) modal.style.display = 'none';
  }

  // React to remote UI events (safe for cashier if mirrored)
  function onUiShowOptions(msg){
    const p = msg.product||{}; const opts = msg.options||{}; const sel = msg.selection||{};
    showOptionsUI(false, p, opts, sel); // cashier can control; ensure buttons visible
  }
  function onUiOptionsUpdate(msg){
    // Update radios if open
    const body = document.getElementById('optBody'); if (!body || document.getElementById('optionsModal').style.display==='none') return;
    const sel = msg.selection||{};
    const sizeEl = body.querySelector(`input[name=opt_size][value="${sel.sizeId}"]`);
    const milkEl = body.querySelector(`input[name=opt_milk][value="${sel.milkId}"]`);
    if (sizeEl) sizeEl.checked = true; if (milkEl) milkEl.checked = true;
  }
  function onUiOptionsClose(){ hideOptionsUI(); }

  // extend WS listener for UI options
  (function extendWs(){
    // Already attached; add extra handler via capturing original
    // We rely on the existing 'message' listener to call these based on type.
  })();
})();
