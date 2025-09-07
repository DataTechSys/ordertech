(function() {
  // Header link/pair UI for selecting a Drive‑Thru display
  function qs(sel, el){ return (el||document).querySelector(sel); }
  function qsa(sel, el){ return Array.from((el||document).querySelectorAll(sel)); }
  function getToken(){ return localStorage.getItem('DEVICE_TOKEN_CASHIER') || localStorage.getItem('DEVICE_TOKEN') || ''; }
  let tenant = new URLSearchParams(location.search).get('tenant') || '';
  if (!tenant) { try { tenant = localStorage.getItem('DEVICE_TENANT_ID') || ''; } catch {} }
  // Image helpers (proxy remote URLs and fallback gracefully)
  function proxiedImageSrc(u){
    if (!u) return '';
    const s = String(u);
    return /^https?:\/\//i.test(s) ? ('/img?u=' + encodeURIComponent(s)) : s;
  }
  function imageDisplaySrcForUrl(u){
    const raw = String(u || '').trim();
    if (!raw) return '';
    if (/^http:\/\//i.test(raw)) return proxiedImageSrc(raw);
    if (/^https:\/\//i.test(raw)) return raw;
    return raw;
  }
  function attachImageFallback(imgEl, originalUrl){
    try {
      const raw = String(originalUrl || '').trim();
      if (!imgEl || !raw) return;
      const isHttps = /^https:\/\//i.test(raw);
      const proxy = proxiedImageSrc(raw) || '/images/products/placeholder.jpg';
      let triedProxy = false;
      imgEl.addEventListener('error', () => {
        if (isHttps && !triedProxy) { triedProxy = true; imgEl.src = proxy; }
        else { imgEl.src = '/images/products/placeholder.jpg'; }
      });
    } catch {}
  }

  async function applyBrand(){
    try {
      const headers = { 'accept': 'application/json' };
      if (tenant) headers['x-tenant-id'] = tenant;
      const r = await fetch('/brand', { headers });
      const j = await r.json();
      const logo = (j && j.logo_url) ? String(j.logo_url) : '';
      const img = document.querySelector('.logo-overlay, .topbar .logo');
      if (img && logo) img.src = logo;
    } catch {}
  }

  // Display buttons (top-right of order summary) — click to start/stop session
  function renderDisplayFlags(items){
    const el = document.getElementById('branchFlags');
    if (!el) return;
    el.innerHTML = '';
    const current = (basketId && basketId !== 'unpaired') ? String(basketId) : '';
    if (!items || items.length === 0) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'flag idle';
      btn.textContent = 'Pair';
      btn.onclick = async (ev) => {
        ev.preventDefault();
        try {
          const list = await fetchDisplays();
          showDropdown(list, btn);
        } catch {}
      };
      el.appendChild(btn);
      return;
    }
    (items || []).forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isActive = current && String(it.id) === current;
      const statusCls = isActive ? 'in-session' : (it.connected ? 'waiting' : 'idle');
      btn.className = 'flag ' + statusCls;
      const label = it.name || 'Display';
      btn.title = it.branch ? `${label} — ${it.branch}` : label;
      btn.textContent = label;
      btn.onclick = async (ev) => {
        ev.preventDefault();
        try {
          if (isActive) {
            // Stop and fully reset
            try { await fetch(`/webrtc/session/${encodeURIComponent(current)}?reason=user`, { method:'DELETE' }); } catch {}
            try { await fetch(`/session/reset?pairId=${encodeURIComponent(current)}`, { method:'POST' }); } catch {}
            try { stopRTC && stopRTC('user'); } catch {}
            const p = new URLSearchParams(location.search);
            p.delete('basket');
            p.delete('pair');
            const qs = p.toString();
            location.href = location.pathname + (qs ? ('?' + qs) : '');
          } else {
            // Start pairing to this display and auto-start session
            const p = new URLSearchParams(location.search);
            p.set('basket', String(it.id));
            p.set('pair', '1');
            location.search = p.toString();
          }
        } catch {}
      };
      el.appendChild(btn);
    });
  }
  async function startDisplayFlagsPolling(){
    const run = async () => {
      try {
        const items = await fetchDisplays();
        renderDisplayFlags(items);
      } catch {}
    };
    run();
    try { setInterval(run, 5000); } catch {}
  }
  function setPill(text, connected){
    const pill = qs('#linkPill'); const label = qs('#linkStatus'); const dot = pill ? pill.querySelector('.dot') : null;
    if (label) label.textContent = text;
    if (dot) dot.style.background = connected ? '#22c55e' : '';
  }
  async function fetchDisplays(){
    try {
      const headers = {};
      const tok = getToken(); if (tok) headers['x-device-token'] = tok;
      if (tenant) headers['x-tenant-id'] = tenant;
      const r = await fetch('/presence/displays', { headers });
      const j = await r.json();
      return Array.isArray(j.items) ? j.items : [];
    } catch { return []; }
  }
  function showDropdown(items, anchorEl){
    const anchor = anchorEl || qs('#btnPlay') || document.body;
    const rectSrc = (anchor.getBoundingClientRect ? anchor : document.body);
    const pillRect = rectSrc.getBoundingClientRect ? rectSrc.getBoundingClientRect() : { top: 20, left: 20, bottom: 40 };
    let menu = qs('#displayDropdown');
    if (!menu){
      menu = document.createElement('div');
      menu.id = 'displayDropdown';
      Object.assign(menu.style, {
        position:'absolute',
        top: (pillRect.bottom + window.scrollY + 8)+'px',
        left: (pillRect.left + window.scrollX)+'px',
        background:'#0b1220',
        border:'1px solid #243244',
        borderRadius:'8px',
        padding:'8px',
        zIndex:3000,
        minWidth:'260px',
        maxWidth:'min(360px, 90vw)',
        maxHeight:'min(60vh, 480px)',
        overflowY:'auto',
        color:'#fff',
        boxSizing:'border-box',
        boxShadow:'0 8px 24px rgba(0,0,0,0.3)'
      });
      document.body.appendChild(menu);
    } else {
      // reset base position near pill before reflow
      menu.style.top = (pillRect.bottom + window.scrollY + 8)+'px';
      menu.style.left = (pillRect.left + window.scrollX)+'px';
    }
    menu.innerHTML = '';
    // Stop option moved outside dropdown - no longer needed here
    if (!items.length){ menu.textContent = 'No displays online'; repositionDropdown(menu, pillRect); return; }
    items.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${it.name || 'Display'}${it.branch?` — ${it.branch}`:''}`;
      Object.assign(btn.style, {
        display:'block',
        width:'100%',
        textAlign:'left',
        background:'transparent',
        color:'#fff',
        border:'none',
        padding:'8px',
        cursor:'pointer',
        whiteSpace:'normal',
        overflowWrap:'anywhere',
        lineHeight:'1.25'
      });
      btn.onmouseenter = () => btn.style.background = '#1f2937';
      btn.onmouseleave = () => btn.style.background = 'transparent';
      btn.onclick = () => {
        const params = new URLSearchParams(location.search);
        params.set('basket', it.id);
        params.set('pair', '1');
        // Re-enable RTC if previously stopped
        canConnect = true;
        location.search = params.toString();
      };
      menu.appendChild(btn);
    });
    // After content is laid out, clamp to viewport
    repositionDropdown(menu, pillRect);
    const onDoc = (ev) => { if (!menu.contains(ev.target) && ev.target !== anchor) { menu.remove(); document.removeEventListener('click', onDoc); } };
    setTimeout(() => document.addEventListener('click', onDoc), 0);
  }

  function repositionDropdown(menu, pillRect){
    const viewportRight = window.scrollX + document.documentElement.clientWidth;
    const viewportBottom = window.scrollY + window.innerHeight;
    const rect = menu.getBoundingClientRect();
    let left = parseFloat(menu.style.left);
    let top = parseFloat(menu.style.top);
    // Clamp horizontally with 12px margin
    const desiredRight = left + rect.width;
    if (desiredRight > viewportRight - 12) {
      left = Math.max(12 + window.scrollX, viewportRight - rect.width - 12);
    }
    if (left < 12 + window.scrollX) left = 12 + window.scrollX;
    // If dropdown overflows bottom, try placing it above the pill
    const desiredBottom = top + rect.height;
    if (desiredBottom > viewportBottom - 12) {
      const aboveTop = (pillRect.top + window.scrollY) - rect.height - 8;
      if (aboveTop >= (12 + window.scrollY)) top = aboveTop;
    }
    if (top < 12 + window.scrollY) top = 12 + window.scrollY;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  function initControls(){
    // Wire Play/Stop
    const btnPlay = qs('#btnPlay');
    const btnStop = qs('#btnStop');
    const osnBadge = qs('#osnBadge');
    function setReadyUI(){
      if (btnPlay) { btnPlay.style.display = ''; btnPlay.classList.remove('green'); btnPlay.classList.add('orange'); }
      if (btnStop) { btnStop.style.display = ''; }
      if (osnBadge) osnBadge.style.display = 'none';
    }
    function setConnectedUI(){
      if (btnPlay) { btnPlay.style.display = ''; btnPlay.classList.remove('orange'); btnPlay.classList.add('green'); }
      if (btnStop) { btnStop.style.display = ''; }
      if (osnBadge && osnBadge.textContent) osnBadge.style.display = '';
    }
    window.__setReadyUI = setReadyUI; window.__setConnectedUI = setConnectedUI;
    if (btnPlay) btnPlay.onclick = async (ev) => {
      ev.preventDefault();
      // If not paired, use Play as the chooser for displays; otherwise start session immediately
      if (!basketId || basketId === 'unpaired') {
        const items = await fetchDisplays();
        showDropdown(items, btnPlay);
        return;
      }
      try {
        await fetch(`/session/start?pairId=${encodeURIComponent(basketId)}`, { method:'POST' });
      } catch {}
      canConnect = true;
      if (!rtcStarted && !rtcStarting) startRTC();
    };
    if (btnStop) btnStop.onclick = async () => {
      if (peersConnected) {
        stopRTC('user');
        try { await fetch(`/webrtc/session/${encodeURIComponent(basketId)}?reason=user`, { method:'DELETE' }); } catch {}
      } else {
        try { await fetch(`/session/reset?pairId=${encodeURIComponent(basketId)}`, { method:'POST' }); } catch {}
      }
    };
  }
document.addEventListener('DOMContentLoaded', ()=>{ initControls(); applyBrand().catch(()=>{}); startDisplayFlagsPolling(); enablePipDrag(); try { initDeviceOverlayIfNeeded(); } catch (e) { console.warn('overlay init failed', e); } });
  // Pairing gate: connect whenever a basket is present. ?pair=1 is treated as a one-shot hint only.
  const paramsGate = new URLSearchParams(location.search);
  const basketIdParam = paramsGate.get('basket') || '';
  const shouldConnect = Boolean(basketIdParam); // presence of basket implies intent to connect
  let canConnect = shouldConnect; // dynamic gate we can toggle via UI (Stop streaming)
const basketId = shouldConnect ? basketIdParam : 'unpaired';
// Load preferred RTC config for this basket (if selected from overlay previously)
try {
  const rawPref = localStorage.getItem('RTC_PREF_' + basketId);
  window.__RTC_PREF = rawPref ? JSON.parse(rawPref) : null;
} catch { window.__RTC_PREF = null; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws;
  let reconnectDelay = 500;
  let peersConnected = false;

  const POPULER = 'Populer';
  let allProducts = [];
  let populerList = [];
  let imgById = new Map();
  let __popularSeed = null;
  const DEMO_TOP = [
    { sku: 'PIC-106', kw: ['americano'] },
    { sku: 'PIC-111', kw: ['spanish','latte'] },
    { sku: 'PHT-107', kw: ['espresso'] },
    { sku: 'PWJ-101', kw: ['water','eva'] },
    { sku: 'PSC-107', kw: ['v60'] },
    { sku: 'PSD-104', kw: ['halloumi'] },
    { sku: 'PIC-110', kw: ['spanish','latte'] },
    { sku: 'PBR-102', kw: ['matcha'] },
    { sku: 'PHT-101', kw: ['americano'] },
    { sku: 'PHT-115', kw: ['spanish','latte'] },
    { sku: 'PSD-115', kw: ['brioche','egg'] },
    { sku: 'PIC-105', kw: ['americano'] }
  ];
  function buildDemoPopular(all){
    const out = [];
    const used = new Set();
    // Prefer keyword matches (SKU may be missing in dev-open mode)
    for (const it of DEMO_TOP){
      const kw = (it.kw||[]).map(s=>String(s).toLowerCase());
      const cand = (all||[]).find(p => !used.has(p.id) && kw.every(k => String(p.name||'').toLowerCase().includes(k)));
      if (cand) { out.push(cand); used.add(cand.id); }
      if (out.length >= 12) break;
    }
    if (out.length < 12){
      for (const p of (all||[])){ if (!used.has(p.id)) { out.push(p); used.add(p.id); if (out.length>=12) break; } }
    }
    return out.slice(0,12);
  }

  const state = {
    items: new Map(),
    total: 0,
    version: 0
  };

let __connectFailTimer = null;
function renderNetBars(bars){
  try {
    const el = document.getElementById('netBars');
    if (!el) return;
    // Create bars if not present
    if (!el.children.length) {
      for (let i=0;i<3;i++){ const b=document.createElement('i'); el.appendChild(b); }
    }
    el.classList.remove('bars-0','bars-1','bars-2','bars-3');
    el.classList.add('bars-'+Math.max(0, Math.min(3, Number(bars)||0)));
  } catch {}
}

function connect() {
    ws = new WebSocket(proto + '://' + location.host);
    ws.addEventListener('open', () => {
      setStatus('Connected');
      setStatusChip('ready','READY');
      reconnectDelay = 500;
      ws.send(JSON.stringify({ type: 'subscribe', basketId }));
      try {
        const name = localStorage.getItem('DEVICE_NAME_CASHIER') || localStorage.getItem('DEVICE_NAME') || 'Cashier';
        ws.send(JSON.stringify({ type:'hello', basketId, role:'cashier', name }));
      } catch {}
      // Send rtc:config to drive if a preference exists
      try { if (window.__RTC_PREF) ws.send(JSON.stringify({ type:'rtc:config', basketId, config: window.__RTC_PREF })); } catch {}
      // If we connected via ?pair=1, clear the flag from the URL so refresh won't auto-connect
      if (shouldConnect) {
        const p = new URLSearchParams(location.search);
        p.delete('pair');
        const qs3 = p.toString();
        history.replaceState(null, '', location.pathname + (qs3 ? ('?' + qs3) : ''));
      }
      // Auto-start session and RTC when we intended to pair
      if (canConnect) {
        try { fetch(`/session/start?pairId=${encodeURIComponent(basketId)}`, { method:'POST' }); } catch {}
        startRTC();
        // Start a connect budget timer: if we don't see peersConnected within ~15s, abort and return to overlay
        try { if (__connectFailTimer) clearTimeout(__connectFailTimer); } catch {}
        __connectFailTimer = setTimeout(() => {
          try {
            if (!peersConnected) {
              try { stopRTC('user'); } catch {}
              try { fetch(`/webrtc/session/${encodeURIComponent(basketId)}?reason=connect-timeout`, { method:'DELETE' }); } catch {}
              // Remove basket param and reload (overlay will appear)
              const p = new URLSearchParams(location.search);
              p.delete('basket'); p.delete('pair');
              location.href = location.pathname + (p.toString()?('?'+p.toString()):'');
            }
          } catch {}
        }, 15000);
      }
    });
    ws.addEventListener('message', async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'basket:sync' || msg.type === 'basket:update') {
          applyBasket(msg.basket);
        } else if (msg.type === 'ui:showPreview') {
          try { const p = msg.product || {}; showProductPreviewUI(p); } catch {}
        } else if (msg.type === 'ui:showOptions') {
          try {
            const p = msg.product || {};
            if (Array.isArray(msg.groups) && msg.groups.length) {
              showProductPopupWithOptions(p, msg.groups);
              // Apply any initial selection if provided
              try { const sel = msg.selection || {}; if (sel) syncModifiersSelection(sel); } catch {}
            } else {
              // Fallback: fetch modifiers locally and open if found; otherwise show simple options if provided
              try {
                const groups = await fetchProductModifiers(p);
                if (Array.isArray(groups) && groups.length) { showProductPopupWithOptions(p, groups); }
                else { const opts = msg.options || {}; const sel = msg.selection || {}; showOptionsUI(false, p, opts, sel); }
              } catch { const opts = msg.options || {}; const sel = msg.selection || {}; showOptionsUI(false, p, opts, sel); }
            }
          } catch {}
        } else if (msg.type === 'ui:optionsUpdate') {
          try {
            const sel = msg.selection || {};
            // Update simple options or modifiers selection
            if (sel && (sel.sizeId || sel.milkId)) syncSimpleOptionsSelection(sel);
            else syncModifiersSelection(sel);
          } catch {}
        } else if (msg.type === 'ui:optionsClose') {
          hideOptionsUI();
        } else if (msg.type === 'peer:status') {
          if (msg.status === 'connected') {
            try { if (__connectFailTimer) { clearTimeout(__connectFailTimer); __connectFailTimer = null; } } catch {}
            peersConnected = true;
            setStatusChip('connected', `CONNECTED — ${String(msg.displayName||'Display')}`);
            if (window.__setConnectedUI) window.__setConnectedUI();
            startRTC();
          } else {
            peersConnected = false;
            setStatusChip('ready','READY');
            if (window.__setReadyUI) window.__setReadyUI();
          }
        } else if (msg.type === 'rtc:stopped' && msg.basketId === basketId) {
          if (preClearing) {
            try { console.log('RTC(cashier) ignoring rtc:stopped (pre-clear)'); } catch {}
          } else {
            console.log('RTC(cashier) received stop command');
            peersConnected = false;
            stopRTC('remote');
          }
        } else if (msg.type === 'session:started' && msg.basketId === basketId) {
          const b = qs('#osnBadge');
          if (b) { b.textContent = msg.osn || ''; b.style.display = msg.osn ? '' : 'none'; }
          const h = qs('#osnHeader');
          if (h) { h.textContent = msg.osn || ''; h.style.display = msg.osn ? '' : 'none'; }
          // Use OSN as popular seed so cashier and display show identical Populer list
          __popularSeed = msg.osn || null;
          // Reset product highlight on new session
          try { clearSelection(); } catch {}
          try {
            const curated = buildDemoPopular(allProducts);
            populerList = __popularSeed ? seededShuffle(curated, hashString(String(__popularSeed))).slice(0,12) : curated;
            emitCategory(POPULER);
            await showCategory(POPULER);
          } catch {}
        } else if (msg.type === 'session:ended' && msg.basketId === basketId) {
          const b = qs('#osnBadge');
          if (b) { b.textContent = ''; b.style.display = 'none'; }
          const h = qs('#osnHeader');
          if (h) { h.textContent = ''; h.style.display = 'none'; }
        } else if (msg.type === 'poster:status' && msg.basketId === basketId) {
          posterActive = !!msg.active;
          const b = document.getElementById('posterBtn'); if (b) b.textContent = posterActive ? 'Stop Poster' : 'Poster';
        } else if (msg.type === 'error') {
          console.warn('WS error:', msg.error);
        }
      } catch (e) {
        try { console.warn('WS(cashier) message parse failed', e); } catch {}
      }
    });
    ws.addEventListener('close', () => {
      setStatus('Disconnected - reconnecting...');
      setStatusChip('offline','OFFLINE');
      const pill = document.getElementById('linkPill');
      const label = document.getElementById('linkStatus');
      const dot = pill ? pill.querySelector('.dot') : null;
      if (label) label.textContent = 'OFFLINE';
      if (dot) dot.style.background = '#ef4444';
      if (pill) { pill.style.background = '#ef4444'; pill.style.color = '#fff'; }
      if (shouldConnect) setTimeout(connect, Math.min(reconnectDelay *= 2, 8000));
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
  }
  if (shouldConnect) connect();
  // Query current poster state from display after a short delay
  setTimeout(()=>{ try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'poster:query', basketId })); } catch {} }, 1000);

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
  try { catsEl && catsEl.classList.add('tabs-grid'); catsEl && catsEl.classList.remove('two-rows'); } catch {}
  const gridEl = document.querySelector('#grid');
  const remoteEl = document.getElementById('remoteVideo');
  const localEl  = document.getElementById('localVideo');

  // selection state for two-click add
  let selectedId = null;
  let selectedBtn = null;
  function clearSelection(){
    if (selectedBtn) selectedBtn.classList.remove('selected');
    selectedId = null; selectedBtn = null;
    try { if (peersConnected && ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:clearSelection', basketId })); } catch {}
  }
  function selectTile(btn, id){
    clearSelection();
    selectedId = id; selectedBtn = btn;
    if (selectedBtn) selectedBtn.classList.add('selected');
    try { if (peersConnected && ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:selectProduct', basketId, productId: id })); } catch {}
  }
function onProductTileClick(p, btn){
    // New behavior: open overlay immediately and mirror to display
    try { clearSelection(); } catch {}
    try { if (peersConnected && ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showPreview', basketId, product: p })); } catch {}
    onProductClick(p);
  }

  const api = {
    get: async (url) => {
        const headers = { 'accept': 'application/json' };
        if (tenant) headers['x-tenant-id'] = tenant;
        const r = await fetch(url, { headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
    }
  };

  // Drive‑thru state for hidden categories
  let __hiddenCategoryIds = [];
  async function loadDriveThruState(){
    try {
      const headers = { 'accept': 'application/json' };
      if (tenant) headers['x-tenant-id'] = tenant;
      const r = await fetch('/drive-thru/state', { headers, cache: 'no-store' });
      const j = await r.json();
      __hiddenCategoryIds = Array.isArray(j.hiddenCategoryIds) ? j.hiddenCategoryIds.map(String) : [];
    } catch { __hiddenCategoryIds = []; }
  }

  async function init() {
    await loadDriveThruState();

    // Fallback loader from static JSON catalog when API fails and no tenant is specified
    async function loadFallbackCatalog(){
      try {
        const r = await fetch('/data/product.json', { cache: 'no-store' });
        const arr = await r.json();
        const catsSet = new Set();
        const cats = [];
        const prods = [];
        const slug = (s) => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
        for (const grp of (arr||[])){
          const cname = String(grp.category||'').trim(); if (!cname) continue;
          if (!catsSet.has(cname)) { catsSet.add(cname); cats.push({ id: 'c-'+slug(cname), name: cname }); }
          for (const it of (grp.items||[])){
            const id = String(it.id||'p-'+slug(it.name_en||it.name||''));
            const name = String(it.name_en||it.name||'').trim();
            const name_localized = String(it.name_ar||'').trim();
            const price = Number(it.price_kwd ?? it.price ?? 0) || 0;
            const image_url = it.image ? `/images/products/${encodeURIComponent(it.image)}` : '';
            prods.push({ id, name, name_localized, price, category_name: cname, image_url });
          }
        }
        return { cats, prods };
      } catch { return { cats: [], prods: [] }; }
    }

    let cats = [];
    try {
      cats = await api.get('/categories');
    } catch {
      // Only fallback when no explicit tenant is provided (avoid cross-tenant mixing)
      if (!tenant) {
        const fb = await loadFallbackCatalog();
        cats = fb.cats;
      } else {
        cats = [];
      }
    }
    try {
      allProducts = await api.get('/products');
    } catch {
      if (!tenant) {
        const fb = await loadFallbackCatalog();
        if (!cats || !cats.length) cats = fb.cats;
        allProducts = fb.prods;
      } else {
        allProducts = [];
      }
    }

    imgById = new Map((allProducts||[]).map(p => [p.id, p.image_url]));
    // Compute "Populer" from curated demo set; reorder deterministically by OSN when available
    {
      const curated = buildDemoPopular(allProducts||[]);
      populerList = __popularSeed ? seededShuffle(curated, hashString(String(__popularSeed))).slice(0,12) : curated;
    }
    const filteredCats = Array.isArray(cats) && __hiddenCategoryIds.length
      ? cats.filter(c => !__hiddenCategoryIds.includes(String(c.id)))
      : cats;
    const withPop = [{ name: POPULER }, ...filteredCats];
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
  // Fallback: start RTC even if WS handshake is blocked by proxy/CDN
  setTimeout(() => { if (canConnect && !rtcStarted && !rtcStarting) startRTC(); }, 1200);
  // Delay RTC until peers are connected
  let rtcStarted = false;
  let rtcStarting = false;
  let rtcBackoff = 1000;
  let restartTimer = null;
  // Media heartbeat
  let hbTimer = null;
  let __lastStats = { aIn:{bytes:0,at:0}, vIn:{bytes:0,at:0}, aOut:{bytes:0,at:0}, vOut:{bytes:0,at:0} };
  // Ensure we pre-clear stale signaling state only once per page load
  let didPreclear = false;
  // Ignore rtc:stopped coming from our own pre-clear
  let preClearing = false;
  function stopRTC(reason){
    try { console.log('RTC(cashier) stop', { reason }); } catch {}
    // Notify backend to clear session state so display stops polling
    if (reason==='user') fetch(`/webrtc/session/${encodeURIComponent(basketId)}?reason=user`, { method:'DELETE' }).catch(err=>console.warn('session delete failed',err));
    if (reason==='user') canConnect = false;
    clearRtcTimers();
    try {
      const pc = window.__pcCashier; if (pc && pc.close) pc.close();
    } catch {}
    window.__pcCashier = null;
    try {
      const s = localEl && localEl.srcObject; if (s && s.getTracks) { for (const t of s.getTracks()) { try { t.stop(); } catch {} } }
      if (localEl) localEl.srcObject = null;
    } catch {}
    try { if (remoteEl) remoteEl.srcObject = null; } catch {}
    rtcStarted = false; rtcStarting = false; restartTimer && clearTimeout(restartTimer); restartTimer = null; rtcBackoff = 1000;
    if (window.__setReadyUI) window.__setReadyUI();
    try { window.__ICE_SERVERS = null; } catch {}
  }
  function clearRtcTimers(){
    const t = window.__rtcTimersCashier || {};
    try { if (t.pollAnswerTimer) clearInterval(t.pollAnswerTimer); } catch {}
    try { if (t.candidatesInterval) clearInterval(t.candidatesInterval); } catch {}
    if (hbTimer) { try { clearInterval(hbTimer); } catch {} hbTimer = null; }
    window.__rtcTimersCashier = { pollAnswerTimer: null, candidatesInterval: null };
  }
  function scheduleRtcRestart(reason){
    if (restartTimer) return;
    restartTimer = setTimeout(() => {
      try {
        const pc2 = window.__pcCashier;
        const connected = pc2 && (pc2.iceConnectionState === 'connected' || pc2.connectionState === 'connected');
        if (!connected) {
          console.warn('RTC(cashier) restart', { reason });
          try { pc2 && pc2.close && pc2.close(); } catch {}
          clearRtcTimers();
          rtcStarted = false;
          const delay = Math.min(rtcBackoff, 8000) + Math.floor(Math.random()*300);
          rtcBackoff = Math.min(rtcBackoff * 2, 8000);
          setTimeout(() => { try { startRTC(); } catch {} }, delay);
        }
      } finally { restartTimer = null; }
    }, 2500);
  }
  async function startRTC(){
    if (rtcStarted || rtcStarting) return;
    rtcStarting = true;
    try {
      await initRTC();
      rtcStarted = true;
    } catch (e) {
      console.warn('RTC init failed', e);
    } finally {
      rtcStarting = false;
    }
  }

  function renderCategories(cats) {
    // Grid layout: auto-fit columns with 1–3 rows (scroll if more)
    catsEl.innerHTML = '';
    catsEl.classList.remove('two-rows');
    catsEl.classList.add('tabs-grid');

    const makeBtn = (c, idx, isActive) => {
      const b = document.createElement('button');
      b.className = 'tab' + (isActive ? ' active' : '');
      b.textContent = c.name;
      b.onclick = async () => {
        Array.from(catsEl.querySelectorAll('.tab')).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        emitCategory(c.name);
        await showCategory(c.name);
      };
      return b;
    };

    cats.forEach((c, idx) => {
      const isActive = (idx === 0);
      const btn = makeBtn(c, idx, isActive);
      catsEl.appendChild(btn);
    });
  }

  function emitCategory(name){
    try {
      if (peersConnected && ws && ws.readyState === WebSocket.OPEN) {
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
      card.onclick = () => onProductTileClick(p, card);

      const img = document.createElement('img');
      const src = p.image_url || '/images/products/placeholder.jpg';
      img.src = src;
      img.addEventListener('load', () => {});
      img.onerror = () => {
        img.src = '/images/products/placeholder.jpg';
      };

      // Names wrapper: Arabic first (RTL), then English
      const names = document.createElement('div');
      names.className = 'names';

      const nameAr = document.createElement('div');
      nameAr.className = 'name-ar';
      nameAr.dir = 'rtl';

      const nameEn = document.createElement('div');
      nameEn.className = 'name-en';
      nameEn.textContent = p.name;

      const ar = (p.name_localized && String(p.name_localized).trim()) ? String(p.name_localized).trim() : '';
      nameAr.textContent = ar || '\u00A0';
      names.appendChild(nameAr);
      names.appendChild(nameEn);

      const price = document.createElement('div');
      price.className = 'price';
      price.textContent = `${fmtPrice(p.price)} KWD`;

      card.appendChild(img);
      card.appendChild(names);
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
      const baseId = String(item.sku || item.id || '').split('#')[0];
      const thumb = imgById.get(baseId) || '/images/products/placeholder.jpg';
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = thumb;
      img.onerror = () => { img.src = '/images/products/placeholder.jpg'; };

      const info = document.createElement('div');
      const t = document.createElement('div'); t.textContent = `${item.name} × ${item.qty}`;
      const p = document.createElement('div'); p.className = 'muted'; p.textContent = `${fmtPrice(item.price)} KWD`;
      info.appendChild(t); info.appendChild(p);

      const amt = document.createElement('div'); amt.textContent = `${fmtPrice(item.price * item.qty)} KWD`;

      // small trash button (cashier only)
      const del = document.createElement('button');
      del.type = 'button';
      del.title = 'Remove';
      del.className = 'trash';
      del.textContent = '🗑';
      del.style = 'margin-left:8px; background:none; border:none; cursor:pointer; font-size:14px; line-height:1;';
      del.onclick = (e) => { e.stopPropagation(); window.onRemoveItem(item.sku); };

      li.appendChild(img); li.appendChild(info); li.appendChild(amt); li.appendChild(del);
      billItemsEl.appendChild(li);
      mapped.push({ id: item.sku, name: item.name, price: item.price, qty: item.qty, thumb });
    }
    grandTotalEl.textContent = `${state.total.toFixed(3)} KWD`;
  }

  function setStatus(text) {
    const s = document.getElementById('connection-status');
    if (s) s.textContent = text;
  }
  function setStatusChip(kind, label){
    const chip = document.getElementById('statusChip');
    if (!chip) return;
    chip.classList.remove('ready','connected','offline');
    if (kind==='connected') chip.classList.add('connected');
    else if (kind==='offline') chip.classList.add('offline');
    else chip.classList.add('ready');
    chip.textContent = label || (kind==='connected' ? 'CONNECTED' : kind==='offline' ? 'OFFLINE' : 'READY');
  }

  const clearBtn = document.getElementById('clear-basket');
  if (clearBtn) clearBtn.addEventListener('click', () => window.onClearBasket());

  // Buttons: Pay (keep RTC), Reset (basket only), Poster (toggle overlay on display)
  let posterActive = false;
  const payBtn = document.getElementById('payBtn');
  if (payBtn) payBtn.addEventListener('click', async () => {
    try {
      const r = await fetch(`/session/pay?pairId=${encodeURIComponent(basketId)}`, { method:'POST' });
      await r.json().catch(()=>({}));
    } catch {}
    // Do NOT stop RTC; continue streaming for next order
  });
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.addEventListener('click', async () => {
    // Hard reset session: clears basket, resets signaling, and instructs display to reload
    try { await fetch(`/session/reset?pairId=${encodeURIComponent(basketId)}`, { method:'POST' }); } catch {}
    try { posterActive = false; const b=document.getElementById('posterBtn'); if (b) b.textContent='Poster'; } catch {}
  });
  const posterBtn = document.getElementById('posterBtn');
  if (posterBtn) posterBtn.addEventListener('click', async () => {
    try {
      if (!posterActive) await fetch(`/poster/start?pairId=${encodeURIComponent(basketId)}`, { method:'POST' });
      else await fetch(`/poster/stop?pairId=${encodeURIComponent(basketId)}`, { method:'POST' });
      // Do not flip label immediately; wait for display ack via poster:status
    } catch {}
  });

  // Mute/unmute microphone (cashier local audio track)
  let micMuted = false;
  function applyMicMute(){
    try {
      const s = localEl && localEl.srcObject;
      if (s && s.getAudioTracks) {
        const tracks = s.getAudioTracks();
        for (const t of tracks) { try { t.enabled = !micMuted; } catch {} }
      }
    } catch {}
    try {
      const pc = window.__pcCashier;
      if (pc && typeof pc.getSenders === 'function') {
        pc.getSenders().forEach(sender => {
          const tr = sender && sender.track;
          if (tr && tr.kind === 'audio') { try { tr.enabled = !micMuted; } catch {} }
        });
      }
    } catch {}
    try { const b=document.getElementById('muteBtn'); if (b) b.textContent = micMuted ? 'Unmute' : 'Mute'; } catch {}
  }
  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) muteBtn.addEventListener('click', () => { micMuted = !micMuted; applyMicMute(); });


  async function getIceServers(){
    if (window.__ICE_SERVERS) return window.__ICE_SERVERS;
    try {
const r = await fetch('/webrtc/config', { cache: 'no-store' });
      const j = await r.json();
      const arr = (j && Array.isArray(j.iceServers)) ? j.iceServers : [{ urls: ['stun:stun.l.google.com:19302'] }];
      window.__ICE_SERVERS = arr;
      return arr;
    } catch {
      return [{ urls: ['stun:stun.l.google.com:19302'] }];
    }
  }

  // Deterministic popular computation when a seed (e.g., OSN) is provided
  function hashString(s){ let h = 2166136261>>>0; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = (h * 16777619)>>>0; } return h>>>0; }
  function seededRandom(seed){ let x = seed>>>0; return () => { x = (x * 1664525 + 1013904223)>>>0; return (x>>>0) / 4294967296; }; }
  function seededShuffle(arr, seed){ const rnd = seededRandom(seed>>>0); const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j = Math.floor(rnd() * (i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
  function computePopular(all, seed) {
    const base = (all || []).slice().sort((a,b)=> String(a.id).localeCompare(String(b.id)));
    if (seed) {
      const s = (typeof seed === 'string') ? hashString(seed) : (seed>>>0);
      return seededShuffle(base, s).slice(0, 12);
    }
    const shuffled = shuffle(base.slice());
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

  // ---- WebRTC two-way video (cashier offers)
// Detailed ICE config helper
async function getIceConfigDetailed(){
  try {
    const r = await fetch('/webrtc/config', { cache:'no-store' });
    return await r.json();
  } catch { return { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }] }; }
}

async function initRTC(){
    try {
      clearRtcTimers();
      // Pre-clear any stale session state on the backend (offer/answer/ICE) once per load
      if (!didPreclear) {
        preClearing = true;
        try {
          await fetch(`/webrtc/session/${encodeURIComponent(basketId)}?reason=preclear`, { method:'DELETE' });
          console.log('RTC(cashier) pre-cleared session state');
        } catch (e) {
          console.warn('RTC(cashier) pre-clear failed', e);
        } finally {
          didPreclear = true;
          // Allow a short window for the rtc:stopped broadcast to arrive, then resume normal handling
          setTimeout(() => { preClearing = false; }, 1500);
        }
      }
      const localStream = await (window.startLocalCam ? window.startLocalCam(localEl) : (async () => {
        // Prefer built-in mic on macOS; allow override via ?mic=... or localStorage key CASHIER_MIC_PREF
        const params = new URLSearchParams(location.search);
        const micPrefParam = (params.get('mic') || '').trim().toLowerCase();
        if (micPrefParam) { try { localStorage.setItem('CASHIER_MIC_PREF', micPrefParam); } catch {} }
        const micPref = micPrefParam || (localStorage.getItem('CASHIER_MIC_PREF') || '').toLowerCase();

        const baseConstraints = {
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        };
        let s = await navigator.mediaDevices.getUserMedia(baseConstraints);

        // After permission, enumerate devices and switch to preferred audioinput if needed
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audios = devices.filter(d => d.kind === 'audioinput');
          const isBuiltIn = (label) => /built[- ]?in|macbook/i.test(label);
          const isUnwanted = (label) => /(iphone|airpods|beats|continuity|display|pro|max)/i.test(label);
          let preferred = null;
          if (micPref) {
            if (micPref === 'builtin') preferred = audios.find(d => isBuiltIn(d.label || '')) || null;
            else preferred = audios.find(d => (d.label || '').toLowerCase().includes(micPref)) || null;
          }
          if (!preferred) {
            preferred = audios.find(d => isBuiltIn(d.label || '')) || audios.find(d => !isUnwanted(d.label || '')) || audios[0] || null;
          }
          const cur = (s.getAudioTracks && s.getAudioTracks()[0]) || null;
          let curId = '';
          try { curId = cur && cur.getSettings ? (cur.getSettings().deviceId || '') : ''; } catch {}
          if (preferred && preferred.deviceId && preferred.deviceId !== curId) {
            try {
              const sAudio = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: preferred.deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
              const [newTrack] = sAudio.getAudioTracks();
              if (newTrack) {
                if (cur) { try { s.removeTrack(cur); } catch {} try { cur.stop(); } catch {} }
                try { s.addTrack(newTrack); } catch {}
              }
            } catch (e2) { console.warn('Preferred mic acquisition failed', e2); }
          }
        } catch (e1) { console.warn('Device enumeration failed', e1); }

        try {
          const [t] = s.getVideoTracks();
          if (t && typeof t.getCapabilities === 'function') {
            const caps = t.getCapabilities();
            const advanced = [];
            if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) advanced.push({ exposureMode: 'continuous' });
            if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) advanced.push({ whiteBalanceMode: 'continuous' });
            if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' });
            if (caps.exposureCompensation && typeof caps.exposureCompensation.min === 'number' && typeof caps.exposureCompensation.max === 'number') {
              const min = caps.exposureCompensation.min; const max = caps.exposureCompensation.max;
              let neutral = 0; if (neutral < min) neutral = min; if (neutral > max) neutral = max;
              advanced.push({ exposureCompensation: neutral });
            }
            if (advanced.length) await t.applyConstraints({ advanced });
          }
        } catch (e) { console.warn('Auto constraints not supported or failed (cashier):', e); }
        if (localEl) { localEl.srcObject = s; localEl.play && localEl.play().catch(()=>{}); }
        // Apply any pending mic mute state to the fresh stream and PC senders
        try { if (typeof applyMicMute === 'function') setTimeout(applyMicMute, 0); } catch {}
        return s;
      })());
      const cfg = await getIceConfigDetailed();
      const params = new URLSearchParams(location.search);
      let icePolicy = params.get('ice') === 'relay' ? 'relay' : 'all';
      let iceServers = cfg.iceServers || [];
      try {
        const pref = window.__RTC_PREF || null; // { provider:'twilio'|'self'|'default', policy:'relay'|'all' }
        if (pref && pref.policy) icePolicy = pref.policy;
        if (pref && pref.provider === 'twilio' && Array.isArray(cfg.twilioServers) && cfg.twilioServers.length) {
          iceServers = cfg.twilioServers;
        } else if (pref && pref.provider === 'self' && Array.isArray(cfg.selfServers) && cfg.selfServers.length) {
          // Self TURN + baseline STUN
          iceServers = [...cfg.selfServers, { urls: ['stun:stun.l.google.com:19302'] }];
        }
      } catch {}
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: icePolicy });
      window.__pcCashier = pc;
      const pendingRemote = [];
      const addRemoteCandidate = async (cand) => {
        if (pc.remoteDescription && pc.signalingState !== 'have-local-offer') {
          try { await pc.addIceCandidate(new RTCIceCandidate(cand)); }
          catch (e) { console.error('addIceCandidate failed (cashier)', { candidate: cand, error: e }); }
        } else {
          pendingRemote.push(cand);
        }
      };
console.log('RTC(cashier) init', { pairId: basketId, icePolicy, servers: Array.isArray(ice) ? ice.length : 0 });
      if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
      const remoteStream = new MediaStream();
      if (remoteEl) { remoteEl.srcObject = remoteStream; remoteEl.play && remoteEl.play().catch(()=>{}); }
      pc.ontrack = (ev) => { ev.streams[0]?.getTracks().forEach(tr => remoteStream.addTrack(tr)); };
pc.addEventListener('iceconnectionstatechange', () => {
        console.log('RTC(cashier) iceConnectionState:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected') { rtcBackoff = 1000; }
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') scheduleRtcRestart(pc.iceConnectionState);
      });
      pc.addEventListener('connectionstatechange', () => {
        console.log('RTC(cashier) connectionState:', pc.connectionState);
        if (pc.connectionState === 'connected') { rtcBackoff = 1000; }
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') scheduleRtcRestart(pc.connectionState);
      });
      pc.addEventListener('icegatheringstatechange', () => console.log('RTC(cashier) iceGatheringState:', pc.iceGatheringState));
      // Start media heartbeat after pc is created
      try { beginRtcStats(pc); } catch {}
      try { tuneQoS(pc); } catch {}
      pc.onicecandidate = async (ev) => {
        if (ev.candidate) {
          try {
await fetch('/webrtc/candidate', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId: basketId, role:'cashier', candidate: ev.candidate }) });
          } catch (err) { console.warn('POST /webrtc/candidate failed (cashier)', err); }
        } else {
          console.log('RTC(cashier) ICE gathering complete');
        }
      };
      const offer = await pc.createOffer({offerToReceiveAudio:true, offerToReceiveVideo:true});
      await pc.setLocalDescription(offer);
await fetch('/webrtc/offer', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId: basketId, sdp: offer.sdp }) });
const pollAnswerTimer = setInterval(async () => {
        try {
          const r = await fetch(`/webrtc/answer?pairId=${encodeURIComponent(basketId)}`);
          const j = await r.json();
          if (j && j.sdp && pc.signalingState !== 'stable') {
            console.log('GET /webrtc/answer (cashier) received');
            await pc.setRemoteDescription({ type:'answer', sdp: j.sdp });
clearInterval(pollAnswerTimer);
            window.__rtcTimersCashier = window.__rtcTimersCashier || {};
            window.__rtcTimersCashier.pollAnswerTimer = null;
            // flush buffered candidates
            if (pendingRemote.length) {
              console.log('RTC(cashier) flushing buffered remote candidates', { count: pendingRemote.length });
              for (const c of pendingRemote.splice(0)) { await addRemoteCandidate(c); }
            }
            // burst fetch candidates immediately a few times after answer
try {
              const r2 = await fetch(`/webrtc/candidates?pairId=${encodeURIComponent(basketId)}&role=cashier`);
              const j2 = await r2.json();
              const items2 = Array.isArray(j2.items) ? j2.items : [];
              if (items2.length) console.log('IMMEDIATE GET /webrtc/candidates (cashier)', { count: items2.length });
              for (const c of items2) { await addRemoteCandidate(c); }
            } catch {}
          } else {
// no answer yet
          }
        } catch (err) { console.warn('GET /webrtc/answer failed (cashier)', err); }
}, 1500);
      window.__rtcTimersCashier = window.__rtcTimersCashier || {};
      window.__rtcTimersCashier.pollAnswerTimer = pollAnswerTimer;
const candidatesInterval = setInterval(async () => {
        try {
          const r = await fetch(`/webrtc/candidates?pairId=${encodeURIComponent(basketId)}&role=cashier`);
          const j = await r.json();
          const items = Array.isArray(j.items) ? j.items : [];
          if (items.length) console.log('GET /webrtc/candidates (cashier)', { count: items.length });
          for (const c of items) { await addRemoteCandidate(c); }
        } catch (err) { console.warn('GET /webrtc/candidates failed (cashier)', err); }
      }, 1800);
      window.__rtcTimersCashier = window.__rtcTimersCashier || {};
      window.__rtcTimersCashier.candidatesInterval = candidatesInterval;
    } catch (e) { console.warn('RTC init failed', e); }
  }

  function beginRtcStats(pc){
    if (hbTimer) { try { clearInterval(hbTimer); } catch {} hbTimer = null; }
    __lastStats = { aIn:{bytes:0,at:0}, vIn:{bytes:0,at:0}, aOut:{bytes:0,at:0}, vOut:{bytes:0,at:0} };
    hbTimer = setInterval(async () => {
      try {
        const now = Date.now();
        const rep = await pc.getStats();
        let aIn=null,vIn=null,aOut=null,vOut=null;
        rep.forEach(r => {
          if (r.type==='inbound-rtp' && !r.isRemote) {
            if (r.kind==='audio') aIn = r.bytesReceived; else if (r.kind==='video') vIn = r.bytesReceived;
          } else if (r.type==='outbound-rtp' && !r.isRemote) {
            if (r.kind==='audio') aOut = r.bytesSent; else if (r.kind==='video') vOut = r.bytesSent;
          }
        });
        if (typeof aIn==='number' && aIn>__lastStats.aIn.bytes) { __lastStats.aIn.bytes=aIn; __lastStats.aIn.at=now; }
        if (typeof vIn==='number' && vIn>__lastStats.vIn.bytes) { __lastStats.vIn.bytes=vIn; __lastStats.vIn.at=now; }
        if (typeof aOut==='number' && aOut>__lastStats.aOut.bytes) { __lastStats.aOut.bytes=aOut; __lastStats.aOut.at=now; }
        if (typeof vOut==='number' && vOut>__lastStats.vOut.bytes) { __lastStats.vOut.bytes=vOut; __lastStats.vOut.at=now; }
        const audioInHealthy = (__lastStats.aIn.at && (now-__lastStats.aIn.at)<6000);
        const videoInHealthy = (__lastStats.vIn.at && (now-__lastStats.vIn.at)<6000);
        const audioOutHealthy = (__lastStats.aOut.at && (now-__lastStats.aOut.at)<6000);
        const videoOutHealthy = (__lastStats.vOut.at && (now-__lastStats.vOut.at)<6000);
        // send heartbeat: cashier outbound is display inbound
        try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'rtc:heartbeat', basketId, audio:{ in: audioInHealthy, out: audioOutHealthy }, video:{ in: videoInHealthy, out: videoOutHealthy } })); } catch {}
        // simple bars: prioritize audio
        let bars = 1;
        if (audioInHealthy && audioOutHealthy) bars = 3; else if (audioInHealthy || audioOutHealthy) bars = 2; else bars = 1;
        renderNetBars(bars);
      } catch {}
    }, 2000);
  }

  // QoS tuning: prioritize audio, enable simulcast if possible
  function tuneQoS(pc){
    try {
      const senders = pc.getSenders ? pc.getSenders() : [];
      for (const s of senders){
        const p = s.getParameters ? s.getParameters() : null; if (!p) continue;
        if (s.track && s.track.kind === 'audio'){
          p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
          p.encodings[0].maxBitrate = 64000; // ~64 kbps
          p.degradationPreference = 'maintain-framerate';
          try { s.setParameters(p); } catch {}
        }
        if (s.track && s.track.kind === 'video'){
          p.encodings = p.encodings && p.encodings.length ? p.encodings : [{},{},{}];
          // conservative caps; congestion control will adapt
          if (p.encodings[0]) p.encodings[0].maxBitrate = 250000;
          if (p.encodings[1]) p.encodings[1].maxBitrate = 600000;
          if (p.encodings[2]) p.encodings[2].maxBitrate = 1200000;
          p.degradationPreference = 'balanced';
          try { s.setParameters(p); } catch {}
        }
      }
    } catch {}
  }

  // ---- Device overlay + Preflight (cashier drives selection before session) ----
  const OVERLAY_ID = 'deviceOverlay';
  const OVERLAY_HTML = (devices=[]) => {
    return `\n      <div class="ov-header">Select Drive Device</div>\n      <div class="ov-grid" id="ovGrid"></div>\n      <div class="ov-foot">Quality and path are pre-tested (Direct, Direct(TURN), Twilio).</div>\n    `;
  };
  const PREFLIGHT_TIMEOUT_MS = 2600;
  const PREFLIGHT_PINGS = 3;
  const PREFLIGHT_CONCURRENCY = 4;
  const deviceRankings = new Map(); // id -> { quality, bestScenarioId, bestTag, at }
  const selectedScenarioByDevice = new Map();
  let __ovInit = false;

  function ensureOverlayEl(){
    const card = document.querySelector('.order-panel .billCard');
    const el = document.getElementById(OVERLAY_ID);
    if (!card || !el) return null;
    el.innerHTML = OVERLAY_HTML();
    // anchor inside bill card bounds
    el.style.inset = '0';
    return el;
  }

  function showOverlay(show){
    const el = document.getElementById(OVERLAY_ID); if (!el) return;
    if (show) el.classList.add('show'); else el.classList.remove('show');
  }

  async function listDisplaysOverlay(){
    try { return await fetchDisplays(); } catch { return []; }
  }

  function scenarioTag(id){
    if (!id) return '';
    if (id.includes('twilio')) return 'Twilio';
    if (id.includes('self-relay')) return 'Direct(TURN)';
    return 'Direct';
  }

  function renderDeviceCardsOverlay(devices){
    try {
      const grid = document.getElementById('ovGrid'); if (!grid) return;
      grid.innerHTML = '';
      if (!devices || !devices.length) {
        const empty = document.createElement('div');
        empty.className = 'muted';
        empty.style.padding = '12px';
        empty.textContent = 'No displays online yet. Open a Drive screen to connect.';
        grid.appendChild(empty);
        return;
      }
      (devices||[]).forEach(d => {
        const rk = deviceRankings.get(d.id);
        const q = rk && typeof rk.quality === 'number' ? Math.round(rk.quality) : null;
        const tag = rk ? rk.bestTag : '';
        const div = document.createElement('div');
        div.className = 'ov-card';
        div.innerHTML = `
          <div class="ov-title">${(d.name||'Display')}</div>
          <div class="ov-sub">${d.branch ? d.branch : ''}</div>
          <div class="ov-badges">
            <span class="ov-badge ${q==null?'':(q>=75?'good':q>=45?'mid':'bad')}">${q==null?'testing…':(q+'%')}</span>
            <span class="ov-badge">${tag||''}</span>
          </div>`;
        div.addEventListener('click', ()=> onDeviceSelectedOverlay(d));
        grid.appendChild(div);
      });
    } catch {}
  }

  async function beginPreflightOnDrive(targetId, requestId, scenarios){
    try {
      await fetch('/preflight/begin', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ targetId, requestId, scenarios }) });
    } catch {}
  }

  function buildScenariosForDevice(deviceId, requestId){
    return [
      { id:`${deviceId}-self-all`, deviceId, provider:'self', policy:'all', timeoutMs:PREFLIGHT_TIMEOUT_MS },
      { id:`${deviceId}-self-relay`, deviceId, provider:'self', policy:'relay', timeoutMs:PREFLIGHT_TIMEOUT_MS },
      { id:`${deviceId}-twilio-relay`, deviceId, provider:'twilio', policy:'relay', timeoutMs:PREFLIGHT_TIMEOUT_MS },
    ];
  }

  function pLimit(n){ let active=0, q=[]; const next=()=>{ active--; if(q.length) q.shift()(); }; return fn=> new Promise((res,rej)=>{ const run=()=>{ active++; fn().then(res,rej).finally(next); }; active<n?run():q.push(run); }); }
  const limitPref = pLimit(PREFLIGHT_CONCURRENCY);

  async function runScenarioOffer(deviceId, requestId, sc){
    const pairId = `pf_${requestId}_${sc.id}`;
    const cfg = await getIceConfigDetailed();
    let iceServers = cfg.iceServers || [];
    let iceTransportPolicy = sc.policy || 'all';
    if (sc.provider === 'twilio' && Array.isArray(cfg.twilioServers) && cfg.twilioServers.length) iceServers = cfg.twilioServers;
    else if (sc.provider === 'self' && Array.isArray(cfg.selfServers) && cfg.selfServers.length) iceServers = [...cfg.selfServers, { urls:['stun:stun.l.google.com:19302'] }];

    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
    const dc = pc.createDataChannel('pf', { ordered:true });
    const pendingRemote = [];
    const start = Date.now();
    let connectTime = null;
    pc.oniceconnectionstatechange = () => {
      if (!connectTime && (pc.iceConnectionState==='connected'||pc.iceConnectionState==='completed')) connectTime = Date.now() - start;
    };
    pc.onicecandidate = async (ev) => {
      if (!ev.candidate) return;
      try { await fetch('/webrtc/candidate', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId, role:'cashier', candidate: ev.candidate }) }); } catch {}
    };
    const offer = await pc.createOffer({ offerToReceiveAudio:false, offerToReceiveVideo:false });
    await pc.setLocalDescription(offer);
    await fetch('/webrtc/offer', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId, sdp: offer.sdp }) });

    const deadline = Date.now() + (sc.timeoutMs||PREFLIGHT_TIMEOUT_MS);
    // Poll for answer
    let answered = false;
    while (Date.now() < deadline && !answered) {
      try {
        const r = await fetch(`/webrtc/answer?pairId=${encodeURIComponent(pairId)}`);
        const j = await r.json();
        if (j && j.sdp && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription({ type:'answer', sdp: j.sdp });
          answered = true; break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 150));
    }
    if (!answered) { try{ pc.close(); }catch{}; throw new Error('preflight_no_answer'); }

    // Short candidate poll burst
    let candTimer = setInterval(async () => {
      try {
        const r = await fetch(`/webrtc/candidates?pairId=${encodeURIComponent(pairId)}&role=cashier`);
        const j = await r.json();
        const items = Array.isArray(j.items)?j.items:[];
        for (const c of items) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
      } catch {}
    }, 180);

    // Ping RTTs over datachannel
    const rtts = [];
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('pf_ping_timeout')), Math.min(1200, sc.timeoutMs||PREFLIGHT_TIMEOUT_MS));
      dc.onopen = async () => {
        try {
          for (let i=0;i<PREFLIGHT_PINGS;i++) {
            const t = performance.now();
            dc.send(JSON.stringify({ type:'pf-ping', t }));
            const pong = await new Promise((res, rej) => {
              const h = ev => {
                try {
                  const m = JSON.parse(ev.data);
                  if (m && m.type==='pf-pong' && m.t===t) { dc.removeEventListener('message', h); res(m); }
                } catch {}
              };
              dc.addEventListener('message', h);
              setTimeout(()=>rej(new Error('pf_pong_timeout')), 400);
            });
            rtts.push(performance.now()-t);
          }
          clearTimeout(to); resolve();
        } catch (e) { clearTimeout(to); reject(e); }
      };
    });

    // Collect selected candidate info
    const stats = await pc.getStats();
    let selectedPair=null, localCand=null, remoteCand=null;
    stats.forEach(s => { if (s.type==='transport' && s.selectedCandidatePairId) selectedPair = stats.get(s.selectedCandidatePairId); });
    if (!selectedPair) { stats.forEach(s => { if (s.type==='candidate-pair' && s.state==='succeeded' && s.nominated) selectedPair = s; }); }
    if (selectedPair) {
      localCand = stats.get(selectedPair.localCandidateId);
      remoteCand = stats.get(selectedPair.remoteCandidateId);
    }

    try { clearInterval(candTimer); } catch {}
    setTimeout(()=>{ fetch(`/webrtc/session/${encodeURIComponent(pairId)}?reason=preflight`, { method:'DELETE' }).catch(()=>{}); try{ pc.close(); }catch{}; }, 0);

    return {
      scenarioId: sc.id,
      connectTime: connectTime || (Date.now()-start),
      rtts,
      localCandidateType: (localCand?.candidateType)||'',
      localProtocol: (localCand?.protocol)||'',
      remoteCandidateType: (remoteCand?.candidateType)||'',
      remoteProtocol: (remoteCand?.protocol)||''
    };
  }

  function scoreScenario(r){
    if (!r || typeof r.connectTime !== 'number') return 0;
    const tt = Math.min(3000, r.connectTime);
    const rtt = Math.min(400, ((r.rtts||[]).reduce((a,b)=>a+b,0) / Math.max(1,(r.rtts||[]).length)) || 0);
    let base = 100;
    const type = String(r.localCandidateType||'').toLowerCase(); // host,srflx,relay
    const proto = String(r.localProtocol||'').toLowerCase(); // udp,tcp
    if (type === 'relay') base -= 20;
    if (proto === 'tcp') base -= 10;
    base -= Math.round(tt / 60);
    base -= Math.round(rtt / 8);
    base = Math.max(0, Math.min(100, base));
    return base;
  }

  async function runPreflightForDevice(d){
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const scenarios = buildScenariosForDevice(d.id, requestId);
    await beginPreflightOnDrive(d.id, requestId, scenarios);
    const results = await Promise.allSettled(scenarios.map(sc => limitPref(()=>runScenarioOffer(d.id, requestId, sc))));
    let best = null;
    for (const rr of results) {
      if (rr.status !== 'fulfilled') continue;
      const s = scoreScenario(rr.value);
      if (!best || s > best.score) best = { score:s, scenarioId: rr.value.scenarioId };
    }
    if (best) {
      deviceRankings.set(d.id, { quality: best.score, bestScenarioId: best.scenarioId, bestTag: scenarioTag(best.scenarioId), at: Date.now() });
      selectedScenarioByDevice.set(d.id, best.scenarioId);
    }
  }

  async function initDeviceOverlayIfNeeded(){
    try {
      if (shouldConnect) return; // only when not paired yet
      const el = ensureOverlayEl(); if (!el) return;
      showOverlay(true);
      const devices = await listDisplaysOverlay();
      renderDeviceCardsOverlay(devices);
      // Safety: after a short budget, mark devices without results as unreachable (0%) to avoid endless "testing…"
      setTimeout(() => {
        try {
          for (const d of (devices||[])) {
            if (!deviceRankings.has(d.id)) {
              deviceRankings.set(d.id, { quality: 0, bestScenarioId: null, bestTag: 'Unreachable', at: Date.now() });
            }
          }
          renderDeviceCardsOverlay(devices);
        } catch {}
      }, 4000);
      // Kick off preflight per device
      await Promise.all(devices.map(d => limitPref(()=>runPreflightForDevice(d))));
      renderDeviceCardsOverlay(devices);
    } catch (e) { console.warn('overlay error', e); }
  }

  function scenarioFromId(id){
    if (!id) return { provider:'self', policy:'all' };
    if (id.includes('twilio')) return { provider:'twilio', policy:'relay' };
    if (id.includes('self-relay')) return { provider:'self', policy:'relay' };
    return { provider:'self', policy:'all' };
  }

  async function onDeviceSelectedOverlay(d){
    try {
      const scId = selectedScenarioByDevice.get(d.id) || '';
      const pref = scenarioFromId(scId);
      try { localStorage.setItem('RTC_PREF_' + d.id, JSON.stringify(pref)); } catch {}
      // Set a connection budget window (~15s)
      try { localStorage.setItem('CONNECT_BUDGET_' + d.id, String(Date.now()+15000)); } catch {}
      // Set basket and pair=1 to trigger session start
      const p = new URLSearchParams(location.search);
      p.set('basket', d.id);
      p.set('pair', '1');
      location.search = p.toString();
    } catch {}
  }

  // ---- Options / Modifiers flow (cashier drives)
  function hasMilkVariants(p){
    const name = String(p.name||'').toLowerCase();
    const cat  = String(p.category_name||'').toLowerCase();
    const include = ['latte','cappuccino','flat white','mocha','macchiato','cortado','frappe','white mocha','spanish'];
    const exclude = ['americano','espresso','drip','cold brew','iced americano','turkish coffee','tea','mojito','lemonade','juice'];
    if (exclude.some(w => name.includes(w))) return false;
    if (include.some(w => name.includes(w))) return true;
    // default: coffee categories except excluded names
    if (cat.includes('coffee')) return true;
    return false;
  }
async function fetchProductModifiers(p){
    try {
      const headers = { 'accept':'application/json' };
      try { if (tenant) headers['x-tenant-id'] = tenant; } catch {}
      const r = await fetch(`/products/${encodeURIComponent(p.id)}/modifiers`, { cache: 'no-store', headers });
      const j = await r.json();
      const items = Array.isArray(j?.items) ? j.items : [];
      // Normalize: only keep groups with at least one option
      const groups = items
        .map(it => ({ id: it.group?.group_id, name: it.group?.name, required: !!it.group?.required, min: (it.group?.min_select ?? 0), max: (it.group?.max_select ?? 0), options: (it.options||[]).map(o => ({ id:o.id, name:o.name, delta:Number(o.price)||0 })) }))
        .filter(g => g.id && (g.options||[]).length);
      return groups;
    } catch { return []; }
  }
  function productOptions(p){
    if (!hasMilkVariants(p)) return null;
    return {
      size: [ {id:'reg', label:'Regular', delta:0}, {id:'lg', label:'Large', delta:0.5} ],
      milk: [ {id:'full', label:'Full fat', delta:0}, {id:'low', label:'Low fat', delta:0}, {id:'oat', label:'Oat', delta:0.25}, {id:'almond', label:'Almond', delta:0.25} ]
    };
  }

async function onProductClick(p){
    // Prefer real modifiers if defined for this product
    const groups = await fetchProductModifiers(p);
    if (Array.isArray(groups) && groups.length) {
      showProductPopupWithOptions(p, groups);
      try { if (peersConnected && ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups })); } catch {}
      return;
    }
    // If we have simple options (size/milk), show unified popup and mirror
    const opts = productOptions(p);
    if (!opts) {
      showProductPreviewUI(p);
      return;
    }
    const groups2 = [];
    if (opts.size && opts.size.length) groups2.push({ id:'size', name:'Size', required:false, min:0, max:1, options: opts.size.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
    if (opts.milk && opts.milk.length) groups2.push({ id:'milk', name:'Milk', required:false, min:0, max:1, options: opts.milk.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
    showProductPopupWithOptions(p, groups2);
    try { if (peersConnected && ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups: groups2 })); } catch {}
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
        const items = opts.size.map(o => renderOptionButton({ id:o.id, name:o.label, delta:o.delta }, sel.sizeId===o.id)).join('');
        grp.push(`<fieldset><legend>Size</legend><div class=\"optrow\">${items}</div></fieldset>`);
      }
      if (opts.milk && opts.milk.length){
        const items = opts.milk.map(o => renderOptionButton({ id:o.id, name:o.label, delta:o.delta }, sel.milkId===o.id)).join('');
        grp.push(`<fieldset><legend>Milk</legend><div class=\"optrow\">${items}</div></fieldset>`);
      }
      grp.push(`<div style=\"margin-top:8px;font-weight:600;\">Price: ${fmtPrice(price)} KWD</div>`);
      body.innerHTML = grp.join('');
      applyOptionButtonStyles(body);
      if (!readOnly){
        body.querySelectorAll('fieldset').forEach(fs => {
          const legend = (fs.querySelector('legend')||{}).textContent||'';
          const isSize = /size/i.test(legend);
          const isMilk = /milk/i.test(legend);
          fs.querySelectorAll('button.optbtn').forEach(btn => {
            btn.addEventListener('click', ()=>{
              const id = btn.getAttribute('data-opt');
              if (isSize) sel.sizeId = id; else if (isMilk) sel.milkId = id;
              fs.querySelectorAll('button.optbtn').forEach(b => b.classList.toggle('selected', b===btn));
              applyOptionButtonStyles(fs);
              try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsUpdate', basketId, selection: sel })); } catch {}
            });
          });
        });
      }
    }
    render();

    // disable form change handler (replaced by buttons)
    body.onchange = null;
    btnCancel.style.display = readOnly ? 'none' : '';
    btnConfirm.style.display = readOnly ? 'none' : '';

    btnCancel.onclick = () => { hideOptionsUI(); try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {} };
    btnConfirm.onclick = () => {
      const price = computePriceWith(p, opts, sel);
      const suffix = selectionLabel(opts, sel);
      const variantKey = `${p.id}#size=${sel.sizeId||''}&milk=${sel.milkId||''}`;
      sendUpdate({ action:'add', item:{ sku: variantKey, name: suffix?`${p.name} (${suffix})`:p.name, price }, qty:1 });
      hideOptionsUI();
      try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {}
    };

    modal.style.display = 'flex';
  }
function hideOptionsUI(){
    const modal = document.getElementById('optionsModal');
    if (modal) modal.style.display = 'none';
    try { const card = document.getElementById('optionsCard'); if (card) card.classList.remove('compact'); } catch {}
    clearSelection();
  }

  // Simple product preview with Add/Close when no modifiers/options
  function showProductPreviewUI(p){
    const modal = document.getElementById('optionsModal');
    const body = document.getElementById('optBody');
    const title = document.getElementById('optTitle');
    const btnCancel = document.getElementById('optCancel');
    const btnConfirm = document.getElementById('optConfirm');
    const btnsRow = document.getElementById('optBtnsRow');
    const card = document.getElementById('optionsCard');
    if (!modal||!body||!title||!btnCancel||!btnConfirm||!btnsRow) return;

    title.textContent = 'Add Item';
    try { if (card) card.classList.add('compact'); } catch {}

    const ar = (p.name_localized && String(p.name_localized).trim()) ? String(p.name_localized).trim() : '';
    const img = imageDisplaySrcForUrl(p.image_url) || '/images/products/placeholder.jpg';
    const price = fmtPrice(p.price) + ' KWD';

    body.innerHTML = `
      <div style=\"display:flex; flex-direction:column; align-items:center; gap:12px;\">\n        <img class=\"product-img\" src=\"${img}\" alt=\"${p.name}\" onerror=\"this.src='/images/products/placeholder.jpg'\"/>\n        <div class=\"names\" style=\"text-align:center; width:100%;\">\n          <div class=\"name-ar\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:700; font-size:1.1em; direction:rtl;\">${ar||'\\u00A0'}</div>\n          <div class=\"name-en\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:600;\">${p.name}</div>\n          <div class=\"price\" style=\"margin-top:6px; color:#6b7280; font-weight:700;\">${price}</div>\n        </div>\n      </div>
    `;
    // Buttons full-width equal columns
    btnsRow.style.display = 'flex';
    btnsRow.style.gap = '12px';
    btnConfirm.style.flex = '1';
    btnCancel.style.flex = '1';

    btnCancel.style.display = '';
    btnConfirm.style.display = '';
    btnCancel.disabled = false; btnConfirm.disabled = false;
    btnCancel.textContent = 'Close';
    btnConfirm.textContent = 'Add';
    btnCancel.onclick = () => { hideOptionsUI(); };
    btnConfirm.onclick = async () => {
      try {
        const groups = await fetchProductModifiers(p);
        if (Array.isArray(groups) && groups.length) {
          // Render product preview with Options in the same popup
          showProductPopupWithOptions(p, groups);
        } else {
          // Try simple options
          const opts = productOptions(p);
          if (opts && (opts.size?.length || opts.milk?.length)){
            const groups2 = [];
            if (opts.size && opts.size.length) groups2.push({ id:'size', name:'Size', required:false, min:0, max:1, options: opts.size.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
            if (opts.milk && opts.milk.length) groups2.push({ id:'milk', name:'Milk', required:false, min:0, max:1, options: opts.milk.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
            showProductPopupWithOptions(p, groups2);
          } else {
            window.onAddItem(p);
            hideOptionsUI();
          }
        }
      } catch {
        window.onAddItem(p);
        hideOptionsUI();
      }
    };

    modal.style.display = 'flex';
  }

  // Render product preview + Options in the same popup (radios/checkboxes)
  function renderOptionButton(o, selected){
    const extra = o.delta ? ` (+${fmtPrice(o.delta)} KWD)` : '';
    const cls = 'optbtn' + (selected ? ' selected' : '');
    return `<button type=\"button\" class=\"${cls}\" data-opt=\"${String(o.id)}\">${o.name || o.label || ''}${extra}</button>`;
  }
  function applyOptionButtonStyles(scope){
    try {
      const root = scope || document;
      root.querySelectorAll('.optbtn').forEach(btn => {
        btn.style.display = 'inline-block';
        btn.style.margin = '4px';
        btn.style.padding = '10px 12px';
        btn.style.border = '1px solid #e5e7eb';
        btn.style.borderRadius = '10px';
        btn.style.background = btn.classList.contains('selected') ? '#0b1220' : '#fff';
        btn.style.color = btn.classList.contains('selected') ? '#fff' : '#111827';
        btn.style.cursor = 'pointer';
        btn.style.minWidth = '84px';
      });
    } catch {}
  }
  function syncSimpleOptionsSelection(sel){
    const body = document.getElementById('optBody'); if (!body) return;
    try {
      const sizeFs = Array.from(body.querySelectorAll('fieldset')).find(fs => /size/i.test((fs.querySelector('legend')||{}).textContent||''));
      if (sizeFs) { sizeFs.querySelectorAll('button.optbtn').forEach(b => b.classList.toggle('selected', b.getAttribute('data-opt')===String(sel.sizeId||''))); applyOptionButtonStyles(sizeFs); }
      const milkFs = Array.from(body.querySelectorAll('fieldset')).find(fs => /milk/i.test((fs.querySelector('legend')||{}).textContent||''));
      if (milkFs) { milkFs.querySelectorAll('button.optbtn').forEach(b => b.classList.toggle('selected', b.getAttribute('data-opt')===String(sel.milkId||''))); applyOptionButtonStyles(milkFs); }
    } catch {}
  }
  function syncModifiersSelection(sel){
    const body = document.getElementById('optBody'); if (!body) return;
    try {
      const map = sel || {}; // { groupId: [optionIds] }
      body.querySelectorAll('fieldset[data-gid]').forEach(fs => {
        const gid = fs.getAttribute('data-gid');
        const selected = new Set((map[gid]||[]).map(String));
        fs.querySelectorAll('button.optbtn').forEach(btn => {
          const opt = String(btn.getAttribute('data-opt'));
          btn.classList.toggle('selected', selected.has(opt));
        });
        applyOptionButtonStyles(fs);
      });
    } catch {}
  }
  function showProductPopupWithOptions(p, groups){
    const modal = document.getElementById('optionsModal');
    const body = document.getElementById('optBody');
    const title = document.getElementById('optTitle');
    const card = document.getElementById('optionsCard');
    if (!modal||!body||!title) return;
    title.textContent = 'Add Item';
    try { if (card) card.classList.add('compact'); } catch {}

    const hasGroups = Array.isArray(groups) && groups.length>0;

    // selection: map group_id -> Set(option_id)
    const sel = new Map();
    if (hasGroups){
      for (const g of groups) {
        const init = new Set();
        // default select first when required and min=1 and max=1
        if (g.required && (g.min||0) === 1 && (g.max||1) === 1 && g.options && g.options[0]) init.add(g.options[0].id);
        sel.set(g.id, init);
      }
    }

    function computePrice(){
      let price = Number(p.price)||0;
      if (hasGroups){
        for (const g of groups){
          const set = sel.get(g.id) || new Set();
          for (const oid of set){
            const opt = (g.options||[]).find(o=>String(o.id)===String(oid));
            if (opt) price += Number(opt.delta)||0;
          }
        }
      }
      return Math.round(price*1000)/1000;
    }
    function selectionLabel(){
      const parts=[];
      if (hasGroups){
        for (const g of groups){
          const set = sel.get(g.id) || new Set();
          const names = (g.options||[]).filter(o=>set.has(o.id)).map(o=>o.name);
          if (names.length) parts.push(`${g.name}: ${names.join('/')}`);
        }
      }
      return parts.join(', ');
    }

    function render(){
      const ar = (p.name_localized && String(p.name_localized).trim()) ? String(p.name_localized).trim() : '';
      const img = imageDisplaySrcForUrl(p.image_url) || '/images/products/placeholder.jpg';
      const price = computePrice();

      function renderGroups(){
        if (!hasGroups) return '';
        const sections = [];
        for (const g of groups){
          const set = sel.get(g.id) || new Set();
          const multi = (g.max||0) !== 1;
          const items = (g.options||[]).map(o => renderOptionButton({ id:o.id, name:o.name, delta:o.delta }, set.has(o.id))).join('');
          const note = (g.required || g.min || g.max) ? `<small class=\"muted\">${g.required?'Required. ':''}${g.min?`Min ${g.min}. `:''}${g.max?`Max ${g.max}.`:''}</small>` : '';
          sections.push(`<fieldset data-gid=\"${g.id}\"><legend>${g.name}</legend><div class=\"optrow\">${items}</div>${note}</fieldset>`);
        }
        return `<div class=\"options-box\" style=\"margin-top:8px; padding:12px; border:1px solid #e5e7eb; border-radius:12px;\">\n          <h4 style=\"margin:0 0 8px 0;\">Options</h4>\n          ${sections.join('')}\n        </div>`;
      }

      body.innerHTML = `
        <div style=\"display:flex; flex-direction:column; gap:12px;\">\n          <img class=\"product-img\" src=\"${img}\" alt=\"${p.name}\"/>\n          <div class=\"names\" style=\"text-align:center; width:100%;\">\n            <div class=\"name-ar\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:700; font-size:1.1em; direction:rtl;\">${ar||'\\u00A0'}</div>\n            <div class=\"name-en\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:600;\">${p.name}</div>\n            <div class=\"price\" id=\"optPriceKwd\" style=\"margin-top:6px; color:#6b7280; font-weight:700;\">${fmtPrice(price)} KWD</div>\n          </div>\n          ${renderGroups()}\n        </div>`;
      try { const el = body.querySelector('img.product-img'); if (el) attachImageFallback(el, p.image_url); } catch {}

      if (hasGroups){
        applyOptionButtonStyles(body);
        body.querySelectorAll('fieldset[data-gid]').forEach(fs => {
          const gid = fs.getAttribute('data-gid');
          const g = groups.find(x => String(x.id)===String(gid));
          const set = sel.get(gid) || new Set();
          const multi = (g.max||0) !== 1;
          fs.querySelectorAll('button.optbtn').forEach(btn => {
            btn.addEventListener('click', ()=>{
              const oid = btn.getAttribute('data-opt');
              if (multi){
                if (btn.classList.contains('selected')) { set.delete(oid); btn.classList.remove('selected'); }
                else { if (!g.max || set.size < g.max) { set.add(oid); btn.classList.add('selected'); } }
              } else {
                set.clear(); set.add(oid);
                fs.querySelectorAll('button.optbtn').forEach(b => b.classList.toggle('selected', b===btn));
              }
              sel.set(gid, set);
              applyOptionButtonStyles(fs);
              try {
                if (peersConnected) {
                  const map = {}; for (const [k,v] of sel.entries()) map[k] = Array.from(v.values());
                  ws && ws.send(JSON.stringify({ type:'ui:optionsUpdate', basketId, selection: map }));
                }
              } catch {}
              // Update price label
              try { const pk=document.getElementById('optPriceKwd'); if (pk) pk.textContent = `${fmtPrice(computePrice())} KWD`; } catch {}
            });
          });
        });
      }
    }

    const btnCancel = document.getElementById('optCancel');
    const btnConfirm = document.getElementById('optConfirm');
    btnCancel.style.display = '';
    btnConfirm.style.display = '';
    btnCancel.onclick = () => { hideOptionsUI(); try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {} };
    btnConfirm.onclick = () => {
      if (hasGroups){
        // enforce required/min
        for (const g of groups){
          const set = sel.get(g.id) || new Set();
          if (g.required && set.size === 0) { alert(`Please choose for ${g.name}`); return; }
          if (g.min && set.size < g.min) { alert(`${g.name}: choose at least ${g.min}`); return; }
          if (g.max && set.size > g.max) { alert(`${g.name}: choose up to ${g.max}`); return; }
        }
        const price = computePrice();
        const suffix = selectionLabel();
        // Compose a variant SKU to allow aggregating identical selections
        const parts=[];
        for (const g of groups){ const set = Array.from(sel.get(g.id) || []); if (set.length) parts.push(`${g.id}:${set.join('+')}`); }
        const variantKey = `${p.id}#mods=${encodeURIComponent(parts.join(','))}`;
        const itemName = suffix ? `${p.name} (${suffix})` : p.name;
        sendUpdate({ action:'add', item:{ sku: variantKey, name: itemName, price }, qty:1 });
        hideOptionsUI();
        try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {}
      } else {
        // no groups — just add
        window.onAddItem(p);
        hideOptionsUI();
      }
    };

    render();
    modal.style.display = 'flex';
  }

  // Draggable PiP (local video). Persist position as percentages relative to video panel.
  function enablePipDrag(){
    try {
      const pip = document.getElementById('localVideo');
      const panel = pip ? pip.closest('.video-panel') : null;
      if (!pip || !panel) return;

      // Restore saved position
      try {
        const saved = localStorage.getItem('CASHIER_PIP_POS');
        if (saved) {
          const { xPct, yPct } = JSON.parse(saved);
          const rect = panel.getBoundingClientRect();
          // Temporarily position with top/left based on percentages
          const left = Math.max(0, Math.min(rect.width - pip.offsetWidth, (xPct/100) * rect.width));
          const top = Math.max(0, Math.min(rect.height - pip.offsetHeight, (yPct/100) * rect.height));
          pip.style.left = left + 'px';
          pip.style.top = top + 'px';
          pip.style.right = 'auto';
          pip.style.bottom = 'auto';
        }
      } catch {}

      let dragging = false;
      let startX = 0, startY = 0;
      let startLeft = 0, startTop = 0;

      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

      function onDown(clientX, clientY){
        try {
          const panelRect = panel.getBoundingClientRect();
          const pipRect = pip.getBoundingClientRect();
          // Ensure we use top/left coordinates from now on
          const curLeft = (pip.style.left && pip.style.left.endsWith('px')) ? parseFloat(pip.style.left) : (pipRect.left - panelRect.left);
          const curTop  = (pip.style.top && pip.style.top.endsWith('px'))   ? parseFloat(pip.style.top)  : (pipRect.top - panelRect.top);
          pip.style.left = curLeft + 'px';
          pip.style.top = curTop + 'px';
          pip.style.right = 'auto';
          pip.style.bottom = 'auto';

          dragging = true;
          startX = clientX; startY = clientY;
          startLeft = curLeft; startTop = curTop;
          pip.style.transition = 'none';
          pip.style.willChange = 'left, top';
        } catch {}
      }
      function onMove(clientX, clientY){
        if (!dragging) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        const panelRect = panel.getBoundingClientRect();
        const pipRect = pip.getBoundingClientRect();
        // Compute bounded new position
        const maxLeft = panelRect.width - pipRect.width - 4;
        const maxTop  = panelRect.height - pipRect.height - 4;
        const nextLeft = clamp(startLeft + dx, 4, maxLeft);
        const nextTop  = clamp(startTop + dy, 4, maxTop);
        pip.style.left = nextLeft + 'px';
        pip.style.top  = nextTop + 'px';
      }
      function onUp(){
        if (!dragging) return;
        dragging = false;
        pip.style.transition = '';
        pip.style.willChange = '';
        // Save position as percentages
        try {
          const panelRect = panel.getBoundingClientRect();
          const pipRect = pip.getBoundingClientRect();
          const xPct = clamp(((pipRect.left - panelRect.left) / panelRect.width) * 100, 0, 100);
          const yPct = clamp(((pipRect.top - panelRect.top) / panelRect.height) * 100, 0, 100);
          localStorage.setItem('CASHIER_PIP_POS', JSON.stringify({ xPct, yPct }));
        } catch {}
      }

      // Mouse
      pip.addEventListener('mousedown', (e)=>{ onDown(e.clientX, e.clientY); e.preventDefault(); });
      window.addEventListener('mousemove', (e)=>{ onMove(e.clientX, e.clientY); });
      window.addEventListener('mouseup', onUp);
      // Touch
      pip.addEventListener('touchstart', (e)=>{ const t=e.touches[0]; if (t) onDown(t.clientX, t.clientY); e.preventDefault(); }, { passive:false });
      window.addEventListener('touchmove', (e)=>{ const t=e.touches[0]; if (t) onMove(t.clientX, t.clientY); }, { passive:false });
      window.addEventListener('touchend', onUp);

      // Re-apply on resize (orientation change)
      window.addEventListener('resize', ()=>{
        try {
          const saved = localStorage.getItem('CASHIER_PIP_POS');
          if (saved) {
            const { xPct, yPct } = JSON.parse(saved);
            const rect = panel.getBoundingClientRect();
            const left = Math.max(0, Math.min(rect.width - pip.offsetWidth, (xPct/100) * rect.width));
            const top = Math.max(0, Math.min(rect.height - pip.offsetHeight, (yPct/100) * rect.height));
            pip.style.left = left + 'px';
            pip.style.top = top + 'px';
            pip.style.right = 'auto';
            pip.style.bottom = 'auto';
          }
        } catch {}
      });
    } catch {}
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
