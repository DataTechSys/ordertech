(function() {
  // Header link/pair UI for selecting a Drive‑Thru display
  function qs(sel, el){ return (el||document).querySelector(sel); }
  function qsa(sel, el){ return Array.from((el||document).querySelectorAll(sel)); }
  function getToken(){ return localStorage.getItem('DEVICE_TOKEN_CASHIER') || localStorage.getItem('DEVICE_TOKEN') || ''; }
  const tenant = new URLSearchParams(location.search).get('tenant') || '';
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
  function showDropdown(items){
    const pill = qs('#linkPill'); if (!pill) return;
    let menu = qs('#displayDropdown');
    if (!menu){
      menu = document.createElement('div');
      menu.id = 'displayDropdown';
      Object.assign(menu.style, { position:'absolute', top: (pill.getBoundingClientRect().bottom + window.scrollY + 8)+'px', left: (pill.getBoundingClientRect().left + window.scrollX)+'px', background:'#0b1220', border:'1px solid #243244', borderRadius:'8px', padding:'8px', zIndex:3000, minWidth:'260px', color:'#fff' });
      document.body.appendChild(menu);
    }
    menu.innerHTML = '';
    // Stop option moved outside dropdown - no longer needed here
    if (!items.length){ menu.textContent = 'No displays online'; return; }
    items.forEach(it => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `${it.name || 'Display'}${it.branch?` — ${it.branch}`:''}`;
      Object.assign(btn.style, { display:'block', width:'100%', textAlign:'left', background:'transparent', color:'#fff', border:'none', padding:'8px', cursor:'pointer' });
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
    const onDoc = (ev) => { if (!menu.contains(ev.target) && ev.target !== pill) { menu.remove(); document.removeEventListener('click', onDoc); } };
    setTimeout(() => document.addEventListener('click', onDoc), 0);
  }
  function initPill(){
  const pill = qs('#linkPill'); if (!pill) return;
  const stopBtn = document.createElement('button');
  stopBtn.id = 'stopRtcBtn';
  stopBtn.textContent = '⏹ Stop';
  Object.assign(stopBtn.style, { display:'none', background:'#ef4444', color:'#fff', border:'1px solid #b91c1c', borderRadius:'8px', padding:'8px 14px', cursor:'pointer', marginLeft:'12px', fontSize:'14px', fontWeight:'600' });
  stopBtn.onclick = () => stopRTC('user');
  pill.parentNode.insertBefore(stopBtn, pill.nextSibling);
    setPill('READY', false);
    // orange dot for READY by default
    const dot = pill.querySelector('.dot'); if (dot) dot.style.background = '#f59e0b'; if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
    pill.style.cursor = 'pointer';
    pill.onclick = async () => { const items = await fetchDisplays(); showDropdown(items); };
  }
  document.addEventListener('DOMContentLoaded', initPill);
  // Pairing gate: connect whenever a basket is present. ?pair=1 is treated as a one-shot hint only.
  const paramsGate = new URLSearchParams(location.search);
  const basketIdParam = paramsGate.get('basket') || '';
  const shouldConnect = Boolean(basketIdParam); // presence of basket implies intent to connect
  let canConnect = shouldConnect; // dynamic gate we can toggle via UI (Stop streaming)
  const basketId = shouldConnect ? basketIdParam : 'unpaired';
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
      try {
        const name = localStorage.getItem('DEVICE_NAME_CASHIER') || localStorage.getItem('DEVICE_NAME') || 'Cashier';
        ws.send(JSON.stringify({ type:'hello', basketId, role:'cashier', name }));
      } catch {}
      const pill = document.getElementById('linkPill');
      const label = document.getElementById('linkStatus');
      const dot = pill ? pill.querySelector('.dot') : null;
      if (label && !shouldConnect) label.textContent = 'READY';
      if (dot && !shouldConnect) dot.style.background = '#f59e0b';
      if (pill && !shouldConnect) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
      // If we connected via ?pair=1, clear the flag from the URL so refresh won't auto-connect
      if (shouldConnect) {
        const p = new URLSearchParams(location.search);
        p.delete('pair');
        const qs3 = p.toString();
        history.replaceState(null, '', location.pathname + (qs3 ? ('?' + qs3) : ''));
      }
      // Start RTC immediately when we intended to pair; display will pick up the offer
      if (canConnect) startRTC();
    });
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'basket:sync' || msg.type === 'basket:update') {
        applyBasket(msg.basket);
      } else if (msg.type === 'peer:status') {
        const label = document.getElementById('linkStatus');
        const pill = document.getElementById('linkPill');
        const dot = pill ? pill.querySelector('.dot') : null;
        if (msg.status === 'connected') {
          const disp = msg.displayName || 'Display';
          if (label) label.textContent = `Connected — ${disp}`;
          if (dot) dot.style.background = '#22c55e';
          if (pill) { pill.style.background = '#22c55e'; pill.style.color = '#0b1220'; }
          if (qs('#stopRtcBtn')) qs('#stopRtcBtn').style.display = '';
          startRTC();
        } else {
          if (label) label.textContent = 'READY';
          if (dot) dot.style.background = '#f59e0b';
          if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
        }
      } else if (msg.type === 'rtc:stopped' && msg.basketId === basketId) {
        console.log('RTC(cashier) received stop command');
        stopRTC('remote');
      } else if (msg.type === 'error') {
        console.warn('WS error:', msg.error);
      }
    });
    ws.addEventListener('close', () => {
      setStatus('Disconnected - reconnecting...');
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
  const remoteEl = document.getElementById('remoteVideo');
  const localEl  = document.getElementById('localVideo');

  // selection state for two-click add
  let selectedId = null;
  let selectedBtn = null;
  function clearSelection(){
    if (selectedBtn) selectedBtn.classList.remove('selected');
    selectedId = null; selectedBtn = null;
    try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:clearSelection', basketId })); } catch {}
  }
  function selectTile(btn, id){
    clearSelection();
    selectedId = id; selectedBtn = btn;
    if (selectedBtn) selectedBtn.classList.add('selected');
    try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:selectProduct', basketId, productId: id })); } catch {}
  }
  function onProductTileClick(p, btn){
    if (selectedId === p.id) {
      // second click: proceed
      clearSelection();
      onProductClick(p);
    } else {
      // first click: highlight only
      selectTile(btn, p.id);
    }
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
  // Fallback: start RTC even if WS handshake is blocked by proxy/CDN
  setTimeout(() => { if (canConnect && !rtcStarted && !rtcStarting) startRTC(); }, 1200);
  // Delay RTC until peers are connected
  let rtcStarted = false;
  let rtcStarting = false;
  let rtcBackoff = 1000;
  let restartTimer = null;
  function stopRTC(reason){
    try { console.log('RTC(cashier) stop', { reason }); } catch {}
    // Notify backend to clear session state so display stops polling
    if (reason==='user') fetch(`/webrtc/session/${basketId}`, { method:'DELETE' }).catch(err=>console.warn('session delete failed',err));
    canConnect = false;
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
    const pill = document.getElementById('linkPill');
    const label = document.getElementById('linkStatus');
    const dot = pill ? pill.querySelector('.dot') : null;
    if (label) label.textContent = 'READY';
    if (dot) dot.style.background = '#f59e0b';
    if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
    if (qs('#stopRtcBtn')) qs('#stopRtcBtn').style.display = 'none';
  }
  function clearRtcTimers(){
    const t = window.__rtcTimersCashier || {};
    try { if (t.pollAnswerTimer) clearInterval(t.pollAnswerTimer); } catch {}
    try { if (t.candidatesInterval) clearInterval(t.candidatesInterval); } catch {}
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
      card.onclick = () => onProductTileClick(p, card);

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
      const baseId = String(item.sku || item.id || '').split('#')[0];
      const thumb = imgById.get(baseId) || '/public/images/products/placeholder.jpg';
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = thumb;
      img.onerror = () => { img.src = '/public/images/products/placeholder.jpg'; };

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

  const clearBtn = document.getElementById('clear-basket');
  if (clearBtn) clearBtn.addEventListener('click', () => window.onClearBasket());


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

  // ---- WebRTC two-way video (cashier offers)
async function initRTC(){
    try {
      clearRtcTimers();
      const localStream = await (window.startLocalCam ? window.startLocalCam(localEl) : navigator.mediaDevices.getUserMedia({video:true,audio:false}).then(s=>{localEl.srcObject=s;localEl.play().catch(()=>{});return s;}));
      const ice = await getIceServers();
      const params = new URLSearchParams(location.search);
      const icePolicy = params.get('ice') === 'relay' ? 'relay' : 'all';
      const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: icePolicy });
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
  function productOptions(p){
    if (!hasMilkVariants(p)) return null;
    return {
      size: [ {id:'reg', label:'Regular', delta:0}, {id:'lg', label:'Large', delta:0.5} ],
      milk: [ {id:'full', label:'Full fat', delta:0}, {id:'low', label:'Low fat', delta:0}, {id:'oat', label:'Oat', delta:0.25}, {id:'almond', label:'Almond', delta:0.25} ]
    };
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
    clearSelection();
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
