import { qs, qsa, fmt, getParams, loadCategories, loadProducts, startLocalCam, setRemoteVideo, createCart, api, proxiedImageSrc } from '/js/common.js?v=1.0.14';
import { setDisplayId, renderBillList, renderTotals } from '/js/ui-common.js';
import { computeTotals } from '/js/data.js';

const { tenant, remote } = getParams();

// Load tenant brand for header logo
(async () => {
  try {
    const j = await api('/brand', { tenant });
    const logo = (j && j.logo_url) ? proxiedImageSrc(j.logo_url) : '';
    const img = document.querySelector('.logo-overlay, .topbar .logo');
    if (img && logo) img.src = logo;
  } catch {}
})();

const catsEl = qs('#cats');
try { catsEl.classList.add('tabs-grid'); } catch {}
const gridEl = qs('#grid');
const remoteEl = qs('#remoteVideo');
const localEl = qs('#localVideo');
const posterEl = document.getElementById('posterOverlay');
const posterA = posterEl ? document.getElementById('posterImgA') : null;
const posterB = posterEl ? document.getElementById('posterImgB') : null;
const posterNotice = posterEl ? document.getElementById('posterNotice') : null;
let posterEnabled = false; // gated by Drive-Thru state (posterOverlayEnabled)
let posterForce = false; // cashier override to force poster on/off regardless of setting
let posterList = [];
let posterIdx = 0;
let posterTimer = null;
// Popular list seed (shared via OSN)
let __popularSeed = null;
let posterResumeTimer = null;
let posterStopped = false;
let POSTER_INTERVAL_MS = 8000;
const cart = createCart();

// selection highlight (read-only mirror)
let selProductId = '';
let selBtn = null;

// Deterministic popular computation when a seed (e.g., OSN) is provided
function hashString(s){ let h = 2166136261>>>0; for (let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = (h * 16777619)>>>0; } return h>>>0; }
function seededRandom(seed){ let x = seed>>>0; return () => { x = (x * 1664525 + 1013904223)>>>0; return (x>>>0) / 4294967296; }; }
function seededShuffle(arr, seed){ const rnd = seededRandom(seed>>>0); const a = arr.slice(); for (let i=a.length-1;i>0;i--){ const j = Math.floor(rnd() * (i+1)); [a[i],a[j]] = [a[j],a[i]]; } return a; }
function computePopular(all, seed){ const base=(all||[]).slice().sort((a,b)=> String(a.id).localeCompare(String(b.id))); if (seed){ const s=(typeof seed==='string')?hashString(seed):(seed>>>0); return seededShuffle(base, s).slice(0,12);} const a = base.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]];} return a.slice(0,12);}
// Prefer direct HTTPS first; fall back to proxy on error; HTTP -> proxy immediately
function imageDisplaySrcForUrl(u){
  const raw = String(u || '').trim();
  if (!raw) return '';
  if (/^http:\/\//i.test(raw)) return proxiedImageSrc(raw); // avoid mixed content
  if (/^https:\/\//i.test(raw)) return raw;                 // try direct first
  return raw; // local/relative path
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
let lastCashierName = 'Cashier';

// Session/idle tracking and auto-refresh scheduler
let sessionActive = false; // true between session:started and session:ended
let idleSince = null;      // timestamp when we entered idle (no RTC and no session)
let lastReloadAt = 0;

function parseBusyWindows() {
  // Override via localStorage key DRIVE_BUSY_WINDOWS = JSON array of "HH:MM-HH:MM" strings
  try {
    const raw = localStorage.getItem('DRIVE_BUSY_WINDOWS');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    }
  } catch {}
  return ["09:00-23:00"]; // default busy window
}
function isWithinBusyWindows(d = new Date()){
  try {
    const minutes = d.getHours()*60 + d.getMinutes();
    const wins = parseBusyWindows();
    for (const w of wins) {
      const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(String(w));
      if (!m) continue;
      const s = parseInt(m[1],10)*60 + parseInt(m[2],10);
      const e = parseInt(m[3],10)*60 + parseInt(m[4],10);
      if (s <= e) { if (minutes >= s && minutes < e) return true; }
      else { if (minutes >= s || minutes < e) return true; }
    }
  } catch {}
  return false;
}
function isRtcConnected(){
  try {
    if (peersConnected) return true;
    const pc = window.__pcDisplay;
    if (!pc) return false;
    const ice = pc.iceConnectionState;
    const cs = pc.connectionState;
    return (ice === 'connected' || ice === 'completed' || cs === 'connected');
  } catch { return false; }
}
function isActive(){ return isRtcConnected() || sessionActive; }
function updateIdleState(){
  try {
    if (isActive()) idleSince = null; else if (idleSince == null) idleSince = Date.now();
  } catch {}
}
const IDLE_THRESHOLD_MS = (() => { try { const v = Number(localStorage.getItem('DRIVE_IDLE_MS')||''); if (Number.isFinite(v) && v>0) return v; } catch {} return 3*60*60*1000; })();
const IDLE_DISABLED = () => { try { return String(localStorage.getItem('DRIVE_IDLE_DISABLED')||'') === '1'; } catch { return false; } };
function maybeReloadIfIdle(){
  try {
    if (IDLE_DISABLED()) return;
    const now = Date.now();
    if (statusFreezeUntil && now < statusFreezeUntil) return;
    if (idleSince == null) return;
    if (isActive()) { idleSince = null; return; }
    if (isWithinBusyWindows(new Date())) return;
    if ((now - idleSince) < IDLE_THRESHOLD_MS) return;
    if (lastReloadAt && (now - lastReloadAt) < 10*60*1000) return; // do not thrash
    lastReloadAt = now;
    location.reload();
  } catch {}
}
try { setInterval(maybeReloadIfIdle, 5*60*1000); } catch {}

function renderLiveFlag(){
  try {
    const wrap = document.getElementById('liveFlag');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!peersConnected) return; // only show when connected
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'flag in-session';
    btn.textContent = `Live: ${String(lastCashierName||'').split(/\s+/)[0] || 'Cashier'}`;
    wrap.appendChild(btn);
  } catch {}
}

let __posterLastActive = null;
function sendPosterStatus(active){
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type:'poster:status', basketId, active: !!active }));
    }
  } catch {}
}
function isPosterVisible(){ try { return !!(posterEl && posterEl.style && posterEl.style.display !== 'none'); } catch { return false; } }
function setPosterVisible(show){
  try {
    // Allow hiding regardless of gating; only gate showing
    if (show && !(posterEnabled || posterForce)) return;
    if (!posterEl) return;
    posterEl.style.display = show ? 'flex' : 'none';
    if (show) document.body.classList.add('poster-active'); else document.body.classList.remove('poster-active');
    const active = isPosterVisible();
    if (__posterLastActive === null || __posterLastActive !== active) { __posterLastActive = active; sendPosterStatus(active); }
  } catch {}
}
function setPosterNotice(text, show){
  try {
    // Allow hiding regardless of gating; only gate showing
    if (show && !(posterEnabled || posterForce)) return;
    if (posterNotice) {
      if (text != null) posterNotice.textContent = text;
      posterNotice.style.display = show ? 'block' : 'none';
    }
  } catch {}
}
// Poster overlay default OFF; can be enabled via admin toggle in drive-thru state
function startPosterRotation(){
  if ((!posterEnabled && !posterForce) || !posterEl) return;
  // Try to fetch tenant posters
  const headers = {};
  try { if (tenant) headers['x-tenant-id'] = tenant; } catch {}
  fetch('/posters', { headers, cache: 'no-store' })
    .then(r => r.json())
    .then(j => {
      const items = Array.isArray(j?.items) ? j.items.filter(u => typeof u === 'string' && u) : [];
      if (items.length) {
        posterList = items;
        initPosterCycle();
        return;
      }
      // Fallback single poster: tenant default or global
const fb = (window.__DEFAULT_POSTER_URL || '').trim() || '/poster-default.png';
      if (posterA) { posterA.src = fb; posterA.classList.add('visible'); }
    })
    .catch(() => {
const fb = (window.__DEFAULT_POSTER_URL || '').trim() || '/poster-default.png';
      if (posterA) { posterA.src = fb; posterA.classList.add('visible'); }
    });
}

function swapPoster(){
  if (!posterEnabled || !posterEl || posterList.length === 0) return;
  const next = posterList[posterIdx % posterList.length];
  const aVis = posterA && posterA.classList.contains('visible');
  const showB = aVis; // if A visible, fade in B; else fade in A
  const target = showB ? posterB : posterA;
  const other  = showB ? posterA : posterB;
  if (target) {
    if (target.src !== next) target.src = next;
    target.classList.add('visible');
  }
  if (other) {
    other.classList.remove('visible');
  }
  posterIdx++;
}

function initPosterCycle(){
  // prime first
  if (!posterA || !posterB) return;
  posterIdx = 0;
  // set first into A
  if (posterList.length) {
    posterA.src = posterList[0];
    posterA.classList.add('visible');
    posterIdx = 1;
  }
  if (posterTimer) { try { clearInterval(posterTimer); } catch {} posterTimer = null; }
  posterStopped = false;
  posterTimer = setInterval(swapPoster, POSTER_INTERVAL_MS);
}

function isDisplayConnected(){
  try {
    if (peersConnected) return true;
    const pc = window.__pcDisplay;
    if (!pc) return false;
    const ice = pc.iceConnectionState;
    const cs = pc.connectionState;
    return (ice === 'connected' || ice === 'completed' || cs === 'connected');
  } catch { return false; }
}
function cancelPosterResume(){ try { if (posterResumeTimer) { clearTimeout(posterResumeTimer); posterResumeTimer=null; } } catch {} }
function resumePosterIfNoSession(){
  if (!posterEnabled) return;
  cancelPosterResume();
  posterResumeTimer = setTimeout(() => {
    try {
      if (!isDisplayConnected()) {
        posterStopped = false;
        setPosterVisible(true);
        initPosterCycle();
      }
    } catch {}
    posterResumeTimer = null;
  }, 120000); // 2 minutes
}
function stopPoster(){
  if (!posterEnabled && !posterForce) {
    // Even if overlay was shown via force previously, proceed to hide
  }
  try { if (posterTimer) { clearInterval(posterTimer); posterTimer = null; } } catch {}
  posterStopped = true;
  // Ensure both images are hidden immediately
  try { if (posterA) posterA.classList.remove('visible'); } catch {}
  try { if (posterB) posterB.classList.remove('visible'); } catch {}
  setPosterVisible(false);
  setPosterNotice('', false);
  // If user dismissed poster but no session starts within 2 minutes, resume poster
  resumePosterIfNoSession();
}

// Poster rotation is initialized after drive-thru state is loaded (see below)

// Load Drive‑Thru state to get posterOverlayEnabled and hiddenCategoryIds
let __hiddenCategoryIds = [];
async function loadDriveThruState(){
  try {
    const headers = { 'accept': 'application/json' };
    if (tenant) headers['x-tenant-id'] = tenant;
    const r = await fetch('/drive-thru/state', { headers, cache: 'no-store' });
    const j = await r.json();
    posterEnabled = !!j.posterOverlayEnabled;
    POSTER_INTERVAL_MS = (function(){ const n=Number(j.posterIntervalMs); return Number.isFinite(n) && n>0 ? n : 8000; })();
    // Transition class on overlay
    try {
      const ov = document.getElementById('posterOverlay');
      if (ov) {
        ov.classList.remove('transition-none');
        const t = String(j.posterTransitionType||'fade').toLowerCase();
        if (t === 'none') ov.classList.add('transition-none');
      }
    } catch {}
    try { window.__DEFAULT_POSTER_URL = String(j.defaultPosterUrl||'').trim(); } catch { window.__DEFAULT_POSTER_URL = ''; }
    __hiddenCategoryIds = Array.isArray(j.hiddenCategoryIds) ? j.hiddenCategoryIds.map(String) : [];
  } catch { posterEnabled = false; __hiddenCategoryIds = []; }
}

// Initialize poster and state after declarations to avoid TDZ issues
(async () => {
  try { await loadDriveThruState(); } catch {}
  try { startPosterRotation(); } catch {}
  if (posterEl) { try { posterEl.addEventListener('click', () => { stopPoster(); }); } catch {} }
})();

// Require activation for display role: if no device token, keep INACTIVE and do not start WS/RTC
try {
  const deviceToken = localStorage.getItem('DEVICE_TOKEN_DISPLAY') || localStorage.getItem('DEVICE_TOKEN') || '';
  if (!deviceToken) {
    const pill = document.getElementById('linkPill');
    const label = document.getElementById('linkStatus');
    const dot = pill ? pill.querySelector('.dot') : null;
    if (label) label.textContent = 'INACTIVE';
    if (dot) dot.style.background = '#6b7280'; // gray
    if (pill) { pill.style.background = '#6b7280'; pill.style.color = '#0b1220'; }
    // Ensure poster overlay remains visible and show notice
    setPosterVisible(true);
    setPosterNotice('No Active Key', true);
    // Load menu even if not activated, so the screen is useful
    try { init(); } catch {}
  } else {
    setPosterNotice('', false);
    connect();
    init();
    setupPresenceHeartbeat();
    // Fallback: try starting RTC even if WS handshake is blocked by proxy/CDN
    setTimeout(() => { if (!rtcStarted && !rtcStarting) startRTC(); }, 1200);
  }
} catch {
  // If localStorage is unavailable for some reason, default to INACTIVE
  const pill = document.getElementById('linkPill');
  const label = document.getElementById('linkStatus');
  const dot = pill ? pill.querySelector('.dot') : null;
  if (label) label.textContent = 'INACTIVE';
  if (dot) dot.style.background = '#6b7280';
  if (pill) { pill.style.background = '#6b7280'; pill.style.color = '#0b1220'; }
  setPosterVisible(true);
  setPosterNotice('No Active Key', true);
}

let rtcStarted = false;
let rtcStarting = false;
let rtcBackoff = 1000;
let restartTimer = null;
// Media health & heartbeat
let hbTimer = null;
let audioInHealthy = false, audioOutHealthy = false, videoInHealthy = false, videoOutHealthy = false;
let __lastStats = { aIn: { bytes: 0, at: 0 }, aOut: { bytes: 0, at: 0 }, vIn: { bytes: 0, at: 0 }, vOut: { bytes: 0, at: 0 } };
function clearRtcTimers(){
  const t = window.__rtcTimersDisplay || {};
  try { if (t.pollOfferTimer) clearInterval(t.pollOfferTimer); } catch {}
  try { if (t.candidatesInterval) clearInterval(t.candidatesInterval); } catch {}
  if (hbTimer) { try { clearInterval(hbTimer); } catch {} hbTimer = null; }
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
function setLinkStatusLabel(){
  try { renderLiveFlag(); } catch {}
  const pill = document.getElementById('linkPill');
  const label = document.getElementById('linkStatus');
  const dot = pill ? pill.querySelector('.dot') : null;
  // Consider actual PC connectivity in addition to media health
  const pcConnected = isDisplayConnected();
  const mediaHealthy = (audioInHealthy || videoInHealthy);
  const connected = (mediaHealthy || pcConnected) && peersConnected;
  if (connected) {
    if (label) label.textContent = `CONNECTED — ${lastCashierName}${(!videoInHealthy && audioInHealthy) ? ' (AUDIO ONLY)' : ''}`;
    if (dot) dot.style.background = '#22c55e';
    if (pill) { pill.style.background = '#22c55e'; pill.style.color = '#0b1220'; }
  } else {
    if (label) label.textContent = 'READY';
    if (dot) dot.style.background = '#f59e0b';
    if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
  }
}
let __posterApplyTimer = null;
function setPosterDesired(show){
  try { if (__posterApplyTimer) { clearTimeout(__posterApplyTimer); __posterApplyTimer = null; } } catch {}
  __posterApplyTimer = setTimeout(() => {
    try { setPosterVisible(show); } catch {}
    __posterApplyTimer = null;
  }, 600); // debounce to avoid flicker on transient health changes
}
function updatePosterFromHealth(){
  try { updateIdleState(); } catch {}
  // When forced by cashier, keep overlay visible regardless of media health
  if (posterForce) { setPosterVisible(true); setPosterNotice('', false); return; }
  if (!posterEnabled) return;
  // Hide poster as soon as the PC is connected OR we detect healthy inbound media
  const pcConnected = isDisplayConnected();
  if (pcConnected || videoInHealthy || audioInHealthy) {
    setPosterDesired(false);
    setPosterNotice('', false);
  } else {
    setPosterDesired(true);
    setPosterNotice('Waiting for session…', true);
  }
  // Push status whenever health changes might toggle visibility
  try { const active = isPosterVisible(); if (__posterLastActive === null || __posterLastActive !== active) { __posterLastActive = active; sendPosterStatus(active); } } catch {}
}
function beginRtcStats(pc){
  if (hbTimer) { try { clearInterval(hbTimer); } catch {} hbTimer = null; }
  __lastStats = { aIn: { bytes: 0, at: 0 }, aOut: { bytes: 0, at: 0 }, vIn: { bytes: 0, at: 0 }, vOut: { bytes: 0, at: 0 } };
  hbTimer = setInterval(async () => {
    try {
      const now = Date.now();
      const rep = await pc.getStats();
      let aIn = null, aOut = null, vIn = null, vOut = null;
      rep.forEach(r => {
        if (r.type === 'inbound-rtp' && !r.isRemote) {
          if (r.kind === 'audio') aIn = r.bytesReceived;
          else if (r.kind === 'video') vIn = r.bytesReceived;
        } else if (r.type === 'outbound-rtp' && !r.isRemote) {
          if (r.kind === 'audio') aOut = r.bytesSent;
          else if (r.kind === 'video') vOut = r.bytesSent;
        }
      });
      // update last bytes and timestamps
      if (typeof aIn === 'number') {
        if (aIn > __lastStats.aIn.bytes) { __lastStats.aIn.bytes = aIn; __lastStats.aIn.at = now; }
      }
      if (typeof vIn === 'number') {
        if (vIn > __lastStats.vIn.bytes) { __lastStats.vIn.bytes = vIn; __lastStats.vIn.at = now; }
      }
      if (typeof aOut === 'number') {
        if (aOut > __lastStats.aOut.bytes) { __lastStats.aOut.bytes = aOut; __lastStats.aOut.at = now; }
      }
      if (typeof vOut === 'number') {
        if (vOut > __lastStats.vOut.bytes) { __lastStats.vOut.bytes = vOut; __lastStats.vOut.at = now; }
      }
      // derive health booleans (last activity within 6s)
      audioInHealthy = (__lastStats.aIn.at && (now - __lastStats.aIn.at) < 6000);
      videoInHealthy = (__lastStats.vIn.at && (now - __lastStats.vIn.at) < 6000);
      audioOutHealthy = (__lastStats.aOut.at && (now - __lastStats.aOut.at) < 6000);
      videoOutHealthy = (__lastStats.vOut.at && (now - __lastStats.vOut.at) < 6000);
      // send heartbeat
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type:'rtc:heartbeat', basketId, audio:{ in: audioInHealthy, out: audioOutHealthy }, video:{ in: videoInHealthy, out: videoOutHealthy } }));
        }
      } catch {}
      // update UI
      setLinkStatusLabel();
      updatePosterFromHealth();
    } catch {}
  }, 2000);
}
function stopRTC(reason){
  try { updateIdleState(); } catch {}
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
  // Reset health and show poster when RTC is stopped
  audioInHealthy = audioOutHealthy = videoInHealthy = videoOutHealthy = false;
  setPosterVisible(true);
}
async function startRTC(){
  if (rtcStarted || rtcStarting) return;
  rtcStarting = true;
  try {
    const localStream = await startLocalCam(localEl, { audio: true });
    await initRTC(localStream);
    rtcStarted = true;
  } catch (e) { console.warn('RTC start failed', e); }
  finally { rtcStarting = false; }
}

async function init() {
  // Register service worker for offline caching (no-op if unsupported)
  try { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}); } catch {}

  // Fallback loader from static JSON catalog when API fails
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
    cats = await loadCategories(tenant);
  } catch {
    // categories load failed; only fallback when no tenant is specified
    if (!tenant) {
      const fb = await loadFallbackCatalog();
      cats = fb.cats;
    } else {
      cats = [];
    }
  }
  try {
    allProds = await loadProducts(tenant);
  } catch {
    // products load failed; only fallback when no tenant is specified
    if (!tenant) {
      const fb = await loadFallbackCatalog();
      if (!cats || !cats.length) cats = fb.cats;
      allProds = fb.prods;
    } else {
      allProds = [];
    }
  }

  imgMap = new Map((allProds||[]).map(p => [p.id, imageDisplaySrcForUrl(p.image_url)]));
  try { prefetchImages(allProds).catch(()=>{}); } catch {}
  // Compute "Populer" deterministically when a session seed is available
  {
    const curated = buildDemoPopular(allProds||[]);
    popular = __popularSeed ? seededShuffle(curated, hashString(String(__popularSeed))).slice(0,12) : curated;
  }
  // Filter hidden categories if present
  const visibleCats = Array.isArray(cats) && __hiddenCategoryIds.length
    ? cats.filter(c => !__hiddenCategoryIds.includes(String(c.id)))
    : cats;
  renderCategories(visibleCats||[]);
  catsReady = true;
  if (pendingCategory) {
    await setActiveAndShow(pendingCategory);
    pendingCategory = '';
  } else {
    await showCategory(POPULER);
  }
}

function renderCategories(cats) {
  // Responsive grid (auto-fit). Include POPULER at the start.
  catsEl.innerHTML = '';
  catsEl.classList.remove('two-rows');
  const list = [{ name: POPULER }, ...cats];

  const makeBtn = (c, i, isActive) => {
    const b = document.createElement('button');
    b.className = 'tab' + (isActive ? ' active' : '');
    b.textContent = c.name;
    b.style.minWidth = '0';
    b.onclick = async () => {
      await setActiveAndShow(c.name, b);
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ui:selectCategory', basketId, name: c.name }));
        }
      } catch {}
    };
    return b;
  };

  list.forEach((c, idx) => {
    const isActive = (idx === 0);
    const btn = makeBtn(c, idx, isActive);
    catsEl.appendChild(btn);
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
  // Ensure idle tracking reacts to user/category activity
  try { updateIdleState(); } catch {}
  if (name === POPULER) {
    renderProducts(popular);
    return;
  }
try {
    const prods = await loadProducts(tenant, name);
    renderProducts(prods);
  } catch {
    // Offline or fetch failed: derive from full list loaded at startup
    try {
      const prods = (allProds||[]).filter(p => String(p.category_name||'') === String(name||''));
      renderProducts(prods);
    } catch {}
  }
}


function renderProducts(list) {
  gridEl.innerHTML = '';
  list.forEach(p => {
    const card = document.createElement('button');
    card.className = 'tile';
card.onclick = () => onProductTileClick(p, card);

    const img = document.createElement('img');
    const initial = imageDisplaySrcForUrl(p.image_url) || '/images/products/placeholder.jpg';
    img.src = initial;
    attachImageFallback(img, p.image_url);

    // Names wrapper: Arabic first (RTL), then English
    const names = document.createElement('div');
    names.className = 'names';
    try { names.style.textAlign = 'center'; names.style.width = '100%'; } catch {}

    const nameAr = document.createElement('div');
    nameAr.className = 'name-ar';
    nameAr.dir = 'rtl';
    try { nameAr.style.textAlign = 'center'; } catch {}

    const nameEn = document.createElement('div');
    nameEn.className = 'name-en';
    nameEn.textContent = p.name;
    try { nameEn.style.textAlign = 'center'; } catch {}

    const ar = (p.name_localized && String(p.name_localized).trim()) ? String(p.name_localized).trim() : '';
    nameAr.textContent = ar || '\u00A0';
    names.appendChild(nameAr);
    names.appendChild(nameEn);

    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = `${fmt(p.price)} KWD`;
    try { price.style.textAlign = 'center'; width='100%'; } catch {}

    card.appendChild(img);
    card.appendChild(names);
    card.appendChild(price);
    gridEl.appendChild(card);
  });
  // after rendering grid, reapply highlight if it was selected earlier
  applySelection();
}

function connect(){
  try { updateIdleState(); } catch {}
  try {
    // Clear any pending reconnect to avoid duplicated sockets
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(proto + '://' + location.host);
ws.addEventListener('open', () => {
      try { updateIdleState(); } catch {}
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
      // Keep poster visible while connecting/handshaking
      setPosterVisible(true);
      // Start RTC immediately; display will poll for offer until cashier posts one
      startRTC();
      statusFreezeUntil = Date.now() + 3000;
    });
    ws.addEventListener('message', async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'rtc:status' && msg.basketId === basketId) {
          try {
            const their = msg.status || {};
            const fromCashier = their.cashier || {};
            // cashier outbound == our inbound
            audioInHealthy = !!(fromCashier.audio && fromCashier.audio.out);
            videoInHealthy = !!(fromCashier.video && fromCashier.video.out);
            setLinkStatusLabel();
            updatePosterFromHealth();
          } catch {}
          return;
        }
        if (msg.type === 'rtc:stopped') {
          if (msg.reason === 'preclear') {
            stopRTC('preclear');
            statusFreezeUntil = Date.now() + 3000;
            scheduleRtcRestart('preclear');
          } else {
            stopRTC('remote');
            // If cashier requested a hard reset, reload to pick up latest config/state
            if (msg.reason === 'reset') {
              try { location.reload(); } catch {}
            }
          }
          return;
        }
        if (msg.type === 'peer:status') {
          const pill = document.getElementById('linkPill');
          const label = document.getElementById('linkStatus');
          const dot = pill ? pill.querySelector('.dot') : null;
if (msg.status === 'connected') { cancelPosterResume();
            peersConnected = true; updateIdleState();
            lastCashierName = String(msg.cashierName||'Cashier').split(/\s+/)[0];
            // Update drive live flag
            try { renderLiveFlag(); } catch {}
            // Do not set pill here; let RTCPeerConnection events drive the UI to avoid flicker
            startRTC();
          } else {
            // Avoid flicker to READY while we are connecting/connected
            const pc = window.__pcDisplay;
            const midHandshake = (Date.now() < statusFreezeUntil) || (pc && (
              pc.connectionState === 'connecting' || pc.connectionState === 'connected' ||
              pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'connected'
            ));
            if (midHandshake) return;
peersConnected = false; updateIdleState();
            try { renderLiveFlag(); } catch {}
            if (label) label.textContent = 'READY';
            if (dot) dot.style.background = '#f59e0b';
            if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
          }
        }
if (msg.type === 'session:started' && msg.basketId === basketId) {
          sessionActive = true; updateIdleState();
          const h = document.getElementById('osnHeader'); if (h) { h.textContent = msg.osn || ''; h.style.display = msg.osn ? '' : 'none'; }
          // Use OSN as popular seed so cashier and display show identical Populer list
          __popularSeed = msg.osn || null;
          // Reset product highlight on new session
          try { clearSelection(); } catch {}
          try {
            const curated = buildDemoPopular(allProds);
            popular = __popularSeed ? seededShuffle(curated, hashString(String(__popularSeed))).slice(0,12) : curated;
            await showCategory(POPULER);
          } catch {}
        }
        if (msg.type === 'session:paid' && msg.basketId === basketId) {
          const h = document.getElementById('osnHeader'); if (h) { h.textContent = msg.osn || ''; h.style.display = msg.osn ? '' : 'none'; }
        }
if (msg.type === 'poster:start' && msg.basketId === basketId) {
          posterForce = true;
          setPosterVisible(true);
          try { startPosterRotation(); } catch {}
          // Acknowledge status back to peers
          try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'poster:status', basketId, active: true })); } catch {}
        }
        if (msg.type === 'poster:stop' && msg.basketId === basketId) {
          posterForce = false;
          stopPoster();
          // Acknowledge status back to peers
          try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'poster:status', basketId, active: false })); } catch {}
        }
        if (msg.type === 'session:ended' && msg.basketId === basketId) {
          sessionActive = false; updateIdleState();
          const h = document.getElementById('osnHeader'); if (h) { h.textContent = ''; h.style.display = 'none'; }
          // Back to poster when session ends
          setPosterVisible(true);
        }
        if (msg.type === 'poster:query' && msg.basketId === basketId) {
          try {
            const active = !!(posterForce || (posterEl && posterEl.style && posterEl.style.display !== 'none'));
            if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'poster:status', basketId, active }));
          } catch {}
          return;
        }
        if (msg.type === 'preflight:begin' && msg.basketId === basketId) {
          try {
            const list = Array.isArray(msg.scenarios) ? msg.scenarios : [];
            for (const sc of list) { try { runPreflightAnswer(msg.requestId, sc); } catch {} }
          } catch {}
          return;
        }
        if (msg.type === 'rtc:offer') {
          // A fresh offer is available; force-reset and (re)start RTC to fetch it
          try { stopRTC('new-offer'); } catch {}
          statusFreezeUntil = Date.now() + 3000;
          setTimeout(() => { try { startRTC(); } catch {} }, 150);
          return;
        }
        // Allow UI mirroring regardless of RTC media connection; rely on WS
        // (do not return early here)
        if (msg.type === 'ui:selectCategory') {
          const name = String(msg.name||'');
          if (!name) return;
          if (!catsReady) { pendingCategory = name; return; }
          await setActiveAndShow(name);
        } else if (msg.type === 'basket:sync' || msg.type === 'basket:update') {
          updateBillFromBasket(msg.basket || { items: [], total: 0, version: 0 });
        } else if (msg.type === 'ui:showOptions') {
          const p = msg.product||{}; const opts = msg.options||{}; const sel = msg.selection||{};
          if (Array.isArray(msg.groups) && msg.groups.length) { showProductPopupWithOptions(p, msg.groups); }
          else {
            // Fallback: fetch modifiers locally
            try {
              const groups = await fetchProductModifiers(p);
              if (Array.isArray(groups) && groups.length) { showProductPopupWithOptions(p, groups); }
              else { showOptionsUI(true, p, opts, sel); }
            } catch { showOptionsUI(true, p, opts, sel); }
          }
        } else if (msg.type === 'ui:showPreview') {
          const p = msg.product||{}; showProductPreviewUIDisplay(p);
          // Attempt to auto-upgrade to options if modifiers exist
          try {
            const groups = await fetchProductModifiers(p);
            if (Array.isArray(groups) && groups.length) { showProductPopupWithOptions(p, groups); }
          } catch {}
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
      try { updateIdleState(); } catch {}
      peersConnected = false; try { renderLiveFlag(); } catch {}
      const pill = document.getElementById('linkPill');
      const label = document.getElementById('linkStatus');
      const dot = pill ? pill.querySelector('.dot') : null;
      if (label) label.textContent = 'OFFLINE';
      if (dot) dot.style.background = '#ef4444';
      if (pill) { pill.style.background = '#ef4444'; pill.style.color = '#fff'; }
      // Show poster while offline
      setPosterVisible(true);
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

function addToBill(p) {
  // Two-click add on display: send basket update to server
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'basket:update', basketId, op: { action: 'add', item: { sku: p.id, name: p.name, price: Number(p.price)||0 }, qty: 1 } }));
    }
  } catch {}
}

function setupPresenceHeartbeat(){
  const token = localStorage.getItem('DEVICE_TOKEN_DISPLAY') || localStorage.getItem('DEVICE_TOKEN') || '';
  setInterval(async () => {
    try {
      const headers = { 'content-type':'application/json' };
      if (token) headers['x-device-token'] = token;
      if (tenant) headers['x-tenant-id'] = tenant;
      const name = localStorage.getItem('DEVICE_NAME_DISPLAY') || localStorage.getItem('DEVICE_NAME') || 'Drive‑Thru';
      const branch = localStorage.getItem('DEVICE_BRANCH') || '';
      await fetch('/presence/display', { method:'POST', headers, body: JSON.stringify({ id: basketId, name, branch }) });
    } catch {}
  }, 5000);
}

function onProductTileClick(p, btn){
  try { updateIdleState(); } catch {}
  // New behavior: open overlay immediately and mirror preview to cashier
  clearSelection();
  try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showPreview', basketId, product: p })); } catch {}
  onDisplayProductClick(p);
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
      const items = opts.size.map(o => renderOptionButton({ id:o.id, name:o.label, delta:o.delta }, sel.sizeId===o.id)).join('');
      grp.push(`<fieldset><legend>Size</legend><div class=\"optrow\">${items}</div></fieldset>`);
    }
    if (opts.milk && opts.milk.length){
      const items = opts.milk.map(o => renderOptionButton({ id:o.id, name:o.label, delta:o.delta }, sel.milkId===o.id)).join('');
      grp.push(`<fieldset><legend>Milk</legend><div class=\"optrow\">${items}</div></fieldset>`);
    }
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
            // Toggle selected state within group (single-select)
            fs.querySelectorAll('button.optbtn').forEach(b => b.classList.toggle('selected', b===btn));
            applyOptionButtonStyles(fs);
            try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsUpdate', basketId, selection: sel })); } catch {}
          });
        });
      });
    }
  }
  render();
  modal.style.display = 'flex';
}
function updateOptionsSelection(sel){
  const body = document.getElementById('optBody'); if (!body || document.getElementById('optionsModal').style.display==='none') return;
  try {
    const sizeFs = Array.from(body.querySelectorAll('fieldset')).find(fs => /size/i.test((fs.querySelector('legend')||{}).textContent||''));
    if (sizeFs) {
      sizeFs.querySelectorAll('button.optbtn').forEach(b => b.classList.toggle('selected', b.getAttribute('data-opt')===String(sel.sizeId||'')));
      applyOptionButtonStyles(sizeFs);
    }
    const milkFs = Array.from(body.querySelectorAll('fieldset')).find(fs => /milk/i.test((fs.querySelector('legend')||{}).textContent||''));
    if (milkFs) {
      milkFs.querySelectorAll('button.optbtn').forEach(b => b.classList.toggle('selected', b.getAttribute('data-opt')===String(sel.milkId||'')));
      applyOptionButtonStyles(milkFs);
    }
  } catch {}
}
function hideOptionsUI(){ const m = document.getElementById('optionsModal'); if (m) m.style.display='none'; try { const card=document.getElementById('optionsCard'); if (card) card.classList.remove('compact'); } catch {} }

// Fetch real modifiers for display page
async function fetchProductModifiers(p){
  try {
    const headers = { 'accept':'application/json' };
    try { if (tenant) headers['x-tenant-id'] = tenant; } catch {}
    const r = await fetch(`/products/${encodeURIComponent(p.id)}/modifiers`, { cache: 'no-store', headers });
    const j = await r.json();
    const items = Array.isArray(j?.items) ? j.items : [];
    const groups = items
      .map(it => ({ id: it.group?.group_id, name: it.group?.name, required: !!it.group?.required, min: (it.group?.min_select ?? 0), max: (it.group?.max_select ?? 0), options: (it.options||[]).map(o => ({ id:o.id, name:o.name, delta:Number(o.price)||0 })) }))
      .filter(g => g.id && (g.options||[]).length);
    return groups;
  } catch { return []; }
}

// Interactive options UI (buttons) for both simple options and real modifier groups
function renderOptionButton(o, selected){
  const extra = o.delta ? ` (+${fmt(o.delta)} KWD)` : '';
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

function showProductPreviewUIDisplay(p){
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
  const imgUrl = imageDisplaySrcForUrl(p.image_url) || '/images/products/placeholder.jpg';
  const price = fmt(p.price) + ' KWD';
  body.innerHTML = `
    <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
      <img class="product-img" src="${imgUrl}" alt="${p.name}"/>
      <div class="names" style="text-align:center; width:100%;">
        <div class="name-ar" style="font-family: 'Almarai', Inter, system-ui; font-weight:700; font-size:1.1em; direction:rtl;">${ar||'\u00A0'}</div>
        <div class="name-en" style="font-family: 'Almarai', Inter, system-ui; font-weight:600;">${p.name}</div>
        <div class="price" style="margin-top:6px; color:#6b7280; font-weight:700;">${price}</div>
      </div>
    </div>
  `;
  try { const el = body.querySelector('img.product-img'); if (el) attachImageFallback(el, p.image_url); } catch {}
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
        // Drive: open full interactive modifiers UI and mirror to cashier
        showProductPopupWithOptions(p, groups);
        try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups })); } catch {}
      } else {
        // Fallback to simple options if defined
        const opts = { };
        // No dynamic simple opts for drive yet; add directly
        addToBill(p);
        hideOptionsUI();
      }
    } catch {
      addToBill(p);
      hideOptionsUI();
    }
  };
  modal.style.display = 'flex';
}

async function onDisplayProductClick(p){
  // Show preview locally and remotely; then, if modifiers exist, open options and mirror to cashier
  try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showPreview', basketId, product: p })); } catch {}
  showProductPreviewUIDisplay(p);
  try {
    const groups = await fetchProductModifiers(p);
    if (Array.isArray(groups) && groups.length) {
      showProductPopupWithOptions(p, groups);
      try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups })); } catch {}
    }
  } catch {}
}

// Detailed ICE config helper
async function getIceConfigDetailed(){
  try { const r = await fetch('/webrtc/config', { cache:'no-store' }); return await r.json(); } catch { return { iceServers:[{ urls: ['stun:stun.l.google.com:19302'] }] }; }
}

async function runPreflightAnswer(requestId, scenario){
  try {
    const pairId = `pf_${requestId}_${scenario.id}`;
    const cfg = await getIceConfigDetailed();
    let iceServers = cfg.iceServers || [];
    let iceTransportPolicy = scenario.policy || 'all';
    if (scenario.provider === 'twilio' && Array.isArray(cfg.twilioServers) && cfg.twilioServers.length) iceServers = cfg.twilioServers;
    else if (scenario.provider === 'self' && Array.isArray(cfg.selfServers) && cfg.selfServers.length) iceServers = [...cfg.selfServers, { urls:['stun:stun.l.google.com:19302'] }];

    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy });
    pc.ondatachannel = (ev) => {
      try {
        const dc = ev.channel;
        dc.onmessage = (m) => {
          try { const mm = JSON.parse(m.data); if (mm && mm.type==='pf-ping') { dc.send(JSON.stringify({ type:'pf-pong', t: mm.t })); } } catch {}
        };
      } catch {}
    };
    pc.onicecandidate = async (ev) => {
      if (!ev.candidate) return;
      try { await fetch('/webrtc/candidate', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId, role:'display', candidate: ev.candidate }) }); } catch {}
    };

    const deadline = Date.now() + (scenario.timeoutMs || 2500);
    // poll for offer
    let offered = false;
    while (Date.now() < deadline && !offered) {
      try {
        const r = await fetch(`/webrtc/offer?pairId=${encodeURIComponent(pairId)}`);
        const j = await r.json();
        if (j && j.sdp) {
          await pc.setRemoteDescription({ type:'offer', sdp: j.sdp });
          offered = true; break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 150));
    }
    if (!offered) { try { pc.close(); } catch {}; return; }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await fetch('/webrtc/answer', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ pairId, sdp: answer.sdp }) });

    // short candidate poll loop
    const candTimer = setInterval(async () => {
      try {
        const r = await fetch(`/webrtc/candidates?pairId=${encodeURIComponent(pairId)}&role=display`);
        const j = await r.json();
        const items = Array.isArray(j.items)?j.items:[];
        for (const c of items) { try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {} }
      } catch {}
    }, 180);

    setTimeout(() => { try { clearInterval(candTimer); } catch {}; try { pc.close(); } catch {}; fetch(`/webrtc/session/${encodeURIComponent(pairId)}?reason=preflight`, { method:'DELETE' }).catch(()=>{}); }, (scenario.timeoutMs||2500));
  } catch {}
}

async function initRTC(localStream){
  try {
    clearRtcTimers();
    const cfg = await getIceConfigDetailed();
    let iceServers = cfg.iceServers || [];
    let icePolicy = 'all';
    try {
      const apply = window.applyRtcConfig || null; // { provider, policy }
      if (apply && apply.policy) icePolicy = apply.policy;
      if (apply && apply.provider === 'twilio' && Array.isArray(cfg.twilioServers) && cfg.twilioServers.length) {
        iceServers = cfg.twilioServers;
      } else if (apply && apply.provider === 'self' && Array.isArray(cfg.selfServers) && cfg.selfServers.length) {
        iceServers = [...cfg.selfServers, { urls: ['stun:stun.l.google.com:19302'] }];
      }
    } catch {}
    const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: icePolicy });
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
    try { tuneQoS(pc); } catch {}
    const remoteStream = new MediaStream();
    if (remoteEl) { remoteEl.srcObject = remoteStream; remoteEl.play && remoteEl.play().catch(()=>{}); }
    pc.ontrack = (ev) => {
      ev.streams[0]?.getTracks().forEach(tr => remoteStream.addTrack(tr));
      // As soon as any remote track arrives, hide the poster immediately (unless forced)
      try { if (!posterForce) { setPosterVisible(false); setPosterNotice('', false); } } catch {}
    };
pc.addEventListener('iceconnectionstatechange', () => {
      try { updateIdleState(); } catch {}
      console.log('RTC(display) iceConnectionState:', pc.iceConnectionState);
      const isConnected = (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
      if (isConnected) { cancelPosterResume();
        rtcBackoff = 1000;
        // Hide poster early on successful ICE connection
        try { if (!posterForce) { setPosterVisible(false); setPosterNotice('', false); } } catch {}
        setLinkStatusLabel();
        updatePosterFromHealth();
        statusFreezeUntil = Date.now() + 2000;
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        // Show poster when not connected
        audioInHealthy = audioOutHealthy = videoInHealthy = videoOutHealthy = false;
        setPosterVisible(true);
        if (Date.now() >= statusFreezeUntil) setLinkStatusLabel();
        scheduleRtcRestart(pc.iceConnectionState);
      }
    });
pc.addEventListener('connectionstatechange', () => {
      try { updateIdleState(); } catch {}
      console.log('RTC(display) connectionState:', pc.connectionState);
      if (pc.connectionState === 'connected') { cancelPosterResume();
        rtcBackoff = 1000;
        // Hide poster early on successful connection
        try { if (!posterForce) { setPosterVisible(false); setPosterNotice('', false); } } catch {}
        setLinkStatusLabel();
        updatePosterFromHealth();
        statusFreezeUntil = Date.now() + 2000;
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        audioInHealthy = audioOutHealthy = videoInHealthy = videoOutHealthy = false;
        setPosterVisible(true);
        if (Date.now() >= statusFreezeUntil) setLinkStatusLabel();
        scheduleRtcRestart(pc.connectionState);
      }
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
    beginRtcStats(pc);

    // QoS tuning: prioritize audio, enable simulcast
    function tuneQoS(pc){
      try {
        const senders = pc.getSenders ? pc.getSenders() : [];
        for (const s of senders){
          const p = s.getParameters ? s.getParameters() : null; if (!p) continue;
          if (s.track && s.track.kind === 'audio'){
            p.encodings = p.encodings && p.encodings.length ? p.encodings : [{}];
            p.encodings[0].maxBitrate = 64000;
            p.degradationPreference = 'maintain-framerate';
            try { s.setParameters(p); } catch {}
          }
          if (s.track && s.track.kind === 'video'){
            p.encodings = p.encodings && p.encodings.length ? p.encodings : [{},{},{}];
            if (p.encodings[0]) p.encodings[0].maxBitrate = 250000;
            if (p.encodings[1]) p.encodings[1].maxBitrate = 600000;
            if (p.encodings[2]) p.encodings[2].maxBitrate = 1200000;
            p.degradationPreference = 'balanced';
            try { s.setParameters(p); } catch {}
          }
        }
      } catch {}
    }
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

// Full modifiers popup (interactive) with button options
function showProductPopupWithOptions(p, groups){
  const modal = document.getElementById('optionsModal');
  const body = document.getElementById('optBody');
  const title = document.getElementById('optTitle');
  const btnCancel = document.getElementById('optCancel');
  const btnConfirm = document.getElementById('optConfirm');
  const card = document.getElementById('optionsCard');
  if (!modal||!body||!title||!btnCancel||!btnConfirm) return;
  title.textContent = 'Add Item';
  try { if (card) card.classList.add('compact'); } catch {}
  const sel = new Map();
  for (const g of (groups||[])) { sel.set(g.id, new Set()); if (g.required && (g.min||0)===1 && (g.max||1)===1 && g.options && g.options[0]) sel.get(g.id).add(g.options[0].id); }
  function computePrice(){ let price = Number(p.price)||0; for (const g of groups){ const set = sel.get(g.id)||new Set(); for (const oid of set){ const opt=(g.options||[]).find(o=>String(o.id)===String(oid)); if (opt) price += Number(opt.delta)||0; } } return Math.round(price*1000)/1000; }
  function selectionLabel(){ const parts=[]; for (const g of groups){ const set=sel.get(g.id)||new Set(); const names=(g.options||[]).filter(o=>set.has(o.id)).map(o=>o.name); if (names.length) parts.push(`${g.name}: ${names.join('/')}`); } return parts.join(', '); }
  function render(){
    const ar = (p.name_localized && String(p.name_localized).trim()) ? String(p.name_localized).trim() : '';
    const img = imageDisplaySrcForUrl(p.image_url) || '/images/products/placeholder.jpg';
    const price = computePrice();
    function section(g){
      const set = sel.get(g.id)||new Set();
      const multi = (g.max||0) !== 1;
      const items = (g.options||[]).map(o => renderOptionButton({ id:o.id, name:o.name, delta:o.delta }, set.has(o.id))).join('');
      const note = (g.required || g.min || g.max) ? `<small class=\"muted\">${g.required?'Required. ':''}${g.min?`Min ${g.min}. `:''}${g.max?`Max ${g.max}.`:''}</small>` : '';
      return `<fieldset data-gid=\"${g.id}\"><legend>${g.name}</legend><div class=\"optrow\">${items}</div>${note}</fieldset>`;
    }
    body.innerHTML = `
      <div style=\"display:flex; flex-direction:column; gap:12px;\">\n        <img class=\"product-img\" src=\"${img}\" alt=\"${p.name}\" onerror=\"this.src='/images/products/placeholder.jpg'\"/>\n        <div class=\"names\" style=\"text-align:center; width:100%;\">\n          <div class=\"name-ar\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:700; font-size:1.1em; direction:rtl;\">${ar||'\\u00A0'}</div>\n          <div class=\"name-en\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:600;\">${p.name}</div>\n          <div class=\"price\" id=\"optPriceKwd\" style=\"margin-top:6px; color:#6b7280; font-weight:700;\">${fmt(price)} KWD</div>\n        </div>\n        ${groups.map(section).join('')}\n      </div>`;
    applyOptionButtonStyles(body);
    body.querySelectorAll('fieldset').forEach(fs => {
      const gid = fs.getAttribute('data-gid');
      const g = (groups||[]).find(x => String(x.id)===String(gid));
      const set = sel.get(gid)||new Set();
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
            if (ws && ws.readyState===WebSocket.OPEN) {
              const selection = {}; for (const [k,v] of sel.entries()) selection[k] = Array.from(v.values());
              ws.send(JSON.stringify({ type:'ui:optionsUpdate', basketId, selection }));
            }
          } catch {}
          // update price
          try { const pk = document.getElementById('optPriceKwd'); if (pk) pk.textContent = `${fmt(computePrice())} KWD`; } catch {}
        });
      });
    });
  }
  render();
  btnCancel.style.display = '';
  btnConfirm.style.display = '';
  btnCancel.onclick = () => { hideOptionsUI(); try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {} };
  btnConfirm.onclick = () => {
    // validate required
    for (const g of (groups||[])){
      const set = sel.get(g.id)||new Set();
      if (g.required && set.size === 0) { alert(`Please choose for ${g.name}`); return; }
      if (g.min && set.size < g.min) { alert(`${g.name}: choose at least ${g.min}`); return; }
      if (g.max && set.size > g.max) { alert(`${g.name}: choose up to ${g.max}`); return; }
    }
    const parts=[]; for (const g of (groups||[])) { const set = Array.from(sel.get(g.id)||[]); if (set.length) parts.push(`${g.id}:${set.join('+')}`); }
    const variantKey = `${p.id}#mods=${encodeURIComponent(parts.join(','))}`;
    addToBill({ ...p, id: p.id, price: computePrice() });
    hideOptionsUI();
    try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {}
  };
  modal.style.display = 'flex';
}

// Prefetch product images into Cache Storage for offline resilience
async function prefetchImages(list){
  try {
    if (!('caches' in window)) return;
    const cache = await caches.open('ot-drive-v1');
    const urls = Array.from(new Set((list||[])
      .map(p => imageDisplaySrcForUrl(p.image_url))
      .filter(u => typeof u === 'string' && !!u)));
    let idx = 0;
    const limit = 6;
    async function worker(){
      while (idx < urls.length){
        const i = idx++;
        const u = urls[i];
        try { const hit = await cache.match(u); if (!hit) await cache.add(u); } catch {}
      }
    }
    const runners = Array.from({ length: limit }, () => worker());
    await Promise.all(runners);
  } catch {}
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

