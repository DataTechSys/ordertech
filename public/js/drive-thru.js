import { qs, qsa, fmt, getParams, loadCategories, loadProducts, startLocalCam, setRemoteVideo, createCart, api } from '/public/js/common.js?v=1.0.13';
import { setDisplayId, renderBillList, renderTotals } from '/public/js/ui-common.js';
import { computeTotals } from '/public/js/data.js';

const { tenant, remote } = getParams();
const catsEl = qs('#cats');
const gridEl = qs('#grid');
const remoteEl = qs('#remoteVideo');
const localEl = qs('#localVideo');
const cart = createCart();

// selection highlight (read-only mirror)
let selProductId = '';
let selBtn = null;
const escapeAttr = (s) => {
  const v = String(s);
  try { if (window.CSS && typeof CSS.escape === 'function') return CSS.escape(v); } catch {}
  return v.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\]/g,'\\]');
};
function clearSelection(){ if (selBtn) selBtn.classList.remove('selected'); selBtn=null; selProductId=''; }
function applySelection(){
  if (!selProductId) return clearSelection();
  const btn = gridEl.querySelector(`.tile[data-id="${escapeAttr(selProductId)}"]`);
  if (selBtn && selBtn!==btn) selBtn.classList.remove('selected');
  selBtn = btn || null;
  if (selBtn) selBtn.classList.add('selected');
}

const POPULER = 'Populer';
let allProds = [];
let popular = [];

let myId = localStorage.getItem('DEVICE_ID_DISPLAY') || '';
let basketId = new URLSearchParams(location.search).get('basket') || '';
if (myId && basketId !== myId) {
  const params = new URLSearchParams(location.search);
  params.set('basket', myId);
  history.replaceState(null, '', location.pathname + '?' + params.toString());
  basketId = myId;
}
if (!basketId) {
  basketId = 'lane-1';
}
const proto = location.protocol === 'https:' ? 'wss' : 'ws';
let ws;
let catsReady = false;
let pendingCategory = '';
let currentBasket = { items: [], total: 0, version: 0 };
let imgMap = new Map();
let reconnectDelay = 500;
let reconnectTimer = null;
let peersConnected = false;
let statusFreezeUntil = 0; // gate READY flicker shortly after offers/restarts

connect();
init();
setupPresenceHeartbeat();
// Fallback: try starting RTC even if WS handshake is blocked by proxy/CDN
setTimeout(() => { if (!rtcStarted && !rtcStarting) startRTC(); }, 1200);

let rtcStarted = false;
let rtcStarting = false;
let rtcBackoff = 1000;
let restartTimer = null;
function clearRtcTimers(){
  const t = window.__rtcTimersDisplay || {};
  try { if (t.pollOfferTimer) clearInterval(t.pollOfferTimer); } catch {}
  try { if (t.candidatesInterval) clearInterval(t.candidatesInterval); } catch {}
  window.__rtcTimersDisplay = { pollOfferTimer: null, candidatesInterval: null };
}
function scheduleRtcRestart(reason){
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    try {
      const pc2 = window.__pcDisplay;
      const connected = pc2 && (pc2.iceConnectionState === 'connected' || pc2.connectionState === 'connected');
      if (!connected) {
        console.warn('RTC(display) restart', { reason });
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
function stopRTC(reason){
  try { console.log('RTC(display) stop', { reason }); } catch {}
  clearRtcTimers();
  try {
    const pc = window.__pcDisplay; if (pc && pc.close) pc.close();
  } catch {}
  window.__pcDisplay = null;
  try {
    const s = localEl && localEl.srcObject; if (s && s.getTracks) { for (const t of s.getTracks()) { try { t.stop(); } catch {} } }
    if (localEl) localEl.srcObject = null;
  } catch {}
  try { if (remoteEl) remoteEl.srcObject = null; } catch {}
  rtcStarted = false; rtcStarting = false; restartTimer && clearTimeout(restartTimer); restartTimer = null; rtcBackoff = 1000;
  // force refresh ICE servers next time
  try { window.__ICE_SERVERS = null; } catch {}
  const pill = document.getElementById('linkPill');
  const label = document.getElementById('linkStatus');
  const dot = pill ? pill.querySelector('.dot') : null;
  const keepLabel = (reason === 'preclear');
  if (!keepLabel) {
    if (label) label.textContent = 'READY';
    if (dot) dot.style.background = '#f59e0b';
    if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
  }
}
async function startRTC(){
  if (rtcStarted || rtcStarting) return;
  rtcStarting = true;
  try {
    const localStream = await startLocalCam(localEl);
    await initRTC(localStream);
    rtcStarted = true;
  } catch (e) { console.warn('RTC start failed', e); }
  finally { rtcStarting = false; }
}

async function init() {
  const cats = await loadCategories(tenant);
  allProds = await loadProducts(tenant);
  imgMap = new Map(allProds.map(p => [p.id, p.image_url]));
  popular = computePopular(allProds);
  renderCategories(cats);
  catsReady = true;
  if (pendingCategory) {
    await setActiveAndShow(pendingCategory);
    pendingCategory = '';
  } else {
    await showCategory(POPULER);
  }
}

function renderCategories(cats) {
  catsEl.innerHTML = '';
  const list = [{ name: POPULER }, ...cats];
  list.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'tab' + (i === 0 ? ' active' : '');
    b.textContent = c.name;
    b.onclick = async () => {
      await setActiveAndShow(c.name, b);
    };
    catsEl.appendChild(b);
  });
  // after rendering, reapply highlight if any
  applySelection();
}

async function setActiveAndShow(name, btnEl) {
  qsa('.tab', catsEl).forEach(x => x.classList.remove('active'));
  if (!btnEl) {
    btnEl = qsa('.tab', catsEl).find(el => (el.textContent || '').trim() === name);
  }
  if (btnEl) btnEl.classList.add('active');
  await showCategory(name);
}

async function showCategory(name) {
  if (name === POPULER) {
    renderProducts(popular);
    return;
  }
  const prods = await loadProducts(tenant, name);
  renderProducts(prods);
}

function renderProducts(list) {
  gridEl.innerHTML = '';
  list.forEach(p => {
    const card = document.createElement('button');
    card.className = 'tile';
    card.dataset.id = p.id;
    card.onclick = () => addToBill(p);

    const img = document.createElement('img');
    const src = p.image_url || '/public/images/products/placeholder.jpg';
    img.src = src;
    img.addEventListener('load', () => {
      console.log(`Image loaded: ${src}`);
    });
    img.onerror = () => {
      console.log(`Error loading image: ${src}`);
      img.src = '/public/images/products/placeholder.jpg';
    };

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = `${fmt(p.price)} KWD`;

    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(price);
    gridEl.appendChild(card);
  });
  // after rendering grid, reapply highlight if it was selected earlier
  applySelection();
}

function connect(){
  try {
    // Clear any pending reconnect to avoid duplicated sockets
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(proto + '://' + location.host);
    ws.addEventListener('open', () => {
      reconnectDelay = 500;
      try { ws.send(JSON.stringify({ type: 'subscribe', basketId })); } catch {}
      // Identify as display with name for peer-status
      try {
        const name = localStorage.getItem('DEVICE_NAME_DISPLAY') || localStorage.getItem('DEVICE_NAME') || 'Drive‑Thru';
        ws.send(JSON.stringify({ type:'hello', basketId, role:'display', name }));
      } catch {}
      const pill = document.getElementById('linkPill');
      const label = document.getElementById('linkStatus');
      const dot = pill ? pill.querySelector('.dot') : null;
      if (label) label.textContent = 'READY';
      if (dot) dot.style.background = '#f59e0b';
      if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
      // Start RTC immediately; display will poll for offer until cashier posts one
      startRTC();
      statusFreezeUntil = Date.now() + 3000;
    });
    ws.addEventListener('message', async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'rtc:stopped') {
          if (msg.reason === 'preclear') {
            stopRTC('preclear');
            statusFreezeUntil = Date.now() + 3000;
            scheduleRtcRestart('preclear');
          } else {
            stopRTC('remote');
          }
          return;
        }
        if (msg.type === 'peer:status') {
          const pill = document.getElementById('linkPill');
          const label = document.getElementById('linkStatus');
          const dot = pill ? pill.querySelector('.dot') : null;
          if (msg.status === 'connected') {
            peersConnected = true;
            const first = String(msg.cashierName||'Cashier').split(/\s+/)[0];
            if (label) label.textContent = `CONNECTED — ${first}`;
            if (dot) dot.style.background = '#22c55e';
            if (pill) { pill.style.background = '#22c55e'; pill.style.color = '#0b1220'; }
            startRTC();
          } else {
            // Avoid flicker to READY while we just received/are processing an offer/reconnect
            const pc = window.__pcDisplay;
            const midHandshake = (Date.now() < statusFreezeUntil) || (pc && (
              pc.connectionState === 'connecting' || pc.connectionState === 'connected' ||
              pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'connected'
            ));
            if (midHandshake) return;
            peersConnected = false;
            if (label) label.textContent = 'READY';
            if (dot) dot.style.background = '#f59e0b';
            if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
          }
        }
        if (msg.type === 'session:started' && msg.basketId === basketId) {
          const h = document.getElementById('osnHeader'); if (h) { h.textContent = msg.osn || ''; h.style.display = msg.osn ? '' : 'none'; }
        }
        if (msg.type === 'session:paid' && msg.basketId === basketId) {
          const h = document.getElementById('osnHeader'); if (h) { h.textContent = msg.osn || ''; h.style.display = msg.osn ? '' : 'none'; }
        }
        if (msg.type === 'session:ended' && msg.basketId === basketId) {
          const h = document.getElementById('osnHeader'); if (h) { h.textContent = ''; h.style.display = 'none'; }
        }
        if (msg.type === 'rtc:offer') {
          // A fresh offer is available; force-reset and (re)start RTC to fetch it
          try { stopRTC('new-offer'); } catch {}
          statusFreezeUntil = Date.now() + 3000;
          setTimeout(() => { try { startRTC(); } catch {} }, 150);
          return;
        }
        if (!peersConnected) return; // ignore UI mirroring when not connected
        if (msg.type === 'ui:selectCategory') {
          const name = String(msg.name||'');
          if (!name) return;
          if (!catsReady) { pendingCategory = name; return; }
          await setActiveAndShow(name);
        } else if (msg.type === 'basket:sync' || msg.type === 'basket:update') {
          updateBillFromBasket(msg.basket || { items: [], total: 0, version: 0 });
        } else if (msg.type === 'ui:showOptions') {
          const p = msg.product||{}; const opts = msg.options||{}; const sel = msg.selection||{};
          showOptionsUI(true, p, opts, sel);
        } else if (msg.type === 'ui:optionsUpdate') {
          updateOptionsSelection(msg.selection||{});
        } else if (msg.type === 'ui:optionsClose') {
          hideOptionsUI();
          clearSelection();
        } else if (msg.type === 'ui:selectProduct') {
          selProductId = String(msg.productId||'');
          applySelection();
        } else if (msg.type === 'ui:clearSelection') {
          clearSelection();
        }
      } catch {}
    });
    ws.addEventListener('close', () => {
      const pill = document.getElementById('linkPill');
      const label = document.getElementById('linkStatus');
      const dot = pill ? pill.querySelector('.dot') : null;
      if (label) label.textContent = 'OFFLINE';
      if (dot) dot.style.background = '#ef4444';
      if (pill) { pill.style.background = '#ef4444'; pill.style.color = '#fff'; }
      // Attempt to reconnect with backoff
      if (!reconnectTimer) {
        const delay = Math.min(reconnectDelay, 8000) + Math.floor(Math.random()*250);
        reconnectDelay = Math.min(reconnectDelay * 2, 8000);
        reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
      }
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch (_) {} });
  } catch {}
}

function addToBill(_p) {
  // No-op: drive-thru follows cashier basket now.
}

function setupPresenceHeartbeat(){
  const token = localStorage.getItem('DEVICE_TOKEN_DISPLAY') || localStorage.getItem('DEVICE_TOKEN') || '';
  if (!token) return; // not activated yet
  setInterval(async () => {
    try {
      const headers = { 'content-type':'application/json', 'x-device-token': token };
      if (tenant) headers['x-tenant-id'] = tenant;
      const name = localStorage.getItem('DEVICE_NAME_DISPLAY') || localStorage.getItem('DEVICE_NAME') || 'Drive‑Thru';
      const branch = localStorage.getItem('DEVICE_BRANCH') || '';
      await fetch('/presence/display', { method:'POST', headers, body: JSON.stringify({ id: basketId, name, branch }) });
    } catch {}
  }, 5000);
}

function updateBillFromBasket(basket) {
  currentBasket = basket || { items: [], total: 0, version: 0 };
  const mapped = (currentBasket.items || []).map(i => {
    const baseId = String(i.sku || i.id || '').split('#')[0];
    return { id: i.sku, name: i.name, price: Number(i.price)||0, qty: Number(i.qty)||0, thumb: imgMap.get(baseId) };
  });
  renderBillList('billItems', mapped);
  const totals = computeTotals(mapped);
  renderTotals(totals);
}

function showOptionsUI(readOnly, p, opts, sel){
  const modal = document.getElementById('optionsModal');
  const body = document.getElementById('optBody');
  const title = document.getElementById('optTitle');
  const btnCancel = document.getElementById('optCancel');
  const btnConfirm = document.getElementById('optConfirm');
  if (!modal||!body) return;
  title.textContent = `Choose options — ${p.name||''}`;
  btnCancel.disabled = true; btnConfirm.disabled = true;

  function render(){
    const grp = [];
    if (opts.size && opts.size.length){
      grp.push(`<fieldset><legend>Size</legend>${opts.size.map(o=>`<label style="display:block;margin:4px 0;"><input type=radio name=opt_size value="${o.id}" ${sel.sizeId===o.id?'checked':''} disabled> ${o.label}${o.delta?` (+${fmt(o.delta)} KWD)`:''}</label>`).join('')}</fieldset>`);
    }
    if (opts.milk && opts.milk.length){
      grp.push(`<fieldset><legend>Milk</legend>${opts.milk.map(o=>`<label style="display:block;margin:4px 0;"><input type=radio name=opt_milk value="${o.id}" ${sel.milkId===o.id?'checked':''} disabled> ${o.label}${o.delta?` (+${fmt(o.delta)} KWD)`:''}</label>`).join('')}</fieldset>`);
    }
    body.innerHTML = grp.join('');
  }
  render();
  modal.style.display = 'flex';
}
function updateOptionsSelection(sel){
  const body = document.getElementById('optBody'); if (!body || document.getElementById('optionsModal').style.display==='none') return;
  const sizeEl = body.querySelector(`input[name=opt_size][value="${sel.sizeId}"]`);
  const milkEl = body.querySelector(`input[name=opt_milk][value="${sel.milkId}"]`);
  if (sizeEl) sizeEl.checked = true; if (milkEl) milkEl.checked = true;
}
function hideOptionsUI(){ const m = document.getElementById('optionsModal'); if (m) m.style.display='none'; }

async function initRTC(localStream){
  try {
    clearRtcTimers();
    const ice = await getIceServers();
    const params = new URLSearchParams(location.search);
    const icePolicy = params.get('ice') === 'relay' ? 'relay' : 'all';
    const pc = new RTCPeerConnection({ iceServers: ice, iceTransportPolicy: icePolicy });
    window.__pcDisplay = pc;
    const pendingRemote = [];
    const addRemoteCandidate = async (cand) => {
      if (pc.remoteDescription && pc.signalingState !== 'have-local-offer') {
        try { await pc.addIceCandidate(new RTCIceCandidate(cand)); }
        catch (e) { console.error('addIceCandidate failed (display)', { candidate: cand, error: e }); }
      } else {
        pendingRemote.push(cand);
      }
    };
console.log('RTC(display) init', { pairId: basketId, icePolicy, servers: Array.isArray(ice) ? ice.length : 0 });
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    const remoteStream = new MediaStream();
    if (remoteEl) { remoteEl.srcObject = remoteStream; remoteEl.play && remoteEl.play().catch(()=>{}); }
    pc.ontrack = (ev) => { ev.streams[0]?.getTracks().forEach(tr => remoteStream.addTrack(tr)); };
pc.addEventListener('iceconnectionstatechange', () => {
      console.log('RTC(display) iceConnectionState:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected') { rtcBackoff = 1000; }
      if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') scheduleRtcRestart(pc.iceConnectionState);
    });
    pc.addEventListener('connectionstatechange', () => {
      console.log('RTC(display) connectionState:', pc.connectionState);
      if (pc.connectionState === 'connected') { rtcBackoff = 1000; }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') scheduleRtcRestart(pc.connectionState);
    });
    pc.addEventListener('icegatheringstatechange', () => console.log('RTC(display) iceGatheringState:', pc.iceGatheringState));
    pc.onicecandidate = async (ev) => {
      if (ev.candidate) {
        try {
await fetch('/webrtc/candidate', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId: basketId, role:'display', candidate: ev.candidate }) });
        } catch (err) { console.warn('POST /webrtc/candidate failed (display)', err); }
      } else {
        console.log('RTC(display) ICE gathering complete');
      }
    };
    // Wait/poll for offer, then answer
const pollOfferTimer = setInterval(async () => {
      try {
        const r = await fetch(`/webrtc/offer?pairId=${encodeURIComponent(basketId)}`);
        const j = await r.json();
        if (j && j.sdp && pc.signalingState === 'stable') {
          console.log('GET /webrtc/offer (display) received');
          await pc.setRemoteDescription({ type:'offer', sdp: j.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log('POST /webrtc/answer (display)');
          await fetch('/webrtc/answer', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId: basketId, sdp: answer.sdp }) });
          // flush buffered candidates
          if (pendingRemote.length) {
            console.log('RTC(display) flushing buffered remote candidates', { count: pendingRemote.length });
            for (const c of pendingRemote.splice(0)) { await addRemoteCandidate(c); }
          }
          // burst fetch candidates immediately after answering
          try {
              const r2 = await fetch(`/webrtc/candidates?pairId=${encodeURIComponent(basketId)}&role=display`);
              const j2 = await r2.json();
              const items2 = Array.isArray(j2.items) ? j2.items : [];
              if (items2.length) console.log('IMMEDIATE GET /webrtc/candidates (display)', { count: items2.length });
              for (const c of items2) { await addRemoteCandidate(c); }
            } catch {}
          clearInterval(pollOfferTimer);
          window.__rtcTimersDisplay = window.__rtcTimersDisplay || {};
          window.__rtcTimersDisplay.pollOfferTimer = null;
        } else if (!j.sdp && pc.remoteDescription) {
          console.log('GET /webrtc/offer (display) is gone; session ended');
          stopRTC('offer-gone');
        } else {
          console.log('GET /webrtc/offer (display) no offer yet');
        }
      } catch (err) { console.warn('GET /webrtc/offer failed (display)', err); }
}, 1200);
    window.__rtcTimersDisplay = window.__rtcTimersDisplay || {};
    window.__rtcTimersDisplay.pollOfferTimer = pollOfferTimer;
const candidatesInterval = setInterval(async () => {
      try {
        const r = await fetch(`/webrtc/candidates?pairId=${encodeURIComponent(basketId)}&role=display`);
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        if (items.length) console.log('GET /webrtc/candidates (display)', { count: items.length });
        for (const c of items) { await addRemoteCandidate(c); }
      } catch (err) { console.warn('GET /webrtc/candidates failed (display)', err); }
    }, 1800);
    window.__rtcTimersDisplay = window.__rtcTimersDisplay || {};
    window.__rtcTimersDisplay.candidatesInterval = candidatesInterval;
  } catch (e) { console.warn('RTC init failed', e); }
}

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
  const shuffled = withPhotos.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 12);
}
