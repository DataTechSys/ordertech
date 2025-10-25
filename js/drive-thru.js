import { qs, qsa, fmt, getParams, loadCategories, loadProducts, startLocalCam, setRemoteVideo, createCart, api, proxiedImageSrc } from '/js/common.js?v=1.0.14';
import { setDisplayId, renderBillList, renderTotals } from '/js/ui-common.js';
import { hasMilkVariants, productOptions, computePriceWith, selectionLabelSimple } from '/js/product-helpers.js?v=1.0.0';
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
  if (/^https:\/\//i.test(raw)) {
    try {
      const h = new URL(raw).host;
      if (h && h !== location.host) return proxiedImageSrc(raw);
    } catch {}
    return raw;                 // same-origin https is fine
  }
  return raw; // local/relative path
}
function attachImageFallback(imgEl, originalUrl){
  try {
    const raw = String(originalUrl || '').trim();
    if (!imgEl || !raw) return;
    const isHttps = /^https:\/\//i.test(raw);
    const proxy = proxiedImageSrc(raw) || '/images/placeholder.png';
    let triedProxy = false;
    imgEl.addEventListener('error', () => {
      if (isHttps && !triedProxy) { triedProxy = true; imgEl.src = proxy; }
      else { imgEl.src = '/images/placeholder.png'; }
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
// LiveKit auto-rejoin state (display)
let __lkRejoinTimer = null;
let __lkRejoinBackoff = 2000;
// Audio unlock state for autoplay policy
let __audioUnlocked = false;
function clearLivekitRejoinTimer(){ try { if (__lkRejoinTimer) clearTimeout(__lkRejoinTimer); } catch {} __lkRejoinTimer = null; }
function scheduleLivekitRejoin(reason){
  try { if ((window.__rtcProvider||'') !== 'livekit') return; } catch {}
  const jitter = Math.floor(Math.random()*300);
  const delay = Math.min(__lkRejoinBackoff, 30000) + jitter;
  __lkRejoinBackoff = Math.min(__lkRejoinBackoff*2, 30000);
  clearLivekitRejoinTimer();
  __lkRejoinTimer = setTimeout(async () => { try { await joinLivekitDisplay(); } catch {} }, delay);
}
// Current RTC provider hint for telemetry and reconnect logic
try { window.__rtcProvider = 'p2p'; } catch {}
let statusFreezeUntil = 0; // gate READY flicker shortly after offers/restarts
let lastCashierName = 'Cashier';
// Heartbeat tracking for remote (cashier) media health; used to clear stale "Live" state
let __lastRtcStatusAt = 0;
let __hbMonitorTimer = null;
function startHeartbeatMonitor(){
  try { if (__hbMonitorTimer) { clearInterval(__hbMonitorTimer); __hbMonitorTimer = null; } } catch {}
  __hbMonitorTimer = setInterval(() => {
    try {
      // Only enforce when we think we're connected; otherwise, let normal flow drive UI
      if (!peersConnected) return;
      const now = Date.now();
      // If we haven't received an rtc:status in ~9s, consider the peer stale and reset UI/RTC
      if (!__lastRtcStatusAt || (now - __lastRtcStatusAt) > 9000) {
        peersConnected = false; updateIdleState();
        try { renderLiveFlag(); } catch {}
        try { setPosterVisible(true); setPosterNotice('Waiting for session…', true); } catch {}
        try { setLinkStatusLabel(); } catch {}
        try { stopRTC('hb-timeout'); } catch {}
      }
    } catch {}
  }, 4000);
}

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

    // Always show branch tag if known (even when not connected)
    try {
      const branch = localStorage.getItem('DEVICE_BRANCH') || '';
      if (branch) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'flag';
        b.textContent = `Branch: ${branch}`;
        wrap.appendChild(b);
      }
    } catch {}

    // Show live status only when peers are connected AND WebRTC looks healthy
    const pcConnected = isDisplayConnected();
    const mediaHealthy = (audioInHealthy || videoInHealthy);
    if (peersConnected && (pcConnected || mediaHealthy)) {
      // Replace text label with a simple green dot indicator (no text)
      const dot = document.createElement('span');
      dot.className = 'conn-dot online';
      dot.setAttribute('aria-label', 'Connected');
      wrap.appendChild(dot);
    }

    // Audio indicator when unlocked
    if (__audioUnlocked) {
      const a = document.createElement('button');
      a.type = 'button';
      a.className = 'flag';
      a.textContent = 'Audio: ON';
      wrap.appendChild(a);
    }
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
    // Pre-fetch RTC config to determine desired provider early (avoid starting P2P if SFU is default)
    (async () => {
      try {
        const cfg = await getIceConfigDetailed();
        if (cfg && cfg.sfu && cfg.sfu.enabled && String(cfg.sfu.defaultProvider||'') === 'livekit') {
          try { window.__rtcProvider = 'livekit'; } catch {}
        }
      } catch {}
    })();
    connect();
    init();
    try { ensurePreconnectPip(); } catch {}
    setupPresenceHeartbeat();
    // Fallback: try starting RTC even if WS handshake is blocked by proxy/CDN
    setTimeout(() => { if (window.__rtcProvider === 'p2p' && !rtcStarted && !rtcStarting) startRTC(); }, 1200);
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
try { ensurePreconnectPip(); } catch {}

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
  // Only restart the P2P stack; SFU clients handle their own reconnection
  try { if (window.__rtcProvider && window.__rtcProvider !== 'p2p') return; } catch {}
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
function isIOS(){
  try {
    const ua = navigator.userAgent || '';
    const p = navigator.platform || '';
    return /(iPad|iPhone|iPod)/i.test(ua) || (p === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch { return false; }
}
function setStatusLabelText(text, type){
  try {
    const pill = document.getElementById('linkPill');
    const label = document.getElementById('linkStatus');
    const dot = pill ? pill.querySelector('.dot') : null;
    if (type === 'connected') {
      if (dot) dot.style.background = '#22c55e';
      if (pill) { pill.style.background = '#22c55e'; pill.style.color = '#0b1220'; }
      if (label) label.textContent = isIOS() ? '' : text;
      return;
    }
    if (type === 'ready') {
      if (dot) dot.style.background = '#f59e0b';
      if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
      if (label) label.textContent = isIOS() ? '' : text;
      return;
    }
    if (type === 'reconnecting') {
      if (dot) dot.style.background = '#f59e0b';
      if (pill) { pill.style.background = '#f59e0b'; pill.style.color = '#0b1220'; }
      if (label) label.textContent = isIOS() ? '' : text;
      return;
    }
    if (type === 'offline') {
      if (dot) dot.style.background = '#ef4444';
      if (pill) { pill.style.background = '#ef4444'; pill.style.color = '#fff'; }
      if (label) label.textContent = isIOS() ? '' : text;
      return;
    }
  } catch {}
}
function setLinkStatusLabel(){
  try { renderLiveFlag(); } catch {}
  // Consider actual PC connectivity in addition to media health
  const pcConnected = isDisplayConnected();
  const mediaHealthy = (audioInHealthy || videoInHealthy);
  const connected = (mediaHealthy || pcConnected) && peersConnected;
  if (connected) {
    setStatusLabelText(`CONNECTED — ${lastCashierName}${(!videoInHealthy && audioInHealthy) ? ' (AUDIO ONLY)' : ''}`, 'connected');
  } else {
    setStatusLabelText('READY', 'ready');
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
  let __bytesSnap = null; // { inBytes, outBytes, at }
  let __lastTelemetryAt = 0;
  const TELEMETRY_PERIOD_MS = (function(){ try { const n=Number(localStorage.getItem('RTC_STATS_INTERVAL_SEC')); return Number.isFinite(n)&&n>0 ? n*1000 : 5000; } catch { return 5000; } })();
  const telemetryEnabled = () => { try { const v=String(localStorage.getItem('FRONTEND_RTC_TELEMETRY_ENABLED')||'1'); return v==='1' || /^(true|yes|on)$/i.test(v); } catch { return true; } };
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

      // telemetry (every TELEMETRY_PERIOD_MS)
      try {
        const now2 = Date.now();
        if (telemetryEnabled() && (now2 - __lastTelemetryAt) >= TELEMETRY_PERIOD_MS) {
          // Bitrates from bytes deltas across interval snapshot
          const inBytes = (typeof aIn==='number' ? aIn : (__lastStats.aIn.bytes||0)) + (typeof vIn==='number' ? vIn : (__lastStats.vIn.bytes||0));
          const outBytes = (typeof aOut==='number' ? aOut : (__lastStats.aOut.bytes||0)) + (typeof vOut==='number' ? vOut : (__lastStats.vOut.bytes||0));
          let brInKbps = null, brOutKbps = null;
          if (__bytesSnap) {
            const dt = Math.max(0.5, (now2 - __bytesSnap.at)/1000);
            const dIn = Math.max(0, inBytes - __bytesSnap.inBytes);
            const dOut = Math.max(0, outBytes - __bytesSnap.outBytes);
            brInKbps = Math.round((dIn*8/1000)/dt);
            brOutKbps = Math.round((dOut*8/1000)/dt);
          }
          __bytesSnap = { inBytes, outBytes, at: now2 };

          // Candidate pair, RTT, jitter and loss
          let byId = new Map();
          rep.forEach(r => { try { if (r && r.id) byId.set(r.id, r); } catch {} });
          let rttMs = null, pairId = null, localCand = null, remoteCand = null;
          rep.forEach(r => {
            if (r.type === 'transport' && r.selectedCandidatePairId) {
              const pair = byId.get(r.selectedCandidatePairId);
              if (pair) {
                pairId = pair.id || null;
                if (typeof pair.currentRoundTripTime === 'number') rttMs = Math.round(pair.currentRoundTripTime * 1000);
                const lc = byId.get(pair.localCandidateId);
                const rc = byId.get(pair.remoteCandidateId);
                if (lc) localCand = { type: lc.candidateType, protocol: lc.protocol };
                if (rc) remoteCand = { type: rc.candidateType, protocol: rc.protocol };
              }
            }
          });
          // Approx jitter and loss (use inbound stats if present)
          let jitterMs = null, lossPct = null;
          try {
            let jitterSum = 0, jitterN = 0, lost = 0, recv = 0;
            rep.forEach(r => {
              if (r.type === 'inbound-rtp' && !r.isRemote) {
                if (typeof r.jitter === 'number') { jitterSum += (r.jitter*1000); jitterN++; }
                if (typeof r.packetsLost === 'number') lost += Math.max(0, r.packetsLost);
                if (typeof r.packetsReceived === 'number') recv += Math.max(0, r.packetsReceived);
              }
            });
            jitterMs = jitterN ? Math.round(jitterSum / jitterN) : null;
            lossPct = (lost+recv) ? Math.round((lost*1000)/(lost+recv))/10 : null;
          } catch {}

          const headers = { 'content-type':'application/json' };
          try { if (tenant) headers['x-tenant-id'] = tenant; } catch {}
          try {
            const tok = localStorage.getItem('DEVICE_TOKEN_DISPLAY') || localStorage.getItem('DEVICE_TOKEN') || '';
            if (tok) headers['x-device-token'] = tok;
          } catch {}
          const device_id = (function(){ try { return localStorage.getItem('DEVICE_ID_DISPLAY') || localStorage.getItem('DEVICE_ID') || ''; } catch { return ''; } })();
          const payload = {
            basketId,
            role: 'display',
            device_id,
            provider: (window.__rtcProvider || 'p2p'),
            metrics: {
              rtt_ms: rttMs,
              br_in_kbps: brInKbps,
              br_out_kbps: brOutKbps,
              jitter_ms: jitterMs,
              pkt_loss_pct: lossPct,
              local_candidate: localCand,
              remote_candidate: remoteCand,
              pair_id: pairId
            }
          };
          fetch('/rtc/telemetry', { method:'POST', headers, body: JSON.stringify(payload) }).catch(()=>{});
          __lastTelemetryAt = now2;
        }
      } catch {}

      // update UI
      setLinkStatusLabel();
      updatePosterFromHealth();
    } catch {}
  }, 2000);
}
// Optional: mic level meter for diagnostics (enable with localStorage.DRIVE_DEBUG_MIC='1')
function maybeStartMicMeter(stream){
  try {
    if (!stream) return;
    if (String(localStorage.getItem('DRIVE_DEBUG_MIC')||'') !== '1') return;
    if (document.getElementById('micMeter')) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const el = document.createElement('div');
    el.id = 'micMeter';
    Object.assign(el.style, { position:'fixed', left:'12px', bottom:'12px', width:'120px', height:'10px', background:'#1f2937', border:'1px solid #334155', borderRadius:'4px', zIndex:9999 });
    const bar = document.createElement('div'); Object.assign(bar.style, { height:'100%', width:'2%', background:'#22c55e', borderRadius:'3px', transition:'width 80ms linear' });
    el.appendChild(bar); document.body.appendChild(el);
    function tick(){
      try {
        analyser.getByteTimeDomainData(data);
        let sum=0; for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
        const rms = Math.sqrt(sum/data.length);
        const pct = Math.min(100, Math.max(0, Math.round(rms*180)));
        bar.style.width = Math.max(2, pct) + '%';
      } catch {}
      requestAnimationFrame(tick);
    }
    tick();
  } catch {}
}

function ensurePreconnectPip(){
  try {
    if (!localEl) return;
    const s = localEl.srcObject;
    if (s && typeof s.getTracks === 'function' && s.getTracks().some(t => t.readyState === 'live')) return;
    // Start a lightweight preview without audio to avoid feedback; will be replaced by RTC provider once connected
    startLocalCam(localEl, { audio: false }).catch(()=>{});
  } catch {}
}

function stopPreconnectPip(){
  try {
    const pip = localEl || document.getElementById('localVideo');
    if (!pip) return;
    const s = pip.srcObject;
    if (s && typeof s.getTracks === 'function') {
      s.getTracks().forEach(t => { try { t.stop(); } catch {} });
    }
    pip.srcObject = null;
  } catch {}
}

function stopRTC(reason){
  try { updateIdleState(); } catch {}
  try { console.log('RTC(display) stop', { reason }); } catch {}
  __audioUnlocked = false; try { renderLiveFlag(); } catch {}
  clearRtcTimers();
  try {
    const pc = window.__pcDisplay; if (pc && pc.close) pc.close();
  } catch {}
  // Also disconnect LiveKit room if present and clean up any audio elements
  try {
    const room = window.__lkRoomDisplay;
    if (room && typeof room.disconnect === 'function') { try { room.disconnect(); } catch {} }
    const sink = document.getElementById('audioSink') || document.body;
    Array.from(sink.querySelectorAll('audio')).forEach(el => { try { el.pause && el.pause(); el.srcObject = null; el.remove(); } catch {} });
  } catch {}
  window.__lkRoomDisplay = null;
  window.__pcDisplay = null;
  try {
    const s = localEl && localEl.srcObject; if (s && s.getTracks) { for (const t of s.getTracks()) { try { t.stop(); } catch {} } }
    if (localEl) localEl.srcObject = null;
  } catch {}
  try { if (remoteEl) remoteEl.srcObject = null; } catch {}
  rtcStarted = false; rtcStarting = false; restartTimer && clearTimeout(restartTimer); restartTimer = null; rtcBackoff = 1000;
  // force refresh ICE servers next time
  try { window.__ICE_SERVERS = null; } catch {}
  const keepLabel = (reason === 'preclear');
  if (!keepLabel) {
    setStatusLabelText('READY', 'ready');
  }
  // Reset health and show poster when RTC is stopped
  audioInHealthy = audioOutHealthy = videoInHealthy = videoOutHealthy = false;
  setPosterVisible(true);
  try { ensurePreconnectPip(); } catch {}
}
async function startRTC(){
  if (rtcStarted || rtcStarting) return;
  rtcStarting = true;
  try {
    const localStream = await startLocalCam(localEl, { audio: true });
    try { if (localStream && localStream.getAudioTracks) localStream.getAudioTracks().forEach(t => { try { t.enabled = true; } catch {} }); } catch {}
    try { maybeStartMicMeter(localStream); } catch {}
    await initRTC(localStream);
    // Ensure sender audio track is enabled once PC is created
    setTimeout(() => {
      try {
        const pc = window.__pcDisplay;
        if (pc && typeof pc.getSenders === 'function') {
          pc.getSenders().forEach(s => { const tr = s && s.track; if (tr && tr.kind === 'audio') { try { tr.enabled = true; } catch {} } });
        }
      } catch {}
    }, 0);
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
  // Load categories; robust fallback even when tenant is provided (avoid blank UI)
  try {
    cats = await loadCategories(tenant);
  } catch {
    cats = null;
  }
  if (!Array.isArray(cats) || cats.length === 0) {
    try {
      const fb = await loadFallbackCatalog();
      if (fb && Array.isArray(fb.cats) && fb.cats.length) {
        cats = fb.cats;
        try { console.warn('Categories fallback applied (JSON catalog)'); } catch {}
      } else {
        cats = [];
      }
    } catch {
      cats = [];
    }
  }
  // Load products; robust fallback even when tenant is provided (avoid blank UI)
  try {
    allProds = await loadProducts(tenant);
  } catch {
    allProds = null;
  }
  if (!Array.isArray(allProds) || allProds.length === 0) {
    try {
      const fb = await loadFallbackCatalog();
      if ((!cats || !cats.length) && fb && Array.isArray(fb.cats) && fb.cats.length) cats = fb.cats;
      if (fb && Array.isArray(fb.prods) && fb.prods.length) {
        allProds = fb.prods;
        try { console.warn('Products fallback applied (JSON catalog)'); } catch {}
      } else {
        allProds = [];
      }
    } catch {
      allProds = [];
    }
  }

  imgMap = new Map((allProds||[]).map(p => [p.id, imageDisplaySrcForUrl(p.image_url)]));
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
  // Defer image prefetch until after initial render so first paint is fast
  try {
    const schedule = () => {
      try {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(() => { prefetchImages(allProds).catch(()=>{}); }, { timeout: 2500 });
        } else {
          setTimeout(() => { prefetchImages(allProds).catch(()=>{}); }, 1200);
        }
      } catch {}
    };
    // Queue scheduling after current task yields to paint
    setTimeout(schedule, 0);
  } catch {}
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
      // Removed: Display should not send category selections back to Cashier
      // This prevents feedback loops and ensures proper remote control flow
      // The Cashier controls the Display menu, not vice versa
      // try {
      //   if (ws && ws.readyState === WebSocket.OPEN) {
      //     ws.send(JSON.stringify({ type: 'ui:selectCategory', basketId, name: c.name }));
      //   }
      // } catch {}
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
    const initial = imageDisplaySrcForUrl(p.image_url) || '/images/placeholder.png';
    img.decoding = 'async';
    img.loading = 'eager';
    try { img.setAttribute('fetchpriority', 'high'); } catch {}
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
try {
        const device_id = localStorage.getItem('DEVICE_ID_DISPLAY') || localStorage.getItem('DEVICE_ID') || '';
        ws.send(JSON.stringify({ type:'hello', basketId, role:'display', name, device_id }));
      } catch {
        ws.send(JSON.stringify({ type:'hello', basketId, role:'display', name }));
      }
      } catch {}
      // Start heartbeat watchdog
      try { __lastRtcStatusAt = 0; startHeartbeatMonitor(); } catch {}
      setStatusLabelText('READY', 'ready');
      // Keep poster visible while connecting/handshaking
      setPosterVisible(true);
      // Decide provider first to avoid spinning up P2P when SFU is available
      (async () => {
        try {
          const cfg = await getIceConfigDetailed();
          if (cfg && cfg.sfu && cfg.sfu.enabled && String(cfg.sfu.defaultProvider||'') === 'livekit'){
            try { window.__rtcProvider = 'livekit'; } catch {}
            try { stopRTC('prefer-sfu'); } catch {}
            const ok = await joinLivekitDisplay();
            if (!ok) {
              // Fallback to P2P only if SFU connect fails
              try { window.__rtcProvider = 'p2p'; } catch {}
              startRTC();
            }
          } else {
            // No SFU available → P2P
            try { window.__rtcProvider = 'p2p'; } catch {}
            startRTC();
          }
        } catch {
          // On error, keep P2P behavior
          try { window.__rtcProvider = 'p2p'; } catch {}
          startRTC();
        }
      })();
      statusFreezeUntil = Date.now() + 3000;
    });
    ws.addEventListener('message', async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
if (msg.type === 'rtc:status' && msg.basketId === basketId) {
          try {
            __lastRtcStatusAt = Date.now();
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
            // Reflect disconnected state immediately in UI
            peersConnected = false; try { renderLiveFlag(); setLinkStatusLabel(); updatePosterFromHealth(); } catch {}
            // If cashier requested a hard reset, reload to pick up latest config/state
            if (msg.reason === 'reset') {
              try { location.reload(); } catch {}
            }
          }
          return;
        }
        if (msg.type === 'rtc:provider' && (msg.provider === 'livekit' || msg.provider === 'twilio')) {
          (async () => {
            try {
              try { clearLivekitRejoinTimer(); } catch {}
              stopRTC('sfu-switch');
              if (msg.provider === 'livekit') await joinLivekitDisplay();
              else await joinTwilioDisplay();
            } catch {}
          })();
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
            try { if ((window.__rtcProvider||'p2p') === 'p2p') startRTC(); } catch {}
          } else {
            // Avoid flicker to READY while we are connecting/connected
            const pc = window.__pcDisplay;
            const midHandshake = (Date.now() < statusFreezeUntil) || (pc && (
              pc.connectionState === 'connecting' || pc.connectionState === 'connected' ||
              pc.iceConnectionState === 'checking' || pc.iceConnectionState === 'connected'
            ));
            if (midHandshake) return;
            // Peer left: immediately stop RTC to clear stale media and UI state
            try { stopRTC('peer-left'); } catch {}
            peersConnected = false; updateIdleState();
            try { renderLiveFlag(); } catch {}
            setStatusLabelText('READY', 'ready');
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
        // Apply RTC config preference from cashier and restart to take effect
        if (msg.type === 'rtc:config' && msg.basketId === basketId) {
          try { window.applyRtcConfig = msg.config || null; } catch {}
          try { stopRTC('reconfig'); } catch {}
          statusFreezeUntil = Date.now() + 3000;
          setTimeout(() => { try { startRTC(); } catch {} }, 150);
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
      try { __lastRtcStatusAt = 0; } catch {}
      setStatusLabelText('OFFLINE', 'offline');
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

  sel = sel || {};

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
    grp.push(`<div style=\"margin-top:8px;font-weight:600;\">Price: ${fmt(price)} KWD</div>`);
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
            // update price label
            render();
          });
        });
      });
    }
  }
  render();

  btnCancel.style.display = readOnly ? 'none' : '';
  btnConfirm.style.display = readOnly ? 'none' : '';
  // Ensure buttons are enabled when interactive
  btnCancel.disabled = !!readOnly ? true : false;
  btnConfirm.disabled = !!readOnly ? true : false;

  btnCancel.onclick = () => { hideOptionsUI(); try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {} };
  btnConfirm.onclick = () => {
    const price = computePriceWith(p, opts, sel);
    const suffix = selectionLabelSimple(opts, sel);
    const variantKey = `${p.id}#size=${sel.sizeId||''}&milk=${sel.milkId||''}`;
    try {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type:'basket:update', basketId, op:{ action:'add', item:{ sku: variantKey, name: suffix?`${p.name} (${suffix})`:p.name, price }, qty:1 } }));
      }
    } catch {}
    hideOptionsUI();
    try { if (peersConnected) ws && ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {}
  };

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
  const imgUrl = imageDisplaySrcForUrl(p.image_url) || '/images/placeholder.png';
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
  btnCancel.onclick = () => { hideOptionsUI(); try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {} };
  btnConfirm.onclick = async () => {
    try {
      const groups = await fetchProductModifiers(p);
      if (Array.isArray(groups) && groups.length) {
        // Drive: open full interactive modifiers UI and mirror to cashier
        showProductPopupWithOptions(p, groups);
        try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups })); } catch {}
      } else {
        // Fallback to simple options (size/milk) if defined
        const opts = productOptions(p);
        if (opts && ((opts.size && opts.size.length) || (opts.milk && opts.milk.length))) {
          const groups2 = [];
          if (opts.size && opts.size.length) groups2.push({ id:'size', name:'Size', required:false, min:0, max:1, options: opts.size.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
          if (opts.milk && opts.milk.length) groups2.push({ id:'milk', name:'Milk', required:false, min:0, max:1, options: opts.milk.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
          showProductPopupWithOptions(p, groups2);
          try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups: groups2 })); } catch {}
        } else {
          addToBill(p);
          hideOptionsUI();
        }
      }
    } catch {
      addToBill(p);
      hideOptionsUI();
    }
  };
  modal.style.display = 'flex';
}

async function onDisplayProductClick(p){
  // Prefer opening Options immediately if real modifiers or simple options exist; otherwise show preview
  try {
    const groups = await fetchProductModifiers(p);
    if (Array.isArray(groups) && groups.length) {
      // Open full modifiers UI and mirror to cashier
      showProductPopupWithOptions(p, groups);
      try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups })); } catch {}
      return;
    }
  } catch {}
  // Fallback to simple options (size/milk) if defined
  try {
    const opts = productOptions(p);
    if (opts && ((opts.size && opts.size.length) || (opts.milk && opts.milk.length))) {
      const groups2 = [];
      if (opts.size && opts.size.length) groups2.push({ id:'size', name:'Size', required:false, min:0, max:1, options: opts.size.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
      if (opts.milk && opts.milk.length) groups2.push({ id:'milk', name:'Milk', required:false, min:0, max:1, options: opts.milk.map(o=>({ id:o.id, name:o.label, delta:Number(o.delta)||0 })) });
      showProductPopupWithOptions(p, groups2);
      try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showOptions', basketId, product: p, groups: groups2 })); } catch {}
      return;
    }
  } catch {}
  // Otherwise, show preview locally and remotely
  try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:showPreview', basketId, product: p })); } catch {}
  showProductPreviewUIDisplay(p);
}

// Detailed ICE config helper (cached with TTL to avoid rate limits)
let __rtcCfgCacheDisplay = null; let __rtcCfgAtDisplay = 0;
async function getIceConfigDetailed(){
  const now = Date.now();
  try {
    if (__rtcCfgCacheDisplay && (now - __rtcCfgAtDisplay) < 60000) return __rtcCfgCacheDisplay;
    const r = await fetch('/webrtc/config', { cache:'no-store' });
    if (!r.ok) {
      if (r.status === 429 && __rtcCfgCacheDisplay) return __rtcCfgCacheDisplay;
      throw new Error('cfg_fetch_failed');
    }
    const j = await r.json();
    __rtcCfgCacheDisplay = j; __rtcCfgAtDisplay = now;
    return j;
  } catch {
    return __rtcCfgCacheDisplay || { iceServers:[{ urls: ['stun:stun.l.google.com:19302'] }] };
  }
}

// Simple audio prompt overlay for autoplay restrictions
function showAudioPrompt(room){
  try {
    if (document.getElementById('audioPrompt')) return;
    const div = document.createElement('div');
    div.id = 'audioPrompt';
    Object.assign(div.style, {
      position:'fixed', bottom:'16px', left:'16px', zIndex:99999,
      background:'#0b1220', color:'#fff', border:'1px solid #243244', borderRadius:'10px',
      padding:'10px 12px', boxShadow:'0 6px 18px rgba(0,0,0,0.35)', display:'flex', gap:'8px', alignItems:'center'
    });
    const txt = document.createElement('span'); txt.textContent = 'Tap to enable audio'; txt.style.fontWeight='700';
    const btn = document.createElement('button'); btn.textContent = 'Enable'; Object.assign(btn.style, { padding:'6px 10px', borderRadius:'8px', border:'1px solid #334155', background:'#22c55e', color:'#0b1220', cursor:'pointer', fontWeight:'800' });
    btn.onclick = async () => {
      try { await room.startAudio(); document.body.removeChild(div); } catch (_) { btn.textContent='Tap again'; }
    };
    div.appendChild(txt); div.appendChild(btn); document.body.appendChild(div);
  } catch {}
}
function hideAudioPrompt(){ try { const el=document.getElementById('audioPrompt'); if (el) el.remove(); } catch {}}

// Global one-time audio unlock handler to satisfy autoplay restrictions
function ensureAudioUnlocked(room){
  try {
    if (!room) return;
    if (window.__audioUnlockInstalled) return;
    const tryStart = async () => {
      try { await room.startAudio(); __audioUnlocked = true; hideAudioPrompt(); try { renderLiveFlag(); } catch {} } catch {}
      try {
        window.removeEventListener('pointerdown', tryStart, { capture: true });
        window.removeEventListener('click', tryStart, { capture: true });
        window.removeEventListener('touchstart', tryStart, { capture: true });
      } catch {}
    };
    window.addEventListener('pointerdown', tryStart, { capture: true, once: true });
    window.addEventListener('click', tryStart, { capture: true, once: true });
    window.addEventListener('touchstart', tryStart, { capture: true, once: true });
    window.__audioUnlockInstalled = true;
  } catch {}
}

async function joinLivekitDisplay(){
  try {
    clearLivekitRejoinTimer();
    // Load LiveKit SDK: prefer same-origin vendor proxy, then ESM CDNs, then UMD script globals
    async function loadLivekitModule(){
      // 1) Same-origin ESM proxy (avoids CORS/DNS issues)
      try { return await import('/js/vendor/livekit-client.esm.js?v=2.4.0'); } catch (e) {}
      // 2) ESM from public CDNs
      const urls = [
        'https://cdn.livekit.io/client-sdk-js/v2.4.0/livekit-client.esm.js',
        'https://cdn.jsdelivr.net/npm/@livekit/client@2.4.0/dist/livekit-client.esm.js',
        'https://unpkg.com/@livekit/client@2.4.0/dist/livekit-client.esm.js'
      ];
      let lastErr;
      for (const u of urls) { try { return await import(u); } catch (e) { lastErr = e; } }
      // 3) UMD fallback (classic script, no CORS required)
      const umdUrls = [ '/js/vendor/livekit-client.umd.min.js', 'https://cdn.jsdelivr.net/npm/@livekit/client@2.4.0/dist/livekit-client.umd.min.js', 'https://unpkg.com/@livekit/client@2.4.0/dist/livekit-client.umd.min.js' ];
      for (const u of umdUrls) {
        try {
          await new Promise((resolve, reject) => { const s=document.createElement('script'); s.src=u; s.async=true; s.onload=()=>resolve(true); s.onerror=()=>reject(new Error('load_failed')); document.head.appendChild(s); });
          const g = (window.livekit||window.Livekit||window.LiveKit||window.LiveKitClient||window.LK||null);
          if (g && g.Room) return g;
        } catch (e) { lastErr = e; }
      }
      throw lastErr || new Error('livekit_load_failed');
    }

    const r = await fetch('/rtc/token', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ provider:'livekit', basketId, role:'drive' }) });
    if (!r.ok) return false; const j = await r.json();
    if (!j || !j.token || !j.url) return false;

    const lk = await loadLivekitModule();
    const room = new lk.Room({
      adaptiveStream: true,
      dynacast: true,
      stopLocalTrackOnUnpublish: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      publishDefaults: {
        // Prefer H.264 for smoother iOS decode, enable simulcast so SFU can pick a fitting layer
        videoCodec: 'h264',
        simulcast: true,
        videoEncoding: { maxBitrate: 600_000, maxFramerate: 24 },
        audioBitrate: 20_000
      }
    });
    window.__lkRoomDisplay = room;

    const remoteStreamVideo = document.getElementById('remoteVideo');
    const audioSink = document.getElementById('audioSink') || document.body;
room.on(lk.RoomEvent.TrackSubscribed, (track, publication, participant) => {
      try {
        if (participant && participant.isLocal) return; // ignore self
        if (track.kind === 'audio') {
          const el = document.createElement('audio');
          el.autoplay = true; el.playsInline = true;
          track.attach(el);
          try { audioSink.appendChild(el); el.play && el.play().catch(()=>{}); } catch {}
        } else if (track.kind === 'video' && remoteStreamVideo) {
          try { track.attach(remoteStreamVideo); remoteStreamVideo.muted = true; remoteStreamVideo.play && remoteStreamVideo.play().catch(()=>{}); } catch {}
        }
      } catch {}
    });

    // Attach local video track to the PiP element when published
    try {
      const pip = document.getElementById('localVideo');
      room.on(lk.RoomEvent.LocalTrackPublished, (pub) => {
        try {
          const track = pub && pub.track;
          if (track && track.kind === 'video' && pip) {
            // Stop any pre-connect preview and hand-over to LiveKit
            try { const s = pip.srcObject; if (s && s.getTracks) { s.getTracks().forEach(t => { try { t.stop(); } catch {} }); pip.srcObject = null; } } catch {}
            track.attach(pip);
            try { pip.muted = true; pip.playsInline = true; pip.autoplay = true; pip.play && pip.play().catch(()=>{}); } catch {}
          }
        } catch {}
      });
    } catch {}

    // Detach and remove media elements when tracks are unsubscribed
room.on(lk.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      try {
        const els = track.detach();
        els && els.forEach(el => { try { el.pause && el.pause(); el.srcObject = null; el.remove(); } catch {} });
      } catch {}
    });

    // Clean up participant media on disconnects
    room.on(lk.RoomEvent.ParticipantDisconnected, (participant) => {
      try {
        participant.tracks.forEach(pub => { try { const t = pub.track; if (t) { const els = t.detach(); els && els.forEach(el => { try { el.pause && el.pause(); el.srcObject = null; el.remove(); } catch {} }); } } catch {} });
      } catch {}
    });

    // Update UI while reconnecting
    room.on(lk.RoomEvent.Reconnecting, () => {
      try {
        setStatusLabelText('RECONNECTING — SFU(LiveKit)', 'reconnecting');
      } catch {}
      try { setPosterVisible(true); } catch {}
    });
room.on(lk.RoomEvent.Reconnected, () => {
      try { __lkRejoinBackoff = 2000; clearLivekitRejoinTimer(); } catch {}
      try { setPosterVisible(false); } catch {}
      try { renderLiveFlag(); } catch {}
      try {
        setStatusLabelText('CONNECTED — SFU(LiveKit)', 'connected');
      } catch {}
    });

    // Basic resilience: if disconnected, show poster and let outer flow retry
room.on(lk.RoomEvent.Disconnected, () => {
      try { setPosterVisible(true); } catch {}
      try {
        __audioUnlocked = false; renderLiveFlag();
        // Detach all tracks and remove any appended audio elements
        room.participants.forEach(p => { try { p.tracks.forEach(pub => { const t = pub.track; if (t) { const els = t.detach(); els && els.forEach(el => { try { el.pause && el.pause(); el.srcObject = null; el.remove(); } catch {} }); } }); } catch {} });
        const sink = document.getElementById('audioSink') || document.body;
        Array.from(sink.querySelectorAll('audio')).forEach(el => { try { el.pause && el.pause(); el.srcObject = null; el.remove(); } catch {} });
      } catch {}
      try { window.__lkRoomDisplay = null; } catch {}
      try { ensurePreconnectPip(); } catch {}
      try { scheduleLivekitRejoin('disconnected'); } catch {}
    });

    await room.connect(j.url, j.token);
    try { __lkRejoinBackoff = 2000; clearLivekitRejoinTimer(); } catch {}
    try { window.__rtcProvider = 'livekit'; } catch {}
    // Some browsers block audio autoplay until a gesture; attempt to start audio context
    try { await room.startAudio(); __audioUnlocked = true; hideAudioPrompt(); } catch { __audioUnlocked = false; showAudioPrompt(room); ensureAudioUnlocked(room); }
    try { renderLiveFlag(); } catch {}
    // Hand-over camera from preconnect preview to LiveKit before enabling local tracks
    try { stopPreconnectPip(); } catch {}
    try { await room.localParticipant.setMicrophoneEnabled(true); } catch {}
    // Enable local camera so cashier can see the display and PiP shows locally (lower res for latency/stability)
    try { await room.localParticipant.setCameraEnabled(true, { resolution: { width: 960, height: 540 }, frameRate: 24, facingMode: 'user' }); } catch {}
    try { setPosterVisible(false); } catch {}
    try { setStatusLabelText('CONNECTED — SFU(LiveKit)', 'connected'); } catch {}
    return true;
  } catch (e) { try { scheduleLivekitRejoin('join-failed'); } catch {} return false; }
}

function loadTwilioVideo(){
  return new Promise((resolve, reject) => {
    if (window.Twilio && window.Twilio.Video) return resolve(window.Twilio.Video);
    const s = document.createElement('script');
    s.src = 'https://sdk.twilio.com/js/video/releases/2.28.1/twilio-video.min.js';
    s.async = true;
    s.onload = () => { try { resolve(window.Twilio && window.Twilio.Video ? window.Twilio.Video : null); } catch(e){ reject(e); } };
    s.onerror = () => reject(new Error('twilio_video_load_failed'));
    document.head.appendChild(s);
  });
}

async function joinTwilioDisplay(){
  try {
    const r = await fetch('/rtc/token', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ provider:'twilio', basketId, role:'drive' }) });
    if (!r.ok) return false; const j = await r.json();
    if (!j || !j.token) return false;
    const TVideo = await loadTwilioVideo(); if (!TVideo) return false;
    const room = await TVideo.connect(j.token, {
      audio: true,
      video: false,
      dominantSpeaker: true,
      networkQuality: { local: 1, remote: 1 }
    });
window.__twRoomDisplay = room;
    try { window.__rtcProvider = 'twilio'; } catch {}
    const remoteStreamVideo = document.getElementById('remoteVideo');
    const audioSink = document.getElementById('audioSink') || document.body;
    room.on('trackSubscribed', (track) => {
      try {
        if (track.kind === 'audio') {
          const el = track.attach();
          el.autoplay = true; el.playsInline = true;
          try { audioSink.appendChild(el); el.play && el.play().catch(()=>{}); } catch {}
        } else if (track.kind === 'video' && remoteStreamVideo) {
          try { track.attach(remoteStreamVideo); remoteStreamVideo.muted = true; remoteStreamVideo.play && remoteStreamVideo.play().catch(()=>{}); } catch {}
        }
      } catch {}
    });
    try { setPosterVisible(false); } catch {}
    try { setStatusLabelText('CONNECTED — SFU(Twilio)', 'connected'); } catch {}
    return true;
  } catch (e) { return false; }
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
    try { window.__rtcProvider = 'p2p'; } catch {}
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
console.log('RTC(display) init', { pairId: basketId, icePolicy, servers: Array.isArray(iceServers) ? iceServers.length : 0 });
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
    function renderGroups(){
      const sections = [];
      for (const g of groups){
        const set = sel.get(g.id)||new Set();
        const multi = (g.max||0) !== 1;
        const items = (g.options||[]).map(o => renderOptionButton({ id:o.id, name:o.name, delta:o.delta }, set.has(o.id))).join('');
        const note = (g.required || g.min || g.max) ? `<small class=\"muted\">${g.required?'Required. ':''}${g.min?`Min ${g.min}. `:''}${g.max?`Max ${g.max}.`:''}</small>` : '';
        sections.push(`<fieldset data-gid=\"${g.id}\"><legend>${g.name}</legend><div class=\"optrow\">${items}</div>${note}</fieldset>`);
      }
      return `<div class=\"options-box\" style=\"margin-top:8px; padding:12px; border:1px solid #e5e7eb; border-radius:12px;\">\n          <h4 style=\"margin:0 0 8px 0;\">Options</h4>\n          ${sections.join('')}\n        </div>`;
    }
    body.innerHTML = `
      <div style=\"display:flex; flex-direction:column; gap:12px;\">\n        <img class=\"product-img\" src=\"${img}\" alt=\"${p.name}\"/>\n        <div class=\"names\" style=\"text-align:center; width:100%;\">\n          <div class=\"name-ar\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:700; font-size:1.1em; direction:rtl;\">${ar||'\\u00A0'}</div>\n          <div class=\"name-en\" style=\"font-family: 'Almarai', Inter, system-ui; font-weight:600;\">${p.name}</div>\n          <div class=\"price\" id=\"optPriceKwd\" style=\"margin-top:6px; color:#6b7280; font-weight:700;\">${fmt(price)} KWD</div>\n        </div>\n        ${renderGroups()}\n      </div>`;
    try { const el = body.querySelector('img.product-img'); if (el) attachImageFallback(el, p.image_url); } catch {}
    applyOptionButtonStyles(body);
    body.querySelectorAll('fieldset[data-gid]').forEach(fs => {
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
  btnCancel.disabled = false; btnConfirm.disabled = false;
  btnCancel.onclick = () => { hideOptionsUI(); try { if (ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify({ type:'ui:optionsClose', basketId })); } catch {} };
  btnConfirm.onclick = () => {
    // validate required
    for (const g of (groups||[])){
      const set = sel.get(g.id)||new Set();
      if (g.required && set.size === 0) { alert(`Please choose for ${g.name}`); return; }
      if (g.min && set.size < g.min) { alert(`${g.name}: choose at least ${g.min}`); return; }
      if (g.max && set.size > g.max) { alert(`${g.name}: choose up to ${g.max}`); return; }
    }
    const price = computePrice();
    const suffix = selectionLabel();
    const parts=[]; for (const g of (groups||[])) { const set = Array.from(sel.get(g.id)||[]); if (set.length) parts.push(`${g.id}:${set.join('+')}`); }
    const variantKey = `${p.id}#mods=${encodeURIComponent(parts.join(','))}`;
    const itemName = suffix ? `${p.name} (${suffix})` : p.name;
    try {
      if (ws && ws.readyState===WebSocket.OPEN) {
        ws.send(JSON.stringify({ type:'basket:update', basketId, op:{ action:'add', item:{ sku: variantKey, name: itemName, price }, qty:1 } }));
      }
    } catch {}
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
    const limit = 4;
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

